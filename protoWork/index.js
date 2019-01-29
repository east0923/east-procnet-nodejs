
const protobufjs=require('protobufjs');
const etools=require('../etools/index');

const protoBuf = protobufjs.Root.fromJSON(require('./plant.json'));

class c_protoWork{
  constructor(root){
    this._root=root;
  }

  /**
   * 将json序列化为指定格式
   * @param json 必须是字典，
   * @param typ 指定的格式字符串
   */
  create(typ,obj){
    // 如果没有obj，给空对象
    if(!obj) obj={};
    // json必须是字典
    if(etools.etype(obj)!=='dict') throw new Error('obj is not Dict');
    // 预备proto格式
    const protoObj=this._root.lookupType(typ);
    // 返回创建的mid对象
    return protoObj.create(obj);
  }

  encode(protoMid){
    // 获取原型类型
    const typ=protoMid.$type.name;
    // 预备proto格式
    const protoObj=this._root.lookupType(typ);
    // 取得流并反馈
    return [typ,protoObj.encode(protoMid).finish()];
  }

  decode(typ,buf){
    // 预备proto格式
    const protoObj=this._root.lookupType(typ);
    // 解析并反馈
    return protoObj.decode(buf);
  }

  // 后端同步添加proto文件用
  addProtoFile(filepath){
    this._root.loadSync(filepath);
  }

  // 前端添加json对象
  addJson(json){
    this._root.addJSON(json)
  }

  lookupType(typ){
    return this._root.lookupType(typ);
  }

  // 工具函数
  midToJson(mid){
    // 数组最优先处理
    if(Array.isArray(mid)) return mid.map(i=>{return this.midToJson(i)});

    // 获取typ
    const typ=typeof mid;
    // 对象，需详细分类处理
    if(typ==='object'){
      // null，反馈空
      if(typ===null) return;

      // Long类型
      if(typeof mid.unsigned==='boolean') return mid.toNumber();

      // 子类别
      const dict={};
      for(const key in mid){
        if(!mid.hasOwnProperty(key)) continue;
        dict[key]=this.midToJson(mid[key]);
      }
      return dict;
    }
    // 其他，直接反馈
    else return mid;
  }
}
const protoWork=new c_protoWork(protoBuf);

module.exports=protoWork;