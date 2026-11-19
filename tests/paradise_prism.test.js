const { test, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const AWS = require('aws-sdk');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const data = {};
for (const key of ['Item', 'Equipment', 'Bundle', 'Recipe', 'Pack', 'Pet']) data[key] = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'DB/RPGenius', key + '.json'), 'utf8'));
data.Item.push({ type: '티켓', name: '천상의 회랑 입장권' });
data.Paradise = { enabled: true, baseRewards: [{ type: '골드', count: 100, perFloors: 1 }] };
data.Quest = []; data.Shop = {};
const account = { _get: 1, name: 'paradise-prism-test', id: 'paradise-prism-test-id', code: 'TEST', level: 300, logged_in: [], avatarMigrated: true, need_character_card_select: false, main_card: { id: 0, star: 6, type: '일반' }, inventory: { card: [], item: [], equipment: [], pet: [] } };
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
    if (type === 'ScanCommand') {
        if (input.TableName === 'rpgenius_user') assert.equal(input.ConsistentRead, true, '유저 캐시는 완료된 저장보다 오래된 DB 값을 읽지 않는다');
        return { Items: input.TableName === 'rpgenius_user' ? [...persisted.values()].map(v => structuredClone(v)) : [] };
    }
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
const boons = require('../paradise_boons');
const prism = require('../paradise_prism');
const { AUGMENTS } = require('../paradise_content');

// 천상 개편(2026-11): 2마리 연속 전투, 네 번째 전투의 증강, 성장 선택지(스탯/회복/보상), 프리즘 증강 30종.
async function attack(user) { user.field.nextActionAt = 0; return rpg.useBasicAttackInField(user); }
async function finishEnemy(user) { user.paradise.enemy.hp = 1; return attack(user); }
async function winEncounter(user) { await finishEnemy(user); if (user.paradise.phase === 'combat') await finishEnemy(user); }
function grant(user, id, random = () => .5) { user.paradise.acquired[id] = 1; prism.onAcquire(user, AUGMENTS.find(a => a.id === id), random); }
function tank(user) { const enemy = user.paradise.enemy; enemy.hp = enemy.maxHp = 1e13; return enemy; }
function enemyTurn(user) { user.field.nextEnemyAttackAt = Date.now() - 1; return rpg.advanceParadiseCombat(user); }
const lastEvent = (user, filter = () => true) => user.paradise.combatEvents.filter(filter).at(-1);

test('일반 전투는 HP가 절반인 적 두 마리와 연속으로 싸우고, 둘째 적은 쿨타임과 전투 번호를 이어받는다', async () => {
    const user = await reset(); corridor.enter(user, () => .5);
    const run = user.paradise, full = corridor.heavenMonsterStats(run.floor, 'normal');
    assert.equal(run.phase, 'combat');
    assert.deepEqual(run.enemy.wave, { index: 1, total: 2 });
    assert.ok(Math.abs(run.enemy.maxHp - full.hp * .5) <= 1, '첫 적의 HP는 기존 일반 몬스터의 절반');
    assert.equal(run.enemy.atk, full.atk, '공격력은 그대로라 두 마리를 합친 부담이 같다');
    const encounterId = run.encounterId, firstId = run.enemy.id, lock = Date.now() + 60000;
    user.field.skillCooldowns['테스트 스킬'] = lock;
    await finishEnemy(user);
    assert.equal(run.phase, 'combat'); assert.notEqual(run.enemy.id, firstId);
    assert.deepEqual(run.enemy.wave, { index: 2, total: 2 });
    assert.equal(run.encounterId, encounterId); assert.equal(user.field.skillCooldowns['테스트 스킬'], lock);
    assert.equal(run.battlesWon, 0, '승리 처리는 둘째 적 뒤에 한 번');
    const kill = run.combatEvents.find(event => event.enemyId === firstId && event.cleared);
    assert.equal(kill.nextWave, 2); assert.equal(kill.waveTotal, 2);
    await finishEnemy(user);
    assert.equal(run.battlesWon, 1); assert.equal(run.encounterWins, 1);
    assert.equal(run.phase, 'boon');
    const view = corridor.view(user);
    assert.equal(view.run.boon.stage, 'pick'); assert.equal(view.run.augmentIn, 3);
    assert.ok(view.run.canReturn, '성장 선택 단계에서도 귀환할 수 있다');
});

test('네 번째 전투마다 증강 3개(모두 프리즘)를 먼저 고르고, 그다음 성장 선택지로 층을 정한다', async () => {
    const user = await reset(); corridor.enter(user, () => .5);
    const run = user.paradise;
    run.encounterWins = 3;
    await winEncounter(user);
    assert.equal(run.phase, 'augment');
    const view = corridor.view(user).run;
    assert.equal(view.choices.length, 3);
    for (const choice of view.choices) { assert.equal(choice.rarity, 'prismatic'); assert.equal(choice.floors, 0); assert.ok(choice.lines.length); assert.ok(choice.iconUrl.endsWith(choice.id + '.webp')); }
    const floor = run.floor, result = corridor.chooseAugment(user, view.choices[0].id);
    assert.ok(!result.error, result.error);
    assert.equal(run.floor, floor, '증강은 층을 옮기지 않는다');
    assert.equal(run.phase, 'boon');
    assert.equal(corridor.view(user).run.augmentIn, 4);
});

test('성장 선택: 스탯은 후보 3개 중 하나, 회복은 HP와 MP 20%, 보상은 종료 보상 또는 카드 계약', async () => {
    const user = await reset(); corridor.enter(user, () => .5);
    const run = user.paradise;
    await winEncounter(user);
    // 스탯
    let floor = run.floor;
    assert.ok(!boons.choose(user, { choice: 'stat' }, () => .3).error);
    assert.equal(run.boon.stage, 'stat'); assert.equal(run.boon.options.length, 3);
    assert.equal(new Set(run.boon.options.map(o => boons.STATS.find(s => s.id === o.id).label)).size, 3, '같은 이름의 스탯은 한 번에 하나');
    run.boon.options[0] = { id: 'atkFlat', value: 1000, floors: 9 };
    const before = rpg.calculateUserStats(user);
    assert.ok(!boons.choose(user, { index: 0 }).error);
    const after = rpg.calculateUserStats(user);
    assert.equal(run.boonStats.atk, 1000);
    assert.ok(Math.abs(after.baseAtk - before.baseAtk - 1000) < 1);
    assert.equal(run.floor, floor + 9); assert.equal(run.phase, 'route');
    // 회복
    corridor.startCombat(user, 'normal', null, () => .5);
    await winEncounter(user);
    run.boon.floors = { heal: -2 };
    const stats = rpg.calculateUserStats(user);
    corridor.getResources(user).hp = 1; corridor.getResources(user).mp = 0;
    floor = run.floor;
    boons.choose(user, { choice: 'heal' });
    assert.equal(corridor.getResources(user).hp, 1 + Math.round(stats.hp * .2));
    assert.equal(corridor.getResources(user).mp, Math.round(stats.mp * .2));
    assert.equal(run.floor, floor - 2);
    // 보상
    corridor.startCombat(user, 'normal', null, () => .5);
    await winEncounter(user);
    const rolls = [.9, .3, .1, .2, .7, .6, .95, .05, .5]; let roll = 0;
    boons.choose(user, { choice: 'reward' }, () => rolls[roll++ % rolls.length]);
    assert.equal(run.boon.stage, 'reward'); assert.equal(run.boon.options.length, 3);
    run.boon.options = [{ kind: 'card', star: 9, type: '각성', floors: 14 }, { kind: 'bonus', bonus: .07, floors: 12 }];
    const contracts = run.contracts.length;
    floor = run.floor;
    boons.choose(user, { index: 0 });
    assert.deepEqual(run.contracts.at(-1), { star: 9, type: '각성', name: '9성 각성 카드' });
    assert.equal(run.contracts.length, contracts + 1);
    assert.equal(run.floor, floor + 14, '고른 후보의 층 수만큼 오른다');
});

test('성장 선택의 층 수는 무작위가 아니라 영향이 클수록 높다: 스탯 11~16층, 보상 7~11층, 회복은 채워지는 양만큼', async () => {
    const user = await reset(); corridor.enter(user, () => .5);
    const run = user.paradise;
    await winEncounter(user);
    const pick = corridor.view(user).run.boon;
    assert.deepEqual(boons.FLOORS, { stat: [11, 16], heal: [-3, 3], reward: [7, 11] });
    assert.deepEqual(pick.floors.stat, [11, 16]); assert.deepEqual(pick.floors.reward, [7, 11]);
    // 스탯: 전투 영향이 큰(등장 가중치가 낮은) 스탯일수록 높고, 같은 스탯이면 범위의 가운데 이상일 때 1층 더.
    const stat = id => boons.STATS.find(entry => entry.id === id);
    assert.deepEqual([0, .49, .5, 1].map(at => boons.statFloors(stat('atkFlat'), at)), [11, 11, 12, 12]);
    assert.deepEqual([stat('hp'), stat('crit'), stat('atk'), stat('final'), stat('avd')].map(entry => boons.statFloors(entry, 0)), [12, 13, 14, 15, 15]);
    assert.equal(boons.statFloors(stat('final'), 1), 16); assert.equal(boons.statFloors(stat('maxCmb'), 1), 16);
    for (const entry of boons.STATS) for (const other of boons.STATS) if (entry.weight < other.weight) assert.ok(entry.floors > other.floors, `${entry.label}(${entry.weight}) > ${other.label}(${other.weight})`);
    // 보상: 귀할수록 높다. 카드는 성급과 종류가 한 단계 오를 때마다 1층, 종료 보상은 2%p마다 1층.
    const reward = (star, type) => boons.rewardFloors({ kind: 'card', star, type }), bonus = n => boons.rewardFloors({ kind: 'bonus', bonus: n / 100 });
    assert.deepEqual([3, 4, 5, 6, 7, 8, 9, 10].map(bonus), [7, 7, 8, 8, 9, 9, 10, 10]);
    assert.deepEqual([5, 6, 7, 8, 9].map(star => ['일반', '전직', '각성'].map(type => reward(star, type))), [[7, 8, 9], [8, 9, 10], [9, 10, 11], [10, 11, 11], [11, 11, 11]]);
    // 같은 후보는 언제나 같은 층 수이고, 스탯 후보는 보상 후보보다 낮지 않다.
    for (let round = 0; round < 30; round++) {
        boons.offer(user); assert.ok(!boons.choose(user, { choice: 'stat' }).error);
        for (const option of run.boon.options) {
            const entry = stat(option.id), [min, max] = entry.range;
            const steps = entry.step ? Math.round((max - min) / entry.step) : 0, position = entry.kind === 'count' ? 1 : entry.kind === 'flat' || entry.kind === 'enemyDef' ? null : Math.round((option.value - min) / entry.step) / steps;
            if (position != null) assert.equal(option.floors, boons.statFloors(entry, position), entry.label + ' ' + option.value);
            assert.ok(option.floors >= 11 && option.floors <= 16);
        }
        boons.offer(user); assert.ok(!boons.choose(user, { choice: 'reward' }).error);
        for (const option of run.boon.options) { assert.equal(option.floors, boons.rewardFloors(option)); assert.ok(option.floors >= 7 && option.floors <= 11); }
        // 카드마다 제 층 수와 그 층 기준의 위험 표시를 받는다.
        const view = corridor.view(user).run.boon;
        assert.deepEqual(view.options.map(option => option.floors), run.boon.options.map(option => option.floors));
        assert.ok(view.options.every(option => 'powerWarning' in option));
    }
    // 회복: 실제로 채워지는 HP와 MP가 많을수록 높다(가득 -3층, 반만 채워지면 0층, 20% 넘게 비면 +3층, 회복 봉쇄 -3층).
    const stats = rpg.calculateUserStats(user), resources = corridor.getResources(user);
    const healAt = (hp, mp) => { resources.hp = Math.round(stats.hp * hp); resources.mp = Math.round(stats.mp * mp); boons.offer(user); return run.boon.floors.heal; };
    assert.deepEqual([healAt(1, 1), healAt(.9, .9), healAt(.5, .5), healAt(.5, 1)], [-3, 0, 3, 0]);
    run.effects.noHealing = true; assert.equal(healAt(.1, .1), -3); delete run.effects.noHealing;
    assert.equal(corridor.view(user).run.boon.floors.heal, -3);
    // 분류마다 층 수가 하나였던 때 저장된 선택지도 그 값으로 이어서 고른다.
    resources.hp = stats.hp; resources.mp = stats.mp;
    boons.offer(user);
    boons.choose(user, { choice: 'stat' }, () => .5);
    run.boon.floors = { stat: 8, heal: -1, reward: 12 };
    run.boon.options = run.boon.options.map(({ floors, ...option }) => option);
    const floor = run.floor;
    assert.ok(!boons.choose(user, { index: 1 }).error);
    assert.equal(run.floor, floor + 8);
});

test('보상 후보 확률표: 5성 80%에서 9성 0.3%, 일반 70%에서 각성 5%, 종료 보상 3~10%', () => {
    const sum = list => list.reduce((s, [, w]) => s + w, 0);
    assert.equal(Math.round(sum(boons.STAR_WEIGHTS) * 10) / 10, 100); assert.deepEqual(boons.STAR_WEIGHTS[0], [5, 80]); assert.deepEqual(boons.STAR_WEIGHTS.at(-1), [9, .3]);
    assert.equal(sum(boons.TYPE_WEIGHTS), 100); assert.deepEqual(boons.TYPE_WEIGHTS[0], ['일반', 70]); assert.deepEqual(boons.TYPE_WEIGHTS.at(-1), ['각성', 5]);
    assert.equal(sum(boons.BONUS_WEIGHTS), 100); assert.equal(boons.BONUS_WEIGHTS[0][0], 3); assert.equal(boons.BONUS_WEIGHTS.at(-1)[0], 10);
    assert.equal(AUGMENTS.length, 30); assert.equal(new Set(AUGMENTS.map(a => a.id)).size, 30);
    assert.ok(AUGMENTS.every(a => a.rarity === 'prismatic' && a.floors === 0));
});

test('결실: 자연 치명타 없이 세 번째 공격마다 확정 치명타, 치명타 피해량 +100%', async () => {
    const user = await reset(); corridor.enter(user, () => .5); tank(user);
    const base = rpg.calculateUserStats(user).critMul;
    grant(user, 'fruition');
    assert.equal(rpg.calculateUserStats(user).critMul, base + 1);
    user.paradise.effects.crit = 5; // 자연 치명타 확률을 100% 넘게 올려도 세 번째 공격만 치명타
    const crits = [];
    for (let i = 0; i < 6; i++) { await attack(user); crits.push(lastEvent(user, e => e.action === 'basic').criticalCount > 0); }
    assert.deepEqual(crits, [false, false, true, false, false, true]);
    assert.ok(lastEvent(user, e => e.action === 'basic').triggeredEffectIds.includes('augment:fruition'));
});

test('원펀치 룰: 일반 공격 피해 2배, 적이 즉시 맞공격(-50%)하고 적의 다음 행동 시간이 다시 흐른다', async (t) => {
    const user = await reset(); corridor.enter(user, () => .5); tank(user);
    t.mock.method(Math, 'random', () => .5);
    user.field.nextEnemyAttackAt = Date.now() + 500;
    grant(user, 'onePunch');
    const hp = corridor.getResources(user).hp;
    await attack(user);
    const events = user.paradise.combatEvents, mine = events.at(-2), reply = events.at(-1);
    assert.equal(mine.action, 'basic'); assert.ok(mine.triggeredEffectIds.includes('augment:onePunch'));
    assert.equal(reply.actor, 'enemy'); assert.equal(reply.counter, true); assert.ok(reply.triggeredEffectIds.includes('augment:onePunch.counter'));
    assert.ok(corridor.getResources(user).hp < hp);
    assert.ok(user.field.nextEnemyAttackAt >= Date.now() + 3000, '맞공격 뒤 적의 공격 주기 초기화');
    assert.equal(prism.attackMultiplier(user, { isBasic: true }), 2);
});

// 결투 신청 시험용: 궁극기가 아닌 내 카드 스킬을 쿨타임과 MP 걱정 없이 쓴다.
function normalSkillOf(user) {
    const ultimates = new Set(rpg.getUltimateSkills(user).map(entry => entry.skill.name));
    return rpg.getMainCardSkills(user).map(entry => entry.skill).find(s => !ultimates.has(s.name));
}
async function castNormal(user, skill = normalSkillOf(user)) {
    delete user.field.skillCooldowns[skill.name]; user.field.nextActionAt = 0; corridor.getResources(user).mp = rpg.calculateUserStats(user).mp;
    const message = await rpg.useSkillInField(user, skill.name); assert.ok(!String(message).startsWith('❌'), message); return message;
}

test('결투 신청: 첫 일반 스킬 적중에만 적이 반격(피해 -75%)하고, 반격 뒤 10초 동안 서로의 행동 쿨타임이 절반', async (t) => {
    const user = await reset(); corridor.enter(user, () => .5); tank(user);
    t.mock.method(Math, 'random', () => .5);
    grant(user, 'duelChallenge'); prism.onBattle(user);
    const b = user.paradise.battle.prism, field = user.field;
    await attack(user);
    assert.notEqual(user.paradise.combatEvents.at(-1).counter, true, '일반 공격은 결투를 시작하지 않는다');
    assert.equal(b.duel, 'ready');
    const normalCooldown = rpg.getFieldActionCooldownMs(user, Date.now());
    field.nextEnemyAttackAt = Date.now() + 4000;
    await castNormal(user);
    const skillEvent = lastEvent(user, e => e.action === 'skill' && e.actor !== 'enemy'), reply = user.paradise.combatEvents.at(-1);
    assert.ok(skillEvent.triggeredEffectIds.includes('augment:duelChallenge'));
    assert.equal(reply.counter, true);
    assert.ok(reply.triggeredEffectIds.includes('augment:duelChallenge.counter') && reply.triggeredEffectIds.includes('augment:duelChallenge.haste'));
    assert.equal(b.duel, 'haste'); assert.ok(b.duelUntil > Date.now() + 9000 && b.duelUntil <= Date.now() + 10000);
    assert.ok(field.nextEnemyAttackAt <= Date.now() + 2000 + 50, '잡혀 있던 적의 다음 공격까지 남은 시간도 절반');
    // 반격 피해는 75% 줄어든다(원펀치 룰은 50%).
    assert.equal(prism.counter(user, { prismDuel: true }).mul, .25);
    assert.equal(rpg.getFieldActionCooldownMs(user, Date.now()), Math.round(normalCooldown * .5), '내 행동 쿨타임 절반');
    assert.equal(prism.enemyIntervalMultiplier(user), .5, '적의 공격 주기 절반');
    assert.ok(field.nextActionAt - Date.now() <= Math.round(normalCooldown * .5) + 50);
    assert.deepEqual(prism.view(user).find(a => a.id === 'duelChallenge'), { id: 'duelChallenge', stage: 'haste', until: b.duelUntil });
    await castNormal(user);
    assert.notEqual(user.paradise.combatEvents.at(-1).counter, true, '두 번째 스킬에는 반격이 없다');
    b.duelUntil = Date.now() - 1;
    assert.equal(rpg.getFieldActionCooldownMs(user, Date.now()), normalCooldown, '10초가 지나면 원래대로');
    assert.equal(prism.enemyIntervalMultiplier(user), 1);
    assert.equal(prism.view(user).find(a => a.id === 'duelChallenge').stage, 'done');
});

test('정복자: 공격마다 공격력 +20과 최종 피해 +2%, 10중첩에서 기병이 3초마다 공격, 다음 전투에서 초기화', async () => {
    const user = await reset(); corridor.enter(user, () => .5); tank(user);
    grant(user, 'conqueror');
    const before = rpg.calculateUserStats(user);
    for (let i = 0; i < 10; i++) await attack(user);
    const after = rpg.calculateUserStats(user);
    assert.equal(user.paradise.prismEncounter.conqueror, 10);
    assert.ok(Math.abs(after.atk - before.atk - 200) <= 1, after.atk - before.atk);
    assert.ok(Math.abs(after.finalDamage - before.finalDamage - .20) < 1e-9);
    assert.ok(user.paradise.battle.mechanics.dots['prism:cavalry'].summon);
    assert.ok(user.paradise.combatEvents.some(e => e.triggeredEffectIds?.includes('augment:conqueror.max')));
    const [tick] = require('../paradise_mechanics').takeTicks(user, Date.now() + 3001);
    assert.equal(tick.label, '정복자의 기병'); assert.equal(tick.summon, true); assert.ok(tick.rawDamage > 0);
    corridor.startCombat(user, 'elite', null, () => .5);
    assert.equal(prism.view(user).find(a => a.id === 'conqueror').stacks, 0);
});

test('치명적인 운명: 치명타 확률 최대 20%, 7중첩의 운명 스킬이 치명타면 처형', async () => {
    const user = await reset(); corridor.enter(user, () => .5); tank(user);
    user.paradise.effects.crit = 2; grant(user, 'fatalDestiny');
    const stats = rpg.calculateUserStats(user);
    assert.equal(stats.fixedCriticalChance, .20);
    (user.paradise.battle.prism ||= {}).fate = 7;
    const skill = prism.skills(user).find(s => s.name === '운명');
    assert.ok(skill && !prism.disabledReason(user, skill));
    user.paradise.acquired.fruition = 1; user.paradise.prism.fruition = 2; // 결실의 세 번째 공격으로 확정 치명타
    const enemyId = user.paradise.enemy.id;
    user.field.nextActionAt = 0;
    const message = await rpg.useSkillInField(user, '운명');
    assert.ok(!String(message).startsWith('❌'), message);
    const event = user.paradise.combatEvents.find(e => e.enemyId === enemyId && e.skillName === '운명');
    assert.ok(event.cleared, '처형으로 적이 쓰러진다');
    assert.ok(event.triggeredEffectIds.includes('augment:fatalDestiny.execute'));
});

test('영혼 수확자: 처치마다 영혼과 HP 5%, 명계의 부름은 영혼당 공격력 144% 고정 피해', async () => {
    const user = await reset(); corridor.enter(user, () => .5);
    grant(user, 'soulReaper');
    await finishEnemy(user);
    assert.equal(user.paradise.prism.souls, 1);
    assert.ok(user.paradise.combatEvents.some(e => e.cleared && e.triggeredEffectIds.includes('augment:soulReaper.harvest')));
    tank(user); user.paradise.prism.souls = 3;
    const atk = rpg.calculateUserStats(user).atk;
    user.field.nextActionAt = 0;
    await rpg.useSkillInField(user, '명계의 부름');
    const event = lastEvent(user, e => e.skillName === '명계의 부름');
    assert.equal(event.action, 'skill'); assert.equal(user.paradise.prism.souls, 0);
    assert.ok(Math.abs(event.damage - atk * 1.44 * 3) / (atk * 4.32) < .05, event.damage + ' vs ' + atk * 4.32);
});

test('읽어 낸 살의: 적의 공격 2회 뒤 다음 공격의 예정 피해가 보이고, 간파는 그 공격을 막고 HP 10%를 회복', async (t) => {
    const user = await reset(); corridor.enter(user, () => .5); tank(user);
    t.mock.method(Math, 'random', () => .5);
    grant(user, 'readIntent');
    enemyTurn(user); enemyTurn(user);
    const aura = prism.view(user).find(a => a.id === 'readIntent');
    assert.ok(aura.foresight && aura.foresight.damage > 0);
    const max = rpg.calculateUserStats(user).hp; corridor.getResources(user).hp = Math.round(max * .5);
    const hp = corridor.getResources(user).hp, ready = Date.now();
    user.field.nextActionAt = 0;
    await rpg.useSkillInField(user, '간파');
    assert.equal(corridor.getResources(user).hp, hp + Math.round(max * .1));
    assert.ok(user.field.nextActionAt >= ready + 1990, '다음 행동 2초 지연');
    const before = corridor.getResources(user).hp;
    enemyTurn(user);
    assert.equal(corridor.getResources(user).hp, before);
    assert.ok(lastEvent(user, e => e.actor === 'enemy').triggeredEffectIds.includes('augment:readIntent.parry'));
});

test('죽음을 초월하는 자: HP 0에서 쿨타임 초기화와 두 번의 기회, 그 안에 처치하면 HP 30%로 부활', async () => {
    const user = await reset(); corridor.enter(user, () => .5);
    grant(user, 'transcendDeath');
    user.paradise.enemy.atk *= 1000; corridor.getResources(user).hp = 1;
    user.field.skillCooldowns.x = Date.now() + 99999;
    enemyTurn(user);
    assert.equal(user.paradise.phase, 'combat'); assert.ok(prism.transcendActive(user));
    assert.ok(user.field.skillCooldowns.x <= Date.now());
    assert.equal(prism.view(user).find(a => a.id === 'transcendDeath').attacksLeft, 2);
    enemyTurn(user);
    assert.ok(prism.transcendActive(user), '마지막 기회 동안 적의 공격을 받지 않는다');
    await finishEnemy(user);
    assert.ok(!prism.transcendActive(user));
    assert.ok(corridor.getResources(user).hp >= Math.round(rpg.calculateUserStats(user).hp * .3) - 1);
});

test('죽음을 초월하는 자: 두 번 안에 처치하지 못하면 패배', async () => {
    const user = await reset(); corridor.enter(user, () => .5); tank(user);
    grant(user, 'transcendDeath');
    user.paradise.enemy.atk *= 1000; corridor.getResources(user).hp = 1;
    enemyTurn(user);
    await attack(user); await attack(user);
    assert.equal(user.paradise.status, 'ended'); assert.equal(user.paradise.outcome, 'defeated');
});

test('되감기와 천사강림: 큰 피해를 3초 전 HP로 되돌리고, HP 20% 미만이 되면 천사가 10초간 싸우며 공격을 막는다', async (t) => {
    const user = await reset(); corridor.enter(user, () => .5); tank(user);
    t.mock.method(Math, 'random', () => .5);
    grant(user, 'timeRewind');
    const max = rpg.calculateUserStats(user).hp;
    corridor.getResources(user).hp = max;
    (user.paradise.battle.prism ||= {}).hpLog = [[Date.now() - 5000, max]];
    user.paradise.enemy.atk = max * 50;
    enemyTurn(user);
    assert.equal(corridor.getResources(user).hp, max);
    assert.ok(user.paradise.battle.prism.rewindGuardUntil > Date.now());
    assert.ok(lastEvent(user, e => e.actor === 'enemy').triggeredEffectIds.includes('augment:timeRewind'));
    grant(user, 'angelDescent');
    corridor.getResources(user).hp = Math.round(max * .21);
    user.paradise.battle.prism.rewindGuardUntil = 0;
    user.paradise.enemy.atk = Math.round(max * .03);
    for (let i = 0; i < 6 && !(user.paradise.prism.angelUntil > 0); i++) enemyTurn(user);
    assert.ok(user.paradise.prism.angelUntil > Date.now());
    assert.equal(user.paradise.battle.mechanics.dots['prism:angel'].prism, 'angel');
    const hp = corridor.getResources(user).hp;
    enemyTurn(user);
    assert.equal(corridor.getResources(user).hp, hp, '천사가 공격을 막는다');
});

test('검무 스킬은 8타 일반 공격으로 취급하고, 리플레이는 마지막 일반 스킬을 자원 없이 다시 쓴다', async () => {
    const user = await reset(); corridor.enter(user, () => .5); tank(user);
    grant(user, 'swordDance'); grant(user, 'replay');
    corridor.getResources(user).mp = 100000;
    const mp = corridor.getResources(user).mp;
    user.field.nextActionAt = 0;
    await rpg.useSkillInField(user, '검무');
    const dance = lastEvent(user, e => e.skillName === '검무');
    assert.equal(dance.action, 'skill');
    assert.equal(corridor.getResources(user).mp, mp - 390);
    assert.equal(prism.replayTarget(user), '검무');
    const danceCooldown = user.field.skillCooldowns['검무'];
    user.field.nextActionAt = 0;
    const message = await rpg.useSkillInField(user, '리플레이');
    assert.ok(!String(message).startsWith('❌'), message);
    assert.equal(corridor.getResources(user).mp, mp - 390, '리플레이는 자원을 쓰지 않는다');
    assert.equal(user.field.skillCooldowns['검무'], danceCooldown);
    assert.ok(user.field.skillCooldowns['리플레이'] > Date.now() + 20000);
    assert.ok(lastEvent(user, e => e.skillName === '검무').triggeredEffectIds.includes('augment:replay'));
});

test('두 가지 정체성은 다른 캐릭터 카드의 스킬을 탐험 내내 준다', async () => {
    const user = await reset(); corridor.enter(user, () => .5);
    const before = rpg.getMainCardSkills(user).map(e => e.skill.name);
    grant(user, 'dualIdentity', () => .3);
    corridor.startCombat(user, 'normal', null, () => .5);
    const now = rpg.getMainCardSkills(user).map(e => e.skill.name);
    assert.ok(now.length > before.length);
    await winEncounter(user); boons.choose(user, { choice: 'heal' });
    corridor.startCombat(user, 'normal', null, () => .5);
    assert.deepEqual(rpg.getMainCardSkills(user).map(e => e.skill.name), now);
});

test('가시 갑옷은 방어력 +20%와 피격마다 방어력 300% 반사, 꺼지지 않는 불꽃은 전투 시작 화상과 신호', async (t) => {
    const user = await reset(); corridor.enter(user, () => .5); tank(user);
    t.mock.method(Math, 'random', () => .5);
    const def = rpg.calculateUserStats(user).def;
    grant(user, 'thornArmor');
    const armored = rpg.calculateUserStats(user).def;
    assert.equal(armored, Math.round(def * 1.2));
    const hp = user.paradise.enemy.hp;
    enemyTurn(user);
    assert.equal(hp - user.paradise.enemy.hp, armored * 3);
    assert.deepEqual(lastEvent(user, e => e.actor === 'enemy').reflectedHits.map(h => h.label), ['가시 갑옷']);
    grant(user, 'eternalFlame');
    corridor.startCombat(user, 'elite', null, () => .5);
    assert.ok(user.paradise.battle.mechanics.dots['prism:flame']);
    assert.ok(user.paradise.combatEvents.some(e => e.action === 'augment' && e.triggeredEffectIds.includes('augment:eternalFlame.ignite')));
});

test('백화요란은 6송이에서 만개하고, 갑옷 깎아내기는 30%까지 방어력을 깎는다', async () => {
    const user = await reset(); corridor.enter(user, () => .5); tank(user);
    grant(user, 'hundredFlowers'); grant(user, 'armorShred');
    for (let i = 0; i < 5; i++) await attack(user);
    const b = user.paradise.battle.prism;
    assert.equal(b.flowers, 5); assert.equal(b.shred, .30);
    await attack(user);
    assert.equal(b.flowers, 0);
    assert.ok(lastEvent(user, e => e.action === 'basic').hits.some(h => h.label === '백화요란'));
});

test('주문의 계절은 일반 스킬마다 봄, 여름, 가을, 겨울로 돌고 겨울에는 적의 행동이 1초 느려진다', async () => {
    const user = await reset(); corridor.enter(user, () => .5);
    grant(user, 'seasons');
    assert.equal(user.paradise.prism.season, 'spring');
    const seen = [];
    for (let i = 0; i < 4; i++) { prism.onSkillUsed(user, '임의 스킬'); seen.push(user.paradise.prism.season); }
    assert.deepEqual(seen, ['summer', 'autumn', 'winter', 'spring']);
    user.paradise.prism.season = 'winter';
    assert.equal(prism.enemyIntervalBonus(user), 1000);
    user.paradise.prism.season = 'autumn';
    assert.ok(corridor.cooldownMultiplier(user) <= .7 + 1e-9);
});

test('2마리 전투는 한 전투: 결투 신청은 한 번만 걸리고, 적에게 붙은 꽃과 방어 감소는 새 적에서 다시 시작한다', async (t) => {
    const user = await reset(); corridor.enter(user, () => .5);
    t.mock.method(Math, 'random', () => .5);
    grant(user, 'duelChallenge'); grant(user, 'hundredFlowers'); grant(user, 'armorShred'); prism.onBattle(user);
    user.paradise.enemy.hp = user.paradise.enemy.maxHp = 1e12;
    await castNormal(user);
    assert.equal(user.paradise.combatEvents.at(-1).counter, true);
    await attack(user);
    const first = user.paradise.enemy.id, b = user.paradise.battle.prism;
    assert.ok(b.flowers > 0 && b.shred > 0);
    await finishEnemy(user);
    assert.notEqual(user.paradise.enemy.id, first); assert.equal(user.paradise.enemy.wave.index, 2);
    assert.equal(user.paradise.battle.prism, b, '전투 기록은 이어진다');
    assert.equal(b.flowers, undefined); assert.equal(b.shred, undefined);
    assert.equal(b.duel, 'haste', '가속은 두 번째 적에게도 이어진다');
    tank(user); await castNormal(user);
    assert.notEqual(user.paradise.combatEvents.at(-1).counter, true, '두 번째 적에게는 결투 신청이 다시 걸리지 않는다');
});

// 공격 분류(사용자 지시): '공격'은 지속 피해를 뺀 모든 공격(소환수 포함), '직접 공격'은 내가 행동한 공격, '일반 공격'은 일반 공격과 검무의 한 타.
async function summonTick(user, key) {
    const dot = user.paradise.battle.mechanics.dots[key];
    dot.nextAt = Date.now(); dot.until = Math.max(Number(dot.until || 0), Date.now() + 60000);
    await rpg.runFieldEquipmentDotTick(user.name, user);
    return lastEvent(user, e => e.action === 'tick');
}
test('신성한 번개와 결실은 소환수의 공격도 세고, 악마 사냥꾼은 직접 공격만 센다', async () => {
    const user = await reset(); corridor.enter(user, () => .5); tank(user);
    for (const id of ['holyLightning', 'fruition', 'demonHunter', 'conqueror', 'flyingSword']) grant(user, id);
    require('../paradise_mechanics').addDot(user, 'prism:sword:test', '떠다니는 검', 1, 3, 60000, true, { summon: true, prism: 'sword' });
    await attack(user);
    const e = user.paradise.prism;
    assert.deepEqual([e.lightning, e.fruition, e.demon, user.paradise.prismEncounter.conqueror], [1, 1, 1, 1]);
    e.lightning = 2; e.fruition = 2;
    const tick = await summonTick(user, 'prism:sword:test');
    assert.equal(tick.skillName, '떠다니는 검');
    assert.equal(e.lightning, 3, '소환수의 공격도 신성한 번개의 박자에 든다');
    assert.equal(e.fruition, 3, '소환수의 공격도 결실의 박자에 든다');
    assert.equal(e.demon, 1, '악마 사냥꾼은 소환수의 공격을 세지 않는다');
    assert.equal(user.paradise.prismEncounter.conqueror, 2, '정복자는 공격할 때마다(소환수 포함) 쌓인다');
    assert.ok(tick.triggeredEffectIds.includes('augment:holyLightning') && tick.triggeredEffectIds.includes('augment:fruition'));
    assert.ok(tick.criticalCount >= 1, '결실의 세 번째 공격이 소환수면 그 공격이 확정 치명타');
    assert.ok(tick.hits.some(hit => hit.label === '신성한 번개' && hit.damage > 0));
    // 지속 피해는 어느 박자에도 들지 않는다.
    require('../paradise_mechanics').addDot(user, 'prism:flame', '꺼지지 않는 불꽃', 50, 3, 2000, false, { element: '화' });
    await summonTick(user, 'prism:flame');
    assert.deepEqual([e.lightning, e.fruition, e.demon], [3, 3, 1]);
});

test('검무의 8타는 한 타 한 타가 일반 공격이자 직접 공격이고, 화면에는 검무 한 번으로 묶인다', async () => {
    const user = await reset(); corridor.enter(user, () => .5); tank(user);
    for (const id of ['swordDance', 'holyLightning', 'demonHunter', 'fruition', 'conqueror', 'armorShred', 'hundredFlowers', 'onePunch', 'comboStaircase']) grant(user, id);
    corridor.getResources(user).mp = 100000; corridor.getResources(user).hp = rpg.calculateUserStats(user).hp;
    user.paradise.effects.cmb = 1; // 연격 확률 100%여도 검무는 8회 고정
    const stair = Number(user.paradise.battle.mechanics?.stairStep || 0);
    const e = user.paradise.prism, b = () => user.paradise.battle.prism, sequence = Number(user.paradise.combatSequence || 0);
    user.field.nextActionAt = 0;
    const message = await rpg.useSkillInField(user, '검무');
    assert.ok(!String(message).startsWith('❌'), message);
    assert.match(String(message), /검무 8타/);
    assert.deepEqual([e.lightning, e.demon, e.fruition], [8, 8, 8], '8타가 모두 공격 박자에 든다');
    assert.equal(user.paradise.prismEncounter.conqueror, 8);
    assert.equal(b().shred, .30, '직접 공격 8번으로 방어력 감소가 최대치까지 쌓인다');
    const fresh = user.paradise.combatEvents.filter(event => Number(String(event.id).split(':').pop()) > sequence);
    const dance = fresh.filter(event => event.skillName === '검무'), counters = fresh.filter(event => event.actor === 'enemy' && event.counter);
    assert.equal(dance.length, 1, '검무는 사건 하나'); assert.equal(dance[0].action, 'skill');
    const plain = dance[0].hits.filter(hit => !hit.label);
    assert.equal(plain.length, 8, '한 타는 1회 타격이라 연격이 붙지 않는다');
    assert.deepEqual(plain.map(hit => hit.strike), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(Number(user.paradise.battle.mechanics?.stairStep || 0), stair, '한 칸씩 오르는 검무의 계단도 움직이지 않는다');
    assert.ok(!dance[0].triggeredEffectIds.includes('augment:comboStaircase.3'));
    // 화면이 0.1초마다 한 타씩 쌓아 보이도록 타마다 신호와 지속 상태가 따로 온다.
    assert.equal(dance[0].strikeInterval, 100); assert.equal(dance[0].strikes.length, 8);
    assert.deepEqual(dance[0].strikes.map((step, i) => step.cues.includes('augment:holyLightning') ? i + 1 : 0).filter(Boolean), [3, 6]);
    assert.deepEqual(dance[0].strikes.map(step => step.auras.find(aura => aura.id === 'conqueror').stacks), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual(dance[0].strikes.map(step => step.auras.find(aura => aura.id === 'armorShred').percent), [6, 12, 18, 24, 30, 30, 30, 30]);
    assert.deepEqual(counters[0].receivedHits.map(hit => hit.strike), [1, 2, 3, 4, 5, 6, 7, 8]);
    for (const id of ['holyLightning', 'demonHunter', 'fruition', 'armorShred.max', 'hundredFlowers.bloom', 'onePunch']) assert.ok(dance[0].triggeredEffectIds.includes('augment:' + id), id);
    assert.equal(dance[0].hits.filter(hit => hit.label === '신성한 번개').length, 2, '8타 중 세 번째와 여섯 번째에 번개');
    assert.equal(counters.length, 1, '원펀치 룰의 맞공격 8번은 반격 사건 하나로 묶인다');
    assert.equal(counters[0].receivedHits.length, 8);
    assert.equal(fresh.filter(event => event.action === 'basic' && !event.actor).length, 0, '한 타 한 타의 일반 공격 사건은 남지 않는다');
});

test('검무는 적이 쓰러지면 남은 타를 멈추고, 마지막 기회에는 행동 한 번으로 센다', async () => {
    const user = await reset(); corridor.enter(user, () => .5);
    grant(user, 'swordDance'); corridor.getResources(user).mp = 100000;
    user.paradise.enemy.hp = 1; user.field.nextActionAt = 0;
    const message = await rpg.useSkillInField(user, '검무');
    assert.match(String(message), /검무 1타/);
    assert.equal(user.paradise.enemy.wave.index, 2, '첫 적을 쓰러뜨리고 둘째 적이 나온다');
    const fresh = tank(user);
    grant(user, 'transcendDeath');
    user.paradise.battle.prism.transcend = { until: Date.now() + 10000, attacksLeft: 2 };
    user.field.skillCooldowns = {}; user.field.nextActionAt = 0;
    await rpg.useSkillInField(user, '검무');
    assert.equal(user.paradise.battle.prism.transcend.attacksLeft, 1, '검무 8타는 마지막 기회 한 번');
    assert.ok(fresh.hp > 0);
});

test('두 가지 정체성: 빌린 스킬은 카드 이름과 실제 비용으로 보이고, 키노와 다른 카드는 비용 단위를 바꿔 낸다', async () => {
    const C = require('../DB/RPGenius/CharacterCards.json'), kino = C.findIndex(card => card?.name === '키노'), glenn = C.findIndex(card => card?.name === '글렌첵');
    const borrow = async (main, borrowed) => {
        account.main_card = { id: main, star: 6, type: '일반' };
        const user = await reset(); corridor.enter(user, () => .5);
        user.paradise.acquired.dualIdentity = 1;
        Object.assign(user.paradise.prism ||= {}, { identity: { id: borrowed, star: 6, type: '일반' }, identityName: C[borrowed].name });
        corridor.startCombat(user, 'normal', null, () => .5); tank(user);
        return user;
    };
    try {
        // 키노가 빌린 글버지(MP 82): 정신력 41
        let user = await borrow(kino, glenn);
        const stats = rpg.calculateUserStats(user);
        assert.equal(rpg.getParadiseBorrowedSkillView(user, stats, '글버지').mpCost, 41);
        assert.equal(rpg.getParadiseBorrowedSkillView(user, stats, '글버지').resourceLabel, '정신력');
        assert.equal(rpg.getParadiseBorrowedSkillView(user, stats, '글버지').sourceCard, '글렌첵');
        user.field.kino.value = stats.mental; user.field.nextActionAt = 0;
        const message = await rpg.useSkillInField(user, '글버지');
        assert.ok(!String(message).startsWith('❌'), message);
        assert.match(String(message), /정신력 41 소모/);
        // 다른 카드가 빌린 키노의 아이돌 할래?(정신력 40): MP 80
        user = await borrow(glenn, kino);
        const mp = corridor.getResources(user).mp = rpg.calculateUserStats(user).mp;
        assert.equal(rpg.getParadiseBorrowedSkillView(user, rpg.calculateUserStats(user), '아이돌 할래?').mpCost, 80);
        user.field.nextActionAt = 0;
        await rpg.useSkillInField(user, '아이돌 할래?');
        assert.equal(corridor.getResources(user).mp, mp - 80);
        // 자기 카드의 스킬은 빌린 스킬이 아니다.
        assert.equal(rpg.getParadiseBorrowedSkillView(user, rpg.calculateUserStats(user), '글버지'), null);
    } finally { account.main_card = { id: 0, star: 6, type: '일반' }; }
});

test('선택의 시간: 일반 스킬은 표식을 남기고, 표식이 있을 때 스킬은 표식 폭발(방어력을 거치는 일반 피해), 일반 공격은 HP와 MP 10% 회복', async () => {
    const user = await reset(); corridor.enter(user, () => .5); const enemy = tank(user);
    grant(user, 'timeOfChoice');
    const stats = rpg.calculateUserStats(user), resources = corridor.getResources(user), b = () => user.paradise.battle.prism;
    // 방어력이 관통보다 훨씬 높아야 고정 피해와 일반 피해가 갈린다.
    enemy.def = Number(stats.pnt || 0) + 5000;
    const ultimates = new Set(rpg.getUltimateSkills(user).map(entry => entry.skill.name));
    const skill = rpg.getMainCardSkills(user).map(entry => entry.skill).find(s => !ultimates.has(s.name));
    const cast = async () => { delete user.field.skillCooldowns[skill.name]; user.field.nextActionAt = 0; resources.mp = stats.mp; const message = await rpg.useSkillInField(user, skill.name); assert.ok(!String(message).startsWith('❌'), message); };
    const skillEvent = () => lastEvent(user, e => e.action === 'skill' && e.actor !== 'enemy');

    await cast();
    assert.equal(b().marked, true, '표식이 없을 때 일반 스킬은 표식을 남긴다');
    assert.ok(skillEvent().triggeredEffectIds.includes('augment:timeOfChoice.mark'));

    await cast();
    assert.equal(b().marked, false, '표식이 있을 때 스킬은 표식을 터뜨리고 새 표식을 남기지 않는다');
    const event = skillEvent(), burst = event.hits.find(h => h.label === '표식 폭발');
    assert.ok(event.triggeredEffectIds.includes('augment:timeOfChoice.burst'));
    assert.ok(burst && !burst.fixed, '표식 폭발은 고정 피해가 아니다');
    const rate = Math.min(1, rpg.getTotalDefenseReductionRate(stats, rpg.calculateCardSlotEffects(user)));
    const expected = rpg.getDamageAfterReducedDefense(enemy.maxHp * .10, Math.max(0, enemy.def - Number(stats.atkDefReduce || 0)), Number(stats.pnt || 0), rate);
    assert.equal(burst.damage, expected, '대상 최대 HP 10%가 방어력을 거친다');
    assert.ok(burst.damage < enemy.maxHp * .10 * .5);

    await cast();
    assert.equal(b().marked, true);
    resources.hp = Math.round(stats.hp * .5); resources.mp = Math.round(stats.mp * .5);
    const hp = resources.hp, mp = resources.mp;
    await attack(user);
    const basic = lastEvent(user, e => e.action === 'basic' && e.actor !== 'enemy');
    assert.equal(b().marked, false, '표식이 있을 때 일반 공격은 표식을 소비한다');
    assert.ok(basic.triggeredEffectIds.includes('augment:timeOfChoice.heal'));
    assert.ok(!basic.hits.some(h => h.label === '표식 폭발'), '일반 공격은 표식을 터뜨리지 않는다');
    assert.ok(resources.hp >= hp + Math.floor(stats.hp * .10) - 1, 'HP 10% 회복');
    assert.ok(resources.mp >= mp + Math.floor(stats.mp * .10) - 1, 'MP 10% 회복');

    await attack(user);
    assert.equal(b().marked, false, '일반 공격은 표식을 남기지 않는다');
    assert.ok(!lastEvent(user, e => e.action === 'basic' && e.actor !== 'enemy').triggeredEffectIds.includes('augment:timeOfChoice.heal'));
});

test('증강은 한 탐험에 10개까지: 10개를 가지면 네 번째 전투 뒤에도 증강 없이 성장 선택지로 가고, 9개면 제시된다', async () => {
    const user = await reset(); corridor.enter(user, () => .5);
    const run = user.paradise, ids = AUGMENTS.map(a => a.id).filter(id => !['transcendDeath', 'angelDescent', 'timeRewind', 'duelChallenge'].includes(id));
    for (const id of ids.slice(0, 9)) run.acquired[id] = 1;
    run.encounterWins = 3;
    await winEncounter(user);
    assert.equal(run.phase, 'augment', '9개면 아직 제시된다');
    assert.ok(!corridor.chooseAugment(user, corridor.view(user).run.choices[0].id).error);
    assert.equal(corridor.view(user).run.augmentCount, 10);
    assert.equal(corridor.view(user).run.augmentIn, null, '다 모으면 다음 증강까지의 전투 수를 보이지 않는다');
    assert.equal(corridor.offerAugments(user), false);
    // 성장 선택지를 고르고 다시 네 번째 전투를 이긴다.
    boons.choose(user, { choice: 'heal' });
    if (run.phase !== 'combat') corridor.startCombat(user, 'normal');
    run.encounterWins = 7;
    await winEncounter(user);
    assert.equal(run.phase, 'boon', '10개면 증강 없이 성장 선택지로');
    assert.equal(Object.keys(run.acquired).length, 10);
});

test('전투 중 안내 표시: 사용자가 뺀 증강(신성한 번개, 치명적인 운명, 백화요란, 악마 사냥꾼, 선택의 시간, 읽어 낸 살의)은 없고, 나머지는 id와 자리를 준다', async () => {
    const user = await reset(); corridor.enter(user, () => .5); tank(user);
    const hidden = ['holyLightning', 'fatalDestiny', 'hundredFlowers', 'demonHunter', 'timeOfChoice', 'readIntent'];
    for (const id of [...hidden, 'conqueror', 'armorShred', 'seasons']) grant(user, id);
    prism.onBattle(user);
    const b = user.paradise.battle.prism; b.marked = true; b.shred = .12; b.intentCount = 1;
    const list = prism.statusView(user), ids = list.map(item => item.id);
    for (const id of hidden) assert.ok(!ids.includes(id), id + '는 표시하지 않는다');
    assert.deepEqual(list.filter(item => ['conqueror', 'seasons'].includes(item.id)).map(item => item.side), ['self', 'self']);
    const shred = list.find(item => item.id === 'armorShred');
    assert.equal(shred.side, 'enemy'); assert.equal(shred.percent, 12); assert.ok(shred.state);
});

test('배포 전에 시작해 진행 중이던 천상 탐험(판 번호 없음)은 다음 접속 때 전투 중이어도 귀환되고 보상을 정산받는다', async () => {
    let user = await reset(); corridor.enter(user, () => .5);
    assert.equal(user.paradise.version, corridor.RUN_VERSION);
    assert.equal(corridor.forceReturnOutdated(user), false, '새 판의 탐험은 그대로');
    delete user.paradise.version; user.paradise.clearedFloor = 30; user.paradise.floor = 31;
    assert.equal(user.paradise.phase, 'combat');
    await user.save();
    const { status, data } = await request('/api/paradise');
    assert.equal(status, 200);
    user = await rpg.getRPGUserByName(account.name);
    assert.equal(user.paradise.status, 'ended'); assert.equal(user.paradise.outcome, 'retired'); assert.equal(user.paradise.forcedReturn, true);
    assert.equal(user.field, null, '전투 상태도 정리된다');
    assert.equal(data.run.forcedReturn, true); assert.equal(data.run.canClaim, true, '평소 귀환처럼 보상을 받을 수 있다');
    // 지옥 탐험은 건드리지 않는다.
    user.paradise = { ...user.paradise, mode: 'hell', status: 'active' }; delete user.paradise.version;
    assert.equal(corridor.forceReturnOutdated(user), false);
});
