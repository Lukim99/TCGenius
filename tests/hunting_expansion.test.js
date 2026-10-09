const { test, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const AWS = require('aws-sdk');
const { appendContent } = require('../scripts/init_intrigue_content');
const { appendPackages } = require('../scripts/init_chuseok_packages');

// 실제 엔진·캐시·인증·Express API를 사용하되 AWS 전송은 메모리 데이터로 격리한다.
const data = {};
for (const key of ['Item', 'Equipment', 'Recipe', 'Bundle', 'Pack']) {
    const file = path.join(__dirname, '..', 'DB', 'RPGenius', key + '.json');
    data[key] = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
}
data.Quest = [];
data.Shop = {};
for (const name of ['상급 강화석', '헬 초대장', '헬 도전장']) if (!data.Item.some(item => item.name === name)) data.Item.push({ name, type: '재료' });
Object.assign(data, appendPackages({ Item: data.Item, Bundle: data.Bundle, Shop: data.Shop }));
const accounts = ['hunting-test', 'raid-guest'].map((name, index) => ({
    _get: 1, id: name + '-id', name, code: 'TEST', level: 300, logged_in: [],
    avatarMigrated: true, need_character_card_select: false, main_card: { id: 0, star: 6, type: '일반' },
    inventory: { item: [], card: [], equipment: [], pet: [] }
}));
const writes = [];
process.env.ADMIN_SESSION_SECRET = 'hunting-isolated-test';
AWS.S3.prototype.makeRequest = function (operation) {
    if (operation === 'listObjectsV2') return { promise: async () => ({ Contents: [] }) };
    throw new Error('Unexpected isolated S3 operation: ' + operation);
};
DynamoDBDocumentClient.prototype.send = async command => {
    const input = command.input;
    if (command.constructor.name === 'GetCommand' && input.TableName === 'rpgenius_data') return { Item: { data: structuredClone(data[input.Key.key] || {}) } };
    if (command.constructor.name === 'ScanCommand') return { Items: input.TableName === 'rpgenius_user' ? structuredClone(accounts) : [] };
    if (command.constructor.name === 'UpdateCommand' && input.TableName === 'rpgenius_user') { writes.push(structuredClone(input)); return {}; }
    if (command.constructor.name === 'PutCommand' && input.TableName === 'rpgenius_data' && input.Item.key === 'EliteState') return {};
    throw new Error('Unexpected isolated DB command: ' + command.constructor.name + '/' + input.TableName);
};
const rpg = require('../rpgenius');
const training = require('../training');
const party = require('../partyquest');
let listener, base;
before(async () => {
    await rpg.initRpgeniusData();
    const listen = express.application.listen;
    mock.method(express.application, 'listen', function () { listener = listen.call(this, 0, '127.0.0.1'); return listener; });
    require('../server')();
    await new Promise(resolve => listener.once('listening', resolve));
    mock.restoreAll();
    base = 'http://127.0.0.1:' + listener.address().port;
});
after(async () => {
    for (const account of accounts) { party.leaveRoom(account.name); rpg.clearFieldRuntimeTimers(account.name); rpg.clearFieldRuntimeTimers('training:' + account.name); }
    await new Promise(resolve => listener.close(resolve));
});
function cookie(name = accounts[0].name) {
    const body = Buffer.from(JSON.stringify({ name, admin: false, canPartyQuest: true, exp: Date.now() + 3600000 })).toString('base64url');
    return 'rpg_admin=' + body + '.' + crypto.createHmac('sha256', process.env.ADMIN_SESSION_SECRET).update(body).digest('base64url');
}
async function request(route, body, authenticated = true) {
    const response = await fetch(base + route, {
        method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(authenticated ? { Cookie: cookie() } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: response.status, data: await response.json() };
}
async function reset(name = accounts[0].name) {
    party.leaveRoom(name);
    rpg.clearFieldRuntimeTimers(name);
    rpg.__setQuestDefs([]);
    const user = await rpg.getRPGUserByName(name);
    Object.assign(user, new rpg.RPGUser(name, name + '-id'), structuredClone(accounts.find(account => account.name === name)));
    user.hp = 1000000000;
    user.mp = 1000000000;
    user.field = null;
    user.dailyDungeonDaily = null;
    user.quests = {};
    user.unlockedRaids = [];
    assert.equal((await user.save()).success, true);
    writes.length = 0;
    return user;
}
function raidQuest(raidId = 'blackHodu') {
    return { id: 901, name: '레이드 입장 허가', enabled: true, categories: ['일반'], minLevel: 1, maxLevel: 300,
        objectives: [{ type: 'kill', count: 1 }], rewards: [{ type: '레이드해금', raid_id: raidId }] };
}

function mockDamageBonusSlot(t, user) {
    const file = path.join(__dirname, '..', 'DB', 'RPGenius', 'CharacterCards.json');
    const readFile = fs.readFileSync;
    const cards = JSON.parse(readFile(file, 'utf8'));
    cards[0].slot_effect = { effect: 'damageBonus', values: [.5] };
    t.mock.method(fs, 'readFileSync', (target, ...args) => target === file ? JSON.stringify(cards) : readFile(target, ...args));
    user.card_slot = [{ id: 0, star: 6, type: '일반' }];
    assert.equal(rpg.calculateCardSlotEffects(user).damageBonus, .5);
}

test('신규 등록은 운영 인덱스·변경된 스탯·비워 둔 제작식을 보존하고 재실행해도 중복되지 않는다', () => {
    const before = { Item: [{ name: '기존 재료' }], Equipment: { accessory: [{ name: '기존 장신구' }], weapon: [] }, Recipe: [] };
    const first = appendContent(before);
    assert.deepEqual(first.after.Item.slice(0, 1), before.Item);
    assert.deepEqual(first.after.Equipment.accessory.slice(0, 1), before.Equipment.accessory);
    assert.equal(first.after.Recipe[0].materials[0].item_id, 1);
    assert.equal(first.after.Recipe[0].crafted[0].accessory_id, 1);
    assert.deepEqual(appendContent(first.after).after, first.after);
    first.after.Item[1].desc = '운영자 설명';
    first.after.Equipment.accessory[1].plusStat.bossDmg = .25;
    first.after.Recipe[0].materials = [];
    assert.deepEqual(appendContent(first.after).after, first.after);
    assert.throws(() => appendContent({}), /초기화하지 않습니다/);
});

test('인트리그미션은 기존 배경·문지기 설정으로 일반 필드와 일일 던전에 입장할 수 있다', async () => {
    let user = await reset();
    for (const route of ['/api/field', '/api/daily-dungeon']) {
        assert.equal((await request(route, undefined, false)).status, 401);
        const state = (await request(route)).data;
        const field = state.fields.find(field => field.name === '인트리그미션');
        assert.equal(field.locked, false);
        assert.equal(field.requireLevel, 161);
        assert.match(decodeURIComponent(field.backgroundUrl), /필드\/인트리그미션\.png/);
        const entry = (await request(route + '/enter', { fieldName: field.name, confirmed: true })).data;
        assert.equal(entry.ok, true, JSON.stringify(entry));
        assert.equal(entry.state.inField, true);
        if (route === '/api/field') await request(route + '/leave', {});
    }
    assert.equal((await request('/api/daily-dungeon')).data.daily.used, true);
    const dungeon = rpg.getDailyDungeons().find(dungeon => dungeon.name === '인트리그미션');
    assert.equal(rpg.getDungeonConfigurationError(dungeon, true), null);
    assert.equal(rpg.getDungeonConfigurationError(dungeon, false), null);
    assert.equal(dungeon.elite.name, '의문의 문지기');
    assert.deepEqual([dungeon.atk, dungeon.pnt, dungeon.def, dungeon.hp], [4100, 280, 205, 8820]);
    assert.deepEqual([dungeon.elite.atk, dungeon.elite.pnt, dungeon.elite.def, dungeon.elite.hp], [11950, 620, 650, 146000]);
    assert.equal(dungeon.elite.reward.find(reward => reward.item_name === '금괴0.1돈').roll, .3);
    const incomplete = structuredClone(dungeon); incomplete.elite.name = '';
    assert.match(rpg.getDungeonConfigurationError(incomplete, false), /엘리트/);
    user = await reset(); user.level = 160; await user.save();
    assert.equal((await request('/api/daily-dungeon/enter', { fieldName: dungeon.name })).data.ok, false);
    assert.equal((await request('/api/daily-dungeon')).data.daily.used, false);
});

test('인트리그미션 일일 보상은 문서 수량 범위와 6성 80%·7성 20% 추첨을 적용한다', () => {
    const dungeon = rpg.getDailyDungeons().find(dungeon => dungeon.name === '인트리그미션');
    const lower = rpg.rollDailyDungeonClearReward(dungeon, () => 0);
    assert.equal(lower.exp, 45000000);
    assert.equal(lower.gold, 10500000);
    assert.deepEqual(lower.items, { '일반 떡밥': 2000, '강화석': 2000, '상급 강화석': 8, '6성 카드팩': 1, '헬 초대장': 130 });
    const upper = rpg.rollDailyDungeonClearReward(dungeon, () => 1 - Number.EPSILON);
    assert.equal(upper.gold, 12500000);
    assert.deepEqual(upper.items, { '일반 떡밥': 2500, '강화석': 2500, '상급 강화석': 13, '7성 카드팩': 1, '헬 도전장': 90 });
    assert.equal(rpg.rollDailyDungeonClearReward(dungeon, () => .799999).items['6성 카드팩'], 1);
    assert.equal(rpg.rollDailyDungeonClearReward(dungeon, () => .8).items['7성 카드팩'], 1);
});

test('일일 던전 웹 API는 기존 전투·타임 중첩·하루 한 번 입장 규칙과 클리어 보상 복구를 제공한다', async t => {
    let user = await reset();
    const entered = (await request('/api/daily-dungeon/enter', { fieldName: '마동' })).data;
    assert.equal(entered.ok, true);
    assert.equal(entered.state.daily.used, true);
    assert.equal(entered.state.target.def, rpg.findDailyDungeonByName('마동').def / 20);
    t.mock.method(Math, 'random', () => 0);
    const attack = (await request('/api/daily-dungeon/attack', {})).data;
    assert.equal(attack.ok, true);
    assert.ok(attack.event.damage > 0);
    assert.equal(attack.event.activatedEffects[0].type, 'fever');
    assert.equal(attack.state.daily.effects[0].type, 'fever');
    user = await rpg.getRPGUserByName(accounts[0].name);
    user.statPointStats.atk = 10000000;
    user.field.killCount = 4999;
    user.field.nextActionAt = 0;
    await user.save();
    const cleared = (await request('/api/daily-dungeon/attack', {})).data;
    assert.equal(cleared.ok, true);
    assert.equal(cleared.event.cleared, true);
    assert.equal(cleared.event.lucky, true);
    assert.equal(cleared.state.inField, false);
    assert.ok(cleared.event.rewards.length >= 5);
    const recovery = (await request('/api/daily-dungeon')).data;
    assert.equal(recovery.daily.outcome, 'cleared');
    assert.equal(recovery.daily.clearReward.lucky, true);
    assert.deepEqual(recovery.clearRewards.map(reward => [reward.name, reward.count]), cleared.event.rewards.map(reward => [reward.name, reward.count]));
    const before = JSON.stringify((await rpg.getRPGUserByName(accounts[0].name)).inventory);
    assert.equal((await request('/api/daily-dungeon/enter', { fieldName: '리조트' })).data.ok, false);
    assert.equal((await request('/api/daily-dungeon/attack', {})).data.ok, false);
    await request('/api/daily-dungeon');
    assert.equal(JSON.stringify((await rpg.getRPGUserByName(accounts[0].name)).inventory), before);
});

test('훈련장 스탯 변경·공격·스킬·반격은 실제 캐릭터와 보상·퀘스트·입장 상태를 변경하거나 저장하지 않는다', async t => {
    const real = await reset();
    real.field = { name: '마동', nextActionAt: 0, skillCooldowns: {}, killCount: 4 };
    real.quests = { 90: { counters: { 0: 2 } } };
    await real.save();
    const before = JSON.stringify(await rpg.getRPGUserByName(real.name));
    writes.length = 0;
    assert.equal((await request('/api/training', undefined, false)).status, 401);
    const initial = (await request('/api/training')).data;
    assert.equal(initial.phase, 'training');
    assert.match(decodeURIComponent(initial.activeField.monster.spriteUrl), /훈련장-허수아비/);
    const configured = (await request('/api/training/configure', { player: { atk: 1000, hp: 10000, mp: 10000, crit: 0, cmb: 0, def: 0 }, target: { kind: 'boss', hp: 100000, def: 0, atk: 100, counterAttack: true } })).data;
    assert.equal(configured.ok, true);
    assert.equal(configured.state.player.atk, 1000);
    assert.equal(configured.state.target.kind, 'boss');
    t.mock.method(Math, 'random', () => .5);
    const attack = (await request('/api/training/attack', {})).data;
    assert.equal(attack.ok, true);
    assert.ok(attack.event.damage > 0);
    assert.ok(attack.event.received > 0);
    assert.equal(attack.state.training.metrics.damage, attack.event.damage);
    assert.ok(attack.state.training.metrics.dps > 0);
    const snapshot = training.get(real);
    snapshot.field.nextActionAt = 0;
    const skill = initial.skills[0];
    assert.ok(skill);
    const cast = (await request('/api/training/skill', { skillName: skill.name })).data;
    assert.equal(cast.ok, true, cast.message);
    assert.ok(cast.state.player.mp < 10000);
    const invalid = (await request('/api/training/configure', { player: { crit: 1.1 }, target: { hp: 0 } })).data;
    assert.equal(invalid.ok, false);
    assert.equal(invalid.state.training.metrics.damage, cast.state.training.metrics.damage);
    assert.equal(writes.length, 0);
    assert.equal(JSON.stringify(await rpg.getRPGUserByName(real.name)), before);
    await assert.rejects(snapshot.save(), /저장할 수 없습니다/);
});

test('훈련장 대상 종류·방어력·관통·치명타 설정이 공용 피해 계산에 적용된다', async t => {
    const real = await reset();
    t.mock.method(Math, 'random', () => .5);
    const player = { atk: 1000, crit: 0, cmb: 0, pnt: 0, pntPercent: 0, damageBonus: 0, eliteDmg: .5, bossDmg: .1 };
    async function damage(kind, def = 0, patch = {}) {
        const user = training.configure(real, { player: { ...player, ...patch }, target: { kind, hp: 1000000, def, counterAttack: false } });
        await rpg.useBasicAttackInField(user);
        return training.describe(user).metrics.lastDamage;
    }
    const normal = await damage('normal');
    assert.equal(await damage('boss'), Math.round(normal * 1.1));
    assert.equal(await damage('elite'), Math.round(normal * 1.5));
    const armored = await damage('normal', 1000);
    assert.ok(armored < normal);
    assert.ok(await damage('normal', 1000, { pnt: 1000 }) > armored);
    assert.ok(await damage('normal', 0, { crit: 1, critMul: 2 }) > normal);
});

test('일반 몬스터 피해 슬롯은 훈련장 일반 대상 피해를 높이고 엘리트 피해는 늘리지 않는다', async t => {
    const real = await reset();
    mockDamageBonusSlot(t, real);
    t.mock.method(Math, 'random', () => .5);
    const slots = real.card_slot;
    async function damage(kind, withSlot) {
        real.card_slot = withSlot ? slots : [];
        const user = training.configure(real, { player: { atk: 1000, crit: 0, cmb: 0, pnt: 0, pntPercent: 0, damageBonus: .2, eliteDmg: .5 }, target: { kind, hp: 1000000, def: 0, counterAttack: false } });
        await rpg.useBasicAttackInField(user);
        return training.describe(user).metrics.lastDamage;
    }
    assert.equal(await damage('normal', false), 1200);
    assert.equal(await damage('normal', true), 1800);
    assert.equal(await damage('elite', false), 1500);
    assert.equal(await damage('elite', true), 1500);
    assert.equal(writes.length, 0);
});

test('일반 몬스터 피해 슬롯은 일반 필드와 헬 던전의 엘리트 피해를 늘리지 않는다', async t => {
    const user = await reset();
    mockDamageBonusSlot(t, user);
    t.mock.method(Math, 'random', () => .5);
    const slots = user.card_slot;
    user.statPointStats.atk = 250;
    user.statPointStats.hp = 1000;
    async function damage(dungeon, withSlot) {
        user.card_slot = withSlot ? slots : [];
        user.hp = 1000000000;
        user.field = { name: dungeon.name, hell: !!dungeon.isHell, phase: 'elite', nextActionAt: 0, skillCooldowns: {}, elite: { hp: dungeon.elite.hp }, killCount: 0 };
        await rpg.useBasicAttackInField(user);
        assert.ok(user.field && user.field.elite, '피해 비교 동안 엘리트가 생존해야 한다.');
        return dungeon.elite.hp - user.field.elite.hp;
    }
    for (const dungeon of [rpg.getRegularFieldDungeons().find(entry => entry.name === '서울오프라인'), rpg.getHellDungeon()]) {
        const baseline = await damage(dungeon, false);
        assert.ok(baseline > 0);
        assert.equal(await damage(dungeon, true), baseline, dungeon.name);
    }
    assert.equal(writes.length, 0);
});

test('일반 몬스터 피해 슬롯은 파티 일반 공격·스킬·소환·지속 피해에서 엘리트를 강화하지 않는다', t => {
    t.mock.method(Math, 'random', () => .5);
    function damage(type, slotBonus, extra) {
        const attacker = { name: 'slot-damage-test', position: '딜러',
            baseSnapshot: { stats: { atk: 1000, crit: 0, cmb: 0, damageBonus: .25, eliteDmg: .5, bossDmg: .25 }, slotEffects: { damageBonus: slotBonus }, mainCardSkills: [] },
            runtime: { hp: 1000, hpMax: 1000, mp: 1000, mpMax: 1000, buffs: [], equipmentState: {} } };
        const monster = { type, hp: 1000000, hpMax: 1000000, def: 0, stats: {}, debuffs: [] };
        return party.__test.calculateOutgoingDamage(attacker, monster, {}, 1000, { ...extra }).damage;
    }
    for (const extra of [{ isBasic: true }, { isSkill: true, hitCount: 2 }, { summonAttack: true }, { dotAttack: true }]) {
        const hits = extra.hitCount || 1;
        assert.equal(damage('mob', 0, extra), 1250 * hits);
        assert.equal(damage('mob', .5, extra), 1875 * hits);
        assert.equal(damage('elite', 0, extra), 1500 * hits);
        assert.equal(damage('elite', .5, extra), 1500 * hits);
        assert.equal(damage('boss', .5, extra), 1250 * hits);
    }
});

test('훈련장 소환수 후속 공격은 같은 전투 계산과 웹 이벤트를 사용하고 DB에 저장하지 않는다', async t => {
    const real = await reset();
    real.main_card.id = 11;
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    t.mock.method(Math, 'random', () => .5);
    const user = training.configure(real, { player: { atk: 1000, mp: 10000, hp: 10000, crit: 0, cmb: 0 }, target: { kind: 'boss', hp: 1000000, atk: 1000, counterAttack: true } });
    assert.match(await rpg.useSkillInField(user, '익테봇 소환'), /소환/);
    assert.ok(user.field.iktaeBot);
    const hp = user.hp;
    t.mock.timers.tick(3999);
    await rpg.tickTrainingCombat(user);
    assert.equal(user.field.training.metrics.damage, 0);
    t.mock.timers.tick(1);
    await rpg.tickTrainingCombat(user);
    assert.ok(user.field.training.metrics.damage > 0);
    assert.equal(user.hp, hp, '소환수 틱은 허수아비 반격을 유발하지 않는다.');
    const events = rpg.drainFieldTickEvents(user.name);
    assert.equal(events.length, 1);
    assert.ok(events[0].damage > 0);
    assert.equal(events[0].fieldName, '훈련장');
    assert.equal(writes.length, 0);
    user.field.iktaeBot.expired_at = Date.now() - 1;
    t.mock.timers.tick(5000);
    await rpg.tickTrainingCombat(user);
    assert.equal(user.field.iktaeBot, null);
    assert.equal(writes.length, 0);
});

test('일반 필드 API도 공용 등록 경로에서 기존 입장·공격·퇴장과 전투 종류 차단을 유지한다', async () => {
    await reset();
    const entered = (await request('/api/field/enter', { fieldName: '서울오프라인', confirmed: true })).data;
    assert.equal(entered.ok, true);
    assert.equal(entered.state.inField, true);
    assert.equal((await request('/api/daily-dungeon/attack', {})).data.ok, false);
    const attack = (await request('/api/field/attack', {})).data;
    assert.equal(attack.ok, true, attack.message);
    assert.equal(attack.state.fieldName, '서울오프라인');
    assert.ok(attack.event.damage > 0);
    assert.equal((await request('/api/field/leave', {})).data.state.inField, false);
    assert.equal((await request('/api/daily-dungeon')).data.daily.used, false);
});

test('금괴 10개 제작은 재료를 정확히 소비하고 게임체인저 두 스탯을 적용한다', async () => {
    const user = await reset();
    const materialId = data.Item.findIndex(item => item && item.name === '금괴0.1돈');
    const accessoryId = data.Equipment.accessory.findIndex(item => item && item.name === '게임체인저');
    rpg.addInventoryItem(user, materialId, 9);
    assert.match(rpg.craftRecipeByName(user, '게임체인저', 1), /재료가 부족/);
    assert.equal(rpg.getInventoryItemCount(user, materialId), 9);
    rpg.addInventoryItem(user, materialId, 1);
    assert.match(rpg.craftRecipeByName(user, '게임체인저', 1), /성공/);
    assert.equal(rpg.getInventoryItemCount(user, materialId), 0);
    assert.equal(user.inventory.equipment.length, 1);
    const before = rpg.calculateUserStats(user);
    user.equipments.accessory = { 0: { id: accessoryId, level: 0 } };
    const equipped = rpg.calculateUserStats(user);
    assert.equal(equipped.bossDmg - before.bossDmg, .1);
    assert.equal(equipped.takenDamage - before.takenDamage, .1);
});

test('퀘스트 레이드 해금은 영구 저장되고 재수령해도 중복되지 않으며 생성·참가·시작에서 검사한다', async () => {
    await reset(accounts[1].name);
    const user = await reset();
    rpg.__setQuestDefs([raidQuest()]);
    assert.match((await party.createRoom(user.name, 'blackHodu')).error, /해금/);
    assert.equal(party.listQuestSummaries(user).find(raid => raid.id === 'blackHodu').locked, true);
    assert.equal(rpg.getRaidUnlockError(user, 'butaGame'), null);
    rpg.recordQuestEvent(user, 'kill', { count: 1 });
    await user.save();
    const claims = await Promise.all([request('/api/quests/claim', { id: 901, period: 'once' }), request('/api/quests/claim', { id: 901, period: 'once' })]);
    assert.ok(claims.every(result => result.status === 200), JSON.stringify(claims));
    const unlocked = await rpg.getRPGUserByName(user.name);
    assert.deepEqual(unlocked.unlockedRaids, ['blackHodu']);
    assert.deepEqual(writes.at(-1).ExpressionAttributeValues[':v_unlockedRaids'], ['blackHodu']);
    const room = await party.createRoom(user.name, 'blackHodu');
    assert.ok(room.roomId);
    assert.match((await party.joinRoom(room.roomId, accounts[1].name)).error, /해금/);
    // 방 생성 후 운영자가 해금 보상을 지정한 경우에도 시작 시 재검증한다.
    unlocked.unlockedRaids = [];
    await unlocked.save();
    party.setPosition(user.name, '메인딜러');
    party.setReady(user.name, true);
    const state = party.getRoomOf(user.name);
    state.minPlayers = 1;
    assert.match((await party.start(user.name)).error, /해금/);
    assert.equal(state.state, 'lobby');
    party.leaveRoom(user.name);
});

test('존재하지 않는 레이드 해금 보상은 납품 재료를 차감하거나 완료 처리하지 않는다', async () => {
    const user = await reset();
    const materialId = data.Item.findIndex(item => item && item.name === '금괴0.1돈');
    rpg.addInventoryItem(user, materialId, 1);
    rpg.__setQuestDefs([{ ...raidQuest('unknown-raid'), objectives: [{ type: 'deliver', item_id: materialId, count: 1 }] }]);
    assert.match(rpg.claimQuestReward(user, 901).error, /레이드 설정/);
    assert.equal(rpg.getInventoryItemCount(user, materialId), 1);
    assert.equal(user.quests[901].claimed, false);
    assert.deepEqual(user.unlockedRaids, []);
});

test('한가위 패키지 등록은 기존 아이템·꾸러미·상품과 운영자가 수정한 구성을 보존한다', () => {
    const before = { Item: ['8성 전직 카드팩', '윷', '고급 장비 보호권', '상급 강화석'].map(name => ({ name })), Bundle: [[]], Shop: { 패키지: [] } };
    const after = appendPackages(before);
    assert.deepEqual(after.Item.slice(0, before.Item.length), before.Item);
    assert.deepEqual(after.Bundle.slice(0, 1), before.Bundle);
    assert.equal(after.Shop.패키지.length, 2);
    assert.deepEqual(after.Shop.패키지.map(item => [item.price.amount, item.limits.max]), [[4900, 2], [1500, 3]]);
    assert.deepEqual(appendPackages(after), after);
    after.Bundle[after.Item[4].pack] = [];
    after.Shop.패키지[0].price.amount = 7000;
    after.Shop.이동 = [after.Shop.패키지.shift()];
    assert.deepEqual(appendPackages(after), after);
    assert.throws(() => appendPackages({ ...before, Item: [] }), /운영 구성품/);
});

test('운영 DB에 새 패키지를 등록해도 이전 캐시가 구성품을 누락하거나 번들 아이템만 지급하지 않는다', async () => {
    let user = await reset(); user.point = 10000; await user.save();
    const itemCount = data.Item.length;
    rpg.getDataCache('Item', []).splice(itemCount - 2);
    rpg.getDataCache('Bundle', []).splice(data.Bundle.length - 2);
    assert.equal(data.Item.length, itemCount);
    const view = await request('/api/shop');
    const product = view.data.shop.패키지.find(item => item.display.name === '한가위맞이각성패키지');
    assert.ok(product);
    assert.deepEqual(product.display.bundleContents.map(reward => reward.count), ['1', '3', '16']);
    rpg.getDataCache('Item', []).splice(itemCount - 2);
    rpg.getDataCache('Bundle', []).splice(data.Bundle.length - 2);
    const result = await request('/api/shop/buy', { shopType: '패키지', shopId: product.shopId, count: 1 });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.equal(result.data.grantedCards.length, 1);
    user = await rpg.getRPGUserByName(user.name);
    assert.equal(user.point, 5100);
    assert.equal(rpg.getInventoryItemCount(user, data.Item.findIndex(item => item.name === '한가위맞이각성패키지')), 0);
});

test('각성 패키지는 구매마다 별도 추첨한 9성 각성 카드를 즉시 지급하고 최대 2회에서 차단한다', async t => {
    let user = await reset(); user.point = 20000; await user.save();
    const shop = rpg.getDataCache('Shop', {}).패키지;
    const itemId = data.Item.findIndex(item => item.name === '한가위맞이각성패키지');
    const product = shop.find(item => item.item_id === itemId);
    const packId = data.Item.findIndex(item => item.name === '8성 전직 카드팩');
    const yutId = data.Item.findIndex(item => item.name === '윷');
    let roll = 0;
    t.mock.method(Math, 'random', () => roll);
    const first = await request('/api/shop/buy', { shopType: '패키지', shopId: product.shopId, count: 1 });
    assert.equal(first.status, 200, JSON.stringify(first.data));
    assert.equal(first.data.grantedCards.length, 1);
    assert.equal(first.data.grantedCards[0].type, '각성');
    assert.equal(first.data.grantedCards[0].star, 8);
    assert.ok(first.data.grantedCards[0].imageUrl.includes('/card-image'));
    assert.ok(first.data.bundleGranted.some(reward => reward.name.includes('각성')));
    roll = .999;
    const second = await request('/api/shop/buy', { shopType: '패키지', shopId: product.shopId, count: 1 });
    assert.equal(second.status, 200);
    assert.notEqual(second.data.grantedCards[0].id, first.data.grantedCards[0].id);
    user = await rpg.getRPGUserByName(user.name);
    assert.equal(user.point, 10200);
    assert.equal(user.inventory.card.length, 2);
    assert.equal(rpg.getInventoryItemCount(user, packId), 6);
    assert.equal(rpg.getInventoryItemCount(user, yutId), 32);
    assert.equal(rpg.getInventoryItemCount(user, itemId), 0);
    const snapshot = JSON.stringify(user.inventory);
    const third = await request('/api/shop/buy', { shopType: '패키지', shopId: product.shopId, count: 1 });
    assert.equal(third.status, 400);
    assert.match(third.data.error, /누적 구매 제한/);
    user = await rpg.getRPGUserByName(user.name);
    assert.equal(user.point, 10200);
    assert.equal(JSON.stringify(user.inventory), snapshot);
});

test('각성 패키지 복수 구매도 각각 추첨하며 카드 공간·포인트 부족은 지급과 결제 전에 차단한다', async t => {
    let user = await reset(); user.point = 20000; user.maxCardLimit = 1; await user.save();
    const product = rpg.getDataCache('Shop', {}).패키지.find(item => data.Item[item.item_id].name === '한가위맞이각성패키지');
    const buy = count => request('/api/shop/buy', { shopType: '패키지', shopId: product.shopId, count });
    const rejected = await buy(2);
    assert.equal(rejected.status, 400); assert.match(rejected.data.error, /인벤토리 공간/);
    user = await rpg.getRPGUserByName(user.name);
    assert.equal(user.point, 20000); assert.equal(user.inventory.card.length, 0);
    user.maxCardLimit = 52; user.point = 4899; await user.save();
    assert.match((await buy(1)).data.error, /재화가 부족/);
    user = await rpg.getRPGUserByName(user.name); assert.equal(user.point, 4899);
    user.point = 20000; await user.save();
    let index = 0; const rolls = [.05, .1, .5];
    t.mock.method(Math, 'random', () => rolls[index++ % rolls.length]);
    const success = await buy(2);
    assert.equal(success.status, 200);
    assert.equal(success.data.grantedCards.length, 2);
    assert.notEqual(success.data.grantedCards[0].id, success.data.grantedCards[1].id);
    assert.equal(success.data.currencies.point, 10200);
});

test('강화 패키지는 정확한 수량을 즉시 지급하며 최대 3회 구매에서 차단한다', async () => {
    let user = await reset(); user.point = 10000; await user.save();
    const product = rpg.getDataCache('Shop', {}).패키지.find(item => data.Item[item.item_id].name === '한가위맞이강화패키지');
    const bought = await request('/api/shop/buy', { shopType: '패키지', shopId: product.shopId, count: 3 });
    assert.equal(bought.status, 200);
    assert.deepEqual(bought.data.grantedCards, []);
    user = await rpg.getRPGUserByName(user.name);
    assert.equal(user.point, 5500);
    for (const [name, count] of [['고급 장비 보호권', 9], ['상급 강화석', 1800], ['윷', 24]]) {
        assert.equal(rpg.getInventoryItemCount(user, data.Item.findIndex(item => item.name === name)), count);
        assert.equal(bought.data.bundleGranted.find(reward => reward.name === name).count, count);
    }
    assert.match((await request('/api/shop/buy', { shopType: '패키지', shopId: product.shopId, count: 1 })).data.error, /누적 구매 제한/);
    assert.equal((await rpg.getRPGUserByName(user.name)).point, 5500);
});
