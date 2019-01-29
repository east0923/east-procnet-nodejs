
const etools=require('../etools');
const procnet=require('../index');


// 客户端
const c_clientWs=procnet.clientWs;
const clientWs=new c_clientWs.c_client(null,'ws://localhost:9999/ws');
clientWs.apiCall('serv-a.hello',[{hello:'east'}],(err,json)=>{
  if(err) etools.log('后端Node环境 WebClient -> Service API 失败，错误参数：'+JSON.stringify(err));
  else    etools.log('后端Node环境 WebClient -> Service API 成功，传输参数：'+JSON.stringify(json));
});