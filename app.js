'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { ChatStore, readJson } = require('./store');

const ROOT = __dirname;
const APP_ID = 'aionshome-chat-viewer';
const runtime = path.join(ROOT, 'runtime');
const stateFile = path.join(runtime, 'server.json');
const config = readJson(path.join(ROOT, 'config.json'));
const args = new Set(process.argv.slice(2));
const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.pdf': 'application/pdf',
};

function openWindow(url) {
  // 使用独立浏览器配置和 app 窗口，不接入 AionsHome 的前端或登录状态。
  const candidates = [
    path.join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env.ProgramFiles || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
  ];
  const browser = candidates.find(p => fs.existsSync(p));
  if (!browser) { console.log(`请在浏览器打开：${url}`); return; }
  const child = spawn(browser, [`--app=${url}`, '--new-window', '--window-size=1220,860', '--no-first-run', `--user-data-dir=${path.join(runtime, 'browser-profile')}`], { detached: true, stdio: 'ignore' });
  child.on('error', () => console.log(`请在浏览器打开：${url}`));
  child.unref();
}

function sendJson(response, payload, status = 200) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(payload));
}

function sendFile(request, response, filename) {
  let stat;
  try { stat = fs.statSync(filename); } catch { response.writeHead(404); response.end('文件不存在'); return; }
  if (!stat.isFile()) { response.writeHead(404); response.end(); return; }
  const headers = { 'Content-Type': types[path.extname(filename).toLowerCase()] || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
  let start = 0;
  let end = stat.size - 1;
  let status = 200;
  if (request.headers.range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
    if (!match || (!match[1] && !match[2])) { response.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); response.end(); return; }
    if (!match[1]) start = Math.max(0, stat.size - Number(match[2]));
    else start = Number(match[1]);
    if (match[1] && match[2]) end = Math.min(end, Number(match[2]));
    if (start > end || start >= stat.size) { response.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); response.end(); return; }
    status = 206;
    headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
  }
  headers['Content-Length'] = Math.max(0, end - start + 1);
  response.writeHead(status, headers);
  if (request.method === 'HEAD' || !stat.size) { response.end(); return; }
  const stream = fs.createReadStream(filename, { start, end });
  stream.on('error', () => response.destroy());
  response.on('close', () => stream.destroy());
  stream.pipe(response);
}

function inside(root, relative) {
  const target = path.resolve(root, relative);
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error('无效的文件地址');
  return target;
}

function resolveMedia(raw) {
  // 原附件 URL 转为本地文件读取，AionsHome 后端关闭时仍能显示本地图片和音视频。
  let url;
  try { url = new URL(raw, 'http://localhost'); } catch { throw new Error('附件地址无效'); }
  const pathname = decodeURIComponent(url.pathname);
  if (pathname.startsWith('/uploads/album/')) return inside(path.join(config.dataDirectory, 'album/images'), pathname.slice(15));
  if (pathname.startsWith('/uploads/')) return inside(path.join(config.dataDirectory, 'uploads'), pathname.slice(9));
  if (pathname.startsWith('/screenshots/')) return inside(path.join(config.dataDirectory, 'screenshots'), pathname.slice(13));
  if (pathname.startsWith('/songs/')) return inside(path.join(config.dataDirectory, 'songs'), pathname.slice(7));
  if (pathname.startsWith('/cr-uploads/')) return inside(path.resolve(config.dataDirectory, '../../Connor-Codex/uploads'), pathname.slice(12));
  if (pathname.startsWith('/public/')) return inside(path.resolve(config.dataDirectory, '../../public'), pathname.slice(8));
  if (pathname.startsWith('/api/chatroom/images/')) return inside(path.join(config.dataDirectory, 'chatroom_images'), pathname.slice(21));
  if (pathname.startsWith('/chatroom_images/')) return inside(path.join(config.dataDirectory, 'chatroom_images'), pathname.slice(17));
  if (pathname.startsWith('/data/uploads/')) return inside(path.join(config.dataDirectory, 'uploads'), pathname.slice(14));
  throw new Error('这份附件不在本地聊天附件目录中');
}

async function existingServer() {
  // 重复双击复用本查看器的进程；实例标识可以避免误连占用同一端口的其他服务。
  const state = readJson(stateFile);
  if (!Number.isInteger(state.port) || state.port < 1024 || state.port > 65535) return null;
  const url = `http://127.0.0.1:${state.port}`;
  try {
    const info = await fetch(url + '/api/info', { signal: AbortSignal.timeout(1500) }).then(r => r.json());
    return info.appId === APP_ID && info.instance === state.instance ? { ...state, url } : null;
  } catch { return null; }
}

async function main() {
  const existing = await existingServer();
  if (args.has('--stop')) {
    if (existing) {
      await fetch(existing.url + '/api/stop', { method: 'POST', headers: { 'X-Viewer-Token': existing.token }, signal: AbortSignal.timeout(3000) });
      console.log('聊天记录查看器已停止。');
    } else console.log('聊天记录查看器没有在运行。');
    return;
  }
  if (existing) {
    if (args.has('--open')) openWindow(existing.url);
    console.log(`查看器已经在运行：${existing.url}`);
    return;
  }
  if (!config.dataDirectory || !fs.existsSync(path.join(config.dataDirectory, 'chat.db'))) {
    throw new Error('找不到聊天数据库，请在 config.json 中设置正确的 dataDirectory。');
  }
  config.dataDirectory = path.resolve(config.dataDirectory);
  const store = new ChatStore(config.dataDirectory);
  const instance = crypto.randomUUID();
  const token = crypto.randomBytes(24).toString('hex');
  const cursor = params => {
    const value = params.get('cursor');
    return value ? JSON.parse(value) : null;
  };
  const server = http.createServer((request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (url.pathname === '/api/stop' && request.method === 'POST') {
        if (request.headers['x-viewer-token'] !== token) { sendJson(response, { error: '无法停止其他程序' }, 403); return; }
        sendJson(response, { ok: true });
        setTimeout(stop, 50);
        return;
      }
      if (!['GET', 'HEAD'].includes(request.method)) { sendJson(response, { error: '查看器只读取记录' }, 405); return; }
      if (url.pathname === '/api/info') { sendJson(response, { appId: APP_ID, instance, ...store.info() }); return; }
      if (url.pathname === '/api/conversations') { sendJson(response, { items: store.conversations() }); return; }
      if (url.pathname === '/api/messages') {
        sendJson(response, store.messages({ source: url.searchParams.get('source'), id: url.searchParams.get('id'), anchor: url.searchParams.get('anchor'), direction: url.searchParams.get('direction'), cursor: cursor(url.searchParams), position: url.searchParams.get('position') || 'latest' }));
        return;
      }
      if (url.pathname === '/api/search') {
        sendJson(response, store.search({ query: url.searchParams.get('q'), kind: url.searchParams.get('kind'), source: url.searchParams.get('source'), id: url.searchParams.get('id'), cursor: cursor(url.searchParams) }));
        return;
      }
      if (url.pathname === '/api/media') { sendFile(request, response, resolveMedia(url.searchParams.get('url') || '')); return; }
      const assets = { '/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css', '/icon.svg': 'icon.svg' };
      if (assets[url.pathname]) { sendFile(request, response, path.join(ROOT, 'public', assets[url.pathname])); return; }
      response.writeHead(404); response.end('页面不存在');
    } catch (error) { sendJson(response, { error: error.message || '读取失败，请稍后重试' }, 400); }
  });
  let stopped = false;
  function cleanup() {
    try { if (readJson(stateFile).instance === instance) fs.unlinkSync(stateFile); } catch {}
    try { store.close(); } catch {}
  }
  function stop() {
    if (stopped) return;
    stopped = true;
    server.close(() => { cleanup(); process.exit(0); });
    server.closeIdleConnections();
    setTimeout(() => { cleanup(); process.exit(0); }, 1500).unref();
  }
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  process.on('exit', cleanup);
  const preferred = Number(config.port) || 4328;
  // 只监听本机；自己的端口冲突时换一个空闲端口，不重启或停止现有服务。
  for (let port = preferred; port < preferred + 10; port++) {
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
      });
      fs.mkdirSync(runtime, { recursive: true });
      fs.writeFileSync(stateFile, JSON.stringify({ port, pid: process.pid, instance, token }));
      const address = `http://127.0.0.1:${port}`;
      console.log(`聊天记录查看器已启动：${address}\n关闭这个窗口即可停止查看器。`);
      if (args.has('--open')) openWindow(address);
      return;
    } catch (error) { if (error.code !== 'EADDRINUSE') throw error; }
  }
  throw new Error('启动端口正在使用，请调整 config.json 中的 port。');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
