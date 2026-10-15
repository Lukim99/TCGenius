const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const ilion = require('../ilion_cards');
const content = require('../scripts/register_ilion_content');
const items = require('../DB/RPGenius/Item.json').concat(content.itemDefinitions);
const equipment = structuredClone(require('../DB/RPGenius/Equipment.json'));
equipment.hat = [{ name: '검증용 모자', rarity: '일반', stat: { def: 100 }, upgrade: [] }];
for (const [part, list] of Object.entries(content.equipmentDefinitions)) equipment[part].push(...list);
const fashion = require('../DB/RPGenius/Fashion.json').concat(content.fashionDefinition);
const writes = [];
// 모든 AWS 입출력을 격리한다. 운영 환경 파일은 읽지 않는다.
DynamoDBDocumentClient.prototype.send = async command => {
    const input = command.input;
    if (command.constructor.name === 'GetCommand') {
        if (input.TableName !== 'rpgenius_data') return {};
        if (input.Key.key === 'Item') return { Item: { data: structuredClone(items) } };
        if (input.Key.key === 'Equipment') return { Item: { data: structuredClone(equipment) } };
        if (input.Key.key === 'Fashion') return { Item: { data: structuredClone(fashion) } };
        const file = path.join(__dirname, '../DB/RPGenius', input.Key.key + '.json');
        return { Item: { data: fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {} } };
    }
    if (command.constructor.name === 'ScanCommand') return { Items: [] };
    if (['UpdateCommand', 'PutCommand'].includes(command.constructor.name)) { writes.push(input); return {}; }
    throw new Error('Unexpected isolated DB command: ' + command.constructor.name);
};
const rpg = require('../rpgenius');
const training = require('../training');
const party = require('../partyquest').__test;
const pvp = require('../pvp');
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, a + ' ≠ ' + b);
const baseStats = { atk: 1000, crit: 0, critMul: 1.5, cmb: 0, maxCmb: 0, ilion: true, ilionStar: 4 };
const held = (name, until = Date.now() + 30000) => ({ name, until });
const runtime = names => ({ ilion: { deck: names.map(name => held(name)), balanceHits: 0 } });
let sequence = 0;
function user(type = '일반') {
    const u = new rpg.RPGUser('일리온검증' + ++sequence, 'ilion-test-' + sequence);
    u.main_card = { id: 14, star: 4, type }; u.card_slot = []; u.equipments = {}; u.need_character_card_select = false;
    u.hp = u.mp = 10000; u.avatarMigrated = true;
    return u;
}
function trainingUser(type = '일반') {
    return training.configure(user(type), { player: { atk: 1000, crit: 0, critMul: 1.5, cmb: 0, maxCmb: 0, extraDamage: 0, finalDamage: 0, afterSkill: 0 }, target: { kind: 'normal', def: 0, counterAttack: false } });
}
function equip(u, name, stage = 1) { u.equipments.weapon = { id: equipment.weapon.findIndex(e => e.name === name), transcendStage: stage }; }
async function fixed(value, fn) {
    const previous = Math.random;
    Math.random = () => value;
    try { return await fn(); } finally { Math.random = previous; }
}
test.before(() => rpg.initRpgeniusData());

test('14종 균등 추첨, 현재 덱의 중복 제외, 가장 오래된 카드 제외와 2/3장 한도', () => {
    const expected = ['삼두사', '광기', '부식', '환희', '뒤틀린 운명', '유령', '도태', '균형', '심판', '달', '별', '광대', '재상', '제후'];
    for (let i = 0; i < 14; i++) assert.equal(ilion.draw({}, {}, 0, 0, 1000, () => (i + .5) / 14).name, expected[i]);
    for (const stage of [0, 1]) {
        const r = {};
        for (let i = 0; i < 80; i++) {
            const previous = (r.ilion?.deck || []).map(c => c.name);
            const result = ilion.draw(r, {}, stage, 0, 1000 + i, () => 0);
            assert.ok(!previous.includes(result.name));
            assert.equal(new Set(r.ilion.deck.map(c => c.name)).size, r.ilion.deck.length);
            assert.equal(r.ilion.deck.length, Math.min(i + 1, stage ? 3 : 2));
            if (previous.length === (stage ? 3 : 2)) assert.equal(result.excluded, previous[0]);
        }
    }
    const reduced = runtime(['환희', '균형', '삼두사']);
    const result = ilion.draw(reduced, {}, 0, 0, Date.now(), () => 0);
    assert.equal(result.excluded, '환희, 균형');
    assert.equal(reduced.ilion.deck.length, 2);
    assert.equal(reduced.ilion.balanceHits, 1);
});

test('지속 효과의 정확한 만료와 제외 즉시 해제, 만료 후에도 덱 카드 수 유지', () => {
    const r = { ilion: { deck: [{ name: '삼두사', until: 17000 }, { name: '제후', until: 5000 }], balanceHits: 0 } };
    near(ilion.applyStats({ ...baseStats }, r, { ilionDeckAttack: .11 }, 4999).afterBasic, .5);
    const expired = ilion.applyStats({ ...baseStats }, r, { ilionDeckAttack: .11 }, 17000);
    assert.equal(expired.atk, 1220); assert.equal(expired.extraDamage || 0, 0); assert.equal(expired.afterBasic || 0, 0);
    ilion.excludeAll(r, {}, 0, 2000);
    assert.equal(ilion.applyStats({ ...baseStats }, r, {}, 2001).extraDamage || 0, 0);
});

test('도태 확정 치명타·치명 피해, 유령·광대·재상·달·별·광기', async () => {
    const doom = ilion.applyStats({ ...baseStats }, runtime(['도태']), {}, Date.now());
    await fixed(.99, () => {
        assert.equal(rpg.applyCriticalDamage(1000, doom, { critChanceMul: .5 }, {}).damage, 2000);
        assert.equal(rpg.applyCriticalDamage(1000, doom, { disableCritical: true }, {}).damage, 2000);
        assert.equal(rpg.applyCriticalDamage(1000, baseStats, { disableCritical: true }, {}).damage, 1000);
    });
    const other = ilion.applyStats({ ...baseStats }, runtime(['유령', '광대', '재상', '달']), {}, Date.now());
    near(other.avd, .10); near(other.cmb, .15); near(other.crit, .20); near(other.cooldown, .20);
    near(ilion.mpMultiplier(baseStats, {}, '헤즈업', 0), .70);
    assert.equal(ilion.mpMultiplier(baseStats, runtime(['별']), '느억맘', Date.now()), 0);
    assert.equal(ilion.actionReduction(baseStats, runtime(['광기']), Date.now()), 500);
});

test('환희의 남은 쿨타임 10% 즉시 감소, 균형 즉시 피해와 어머니 치확 갱신', async () => {
    const r = runtime(['환희', '균형']); const cd = { 헤즈업: 3000, 느억맘: 101000, 완료: 500 };
    ilion.excludeAll(r, cd, 2, 1000);
    assert.deepEqual(cd, { 헤즈업: 2800, 느억맘: 91000, 완료: 1000 });
    assert.equal(r.ilion.motherCritUntil, 6000);
    const stats = ilion.applyStats({ ...baseStats }, r, {}, 1000), extra = { cardDamage: true };
    near(stats.crit, .10);
    ilion.prepareAttack(stats, r, {}, 'boss', false, extra, 1000);
    await fixed(.5, () => {
        const hit = rpg.calculateAttackHitResult(0, 0, 0, stats, {}, extra, {});
        assert.equal(hit.finalDamage, 1000); assert.equal(hit.damageComponents.find(c => c.label === '균형').damage, 1000);
    });
    assert.equal(r.ilion.balanceHits, 0);
});

test('부식은 발동 확률 30%, 같은 공격자·대상에게만 5초 적용; 뒤틀린 운명은 50%', () => {
    const r = runtime(['부식', '뒤틀린 운명']), now = Date.now();
    const a = { isSkill: true }; ilion.prepareAttack(baseStats, r, {}, 'A', false, a, now, () => .2999);
    near(a.finalDamageBonus, .10); near(a.damageBonusMul, .40);
    for (const [owner, key, time] of [[{}, 'A', now], [r, 'B', now], [r, 'A', now + 5000]]) {
        const extra = { cardDamage: true }; ilion.prepareAttack(baseStats, owner, {}, key, false, extra, time, () => .9);
        assert.equal(extra.finalDamageBonus || 0, 0);
    }
    const no = { isSkill: true }; ilion.prepareAttack(baseStats, runtime(['부식', '뒤틀린 운명']), {}, 'A', false, no, now, () => .5);
    assert.equal(no.damageBonusMul || 0, 0); assert.equal(no.finalDamageBonus || 0, 0);
    ilion.excludeAll(r, {}, 0, now + 1);
    const removed = {}; ilion.prepareAttack(baseStats, r, {}, 'A', false, removed, now + 2);
    assert.equal(removed.finalDamageBonus || 0, 0);
});

test('선제공격은 개체별 첫 직접 공격, 일반 사냥 20초와 중복 처리·간접 피해 제외', () => {
    const r = {}, slots = { firstStrikeDamage: .50 };
    const attempt = (key, ordinary, now, extra = {}) => { ilion.prepareAttack({}, r, slots, key, ordinary, extra, now); return extra; };
    assert.equal(attempt('A', false, 1000, { dotAttack: true }).firstStrike, undefined);
    const first = attempt('A', false, 1000); near(first.finalDamageBonus, .50);
    attempt('A', false, 1000, first); near(first.finalDamageBonus, .50);
    assert.equal(attempt('A', false, 2000).firstStrike, undefined); assert.equal(attempt('B', false, 2000).firstStrike, true);
    assert.equal(attempt('field', true, 1000).firstStrike, true);
    assert.equal(attempt('field', true, 20999).firstStrike, undefined); assert.equal(attempt('field', true, 21000).firstStrike, true);
});

test('무한홀덤덱의 1/3단계 자동 추첨은 10/8초 간격이고 MP와 명령 쿨타임을 소비하지 않는다', () => {
    for (const [stage, interval] of [[1, 10000], [3, 8000]]) {
        const r = {};
        assert.equal(ilion.tick(r, {}, stage, 0, 1000, 1000 + interval - 1), null);
        assert.ok(ilion.tick(r, {}, stage, 0, 1000, 1000 + interval, () => 0));
        assert.equal(r.ilion.autoDrawAt, 1000 + interval * 2);
    }
});

test('일리온 전용 기본 슬롯, 전직 슬롯과 각성 슬롯은 각 타입에서만 적용', () => {
    const u = user(); u.card_slot = [{ id: 14, star: 11, type: '일반' }]; u.field = runtime(['환희', '균형']);
    near(rpg.calculateCardSlotEffects(u).ilionDeckAttack, .11);
    const before = rpg.calculateUserStats({ ...u, field: null }).atk;
    assert.equal(rpg.calculateUserStats(u).atk, Math.round(before * 1.22));
    u.main_card.id = 0; assert.equal(rpg.calculateCardSlotEffects(u).ilionDeckAttack, 0);
    u.card_slot[0].type = '전직'; near(rpg.calculateCardSlotEffects(u).damageBonus, .20);
    u.card_slot[0].type = '각성'; near(rpg.calculateCardSlotEffects(u).firstStrikeDamage, .50);
});

test('실제 필드 스킬: MP 부족 무변경, 헤즈업의 4성 비용 31MP, 각성 추가 피해', async () => {
    const u = trainingUser(); u.mp = 30;
    assert.match(await rpg.useSkillInField(u, '헤즈업'), /MP가 부족/); assert.equal(u.field.ilion, undefined);
    u.mp = 1000;
    await fixed(.5, () => rpg.useSkillInField(u, '헤즈업'));
    assert.equal(u.mp, 969); assert.equal(u.field.ilion.deck.length, 1); assert.equal(u.field.training.metrics.damage, 0);
    const awake = trainingUser('각성');
    await fixed(.5, () => rpg.useSkillInField(awake, '헤즈업'));
    assert.equal(awake.field.training.metrics.damage, 320);
    awake.field.nextActionAt = 0; awake.field.skillCooldowns = {}; awake.field.ilion = runtime(['별']).ilion; awake.mp = 0;
    assert.ok(!(await fixed(.5, () => rpg.useSkillInField(awake, '헤즈업'))).startsWith('❌'));
});

test('실제 필드: 어머니의 마음 궁극기 피해·쿨타임·전원 제외와 무한홀덤덱 자동 뽑기', async () => {
    const u = trainingUser('전직'); equip(u, '어머니의 마음', 3); u.mp = 10000; u.field.ilion = runtime(['환희', '균형']).ilion;
    const at = Date.now();
    await fixed(.5, () => rpg.useSkillInField(u, '느억맘'));
    assert.equal(u.field.ilion.deck.length, 0); assert.equal(u.field.training.metrics.damage, 13800);
    assert.ok(Math.abs(u.field.skillCooldowns['느억맘'] - at - 108000) < 100);
    const auto = trainingUser(); equip(auto, '무한홀덤덱', 3); auto.field.enteredAt = Date.now() - 8000;
    const mp = auto.mp, action = auto.field.nextActionAt;
    await fixed(.5, () => rpg.tickTrainingCombat(auto));
    assert.equal(auto.field.ilion.deck.length, 1); assert.equal(auto.mp, mp); assert.equal(auto.field.nextActionAt, action);
});

test('실제 파티 피해: 도태·심판, 부식의 공격자 분리와 균형 제외 피해', async () => {
    const make = name => ({ name, position: '메인딜러', baseSnapshot: { stats: { ...baseStats }, slotEffects: {}, mainCardSkills: [], transcendEquipment: { entries: [], setCounts: {} } }, runtime: { hp: 1000, hpMax: 1000, mp: 1000, mpMax: 1000, equipmentState: {}, equipmentAtkBuffs: {}, buffs: [], cooldownsUntil: {} } });
    const a = make('일리온'), b = make('다른 공격자'); a.runtime.ilion = runtime(['도태', '심판']).ilion;
    const monster = { name: '테스트 보스', hp: 1e9, hpMax: 1e9, stats: { def: 0 }, debuffs: [] };
    const room = { questId: 'blackHodu', phaseIndex: 1, members: [a, b], monster };
    await fixed(.5, () => { const hit = party.calculateOutgoingDamage(a, monster, room, 1000, { isBasic: true }); assert.equal(hit.damage, 4950); assert.equal(hit.criticalCount, 1); });
    a.runtime.ilion = runtime(['부식']).ilion;
    await fixed(.1, () => party.calculateOutgoingDamage(a, monster, room, 1000, { isBasic: true }));
    await fixed(.5, () => assert.equal(party.calculateOutgoingDamage(b, monster, room, 1000, { isBasic: true }).damage, 1650));
    a.runtime.ilion = runtime(['균형']).ilion; ilion.excludeAll(a.runtime, {}, 0, Date.now());
    await fixed(.5, () => assert.equal(party.calculateOutgoingDamage(a, monster, room, 0, { cardDamage: true }).damage, 1000));
});

test('실제 파티 자동 추첨은 MP·행동 대기시간을 소비하지 않고 각성 공격을 발동시키지 않는다', async () => {
    const a = { name: '일리온', baseSnapshot: { stats: { ...baseStats, awakening: { effect: 'headsUpDamage', value: .32 } },
        transcendEquipment: { entries: [{ name: '무한홀덤덱', stage: 3 }] } }, runtime: {
        mp: 1000, actionUntil: 0, cooldownsUntil: {}, equipmentState: { combatStartedAt: Date.now() - 8000 } } };
    const room = { questId: 'blackHodu', phaseIndex: 1, members: [a], monster: { hp: 10000 } };
    await fixed(.5, () => party.tickPartyIlion(room, a));
    assert.equal(a.runtime.ilion.deck.length, 1); assert.equal(a.runtime.mp, 1000); assert.equal(a.runtime.actionUntil, 0);
    assert.equal(room.monster.hp, 10000); assert.match(room.combatLog.at(-1).text, /무한홀덤덱/);
});

test('13종 보주의 모자·신발 부위와 실제 스탯 반영, 관통률 및 음수 효과', () => {
    const orbs = require('../DB/RPGenius/Orb.json').orbs.slice(-13);
    const expected = [ { takenDamage: -.02 }, { cmb: .01 }, { fireAtk: 25, fireRes: 25 }, { recoveryEfficiency: -.05, potion: .10 },
        { crit: .05, critMul: -.05 }, null, { darkAtk: 25, darkRes: 25 }, { waterAtk: 25, waterRes: 25 },
        { nonElementDamage: .01 }, { gold: .01 }, { pntPercent: .03 }, { eliteDmg: .03 }, { damageBonus: .03 } ];
    const u = user(); u.equipments.hat = { id: 0 };
    const before = rpg.calculateUserStats(u);
    orbs.forEach((orb, i) => {
        assert.deepEqual(orb.parts, ['hat', 'shoes']);
        u.equipments.hat.orb = { name: orb.name, stat: orb.stat, plusStat: orb.plusStat };
        const after = rpg.calculateUserStats(u);
        if (i === 5) assert.equal(after.def, Math.round(before.def * 1.02));
        else for (const [key, delta] of Object.entries(expected[i])) near(Number(after[key] || 0) - Number(before[key] || 0), delta);
    });
});

test('운영 등록은 누락 항목만 추가하고 기존 설정·인덱스·빈 구성을 보존하며 재실행은 무변경', () => {
    const before = { Item: [{ name: '운영 보상', pack: 99 }], Equipment: { weapon: [], support: [] }, Fashion: [], Shop: { 아바타: [] } };
    const after = content.prepare(before); assert.deepEqual(after.Item[0], before.Item[0]); assert.equal(after.Item.length, 15);
    after.Equipment.weapon[0].stat.atk = 777; after.Fashion[0].option.stat = {}; after.Shop.아바타[0].price.amount = 900;
    assert.deepEqual(content.prepare(after), after); assert.deepEqual(before.Equipment.weapon, []);
    assert.equal(after.Equipment.support[0].statRange.mp, 100); assert.equal(after.Equipment.support[0].plusStatRange.afterBasic, .10);
    assert.equal(writes.filter(w => w.TableName === 'rpgenius_data').length, 0);
});

test('실제 PvP 스킬: MP 부족 무변경·별 무료 사용·어머니 궁극기의 제외와 쿨타임', async () => {
    let time = Date.now(); pvp.__setNow(() => time);
    try {
        const a = user('전직'), b = user(); equip(a, '어머니의 마음', 3);
        await a.save(); await b.save();
        pvp.ensurePvpState(a).daily.opponents = [{ name: b.name, rating: 1000 }];
        assert.equal((await pvp.startBattle(a, b.name)).ok, true);
        const battle = a.pvp.battle;
        time = battle.me.nextActionAt; battle.opp.nextActionAt = time + 60000; battle.opp.hp = 1e9;
        battle.me.skillCooldowns = {}; battle.me.mp = 0;
        assert.equal(pvp.playerSkill(a, '헤즈업').ok, false); assert.equal(battle.me.runtime.ilion, undefined);
        battle.me.mp = 1000;
        await fixed(.5, () => assert.equal(pvp.playerSkill(a, '헤즈업').ok, true));
        assert.equal(battle.me.mp, 969); assert.equal(battle.me.runtime.ilion.deck.length, 1);
        battle.me.nextActionAt = 0; battle.me.skillCooldowns = {}; battle.me.mp = 0;
        battle.me.runtime.ilion = runtime(['별']).ilion;
        await fixed(.5, () => assert.equal(pvp.playerSkill(a, '헤즈업').ok, true));
        assert.equal(battle.me.mp, 0);
        battle.me.nextActionAt = 0; battle.me.skillCooldowns = {}; battle.me.mp = 10000;
        battle.me.runtime.ilion = runtime(['환희', '균형']).ilion;
        await fixed(.5, () => assert.equal(pvp.playerSkill(a, '느억맘').ok, true));
        assert.equal(battle.me.runtime.ilion.deck.length, 0);
        assert.equal(battle.me.skillCooldowns['느억맘'] - time, 108000);
        assert.ok(battle.events.at(-1).damage > 0);
    } finally { pvp.__setNow(null); }
});

test('실제 PvP 시간 진행으로 무한홀덤덱이 자동 추첨하며 유효한 이펙트만 전달한다', async () => {
    let time = Date.now(); pvp.__setNow(() => time);
    try {
        const a = user('각성'), b = user(); equip(a, '무한홀덤덱', 3); await a.save(); await b.save();
        pvp.ensurePvpState(a).daily.opponents = [{ name: b.name, rating: 1000 }];
        assert.equal((await pvp.startBattle(a, b.name)).ok, true);
        const battle = a.pvp.battle;
        battle.me.nextActionAt = battle.opp.nextActionAt = time + 60000;
        const mp = battle.me.mp, hp = battle.opp.hp, action = battle.me.nextActionAt;
        time = battle.me.enteredAt + 8000;
        await fixed(.5, () => pvp.advanceBattle(a, time));
        assert.equal(battle.me.runtime.ilion.deck.length, 1); assert.equal(battle.me.mp, mp);
        assert.equal(battle.me.nextActionAt, action); assert.equal(battle.opp.hp, hp);
        const event = battle.events.at(-1); assert.equal(event.skillName, '헤즈업');
        const effects = require('../public/combat-effects');
        for (const id of event.effectIds) assert.ok(fs.existsSync(path.join(__dirname, '../DB/RPGenius/ui', effects.assetPath(id))), id);
    } finally { pvp.__setNow(null); }
});

test('실제 레이드 입장 시 무한홀덤덱 스냅샷과 8초 자동 추첨', async () => {
    const api = require('../partyquest');
    const u = user(); u.level = 300; u.unlockedRaids = ['mansionNormal']; equip(u, '무한홀덤덱', 3); await u.save();
    const result = await api.createRoom(u.name, 'mansionNormal'); assert.ok(result.roomId, JSON.stringify(result));
    try {
        api.setReady(u.name, true);
        assert.equal((await api.start(u.name)).ok, true);
        const room = api.getRoomOf(u.name), member = room.members[0];
        assert.equal(member.baseSnapshot.stats.ilion, true);
        assert.ok(member.baseSnapshot.transcendEquipment.entries.some(e => e.name === '무한홀덤덱' && e.stage === 3));
        room.introUntil = 0;
        delete member.runtime.ilion.pausedAt;
        member.runtime.ilion.autoDrawAt = Date.now() - 1;
        await fixed(.6, () => party.stepRoom(room));
        assert.equal(member.runtime.ilion.deck.length, 1);
        assert.ok(member.runtime.ilion.deck[0].until - Date.now() > 3900);
        const originalNow = Date.now; let time = originalNow(); Date.now = () => time;
        try {
            member.runtime.ilion.motherCritUntil = time + 5000;
            const expires = member.runtime.ilion.deck[0].until, drawAt = member.runtime.ilion.autoDrawAt;
            room.monster.bossState.form = 'transition'; room.monster.bossState.transitionRemain = 4;
            party.stepRoom(room); time += 2200; party.stepRoom(room);
            room.monster.bossState.form = 'body'; party.stepRoom(room);
            assert.equal(member.runtime.ilion.deck[0].until, expires + 2200);
            assert.equal(member.runtime.ilion.autoDrawAt, drawAt + 2200);
            assert.equal(member.runtime.ilion.motherCritUntil - time, 5000);
        } finally { Date.now = originalNow; }
        room.awaitingChoices = true;
    } finally { api.leaveRoom(u.name); }
});

test('레이드 전환은 일리온 4초 카드와 자동 추첨을 함께 동결한다', () => {
    const original = Date.now; let time = 10000; Date.now = () => time;
    try {
        const member = { baseSnapshot: { stats: { ...baseStats }, transcendEquipment: { entries: [{ name: '무한홀덤덱', stage: 3 }] } }, runtime: { equipmentState: { combatStartedAt: 10000 }, ilion: { deck: [{ name: '심판', until: 14000 }, { name: '제후', until: 9000 }], autoDrawAt: 18000, balanceHits: 0 } } };
        const room = { members: [member] };
        party.pausePartyIlion(room, true); time += 2200; party.pausePartyIlion(room, false);
        assert.equal(member.runtime.ilion.deck[0].until - time, 4000);
        assert.equal(member.runtime.ilion.deck[1].until, 9000);
        assert.equal(member.runtime.ilion.autoDrawAt - time, 8000);
        assert.equal(ilion.applyStats({ ...baseStats }, member.runtime, {}, time).finalDamage, .5);
    } finally { Date.now = original; }
});
