/**
 * east工具集，要能够适用于前后端
 */

const etools={};
module.exports=etools;

// 直接引用第三方库
etools.clone=require('clone');
// 子项目载入
etools.time=require('./sub_time');
etools.num =require('./sub_num');
etools.md5 =require('./md5');

// 是否是在nodejs环境
etools.isNode=process && process.version;

// 获取对象原型类别
etools.protoType=function(obj){
  return Object.prototype.toString.call(obj);
};

// 获取east定义类别
etools.etype=function(obj){
  switch (Object.prototype.toString.call(obj)){
    case '[object Object]':return 'dict';
    case '[object Array]':return 'array';
    case '[object Null]':return 'null';
    case '[object RegExp]':return 'regex';
    case '[object Uint8Array]':return 'buffer';
    case '[object Undefined]':return 'undefined';
    case '[object Number]':return 'number';
    case '[object String]':return 'string';
    case '[object Function]':return 'function';
    case '[object Boolean]':return 'bool';
    default:return 'unknow';
  }
};

// 日志输出，增加时间前缀
etools.log=function(str){
  // 后台需补充时间
  if(etools.isNode) console.log(etools.time.nowLocalStr()+': '+str);
  // 前端直接输出
  else console.log(str);
};

// 取环境变量，取不到则用默认值
etools.getEnvInt=(key,def)=>{
  const val=process.env[key];
  if(val && val.length>0) return Number.parseInt(val);
  else return Number.parseInt(def);
};
etools.getEnvStr=(key,def)=>{
  const val=process.env[key];
  if(val && val.length>0) return val;
  else return String(def);
};

// 产生指定长度的随机字符串
etools.ranStr=(len,typ)=>{
  let $chars;
  switch (typ){
    case 'hex':case undefined:
    $chars='1234567890abcdef';break;
    case 'base62':
      $chars='1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';break;
    default:
      throw new Error('unknow Random Type');
  }

  var maxPos = $chars.length;
  var pwd = '';
  for (var i = 0; i < len; i++) {
    pwd += $chars.charAt(Math.floor(Math.random() * maxPos));
  }
  return pwd;
};

/**
 * 以指定顺序将元素插入数组，key相同则替换
 * @param arry 要插入的数组
 * @param obj 要插入的对象
 * @param key 排序属性，或数组下标
 */
etools.orderInsert=(arry,obj,key)=>{
  const len=arry.length; // 原数组长度
  const num=obj[key];    // 插入对象属性值
  let p,re;   // 最终插入位置，是否替换

  // 特殊情况快速得到结果
  if     (len===0)                [p,re]=[0,0];    // 空数组
  else if(arry[len-1][key]<num)   [p,re]=[len,0];  // 后面插入
  else if(arry[0][key]>num)       [p,re]=[0,0]  ;  // 前面插入
  else if(arry[len-1][key]===num) [p,re]=[len-1,1];// 最后一位替换
  else if(arry[0][key]===num)     [p,re]=[0,1];    // 第一位替换
  // 不满足特殊清空，二分法查找应该插入的位置
  else {
    let start=0,end=len-1,mid;
    while(start+1!==end){
      mid=((end-start)>>1)+start;
      if(arry[mid][key]===num){
        [p,re]=[mid,1];
        break;
      }
      else if(arry[mid][key]>num)
        end=mid;
      else
        start=mid;
    }
    // 若是break跳出，此处必定不成立；正常结束，必定成立
    if(start+1===end) [p,re]=[end,0];
  }

  // 对数组进行操作
  arry.splice(p,re,obj);
};
