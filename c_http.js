const fs=require('fs');
const URL=require('url');
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
                    response.writeHead(500);
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
            console.log(`[${this.labelText}] `+'Listen OK')
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
        console.log(`[${this.labelText}] Reg pathPrefix:"${pathPrefix}"${domainPostfix?(' domainPostfix: '+domainPostfix):''} to `+siteObj.labelText);
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
        // 认证当前请求对象
        await this._httpAuth.requestAuth(request);
        // 如果没有SessionId，则重新分配
        if(!request.httpAuth.SessionId){
            await this._httpAuth.setRequestNewSessionId(request);
        }

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
                request.resHeaders.forEach(s=>{
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


// 认证管理实例
class c_httpAuth{
    /* conf 配置项
     *
     * redisConf: redis连接配置，可分离于微服务平台
     * SessionIdKey: cookie中SessionId存储的key
     * SessionTimeoutSec: Session有效时常，以秒为单位
     * TokenKey：头信息中token携带的key
     * domainShares：可共享的主域
     * isAllowUnknowDomain：是否允许未列出的域
     */
    constructor(conf){
        // 记录配置信息
        this._SessionIdKey     = conf.SessionIdKey;
        this._SessionTimeoutSec= conf.SessionTimeoutSec;
        this._TokenKey         = conf.TokenKey;
        this._domainShares     = conf.domainShares||[];
        this._isAllowUnknowDomain=conf.isAllowUnknowDomain||false;

        // 验证配置
        if(!this._SessionIdKey||(typeof this._SessionIdKey!=='string')) throw new Error('must set SessionIdKey');
        if(!this._TokenKey    ||(typeof this._TokenKey    !=='string')) throw new Error('must set TokenKey');
        if(this._TokenKey.toLocaleLowerCase()!==this._TokenKey) throw new Error('TokenKey cannot have UpperCase Word');

        // 创建redis连接实例
        this.redis=c_connRedis.f_buildConn(conf.redisConf,'localhost',6379,'http#');
    }

    /**
     * 获取Session字典中指定项信息
     * @param SessionId 要验证的SessionId
     * @param keys 要获取的项目
     * @returns {Promise<void>}
     */
    async getSessionInfo(SessionId,keys){
        const values = await this.redis.hmgetAsync(`${this.redis.prefix}se_${SessionId}`,...keys);
        const result={};
        for(let i=0;i<keys.length;i++){
            result[keys[i]]=values[i]
        }
        return result;
    }

    async setSessionExpire(SessionId,Second){
        if(!Second) Second=this._SessionTimeoutSec;
        const r=await this.redis.expireAsync(`${this.redis.prefix}se_${SessionId}`,Second);
        return !!r;
    }

    // 给request设定新的SessionId
    async setRequestNewSessionId(request){
        // 尝试查找共享域
        let domain;
        for(let i=0;i<this._domainShares.length;i++){
            const tryDomain=this._domainShares[i];
            if(request.reqInfo.hostname.substr(request.reqInfo.hostname.length-tryDomain.length)===tryDomain){
                domain=tryDomain;
                break
            }
        }

        // 如果未获取到共享域，且不允许未知，则报错
        if(!domain && !this._isAllowUnknowDomain) throw new Error('unknow HostDomain');

        // 生成新id，并验证当前redis中没有重复
        const strmod='0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
        let newId,exists;
        do{
            newId='';
            for(let i=0;i<16;i++) newId+=strmod.substr(Math.floor(Math.random()*strmod.length),1);
            exists=await this.redis.exists(`${this.redis.prefix}se_${newId}`);
        }while (!exists);

        // 调用退出登录方法
        await this.setSessionLogout(newId);

        // 修改认证信息
        request.httpAuth.SessionId=newId;

        // 添加头信息，写Cookie
        request.resHeaders.push('Set-Cookie: '+funcDict.getSetSessionIdHeaderStr(this._SessionIdKey,newId,domain));

    }

    // 清空登录信息
    async setSessionLogout(SessionId){
        // 删除并重建
        await this.redis.multi()
            .del(`${this.redis.prefix}se_${SessionId}`)
            .hset(`${this.redis.prefix}se_${SessionId}`,'buildSt',Date.now())
            .execAsync();
        // 设定有效期
        await this.setSessionExpire(SessionId)
    }

    // 给http请求对象写入authSet结点
    async requestAuth(request){
        // 提取信息结构
        let reqInfo;
        // 初次验证的request对象
        if(!request.reqInfo){
            reqInfo=request.reqInfo={
                hostname:funcDict.getHostname(request),
                ipStr:funcDict.getIpStr(request),
                ipRaw:null,
                SessionId:null,
                token:request.headers[this._TokenKey]||''
            };
            const cookieDict=funcDict.getCookieDict(request);
            reqInfo.SessionId=cookieDict[this._SessionIdKey];
            reqInfo.ipRaw=funcDict.ip2raw(reqInfo.ipStr);

            // 反馈的消息头结构
            request.resHeaders=[];
        }
        // 非初次验证，往往是WebSocket连接反复来验证
        else {
            reqInfo=request.reqInfo;
            // SessionId为上次认证后的SessionId
            reqInfo.SessionId=request.httpAuth.SessionId;
        }

        // 写入认证信息
        const httpAuth=request.httpAuth={
            SessionId:'',  // 认证后的SessionId
            AccountId:'',  // 认证后的AccountId
            Security:0,    // 安全级别
            ipUser:'',     // 根据ip地址认证的用户
            httpErrCode:0, // http错误代码，非零则应直接
            httpErrMsg:''  // http错误消息，需错误代码非零才有意义
        };

        // 1、如果提交信息有SessionId，先判定是否有效，有效则
        if(reqInfo.SessionId){
            // 判定是否在有效期，在则延长
            const isOk=await this.setSessionExpire(reqInfo.SessionId);
            // 在有效期，才继续
            if(isOk){
                // 写认证后的SessionId
                httpAuth.SessionId=reqInfo.SessionId;

                // 读取Session信息
                const info=await this.getSessionInfo(reqInfo.SessionId,['AccountId','Security']);
                httpAuth.AccountId=info.AccountId||'';
                httpAuth.Security =info.Security||0;
            }
        }

        // 2、如果SessionId无效，但有Token信息，尝试根据Token获取认证信息
        if(!httpAuth.SessionId && reqInfo.token){

        }

        // 3、如果传入没有SessionId和Token，尝试根据IP地址认证身份
        if(!reqInfo.SessionId && !reqInfo.token){

        }
    }
}

module.exports={
    c_server,
    c_siteStatic,
    c_httpAuth
};