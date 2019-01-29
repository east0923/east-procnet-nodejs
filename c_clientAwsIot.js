/* ====== 实现通用连接 ====== */
let awsIot;
class c_conn {
  constructor(conf){
    // 在此处引用，以避免不需要创建该类，未安装该包时报错
    awsIot=require('aws-iot-device-sdk');
    // 建立设备实例
    this.device=awsIot.device(conf);

    // 接收消息，调用onMessage方法
    this.device.on('message',(topic,msg)=> {
      // 调用onMessage方法
      this.onMessage(topic,msg);
    })
  }

  /* 属性 */
  // 连接是否可用
  get usable(){
    return !(this.subConn.closing||this.pubConn.closing)
  }

  /* 方法 */
  // 主题订阅
  sub(topic){
    this.subConn.subscribe(this.prefix+topic)
  }
  // 主题推送
  pub(topic,buf){
    this.pubConn.publish(this.prefix+topic,buf)
  }
}

/* ====== 客户端类，构建方法可进行必要配置项整理 ====== */
const c_clientCore  = require('./c_clientCore');
class c_client extends c_clientCore{
  constructor(clientConf,connConf){
    // 连接配置中，写入平台id
    connConf.clientId=clientConf.id;
    const conn=new c_conn(connConf);
    super(clientConf,conn);
  }
}

/* ====== 输出 ======*/
module.exports={
  c_client,
  protoWork:require('./protoWork')
};