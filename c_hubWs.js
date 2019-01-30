const c_hubCore=require('./c_hubCore');
let WebSocket; // 创建c_hubWs时才引用npm项目ws
const etools=require('./etools');
const url=require('url');
const funcDict=require('./funcDict');


// 前端以WebSocket协议接入微服务代理类
class c_hubWs extends c_hubCore{
    /**
     * conf 配置字典说明
     * halfId: 标识，但不完整，最终的hubId = [hubTyp]:[halfId]
     * redisConf: redis连接配置字典，说明见c_connRedis.js
     * httpAuth: 身份管理对象实例
     * ajaxApi: Ajax方式调用API配置，无此项则拒绝Ajax方式请求
     * access: 服务端跨域头 - Access-Control-Allow-Origin
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
        // ajaxApi配置，默认null表示不允许ajax方式访问
        this._ajaxApi=conf.ajaxApi||null;

        // 连接字典
        this._wsDict={};
        // 秒循环
        this._secLoopClock=setInterval(()=>this._secLoop(),1000);
        // WebSocket处理服务
        this.server=new WebSocket.Server({noServer:true});
        // 反馈头信息的方式，很BT
        this.server.on('headers',(headers,request)=>{
            headers.push(...request.resHeaders);
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

    // api请求头信息构造
    _apiHeaderMake(request,addition={}){

    }

    // ajax方式POST数据接收
    async _ajaxPostData(request){
        if(request.method!=='POST') throw new Error('request is not POST');
        return new Promise((resolve,reject)=>{
            // 监听data事件接收数据
            const contentLength=Number.parseInt(request.headers['content-length']);

            let length=0;      // 已接收长度
            const rawArry=[];  // 接收Buffer缓存数组
            let tooLong=false;
            request.addListener('data',(data)=>{
                // 如果已经超长，则不再执行任何动作
                if(tooLong) return;

                // 累计长度，并验证是否超长
                length+=data.length;
                if(contentLength && length>contentLength){ // 超过content-length字段长度 (不一定有)
                    tooLong=true;
                    reject('content too long');
                    return
                }
                // 数据写入数组
                rawArry.push(data)
            });
            // 调用api执行
            request.addListener('end',()=>{
                // 如果之前已经因为超长报错，则不需要执行此处
                if(tooLong) return;
                // post过程注定结束了
                // 合并为完整Buffer
                const raw=Buffer.concat(rawArry);
                // 如果有content-length字段长度且raw长度不符合，报错
                if(contentLength && contentLength!==raw.length){
                    reject('post-data length donot match content-length');
                    return;
                }

                // 转换为Json
                let post;
                try{
                    post=JSON.parse(raw.toString('utf8'));
                } catch (e) {
                    reject('post data Only Support Json in UTF-8');
                    return;
                }

                // 反馈
                resolve(post);
            });
        })
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

    // ajaxApi请求
    async request(request,response){
        // 如不允许ajaxApi，直接报错
        if(!this._ajaxApi) throw new Error('hubWs not allow AjaxApi');

        // 跨域配置
        if(this._ajaxApi.access) response.setHeader('Access-Control-Allow-Origin', this._ajaxApi.access);

        // 认证当前请求对象
        await this._httpAuth.requestAuth(request);

        /* 分离api、params请求参数 */

        // apiUrl为去掉了请求匹配前缀后的全部
        let api,params={};
        {
            const apiUrl=request.url.substr(request.url.lastIndexOf('/')+1);
            const index=apiUrl.indexOf('?'); // 问号index

            // 有
            if(index>=0){
                api=apiUrl.substr(0,index);
                apiUrl.substr(index+1).split('&').forEach(kv=>{
                    const [k,v]=kv.split('=');
                    params[k]=(typeof v==='undefined')?null:v;
                })
            }
            // 无
            else api=apiUrl;
        }

        // 构建Heads对象
        const apiHeader=this._apiHeaderMake(request,{

        });

        // 获取post信息
        const post=request.method==='POST'?this._ajaxPostData(request):null;


    }

    // 接收http升级为websocket请求
    async upgrade(request,socket,head){
        // 认证当前请求对象
        await this._httpAuth.requestAuth(request);
        // WebSocket连接必须有SessionId，没有需重新分配
        if(!request.reqAuth.SessionId){
            await this._httpAuth.setRequestNewSessionId(request);
        }

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
        // 尝试注册，失败则反馈代码406或407，但可以再尝试
        else {
            // 取出对象，没有则新建
            wsObj=this._wsDict[id]=this._wsDict[id]||{
                authStr,  // 身份验证字符串，新建时保存，之后不可变更
                request,  // 记录建立时的request对象，断线后清空
                ws:null,  // 连接实例，断线后清空
                empSec:0  // 空闲时间，用于心跳
            };
            // 当前该id有连接，反馈错误
            if(wsObj.ws)
                httpErrCode=406;
            // 当前有authStr，且与传来的不同，禁止连接
            else if(wsObj.authStr!==authStr)
                httpErrCode=407;
        }

        // 有错误时直接response错误信息，并结束
        if(httpErrCode){
            socket.write('HTTP/1.1 '+httpErrCode +'\r\n\r\n');
            socket.destroy();
            return
        }

        // 显示日志
        etools.log(`[${this.labelText}] clientId: ${id} SessionId: ${request.reqAuth.SessionId}`);

        // 升级连接对象
        this.server.handleUpgrade(request,socket,head,ws=>this._wsOn(id,ws,request))
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

    // 获取id关联的信息，获取不到时，返回null
    async getIdReqAuth(id){
        // 先获取id对应的wsObj，获取失败则返回null
        const wsObj=this._wsDict[id];
        if(!wsObj||!wsObj.ws||!wsObj.request) return null;

        // 验证request
        await this._httpAuth.requestAuth(wsObj.request);

        // 如果SessionId无效，返回null
        if(!wsObj.request.reqAuth.SessionId) return null;
        // 有效，反馈
        else return wsObj.request.reqAuth;
    }
}

module.exports=c_hubWs;