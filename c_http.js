const fs=require('fs');
const URL=require('url');
const etools=require('./etools');
const c_connRedis=require('./c_connRedis');

// 功能函数
const funcDict={
    // 获取hostname，即host中不含端口的部分
    getHostname:(request)=>{
        // 给host项去除端口信息
        let hostname=request.headers.host;
        const lastIndex = hostname.lastIndexOf(':');
        // 有端口：有冒号，且最后一个字符不是“]”，排除单纯的ipv6地址
        if (lastIndex > 0 && hostname.substr(hostname.length-1)!==']'){
            return hostname.substr(0,lastIndex);
        }
        // 无端口，直接返回
        else return hostname;
    },
    // 将cookie字符串识别为字典
    getCookieDict:(request)=>{
        const cookieStr=request.headers.cookie;
        if(typeof cookieStr!=='string') return {};
        // 有cookie项目，分离
        const rObj={};
        cookieStr.split(';').forEach((item)=>{
            const [key,value]=item.split('=').map((i)=>{return i.trim()});
            // 如果value
            rObj[key]=value
        });
        return rObj
    },
    // 获取ip地址字符串
    getIpStr:(request)=> {
        return request.headers['x-forwarded-for'] ||
            request.connection.remoteAddress ||
            request.socket.remoteAddress ||
            request.connection.socket.remoteAddress;
    },
    // 将ip地址转为buf流
    ip2raw(ip){
        let ipRaw;
        // ipv4类型
        if(ip.includes('.')){
            // 排除ipv6兼容模式，仅提取最后的
            if(ip.includes(':')) ip=ip.substr(ip.lastIndexOf(':')+1);

            const arry=ip.split('.').map(r=>{return parseInt(r)});
            return Buffer.from(arry);
        }
        // ipv6类型
        else {
            ipRaw=Buffer.alloc(16,0);
            const strArry=ip.split(':');
            let hasFilled=false;// 是否遇到过填充
            let p=0; // 填充指针
            for(let i=0;i<strArry.length;i++){
                // 空字符串：最前面是冒号，或遇到连续冒号
                if(!strArry[i]){
                    // 如果没有填充过，此处补(9-len)*2个0
                    if(!hasFilled){
                        hasFilled=true;
                        p+=(9-strArry.length)*2;
                    }
                    // 如果已经填充过，此处只可再补2个0
                    else p+=2;
                }
                // 非空字符串，先转数字
                else {
                    const num=parseInt(strArry[i]);
                    ipRaw.writeUInt16BE(num,p);
                    p+=2;
                }
            }
            return ipRaw;
        }
    },
    // 计算两个ip地址匹配的长度
    ipRawSameLen(raw1,raw2){
        // 长度不一致，匹配长度反馈0
        if(raw1.length!==raw2.length) return 0;

        // 匹配长度，默认0
        let len=0;
        for(let i=0;i<raw1.length;i++){
            // 对位异或运算
            let a=raw1[i]^raw2[i];
            // 是否退出循环
            const isBreak=!!a;
            // 默认此次匹配到8位，先加
            len+=8;
            // 异或结果按位减出
            while (a){
                len--;
                a=a>>1;
            }
            // 如果需跳出循环，则break
            if(isBreak) break;
        }
        // 反馈匹配长度
        return len;
    },
    // 获取设置SessionId的头信息
    getSetSessionIdHeaderStr(SessionIdKey,SessionId,domain){
        // 添加头信息写入cookie
        const cookie=[
            SessionIdKey+'='+SessionId,
            'path=/',
            'expires=Thu, 31-Dec-37 23:55:55 GMT',
            'max-age=2147483647',
            'HttpOnly'
        ];
        // 是否设置了共享域
        if(domain) cookie.push('Domain='+domain);

        return cookie.join(';');
    }
};

// http监听服务
class c_server{
    constructor(conf){
        this._port=conf.port||80;                           // 监听端口
        this._showErrorToWeb=conf.showErrorToWeb||false;    // 是否将错误信息输出到Web端
        this._showErrorToLog=conf.showErrorToLog||false;    // 是否将错误信息输出到日志

        // 站点缓存
        this._sites=[];

        // 建立http服务器
        this.server=require('http').createServer();
        this.server.listen(this._port);

        // 各个事件的订阅并下发给站点
        this.server.on('upgrade', (request, socket, info)=>{
            const site=this._getSite(request);
            if(site && site.upgrade) site.upgrade(request, socket, info);
            else socket.destroy();
        });
        this.server.on('request', async (request, response)=>{
            const site=this._getSite(request);
            if(site && site.request){
                try{
                    await site.request(request, response);
                } catch (e) {
                    response.writeHead(400);
                    if(this._showErrorToWeb) response.end(e.message);
                    else response.end('Server Error');
                    if(this._showErrorToLog) console.log(e);
                }
            }
            else{
                response.writeHead(404);
                response.end('no site');
            }
        });
        this.server.on('listening',()=>{
            etools.log(`[${this.labelText}] `+'Listen OK')
        })
    }

    // 获取站点对象，未匹配则返回undefined
    _getSite(request){
        const host=request.headers.host;
        // 依次遍历站点，一旦有匹配的，则反馈
        const hostLen=host.length;
        for(let i=0;i<this._sites.length;i++){
            // 取出站点配置
            const item=this._sites[i];
            // 默认匹配结果为真
            let match=true;

            // 如果有域名匹配要求，且不成立，匹配结果设置为假
            if(item.domainPostfix && item.domainPostfix!==host.substr(hostLen-item.domainPrefix.length)) match=false;
            // 如果有路径匹配要求，且不成立，匹配结果设置为假
            else if(item.pathPrefix && item.pathPrefix!==request.url.substr(0,item.pathPrefix.length)) match=false;

            // 如果匹配成功，则反馈站点对象
            if(match) return item.siteObj;
        }
    }

    /**
     * 注册站点，注册顺序即为优先级
     * @param siteObj 站点对象
     * @param pathPrefix 路径前缀，留空则匹配所有
     * @param domainPostfix 域名后缀，留空则匹配所有
     */
    siteReg(siteObj,pathPrefix,domainPostfix){
        pathPrefix=pathPrefix||'/';
        this._sites.push({siteObj,pathPrefix,domainPostfix});
        etools.log(`[${this.labelText}] Reg pathPrefix:"${pathPrefix}"${domainPostfix?(' domainPostfix: '+domainPostfix):''} to `+siteObj.labelText);
    }

    get labelText(){
        return `HttpServer(${this._port})`;
    }
}

// 默认MIME配置
const mimeDefault={
    "css": "text/css",
    "gif": "image/gif",
    "html": "text/html",
    "ico": "image/x-icon",
    "jpeg": "image/jpeg",
    "jpg": "image/jpeg",
    "js": "text/javascript",
    "json": "application/json",
    "pdf": "application/pdf",
    "png": "image/png",
    "svg": "image/svg+xml",
    "swf": "application/x-shockwave-flash",
    "tiff": "image/tiff",
    "txt": "text/plain",
    "wav": "audio/x-wav",
    "wma": "audio/x-ms-wma",
    "wmv": "video/x-ms-wmv",
    "xml": "text/xml",
    "ttf": "font/otf",
    "woff": "application/x-font-woff",
    "woff2": "application/x-font-woff"
};
// 静态资源站点
class c_siteStatic{
    /* conf 配置参数
     *
     * root：文件路径
     * defaultDoc：默认文档，可留空使用index.html
     * mime：扩展名与Content-Type对应关系字典，可留空使用mimeDefault配置
     * */
    constructor(conf){
        // 提取配置
        this._root=conf.root;
        this._defaultDoc=conf.defaultDoc||'index.html';
        this._mime=conf.mime||mimeDefault;
        this._httpAuth=conf.httpAuth;

        // 修正_root末尾不含‘/’或‘\’号
        const len=this._root.length;
        const lastChar=this._root.substr(len-1);
        if('/\\'.includes(lastChar)) this._root=this._root.substr(0,len-1);
    }

    /**
     * 读取文件或缓存
     * @param urlPath url路径(已经补充了默认文档)
     * @param callback 回调函数
     * @private
     */
    _getFile(urlPath,callback){
        // 异步读取文件方法，并委托callback
        fs.readFile(this._root+urlPath,callback);
    }

    /* 站点对http服务接口 */
    // 一般请求到达
    async request(request,response) {
        // 认证当前请求对象(可选)
        if(this._httpAuth) await this._httpAuth.requestAuth(request);

        // 获取请求路径
        const urlInfo = require('url').parse(request.url);
        const pathName = urlInfo.pathname;

        // 分离路径和文件名
        const index = pathName.lastIndexOf('/');
        const path = pathName.substr(0, index);
        const fileName = pathName.substr(index + 1) || this._defaultDoc;

        // 分离扩展名
        const index2 = fileName.lastIndexOf('.');
        const ext = index2 >= 0 ? fileName.substr(index2 + 1) : "";

        // 获取mime类型
        const mimeType = this._mime[ext];
        // 如果没有获取到，报405错误
        if (!mimeType) {
            response.writeHead(405);
            response.end('no match Mime');
        }
        // mime匹配成功，获取
        else this._getFile(path + '/' + fileName, (err, buf) => {
            if(err){
                response.writeHead(404);
                response.end('get file Error');
            }
            else {
                response.setHeader('Content-Length',buf.length); // 设置文档长度
                response.setHeader('Content-Type', mimeType); // 设定文档类型
                // 补充其他头信息
                if(request.resHeaders) request.resHeaders.forEach(s=>{
                    let index=s.indexOf(':');
                    response.setHeader(s.substr(0,index),s.substr(index+1));
                });
                response.end(buf);
            }
        });
    }

    // 日志标签
    get labelText(){
        return `SiteStatic(root:"${this._root}")`;
    }
}

// ipUser字典注册及查询
class c_ipMatch{
    constructor(){
        // 列表中每一项为一个
        this._list=[];
    }

    // 清空
    clean(){
        this._list=[];
    }

    /**
     * 规则注册
     * @param user 标记名称，如此项为数组，则批量迭代
     * @param ip ip地址
     * @param mask 子网掩码
     */
    reg(user,ip,mask){
        // 获取ip地址对应的流
        const ipRaw=funcDict.ip2raw(ip);
        // 默认子网掩码，ipv4为32，ipv6为128
        if(!Number.isSafeInteger(mask)){
            mask=ipRaw.length*8;
        }
        // 记录到list
        this._list.push({user,ipRaw,mask});
    }

    // 获取ip对应的用户
    getUser(ip){
        // 将输入ip转为流
        const ipRaw=Buffer.isBuffer(ip)?
            ip:
            funcDict.ip2raw(ip);

        // 依注册顺序依次匹配
        for(let i=0;i<this._list.length;i++){
            const rec=this._list[i];
            // 长度不一致，跳过
            if(rec.ipRaw.length!==ipRaw.length) continue;
            // 计算匹配长度
            const len=funcDict.ipRawSameLen(rec.ipRaw,ipRaw);
            // 如果匹配长度大于等于要求，则反馈该值
            if(len>=rec.mask) return rec.user;
        }

        // 没有任何匹配，反馈空字符串
        return ''
    }
}

/**
 * 认证管理实例
 *
 * 依赖请求Query参数中，devId参数，来判别请求类别
 *
 * 认证方式有三种：
 * Session机制，主要针对Web端：
 * Token机制，主要针对APP端
 * IP机制，主要针对服务器后台
 * */
class c_httpAuth{
    constructor(redisConf){
        // 创建redis连接实例
        this.redis=c_connRedis.f_buildConn(redisConf,'localhost',6379,'http#');

        // 异步判定是否已经设置了配置，没有配置则从redis配置信息中读取
        process.nextTick(()=>{
            // 根据是否设定了SessionId存储的key，来判定是否有设置
            if(!this._isSetConf) this.setConf()
        });

        // 每分钟从redis中更新一次配置
        setInterval(()=>this.setConf(),60000)
    }

    /**
     * 初始化配置，主动调用时，将配置信息记录到Redis中
     * @param conf 配置项，后续详细说明
     * @param isRedis 是否是从redis中读取的配置
     *
     * SessionTimeoutSec: Session有效时长，以秒为单位
     * TokenTimeoutSec  : Token有效时长，以秒为单位
     * domainShares：可共享的主域
     * isAllowUnknowDomain：是否允许未列出的域
     * ipUserArray：ip认证列表，有先后顺序，参考c_ipMatch类
     * authToken、authIp、authIot、authSession，根据devTyp匹配的身份验证类型
     */
    async setConf(conf){
        // 判定是否执行过setConf用
        this._isSetConf=true;
        // 有conf，将配置信息记录到redis
        if(conf){
            const str=JSON.stringify(conf);
            this.redis.hset(`${this.redis.prefix}info`,'confJson',str);
        }
        // 如果要求从redis中更新
        else {
            const buf=await this.redis.hgetAsync(`${this.redis.prefix}info`,'confJson');
            if(!buf) throw new Error('Get Conf from Redis Failed');
            conf=JSON.parse(buf.toString());
        }

        /* 记录配置信息 */
        // 根据devTyp来判定Session、Token、IP、Iot认证方式，未设置则用默认值
        this._authToken          = conf.authToken||['ios','android'];
        this._authSession        = conf.authSession||['web'];
        this._authIp             = conf.authIp||['java','nodejs','python'];
        this._authIot            = conf.authIot||[];

        // SessionId超时时间，单位秒
        this._SessionTimeoutSec  = conf.SessionTimeoutSec;
        // Token超时时间，单位秒
        this._TokenTimeoutSec    = conf.TokenTimeoutSec;
        // 可用的共享域
        this._domainShares       = conf.domainShares||[];
        // 是否允许不在domainShares列表中的域来访问
        this._isAllowUnknowDomain= conf.isAllowUnknowDomain||false;

        // 新建（或清空）ipMatch对象
        if(this._ipMatch) this._ipMatch.clean();
        else this._ipMatch=new c_ipMatch();

        // 逐条注册ipUser信息
        (conf.ipUserArray||[]).forEach(i=>{
            this._ipMatch.reg(i.user,i.ip,i.mask);
        });

    }

    /**
     * 对request对象进行认证，同一request可多次调用该方法（应对WebSocket链接）
     * @param request 原生request对象
     *
     * 写入节点：
     * 1、httpAuth 认证信息，每次调用更新，结构保持与proto文件一致
     * 2、resHeaders 反馈需写入的头信息，仅初次更新
     * 3、querys URL后续请求参数，仅初次更新
     * 4、cookieDict cookie字典，仅初次更新
     *
     * Bug列表：
     * 【20190429】
     * 现象：同一request短时间内多次调用该方法时，httpAuth失效
     * 原因：因为该方法为异步方法，而httpAuth对象是唯一实例，导致类似于需要锁的情景
     * 解决方案：
     * 1、httpAuth构建过程中，不写入request对象；
     * 2、不使用async关键字，异步时反馈Promise对象
     * 3、_resolves项为构建过程中，Promise对象resolve方法缓存数组，长度为0表示需要构建，大于0表示构建过程中，无该项表明构建完成
     * 4、_checkOnce表明是否仅检查一次，ip和iot机制中使用
     */
    requestAuth(request){
        // 获取认证对象
        let httpAuth=request.httpAuth;
        // 是否是初次验证
        const isFirst=!httpAuth;
        // 初次验证，httpAuth不存在，构建httpAuth结构
        if(isFirst){
            // 反馈的消息头结构
            request.resHeaders=[];

            // 提取cookie
            request.cookieDict=funcDict.getCookieDict(request);
            // 提取querys
            const urlObj=URL.parse(request.url);
            const querys=request.querys={};
            urlObj.query && urlObj.query.split('&').forEach(line=>{
                const [key,value]=line.split('=');
                querys[key]=value;
            });

            // 读取devId，定位下划线
            const devId=querys.devId||'';
            const index=devId.indexOf('_');

            /* ==== 构建初始httpAuth结构 === */
            httpAuth={
                devTyp    : devId.substr(0,index), // 请求设备类型
                devNo     : devId.substr(1+index), // 请求设备id
                host      : funcDict.getHostname(request), // 请求头中的host信息
                ipRaw     : funcDict.ip2raw(funcDict.getIpStr(request)), // 请求来源的IP地址
                userAgent : request.headers['user-agent'], // 请求头中的浏览器信息
                _checkOnce: false, // 仅检查一次的标记
                _resolves : [],    // 等待的resolve方法集合，留空表示未开始

            }

            /* 写入httpAuth.domain节点 */
            // 查找共享域
            for(let i=0;i<this._domainShares.length;i++){
                const tryDomain=this._domainShares[i];
                if(httpAuth.host.includes(tryDomain)){
                    httpAuth.domain=tryDomain;
                    break
                }
            }
            // 已有
            if(httpAuth.domain){}
            // 配置允许未知域
            else if(this._isAllowUnknowDomain) httpAuth.domain=httpAuth.host;
            // 不允许未知域，抛出错误
            else throw new Error('Forbidden Request Host');

            /* 写入httpAuth.authTyp节点 */
            if     (this._authToken  .includes(httpAuth.devTyp)) httpAuth.authTyp='token';
            else if(this._authIp     .includes(httpAuth.devTyp)) httpAuth.authTyp='ip';
            else if(this._authIot    .includes(httpAuth.devTyp)) httpAuth.authTyp='iot';
            else if(this._authSession.includes(httpAuth.devTyp)||request.cookieDict.sid) httpAuth.authTyp='session';
        }
        // 之前构建未完成，httpAuth复用，此处不做处理
        else if(httpAuth._resolves) {}
        // 构建完成，仅检查一次，可直接返回
        else if(httpAuth._checkOnce) return
        // 需要重新构建httpAuth
        else {
            const obj={
                devTyp   :httpAuth.devTyp,
                devNo    :httpAuth.devNo,
                host     :httpAuth.host,
                ipRaw    :httpAuth.ipRaw,
                userAgent:httpAuth.userAgent,
                domain   :httpAuth.domain,
                authTyp  :httpAuth.authTyp,
                _checkOnce:false,
                _resolves:[],
            }
            httpAuth=obj;
        }

        // 构建httpAuth，反馈Promise对象
        return new Promise(async resolve => {
            // 将resolve方法记录
            httpAuth._resolves.push(resolve);
            // 如果resolve记录超过1个，说明正在构建过程中，不必再次进行构建
            if(httpAuth._resolves.length>1) return;

            // SessionId机制
            if     (httpAuth.authTyp==='session'){
                // 提取待验证的SessionId
                const reqSid=isFirst?
                    (request.cookieDict.sid    ||''): // 初次验证从Cookie中提取
                    (request.httpAuth.SessionId||''); // 再次验证取上一次的SessionId

                // 判定sid是否在有效期，在则延长。第一次时
                const isOk=await this.setSessionExpire(reqSid);
                // 在有效期，记录
                if(isOk) httpAuth.SessionId=reqSid;
                // 不在有效期，第一次请求，重发SessionId
                else if(isFirst) httpAuth.SessionId=await this.setRequestNewSessionId(request,httpAuth);

                // 读取Session信息
                if(httpAuth.SessionId){
                    // 读取Session信息，写AccountId
                    const info=await this.getSessionInfo(httpAuth.SessionId,['AccountId']);
                    httpAuth.AccountId=info.AccountId||'';
                }
            }
            // Token机制
            else if(httpAuth.authTyp==='token'){
                // 提取待验证的token
                const reqToken=request.querys.token||'';

                // 尝试延长有效期
                const isOk=await this.setTokenExpire(reqToken);
                // 延长成功
                if(isOk){
                    // 记录Token
                    httpAuth.Token=reqToken;
                    // 读取Token信息
                    const info=await this.getTokenInfo(httpAuth.Token,['AccountId']);
                    httpAuth.AccountId=info.AccountId||'';
                }
            }
            // ip地址验证机制，设定checkOnce，以保证仅验证1次
            else if(httpAuth.authTyp==='ip'){
                // 直接尝试获取ip地址对应的用户，并记录到IpUser
                httpAuth.IpUser=this._ipMatch.getUser(httpAuth.ipRaw);
                httpAuth._checkOnce=true;
            }
            // Iot设备认证机制，设定checkOnce，以保证仅验证1次
            else if(httpAuth.authTyp==='iot'){
                // 写入Iot设备是否可靠
                httpAuth.IotOk=!!(await this.iotRequestCheck(request));
                httpAuth._checkOnce=true;
            }

            // 将httpAuth写入Request
            request.httpAuth=httpAuth;
            // 取出缓存的resolves，并清除，表明构建完成
            const funcs=httpAuth._resolves;
            delete httpAuth._resolves;
            // 执行所有缓存的resolve方法
            funcs.forEach(f=>f());
        })
    }

    /* ====== SessionId机制 ====== */
    // 给request设定新的SessionId
    async setRequestNewSessionId(request,httpAuth){
        /**
         * 分配SessionId，需注意全局同步
         *
         * 当一个客户端无SessionId，且加载页面向多个后台发起请求。
         * 多个后台都在尝试为其分配SessionId，若分配的SessionId不
         * 同，则会产生Bug。需保证多个后台分配的SessionId相同。
         *
         * 此处利用reqUuid作为请求标识，在redis记录reqUuid对应分发
         * 的SessionId，有效期仅5秒。在此期间相同reqUuid再分配Sess
         * ionId时，取出之前的分配结果再次使用。
         *
         * reqUuid并不能很好的保证唯一性，所以分配记录有效期设定尽量短
         */

            // 生成reqUuid、Redis中的分发记录key
        let reqUuid=
            httpAuth.domain+'|'+
            httpAuth.devTyp+'|'+
            httpAuth.devNo+'|'+
            httpAuth.userAgent;
        reqUuid=etools.md5(reqUuid,null,'hex');
        const key=`${this.redis.prefix}seIssue_${reqUuid}`;

        // 生成尝试使用的SessionId
        const tryNewId=etools.ranStr(16,'base62');

        // 在Redis中进行原子操作
        const result=await this.redis.multi()
            .setnx (key,tryNewId) // 先尝试将预备的SessionId写入分发记录，已存在则会写入失败
            .get   (key)          // 读取分发记录，之前已存在，则读取到的与tryNewId不一样
            .expire(key,5)        // 将分发记录有效期设定为5秒
            .execAsync();

        // 最终分配的SessionId以Redis分发记录读出的为准
        const newId=result[1].toString();

        // 如果setnx成功，先执行退出登录处理，实现redis记录初始化的效果
        if(result[0]) await this.setSessionLogout(newId);

        // 添加头信息，写Cookie
        request.resHeaders.push('Set-Cookie: '+funcDict.getSetSessionIdHeaderStr('sid',newId,httpAuth.domain));

        // 将newId作为返回值反馈
        return newId;
    }

    // Session信息读取、写入
    async getSessionInfo(SessionId,keys){
        const values = await this.redis.hmgetAsync(`${this.redis.prefix}se_${SessionId}`,...keys);
        const result={};
        for(let i=0;i<keys.length;i++){
            result[keys[i]]=values[i]===null?null:values[i].toString('utf8')
        }
        return result;
    }
    async setSessionInfo(SessionId,dict){
        const dels=[];
        const adds=[];
        // 遍历字典
        for(const key in dict){
            if(!dict.hasOwnProperty(key)) continue;
            // 设定为null，予以删除
            if(dict[key]===null) dels.push(key);
            // 字符串类型，予以添加
            else if(typeof dict[key]==='string') adds.push(key,dict[key]);
        }
        // 操作
        if(dels.length>0) await this.redis.hdelAsync (`${this.redis.prefix}se_${SessionId}`,...dels);
        if(adds.length>0) await this.redis.hmsetAsync(`${this.redis.prefix}se_${SessionId}`,...adds);
    }

    // 设定有效期，Second不给则从配置读取
    async setSessionExpire(SessionId,Second){
        // 无SessionId，直接反馈false
        if(!SessionId) return false;
        // 尝试调用redis进行延长，延长有效期结果即表明Session是否有效
        if(!Second) Second=this._SessionTimeoutSec;
        const r=await this.redis.expireAsync(`${this.redis.prefix}se_${SessionId}`,Second);
        return !!r;
    }

    // 清空登录信息
    async setSessionLogout(SessionId){
        // 删除并重建
        await this.redis.multi()
            .del(`${this.redis.prefix}se_${SessionId}`)
            .hset(`${this.redis.prefix}se_${SessionId}`,'BuildSt',Date.now())
            .execAsync();
        // 设定有效期
        this.setSessionExpire(SessionId)
    }

    /* ====== Token机制 ====== */
    // 分配新Token，并写入AccountId
    async getNewToken(AccountId){
        const Token=etools.ranStr(32,'base62');
        await this.setTokenInfo(Token,{
            AccountId,
            BuildSt:Date.now().toString()
        });

        // 写入有效期
        this.setTokenExpire(Token);

        return Token;
    }

    // Token信息读取、写入
    async getTokenInfo(Token,keys){
        const values = await this.redis.hmgetAsync(`${this.redis.prefix}to_${Token}`,...keys);
        const result={};
        for(let i=0;i<keys.length;i++){
            result[keys[i]]=values[i].toString('utf8')
        }
        return result;
    }
    async setTokenInfo(Token,dict){
        const dels=[];
        const adds=[];
        // 遍历字典
        for(const key in dict){
            if(!dict.hasOwnProperty(key)) continue;
            // 设定为null，予以删除
            if(dict[key]===null) dels.push(key);
            // 字符串类型，予以添加
            else if(typeof dict[key]==='string') adds.push(key,dict[key]);
        }
        // 操作
        if(dels.length>0) await this.redis.hdelAsync (`${this.redis.prefix}to_${Token}`,...dels);
        if(adds.length>0) await this.redis.hmsetAsync(`${this.redis.prefix}to_${Token}`,...adds);
    }

    // 设定有效期，Second不给则从配置读取
    async setTokenExpire(Token,Second){
        // 无SessionId，直接反馈false
        if(!Token) return false;
        // 尝试调用redis进行延长，延长有效期结果即表明Session是否有效
        if(!Second) Second=this._TokenTimeoutSec;
        const r=await this.redis.expireAsync(`${this.redis.prefix}to_${Token}`,Second);
        return !!r;
    }

    // 清空登录信息
    setTokenLogout(Token){
        // 删除Token信息
        this.redis.del(`${this.redis.prefix}to_${Token}`)
    }
}

module.exports={
    c_server,
    c_siteStatic,
    c_httpAuth
};