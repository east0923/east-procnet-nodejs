const etools=require('east-tools');
const httpio=require('east-httpio');
const procnet=require('../index');

const redisConf={
  host:'172.22.22.6',
  port:950,
  prefix:'test'
};

/* redis测试 */
const serv_a=new procnet.clientRedis.c_client({id: 'serv-a'},redisConf);
const serv_b=new procnet.clientRedis.c_client({id: 'serv-b'},redisConf);

serv_a.apiReg('hello',async (info,params)=>{
  const a=[info,params];
  return 'ok';
});
serv_a.eventBook('testEvent',(info,json)=>{
  etools.log('Redis Event 成功，传输参数：'+JSON.stringify(json));
});
setInterval(()=>{
  serv_a.eventEmit('evtTest',JSON.stringify({ranStr:etools.ranStr(10)}))
},2000);

setTimeout(()=>{
  serv_b.apiCall('serv-a.hello',[{hello:'east'}],(err,json)=>{
    if(err) etools.log('Redis API 失败，错误参数：'+JSON.stringify(err));
    else    etools.log('Redis API 成功，传输参数：'+JSON.stringify(json));
  });
  serv_b.eventEmit('testEvent',{event:'bignews'})
},1000);

// 静态页
const staticSite=new httpio.c_site_static({
  root:__dirname,
  defaultDoc:'index.html',
  mime:{
    "css": "text/css",
    "gif": "image/gif",
    "html": "text/html",
    "ico": "image/x-icon",
    "jpeg": "image/jpeg",
    "jpg": "image/jpeg",
    "js": "text/javascript",
    "json": "application/json",
    "pdf": "application/pdf",
    "png": "image/png",
    "svg": "image/svg+xml",
    "swf": "application/x-shockwave-flash",
    "tiff": "image/tiff",
    "txt": "text/plain",
    "wav": "audio/x-wav",
    "wma": "audio/x-ms-wma",
    "wmv": "video/x-ms-wmv",
    "xml": "text/xml",
    "ttf": "font/otf",
    "woff": "application/x-font-woff",
    "woff2": "application/x-font-woff"
  }
});

const sessionStore=new httpio.c_sessionStore({
  "shareDomain": "ewatersys.com",
  "cookiePrefix": "ewtNewId",
  "expireMinute": 2,
  "redisConn": {
    "host": "172.16.0.82",
    "port": 6379
  }
});
/* WebSocket测试 */
const wsHub=new procnet.hubWs({
  hubId:'wsHub',
  sessionStore
},redisConf);

// 验证函数
wsHub.check_eventBook =async (id,idInfo,topic)=>{
  const b=[id,idInfo,topic];
  return true
};
wsHub.check_eventEmit =async (id,idInfo,topic)=>{
  const b=[id,idInfo,topic];
  return true
};
wsHub.check_apiReq    =async (id,idInfo,targetId)=>{
  const b=[id,idInfo,targetId];
  return true
};
wsHub.check_conn      =(id,info)=>{return true};

// http监听及路径注册
const httpServer=new httpio.c_httpServer({
  port:9999
});
httpServer.siteReg(wsHub,'/ws');
httpServer.siteReg(staticSite,'/');

// node客户端
const c_clientWs=procnet.clientWs;
const clientWs=new c_clientWs.c_client(null,'ws://east.ewatersys.com/ws');
clientWs.apiCall('serv-a.hello',[{hello:'east'}],(err,json)=>{
  if(err) etools.log('后端Node环境 WebClient -> Service API 失败，错误参数：'+JSON.stringify(err));
  else    etools.log('后端Node环境 WebClient -> Service API 成功，传输参数：'+JSON.stringify(json));
});