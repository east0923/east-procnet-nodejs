/*
* 微服务Redis节点
*
* 运行环境：Nodejs
*
* */

const funcDict=require('./funcDict');

/* ====== 通用连接 ====== */
const c_connRedis=require('./c_connRedis');

/* ====== 客户端类，构建方法可进行必要配置项整理 ====== */
const c_clientCore  = require('./c_clientCore');
class c_client extends c_clientCore{
  constructor(clientConf){
    // 验证id符合后端服务规范，不符合则抛出错误
    if(funcDict.idType(clientConf.id)!=='serv') throw new Error('Redis Service Id Type Error');
    // 创建连接类
    const conn=new c_connRedis.c_subpub(clientConf.redisConf);
    // 构造客户端类
    super(clientConf,conn);
  }
}

/* ====== 输出 ======*/
module.exports={
  c_client,
  protoWork:require('./protoWork'),
  idType:funcDict.idType
};