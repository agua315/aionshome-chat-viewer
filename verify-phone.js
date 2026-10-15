'use strict';

// 轻量检查手机登录和地址分类，不读取真实聊天，也不改系统网络配置。
const assert = require('node:assert/strict');
const { PhoneAccess, isLocalClient } = require('./phone-access');
const local = { socket: { remoteAddress: '127.0.0.1' }, headers: {} };
const remote = { socket: { remoteAddress: '192.168.1.2' }, headers: {} };
const access = new PhoneAccess('unused-test-config', { phoneAccess: { enabled: true, code: '12345678', secret: 'a'.repeat(64) } });
assert(isLocalClient(local));
assert(!isLocalClient(remote));
assert(access.authorized(local));
assert(!access.authorized(remote));
assert.throws(() => access.login(remote, '00000000'), error => error.status === 403);
const cookie = access.login(remote, '12345678');
assert(cookie.includes('HttpOnly') && cookie.includes('SameSite=Strict'));
assert(access.authorized({ ...remote, headers: { cookie } }));
assert(!access.authorized({ ...remote, headers: { cookie: cookie.replace('chat_viewer_phone=', 'chat_viewer_phone=x') } }));
const noPhone = new PhoneAccess('unused-test-config', {});
assert(noPhone.authorized(local));
assert(!noPhone.authorized(remote));
// 使用虚构网卡地址，验证不依赖当前电脑的 Wi-Fi 或 Tailscale 地址。
const addresses = access.addresses(4328, {
  WLAN: [{ family: 'IPv4', internal: false, address: '192.168.1.20' }],
  Tailscale: [{ family: 'IPv4', internal: false, address: '100.100.10.20' }],
  'vEthernet (WSL)': [{ family: 'IPv4', internal: false, address: '192.168.96.1' }],
  Loopback: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
});
assert.deepEqual(addresses.wifi.map(item => item.url), ['http://192.168.1.20:4328/']);
assert.deepEqual(addresses.tailscale.map(item => item.url), ['http://100.100.10.20:4328/']);
console.log('通过：本机访问、手机访问码和登录记忆；Wi-Fi/Tailscale 地址；过滤虚拟网卡。');
