/*
* 集线器核心类
*
* 运行环境：Nodejs
*
* */

const etools=require('./etools');
const protoWork = require('./protoWork');
const c_connRedis=require('./c_connRedis');

/*
* hubConf配置说明
*
* hubTyp 集线器类别，在继承类代码中赋值
* hubId  集线器标识
*
* */

/*
* 需在继承类中实现的方法
*
* pubClient(id,topic,buf)
* getIdAuth(id) - async
* */

/*
* 可选在代码中实现的检查方法，均可为async类型，默认方法在构造函数中，可在外部替换
* check_connect  (id,authObj,authStr)  ：连接建立时使用的id是否被允许，默认仅检测id符合16位base62
* check_eventBook(id,authObj,eventName)：事件订阅验证，默认允许
* check_eventEmit(id,authObj,eventName)：事件推送验证，默认禁止
* check_apiReq   (id,authObj,targetId )：调用API验证，默认允许
* */

class c_hubCore {
    constructor(conf) {
        // 生成hub前缀，并连接后端Redis
        if (!conf.typ || !conf.halfId) throw new Error('HubConf need: typ & halfId');
        this.hubId = conf.typ+':'+conf.halfId;
        this._conn = new c_connRedis.c_subpub(conf.redisConf);
        this._conn.onMessage=(...all)=>this._onRedisMsg(...all);
        this._conn.onConnect=(...all)=>this._onRedisConnect(...all);

        // 事件订阅集合
        this._bookDict={};

        // 权限验证默认方法
        this.check_connect   =(id,httpAuth,authStr)=>{
            // 仅接收默认hub客户端随机Id生成规则
            return /^[A-Za-z0-9]{16}$/.test(id)
        };
        this.check_eventBook =(id,httpAuth,eventName)=>{return true};
        this.check_eventEmit =(id,httpAuth,eventName)=>{return false};
        this.check_apiReq    =(id,httpAuth,targetId)=>{return true};

    }

    // 客户端上线
    _clientOn(id){
        etools.log(`[${this.labelText}] (${id}) On`);
    }
    // 客户端下线
    _clientOff(id){
        etools.log(`[${this.labelText}] (${id}) Off`);
        // 取消该id的所有订阅
        Object.keys(this._bookDict).forEach(topic=>this._clientSubCancel(id,topic));
    }

    // 内部命令式主题，对应处理在各类别client类，不在clientCore
    _clientCmdTopic(id,cmdTopic,msg){
        switch (cmdTopic){
            // 心跳
            case '__ping': this.pubClient(id,'__pong',''); break;
            case '__pong': break;
            // 订阅
            case '__sub': this._clientSub(id,msg.toString()); break;
            // 取消订阅
            case '__subCancel': this._clientSubCancel(id,msg.toString());break;
        }
    }

    // 客户端订阅取消，(主动取消，下线时后端取消)
    _clientSubCancel(id,topic){
        // 获取主题对象，没有则不必继续
        const topicObj=this._bookDict[topic];
        if(!topicObj) return;

        // 从ids数组移除自身id
        const index=topicObj.ids.indexOf(id);
        if(index>=0){
            topicObj.ids.splice(index,1);
            etools.log(`[${this.hubId}] (${id}) SubCancel: `+topic);
        }

        // 如果此时ids数组为空，则删除该主题对象，并向redis取消订阅
        if(topicObj.ids.length===0){
            delete this._bookDict[topic];
            this._conn.subCancel(topic);
            etools.log(`[${this.hubId}] Redis SubCancel: `+topic);
        }
    }
    async _clientSub(id,topic){
        // 权限，默认无权
        let isOk=false;

        const index=topic.indexOf('.');
        const left =topic.substr(0,index);
        const right=topic.substr(index+1);

        // 订阅自身api机制免验证
        if(topic==='apiMsg.'+id) isOk=true;
        // 订阅事件，调用check_eventBook验证权限
        else if(left==='eventMsg'){
            // 获取账号信息，获取不到则不用处理
            const authObj=await this.getIdAuth(id);
            // 没有获取到，则验证失败
            if(!authObj) isOk=false;
            // 调用检验方法，此时right即为eventName
            else isOk=await this.check_eventBook(id,authObj,right);
        }
        // 不明订阅，拒绝
        else isOk=false;

        // 无权订阅，向客户端推送通知
        if(!isOk){
            // 告知客户端拒绝订阅
            this.pubClient(id,'__subReject',topic);
        }
        // 准许订阅，进行关联
        else {
            // 告知客户端订阅成功
            this.pubClient(id,'__subSucc',topic);

            // 获取
            const topicObj=this._bookDict[topic]=this._bookDict[topic]||{
                ids:[],// 当前订阅的id集合，为空时表示没有向redis订阅
            };
            // 该消息初次被订阅
            if(topicObj.ids.length===0){
                // 向redis订阅该主题
                this._conn.sub(topic);
                etools.log(`[${this.hubId}] Redis Sub: `+topic);
            }
            // 当前订阅不含该id时，添加进去
            if(!topicObj.ids.includes(id)){
                topicObj.ids.push(id);
                etools.log(`[${this.hubId}] (${id}) Sub: `+topic);
            }
        }

    }
    async _clientPub(id,topic,msg){
        // 权限，默认无权
        let isOk;
        const index=topic.indexOf('.');
        const left =topic.substr(0,index);
        const right=topic.substr(index+1);


        // 根据消息头，确定不同的检验方法
        try{
            switch (left){
                case 'apiMsg':{
                    const apiMsg=protoWork.decode('apiMsg',msg);
                    switch (apiMsg.cmd){
                        // 收到应答及执行结果反馈，不用检测，予以通过
                        case 'rec':case 'res':
                        isOk=true;
                        break;
                        // 调用其他服务API
                        case 'req':
                            // 获取账号信息
                            const authObj=await this.getIdAuth(id);
                            // 没有获取到，则验证失败
                            if(!authObj) isOk=false;
                            // 调用检验方法，此时right为对方id
                            else isOk=await this.check_apiReq(id,authObj,right);
                            // 允许调用时，写入hubInfo
                            if(isOk){
                                // 写集线器信息
                                apiMsg.hubInfo= {
                                    hubId: this.hubId
                                };
                                // 带入身份信息
                                apiMsg.httpAuth=authObj;
                                let msgTyp;
                                [msgTyp,msg]=protoWork.encode(apiMsg);
                            }
                    }
                    break;
                }
                case 'eventMsg':
                    // 获取请求权限
                    const httpAuth=await this.getIdAuth(id);
                    // 没有获取到，则验证失败
                    if(!httpAuth) isOk=false;
                    // 调用检验方法，此时right为eventName
                    else isOk=await this.check_eventEmit(id,httpAuth,right);
                    // 如果验证通过，更新msg流，写入hubInfo信息
                    if(isOk){
                        const eventMsg=protoWork.decode('eventMsg',msg);
                        eventMsg.hubInfo= {
                            hubId: this.hubId,
                            AccountId: httpAuth.AccountId
                        };
                        let msgTyp;
                        [msgTyp,msg]=protoWork.encode(eventMsg);
                    }
                    break;
                // 不明消息，拒绝
                default: isOk=false;
            }
        }
        catch (e) {
            // 出错，拒绝
            etools.log(`[${this.hubId} Warn] clientPub Check Throw Error`);
            isOk=false;
        }

        // 无权，向客户端推送通知
        if(!isOk) this.pubClient(id,'__pubReject',topic);
        // 准许，推送到redis
        else this._conn.pub(topic,msg);
    }

    // 后端Redis消息处理
    _onRedisConnect(){}
    _onRedisMsg(channel,msg){
        const topicObj=this._bookDict[channel];
        // 未订阅该频道，或该频道ids数量为0，向redis取消订阅
        if(!topicObj||topicObj.ids.length===0){
            this._conn.subCancel(channel);
            return;
        }

        // 向订阅了该频道的所有id推送
        topicObj.ids.forEach(id=>this.pubClient(id,channel,msg));
    }

    // 日志标签
    get labelText(){
        return `procHub(${this.hubId})`
    }
}

module.exports=c_hubCore;
