var _              = require('underscore');
var commonStorage  = require('../../server/common-storage');
var shortId        = require('shortid');
var serverUtils    = require('../../server/utils');

/**
 * Facebook 인증 처리를 위한 Module
 * @module
 * @name oauth-facebook
 */
exports.install = function (server, passport, conf){

  if(_.isEmpty(conf.key) || _.isEmpty(conf.secret)){

    var errMessage = '';
    if(_.isEmpty(conf.key)) errMessage = errMessage + '["key": Facebook App ID] ';
    if(_.isEmpty(conf.secret)) errMessage = errMessage + '["secret": Facebook App Secret] ';
    errMessage = errMessage + 'is not filled on the config file for XPUSH Session Server.\n refer to your facebook developer site(https://developers.facebook.com).';
    console.error(errMessage);

  }else{

    var authUrl = conf.authUrl;
    if(_.isEmpty(conf.authUrl)) authUrl = '/auth/facebook';

    var callbackUrl = conf.callbackUrl;
    if(_.isEmpty(conf.callbackUrl)) callbackUrl = '/auth/facebook/callback';

    FacebookStrategy = require('passport-facebook').Strategy;
    passport.use(new FacebookStrategy({
        clientID:     conf.key,
        clientSecret: conf.secret,
        callbackURL:  conf.serverUrl + callbackUrl
      },
      function(accessToken, refreshToken, profile, done) {
        /*console.log('##############');
        console.log('accessToken  : ', accessToken);
        console.log('refreshToken : ', refreshToken);
        console.log('profile      : ', profile);confconf
        console.log('##############'); */
        done(null, profile);
        /*User.findOrCreate(..., function(err, user) {
          if (err) { return done(err); }
          done(null, user);
        });*/
      }
    ));

    /**
     * /auth/facebook/check REST API를 추가한다.
     * commonStorage에 session id를 저장한다.
     */
    server.get(authUrl+'/check',
      function (req, res) {

        var sid = shortId.generate();
        if(Object.keys(req.params).length > 0){
          commonStorage.set(sid, req.params, 20000);
        }

        // @todo check cookir expiration data !!!!!
        // 쿠키에 session id를 등록한다.
        res.writeHead(302, {
          'Set-Cookie': 'xpush-sid='+sid+'; expires='+new Date(new Date().getTime()+86409000).toUTCString(),
          'Location': authUrl
        });

        res.end();
      }
    );

    /**
     * 쿠키에 저장된 세션 객체를 보기 위한 REST API
     * @todo 운영단계에서는 삭제해아함.
     */
    server.get(authUrl+'/debug',
      function (req, res) {

        var cookieList = serverUtils.parseCookies(req);
        res.send(cookieList); //req.headers['Session-Id']);
      }
    );

    /**
     * /auth/facebook REST API를 추가한다.
     * passport 모듈을 사용하여 facebook 인증을 위한 URL을 호출한다.
     */
    server.get(authUrl,
      function (req, res, next) {
        passport.authenticate('facebook', { session: false })(req, res);
      }
    );

    /**
     * /auth/facebook/callback REST API를 추가한다.
     * passport 모듈을 사용하여 facebook 인증 완료 후 호출될 REST API
     */
    server.get(callbackUrl,
      passport.authenticate('facebook', { session: false }),
      function(req, res) {

        // `oauth` Event를 발생시켜서, 클라이언트는 해당 event를 받아 로그인 처리를 한다.
        var _r = server._fireEvent(
          'oauth', {provider: 'facebook', request: req, response: res}
        );

        if( !_r ){

          if(conf.event){

            var _sid = serverUtils.parseCookies(req)['xpush-sid'];

            if(_sid){
              var _params = commonStorage.get(_sid);

              if(_params){
                var data = {
                  A: _params.app,
                  C: _params.channel,
                  SS: _params.socketId,
                  NM: conf.event.name,
                  DT: req.user
                };

                server.emit('XPUSH-send', data);
              }
            }
          }

          if(conf.success){
            res.end(conf.success);
          }else{
            res.end(req.user);
          }
        }
      }
    );

    console.log('Facebook oauth >');
    console.log('        - url :  '+ conf.serverUrl + authUrl );
    console.log('   - callback :  '+ conf.serverUrl + callbackUrl );

  }
};
