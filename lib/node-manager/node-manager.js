var events       = require('events'),
    util         = require('util'),
    zookeeper    = require('node-zookeeper-client'),
    async        = require('async'),
    shortId       = require('shortid'),

    constants    = require('./constants'),
    ConsistentHashing = require('./consistent-hashing').ConsistentHashing;

function wait(msecs){
  var start = new Date().getTime();
  var cur = start;
  while(cur - start < msecs){
    cur = new Date().getTime();
  }
}

/**
 * 서버정보를 Zookeeper에 등록 후 watching 하면서 사용가능한 서버를 동적으로 관리하기 위한 모듈
 * @module
 * @name NodeManager
 */
var NodeManager = exports.NodeManager = function (addr, isWatching, callback) {

  this.address = addr || 'localhost:2181';
  this.ready = false;

  events.EventEmitter.call(this);

  var self = this;

  this.nodeRing = new ConsistentHashing();
  this.appInfos = {};

  this.zkClient = zookeeper.createClient(this.address, { retries : 2 });
  this.connected = false;
  this.connectionTryNum=0;

  this.zkClient.once('connected', function () {

    self.connected = true;

    /* 왜 아래 코드는 안될까?
    var paths = [ '', constants.SERVERS_PATH, constants.META_PATH ];

    async.map(paths, self._initPath, function (err, results) {

      if(isWatching) self._watchServerNodes();
      self.ready = true;

      if(callback) callback();

    });
    */

    // 주키퍼에 노드를 생성함. '/xpush/servers/meta/app/session'
    self._initPath('', function () {
      self._initPath(constants.SERVERS_PATH, function () {
        self._initPath(constants.META_PATH, function () {
          self._initPath(constants.META_PATH+constants.APP_PATH, function () {
            self._initPath(constants.META_PATH+constants.GW_SERVER_PATH, function () {

              if(isWatching){
                self._watchServerNodes();
                self._watchAppNodes();
              }
              self.ready = true;

              if(callback) callback();
            });
          });
        });
      });
    });
  });

  this.zkClient.connect();

  var connectTry = function(){

    if(!self.connected){
      if(self.connectionTryNum>3){
        if(callback) callback( 'ERR-ZOOKEEPER', 'zookeeper - failed to connect to ['+self.address+']');
      }else{
        self.connectionTryNum++;
        setTimeout(connectTry,2000);
      }
    }
  };
  connectTry();
};

util.inherits(NodeManager, events.EventEmitter);

/**
 * User 정보가 있는지 확인 후에 있는 경우 수정한다. deviceId를 필수로 입력받아야 한다.
 * @name isReady
 * @function
 */
NodeManager.prototype.isReady = function () {
  return this.ready;
};

/**
 * Zookeeper에 nodePath가 있는지 확인 후 없는 경우 생성함.
 * @private
 * @name _initPath
 * @function
 * @param {string} nodePath - node path
 * @param {callback} done - 초기화 후 수행할 callback function
 */
NodeManager.prototype._initPath = function (nodePath, callback) {

  var self = this;

  self.zkClient.exists(
    constants.BASE_ZNODE_PATH+nodePath,
    function (error, stat) {
      if (error) {
        console.log(error.stack);
        return;
      }

      if (!stat) {
         self._createZnode(nodePath, callback);
       }else{
         if(callback) callback(null);
       }
   });

};

/**
 * Zookeeper에 node를 persistent 모드로 생성함.
 * @private
 * @name _createZnode
 * @function
 * @param {string} nodePath - node path
 * @param {callback} done - 초기화 후 수행할 callback function
 */
NodeManager.prototype._createZnode = function (nodePath, callback) {
  this.zkClient.create(
    constants.BASE_ZNODE_PATH + nodePath,
    zookeeper.CreateMode.PERSISTENT,
    function (error) {
      if (error) {
        console.log('Failed to create node: %s due to: %s.', constants.BASE_ZNODE_PATH+nodePath, error);
        if(callback) callback(error);
      } else {
        if(callback) callback(null, constants.BASE_ZNODE_PATH + nodePath );
      }
    }
  );
};

/**
 * Zookeeper에 node를 EPHEMERAL 모드로 생성함.
 * @private
 * @name _createEphemeralZnode
 * @function
 * @param {string} nodePath - node path
 * @param {callback} done - 초기화 후 수행할 callback function
 */
NodeManager.prototype._createEphemeralZnode = function (nodePath, callback) {
 this.zkClient.create(
   constants.BASE_ZNODE_PATH + nodePath,
   zookeeper.CreateMode.EPHEMERAL,
   function (error) {
     if (error) {
       console.log('Failed to create node: %s due to: %s.', constants.BASE_ZNODE_PATH+nodePath, error);
       if(callback) callback(error);
     } else {
       if(callback) callback(null, constants.BASE_ZNODE_PATH + nodePath );
     }
   }
 );
};



/**
 * Zookeeper에 node를 persistent 모드로 생성함.
 * @private
 * @name _createZnodeWithData
 * @function
 * @param {string} nodePath - node path
 * @param {object} - node에 저장할 data
 * @param {callback} callback - 초기화 후 수행할 callback function
 */
NodeManager.prototype._createZnodeWithData = function (nodePath, data, callback) {

  this.zkClient.create(
    constants.BASE_ZNODE_PATH + nodePath,
    new Buffer(data),
    zookeeper.CreateMode.PERSISTENT,
    function (error) {
      if (error) {
        console.log('Failed to create node: %s due to: %s.', constants.BASE_ZNODE_PATH+nodePath, error);
        if(callback) callback(error);
      } else {
        if(callback) callback(null, constants.BASE_ZNODE_PATH + nodePath );
      }
    }
  );
};

/**
 * Zookeeper에서 node를 삭제함
 * @private
 * @name _removeZnode
 * @function
 * @param {string} nodePath - node path
 * @param {callback} callback - 초기화 후 수행할 callback function
 */
NodeManager.prototype._removeZnode = function (nodePath, callback) {
  this.zkClient.remove(
    constants.BASE_ZNODE_PATH + nodePath,
    -1,
    function (err) {
      if (err) {
        console.log('Failed to remove node: %s due to: %s.', constants.BASE_ZNODE_PATH+nodePath, err);
        if(callback) callback(err);
      } else {
        if(callback) callback(null);
      }
    }
  );
};

/**
 * Zookeeper에서 node를 삭제함
 * @name addAppNode
 * @function
 * @param {string} appId - application id
 * @param {string} appNm - application name
 * @param {object} data - json
 * @param {callback} callback - 초기화 후 수행할 callback function
 */
NodeManager.prototype.addAppNode = function (appId, appNm, data, callback) {

  if(!appId){
    appId = shortId.generate();
  }
  var appInfo = appId+'^'+appNm;
  var nodePath = constants.META_PATH+constants.APP_PATH+'/'+appInfo;
  data.id = appId;

  var self = this;

  self.zkClient.exists(
    constants.BASE_ZNODE_PATH+nodePath,
    function (error, stat) {
      if (error) {
        console.log(error.stack);
        return;
      }

      if (!stat) {
        self._createZnodeWithData(nodePath, JSON.stringify(data), callback);
      }else{
        if(callback) callback(null)
      }
    }
  );
};

/**
 * Zookeeper에서 서버 node를 등록함
 * @name addServerNode
 * @function
 * @param {string} address - 서버의 address
 * @param {number} port - 서버의 port
 * @param {callback} callback - 초기화 후 수행할 callback function
 */
NodeManager.prototype.addServerNode = function (address, port, weight, callback) {

  var self = this;

  this.zkClient.getChildren(
    constants.BASE_ZNODE_PATH + constants.SERVERS_PATH,
    function (error, nodes, stats) {
      if (error) {
        console.log(error.stack);
        callback(error);
        return;
      }

      var server = address + ':' + port;
      var isExisted = false;
      var names = [];

      var existedPathName;

      for (var i = 0; i < nodes.length; i++ ){

        var ninfo = nodes[i].split('^'); // 0: name, 1:ip&Port, 2: replicas

        if(server == ninfo[1]){ // address (1)
          existedPathName = nodes[i];
          isExisted = true;
          break;
        }

        names.push( Number(ninfo[0]) ); // server name (0)

      }

      if(!isExisted){

        var n = 10;
        if(names.length > 0){
          n = Math.max.apply(null, names) + Math.floor(Math.random() * (20 - 10 + 1)) + 10;
        }

        var replicas = 160; // default replicas
        if(weight){
          replicas = parseInt(replicas * Number(weight));
        }

        var nodePath = constants.SERVERS_PATH + '/' + n + '^' + server + '^' + replicas;

        self._createEphemeralZnode(nodePath, callback);

      }else{
        if(callback) callback(null, constants.SERVERS_PATH + '/' + existedPathName);
      }
    }
  );
};

/**
 * Zookeeper에서 서버 node를 삭제함
 * @name removeServerNode
 * @function
 * @param {string} address - 서버의 address
 * @param {number} port - 서버의 port
 * @param {callback} callback - 초기화 후 수행할 callback function
 */
NodeManager.prototype.removeServerNode = function (address, port, callback) {
  var self = this;

  this.zkClient.getChildren(
    constants.BASE_ZNODE_PATH + constants.SERVERS_PATH,
    function (error, nodes, stats) {
      if (error) {
        console.log(error.stack);
        return;
      }

      nodes.forEach(function(node){
        var n = node.split('^')[0];
        var s = node.split('^')[1];
        if( s === address+":"+port){
          self._removeZnode(constants.SERVERS_PATH+"/"+node, function (err) {
            if(err){
							if(callback) callback(err);
            }else{
            	callback(null);
						}
          });
        }
      });
    }
  );
};

/**
 * Zookeeper에 등록된 서버 노드를 watching하여 변경이 있을 경우, 새로운 Consisstent Hash를 생성한다. /xpush/servers
 * @private
 * @name _watchServerNodes
 * @function
 */
NodeManager.prototype._watchServerNodes = function () {

  var self = this;
  this.zkClient.getChildren(
    constants.BASE_ZNODE_PATH+constants.SERVERS_PATH,
    function (event) {
      console.log('  Got watcher event: %s', event);
      self._watchServerNodes();
    },
    function (error, children, stat) {
      if (error) {
        console.log('Failed to list children due to: %s.', error);
      }
      console.log('  server nodes : ' + children);
      self.nodeRing = new ConsistentHashing(children);
    }
  );
};

/**
 * Zookeeper에 등록된 Application 노드를 watching하여 변경이 있을 경우 appInfos를 수정한다.
 * @private
 * @name _watchAppNodes
 * @function
 */
NodeManager.prototype._watchAppNodes = function () {

  var self = this;
  this.zkClient.getChildren(
    constants.BASE_ZNODE_PATH+constants.META_PATH+constants.APP_PATH,
    function (event) {
      console.log('  Got app watcher event: %s', event);
      self._watchAppNodes();
    },
    function (error, children, stat) {
      if (error) {
        console.log('Failed to app list children due to: %s.', error);
      }else{

        for (var i = 0; i < children.length; i++) {
          self.zkClient.getData(
            constants.BASE_ZNODE_PATH+constants.META_PATH+constants.APP_PATH+'/'+children[i],
            function (error, data, stat) {

              if(error){
                console.log('Fail retrieve app datas: %s.', error);
              }

              var tmp = data.toString('utf8');
              var appDatas = JSON.parse(tmp);

              self.appInfos[appDatas.id] = appDatas;
            }
          );
        }
      }
    }
  );
};

NodeManager.prototype.getServerNode = function (key) {
  var serverNode = this.nodeRing.getNode(key);
  return serverNode;
};

NodeManager.prototype.getServerNodeByName = function (name) {
  var serverNode = this.nodeRing.getNodeByName(name);
  return serverNode;
};

NodeManager.prototype.createPath = function (path, callback) {
  this._createZnode(path, callback);
};

NodeManager.prototype.createEphemeralPath = function (path, callback) {
  this._createEphemeralZnode(path, callback);
};


NodeManager.prototype.removePath = function (path, callback) {
  this._removeZnode(path, callback);
};

NodeManager.prototype.getAppInfo = function (id) {
  return this.appInfos[id];
};

NodeManager.prototype.getAppInfos = function () {
  return this.appInfos;
};
