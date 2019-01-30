
const etools=require('./etools');

const funcDict={};
// 字符串转流
funcDict.str2buf=(str)=>{
    // nodejs环境，使用Buffer提供的方法
    if(etools.isNode) return Buffer.from(str,'utf8');
    // 高级浏览器
    else if(typeof TextEncoder!=='undefined') return (new TextEncoder('utf-8')).encode(str);
    // 低级浏览器，自行实现
    else {
        let code,out=[];
        for(let i=0;i<str.length;i++){
            code=str.charCodeAt(i);
            // 0xxxxxxx
            if(code>>7===0){
                out.push(code);
            }
            // 110x xxxx   10xx xxxx
            else if(code>>11===0){
                out.push(0xc0 & (code >> 6));
                out.push(0x80 & (code & 0x3f))
            }
            // 1110 xxxx  10xx xxxx  10xx xxxx
            else {
                out.push(0xe0 & (code >> 12));
                out.push(0x80 & (code >> 6 & 0x3f));
                out.push(0x80 & (code & 0x3f));
            }
        }
        return new Uint8Array(out);

    }
};
// 流转字符串
funcDict.buf2str=(buf)=>{
    // nodejs环境，使用Buffer提供的方法
    if(etools.isNode){
        if(!Buffer.isBuffer(buf)) buf=Buffer.from(buf);
        return buf.toString('utf8');
    }
    // 高级浏览器
    else if(typeof TextDecoder!=='undefined') return (new TextDecoder('utf-8')).decode(buf);
    // 低级浏览器，自行实现
    else {
        let i=0, c, char2, char3, out="";
        while(i < buf.length) {
            c = buf[i++];
            // 0xxxxxxx
            if(c>>7===0){
                out += String.fromCharCode(c);
            }
            // 110x xxxx   10xx xxxx
            else if(c>>5===6){
                char2 = buf[i++];
                out += String.fromCharCode(((c & 0x1F) << 6) | (char2 & 0x3F));
            }
            // 1110 xxxx  10xx xxxx  10xx xxxx
            else if(c>>4===14){
                char2 = buf[i++];
                char3 = buf[i++];
                out += String.fromCharCode(((c & 0x0F) << 12) |
                    ((char2 & 0x3F) << 6) |
                    ((char3 & 0x3F) << 0));
            }
        }

        return out;

    }
};
// 流转topic和msg
funcDict.buf2topicMsg=(buf)=>{
    const index0=buf.indexOf(0);
    const topic=funcDict.buf2str(buf.slice(0,index0));
    const msg=buf.slice(index0+1);
    return [topic,msg]
};
// 合并
funcDict.msgCombine=(...all)=>{
    // 将所有参数先整理为流
    all=all.map(i=>{
        // 支持数字0
        if(i===0) return funcDict.str2buf('\0');
        // 支持字符串
        if(typeof i==='string') return funcDict.str2buf(i);
        // 至此认为本身就是流的形式，后续出错自然会抛出
        return i;
    });
    /* 组织输出 */
    // 总长度
    let totalLen=0;
    all.forEach(i=>totalLen+=i.length);
    // 创建总输出，并依次写入
    const result= new Uint8Array(totalLen);
    let p=0;
    all.forEach(i=>{
        result.set(i,p);
        p+=i.length;
    });


    return result;
};
// 判定id的类别
funcDict.idType=(id)=>{
    // 非字符串，或空字符串，无法判定
    if(!id||(typeof id!=="string")) return;
    const len=id.length;
    // 判定hubCli
    if(10<len&&len<=24&&(/^[a-zA-Z0-9\-]+$/.test(id))) return 'hubCli';
    // 判定serv
    if((/^[a-zA-Z0-9\-#]+$/.test(id)) && (0<len && len<=10 || id.includes('#'))) return 'serv';

    // 全部都不符合
    return
};

module.exports=funcDict;