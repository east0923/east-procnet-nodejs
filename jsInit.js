const path =require('path');
const fs   =require('fs');
const clone=require('clone');

const init={
    index(){
        // 不能两次运行
        if(process.gl) throw new Error('index Cannot Init Twice');
        // 初始化全局对象并写入
        const gl=process.gl={
            conf:{},   // 运行配置参数
            serv:null, // 本地微服务实例
            func:{},   // 本服务方法
        };
        // 初始化插件存储，key为fullname
        process.jsMem={};
        // 初始化计划任务，key为fullname
        process.jsTask={};
        setInterval(()=>{
            for(const key in process.jsTask){
                if(!process.jsTask.hasOwnProperty(key)) continue;

                // 取出任务对象
                const taskObj=process.jsTask[key];

                // 秒循环方式
                if(taskObj.secLoop){
                    // 倒计时复位
                    if(!taskObj._lastSec||taskObj._lastSec<0) taskObj._lastSec=taskObj.secLoop;
                    // 倒计时递减
                    taskObj._lastSec--;
                    // 如果倒计时为0，触发方法
                    if(taskObj._lastSec===0) taskObj.func();
                }
            }
        },1000);

        return gl
    },
    addon_base(fullname){
        // 分离文件名
        const _fstart=Math.max(
            fullname.lastIndexOf('\\'), // Windows系统路径格式
            fullname.lastIndexOf('/')   // Linux系统路径格式
        );
        const _fend  =fullname.lastIndexOf('.');
        const filename=fullname.substr(_fstart+1,_fend-_fstart-1);

        // 判定是否需要初始化存储
        if(!process.jsMem[fullname]) process.jsMem[fullname]={};

        // 返回数组中包含: 全局gl、以fullname标识的mem对象、分离后的文件名
        return [
            process.gl,
            process.jsMem[fullname],
            filename
        ]
    },
    addon_func(fullname,func){
        const [gl,mem,filename]=init.addon_base(fullname);

        gl.func[filename]=func;
        console.log('[jsInit] Func   加载: '+filename);

        return [gl,mem,filename]
    },
    addon_api(fullname,func){
        const [gl,mem,filename]=init.addon_base(fullname);

        if(gl.serv){
            gl.serv.apiReg(filename,func);
            console.log('[jsInit] API    注册: '+filename)
        }
        else {
            console.log('[jsInit] API注册失败，因为没有本地微服务对象 gl.serv: '+filename)
        }

        return [gl,mem,filename]
    },
    addon_task(fullname,func,conf){
        const [gl,mem,filename]=init.addon_base(fullname);
        // 构建任务对象
        const taskObj= Number.isSafeInteger(conf)?
                {secLoop:conf}: // conf给一Int数字，理解为秒循环方式
                clone(conf);    // 克隆配置作为任务对象

        // 记录方法
        taskObj.func=func;

        // 记录配置，即为任务对象taskObj
        process.jsTask[fullname]=taskObj;
    },
    loadAddons(paths,paths_old){
        // 兼容旧版本在第二项给插件相对路径的方式
        if(!Array.isArray(paths)) paths=paths_old;
        // 提取主模块PWD值
        const file=process.mainModule.filename;
        const PWD=file.substr(0,1+Math.max(file.lastIndexOf('\\'),file.lastIndexOf('/')));

        // 遍历插件目录
        paths.forEach(p=>{
            // 生成绝对路径，并判定是否存在，不存在则跳过
            const dirPath=path.resolve(PWD,p);
            if(!fs.existsSync(dirPath)) return;
            // 遍历该路径下所有文件
            fs.readdirSync(dirPath).forEach(filename=>{
                // 分离文件名、扩展名
                const _fend = filename.lastIndexOf('.');
                const name  = filename.substr(0,_fend);
                const ext   = filename.substr(filename.lastIndexOf('.')+1);

                // 如果是js文件，且不以下划线开头，则加载
                if(ext==='js' && name.substr(0,1)!=='_' ){
                    const fullPath=path.resolve(dirPath,filename);
                    require(fullPath);
                }
            });
        });
    }
};

module.exports=init;