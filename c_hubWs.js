const c_hubCore=require('./c_hubCore');
let WebSocket; // 创建c_hubWs时才引用npm项目ws
const etools=require('./etools');
const url=require('url');
const funcDict=require('./funcDict');

// 前端以WebSocket协议接入微服务代理类
class c_hubWs extends c_hubCore{
  /**
   * conf 配置字典说明
   * id: 标识，但不完整，最终的hubId = [hubTyp]:[id]
   * redisConf: redis连接配置字典，说明见c_connRedis.js
   * httpAuth: 身份管理对象实例
   */
  constructor(conf){
    // 在此处引用，以避免不需要创建该类，未安装该包时报错
    WebSocket=require('ws');
    // 写入类别
    conf.typ='ws';
    // 构建基类
    super(conf);
    // 记录http身份管理对象
    this._httpAuth=conf.httpAuth;
    // 连接字典
    this._wsDict={};
    // 秒循环
    this._secLoopClock=setInterval(()=>this._secLoop(),1000);
    // WebSocket处理服务
    this.server=new WebSocket.Server({noServer:true});
    // 反馈头信息的方式，很BT
    this.server.on('headers',(headers,request)=>{
      if(request.setNewSessionId) headers.push(request.setNewSessionId);
    });
  }

  // 内部秒循环函数
  _secLoop(){
    /* 心跳维护 */
    for(const id in this._wsDict){
      if(!this._wsDict.hasOwnProperty(id)) continue;
      const wsObj=this._wsDict[id];
      if(!wsObj.ws) continue;

      wsObj.empSec++;
      if(wsObj.empSec>55) {
        wsObj.ws.close();
        this._wsDown(id);
      }
      else if(wsObj.empSec>45) this.pubClient(id,'__ping','');
    }
  }

  // 上线
  _wsOn(id,ws,request){
    // 没有wsObj或wsObj中已有ws连接，则关闭并结束
    const wsObj=this._wsDict[id];
    if(!wsObj||wsObj.ws){
      ws.close();
      return;
    }

    // 整理接入信息
    const connInfo={
      host:request.headers.host,

    };

    // 登入
    wsObj.ws=ws;
    this._clientOn(id);

    // 关联事件
    ws.onclose  =(()=>this._wsDown(id,ws));
    ws.onerror  =(()=>this._wsDown(id,ws));
    ws.onmessage=(evt=>this._wsOnMsg(id,ws,evt.data));
  }

  // 下线：错误，关闭，心跳失败
  _wsDown(id,ws){
    // 验证当前id对象中的ws与传来的匹配，不匹配则不继续
    const wsObj=this._wsDict[id];
    if(!wsObj) return;
    // 防止旧实例事件关闭当前
    if(ws&&ws!==wsObj.ws) return;

    // 登出
    if(wsObj.ws&&wsObj.ws!==true) wsObj.ws.close();
    wsObj.ws=null;
    delete this._wsDict[id];
    this._clientOff(id);
  }

  // 收到消息
  _wsOnMsg(id,ws,buf){
    // 验证当前id对象中的ws与传来的匹配，不匹配则关闭
    const wsObj=this._wsDict[id];
    if(!wsObj||wsObj.ws!==ws) {
      ws.close();
      return
    }

    // 空闲时间归零
    wsObj.empSec=0;

    // 处理消息
    const index0=buf.indexOf(0);
    const topic=buf.slice(0,index0).toString();
    const msg  =buf.slice(index0+1);

    /* 对topic进行switch处理 */
    // 内部消息，未匹配到则忽略
    if(topic.substr(0,2)==='__') this._clientCmdTopic(id,topic,msg);
    // pub消息
    else this._clientPub(id,topic,msg);
  }

  /* 以下方法为配合east-httpio调用 */
  // 接收http升级为websocket请求
  async upgrade(request,socket,head){
    // 先进行http认证
    await this._httpAuth.requireAuth(request);

    // 分离query参数
    const urlObj=url.parse(request.url);
    const querys={};
    urlObj.query.split('&').forEach(line=>{
      const [key,value]=line.split('=');
      querys[key]=value;
    });

    /* 验证参数合法性 */
    let httpErrCode=0; // 错误代码，默认0即然没有

    // 取出id，authStr
    const id=querys.id;
    const authStr=querys.authStr;
    let wsObj;

    // 请求格式错误类，反馈代码400，告知客户端不必再尝试
    if (authStr.length<4|| authStr.length>24 || // authStr长度不合规
      funcDict.idType(id)!=='hubCli'            // id不符合规范
    ) httpErrCode=400;
    // 尝试注册，失败则反馈代码406，但可以再尝试
    else {
      // 取出对象，没有则新建
      wsObj=this._wsDict[id]=this._wsDict[id]||{
        authStr:null,// 身份验证字符串
        ws:null,// 连接实例
        SessionId:'',// 会话id
        cookieStr:'',// 新设置Session的头信息，不需要新设置时为空
        empSec:0
      };
      // 当前该id有连接，反馈错误
      if(wsObj.ws)
        httpErrCode=406;
      // 当前有authStr，且与传来的不同
      else if(wsObj.authStr&&wsObj.authStr!==authStr)
        httpErrCode=406;
    }

    // 有错误时直接response错误信息，并结束
    if(httpErrCode){
      socket.write('HTTP/1.1 '+httpErrCode +'\r\n\r\n');
      socket.destroy();
      return
    }

    // 注册成功，获取session信息
    this.sessionStore.RequestCheck(request,(err,info,SessionId,cookieStr)=>{
      // session信息获取失败，断开连接
      if(err) {
        socket.write('HTTP/1.1 '+407 +'\r\n\r\n');
        socket.destroy();
        return
      }
      // 写入会话id
      wsObj.SessionId=SessionId;
      // 如果有cookieStr，写到request项中
      if(cookieStr) request.setNewSessionId='Set-Cookie: '+cookieStr;

      // 显示日志
      etools.log(`[${this.hubId}] (${id}) Build SessionId: `+SessionId.toString('hex'));

      // 升级连接对象
      this.server.handleUpgrade(request,socket,head,ws=>this._wsOn(id,ws,request))
    });
  }

  /* 以下方法为配合hubCore调用 */
  // 向指定客户端推送消息
  pubClient(id,topic,buf){
    // 如果没有id对应的ws，或状态不可用，则结束
    const wsObj=this._wsDict[id];
    if(!wsObj||!wsObj.ws||wsObj.ws.readyState!==1) return;


    // 如果buf是字符串，转流
    if(typeof buf==='string') buf=Buffer.from(buf,'utf8');

    // 将topic和buf组合成完整的消息流
    const full=Buffer.concat([Buffer.from(topic+'\0'),buf]);
    wsObj.ws.send(full);
  }

  // 获取id关联的信息，对于hubWs，仅能获取到SessionId
  async getIdInfo(id){

    // 先获取id对应的SessionId
    const wsObj=this._wsDict[id];
    if(!wsObj||!wsObj.SessionId) return {};

    // 获取Session对应的信息
    return new Promise((resolve)=>{
      this.sessionStore.SessionLoad(wsObj.SessionId,(err,info)=>{
        if(err||!info) resolve({});
        else {
          info.SessionId=wsObj.SessionId;
          resolve(info);
        }
      })
    });
  }
}

module.exports=c_hubWs;