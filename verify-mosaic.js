'use strict';

// 用虚构字词和画布调用记录做轻量验证，不读取真实聊天。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const M = require('./public/cards-mosaic');
const C = require('./public/cards-layout');
const run = (text, options) => M.maskRuns([{ text, start: 0, thought: false }], 'text', { style: M.defaults(), ...options });
assert.equal(run('张三和张三', { ranges: [{ field: 'text', start: 0, end: 2 }] }).count, 1, '手动只遮挡所选的一次');
assert.equal(run('张三和张三', { keywords: ['张三'] }).count, 2, '批量匹配所有出现');
assert.equal(run('C++ c++ a.b axb', { keywords: ['C++', 'a.b'] }).count, 3, '字词按字面匹配，不执行正则');
assert.equal(run('张三三', { keywords: ['张三', '三'] }).count, 2, '重叠字词合并，其他位置照常匹配');
const family = '👩‍👩‍👦';
const familyResult = run(family + '平安', { keywords: ['👩'] });
assert.equal(familyResult.runs[0].text, family, '不拆 emoji 组合字符');
const thoughtRaw = '正文[心里嘀咕：张三的秘密。]结尾';
const thoughtStart = thoughtRaw.indexOf('张三');
const thought = M.maskRuns(C.thoughtRuns(thoughtRaw), 'text', { style: M.defaults(), ranges: [{ field: 'text', start: thoughtStart, end: thoughtStart + 2 }] });
assert.equal(thought.count, 1); assert.equal(thought.runs.find(run => run.mask).text, '张三'); assert.equal(thought.runs.find(run => run.mask).thought, true);
const crossStyle = M.maskRuns(C.thoughtRuns('张[心里嘀咕：三]在此'), 'text', { style: { ...M.defaults(), kind: 'text', text: '某人' }, keywords: ['张三'] });
assert.equal(crossStyle.runs.map(run => run.text).join(''), '某人在此'); assert.equal(crossStyle.count, 1);
let ranges = [{ field: 'text', start: 2, end: 6, text: '1234' }];
ranges = M.rebaseRanges('电话1234在此', '新电话1234在此', ranges, 'text');
assert.equal(ranges[0].start, 3); assert.equal(ranges[0].end, 7);
ranges = M.rebaseRanges('新电话1234在此', '新电话129934在此', ranges, 'text');
assert.equal(ranges[0].text, '129934', '被遮挡内容内部编辑后仍遮挡');
assert.equal(M.rebaseRanges('新电话129934在此', '新电话在此', ranges, 'text').length, 0);
assert.equal(run('张三', { style: { enabled: false }, keywords: ['张三'] }).count, 0);

// 记录实际渲染器的 fillText 调用：七种样式都不把被遮挡原字画进图中。
let drawn = [], images = 0;
const context = {
  save() {}, restore() {}, scale() {}, fillRect() {}, beginPath() {}, roundRect() {}, clip() {}, moveTo() {}, lineTo() {}, stroke() {},
  createLinearGradient() { return { addColorStop() {} }; },
  drawImage() { images++; }, fillText(text) { drawn.push(text); },
  measureText(text) { return { width: Array.from(text).length * Number(/([\d.]+)px/.exec(this.font)?.[1] || 30) * .75 }; },
};
const canvas = { getContext: () => context };
const sandbox = { QuoteCardLayout: C, QuoteCardMosaic: M, document: { createElement: () => canvas } };
vm.runInNewContext(fs.readFileSync(require.resolve('./public/cards-renderer'), 'utf8') + ';this.renderer = QuoteCardRenderer;', sandbox);
const content = { text: '张三的电话是13800001234。[心里嘀咕：张三今天很开心。]再给张三留句话。', title: '张三的一页', signature: '张三' };
for (const kind of M.kinds) {
  drawn = []; images = 0;
  const result = sandbox.renderer.paint(canvas, { ...C.defaults(), imageMode: 'full' }, content, null, { style: { ...M.defaults(), kind }, keywords: ['张三', '13800001234'] }, { naturalWidth: 30, naturalHeight: 30 });
  assert.equal(result.maskCount, 6, kind + ' 正文/标题/落款均覆盖');
  assert.ok(!drawn.join('').includes('张三'), kind + ' 不绘制姓名');
  assert.ok(!drawn.join('').includes('13800001234'), kind + ' 不绘制号码');
  assert.ok(!result.safeTitle.includes('张三'), kind + ' 文件名也移除原字词');
  if (kind === 'image') assert.ok(images > 0);
}
console.log('通过：手动单次、批量字词、重叠/字面匹配、独白下标、编辑后范围、七种样式不绘制原字、标题/落款/文件名遮挡。');
