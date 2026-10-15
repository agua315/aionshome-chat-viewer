'use strict';

// 轻量检查分句、排版与一张长图，不读取真实聊天、不引入截图或绘图库依赖。
const assert = require('node:assert/strict');
const C = require('./public/cards-layout');
assert.equal(C.templates.length, 5);
assert.deepEqual(C.sentences('“别急。”\n我在！抓紧了，不准叹气。🙂今天也要开心'), ['“别急。”', '我在！', '抓紧了，不准叹气。', '🙂今天也要开心']);
assert.equal(C.sentences('没有标点'.repeat(10000)).join(''), '没有标点'.repeat(10000));
const sample = '中文🙂e\u0301English 以及不能丢失的标点。'.repeat(100);
const wrapped = C.wrap(sample, value => Array.from(value).length, 21);
assert.equal(wrapped.join(''), sample, '换行不截字、不丢 emoji 或组合字符');
assert.ok(!wrapped.some(line => /^[\uDC00-\uDFFF]/.test(line)));
const measure = (value, size) => Array.from(value).length * size;
const short = C.layout(C.defaults(), { text: '短短一句话', title: '标题', signature: '落款' }, measure);
const text = '一整张长图的最后一句话不能丢失。\n'.repeat(180);
const long = C.layout(C.defaults(), { text, title: '完整长图', signature: '只存一张' }, measure);
assert.ok(long.height > short.height * 5);
assert.equal(long.body.join('').replace(/\n/g, ''), text.replace(/\n/g, ''));
assert.ok(!('pages' in long), '没有分页或分张逻辑');
const thoughtText = '正文。[心里嘀咕：第一句独白。第二句独白🙂。]继续正文。';
assert.deepEqual(C.thoughtRuns(thoughtText).map(run => [run.text, run.thought]), [['正文。', false], ['第一句独白。第二句独白🙂。', true], ['继续正文。', false]]);
const styled = C.layout(C.defaults(), { text: thoughtText, title: '', signature: '' }, (text, size, bold, italic) => Array.from(text).length * size * (italic ? 1.04 : 1));
assert.equal(styled.body.join(''), '正文。第一句独白。第二句独白🙂。继续正文。');
assert.ok(styled.bodyRuns.flatMap(line => line.runs).some(run => run.thought));
assert.ok(styled.bodyRuns.every(line => line.width <= styled.textWidth * 1.06));
assert.deepEqual(C.sentences(thoughtText), ['正文。', '[心里嘀咕：第一句独白。]', '[心里嘀咕：第二句独白🙂。]', '继续正文。']);
for (const example of ['`[心里嘀咕：代码示例]`', '\\[心里嘀咕：转义示例]', '```\n[心里嘀咕：代码块]\n```']) assert.ok(C.thoughtRuns(example).every(run => !run.thought));
assert.equal(C.normalize({ thoughtColor: '#123456' }).thoughtColor, '#123456');
assert.equal(C.normalize({ thoughtColor: 'invalid' }).thoughtColor, C.defaults().thoughtColor);
for (const template of C.templates) {
  const settings = C.normalize(C.defaults(template.id));
  assert.equal(settings.template, template.id);
  assert.match(settings.background, /^#[a-f\d]{6}$/);
}
const bad = C.normalize({ image: 'https://example.com/remote.jpg', fontSize: -3, lineHeight: 100, width: 7, background: 'red', format: 'exe' });
assert.equal(bad.image, ''); assert.equal(bad.fontSize, 22); assert.equal(bad.lineHeight, 2.5); assert.equal(bad.width, 1080); assert.equal(bad.format, 'png');
assert.equal(C.normalize({ image: '/api/appearance/background/abcdef012345.png' }).image, '/api/appearance/background/abcdef012345.png');
console.log('通过：五套模板、中文逐句选择、emoji 换行、完整单张长图、独白斜体分段与独立配色。');
