/*
* 微服务WebSocket节点，可用于前端
*
* 运行环境：Nodejs Browser
*
* */

// 使用webJsMaker生成前端js脚本时，需注释掉下面一条语句
const WebSocket=require('ws');

const etools=require('./etools');
const funcDict=require('./funcDict');

/* ====== 通用连接 ====== */
/**
 * 配置项说明：
 * url: websocket连接网址
 * id：自身标识
 * authStr：自身标识验证字符串
 * cacheSec：消息缓存时间，单位秒
 */
class c_conn{
  constructor(conf){
    // 配置信息原样记录
    this.conf=conf;
    // 创建send缓存
    this._sendCache=[];
    // 重连计次，0表示初次连接
    this._reConnCount=0;
    // ws连接实例
    this._ws=null;
    // 空闲时间
    this.empSec=0;
    // 是否已经关闭
    this._isClosed=false;
    // 调用秒循环
    this._secLoop();
    this._secLoopClock=setInterval(()=>this._secLoop(),1000);

    // 订阅字典
    this._subDict={
      // key为topic，其值字典：
      /**
       * state:
       *  0 初始未发送，或被重置需重新订阅
       *  1 尝试发送待确认
       *  2 发送成功
       *  3 发送失败
       *  4 订阅成功
       *  10 订阅被拒绝
       */
    };
  }

  // 秒循环，初次也执行
  _secLoop(){
    // 如果已经关闭，销毁
    if(this._isClosed){
      // 如果有连接实例，关闭
      if(typeof this._ws==='object') this._ws.close();
      // 终止秒循环
      clearInterval(this._secLoopClock);
      // 不再继续
      return;
    }
    // 连接是否可用
    const usable=this.usable;
    /* ===== 连接维护 ===== */
    // 如果可用，重连计次回0
    if(usable) this._reConnCount=0;
    // 不可用，但有ws实例，表明连接在尝试过程中，不用处理
    else if(this._ws) {}
    // 不可用，没有ws实例，创建实例
    else {
      // 此处先占位，并不可用
      this._ws=true;
      // 根据重连计次，决定异步连接等待时间
      setTimeout(()=>this._buildWs(),1000*Math.min(5,this._reConnCount));
      // 重连计次累加
      this._reConnCount++;
    }

    /* ===== 缓存消息发送 ===== */
    const deleteNo=[];// 要删除的序号，降序排列
    for(let i=0;i<this._sendCache.length;i++){
      const cache=this._sendCache[i];
      // ws实例可用，发送并回调成功
      if(usable){
        // 发送流并回调成功
        this._ws.send(cache.buf);
        cache.callback();
        // 标记删除
        deleteNo.unshift(i);
      }
      // ws实例不可用，不超时，计时器累加
      else if(cache.sec<this.conf.cacheSec) cache.sec++;
      // ws实例不可用，超时，回调失败，准备删除
      else {
        // 回调失败
        cache.callback({code:2,message:'ws conn un Usable, send Timeout'});
        // 标记删除
        deleteNo.unshift(i);
      }
    }
    // 移除需删除的项目，此处deleteNo需已经降序排列
    deleteNo.forEach(i=>this._sendCache.splice(i,1));

    /* ===== 心跳机制 ===== */
    // 此处以有_ws对象为标准判定是否可用
    if(this._ws&&this._ws!==true){
      this.empSec++;
      // 超过50秒，断开
      if(this.empSec>55) {
        this._ws.close();
        this._ws=null;
      }
      // 超过40秒，开始发心跳
      else if(this.empSec>45) this._pubSend('__ping','',true,()=>{});
    }
  }

  // 建立连接实例
  _buildWs(){
    // 完整地址
    const fullUrl=this.conf.url+
      '?id='+this.conf.id+
      '&authStr='+this.conf.authStr;

    // 创建连接实例
    this._ws=new WebSocket(fullUrl,'*');

    // 无论前后端，均指定统一消息格式
    this._ws.binaryType='arraybuffer';

    const ws=this._ws;
    this.empSec=0;
    ws.onopen=(...all)=>{
      if(ws!==this._ws) return;
      etools.log(`[${this.conf.id}] Connected by clientWs.`);
      // 重新订阅
      for(const topic in this._subDict){
        if(!this._subDict.hasOwnProperty(topic)) continue;
        this._subDict[topic].state=0;
        this.sub(topic);
      }
    };
    ws.onerror=(err)=>{
      if(ws!==this._ws) return;
      // 如果得到400错误代码，表明连接参数有错误，记录并抛出
      if(err.message && err.message.includes('(400)')){
        this._isClosed=true;
        throw new Error('Ws Error Close');
      }
      etools.log(`[${this.conf.id}] Error`);
      this._ws=null;
    };
    ws.onclose=()=>{
      if(ws!==this._ws) return;
      etools.log(`[${this.conf.id}] Close`);
      this._ws=null;
    };
    ws.onmessage=(evt)=>{
      if(ws!==this._ws) return;
      // 空闲时间归零
      this.empSec=0;

      // 处理消息
      const uint8array=new Uint8Array(evt.data);
      const [topic,msg]=funcDict.buf2topicMsg(uint8array);

      /* 对topic进行switch处理 */
      // 内部消息，未匹配到则忽略
      if(topic.substr(0,2)==='__') this._onCmdTopic(topic,msg);
      // pub消息
      else this.onMessage(topic,msg);
    }
  }

  // 收到内部命令式消息，对应处理在hubCore，不在各类别hub类
  _onCmdTopic(cmdTopic,msg){
    switch (cmdTopic){
      // 心跳
      case '__ping':
        this._ws.send('__pong\0');
        etools.log(`[${this.conf.id}] rec Server Ping`);
        break;
      case '__pong':
        etools.log(`[${this.conf.id}] rec Self Ping Back`);
        break;
      // 订阅成功
      case '__subSucc':{
        // 取出主题对应订阅状态对象，取不到则结束
        const topic=String.fromCharCode(...msg);
        const subObj=this._subDict[topic];
        if(!topic) break;

        // 将订阅状态标记为成功
        subObj.state=4;

        etools.log(`[${this.conf.id}] subSucc  : `+topic);
        break;
      }
      // 订阅被拒绝
      case '__subReject':{
        // 取出主题对应订阅状态对象，取不到则结束
        const topic=String.fromCharCode(...msg);
        const subObj=this._subDict[topic];
        if(!topic) break;

        // 将订阅状态标记为被拒绝
        subObj.state=10;

        etools.log(`[${this.conf.id}] subReject: `+topic);
        break;
      }
      // 推送消息失败
      case '__pubReject':{
        const topic=String.fromCharCode(...msg);
        etools.log(`[${this.conf.id}] pubReject: `+topic);
        break;
      }
    }
  }

  /**
   * 发送数据流方法
   * @param topic 主题，含内部命令式主题
   * @param msg 消息流，支持字符串和二进制流
   * @param noCache 禁用缓存
   * @param callback 回调函数，仅有错误
   * @private
   */
  _pubSend(topic,msg,noCache,callback){
    // 合并为ws层的消息
    const buf=funcDict.msgCombine(topic,0,msg);

    // 可用，直接发送
    if(this.usable) {
      this._ws.send(buf);
      callback()
    }
    // 不可用，不允许缓存，直接回调错误
    else if(noCache) {
      callback({code:2,message:'ws conn un Usable, set NoCache'})
    }
    // 不可用，允许缓存，记录到发送缓存
    else {
      this._sendCache.push({
        sec:0,
        buf,
        callback
      })
    }
  }

  /* 属性 */
  get usable(){
    return this._ws && this._ws.readyState===1
  }

  /* 方法 */
  // 主题订阅，可外部调用该方法，秒循环中也在不断调用
  sub(topic){
    // 取出该主题的订阅对象，为空则新建
    let subObj=this._subDict[topic];
    if(!subObj) subObj=this._subDict[topic]={
      state:0,
    };
    // 仅0和3状态时，发送订阅消息
    if(this.usable&&(subObj.state===0||subObj.state===3)){
      // 标记状态为1
      subObj.state=1;
      // 发送
      this._pubSend('__sub',topic,null,err=>{
        // 有错误，标记发送失败
        if(err) subObj.state=3;
        // 无错误，标记发送成功
        else subObj.state=2;
      })
    }
  }

  // 取消订阅
  subCancel(topic){
    // 删除订阅对象
    delete this._subDict[topic];
    // 发送取消订阅指令
    this._pubSend('__subCancel',topic,null,()=>{})
  }

  // 主题推送
  pub(topic,buf){
    this._pubSend(topic,buf,null,err=>{
      etools.log(`[${this.conf.id}] topic ${topic} push ` + (err?'Fail':'Succ'))
    })
  }
}

/* ====== 客户端类，构建方法可进行必要配置项整理 ====== */
const c_clientCore  = require('./c_clientCore');
class c_client extends c_clientCore{
  // ws客户端仅有连接配置信息，身份信息通过http连接过程完成
  constructor(clientConf,connConf){
    /* 整理客户端配置 */
    // 无客户端配置，则给空对象
    if(!clientConf) clientConf={};
    // 连接配置为字符串，则包装成对象写入url项
    if(typeof connConf==='string') connConf={url:connConf};
    // id有则使用，没有则随机生成。忽略重复导致的bug
    connConf.id=clientConf.id=clientConf.id||etools.ranStr(16,'base62');
    // authStr一定是随机生成的
    connConf.authStr=etools.ranStr(10,'base62');
    // connConf中消息缓存时间，默认5秒
    connConf.cacheSec=connConf.cacheSec||5;

    /* 建立连接，并生成 */
    const conn=new c_conn(connConf);
    super(clientConf,conn);
  }
}

/* ====== 输出 ======*/
const expOut={
  c_client,
  protoWork:require('./protoWork'),
  idType:funcDict.idType
};
module.exports=expOut;

// 前端写到window中
if(!etools.isNode) window.c_clientWs=expOut;