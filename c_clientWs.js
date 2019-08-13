/*
* 微服务WebSocket节点，可用于前端
*
* 运行环境：Nodejs Browser
*
* */

const c_ws=(typeof WebSocket!=='undefined')?WebSocket:require('ws');
const etools=require('./etools');
const funcDict=require('./funcDict');

/* ====== 通用连接 ====== */
class c_conn{
    // 配置项在c_client构造过程中生成
    constructor(conf){
        // 配置信息原样记录
        this.conf=conf;
        // 创建send缓存
        this._sendCache=[];
        // 重连计次，0表示初次连接
        this._reConnCount=0;
        // 重连读秒，超过重连计次或超过10s，执行连接
        this._reConnSec=0;
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
            if(this._ws) this._ws.close();
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
        // 不可用，且没有ws实例，需重建连接
        else if(!this._ws) {
            // 重连读秒+1
            this._reConnSec++;
            // 符合重连条件
            if(this._reConnSec>Math.min(10,this._reConnCount)){
                this._reConnSec=0;   // 重连读秒回0
                this._reConnCount++; // 重连计次+1
                this._buildWs();     // 建立连接
            }
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
        deleteNo.forEach(i=>{
            this._sendCache.splice(i,1)
        });

        /* ===== 心跳机制 ===== */
        // 此处以有_ws对象为标准判定是否可用
        if(this._ws){
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
        const conf=this.conf;
        // 完整地址
        let fullUrl=conf.url+
            '?id='     +conf.id+
            '&authStr='+conf.authStr+
            '&devId='  +conf.devTyp+'_'+conf.devNo;
        if(conf.devSt&&conf.devPass){
            fullUrl+='&devSt='  +conf.devSt;
            fullUrl+='&devPass='+conf.devPass;
        }

        // 创建连接实例
        const ws=this._ws=new c_ws(fullUrl,'*');
        // 设定消息格式
        ws.binaryType='arraybuffer';
        // 空闲时间归零
        this.empSec=0;

        ws.onopen=(...all)=>{
            if(ws!==this._ws) return;
            etools.log('Connected by clientWs: '+fullUrl);
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
                // etools.log(`[${this.conf.id}] rec Server Ping`)
                break;
            case '__pong':
                // etools.log(`[${this.conf.id}] rec Self Ping Back`);
                break;
            // 订阅成功
            case '__subSucc':{
                // 取出主题对应订阅状态对象，取不到则结束
                const topic=String.fromCharCode(...msg);
                const subObj=this._subDict[topic];
                if(!topic) break;

                // 将订阅状态标记为成功
                subObj.state=4;

                //etools.log(`[${this.conf.id}] subSucc  : `+topic);
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
    /*
    * 构造函数中第一项url参数会写入conf中的url节点
    * 最终配置项说明：
    * url：WebSocket连接的地址
    * 【http层身份标识】
    * devTyp ：连接设备类型，默认浏览器为web，后台为nodejs，Iot应用应外部传入
    * devNo  ：设备编号，默认浏览器随机生成并存储在LocalStorage，后台始终随机，Iot应用应外部传入
    * devSt  ：设备时间戳(毫秒)，仅适用于后台Iot设备身份认证
    * devPass：连接密码，仅适用于后台Iot设备身份认证
    * 【其他配置】
    * cacheSec：连接不可用时，消息缓存时间，单位为秒。默认为5秒。
    * 【自动生成，不可配置的项目】
    * id：websocket层的id
    * authStr：websocket防冒充的连接密码
    *
    * */
    constructor(url,conf={}){
        /* 构造配置兼容及整理 */
        // 推荐构造方式，第一项给url，第二项给可选参数
        if(typeof url==='string') conf.url=url;
        // 兼容老版本，在第一项给conf对象
        else if(url) conf=url;
        // 兼容老版本，第一项为空，第二项给url
        else if(typeof conf==='string') conf={url:conf};
        // 兼容老版本，第二线给conf对象，此时不用处理


        /* http层身份认证信息整理 */
        // 未配置devTyp时的自动配置
        if(!conf.devTyp) conf.devTyp=etools.isNode?'nodejs':'web';
        // 未配置devNo时的自动配置
        if(conf.devNo) {}
        else if(etools.isNode) conf.devNo=etools.ranStr(16,'base62');
        else {
            conf.devNo=localStorage.getItem('devNo');
            if(!conf.devNo) {
                conf.devNo=etools.ranStr(16,'base62');
                localStorage.setItem('devNo',conf.devNo);
            }
        }

        /* 自动生成websocket层身份：id & authStr */
        // node环境，id和authStr均为随机字符串
        if(etools.isNode){
            conf.id=etools.ranStr(16,'base62');
            conf.authStr=etools.ranStr(10,'base62');
        }
        // 浏览器环境，尝试读sessionStorage，没有再随机
        else{
            // 尝试读取localStorage
            conf.id     =sessionStorage.getItem('wsId_'+conf.url);
            conf.authStr=sessionStorage.getItem('wsAuth_'+conf.url);
            // 本地获取失败，则自动生成并记录
            if(!conf.id || !conf.authStr){
                // 随机生成
                conf.id=etools.ranStr(16,'base62');
                conf.authStr=etools.ranStr(10,'base62');
                // 记录到localStorage
                sessionStorage.setItem('wsId_'+conf.url,conf.id);
                sessionStorage.setItem('wsAuth_'+conf.url,conf.authStr);
            }
        }

        /* connConf中消息缓存时间，默认5秒 */
        conf.cacheSec=conf.cacheSec||5;

        /* 建立连接，并生成 */
        const conn=new c_conn(conf);
        super(conf,conn);
    }
}

/* ====== 输出 ======*/
const expOut={
    c_client,
    protoWork:require('./protoWork'),
};
module.exports=expOut;

// 前端写到window中
if(!etools.isNode) window.c_clientWs=expOut;

/* 添加前端IE不支持的数组方法 */
[Array,Uint8Array].forEach(arry=>{
    var _array=arry;
    // slice
    if (!_array.prototype.slice) {
        //Returns a new ArrayBuffer whose contents are a copy of this ArrayBuffer's
        //bytes from `begin`, inclusive, up to `end`, exclusive
        _array.prototype.slice = function (begin, end) {
            //If `begin` is unspecified, Chrome assumes 0, so we do the same
            if (begin === void 0) {
                begin = 0;
            }

            //If `end` is unspecified, the new ArrayBuffer contains all
            //bytes from `begin` to the end of this ArrayBuffer.
            if (end === void 0) {
                end = this.byteLength;
            }

            //Chrome converts the values to integers via flooring
            begin = Math.floor(begin);
            end = Math.floor(end);

            //If either `begin` or `end` is negative, it refers to an
            //index from the end of the array, as opposed to from the beginning.
            if (begin < 0) {
                begin += this.byteLength;
            }
            if (end < 0) {
                end += this.byteLength;
            }

            //The range specified by the `begin` and `end` values is clamped to the
            //valid index range for the current array.
            begin = Math.min(Math.max(0, begin), this.byteLength);
            end = Math.min(Math.max(0, end), this.byteLength);

            //If the computed length of the new ArrayBuffer would be negative, it
            //is clamped to zero.
            if (end - begin <= 0) {
                return new _array(0);
            }

            var result=new _array(end - begin);

            for(var i=0;i<end - begin;i++){
                result[i]=this[begin+i];
            }

            return result;
        };
    }
    // indexOf
    if (!_array.prototype.indexOf) {
        _array.prototype.indexOf=function(searchElement, fromIndex) {

            var k;

            // 1. Let o be the result of calling ToObject passing
            //    the this value as the argument.
            if (this == null) {
                throw new TypeError('"this" is null or not defined');
            }

            var o = Object(this);

            // 2. Let lenValue be the result of calling the Get
            //    internal method of o with the argument "length".
            // 3. Let len be ToUint32(lenValue).
            var len = o.length >>> 0;

            // 4. If len is 0, return -1.
            if (len === 0) {
                return -1;
            }

            // 5. If argument fromIndex was passed let n be
            //    ToInteger(fromIndex); else let n be 0.
            var n = fromIndex | 0;

            // 6. If n >= len, return -1.
            if (n >= len) {
                return -1;
            }

            // 7. If n >= 0, then Let k be n.
            // 8. Else, n<0, Let k be len - abs(n).
            //    If k is less than 0, then let k be 0.
            k = Math.max(n >= 0 ? n : len - Math.abs(n), 0);

            // 9. Repeat, while k < len
            while (k < len) {
                // a. Let Pk be ToString(k).
                //   This is implicit for LHS operands of the in operator
                // b. Let kPresent be the result of calling the
                //    HasProperty internal method of o with argument Pk.
                //   This step can be combined with c
                // c. If kPresent is true, then
                //    i.  Let elementK be the result of calling the Get
                //        internal method of o with the argument ToString(k).
                //   ii.  Let same be the result of applying the
                //        Strict Equality Comparison Algorithm to
                //        searchElement and elementK.
                //  iii.  If same is true, return k.
                if (k in o && o[k] === searchElement) {
                    return k;
                }
                k++;
            }
            return -1;
        };
    }
    // includes
    if (!_array.prototype.includes) {
        _array.prototype.includes=function(valueToFind, fromIndex) {

            if (this == null) {
                throw new TypeError('"this" is null or not defined');
            }

            // 1. Let O be ? ToObject(this value).
            var o = Object(this);

            // 2. Let len be ? ToLength(? Get(O, "length")).
            var len = o.length >>> 0;

            // 3. If len is 0, return false.
            if (len === 0) {
                return false;
            }

            // 4. Let n be ? ToInteger(fromIndex).
            //    (If fromIndex is undefined, this step produces the value 0.)
            var n = fromIndex | 0;

            // 5. If n ≥ 0, then
            //  a. Let k be n.
            // 6. Else n < 0,
            //  a. Let k be len + n.
            //  b. If k < 0, let k be 0.
            var k = Math.max(n >= 0 ? n : len - Math.abs(n), 0);

            function sameValueZero(x, y) {
                return x === y || (typeof x === 'number' && typeof y === 'number' && isNaN(x) && isNaN(y));
            }

            // 7. Repeat, while k < len
            while (k < len) {
                // a. Let elementK be the result of ? Get(O, ! ToString(k)).
                // b. If SameValueZero(valueToFind, elementK) is true, return true.
                if (sameValueZero(o[k], valueToFind)) {
                    return true;
                }
                // c. Increase k by 1.
                k++;
            }

            // 8. Return false
            return false;
        }
    }
});