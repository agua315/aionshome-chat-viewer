/* 摘句卡片的纯排版工具：预览与下载使用同一份布局，长内容始终生成一张图。 */
(function (root, factory) {
  const display = root.MessageDisplay || (typeof module === 'object' && module.exports ? require('./message-display') : null);
  const mosaic = root.QuoteCardMosaic || (typeof module === 'object' && module.exports ? require('./cards-mosaic') : null);
  const api = factory(display, mosaic);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.QuoteCardLayout = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (display, mosaic) {
  'use strict';
  const templates = [
    { id: 'cover', name: '配图留白', note: '封面与摘句', bg: '#fffefa', ink: '#434941', accent: '#839573', font: 'sans', cover: 'top', colors: ['#405e58', '#bac7ad'] },
    { id: 'paper', name: '奶油纸笺', note: '温柔纸面', bg: '#f4eddd', ink: '#514536', accent: '#a28c63', font: 'serif', cover: 'full', colors: ['#e7d9bc', '#fbf5e9'] },
    { id: 'forest', name: '雾林来信', note: '山色与留白', bg: '#eef2ec', ink: '#324e42', accent: '#6f8b79', font: 'serif', cover: 'top', colors: ['#334f47', '#c7d8cf'] },
    { id: 'night', name: '午夜蓝调', note: '夜色里的话', bg: '#142339', ink: '#e8e8df', accent: '#aabdd5', font: 'sans', cover: 'full', colors: ['#142339', '#465972'] },
    { id: 'sakura', name: '粉樱手札', note: '淡粉花笺', bg: '#faefef', ink: '#745459', accent: '#bd858d', font: 'serif', cover: 'full', colors: ['#eac8cd', '#fff5ef'] },
  ];
  const fonts = {
    sans: '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif',
    serif: '"Noto Serif CJK SC", "Songti SC", "SimSun", serif',
    kai: '"KaiTi", "STKaiti", "FangSong", serif',
  };
  const number = (value, fallback, min, max) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;
  const color = (value, fallback) => /^#[\da-f]{6}$/i.test(String(value)) ? value.toLowerCase() : fallback;
  const thoughtColors = { cover: '#8b7892', paper: '#92747e', forest: '#81718c', night: '#c4acd8', sakura: '#a56e86' };
  function defaults(id = 'cover') {
    const t = templates.find(item => item.id === id) || templates[0];
    return { template: t.id, background: t.bg, textColor: t.ink, thoughtColor: thoughtColors[t.id], accent: t.accent, font: t.font, fontSize: 35, lineHeight: 1.95, align: 'left', padding: 86, radius: 0, image: '', imageMode: t.cover, imageOpacity: 22, coverHeight: 620, width: 1080, format: 'png', showSignature: true, showDate: false, showMark: false, minRatio: 'auto' };
  }
  function normalize(raw = {}) {
    const base = defaults(raw.template);
    return { ...base,
      template: base.template, background: color(raw.background, base.background), textColor: color(raw.textColor, base.textColor), thoughtColor: color(raw.thoughtColor, base.thoughtColor), accent: color(raw.accent, base.accent),
      font: fonts[raw.font] ? raw.font : base.font,
      fontSize: number(raw.fontSize, base.fontSize, 22, 62), lineHeight: number(raw.lineHeight, base.lineHeight, 1.35, 2.5),
      padding: number(raw.padding, base.padding, 45, 130), radius: number(raw.radius, 0, 0, 60),
      image: typeof raw.image === 'string' && /^\/api\/appearance\/background\/[a-f\d]+\.(png|jpe?g|webp|gif|avif)$/.test(raw.image) ? raw.image : '',
      imageMode: ['top', 'full'].includes(raw.imageMode) ? raw.imageMode : base.imageMode,
      imageOpacity: number(raw.imageOpacity, base.imageOpacity, 0, 100), coverHeight: number(raw.coverHeight, base.coverHeight, 300, 1000),
      width: [900, 1080, 1440].includes(Number(raw.width)) ? Number(raw.width) : base.width,
      format: raw.format === 'jpg' ? 'jpg' : 'png', align: ['left', 'center', 'right'].includes(raw.align) ? raw.align : 'left',
      showSignature: raw.showSignature !== false, showDate: raw.showDate === true, showMark: raw.showMark === true,
      minRatio: ['auto', 'square', 'portrait', 'story'].includes(raw.minRatio) ? raw.minRatio : 'auto',
    };
  }
  // 复用阅读器的明确标记识别；代码示例和转义内容保持普通文字。
  function thoughtRuns(value) {
    const text = String(value || '');
    const runs = [];
    let end = 0;
    display.replaceInnerThoughts(text, (thought, raw, offset) => {
      if (offset > end) runs.push({ text: text.slice(end, offset), thought: false, start: end });
      const prefix = /^[\[【]心里嘀咕[：:]\s*/.exec(raw)?.[0].length || 0;
      runs.push({ text: thought, thought: true, start: offset + raw.indexOf(thought, prefix) });
      end = offset + raw.length;
      return raw;
    });
    if (end < text.length) runs.push({ text: text.slice(end), thought: false, start: end });
    return runs;
  }
  function splitSentences(value) {
    const chars = Array.from(String(value || '').replace(/\r\n?/g, '\n'));
    const result = [];
    let buffer = '';
    const flush = () => { const text = buffer.trim(); if (text) result.push(text); buffer = ''; };
    for (let i = 0; i < chars.length; i++) {
      const char = chars[i];
      if (char === '\n') { flush(); continue; }
      buffer += char;
      // 引号跟在句末标点后时一起保留；按码点遍历不会把 emoji 分成两半。
      if (/[。！？!?；;]/.test(char) && !/[。！？!?；;]/.test(chars[i + 1] || '')) {
        while (/[”’」』）】\)]/.test(chars[i + 1] || '')) buffer += chars[++i];
        flush();
      } else if (buffer.length >= 240 && /[，,、：: ]/.test(char)) flush();
    }
    flush();
    return result;
  }
  function sentences(value) {
    // 独白跨多句话时，每个可选片段保留独立标记，挑其中一句也不会丢失斜体身份。
    return thoughtRuns(value).flatMap(run => splitSentences(run.text).map(text => run.thought ? `[心里嘀咕：${text}]` : text));
  }
  function graphemes(text) {
    if (typeof Intl.Segmenter === 'function') return [...new Intl.Segmenter('zh-CN', { granularity: 'grapheme' }).segment(text)].map(part => part.segment);
    return Array.from(text);
  }
  function wrap(text, measure, maxWidth) {
    const lines = [];
    for (const paragraph of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
      if (!paragraph) { lines.push(''); continue; }
      let line = '';
      for (const character of graphemes(paragraph)) {
        if (line && measure(line + character) > maxWidth) {
          // 标点尽量留在前一行，允许小幅悬挂，避免句号孤零零跑到行首。
          if (/^[，。！？；：、）》】」』,.!?;:]$/.test(character) && measure(line + character) < maxWidth * 1.06) { line += character; continue; }
          lines.push(line); line = '';
        }
        line += character;
      }
      if (line) lines.push(line);
    }
    return lines;
  }
  function layout(settings, content, measure, masking = null) {
    const s = normalize(settings);
    const textWidth = 1080 - s.padding * 2;
    const protectedBody = mosaic.maskRuns(thoughtRuns(content.text), 'text', masking);
    const protectedTitle = mosaic.maskRuns([{ text: content.title || '', start: 0, thought: false }], 'title', masking);
    const protectedSignature = mosaic.maskRuns([{ text: content.signature || '', start: 0, thought: false }], 'signature', masking);
    const measured = size => (value, thought, mask) => mask?.kind === 'image' ? size * mask.style.imageSize : measure(value, size, false, thought);
    const bodyRuns = wrapStyled(protectedBody.runs, measured(s.fontSize), textWidth);
    const body = bodyRuns.map(line => line.runs.map(run => run.text).join(''));
    const headingRuns = content.title ? wrapStyled(protectedTitle.runs, measured(24), textWidth) : [];
    const signatureRuns = s.showSignature && content.signature ? wrapStyled([{ text: '— ', thought: false }, ...protectedSignature.runs], measured(24), textWidth) : [];
    const heading = headingRuns.map(line => line.runs.map(run => run.text).join(''));
    const signature = signatureRuns.map(line => line.runs.map(run => run.text).join(''));
    const cover = s.imageMode === 'top' ? s.coverHeight + 64 : 0;
    const titleHeight = heading.length ? heading.length * 37 + 36 : 0;
    const quoteHeight = body.length * s.fontSize * s.lineHeight;
    const bottomHeight = (signature.length ? signature.length * 40 + 38 : 0) + (s.showDate ? 40 : 0) + (s.showMark ? 42 : 0);
    const textTop = cover + s.padding + titleHeight + (s.template === 'cover' ? 0 : 70);
    const minimum = ({ auto: 800, square: 1080, portrait: 1440, story: 1920 })[s.minRatio];
    const height = Math.ceil(Math.max(minimum, textTop + quoteHeight + bottomHeight + s.padding + 20));
    const maskCounts = { text: protectedBody.count, title: protectedTitle.count, signature: s.showSignature ? protectedSignature.count : 0 };
    return { settings: s, width: 1080, height, textWidth, body, bodyRuns, heading, headingRuns, signature, signatureRuns, textTop, quoteHeight, bottomHeight, titleY: cover + s.padding, cover,
      maskCounts, maskCount: Object.values(maskCounts).reduce((sum, n) => sum + n, 0), safeTitle: mosaic.safeText(protectedTitle.runs) };
  }
  function wrapStyled(runs, measure, maxWidth) {
    const lines = [];
    let line = { runs: [], width: 0 }, endedWithNewline = false;
    const flush = () => { lines.push(line); line = { runs: [], width: 0 }; };
    for (const run of runs) for (const character of graphemes(run.text.replace(/\r\n?/g, '\n'))) {
      if (character === '\n') { flush(); endedWithNewline = true; continue; }
      endedWithNewline = false;
      let previous = line.runs.at(-1);
      const sameStyle = previous && previous.thought === run.thought && previous.mask?.key === run.mask?.key;
      let delta = sameStyle ? measure(previous.text + character, run.thought, run.mask) - previous.width : measure(character, run.thought, run.mask);
      if (line.runs.length && line.width + delta > maxWidth && !(/^[，。！？；：、）》】」』,.!?;:]$/.test(character) && line.width + delta < maxWidth * 1.06)) {
        flush(); previous = null; delta = measure(character, run.thought, run.mask);
      }
      if (previous && previous.thought === run.thought && previous.mask?.key === run.mask?.key) { previous.text += character; previous.width += delta; }
      else line.runs.push({ text: character, thought: run.thought, mask: run.mask, width: delta });
      line.width += delta;
    }
    if (line.runs.length || endedWithNewline || !lines.length) flush();
    return lines;
  }
  return { templates, fonts, defaults, normalize, sentences, thoughtRuns, wrap, wrapStyled, layout };
});
