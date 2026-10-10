/* =====================================================================
   第五季 · 内容工作台 —— 数据源密钥（免登录，直接粘贴）
   ---------------------------------------------------------------------
   抖音站内爆款数据来自红狐 Hub（第三方接口），需要一个 ak_ 开头的密钥。

   这里刻意做到最简：
     · 不注册、不登录、不建表；
     · 密钥只写进**当前浏览器**的 localStorage，仅采集时传给工作台服务端、不进网页源码；
     · 采集时前端把密钥随请求头 x-redfox-key 透传给工作台服务端，
       服务端只做转发（不落盘、不落库、不写日志），用完即弃。

   代价：换设备 / 换浏览器 / 清缓存后要重新粘贴一次。

   对外接口（挂 window.SecureStore）：
     getKey()         取密钥（未配置返回 ''）
     isConfigured()   是否已配置
     saveKey(raw)     保存（校验格式）
     clearKey()       清除
     masked()         用于界面展示的脱敏串
   ===================================================================== */
(function () {
'use strict';

var LS_KEY = 'wj_redfox_key';

function read(){
  try { return String(localStorage.getItem(LS_KEY) || '').trim(); }
  catch (e) { return ''; }
}

function write(v){
  try { v ? localStorage.setItem(LS_KEY, v) : localStorage.removeItem(LS_KEY); }
  catch (e) { /* 隐私模式 / 存储被禁用时静默降级，本次会话内仍可用 */ }
}

/* 内存兜底：localStorage 写不进去时（无痕模式等），至少本次会话能用 */
var mem = '';

function getKey(){
  var k = read();
  if (!k) k = mem;
  return k || '';
}

function isConfigured(){ return !!getKey(); }

function masked(){
  var k = getKey();
  if (!k) return '';
  return k.slice(0, 5) + '••••••' + k.slice(-2);
}

function saveKey(raw){
  var key = String(raw == null ? '' : raw).trim().replace(/^["']|["']$/g, '');
  if (!key) throw new Error('请先粘贴密钥');
  if (!/^ak_/.test(key)) throw new Error('密钥格式不对（应该以 ak_ 开头）');
  if (!/^[\x21-\x7e]+$/.test(key)) throw new Error('密钥里夹了空格或换行，请检查是否复制完整');
  if (key.length < 20) throw new Error('密钥看起来不完整，请重新复制一次');
  mem = key;
  write(key);
  return key;
}

function clearKey(){
  mem = '';
  write('');
}

window.SecureStore = {
  getKey: getKey,
  isConfigured: isConfigured,
  masked: masked,
  saveKey: saveKey,
  clearKey: clearKey
};
})();
