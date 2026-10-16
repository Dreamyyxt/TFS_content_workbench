'use strict';
/* =====================================================================
   可信来源判定（本机服务 / 工作台共用）
   ---------------------------------------------------------------------
   背景：制作服务（4191）原本只接受「Host 是 localhost / 127.0.0.1」的网页调用，
        因为它的能力很重（能烧火山额度、能往磁盘写文件）。
   远程访问方案（Tailscale / 自建域名反代）需要在不拆掉「服务只听回环」这条底线的
        前提下，多认一个域名 —— 就靠这里显式授权的主机名。

   判定规则（三者之一即可）：
     ① 来源就是已发布的线上工作台（webOrigin）
     ② 来源与本次请求同源（页面由本机服务自己出具：回环 / 局域网 / 远程域名都覆盖）
     ③ 来源主机名在显式授权名单里（反代改写了 Host 时兜底）
   授权名单只放宽「谁能连」，不放宽「谁能调」—— 每个接口仍要 Bearer token。
   ===================================================================== */

const LOCAL_HOSTNAMES = ['localhost', '127.0.0.1'];

/* 'a.ts.net, b.example.com' → ['a.ts.net','b.example.com'] */
function parseHosts(value) {
  return String(value || '').split(',').map(h => h.trim().toLowerCase()).filter(Boolean);
}

function createAccessPolicy(trustedHosts) {
  const extra = (Array.isArray(trustedHosts) ? trustedHosts : parseHosts(trustedHosts))
    .map(h => String(h || '').trim().toLowerCase()).filter(Boolean);
  const trusted = new Set([...LOCAL_HOSTNAMES, ...extra]);
  return {
    extra: extra.slice(),
    /* 主机名是否可信（空 / 缺省视为可信，由调用点自行决定要不要拦） */
    trustedHost(host) {
      const h = String(host || '').toLowerCase();
      return !h || trusted.has(h);
    },
    /* 'https://a.ts.net:443' → 'a.ts.net'；解析失败返回 '' */
    hostOf(origin) {
      try { return new URL(String(origin)).hostname.toLowerCase(); } catch (e) { return ''; }
    },
    /* 网页来源是否可以连接本机服务 */
    knownOrigin(origin, requestHost, webOrigin) {
      if (!origin) return true;
      if (webOrigin && origin === webOrigin) return true;
      const h = this.hostOf(origin);
      return !!h && (h === String(requestHost || '').toLowerCase() || trusted.has(h));
    },
  };
}

module.exports = { LOCAL_HOSTNAMES, parseHosts, createAccessPolicy };
