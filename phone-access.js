'use strict';

const crypto = require('node:crypto');
const os = require('node:os');
const { writePreferences } = require('./preferences');
const SESSION_COOKIE = 'chat_viewer_phone';
const SESSION_SECONDS = 30 * 24 * 60 * 60;

function isLocalClient(request) {
  const address = request.socket?.remoteAddress || '';
  return address === '::1' || /^(?:::ffff:)?127\./.test(address);
}

function equalSecret(left, right) {
  const a = Buffer.from(String(left)), b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

class PhoneAccess {
  constructor(filename, config) {
    const current = config.phoneAccess || {};
    this.enabled = current.enabled === true;
    if (!this.enabled) return;
    // 每份本机配置有自己的访问码和签名密钥，源码仓库不包含这些字段。
    const settings = { enabled: true, code: /^\d{8}$/.test(current.code || '') ? current.code : String(crypto.randomInt(10000000, 100000000)), secret: /^[a-f0-9]{64}$/.test(current.secret || '') ? current.secret : crypto.randomBytes(32).toString('hex') };
    if (settings.code !== current.code || settings.secret !== current.secret) writePreferences(filename, config, { phoneAccess: settings });
    this.code = settings.code;
    this.secret = settings.secret;
    this.failures = new Map();
  }

  sign(payload) { return crypto.createHmac('sha256', this.secret).update(payload).digest('base64url'); }

  authorized(request) {
    if (isLocalClient(request)) return true;
    if (!this.enabled) return false;
    const value = String(request.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(SESSION_COOKIE + '='))?.slice(SESSION_COOKIE.length + 1);
    if (!value || value.length > 300) return false;
    const [payload, signature, extra] = value.split('.');
    if (!payload || !signature || extra || !equalSecret(signature, this.sign(payload))) return false;
    try { return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).expires > Date.now(); }
    catch { return false; }
  }

  login(request, code) {
    if (!this.enabled) throw new Error('当前未开启手机访问');
    const address = request.socket?.remoteAddress || '';
    const failed = this.failures.get(address);
    if (failed && failed.until > Date.now() && failed.count >= 10) {
      const error = new Error('访问码错误次数较多，请五分钟后重试'); error.status = 429; throw error;
    }
    if (!equalSecret(String(code || '').replace(/\s/g, ''), this.code)) {
      this.failures.set(address, { count: failed?.until > Date.now() ? failed.count + 1 : 1, until: Date.now() + 5 * 60 * 1000 });
      const error = new Error('访问码不正确，请查看电脑上的“手机访问”'); error.status = 403; throw error;
    }
    this.failures.delete(address);
    const payload = Buffer.from(JSON.stringify({ expires: Date.now() + SESSION_SECONDS * 1000, nonce: crypto.randomBytes(12).toString('hex') })).toString('base64url');
    return `${SESSION_COOKIE}=${payload}.${this.sign(payload)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}`;
  }

  logoutCookie() { return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`; }

  addresses(port, interfaces = os.networkInterfaces()) {
    const wifi = [], tailscale = [];
    if (this.enabled) for (const [name, entries] of Object.entries(interfaces)) for (const entry of entries || []) {
      if (entry.internal || !['IPv4', 4].includes(entry.family)) continue;
      const address = entry.address;
      const octets = address.split('.').map(Number);
      const item = { interface: name, url: `http://${address}:${port}/` };
      if (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127 && /tailscale/i.test(name)) tailscale.push(item);
      else if ((octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168)) && !/vEthernet|virtual|WSL|docker|Hyper-V|VPN/i.test(name)) wifi.push(item);
    }
    wifi.sort((a, b) => Number(/WLAN|Wi-?Fi|Wireless|无线/i.test(b.interface)) - Number(/WLAN|Wi-?Fi|Wireless|无线/i.test(a.interface)));
    return { enabled: this.enabled, wifi, tailscale };
  }
}

module.exports = { PhoneAccess, isLocalClient };
