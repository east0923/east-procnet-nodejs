/**
 * 方法集合类，可注册方法、并查询
 *
 * 功能：以字符串key或正则表达式注册方法，在需要时查询匹配
 *
 * 匹配原则：
 * 1、字符串完全匹配优先；
 * 2、较早注册的正则表达式优先。
 *
 * 使用范围：前端、后端
 */

// 引入etools库
const etools=require('./etools');

//
class c_apiFunc {
  constructor(){
    // 对外提供的API字典集合（高优先级）
    this._apiDict = {};
    // 对外提供的API正则匹配数组（低优先级，有顺序）
    this._apiRegex = [];
  }
  // 设定对外提供的API
  reg(api, func) {
    // func必须是函数，否则为编程错误
    if(typeof func!=='function') throw new Error('func format Error');

    // 根据api类型，来确定设定方法
    switch (etools.etype(api)){
      // 字符串：记录到字典匹配
      case 'string':
        this._apiDict[api] = func;
        break;
      // 正则对象，添加到正则匹配数组
      case 'regex':
        this._apiRegex.push([api,func]);
        break;
      // 未识别
      default: throw new Error('unknow how to regApi');
    }
  }

  // 获取方法函数
  getFunc(api){
    // api必须是字符串，否则为编程错误
    if(typeof api!=='string') throw new Error('api must be String');

    // 优先级 1：如果有字典匹配，直接反馈
    if(api in this._apiDict) return this._apiDict[api];

    // 优先级 2：依次尝试正则匹配，匹配成功，则反馈
    for(let i=0;i<this._apiRegex.length;i++)
      if(this._apiRegex[i][0].test(api)) return this._apiRegex[i][1];

    // 末次：返回未找到方法
    const func=(info,[], callback)=>{
      // 作为API方法集用时，callback位置为function，需报错
      if(typeof callback==='function') callback('noApi: ' + api)
    };
    return func;
  }
}

module.exports=c_apiFunc;
