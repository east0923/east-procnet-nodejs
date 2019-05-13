// 引入配置文件，需自行修改conf.js.example文件配置并命名为conf.js，也可直接将配置结构在此负值给conf
const conf=require('./conf');
// 引入工具类，仅输入日志加时间使用
const etools=require('../etools');

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
const httpAuth=new procnet.http.c_httpAuth(conf.redis_http);
// 写入配置，管理站点必须调用，该配置会记录入redis
httpAuth.setConf({
    SessionTimeoutSec:1200,
    TokenTimeoutSec:31*24*3600,
    isAllowUnknowDomain:true,
    authIp:['screen']
});
httpAuth.iotRequestCheck=(request)=>{
    return true
};

// 建立WebSocket接入代理hub站点，并注册到http服务器
const site_hubWs=new procnet.hubWs({
    halfId:'demoHub',
    redisConf:conf.redis_proc,
    httpAuth,
    ajaxApi:{
        access:'*',
        apiFunc:async (reqMsg,params)=>{
            return procB.apiCallAsync(reqMsg,params);
        }
    }
});
http.siteReg(site_hubWs,'/api/');


// 建立静态资源http站点，并注册到http服务器(正式环境应简易使用Nginx或CDN部署静态资源)
const site_static=new procnet.http.c_siteStatic({
    alias:'demo/',
    httpAuth
});
http.siteReg(site_static,'/test/');

// 建立微服务实例 A
const procA=new procnet.clientRedis.c_client({
  id:'procA',
  redisConf:conf.redis_proc
});

procA.apiReg('test',async (info,params)=>{
    return [null,{
        info,
        params
    }];
});

/* 后端服务间调用测试 */
if(true){

// 建立另一个微服务实例 B
    const procB=new procnet.clientRedis.c_client({
        id:'procB',
        redisConf:conf.redis_proc
    });
// 调用微服务A的test API
    procB.apiCall('procA.test',[],(err,...all)=>{
        etools.log(`===== 后端服务间调用 =====`);
        console.log('[ Error ]');
        console.log(err);
        console.log('[ Params ]');
        console.log(all);
        console.log();
    });
    function bookFunc(info,params){
        console.log('helloEvent A');
    }

    procB.eventBook('helloEvent',bookFunc);
    procB.eventBook('helloEvent',(info,params)=>{
        console.log('helloEvent B');
    });
}

/* 后端webSocket接入调用测试 */
setTimeout(()=>{
    // 建立WebSocket服务实例，id随机生成
    const procC=new procnet.clientWs.c_client(null,'ws://localhost:9988/api/')
    // 调用微服务A的test API
    procC.apiCall('procA.test',[],(err,...all)=>{
        etools.log(`===== 后端webSocket接入调用 =====`);
        console.log('[ Error ]');
        console.log(err);
        console.log('[ Params ]');
        console.log(all);
        console.log();
    });
},500);

/* 线上API测试 */
if(true){
    setTimeout(()=>{
        // 建立WebSocket服务实例，id随机生成
        const procC=new procnet.clientWs.c_client(null,'wss://c03.box-alihb2.ewatersys.com/apiHubWs');
        // 调用微服务A的test API
        procC.apiCall('dataApi.taglist',[{cids:'cq-gcgyyq'}],(err,...all)=>{
            etools.log(`===== 线上ws-API调用测试 =====`);
            console.log('[ Error ]');
            console.log(err);
            console.log();
        });
    },2000);
}
