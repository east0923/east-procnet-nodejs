const c_hubCore=require('./c_hubCore');
let WebSocket; // 创建c_hubWs时才引用npm项目ws
const etools=require('./etools');
const url=require('url');
const qs =require('qs');
const funcDict=require('./funcDict');

// Ajax请求各类型处理
const contentMethods=[
    // 0 application/json
    {
        // 特征字符串
        reqContentTypeFeature:'application/json',
        // 转换为params的方法
        buf2params:(raw,querys)=>{
            const params=new Array(2);
            params[0]=JSON.parse(raw.toString('utf8'));
            params[1]=querys;
            return params;
        },
        // 输出响应的方法
        resFunc:(res,err,params)=>{
            // 反馈字节流及类别
            let resultBuf,resultType;

            // 有错误时
            if(err){
                const result={
                    code:0,
                    message:'',
                    result:null
                };
                result.code=30;
                switch (typeof err){
                    case 'string':
                        result.message=err;
                        break;
                    case 'number':
                        result.code=err;
                        break;
                    default:
                        result.code=err.code||30;
                        result.message=err.msg||err.message;
                }
                resultType='application/json';
                resultBuf =Buffer.from(JSON.stringify(result));
            }
            // 无错误，特殊参数：http
            else if(
                params.length ===3    &&         // 3个参数
                params[0] ==='buffer' &&         // 第一个是表明是buffer直接反馈
                (typeof params[1]==='string') && // 第二个是Content-Type字符串
                Buffer.isBuffer(params[2])       // 第三个是二进制流，为反馈体本身
            ) {
                resultType=params[1];
                resultBuf =params[2];
            }
            // 无错误，普通参数，仅能反馈第一个
            else {
                const result={
                    code:0,
                    message:'',
                    result:null
                };
                result.result=params[0];
                resultType='application/json';
                resultBuf =Buffer.from(JSON.stringify(result));
            }

            // 转字符串输出
            res.writeHead(200,{
                'Content-Length': resultBuf.length,
                'Content-Type'  : resultType,
                'Cache-Control' : 'no-cache'
            });
            res.write(resultBuf);
            res.end()
        }
    },
    // 1 application/x-www-form-urlencoded
    {
        // 特征字符串
        reqContentTypeFeature:'application/x-www-form-urlencoded',
        // 转换为params的方法
        buf2params:(raw,querys)=>{
            const params=new Array(2);
            params[0]=qs.parse(raw.toString('utf8'));
            params[1]=querys;
            return params;
        },
        // 输出响应的方法，与JSON相同
        resFunc:(res,err,params)=>{
            // 反馈字节流及类别
            let resultBuf,resultType;

            // 默认输出对象


            // 有错误时
            if(err){
                const result={
                    code:0,
                    message:'',
                    result:null
                };
                result.code=30;
                switch (typeof err){
                    case 'string':
                        result.message=err;
                        break;
                    case 'number':
                        result.code=err;
                        break;
                    default:
                        result.code=err.code||30;
                        result.message=err.msg||err.message;
                }
                resultType='application/json';
                resultBuf =Buffer.from(JSON.stringify(result));
            }
            // 无错误，特殊参数：http
            else if(
                params.length ===3    &&         // 3个参数
                params[0] ==='buffer' &&         // 第一个是表明是buffer直接反馈
                (typeof params[1]==='string') && // 第二个是Content-Type字符串
                Buffer.isBuffer(params[2])       // 第三个是二进制流，为反馈体本身
            ) {
                resultType=params[1];
                resultBuf =params[2];
            }
            // 无错误，普通参数，仅能反馈第一个
            else {
                const result={
                    code:0,
                    message:'',
                    result:null
                };
                result.result=params[0];
                resultType='application/json';
                resultBuf =Buffer.from(JSON.stringify(result));
            }

            // 转字符串输出
            res.writeHead(200,{
                'Content-Length': resultBuf.length,
                'Content-Type'  : resultType,
                'Cache-Control' : 'no-cache'
            });
            res.write(resultBuf);
            res.end()
        }
    },
];

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

                // 反馈
                resolve(raw);
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

        // 认证当前请求对象
        await this._httpAuth.requestAuth(request);
        // 跨域配置
        if(this._ajaxApi.access) response.setHeader('Access-Control-Allow-Origin', this._ajaxApi.access);
        // 如果需要设置头信息，在此配置
        if(request.resHeaders) request.resHeaders.forEach(str=>{
            const index=str.indexOf(':');
            const key  =str.substr(0,index);
            const value=str.substr(1+index);
            response.setHeader(key,value);
        });

        // 错误消息
        let errMsg='';

        /* 获取参数数组 */
        let params;
        let contentMethod=contentMethods[0]; // 默认json格式
        if(request.method==='POST'){
            // post方法时，必须从content-type识别，清空默认
            contentMethod=null;
            /* 根据contentType识别处理对象 */
            const ctype=request.headers['content-type'];
            for(let i=0;i<contentMethods.length;i++){
                const p=contentMethods[i];
                if(ctype.includes(p.reqContentTypeFeature)){
                    contentMethod=p;
                    break
                }
            }

            // 如果此处没有，则报错终止
            if(!contentMethod){
                errMsg='unknow Content-Type: '+ctype
            }
            // 有post处理方法
            else {
                const raw=await this._ajaxPostData(request);
                params=contentMethod.buf2params(raw,request.querys)
            }
        }
        // 非post格式，将url请求参数放在参数数组第二项
        else {
            params=[null,request.querys];
        }

        if(errMsg){
            response.writeHead(400);
            response.end(errMsg);
            return
        }

        /* 分离api路径 */
        // 若有"?"，取出之前的部分
        let index=request.url.indexOf('?'); // 问号index
        let api=index>=0?request.url.substr(0,index):request.url;
        // 取最后一个"/"之后的部分
        index=api.lastIndexOf('/');
        api=api.substr(index+1);

        // 构造info
        const info={
            reqInfo:{
                api:api,
            },
            hubInfo:{
                hubId:this.hubId
            },
            httpAuth:request.httpAuth
        };

        // 调用定义时传入的方法
        let err,resultParams;
        try{
            [err,...resultParams]=await this._ajaxApi.apiFunc(info,params);
        }
        catch (e) {
            err=e
        }

        // 调用反馈
        contentMethod.resFunc(response,err,resultParams)
    }

    // 接收http升级为websocket请求
    async upgrade(request,socket,head){
        // 认证当前请求对象
        await this._httpAuth.requestAuth(request);

        /* 验证参数合法性 */
        let httpErrCode=0; // 错误代码，默认0即然没有

        // 取出id，authStr
        const id=request.querys.id;
        const authStr=request.querys.authStr;

        let wsObj;

        // 没有设备类别，不可连接。反馈代码400，告知客户端不必再尝试
        if(!request.httpAuth.devTyp) httpErrCode=400;
        // 请求验证非法，报405错误
        else if (!(await this.check_connect(id,request.httpAuth,authStr))) httpErrCode=405;
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
            if(wsObj.ws) httpErrCode=406;
            // authStr
            else if(wsObj.authStr!==authStr) httpErrCode=407;
        }

        // 有错误时直接response错误信息，并结束
        if(httpErrCode){
            socket.write('HTTP/1.1 '+httpErrCode +'\r\n\r\n');
            socket.destroy();
            return
        }

        // 显示日志
        etools.log(`[${this.labelText}] clientId: ${id}`);

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
    async getIdAuth(id){
        // 先获取id对应的wsObj，获取失败则返回null
        const wsObj=this._wsDict[id];
        if(!wsObj||!wsObj.ws||!wsObj.request) return null;

        // 验证request
        await this._httpAuth.requestAuth(wsObj.request);

        // 反馈
        return wsObj.request.httpAuth;
    }
}

module.exports=c_hubWs;