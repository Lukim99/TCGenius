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
    user.field = null; user.paradise = null; user.paradiseReceipt = null; user.paradiseWeekly = null; user.paradiseProgression = null; user.paradiseProgressionReceipt = null; user.paradiseShop = null; user.paradiseShopReceipt = null; user.isAdmin = false;
    const stats = rpg.calculateUserStats(user); corridor.getResources(user).hp = stats.hp; corridor.getResources(user).mp = stats.mp;
    rpg.addInventoryItem(user, data.Item.length - 1, 3);
    await user.save(); return user;
}
const bodyFor = state => ({ requestId: crypto.randomUUID(), runId: state.runId, revision: state.revision });
function progressionEnvironment(t) {
    const progression = require('../paradise_progression'), get = rpg.getDataCache;
    const items = [...get('Item')];
    if (!items.some(i => i.name === progression.TOKEN)) items.push({ name: progression.TOKEN, type: '재료' });
    const token = items.findIndex(i => i.name === progression.TOKEN);
    const config = { ...get('Paradise'), milestoneRewards: [{ floor: 1, name: progression.TOKEN, count: 100 }, { floor: 10, name: progression.TOKEN, count: 200 }] };
    t.mock.method(rpg, 'getDataCache', (key, fallback) => key === 'Item' ? items : key === 'Paradise' ? config : get(key, fallback));
    return { progression, token, config, async user(traits = []) {
        const user = await reset(); rpg.addInventoryItem(user, token, 50000);
        user.paradiseProgression = { revision: 0, weapon: null, armor: null, traits };
        await user.save(); return user;
    } };
}
function forceEvent(user, id, extra = {}) { user.paradise.phase = 'event'; user.paradise.event = { id, ...extra }; }
function buff(user, id) { user.paradise.phase = 'augment'; user.paradise.choices = [id]; return corridor.chooseAugment(user, id, () => .99); }
const routeGimmicks = require('../paradise_routes');
function specialRoute(user, gimmick, kind = 'normal') {
    user.paradise.phase = 'route'; user.paradise.routes = [{ id: 'special-route', kind, gimmick }];
    return corridor.chooseRoute(user, 'special-route', () => .99);
}

test('갈림길은 독립 추첨하며 이벤트 15%와 기믹 20%의 경계를 지킨다', async () => {
    const user = await reset(); corridor.enter(user);
    assert.equal(routeGimmicks.GIMMICKS.length, 30);
    assert.equal(new Set(routeGimmicks.GIMMICKS.map(g => g.id)).size, 30);
    for (const distortion of [0, 25]) {
        user.paradise.distortion = distortion;
        const counts = { normal: 0, elite: 0, event: 0 };
        for (let i = 0; i < 20; i++) {
            const values = [(i + .5) / 20, .20, (i + .5) / 20, .20];
            corridor.offerRoutes(user, () => values.shift());
            assert.equal(user.paradise.routes[0].kind, user.paradise.routes[1].kind);
            for (const route of user.paradise.routes) { counts[route.kind]++; assert.equal(route.gimmick, null); }
        }
        assert.deepEqual(counts, distortion ? { normal: 22, elite: 12, event: 6 } : { normal: 28, elite: 6, event: 6 });
    }
    for (const kindRoll of [.01, .20, .90]) {
        const values = [kindRoll, .1999, .10, kindRoll, .20];
        corridor.offerRoutes(user, () => values.shift());
        assert.ok(user.paradise.routes[0].gimmick); assert.equal(user.paradise.routes[1].gimmick, null);
        assert.notEqual(user.paradise.routes[0].id, user.paradise.routes[1].id);
    }
    // 일반 조우 경로에도 동일한 15% 기준을 적용한다.
    for (const [roll, phase, kind] of [[.1499, 'event'], [.15, 'combat', 'elite'], [.4499, 'combat', 'elite'], [.45, 'combat', 'normal']]) {
        corridor.nextEncounter(user, () => roll); assert.equal(user.paradise.phase, phase);
        if (kind) assert.equal(user.paradise.enemy.kind, kind);
    }
});

test('30종 기믹은 전투 종류와 보유 조건을 지키고 모든 보상을 마지막 완료에서만 지급한다', async () => {
    for (const gimmick of routeGimmicks.GIMMICKS) {
        const user = await reset(); user.main_card.type = '전직'; user.main_card.star = 9; corridor.enter(user, () => .99);
        assert.match(gimmick.rule, /니다\.$/); assert.match(gimmick.reward, /니다\.$/);
        assert.ok(!gimmick.rule.includes('·') && !gimmick.reward.includes('·'));
        const kind = gimmick.kinds[0]; specialRoute(user, gimmick.id, kind);
        assert.equal(user.paradise.routeEncounter.id, gimmick.id);
        if (kind === 'event') { forceEvent(user, 'mirror'); corridor.chooseEvent(user, 'skip', {}, () => .99); }
        if (kind !== 'event' || gimmick.id === 'eventAmbush') {
            const count = gimmick.sequence || 1;
            for (let i = 0; i < count; i++) {
                corridor.victory(user, () => .99);
                if (i < count - 1) { assert.equal(user.paradise.contracts.length, 0); assert.equal(user.paradise.phase, 'combat'); }
            }
        }
        assert.equal(user.paradise.routeEncounter, undefined, gimmick.id);
        assert.ok(['relic', 'augment'].includes(user.paradise.phase), gimmick.id);
        if (gimmick.prize?.star) assert.ok(user.paradise.contracts.some(c => c.star === gimmick.prize.star && c.type === gimmick.prize.type), gimmick.id);
        if (gimmick.prize?.bonus) assert.ok(user.paradise.contracts.some(c => c.bonus === gimmick.prize.bonus), gimmick.id);
        if (gimmick.prize?.relic) assert.ok(corridor.view(user).run.relicChoices.every(r => r.rarity === gimmick.prize.relic), gimmick.id);
        if (gimmick.category) assert.ok(corridor.view(user).run.choices.every(a => a.category === gimmick.category), gimmick.id);
        const contracts = structuredClone(user.paradise.contracts);
        routeGimmicks.complete(user, () => 0); assert.deepEqual(user.paradise.contracts, contracts);
    }
    const user = await reset(); corridor.enter(user);
    assert.ok(!routeGimmicks.eligible(user, 'normal').some(g => ['gildedElite', 'borrowedFinale'].includes(g.id)));
    for (const a of corridor.AUGMENTS.filter(a => a.category === 'dot')) user.paradise.acquired[a.id] = 1;
    assert.ok(!routeGimmicks.eligible(user, 'normal').some(g => g.id === 'ashOnly'));
    user.paradise.relics = corridor.RELICS.filter(r => r.rarity === 'advanced').map(r => r.id);
    assert.ok(!routeGimmicks.eligible(user, 'elite').some(g => g.id === 'gildedElite'));
});

test('기믹 적 스탯과 경고에 강화 수치를 반영하고 연속 전투는 패배층을 기록하지 않는다', async t => {
    const user = await reset(); corridor.enter(user, () => .99); const baseEnemy = structuredClone(user.paradise.enemy);
    specialRoute(user, 'bloodSeal');
    assert.equal(user.paradise.enemy.maxHp, Math.round(baseEnemy.maxHp * 1.35));
    assert.equal(user.paradise.enemy.atk, Math.round(baseEnemy.atk * 1.25));
    assert.equal(user.paradise.enemy.recommendedPower, rpg.computeCombatPowerFromStats(user.paradise.enemy).total);
    user.paradise.phase = 'route'; user.paradise.routes = [{ id: 'buffed', kind: 'normal', gimmick: 'bloodSeal' }, { id: 'plain', kind: 'normal' }];
    t.mock.method(rpg, 'calculateCombatPower', () => ({ total: 10000 }));
    assert.deepEqual(corridor.view(user).run.routes.map(r => r.powerWarning), [true, false]);
    user.paradise.floor = 30; specialRoute(user, 'twinHunt');
    const atk = rpg.calculateUserStats(user).atk;
    corridor.victory(user, () => .99);
    assert.equal(user.paradise.phase, 'combat'); assert.equal(user.paradise.routeEncounter.wins, 1);
    assert.equal(rpg.calculateUserStats(user).atk, atk);
    assert.equal(user.paradise.highestFloor, 0); assert.equal(user.paradise.contracts.length, 0);
    corridor.finish(user, 'defeated'); assert.equal(user.paradise.highestFloor, 0); assert.equal(corridor.weeklyInfo(user).bestFloor, 0);
    assert.equal(user.paradise.routeEncounter, undefined); assert.equal(corridor.view(user).run.canClaim, false);
});

test('특수 갈림길은 재접속과 중복 요청으로 비용이나 보상을 다시 적용하지 않는다', async t => {
    t.mock.method(Math, 'random', () => .99);
    let user = await reset(); corridor.enter(user);
    user.paradise.phase = 'route'; user.paradise.routes = [{ id: 'sealed-event', kind: 'event', gimmick: 'eventSeal' }]; await user.save();
    const before = (await request('/api/paradise')).data, hp = corridor.getResources(user).hp;
    assert.equal(before.run.routes[0].gimmick.id, 'eventSeal');
    const body = { ...bodyFor(before), choice: 'sealed-event', gimmick: 'gildedElite' };
    const chosen = await request('/api/paradise/route', body); assert.equal(chosen.status, 200);
    assert.equal(chosen.data.state.player.hp, Math.floor(hp * .9));
    const retried = await request('/api/paradise/route', body);
    assert.equal(retried.data.state.player.hp, chosen.data.state.player.hp);
    assert.equal((await request('/api/paradise')).data.run.routeGimmick.id, 'eventSeal');
    user = await rpg.getRPGUserByName(account.name); forceEvent(user, 'mirror'); await user.save();
    const state = (await request('/api/paradise')).data, finishBody = { ...bodyFor(state), choice: 'skip' };
    const done = await request('/api/paradise/event', finishBody);
    assert.equal(done.status, 200); assert.equal(done.data.state.run.contracts.filter(c => c.bonus === .05).length, 1);
    assert.deepEqual((await request('/api/paradise/event', finishBody)).data.state.run.contracts, done.data.state.run.contracts);
    assert.equal(persisted.get(account.id).paradise.routeEncounter, undefined);
    // 확정 고급 유물 선택권도 저장 후에만 제시하며 동일 요청은 다시 지급하지 않는다.
    user = await reset(); corridor.enter(user); specialRoute(user, 'gildedElite', 'elite');
    user.paradise = JSON.parse(JSON.stringify(user.paradise)); user.field = JSON.parse(JSON.stringify(user.field));
    corridor.victory(user, () => .99); await user.save();
    const draft = (await request('/api/paradise')).data;
    assert.equal(draft.run.relicChoices.length, 3); assert.ok(draft.run.relicChoices.every(r => r.rarity === 'advanced'));
    const pickBody = { ...bodyFor(draft), choice: draft.run.relicChoices[0].id };
    const selected = await request('/api/paradise/relic', pickBody);
    assert.equal(selected.status, 200); assert.equal(selected.data.state.run.relics.length, 1);
    assert.deepEqual((await request('/api/paradise/relic', pickBody)).data.state.run.relics, selected.data.state.run.relics);
});

test('이벤트 기믹의 비용, 확률 계약, 추가 전투와 퍼즐 완료는 한 방의 흐름을 유지한다', async () => {
    let user = await reset(); corridor.enter(user); corridor.getResources(user).hp = 10; corridor.getResources(user).mp = 0;
    specialRoute(user, 'eventLantern', 'event'); assert.equal(user.paradise.distortion, 10); assert.ok(corridor.getResources(user).hp > 10); assert.ok(corridor.getResources(user).mp > 0);
    specialRoute(user, 'eventPurity', 'event'); assert.equal(user.paradise.distortion, 0); assert.equal(corridor.getResources(user).mp, 0);
    const before = corridor.remainingTime(user.paradise); specialRoute(user, 'eventClock', 'event');
    const consumed = before - corridor.remainingTime(user.paradise); assert.ok(consumed >= 30000 && consumed < 31000);
    for (const [roll, star, type] of [[.8499, 5, '일반'], [.85, 6, '전직'], [.9799, 6, '전직'], [.98, 8, '일반']]) {
        user = await reset(); corridor.enter(user); specialRoute(user, 'eventDeed', 'event'); forceEvent(user, 'mirror');
        corridor.chooseEvent(user, 'skip', {}, () => roll);
        assert.deepEqual(user.paradise.contracts.map(c => [c.star, c.type]), [[star, type]]);
    }
    user = await reset(); corridor.enter(user); specialRoute(user, 'eventAmbush', 'event'); forceEvent(user, 'casino');
    corridor.chooseEvent(user, 'attack', {}, () => .99); corridor.victory(user, () => .99);
    assert.equal(user.paradise.phase, 'combat'); assert.equal(user.paradise.enemy.kind, 'normal');
    assert.equal(user.paradise.routeEncounter.ambushStarted, true); assert.equal(user.paradise.highestFloor, 0);
    corridor.victory(user, () => .99); assert.equal(user.paradise.phase, 'relic');
    assert.equal(user.paradise.routeEncounter, undefined); assert.equal(user.paradise.battlesWon, 2);
    user = await reset(); corridor.enter(user); specialRoute(user, 'eventSeal', 'event'); forceEvent(user, 'puzzle');
    corridor.chooseEvent(user, 'solve', {}, () => .99); assert.equal(user.paradise.phase, 'puzzle');
    assert.equal(user.paradise.contracts.length, 0);
    corridor.answerPuzzle(user, null, () => .99); assert.equal(user.paradise.contracts[0].bonus, .05);
});

test('무피해 계약과 시간 계약은 실제 달성 여부에 따라 보상이 달라지며 만료나 패배로 완료되지 않는다', async () => {
    for (const damaged of [false, true]) {
        const user = await reset(); corridor.enter(user); specialRoute(user, 'cleanHunt');
        user.paradise.routeEncounter.damaged = damaged; corridor.getResources(user).hp = 1;
        corridor.victory(user, () => .99);
        assert.equal(user.paradise.phase, damaged ? 'augment' : 'relic');
        if (damaged) assert.ok(corridor.getResources(user).hp > 1);
    }
    for (const [elapsed, star] of [[24000, 6], [26000, 5]]) {
        const user = await reset(); corridor.enter(user); specialRoute(user, 'fadingContract');
        user.paradise.routeEncounter.startedAt -= elapsed;
        corridor.victory(user, () => .99); assert.equal(user.paradise.contracts[0].star, star);
    }
    for (const outcome of ['defeated', 'timedOut']) {
        const user = await reset(); corridor.enter(user); specialRoute(user, 'bloodSeal');
        if (outcome === 'timedOut') user.paradise.clock.remainingMs = 0;
        corridor.finish(user, outcome); assert.equal(user.paradise.contracts.length, 0); assert.equal(user.paradise.routeEncounter, undefined);
    }
});

test('회랑 API는 인증이 필요하고 임의 상태 전이를 허용하지 않는다', async () => {
    await reset();
    assert.equal((await request('/api/paradise', undefined, false)).status, 401);
    assert.equal((await request('/api/paradise/enter', {}, false)).status, 401);
    assert.equal((await request('/api/paradise/enter', {})).status, 400);
    const state = (await request('/api/paradise')).data;
    assert.equal(state.ticket.count, 3); assert.equal(state.run, null);
    assert.equal((await request('/api/paradise/event', { ...bodyFor(state), choice: 'rift' })).status, 400);
});

test('배포 전에 열린 화면의 낙원 에셋 요청은 S3 동기화 경로로 연결한다', async () => {
    for (const file of ['corridor.webp', 'gambler.webp', 'audio/heaven.mp3']) {
        const response = await fetch(base + '/static/assets/paradise/' + file, { headers: { Cookie: cookie() }, redirect: 'manual' });
        assert.equal(response.status, 307);
        assert.equal(response.headers.get('location'), '/rpg-ui?file=' + encodeURIComponent('낙원/' + file));
    }
    const missing = await fetch(base + '/static/assets/paradise/missing.webp', { headers: { Cookie: cookie() }, redirect: 'manual' });
    assert.equal(missing.status, 404);
});

test('낙원 전투는 필드 HUD 데이터와 중복 재생 없는 실제 타격 사건을 전달한다', async () => {
    const user = await reset();
    corridor.enter(user); corridor.startCombat(user, 'judge'); await user.save();
    const before = (await request('/api/paradise')).data;
    assert.equal(before.run.enemy.sprite, '/rpg-ui?file=%EB%82%99%EC%9B%90%2Fjudge-boss.webp');
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

test('캐릭터 증강의 스킬 봉인과 무료 MP를 전투 HUD에 반영한다', async () => {
    let user = await reset();
    user.main_card = { id: 11, star: 9, type: '전직' };
    corridor.enter(user); buff(user, 'solitaryIktae'); corridor.startCombat(user, 'normal'); await user.save();
    const sealed = (await request('/api/paradise')).data;
    assert.ok(sealed.battle.skills.length > 0);
    assert.ok(sealed.battle.skills.every(skill => skill.disabledReason === '고독한 이익태로 스킬이 봉인되어 있습니다.'));

    user = await reset();
    user.main_card = { id: 10, star: 9, type: '전직' };
    corridor.enter(user); buff(user, 'burstReprise'); corridor.startCombat(user, 'normal');
    user.paradise.battle.characters = { freeBribe: true }; await user.save();
    const free = (await request('/api/paradise')).data;
    assert.equal(free.battle.skills.find(skill => skill.name === '비리').mpCost, 0);
    assert.ok(free.battle.skills.every(skill => !skill.disabledReason));
    user = await rpg.getRPGUserByName(account.name);
    user.paradise.battle.characters.freeBribe = false; await user.save();
    assert.ok((await request('/api/paradise')).data.battle.skills.find(skill => skill.name === '비리').mpCost > 0);
});

test('탐험 사망 시 바깥 HP는 보존하고 마지막 타격은 패배 사건으로 전달한다', async t => {
    let now = Date.now(); t.mock.method(Date, 'now', () => now);
    const user = await reset(); const outsideHp = user.hp; corridor.enter(user); corridor.startCombat(user, 'judge');
    corridor.getResources(user).hp = 1; Object.assign(user.paradise.enemy, { hp: 100000000, maxHp: 100000000, atk: 100000000, pnt: 100000000 });
    user.field.elite.hp = 100000000; await user.save();
    t.mock.method(Math, 'random', () => .99);
    const before = (await request('/api/paradise')).data;
    const result = await request('/api/paradise/attack', bodyFor(before));
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.equal(result.data.state.run.status, 'active');
    now += 4000;
    const ended = (await request('/api/paradise')).data;
    assert.equal(ended.run.status, 'ended');
    assert.equal(ended.player.hp, outsideHp);
    assert.equal(persisted.get(account.id).hp, outsideHp);
    assert.equal(persisted.get(account.id).paradise.resources.hp, 0);
    assert.equal(ended.run.combatEvents.at(-1).defeated, true);
    assert.equal(ended.run.combatEvents.at(-1).cleared, false);
});

test('습득 스킬의 HUD·API·무료 사용·자동 지속 피해와 재요청 정산을 연결한다', async t => {
    let user = await reset(); user.main_card = { id: 0, star: 9, type: '전직' }; corridor.enter(user);
    assert.ok(rpg.calculateUserStats(user).crit > 0);
    for (const augment of require('../paradise_augments_mechanics').filter(a => a.category === 'active')) user.paradise.acquired[augment.id] = 1;
    user.paradise.acquired.dotCritical = 1;
    Object.assign(user.paradise.enemy, { hp: 1e12, maxHp: 1e12, atk: 0, def: 0 });
    await user.save();
    t.mock.method(Math, 'random', () => 0);
    const state = (await request('/api/paradise')).data;
    assert.equal(state.battle.skills.filter(skill => skill.augmentSkill).length, 10);
    assert.equal(state.battle.skills.find(skill => skill.name === '응혈 폭발').disabledReason, '지속 피해 없음');
    assert.equal(state.battle.skills.find(skill => skill.name === '시간 접기').hpCost, Math.floor(state.player.hp * .10));
    assert.equal(state.battle.skills.find(skill => skill.name === '판돈 뒤집기').hpCost, Math.floor(state.player.hp * .20));
    const body = { ...bodyFor(state), skill: '도화선 점화' };
    const first = await request('/api/paradise/skill', body);
    assert.equal(first.status, 200, JSON.stringify(first.data));
    const retry = await request('/api/paradise/skill', body);
    assert.equal(retry.status, 200);
    assert.equal(retry.data.state.player.mp, first.data.state.player.mp);
    assert.equal(retry.data.state.run.combatEvents.length, first.data.state.run.combatEvents.length);
    user = await rpg.getRPGUserByName(account.name);
    const dot = user.paradise.battle.mechanics.dots.ignition;
    dot.nextAt = Date.now() - 10; await user.save();
    // 기존 200ms 장비 지속 피해 타이머를 그대로 검증한다.
    await new Promise(resolve => setTimeout(resolve, 300));
    const polled = (await request('/api/paradise')).data;
    const ticks = polled.run.combatEvents.filter(event => event.action === 'tick' && event.skillName === '도화선 점화');
    assert.ok(ticks.length >= 1);
    assert.equal(ticks[0].criticalCount, 1);
    assert.equal(polled.battle.skills.find(skill => skill.name === '응혈 폭발').disabledReason, undefined);
    user = await rpg.getRPGUserByName(account.name);
    user.paradise.battle.mechanics.freeAny = true;
    corridor.getResources(user).mp = 0; await user.save();
    assert.equal((await request('/api/paradise')).data.battle.skills.find(skill => skill.name === '유리 방벽').mpCost, 0);
    user.paradise.battle.mechanics.freeAny = false; user.paradise.acquired.bloodMana = 1; await user.save();
    const borrowed = (await request('/api/paradise')).data;
    assert.equal(borrowed.battle.skills.find(skill => skill.name === '유리 방벽').hpCost, Math.ceil(borrowed.player.maxMp * .12) * 2);
    assert.equal(borrowed.battle.skills.find(skill => skill.name === '시간 접기').hpCost, Math.floor(borrowed.player.hp * .10));
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

test('낙원은 141레벨부터 천상과 지옥에 입장하고 미달 시 입장 재료를 보존한다', async t => {
    const env = setupHell(t);
    for (const mode of ['heaven','hell']) {
        const user = await env.user(), inventory = structuredClone(user.inventory);
        user.level = 140; await user.save();
        const before = (await request('/api/paradise')).data;
        assert.match(before.entryBlocked,/141레벨/);
        const input = {...bodyFor(before),mode,key:env.hell.KEYS[0].name};
        const blocked = await request('/api/paradise/enter',input);
        assert.equal(blocked.status,400); assert.match(blocked.data.error,/141레벨/);
        assert.deepEqual((await rpg.getRPGUserByName(account.name)).inventory,inventory);
        user.level = 141; await user.save();
        const ready = (await request('/api/paradise')).data;
        assert.equal(ready.entryBlocked,null);
        const entered = await request('/api/paradise/enter',{...input,...bodyFor(ready)});
        assert.equal(entered.status,200,JSON.stringify(entered.data));
        assert.equal(entered.data.state.run.phase,'combat');
    }
});

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

test('지옥 12종 보상은 지정 가중치 경계를 지키고 중복 없이 남은 가중치로 추첨한다', async t => {
    const env = setupHell(t), { CHEST_WEIGHTS } = require('../paradise_hell_content');
    assert.equal(Object.values(CHEST_WEIGHTS).reduce((sum, n) => sum + n, 0), 100);
    let lower = 0;
    for (const reward of env.config.hell.rewards) {
        const upper = lower + reward.weight;
        for (const roll of [(lower + .000001) / 100, (upper - .000001) / 100]) {
            const user = await env.user(); env.hell.enter(user, env.hell.KEYS[0].name, () => .99);
            user.paradise.clearedFloor = 30; let calls = 0;
            env.hell.finish(user, 'cleared', () => calls++ === 0 ? roll : .5);
            assert.equal(user.paradise.chests[0].category, reward.id);
            assert.equal(user.paradise.chests[0].stones, 40);
            assert.equal(user.paradise.chests[0].rich, false);
            assert.equal(new Set(user.paradise.chests.map(chest => chest.category)).size, 3);
        }
        lower = upper;
    }
    const user = await env.user(); env.hell.enter(user, env.hell.KEYS[0].name, () => .99);
    user.paradise.clearedFloor = 100; user.paradise.bonusChests = 1; user.paradise.richChests = 1;
    env.hell.finish(user, 'cleared', () => .999);
    assert.equal(user.paradise.chests.length, 5);
    assert.equal(new Set(user.paradise.chests.map(chest => chest.category)).size, 5);
    assert.equal(new Set(user.paradise.chests.map(chest => chest.id)).size, 5);
    assert.equal(user.paradise.chests[4].stones, 330); assert.equal(user.paradise.opensRemaining, 1);
    await user.save(); const view = (await request('/api/paradise')).data;
    assert.ok(view.run.chests.every(chest => !chest.loot && chest.categoryName && chest.rewardText && Object.hasOwn(chest, 'iconUrl') && Object.hasOwn(chest, 'stonesIconUrl')));
    const snapshot = structuredClone(user.paradise.chests);
    env.hell.finish(user, 'retired', () => 0); assert.deepEqual(user.paradise.chests, snapshot);
    env.hell.openChest(user, snapshot[0].id);
    assert.equal(user.paradise.claimed, true); assert.ok(env.hell.openChest(user, snapshot[1].id).error);
});

test('운영 상자 가중치 변경은 수량과 연결을 보존하고 구형 탐험 표를 덮어쓰지 않는다', async t => {
    const env = setupHell(t), { updateWeights } = require('../scripts/update_paradise_hell_weights');
    for (const row of env.config.hell.rewards) delete row.weight;
    env.config.hell.rewards.find(row => row.id === 'goldPouch').counts[0] = 777;
    const user = await env.user(); env.hell.enter(user, env.hell.KEYS[0].name, () => .99);
    const saved = structuredClone(user.paradise.rewardTable), before = structuredClone(env.config), after = updateWeights(before);
    for (const row of after.hell.rewards) {
        const { weight, ...other } = row;
        assert.ok(weight > 0); assert.deepEqual(other, before.hell.rewards.find(old => old.id === row.id));
    }
    assert.deepEqual(updateWeights(after), after); assert.deepEqual(user.paradise.rewardTable, saved);
    assert.throws(() => updateWeights({ hell: { rewards: [] } }), /누락/);
    const duplicate = structuredClone(before); duplicate.hell.rewards.push(duplicate.hell.rewards[0]);
    assert.throws(() => updateWeights(duplicate), /중복/);
    for (const weight of [-1, NaN, Infinity, '6']) {
        const invalid = structuredClone(after.hell); invalid.rewards[0].weight = weight;
        assert.ok(env.hell.validateConfig(invalid));
    }
    const zeros = structuredClone(after.hell); zeros.rewards.forEach(row => row.weight = 0);
    assert.ok(env.hell.validateConfig(zeros)); assert.equal(env.hell.validateConfig(before.hell), null);
    const only = after.hell.rewards.find(row => row.id === 'goldPouch');
    user.paradise.rewardTable = after.hell.rewards.map(row => ({ ...row, weight: row.id === only.id ? 1 : 0 }));
    user.paradise.clearedFloor = 1; env.hell.finish(user, 'retired', () => 0);
    assert.ok(user.paradise.chests.every(chest => chest.category === only.id));
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
    const enemy = user.paradise.enemy;
    assert.ok(Math.abs(rpg.getDungeonRecommendedCP({ ...enemy, hp: enemy.hp / 10, maxHp: enemy.maxHp / 10 }) - 330000) / 330000 < .02);
    assert.equal(user.paradiseWeekly, null);
    corridor.victory(user, () => .99); assert.equal(user.paradise.phase, 'chests'); assert.equal(user.paradise.chests[0].tier, 10);
    for (const floor of [1,9,10,19,20,90,99,100]) assert.equal(env.hell.recommendedPower(floor), 30000 * (1 + Math.floor(floor / 10)));
});

test('지옥 낙하 구간은 65/25/10 확률이고 각 구간 내부 및 로켓은 균등 추첨한다', async t => {
    const env = setupHell(t), user = await env.user(); env.hell.enter(user, env.hell.KEYS[0].name, () => .99);
    const cases = [[0,1],[.649999,10],[.65,11],[.899999,15],[.90,16],[.999999,20]];
    for (let step = 0; step < 10; step++) cases.push([.65 * (step + .5) / 10, step + 1]);
    for (let step = 0; step < 5; step++) cases.push([.65 + .25 * (step + .5) / 5, step + 11], [.90 + .10 * (step + .5) / 5, step + 16]);
    for (const [roll, expected] of cases) {
        Object.assign(user.paradise, { floor: 1, phase: 'descent', dropsRemaining: 1, rocketJump: false });
        env.hell.descend(user, 'left', () => roll);
        assert.equal(user.paradise.lastDrop.distance, expected, 'roll=' + roll);
        assert.equal(user.paradise.dropsRemaining, 0);
    }
    for (let step = 0; step < 5; step++) {
        Object.assign(user.paradise, { floor: 1, phase: 'descent', dropsRemaining: 1, rocketJump: true });
        env.hell.descend(user, 'right', () => (step + .5) / 5);
        assert.equal(user.paradise.lastDrop.distance, step + 16);
        assert.equal(user.paradise.rocketJump, false);
    }
});

test('지옥 일반·엘리트·보스는 기존 스탯 보정 후 HP만 10배로 생성한다', async t => {
    const env = setupHell(t), user = await env.user(); env.hell.enter(user, env.hell.KEYS[0].name, () => .99);
    for (const floor of [1,10,30,100]) for (const kind of ['normal','elite','boss']) {
        user.paradise.floor = floor; corridor.startCombat(user, kind, null, () => .99);
        const enemy = user.paradise.enemy, base = { ...enemy, hp: enemy.hp / 10, maxHp: enemy.maxHp / 10 };
        const power = env.hell.recommendedPower(floor);
        assert.equal(enemy.maxHp, enemy.hp); assert.equal(enemy.hp % 10, 0);
        assert.equal(enemy.recommendedPower, power);
        assert.ok(Math.abs(rpg.getDungeonRecommendedCP(base) - power) / power < .02, floor + '/' + kind);
    }
});

test('지옥은 모든 열쇠로 HP·MP 100% 입장하며 낙하·입장 재전송·입장 실패로 회복하지 않는다', async t => {
    const env = setupHell(t);
    for (const key of env.hell.KEYS) {
        const user = await env.user(key.name); corridor.getResources(user).hp = 1; corridor.getResources(user).mp = 0; await user.save();
        const before = (await request('/api/paradise')).data, body = { ...bodyFor(before), mode: 'hell', key: key.name };
        const result = await request('/api/paradise/enter', body);
        assert.equal(result.status, 200, JSON.stringify(result.data));
        assert.equal(result.data.state.player.hp, result.data.state.player.maxHp);
        assert.equal(result.data.state.player.mp, result.data.state.player.maxMp);
        const saved = await rpg.getRPGUserByName(account.name);
        assert.equal(persisted.get(account.id).hp, 1); assert.equal(persisted.get(account.id).mp, 0);
        assert.equal(persisted.get(account.id).paradise.resources.hp, result.data.state.player.maxHp);
        assert.equal(persisted.get(account.id).paradise.resources.mp, result.data.state.player.maxMp);
        corridor.getResources(saved).hp = 10; corridor.getResources(saved).mp = 0; await saved.save();
        const retry = await request('/api/paradise/enter', body);
        assert.equal(retry.status, 200);
        assert.equal(retry.data.state.player.hp, 10); assert.equal(retry.data.state.player.mp, 0);
        corridor.victory(saved); env.hell.descend(saved, 'left', () => 0);
        assert.equal(corridor.getResources(saved).hp, 10); assert.equal(corridor.getResources(saved).mp, 0);
        assert.equal(saved.paradise.phase, 'combat');
        const blocked = await env.user(key.name); blocked.hp = 1; blocked.mp = 0;
        rpg.removeInventoryItem(blocked, env.items.findIndex(item => item.name === key.name), 2);
        assert.ok(env.hell.enter(blocked, key.name).error);
        assert.equal(blocked.hp, 1); assert.equal(blocked.mp, 0);
    }
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
            assert.equal(user.paradise.opensRemaining, 1);
            assert.equal(user.paradise.chests.length, expected === 'rocket' ? 3 : 4);
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

test('지옥 보상표 11구간·12종의 실제 아이템과 카드 등급/수량 및 강화석을 지급한다', async t => {
    const env = setupHell(t), rows = require('../paradise_hell_content').INITIAL_CONFIG.rewards;
    assert.equal(rows.length, 12);
    assert.deepEqual(rows.find(row => row.id === 'goldPouch').counts, [20,50,80,200,450,850,1250,2000,3500,7000,10000]);
    assert.deepEqual(rows.find(row => row.id === 'blackFlame').counts, [5,10,25,50,80,120,200,270,360,480,800]);
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
        else assert.equal(rpg.getInventoryItemCount(user, env.items.findIndex(item => item.name === (reward.items?.[tier] || reward.item))), reward.counts[tier] + (reward.id === 'heavenTicket' ? 3 : 0));
        assert.equal(user.paradise.claimed, true);
    }
});

test('풍요로운 황금 주머니·검은 불 상자도 강화석만 3배 지급한다', async t => {
    const env = setupHell(t), rows = require('../paradise_hell_content').INITIAL_CONFIG.rewards.filter(row => ['goldPouch','blackFlame'].includes(row.id));
    for (const reward of rows) for (const tier of [0,3,10]) {
        const user = await env.user(); env.hell.enter(user, env.hell.KEYS[0].name, () => .99);
        user.paradise.rewardTable = [reward]; user.paradise.clearedFloor = tier ? tier * 10 : 1;
        env.hell.finish(user, 'cleared', () => 0);
        const chest = user.paradise.chests[0];
        assert.equal(chest.rich, true); assert.ok(!env.hell.openChest(user, chest.id).error);
        assert.equal(rpg.getInventoryItemCount(user, env.items.findIndex(item => item.name === '상급 강화석')), (tier + 1) * 30);
        assert.equal(rpg.getInventoryItemCount(user, env.items.findIndex(item => item.name === reward.item)), reward.counts[tier]);
        assert.ok(env.hell.openChest(user, user.paradise.chests[0].id).error);
    }
});

test('제단 추가 상자는 후보만 늘리고 1개만 개봉하며 풍요 보상은 재접속·재전송에도 한 번 지급한다', async t => {
    const rows = require('../paradise_hell_content').INITIAL_CONFIG.rewards.filter(row => ['fragment','goldPouch','heavenTicket','blackFlame','key'].includes(row.id)).sort((a,b) => a.id === 'fragment' ? -1 : b.id === 'fragment' ? 1 : 0);
    const env = setupHell(t, rows), user = await env.user(); env.hell.enter(user, env.hell.KEYS[0].name, () => .99);
    Object.assign(user.paradise, { clearedFloor: 30, bonusChests: 1, richChests: 1 }); env.hell.finish(user, 'cleared', () => .99); await user.save();
    let state = (await request('/api/paradise')).data;
    assert.equal(state.run.chests.length, 5); assert.equal(state.run.opensRemaining, 1); assert.ok(state.run.chests.every(chest => !Object.hasOwn(chest, 'loot')));
    assert.equal(state.run.chests[4].rich, true); assert.equal(state.run.chests[4].stones, 120);
    const body = { ...bodyFor(state), chest: state.run.chests[4].id };
    const results = await Promise.all([request('/api/paradise/chest', body), request('/api/paradise/chest', body)]);
    assert.ok(results.every(r => r.status === 200), JSON.stringify(results)); state = (await request('/api/paradise')).data;
    assert.equal(results[0].data.reveal.kind, 'rewards');
    assert.deepEqual(results[0].data.reveal, results[1].data.reveal);
    const stones = results[0].data.reveal.items.find(item => item.name === '상급 강화석');
    assert.equal(stones.count, 120);
    assert.ok(Object.hasOwn(stones, 'iconUrl')); // 로컬 격리 테스트에는 운영 아이템 이미지가 없다.
    assert.ok(!results[0].data.reveal.items.some(item => Object.hasOwn(item, 'card')));
    assert.equal(state.run.opensRemaining, 0); assert.equal(state.run.claimed, true); assert.equal(state.run.phase, 'ended');
    assert.equal(state.run.chests.filter(chest => chest.opened).length, 1);
    for (const chest of state.run.chests) assert.equal((await request('/api/paradise/chest', { ...bodyFor(state), chest: chest.id })).status, 400);
    const saved = await rpg.getRPGUserByName(account.name);
    assert.equal(rpg.getInventoryItemCount(saved, env.items.findIndex(item => item.name === '상급 강화석')), 120);
    assert.equal(rpg.getInventoryItemCount(saved, env.items.findIndex(item => item.name === '초월 조각')), 15);
    for (const [roll, rich] of [[.099,true],[.1,false]]) {
        const u = await env.user(); env.hell.enter(u, env.hell.KEYS[0].name, () => .99); u.paradise.clearedFloor = 1;
        env.hell.finish(u, 'cleared', () => roll); assert.equal(u.paradise.chests[0].rich, rich);
    }
});

test('이전 규칙의 지옥 보상도 후보를 보존하며 1회 개봉으로 제한하고 이미 개봉했다면 추가 지급 없이 종료한다', async t => {
    const row = require('../paradise_hell_content').INITIAL_CONFIG.rewards.find(row => row.id === 'fragment');
    const env = setupHell(t, [row]);
    for (const alreadyOpened of [false, true]) {
        const user = await env.user(); env.hell.enter(user, env.hell.KEYS[0].name, () => .99);
        Object.assign(user.paradise, { clearedFloor: 30, bonusChests: 1, richChests: 1 }); env.hell.finish(user, 'cleared', () => .99);
        if (alreadyOpened) env.hell.openChest(user, user.paradise.chests[0].id);
        Object.assign(user.paradise, { phase: 'chests', claimed: false, opensRemaining: alreadyOpened ? 2 : 3 });
        await user.save();
        const candidates = structuredClone(user.paradise.chests), inventory = structuredClone(user.inventory);
        if (alreadyOpened) {
            assert.ok(env.hell.openChest(user, user.paradise.chests[0].id).error);
            const stale = await request('/api/paradise/chest', { ...bodyFor(corridor.view(user)), chest: candidates[0].id });
            assert.equal(stale.status, 409);
        }
        const state = (await request('/api/paradise')).data, saved = await rpg.getRPGUserByName(account.name);
        assert.deepEqual(saved.paradise.chests, candidates);
        assert.deepEqual(saved.inventory, inventory);
        assert.equal(state.run.opensRemaining, alreadyOpened ? 0 : 1);
        assert.equal(state.run.phase, alreadyOpened ? 'ended' : 'chests');
        assert.equal(state.run.claimed, alreadyOpened);
        assert.equal(persisted.get(account.id).paradise.opensRemaining, alreadyOpened ? 0 : 1);
        const secondRead = (await request('/api/paradise')).data;
        assert.equal(secondRead.revision, state.revision);
        const result = await request('/api/paradise/chest', { ...bodyFor(state), chest: candidates[0].id });
        assert.equal(result.status, alreadyOpened ? 400 : 200);
        assert.equal(result.data.state.run.phase, 'ended');
        if (alreadyOpened) {
            const entered = await request('/api/paradise/enter', { ...bodyFor(result.data.state), mode: 'hell', key: env.hell.KEYS[0].name });
            assert.equal(entered.status, 200, JSON.stringify(entered.data));
        }
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
    current.paradise.enemy.hp = current.paradise.enemy.maxHp = 1e12; current.paradise.enemy.atk = 1e12; corridor.getResources(current).hp = 2;
    await current.save(); t.mock.method(Math, 'random', () => .99);
    state = (await request('/api/paradise')).data; result = await request('/api/paradise/attack', bodyFor(state));
    assert.equal(result.status, 200); state = result.data.state;
    assert.equal(state.player.hp, user.hp); assert.equal(state.run.outcome, 'defeated'); assert.equal(state.run.phase, 'chests'); assert.equal(state.run.chests[0].tier, 1);
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
    const user = await reset(); corridor.getResources(user).hp = 1; corridor.getResources(user).mp = 0; await user.save();
    const before = (await request('/api/paradise')).data;
    const result = await request('/api/paradise/enter', bodyFor(before));
    assert.equal(result.status, 200, JSON.stringify(result.data));
    const player = result.data.state.player;
    assert.equal(player.hp, player.maxHp); assert.equal(player.mp, player.maxMp);
    const saved = await rpg.getRPGUserByName(account.name);
    corridor.getResources(saved).hp = 10; corridor.getResources(saved).mp = 0; corridor.startCombat(saved, 'normal');
    assert.equal(corridor.getResources(saved).hp, 10); assert.equal(corridor.getResources(saved).mp, 0);
    const blocked = await reset(); blocked.hp = 1; blocked.mp = 0;
    rpg.removeInventoryItem(blocked, data.Item.length - 1, 3);
    assert.ok(corridor.enter(blocked).error);
    assert.equal(blocked.hp, 1); assert.equal(blocked.mp, 0);
});

test('천상·지옥 HP·MP는 별도로 저장되고 스킬·회복·재접속·모든 종료 결과가 바깥 수치를 바꾸지 않는다', async t => {
    const env = setupHell(t);
    for (const mode of ['heaven', 'hell']) for (const outcome of ['retired', 'defeated', 'cleared']) {
        const user = await env.user(); user.hp = 19; user.mp = 7; await user.save();
        const before = (await request('/api/paradise')).data;
        const entered = await request('/api/paradise/enter', { ...bodyFor(before), mode, key: env.hell.KEYS[0].name });
        assert.equal(entered.status, 200, JSON.stringify(entered.data));
        let saved = await rpg.getRPGUserByName(account.name);
        const full = rpg.calculateUserStats(saved);
        assert.deepEqual(saved.paradise.resources, { hp: full.hp, mp: full.mp });
        assert.deepEqual([saved.hp, saved.mp], [19, 7]);
        assert.equal(entered.data.state.battle.player.hp, full.hp);
        assert.equal(entered.data.state.battle.player.mp, full.mp);
        Object.assign(saved.paradise.enemy, { hp: 1e12, maxHp: 1e12, atk: 1, pnt: 0 });
        await saved.save();
        const state = (await request('/api/paradise')).data;
        const skill = state.run.skills.find(skill => skill.cost > 0 && skill.cost <= full.mp);
        assert.ok(skill);
        const used = await request('/api/paradise/skill', { ...bodyFor(state), skill: skill.name });
        assert.equal(used.status, 200, JSON.stringify(used.data));
        assert.ok(used.data.state.player.mp < full.mp);
        saved = await rpg.getRPGUserByName(account.name);
        assert.deepEqual([saved.hp, saved.mp], [19, 7]);
        saved.paradise.resources = { hp: 21, mp: 3 };
        corridor.heal(saved, 1, 1);
        assert.deepEqual(saved.paradise.resources, { hp: full.hp, mp: full.mp });
        assert.deepEqual([saved.hp, saved.mp], [19, 7]);
        saved.paradise.resources = { hp: outcome === 'defeated' ? 0 : 21, mp: 3 };
        await saved.save();
        const restored = new rpg.RPGUser().load(structuredClone(persisted.get(account.id)));
        assert.deepEqual(restored.paradise.resources, saved.paradise.resources);
        assert.deepEqual([restored.hp, restored.mp], [19, 7]);
        if (mode === 'heaven' && outcome !== 'defeated') {
            corridor.offerAugments(restored, () => .99);
            restored.paradise.completed = outcome === 'cleared';
        }
        corridor.finish(restored, outcome); await restored.save();
        assert.deepEqual([persisted.get(account.id).hp, persisted.get(account.id).mp], [19, 7]);
        const ended = (await request('/api/paradise')).data;
        assert.deepEqual([ended.player.hp, ended.player.mp], [19, 7]);
        // 종료 뒤 바깥 수치를 변경해도 재정산이 과거 값으로 복원하지 않는다.
        restored.hp = 13; restored.mp = 2; corridor.finish(restored, outcome);
        assert.deepEqual([restored.hp, restored.mp], [13, 2]);
    }
});

test('기존 진행 중 탐험도 현재 저장 수치부터 분리하며 조회·재접속으로 바깥 HP·MP를 덮어쓰지 않는다', async () => {
    const user = await reset(); corridor.enter(user);
    delete user.paradise.resources; user.hp = 47; user.mp = 5; await user.save();
    const state = (await request('/api/paradise')).data;
    assert.deepEqual([state.player.hp, state.player.mp], [47, 5]);
    const saved = await rpg.getRPGUserByName(account.name);
    assert.deepEqual(saved.paradise.resources, { hp: 47, mp: 5 });
    saved.paradise.resources.hp = 1; saved.paradise.resources.mp = 0; await saved.save();
    const reloaded = (await request('/api/paradise')).data;
    assert.deepEqual([reloaded.player.hp, reloaded.player.mp], [1, 0]);
    assert.deepEqual([persisted.get(account.id).hp, persisted.get(account.id).mp], [47, 5]);
});

test('자동 장비 회복과 물약도 탐험 수치만 회복하며 바깥 수치는 저장 후에도 유지한다', async t => {
    let tick;
    t.mock.method(global, 'setInterval', callback => { tick = callback; return { unref() {} }; });
    t.mock.method(Math, 'random', () => .99);
    let user = await reset(); user.hp = 19; user.mp = 7; corridor.enter(user);
    user.paradise.resources = { hp: 10, mp: 0 };
    Object.assign(user.paradise.enemy, { hp: 1e12, maxHp: 1e12, atk: 0, pnt: 0 });
    user.field.equipmentState.dragonRegen = { ticksLeft: 1, nextTickAt: Date.now() - 1000 };
    await rpg.useBasicAttackInField(user); await user.save();
    assert.ok(tick); await tick();
    user = await rpg.getRPGUserByName(account.name);
    assert.ok(user.paradise.resources.hp > 10);
    assert.deepEqual([user.hp, user.mp], [19, 7]);
    for (const [type, key] of [['체력회복', 'hp'], ['마나회복', 'mp']]) {
        const id = data.Item.findIndex(item => item.type === '소모품' && item.use_func?.some(func => func.type === type));
        assert.ok(id >= 0);
        user.paradise.resources[key] = 1; rpg.addInventoryItem(user, id, 1);
        const result = await rpg.useItem(user, data.Item[id].name, 1);
        assert.ok(!String(result).startsWith('❌'), result);
        assert.ok(user.paradise.resources[key] > 1);
        assert.deepEqual([user.hp, user.mp], [19, 7]);
    }
    await user.save();
    assert.deepEqual([persisted.get(account.id).hp, persisted.get(account.id).mp], [19, 7]);
    rpg.clearFieldRuntimeTimers(account.name);
});

test('낙원 아이템은 관리자 itemImage를 우선하며 입장권·열쇠·인벤토리가 변경된 이미지 버전을 함께 사용한다', async t => {
    const env = setupHell(t), user = await env.user();
    env.items.push({ name: '천상의 증표', type: '재료' });
    const names = ['천상의 회랑 입장권', '천상의 증표', ...env.hell.KEYS.map(key => key.name)];
    const paths = new Set(names.map(name => path.join(__dirname, '..', 'DB/RPGenius/itemImage', env.items.find(item => item.name === name).type, name + '.png')));
    const exists = fs.existsSync, stat = fs.statSync;
    let version = 1000, uploaded = false;
    t.mock.method(fs, 'existsSync', file => paths.has(String(file)) ? uploaded : exists(file));
    t.mock.method(fs, 'statSync', (file, ...args) => uploaded && paths.has(String(file)) ? { mtimeMs: version } : stat(file, ...args));
    for (const name of names) rpg.addInventoryItem(user, env.items.findIndex(item => item.name === name), 1);
    await user.save();
    const initial = (await request('/api/paradise')).data;
    assert.ok(initial.ticket.iconUrl.startsWith('/rpg-ui?file='));
    assert.ok(initial.hell.keys.every(key => key.iconUrl.startsWith('/rpg-ui?file=')));
    uploaded = true;
    for (const next of [1000, 2000]) {
        version = next;
        const state = (await request('/api/paradise')).data;
        for (const item of [state.ticket, ...state.hell.keys]) {
            const type = env.items.find(row => row.name === item.name).type;
            assert.equal(decodeURIComponent(item.iconUrl), `/item-image?dir=${type}&file=${item.name}.png&v=${next}`);
        }
        for (const name of names) {
            const id = env.items.findIndex(item => item.name === name), result = await request('/api/inventory/items/' + id + '/detail');
            assert.equal(result.status, 200, JSON.stringify(result.data));
            assert.equal(decodeURIComponent(result.data.detail.iconUrl), `/item-image?dir=${env.items[id].type}&file=${name}.png&v=${next}`);
        }
    }
});

test('새 전투력 기준과 완만한 성장 곡선을 따르며 방어력에 1만 제한을 두지 않는다', async () => {
    const user = await reset(); corridor.enter(user, () => .99);
    assert.deepEqual(corridor.CP_ANCHORS, [[1, 10000], [10, 100000], [100, 1000000], [200, 10000000], [300, 30000000], [400, 90000000], [500, 200000000], [600, 500000000], [700, 1000000000], [800, 3000000000], [900, 5000000000], [999, 10000000000]]);
    for (let floor = 2; floor <= 999; floor++) assert.ok(corridor.recommendedPower(floor) > corridor.recommendedPower(floor - 1));
    assert.equal(corridor.recommendedPower(150), Math.round(Math.sqrt(1e6 * 1e7)));
    let previous;
    for (const [floor, cp] of corridor.CP_ANCHORS) {
        user.paradise.floor = floor;
        assert.equal(corridor.recommendedPower(floor), cp);
        corridor.startCombat(user, 'normal', null, () => .99);
        const normal = user.paradise.enemy;
        const actual = rpg.computeCombatPowerFromStats(normal);
        assert.equal(normal.recommendedPower, actual.total);
        const originalDef = Math.round(Math.sqrt(cp) * .5);
        assert.equal(normal.def, originalDef);
        assert.ok(Math.abs(rpg.computeCombatPowerFromStats({ ...normal, def: originalDef }).total - cp) <= 1, '방어력 외 스탯 유지: ' + floor);
        assert.ok(normal.hp >= cp * .5 && normal.hp < cp * .51, 'HP는 전투력에 비례해 성장');
        assert.ok(actual.offense > actual.defense, String(floor));
        assert.ok(Number.isSafeInteger(normal.hp));
        if (previous) {
            assert.ok(normal.atk > previous.atk);
            assert.ok(normal.hp > previous.hp);
            assert.ok(normal.def >= previous.def);
        }
        previous = normal;
        corridor.startCombat(user, 'elite', null, () => .99);
        const elite = user.paradise.enemy, eliteDef = Math.round(Math.sqrt(cp * 1.2) * .5);
        assert.equal(elite.def, eliteDef);
        assert.ok(Math.abs(rpg.computeCombatPowerFromStats({ ...elite, def: eliteDef }).total - cp * 1.2) <= 1);
    }
    corridor.startCombat(user, 'final', null, () => .99);
    assert.equal(user.paradise.enemy.def, Math.round(Math.sqrt(1.5e10) * .5));
    assert.ok(Math.abs(rpg.computeCombatPowerFromStats(user.paradise.enemy).total - 1.5e10) <= 1);
    user.paradise.distortion = 75;
    corridor.startCombat(user, 'elite', null, () => 0);
    assert.ok(user.paradise.enemy.traits.length);
    assert.equal(user.paradise.enemy.recommendedPower, rpg.computeCombatPowerFromStats(user.paradise.enemy).total);
    for (const kind of ['normal', 'elite', 'judge', 'rift', 'final']) {
        const rolls = [.99, 0, .5];
        corridor.startCombat(user, kind, null, () => rolls.shift() ?? .99);
        assert.ok(user.paradise.enemy.traits.includes('철갑, 방어력 +30%'));
        assert.ok(user.paradise.enemy.def > 50000, kind);
    }
});

test('보스는 해당 층 권장 전투력의 1.5배이며 진행 중인 보스도 HP 비율을 보존한다', async () => {
    const user = await reset(); corridor.enter(user, () => .99);
    for (const floor of [10, 150, 500, 999]) for (const kind of ['boss', 'judge', 'rift', 'final']) {
        user.paradise.floor = floor; corridor.startCombat(user, kind, null, () => .99);
        const enemy = user.paradise.enemy;
        assert.ok(Math.abs(rpg.computeCombatPowerFromStats(enemy).total - corridor.recommendedPower(floor) * 1.5) <= 1, `${floor}/${kind}`);
        const expectedHp = enemy.maxHp;
        Object.assign(enemy, { statVersion: 4, maxHp: expectedHp * 2, hp: expectedHp });
        assert.equal(corridor.rebalanceEnemy(user), true);
        assert.equal(enemy.maxHp, expectedHp); assert.equal(enemy.hp, Math.round(expectedHp / 2));
        assert.equal(corridor.rebalanceEnemy(user), false);
    }
});

test('현재 버전 전투와 거울의 높은 방어력은 조회 시 잘라내지 않는다', async () => {
    const user = await reset(); corridor.enter(user, () => .99); user.paradise.floor = 999;
    corridor.startCombat(user, 'elite', null, () => .99);
    user.paradise.enemy.def = 50000;
    user.paradise.enemy.hp = Math.floor(user.paradise.enemy.maxHp / 2);
    user.field.elite.hp = user.paradise.enemy.hp;
    user.field.skillCooldowns['자인'] = Date.now() + 60000;
    const before = structuredClone(user.paradise.enemy), field = structuredClone(user.field);
    await user.save(); const count = writes.length;
    const response = await request('/api/paradise'); assert.equal(response.status, 200);
    const enemy = persisted.get(account.id).paradise.enemy;
    assert.deepEqual(enemy, before);
    assert.deepEqual(persisted.get(account.id).field, field); assert.equal(writes.length, count);
    await request('/api/paradise'); assert.equal(writes.length, count);
    const copy = structuredClone(user);
    copy.paradise.enemy = { ...before, kind: 'mirror', mirror: { snapshot: { stats: { ...before } } } };
    assert.equal(corridor.rebalanceEnemy(copy), false);
    assert.equal(copy.paradise.enemy.def, 50000); assert.equal(copy.paradise.enemy.mirror.snapshot.stats.def, 50000);
    assert.equal(copy.paradise.enemy.hp, before.hp); assert.equal(copy.paradise.enemy.atk, before.atk);
});

test('13층 도박사는 새 곡선의 엘리트 전투력을 따르고 과도한 HP를 갖지 않는다', async () => {
    const user = await reset(); corridor.enter(user, () => .99);
    user.paradise.floor = 13; forceEvent(user, 'casino');
    corridor.chooseEvent(user, 'attack', {}, () => .99);
    const enemy = user.paradise.enemy;
    assert.equal(enemy.name, '잊혀진 도박사');
    const power = corridor.recommendedPower(13) * 1.2;
    assert.ok(Math.abs(rpg.computeCombatPowerFromStats(enemy).total - power) <= 1);
    assert.ok(enemy.maxHp >= power * .5 && enemy.maxHp < power * .51);
    assert.ok(enemy.atk > 3500 && enemy.def > 14);
});

test('진행 중인 구형 전투는 HP 비율과 강화·진행 상태를 보존하여 한 번만 보정한다', async () => {
    const user = await reset(); corridor.enter(user, () => .99);
    user.paradise.floor = 200; user.paradise.distortion = 75;
    user.paradise.nextEliteHp = true; user.paradise.nextEliteAttack = true;
    user.paradise.relics.push('hourglass');
    user.paradise.temporary.push({ id: 'collapse', battles: 3 });
    corridor.startCombat(user, 'elite', { reward: 'casino' }, () => .99);
    const expected = structuredClone(user.paradise.enemy), field = structuredClone(user.field);
    const battle = structuredClone(user.paradise.battle), sequence = structuredClone(user.paradise.sequence);
    Object.assign(user.paradise.enemy, { hp: 14408462, maxHp: 28816924, atk: 8000, def: 14 });
    user.paradise.enemy.statVersion = 3;
    expected.traits = expected.traits.map(trait => trait.replace(', ', ' · '));
    user.paradise.enemy.traits = [...expected.traits];
    user.field.elite.hp = user.paradise.enemy.hp;
    await user.save();
    const beforeWrites = writes.length;
    const first = await request('/api/paradise'), enemy = first.data.run.enemy;
    assert.equal(first.status, 200);
    assert.equal(enemy.maxHp, expected.maxHp); assert.equal(enemy.atk, expected.atk); assert.equal(enemy.def, expected.def);
    assert.equal(enemy.hp, Math.round(enemy.maxHp * .5));
    assert.deepEqual(enemy.traits, expected.traits); assert.equal(enemy.id, expected.id); assert.equal(enemy.name, expected.name);
    const stored = persisted.get(account.id);
    assert.deepEqual(stored.field, { ...field, elite: { ...field.elite, hp: enemy.hp } });
    assert.deepEqual(stored.paradise.battle, battle); assert.deepEqual(stored.paradise.sequence, sequence);
    assert.equal(writes.length, beforeWrites + 1);
    assert.deepEqual((await request('/api/paradise')).data.run.enemy, enemy);
    assert.equal(writes.length, beforeWrites + 1);
    for (const type of ['hell', 'mirror', 'ended']) {
        const copy = structuredClone(stored); delete copy.paradise.enemy.statVersion;
        if (type === 'hell') copy.paradise.mode = 'hell';
        if (type === 'mirror') copy.paradise.enemy.kind = 'mirror';
        if (type === 'ended') copy.paradise.status = 'ended';
        const before = structuredClone(copy);
        assert.equal(corridor.rebalanceEnemy(copy), false); assert.deepEqual(copy, before);
    }
});

test('황금 상자는 희귀 보상을 미리 노출하지 않고 실제 획득한 계약만 알려준다', async () => {
    for (const rareRoll of [0, .4, .9]) {
        const user = await reset(); corridor.enter(user, () => .99); forceEvent(user, 'chests');
        const choice = corridor.view(user).run.event.choices.find(choice => choice.id === 'gold');
        assert.doesNotMatch(choice.desc, /9성|각성|전직/);
        let call = 0;
        const result = corridor.chooseEvent(user, 'gold', {}, () => call++ === 0 ? 0 : rareRoll);
        const contract = user.paradise.contracts.at(-1);
        assert.equal(result.reveal.positive, true); assert.ok(result.message.includes(contract.name));
        if (rareRoll < .7) {
            assert.equal(contract.star, 8); assert.equal(contract.type, rareRoll === 0 ? '각성' : '전직');
            corridor.finish(user); assert.ok(!corridor.claim(user).error);
            assert.equal(user.inventory.card.at(-1).type, contract.type);
            assert.equal(user.inventory.card.at(-1).star, 7);
            const count = user.inventory.card.length;
            corridor.claim(user); assert.equal(user.inventory.card.length, count);
        } else assert.equal(contract.bonus, 1);
    }
});

test('천상 도감은 유물과 모든 증강을 제공하되 등장 조건 안내를 노출하지 않는다', async () => {
    await reset();
    const result = await request('/api/dex/augments');
    assert.equal(result.status, 200);
    assert.equal(result.data.augments.length, 465);
    assert.equal(result.data.traits.length, 47);
    assert.equal(result.data.traits.find(trait => trait.id === 'halfSteps').name, '후퇴란 없다');
    assert.equal(result.data.augments.filter(a => a.category === 'stone').length, 109);
    assert.equal(result.data.augments.filter(a => a.equipment).length, 72);
    // 효과가 발동하는 조건은 설명하되 선택지의 등장 조건은 효과 문구에서 숨긴다.
    assert.ok(result.data.augments.every(a => !Object.hasOwn(a, 'condition') && !/때 등장/.test(a.desc)));
    assert.equal(result.data.augments.find(a => a.id === 'sevenBells').rarity, 'prismatic');
    assert.equal(result.data.relics.length, corridor.RELICS.length);
    assert.ok(!result.data.relics.some(r => ['alchemistFlask', 'moonSeal'].includes(r.id)));
    assert.equal(result.data.augments.find(a => a.id === 'comboRupture').rarity, 'prismatic');
    assert.match(result.data.relics.find(r => r.id === 'riftLens').desc, /MP의 2%/);
    assert.deepEqual(new Set(result.data.relics.map(r => r.rarity)), new Set(['normal','advanced','special']));
    assert.ok(result.data.relics.every(r => r.iconUrl.includes('/rpg-ui?file=') && r.rarityLabel && r.desc.endsWith('합니다.') && !Object.hasOwn(r, 'effect')));
    assert.equal((await request('/api/dex/augments', undefined, false)).status, 401);
});

test('삭제된 증류병만 남은 유물 선택지도 재접속 시 정상 복구하고 다시 지급하지 않는다', async () => {
    const user = await reset(); corridor.enter(user, () => .99);
    Object.assign(user.paradise, { phase: 'relic', relicChoices: ['alchemistFlask'], relicPicksRemaining: 1, relicDraftRarities: ['advanced'] });
    assert.ok(corridor.chooseRelic(user, 'alchemistFlask').error);
    await user.save();
    const state = (await request('/api/paradise')).data;
    assert.equal(state.run.phase, 'relic'); assert.equal(state.run.relicChoices.length, 3);
    assert.ok(state.run.relicChoices.every(r => r.id !== 'alchemistFlask' && r.rarity === 'advanced'));
    const repeat = (await request('/api/paradise')).data;
    assert.equal(repeat.revision, state.revision); assert.deepEqual(repeat.run.relicChoices, state.run.relicChoices);
    const stale = await request('/api/paradise/relic', { ...bodyFor(state), choice: 'alchemistFlask' });
    assert.equal(stale.status, 400);
    const selected = await request('/api/paradise/relic', { ...bodyFor(state), choice: state.run.relicChoices[0].id });
    assert.equal(selected.status, 200); assert.equal(selected.data.state.run.relics.length, 1);
});

test('계약 진행과 잭팟 결과는 재접속·중복 요청에도 한 번만 지급된다', async t => {
    t.mock.method(Math, 'random', () => .99);
    const user = await reset(); corridor.enter(user, () => .99);
    user.paradise.phase = 'augment'; user.paradise.choices = ['sevenBells']; await user.save();
    let state = (await request('/api/paradise')).data;
    const slotBody = { ...bodyFor(state), choice: 'sevenBells' };
    const jackpot = await request('/api/paradise/augment', slotBody);
    assert.match(jackpot.data.reveal.text, /7, 7, 7/);
    assert.equal(jackpot.data.state.run.contracts[0].star, 8);
    const repeated = await request('/api/paradise/augment', slotBody);
    assert.deepEqual(repeated.data.reveal, jackpot.data.reveal);
    assert.equal(repeated.data.state.run.contracts.length, 1);
    const latest = await rpg.getRPGUserByName(account.name);
    const power = t.mock.method(rpg, 'calculateCombatPower', () => ({ total: corridor.recommendedPower(latest.paradise.floor + 5) }));
    assert.equal(buff(latest, 'basicContract').error, undefined); power.mock.restore();
    corridor.victory(latest, () => .99); corridor.nextEncounter(latest, () => .99);
    corridor.victory(latest, () => .99); corridor.nextEncounter(latest, () => .99);
    latest.paradise.enemy.hp = 1; latest.paradise.enemy.atk = 0; await latest.save();
    state = (await request('/api/paradise')).data;
    assert.equal(state.run.quests[0].remaining, 1);
    const attackBody = bodyFor(state), completed = await request('/api/paradise/attack', attackBody);
    assert.equal(completed.status, 200);
    assert.match(completed.data.reveal.text, /검 한 자루의 약속, 계약 달성/);
    assert.equal(completed.data.state.run.contracts.length, 2);
    assert.equal(completed.data.state.run.contracts.at(-1).star, 6);
    const retry = await request('/api/paradise/attack', attackBody);
    assert.deepEqual(retry.data.reveal, completed.data.reveal); assert.equal(retry.data.state.run.contracts.length, 2);
    assert.equal((await request('/api/paradise')).data.run.quests[0].status, 'completed');
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
        corridor.move(user, 30); assert.equal(user.paradise.distortion, 20); assert.equal(user.paradise.ring, .07);
        corridor.move(user, -100); assert.equal(user.paradise.distortion, 15); assert.equal(user.paradise.floor, 1); assert.equal(user.paradise.compass, .07);
        user.paradise.distortion = 100; corridor.nextEncounter(user, () => .99); assert.equal(user.paradise.event.id, 'collapse');
        corridor.chooseEvent(user, choice, {}, () => .99);
        if (choice === 'accept') { assert.equal(user.paradise.battle.collapse, true); assert.equal(user.paradise.temporary.find(b => b.id === 'collapse').battles, 3); }
        else if (choice === 'rift') assert.equal(user.paradise.enemy.kind, 'rift');
        else assert.equal(user.paradise.distortion, 50);
    }
});

test('균열 보스 격파 뒤 두 번째 붕괴는 마지막 클리어 층으로 강제 귀환하고 재조회에도 한 번만 정산한다', async t => {
    t.mock.method(Math, 'random', () => .99);
    const user = await reset(); corridor.enter(user, () => .99);
    user.paradise.distortion = 100; corridor.nextEncounter(user, () => .99);
    assert.equal(user.paradise.event.id, 'collapse');
    corridor.chooseEvent(user, 'rift', {}, () => .99);
    assert.equal(user.paradise.enemy.kind, 'rift');
    corridor.victory(user, () => .99);
    const run = user.paradise, cleared = run.highestFloor;
    assert.equal(run.riftDefeated, true); assert.equal(run.status, 'active');
    // 보상을 반납해도 보스 격파 기록은 남는다.
    run.relics = []; run.distortion = 95; run.choices = ['blade']; run.offerRarity = 'silver';
    const gold = user.gold; await user.save();
    const before = (await request('/api/paradise')).data, body = { ...bodyFor(before), choice: 'blade' };
    const response = await request('/api/paradise/augment', body);
    assert.equal(response.status, 200);
    const end = response.data.state.run;
    assert.equal(end.outcome, 'collapsed'); assert.equal(end.status, 'ended'); assert.equal(end.claimed, true);
    assert.equal(end.highestFloor, cleared); assert.ok(end.floor > cleared);
    assert.equal(end.event, null); assert.equal(end.timer.paused, true);
    const stored = structuredClone(persisted.get(account.id));
    assert.equal(stored.field, null); assert.equal(stored.paradiseWeekly.bestFloor, cleared);
    assert.equal(stored.gold - gold, cleared * 100);
    assert.equal(stored.inventory.card.length, 1);
    await request('/api/paradise/augment', body); await request('/api/paradise');
    assert.equal(persisted.get(account.id).gold, stored.gold);
    assert.deepEqual(persisted.get(account.id).inventory.card, stored.inventory.card);
});

test('저장된 두 번째 붕괴도 자동 귀환하며 카드 공간 부족이면 보상을 보존한다', async () => {
    const user = await reset(); corridor.enter(user, () => .99);
    const run = user.paradise;
    run.relics = ['riftHeart']; run.highestFloor = run.clearedFloor = 50; run.floor = 65;
    run.distortion = 100; forceEvent(user, 'collapse');
    run.contracts = [{ star: 8, type: '전직', name: '8성 전직 카드' }];
    user.maxCardLimit = 1; user.inventory.card = [{ id: 0, star: 0, type: '일반' }];
    const gold = user.gold; await user.save();
    const result = await request('/api/paradise');
    assert.equal(result.data.run.outcome, 'collapsed'); assert.equal(result.data.run.claimed, false);
    assert.match(result.data.run.timeoutClaimError, /공간/);
    assert.equal(persisted.get(account.id).gold, gold);
    const restored = await rpg.getRPGUserByName(account.name); restored.inventory.card = []; await restored.save();
    const claim = await request('/api/paradise/claim', bodyFor((await request('/api/paradise')).data));
    assert.equal(claim.status, 200); assert.equal(claim.data.state.run.claimed, true);
    assert.equal(persisted.get(account.id).inventory.card.length, 1);
    assert.equal(persisted.get(account.id).paradise.highestFloor, 50);
});

test('유물 확률과 피해 변경은 이벤트 결과 및 실제 능력치에 적용된다', async () => {
    for (const [roll, won] of [[.8499, true], [.85, false]]) {
        const user = await reset(); corridor.enter(user); user.paradise.relics = ['dice'];
        forceEvent(user, 'casino');
        assert.match(corridor.view(user).run.event.choices[0].desc, /85%/);
        corridor.chooseEvent(user, 'safe', {}, () => roll);
        assert.equal(Number(user.paradise.effects.atk || 0), won ? .1 : 0);
    }
    for (const [roll, good] of [[.5699, true], [.57, false]]) {
        const user = await reset(); corridor.enter(user); user.paradise.relics = ['key', 'redContract'];
        assert.equal(corridor.sumEffects(user.paradise).final, .30);
        forceEvent(user, 'chests'); corridor.chooseEvent(user, 'gold', {}, () => roll);
        assert.equal(Number(user.paradise.effects.atk || 0), good ? .25 : 0);
    }
});
test('퍼즐 정답·오답·무시·서버 시간 초과, 정답 비공개를 검증한다', async () => {
    for (const outcome of ['correct', 'wrong', 'skip', 'timeout']) {
        const user = await reset(); corridor.enter(user, () => .99); forceEvent(user, 'puzzle');
        corridor.chooseEvent(user, 'solve'); const event = user.paradise.event;
        assert.equal(corridor.view(user).run.event.puzzle.solution, undefined);
        const beforeHp = corridor.getResources(user).hp;
        if (outcome === 'timeout') event.deadline = Date.now() - 1;
        const wrong = event.puzzle.solution.split('').reverse().join('');
        let answer = outcome === 'skip' ? null : outcome === 'wrong' ? wrong : event.puzzle.solution;
        if (answer === event.puzzle.solution && outcome === 'wrong') answer = event.puzzle.solution.slice(1) + event.puzzle.solution[0];
        const result = corridor.answerPuzzle(user, answer, () => .99);
        assert.equal(result.error, undefined); assert.equal(user.paradise.phase, 'augment');
        if (['wrong', 'timeout'].includes(outcome)) assert.ok(corridor.getResources(user).hp < beforeHp);
        else assert.ok(corridor.getResources(user).hp >= beforeHp);
    }
});
test('균열의 거래상은 네 선택지를 제공하고 뒤틀림의 대가로 탐험 능력치만 강화한다', async () => {
    for (const choice of ['power', 'vigor', 'pierce']) {
        const user = await reset(); const outside = { hp: user.hp, mp: user.mp };
        corridor.enter(user, () => .99); forceEvent(user, 'riftTrader');
        const before = rpg.calculateUserStats(user), resources = structuredClone(corridor.getResources(user));
        const choices = corridor.view(user).run.event.choices;
        assert.deepEqual(choices.map(c => c.id), ['power', 'vigor', 'pierce', 'skip']);
        const result = corridor.chooseEvent(user, choice, {}, () => .99);
        assert.equal(result.error, undefined); assert.ok(result.reveal);
        assert.equal(user.paradise.phase, 'augment'); assert.equal(user.paradise.floor, 1);
        assert.equal(user.paradise.distortion, choice === 'pierce' ? 25 : 20);
        const after = rpg.calculateUserStats(user);
        if (choice === 'power') assert.equal(after.atk, Math.round(before.atk * 1.25));
        if (choice === 'vigor') {
            assert.equal(after.hp, Math.round(before.hp * 1.25));
            assert.equal(after.def, Math.round(before.def * 1.25));
        }
        if (choice === 'pierce') {
            assert.equal(after.pnt, before.pnt + 300);
            assert.equal(after.pntPercent, Number(before.pntPercent || 0) + .10);
            const hit = stats => rpg.getDamageAfterReducedDefense(1000, 10000, stats.pnt, Number(stats.pntPercent || 0));
            assert.ok(hit(after) > hit(before), '관통은 실제 적 방어력 계산에 반영된다');
        }
        assert.deepEqual(corridor.getResources(user), resources);
        assert.deepEqual({ hp: user.hp, mp: user.mp }, outside);
        const effects = structuredClone(user.paradise.effects);
        assert.ok(corridor.chooseEvent(user, choice).error); assert.deepEqual(user.paradise.effects, effects);
        corridor.startCombat(user, 'normal', null, () => .99);
        assert.equal(rpg.calculateUserStats(user).pnt, after.pnt);
        corridor.finish(user, 'defeated');
        const ended = rpg.calculateUserStats(user);
        for (const key of ['atk', 'def', 'hp', 'pnt', 'pntPercent']) assert.equal(ended[key], before[key], key);
    }
});
test('균열의 거래상은 무작위 이벤트에 등장하며 도망은 거래 비용을 내지 않는다', async () => {
    const user = await reset(); corridor.enter(user, () => .99);
    const rolls = [.10, .99]; corridor.nextEncounter(user, () => rolls.shift() ?? .99);
    assert.equal(user.paradise.event.id, 'riftTrader');
    const before = structuredClone(user.paradise.effects);
    assert.ok(corridor.chooseEvent(user, 'unknown').error); assert.deepEqual(user.paradise.effects, before);
    const result = corridor.chooseEvent(user, 'skip', {}, () => .99);
    assert.equal(result.reveal, null); assert.equal(user.paradise.distortion, 0);
    assert.equal(user.paradise.floor, 6); assert.equal(user.paradise.phase, 'augment');
    assert.deepEqual(user.paradise.effects, before);
    forceEvent(user, 'riftTrader'); user.paradise.distortion = 90;
    corridor.chooseEvent(user, 'pierce', {}, () => .99);
    assert.equal(user.paradise.distortion, 100);
    corridor.nextEncounter(user, () => .99);
    assert.equal(user.paradise.event.id, 'collapse');
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
    corridor.enter(user, () => .99); corridor.addEffect(user, { atk: 2, hp: .5 }); corridor.getResources(user).hp = 1;
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
    corridor.victory(user, () => .99);
    assert.equal(user.paradise.status, 'active'); assert.equal(user.paradise.phase, 'augment');
    assert.equal(user.paradise.completed, true); assert.deepEqual(user.paradise.choices, []);
    assert.match(corridor.continueExploration(user).error, /999층/);
    assert.ok(corridor.claim(user).error);
    corridor.finish(user); assert.equal(user.paradise.outcome, 'cleared'); assert.equal(user.field, null);
});
test('종료 기본 보상과 5성/9성 계약을 정확한 등급으로 한 번만 지급한다', async () => {
    const user = await reset(); corridor.enter(user, () => .99); user.paradise.clearedFloor = 20;
    user.paradise.contracts = [{ star: 5, type: '전직', name: '5성 전직 카드' }, { star: 9, type: '전직', name: '9성 전직 카드' }];
    user.paradise.effects.reward = .30; corridor.offerAugments(user); corridor.finish(user); await user.save();
    const beforeGold = user.gold;
    const state = (await request('/api/paradise')).data, body = bodyFor(state);
    const result = await request('/api/paradise/claim', body); assert.equal(result.status, 200, JSON.stringify(result.data));
    const repeat = await request('/api/paradise/claim', body); assert.equal(repeat.status, 200);
    assert.equal(result.data.reveal.kind, 'rewards');
    assert.equal(result.data.reveal.items[0].count, 2600);
    assert.deepEqual(result.data.reveal, repeat.data.reveal);
    const cardRewards = result.data.reveal.items.filter(item => item.kind === 'card');
    assert.equal(cardRewards.length, 2);
    assert.ok(cardRewards.every(item => item.iconUrl && item.cardType === '전직' && !Object.hasOwn(item, 'card')));
    assert.deepEqual((await request('/api/paradise')).data.run.rewardSummary, result.data.reveal.items);
    const latest = await rpg.getRPGUserByName(account.name);
    assert.equal(latest.gold - beforeGold, 2600); assert.deepEqual(latest.inventory.card.map(c => c.star), [4, 8]);
    assert.ok(latest.inventory.card.every(c => c.type === '전직'));
});
test('악마의 거래는 HP·MP 회복을 막고 불굴/보험/깃털 생존을 순서대로 한 번씩 처리한다', async () => {
    const user = await reset(); corridor.enter(user, () => .99);
    Object.assign(user.paradise.effects, { noHealing: 1, unyielding: 1 }); corridor.getResources(user).hp = 1; corridor.getResources(user).mp = 0;
    corridor.heal(user, 1, 1); assert.equal(corridor.getResources(user).hp, 1); assert.equal(corridor.getResources(user).mp, 0);
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
    corridor.getResources(user).mp = 0; corridor.onSkillUsed(user, 50); assert.equal(corridor.getResources(user).mp, 10);
    user.paradise.relics.push('clock');
    user.paradise.temporary.push({ id: 'forbidden', battles: 1 });
    assert.equal(corridor.cooldownMultiplier(user), .35); assert.equal(corridor.cooldownMultiplier(user), .50);
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
    const mp = corridor.getResources(user).mp, time = Date.now();
    const message = await rpg.useSkillInField(user, skill.name);
    assert.ok(!message.startsWith('❌'), message);
    assert.equal(corridor.getResources(user).mp, mp - skill.mp_cost + Math.floor(skill.mp_cost * .20));
    assert.ok(user.field.skillCooldowns[skill.name] - time <= skill.cooltime * .70 + 100);
    const pvp = require('../pvp');
    const copy = pvp.createCorridorMirror({ ...user, paradise: null, field: null });
    const response = pvp.corridorMirrorTurn(copy, user, rpg.calculateUserStats(user), copy.hp, undefined, copy.enteredAt + 4000);
    assert.ok(Number.isFinite(response.damage)); assert.ok(response.messages.length); assert.ok(response.mp < copy.maxMp);
});
test('카드 공간 부족은 계약을 소모하지 않고, 신규 등록은 기존 운영 항목과 빈 구성을 보존한다', async () => {
    const { appendContent } = require('../scripts/register_paradise_content');
    const first = appendContent({ Item: [{ name: '기존 아이템' }] }); assert.equal(first.ticketId, 1);
    first.after.Item[1].desc = '운영자 변경'; first.after.Paradise = { enabled: false, baseRewards: [] };
    assert.deepEqual(appendContent(first.after).after, first.after);
    const user = await reset(); corridor.enter(user, () => .99);
    user.paradise.contracts.push({ star: 5, type: '전직' }); corridor.offerAugments(user); corridor.finish(user);
    user.maxCardLimit = 1; user.inventory.card.push({ id: 0, star: 0, type: '일반' });
    assert.match(corridor.claim(user).error, /공간/); assert.equal(user.paradise.claimed, undefined);
    user.inventory.card = []; assert.equal(corridor.claim(user).error, undefined);
});
test('귀환은 증강 선택 단계에서만 가능하며 필드 퇴장·API 우회와 정산 재요청을 막는다', async () => {
    let user = await reset(); corridor.enter(user, () => .99);
    for (const phase of ['combat', 'event', 'puzzle']) {
        user.paradise.phase = phase; user.paradise.event = null; await user.save();
        assert.equal(corridor.view(user).run.canReturn, false);
        assert.match(corridor.finish(user).error, /증강 선택/);
        assert.match(rpg.leaveField(user), /❌.*증강 선택/);
        const state = (await request('/api/paradise')).data;
        assert.equal((await request('/api/paradise/retire', bodyFor(state))).status, 400);
        user = await rpg.getRPGUserByName(account.name);
        assert.equal(user.paradise.status, 'active'); assert.equal(user.paradise.phase, phase);
    }
    corridor.offerAugments(user); user.paradise.clearedFloor = 10; await user.save();
    const before = (await request('/api/paradise')).data, body = bodyFor(before);
    assert.equal(before.run.canReturn, true);
    const returned = await request('/api/paradise/retire', body);
    assert.equal(returned.status, 200); assert.equal(returned.data.state.run.canClaim, true);
    assert.equal((await request('/api/paradise/retire', body)).status, 200);
    const claimBody = bodyFor(returned.data.state), gold = user.gold;
    assert.equal((await request('/api/paradise/claim', claimBody)).status, 200);
    assert.equal((await request('/api/paradise/claim', claimBody)).status, 200);
    user = await rpg.getRPGUserByName(account.name);
    assert.equal(user.gold - gold, 1000);
});

test('이전 규칙의 미수령 999층 완주도 직접 귀환한 뒤 정산하며 패배 보상은 API에서 거절한다', async () => {
    let user = await reset(); corridor.enter(user, () => .99);
    Object.assign(user.paradise, { status: 'ended', phase: 'ended', outcome: 'cleared', clearedFloor: 999 });
    user.field = null; await user.save();
    let state = (await request('/api/paradise')).data;
    assert.equal(state.run.canReturn, true);
    assert.equal((await request('/api/paradise/claim', bodyFor(state))).status, 400);
    const returned = await request('/api/paradise/retire', bodyFor(state));
    assert.equal(returned.status, 200);
    assert.equal((await request('/api/paradise/claim', bodyFor(returned.data.state))).status, 200);

    user = await reset(); corridor.enter(user, () => .99);
    user.paradise.clearedFloor = 100; user.paradise.highestFloor = 100;
    user.paradise.milestoneRewards = [{ floor: 1, name: '천상의 회랑 입장권', count: 5 }];
    user.paradise.contracts = [{ star: 9, type: '각성', name: '9성 각성 카드' }];
    corridor.finish(user, 'defeated'); await user.save();
    state = (await request('/api/paradise')).data;
    assert.deepEqual(state.run.rewards, []); assert.equal(state.run.canReturn, false);
    const before = structuredClone({ gold: user.gold, inventory: user.inventory });
    assert.equal((await request('/api/paradise/claim', bodyFor(state))).status, 400);
    assert.equal((await request('/api/paradise/retire', bodyFor(state))).status, 400);
    user = await rpg.getRPGUserByName(account.name);
    assert.deepEqual({ gold: user.gold, inventory: user.inventory }, before);
    assert.equal((await request('/api/paradise/enter', bodyFor(state))).status, 200);
});

test('전투 패배는 달성·기본·계약 보상을 모두 잃고 다음 탐험에 천상 강화가 유출되지 않는다', async () => {
    const user = await reset(), original = rpg.calculateUserStats(user);
    corridor.enter(user, () => .99); corridor.addEffect(user, { atk: 1, hp: .5 });
    user.paradise.contracts.push({ star: 5, type: '전직' }); user.paradise.enemy.hp = 10000000; user.paradise.enemy.atk = 1e12; corridor.getResources(user).hp = 1;
    rpg.advanceParadiseCombat(user, user.field.nextEnemyAttackAt);
    assert.equal(user.paradise.outcome, 'defeated'); assert.equal(user.paradise.contracts.length, 1); assert.equal(user.hp, original.hp); assert.equal(user.paradise.resources.hp, 0);
    assert.equal(rpg.calculateUserStats(user).atk, original.atk);
    const before = structuredClone({ gold: user.gold, inventory: user.inventory });
    assert.deepEqual(corridor.view(user).run.rewards, []);
    assert.equal(corridor.view(user).run.canClaim, false);
    assert.match(corridor.claim(user).error, /패배/);
    assert.deepEqual({ gold: user.gold, inventory: user.inventory }, before);
    assert.ok(!corridor.enter(user, () => .99).error);
    assert.deepEqual(user.paradise.contracts, []); assert.deepEqual(user.paradise.acquired, {});
});

test('추가 장비 전용 증강 15개도 유효 장착 장비만 제시하며 실제 공격/보호막 수치를 강화한다', async t => {
    const additions = corridor.AUGMENTS.filter(a => a.equipment).slice(7, 22);
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
test('주간 최고 기록은 통과한 층만 집계하고 하락·패배·재입장으로 낮아지지 않는다', async () => {
    const user = await reset(); corridor.enter(user, () => .99); assert.equal(corridor.weeklyInfo(user).bestFloor, 0);
    corridor.victory(user, () => .99); assert.equal(corridor.weeklyInfo(user).bestFloor, 1);
    corridor.move(user, 100); assert.equal(corridor.weeklyInfo(user).bestFloor, 1);
    corridor.startCombat(user, 'normal', null, () => .99); corridor.victory(user, () => .99);
    assert.equal(corridor.weeklyInfo(user).bestFloor, 101);
    corridor.move(user, -20); assert.equal(corridor.weeklyInfo(user).bestFloor, 101);
    corridor.finish(user, 'defeated'); assert.equal(corridor.weeklyInfo(user).bestFloor, 101);
    user.paradise.claimed = true; corridor.getResources(user).hp = rpg.calculateUserStats(user).hp; corridor.enter(user, () => .99);
    assert.equal(corridor.weeklyInfo(user).bestFloor, 101);
    corridor.offerAugments(user);
    await user.save(); const state = (await request('/api/paradise')).data;
    assert.equal(state.weekly.bestFloor, 101);
    const result = await request('/api/paradise/retire', bodyFor(state)); assert.equal(result.status, 200);
    assert.equal(persisted.get(account.id).paradiseWeekly.bestFloor, 101);
});
test('패배한 첫 층, 미완료 연속 전투, 이동한 층은 최고 기록과 순위에 들어가지 않는다', async () => {
    let user = await reset(); corridor.enter(user, () => .99); corridor.finish(user, 'defeated'); await user.save();
    let state = (await request('/api/paradise')).data;
    assert.equal(state.run.highestFloor, 0); assert.equal(state.weekly.bestFloor, 0);
    assert.equal((await request('/api/paradise/ranking')).data.total, 0);

    user = await reset(); corridor.enter(user, () => .99); corridor.victory(user, () => .99);
    corridor.move(user, 199); corridor.startCombat(user, 'normal', { kind: 'normal', remaining: 3, reward: 'judge:three' }, () => .99);
    corridor.victory(user, () => .99);
    assert.equal(user.paradise.sequence.remaining, 2); assert.equal(user.paradise.clearedFloor, 1);
    corridor.finish(user, 'defeated'); await user.save();
    state = (await request('/api/paradise')).data;
    assert.equal(state.run.floor, 200); assert.equal(state.run.highestFloor, 1); assert.equal(state.weekly.bestFloor, 1);
    assert.equal((await request('/api/paradise/ranking')).data.me.floor, 1);

    user = await reset(); corridor.enter(user, () => .99); corridor.victory(user, () => .99); corridor.move(user, 149);
    forceEvent(user, 'chests'); corridor.chooseEvent(user, 'red', {}, () => .5);
    assert.equal(user.paradise.highestFloor, 150);
    corridor.move(user, 50); corridor.startCombat(user, 'elite', null, () => .99); corridor.finish(user, 'defeated');
    assert.equal(user.paradise.highestFloor, 150); assert.equal(corridor.weeklyInfo(user).bestFloor, 150);
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
    assert.ok(Math.abs(after.afterSkill - before.afterSkill - definition.plusStat.afterSkill * .45) < 1e-9);
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

test('거울은 입력 없이도 스킬·일반 공격을 사용하며 동시 조회와 재접속으로 공격이 중복되지 않는다', async t => {
    const user = await reset(); corridor.enter(user, () => .99); corridor.startCombat(user, 'mirror');
    const clock = Date.now() + 4000; t.mock.method(Date, 'now', () => clock); t.mock.method(Math, 'random', () => .99);
    const originalHp = corridor.getResources(user).hp, originalMp = user.paradise.enemy.mp;
    await user.save();
    const polls = await Promise.all([request('/api/paradise'), request('/api/paradise')]);
    assert.ok(polls.every(r => r.status === 200));
    const first = polls[1].data;
    assert.ok(first.player.hp < originalHp);
    assert.ok(first.run.enemy.mp < originalMp);
    assert.equal(first.run.combatEvents.length, 1);
    assert.equal(first.run.combatEvents[0].actor, 'enemy');
    assert.equal(first.run.combatEvents[0].action, 'skill');
    assert.ok(first.run.combatEvents[0].skillName);
    assert.ok(first.run.combatEvents[0].receivedHits.length);
    const persistedMirror = persisted.get(account.id).paradise.enemy.mirror;
    assert.ok(persistedMirror.nextActionAt > clock);
    assert.deepEqual((await request('/api/paradise')).data.run.combatEvents, first.run.combatEvents);
    const latest = await rpg.getRPGUserByName(account.name);
    latest.paradise.enemy.mirror.mp = 0;
    latest.paradise.enemy.mirror.nextActionAt = clock;
    await latest.save();
    const next = await request('/api/paradise');
    assert.equal(next.data.run.combatEvents.at(-1).action, 'basic');
    assert.equal(next.data.run.combatEvents.length, 2);
});

test('거울의 독립 타격도 플레이어 보호막·회랑 부활과 최종 사망을 순서대로 적용한다', async t => {
    const user = await reset(); corridor.enter(user, () => .99); corridor.startCombat(user, 'mirror');
    t.mock.method(Math, 'random', () => .99);
    const mirror = user.paradise.enemy.mirror;
    mirror.snapshot.stats.atk = 1e9; mirror.mp = 0; mirror.nextActionAt = Date.now();
    require('../combat_shields').grant(user.field, { source: 'test', caster: user.name, amount: 1e12, expiresAt: Date.now() + 60000 });
    const hp = corridor.getResources(user).hp;
    rpg.advanceParadiseMirror(user);
    assert.equal(corridor.getResources(user).hp, hp);
    assert.equal(user.paradise.combatEvents.at(-1).received, 0);
    assert.equal(user.paradise.combatEvents.at(-1).receivedHits.filter(hit => hit.type !== 'absorbed').reduce((n, hit) => n + hit.damage, 0), 0);
    assert.ok(user.paradise.combatEvents.at(-1).receivedHits.some(hit => hit.type === 'absorbed' && hit.damage > 0));
    user.field.shield = null; user.field.shieldLayers = []; corridor.getResources(user).hp = 1; user.paradise.effects.unyielding = 1;
    mirror.nextActionAt = Date.now();
    rpg.advanceParadiseMirror(user);
    assert.equal(corridor.getResources(user).hp, 1); assert.equal(user.paradise.status, 'active');
    mirror.nextActionAt = Date.now();
    rpg.advanceParadiseMirror(user);
    assert.equal(user.paradise.outcome, 'defeated');
    assert.equal(user.paradise.combatEvents.at(-1).defeated, true);
});

test('거울은 각성 15종의 패시브·스킬·궁극기·장비를 복제하고 실제 전투에 사용한다', async t => {
    const pvp = require('../pvp'), characters = require('../DB/RPGenius/CharacterCards.json');
    const awakening = require('../card_awakening');
    t.mock.method(Math, 'random', () => .99);
    for (const definition of awakening.definitions) {
        const user = await reset();
        user.main_card = { id: characters.findIndex(c => c.name === definition.name), type: '각성', star: 6 };
        user.equipments.hat = { id: data.Equipment.hat.findIndex(e => e.name === '마나번 햇'), level: 0 };
        const mirror = pvp.createCorridorMirror(user), skills = rpg.getMainCardSkills(user);
        assert.deepEqual(mirror.snapshot.stats.awakening, awakening.getPassive(user.main_card), definition.name);
        assert.deepEqual(mirror.snapshot.skillIndexes, skills.map(e => e.index), definition.name);
        assert.ok(mirror.snapshot.equipment.entries.some(e => e.name === '마나번 햇'), definition.name);
        assert.equal(mirror.hp, rpg.calculateUserStats(user).hp);
        assert.equal(mirror.mp, rpg.calculateUserStats(user).mp);
        corridor.getResources(user).hp = 1e9;
        const turn = pvp.corridorMirrorTurn(mirror, user, { ...rpg.calculateUserStats(user), hp: 1e9 }, mirror.hp, undefined, mirror.enteredAt + 10000);
        assert.ok(turn.events.length, definition.name);
        assert.ok(turn.events.some(e => e.action === 'skill'), definition.name);
        assert.ok(Object.keys(mirror.skillCooldowns).length, definition.name);
    }
    const user = await reset();
    user.main_card = { id: characters.findIndex(c => c.name === '딜러장'), type: '각성', star: 6 };
    const mirror = pvp.createCorridorMirror(user);
    mirror.mp = 0; mirror.snapshot.stats.crit = 0;
    const hit = pvp.corridorMirrorTurn(mirror, user, rpg.calculateUserStats(user), mirror.hp, undefined, mirror.enteredAt + 4000);
    assert.ok(hit.events[0].criticalCount > 0, '각성 일반 공격 확정 치명타');
    const ordinary = await reset();
    ordinary.main_card.type = '전직';
    const jobMirror = pvp.createCorridorMirror(ordinary), skills = rpg.getMainCardSkills(ordinary);
    assert.equal(jobMirror.skillCooldowns[skills.at(-1).skill.name], jobMirror.enteredAt + 10000);
    jobMirror.nextActionAt = jobMirror.enteredAt + 10000;
    const ultimate = pvp.corridorMirrorTurn(jobMirror, ordinary, rpg.calculateUserStats(ordinary), jobMirror.hp, undefined, jobMirror.enteredAt + 10000);
    assert.equal(ultimate.events[0].skillName, skills.at(-1).skill.name, '전직 궁극기를 우선 사용');
    ordinary.equipments.hat = { id: data.Equipment.hat.findIndex(e => e.name === '마나번 햇'), level: 0 };
    const equipped = pvp.createCorridorMirror(ordinary);
    equipped.rules = [{ cond: 'always', action: 'attack' }];
    t.mock.method(Math, 'random', () => .01);
    pvp.corridorMirrorTurn(equipped, ordinary, rpg.calculateUserStats(ordinary), equipped.hp, undefined, equipped.enteredAt + 4000);
    assert.equal(equipped.runtime.equipment.manaBurnAttackBuff.value, .15, '장비 패시브가 실제로 발동');
});

test('거울 각성 생존은 복제본에 저장되고 새 거울의 생존 기회를 소모하지 않는다', async t => {
    const pvp = require('../pvp'), characters = require('../DB/RPGenius/CharacterCards.json');
    const user = await reset();
    user.main_card = { id: characters.findIndex(c => c.name === '타이란트'), star: 6, type: '각성' };
    t.mock.method(Math, 'random', () => .99);
    const first = pvp.createCorridorMirror(user);
    pvp.corridorMirrorHit(first, user, 1e12, {});
    assert.equal(first.hp, 1);
    const restored = structuredClone(first);
    assert.ok(restored.runtime.awakeningSurvival.invincibleUntil > Date.now());
    pvp.corridorMirrorHit(restored, user, 1e12, {});
    assert.equal(corridor.getResources(restored).hp, 1);
    const second = pvp.createCorridorMirror(user);
    pvp.corridorMirrorHit(second, user, 1e12, {});
    assert.equal(second.hp, 1);
});

test('획득·만료·거울 거래로 버린 증강은 다시 나오지 않고 소진 후에도 탐험을 이어간다', async () => {
    const user = await reset(); corridor.enter(user, () => .99);
    user.paradise.acquired = Object.fromEntries(corridor.AUGMENTS.filter(a => a.id !== 'blade').map(a => [a.id, 1]));
    corridor.offerAugments(user);
    assert.deepEqual(user.paradise.choices, ['blade']);
    corridor.chooseAugment(user, 'blade', () => .99);
    forceEvent(user, 'mirror'); corridor.chooseEvent(user, 'trade', {}, () => .99);
    assert.deepEqual(user.paradise.acquired, {});
    assert.deepEqual(user.paradise.choices, []);
    const floor = user.paradise.floor;
    assert.equal(corridor.continueExploration(user, () => .99).error, undefined);
    assert.equal(user.paradise.floor, floor + 5); assert.equal(user.paradise.phase, 'route');
    user.paradise.phase = 'augment'; user.paradise.choices = ['blade'];
    assert.equal(corridor.view(user).run.choices.length, 0, '이전 버전이 제시한 중복 선택지도 숨긴다');
    assert.ok(corridor.chooseAugment(user, 'blade').error);
});

test('확률형 증강은 확정된 성공·실패와 실제 수치를 즉시 전달하고 재요청해도 재추첨하지 않는다', async t => {
    for (const [roll, word, amount] of [[.01, '성공', .30], [.99, '실패', -.20]]) {
        const user = await reset(); corridor.enter(user, () => .99);
        user.paradise.phase = 'augment'; user.paradise.choices = ['gambler']; await user.save();
        t.mock.method(Math, 'random', () => roll);
        const body = bodyFor((await request('/api/paradise')).data);
        body.choice = 'gambler';
        const result = await request('/api/paradise/augment', body);
        assert.equal(result.status, 200, JSON.stringify(result.data));
        assert.match(result.data.message, new RegExp(word));
        assert.match(result.data.reveal.text, new RegExp(amount > 0 ? '\\+30%' : '-20%'));
        const repeat = await request('/api/paradise/augment', body);
        assert.deepEqual(repeat.data.reveal, result.data.reveal);
        assert.equal((await rpg.getRPGUserByName(account.name)).paradise.effects.atk, amount);
    }
});

test('도박사·붕괴·최종 보스는 개별 전투 이미지로 연결된다', async () => {
    for (const [kind, reward, name, image] of [
        ['elite', 'casino', '잊혀진 도박사', 'gambler.webp'],
        ['rift', 'rift', '균열을 삼키는 자', 'rift-boss.webp'],
        ['final', null, '천상의 마지막 수문장', 'final-warden.webp']
    ]) {
        const user = await reset(); corridor.enter(user, () => .99);
        corridor.startCombat(user, kind, reward ? { kind, remaining: 1, reward } : null);
        await user.save();
        const view = (await request('/api/paradise')).data;
        assert.equal(view.run.enemy.name, name);
        assert.equal(view.run.enemy.sprite, '/rpg-ui?file=%EB%82%99%EC%9B%90%2F' + image);
    }
});

test('붕괴 수락은 사건 전투 보상을 복제하지 않고 3회 승리 후 종료 보상만 증가시킨다', async () => {
    for (const [event, choice, effect, amount] of [['mirror', 'fight', 'atk', .20], ['judge', 'three', 'atk', .15], ['well', 'destroy', 'hp', .10], ['judge', 'boss'], ['collapse', 'rift']]) {
        const user = await reset(); corridor.enter(user, () => .99);
        user.paradise.temporary.push({ id: 'collapse', battles: 3 });
        forceEvent(user, event); const result = corridor.chooseEvent(user, choice, {}, () => .99);
        assert.equal(result.error, undefined);
        while (user.paradise.phase === 'combat') corridor.victory(user, () => .99);
        if (effect) assert.equal(user.paradise.effects[effect], amount, event);
        else { assert.equal(user.paradise.contracts.filter(c => c.star).length, 1); assert.equal(user.paradise.relics.length, event === 'collapse' ? 2 : 1); }
        if (event === 'mirror') assert.equal(user.paradise.contracts[0].bonus, .30);
        assert.equal(Number(user.paradise.effects.reward || 0), event === 'judge' && choice === 'three' ? .30 : 0);
    }
});

test('이동 후 권장 전투력이 현재 전투력의 1.1배 이상일 때만 경고한다', async t => {
    const user = await reset(); corridor.enter(user, () => .99);
    let playerPower = 100000;
    t.mock.method(rpg, 'calculateCombatPower', () => ({ total: playerPower }));
    user.paradise.floor = 7; user.paradise.phase = 'augment'; user.paradise.choices = ['contract', 'rest', 'rewind'];
    const choices = corridor.view(user).run.choices;
    assert.equal(choices[0].powerWarning, null);
    assert.equal(choices[1].powerWarning, null); assert.equal(choices[2].powerWarning, null);
    user.paradise.floor = 8;
    const boundary = corridor.recommendedPower(11) / 1.1;
    playerPower = Math.floor(boundary);
    assert.equal(corridor.view(user).run.choices[0].powerWarning.floor, 11);
    playerPower = Math.ceil(boundary);
    assert.equal(corridor.view(user).run.choices[0].powerWarning, null);
    playerPower = Math.floor(boundary) - 1;
    assert.equal(corridor.view(user).run.choices[0].powerWarning.floor, 11);
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
        corridor.offerAugments(user); corridor.finish(user); const rewards = corridor.view(user).run.rewards;
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

test('20분은 전투와 퍼즐에서 흐르고 증강, 길, 이벤트 선택과 재접속 중에는 멈춘다', async t => {
    const user = await reset();
    let now = Date.now(); t.mock.method(Date, 'now', () => now);
    corridor.enter(user, () => .99);
    assert.equal(corridor.view(user).run.timer.remainingMs, 1200000);
    now += 60000; corridor.victory(user, () => .99);
    assert.deepEqual(corridor.view(user).run.timer, { remainingMs: 1140000, paused: true });
    const round = user.paradise.offerId;
    now += 3600000;
    assert.equal(corridor.rerollAugment(user, user.paradise.choices[0], () => .4).error, undefined);
    assert.equal(user.paradise.offerId, round);
    assert.equal(corridor.remainingTime(structuredClone(user.paradise)), 1140000);
    assert.equal(corridor.advanceTime(user), false);
    user.paradise.choices = ['firstStrike']; corridor.chooseAugment(user, 'firstStrike', () => 0);
    assert.equal(user.paradise.phase, 'route');
    assert.equal(corridor.view(user).run.timer.paused, true);
    now += 600000; assert.equal(corridor.remainingTime(user.paradise), 1140000);
    user.paradise.routes[0].kind = 'event'; delete user.paradise.routes[0].gimmick;
    corridor.chooseRoute(user, user.paradise.routes[0].id, () => 0);
    assert.equal(user.paradise.phase, 'event'); assert.equal(corridor.view(user).run.timer.paused, true);
    await user.save(); now += 600000;
    const restored = (await request('/api/paradise')).data;
    assert.deepEqual(restored.run.timer, { remainingMs: 1140000, paused: true });
    now += 20000; forceEvent(user, 'puzzle'); corridor.chooseEvent(user, 'solve');
    assert.equal(corridor.view(user).run.timer.paused, false);
    now += 10000;
    corridor.answerPuzzle(user, null);
    assert.deepEqual(corridor.view(user).run.timer, { remainingMs: 1130000, paused: true });
});

test('저장된 길, 이벤트, 유물 선택의 시계를 한 번 멈추고 전투 진입 시 다시 진행한다', async t => {
    let now = Date.now(); t.mock.method(Date, 'now', () => now);
    for (const phase of ['route', 'event', 'relic']) {
        const user = await reset(); corridor.enter(user, () => .99);
        user.paradise.phase = phase; now += 1000;
        assert.equal(corridor.advanceTime(user), true);
        assert.equal(user.paradise.clock.paused, true);
        now += 3600000; assert.equal(corridor.remainingTime(user.paradise), 1199000);
        assert.equal(corridor.advanceTime(user), false);
        corridor.startCombat(user, 'normal', null, () => .99);
        now += 4000; assert.equal(corridor.remainingTime(user.paradise), 1195000);
    }
});

test('증강 자리마다 1회만 새로고침하며 중복·획득·장착 조건과 동시 요청을 검증한다', async () => {
    const user = await reset(); corridor.enter(user); corridor.victory(user, () => .99);
    user.paradise.relics.push('riftLens'); user.paradise.distortion = 10;
    corridor.getResources(user).mp = 0;
    const recoveredMp = Math.round(rpg.calculateUserStats(user).mp * .02);
    user.paradise.acquired.lastStand = 1;
    const initial = [...user.paradise.choices], remaining = corridor.remainingTime(user.paradise);
    await user.save();
    let view = (await request('/api/paradise')).data;
    const body = { ...bodyFor(view), choice: initial[0] };
    const [a, b] = await Promise.all([request('/api/paradise/reroll', body), request('/api/paradise/reroll', body)]);
    assert.equal(a.status, 200); assert.equal(b.status, 200);
    assert.deepEqual(a.data.state.run.choices, b.data.state.run.choices);
    view = b.data.state;
    assert.deepEqual(view.run.choices.map(c => c.canReroll), [false, true, true]);
    assert.deepEqual(view.run.choices.slice(1).map(c => c.id), initial.slice(1));
    assert.ok(!initial.includes(view.run.choices[0].id));
    assert.equal(view.run.choices[0].equipment, undefined);
    assert.notEqual(view.run.choices[0].id, 'lastStand');
    assert.equal(view.run.distortion, 6); assert.equal(view.run.timer.remainingMs, remaining);
    assert.equal(corridor.getResources(await rpg.getRPGUserByName(account.name)).mp, recoveredMp, '동시 요청에도 MP 2%를 한 번만 회복');
    const again = await request('/api/paradise/reroll', { ...bodyFor(view), choice: view.run.choices[0].id });
    assert.equal(again.status, 400); assert.match(again.data.error, /이미 새로고침/);
    assert.equal(corridor.getResources(await rpg.getRPGUserByName(account.name)).mp, recoveredMp);
    for (const index of [1, 2]) {
        const result = await request('/api/paradise/reroll', { ...bodyFor(view), choice: view.run.choices[index].id });
        assert.equal(result.status, 200); view = result.data.state;
    }
    assert.equal(new Set(view.run.choices.map(c => c.id)).size, 3);
    assert.deepEqual(view.run.choices.map(c => c.canReroll), [false, false, false]);
    const latest = await rpg.getRPGUserByName(account.name);
    const seen = latest.paradise.offerSeen;
    assert.equal(new Set(seen).size, 6);
    corridor.startCombat(latest); corridor.victory(latest);
    assert.deepEqual(corridor.view(latest).run.choices.map(c => c.canReroll), [true, true, true]);
});

test('새로고침할 후보가 소진되면 횟수를 쓰지 않고 지옥·전투 중 새로고침은 거절한다', async t => {
    const user = await reset(); corridor.enter(user);
    assert.match(corridor.rerollAugment(user, 'firstStrike').error, /선택 단계/);
    corridor.offerAugments(user);
    user.paradise.offerSeen = corridor.AUGMENTS.map(a => a.id);
    assert.match(corridor.rerollAugment(user, user.paradise.choices[0]).error, /새로 제시/);
    assert.deepEqual(user.paradise.rerolled, [false, false, false]);
    assert.ok(corridor.view(user).run.choices.every(c => !c.canReroll));
    const env = setupHell(t), hellUser = await env.user(); env.hell.enter(hellUser, env.hell.KEYS[0].name);
    assert.match(corridor.rerollAugment(hellUser, 'firstStrike').error, /선택 단계/);
    assert.equal(corridor.view(hellUser).run.timer, null);
    assert.equal(corridor.advanceTime(hellUser), false);
});

test('시간 만료는 전투·이벤트·퍼즐에서도 자동 귀환하고 동시 조회·재요청에 한 번만 정산한다', async () => {
    for (const phase of ['combat', 'event', 'puzzle']) {
        const user = await reset(); corridor.enter(user);
        const outside = [user.hp, user.mp];
        user.paradise.floor = user.paradise.clearedFloor = user.paradise.highestFloor = 100;
        user.paradise.battlesWon = user.paradise.rewardUnits = 1;
        user.paradise.contracts.push({ star: 5, type: '전직', name: '5성 전직 카드' });
        if (phase !== 'combat') { forceEvent(user, 'puzzle'); if (phase === 'puzzle') corridor.chooseEvent(user, 'solve'); }
        const before = Number(user.gold || 0);
        user.paradise.clock = { remainingMs: 100, limitMs: corridor.TIME_LIMIT_MS, updatedAt: Date.now() - 1000, paused: false };
        await user.save();
        const results = await Promise.all([request('/api/paradise'), request('/api/paradise')]);
        for (const result of results) {
            assert.equal(result.status, 200);
            assert.equal(result.data.run.outcome, 'timedOut');
            assert.equal(result.data.run.claimed, true);
            assert.equal(result.data.run.phase, 'ended');
            assert.ok(result.data.run.rewardSummary.length > 0);
        }
        const saved = await rpg.getRPGUserByName(account.name);
        assert.equal(saved.gold - before, 10000); assert.equal(saved.inventory.card.length, 1);
        assert.equal(saved.field, null); assert.deepEqual([saved.hp, saved.mp], outside);
        const claim = await request('/api/paradise/claim', bodyFor(results[1].data));
        assert.equal(claim.status, 200);
        assert.equal(saved.gold - before, 10000); assert.equal(saved.inventory.card.length, 1);
    }
});

test('시간 만료 시 카드 공간 부족은 미수령 보상으로 보존하며 진행 중 구형 탐험은 20분을 부여한다', async () => {
    const user = await reset(); corridor.enter(user);
    delete user.paradise.clock;
    user.paradise.startedAt = Date.now() - 86400000;
    assert.equal(corridor.advanceTime(user), true);
    assert.ok(corridor.remainingTime(user.paradise) > 1199000);
    user.paradise.contracts.push({ star: 5, type: '전직', name: '5성 전직 카드' });
    user.maxCardLimit = 1; user.inventory.card.push({ id: 0, star: 5, type: '일반' });
    user.paradise.clock.updatedAt = Date.now() - corridor.TIME_LIMIT_MS - 1000;
    assert.equal(corridor.advanceTime(user), true);
    assert.equal(user.paradise.outcome, 'timedOut'); assert.ok(!user.paradise.claimed);
    assert.match(corridor.view(user).run.timeoutClaimError, /보관함 공간/);
    assert.equal(corridor.view(user).run.canClaim, true);
    user.inventory.card.length = 0;
    assert.equal(corridor.claim(user).error, undefined);
    assert.equal(corridor.view(user).run.timeoutClaimError, null);
    assert.equal(user.inventory.card.length, 1);
});

test('퍼즐 유물은 성공할 때만 10% 회복과 3%p 보상을 주며 최대 30%p까지 누적한다', async () => {
    assert.ok(corridor.RELICS.length >= 22);
    assert.ok(corridor.RELICS.every(r => /합니다\.$/.test(r.desc) && r.iconUrl.includes('relic-')));
    assert.ok(corridor.AUGMENTS.every(a => !a.name.startsWith('패시브:')));
    const user = await reset(); corridor.enter(user); user.paradise.relics.push('crystalVial');
    const stats = rpg.calculateUserStats(user);
    for (let i = 0; i < 11; i++) {
        forceEvent(user, 'puzzle'); corridor.chooseEvent(user, 'solve');
        corridor.getResources(user).hp = corridor.getResources(user).mp = 1;
        corridor.answerPuzzle(user, user.paradise.event.puzzle.solution, () => .99);
        assert.equal(corridor.getResources(user).hp, 1 + Math.round(stats.hp * .10));
        assert.equal(corridor.getResources(user).mp, 1 + Math.round(stats.mp * .10));
        assert.ok(Math.abs(user.paradise.effects.reward - Math.min(i + 1, 10) * .03) < 1e-9);
    }
    assert.ok(Math.abs(user.paradise.effects.reward - .30) < 1e-9);
    forceEvent(user, 'puzzle'); corridor.chooseEvent(user, 'solve'); corridor.getResources(user).hp = 1;
    corridor.answerPuzzle(user, null);
    assert.equal(corridor.getResources(user).hp, 1);
    forceEvent(user, 'puzzle'); corridor.chooseEvent(user, 'solve'); user.paradise.effects.noHealing = 1;
    corridor.answerPuzzle(user, user.paradise.event.puzzle.solution);
    assert.equal(corridor.getResources(user).hp, 1);
});

test('천상 일반 몬스터는 입력과 관계없이 3.5초마다 공격하고 동시 조회·재접속에도 한 번만 처리한다', async t => {
    let now = Date.now(); t.mock.method(Date, 'now', () => now); t.mock.method(Math, 'random', () => .99);
    const user = await reset(); corridor.enter(user, () => .99);
    Object.assign(user.paradise.enemy, { hp: 1e12, maxHp: 1e12, atk: 100, crit: 0, cmb: 0 });
    const hp = corridor.getResources(user).hp; await user.save();
    const initial = (await request('/api/paradise')).data;
    const attack = await request('/api/paradise/attack', bodyFor(initial));
    assert.equal(attack.data.state.player.hp, hp); assert.equal(attack.data.state.run.combatEvents.at(-1).received, 0);
    now += 3499; assert.equal((await request('/api/paradise')).data.player.hp, hp);
    now++;
    const polls = await Promise.all([request('/api/paradise'), request('/api/paradise')]);
    assert.ok(polls.every(p => p.status === 200 && p.data.player.hp < hp));
    assert.equal(polls[1].data.run.combatEvents.filter(e => e.actor === 'enemy').length, 1);
    now += 7000;
    const resumed = (await request('/api/paradise')).data;
    const events = resumed.run.combatEvents.filter(e => e.actor === 'enemy');
    assert.equal(events.length, 3); assert.equal(events[2].at - events[1].at, 3500);
    assert.deepEqual((await request('/api/paradise')).data.run.combatEvents, resumed.run.combatEvents);
    const saved = await rpg.getRPGUserByName(account.name); corridor.victory(saved, () => .99); await saved.save();
    now += 60000; assert.equal((await request('/api/paradise')).data.run.combatEvents.filter(e => e.actor === 'enemy').length, 3);
    const env = setupHell(t), hellUser = await env.user(); env.hell.enter(hellUser, env.hell.KEYS[0].name);
    assert.equal(rpg.advanceParadiseCombat(hellUser, now + 40000), false);
    rpg.buildHuntResult(hellUser, {}, 1, { isBasic: true });
    assert.ok(hellUser.paradise.combatEvents.at(-1).receivedHits.length, '지옥은 기존 반격 유지');
});

test('천상 적은 종류별 행동 간격을 첫 행동과 후속 행동 모두에 적용한다', async t => {
    const now = Date.now(); t.mock.method(Date, 'now', () => now); t.mock.method(Math, 'random', () => .99);
    for (const [kind, interval] of [['normal', 3500], ['elite', 3000], ['boss', 2500], ['judge', 2500], ['rift', 2500], ['final', 2500], ['mirror', 2500]]) {
        const user = await reset(); corridor.enter(user, () => .99); corridor.startCombat(user, kind, null, () => .99);
        const enemy = user.paradise.enemy;
        Object.assign(enemy, { hp: 1e12, maxHp: 1e12, atk: 1, crit: 0, cmb: 0 });
        if (enemy.mirror) { enemy.mirror.rules = [{ cond: 'always', action: 'attack' }]; enemy.mirror.snapshot.stats.atk = 1; }
        assert.equal(user.field.nextEnemyAttackAt, now + interval, kind);
        rpg.advanceParadiseCombat(user, now + interval - 1);
        assert.equal(user.paradise.combatEvents?.length || 0, 0, kind);
        rpg.advanceParadiseCombat(user, now + interval);
        assert.equal(user.paradise.combatEvents.length, 1, kind);
        rpg.advanceParadiseCombat(user, now + interval * 3);
        assert.equal(user.paradise.combatEvents.length, 3, kind);
        assert.equal(user.paradise.combatEvents[2].at - user.paradise.combatEvents[1].at, interval, kind);
    }
});

test('천상 진입과 다음 전투에서 전직·스펙터 궁극기는 10초 후 사용할 수 있다', async t => {
    let now = Date.now(); t.mock.method(Date, 'now', () => now); t.mock.method(Math, 'random', () => .99);
    const user = await reset(); user.main_card = { id: 0, star: 9, type: '전직', specter: '빅뱅 스펙터' };
    corridor.enter(user, () => .99);
    const ultimates = rpg.getUltimateSkills(user).map(entry => entry.skill.name);
    assert.deepEqual(ultimates, ['유드 알레프', '빅뱅']);
    assert.equal(user.field.skillCooldowns['자인'], undefined);
    for (const name of ultimates) assert.equal(user.field.skillCooldowns[name], now + 10000);
    Object.assign(user.paradise.enemy, { hp: 1e12, maxHp: 1e12, atk: 0 }); await user.save();
    const state = (await request('/api/paradise')).data;
    for (const name of ultimates) assert.equal(state.battle.skills.find(skill => skill.name === name).cooldownEnd, now + 10000);
    now += 9999;
    for (const name of ultimates) assert.match(await rpg.useSkillInField(user, name), /스킬 쿨타임/);
    now++;
    for (const name of ultimates) {
        user.field.nextActionAt = 0; corridor.getResources(user).mp = rpg.calculateUserStats(user).mp;
        assert.ok(!(await rpg.useSkillInField(user, name)).startsWith('❌'), name);
    }
    corridor.startCombat(user, 'elite', null, () => .99);
    for (const name of ultimates) assert.equal(user.field.skillCooldowns[name], now + 10000);
    const env = setupHell(t), hellUser = await env.user(); hellUser.main_card = { ...user.main_card };
    env.hell.enter(hellUser, env.hell.KEYS[0].name);
    for (const name of ultimates) assert.equal(hellUser.field.skillCooldowns[name], undefined, '지옥은 기존 시작 상태 유지');
});

test('15분 탐험의 남은 시간에는 5분을 한 번만 더하며 증강 단계에서는 소모하지 않는다', async t => {
    const now = Date.now(); t.mock.method(Date, 'now', () => now);
    const user = await reset(); corridor.enter(user); corridor.offerAugments(user);
    user.paradise.clock = { remainingMs: 120000, updatedAt: now - 3600000, paused: true };
    assert.equal(corridor.advanceTime(user), true); assert.equal(corridor.remainingTime(user.paradise), 420000);
    assert.equal(corridor.advanceTime(user), false); assert.equal(corridor.remainingTime(user.paradise), 420000);
});

test('보호막 HUD는 겹친 보호막을 합치고 각 만료 시각·흡수 후 잔량을 표시한다', async t => {
    let now = Date.now(); t.mock.method(Date, 'now', () => now);
    const user = await reset(); corridor.enter(user);
    user.field.nextEnemyAttackAt = now + 60000;
    const shields = require('../combat_shields'), presentation = require('../public/combat-effects');
    shields.grant(user.field, { source: 'a', amount: 1000, expiresAt: now + 5000 });
    shields.grant(user.field, { source: 'b', amount: 2000, expiresAt: now + 10000 });
    await user.save();
    const player = (await request('/api/paradise')).data.battle.player;
    assert.equal(player.shield, 3000); assert.equal(presentation.shieldAmount(player, now), 3000);
    assert.equal(presentation.shieldAmount(player, now + 5000), 2000);
    assert.equal(presentation.shieldAmount(player, now + 10000), 0);
    const saved = await rpg.getRPGUserByName(account.name); shields.absorb(saved.field, 1500); await saved.save();
    assert.equal((await request('/api/paradise')).data.battle.player.shield, 1500);
    now += 10000; assert.equal((await request('/api/paradise')).data.battle.player.shield, 0);
});

test('루킴 해킹은 결과를 알리고 모든 캐릭터의 빌린 스킬을 한 전투 동안만 사용한다', async t => {
    t.mock.method(Math, 'random', () => .99);
    const cards = require('../DB/RPGenius/CharacterCards.json'), skills = require('../DB/RPGenius/Skills.json');
    for (let id = 0; id < cards.length; id++) {
        const user = await reset(); user.main_card = { id: id === 0 ? 1 : 0, star: 9, type: '전직' };
        corridor.enter(user, () => .99); corridor.offerAugments(user); user.paradise.choices = ['rukimHack'];
        const pool = cards.map((_, i) => i).filter(i => i !== user.main_card.id), roll = (pool.indexOf(id) + .1) / pool.length;
        const result = corridor.chooseAugment(user, 'rukimHack', () => roll);
        assert.match(result.message, /해킹 성공/);
        if (user.paradise.phase !== 'combat') corridor.startCombat(user, 'normal');
        assert.equal(user.paradise.battle.hackCard.id, id);
        Object.assign(user.paradise.enemy, { hp: 1e12, maxHp: 1e12, atk: 0, def: 0 });
        await user.save();
        const view = (await request('/api/paradise')).data;
        for (const index of cards[id].skills) {
            const name = skills[index].name;
            assert.ok(view.battle.skills.some(s => s.name === name && s.borrowed), name);
            const latest = await rpg.getRPGUserByName(account.name); latest.field.nextActionAt = 0;
            if (name === '시벌론') for (let i = 0; i < 5; i++) { latest.field.nextActionAt = 0; await rpg.useBasicAttackInField(latest); }
            latest.field.nextActionAt = 0;
            const message = await rpg.useSkillInField(latest, name);
            assert.ok(!message.startsWith('❌'), name + ': ' + message);
            assert.ok(latest.field.skillCooldowns[name] > 0, name);
            corridor.victory(latest, () => .99); corridor.startCombat(latest, 'normal');
            assert.ok(!rpg.getMainCardSkills(latest).some(s => s.index === index), name + ' 유출 방지');
        }
    }
});

test('월야섬은 신규 증강에서 제거하고 이미 진행 중인 전투의 계약은 보존한다', async t => {
    t.mock.method(Math, 'random', () => .99);
    const user = await reset(); corridor.enter(user);
    assert.ok(!corridor.AUGMENTS.some(a => a.id === 'moonDuel'));
    assert.ok(buff(user, 'moonDuel').error);
    user.paradise.nextMoonDuel = true; corridor.nextEncounter(user, () => .99);
    assert.notEqual(user.paradise.enemy?.kind, 'moonDuel');
    user.paradise.floor = 31;
    corridor.startCombat(user, 'moonDuel', { remaining: 1, kind: 'moonDuel', reward: 'moonDuel' });
    const enemy = user.paradise.enemy, mirror = enemy.mirror;
    assert.equal(enemy.kind, 'moonDuel'); assert.equal(enemy.characterCard.id, 1); assert.equal(enemy.characterCard.type, '전직');
    assert.equal(mirror.snapshot.equipment.entries.length, 6);
    const target = corridor.recommendedPower(user.paradise.floor) * 1.8;
    assert.ok(Math.abs(rpg.computeCombatPowerFromStats(mirror.snapshot.stats).total / target - 1) < .001);
    corridor.getResources(user).hp = 1e12;
    const pvp = require('../pvp'), stats = { ...rpg.calculateUserStats(user), hp: 1e12 };
    mirror.nextActionAt = mirror.enteredAt + 10000;
    const ult = pvp.corridorMirrorTurn(mirror, user, stats, mirror.hp, undefined, mirror.enteredAt + 10000);
    assert.equal(ult.events.at(-1).skillName, '안면강타');
    const normal = pvp.corridorMirrorTurn(mirror, user, stats, mirror.hp, undefined, mirror.enteredAt + 12500);
    assert.equal(normal.events.at(-1).skillName, '시벌론');
    mirror.mp = 0;
    const basic = pvp.corridorMirrorTurn(mirror, user, stats, mirror.hp, undefined, mirror.enteredAt + 15000);
    assert.equal(basic.events.at(-1).action, 'attack');
    corridor.victory(user, () => .99);
    assert.ok(!user.paradise.relics.includes('moonSeal'));
    assert.ok(user.paradise.contracts.some(c => c.star === 10 && c.type === '일반' && c.cardId === 1));
    corridor.finish(user, 'return');
    assert.equal(corridor.claim(user).error, undefined);
    assert.equal(user.inventory.card.filter(c => c.id === 1 && c.star === 9 && c.type === '일반').length, 1);
    corridor.claim(user);
    assert.equal(user.inventory.card.filter(c => c.id === 1 && c.star === 9 && c.type === '일반').length, 1);
});

test('천상 장비는 0~25강 표의 고정 능력치·비용·확률을 적용하고 실패 시 비용만 소모한다', async t => {
    const env = progressionEnvironment(t), p = env.progression, user = await env.user();
    rpg.addInventoryItem(user, env.token, 50000);
    const values = [5,7,9,11,13,15,18,21,24,27,30,35,40,45,50,55,63,71,79,87,95,107,119,131,143,155];
    const costs = [100,125,160,205,260,325,400,485,580,685,800,925,1060,1205,1360,1525,1700,1885,2080,2285,2500,2725,2960,3205,3460];
    const chances = [100,95,90,85,80,75,70,65,60,55,50,45,40,35,30,30,28,26,24,22,20,18,16,14,12];
    assert.ok(p.mutate(user, 'enhance', { slot: 'weapon' }).error);
    for (const slot of ['weapon','armor']) {
        assert.equal(p.view(user)[slot].atk + p.view(user)[slot].def + p.view(user)[slot].hp, 0);
        assert.equal(p.mutate(user, 'unlockEquipment', { slot }).error, undefined);
        assert.ok(p.mutate(user, 'unlockEquipment', { slot }).error);
        for (let level = 0; level <= 25; level++) {
            const gear = p.view(user)[slot];
            assert.equal(gear.level, level); assert.equal(gear[slot === 'weapon' ? 'atk' : 'def'], values[level] * (slot === 'weapon' ? 10 : 3));
            if (slot === 'armor') assert.equal(gear.hp, values[level] * 60);
            if (level === 25) { assert.equal(gear.next, null); assert.ok(p.mutate(user, 'enhance', { slot }).error); break; }
            assert.equal(gear.next.cost, Math.round(costs[level] * (slot === 'weapon' ? 1 : .8))); assert.equal(gear.next.chance, chances[level]);
            assert.equal(gear.next[slot === 'weapon' ? 'atk' : 'def'], values[level + 1] * (slot === 'weapon' ? 10 : 3));
            if (slot === 'armor') assert.equal(gear.next.hp, values[level + 1] * 60);
            assert.equal(p.mutate(user, 'enhance', { slot }, () => 0).error, undefined);
        }
    }
    user.paradiseProgression.weapon = 24; const coins = p.view(user).tokens;
    p.mutate(user, 'enhance', { slot: 'weapon' }, () => .99);
    assert.equal(p.view(user).tokens, coins - 3460); assert.equal(p.view(user).weapon.level, 24); assert.equal(p.view(user).lastResult.success, false);
    assert.ok(p.mutate(user, 'enhance', { slot: '__proto__' }).error);
});

test('특수능력은 순서대로 해금하고 100개로 선택한 줄만 중복 없이 다시 추첨한다', async t => {
    const env = progressionEnvironment(t), p = env.progression, user = await env.user();
    assert.equal(p.TRAITS.length, 47);
    assert.ok(p.mutate(user, 'unlockTrait', { index: 1 }).error);
    p.mutate(user, 'unlockTrait', { index: 0 }, () => 0);
    assert.deepEqual(user.paradiseProgression.traits, ['ordinaryRelic']); assert.equal(p.view(user).tokens, 49000);
    p.mutate(user, 'unlockTrait', { index: 1 }, () => 0);
    assert.deepEqual(user.paradiseProgression.traits, ['ordinaryRelic','silverAugment']); assert.equal(p.view(user).tokens, 46000);
    assert.ok(p.mutate(user, 'rerollTrait', {}).error);
    p.mutate(user, 'rerollTrait', { index: 0 }, () => .999);
    assert.deepEqual(user.paradiseProgression.traits, [p.TRAITS.at(-1).id,'silverAugment']); assert.equal(p.view(user).tokens, 45900);
    p.mutate(user, 'rerollTrait', { index: 1 }, () => .999);
    assert.deepEqual(user.paradiseProgression.traits, [p.TRAITS.at(-1).id,p.TRAITS.at(-2).id]); assert.equal(p.view(user).tokens, 45800);
    user.inventory.item = []; const before = structuredClone(user.paradiseProgression);
    assert.ok(p.mutate(user, 'rerollTrait', { index: 0 }, () => 0).error); assert.deepEqual(user.paradiseProgression, before);
});

test('천상 강화 API는 인증·중복·낡은 요청을 검증하고 증표와 결과를 함께 저장한다', async t => {
    const env = progressionEnvironment(t), user = await env.user();
    const body = { requestId: crypto.randomUUID(), revision: 0, slot: 'weapon', cost: 0, success: true };
    const route = '/api/paradise/progression/unlockEquipment';
    assert.equal((await request(route, body, false)).status, 401);
    const results = await Promise.all([request(route, body), request(route, body)]);
    assert.ok(results.every(r => r.status === 200)); assert.equal(results[0].data.state.progression.tokens, 49950);
    assert.deepEqual(results[0].data.state.progression, results[1].data.state.progression);
    const stale = await request(route, { ...body, requestId: crypto.randomUUID(), slot: 'armor' });
    assert.equal(stale.data.stale, true); assert.equal(stale.data.state.progression.tokens, 49950);
    const fresh = { ...body, requestId: crypto.randomUUID(), revision: 1 };
    const enhanced = await request('/api/paradise/progression/enhance', fresh);
    assert.equal(enhanced.status, 200); assert.equal(enhanced.data.state.progression.weapon.level, 1);
    assert.equal(enhanced.data.state.progression.tokens, 49850);
    assert.equal(persisted.get(user.id).paradiseProgression.weapon, 1);
    const lastWrite = writes.at(-1), names = Object.values(lastWrite.ExpressionAttributeNames);
    assert.ok(['inventory','paradiseProgression','paradiseProgressionReceipt'].every(key => names.includes(key)));
});

test('강화 저장 실패 시 증표와 결과를 복원하고 같은 요청을 재시도할 수 있다', async t => {
    const env = progressionEnvironment(t); await env.user();
    const send = DynamoDBDocumentClient.prototype.send; let fail = true;
    t.mock.method(DynamoDBDocumentClient.prototype, 'send', async function(command) {
        if (fail && command.constructor.name === 'UpdateCommand' && command.input.TableName === 'rpgenius_user') { fail = false; throw new Error('simulated progression save outage'); }
        return send.call(this, command);
    });
    const body = { requestId: crypto.randomUUID(), revision: 0, slot: 'armor' }, route = '/api/paradise/progression/unlockEquipment';
    const failed = await request(route, body); assert.equal(failed.status, 503); assert.equal(failed.data.retryable, true);
    const rolledBack = (await request('/api/paradise')).data.progression;
    assert.equal(rolledBack.tokens, 50000); assert.equal(rolledBack.armor.unlocked, false);
    const retry = await request(route, body); assert.equal(retry.status, 200); assert.equal(retry.data.state.progression.tokens, 49950);
});

test('영구 천상 장비는 천상 안에서만 적용하고 입장 전 HP·MP 및 지옥 능력치를 바꾸지 않는다', async t => {
    const env = progressionEnvironment(t), p = env.progression, user = await env.user();
    user.paradiseProgression.weapon = user.paradiseProgression.armor = 25;
    user.hp = 13; user.mp = 7; const outside = rpg.calculateUserStats(user);
    corridor.enter(user, () => .99); const inside = rpg.calculateUserStats(user);
    assert.equal(inside.atk, outside.atk + 1550); assert.equal(inside.def, outside.def + 465); assert.equal(inside.hp, outside.hp + 9300);
    assert.deepEqual(corridor.getResources(user), { hp: inside.hp, mp: inside.mp });
    assert.ok(p.mutate(user, 'rerollTrait', {}).error);
    const copy = { ...outside }; p.applyStats({ mode: 'hell', celestial: p.snapshot(user) }, copy); assert.deepEqual(copy, outside);
    corridor.finish(user, 'defeated'); assert.deepEqual(rpg.calculateUserStats(user), outside); assert.equal(user.hp, 13); assert.equal(user.mp, 7);
});

test('주요 능력치 샘플의 천상 +25 증가 비율은 전체 층 곡선에서 100층 차이보다 작다', () => {
    const progression = require('../paradise_progression');
    const samples = [{ atk: 10101, def: 4919, hp: 25037 }, { atk: 6666, def: 6824, hp: 34334 }, { atk: 16351, def: 7626, hp: 35916 }];
    for (const base of samples) {
        const enhanced = { ...base };
        progression.applyStats({ celestial: { weapon: 25, armor: 25, traits: [] } }, enhanced);
        // 장비가 전혀 없는 상태 대비 공격·방어 전투력 중 더 큰 증가 비율로 검증한다.
        const ratio = Math.max(enhanced.atk / base.atk, Math.sqrt(enhanced.hp * (100 + enhanced.def) / (base.hp * (100 + base.def))));
        for (let floor = 1; floor <= 899; floor++) {
            assert.ok(corridor.recommendedPower(floor) * ratio < corridor.recommendedPower(floor + 100), `${base.atk} 공격력 / ${floor}층`);
        }
    }
});

test('시작 유물은 지정 등급으로 지급하고 시작 증강은 같은 등급 3개·개별 새로고침·일시정지를 지원한다', async t => {
    const env = progressionEnvironment(t); let now = Date.now(); t.mock.method(Date, 'now', () => now);
    let user = await env.user(['ordinaryRelic','advancedRelic']), baseline = rpg.calculateUserStats(user);
    corridor.enter(user, () => .999);
    assert.deepEqual(user.paradise.relics.map(id => corridor.RELICS.find(r => r.id === id).rarity), ['normal','advanced']);
    assert.equal(rpg.calculateUserStats(user).hp, Math.round(baseline.hp * .5));
    user = await env.user(['silverAugment','prismaticAugment']); baseline = rpg.calculateUserStats(user);
    corridor.enter(user, () => .99);
    assert.equal(rpg.calculateUserStats(user).hp, Math.round(baseline.hp * .5)); assert.equal(rpg.calculateUserStats(user).def, Math.round(baseline.def * .5));
    for (const rarity of ['silver','prismatic']) {
        for (let i = 0; i < 20; i++) {
            corridor.offerAugments(user, () => i / 20, rarity);
            assert.ok(user.paradise.choices.every(id => !corridor.AUGMENTS.find(a => a.id === id).encounter));
        }
        const view = corridor.view(user); assert.equal(view.run.phase, 'augment'); assert.equal(view.run.startingAugment, true);
        assert.equal(view.run.choices.length, 3); assert.ok(view.run.choices.every(a => a.rarity === rarity && a.floors === 0));
        const remaining = corridor.remainingTime(user.paradise); now += 600000; assert.equal(corridor.remainingTime(user.paradise), remaining);
        corridor.rerollAugment(user, user.paradise.choices[0], () => .99);
        assert.ok(corridor.view(user).run.choices.every(a => a.rarity === rarity && !corridor.AUGMENTS.find(entry => entry.id === a.id).encounter));
        corridor.chooseAugment(user, user.paradise.choices[0], () => .99);
        if (user.paradise.stoneEntryOffer) corridor.chooseAugment(user, user.paradise.choices[0], () => .99);
    }
    assert.equal(user.paradise.floor, 1); assert.equal(user.paradise.phase, 'combat'); assert.equal(user.paradise.enemy.kind, 'normal');
    now += 4000; assert.equal(corridor.remainingTime(user.paradise), 1196000);
});

test('첫 정예 2마리는 현재 HP만 1로 시작하고 첫 이벤트만 상자방으로 바뀐다', async t => {
    const env = progressionEnvironment(t), user = await env.user(['fragileElites','firstTreasure']); corridor.enter(user, () => .99);
    for (let i = 0; i < 3; i++) { corridor.startCombat(user, 'elite', null, () => .99); assert.equal(user.paradise.enemy.hp, i < 2 ? 1 : user.paradise.enemy.maxHp); assert.ok(user.paradise.enemy.maxHp > 1); }
    corridor.nextEncounter(user, () => .01); assert.equal(user.paradise.event.id, 'chests');
    corridor.nextEncounter(user, () => .01); assert.notEqual(user.paradise.event.id, 'chests');
});

test('회복·층수·뒤틀림·제한시간 특수능력이 실제 천상 전이에 적용된다', async t => {
    const now = Date.now(); t.mock.method(Date, 'now', () => now);
    const env = progressionEnvironment(t); let user = await env.user(['woundedAscent','halfSteps']); corridor.enter(user, () => .99);
    let stats = rpg.calculateUserStats(user), resources = corridor.getResources(user), start = resources.hp;
    assert.equal(start, Math.max(1, Math.round(stats.hp * .05)));
    corridor.move(user, 5); assert.equal(user.paradise.floor, 6); assert.equal(resources.hp, start + Math.round(stats.hp * .25));
    corridor.move(user, 3); assert.equal(user.paradise.floor, 9);
    corridor.move(user, 1); assert.equal(user.paradise.floor, 10);
    corridor.move(user, 20); assert.equal(user.paradise.floor, 30);
    user.paradise.celestial.traits = ['upwardFate','halfSteps']; corridor.move(user, -10); assert.equal(user.paradise.floor, 31);
    user = await env.user(['augmentHp','augmentMp']); corridor.enter(user, () => .99); stats = rpg.calculateUserStats(user); resources = corridor.getResources(user); resources.hp = resources.mp = 1;
    buff(user, 'firstStrike'); assert.equal(resources.hp, 1 + Math.round(stats.hp * .02)); assert.equal(resources.mp, 1 + Math.round(stats.mp * .02));
    user = await env.user(['distortedEdge','chaosCrown']); corridor.enter(user, () => .99);
    user.paradise.distortion = 19; assert.equal(corridor.sumEffects(user.paradise).extraDamage || 0, 0);
    user.paradise.distortion = 20; assert.equal(corridor.sumEffects(user.paradise).extraDamage, .2);
    user.paradise.distortion = 60; assert.equal(corridor.sumEffects(user.paradise).final, .3);
    user = await env.user(['calmStrength','extraTime']); stats = rpg.calculateUserStats(user); corridor.enter(user, () => .99);
    assert.equal(rpg.calculateUserStats(user).atk, Math.round(stats.atk * 1.1)); assert.equal(corridor.remainingTime(user.paradise), 1500000);
    user.paradise.distortion = 1; assert.equal(rpg.calculateUserStats(user).atk, stats.atk);
});

test('후퇴란 없다는 하강 증강을 상승과 추가 선택으로 바꾸며 재접속에도 예약을 보존한다', async t => {
    t.mock.method(Math, 'random', () => .99);
    const env = progressionEnvironment(t), user = await env.user(['halfSteps', 'upwardFate']); corridor.enter(user, () => .99);
    user.paradise.floor = 40; user.paradise.phase = 'augment'; user.paradise.choices = ['future'];
    assert.equal(corridor.view(user).run.choices[0].floors, 10);
    assert.equal(buff(user, 'future').error, undefined);
    assert.equal(user.paradise.floor, 50); assert.equal(user.paradise.phase, 'augment');
    assert.equal(user.paradise.choices.length, 3); assert.equal(user.paradise.clock.paused, true);
    assert.equal(new Set(corridor.view(user).run.choices.map(a => a.rarity)).size, 1);
    assert.ok(corridor.chooseAugment(user, 'future').error); assert.equal(user.paradise.floor, 50);
    buff(user, 'puzzleInvite'); assert.equal(user.paradise.floor, 53); assert.equal(user.paradise.phase, 'augment');
    assert.deepEqual(user.paradise.pendingAugmentEvents, ['puzzle']);
    await user.save(); const state = (await request('/api/paradise')).data;
    assert.equal(state.run.phase, 'augment'); assert.equal(state.run.floor, 53);
    const resumed = await rpg.getRPGUserByName(account.name);
    buff(resumed, 'firstStrike'); assert.equal(resumed.paradise.event.id, 'puzzle');
    assert.equal(resumed.paradise.pendingAugmentEvents.length, 0);
    buff(resumed, 'rewind'); assert.equal(resumed.paradise.phase, 'augment'); assert.equal(resumed.paradise.forceElite, true);
    const floor = resumed.paradise.floor;
    buff(resumed, 'execution'); assert.equal(resumed.paradise.phase, 'combat'); assert.equal(resumed.paradise.enemy.kind, 'elite');
    assert.equal(resumed.paradise.floor, floor + corridor.AUGMENTS.find(a => a.id === 'execution').floors);
    assert.equal(resumed.paradise.forceElite, false);
    const starting = await env.user(['halfSteps', 'silverAugment']); corridor.enter(starting, () => .99);
    buff(starting, 'rest');
    assert.equal(starting.paradise.floor, 1); assert.equal(starting.paradise.phase, 'combat', '시작 증강은 이동하거나 추가 선택을 주지 않음');
});

test('마지막 은총은 사망 시 증표만 50% 지급하고 계약·골드는 제외하며 재입장 전에 정산한다', async t => {
    const env = progressionEnvironment(t), user = await env.user(['tokenBounty','deathInsurance']);
    corridor.enter(user, () => .99); corridor.victory(user, () => .99); corridor.move(user, 9);
    corridor.startCombat(user, 'normal', null, () => .99); corridor.victory(user, () => .99);
    corridor.move(user, 10); corridor.startCombat(user, 'normal', null, () => .99);
    user.paradise.contracts.push({ star: 9, type: '각성', name: '테스트 계약' });
    corridor.finish(user, 'defeated');
    assert.deepEqual(corridor.view(user).run.rewards.map(r => [r.name,r.count]), [['천상의 증표',120]]);
    assert.ok(corridor.enter(user).error); assert.ok(require('../paradise_hell').enter(user, '지옥 열쇠').error);
    const coins = env.progression.view(user).tokens, gold = user.gold;
    assert.equal(corridor.claim(user).error, undefined); corridor.claim(user);
    assert.equal(env.progression.view(user).tokens, coins + 120); assert.equal(user.gold, gold); assert.equal(user.inventory.card.length, 0);
    const survivor = await env.user(['tokenBounty']); corridor.enter(survivor, () => .99); corridor.move(survivor, 9); survivor.paradise.clearedFloor = 10;
    corridor.offerAugments(survivor); corridor.finish(survivor); assert.equal(corridor.view(survivor).run.rewards.find(r => r.name === '천상의 증표').count, 240);
});

test('일반 유물 추첨의 고급 확률은 8%이고 심판자 선택지는 현재 성흔 효과를 설명한다', async t => {
    const env = progressionEnvironment(t), user = await env.user(); corridor.enter(user);
    for (const [roll,rarity] of [[.0799,'advanced'],[.08,'normal'],[.99,'normal']]) {
        user.paradise.relics = []; corridor.grantRelic(user, null, () => roll);
        assert.equal(corridor.RELICS.find(r => r.id === user.paradise.relics[0]).rarity, rarity);
    }
    forceEvent(user, 'judge');
    assert.ok(corridor.view(user).run.event.choices.some(c => c.desc.includes(corridor.RELICS.find(r => r.id === 'judgment').desc)));
});

test('심판자는 150층부터 등장하고 성흔은 최종 피해 35%, 종료 보상 50%를 적용한다', async () => {
    const user = await reset(); corridor.enter(user);
    for (const floor of [1, 149, 150]) for (const distortion of [0, 50]) {
        Object.assign(user.paradise, { floor, distortion });
        const events = new Set();
        for (let i = 0; i < 100; i++) {
            let call = 0; corridor.nextEncounter(user, () => call++ === 0 ? 0 : (i + .5) / 100);
            events.add(user.paradise.event.id);
        }
        assert.equal(events.has('judge'), floor >= 150);
    }
    user.paradise.relics = ['judgment'];
    assert.equal(corridor.sumEffects(user.paradise).final, .35);
    corridor.offerAugments(user); corridor.finish(user);
    assert.equal(user.paradise.rewardBonus, .50);
});

test('증강 세 후보와 새로고침은 같은 등급이며 엘리트 승리의 프리즘 확률이 높다', async () => {
    const user = await reset(); corridor.enter(user);
    for (const distortion of [0, 50]) {
        user.paradise.distortion = distortion;
        const rates = [];
        for (const elite of [false, true]) {
            let prisms = 0;
            for (let i = 0; i < 20; i++) {
                user.paradise.augmentFromElite = elite;
                let call = 0; corridor.offerAugments(user, () => call++ === 0 ? (i + .5) / 20 : .5);
                const choices = user.paradise.choices.map(id => corridor.AUGMENTS.find(a => a.id === id));
                assert.equal(choices.length, 3);
                const rarity = choices[0].rarity;
                assert.ok(choices.every(a => a.rarity === rarity));
                if (rarity === 'prismatic') prisms++;
                for (const choice of i === 0 ? choices : []) {
                    assert.equal(corridor.rerollAugment(user, choice.id, () => .5).error, undefined);
                    assert.ok(user.paradise.choices.every(id => corridor.AUGMENTS.find(a => a.id === id).rarity === rarity));
                }
            }
            rates.push(prisms * 5);
        }
        assert.deepEqual(rates, distortion === 0 ? [20, 40] : [15, 35]);
    }
});

test('증강 후 중복된 갈림길도 저장되며 유효한 길 하나만 선택할 수 있다', async t => {
    t.mock.method(Math, 'random', () => .99);
    const user = await reset(); corridor.enter(user); corridor.victory(user, () => .5);
    user.paradise.choices = ['blade']; user.paradise.offerRarity = 'silver'; await user.save();
    const before = (await request('/api/paradise')).data;
    const result = await request('/api/paradise/augment', { ...bodyFor(before), choice: 'blade' });
    assert.equal(result.status, 200);
    const state = result.data.state;
    assert.equal(state.run.phase, 'route'); assert.equal(state.run.canReturn, false);
    assert.equal(state.run.routes.length, 2); assert.equal(new Set(state.run.routes.map(r => r.id)).size, 2);
    assert.deepEqual(state.run.routes.map(r => r.kind), ['normal', 'normal']);
    assert.ok(state.run.routes.every(r => !Object.hasOwn(r, 'recommendedPower') && !Object.hasOwn(r, 'event')));
    assert.deepEqual((await request('/api/paradise')).data.run.routes, state.run.routes);
    assert.equal((await request('/api/paradise/route', { ...bodyFor(state), choice: 'fake' })).status, 400);
    assert.equal((await request('/api/paradise/retire', bodyFor(state))).status, 400);
    const route = state.run.routes.find(r => r.kind !== 'event'), body = { ...bodyFor(state), choice: route.id };
    const chosen = await request('/api/paradise/route', body);
    assert.equal(chosen.status, 200); assert.equal(chosen.data.state.run.enemy.kind, route.kind);
    assert.equal(chosen.data.state.run.floor, state.run.floor);
    const retried = await request('/api/paradise/route', body);
    assert.equal(retried.data.state.run.enemy.id, chosen.data.state.run.enemy.id);
    assert.equal((await request('/api/paradise/route', { ...bodyFor(state), choice: state.run.routes[1].id })).status, 409);
    assert.equal(persisted.get(account.id).paradise.phase, 'combat');
});

test('강제 엘리트, 지정 이벤트, 붕괴, 999층은 갈림길을 생략한다', async () => {
    for (const scenario of ['elite', 'event', 'collapse', 'final']) {
        const user = await reset(); corridor.enter(user);
        const run = user.paradise, id = scenario === 'event' ? 'chestInvite' : 'firstStrike';
        run.phase = 'augment'; run.choices = [id];
        if (scenario === 'elite') run.forceElite = true;
        if (scenario === 'collapse') run.distortion = 99;
        if (scenario === 'final') run.floor = 998;
        const result = corridor.chooseAugment(user, id, () => .5);
        assert.equal(result.error, undefined); assert.notEqual(run.phase, 'route');
        if (scenario === 'elite' || scenario === 'final') assert.equal(run.enemy.kind, scenario);
        else assert.equal(run.event.id, scenario === 'event' ? 'chests' : 'collapse');
    }
});

test('모든 층의 엘리트 유물은 60% 확률로 세 후보를 제공하며 선택 중 시간 정지와 중복 요청을 처리한다', async t => {
    let now = Date.now(); t.mock.method(Date, 'now', () => now);
    let user = await reset(); corridor.enter(user); user.paradise.floor = 1; corridor.startCombat(user, 'elite'); corridor.victory(user, () => .5999);
    assert.equal(user.paradise.phase, 'relic'); assert.equal(user.paradise.relics.length, 0);
    user = await reset(); corridor.enter(user); user.paradise.floor = 100; corridor.startCombat(user, 'elite'); corridor.victory(user, () => .60);
    assert.equal(user.paradise.phase, 'augment');
    user = await reset(); corridor.enter(user); user.paradise.floor = 100; user.paradise.relics = ['necklace']; corridor.startCombat(user, 'elite'); corridor.victory(user, () => 0);
    await user.save();
    let state = (await request('/api/paradise')).data;
    assert.equal(state.run.phase, 'relic'); assert.equal(state.run.relicPicksRemaining, 1); assert.equal(state.run.canReturn, false);
    assert.equal(state.run.relicChoices.length, 3); assert.equal(new Set(state.run.relicChoices.map(r => r.id)).size, 3);
    assert.ok(state.run.relicChoices.every(r => !r.special && r.id !== 'necklace'));
    assert.equal(state.run.timer.paused, true);
    const remaining = state.run.timer.remainingMs;
    now += 3600000;
    const restored = (await request('/api/paradise')).data;
    assert.deepEqual(restored.run.timer, { remainingMs: remaining, paused: true });
    assert.deepEqual(restored.run.relicChoices, state.run.relicChoices);
    const picks = [];
    for (let i = 0; i < 1; i++) {
        assert.deepEqual((await request('/api/paradise')).data.run.relicChoices, state.run.relicChoices);
        assert.equal((await request('/api/paradise/relic', { ...bodyFor(state), choice: 'judgment' })).status, 400);
        const choice = state.run.relicChoices[0].id, body = { ...bodyFor(state), choice };
        assert.ok(!picks.includes(choice)); picks.push(choice);
        const selected = await request('/api/paradise/relic', body);
        assert.equal(selected.status, 200); state = selected.data.state;
        assert.deepEqual(state.run.timer, { remainingMs: remaining, paused: true });
        const retry = await request('/api/paradise/relic', body);
        assert.deepEqual(retry.data.state.run.relics, state.run.relics);
        assert.equal(state.run.relicPicksRemaining, 0);
    }
    assert.equal(state.run.phase, 'augment');
    assert.ok(persisted.get(account.id).paradise.relics.includes(picks[0]));
    user = await rpg.getRPGUserByName(account.name);
    user.paradise.relics = []; user.paradise.relicPicksRemaining = 1;
    for (const [roll, expected] of [[.0799, 1], [.08, 0], [.99, 0]]) {
        corridor.offerRelics(user, () => roll);
        assert.equal(corridor.view(user).run.relicChoices.filter(r => r.rarity === 'advanced').length, expected);
    }
    user.paradise.distortion = 100;
    corridor.chooseRelic(user, user.paradise.relicChoices[0], () => .5);
    assert.equal(user.paradise.event.id, 'collapse');
});

test('낙원 귀환 완료를 저장하여 재접속해도 정산 화면을 다시 열지 않고 미수령 보상은 보존한다', async () => {
    let user = await reset(); corridor.enter(user); corridor.victory(user); corridor.finish(user); await user.save();
    let state = (await request('/api/paradise')).data;
    assert.equal((await request('/api/paradise/dismiss', bodyFor(state))).status, 400);
    const claimed = await request('/api/paradise/claim', bodyFor(state)); state = claimed.data.state;
    const body = bodyFor(state), dismissed = await request('/api/paradise/dismiss', body);
    assert.equal(dismissed.status, 200); assert.equal(dismissed.data.state.run, null);
    assert.equal((await request('/api/paradise/dismiss', body)).data.state.run, null);
    assert.equal((await request('/api/paradise')).data.run, null);
    assert.ok(persisted.get(account.id).paradise.dismissedAt);
    assert.equal(corridor.view(structuredClone(persisted.get(account.id))).run, null);
    const entered = await request('/api/paradise/enter', bodyFor(dismissed.data.state));
    assert.equal(entered.status, 200); assert.notEqual(entered.data.state.runId, body.runId);
    user = await reset(); corridor.enter(user); corridor.finish(user, 'defeated'); await user.save();
    state = (await request('/api/paradise')).data;
    assert.equal((await request('/api/paradise/dismiss', bodyFor(state))).data.state.run, null);
});

test('지옥도 상자를 개봉한 뒤 낙원 귀환을 저장하며 미개봉 보상은 숨기지 않는다', async t => {
    const row = require('../paradise_hell_content').INITIAL_CONFIG.rewards.find(row => row.id === 'fragment');
    const env = setupHell(t, [row]), user = await env.user(); env.hell.enter(user, env.hell.KEYS[0].name);
    user.paradise.clearedFloor = 30; env.hell.finish(user, 'cleared', () => .99); await user.save();
    let state = (await request('/api/paradise')).data;
    assert.equal((await request('/api/paradise/dismiss', bodyFor(state))).status, 400);
    const opened = await request('/api/paradise/chest', { ...bodyFor(state), chest: state.run.chests[0].id });
    assert.equal(opened.status, 200); state = opened.data.state;
    assert.equal((await request('/api/paradise/dismiss', bodyFor(state))).data.state.run, null);
    assert.equal((await request('/api/paradise')).data.run, null);
    assert.equal(corridor.view(structuredClone(persisted.get(account.id))).run, null);
});

test('구형 혼합 등급 선택지는 한 번만 저장 갱신하고 32개 새 일반 유물은 획득 중에만 적용한다', async () => {
    const user = await reset(); corridor.enter(user);
    user.paradise.phase = 'augment'; user.paradise.clock.paused = true; user.paradise.choices = ['blade', 'firstStrike', 'deathHandshake']; await user.save();
    const oldRevision = user.paradise.revision, state = (await request('/api/paradise')).data;
    assert.equal(new Set(state.run.choices.map(a => a.rarity)).size, 1);
    assert.equal(state.revision, oldRevision + 1);
    assert.equal((await request('/api/paradise')).data.revision, state.revision);
    const added = corridor.RELICS.filter(r => r.effect);
    assert.equal(added.length, 32); assert.ok(added.every(r => r.rarity === 'normal' && r.desc.endsWith('합니다.')));
    const latest = await rpg.getRPGUserByName(account.name), before = rpg.calculateUserStats(latest);
    latest.paradise.relics = ['bluntWhetstone', 'quiltPatch', 'tinBuckle', 'brassReceipt'];
    const after = rpg.calculateUserStats(latest);
    assert.equal(after.atk, Math.round(before.atk * 1.05)); assert.equal(after.hp, Math.round(before.hp * 1.05)); assert.equal(after.def, Math.round(before.def * 1.07));
    corridor.finish(latest); assert.equal(latest.paradise.rewardBonus, .03);
    assert.deepEqual(rpg.calculateUserStats(latest), before);
});

test('운영 지옥 보상 변경은 요청한 수량·입장권만 바꾸며 다른 설정과 진행 중 보상표는 보존한다', async t => {
    const { updateRewards } = require('../scripts/update_paradise_hell_rewards');
    const env = setupHell(t), user = await env.user(); env.hell.enter(user, env.hell.KEYS[0].name);
    const snapshot = structuredClone(user.paradise.rewardTable), before = { other: { empty: [] }, hell: { ...env.config.hell, enabled: false } };
    before.hell.rewards = before.hell.rewards.filter(r => r.id !== 'heavenTicket');
    before.hell.rewards.find(r => r.id === 'goldPouch').name = '운영자 이름';
    const original = structuredClone(before), after = updateRewards(before);
    assert.deepEqual(before, original); assert.deepEqual(after.other, before.other); assert.equal(after.hell.enabled, false);
    assert.equal(after.hell.rewards.find(r => r.id === 'goldPouch').name, '운영자 이름');
    assert.deepEqual(after.hell.rewards.find(r => r.id === 'heavenTicket').counts, [1,2,3,4,5,6,8,10,12,15,18]);
    assert.deepEqual(after.hell.rewards.filter(r => !['goldPouch','heavenTicket'].includes(r.id)), before.hell.rewards.filter(r => r.id !== 'goldPouch'));
    assert.deepEqual(updateRewards(after), after); assert.deepEqual(user.paradise.rewardTable, snapshot);
});

test('줄별 재설정 API는 다른 능력을 유지하고 같은 요청을 반복해도 증표 100개만 차감한다', async t => {
    const env = progressionEnvironment(t); await env.user(['ordinaryRelic','silverAugment']);
    t.mock.method(Math, 'random', () => .999);
    const body = { requestId: crypto.randomUUID(), revision: 0, index: 0 }, route = '/api/paradise/progression/rerollTrait';
    const [a,b] = await Promise.all([request(route,body),request(route,body)]);
    assert.equal(a.status,200); assert.equal(b.status,200);
    const lastTrait = require('../paradise_progression').TRAITS.at(-1).id;
    const previousTrait = require('../paradise_progression').TRAITS.at(-2).id;
    assert.deepEqual(a.data.state.progression.traits.lines.map(l => l.id), [lastTrait,'silverAugment']);
    assert.deepEqual(a.data.state.progression,b.data.state.progression); assert.equal(a.data.state.progression.tokens,49900);
    const invalid = await request(route,{requestId:crypto.randomUUID(),revision:1,index:2});
    assert.equal(invalid.status,400); assert.equal(invalid.data.state.progression.tokens,49900);
    const second = await request(route,{requestId:crypto.randomUUID(),revision:1,index:1});
    assert.equal(second.status,200); assert.equal(second.data.state.progression.tokens,49800);
    assert.deepEqual(second.data.state.progression.traits.lines.map(l => l.id), [lastTrait,previousTrait]);
});


test('거울과 플레이어의 보호막은 흡수량을 타격 사건으로 보내고 HP 피해와 분리한다', async t => {
    let now = Date.now(); t.mock.method(Date, 'now', () => now); t.mock.method(Math, 'random', () => .99);
    const shields = require('../combat_shields'), user = await reset(); corridor.enter(user);
    Object.assign(user.paradise.enemy, { atk: 100, crit: 0, cmb: 0, maxCmb: 0 });
    shields.grant(user.field, { source: 'test', amount: 1e8, expiresAt: now + 60000 });
    now += 4000; rpg.advanceParadiseCombat(user, now);
    const incoming = user.paradise.combatEvents.at(-1);
    assert.equal(incoming.received, 0); assert.ok(incoming.receivedHits.some(h => h.type === 'absorbed' && h.damage > 0));
    corridor.startCombat(user, 'mirror');
    const mirror = user.paradise.enemy.mirror;
    mirror.snapshot.stats.avd = 0;
    shields.grant(mirror, { source: 'mirror-test', amount: 1e9, expiresAt: now + 50000 });
    const hp = mirror.hp;
    rpg.buildHuntResult(user, {}, 100, { isBasic: true, comboHitCount: 1 });
    const outgoing = user.paradise.combatEvents.at(-1);
    assert.equal(outgoing.damage, 0); assert.equal(mirror.hp, hp);
    const absorbed = outgoing.hits.filter(h => h.type === 'absorbed').reduce((n,h) => n + h.damage, 0);
    assert.ok(absorbed > 0);
    const enemy = corridor.view(user).run.enemy;
    assert.equal(enemy.shield, 1e9 - absorbed);
    assert.equal(require('../public/combat-effects').shieldAmount(enemy, now + 50000), 0);
    mirror.shieldLayers = []; mirror.shield = null;
    shields.grant(mirror, { source: 'mirror-test', amount: 1, expiresAt: now + 50000 });
    rpg.buildHuntResult(user, {}, 100, { isBasic: true, comboHitCount: 1 });
    const partial = user.paradise.combatEvents.at(-1);
    assert.equal(partial.hits.find(h => h.type === 'absorbed').damage, 1);
    assert.ok(partial.damage > 0);
    assert.equal(partial.hits.filter(h => h.type !== 'absorbed').reduce((n,h) => n + h.damage, 0), partial.damage);
    assert.equal(corridor.view(user).run.enemy.shield, 0);
});

test('전투 숫자는 보호막·고정 피해·지속 피해를 구별하고 소환 공격은 지속 피해로 취급하지 않는다', () => {
    const { damageStyle } = require('../public/combat-effects');
    assert.deepEqual(damageStyle({action:'basic'}, {type:'absorbed'}), {shield:true,fixed:false,dot:false});
    for (const hit of [{fixed:true},{label:'스킬 고정 피해'},{label:'000 추가 피해'}]) assert.equal(damageStyle({},hit).fixed,true);
    assert.equal(damageStyle({dot:true},{}).dot,true); assert.equal(damageStyle({action:'dot'},{}).dot,true);
    assert.equal(damageStyle({action:'summon'},{}).dot,false); assert.equal(damageStyle({action:'tick',dot:false},{}).dot,false);
});

test('일반 WebGL API도 보호막 흡수량과 숫자가 포함된 고정 피해 및 화상 사건을 전달한다', async t => {
    const user = await reset();
    user.field = { name: '부타게임[H]', phase: 'elite', elite: { hp: 1e9 }, skillCooldowns: {}, equipmentState: {} };
    await user.save();
    t.mock.method(rpg, 'useBasicAttackInField', async () => '⚔️ 1,234 · 000 추가 피해 피해를 입혔습니다.\n🛡️ 보호막이 567 피해를 흡수했습니다.');
    const result = await request('/api/hfield/attack', {});
    assert.equal(result.status, 200); assert.equal(result.data.ok, true);
    assert.equal(result.data.event.hits[0].damage, 1234);
    assert.equal(require('../public/combat-effects').damageStyle(result.data.event, result.data.event.hits[0]).fixed, true);
    assert.equal(result.data.event.receivedHits[0].type, 'absorbed');
    assert.equal(result.data.event.receivedHits[0].damage, 567); assert.equal(result.data.event.received, 0);
    t.mock.method(rpg, 'drainFieldTickEvents', () => ['화상', '화상 폭발', '익테봇'].map(source => ({ fieldName: user.field.name, damage: 50, source })));
    const state = await request('/api/hfield');
    assert.equal(state.status, 200);
    assert.deepEqual(state.data.events.map(event => event.dot), [true, false, false]);
});

test('지옥은 보상 종류가 부족해도 중복을 채우지 않고 풍요 보장을 유지한다', async t => {
    const rows = require('../paradise_hell_content').INITIAL_CONFIG.rewards.filter(row => ['fragment', 'key', 'goldPouch'].includes(row.id));
    rows[2] = { ...rows[2], weight: 0 };
    const env = setupHell(t, rows), user = await env.user(); env.hell.enter(user, env.hell.KEYS[0].name);
    Object.assign(user.paradise, { clearedFloor: 30, bonusChests: 5, richChests: 1 });
    env.hell.finish(user, 'cleared', () => .99);
    assert.equal(user.paradise.chests.length, 2);
    assert.equal(new Set(user.paradise.chests.map(c => c.category)).size, 2);
    assert.ok(user.paradise.chests.every(c => c.category !== rows[2].id));
    assert.equal(user.paradise.chests.at(-1).rich, true);
    assert.equal(user.paradise.opensRemaining, 1);
});

test('상태 조회는 현재 능력치를 한 번 계산해 플레이어와 스킬에 재사용하고 다음 요청에서는 갱신한다', async t => {
    const user = await reset(); user.main_card.type = '전직'; user.main_card.star = 9;
    corridor.enter(user); user.field.nextEnemyAttackAt = Date.now() + 600000; await user.save();
    const calculate = rpg.calculateUserStats;
    const spy = t.mock.method(rpg, 'calculateUserStats', calculate);
    const first = (await request('/api/paradise')).data;
    assert.equal(first.run.phase, 'combat'); assert.equal(spy.mock.callCount(), 1);
    assert.equal(first.player.combatPower, first.battle.player.combatPower);
    assert.equal(first.player.maxHp, first.battle.player.maxHp);
    const latest = await rpg.getRPGUserByName(account.name); latest.paradise.relics.push('bluntWhetstone'); await latest.save();
    const second = (await request('/api/paradise')).data;
    assert.equal(spy.mock.callCount(), 2); assert.ok(second.player.atk > first.player.atk);
    assert.equal(second.player.atk, second.battle.player.atk);
    const stats = calculate(latest), before = structuredClone(stats);
    assert.deepEqual(rpg.calculateCombatPower(latest, stats), rpg.calculateCombatPower(latest));
    assert.deepEqual(stats, before);
});

test('목걸이는 종료 보상만 30% 늘리고 기존 처치 배율 기록은 더 이상 반영하지 않는다', async () => {
    const user = await reset(); corridor.enter(user);
    user.paradise.relics = ['necklace'];
    corridor.startCombat(user, 'elite', { kind: 'elite', remaining: 1, reward: 'casino' });
    corridor.victory(user, () => .99);
    assert.equal(user.paradise.relics.length, 2);
    assert.equal(user.paradise.phase, 'augment');
    user.paradise.rewardUnits = 30; user.paradise.eliteUnits = 30;
    corridor.finish(user);
    assert.equal(corridor.view(user).run.rewards.find(r => r.type === '골드').count, 130);
});

test('마력의 구슬은 MP 15%를 회복하고 균열의 심장은 정돈된 수치를 적용한다', async () => {
    const user = await reset(); corridor.enter(user);
    const base = rpg.calculateUserStats(user); user.paradise.relics = ['orb'];
    corridor.getResources(user).mp = 0; corridor.startCombat(user, 'normal');
    assert.equal(corridor.getResources(user).mp, Math.round(base.mp * .15));
    user.paradise.relics = ['riftHeart']; const stats = rpg.calculateUserStats(user);
    assert.equal(stats.atk, Math.round(base.atk * 1.70));
    assert.equal(stats.takenDamage, Number(base.takenDamage || 0) - .20);
    corridor.victory(user, () => .99); corridor.finish(user);
    assert.equal(corridor.view(user).run.rewards.find(r => r.type === '골드').count, 200);
});

test('연속 엘리트도 처치마다 유물 추첨하며 붕괴 계약은 세 번째 승리에만 보상을 준다', async () => {
    const user = await reset(); corridor.enter(user);
    user.paradise.temporary.push({ id: 'collapse', battles: 3 });
    corridor.startCombat(user, 'elite', { kind: 'elite', remaining: 3 });
    for (let i = 1; i <= 3; i++) {
        corridor.victory(user, () => 0);
        assert.equal(user.paradise.relicPicksRemaining, i);
        assert.equal(Number(user.paradise.effects.reward || 0), i === 3 ? .30 : 0);
    }
    assert.equal(user.paradise.phase, 'relic');
});

function shopEnvironment(t) {
    const { PRODUCTS, LEGENDARY_BOX } = require('../scripts/register_paradise_shop'), shop = require('../paradise_shop'), get = rpg.getDataCache;
    const items = structuredClone(get('Item')), config = { ...get('Paradise'), shop: structuredClone(PRODUCTS) };
    for (const name of ['천상의 증표', ...PRODUCTS.map(p => p.item)]) if (!items.some(i => i.name === name)) items.push(name === LEGENDARY_BOX.name ? structuredClone(LEGENDARY_BOX) : { name, type: '재료', desc: name });
    t.mock.method(rpg, 'getDataCache', (key, fallback) => key === 'Item' ? items : key === 'Paradise' ? config : get(key, fallback));
    const token = items.findIndex(i => i.name === '천상의 증표');
    return { shop, items, config, token, async user() {
        const user = await reset(); user.gold = 1000000000; rpg.addInventoryItem(user, token, 2000000); await user.save(); return user;
    } };
}
const shopBody = (state, product, quantity = 1) => ({ requestId: crypto.randomUUID(), revision: state.shop.revision, catalogRevision: state.shop.catalogRevision, product, quantity });

test('낙원 상점은 일반 계정에도 노출되고 로그인한 계정으로 구매할 수 있다', async t => {
    const env = shopEnvironment(t); await reset();
    assert.equal((await request('/api/paradise')).data.shop.items.length, 12);
    assert.equal((await request('/api/paradise/shop/buy', {})).status, 400);
    assert.equal((await request('/api/paradise/shop/buy', {}, false)).status, 401);
    const user = await env.user(), state = (await request('/api/paradise')).data;
    assert.equal(state.shop.items.length, 12);
    assert.equal(state.shop.balances.tokens, 2000000);
    assert.deepEqual(state.shop.items.filter(i => i.currency === 'gold').map(i => [i.price, i.weeklyLimit]), [[1000000, 1], [10000000, 2], [100000000, null]]);
    assert.equal(user.isAdmin, false);
    const purchased = await request('/api/paradise/shop/buy', shopBody(state, 'warcry'));
    assert.equal(purchased.status, 200);
    assert.equal(purchased.data.state.shop.balances.tokens, 1999900);
    assert.equal(purchased.data.state.shop.items.find(item => item.id === 'warcry').owned, 1);
});

test('낙원 상점은 요청 중복과 동시 구매를 막고 재화와 상품을 함께 저장한다', async t => {
    const env = shopEnvironment(t); await env.user(); let state = (await request('/api/paradise')).data;
    const body = shopBody(state, 'trade-ticket', 2), first = await request('/api/paradise/shop/buy', body);
    assert.equal(first.status, 200); assert.equal(first.data.state.shop.balances.tokens, 1998000);
    const saved = structuredClone(persisted.get(account.id));
    const retry = await request('/api/paradise/shop/buy', body);
    assert.equal(retry.status, 200); assert.deepEqual(retry.data.purchase, first.data.purchase);
    assert.deepEqual(persisted.get(account.id), saved);
    assert.equal((await request('/api/paradise/shop/buy', { ...body, quantity: 3 })).status, 400);
    state = first.data.state;
    const parallel = await Promise.all([request('/api/paradise/shop/buy', shopBody(state, 'heaven-weekly-1')), request('/api/paradise/shop/buy', shopBody(state, 'heaven-weekly-1'))]);
    assert.deepEqual(parallel.map(r => r.status).sort(), [200, 409]);
    assert.equal((await request('/api/paradise')).data.shop.balances.gold, 999000000);
    const write = writes.filter(w => Object.values(w.ExpressionAttributeNames || {}).includes('paradiseShopReceipt')).at(-1);
    for (const key of ['inventory', 'gold', 'paradiseShop', 'paradiseShopReceipt']) assert.ok(Object.values(write.ExpressionAttributeNames).includes(key));
});

test('구매 저장 후 응답을 잃어도 같은 요청 재시도로 한 번만 지급한다', async t => {
    const env = shopEnvironment(t); await env.user(); const state = (await request('/api/paradise')).data, body = shopBody(state, 'orb-box');
    const commit = rpg.commitProtectedUserChange; let fail = true;
    t.mock.method(rpg, 'commitProtectedUserChange', async (...args) => { await commit(...args); if (fail) { fail = false; throw new Error('simulated lost response'); } });
    assert.equal((await request('/api/paradise/shop/buy', body)).status, 503);
    const result = await request('/api/paradise/shop/buy', body);
    assert.equal(result.status, 200); assert.equal(result.data.state.shop.balances.tokens, 1900000);
    assert.equal(result.data.state.shop.items.find(i => i.id === 'orb-box').owned, 1);
});

test('주간 상품별 한도와 한국 시간 월요일 초기화를 적용하고 잘못된 수량과 잔액을 거부한다', async t => {
    const env = shopEnvironment(t), user = await env.user(); const sun = new Date('2026-10-25T14:59:59Z'), mon = new Date('2026-10-25T15:00:00Z');
    for (const [product, quantity] of [['trade-ticket', 10], ['heaven-weekly-1', 1], ['heaven-weekly-2', 2]]) {
        assert.equal(env.shop.buy(user, { product, quantity }, sun).error, undefined);
        assert.match(env.shop.buy(user, { product, quantity: 1 }, sun).error, /주.*한도/);
    }
    assert.equal(env.shop.view(user, undefined, sun).items.find(i => i.id === 'heaven-ticket').remaining, null);
    assert.equal(env.shop.view(user, undefined, sun).resetAt, mon.getTime());
    assert.equal(env.shop.view(user, undefined, mon).items.find(i => i.id === 'trade-ticket').remaining, 10);
    assert.equal(env.shop.buy(user, { product: 'heaven-weekly-1', quantity: 1 }, mon).error, undefined);
    const before = structuredClone(user.inventory);
    for (const quantity of [0, -1, 1.5, '1', Number.MAX_SAFE_INTEGER]) assert.ok(env.shop.buy(user, { product: 'warcry', quantity }, mon).error);
    assert.deepEqual(user.inventory, before);
    user.gold = 0; assert.match(env.shop.buy(user, { product: 'heaven-ticket', quantity: 1 }, mon).error, /부족/);
});

test('상품 변경과 운영 아이템 누락은 구매 전에 검증하며 상점 등록은 기존 운영 구성을 보존한다', async t => {
    const env = shopEnvironment(t); await env.user(); const state = (await request('/api/paradise')).data;
    const before = structuredClone(persisted.get(account.id));
    env.config.shop[0].price++;
    assert.equal((await request('/api/paradise/shop/buy', shopBody(state, 'hell-key'))).status, 409);
    assert.deepEqual(persisted.get(account.id), before);
    const { appendShop, LEGENDARY_BOX } = require('../scripts/register_paradise_shop');
    const original = { Item: env.items.filter(i => i.name !== LEGENDARY_BOX.name), Paradise: { enabled: true, baseRewards: [{ type: '골드', count: 777 }], shop: [] } };
    const added = appendShop(original);
    assert.deepEqual(added.Paradise, original.Paradise); assert.deepEqual(added.Item.slice(0, -1), original.Item);
    assert.deepEqual(appendShop(added), added);
    env.items.splice(env.items.findIndex(i => i.name === '투신의 함성 포션'), 1);
    const fresh = (await request('/api/paradise')).data;
    assert.equal(fresh.shop.items.find(i => i.id === 'warcry').available, false);
    assert.equal((await request('/api/paradise/shop/buy', shopBody(fresh, 'warcry'))).status, 400);
});

test('돌 던지기 획득은 입문 세 갈래와 추가 이동 없는 선택을 저장하며 재요청으로 중복 획득하지 않는다', async () => {
    const user = await reset(); corridor.enter(user); corridor.victory(user, () => .99);
    user.paradise.choices = ['stoneThrow']; user.paradise.offerRarity = 'silver'; await user.save();
    let state = (await request('/api/paradise')).data;
    const rootBody = { ...bodyFor(state), choice: 'stoneThrow' };
    const first = await request('/api/paradise/augment', rootBody);
    assert.equal(first.status, 200); state = first.data.state;
    assert.equal(state.run.phase, 'augment'); assert.equal(state.run.stoneEntryOffer, true);
    assert.equal(state.run.choices.length, 3);
    assert.ok(state.run.choices.every(a => a.isStoneEntry && a.rarity === 'silver' && a.floors === 0));
    assert.equal(new Set(state.run.choices.map(a => a.stoneBranch)).size, 3);
    assert.equal(state.run.timer.paused, true);
    const floor = state.run.floor, ids = state.run.choices.map(a => a.id);
    const repeat = await request('/api/paradise/augment', rootBody);
    assert.equal(repeat.status, 200); assert.deepEqual(repeat.data.state.run.choices.map(a => a.id), ids);
    state = (await request('/api/paradise')).data;
    const chosen = await request('/api/paradise/augment', { ...bodyFor(state), choice: ids[0] });
    assert.equal(chosen.status, 200); assert.equal(chosen.data.state.run.phase, 'route');
    assert.equal(chosen.data.state.run.floor, floor); assert.equal(chosen.data.state.run.stoneEntryOffer, false);
});

test('돌 던지기는 기본 액티브만 교체하고 MP 0으로 실제 공격하며 궁극기와 탐험 밖 스킬을 유지한다', async t => {
    t.mock.method(Math, 'random', () => .99);
    const user = await reset(); user.main_card.type = '전직';
    const original = rpg.getMainCardSkills(user).map(s => s.skill.name), ultimates = rpg.getUltimateSkills(user).map(s => s.skill.name);
    corridor.enter(user); user.paradise.acquired.stoneThrow = 1;
    Object.assign(user.paradise.enemy, { hp: 1e9, maxHp: 1e9, atk: 0, def: 0, crit: 0, cmb: 0 });
    assert.ok(!rpg.getMainCardSkills(user).some(s => s.skill.name === original[0]));
    assert.ok(rpg.getMainCardSkills(user).some(s => s.skill.name === '돌 던지기'));
    assert.deepEqual(rpg.getUltimateSkills(user).map(s => s.skill.name), ultimates);
    const resources = corridor.getResources(user); resources.mp = 0; user.field.nextActionAt = 0;
    const cast = await rpg.useSkillInField(user, '돌 던지기');
    assert.ok(!cast.startsWith('❌'), cast); assert.equal(resources.mp, 0);
    assert.ok(user.paradise.combatEvents.at(-1).damage > 0);
    assert.equal(user.paradise.combatEvents.at(-1).skillName, '돌 던지기');
    assert.ok(user.field.skillCooldowns['돌 던지기'] > Date.now());
    assert.match(await rpg.useSkillInField(user, '돌 던지기'), /아직 행동|쿨타임/);
    user.field.nextActionAt = 0;
    assert.match(await rpg.useSkillInField(user, original[0]), /사용할 수 없는 스킬/);
    await user.save();
    const web = (await request('/api/paradise')).data;
    assert.equal(web.battle.skills.filter(s => s.name === '돌 던지기').length, 1);
    assert.equal(web.battle.skills.find(s => s.name === '돌 던지기').mpCost, 0);
    assert.ok(!web.battle.skills.some(s => s.name === original[0]));
    user.paradise.phase = 'augment'; corridor.finish(user); corridor.claim(user);
    assert.deepEqual(rpg.getMainCardSkills(user).map(s => s.skill.name), original);
});

test('돌 트리 후보와 새로고침은 선행 조건과 동일 등급 및 마지막 전용 후보를 유지한다', async () => {
    const user = await reset(); corridor.enter(user);
    assert.ok(corridor.availableAugments(user).every(a => !a.stoneBranch || a.id === 'stoneThrow'));
    user.paradise.acquired.stoneThrow = 1; user.paradise.acquired.stoneBankShot = 1;
    for (const rarity of ['silver', 'gold', 'prismatic']) {
        corridor.offerAugments(user, () => .31, rarity);
        assert.ok(corridor.view(user).run.choices.every(a => a.rarity === rarity));
        if (corridor.availableAugments(user, rarity).some(a => a.stoneBranch)) {
            assert.ok(corridor.view(user).run.choices.some(a => a.stoneBranch));
            const id = corridor.view(user).run.choices.find(a => a.stoneBranch).id;
            corridor.rerollAugment(user, id, () => .7);
            assert.ok(corridor.view(user).run.choices.some(a => a.stoneBranch));
        }
    }
    assert.ok(!corridor.availableAugments(user).some(a => a.id === 'stonePinball'));
    user.paradise.acquired.stoneCushion = 1;
    assert.ok(corridor.availableAugments(user).some(a => a.id === 'stonePinball'));
    user.paradise.acquired.stoneStraightShot = 1;
    assert.ok(!corridor.availableAugments(user).some(a => a.id === 'stonePinball'));
    user.paradise.phase = 'augment'; user.paradise.choices = ['stonePinball'];
    assert.ok(corridor.chooseAugment(user, 'stonePinball').error);
});

test('돌 강화 보장은 특수능력의 전공 후보와 예약 후보를 함께 보존한다', async t => {
    const env = progressionEnvironment(t), user = await env.user(['subjectMajor', 'waitingList']); corridor.enter(user);
    user.paradise.acquired.stoneThrow = 1; user.paradise.acquired.stoneBankShot = 1;
    const waiting = corridor.availableAugments(user, 'gold').find(a => a.category === 'critical').id;
    for (const roll of [0, .15, .5, .99]) {
        user.paradise.traitState = { subject: 'skill', waiting };
        corridor.offerAugments(user, () => roll, 'gold');
        const choices = corridor.view(user).run.choices;
        assert.equal(new Set(choices.map(a => a.id)).size, 3);
        assert.ok(choices.some(a => a.id === waiting));
        assert.ok(choices.some(a => a.category === 'skill'));
        assert.ok(choices.some(a => a.category === 'stone'));
    }
});

test('투석기의 최소 6초 쿨타임은 특수능력과 유물의 감소 이후에도 유지한다', async t => {
    const now = Date.now(); t.mock.method(Date, 'now', () => now); t.mock.method(Math, 'random', () => .99);
    const env = progressionEnvironment(t), user = await env.user(['reservedSeat', 'oddEvenLuggage']); corridor.enter(user);
    for (const id of ['stoneThrow', 'stonePocket', 'stoneHeavyAmmo', 'stoneRailgun']) user.paradise.acquired[id] = 1;
    user.paradise.traitState = { seat: 'spell' }; user.paradise.relics = ['clock'];
    corridor.startCombat(user, 'normal', null, () => .99);
    Object.assign(user.paradise.enemy, { hp: 1e12, maxHp: 1e12, atk: 0 });
    assert.ok(!(await rpg.useSkillInField(user, '돌 던지기')).startsWith('❌'));
    assert.equal(user.field.skillCooldowns['돌 던지기'] - now, 6000);
});

test('거울 반사로 확정된 패배는 공격 후 회복 증강으로 취소되지 않는다', async t => {
    t.mock.method(Math, 'random', () => .99);
    const user = await reset(); corridor.enter(user); user.paradise.acquired.windowSeat = 1;
    user.paradise.playfulState = { seat: 'left' }; corridor.startCombat(user, 'mirror');
    const stats = rpg.calculateUserStats(user);
    t.mock.method(require('../pvp'), 'corridorMirrorHit', () => ({ damage: 10, hp: user.paradise.enemy.maxHp - 10, hits: [], reflectedDamage: stats.hp * 100 }));
    rpg.buildHuntResult(user, {}, 100, { isBasic: true, comboHitCount: 1, skillHpRecovery: stats.hp });
    assert.equal(user.paradise.status, 'ended'); assert.equal(user.paradise.outcome, 'defeated');
    assert.equal(user.paradise.resources.hp, 0); assert.equal(user.paradise.highestFloor, 0);
    assert.ok(corridor.claim(user).error);
});
