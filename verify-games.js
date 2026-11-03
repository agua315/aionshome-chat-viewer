'use strict';

// 桌游卡片只做附件解析检查，样例来自真实群聊记录结构，不读取任何聊天数据。
const assert = require('node:assert/strict');
const { gameCard, GAME_TYPES } = require('./public/message-display');

const invite = gameCard({ content: '行安邀请逸无栖玩一局桌球。', attachments: [{ type: 'mini_game_invite', game: '桌球', actor: 'aion', actor_name: '行安' }, { type: 'system_model_context' }] });
assert.deepEqual(invite, { kind: 'invite', icon: '🎱', actor: '行安', game: '桌球' });
assert.equal(gameCard({ attachments: [{ type: 'mini_game_invite', game: '吹牛骰子' }] }).actor, 'AI');

const pool = gameCard({ content: '【台球战报 · 第2局】\n行安获胜，康落败。\n累计胜局：行安 2 : 0 康。\n本局共 2 杆；自己的球还未清完，黑八提前入袋。\n三局两胜 · 整场结束：行安以 2:0 赢得本场比赛。', attachments: [{ type: 'billiards_result', rack: 2, players: [{ actor: 'aion', name: '行安' }, { actor: 'connor', name: '康' }], winner: 0, score: [2, 0], shots: 2, reason: '自己的球还未清完，黑八提前入袋', match_complete: true }] });
assert.equal(pool.title, '台球战报');
assert.equal(pool.scope, '第 2 局 · 整场结束');
assert.equal(pool.outcome, '行安 获胜 · 康 落败');
assert.deepEqual(pool.details, ['累计胜局：行安 2 : 0 康', '本局共 2 杆 · 自己的球还未清完，黑八提前入袋']);
assert.equal(pool.note, '三局两胜 · 整场结束：行安以 2:0 赢得本场比赛。');

const dice = gameCard({ content: '【吹牛骰子 · 本场收桌结算】', attachments: [{ type: 'table_game_result', scope: 'table', title: '吹牛骰子', round: 3, outcome: '已完成 3 轮 · 共完成 3 轮', lines: ['逸无栖：本场 -50.00 元', 7, '康：本场 +100.00 元'], note: '结算金额已从钱包自动扣除' }] });
assert.deepEqual(dice, { kind: 'result', badge: '♣', title: '吹牛骰子战报', scope: '本场结算', outcome: '已完成 3 轮 · 共完成 3 轮', details: ['逸无栖：本场 -50.00 元', '7', '康：本场 +100.00 元'], note: '结算金额已从钱包自动扣除' });
assert.equal(gameCard({ attachments: [{ type: 'table_game_result', scope: 'round', round: 2, title: '吹牛骰子', outcome: '康赢了' }] }).scope, '第 2 轮');

const landlord = gameCard({ attachments: [{ type: 'doudizhu_result', outcome: '农民胜利', winnerName: '康', landlordName: '行安', remaining: '行安 3 张', walletLines: ['康 +20', '行安 -20'] }] });
assert.deepEqual(landlord.details, ['先出完：康 · 地主：行安', '剩余手牌：行安 3 张']);
assert.equal(landlord.note, '零钱结算：康 +20 · 行安 -20');

const rps = gameCard({ content: '猜拳结果：本局约定「输了去翻遥控板」。逸无栖出了布，行安出了石头，逸无栖赢了。', attachments: [{ type: 'rps_result', topic: '输了去翻遥控板' }] });
assert.deepEqual(rps, { kind: 'rps', text: '逸无栖出了🖐️，行安出了✊，逸无栖赢了。', topic: '输了去翻遥控板' });

// 普通消息、缺关键字段和异常结构都回退为原文显示，不能抛错。
for (const message of [{ content: '你好', attachments: [] }, {}, null, { attachments: 'bad' }, { attachments: [null, { type: 'billiards_result', players: 'x' }] }, { attachments: [{ type: 'table_game_result', title: '吹牛骰子' }] }, { attachments: [{ type: 'mini_game_invite', game: {} }] }, { attachments: [{ type: 'doudizhu_result' }] }, { content: '', attachments: [{ type: 'rps_result' }] }]) assert.equal(gameCard(message), null);
assert.deepEqual(GAME_TYPES, ['mini_game_invite', 'billiards_result', 'table_game_result', 'doudizhu_result', 'rps_result']);
const { isHiddenMessage } = require('./public/message-display');
const inviteMessage = { speaker: 'system', attachments: [{ type: 'mini_game_invite', game: '桌球' }] };
assert.equal(isHiddenMessage(inviteMessage, { hideSystemMessages: true, showGameCards: true }), false);
assert.equal(isHiddenMessage(inviteMessage, { hideSystemMessages: false, showGameCards: false }), true);
assert.equal(isHiddenMessage({ speaker: 'system', content: '查看了监控' }, { hideSystemMessages: true, showGameCards: true }), true);
assert.equal(isHiddenMessage({ speaker: 'user', attachments: inviteMessage.attachments }, { showGameCards: false }), false);
console.log('通过：独立开关、游玩邀约、台球/吹牛骰子/斗地主战报、猜拳表情、缺字段回退原文。');
