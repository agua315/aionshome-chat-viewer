/* 分享遮挡的匹配与绘制。原字只参与占位测量，图形遮挡从不绘制原字。 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.QuoteCardMosaic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const kinds = ['pixel', 'solid', 'frost', 'stripe', 'text', 'pattern', 'image'];
  const fields = ['text', 'title', 'signature'];
  function defaults() {
    return { enabled: true, kind: 'pixel', color: '#666b77', text: '某人', pattern: '✦', patternCount: 3, size: 10, image: '', imageSize: 1.4, ignoreCase: true };
  }
  const clamp = (value, fallback, min, max) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;
  function normalize(value = {}) {
    const base = defaults();
    return { ...base, enabled: value.enabled !== false, kind: kinds.includes(value.kind) ? value.kind : base.kind,
      color: /^#[a-f\d]{6}$/i.test(String(value.color)) ? value.color.toLowerCase() : base.color,
      text: typeof value.text === 'string' ? value.text.replace(/[\r\n]/g, ' ').slice(0, 120) : base.text,
      pattern: typeof value.pattern === 'string' && value.pattern.trim() ? value.pattern.trim().slice(0, 32) : base.pattern,
      patternCount: Math.round(clamp(value.patternCount, base.patternCount, 1, 8)), size: clamp(value.size, base.size, 4, 24),
      image: typeof value.image === 'string' && /^\/api\/appearance\/background\/[a-f\d]+\.(png|jpe?g|webp|gif|avif)$/.test(value.image) ? value.image : '',
      imageSize: clamp(value.imageSize, base.imageSize, .7, 4), ignoreCase: value.ignoreCase !== false };
  }
  function words(value) {
    const items = Array.isArray(value) ? value : String(value || '').split(/\r?\n/);
    const result = [...new Set(items.map(item => String(item).trim()).filter(Boolean))];
    if (result.length > 200) throw new Error('批量遮挡请控制在 200 个字词以内。');
    if (result.some(item => item.length > 200)) throw new Error('每个遮挡字词请控制在 200 字以内。');
    return result;
  }
  const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function merge(ranges) {
    const sorted = ranges.filter(range => range.end > range.start).map(range => ({ start: range.start, end: range.end })).sort((a, b) => a.start - b.start || b.end - a.end);
    const result = [];
    for (const range of sorted) {
      const last = result.at(-1);
      if (last && range.start < last.end) last.end = Math.max(last.end, range.end);
      else result.push(range);
    }
    return result;
  }
  function boundaries(text) {
    if (typeof Intl.Segmenter === 'function') return [...new Intl.Segmenter('zh-CN', { granularity: 'grapheme' }).segment(text)].map(part => part.index).concat(text.length);
    const result = [0]; let index = 0;
    for (const character of text) { index += character.length; result.push(index); }
    return result;
  }
  function expand(range, stops) {
    let left = 0, right = stops.length - 1;
    while (left < right) { const mid = Math.ceil((left + right) / 2); if (stops[mid] <= range.start) left = mid; else right = mid - 1; }
    const start = stops[left]; left = 0; right = stops.length - 1;
    while (left < right) { const mid = Math.floor((left + right) / 2); if (stops[mid] < range.end) left = mid + 1; else right = mid; }
    return { start, end: stops[left] };
  }
  function maskRuns(runs, field, options = null) {
    if (!options || !normalize(options.style || options).enabled) return { runs, count: 0 };
    const style = normalize(options.style || options);
    const text = runs.map(run => run.text).join('');
    const candidates = [];
    for (const word of words(options.keywords)) {
      const regex = new RegExp(escapeRegex(word), style.ignoreCase ? 'giu' : 'gu');
      for (const match of text.matchAll(regex)) candidates.push({ start: match.index, end: match.index + match[0].length });
    }
    let visibleOffset = 0;
    const positioned = runs.map(run => {
      const part = { ...run, visibleStart: visibleOffset, start: Number.isInteger(run.start) ? run.start : visibleOffset };
      visibleOffset += run.text.length; return part;
    });
    for (const range of options.ranges || []) {
      if (range.field !== field) continue;
      for (const run of positioned) {
        const from = Math.max(range.start, run.start), to = Math.min(range.end, run.start + run.text.length);
        if (to > from) candidates.push({ start: run.visibleStart + from - run.start, end: run.visibleStart + to - run.start });
      }
    }
    const stops = candidates.length ? boundaries(text) : [];
    const ranges = merge(candidates.map(range => expand(range, stops)));
    if (!ranges.length) return { runs, count: 0 };
    const result = [];
    for (const run of positioned) {
      const end = run.visibleStart + run.text.length;
      let position = run.visibleStart;
      for (const range of ranges) {
        if (range.end <= position || range.start >= end) continue;
        if (range.start > position) result.push({ ...run, text: text.slice(position, range.start), mask: null });
        const from = Math.max(position, range.start), to = Math.min(end, range.end);
        const mask = { kind: style.kind, key: `${field}:${range.start}:${range.end}`, style };
        if (['text', 'pattern', 'image'].includes(style.kind)) {
          // 一个匹配只替换一次，即使原字词跨过独白/正文的样式边界。
          if (from === range.start) result.push({ ...run, text: style.kind === 'image' ? '\ufffc' : style.kind === 'pattern' ? style.pattern.repeat(style.patternCount) : style.text || '［已隐藏］', mask });
        } else result.push({ ...run, text: text.slice(from, to), mask });
        position = to;
      }
      if (position < end) result.push({ ...run, text: text.slice(position, end), mask: null });
    }
    return { runs: result, count: ranges.length };
  }
  function safeText(runs) {
    return runs.map(run => run.mask && !['text', 'pattern'].includes(run.mask.kind) ? '已隐藏' : run.text).join('');
  }
  // 单次编辑按公共前后缀定位变化区；原来遮挡范围里的新增文字继续遮挡。
  function rebaseRanges(before, after, ranges, field) {
    if (before === after) return ranges;
    let prefix = 0, suffix = 0;
    while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
    while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
    const oldEnd = before.length - suffix, newEnd = after.length - suffix, delta = after.length - before.length;
    return ranges.flatMap(range => {
      if (range.field !== field) return [range];
      let start = range.start, end = range.end;
      if (end <= prefix) { /* 编辑发生在这处遮挡之后。 */ }
      else if (start >= oldEnd) { start += delta; end += delta; }
      else { start = Math.min(start, prefix); end = Math.max(newEnd, end + delta); }
      start = Math.max(0, Math.min(after.length, start)); end = Math.max(start, Math.min(after.length, end));
      return end > start ? [{ ...range, start, end, text: after.slice(start, end) }] : [];
    });
  }
  function draw(ctx, mask, x, y, width, size, image = null) {
    const s = mask.style, h = size * 1.04, top = y + size * .04, w = Math.max(3, width);
    ctx.save();
    if (mask.kind === 'image' && image) {
      const factor = Math.min(w / image.naturalWidth, h / image.naturalHeight);
      const iw = image.naturalWidth * factor, ih = image.naturalHeight * factor;
      ctx.drawImage(image, x + (w - iw) / 2, top + (h - ih) / 2, iw, ih); ctx.restore(); return;
    }
    ctx.beginPath(); ctx.roundRect(x, top, w, h, mask.kind === 'pixel' ? 1 : Math.min(7, h / 5)); ctx.clip();
    ctx.fillStyle = s.color; ctx.fillRect(x, top, w, h);
    const rgb = [1, 3, 5].map(index => parseInt(s.color.slice(index, index + 2), 16));
    const shade = delta => '#' + rgb.map(value => Math.max(0, Math.min(255, value + delta)).toString(16).padStart(2, '0')).join('');
    if (mask.kind === 'pixel') {
      const block = s.size;
      for (let row = 0; row < h / block; row++) for (let column = 0; column < w / block; column++) {
        ctx.fillStyle = shade(((row * 29 + column * 17 + mask.key.length * 7) % 7 - 3) * 10);
        ctx.fillRect(x + column * block, top + row * block, block + .5, block + .5);
      }
    } else if (mask.kind === 'frost') {
      const gradient = ctx.createLinearGradient(x, top, x + w, top + h); gradient.addColorStop(0, shade(40)); gradient.addColorStop(.5, shade(13)); gradient.addColorStop(1, shade(-13));
      ctx.fillStyle = gradient; ctx.fillRect(x, top, w, h); ctx.fillStyle = shade(58);
      for (let i = 0; i < w * h / 30; i++) ctx.fillRect(x + i * 37 % w, top + i * 23 % h, 1, 1);
    } else if (mask.kind === 'stripe') {
      ctx.strokeStyle = shade(52); ctx.lineWidth = Math.max(2, s.size / 3);
      for (let offset = -h; offset < w + h; offset += s.size) { ctx.beginPath(); ctx.moveTo(x + offset, top + h); ctx.lineTo(x + offset + h, top); ctx.stroke(); }
    }
    ctx.restore();
  }
  return { kinds, fields, defaults, normalize, words, merge, maskRuns, safeText, rebaseRanges, draw };
});
