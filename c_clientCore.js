/*
* 节点核心类
*
* 运行环境：Nodejs Browser
*
* */
const etools    = require('./etools');
const protoWork = require('./protoWork');
const c_apiFunc = require('./c_apiFunc');
const funcDict  = require('./funcDict');

// 网点类
class c_clientCore{
    /**
     * 配置项说明：
     *
     * @param clientConf 节点信息配置：
     * id - 自身服务标识字符串，数字、大小写字母
     *
     * @param conn 节点连接实例，需传入已实例化的conn类
     */
    constructor(clientConf,conn){
        /* 常量 */
        // 连接
        this._conn=conn;
        // 自身id
        this.id=clientConf.id;
        // 自身程序集合
        this._apiFunc=new c_apiFunc();
        // 事件订阅集合
        this._eventFunc={};


        // 订阅API相关消息
        this._conn.sub('apiMsg.'+this.id);

        /* 运行参数 */
        // api请求列表，以请求序号为key，value：[callback, recClock, timeOutClock]
        this.apiReqCache={};

        // 事件关联
        this._conn.onMessage=(...all)=>this._onMessage(...all);

        // 输出日志
        etools.log(`[${this.labelText}] Build`)
    }

    // 收到消息
    _onMessage(topic,msg){
        // 分离后续参数
        const index=topic.indexOf('.');
        const first=topic.substr(0,index);
        const ext  =topic.substr(index+1);
        switch (first){
            // api请求相关
            case 'apiMsg':
                // id不匹配，不再继续
                if(ext!==this.id) break;
                // 解析消息
                const apiMsg=protoWork.decode('apiMsg',msg);
                switch (apiMsg.cmd){
                    case 'req':this._api_req(apiMsg);break;
                    case 'rec':this._api_rec(apiMsg);break;
                    case 'res':this._api_res(apiMsg);break;
                }
                break;
            // 事件相关
            case 'eventMsg':
                // 不解析，直接调用相关函数
                this._eventOn(ext,msg);
                break;
        }
    }

    /* 内部工具函数 */
    _params2arry(params){
        const len=params.length;

        const paramsTyp=new Array(len);
        const paramsBuf=new Array(len);

        // 整理反馈参数
        let dyType='json'; // 动态类别，默认json
        for(let i=0;i<len;i++){
            /* 序列化 */
            let paramTyp,paramBuf;
            const param=params[i];
            // Buffer格式
            if(etools.isBuffer(param)){
                paramTyp='buf';
                paramBuf=param;
            }
            // protomid格式
            else if(param&&(typeof param==='object')&&param.$type&&param.$type.name) [paramTyp,paramBuf]=protoWork.encode(param);
            // json格式
            else [paramTyp,paramBuf]=['json',funcDict.str2buf(JSON.stringify(param)||'')];

            // paramTyp有变化，记录
            if(dyType!==paramTyp) {
                dyType=paramTyp;
                paramsTyp[i]=paramTyp;
            }
            // 无变化，记录空字符串
            else paramsTyp[i]='';

            // 记录buf
            paramsBuf[i]=paramBuf;
        }

        // 反馈
        return [paramsTyp,paramsBuf];
    }
    _arry2params(paramsTyp,paramsBuf){
        const len=paramsBuf.length;
        const params=new Array(len);
        let dyType='json'; // 动态类别，默认json
        for(let i=0;i<len;i++){
            // 更新动态类别
            dyType=paramsTyp[i]||dyType;
            /* 解析 */
            // buf格式
            if(dyType==='buf'){
                params[i]=paramsBuf[i];
            }
            // json格式
            else if(dyType==='json'){
                if(paramsBuf[i].length>0)
                    params[i]=JSON.parse(funcDict.buf2str(paramsBuf[i]));
                else
                    params[i]=undefined;
            }
            // protobuf格式
            else params[i]=protoWork.decode(dyType,paramsBuf[i]);
        }

        return params;
    }

    /* ======= API相关处理 ======= */
    /**
     * 占用topic：apiMsg.[id]
     *
     */
    // 获取api调用序号
    get _apiCount(){
        // 空或越界，归1
        if(!this._apicount||this._apicount>9e9) this._apicount=1;
        // 正常，则递增
        else this._apicount++;
        // 返回内部值
        return this._apicount;
    }
    // 对方请求
    _api_req(reqMsg){
        /* 反馈收到请求 */
        if(reqMsg.count){
            // 生成收到反馈对象
            const recMsg=protoWork.create('apiMsg',{
                id:this.id,
                cmd:'rec',
                count:reqMsg.count
            });
            // 序列化后发送
            const [sendTyp,sendBuf]=protoWork.encode(recMsg);
            this._conn.pub('apiMsg.'+reqMsg.id,sendBuf);
        }

        // 获取处理方法
        const func=this._apiFunc.getFunc(reqMsg.reqInfo.api);

        // 解析参数
        const params=this._arry2params(reqMsg.paramsTyp,reqMsg.paramsBuf);

        // 响应处理结果
        let isResponsed=false;
        const doResponse=(err,...params)=>{
            // 已经响应过，不再处理
            if(isResponsed) return;
            else isResponsed=true;

            // 如果没有回调需求，至此可结束
            if(!reqMsg.count) return;

            /* 整理错误信息 */
            let resErr;
            // 有错误信息，处理为apiResErr格式
            if(err) {
                switch (typeof err){
                    // 数字类型，自定义错误代码
                    case 'number':
                        resErr=protoWork.create('apiResErr',{code:Number.parseInt(err)});
                        break;
                    // 字符串类型，自定义msg
                    case 'string':
                        resErr=protoWork.create('apiResErr',{code:30,message:err});
                        break;
                    // 错误对象
                    default:
                        const pre={
                            code:err.code||30,
                            message:err.message||err.msg,
                        };
                        // 如果没有message，尝试按照语言查找
                        if(!pre.message){
                            const language=reqMsg.reqInfo.language||'zh';
                            pre.message=err[language];
                        }

                        resErr=protoWork.create('apiResErr',pre);
                }
            }

            // 构造反馈信息
            const resMsg=protoWork.create('apiMsg',{
                id:this.id,
                cmd:'res',
                count:reqMsg.count,
                resErr
            });

            // 序列化参数
            [resMsg.paramsTyp,resMsg.paramsBuf]=this._params2arry(params);

            // 序列化发送消息
            const [sendTyp,sendBuf]=protoWork.encode(resMsg);
            // 发送
            this._conn.pub('apiMsg.'+reqMsg.id,sendBuf);
        };

        // 执行方法函数
        let funcOut=func(reqMsg,params,(...all)=>{
            // 此段代码被执行，说明api方法函数中调用了Callback函数
            doResponse(...all);
        });

        // 同步返回数字或字符串，为错误信息，包装为数组
        if(['number','string'].includes(typeof funcOut)){
            funcOut=[funcOut]
        }
        // 同步返回数组，与callback方式处理相同
        if(Array.isArray(funcOut)){
            doResponse(...funcOut);
        }
        // 同步返回promise对象，resolve为参数数组，reject为错误
        else if(funcOut&&Object.prototype.toString.call(funcOut)==='[object Promise]'){
            funcOut
                // Promise resolve 或 async return返回时，接收数组参数，整体执行response
                .then((all)=> {
                    // 返回非数组时，包装为数组
                    if(!Array.isArray(all)) all=[all];
                    // 异步调用响应
                    process.nextTick(() => doResponse(...all))
                })
                // Promise reject  或 async throw 时，接收错误对象
                .catch((err)=>{
                    doResponse(err);
                })
        }
        // 其他判定为true项目，为编程错误，抛出异常
        else if(funcOut) throw new Error('未识别的同步返回值：'+funcOut);
    }
    // 对方表示收到，清除收到反馈
    _api_rec(recMsg){
        // 获取缓存
        const cache=this.apiReqCache[recMsg.count];
        // 无缓存结束
        if(!cache) return;
        // 清除rec定时器
        clearTimeout(cache[1]);
    }
    // 收到对方反馈
    _api_res(resMsg){
        /* 机制内部处理 */
        // 获取缓存
        const cache=this.apiReqCache[resMsg.count];
        // 无缓存结束
        if(!cache) return;
        // 清除rec、timeout定时器，既允许直接res，而没有rec
        clearTimeout(cache[1]);
        clearTimeout(cache[2]);
        // 删除缓存
        delete this.apiReqCache[resMsg.count];

        /* 解析反馈消息，调用callback */
        const params=this._arry2params(resMsg.paramsTyp,resMsg.paramsBuf);

        // 执行回调
        cache[0](resMsg.resErr,...params);
    }
    // 注册api方法
    apiReg(api,func){
        // 委托给内部处理
        this._apiFunc.reg(api,func);
        // 输出日志
        etools.log(`[${this.labelText}] RegApi: `+api.toString());
    }
    // 调用API方法
    apiCall(reqMsg,params,callback){
        // 兼容直接给完整api格式
        if(typeof reqMsg==='string'){
            reqMsg={
                reqInfo:{
                    api:reqMsg
                }
            }
        }
        // 提取出完整Api，后续需修改为服务内的Api
        const apiFull=reqMsg.reqInfo.api;

        // 分离服务、内部Api名称
        const index=apiFull.indexOf('.');
        const id=apiFull.substr(0,index); // api处理方id
        reqMsg.reqInfo.api=apiFull.substr(index+1);// 将reqMsg内的API字符串修改为局部名称
        const count=callback?this._apiCount:0; // 没有回调函数时，count为0

        // 请求参数格式整理
        if(!Array.isArray(params)) throw new Error('params must be Array');

        /**
         * 写入更多信息
         *
         * reqInfo项目要么传入字符串已经整理，要么外部必须构造
         * httpAuth后台间调用时不需要，转发前端请求时需要
         *
         */
        reqMsg.id=this.id;
        reqMsg.cmd='req';
        reqMsg.count=count;


        // 构造请求包
        const apiReq=protoWork.create('apiMsg',reqMsg);

        // 序列化参数
        [apiReq.paramsTyp,apiReq.paramsBuf]=this._params2arry(params);

        // 整体序列化
        const [sendTyp,sendBuf]=protoWork.encode(apiReq);
        // 发送
        this._conn.pub('apiMsg.'+id,sendBuf);

        // 如果没有callback，既count标注为0，至此可结束
        if(!count) return 0;

        // 5秒没有rec定时器
        const recClock=setTimeout(()=>{
            // 删除缓存
            delete this.apiReqCache[count];
            // 清除30秒超时定时器
            clearTimeout(timeOutClock);
            // 错误回调
            callback(protoWork.create('apiResErr',{
                code:10,
                msg:'调用API请求时，对方5s内未收到'
            }))
        },5e3);
        // 30秒超时定时器
        const timeOutClock=setTimeout(()=>{
            // 删除缓存
            delete this.apiReqCache[count];
            // 错误回调
            callback(protoWork.create('apiResErr',{
                code:11,
                msg:'调用API请求时，对方30s内未反馈'
            }))
        },30e3);

        // 缓存请求及定时器
        this.apiReqCache[count]=[callback,recClock,timeOutClock];

        // 返回值带出count
        return count;
    }
    async apiCallAsync(reqMsg,params){
        // 将回调方式封装为
        return new Promise((resolve)=>{
            this.apiCall(reqMsg,params,(...all)=>resolve(all))
        });
    }

    /* ======= Event相关处理 ======= */
    /**
     * 占用topic：eventMsg.[eventName]
     * 占用store：eventMsg.[eventName]
     *
     */
    // 收到事件
    _eventOn(eventName,buf){
        // 取出对应处理函数
        const funcs=this._eventFunc[eventName];
        // 没有订阅记录，自行取消
        if(!funcs || funcs.length===0){
            this.eventCancel(eventName);
            return
        }

        // 解析原始包
        const eventMsg=protoWork.decode('eventMsg',buf);
        // 解析info项目
        const info={
            id:eventMsg.id,
            hubInfo:eventMsg.hubInfo
        };
        // 解析参数
        const params=this._arry2params(eventMsg.paramsTyp,eventMsg.paramsBuf);
        // 遍历调用执行，如果执行出错，自动取消订阅。
        for(const func of funcs){
            try{
                func(info,...params);
            }
            catch (e) {
                this.eventCancel(eventName,func);
            }
        }
    }
    // 订阅事件
    eventBook(eventName,func){
        // 格式检验
        if((typeof eventName!=='string') || !eventName ||
            (typeof func!=='function')
        ) throw new Error('Format Error');

        // 构建函数记录数组
        let arry=this._eventFunc[eventName];
        if(!arry) arry=this._eventFunc[eventName]=[];

        // 该事件对应函数为空，需发送订阅指令
        if(arry.length===0) this._conn.sub('eventMsg.'+eventName);
        // 订阅函数非空，判定是否已有订阅，有则结束
        else if(arry.includes(func)) return;

        // 记录该函数
        arry.push(func);
    }
    // 取消订阅
    eventCancel(eventName,func){
        // 未传入要取消的具体方法，取消全部，即彻底取消
        if(!func){
            // 如果有订阅记录，则发送取消指令
            this._conn.subCancel('eventMsg.'+eventName);
            // 删除该事件记录项
            delete this._eventFunc[eventName];
        }
        // 有传入
        else {
            // 没有该事件对应的记录，啥都不用做
            if(!this._eventFunc[eventName]) return;
            // 定位该函数
            const index=this._eventFunc[eventName].indexOf(func);
            // 没有，什么都不用做
            if(index<0) return;
            // 移除该函数
            this._eventFunc[eventName].splice(index,1);
            // 如果没有其他函数了，彻底取消
            if(this._eventFunc[eventName].length===0) this.eventCancel(eventName);
        }
    }
    // 触发事件
    eventEmit(eventName,...params){
        // 构造包
        const eventMsg=protoWork.create('eventMsg',{
            id:this.id, // 发出方id
        });

        // 序列化参数
        [eventMsg.paramsTyp,eventMsg.paramsBuf]=this._params2arry(params);

        // 整体序列化
        const [sendTyp,sendBuf]=protoWork.encode(eventMsg);
        // 发送
        this._conn.pub('eventMsg.'+eventName,sendBuf);
    }

    /* ======= 队列消息机制 ======= */
    // 向队列中添加
    queuePush(queueName,...protoMids){
        let protoMid,bufs=[];
        while(protoMid=protoMids.shift()){
            // 序列化
            const [sendTyp,sendBuf]=protoWork.encode(protoMid);
            // 添加
            bufs.push(sendBuf);
        }
        // 添加到队列
        this._conn.queuePush(queueName,...bufs);
    }

    /* ========= 公用属性 =========*/
    get labelText(){
        return `Client(${this.id})`;
    }
}

// 输出
module.exports=c_clientCore;