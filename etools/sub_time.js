const etools=require('./index');
const time={
  // 输出当前标准时间
  nowLocalStr:function () {
    return time.stamp2fmt(new Date())
  },
  // 输出指定时间戳对应的字符串
  stamp2fmt:(stamp,fmt)=>{
    if(typeof stamp==='number')stamp=new Date(stamp);
    if(!fmt)fmt='yyyy-MM-dd hh:mm:ss';
    const o = {
      "M+": stamp.getMonth() + 1, //月份
      "d+": stamp.getDate(), //日
      "h+": stamp.getHours(), //小时
      "m+": stamp.getMinutes(), //分
      "s+": stamp.getSeconds(), //秒
      "q+": Math.floor((stamp.getMonth() + 3) / 3), //季度
      "S": stamp.getMilliseconds() //毫秒
    };
    if (/(y+)/.test(fmt)) fmt = fmt.replace(RegExp.$1, (stamp.getFullYear() + "").substr(4 - RegExp.$1.length));
    for (const k in o)
      if (new RegExp("(" + k + ")").test(fmt)) fmt = fmt.replace(RegExp.$1, (RegExp.$1.length === 1) ? (o[k]) : (("00" + o[k]).substr(("" + o[k]).length)));
    return fmt
  },
  // 返回指定年份2月的天数
  feburaryDays:function(fullyear){
    if(!etools.isInt(fullyear)) throw new Error('fullyear isnot INT');
    if(fullyear%100===0){
      return (fullyear%400===0)?29:28
    } else {
      return (fullyear%4===0)?29:28
    }
  },
  // 输出日期对象所在的年，周数
  weekNum:function _weekNum(Year,Month,Date,firstDay){
    if(firstDay===undefined)firstDay=0;
    // 输入检查
    if( !etools.isInt(Year)||
      !etools.isInt(Month)||Month<1||Month>12||
      !etools.isInt(Date) ||Date<1 ||Date>31||
      !(firstDay!==0&&firstDay!==1))
      throw new Error('input Year/Month/Date/firstDay Error');

    // 将Date计算为当年的第几天，不能break
    switch (Month-1){
      case 11: Date+=30;
      case 10: Date+=31;
      case  9: Date+=30;
      case  8: Date+=31;
      case  7: Date+=31;
      case  6: Date+=30;
      case  5: Date+=31;
      case  4: Date+=30;
      case  3: Date+=31;
      case  2: Date+=time.feburaryDays(Year);
      case  1: Date+=31;
    }

    const passnum=Math.floor(Date/7); // 已过去的整周数
    const leftday=Date%7; //除去整周的余数
    const day    =(new Date(Year,1,1)).getDay(); // 当年1月1日的星期数

    const ld=(7-day+firstDay)%7; // 上年剩余天数

    // 根据剩余天数和上年剩余天数反馈
    if(leftday>ld) return [Year,passnum+1];
    else if(passnum>0) {
      return [Year,passnum]
    } else {
      return _weekNum(Year-1,12,31)
    }
  }
};

module.exports=time;