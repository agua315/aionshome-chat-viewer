'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const JSZip = require('./vendor/jszip.cjs');
const MarkdownIt = require('./public/vendor/markdown-it-15.0.1.min.js');
const markdown = require('./public/markdown');
const display = require('./public/message-display');
const parser = new MarkdownIt({ html: false, breaks: true });

const FORMATS = {
  txt: { mime: 'text/plain; charset=utf-8', label: '纯文本' },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', label: 'Word 文档' },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', label: 'PowerPoint' },
  epub: { mime: 'application/epub+zip', label: 'EPUB 电子书' },
  pdf: { mime: 'application/pdf', label: 'PDF 文档' },
};
const clean = value => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '');
const escape = value => markdown.escapeHtml(clean(value));
const timestamp = value => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'medium', hour12: false }).format(new Date(value * 1000));
const nameOf = (speaker, names) => ({ user: names.user, assistant: names.aion, aion: names.aion, connor: names.connor, system: '系统', cam_user: '监控操作', cam_log: '监控记录', cam_trigger: '监控触发' })[speaker] || speaker;
const chapterName = message => `第 ${message.chapter_number} 章${message.chapter_title ? ' · ' + message.chapter_title : ''}`;

function pdfBrowser() {
  return [
    path.join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env.ProgramFiles || 'C:/Program Files', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env.ProgramFiles || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
  ].find(filename => fs.existsSync(filename)) || null;
}

// 文档和幻灯片直接使用原始图片的宽高，避免插图被压扁。
function imageInfo(buffer, extension) {
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { type: 'png', width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  if (buffer.length >= 10 && buffer.toString('ascii', 0, 3) === 'GIF') return { type: 'gif', width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  if (buffer[0] === 255 && buffer[1] === 216) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 255) { offset++; continue; }
      const marker = buffer[offset + 1];
      if (marker === 216 || marker === 217) { offset += 2; continue; }
      const length = buffer.readUInt16BE(offset + 2);
      if (length < 2) break;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) return { type: 'jpg', width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
      offset += length + 2;
    }
  }
  return { type: extension.replace('.', '').replace('jpeg', 'jpg'), width: 800, height: 600 };
}

function prepareDocument(document, resolveMedia, { embedImages = true } = {}) {
  const warnings = new Set();
  const images = new Map();
  function imageBlock(raw, attachment, speaker) {
    raw = String(raw || '');
    if (!document.options.includeMonitor && display.isMonitorScreenshot(raw, attachment, speaker)) return { type: 'text', text: '［监控截图未导出］' };
    // TXT 只保留图片地址，不读取图片字节；整窗导出大量照片时也保持轻量。
    if (!embedImages) return { type: 'text', text: `［图片：${raw}］` };
    if (!document.options.includeImages) return { type: 'text', text: '［图片未导出］' };
    if (images.has(raw)) return images.get(raw);
    // 不下载外部图片，导出在原服务关闭时仍可工作；缺失附件保留提示而不删正文。
    try {
      if (!raw.startsWith('/')) throw new Error('外部图片');
      const filename = resolveMedia(raw);
      const stat = fs.statSync(filename);
      if (stat.size > 20 * 1024 * 1024) throw new Error('图片过大');
      const data = fs.readFileSync(filename);
      const info = imageInfo(data, path.extname(filename).toLowerCase());
      if (!['png', 'jpg', 'gif', 'webp', 'avif'].includes(info.type)) throw new Error('不是支持的图片');
      const block = { ...info, type: 'image', imageType: info.type, data, raw, filename: `image-${images.size + 1}.${info.type}`, caption: attachment?.name || '聊天插图' };
      block.mime = info.type === 'jpg' ? 'image/jpeg' : `image/${info.type}`;
      images.set(raw, block);
      return block;
    } catch {
      warnings.add('部分图片不可用，已在文件中保留提示');
      const block = { type: 'text', text: `［图片不可用：${raw}］` };
      images.set(raw, block);
      return block;
    }
  }
  const groups = document.groups.map(group => ({ ...group, entries: group.messages.map(message => {
    let content = clean(message.content);
    if (group.source === 'theater') {
      const characters = Array.from(content);
      let start = 0, result = '';
      const illustrations = (message.illustrations || []).filter(image => !image.url.includes(']')).map(image => ({ ...image, after: Number.isInteger(image.after) ? Math.max(0, Math.min(characters.length, image.after)) : characters.length })).sort((a, b) => a.after - b.after);
      for (const image of illustrations) {
        result += characters.slice(start, image.after).join('') + `\n\n[[image:${image.url}]]\n\n`;
        start = image.after;
      }
      content = result + characters.slice(start).join('');
    }
    const blocks = [];
    // 普通 Markdown 图片和 AionsHome 图片标记都转为独立图片块。
    const expression = /\[\[image:([^\]]+)\]\]|!\[([^\]]*)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g;
    let offset = 0;
    for (const match of content.matchAll(expression)) {
      if (match.index > offset) blocks.push({ type: 'text', text: content.slice(offset, match.index) });
      blocks.push(imageBlock(match[1] || match[3], null, message.speaker));
      offset = match.index + match[0].length;
    }
    if (offset < content.length) blocks.push({ type: 'text', text: content.slice(offset) });
    for (const attachment of message.attachments || []) {
      if (!attachment || typeof attachment !== 'object') continue;
      const band = display.bandNote(attachment);
      if (band) { blocks.push({ type: 'text', text: `［${band.title}］${band.text}` }); continue; }
      if (attachment.type === 'pat') {
        if (!content) blocks.push({ type: 'text', text: `${nameOf(attachment.actor || 'system', document.names)} ${attachment.action || '拍了拍'} ${nameOf(attachment.target || '', document.names)}${attachment.suffix || ''}` });
        continue;
      }
      const raw = attachment.url || attachment.path || attachment.image_url || attachment.audio_url || attachment.video_url;
      const type = String(attachment.type || attachment.mime_type || attachment.mime || '').toLowerCase();
      if (raw && (type.startsWith('image') || type === 'monitor_camera_snapshot' || /\.(png|jpe?g|gif|webp|avif)(?:[?#]|$)/i.test(raw))) blocks.push(imageBlock(raw, attachment, message.speaker));
      else if (raw) blocks.push({ type: 'text', text: `［附件：${attachment.title || attachment.name || type || '音视频/文件'}］${raw}` });
      const text = attachment.transcript || attachment.transcription || attachment.text || attachment.note || attachment.label || attachment.summary;
      if (text) blocks.push({ type: 'text', text: clean(text) });
      else if (attachment.type === 'music' && attachment.name) blocks.push({ type: 'text', text: `［音乐］${attachment.name}${attachment.artist ? ' · ' + attachment.artist : ''}` });
    }
    if (document.options.includeReasoning && message.reasoning_content) blocks.push({ type: 'text', text: `思考内容：\n${clean(message.reasoning_content)}` });
    const heading = group.source === 'theater' ? chapterName(message) : nameOf(message.speaker, document.names);
    return { heading, time: document.options.includeTime && group.source !== 'theater' ? timestamp(message.created_at) : '', blocks: blocks.length ? blocks : [{ type: 'text', text: '［无文字内容］' }], chapter: group.source === 'theater' };
  }) }));
  return { ...document, groups, images: [...images.values()].filter(image => image.type === 'image'), warnings };
}

function plainText(text) {
  const tokens = parser.parse(clean(text), {});
  const output = [];
  for (const token of tokens) {
    if (token.type === 'fence' || token.type === 'code_block') output.push(token.content);
    if (token.type === 'inline') {
      let line = '';
      for (const child of token.children || []) {
        if (['text', 'code_inline', 'html_inline'].includes(child.type)) line += child.content;
        if (child.type === 'softbreak' || child.type === 'hardbreak') line += '\n';
        if (child.type === 'image') line += child.content;
        if (child.type === 'link_close') {
          const open = token.children.slice(0, token.children.indexOf(child)).findLast(item => item.type === 'link_open');
          const href = open?.attrGet('href');
          if (href && !line.endsWith(href)) line += ` (${href})`;
        }
      }
      output.push(line);
    }
  }
  return output.join('\n');
}

function textFile(document) {
  const parts = [document.title, ...(document.query ? [`搜索关键词：${document.query}`] : []), ''];
  for (const group of document.groups) {
    parts.push(`========== ${group.title || '聊天记录'} ==========`, '');
    for (const entry of group.entries) {
      parts.push(entry.heading + (entry.time ? `  ${entry.time}` : ''));
      for (const block of entry.blocks) parts.push(block.type === 'image' ? `［图片：${block.raw}］` : block.text);
      parts.push('');
    }
  }
  // UTF-8 BOM 兼容 Windows 记事本；TXT 保留 Markdown 原文和全部换行。
  return Buffer.from('\ufeff' + parts.join('\n').replace(/\r?\n/g, '\r\n'));
}

function richParagraphs(text, docx) {
  const { Paragraph, TextRun, HeadingLevel } = docx;
  const output = [];
  let heading = null, list = 0, quote = 0;
  for (const token of parser.parse(clean(text), {})) {
    if (token.type === 'heading_open') heading = HeadingLevel[`HEADING_${Math.min(6, Number(token.tag.slice(1)) + 2)}`];
    if (token.type === 'heading_close') heading = null;
    if (token.type === 'list_item_open') list++;
    if (token.type === 'list_item_close') list--;
    if (token.type === 'blockquote_open') quote++;
    if (token.type === 'blockquote_close') quote--;
    if (token.type === 'hr') output.push(new Paragraph({ text: '────────', spacing: { after: 100 } }));
    if (token.type === 'fence' || token.type === 'code_block') {
      for (const line of token.content.split('\n')) output.push(new Paragraph({ children: [new TextRun({ text: line, font: 'Consolas', size: 20 })], spacing: { after: 60 } }));
    }
    if (token.type !== 'inline') continue;
    let bold = false, italics = false;
    const children = [];
    if (list) children.push(new TextRun('• '));
    for (const child of token.children || []) {
      if (child.type === 'strong_open') bold = true;
      if (child.type === 'strong_close') bold = false;
      if (child.type === 'em_open') italics = true;
      if (child.type === 'em_close') italics = false;
      if (['text', 'code_inline', 'html_inline'].includes(child.type)) children.push(new TextRun({ text: child.content, bold, italics, ...(child.type === 'code_inline' ? { font: 'Consolas' } : {}) }));
      if (child.type === 'softbreak' || child.type === 'hardbreak') children.push(new TextRun({ break: 1 }));
      if (child.type === 'link_open') {
        // 链接地址也写入正文，离线查看时仍保留原始信息。
        const href = child.attrGet('href');
        if (href) children.push(new TextRun({ text: `(${href}) `, color: '476958' }));
      }
    }
    output.push(new Paragraph({ children, heading, indent: quote ? { left: 300 } : undefined, spacing: { after: 130, line: 330 } }));
  }
  return output;
}

async function wordFile(document) {
  const docx = require('./vendor/docx.cjs');
  const { Document, Paragraph, TextRun, HeadingLevel, ImageRun, Packer } = docx;
  const children = [new Paragraph({ text: document.title, heading: HeadingLevel.TITLE })];
  if (document.query) children.push(new Paragraph(`搜索关键词：${document.query}`));
  for (const group of document.groups) {
    children.push(new Paragraph({ text: group.title || '聊天记录', heading: HeadingLevel.HEADING_1 }));
    for (const entry of group.entries) {
      children.push(new Paragraph({ children: [new TextRun({ text: entry.heading, bold: true }), new TextRun({ text: entry.time ? `  ${entry.time}` : '', size: 18, color: '6A746E' })], heading: entry.chapter ? HeadingLevel.HEADING_2 : undefined, spacing: { before: 220, after: 130 }, keepNext: true }));
      for (const block of entry.blocks) {
        if (block.type === 'text') children.push(...richParagraphs(block.text, docx));
        else if (['png', 'jpg', 'gif'].includes(block.type === 'image' ? block.mime.split('/')[1].replace('jpeg', 'jpg') : '')) {
          const scale = Math.min(530 / block.width, 660 / block.height, 1);
          children.push(new Paragraph({ children: [new ImageRun({ data: block.data, type: block.mime === 'image/jpeg' ? 'jpg' : block.mime.split('/')[1], transformation: { width: Math.max(1, Math.round(block.width * scale)), height: Math.max(1, Math.round(block.height * scale)) }, altText: { title: block.caption, description: block.caption, name: block.filename } })], spacing: { after: 160 } }));
        } else {
          document.warnings.add('Word/PPT 中不支持的图片格式已保留文字提示；PDF/EPUB 可显示');
          children.push(new Paragraph(`［${block.caption}：${block.raw}］`));
        }
      }
    }
  }
  return Packer.toBuffer(new Document({ creator: 'AionsHome Chat Viewer', title: document.title, description: '本地聊天记录导出', styles: { default: { document: { run: { font: { ascii: 'Microsoft YaHei', eastAsia: 'Microsoft YaHei' }, size: 23 }, paragraph: { spacing: { line: 330 } } } }, title: { run: { color: '000000', size: 36, bold: true } } }, sections: [{ properties: { page: { margin: { top: 1000, right: 1050, bottom: 1000, left: 1050 } } }, children }] }));
}

// 按显示宽度分行再分页：长中文、无空格长句与代码都不会被截断或缩成小字。
function paginate(text, maxUnits = 62, maxLines = 12) {
  const lines = [];
  for (const sourceLine of clean(text).split('\n')) {
    let line = '', units = 0;
    for (const character of sourceLine) {
      const size = character === '\t' ? 4 : character.codePointAt(0) > 255 ? 2 : 1;
      if (units + size > maxUnits && line) { lines.push(line); line = ''; units = 0; }
      line += character;
      units += size;
    }
    lines.push(line);
  }
  const pages = [];
  for (let index = 0; index < lines.length; index += maxLines) pages.push(lines.slice(index, index + maxLines).join('\n'));
  return pages;
}

async function presentationFile(document) {
  const PptxGenJS = require('./vendor/pptxgen.cjs');
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'AionsHome Chat Viewer'; pptx.subject = '聊天记录导出'; pptx.title = document.title; pptx.lang = 'zh-CN';
  pptx.theme = { headFontFace: 'Microsoft YaHei', bodyFontFace: 'Microsoft YaHei', lang: 'zh-CN' };
  let pageNumber = 0;
  function slideFor(groupTitle, heading, time = '') {
    const slide = pptx.addSlide(); pageNumber++;
    slide.background = { color: 'F7F8F4' };
    slide.addText(groupTitle, { x: 0.6, y: 0.25, w: 12.1, h: 0.35, fontFace: 'Microsoft YaHei', fontSize: 12, color: '657368', margin: 0, breakLine: false });
    slide.addText(heading, { x: 0.6, y: 0.82, w: 12.1, h: 0.65, fontFace: 'Microsoft YaHei', fontSize: 24, bold: true, color: '254E3C', margin: 0, fit: 'shrink' });
    slide.addText(`${time}${time ? '  ·  ' : ''}${pageNumber}`, { x: 0.6, y: 7.05, w: 12.1, h: 0.22, fontFace: 'Microsoft YaHei', fontSize: 10, color: '657368', margin: 0 });
    return slide;
  }
  for (const group of document.groups) for (const entry of group.entries) {
    for (const block of entry.blocks) {
      if (block.type === 'image' && ['image/png', 'image/jpeg', 'image/gif'].includes(block.mime)) {
        const slide = slideFor(group.title, entry.heading, entry.time);
        const scale = Math.min(11.9 / block.width, 5.2 / block.height);
        const w = block.width * scale, h = block.height * scale;
        slide.addImage({ data: `data:${block.mime};base64,${block.data.toString('base64')}`, x: (13.333 - w) / 2, y: 1.6 + (5.2 - h) / 2, w, h, altText: block.caption });
      } else {
        if (block.type === 'image') document.warnings.add('Word/PPT 中不支持的图片格式已保留文字提示；PDF/EPUB 可显示');
        const pages = paginate(block.type === 'image' ? `［${block.caption}：${block.raw}］` : plainText(block.text));
        for (let index = 0; index < pages.length; index++) {
          const slide = slideFor(group.title, entry.heading + (pages.length > 1 ? `（${index + 1}/${pages.length}）` : ''), entry.time);
          slide.addText(pages[index], { x: 0.65, y: 1.65, w: 12, h: 5.1, fontFace: 'Microsoft YaHei', fontSize: 21, color: '293B31', margin: 0, valign: 'top', breakLine: false, lineSpacingMultiple: 1.15, paraSpaceAfterPt: 0 });
        }
      }
    }
  }
  return Buffer.from(await pptx.write({ outputType: 'nodebuffer', compression: true }));
}

const bookCss = `body{font-family:"Microsoft YaHei","Noto Sans CJK SC",sans-serif;color:#25382d;line-height:1.85;margin:0 auto;max-width:48em;padding:1em}h1,h2,h3{line-height:1.5;color:#173e2a;overflow-wrap:anywhere}h1{font-size:1.8em}h2{font-size:1.35em;margin-top:2em}h3{font-size:1.05em;margin:1.6em 0 .4em}.meta{font-size:.8em;color:#6a756e}p{margin:.5em 0;overflow-wrap:anywhere}article{margin-bottom:1.4em}img{display:block;max-width:100%;height:auto;margin:1em auto}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f4ef;padding:.7em}blockquote{border-left:3px solid #bbccbf;padding-left:1em;margin-left:0}table{border-collapse:collapse;max-width:100%;font-size:.9em;word-break:break-word}td,th{border:1px solid #c9d4ca;padding:.3em .6em}.chapter-title{break-before:page}.group{break-before:page}.group:first-of-type{break-before:auto}@page{size:A4;margin:18mm 16mm}@media print{body{max-width:none;padding:0;font-size:11pt}img{max-height:240mm;object-fit:contain}h1,h2,h3{break-after:avoid}pre,blockquote{break-inside:auto}}`;

function htmlText(text) {
  // Markdown 原始 HTML 不执行；统一空元素为 XHTML，EPUB 阅读器也可解析。
  return markdown.render(clean(text)).replace(/<(br|hr)>/g, '<$1 />').replace(/&nbsp;/g, '&#160;');
}
function entryHtml(entry, imageUrl) {
  const tag = entry.chapter ? 'h2' : 'h3';
  return `<article><${tag}${entry.chapter ? ' class="chapter-title"' : ''}>${escape(entry.heading)}</${tag}>${entry.time ? `<p class="meta">${escape(entry.time)}</p>` : ''}${entry.blocks.map(block => block.type === 'image' ? `<figure><img src="${escape(imageUrl(block))}" alt="${escape(block.caption)}" /></figure>` : htmlText(block.text)).join('\n')}</article>`;
}
function xhtmlPage(title, body) {
  return `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="zh-CN" xml:lang="zh-CN"><head><title>${escape(title)}</title><meta charset="utf-8" /><link rel="stylesheet" href="style.css" /></head><body>${body}</body></html>`;
}
async function ebookFile(document) {
  const zip = new JSZip();
  // EPUB 要求 mimetype 为第一个、未压缩条目，不生成额外目录头。
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE', createFolders: false });
  zip.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml" /></rootfiles></container>', { createFolders: false });
  zip.file('OEBPS/style.css', bookCss, { createFolders: false });
  const chapters = [];
  const navigation = [];
  for (const group of document.groups) {
    const groupChapters = [];
    // 小剧场逐章建文件与目录，聊天会话作为单独一节，保持原始先后顺序。
    const batches = group.source === 'theater' ? group.entries.map(entry => [entry]) : [group.entries];
    for (const entries of batches) {
      const filename = `chapter-${chapters.length + 1}.xhtml`;
      const title = group.source === 'theater' ? entries[0].heading : group.title;
      zip.file(`OEBPS/${filename}`, xhtmlPage(title, `<h1>${escape(group.title)}</h1>${entries.map(entry => entryHtml(entry, image => `images/${image.filename}`)).join('\n')}`), { createFolders: false });
      chapters.push({ filename, title }); groupChapters.push({ filename, title });
    }
    navigation.push(`<li><a href="${groupChapters[0].filename}">${escape(group.title)}</a>${group.source === 'theater' ? `<ol>${groupChapters.map(chapter => `<li><a href="${chapter.filename}">${escape(chapter.title)}</a></li>`).join('')}</ol>` : ''}</li>`);
  }
  zip.file('OEBPS/nav.xhtml', xhtmlPage('目录', `<h1>${escape(document.title)}</h1><nav epub:type="toc" id="toc"><h2>目录</h2><ol>${navigation.join('')}</ol></nav>`), { createFolders: false });
  for (const image of document.images) zip.file(`OEBPS/images/${image.filename}`, image.data, { createFolders: false });
  const manifest = chapters.map((chapter, index) => `<item id="c${index}" href="${chapter.filename}" media-type="application/xhtml+xml" />`).join('') + document.images.map((image, index) => `<item id="i${index}" href="images/${image.filename}" media-type="${image.mime}" />`).join('');
  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="zh-CN"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">urn:uuid:${crypto.randomUUID()}</dc:identifier><dc:title>${escape(document.title)}</dc:title><dc:language>zh-CN</dc:language><dc:creator>AionsHome Chat Viewer</dc:creator><meta property="dcterms:modified">${document.createdAt.replace(/\.\d{3}Z$/, 'Z')}</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" /><item id="css" href="style.css" media-type="text/css" />${manifest}</manifest><spine>${chapters.map((chapter, index) => `<itemref idref="c${index}" />`).join('')}</spine></package>`, { createFolders: false });
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

async function pdfFile(document, root) {
  const browser = pdfBrowser();
  if (!browser) throw new Error('导出 PDF 需要电脑安装 Microsoft Edge 或 Chrome；其他格式不受影响');
  const parent = path.join(root, 'runtime', 'exports');
  fs.mkdirSync(parent, { recursive: true });
  const directory = fs.mkdtempSync(path.join(parent, 'pdf-'));
  const output = path.join(directory, 'export.pdf');
  try {
    const body = document.groups.map(group => `<section class="group"><h1>${escape(group.title)}</h1>${group.entries.map(entry => entryHtml(entry, image => `data:${image.mime};base64,${image.data.toString('base64')}`)).join('\n')}</section>`).join('\n');
    const filename = path.join(directory, 'document.html');
    fs.writeFileSync(filename, `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><title>${escape(document.title)}</title><style>${bookCss}</style></head><body>${body}</body></html>`);
    // 独立临时配置不干扰正在阅读的窗口；转换结束关闭无界面浏览器并删除临时内容。
    await new Promise((resolve, reject) => {
      const child = spawn(browser, ['--headless', '--disable-gpu', '--no-first-run', '--disable-extensions', '--disable-background-networking', '--no-pdf-header-footer', `--user-data-dir=${path.join(directory, 'profile')}`, `--print-to-pdf=${output}`, pathToFileURL(filename).href], { windowsHide: true, stdio: 'ignore' });
      const timeout = setTimeout(() => { child.kill(); reject(new Error('PDF 生成超时，请尝试减少范围，或导出 Word/EPUB')); }, 150000);
      child.once('error', error => { clearTimeout(timeout); reject(new Error('无法启动 PDF 转换：' + error.message)); });
      child.once('exit', code => { clearTimeout(timeout); if (fs.existsSync(output)) resolve(); else reject(new Error(`PDF 生成失败（${code}），请稍后重试`)); });
    });
    const data = fs.readFileSync(output);
    if (data.toString('ascii', 0, 5) !== '%PDF-') throw new Error('PDF 文件生成不完整，请重新导出');
    return data;
  } finally {
    // 仅清理本次明确创建、位于 runtime/exports 内的临时目录。
    if (path.dirname(directory) === parent && path.basename(directory).startsWith('pdf-')) fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
  }
}

async function createExport(document, format, { root = __dirname, resolveMedia = () => { throw new Error('图片不可用'); } } = {}) {
  if (!FORMATS[format]) throw new Error('请选择 TXT、DOCX、PPTX、EPUB 或 PDF');
  const prepared = prepareDocument(document, resolveMedia, { embedImages: format !== 'txt' });
  const generators = { txt: () => textFile(prepared), docx: () => wordFile(prepared), pptx: () => presentationFile(prepared), epub: () => ebookFile(prepared), pdf: () => pdfFile(prepared, root) };
  const data = await generators[format]();
  const title = clean(document.title).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 90) || '聊天记录';
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).replace(/\//g, '-');
  return { data, mime: FORMATS[format].mime, filename: `${title}-${day}.${format}`, warnings: [...prepared.warnings] };
}

module.exports = { FORMATS, collectPreview: require('./export-data').summarizeExport, createExport, prepareDocument, paginate, pdfBrowser };
