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

// 同一段文字混用各组样式；重叠按优先级合并，不能露出较长匹配的尾部。
const grouped = {
  keywords: ['张三', '电话'],
  rules: [
    { keywords: ['张三'], style: { kind: 'text', text: '某位朋友', color: '#123456' } },
    { keywords: ['花园'], style: { kind: 'pattern', pattern: '🌸', patternCount: 1 } },
    { keywords: ['13800001234'], style: { kind: 'solid', color: '#654321' } },
  ],
};
const mixed = run('张三在花园，电话13800001234', grouped);
assert.equal(mixed.count, 4);
assert.equal(mixed.runs.filter(item => item.mask?.kind === 'text').map(item => item.text).join(''), '某位朋友');
assert.equal(mixed.runs.find(item => item.mask?.kind === 'text').mask.style.color, '#123456');
assert.equal(mixed.runs.find(item => item.mask?.kind === 'pattern').text, '🌸');
assert.equal(mixed.runs.find(item => item.mask?.kind === 'solid').mask.style.color, '#654321');
assert.ok(mixed.runs.some(item => item.text === '电话' && item.mask?.kind === 'pixel'), '未分组的通用字词继续用默认样式');
const overlapping = run('甲乙丙丁戊', { rules: [
  { keywords: ['乙丙'], style: { kind: 'text', text: '优先' } },
  { keywords: ['甲乙丙丁'], style: { kind: 'pattern', pattern: '🌸' } },
] });
assert.equal(overlapping.runs.map(item => item.text).join(''), '优先戊', '靠前组覆盖整个重叠区，较长词不残留');
assert.equal(overlapping.count, 1);
const manualOverride = run('甲乙丙丁', { ...grouped, ranges: [{ field: 'text', start: 1, end: 2, style: { kind: 'text', text: '手动' } }], rules: [{ keywords: ['甲乙丙'], style: { kind: 'pattern' } }] });
assert.equal(manualOverride.runs.map(item => item.text).join(''), '手动丁');
const manualCrossRaw = '甲[心里嘀咕：乙]丙';
assert.equal(M.maskRuns(C.thoughtRuns(manualCrossRaw), 'text', { style: { kind: 'text', text: '整段' }, ranges: [{ field: 'text', start: 0, end: manualCrossRaw.length }] }).runs.map(item => item.text).join(''), '整段');
assert.equal(run('Alice ALICE', { rules: [{ keywords: ['Alice'], style: { kind: 'text', text: '朋友', ignoreCase: false } }] }).runs.map(item => item.text).join(''), '朋友 ALICE');
assert.equal(run('张三', { rules: [{ keywords: ['张三'], style: { enabled: false } }] }).count, 0);
assert.equal(run('张三', { ...grouped, style: { enabled: false } }).count, 0, '总开关暂停所有分组');
assert.equal(run(family, { rules: [{ keywords: ['👩'], style: { kind: 'text', text: '一家人' } }] }).runs.map(item => item.text).join(''), '一家人');

// 记录实际渲染器的 fillText 调用：七种样式都不把被遮挡原字画进图中。
let drawn = [], images = 0, imageCalls = [];
const context = {
  save() {}, restore() {}, scale() {}, fillRect() {}, beginPath() {}, roundRect() {}, clip() {}, moveTo() {}, lineTo() {}, stroke() {},
  createLinearGradient() { return { addColorStop() {} }; },
  drawImage(image) { images++; imageCalls.push(image); }, fillText(text) { drawn.push(text); },
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
const firstPath = '/api/appearance/background/aa11.png', secondPath = '/api/appearance/background/bb22.jpg';
const firstImage = { naturalWidth: 30, naturalHeight: 30 }, secondImage = { naturalWidth: 60, naturalHeight: 20 };
const imageRules = { style: M.defaults(), rules: [
  { keywords: ['张三'], style: { kind: 'image', image: firstPath, imageSize: 1 } },
  { keywords: ['13800001234'], style: { kind: 'image', image: secondPath, imageSize: 2 } },
] };
drawn = []; imageCalls = [];
const imageResult = sandbox.renderer.paint(canvas, { ...C.defaults(), imageMode: 'full' }, content, null, imageRules, new Map([[firstPath, firstImage], [secondPath, secondImage]]));
assert.equal(imageResult.maskCount, 6);
assert.equal(imageResult.missingMaskImages.length, 0);
assert.equal(imageCalls.filter(image => image === firstImage).length, 5);
assert.equal(imageCalls.filter(image => image === secondImage).length, 1, '不同分组使用各自的图片');
assert.ok(!drawn.join('').includes('张三') && !drawn.join('').includes('13800001234'));
assert.ok(!imageResult.safeTitle.includes('张三'));
const partialImages = sandbox.renderer.paint(canvas, { ...C.defaults(), imageMode: 'full' }, content, null, imageRules, new Map([[firstPath, firstImage]]));
assert.equal(partialImages.missingMaskImages.join(','), secondPath, '只报告实际命中的缺图组，供保存前阻止缺图导出');
const noMatchImage = sandbox.renderer.paint(canvas, { ...C.defaults(), imageMode: 'full' }, { text: '没有敏感词', title: '', signature: '' }, null, imageRules, new Map());
assert.equal(noMatchImage.missingMaskImages.length, 0, '未命中的图片规则不影响保存');
console.log('通过：手动与批量遮挡、多组样式和图片、重叠优先级、独白下标、编辑后范围、七种样式不绘制原字、缺图检测及文件名遮挡。');
