'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { Worker } = require('node:worker_threads');
const { ChatStore, readJson } = require('./store');
const { saveBackupPreferences, normalizeDisplayPreferences, saveDisplayPreferences } = require('./preferences');
const { chooseFolder, closeFolderPicker } = require('./folder-picker');
const { PhoneAccess, isLocalClient } = require('./phone-access');
const { normalize: normalizeAppearance } = require('./public/appearance-config');
const { saveAppearancePreferences, saveBackground, backgroundFile } = require('./appearance-store');
const { collectExport, summarizeExport } = require('./export-data');
const { FORMATS, pdfBrowser } = require('./export-files');

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

async function readRequestJson(request, maximum = 2 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximum) throw new Error('内容过长，请缩短后再保存');
    chunks.push(chunk);
  }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('无法读取编辑内容，请重新保存'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('编辑内容格式不正确');
  return body;
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
  const phoneAccess = new PhoneAccess(path.join(ROOT, 'config.json'), config);
  const store = new ChatStore(config.dataDirectory, { backupDirectory: config.backupDirectory, backupEnabled: config.backupEnabled });
  let displaySettings = normalizeDisplayPreferences(config.displaySettings);
  let appearanceSettings = normalizeAppearance(config.appearanceSettings);
  let exporting = false;
  const instance = crypto.randomUUID();
  const token = crypto.randomBytes(24).toString('hex');
  const cursor = params => {
    const value = params.get('cursor');
    return value ? JSON.parse(value) : null;
  };
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (request.method === 'POST' && request.headers.origin && request.headers.origin !== `http://${request.headers.host}`) {
        sendJson(response, { error: '请从查看器自己的页面进行操作' }, 403); return;
      }
      if (url.pathname === '/api/login' && request.method === 'POST') {
        const body = await readRequestJson(request);
        response.setHeader('Set-Cookie', phoneAccess.login(request, body.code));
        sendJson(response, { ok: true }); return;
      }
      if (url.pathname === '/api/logout' && request.method === 'POST') {
        response.setHeader('Set-Cookie', phoneAccess.logoutCookie()); sendJson(response, { ok: true }); return;
      }
      if (!phoneAccess.authorized(request)) {
        // 未登录的网络访问只提供登录页面和其静态资源，不返回聊天记录、头像或附件。
        const loginAssets = { '/style.css': 'style.css', '/icon.svg': 'icon.svg', '/login.js': 'login.js' };
        if (['GET', 'HEAD'].includes(request.method) && url.pathname === '/') sendFile(request, response, path.join(ROOT, 'public/login.html'));
        else if (['GET', 'HEAD'].includes(request.method) && loginAssets[url.pathname]) sendFile(request, response, path.join(ROOT, 'public', loginAssets[url.pathname]));
        else sendJson(response, { error: '请先输入手机访问码', loginRequired: true }, 401);
        return;
      }
      if (url.pathname === '/api/phone-access') {
        if (!isLocalClient(request)) { sendJson(response, { error: '请在电脑上查看手机连接信息' }, 403); return; }
        sendJson(response, { ...phoneAccess.addresses(server.address().port), code: phoneAccess.code || '' }); return;
      }
      if (url.pathname === '/api/stop' && request.method === 'POST') {
        if (!isLocalClient(request)) { sendJson(response, { error: '请在电脑上停止查看器' }, 403); return; }
        if (request.headers['x-viewer-token'] !== token) { sendJson(response, { error: '无法停止其他程序' }, 403); return; }
        sendJson(response, { ok: true });
        setTimeout(stop, 50);
        return;
      }
      if (url.pathname === '/api/messages/edit' && request.method === 'POST') {
        // 本机查看器的页面取得实例令牌后才可保存，普通网页不能代替用户修改记录。
        if (request.headers['x-viewer-token'] !== token) { sendJson(response, { error: '查看器已重新启动，请刷新页面后再保存' }, 403); return; }
        const body = await readRequestJson(request);
        sendJson(response, store.updateMessage(body));
        return;
      }
      if (url.pathname === '/api/cards/messages' && request.method === 'POST') {
        if (request.headers['x-viewer-token'] !== token) { sendJson(response, { error: '查看器已重新启动，请刷新后再制作卡片' }, 403); return; }
        const body = await readRequestJson(request, 8 * 1024 * 1024);
        // 只读取得被勾选消息的正文；卡片里的删改只作用于图片，不回写聊天记录。
        const document = collectExport(store, { scope: 'selected', selections: body.selections });
        sendJson(response, { names: document.names, groups: document.groups.map(group => ({ source: group.source, id: group.id, title: group.title, messages: group.messages.map(message => ({ id: message.id, speaker: message.speaker, content: message.content, attachments: message.attachments, created_at: message.created_at, chapter_number: message.chapter_number, chapter_title: message.chapter_title })) })) });
        return;
      }
      if (['/api/export/preview', '/api/export'].includes(url.pathname) && request.method === 'POST') {
        if (request.headers['x-viewer-token'] !== token) { sendJson(response, { error: '查看器已重新启动，请刷新后再导出' }, 403); return; }
        const body = await readRequestJson(request, 8 * 1024 * 1024);
        const document = collectExport(store, body);
        if (url.pathname.endsWith('/preview')) { sendJson(response, summarizeExport(document)); return; }
        if (!FORMATS[body.format]) throw new Error('请选择有效的导出格式');
        if (exporting) { sendJson(response, { error: '正在生成另一份文件，请等它完成后再导出' }, 409); return; }
        // 仅把记录中出现的附件通过原有目录规则解析，工作线程不接受任意文件路径。
        const mediaPaths = {};
        const addMedia = raw => { if (typeof raw === 'string' && raw.startsWith('/')) { try { mediaPaths[raw] = resolveMedia(raw); } catch {} } };
        for (const group of document.groups) for (const message of group.messages) {
          for (const match of message.content.matchAll(/\[\[image:([^\]]+)\]\]|!\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) addMedia(match[1] || match[2]);
          for (const image of message.illustrations || []) addMedia(image.url);
          for (const attachment of message.attachments || []) if (attachment) addMedia(attachment.url || attachment.path || attachment.image_url || attachment.audio_url || attachment.video_url);
        }
        exporting = true;
        try {
          const result = await new Promise((resolve, reject) => {
            const worker = new Worker(path.join(ROOT, 'export-worker.js'), { workerData: { root: ROOT, dataDirectory: config.dataDirectory, input: body, mediaPaths } });
            worker.once('message', result => result.error ? reject(new Error(result.error)) : resolve(result));
            worker.once('error', reject);
            worker.once('exit', code => { if (code) reject(new Error('导出任务意外退出，请缩小范围重试')); });
          });
          if (response.destroyed) return;
          response.writeHead(200, { 'Content-Type': result.mime, 'Content-Length': result.data.length, 'Content-Disposition': `attachment; filename="chat-export.${body.format}"; filename*=UTF-8''${encodeURIComponent(result.filename)}`, 'Cache-Control': 'no-store', 'X-Export-Warnings': encodeURIComponent(result.warnings.join('；')) });
          response.end(Buffer.from(result.data));
        } finally { exporting = false; }
        return;
      }
      if (url.pathname === '/api/appearance/background' && request.method === 'POST') {
        if (request.headers['x-viewer-token'] !== token) { sendJson(response, { error: '查看器已重新启动，请刷新页面后再上传' }, 403); return; }
        const chunks = [];
        let size = 0;
        for await (const chunk of request) {
          size += chunk.length;
          if (size > 20 * 1024 * 1024) throw new Error('背景图片请选择 20 MB 以内的文件');
          chunks.push(chunk);
        }
        sendJson(response, { image: saveBackground(ROOT, Buffer.concat(chunks)) });
        return;
      }
      if (url.pathname === '/api/settings/appearance' && request.method === 'POST') {
        if (request.headers['x-viewer-token'] !== token) { sendJson(response, { error: '查看器已重新启动，请刷新页面后再保存外观' }, 403); return; }
        appearanceSettings = saveAppearancePreferences(path.join(ROOT, 'config.json'), config, await readRequestJson(request, 8 * 1024 * 1024));
        sendJson(response, { appearanceSettings });
        return;
      }
      if (['/api/settings/backup', '/api/settings/choose-folder', '/api/settings/display'].includes(url.pathname) && request.method === 'POST') {
        if (request.headers['x-viewer-token'] !== token) { sendJson(response, { error: '查看器已重新启动，请刷新页面后再保存设置' }, 403); return; }
        const body = await readRequestJson(request);
        if (url.pathname.endsWith('/display')) {
          displaySettings = saveDisplayPreferences(path.join(ROOT, 'config.json'), config, body);
          sendJson(response, { displaySettings });
        } else if (url.pathname.endsWith('/choose-folder')) {
          if (!isLocalClient(request)) { sendJson(response, { error: '请在电脑上选择存档文件夹' }, 403); return; }
          const directory = await chooseFolder(typeof body.directory === 'string' ? body.directory : store.backupDirectory);
          sendJson(response, { directory });
        } else {
          const settings = saveBackupPreferences(path.join(ROOT, 'config.json'), config, body);
          store.setBackupSettings(settings);
          sendJson(response, { backupSettings: settings });
        }
        return;
      }
      if (!['GET', 'HEAD'].includes(request.method)) { sendJson(response, { error: '不支持这个操作' }, 405); return; }
      if (url.pathname === '/api/info') { sendJson(response, { appId: APP_ID, instance, editToken: token, localClient: isLocalClient(request), phoneEnabled: phoneAccess.enabled, backupSettings: store.backupSettings(), displaySettings, appearanceSettings, exportPdfAvailable: !!pdfBrowser(), ...store.info() }); return; }
      if (url.pathname === '/api/conversations') { sendJson(response, { items: store.conversations() }); return; }
      if (url.pathname === '/api/messages') {
        sendJson(response, store.messages({ source: url.searchParams.get('source'), id: url.searchParams.get('id'), anchor: url.searchParams.get('anchor'), direction: url.searchParams.get('direction'), cursor: cursor(url.searchParams), position: url.searchParams.get('position') || 'latest', hideSystemMessages: url.searchParams.get('hideSystemMessages') === 'true' }));
        return;
      }
      if (url.pathname === '/api/search') {
        sendJson(response, store.search({ query: url.searchParams.get('q'), kind: url.searchParams.get('kind'), source: url.searchParams.get('source'), id: url.searchParams.get('id'), cursor: cursor(url.searchParams), hideSystemMessages: url.searchParams.get('hideSystemMessages') === 'true' }));
        return;
      }
      if (url.pathname === '/api/media') { sendFile(request, response, resolveMedia(url.searchParams.get('url') || '')); return; }
      if (url.pathname.startsWith('/api/appearance/background/')) { sendFile(request, response, backgroundFile(ROOT, url.pathname)); return; }
      const appearanceAssets = { '/appearance-config.js': 'appearance-config.js', '/appearance.js': 'appearance.js', '/appearance.css': 'appearance.css' };
      if (appearanceAssets[url.pathname]) { sendFile(request, response, path.join(ROOT, 'public', appearanceAssets[url.pathname])); return; }
      const assets = { '/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css', '/cards.js': 'cards.js', '/cards.css': 'cards.css', '/cards-mosaic.js': 'cards-mosaic.js', '/cards-mosaic-ui.js': 'cards-mosaic-ui.js', '/cards-layout.js': 'cards-layout.js', '/cards-renderer.js': 'cards-renderer.js', '/export.js': 'export.js', '/export.css': 'export.css', '/mobile.css': 'mobile.css', '/theater.css': 'theater.css', '/icon.svg': 'icon.svg', '/markdown.js': 'markdown.js', '/message-display.js': 'message-display.js', '/vendor/markdown-it-15.0.1.min.js': 'vendor/markdown-it-15.0.1.min.js' };
      if (assets[url.pathname]) { sendFile(request, response, path.join(ROOT, 'public', assets[url.pathname])); return; }
      response.writeHead(404); response.end('页面不存在');
    } catch (error) { sendJson(response, { error: error.message || '操作失败，请稍后重试' }, error.status || 400); }
  });
  let stopped = false;
  function cleanup() {
    closeFolderPicker();
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
  // 手机访问使用固定端口，避免手机收藏的地址因自动换端口而失效。
  for (let port = preferred; port < preferred + (phoneAccess.enabled ? 1 : 10); port++) {
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, phoneAccess.enabled ? '0.0.0.0' : '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
      });
      fs.mkdirSync(runtime, { recursive: true });
      fs.writeFileSync(stateFile, JSON.stringify({ port, pid: process.pid, instance, token }));
      const address = `http://127.0.0.1:${port}`;
      console.log(`聊天记录查看器已启动：${address}\n关闭这个窗口即可停止查看器。`);
      if (phoneAccess.enabled) {
        const addresses = phoneAccess.addresses(port);
        for (const item of addresses.wifi) console.log(`同一 Wi-Fi：${item.url}`);
        for (const item of addresses.tailscale) console.log(`Tailscale：${item.url}`);
        console.log('手机访问码请在电脑窗口的“手机访问”中查看。');
      }
      if (args.has('--open')) openWindow(address);
      return;
    } catch (error) { if (error.code !== 'EADDRINUSE') throw error; }
  }
  throw new Error('启动端口正在使用，请调整 config.json 中的 port。');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
