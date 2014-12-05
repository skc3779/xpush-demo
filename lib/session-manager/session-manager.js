var events    = require('events'),
    util      = require('util'),
    redis     = require('redis'),
    redisScan = require('./redis-scan');

var SessionManager = exports.SessionManager = function(addr, callback) {

  if (addr) {
    this.redisClient = redis.createClient(addr.split(':')[1], addr.split(':')[0]);
  } else {
    this.redisClient = redis.createClient();
    addr = 'localhost:6379';
  }

  events.EventEmitter.call(this);

  this.redisClient.on("error", function(err) {
    console.log("Redis error encountered", err);
  });

  this.redisClient.on("end", function() {
    console.log("Redis connection closed");
    if (callback) callback('ERR-REDIS', 'redis - failed to connect to ['+addr+']');
  });

  this.redisClient.once("connect", function() {
    if (callback) callback(null);
  });
};

util.inherits(SessionManager, events.EventEmitter);


/**
 * Get the server number according to channel name from redis hash table.

 * @name retrieve
 * @function
 * @param {string} app - application key
 * @param {string} channel - channel name
 * @param {callback} callback - callback function
 */
SessionManager.prototype.retrieve = function(app, channel, callback) {

  this.redisClient.hget(app, channel, function(err, result) {

    if (result) {
      callback(JSON.parse(result).s);
    } else {
      callback();
    }
  });

};

/**
 * Retrieve channel list with hscan
 *
 * @name retrieveChannelList
 * @function
 * @param {string} key - application key
 * @param {string} pattern - channel name
 * @param {callback} callback - callback function
 */
SessionManager.prototype.retrieveChannelList = function(key, pattern, callback) {
  var reVa = [];
  redisScan({
    redis: this.redisClient,
    cmd : 'HSCAN',
    key : key,
    pattern : pattern,
    each_callback: function (type, key, subkey, cursor, value, cb) {
      //console.log(key,subkey,value);
      if(subkey){
        reVa.push({key: subkey, value: value });
      }
      cb();
    },
    done_callback: function (err) {
      callback(err,reVa);
    }
  });
};

/**
 * Remove server datas from redis hash table

 * @name remove
 * @function
 * @param {string} app - application key
 * @param {string} channel - channel name
 */
SessionManager.prototype.remove = function(app, channel) {
  this.redisClient.hdel(app, channel);
};

/**
 * Update connection informations into redis server.
 * If the number of connections in this channel is ZERO, delete data from redis hash table.
 *
 * @name update
 * @function
 * @param {string} app - application key
 * @param {string} channel - channel name
 * @param {string} server - server number (auth-generated into zookeeper)
 * @param {number} count - the number of connections
 *
 */
SessionManager.prototype.update = function(app, channel, server, count) {

  if (count > 0) {
    var s = {
      s: server,
      c: count
    };
    this.redisClient.hset(app, channel, JSON.stringify(s));
  } else {
    this.redisClient.hdel(app, channel);
  }

};

/**
 * Publish data to another server.
 * @name publish
 * @function
 * @param {string} server - server number
 * @param {object} dataObj -  Data to send
 */
SessionManager.prototype.publish = function(server, dataObj) {

  console.log('#### REDIS Publish : ' + 'C-' + server);
  console.log('####       app(A)  : ' + dataObj.A);
  console.log('####   channel(C) : ' + dataObj.C);
  console.log('####  socketId(SS) : ' + dataObj.SS);
  console.log('####      name(NM) : ' + dataObj.NM);

  this.redisClient.publish('C-' + server, JSON.stringify(dataObj));

};
