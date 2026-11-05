'use strict';

// 桌游卡片只做附件解析检查，样例来自结构化群聊记录，不读取任何聊天数据。
const assert = require('node:assert/strict');
const { gameCard, GAME_TYPES, isHiddenMessage } = require('./public/message-display');

const invite = gameCard({ attachments: [{ type: 'mini_game_invite', game: '桌球', actor_name: '行安' }] });
assert.deepEqual(invite, { kind: 'invite', icon: '🎱', actor: '行安', game: '桌球' });
assert.equal(gameCard({ attachments: [{ type: 'mini_game_invite', game: '吹牛骰子' }] }).actor, 'AI');

const pool = gameCard({ content: '台球战报\n三局两胜 · 整场结束：行安以 2:0 赢得本场比赛。', attachments: [{ type: 'billiards_result', rack: 2, players: [{ name: '行安' }, { name: '康' }], winner: 0, score: [2, 0], shots: 2, reason: '合法结束：自己的球已清完', match_complete: true }] });
assert.deepEqual(pool, { kind: 'duel', badge: '🎱', title: '台球战报', scope: '第 2 局 · 整场结束', winner: { name: '行安' }, loser: { name: '康' }, score: '2 : 0', shots: 2, reason: '合法结束：自己的球已清完', legal: true, note: '三局两胜 · 整场结束：行安以 2:0 赢得本场比赛。' });
const reversed = gameCard({ attachments: [{ type: 'billiards_result', players: [{ name: '行安' }, { name: '康' }], winner: 1, score: [2, 1] }] });
assert.equal(reversed.score, '1 : 2');
assert.equal(reversed.scope, '对局结束');
assert.equal(reversed.shots, null);
assert.equal(gameCard({ attachments: [{ type: 'billiards_result', players: [{ name: '行安' }], winner: 0 }] }), null);

const dice = gameCard({ attachments: [{ type: 'table_game_result', scope: 'table', title: '吹牛骰子', outcome: '已完成 3 轮', rows: [{ actor: 'aion', name: '逸无栖', delta: -50, net: '-50.00 元', balance: '120 筹码' }, { name: '康', delta: 100, net: '+100.00 元', balance: '300 筹码' }] }] });
assert.equal(dice.kind, 'scoreboard');
assert.equal(dice.badge, '⚄');
assert.deepEqual(dice.rows.map(row => row.name), ['康', '逸无栖']);
assert.equal(dice.rows[0].won, true);
assert.equal(dice.balanceLabel, '收桌余额');

const legacy = gameCard({ attachments: [{ type: 'table_game_result', title: '吹牛骰子', round: 2, lines: ['逸无栖：本场 -50.00 元 · 收桌余额 120 筹码', '无法解析的旧行', '康 +100 元'] }] });
assert.deepEqual(legacy.rows.map(row => row.name), ['康', '逸无栖']);
assert.deepEqual(legacy.extra, ['无法解析的旧行']);
assert.equal(legacy.rows[0].won, true);

const landlord = gameCard({ attachments: [{ type: 'doudizhu_result', outcome: '农民胜利', winnerName: '康', landlordName: '行安', remaining: '行安 3 张', walletLines: ['康 +20 元', '行安 -20 元', '旧格式'] }] });
assert.equal(landlord.badge, '♠');
assert.equal(landlord.note, '按本局阵营结算 · 用户金额仅记本桌');
assert(landlord.extra.includes('旧格式'));
assert(landlord.extra.includes('先出完：康 · 地主：行安'));
assert(landlord.extra.includes('剩余手牌：行安 3 张'));

const rpsInvite = gameCard({ content: '行安邀请你猜拳。本局约定：「输了去翻遥控板」', attachments: [{ type: 'rps_invite', actor: 'aion', topic: '输了去翻遥控板' }] });
assert.deepEqual(rpsInvite, { kind: 'invite', icon: '✊', actor: '行安', game: '猜拳', topic: '输了去翻遥控板' });
const composition = gameCard({ attachments: [{ type: 'composition', actor_name: '行安', title: '晚风便签', bpm: 72 }] });
assert.deepEqual(composition, { kind: 'composition', actor: '行安', title: '晚风便签', bpm: 72 });

const rps = gameCard({ content: '猜拳结果：本局约定「输了去翻遥控板」。逸无栖出了布，行安出了石头，逸无栖赢了。', attachments: [{ type: 'rps_result', topic: '输了去翻遥控板' }] });
assert.deepEqual(rps, { kind: 'rps', text: '逸无栖出了🖐️，行安出了✊，逸无栖赢了。', topic: '输了去翻遥控板' });

for (const message of [{ content: '你好', attachments: [] }, {}, null, { attachments: 'bad' }, { attachments: [{ type: 'billiards_result', players: 'x' }] }, { attachments: [{ type: 'table_game_result', title: '吹牛骰子' }] }, { attachments: [{ type: 'mini_game_invite', game: {} }] }, { attachments: [{ type: 'composition' }] }, { content: '', attachments: [{ type: 'rps_invite' }] }]) assert.equal(gameCard(message), null);
assert.deepEqual(GAME_TYPES, ['mini_game_invite', 'billiards_result', 'table_game_result', 'doudizhu_result', 'rps_result', 'rps_invite', 'composition']);
const inviteMessage = { speaker: 'system', attachments: [{ type: 'mini_game_invite', game: '桌球' }] };
assert.equal(isHiddenMessage(inviteMessage, { hideSystemMessages: true, showGameCards: true }), false);
assert.equal(isHiddenMessage(inviteMessage, { hideSystemMessages: false, showGameCards: false }), true);
assert.equal(isHiddenMessage({ speaker: 'system', content: '查看了监控' }, { hideSystemMessages: true, showGameCards: true }), true);
assert.equal(isHiddenMessage({ speaker: 'user', attachments: inviteMessage.attachments }, { showGameCards: false }), false);
console.log('通过：独立开关、台球对阵、计分表、旧行解析、猜拳邀约、小曲卡片和异常回退。');