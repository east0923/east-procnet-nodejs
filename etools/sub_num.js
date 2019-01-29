module.exports={
  // 保留指定长度有效数字
  fmt_yx:(num,len)=>{
    // 非数字不处理
    if(typeof num!=='number') return num;
    // 特殊情况
    if(num==0) return '0';
    // 当前小数点前位数，可能为负，表示小数点后
    const n=Math.floor(Math.log10(Math.abs(num)))+1;
    // 移位，将小数点前保留len长度
    num=num*Math.pow(10,len-n);
    // 四舍五入取整
    num=Math.round(num);
    // 移回
    num=num/Math.pow(10,len-n);
    // 转字符串
    let str=num.toString();
    // 无小数点，或长度不超过8位，可直接反馈
    const p=str.indexOf('.');
    if(p<0||str.length<8) return str;
    // 有小数点，处理尾部的0
    else {
      str=(num+9e-11).toString();
      let i;
      for(i=str.length-3;i>=0;i--) if(str.substr(i,1)!=='0') break;
      return str.substr(0,i+1);
    }
  }
}
