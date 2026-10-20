const { test, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const AWS = require('aws-sdk');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const data = {};
for (const key of ['Item', 'Equipment', 'Bundle', 'Recipe', 'Pack']) data[key] = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'DB/RPGenius', key + '.json'), 'utf8'));
data.Item.push({ type: '티켓', name: '천상의 회랑 입장권' });
data.Paradise = { enabled: true, baseRewards: [{ type: '골드', count: 100, perFloors: 1 }] };
data.Quest = []; data.Shop = {};
const account = { _get: 1, name: 'paradise-test', id: 'paradise-test-id', code: 'TEST', level: 300, logged_in: [], avatarMigrated: true, need_character_card_select: false, main_card: { id: 0, star: 6, type: '일반' }, inventory: { card: [], item: [], equipment: [], pet: [] } };
const persisted = new Map([[account.id, structuredClone(account)]]);
const writes = [];
const mailRecords = new Map();
let failMailFor = null;
process.env.ADMIN_SESSION_SECRET = 'paradise-isolated-test';
AWS.S3.prototype.makeRequest = function (operation) {
    if (operation === 'listObjectsV2') return { promise: async () => ({ Contents: [] }) };
    throw new Error('Unexpected isolated S3 operation: ' + operation);
};
DynamoDBDocumentClient.prototype.send = async command => {
    const input = command.input, type = command.constructor.name;
    if (type === 'GetCommand' && input.TableName === 'rpgenius_mail') return { Item: structuredClone(mailRecords.get(input.Key.id)) };
    if (type === 'PutCommand' && input.TableName === 'rpgenius_mail') {
        if (failMailFor === input.Item.toName) { failMailFor = null; throw new Error('simulated mail outage'); }
        mailRecords.set(input.Item.id, structuredClone(input.Item)); return {};
    }
    if (type === 'PutCommand' && input.TableName === 'rpgenius_data' && input.Item.key.startsWith('ParadiseSettlement:')) {
        if (data[input.Item.key]) throw Object.assign(new Error('exists'), { name: 'ConditionalCheckFailedException' });
        data[input.Item.key] = structuredClone(input.Item.data); return {};
    }
    if (type === 'UpdateCommand' && input.TableName === 'rpgenius_data' && input.Key.key.startsWith('ParadiseSettlement:')) { data[input.Key.key].completedAt = input.ExpressionAttributeValues[':now']; return {}; }
    if (type === 'GetCommand') return input.TableName === 'rpgenius_data' ? { Item: data[input.Key.key] === undefined ? undefined : { data: structuredClone(data[input.Key.key]) } } : { Item: structuredClone(persisted.get(input.Key.id)) };
    if (type === 'ScanCommand') return { Items: input.TableName === 'rpgenius_user' ? [...persisted.values()].map(v => structuredClone(v)) : [] };
    if (type === 'PutCommand' && input.TableName === 'rpgenius_data' && input.Item.key === 'EliteState') return {};
    if (type === 'UpdateCommand' && input.TableName === 'rpgenius_user') {
        writes.push(structuredClone(input));
        const user = persisted.get(input.Key.id), names = input.ExpressionAttributeNames || {}, values = input.ExpressionAttributeValues || {};
        for (const [alias, key] of Object.entries(names)) {
            const index = alias.match(/^#k(\d+)$/)?.[1];
            if (index != null) {
                if (Object.hasOwn(values, ':p' + index) && JSON.stringify(user[key]) !== JSON.stringify(values[':p' + index]) || !Object.hasOwn(values, ':p' + index) && user[key] !== undefined) throw Object.assign(new Error('stale state'), { name: 'ConditionalCheckFailedException' });
            }
        }
        const setters = String(input.UpdateExpression).matchAll(/(#[a-zA-Z0-9_]+)\s*=\s*(:[a-zA-Z0-9_]+)/g);
        for (const [, alias, value] of setters) if (names[alias]) user[names[alias]] = structuredClone(values[value]);
        return {};
    }
    throw new Error('Unexpected isolated DB command: ' + type + '/' + input.TableName);
};
const rpg = require('../rpgenius');
const corridor = require('../paradise');
let listener, base;
before(async () => {
    await rpg.initRpgeniusData();
    const listen = express.application.listen;
    mock.method(express.application, 'listen', function () { listener = listen.call(this, 0, '127.0.0.1'); return listener; });
    require('../server')();
    await new Promise(resolve => listener.once('listening', resolve)); mock.restoreAll();
    base = 'http://127.0.0.1:' + listener.address().port;
});
after(async () => { rpg.clearFieldRuntimeTimers(account.name); await new Promise(resolve => listener.close(resolve)); });
function cookie() {
    const body = Buffer.from(JSON.stringify({ name: account.name, admin: false, exp: Date.now() + 3600000 })).toString('base64url');
    return 'rpg_admin=' + body + '.' + crypto.createHmac('sha256', process.env.ADMIN_SESSION_SECRET).update(body).digest('base64url');
}
async function request(route, body, authenticated = true) {
    const response = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(authenticated ? { Cookie: cookie() } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
}
async function reset() {
    rpg.clearFieldRuntimeTimers(account.name);
    const user = await rpg.getRPGUserByName(account.name);
    Object.assign(user, new rpg.RPGUser(account.name, account.id), structuredClone(account));
    user.field = null; user.paradise = null; user.paradiseReceipt = null; user.paradiseWeekly = null;
    const stats = rpg.calculateUserStats(user); user.hp = stats.hp; user.mp = stats.mp;
    rpg.addInventoryItem(user, data.Item.length - 1, 3);
    await user.save(); return user;
}
const bodyFor = state => ({ requestId: crypto.randomUUID(), runId: state.runId, revision: state.revision });
function forceEvent(user, id, extra = {}) { user.paradise.phase = 'event'; user.paradise.event = { id, ...extra }; }
function buff(user, id) { user.paradise.phase = 'augment'; user.paradise.choices = [id]; return corridor.chooseAugment(user, id, () => .99); }

test('회랑 API는 인증이 필요하고 임의 상태 전이를 허용하지 않는다', async () => {
    await reset();
    assert.equal((await request('/api/paradise', undefined, false)).status, 401);
    assert.equal((await request('/api/paradise/enter', {}, false)).status, 401);
    assert.equal((await request('/api/paradise/enter', {})).status, 400);
    const state = (await request('/api/paradise')).data;
    assert.equal(state.ticket.count, 3); assert.equal(state.run, null);
    assert.equal((await request('/api/paradise/event', { ...bodyFor(state), choice: 'rift' })).status, 400);
});

test('낙원 전투는 필드 HUD 데이터와 중복 재생 없는 실제 타격 사건을 전달한다', async () => {
    const user = await reset();
    corridor.enter(user); corridor.startCombat(user, 'judge'); await user.save();
    const before = (await request('/api/paradise')).data;
    assert.equal(before.run.enemy.sprite, '/static/assets/paradise/judge-boss.webp');
    assert.equal(before.battle.player.spriteUrl, before.player.sprite);
    assert.ok(before.battle.skills.every(skill => Number.isFinite(skill.mpCost)));
    const body = bodyFor(before);
    const first = await request('/api/paradise/attack', body);
    assert.equal(first.status, 200, JSON.stringify(first.data));
    const event = first.data.state.run.combatEvents.at(-1);
    assert.equal(event.enemyId, before.run.enemy.id);
    assert.equal(event.damage, event.hits.reduce((sum, hit) => sum + hit.damage, 0));
    assert.equal(event.received, event.receivedHits.reduce((sum, hit) => sum + hit.damage, 0));
    assert.ok(event.id && event.at);
    const retry = await request('/api/paradise/attack', body);
    const poll = await request('/api/paradise');
    assert.deepEqual(retry.data.state.run.combatEvents, first.data.state.run.combatEvents);
    assert.deepEqual(poll.data.run.combatEvents, first.data.state.run.combatEvents);
});

test('사망 후 HP 1로 정산되어도 마지막 타격은 패배 사건으로 전달한다', async t => {
    const user = await reset(); corridor.enter(user); corridor.startCombat(user, 'judge');
    user.hp = 1; Object.assign(user.paradise.enemy, { hp: 100000000, maxHp: 100000000, atk: 100000000, pnt: 100000000 });
    user.field.elite.hp = 100000000; await user.save();
    t.mock.method(Math, 'random', () => .99);
    const before = (await request('/api/paradise')).data;
    const result = await request('/api/paradise/attack', bodyFor(before));
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.equal(result.data.state.run.status, 'ended');
    assert.equal(result.data.state.player.hp, 1);
    assert.equal(result.data.state.run.combatEvents.at(-1).defeated, true);
    assert.equal(result.data.state.run.combatEvents.at(-1).cleared, false);
});

function setupHell(t, rewards) {
    const hell = require('../paradise_hell'), initial = require('../paradise_hell_content').INITIAL_CONFIG;
    const get = rpg.getDataCache, items = [...data.Item, ...hell.KEYS.map(key => ({ name: key.name, type: '재료' }))];
    const config = { ...get('Paradise'), hell: structuredClone(initial) };
    if (rewards) config.hell.rewards = rewards;
    t.mock.method(rpg, 'getDataCache', (key, fallback) => key === 'Paradise' ? config : key === 'Item' ? items : get(key, fallback));
    return { hell, items, config, async user(key = hell.KEYS[0].name) {
        const user = await reset(); rpg.addInventoryItem(user, items.findIndex(item => item.name === key), 2); await user.save(); return user;
    } };
}

test('지옥 열쇠 3종은 5/6/7회 낙하로 입장하며 동시 재요청에도 1개만 차감한다', async t => {
    const env = setupHell(t);
    for (const key of env.hell.KEYS) {
        const user = await env.user(key.name), week = { week: rpg.getKoreanWeekKey(new Date()), bestFloor: 800, reachedAt: 1 };
        user.paradiseWeekly = week; await user.save();
        const before = (await request('/api/paradise')).data, body = { ...bodyFor(before), mode: 'hell', key: key.name };
        const results = await Promise.all([request('/api/paradise/enter', body), request('/api/paradise/enter', body)]);
        assert.ok(results.every(r => r.status === 200), JSON.stringify(results));
        const saved = await rpg.getRPGUserByName(account.name);
        assert.equal(saved.paradise.dropsRemaining, key.drops); assert.equal(saved.paradise.floor, 1);
        assert.equal(saved.paradise.enemy.recommendedPower, 30000);
        assert.equal(rpg.getInventoryItemCount(saved, env.items.findIndex(item => item.name === key.name)), 1);
        assert.deepEqual(saved.paradiseWeekly, week);
    }
    await env.user(); const before = (await request('/api/paradise')).data;
    assert.equal((await request('/api/paradise/enter', { ...bodyFor(before), mode: 'hell', key: '임의 열쇠' })).status, 400);
    assert.equal((await request('/api/paradise/chest', { ...bodyFor(before), chest: 'fake' }, false)).status, 401);
});

test('지옥 낙하는 1~20층, 로켓은 16~20층이며 100층에 멈추고 천상 기록을 바꾸지 않는다', async t => {
    const env = setupHell(t), user = await env.user(); env.hell.enter(user, env.hell.KEYS[0].name, () => .99);
    assert.equal(env.hell.descend(user, 'left').error, '현재는 낙하할 수 없습니다.');
    corridor.victory(user); assert.equal(user.paradise.phase, 'descent');
    env.hell.descend(user, 'left', () => 0); assert.equal(user.paradise.floor, 2); assert.equal(user.paradise.dropsRemaining, 4);
    corridor.victory(user); user.paradise.rocketJump = true; env.hell.descend(user, 'right', () => 0);
    assert.equal(user.paradise.floor, 18); assert.equal(user.paradise.rocketJump, false);
    corridor.victory(user); env.hell.descend(user, 'left', () => .999); assert.equal(user.paradise.floor, 38);
    user.paradise.floor = 95; user.paradise.phase = 'descent'; user.paradise.rocketJump = true;
    env.hell.descend(user, 'right', () => .999); assert.equal(user.paradise.floor, 100); assert.equal(user.paradise.enemy.kind, 'boss');
    assert.equal(user.paradise.enemy.recommendedPower, 330000);
    assert.ok(Math.abs(rpg.getDungeonRecommendedCP(user.paradise.enemy) - 330000) / 330000 < .02);
    assert.equal(user.paradiseWeekly, null);
    corridor.victory(user, () => .99); assert.equal(user.paradise.phase, 'chests'); assert.equal(user.paradise.chests[0].tier, 10);
    for (const floor of [1,9,10,19,20,90,99,100]) assert.equal(env.hell.recommendedPower(floor), 30000 * (1 + Math.floor(floor / 10)));
});

test('지옥 11의 배수에는 제단만 나오고 40/20/20/20 구간 및 추가 낙하가 적용된다', async t => {
    const env = setupHell(t);
    for (const floor of [11,22,33,44,55,66,77,88,99]) {
        const user = await env.user(); env.hell.enter(user, env.hell.KEYS[0].name, () => .99);
        user.paradise.floor = floor - 1; user.paradise.phase = 'descent';
        env.hell.descend(user, 'left', () => 0);
        assert.equal(user.paradise.phase, 'altar'); assert.equal(user.paradise.enemy, null);
    }
    for (const [roll, expected] of [[0,'chest'],[.3999,'chest'],[.4,'drop'],[.5999,'drop'],[.6,'rocket'],[.7999,'rocket'],[.8,'rich'],[.999,'rich']]) {
        const user = await env.user(); env.hell.enter(user, env.hell.KEYS[0].name, () => .99);
        Object.assign(user.paradise, { floor: 11, phase: 'altar', dropsRemaining: 0 });
        assert.ok(env.hell.continueAltar(user).error); env.hell.altar(user, () => roll);
        assert.equal(user.paradise.altarResult.id, expected); assert.ok(env.hell.altar(user).error);
        assert.equal(user.paradise.clearedFloor, 11);
        env.hell.continueAltar(user, () => .99);
        if (expected === 'drop') { assert.equal(user.paradise.phase, 'descent'); assert.equal(user.paradise.dropsRemaining, 1); }
        else {
            assert.equal(user.paradise.phase, 'chests');
            assert.equal(user.paradise.opensRemaining, expected === 'rocket' ? 1 : 2);
            if (expected === 'rich') assert.equal(user.paradise.chests.at(-1).rich, true);
        }
    }
});

test('지옥 최종 낙하 후에도 적을 처치해야 상자가 나오며 사망·귀환은 마지막 클리어 층으로 정산한다', async t => {
    const env = setupHell(t);
    let user = await env.user(); env.hell.enter(user, env.hell.KEYS[0].name, () => .99);
    corridor.victory(user); user.paradise.dropsRemaining = 1; env.hell.descend(user, 'left', () => .99);
    assert.equal(user.paradise.phase, 'combat'); assert.equal(user.paradise.dropsRemaining, 0); assert.ok(env.hell.openChest(user, 'fake').error);
    corridor.victory(user, () => .99); assert.equal(user.paradise.phase, 'chests'); assert.equal(user.paradise.chests.length, 3);
    for (const outcome of ['defeated','retired']) {
        user = await env.user(); env.hell.enter(user, env.hell.KEYS[0].name, () => .99);
        user.paradise.floor = 50; user.paradise.clearedFloor = 30;
        env.hell.finish(user, outcome, () => .99);
        assert.equal(user.paradise.chests[0].tier, 3); assert.equal(user.field, null); assert.equal(user.paradise.claimed, false);
        const ids = user.paradise.chests.map(c => c.id); env.hell.finish(user, outcome);
        assert.deepEqual(user.paradise.chests.map(c => c.id), ids);
    }
    user = await env.user(); env.hell.enter(user, env.hell.KEYS[0].name, () => .99); env.hell.finish(user, 'defeated');
    assert.equal(user.paradise.chests.length, 0); assert.equal(user.paradise.claimed, true);
});

test('지옥 보상표 11구간·9종의 실제 아이템과 카드 등급/수량 및 강화석을 지급한다', async t => {
    const env = setupHell(t), rows = require('../paradise_hell_content').INITIAL_CONFIG.rewards;
    for (const reward of rows) for (let tier = 0; tier <= 10; tier++) {
        const user = await env.user(); env.hell.enter(user, env.hell.KEYS[0].name, () => .99);
        user.paradise.rewardTable = [reward]; user.paradise.clearedFloor = tier ? tier * 10 : 1;
        env.hell.finish(user, 'cleared', () => .99); const chest = user.paradise.chests[0];
        assert.equal(chest.tier, tier); assert.equal(chest.rich, false);
        assert.equal(env.hell.openChest(user, chest.id).error, undefined);
        assert.equal(rpg.getInventoryItemCount(user, env.items.findIndex(item => item.name === '상급 강화석')), (tier + 1) * 10);
        if (reward.kind === 'card') {
            assert.equal(user.inventory.card.length, reward.counts[tier]);
            assert.ok(user.inventory.card.every(card => card.type === reward.cardType && card.star === reward.stars[tier] - 1));
        } else if (reward.kind === 'orb') assert.equal(user.paradise.rewardSummary.filter(row => row.kind === 'item' && env.items[row.id].use === '보주').reduce((n,r) => n + r.count, 0), reward.counts[tier]);
        else assert.equal(rpg.getInventoryItemCount(user, env.items.findIndex(item => item.name === (reward.items?.[tier] || reward.item))), reward.counts[tier]);
        assert.equal(user.paradise.claimed, true);
    }
});

test('제단 추가 상자는 후보와 개봉 횟수를 함께 늘리고 풍요는 강화석만 3배, 재접속·재전송에도 한 번씩 지급한다', async t => {
    const row = require('../paradise_hell_content').INITIAL_CONFIG.rewards.find(row => row.id === 'fragment');
    const env = setupHell(t, [row]), user = await env.user(); env.hell.enter(user, env.hell.KEYS[0].name, () => .99);
    Object.assign(user.paradise, { clearedFloor: 30, bonusChests: 1, richChests: 1 }); env.hell.finish(user, 'cleared', () => .99); await user.save();
    let state = (await request('/api/paradise')).data;
    assert.equal(state.run.chests.length, 5); assert.equal(state.run.opensRemaining, 3); assert.ok(state.run.chests.every(chest => !Object.hasOwn(chest, 'loot')));
    assert.equal(state.run.chests[4].rich, true); assert.equal(state.run.chests[4].stones, 120);
    const firstId = state.run.chests[0].id;
    for (const i of [0,1,4]) {
        const body = { ...bodyFor(state), chest: state.run.chests[i].id };
        const results = await Promise.all([request('/api/paradise/chest', body), request('/api/paradise/chest', body)]);
        assert.ok(results.every(r => r.status === 200), JSON.stringify(results)); state = (await request('/api/paradise')).data;
    }
    assert.equal(state.run.opensRemaining, 0); assert.equal(state.run.claimed, true);
    assert.equal((await request('/api/paradise/chest', { ...bodyFor(state), chest: firstId })).status, 400);
    const saved = await rpg.getRPGUserByName(account.name);
    assert.equal(rpg.getInventoryItemCount(saved, env.items.findIndex(item => item.name === '상급 강화석')), 200);
    assert.equal(rpg.getInventoryItemCount(saved, env.items.findIndex(item => item.name === '초월 조각')), 45);
    for (const [roll, rich] of [[.099,true],[.1,false]]) {
        const u = await env.user(); env.hell.enter(u, env.hell.KEYS[0].name, () => .99); u.paradise.clearedFloor = 1;
        env.hell.finish(u, 'cleared', () => roll); assert.equal(u.paradise.chests[0].rich, rich);
    }
});

test('지옥 카드 공간 부족은 상자를 보존하고 설정 등록은 기존 운영 값을 덮어쓰지 않는다', async t => {
    const initial = require('../paradise_hell_content').INITIAL_CONFIG, row = initial.rewards.find(row => row.id === 'normalCard');
    const env = setupHell(t, [row]), user = await env.user(); env.hell.enter(user, env.hell.KEYS[0].name, () => .99);
    user.paradise.clearedFloor = 30; env.hell.finish(user, 'retired', () => .99);
    const chest = user.paradise.chests[0], loot = structuredClone(chest.loot);
    user.maxCardLimit = 1; assert.ok(env.hell.openChest(user, chest.id).error); assert.equal(chest.opened, false); assert.deepEqual(chest.loot, loot);
    user.maxCardLimit = 52; assert.equal(env.hell.openChest(user, chest.id).error, undefined); assert.equal(user.inventory.card.length, 2);
    const { appendContent } = require('../scripts/register_paradise_content');
    const before = { Item: [{ name: '천상의 회랑 입장권', desc: '운영 설명' }], Paradise: { enabled: false, baseRewards: [], hell: { enabled: false, rewards: [] } } };
    assert.deepEqual(appendContent(before, false, true).after, before);
    assert.equal(env.hell.validateConfig(initial), null);
    assert.ok(env.hell.validateConfig({ ...initial, rewards: [{ ...row, counts: [1] }] }));
});

test('지옥 실제 공격의 승리·사망은 낙하 또는 정산으로 전환하고 서로 다른 동시 상자 요청은 하나만 적용한다', async t => {
    const env = setupHell(t), user = await env.user(); env.hell.enter(user, env.hell.KEYS[0].name, () => .99);
    user.paradise.enemy.hp = 1; await user.save();
    let state = (await request('/api/paradise')).data;
    let result = await request('/api/paradise/attack', bodyFor(state)); assert.equal(result.status, 200);
    assert.equal(result.data.state.run.phase, 'descent');
    const current = await rpg.getRPGUserByName(account.name);
    current.paradise.floor = 12; current.paradise.clearedFloor = 10; corridor.startCombat(current, 'boss', null, () => .99);
    current.paradise.enemy.hp = current.paradise.enemy.maxHp = 1e12; current.paradise.enemy.atk = 1e12; current.hp = 2;
    await current.save(); t.mock.method(Math, 'random', () => .99);
    state = (await request('/api/paradise')).data; result = await request('/api/paradise/attack', bodyFor(state));
    assert.equal(result.status, 200); state = result.data.state;
    assert.equal(state.player.hp, 1); assert.equal(state.run.outcome, 'defeated'); assert.equal(state.run.phase, 'chests'); assert.equal(state.run.chests[0].tier, 1);
    const requests = state.run.chests.slice(0, 2).map(chest => request('/api/paradise/chest', { ...bodyFor(state), chest: chest.id }));
    assert.deepEqual((await Promise.all(requests)).map(r => r.status).sort(), [200,409]);
    const after = (await request('/api/paradise')).data;
    assert.equal(after.run.chests.filter(chest => chest.opened).length, 1); assert.equal(after.run.opensRemaining, 0);
});
test('동시 입장·재전송은 입장권 한 장만 사용하고 재접속해도 같은 탐험이다', async () => {
    await reset(); const before = (await request('/api/paradise')).data, body = bodyFor(before);
    const results = await Promise.all([request('/api/paradise/enter', body), request('/api/paradise/enter', body)]);
    assert.ok(results.every(r => r.status === 200), JSON.stringify(results));
    const state = (await request('/api/paradise')).data;
    assert.equal(state.ticket.count, 2); assert.equal(state.run.floor, 1); assert.equal(state.run.enemy.kind, 'normal');
    assert.equal(results[0].data.state.runId, results[1].data.state.runId);
    const user = await rpg.getRPGUserByName(account.name), restored = new rpg.RPGUser().load(structuredClone(persisted.get(account.id)));
    assert.deepEqual(restored.paradise, user.paradise);
    const differentRequest = await request('/api/paradise/enter', bodyFor(state)); assert.equal(differentRequest.status, 400);
});
test('회랑은 현재 HP·MP와 관계없이 가득 찬 상태로 입장하고 전투마다 재충전하지 않는다', async () => {
    const user = await reset(); user.hp = 1; user.mp = 0; await user.save();
    const before = (await request('/api/paradise')).data;
    const result = await request('/api/paradise/enter', bodyFor(before));
    assert.equal(result.status, 200, JSON.stringify(result.data));
    const player = result.data.state.player;
    assert.equal(player.hp, player.maxHp); assert.equal(player.mp, player.maxMp);
    const saved = await rpg.getRPGUserByName(account.name);
    saved.hp = 10; saved.mp = 0; corridor.startCombat(saved, 'normal');
    assert.equal(saved.hp, 10); assert.equal(saved.mp, 0);
    const blocked = await reset(); blocked.hp = 1; blocked.mp = 0;
    rpg.removeInventoryItem(blocked, data.Item.length - 1, 3);
    assert.ok(corridor.enter(blocked).error);
    assert.equal(blocked.hp, 1); assert.equal(blocked.mp, 0);
});

test('권장 전투력의 모든 기준층과 엘리트 1.2배가 실제 몬스터 스탯에 적용된다', async () => {
    const user = await reset(); corridor.enter(user, () => .99);
    for (const [floor, cp] of corridor.CP_ANCHORS) {
        user.paradise.floor = floor;
        assert.equal(corridor.recommendedPower(floor), cp);
        corridor.startCombat(user, 'normal', null, () => .99);
        const normal = user.paradise.enemy;
        assert.equal(normal.recommendedPower, cp);
        assert.ok(Math.abs(rpg.getDungeonRecommendedCP(normal) - cp) / cp < .02, String(floor));
        corridor.startCombat(user, 'elite', null, () => .99);
        assert.equal(user.paradise.enemy.recommendedPower, cp * 1.2);
    }
});
test('실제 일반 공격으로 승리하면 세 강화가 나타나고 동일 선택을 재전송해도 중복 획득하지 않는다', async () => {
    let user = await reset(); corridor.enter(user, () => .99);
    user.paradise.enemy.hp = 1; await user.save();
    let state = (await request('/api/paradise')).data;
    const attacked = await request('/api/paradise/attack', bodyFor(state));
    assert.equal(attacked.status, 200, JSON.stringify(attacked.data)); state = attacked.data.state;
    assert.equal(state.run.phase, 'augment'); assert.equal(state.run.choices.length, 3);
    const choice = state.run.choices[0], body = { ...bodyFor(state), choice: choice.id };
    const first = await request('/api/paradise/augment', body); assert.equal(first.status, 200, JSON.stringify(first.data));
    const second = await request('/api/paradise/augment', body); assert.equal(second.status, 200);
    user = await rpg.getRPGUserByName(account.name); assert.equal(user.paradise.acquired[choice.id], 1);
    const stale = await request('/api/paradise/augment', { ...body, requestId: crypto.randomUUID() }); assert.equal(stale.status, 409);
});
test('시간제 강화는 승리 횟수로 소모되고 미래의 대가는 3승 뒤 엘리트를 강제한다', async () => {
    const user = await reset(); corridor.enter(user, () => .99); buff(user, 'future');
    for (let i = 0; i < 3; i++) {
        assert.equal(user.paradise.temporary.find(b => b.id === 'future').battles, 3 - i);
        corridor.victory(user, () => .99);
        if (i < 2) corridor.startCombat(user, 'normal', null, () => .99);
    }
    assert.equal(user.paradise.temporary.some(b => b.id === 'future'), false);
    corridor.nextEncounter(user, () => .99); assert.equal(user.paradise.enemy.kind, 'elite');
});
test('뒤틀림·유물의 이동 효과와 붕괴 세 갈래가 적용된다', async () => {
    for (const choice of ['prevent', 'accept', 'rift']) {
        const user = await reset(); corridor.enter(user, () => .99);
        user.paradise.relics = ['compass', 'ring'];
        corridor.move(user, 5); assert.equal(user.paradise.distortion, 0);
        corridor.move(user, 15); assert.equal(user.paradise.distortion, 5);
        corridor.move(user, 30); assert.equal(user.paradise.distortion, 20); assert.equal(user.paradise.ring, .05);
        corridor.move(user, -100); assert.equal(user.paradise.distortion, 15); assert.equal(user.paradise.floor, 1); assert.equal(user.paradise.compass, .04);
        user.paradise.distortion = 100; corridor.nextEncounter(user, () => .99); assert.equal(user.paradise.event.id, 'collapse');
        corridor.chooseEvent(user, choice, {}, () => .99);
        if (choice === 'accept') { assert.equal(user.paradise.battle.doubledReward, true); assert.equal(user.paradise.temporary.find(b => b.id === 'collapse').battles, 3); }
        else if (choice === 'rift') assert.equal(user.paradise.enemy.kind, 'rift');
        else assert.equal(user.paradise.distortion, 50);
    }
});
test('퍼즐 정답·오답·무시·서버 시간 초과, 정답 비공개를 검증한다', async () => {
    for (const outcome of ['correct', 'wrong', 'skip', 'timeout']) {
        const user = await reset(); corridor.enter(user, () => .99); forceEvent(user, 'puzzle');
        corridor.chooseEvent(user, 'solve'); const event = user.paradise.event;
        assert.equal(corridor.view(user).run.event.puzzle.solution, undefined);
        const beforeHp = user.hp;
        if (outcome === 'timeout') event.deadline = Date.now() - 1;
        const wrong = event.puzzle.solution.split('').reverse().join('');
        let answer = outcome === 'skip' ? null : outcome === 'wrong' ? wrong : event.puzzle.solution;
        if (answer === event.puzzle.solution && outcome === 'wrong') answer = event.puzzle.solution.slice(1) + event.puzzle.solution[0];
        const result = corridor.answerPuzzle(user, answer, () => .99);
        assert.equal(result.error, undefined); assert.equal(user.paradise.phase, 'augment');
        if (['wrong', 'timeout'].includes(outcome)) assert.ok(user.hp < beforeHp);
        else assert.ok(user.hp >= beforeHp);
    }
});
test('대장장이는 장착 가능한 수치형 패시브만 제시하고 원본 장비 정의를 변경하지 않는다', async () => {
    const user = await reset(); corridor.enter(user, () => .99);
    assert.deepEqual(corridor.equipmentOptions(user), []);
    const name = '마나번 햇', id = data.Equipment.hat.findIndex(e => e.name === name);
    user.equipments.hat = { id, level: 0, transcendStage: 1 };
    assert.ok(corridor.equipmentOptions(user).some(e => e.name === name));
    const before = structuredClone(rpg.getDataCache('Equipment', {}));
    forceEvent(user, 'forge', { equipment: name }); corridor.chooseEvent(user, 'enhance', {}, () => .99);
    assert.equal(corridor.equipmentMultiplier(user, name), 2); assert.equal(user.paradise.nextEliteHp, true);
    const state = rpg.prepareTranscendSkillEffects(user, { name: 'test' }, rpg.calculateUserStats(user));
    assert.ok(state); assert.deepEqual(rpg.getDataCache('Equipment', {}), before);
});
test('거울 적은 회랑 강화 없이 동일 스탯·장비·스킬과 100% HP·MP를 가진다', async () => {
    const user = await reset(); const base = rpg.calculateUserStats(user);
    corridor.enter(user, () => .99); corridor.addEffect(user, { atk: 2, hp: .5 }); user.hp = 1;
    forceEvent(user, 'mirror'); corridor.chooseEvent(user, 'fight', {}, () => .99);
    const enemy = user.paradise.enemy;
    assert.equal(enemy.atk, base.atk); assert.equal(enemy.maxHp, base.hp); assert.equal(enemy.hp, base.hp); assert.equal(enemy.mp, base.mp);
    assert.equal(enemy.mirror.snapshot.skillIndexes.length, rpg.getMainCardSkills(user).length);
    assert.equal(corridor.view(user).run.enemy.mirror, undefined);
});
test('연속 전투 보상은 마지막 승리 후 지급하고 999층 마지막 전투 승리로만 완주한다', async () => {
    const user = await reset(); corridor.enter(user, () => .99); forceEvent(user, 'judge'); corridor.chooseEvent(user, 'three', {}, () => .99);
    corridor.victory(user, () => .99); assert.equal(user.paradise.phase, 'combat'); assert.equal(user.paradise.effects.atk, undefined);
    corridor.victory(user, () => .99); assert.equal(user.paradise.phase, 'combat');
    corridor.victory(user, () => .99); assert.equal(user.paradise.effects.atk, .15); assert.equal(user.paradise.phase, 'augment');
    user.paradise.floor = 998; user.paradise.choices = ['blade']; corridor.chooseAugment(user, 'blade', () => .99);
    assert.equal(user.paradise.floor, 999); assert.equal(user.paradise.enemy.kind, 'final'); assert.equal(user.paradise.status, 'active');
    corridor.victory(user, () => .99); assert.equal(user.paradise.outcome, 'cleared'); assert.equal(user.field, null);
});
test('종료 기본 보상과 5성/9성 계약을 정확한 등급으로 한 번만 지급한다', async () => {
    const user = await reset(); corridor.enter(user, () => .99); user.paradise.clearedFloor = 20;
    user.paradise.contracts = [{ star: 5, type: '전직', name: '5성 전직 카드' }, { star: 9, type: '전직', name: '9성 전직 카드' }];
    user.paradise.effects.reward = .30; corridor.finish(user); await user.save();
    const beforeGold = user.gold;
    const state = (await request('/api/paradise')).data, body = bodyFor(state);
    const result = await request('/api/paradise/claim', body); assert.equal(result.status, 200, JSON.stringify(result.data));
    const repeat = await request('/api/paradise/claim', body); assert.equal(repeat.status, 200);
    const latest = await rpg.getRPGUserByName(account.name);
    assert.equal(latest.gold - beforeGold, 2600); assert.deepEqual(latest.inventory.card.map(c => c.star), [4, 8]);
    assert.ok(latest.inventory.card.every(c => c.type === '전직'));
});
test('악마의 거래는 HP·MP 회복을 막고 불굴/보험/깃털 생존을 순서대로 한 번씩 처리한다', async () => {
    const user = await reset(); corridor.enter(user, () => .99);
    Object.assign(user.paradise.effects, { noHealing: 1, unyielding: 1 }); user.hp = 1; user.mp = 0;
    corridor.heal(user, 1, 1); assert.equal(user.hp, 1); assert.equal(user.mp, 0);
    assert.equal(rpg.isBlackCurtainHealingBlocked(user), true);
    user.paradise.battle.insurance = true; user.paradise.relics.push('feather');
    assert.equal(corridor.survive(user, 0, 1000), 1); assert.equal(corridor.survive(user, 0, 1000), 1); assert.equal(corridor.survive(user, 0, 1000), 1); assert.equal(corridor.survive(user, 0, 1000), 0);
});
test('기본 운영 보상 설정은 검증하며 빈 보상과 입장 차단 설정을 보존한다', async () => {
    assert.equal(corridor.validateConfig({ enabled: false, baseRewards: [] }), null);
    assert.match(corridor.validateConfig({ enabled: true, baseRewards: [{ type: '골드', count: -1, perFloors: 1 }] }), /양의 정수/);
    assert.ok(writes.every(write => write.TableName === 'rpgenius_user'));
});

test('장비별 증강은 실제 패시브 수치를 증폭하며 마나 추첨·기본 장비 스탯은 그대로다', async t => {
    t.mock.method(Math, 'random', () => .01);
    for (const [slot, name, id, stateKey, amount] of [
        ['hat', '마나번 햇', 'manaHat', 'manaBurnAttackBuff', .15],
        ['hat', '핏빛 모자', 'bloodHat', 'bloodHatBuff', .18]
    ]) {
        const user = await reset(); user.equipments[slot] = { id: data.Equipment[slot].findIndex(e => e.name === name), level: 0 };
        corridor.enter(user, () => .99); buff(user, id);
        const context = rpg.getFieldCombatContext(user), extra = {};
        rpg.applyTranscendPreAttack(user, context, 100, extra, 'basic');
        assert.equal(user.field.equipmentState[stateKey].value, amount * 2, name);
    }
    const user = await reset();
    user.equipments.accessory = { 0: { id: data.Equipment.accessory.findIndex(e => e.name === '운명의 주사위'), level: 0 } };
    corridor.enter(user, () => .99); buff(user, 'dice');
    const prepared = rpg.prepareTranscendSkillEffects(user, { name: 'test' }, rpg.calculateUserStats(user));
    assert.ok(Math.abs(prepared.extra.critChanceBonus - .15 * 1.5) < 1e-9);
    const shoes = data.Equipment.shoes.findIndex(e => e.name === '심해의 신발');
    user.equipments.shoes = { id: shoes, level: 0 }; buff(user, 'shoes');
    const boostedShoes = rpg.prepareTranscendSkillEffects(user, { name: 'test' }, rpg.calculateUserStats(user));
    assert.equal(boostedShoes.selfCooldownRate, .08);
});
test('첫 타격·처형·역전·집중·마력 순환·첫 스킬 시계는 전투 규칙대로 적용된다', async t => {
    const user = await reset(); corridor.enter(user, () => .99);
    Object.assign(user.paradise.effects, { firstStrike: 1, execution: 1, comeback: 1, manaCycle: 1 });
    user.paradise.battle.comeback = .7;
    assert.equal(corridor.attackMultiplier(user, {}), 2 * 1.30);
    assert.equal(corridor.attackMultiplier(user, {}), 1);
    user.paradise.enemy.hp = user.paradise.enemy.maxHp * .20;
    assert.equal(corridor.attackMultiplier(user, {}), 1.5);
    user.mp = 0; corridor.onSkillUsed(user, 50); assert.equal(user.mp, 10);
    user.paradise.relics.push('clock');
    user.paradise.temporary.push({ id: 'forbidden', battles: 1 });
    assert.equal(corridor.cooldownMultiplier(user), .25); assert.equal(corridor.cooldownMultiplier(user), .50);
    user.paradise.effects.focus = 1;
    user.paradise.enemy.hp = user.paradise.enemy.maxHp = 10000000; user.paradise.enemy.atk = 0;
    t.mock.method(Math, 'random', () => 0);
    rpg.buildHuntResult(user, {}, 10, { forceCritical: true, hitCount: 1, isBasic: true });
    assert.equal(user.paradise.focus, .05);
});
test('실제 스킬 사용은 MP 환급·쿨타임 감소를 적용하며 거울 AI도 같은 스킬을 사용한다', async t => {
    const user = await reset(); corridor.enter(user, () => .99);
    user.paradise.enemy.hp = user.paradise.enemy.maxHp = 10000000; user.paradise.enemy.atk = 0;
    const skill = rpg.getMainCardSkills(user)[0].skill;
    user.paradise.effects.manaCycle = 1; user.paradise.relics.push('clock');
    const mp = user.mp, time = Date.now();
    const message = await rpg.useSkillInField(user, skill.name);
    assert.ok(!message.startsWith('❌'), message);
    assert.equal(user.mp, mp - skill.mp_cost + Math.floor(skill.mp_cost * .20));
    assert.ok(user.field.skillCooldowns[skill.name] - time <= skill.cooltime * .5 + 100);
    const pvp = require('../pvp');
    const copy = pvp.createCorridorMirror({ ...user, paradise: null, field: null });
    const response = pvp.corridorMirrorTurn(copy, user, rpg.calculateUserStats(user), copy.hp);
    assert.ok(Number.isFinite(response.damage)); assert.ok(response.messages.length); assert.ok(response.mp < copy.maxMp);
});
test('카드 공간 부족은 계약을 소모하지 않고, 신규 등록은 기존 운영 항목과 빈 구성을 보존한다', async () => {
    const { appendContent } = require('../scripts/register_paradise_content');
    const first = appendContent({ Item: [{ name: '기존 아이템' }] }); assert.equal(first.ticketId, 1);
    first.after.Item[1].desc = '운영자 변경'; first.after.Paradise = { enabled: false, baseRewards: [] };
    assert.deepEqual(appendContent(first.after).after, first.after);
    const user = await reset(); corridor.enter(user, () => .99);
    user.paradise.contracts.push({ star: 5, type: '전직' }); corridor.finish(user);
    user.maxCardLimit = 1; user.inventory.card.push({ id: 0, star: 0, type: '일반' });
    assert.match(corridor.claim(user).error, /공간/); assert.equal(user.paradise.claimed, undefined);
    user.inventory.card = []; assert.equal(corridor.claim(user).error, undefined);
});
test('전투 사망 후에도 계약이 남고 다음 탐험에 회랑 강화가 유출되지 않는다', async () => {
    const user = await reset(), original = rpg.calculateUserStats(user);
    corridor.enter(user, () => .99); corridor.addEffect(user, { atk: 1, hp: .5 });
    user.paradise.contracts.push({ star: 5, type: '전직' }); user.paradise.enemy.hp = 10000000; user.paradise.enemy.atk = 1e12; user.hp = 1;
    rpg.buildHuntResult(user, {}, 1, { isBasic: true });
    assert.equal(user.paradise.outcome, 'defeated'); assert.equal(user.paradise.contracts.length, 1); assert.equal(user.hp, 1);
    assert.equal(rpg.calculateUserStats(user).atk, original.atk);
});

test('추가 장비 전용 증강 15개도 유효 장착 장비만 제시하며 실제 공격/보호막 수치를 강화한다', async t => {
    const additions = corridor.AUGMENTS.filter(a => a.equipment).slice(7);
    assert.equal(additions.length, 15);
    const user = await reset(); corridor.enter(user, () => .99);
    const offered = new Set();
    for (let i = 0; i < 40; i++) { corridor.offerAugments(user); user.paradise.choices.forEach(id => offered.add(id)); }
    assert.ok([...offered].every(id => !corridor.AUGMENTS.find(a => a.id === id).equipment));
    const armorId = data.Equipment.armor.findIndex(e => e.name === '심해의 갑옷');
    user.equipments.armor = { id: armorId, level: 0 };
    const beforeStats = rpg.calculateUserStats(user), skill = { name: 'test' };
    const baseShield = rpg.prepareTranscendSkillEffects(user, skill, beforeStats).selfShield.amount;
    buff(user, 'deepArmor');
    const boostedShield = rpg.prepareTranscendSkillEffects(user, skill, rpg.calculateUserStats(user)).selfShield.amount;
    assert.ok(Math.abs(boostedShield - baseShield * 2) <= 1);
    user.equipments.accessory = { 0: { id: data.Equipment.accessory.findIndex(e => e.name === '예고의 예고'), level: 0 } };
    buff(user, 'foreshadow'); user.field.equipmentState.attackCount = 1;
    const extra = {}; rpg.applyTranscendPreAttack(user, rpg.getFieldCombatContext(user), 100, extra, 'basic');
    assert.equal(extra.perAttackUnitExtras[0].extraDamageBonus, .30);
    assert.equal(corridor.equipmentOptions(user).some(e => e.name === '예고의 예고'), true);
});
test('주간 최고 도달층은 하락·패배·재입장으로 낮아지지 않고 원자적 저장에 포함된다', async () => {
    const user = await reset(); corridor.enter(user, () => .99); assert.equal(corridor.weeklyInfo(user).bestFloor, 1);
    corridor.move(user, 100); assert.equal(corridor.weeklyInfo(user).bestFloor, 101);
    corridor.move(user, -20); assert.equal(corridor.weeklyInfo(user).bestFloor, 101);
    corridor.finish(user, 'defeated'); assert.equal(corridor.weeklyInfo(user).bestFloor, 101);
    user.paradise.claimed = true; user.hp = rpg.calculateUserStats(user).hp; corridor.enter(user, () => .99);
    assert.equal(corridor.weeklyInfo(user).bestFloor, 101);
    await user.save(); const state = (await request('/api/paradise')).data;
    assert.equal(state.weekly.bestFloor, 101);
    const result = await request('/api/paradise/retire', bodyFor(state)); assert.equal(result.status, 200);
    assert.equal(persisted.get(account.id).paradiseWeekly.bestFloor, 101);
});
test('주간 초기화는 월요일 00:00 KST의 기존 주간 키와 연말 주차 전환을 그대로 따른다', async () => {
    const user = await reset(); corridor.enter(user, () => .99); user.paradise.floor = 800;
    const sunday = new Date('2026-10-18T23:59:59.999+09:00'), monday = new Date('2026-10-19T00:00:00+09:00');
    corridor.recordFloor(user, sunday);
    assert.equal(corridor.weeklyInfo(user, sunday).bestFloor, 800);
    assert.equal(corridor.weeklyInfo(user, sunday).resetsAt, monday.getTime());
    assert.equal(corridor.weeklyInfo(user, monday).bestFloor, 0);
    user.paradise.floor = 12; corridor.recordFloor(user, monday); assert.equal(corridor.weeklyInfo(user, monday).bestFloor, 12);
    assert.equal(user.paradiseWeeklyHistory[rpg.getKoreanWeekKey(sunday)].bestFloor, 800);
    for (const date of ['2026-12-31T23:59:59+09:00', '2027-01-04T00:00:00+09:00']) assert.equal(corridor.weeklyInfo(user, new Date(date)).week, rpg.getKoreanWeekKey(new Date(date)));
});
test('주간 순위는 최고층 내림차순·동층 먼저 도달 순이며 지난 주 기록은 제외한다', async () => {
    const user = await reset(), date = new Date('2026-10-19T01:00:00+09:00'), week = rpg.getKoreanWeekKey(date);
    const rows = [
        { name: '먼저', paradiseWeekly: { week, bestFloor: 500, reachedAt: 1 } },
        { name: '나중', paradiseWeekly: { week, bestFloor: 500, reachedAt: 2 } },
        { name: '정상', paradiseWeekly: { week, bestFloor: 999, reachedAt: 3 } },
        { name: '지난주', paradiseWeekly: { week: '2026-W41', bestFloor: 999, reachedAt: 0 } }
    ];
    assert.deepEqual(corridor.buildWeeklyRanking(rows, rows[1], date).rows.map(r => [r.rank, r.name]), [[1, '정상'], [2, '먼저'], [3, '나중']]);
    assert.equal(corridor.buildWeeklyRanking(rows, rows[1], date).me.rank, 3);
    assert.equal((await request('/api/paradise/ranking', undefined, false)).status, 401);
    const state = (await request('/api/paradise/ranking')).data; assert.ok(Array.isArray(state.rows)); assert.equal(state.week, rpg.getKoreanWeekKey(new Date()));
});

test('잊혀진 검집은 무기 기본 공격력 대신 실제 수치형 패시브만 증폭한다', async () => {
    const user = await reset(); user.equipments.weapon = { id: data.Equipment.weapon.findIndex(e => e.name === '궁택토'), level: 0 };
    corridor.enter(user, () => .99); const before = rpg.calculateUserStats(user), definition = structuredClone(rpg.getEquipmentData('weapon', user.equipments.weapon.id));
    user.paradise.relics.push('sheath'); const after = rpg.calculateUserStats(user);
    assert.ok(Math.abs(after.afterSkill - before.afterSkill - definition.plusStat.afterSkill * .20) < 1e-9);
    assert.equal(after.atk, before.atk); assert.deepEqual(rpg.getEquipmentData('weapon', user.equipments.weapon.id), definition);
});

test('거울은 자신의 보호막으로 피해를 흡수하고 소환수의 예약 공격도 실행한다', async t => {
    const user = await reset(); corridor.enter(user, () => .99);
    const pvp = require('../pvp'), mirror = pvp.createCorridorMirror({ ...user, field: null, paradise: null });
    mirror.shield = { amount: 1000, until: Date.now() + 60000 };
    t.mock.method(Math, 'random', () => .99);
    const hp = mirror.hp, blocked = pvp.corridorMirrorHit(mirror, user, 100, {});
    assert.equal(blocked.damage, 0); assert.equal(mirror.hp, hp); assert.equal(mirror.shield.amount, 900);
    mirror.runtime.summon = { name: '익테봇', atkMul: 1, hp: 1000, nextAttackAt: Date.now() - 1, until: Date.now() + 50000 };
    mirror.nextActionAt = Date.now() + 30000;
    const result = pvp.corridorMirrorTurn(mirror, user, rpg.calculateUserStats(user), mirror.hp);
    assert.ok(result.messages.some(text => text.includes('익테봇'))); assert.ok(result.damage > 0);
});

test('붕괴 수락은 사건 전투의 강화와 특별 보스의 카드 계약·유물 보상도 두 배로 지급한다', async () => {
    for (const [event, choice, effect, amount] of [['mirror', 'fight', 'atk', .40], ['judge', 'three', 'atk', .30], ['well', 'destroy', 'hp', .20], ['judge', 'boss'], ['collapse', 'rift']]) {
        const user = await reset(); corridor.enter(user, () => .99);
        user.paradise.temporary.push({ id: 'collapse', battles: 3 });
        forceEvent(user, event); const result = corridor.chooseEvent(user, choice, {}, () => .99);
        assert.equal(result.error, undefined);
        while (user.paradise.phase === 'combat') corridor.victory(user, () => .99);
        if (effect) assert.equal(user.paradise.effects[effect], amount, event);
        else { assert.equal(user.paradise.contracts.filter(c => c.star).length, 2); assert.equal(user.paradise.relics.length, 2); }
        if (event === 'mirror') assert.equal(user.paradise.contracts[0].bonus, .60);
    }
});

test('이동 후 권장 전투력이 현재 전투력의 1.5배 이상일 때만 경고한다', async t => {
    const user = await reset(); corridor.enter(user, () => .99);
    let playerPower = 100000;
    t.mock.method(rpg, 'calculateCombatPower', () => ({ total: playerPower }));
    user.paradise.floor = 9; user.paradise.phase = 'augment'; user.paradise.choices = ['contract', 'rest', 'rewind'];
    const choices = corridor.view(user).run.choices;
    assert.equal(choices[0].powerWarning, null);
    assert.equal(choices[1].powerWarning, null); assert.equal(choices[2].powerWarning, null);
    user.paradise.floor = 12; // 계약 +3층: 150,000, 정확히 1.5배.
    assert.equal(corridor.view(user).run.choices[0].powerWarning.floor, 15);
    playerPower = 100001;
    assert.equal(corridor.view(user).run.choices[0].powerWarning, null);
    playerPower = 99999;
    assert.equal(corridor.view(user).run.choices[0].powerWarning.floor, 15);
    playerPower = 100000; user.paradise.floor = 9;
    forceEvent(user, 'casino'); const events = corridor.view(user).run.event.choices;
    assert.equal(events[0].powerWarning.conditional, true); assert.equal(events[1].powerWarning.floor, 59);
    user.paradise.floor = 990; user.paradise.phase = 'augment'; user.paradise.choices = ['forbidden'];
    assert.equal(corridor.view(user).run.choices[0].powerWarning.floor, 999);
});

test('달성 보상은 최고 도달 구간 한 개만 정산하며 하락·재요청으로 변경되지 않는다', async t => {
    const { milestoneRewards } = require('../scripts/register_paradise_content');
    const get = rpg.getDataCache;
    const items = [...data.Item, { name: '천상의 증표', type: '재료' }];
    t.mock.method(rpg, 'getDataCache', (key, fallback) => key === 'Paradise' ? { enabled: true, baseRewards: [], milestoneRewards } : key === 'Item' ? items : get(key, fallback));
    for (const milestone of milestoneRewards) {
        const user = await reset(); corridor.enter(user, () => .99); corridor.move(user, milestone.floor - 1);
        if (milestone.floor > 10) corridor.move(user, -10);
        corridor.finish(user); const rewards = corridor.view(user).run.rewards;
        assert.deepEqual(rewards.map(r => [r.name, r.count]), [['천상의 증표', milestone.count]]);
        corridor.claim(user); corridor.claim(user);
        assert.equal(rpg.getInventoryItemCount(user, items.length - 1), milestone.count);
    }
});

test('주간 순위 보상은 참가상을 더해 우편 발송하고 재시작·동시 재시도에도 한 번만 지급한다', async t => {
    const { weeklyRewards, rewardItems } = require('../scripts/register_paradise_content');
    const get = rpg.getDataCache, items = [...data.Item, ...rewardItems];
    t.mock.method(rpg, 'getDataCache', (key, fallback) => key === 'Paradise' ? { enabled: true, baseRewards: [], weeklyRewards } : key === 'Item' ? items : get(key, fallback));
    const week = '2026-W44';
    for (let i = 1; i <= 6; i++) persisted.set('weekly-' + i, { ...structuredClone(account), id: 'weekly-' + i, name: 'weekly-' + i, paradiseWeekly: { week, bestFloor: 1000 - i, reachedAt: i }, mail: [] });
    const rewards = require('../paradise_rewards');
    await rewards.settleWeekly(new Date('2026-11-01T23:59:59+09:00'));
    assert.equal(persisted.get('weekly-1').mail.length, 0);
    failMailFor = 'weekly-2';
    await assert.rejects(rewards.settleWeekly(new Date('2026-11-02T00:00:00+09:00')), /simulated mail outage/);
    assert.equal(persisted.get('weekly-1').mail.length, 1);
    assert.equal(data['ParadiseSettlement:' + week].completedAt, undefined);
    await Promise.all([rewards.settleWeekly(new Date('2026-11-02T00:00:00+09:00')), rewards.settleWeekly(new Date('2026-11-02T00:00:00+09:00'))]);
    for (let i = 1; i <= 6; i++) {
        const user = persisted.get('weekly-' + i); assert.equal(user.mail.length, 1);
        const gifts = mailRecords.get(user.mail[0].id).gifts;
        assert.equal(gifts.filter(g => g.type === 'garnet').reduce((sum,g)=>sum+g.amount,0), i === 1 ? 2000 : i === 2 ? 1000 : i <= 5 ? 500 : 0);
        assert.equal(gifts.filter(g => g.type === 'item' && items[g.id].name === '지옥 열쇠').reduce((sum,g)=>sum+g.count,0), i >= 3 && i <= 5 ? 6 : 3);
    }
    delete data['ParadiseSettlement:' + week].completedAt; // 우편 발송 후 완료 표식 저장 전에 재시작된 경우
    delete require.cache[require.resolve('../paradise_rewards')];
    await require('../paradise_rewards').settleWeekly(new Date('2026-11-02T00:01:00+09:00'));
    assert.equal(persisted.get('weekly-1').mail.length, 1);
    const winner = await rpg.getRPGUserByName('weekly-1');
    const id = winner.mail[0].id;
    assert.equal((await rpg.claimMailGifts(winner, id)).ok, true);
    assert.equal((await rpg.claimMailGifts(winner, id)).error, '이미 선물을 수령했습니다.');
    assert.equal(winner.garnet, 2000);
    for (let i = 1; i <= 6; i++) persisted.delete('weekly-' + i);
});
