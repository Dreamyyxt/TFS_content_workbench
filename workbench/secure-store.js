/* =====================================================================
   第五季 · 内容工作台 —— 密钥存储（免登录，直接粘贴）
   ---------------------------------------------------------------------
   这里管两把密钥，都只写进**当前浏览器**的 localStorage：
     · 数据源 / 抖音 + 小红书站内作品 —— 红狐 Hub（第三方接口），ak_ 开头
       → localStorage['wj_redfox_key']
     · 视频制作 / AI 生成 —— 火山方舟（Ark）API Key
       → localStorage['wj_ark_key']

   共同点：不注册、不登录、不建表；不进网页源码；用时随请求头透传给服务端，
   服务端只在该次调用里用，不落盘、不落库、不写日志。
   代价：换设备 / 换浏览器 / 清缓存后要重新粘贴一次。
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

/* ---- 火山方舟（视频制作 · AI 生成）-------------------------------------
   火山 API Key 没有固定前缀，所以只做「非空 / 无空白字符 / 长度合理」的宽松校验；
   是否真的可用，交给服务端调火山 /models 探测后再告诉用户。
   命中优先级在服务端：页面粘贴 > ARK_API_KEY 环境变量 > ~/.workbuddy/volc_mediakit.key，
   所以没配这个也不影响原本在本机放 key 文件的用法。 --------------------- */
var LS_ARK = 'wj_ark_key';
var memArk = '';

function readArk(){
  try { return String(localStorage.getItem(LS_ARK) || '').trim(); }
  catch (e) { return ''; }
}

function writeArk(v){
  try { v ? localStorage.setItem(LS_ARK, v) : localStorage.removeItem(LS_ARK); }
  catch (e) { /* 隐私模式 / 存储被禁用时静默降级，本次会话内仍可用 */ }
}

function getArkKey(){
  var k = readArk();
  if (!k) k = memArk;
  return k || '';
}

function isArkConfigured(){ return !!getArkKey(); }

function maskedArk(){
  var k = getArkKey();
  if (!k) return '';
  return k.length > 12 ? (k.slice(0, 4) + '••••••' + k.slice(-4)) : (k.slice(0, 2) + '••••');
}

function saveArkKey(raw){
  var key = String(raw == null ? '' : raw).trim().replace(/^["']|["']$/g, '');
  if (!key) throw new Error('请先粘贴火山方舟 API Key');
  if (!/^[\x21-\x7e]+$/.test(key)) throw new Error('密钥里夹了空格或换行，请检查是否复制完整');
  if (key.length < 16) throw new Error('密钥看起来不完整，请重新复制一次');
  memArk = key;
  writeArk(key);
  return key;
}

function clearArkKey(){
  memArk = '';
  writeArk('');
}

window.SecureStore = {
  getKey: getKey,
  isConfigured: isConfigured,
  masked: masked,
  saveKey: saveKey,
  clearKey: clearKey,
  getArkKey: getArkKey,
  isArkConfigured: isArkConfigured,
  maskedArk: maskedArk,
  saveArkKey: saveArkKey,
  clearArkKey: clearArkKey
};
})();
