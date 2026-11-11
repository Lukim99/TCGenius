const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const AWS = require('aws-sdk');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const rando = require('../rando_characters');
const content = require('../scripts/register_rando_characters');
const read = key => JSON.parse(fs.readFileSync(path.join(__dirname, '../DB/RPGenius', key + '.json'), 'utf8'));
const before = { Item: read('Item').map(item => item.name === '지정 캐릭터 변환석 주머니' ? { ...item, choices: [{ id: 2, count: 3 }] } : item),
    Equipment: read('Equipment'), Fashion: read('Fashion'), Shop: { ...read('Shop'), 아바타: [] }, Bait: read('Bait') };
const fixture = content.prepare(before);
fixture.Equipment.armor.push(require('../transcend_equipment').definitions.armor.find(e => e.name === '심해의 갑옷'));
const writes = [];
AWS.S3.prototype.makeRequest = operation => {
    if (operation === 'listObjectsV2') return { promise: async () => ({ Contents: [] }) };
    throw new Error('Unexpected isolated S3 operation: ' + operation);
};
DynamoDBDocumentClient.prototype.send = async command => {
    const input = command.input;
    if (command.constructor.name === 'GetCommand') {
        if (input.TableName !== 'rpgenius_data') return {};
        const file = path.join(__dirname, '../DB/RPGenius', input.Key.key + '.json');
        return { Item: { data: structuredClone(fixture[input.Key.key] ?? (fs.existsSync(file) ? read(input.Key.key) : {})) } };
    }
    if (command.constructor.name === 'ScanCommand') return { Items: [] };
    if (['PutCommand', 'UpdateCommand'].includes(command.constructor.name)) { writes.push(input); return {}; }
    throw new Error('Unexpected isolated DB command: ' + command.constructor.name);
};
const rpg = require('../rpgenius');
const training = require('../training');
const party = require('../partyquest').__test;
const pvp = require('../pvp');
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, a + ' ≠ ' + b);
let sequence = 0;
function user(id = 15, type = '일반') {
    const u = new rpg.RPGUser('란도검증' + ++sequence, 'rando-test-' + sequence);
    u.main_card = { id, star: 4, type }; u.card_slot = []; u.equipments = {}; u.avatarMigrated = true;
    u.need_character_card_select = false; u.hp = u.mp = 10000;
    return u;
}
function trainingUser(id = 15, type = '일반') {
    return training.configure(user(id, type), { player: { atk: 1000, hp: 10000, crit: 0, critMul: 1.5, cmb: 0, maxCmb: 0, extraDamage: 0, finalDamage: 0, afterSkill: 0 }, target: { def: 0, counterAttack: false } });
}
function equip(u, name, stage = 1, part = 'weapon') {
    u.equipments[part] = { id: fixture.Equipment[part].findIndex(e => e.name === name), transcendStage: stage };
}
async function fixed(value, run) {
    const saved = Math.random; Math.random = () => value;
    try { return await run(); } finally { Math.random = saved; }
}
async function at(time, run) {
    const saved = Date.now; Date.now = () => time;
    try { return await run(); } finally { Date.now = saved; }
}
test.before(() => rpg.initRpgeniusData());

test('워뇨띠 순환과 럭키비키 대체, 원영적사고 유지 및 다음 순환', () => {
    const stats = { wonyoddi: true, randoStar: 4, randoEquipment: {} }, runtime = {};
    assert.equal(rando.switchMode(stats, runtime, {}, '모드 전환', 1000, () => .5).mode, '즐리');
    assert.equal(rando.switchMode(stats, runtime, {}, '모드 전환', 1000, () => .06999).mode, '럭키비키');
    assert.equal(runtime.wonyoddi.cycle, 2);
    assert.equal(rando.switchMode(stats, runtime, {}, '모드 전환', 1000, () => .07).mode, '기본');
    assert.equal(rando.switchMode(stats, runtime, {}, '원영적사고 모드 전환', 1000, () => .5).mode, '원영적사고');
    assert.equal(runtime.wonyoddi.cycle, 0);
    assert.equal(rando.switchMode(stats, runtime, {}, '모드 전환', 1000, () => .5).mode, '즐리');
});

test('모드 전환의 남은 쿨타임 30%, 가면의 첫 피해 및 일반 공격 강화와 존버 예외', () => {
    const stats = { wonyoddi: true, hp: 10000, randoStar: 4, randoEquipment: { '가면 스위처': 3 } };
    const runtime = { basicUntil: 11000, actionUntil: 6000 }, cd = { '모드 전환': 6000, 궁극기: 101000, 완료: 500 };
    const switched = rando.switchMode(stats, runtime, cd, '모드 전환', 1000, () => .5);
    assert.equal(cd['모드 전환'], 4500); assert.equal(cd.궁극기, 71000); assert.equal(runtime.basicUntil, 8000); assert.equal(runtime.actionUntil, 4500);
    near(switched.skillRate, .60);
    const indirect = { modeSwitchDamage: true }; rando.prepareAttack(stats, runtime, indirect);
    assert.equal(indirect.finalDamageBonus, undefined);
    const first = { isSkill: true }; rando.prepareAttack(stats, runtime, first); near(first.finalDamageBonus, .42);
    const basic = { isBasic: true }; rando.prepareAttack(stats, runtime, basic); near(basic.extraDamageBonus, .40);
    const next = { isBasic: true }; rando.prepareAttack(stats, runtime, next); assert.equal(next.extraDamageBonus, undefined);
    stats.randoEquipment = { '존버의 미학': 3 };
    const preserved = { basicUntil: 11000, actionUntil: 6000 }, deadlines = { '모드 전환': 6000 };
    rando.switchMode(stats, preserved, deadlines, '모드 전환', 1000, () => .5);
    assert.equal(deadlines['모드 전환'], 6000); assert.equal(preserved.basicUntil, 11000);
    near(rando.applyStats({ ...stats, atk: 1000 }, preserved, {}, 0, 1000).afterBasic, .69);
});

test('정신력 소모·초당 회복·실제 타격 회복 및 0에서 30까지 전투불능', () => {
    const stats = { kino: true, mental: 100, randoEquipment: {} }, runtime = {};
    rando.tickMental(stats, runtime, {}, 1000); assert.equal(runtime.kino.value, 100);
    assert.equal(rando.spendMental(stats, runtime, 100, 1000), true); assert.equal(runtime.kino.exhausted, true);
    assert.equal(rando.spendMental(stats, runtime, 0, 1000), false);
    rando.tickMental(stats, runtime, {}, 6999); assert.equal(runtime.kino.exhausted, true);
    rando.tickMental(stats, runtime, {}, 7000); near(runtime.kino.value, 30); assert.equal(runtime.kino.exhausted, false);
    rando.onHit(stats, runtime, 3, { isBasic: true }, 0, 7000); near(runtime.kino.value, 45);
    rando.onHit(stats, runtime, 2, { dotAttack: true }, 0, 7000); near(runtime.kino.value, 45);
    rando.onHit(stats, runtime, 1, { skillName: '아이돌 할래?' }, 2, 7000); near(runtime.kino.value, 60);
});

test('청심환은 폭주 중에도 정신력 30까지 전투불능, 최대 정신력에서 폭주 종료', () => {
    const stats = { kino: true, mental: 150, atk: 1000, critMul: 1.5, randoEquipment: { '청심환': 3 } }, runtime = {};
    rando.tickMental(stats, runtime, {}, 1000); rando.spendMental(stats, runtime, 150, 1000);
    assert.equal(runtime.kino.berserk, true); assert.equal(runtime.kino.exhausted, true);
    const berserk = rando.applyStats({ ...stats }, runtime, {}, 0, 1000); near(berserk.finalDamage, .30); near(berserk.critMul, 1.90);
    assert.equal(rando.mentalCost(stats, { mental_cost: 40 }), 50);
    rando.tickMental(stats, runtime, {}, 2000); near(runtime.kino.value, 30); assert.equal(runtime.kino.exhausted, false); assert.equal(runtime.kino.berserk, true);
    rando.tickMental(stats, runtime, {}, 6000); near(runtime.kino.value, 150); assert.equal(runtime.kino.berserk, false);
});

test('청심환은 스킬 소모 직후 최대 정신력의 20% 이하에서 남은 정신력을 소모하고 타격 회복 전에 폭주한다', () => {
    for (const [mental, cost, expected, berserk] of [[150, 119, 31, false], [150, 120, 0, true], [150, 121, 0, true], [160, 127, 33, false], [160, 128, 0, true], [150, 90, 60, false]]) {
        const stats = { kino: true, mental, randoEquipment: { '청심환': 1 } }, runtime = {};
        assert.equal(rando.spendMental(stats, runtime, cost, 1000), true);
        near(runtime.kino.value, expected); assert.equal(runtime.kino.berserk, berserk); assert.equal(runtime.kino.exhausted, berserk);
        rando.onHit(stats, runtime, 1, { isSkill: true }, 0, 1000);
        near(runtime.kino.value, expected + 5); assert.equal(runtime.kino.berserk, berserk);
    }
    const stats = { kino: true, mental: 150, randoEquipment: {} }, runtime = {};
    assert.equal(rando.spendMental(stats, runtime, 90, 1000), true);
    near(runtime.kino.value, 60); assert.equal(runtime.kino.berserk, false); assert.equal(runtime.kino.exhausted, false);
});

test('청심환은 이미 폭주 중이면 20% 이하에서도 다시 정신력을 소모하지 않는다', () => {
    const stats = { kino: true, mental: 150, randoEquipment: { '청심환': 1 } };
    const runtime = { kino: { value: 100, at: 1000, exhausted: false, berserk: true } };
    assert.equal(rando.spendMental(stats, runtime, 75, 1000), true);
    near(runtime.kino.value, 25); assert.equal(runtime.kino.berserk, true); assert.equal(runtime.kino.exhausted, false);
    assert.equal(rando.spendMental(stats, runtime, 25, 1000), true);
    near(runtime.kino.value, 0); assert.equal(runtime.kino.berserk, true); assert.equal(runtime.kino.exhausted, true);
});

test('박카스 저정신력 회복은 30에서 종료, 1/3단계 카스 쿨타임·피해량', () => {
    const stats = { kino: true, mental: 100, randoEquipment: { '박카스 스프레이': 3 } }, runtime = {};
    rando.tickMental(stats, runtime, {}, 1000); rando.spendMental(stats, runtime, 80, 1000);
    rando.tickMental(stats, runtime, {}, 4000); near(runtime.kino.value, 38.75);
    near(rando.cooldownMultiplier(stats, '카스 살포'), .8); near(rando.sprayDamageMultiplier(stats), 1.2);
    stats.randoEquipment['박카스 스프레이'] = 1; near(rando.cooldownMultiplier(stats, '카스 살포'), .9);
});

test('전용 슬롯 제한, 행동 쿨타임 초 단위, 정신력·비치명타·지속 피해 슬롯', async () => {
    const u = user(); u.card_slot = [{ id: 15, star: 11, type: '일반' }]; near(rpg.calculateCardSlotEffects(u).wonyoddiBasicCooldown, .30);
    u.main_card.id = 16; near(rpg.calculateCardSlotEffects(u).wonyoddiBasicCooldown, 0);
    u.card_slot[0].type = '전직'; near(rpg.calculateCardSlotEffects(u).actionCooldownFlat, .35);
    u.card_slot[0] = { id: 16, star: 11, type: '일반' }; near(rpg.calculateCardSlotEffects(u).mentalRegen, 8);
    u.card_slot[0].type = '전직'; near(rpg.calculateUserStats(u).nonCriticalFinalDamage, .22);
    await fixed(.5, () => assert.equal(rpg.calculateAttackHitResult(1000, 0, 0, { atk: 1000, crit: 0, critMul: 1.5, nonCriticalFinalDamage: .22 }, {}, {}, {}).finalDamage, 1220));
    u.card_slot[0].type = '각성'; near(rpg.calculateUserStats(u).dotDamage, .18);
});

test('실제 필드 모드 전환: 5초가 3.5초로 감소, 일반 공격은 별도 3.5초 대기', async () => at(100000, async () => {
    const u = trainingUser();
    await fixed(.5, () => rpg.useSkillInField(u, '모드 전환'));
    assert.equal(u.field.wonyoddi.mode, '즐리'); assert.equal(u.field.skillCooldowns['모드 전환'], 103500);
    u.field.nextActionAt = 0;
    await fixed(.5, () => rpg.useBasicAttackInField(u));
    assert.equal(u.field.training.metrics.damage, 2272); assert.equal(u.field.basicUntil, 103500);
    u.field.nextActionAt = 0; assert.match(await rpg.useBasicAttackInField(u), /일반 공격 쿨타임/);
}));

test('실제 각성 워뇨띠: 고정 피해·7초 보호막·장비 단계와 보호막 슬롯 공격력', async () => at(200000, async () => {
    const u = trainingUser(15, '각성'); equip(u, '가면 스위처', 3);
    u.card_slot = [{ id: 15, type: '각성', star: 11 }];
    const message = await fixed(.5, () => rpg.useSkillInField(u, '모드 전환'));
    assert.ok(!message.startsWith('❌'));
    assert.equal(u.field.shield.amount, 700); assert.equal(u.field.shield.expired_at, 207000);
    assert.equal(u.field.training.metrics.damage, 3885 + 684);
    assert.equal(rpg.calculateUserStats(u).atk, 1140);
}));

test('필드의 기존 보호막을 보존하고 워뇨띠 보호막만 갱신·흡수·만료한다', async () => at(210000, async () => {
    const u = trainingUser(15, '각성');
    delete u.field.shieldLayers;
    u.field.shield = { amount: 5000, expired_at: 230000 };
    await fixed(.5, () => rpg.useSkillInField(u, '모드 전환'));
    assert.equal(u.field.shield.amount, 5700);
    await at(213500, async () => {
        u.field.nextActionAt = 0;
        await fixed(.5, () => rpg.useSkillInField(u, '모드 전환'));
        assert.equal(u.field.shield.amount, 5700);
        assert.deepEqual(u.field.shieldLayers.find(layer => layer.source === 'legacy'), { source: 'legacy', caster: '', amount: 5000, expiresAt: 230000 });
        u.field.training.target.counterAttack = true; u.field.training.target.atk = 100;
        u.field.nextActionAt = 0;
        await fixed(.5, () => rpg.useBasicAttackInField(u));
        assert.equal(u.field.shieldLayers.find(layer => layer.source === 'legacy').amount, 5000);
        assert.ok(u.field.shieldLayers.find(layer => layer.source === 'awakening:워뇨띠').amount < 700);
        assert.equal(u.hp, 10000);
    });
    await at(220500, () => {
        rpg.calculateUserStats(u);
        assert.deepEqual(u.field.shield, { amount: 5000, expired_at: 230000 });
        assert.equal(u.field.shieldLayers.length, 1);
    });
}));

test('필드에서 심해의 갑옷과 각성 보호막은 각각 5초·7초 뒤 만료한다', async () => at(230000, async () => {
    const u = trainingUser(15, '각성'); equip(u, '심해의 갑옷', 1, 'armor');
    const hp = rpg.calculateUserStats(u).hp;
    await fixed(.5, () => rpg.useSkillInField(u, '모드 전환'));
    assert.equal(u.field.shield.amount, Math.round(hp * .05) + Math.round(hp * .07));
    assert.equal(u.field.shieldLayers.find(layer => layer.source === 'equipment:심해의 갑옷').expiresAt, 235000);
    assert.equal(u.field.shieldLayers.find(layer => layer.source === 'awakening:워뇨띠').expiresAt, 237000);
    await at(235000, () => { rpg.calculateUserStats(u); assert.equal(u.field.shield.amount, Math.round(hp * .07)); });
    await at(237000, () => { rpg.calculateUserStats(u); assert.equal(u.field.shield, null); });
}));

test('PvP도 기존 보호막과 장비·각성 보호막을 따로 유지하며 같은 각성 효과는 중첩하지 않는다', async () => {
    let time = Date.now(); pvp.__setNow(() => time);
    try {
        const a = user(15, '각성'), b = user(0); equip(a, '심해의 갑옷', 1, 'armor');
        await a.save(); await b.save();
        pvp.ensurePvpState(a).daily.opponents = [{ name: b.name, rating: 1000 }];
        await fixed(.5, async () => assert.equal((await pvp.startBattle(a, b.name)).ok, true));
        const battle = a.pvp.battle; time = battle.me.nextActionAt;
        battle.opp.nextActionAt = time + 60000; battle.opp.hp = 1e9;
        const legacyUntil = time + 20000;
        delete battle.me.shieldLayers;
        battle.me.shield = { amount: 5000, until: legacyUntil };
        battle.me.skillCooldowns = {}; battle.me.defendCooldownEnd = time + 10000;
        await fixed(.5, () => assert.equal(pvp.playerSkill(a, '모드 전환').ok, true));
        const first = structuredClone(battle.me.shieldLayers);
        assert.equal(first.length, 3);
        assert.equal(battle.me.shield.amount, first.reduce((sum, layer) => sum + layer.amount, 0));
        time += 3500; battle.me.nextActionAt = time; battle.me.skillCooldowns = {};
        await fixed(.5, () => assert.equal(pvp.playerSkill(a, '모드 전환').ok, true));
        assert.equal(battle.me.shieldLayers.length, 3);
        assert.deepEqual(battle.me.shieldLayers.find(layer => layer.source === 'legacy'), { source: 'legacy', caster: '', amount: 5000, expiresAt: legacyUntil });
        const awake = battle.me.shieldLayers.find(layer => layer.source === 'awakening:워뇨띠');
        assert.equal(awake.expiresAt, time + 7000);
        time += 5000; pvp.advanceBattle(a);
        assert.equal(battle.me.shieldLayers.some(layer => layer.source === 'equipment:심해의 갑옷'), false);
        assert.equal(battle.me.shield.amount, 5000 + awake.amount);
        time += 2000; pvp.advanceBattle(a);
        assert.deepEqual(battle.me.shield, { amount: 5000, until: legacyUntil });
    } finally { pvp.__setNow(null); }
});

test('실제 키노 스킬은 MP 대신 정신력, 처치 보너스와 카스 2초 간격 5틱', async () => at(300000, async () => {
    const u = trainingUser(16); u.field.training.targetHp = 1;
    await fixed(.5, () => rpg.useSkillInField(u, '아이돌 할래?'));
    near(u.field.kino.value, 75); assert.equal(u.mp, 0); assert.equal(u.field.training.metrics.kills, 1);
    const spray = trainingUser(16, '전직'); equip(spray, '박카스 스프레이', 3);
    await fixed(.5, () => rpg.useSkillInField(spray, '카스 살포'));
    near(spray.field.kino.value, 25); assert.equal(spray.field.skillCooldowns['카스 살포'], 348000);
    assert.equal(spray.field.training.metrics.damage, 3576);
    for (let i = 1; i <= 5; i++) await at(300000 + i * 2000, () => fixed(.5, () => rpg.tickTrainingCombat(spray)));
    assert.equal(spray.field.kino.dot, undefined);
    assert.equal(spray.field.training.metrics.damage, 3576 + 744 * 5);
}));

test('실제 카스 살포는 회복 슬롯과 청심환 장착 시 최대 150 중 120에서 90 소모로 폭주한 뒤 타격 정신력 5만 회복한다', async () => at(320000, async () => {
    const real = user(16, '전직'); equip(real, '청심환', 3); real.card_slot = [{ id: 16, star: 11, type: '일반' }];
    const u = training.configure(real, { player: { crit: 0, cmb: 0, maxCmb: 0 }, target: { def: 0, counterAttack: false } });
    assert.equal(rpg.calculateUserStats(u).mental, 150); near(u.field.kino.value, 150);
    assert.equal(rpg.calculateCardSlotEffects(u).mentalRegen, 8);
    u.field.kino.value = 120;
    const result = await fixed(.5, () => rpg.useSkillInField(u, '카스 살포'));
    assert.ok(!result.startsWith('❌'), result);
    near(u.field.kino.value, 5); assert.equal(u.field.kino.berserk, true); assert.equal(u.field.kino.exhausted, true);
    assert.ok(u.field.training.metrics.damage > 0);
    assert.ok(rpg.drainFieldActionEffectIds(u.name).includes('equipment:청심환'));
    u.field.nextActionAt = 0;
    assert.match(await rpg.useBasicAttackInField(u), /정신력이 30까지 회복될 때까지 전투불능/);
}));

test('실제 장비 스탯: 청심환 최대 정신력·쿨타임, 고유 장비 정신력 및 보호막 확률', () => {
    const k = user(16, '각성'); equip(k, '청심환', 3); equip(k, '원빌리언 사원증', 1, 'support');
    const stats = rpg.calculateUserStats(k); assert.equal(stats.mental, 160); assert.equal(stats.mp, 0); near(stats.cooldown, .14); near(stats.dotDamage, .20);
    const w = user(15, '각성'); equip(w, '럭키비키 키링', 1, 'support'); near(rpg.calculateUserStats(w).wonyoddiShieldChance, .10);
});

test('실제 파티 모드·정신력 표시, 남은 정신력 공격력과 지속 피해 5틱', async () => at(400000, async () => {
    const member = id => ({ name: '파티' + id, position: '메인딜러', potions: [], skills: [],
        baseSnapshot: { stats: { atk: 1000, crit: 0, critMul: 1.5, cmb: 0, maxCmb: 0, hp: 10000, mental: 100, randoStar: 4, randoEquipment: {}, wonyoddi: id === 15, kino: id === 16 }, slotEffects: {}, mainCardSkills: [], transcendEquipment: { entries: [], setCounts: {} } },
        runtime: { hp: 10000, hpMax: 10000, mp: 0, mpMax: 0, shield: 0, equipmentState: {}, equipmentAtkBuffs: {}, buffs: [], cooldownsUntil: {} } });
    const k = member(16), w = member(15);
    k.baseSnapshot.stats.awakening = { effect: 'mentalAttack', value: .01 };
    k.runtime.kino = { value: 45, at: 400000, exhausted: false, berserk: false };
    assert.equal(party.getPartyLiveStats(k).atk, 1030);
    const view = party.serializeMember(k); assert.equal(view.runtime.resourceLabel, '정신력'); assert.equal(view.runtime.resource, 45); assert.equal(view.runtime.maxResource, 100);
    rando.switchMode(w.baseSnapshot.stats, w.runtime, w.runtime.cooldownsUntil, '모드 전환', 400000, () => .5);
    assert.equal(party.serializeMember(w).runtime.mode, '즐리');
    k.baseSnapshot.stats.awakening = null;
    const monster = { name: '검증 보스', hp: 1e9, hpMax: 1e9, stats: { def: 0 }, debuffs: [] };
    const room = { questId: 'blackHodu', phaseIndex: 1, state: 'inProgress', members: [k], monster };
    rando.startSpray(k.baseSnapshot.stats, k.runtime, .5, 'party:1:검증 보스', 400000);
    for (let i = 1; i <= 5; i++) await at(400000 + i * 2000, () => fixed(.5, () => party.tickPartyKino(room, k)));
    assert.equal(k.runtime.kino.dot, undefined); assert.equal(monster.hp, 1e9 - 907 * 5);
}));

test('실제 PvP: 모드 전환과 별도 일반 공격 쿨타임, 키노 정신력 비용과 전투불능', async () => {
    let time = Date.now(); pvp.__setNow(() => time);
    try {
        for (const id of [15, 16]) {
            const a = user(id, '전직'), b = user(0); await a.save(); await b.save();
            pvp.ensurePvpState(a).daily.opponents = [{ name: b.name, rating: 1000 }];
            assert.equal((await pvp.startBattle(a, b.name)).ok, true);
            const battle = a.pvp.battle; time = battle.me.nextActionAt; battle.opp.nextActionAt = time + 60000; battle.opp.hp = 1e9;
            battle.me.skillCooldowns = {}; battle.me.defendCooldownEnd = time + 10000;
            await fixed(.5, () => assert.equal(pvp.playerSkill(a, id === 15 ? '모드 전환' : '아이돌 할래?').ok, true));
            if (id === 15) {
                assert.equal(battle.me.runtime.wonyoddi.mode, '즐리'); assert.equal(battle.me.skillCooldowns['모드 전환'] - time, 3500);
                assert.equal(battle.me.defendCooldownEnd - time, 7000);
                time = battle.me.nextActionAt; await fixed(.5, () => assert.equal(pvp.playerAttack(a).ok, true));
                assert.equal(battle.me.runtime.basicUntil - time, 3500); battle.me.nextActionAt = time;
                assert.equal(pvp.playerAttack(a).ok, false);
            } else {
                const v = pvp.buildBattleView(a); assert.equal(v.me.resourceLabel, '정신력'); assert.equal(v.me.mp, 0);
                assert.equal(Math.floor(battle.me.runtime.kino.value), 65);
                battle.me.runtime.kino = { value: 0, at: time, exhausted: true, berserk: false }; battle.me.nextActionAt = time;
                assert.equal(pvp.playerAttack(a).ok, false); assert.equal(pvp.playerSkill(a, '카스 살포').ok, false);
            }
        }
    } finally { pvp.__setNow(null); }
});

test('실제 PvP 카스 살포도 청심환 폭주를 타격 회복 전에 발동한다', async () => {
    let time = Date.now(); pvp.__setNow(() => time);
    try {
        const a = user(16, '전직'), b = user(0); equip(a, '청심환', 3); await a.save(); await b.save();
        pvp.ensurePvpState(a).daily.opponents = [{ name: b.name, rating: 1000 }];
        assert.equal((await pvp.startBattle(a, b.name)).ok, true);
        const battle = a.pvp.battle; time = battle.me.nextActionAt; battle.opp.nextActionAt = time + 60000; battle.opp.hp = 1e9;
        battle.me.skillCooldowns = {};
        battle.me.runtime.kino = { value: 120, at: time, exhausted: false, berserk: false };
        await fixed(.5, () => assert.equal(pvp.playerSkill(a, '카스 살포').ok, true));
        near(battle.me.runtime.kino.value, 5); assert.equal(battle.me.runtime.kino.berserk, true); assert.equal(battle.me.runtime.kino.exhausted, true);
        assert.equal(pvp.buildBattleView(a).me.maxResource, 150);
    } finally { pvp.__setNow(null); }
});

test('왕꿈틀이 19종 정확한 확률과 신규 캐릭터 카드팩 포함', async () => {
    const u = user(); u.bait = '왕꿈틀이';
    assert.equal(content.baitDefinition.rewards.reduce((sum, entry) => sum + entry.rate, 0), 200000);
    let offset = 0;
    for (const entry of content.baitDefinition.rewards) {
        const roll = (offset + entry.rate / 2) / 200000;
        const result = await fixed(roll, () => rpg.pickBaitReward(u));
        assert.equal(result.star, entry.card.star); assert.equal(result.type, entry.card.type);
        if (entry.card.id != null) assert.equal(result.id, entry.card.id);
        offset += entry.rate;
    }
    for (const type of ['일반', '전직', '각성']) for (const [value, id] of [[15.5 / 17, 15], [16.5 / 17, 16]]) {
        const card = await fixed(value, () => rpg.buildCharacterCardReward({ star: 4, card_type: type }));
        assert.equal(card.id, id); assert.equal(card.type, type);
    }
});

test('직접 낚은 카드는 공간이 있을 때 인벤토리, 가득 차면 살림망에 남고 수령 시 보존', async () => {
    const u = user(); u.maxCardLimit = 1; u.inventory.card = [];
    const first = { id: 15, type: '각성', star: 8 }, second = { id: 16, type: '각성', star: 8 }, third = { id: 15, type: '전직', star: 7 };
    rpg.addFishingReward(u, first); rpg.addFishingReward(u, second); rpg.addFishingReward(u, third);
    assert.deepEqual(u.inventory.card, [first]); assert.deepEqual(u.fishingCards, [second, third]); assert.equal(rpg.getFishingNetCount(u), 2);
    u.inventory.card = []; await rpg.clearFishingNet(u);
    assert.deepEqual(u.inventory.card, [second]); assert.deepEqual(u.fishingCards, [third]);
    assert.match(await rpg.clearFishingNet(u), /살림망에 남아/); assert.deepEqual(u.fishingCards, [third]);
});

test('각성 변환석은 각성 대상만 변환하고 등급·스펙터·잠금을 보존, 신규 지정 변환석 주머니', async () => {
    const u = user(), id = fixture.Item.findIndex(e => e.name === '각성 캐릭터 변환석');
    u.inventory.card = [{ id: 15, star: 8, type: '일반' }, { id: 15, star: 8, type: '각성', isSpecter: true, locked: true, skin: '란도랜드2' }];
    u.inventory.item = [{ id, count: 2 }];
    assert.ok(!(await rpg.useItem(u, '각성 캐릭터 변환석', 1)).startsWith('❌'));
    assert.equal(u.inventory.item[0].count, 1);
    assert.match(rpg.resolveWebItemUsePending(u, 1), /각성 카드만/); assert.equal(u.pendingAction.type, '각성캐릭터변환');
    const result = await fixed(.99999, () => rpg.resolveWebItemUsePending(u, 2));
    assert.match(result, /변환되었습니다/); assert.deepEqual(u.inventory.card[1], { id: 16, star: 8, type: '각성', isSpecter: true, locked: true });
    const choices = fixture.Item.find(e => e.name === '지정 캐릭터 변환석 주머니').choices;
    for (const name of ['워뇨띠 캐릭터 변환석', '키노 캐릭터 변환석']) assert.ok(choices.some(c => fixture.Item[c.id].name === name));
});

test('신규 운영 등록은 기존 항목·빈 구성 보존 및 재실행 무변경, 상점 가격·거래 불가', () => {
    const untouched = structuredClone(before);
    const after = content.prepare(before); assert.deepEqual(before, untouched);
    const expectedItems = structuredClone(before.Item), pouchId = before.Item.findIndex(e => e.name === '지정 캐릭터 변환석 주머니');
    expectedItems[pouchId].choices = after.Item[pouchId].choices;
    assert.deepEqual(after.Item.slice(0, before.Item.length), expectedItems);
    assert.deepEqual(after.Item.find(e => e.name === '지정 캐릭터 변환석 주머니').choices[0], { id: 2, count: 3 });
    for (const part of Object.keys(before.Equipment)) assert.deepEqual(after.Equipment[part].slice(0, before.Equipment[part].length), before.Equipment[part]);
    assert.deepEqual(content.prepare(after), after);
    assert.equal(after.Shop.아바타.at(-1).price.amount, 1200); assert.equal(after.Shop.가넷.at(-1).price.amount, 210);
    assert.equal(after.Item.find(e => e.name === '각성 캐릭터 변환석').no_trade, true);
    assert.ok(!Object.values(after.Shop).flat().some(e => Number(e.item_id) === after.Item.findIndex(i => i.name === '왕꿈틀이')));
    assert.equal(writes.filter(w => w.TableName === 'rpgenius_data').length, 0);
});
