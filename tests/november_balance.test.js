'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const AWS = require('aws-sdk');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const read = key => JSON.parse(fs.readFileSync(path.join(__dirname, '../DB/RPGenius', key + '.json'), 'utf8'));
const equipment = read('Equipment');
// 실제 엔진을 실행하되 import 초기화까지 운영 DB/S3와 격리한다.
AWS.S3.prototype.makeRequest = operation => {
    if (operation === 'listObjectsV2') return { promise: async () => ({ Contents: [] }) };
    throw Error('Unexpected S3: ' + operation);
};
DynamoDBDocumentClient.prototype.send = async command => {
    const input = command.input;
    if (command.constructor.name === 'GetCommand' && input.TableName === 'rpgenius_data') {
        const file = path.join(__dirname, '../DB/RPGenius', input.Key.key + '.json');
        return { Item: { data: fs.existsSync(file) ? read(input.Key.key) : {} } };
    }
    if (command.constructor.name === 'ScanCommand') return { Items: [] };
    if (input.TableName === 'rpgenius_user' && ['PutCommand', 'UpdateCommand'].includes(command.constructor.name)) return {};
    throw Error('Unexpected isolated DB: ' + command.constructor.name + '/' + input.TableName);
};
const rpg = require('../rpgenius'), training = require('../training');
const party = require('../partyquest').__test, pvp = require('../pvp');
const transcend = require('../transcend_equipment'), rando = require('../rando_characters');
const migration = require('../scripts/update_november_balance');
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, a + ' != ' + b);
let seq = 0;
const trained = [];
function user(id = 0, type = '전직') {
    const u = new rpg.RPGUser('밸런스검증' + ++seq, 'november-test-' + seq);
    u.main_card = { id, star: 4, type }; u.card_slot = []; u.equipments = {}; u.avatarMigrated = true;
    u.need_character_card_select = false; u.hp = u.mp = 100000;
    return u;
}
function equip(u, name, stage = 1) {
    const slot = Object.keys(equipment).find(slot => equipment[slot].some(item => item.name === name));
    assert.ok(slot, name);
    const entry = { id: equipment[slot].findIndex(item => item.name === name), transcendStage: stage };
    if (slot === 'accessory') u.equipments.accessory = { 1: entry };
    else u.equipments[slot] = entry;
}
function dummy(id = 0, type = '전직') {
    const u = training.configure(user(id, type), { player: { atk: 1000, hp: 100000, mp: 100000, crit: 0, cmb: 0, maxCmb: 0, critMul: 1.5, afterBasic: 0, afterSkill: 0, finalDamage: 0, extraDamage: 0 }, target: { hp: 1000000, def: 0, counterAttack: false } });
    trained.push(u); return u;
}
function member(entries = [], sets = {}, stats = {}) {
    return { name: '파티검증', position: '메인딜러', skills: [],
        baseSnapshot: { stats: { atk: 1000, hp: 10000, mp: 10000, crit: 0, critMul: 1.5, ...stats }, slotEffects: {}, transcendEquipment: { entries, setCounts: sets } },
        runtime: { hp: 10000, hpMax: 10000, mp: 10000, mpMax: 10000, buffs: [], debuffs: [], cooldownsUntil: {}, equipmentState: { combatStartedAt: 100000 } } };
}
before(() => rpg.initRpgeniusData());
after(() => trained.forEach(u => rpg.clearFieldRuntimeTimers(u.name)));

test('운영 패치는 요청 필드만 변경하고 재실행 시 동일하다', () => {
    const before = structuredClone(equipment), items = Object.values(before).flat();
    for (const [name, oldText, newText] of migration.PATCHES) {
        const item = items.find(x => x.name === name);
        if (name === '궁택토') item.desc = '운영자 안내. ' + oldText;
        else if (name === '교촌 주머니') item.desc = oldText + '. 기존 보상 보존.';
        else item.desc = item.desc.replace(newText, oldText);
    }
    delete items.find(x => x.name === '궁택토').plusStat.cooldown;
    delete items.find(x => x.name === '무한홀덤덱').plusStat.afterBasic;
    for (const [name, count, oldText, newText] of migration.SET_PATCHES) for (const item of items.filter(x => x.set === name)) item.setEffects[count] = item.setEffects[count].replace(newText, oldText);
    items[0].stat.atk = 4321; items[0].operatorOnly = { empty: [], count: 17 };
    const after = migration.patchEquipment(before);
    assert.deepEqual(migration.patchEquipment(after), after);
    for (const slot of Object.keys(before)) before[slot].forEach((old, index) => {
        const strip = item => { const copy = structuredClone(item); delete copy.desc; delete copy.setEffects; if (['궁택토', '무한홀덤덱'].includes(copy.name)) delete copy.plusStat[copy.name === '궁택토' ? 'cooldown' : 'afterBasic']; return copy; };
        assert.deepEqual(strip(after[slot][index]), strip(old));
    });
    assert.match(after.weapon.find(x => x.name === '궁택토').desc, /^운영자 안내\./);
    assert.deepEqual(before.accessory[0].operatorOnly, { empty: [], count: 17 });
});

test('감옥열쇠는 80% 경계·초월 단계·일시 치명타 증가를 타격에 한 번만 전환한다', t => {
    t.mock.method(Math, 'random', () => .5);
    for (const stage of [1, 3]) for (const crit of [.79, .80, .81, 1.20]) {
        const stats = transcend.capPrisonKeyCritical({ crit, critMul: 1.5, prisonKeyConversion: 2 + .5 * (stage - 1) });
        near(stats.crit, Math.min(.80, crit));
        near(transcend.capPrisonKeyCritical({ ...stats }).prisonKeyOverflow, Math.max(0, crit - .80));
        const extra = { isSkill: true, skillName: '검증', hitCount: 1, random: () => .99 };
        const hit = rpg.calculateAttackHitResult(1000, 0, 0, stats, {}, extra, {});
        assert.equal(hit.criticalCount, 0);
        assert.ok(Math.abs(hit.finalDamage - 1000 * (1 + Math.max(0, crit - .80) * stats.prisonKeyConversion)) <= 1);
        near(transcend.prisonKeySkillBonus(stats, { ...extra, critChanceBonus: .10 }), Math.max(0, crit + .10 - .80) * stats.prisonKeyConversion);
        assert.equal(transcend.prisonKeySkillBonus(stats, { isBasic: true }), 0);
        assert.equal(rpg.applyCriticalDamage(100, stats, { random: () => .80, critChanceBonus: 1 }, {}).isCritical, false);
    }
    const u = dummy(3); equip(u, '감옥열쇠', 3); u.field.training.overrides.crit = 1.2;
    const stats = rpg.calculateUserStats(u); near(stats.crit, .8); near(stats.prisonKeyOverflow, .4); near(stats.prisonKeyConversion, 3);
});

test('실제 필드: 유드 알레프 520MP, 불사조 8초·취약 6초, 처형박수 취약 12초', async t => {
    const now = 500000; t.mock.method(Date, 'now', () => now); t.mock.method(Math, 'random', () => .99);
    const bread = dummy(); bread.mp = 520;
    assert.doesNotMatch(await rpg.useSkillInField(bread, '유드 알레프'), /^❌/); assert.equal(bread.mp, 0);
    const fire = dummy(3);
    assert.doesNotMatch(await rpg.useSkillInField(fire, '불사조'), /^❌/);
    assert.equal(fire.field.skillCooldowns['불사조'], now + 8000);
    assert.deepEqual(fire.field.buffs.receivedDamageMultiplier, { value: 1.5, expired_at: now + 6000 });
    fire.field.nextActionAt = 0; fire.field.training.overrides.crit = .60;
    assert.doesNotMatch(await rpg.useSkillInField(fire, '처형박수'), /^❌/);
    assert.deepEqual(fire.field.buffs.receivedDamageMultiplier, { value: 1.5, expired_at: now + 12000 });
    fire.field.nextActionAt = 0; fire.field.skillCooldowns = {};
    await rpg.useSkillInField(fire, '불사조');
    assert.equal(fire.field.buffs.receivedDamageMultiplier.expired_at, now + 12000);
});

test('감사합니다 친구야는 확정 치명타 효과가 있어도 치명타가 발생하지 않는다', async t => {
    t.mock.method(Math, 'random', () => 0);
    const u = dummy(5); u.field.training.overrides.crit = 1;
    assert.doesNotMatch(await rpg.useSkillInField(u, '감사합니다 친구야'), /^❌/);
    assert.equal(u.field.training.metrics.criticals, 0);
    assert.equal(rpg.applyCriticalDamage(100, { crit: 1, critMul: 5, ilionForceCritical: true }, { isSkill: true, skillName: '감사합니다 친구야', forceCritical: true }, {}).isCritical, false);
});

test('각성 일리온·무한홀덤덱·궁택토·교촌 주머니의 단계별 실제 스탯', () => {
    const ilion = user(14, '일반'), base = rpg.calculateUserStats(ilion);
    ilion.main_card.type = '각성'; near(rpg.calculateUserStats(ilion).afterBasic - base.afterBasic, .20);
    for (const stage of [1, 3]) {
        equip(ilion, '무한홀덤덱', stage); near(rpg.calculateUserStats(ilion).afterBasic - base.afterBasic, .20 + .15 + .03 * (stage - 1));
        const bread = user(), before = rpg.calculateUserStats(bread); equip(bread, '궁택토', stage);
        near(rpg.calculateUserStats(bread).cooldown - before.cooldown, .05 * stage);
        const zeus = user(7), zeusBase = rpg.calculateUserStats(zeus); equip(zeus, '교촌 주머니', stage);
        near(rpg.calculateUserStats(zeus).cooldown - zeusBase.cooldown, .05 + .04 * (stage - 1));
    }
});

test('범부 120초 스택, 7중첩 후 전투 내 영구 효과와 새 전투 초기화', t => {
    let time = 100000; t.mock.method(Date, 'now', () => time);
    const u = dummy(7); equip(u, '범부의 대나무', 3);
    const skill = read('Skills').find(x => x.name === '백억이요');
    const m = member([{ name: '범부의 대나무', stage: 3 }]);
    for (let i = 0; i < 7; i++) {
        u.field.equipmentState = rpg.prepareTranscendSkillEffects(u, skill, rpg.calculateUserStats(u)).state;
        m.runtime.equipmentState = party.preparePartyTranscendSkill(m, skill.name, false, {}).state;
        assert.equal(u.field.equipmentState.beomStacksUntil, time + 120000);
        assert.equal(m.runtime.equipmentState.beomStacksUntil, time + 120000);
        time += 10000;
    }
    assert.equal(u.field.equipmentState.trueBeom, true); assert.equal(m.runtime.equipmentState.trueBeom, true);
    time += 180000; near(party.getPartyAttackBuffValue(m), .50);
    const fresh = member([{ name: '범부의 대나무', stage: 3 }]); near(party.getPartyAttackBuffValue(fresh), 0);
});

test('정수 필터망은 15초 수속성 추가 피해이고 반복 사용해도 중첩되지 않는다', t => {
    const now = 100000; t.mock.method(Date, 'now', () => now); t.mock.method(Math, 'random', () => .99);
    const m = member([{ name: '정수 필터망', stage: 3 }]);
    for (let i = 0; i < 2; i++) m.runtime.equipmentState = party.preparePartyTranscendSkill(m, '청정수 투척', false, {}).state;
    assert.deepEqual(m.runtime.equipmentState.cleanWaterBuff, { value: .25, expiredAt: now + 15000 });
    const target = { name: '대상', type: 'boss', hp: 100000, hpMax: 100000, def: 0, stats: { def: 0 }, debuffs: [] };
    const water = party.calculateOutgoingDamage(m, target, {}, 1000, { isBasic: true, skillElement: '수', disableCritical: true, hitCount: 1 });
    const fire = party.calculateOutgoingDamage(m, target, {}, 1000, { isBasic: true, skillElement: '화', disableCritical: true, hitCount: 1 });
    assert.ok(water.extraDamageDealt > 0); assert.equal(fire.extraDamageDealt, 0);
});

test('존버는 전투 시작/마지막 스킬로부터 10초 경계에서만 일반 공격 +20%', () => {
    for (const shape of ['field', 'party', 'pvp']) {
        const stats = { wonyoddi: true, randoEquipment: { '존버의 미학': 1 }, atk: 1000 };
        const state = { combatStartedAt: 1000 };
        const runtime = shape === 'pvp' ? { equipment: state } : { equipmentState: state, enteredAt: 1000 };
        const at = time => rando.applyStats({ ...stats }, runtime, {}, 0, time, shape === 'pvp' ? 1000 : undefined).afterBasic;
        near(at(10999), 0); near(at(11000), .20);
        state.lastSkillAt = 11000; near(at(11001), 0); near(at(21000), .20);
    }
});

test('심해·검은 잔향의 4초 재발동과 TCG 공통 장비 쿨타임 감소', t => {
    let now = 100000; t.mock.method(Date, 'now', () => now);
    const sets = { '심해의 순환': 4, '검은 잔향': 4 };
    for (const reduction of [0, 2]) {
        const m = member([], sets, { equipmentEffectCooldownFlat: reduction });
        let result = party.preparePartyTranscendSkill(m, '검증', false, {});
        assert.equal(result.reduceUltimateCooldown, 3); assert.equal(result.shadowDamageRate, .35);
        m.runtime.equipmentState = result.state;
        const readyAt = now + (4 - reduction) * 1000;
        assert.equal(result.state.deepSetReadyAt, readyAt); assert.equal(result.state.blackEchoSetReadyAt, readyAt);
        now = readyAt - 1; result = party.preparePartyTranscendSkill(m, '검증', false, {});
        assert.equal(result.reduceUltimateCooldown, undefined); assert.equal(result.shadowDamageRate, undefined);
        now++; result = party.preparePartyTranscendSkill(m, '검증', false, {}); assert.equal(result.reduceUltimateCooldown, 3);
    }
});

test('PvP의 실제 불사조·처형박수 취약 지속시간과 감사합니다 친구야 비치명타', async t => {
    let time = Date.now(); pvp.__setNow(() => time); t.mock.method(Math, 'random', () => .5);
    try {
        for (const id of [3, 5]) {
            const a = user(id), b = user(); await a.save(); await b.save();
            pvp.ensurePvpState(a).daily.opponents = [{ name: b.name, rating: 1000 }];
            assert.equal((await pvp.startBattle(a, b.name)).ok, true);
            const battle = a.pvp.battle; time = battle.me.nextActionAt;
            battle.opp.nextActionAt = time + 60000; battle.opp.hp = battle.opp.maxHp = 1e9;
            battle.me.skillCooldowns = {}; battle.me.mp = 100000;
            if (id === 3) {
                assert.equal(pvp.playerSkill(a, '불사조').ok, true);
                assert.deepEqual(battle.me.runtime.buffs.receivedDamageMul, { value: 1.5, until: time + 6000 });
                time += 6000; pvp.advanceBattle(a);
                assert.equal(battle.me.runtime.buffs.receivedDamageMul, undefined);
                battle.me.nextActionAt = time; battle.me.skillCooldowns = {};
                assert.equal(pvp.playerSkill(a, '처형박수').ok, true);
                assert.deepEqual(battle.me.runtime.buffs.receivedDamageMul, { value: 1.5, until: time + 12000 });
                const expiry = time + 12000; time += 1000; battle.me.nextActionAt = time; battle.me.skillCooldowns = {};
                assert.equal(pvp.playerSkill(a, '불사조').ok, true);
                assert.equal(battle.me.runtime.buffs.receivedDamageMul.until, expiry);
            } else {
                battle.me.snapshot.stats.crit = 1;
                assert.equal(pvp.playerSkill(a, '감사합니다 친구야').ok, true);
                const hit = battle.events.findLast(e => e.actor === 'me' && e.action === 'skill' && e.skillName === '감사합니다 친구야');
                assert.equal(hit.criticalCount, 0);
            }
        }
    } finally { pvp.__setNow(null); }
});

test('세트 실제 스탯은 마나번 공격력 15%, 심해 수속성 +150, TCG 치명타 10%', () => {
    for (const set of ['마나번', '심해의 순환', 'TCG의 유산']) {
        const u = user(), count = set === 'TCG의 유산' ? 2 : 4;
        const entries = Object.values(equipment).map(list => list.find(x => x.set === set && !x.mythic)).filter(Boolean).slice(0, count);
        assert.equal(entries.length, count);
        entries.forEach(e => equip(u, e.name));
        const withSet = rpg.calculateUserStats(u);
        // 스탯 합산 경로는 그대로 두고 세트 이름만 제거한 동일한 장비와 비교한다.
        const cache = rpg.getDataCache('Equipment', {});
        const refs = Object.values(cache).flat().filter(x => entries.some(e => e.name === x.name));
        const labels = refs.map(x => x.set); refs.forEach(x => { x.set = null; });
        let withoutSet; try { withoutSet = rpg.calculateUserStats(u); } finally { refs.forEach((x, i) => { x.set = labels[i]; }); }
        if (set === '마나번') assert.equal(withSet.atk, Math.round((withoutSet.atk + 250) * 1.15));
        if (set === '심해의 순환') assert.equal(withSet.waterAtk - withoutSet.waterAtk, 250);
        if (set === 'TCG의 유산') { near(withSet.crit - withoutSet.crit, .10); assert.equal(withSet.equipmentEffectCooldownFlat - Number(withoutSet.equipmentEffectCooldownFlat || 0), 2); }
    }
});

test('검은 잔향 하의 80% 경계와 프리즘 속성 합계 1000 경계의 실제 피해 보정', t => {
    t.mock.method(Math, 'random', () => .5);
    const u = dummy(); equip(u, '검은 잔향 하의', 3);
    const context = { type: 'training', dungeon: u.field.training.target };
    u.hp = 80001;
    assert.equal(rpg.applyTranscendPreAttack(u, context, 1000, { isSkill: true }, 'skill', { name: '검증' }), 1000);
    u.hp = 80000;
    assert.equal(rpg.applyTranscendPreAttack(u, context, 1000, { isSkill: true }, 'skill', { name: '검증' }), 1200);
    assert.equal(rpg.applyTranscendPreAttack(u, context, 1000, { isBasic: true }, 'basic'), 1000);
    u.equipments = {}; equip(u, '레인보우 프리즘', 3);
    for (const sum of [999, 1000]) {
        u.field.training.overrides.fireAtk = sum;
        const extra = { isBasic: true };
        rpg.applyTranscendPreAttack(u, context, 1000, extra, 'basic');
        near(Number(extra.perAttackUnitExtras?.[0]?.finalDamageBonus || 0), sum === 1000 ? .20 : 0);
    }
});

test('실제 필드 흐음티콘 지속 피해 30%(+10%)와 천공 심판 축적 피해의 5%', async t => {
    let now = 100000; t.mock.method(Date, 'now', () => now); t.mock.method(Math, 'random', () => .5);
    const base = dummy(13), equipped = dummy(13); equip(equipped, '흐음티콘', 3);
    await rpg.useSkillInField(base, '유서새김'); await rpg.useSkillInField(equipped, '유서새김');
    assert.equal(equipped.field.mark.dot, Math.round(base.field.mark.dot * 1.5));
    const u = dummy();
    u.field.equipmentState.judgment = { targetKey: 'field:훈련장', damage: 10000, expiresAt: now + 8000 };
    now += 7999; await rpg.tickTrainingCombat(u); assert.equal(u.field.training.metrics.damage, 0);
    now++; await rpg.tickTrainingCombat(u); assert.equal(u.field.training.metrics.damage, 500);
    assert.equal(u.field.equipmentState.judgment, undefined);
});

test('TCG의 쿨타임 감소는 TCG 밖의 업화와 불굴 장비에도 적용된다', t => {
    const now = 100000; t.mock.method(Date, 'now', () => now); t.mock.method(Math, 'random', () => .5);
    const armor = require('../armor_expansion'), state = {};
    assert.equal(armor.triggerHellfire({ hasHellfireRage: true, equipmentEffectCooldownFlat: 2 }, state, 100, 1000, now), true);
    assert.equal(state.hellfireRageReadyAt, now + 13000);
    const m = member([], {}, { equipmentEffectCooldownFlat: 2 });
    m.baseSnapshot.immortalArmor = { readyAt: 0 }; m.runtime.hp = 2000;
    party.applyDamageToMember({ members: [m], state: 'inProgress' }, m, 1, '검증');
    assert.equal(m.baseSnapshot.immortalArmor.readyAt, now + 63000);
    assert.equal(m.runtime.dragonRegen.ticksLeft, 5);
});
