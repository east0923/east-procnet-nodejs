/* ====== 实现通用连接 ====== */
const redis    = require('redis');
const bluebird = require('bluebird');
bluebird.promisifyAll(redis.RedisClient.prototype);
bluebird.promisifyAll(redis.Multi.prototype);

// redis重试连接方法函数，详见redis库文档
function retry_strategy (options) {
  if (options.error && options.error.code === 'ECONNREFUSED') {
    // End reconnecting on a specific error and flush all commands with
    // a individual error
    return new Error('The server refused the connection');
  }
  if (options.total_retry_time > 1000 * 60 * 60) {
    // End reconnecting after a specific timeout and flush all commands
    // with a individual error
    return new Error('Retry time exhausted');
  }
  if (options.attempt > 10) {
    // End reconnecting with built in error
    return undefined;
  }
  // reconnect after
  return Math.min(options.attempt * 100, 3000);
}


/**
 * 创建redis连接实例（内部）
 * @param conf 配置参数 host、port、prefix，均可配置默认值
 * @param def_host host默认值，无配置参数时使用
 * @param def_port port默认值，无配置参数时使用
 * @param def_prefix prefix默认值，无配置参数时使用
 * @returns {RedisClient}
 */
function f_buildConn(conf={},def_host,def_port,def_prefix){
  // 生成redisConf，添加二进制反馈要求
  const redisConf={
    host:conf.host||def_host,
    port:conf.port||def_port,
    retry_strategy,     // 断线重连方法
    return_buffers:true // 设定使用二进制方式编码
  };

  // 建立连接实例
  const redisConn=redis.createClient(redisConf);
  // 写入前缀
  redisConn.prefix=conf.prefix||def_prefix;
  // 反馈
  return redisConn;
}

// 订阅发布封装
class c_subpub {
  /* conf 配置项，可完全默认
   *
   * host: 服务ip或域名，默认'localhost'
   * port: 服务端口，默认6379
   * prefix: 所有键前缀，默认'proc#'
   */
  constructor(conf={}){
    // 建立订阅、发布两条通道
    this.subConn=f_buildConn(conf,'localhost',6379,'proc#');
    this.pubConn=f_buildConn(conf,'localhost',6379,'proc#');
    this.prefix=this.subConn.prefix;// 取以上任意一个均可

    // 接收消息，调用onMessage方法
    this.subConn.on('message',(channel,msg)=> {
      // 转字符串，并去除前缀
      channel=channel.toString().substr(this.prefix.length);
      // 调用onMessage方法
      this.onMessage(channel,msg);
    });
  }

  /* 属性 */
  // 连接是否可用
  get usable(){
    return !(this.subConn.closing||this.pubConn.closing)
  }

  /* 方法 */
  // 订阅
  sub(topic){
    this.subConn.subscribe(this.prefix+topic);
  }
  // 订阅取消
  subCancel(topic){
    this.subConn.unsubscribe(this.prefix+topic)
  }

  // 推送
  pub(topic,buf){
    this.pubConn.publish(this.prefix+topic,buf);
  }

  // 添加到队列
  queuePush(queueName,...bufs){
    this.pubConn.lpush(this.prefix+'queue.'+queueName,...bufs)
  }
}

module.exports={
  c_subpub,
  f_buildConn
};