const procnet=require('../');
const proc=new procnet.clientWs.c_client(null,'ws://localhost:9988/ws');

async function test(){
    let err,params;
    try{
        params=await proc.apiCallAsync('test.test',[]);
    }
    catch (e) {
        err=e;
    }

    debugger
}
setTimeout(test,1000);