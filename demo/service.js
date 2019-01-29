// 引入配置文件，需自行修改conf.js.example文件配置并命名为conf.js，也可直接将配置结构在此负值给conf
const conf=require('./conf');

// 引入本包
const procnet=
    // require('east-procnet'); // 正式项目
    require('../index'); // 演示环境

// 建立http服务器
const http=new procnet.http.c_server({
    port:9988,
    showErrorToLog:true
});

// 建立身份认证类
const httpAuth=new procnet.http.c_httpAuth({
    redisConf:conf.redis_http,
    SessionIdKey:'testKey',
    SessionTimeoutSec:1200,
    TokenKey:'testkey',
    isAllowUnknowDomain:true
});

// 建立WebSocket接入代理hub站点，并注册到http服务器
const site_hubWs=new procnet.hubWs({
    halfId:'demoHub',
    redisConf:conf.redis_proc,
    httpAuth
});
http.siteReg(site_hubWs,'/ws');

// 建立静态资源http站点，并注册到http服务器(正式环境应简易使用Nginx或CDN部署静态资源)
const site_static=new procnet.http.c_siteStatic({
    root:'demo',
    httpAuth
});
http.siteReg(site_static,'/');