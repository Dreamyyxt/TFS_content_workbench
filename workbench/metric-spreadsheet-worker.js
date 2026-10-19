'use strict';
importScripts('./vendor/xlsx-0.20.3.min.js','./metric-spreadsheet.js');
onmessage=event=>{
  try{postMessage({ok:true,result:MetricSpreadsheet.parse(event.data,XLSX)});}
  catch(e){postMessage({ok:false,error:e.message||'无法读取表格，请重新导出 .xlsx'});}
};
