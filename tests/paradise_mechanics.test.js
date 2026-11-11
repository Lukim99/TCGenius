const { test, before, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const AWS = require('aws-sdk');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const data = {};
for (const key of ['Item', 'Equipment', 'Bundle', 'Recipe', 'Pack']) data[key] = JSON.parse(fs.readFileSync(path.join(__dirname, '../DB/RPGenius', key + '.json'), 'utf8'));
data.Item.push({ name: '천상의 회랑 입장권', type: '티켓' });
data.Paradise = { enabled: true, baseRewards: [] };
AWS.S3.prototype.makeRequest = operation => {
    if (operation === 'listObjectsV2') return { promise: async () => ({ Contents: [] }) };
    throw new Error('Unexpected isolated S3 operation: ' + operation);
};
DynamoDBDocumentClient.prototype.send = async command => {
    if (command.constructor.name === 'GetCommand' && command.input.TableName === 'rpgenius_data') return { Item: data[command.input.Key.key] ? { data: structuredClone(data[command.input.Key.key]) } : undefined };
    if (command.constructor.name === 'ScanCommand') return { Items: [] };
    throw new Error('Unexpected isolated DB write: ' + command.constructor.name);
};
const rpg = require('../rpgenius'), corridor = require('../paradise'), mechanics = require('../paradise_mechanics');
const catalog = require('../paradise_augments_mechanics'), shields = require('../combat_shields');
const name = 'paradise-mechanics-test';
before(() => rpg.initRpgeniusData());
afterEach(() => rpg.clearFieldRuntimeTimers(name));
function fresh(...augments) {
    rpg.clearFieldRuntimeTimers(name);
    const user = new rpg.RPGUser(name, name);
    user.level = 300; user.main_card = { id: 0, star: 9, type: '전직' }; user.need_character_card_select = false;
    user.hp = 19; user.mp = 7;
    rpg.addInventoryItem(user, data.Item.length - 1, 1);
    corridor.enter(user, () => .99);
    augments.forEach(id => { user.paradise.acquired[id] = 1; });
    battle(user);
    return user;
}
function battle(user) {
    corridor.startCombat(user, 'normal', null, () => .99);
    Object.assign(user.paradise.enemy, { hp: 1e12, maxHp: 1e12, atk: 0, def: 0, pnt: 0, crit: 0, cmb: 0 });
}
function hit(user, extra = {}, raw = 100) {
    rpg.buildHuntResult(user, {}, raw, { isBasic: true, comboHitCount: 1, ...extra });
    return user.paradise.combatEvents.at(-1);
}
function dot(user, raw = 100) { return hit(user, { isBasic: false, paradiseDot: true, dotAttack: true, summonAttack: true, hitCount: 1, disableCritical: true, skillName: '검증용 지속 피해' }, raw); }
function s(user) { return user.paradise.battle.mechanics ||= {}; }
function resources(user) { return corridor.getResources(user); }
async function skill(user, skillName, reset = true) {
    user.field.nextActionAt = 0;
    if (reset) delete user.field.skillCooldowns[skillName];
    const text = await rpg.useSkillInField(user, skillName);
    assert.ok(!text.startsWith('❌'), text);
    return text;
}
function grantShield(user, amount, expiresAt = Date.now() + 30000) { shields.grant(user.field, { source: 'test', caster: name, amount, expiresAt }); }
const routes = require('../paradise_routes');
function route(user, id, kind = 'normal') {
    user.paradise.phase = 'route'; user.paradise.routes = [{ id: 'test-route', kind, gimmick: id }];
    assert.equal(corridor.chooseRoute(user, 'test-route', () => .99).error, undefined);
}
function durableEnemy(user) { Object.assign(user.paradise.enemy, { hp: 1e9, maxHp: 1e9, atk: 0, def: 0, pnt: 0, crit: 0, cmb: 0 }); }

test('재만 남는 길은 고정 피해와 소환수를 막고 불씨와 네이티브 지속 피해는 통과시킨다', t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh('echoStrike', 'rustPendulum'); route(user, 'ashOnly'); durableEnemy(user);
    user.paradise.effects.echoStrike = 1; s(user).rustDamage = 2000;
    const hp = user.paradise.enemy.hp;
    assert.equal(hit(user).damage, 0);
    assert.equal(hit(user, { fixedDamage: 1000 }).damage, 0);
    assert.equal(hit(user, { summonAttack: true }).damage, 0);
    assert.equal(user.paradise.enemy.hp, hp);
    assert.equal(routes.reflection(user, 500), 0);
    const ticks = mechanics.takeTicks(user, Date.now() + 5100);
    assert.equal(ticks.length, 5); assert.ok(ticks.every(tick => tick.rawDamage > 0 && tick.paradiseDot));
    assert.ok(dot(user).damage > 0);
    for (const key of ['burn', 'hellfire']) {
        user.field.equipmentState[key] = { tickDamage: 10, expiredAt: Date.now() + 5000, nextTickAt: Date.now() + 2000 };
        assert.ok(mechanics.dots(user).some(d => d.key === key));
    }
    corridor.victory(user, () => .99);
    assert.equal(user.paradise.routeEncounter, undefined);
    const choices = corridor.view(user).run.choices;
    assert.equal(choices.length, 3); assert.ok(choices.every(a => a.category === 'dot'));
    assert.equal(new Set(choices.map(a => a.rarity)).size, 1);
    for (const choice of choices) {
        const result = corridor.rerollAugment(user, choice.id, () => .99);
        if (!result.error) assert.ok(corridor.view(user).run.choices.every(a => a.category === 'dot'));
    }
    corridor.chooseAugment(user, user.paradise.choices[0], () => .99);
    assert.equal(user.paradise.augmentCategory, undefined);
    corridor.chooseRoute(user, user.paradise.routes[0].id, () => .99); durableEnemy(user);
    assert.ok(hit(user).damage > 0);
    assert.equal(routes.reflection(user, 500), 500);
});

test('기믹은 공격 순서, 봉인, 연격과 치명타 판정을 실제 타격에 적용한다', async t => {
    t.mock.method(Math, 'random', () => .99);
    let user = fresh(); route(user, 'thirdSeal'); durableEnemy(user);
    assert.equal(hit(user).damage, 0); assert.equal(hit(user).damage, 0); assert.ok(hit(user).damage > 250);
    user = fresh(); route(user, 'alternatingGate'); durableEnemy(user);
    assert.ok(hit(user).damage > 100); assert.equal(hit(user).damage, 0);
    assert.ok(hit(user, { isBasic: false, isSkill: true }).damage > 100);
    user = fresh(); route(user, 'criticalLock'); durableEnemy(user);
    for (let i = 0; i < 3; i++) assert.equal(hit(user).damage, 0);
    const critical = hit(user); assert.ok(critical.damage > 0); assert.equal(critical.criticalCount, 1);
    assert.equal(hit(user).damage, 0); assert.equal(dot(user).damage, 0);
    user = fresh(); route(user, 'comboToll'); durableEnemy(user);
    const combo = hit(user); assert.equal(combo.hits.length, 3);
    user = fresh(); route(user, 'silentArena'); durableEnemy(user);
    const blocked = await rpg.useSkillInField(user, rpg.getMainCardSkills(user)[0].skill.name);
    assert.match(blocked, /침묵의 검투장/); assert.ok(hit(user).damage > 150);
    corridor.victory(user, () => .99);
    assert.equal(routes.skillBlocked(user), null); assert.ok(corridor.view(user).run.choices.every(a => a.category === 'combo'));
});

test('유리 금고의 흡수량은 하얀 피해 사건과 체력바에 반영되며 파괴 후 한 번만 세 배가 된다', t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh(); route(user, 'glassVault'); durableEnemy(user);
    shields.grant(user.paradise.enemy, { source: 'route:glassVault', caster: '', amount: 250 });
    assert.equal(corridor.view(user).run.enemy.shield, 250);
    const first = hit(user), absorbed = first.hits.find(detail => detail.type === 'absorbed');
    assert.equal(first.damage, 0); assert.ok(absorbed.damage > 0);
    assert.equal(corridor.view(user).run.enemy.shield, 250 - absorbed.damage);
    hit(user, {}, 10000);
    assert.equal(corridor.view(user).run.enemy.shield, 0);
    const boosted = hit(user).damage, normal = hit(user).damage;
    assert.ok(Math.abs(boosted - normal * 3) <= 3);
    shields.grant(user.paradise.enemy, { source: 'route:glassVault', caster: '', amount: 250 });
    assert.equal(routes.reflection(user, 100), 0); assert.equal(corridor.view(user).run.enemy.shield, 150);
    assert.equal(routes.reflection(user, 200), 50); assert.equal(corridor.view(user).run.enemy.shield, 0);
    assert.ok(Math.abs(hit(user).damage - normal * 3) <= 3);
    corridor.victory(user, () => .99);
    assert.equal(user.paradise.phase, 'relic'); assert.ok(corridor.view(user).run.relicChoices.every(r => r.rarity === 'normal'));
});

test('유리 성벽, 피의 연료, 마지막 불빛은 HP와 보호막을 전투 안에서만 사용한다', t => {
    t.mock.method(Math, 'random', () => .99);
    let user = fresh(); route(user, 'wardDuel'); durableEnemy(user);
    assert.equal(shields.summary(user.field, Date.now()).amount, Math.round(rpg.calculateUserStats(user).hp * .50));
    const protectedHit = hit(user).damage;
    shields.absorb(user.field, Infinity);
    const unprotectedHit = hit(user).damage; assert.ok(Math.abs(protectedHit - unprotectedHit * 3) <= 3);
    user = fresh(); route(user, 'bloodFuel'); durableEnemy(user);
    const before = resources(user).hp; assert.ok(hit(user).damage > 150);
    assert.equal(resources(user).hp, before - Math.floor(before * .05));
    resources(user).hp = 1; hit(user); assert.equal(resources(user).hp, 1);
    corridor.victory(user, () => .99); assert.ok(resources(user).hp > 1);
    user = fresh(); route(user, 'lastLight'); durableEnemy(user);
    const stats = rpg.calculateUserStats(user);
    assert.ok(resources(user).hp <= stats.hp * .30);
    assert.equal(shields.summary(user.field, Date.now()).amount, Math.round(stats.hp * .80));
    assert.ok(hit(user).damage > 150);
    corridor.victory(user, () => .99); assert.equal(resources(user).hp, stats.hp); assert.equal(resources(user).mp, stats.mp);
    assert.deepEqual([user.hp, user.mp], [19, 7]);
});

test('자동 공격 횟수에 따라 역전과 후반전이 발동하며 피해를 저장해 돌려준다', t => {
    t.mock.method(Math, 'random', () => .99);
    let user = fresh(); route(user, 'reversalSpear'); durableEnemy(user);
    const base = hit(user).damage;
    assert.equal(routes.incoming(user, 100), 150); assert.equal(routes.incoming(user, 100), 150); assert.equal(routes.incoming(user, 100), 0);
    assert.ok(Math.abs(hit(user).damage - base * 3) <= 3); assert.equal(hit(user).damage, base);
    user = fresh(); route(user, 'secondHalf'); durableEnemy(user);
    const initial = hit(user).damage;
    for (let i = 0; i < 3; i++) assert.equal(routes.incoming(user, 100), 50);
    assert.equal(routes.incoming(user, 100), 100); assert.ok(Math.abs(hit(user).damage - initial * 2) <= 2);
    user = fresh(); route(user, 'vengeance'); durableEnemy(user);
    user.paradise.enemy.atk = 10;
    user.field.nextEnemyAttackAt = Date.now() - 1;
    rpg.advanceParadiseCombat(user);
    assert.equal(user.paradise.routeEncounter.incoming, 1);
    const stored = user.paradise.routeEncounter.storedHp; assert.ok(stored > 0);
    const returned = hit(user); assert.ok(returned.hits.some(h => h.fixed && h.damage === stored * 3));
    assert.equal(user.paradise.routeEncounter.storedHp, 0);
});

test('도화선은 나눈 피해를 중첩 보존하고 마나 샘과 시계는 실제 쿨타임을 바꾼다', t => {
    t.mock.method(Math, 'random', () => .99);
    let user = fresh(); route(user, 'burningFuse'); durableEnemy(user);
    const reduced = hit(user).damage; hit(user);
    const ticks = mechanics.takeTicks(user, Date.now() + 3100);
    assert.equal(ticks.length, 6); assert.ok(ticks.every(tick => tick.rawDamage > 0));
    assert.ok(Math.abs(ticks.slice(0, 3).reduce((sum, tick) => sum + tick.rawDamage, 0) * 3 - reduced) <= 5);
    user = fresh(); route(user, 'manaSpring'); durableEnemy(user); resources(user).mp = 0;
    const deadline = Date.now() + 15000; user.field.skillCooldowns.test = deadline;
    hit(user); assert.ok(resources(user).mp > 0); assert.equal(user.field.skillCooldowns.test, deadline - 2000);
    user = fresh(); route(user, 'crookedClock'); durableEnemy(user);
    const next = user.field.nextEnemyAttackAt;
    for (let i = 0; i < 6; i++) hit(user);
    assert.equal(user.field.nextEnemyAttackAt, next + 4000);
    corridor.onSkillUsed(user, 1, '시계 검증'); assert.equal(user.field.nextEnemyAttackAt, next + 3000);
    assert.ok(hit(user, { isBasic: false, isSkill: true }).damage > 150);
});

test('빌려 온 피날레는 스펙터 궁극기도 인식하며 첫 궁극기의 쿨타임만 없앤다', async t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh(); user.main_card.specter = '빅뱅 스펙터';
    route(user, 'borrowedFinale'); durableEnemy(user);
    resources(user).mp = rpg.calculateUserStats(user).mp;
    await skill(user, '빅뱅'); assert.ok(user.field.skillCooldowns['빅뱅'] <= Date.now());
    assert.equal(routes.incoming(user, 100), 120);
    resources(user).mp = rpg.calculateUserStats(user).mp;
    await skill(user, '빅뱅'); assert.ok(user.field.skillCooldowns['빅뱅'] > Date.now());
    corridor.victory(user, () => .99);
    assert.ok(corridor.view(user).run.choices.every(a => a.category === 'ultimate'));
});

test('수문장의 부활은 처치 보상보다 먼저 한 번 발동하고 확률 타격은 결과를 알려준다', t => {
    t.mock.method(Math, 'random', () => .99);
    let user = fresh(); route(user, 'revenant');
    const maxHp = user.paradise.enemy.maxHp, atk = user.paradise.enemy.atk;
    hit(user, {}, 1e12);
    assert.equal(user.paradise.phase, 'combat'); assert.equal(user.paradise.battlesWon, 0);
    assert.equal(user.paradise.enemy.hp, Math.round(maxHp * .40)); assert.equal(user.paradise.enemy.atk, Math.round(atk * 1.30));
    hit(user, {}, 1e12); assert.equal(user.paradise.battlesWon, 1); assert.equal(user.paradise.phase, 'relic');
    user = fresh(); route(user, 'coinDuel'); durableEnemy(user);
    hit(user); assert.match(user.paradise.combatLog.join('\n'), /뒷면, 피해 25%/);
    const high = { finalDamage: 100, hitDetails: [{ damage: 100 }] }, extra = { isBasic: true };
    routes.modifyHit(user, rpg.calculateUserStats(user), extra, high, () => 0);
    assert.equal(high.finalDamage, 250); assert.match(extra.notice, /앞면!/);
});

test('82개 증강의 분류·고유 ID·문체와 궁극기 보유 조건을 확인한다', t => {
    let playerPower;
    t.mock.method(rpg, 'calculateCombatPower', () => ({ total: playerPower }));
    assert.equal(catalog.length, 82);
    assert.deepEqual(Object.fromEntries(['dot', 'combo', 'shield', 'ultimate', 'active', 'passive'].map(key => [key, catalog.filter(a => a.category === key).length])), { dot: 24, combo: 12, shield: 13, ultimate: 8, active: 10, passive: 13 });
    assert.equal(new Set(corridor.AUGMENTS.map(a => a.id)).size, 465);
    for (const augment of catalog) {
        assert.match(augment.desc, /니다\.$/);
        const user = fresh();
        playerPower = corridor.recommendedPower(user.paradise.floor + augment.floors);
        user.paradise.phase = 'augment'; user.paradise.choices = [augment.id];
        assert.ok(!corridor.chooseAugment(user, augment.id, () => .99).error, augment.id);
        assert.ok(!user.paradise.choices.includes(augment.id), '중복 제시 ' + augment.id);
    }
    const user = fresh(); user.main_card.type = '일반';
    assert.equal(rpg.getUltimateSkills(user).length, 0);
    assert.equal(rpg.isUltimateSkillForUser(user, rpg.getMainCardSkills(user).at(-1).skill), false);
    for (const augment of catalog.filter(a => a.requiresUltimate)) {
        playerPower = corridor.recommendedPower(user.paradise.floor + augment.floors);
        for (const a of corridor.AUGMENTS) user.paradise.acquired[a.id] = 1;
        delete user.paradise.acquired[augment.id]; corridor.offerAugments(user);
        assert.deepEqual(user.paradise.choices, []);
        user.paradise.choices = [augment.id]; assert.ok(corridor.chooseAugment(user, augment.id).error);
        user.main_card.specter = '빅뱅 스펙터';
        corridor.offerAugments(user); assert.deepEqual(user.paradise.choices, [augment.id]);
        delete user.main_card.specter;
    }
    user.main_card.type = '전직'; user.main_card.specter = '빅뱅 스펙터';
    assert.deepEqual(rpg.getUltimateSkills(user).map(entry => entry.skill.name), ['유드 알레프', '빅뱅']);
});

test('지속 피해는 증강 획득 후에만 치명타가 되고 저항·기존 필드 격리를 지킨다', t => {
    t.mock.method(Math, 'random', () => 0);
    const user = fresh(), normal = dot(user);
    assert.equal(normal.criticalCount, 0);
    user.paradise.acquired.dotCritical = 1;
    const critical = dot(user); assert.equal(critical.criticalCount, 1); assert.ok(critical.damage > normal.damage);
    user.paradise.enemy.critDef = 1;
    assert.equal(dot(user).damage, normal.damage);
    user.paradise.mode = 'hell';
    assert.equal(dot(user).criticalCount, 0);
    assert.equal(user.hp, 19); assert.equal(user.mp, 7);
});

test('공격으로 독침·불씨·산성·시한 상처·중첩 출혈을 만들고 저장된 틱을 한 번만 꺼낸다', t => {
    t.mock.method(Math, 'random', () => 0);
    const user = fresh('venomNeedle', 'cinderScript', 'sourRain', 'delayedWound', 'bleedLedger');
    hit(user); hit(user, { isBasic: false, isSkill: true }); hit(user);
    assert.deepEqual(new Set(Object.keys(s(user).dots)), new Set(['needle', 'ledger', 'cinder', 'acid', 'wound']));
    assert.equal(s(user).dots.ledger.stacks, 3);
    const snapshot = structuredClone(user.paradise), at = Date.now() + 2200;
    const ticks = mechanics.takeTicks(user, at); assert.ok(ticks.length >= 5);
    assert.equal(mechanics.takeTicks(user, at).length, 0);
    user.paradise = snapshot; assert.equal(mechanics.takeTicks(user, at).length, ticks.length);
    ticks.forEach(effect => dot(user, effect.rawDamage));
    assert.ok(user.paradise.enemy.hp < 1e12);
});

test('native 지속 피해 4종을 연장하고 폭발 시 전부 소비한다', t => {
    const at = Date.now(); t.mock.method(Date, 'now', () => at);
    const user = fresh('afterglowThread', 'venomDetonator');
    user.field.mark = { dot: 100, expired_at: at + 6000 };
    user.field.equipmentState.burn = { tickDamage: 100, nextTickAt: at + 2000, intervalMs: 2000, expiredAt: at + 6000 };
    user.field.equipmentState.hellfire = { tickDamage: 100, nextTickAt: at + 2000, intervalMs: 2000, expiredAt: at + 6000 };
    user.field.kino = { dot: { rate: .1, nextAt: at + 2000, until: at + 6000 } };
    hit(user); assert.equal(user.field.mark.expired_at, at + 8000);
    const stored = mechanics.dots(user).reduce((sum, d) => sum + d.damage * d.ticks, 0);
    const result = hit(user, { isBasic: false, isSkill: true });
    assert.ok(result.damage >= stored * .5); assert.equal(mechanics.dots(user).length, 0);
});

test('지속 피해의 숙성·자원 회수·보호막·마취·방어 관통·진자·쿨타임 연계가 작동한다', t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh('patientPoison', 'emberBattery', 'coagulation', 'anesthetic', 'meltingArmor', 'putrefaction', 'rustPendulum');
    resources(user).mp = 0; user.field.skillCooldowns['자인'] = Date.now() + 60000;
    const before = user.field.skillCooldowns['자인'], first = dot(user).damage;
    for (let i = 0; i < 4; i++) dot(user);
    assert.ok(dot(user).damage > first); assert.ok(resources(user).mp > 0);
    assert.ok(shields.summary(user.field, Date.now()).amount > 0);
    assert.equal(user.field.skillCooldowns['자인'], before - 3000);
    assert.equal(mechanics.incomingMultiplier(user), .5);
    assert.equal(mechanics.incomingMultiplier(user), 1);
    assert.ok(!s(user).meltReady, '6회까지는 관통하지 않음');
    dot(user); assert.equal(s(user).meltReady, true);
    const reserve = s(user).rustDamage;
    const result = hit(user); assert.ok(result.damage >= reserve);
    assert.equal(s(user).rustDamage, 0); assert.equal(s(user).meltReady, false);
});

test('합창·피의 잉크·지속 피해 계약과 생명보험은 전투별 한도와 회복 봉쇄를 지킨다', async () => {
    const user = fresh('malignantHarmony', 'bloodInk', 'plaguePact', 'toxicInsurance', 'emberBattery');
    mechanics.addDot(user, 'one', '하나', 20, 10); mechanics.addDot(user, 'two', '둘', 30, 10);
    dot(user); assert.ok(s(user).dots.harmony);
    const before = resources(user).hp; await skill(user, '자인');
    assert.ok(resources(user).hp < before); assert.equal(s(user).ink, .25);
    user.paradise.effects.noHealing = 1; resources(user).mp = 0;
    for (let i = 0; i < 12; i++) dot(user);
    assert.equal(resources(user).mp, 0); assert.equal(user.paradise.effects.reward, .03);
    assert.equal(corridor.survive(user, 0, 100), 1); assert.equal(mechanics.dots(user).length, 0);
    mechanics.addDot(user, 'new', '새 독', 20, 2); assert.equal(corridor.survive(user, 0, 100), 0);
});

test('지속 피해 처치의 잿더미와 카드 계약은 다음 전투·탐험에 정확히 이어진다', () => {
    const user = fresh('contagiousAsh', 'funeralInterest');
    for (let i = 0; i < 15; i++) {
        user.paradise.enemy.hp = 1; dot(user, 100);
        assert.ok(user.paradise.mechanics.carriedAsh > 0);
        assert.equal(user.paradise.contracts.filter(c => c.name.startsWith('장례 보험금')).length, Math.min(2, Math.floor((i + 1) / 3)));
        battle(user); assert.ok(s(user).dots.ash);
    }
    assert.equal(user.paradise.contracts.filter(c => c.star === 8 && c.type === '일반').length, 2);
});

test('실패한 연격을 저축하고 다음 최대 연격에 마지막 확정 치명타·출혈·파열을 적용한다', t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh('comboEncore', 'comboSheath', 'comboMeter', 'comboBleed', 'comboRupture');
    hit(user); const stored = s(user).sheathDamage;
    const second = hit(user); assert.equal(second.hits.length, 3); // 실제 연격 2회 + 저축 피해
    assert.ok(second.damage > stored); assert.equal(s(user).sheathDamage, 0); assert.ok(s(user).dots.comboBleed);
    hit(user, { comboHitCount: 4 }); hit(user, { comboHitCount: 3 });
    assert.ok(s(user).meterReady); assert.ok(s(user).ruptureReady);
    const result = hit(user); assert.ok(result.criticalCount > 0); assert.equal(s(user).meterReady, false);
});

test('세 번째 균열은 프리즘이며 다음 직접 공격에만 방어력 50% 무시를 부여한다', () => {
    const user = fresh('comboRupture'), stats = rpg.calculateUserStats(user);
    assert.equal(corridor.AUGMENTS.find(a => a.id === 'comboRupture').rarity, 'prismatic');
    s(user).ruptureReady = true;
    const extra = { isBasic: true }; mechanics.prepareAttack(user, stats, extra);
    assert.equal(extra.defReductionBonus, .5);
    const next = { isBasic: true }; mechanics.prepareAttack(user, stats, next);
    assert.equal(next.defReductionBonus, undefined);
});

test('수호자의 걸쇠는 보호막 파괴에 5%만 회복하고 삭제된 월야의 인장은 효과가 없다', async t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh(); user.paradise.relics = ['guardianClasp', 'moonSeal'];
    battle(user); const stats = rpg.calculateUserStats(user);
    assert.equal(shields.summary(user.field, Date.now()).amount, Math.round(stats.hp * .1));
    resources(user).hp = 1; shields.absorb(user.field, 1e12);
    mechanics.onDamage(user, stats, 10, 0, 10, {});
    assert.equal(resources(user).hp, 1 + Math.round(stats.hp * .05));
    const hp = resources(user).hp; mechanics.onDamage(user, stats, 10, 0, 10, {});
    assert.equal(resources(user).hp, hp);
    await skill(user, '유드 알레프');
    assert.equal(shields.summary(user.field, Date.now()).amount, 0);
    assert.ok(!s(user).moonStrike);
    assert.ok(!corridor.view(user).run.relics.some(r => r.id === 'moonSeal'));
});

test('스킬 연격도 집계하고 고정 다단 타격은 연격 계약에 넣지 않는다', t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh('comboRelay', 'comboWard', 'comboEscrow', 'comboBalance');
    user.paradise.acquired.comboJackpot = 1;
    resources(user).hp = 100; resources(user).mp = 0;
    user.field.skillCooldowns['자인'] = Date.now() + 60000;
    const until = user.field.skillCooldowns['자인'];
    hit(user, { isBasic: false, isSkill: true, hitCount: 9 });
    assert.equal(s(user).comboHits, 0); assert.equal(user.field.skillCooldowns['자인'], until);
    hit(user); assert.ok(resources(user).hp > 100);
    for (let i = 0; i < 3; i++) hit(user, { isBasic: false, isSkill: true, comboHitCount: 3 });
    assert.equal(s(user).comboHits, 6); assert.equal(user.field.skillCooldowns['자인'], until - 3000);
    assert.ok(shields.summary(user.field, Date.now()).amount > 0); assert.ok(resources(user).mp > 0);
    assert.ok(s(user).freeAny); assert.equal(user.paradise.relics.length, 0);
});

test('보호막 소모 공격과 파괴 반격·재사용 효과를 실제 피격에 적용한다', t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh('shedArmor', 'glassBastion', 'shieldCooldown'), stats = rpg.calculateUserStats(user);
    user.field.shieldLayers = []; grantShield(user, 100);
    const attack = hit(user); assert.ok(attack.damage >= 50); assert.equal(shields.summary(user.field, Date.now()).amount, 75);
    user.field.skillCooldowns['자인'] = Date.now() + 60000;
    user.paradise.enemy.atk = stats.def * 5 + 500;
    user.field.nextEnemyAttackAt = Date.now(); rpg.advanceParadiseCombat(user); assert.ok(s(user).glassReady); assert.ok(user.field.skillCooldowns['자인'] <= Date.now());
    user.paradise.enemy.atk = 0;
    assert.ok(hit(user).criticalCount > 0);
});

test('보호막 흡수로 마나·반사 지속 피해·무효화를 얻고 잔여 보호막을 다음 전투로 가져간다', () => {
    const user = fresh('shieldBattery', 'mirrorAegis', 'shieldThorns', 'wardRelay', 'bastionPact'), stats = rpg.calculateUserStats(user);
    resources(user).mp = 0;
    for (let i = 0; i < 3; i++) mechanics.onDamage(user, stats, stats.hp * .10, 0, stats.hp, {});
    assert.ok(resources(user).mp > 0); assert.ok(s(user).dots.thorns);
    assert.equal(mechanics.incomingMultiplier(user), 0); assert.equal(mechanics.incomingMultiplier(user), 1);
    grantShield(user, 500); mechanics.onVictory(user);
    assert.equal(user.paradise.mechanics.carriedWard, 250); assert.equal(user.paradise.effects.reward, .02);
    battle(user); assert.equal(shields.summary(user.field, Date.now()).amount, 250);
});

test('보호막 꽃·피격 보호막·비상 탈출의 전투별 한도를 지킨다', () => {
    const user = fresh('barrierBloom', 'shieldStitch', 'emergencyExit', 'skillBulwark'), stats = rpg.calculateUserStats(user);
    grantShield(user, 100); hit(user); hit(user); hit(user);
    assert.ok(shields.summary(user.field, Date.now()).amount >= 100 + Math.round(stats.hp * .20));
    resources(user).hp = stats.hp * .20; user.field.skillCooldowns['유리 방벽'] = Date.now() + 50000;
    for (let i = 0; i < 4; i++) mechanics.onDamage(user, stats, 0, 5, 0, {});
    assert.equal(s(user).stitches, 3); assert.ok(s(user).secondWind); assert.ok(user.field.skillCooldowns['유리 방벽'] <= Date.now());
});

test('보호막 금지 장비는 시작 보호막과 습득한 보호막 스킬에도 적용한다', async () => {
    const user = fresh('glassBastion', 'skillBulwark');
    const slot = Object.keys(data.Equipment).find(key => data.Equipment[key].some(item => item.name === '콰트로 1악장'));
    assert.ok(slot);
    user.equipments[slot] = { id: data.Equipment[slot].findIndex(item => item.name === '콰트로 1악장'), level: 0 };
    battle(user);
    assert.equal(rpg.calculateUserStats(user).disableShield, 1);
    assert.equal(shields.summary(user.field, Date.now()).amount, 0);
    await skill(user, '유리 방벽');
    assert.equal(shields.summary(user.field, Date.now()).amount, 0);
});

test('전직과 스펙터 궁극기에 서곡·커튼콜·배당·공백·수확을 적용한다', async () => {
    const user = fresh('ultimateOverture', 'ultimateEncore', 'ultimateDividend', 'ultimateHourglass', 'ultimateHarvest', 'skillIgnition');
    user.main_card.specter = '빅뱅 스펙터';
    user.field.skillCooldowns['자인'] = Date.now() + 60000;
    mechanics.addDot(user, 'harvest', '수확', 100, 3);
    await skill(user, '유드 알레프');
    assert.equal(mechanics.dots(user).length, 0); assert.ok(s(user).harvest >= 300);
    assert.ok(s(user).freeNormal); assert.ok(user.field.skillCooldowns['자인'] <= Date.now() + 10000);
    const remaining = user.field.skillCooldowns['유드 알레프'] - Date.now();
    hit(user); assert.ok(user.field.skillCooldowns['유드 알레프'] - Date.now() < remaining * .92);
    for (let i = 0; i < 4; i++) {
        resources(user).mp = rpg.calculateUserStats(user).mp;
        await skill(user, '빅뱅');
    }
    assert.equal(user.paradise.contracts.filter(c => c.star === 7).length, 1);
});

test('대단원의 배당은 재접속·다음 전투·계약 상실 후에도 탐험당 3장까지만 지급하고 회복은 계속한다', async t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh('ultimateDividend'); user.main_card.specter = '빅뱅 스펙터';
    const stats = rpg.calculateUserStats(user);
    for (let i = 1; i <= 20; i++) {
        resources(user).mp = stats.mp; resources(user).hp = 1;
        await skill(user, i % 2 ? '유드 알레프' : '빅뱅');
        assert.equal(user.paradise.contracts.length, Math.min(3, Math.floor(i / 5)) - (i > 15 ? 1 : 0));
        if (i % 5 === 0) assert.equal(resources(user).hp, Math.min(stats.hp, 1 + Math.round(stats.hp * .20)));
        if (i === 10) { user.paradise = structuredClone(user.paradise); battle(user); }
        if (i === 15) user.paradise.contracts.pop();
    }
    assert.equal(user.paradise.mechanics.ultimatePrizes, 3);
    assert.ok(user.paradise.contracts.every(c => c.star === 7));
    assert.match(corridor.AUGMENTS.find(a => a.id === 'ultimateDividend').desc, /최대 3장/);
    // 패치 전 지급분도 한도에 포함하되 이미 획득한 8성 카드의 등급은 보존한다.
    user.paradise.contracts = Array.from({ length: 3 }, () => ({ star: 8, type: '일반', name: '대단원의 배당 · 8성 일반 카드' }));
    user.paradise.mechanics.ultimateUses = 24; delete user.paradise.mechanics.ultimatePrizes;
    resources(user).mp = stats.mp; await skill(user, '빅뱅');
    assert.equal(user.paradise.contracts.length, 3); assert.equal(user.paradise.mechanics.ultimatePrizes, 3);
    assert.ok(user.paradise.contracts.every(c => c.star === 8));
    const next = fresh('ultimateDividend');
    for (let i = 0; i < 5; i++) { resources(next).mp = rpg.calculateUserStats(next).mp; await skill(next, '유드 알레프'); }
    assert.equal(next.paradise.contracts.length, 1, '다음 탐험에는 새 한도 적용');
});

test('신규 스킬 10개를 실제로 사용하고 미보유·쿨타임·스킬 봉인·탐험 밖 사용을 막는다', async t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh(...catalog.filter(a => a.category === 'active').map(a => a.id));
    assert.equal(mechanics.skillView(user).length, 10);
    await skill(user, '도화선 점화'); assert.ok(s(user).dots.ignition);
    const consumed = mechanics.dots(user).reduce((sum, d) => sum + d.damage * d.ticks, 0);
    await skill(user, '응혈 폭발'); assert.equal(mechanics.dots(user).length, 0); assert.ok(user.paradise.combatEvents.at(-1).damage >= consumed * .98);
    await skill(user, '유리 방벽'); assert.ok(shields.summary(user.field, Date.now()).amount > 0);
    await skill(user, '그림자 연무'); assert.equal(user.paradise.combatEvents.at(-1).hits.length, 3);
    await skill(user, '시간 접기'); const result = await skill(user, '판돈 뒤집기'); assert.match(result, /실패/);
    user.field.nextActionAt = 0; assert.match(await rpg.useSkillInField(user, '판돈 뒤집기'), /쿨타임/);
    delete user.paradise.acquired.skillDoubleDown; assert.match(await rpg.useSkillInField(user, '판돈 뒤집기'), /없는 스킬/);
    user.main_card.id = 11; user.paradise.acquired.solitaryIktae = 1;
    assert.match(await rpg.useSkillInField(user, '도화선 점화'), /봉인/);
    user.paradise.status = 'ended'; assert.deepEqual(mechanics.skills(user), []);
});

test('새 스킬에도 정신력·무료 사용·혈액 대출 비용을 한 번만 적용한다', async () => {
    const user = fresh('skillIgnition', 'bloodMana', 'comboEscrow');
    const stats = rpg.calculateUserStats(user); resources(user).mp = 0;
    const hp = resources(user).hp; await skill(user, '도화선 점화');
    assert.equal(resources(user).mp, 0); assert.equal(hp - resources(user).hp, Math.ceil(stats.mp * .08) * 2);
    s(user).freeAny = true; const hp2 = resources(user).hp;
    await skill(user, '도화선 점화'); assert.equal(resources(user).hp, hp2); assert.equal(s(user).freeAny, false);
    resources(user).hp = 1; assert.match(await (user.field.nextActionAt = 0, delete user.field.skillCooldowns['도화선 점화'], rpg.useSkillInField(user, '도화선 점화')), /MP가 부족/);
    user.main_card = { id: 16, star: 9, type: '전직' }; battle(user);
    rpg.calculateUserStats(user); s(user).freeAny = true;
    await skill(user, '도화선 점화'); assert.equal(user.paradise.combatEvents.at(-1).skillName, '도화선 점화');
});

test('왈츠·빈손·동전·약탈 패시브의 발동 순서와 결과를 전달한다', t => {
    const random = t.mock.method(Math, 'random', () => .99);
    const user = fresh('alternatingWaltz', 'emptyHands', 'loadedCoin', 'memoryTheft');
    resources(user).mp = 0; hit(user); assert.ok(resources(user).mp > 0);
    hit(user, { isBasic: false, isSkill: true }); hit(user); assert.ok(s(user).waltzReady);
    resources(user).hp = 100; hit(user); assert.ok(resources(user).hp > 100); assert.match(user.paradise.combatLog.join('\n'), /동전.*실패/);
    random.mock.mockImplementation(() => 0);
    for (let i = 0; i < 4; i++) hit(user);
    assert.match(user.paradise.combatLog.join('\n'), /동전.*성공/);
    user.paradise.enemy.hp = 510; user.paradise.enemy.maxHp = 1000; user.paradise.enemy.atk = 23;
    hit(user); assert.equal(s(user).stolenAttack, 23); assert.equal(s(user).stolenHits, 3);
});

test('삼색·첫 주문·삼중 서약은 유지하며 삭제된 세 빛의 수집가는 발동하지 않는다', async t => {
    t.mock.method(Math, 'random', () => 0);
    const user = fresh('spellTriad', 'firstSpellMemory', 'threefoldPact', 'dotCritical', 'skillIgnition', 'skillBulwark');
    user.paradise.acquired.collectorTrinity = 1;
    await skill(user, '자인'); await skill(user, '도화선 점화'); await skill(user, '유리 방벽');
    assert.equal(s(user).triadReady, '유리 방벽');
    hit(user); assert.ok(user.field.skillCooldowns['유리 방벽'] <= Date.now());
    hit(user); hit(user); assert.equal(s(user).freeNamed, '자인');
    assert.ok(user.field.skillCooldowns['자인'] <= Date.now());
    dot(user); assert.equal(user.paradise.relics.length, 0);
    mechanics.onVictory(user); assert.equal(user.paradise.effects.reward, .03);
});

test('새 유물의 첫 스킬 보호막·두 스킬 후 평타 배율은 실제 전투와 전투별 한도를 따른다', async t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh('skillIgnition'), stats = rpg.calculateUserStats(user);
    corridor.grantRelic(user, 'starlightSpool'); corridor.grantRelic(user, 'echoBell');
    await skill(user, '도화선 점화');
    const amount = Math.round(stats.hp * .22 * (1 + Number(stats.shieldEfficiency || 0)));
    assert.equal(shields.summary(user.field, Date.now()).amount, amount);
    shields.absorb(user.field, amount / 2);
    await skill(user, '도화선 점화');
    assert.equal(shields.summary(user.field, Date.now()).amount, amount / 2);
    assert.equal(user.paradise.battle.echoBellReady, true);
    dot(user); assert.equal(user.paradise.battle.echoBellReady, true);
    const doubled = hit(user).damage, plain = hit(user).damage;
    assert.equal(doubled, Math.round(plain * 2)); assert.equal(user.paradise.battle.echoBellReady, false);
    battle(user); await skill(user, '도화선 점화');
    assert.equal(shields.summary(user.field, Date.now()).amount, amount);
    const slot = Object.keys(data.Equipment).find(key => data.Equipment[key].some(item => item.name === '콰트로 1악장'));
    user.equipments[slot] = { id: data.Equipment[slot].findIndex(item => item.name === '콰트로 1악장'), level: 0 };
    battle(user); await skill(user, '도화선 점화');
    assert.equal(shields.summary(user.field, Date.now()).amount, 0);
});

test('소리굽쇠는 전직·스펙터 궁극기 후 일반 공격 한 번에만 방어력을 무시한다', async t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh(); corridor.grantRelic(user, 'tuningFork'); user.main_card.specter = '빅뱅 스펙터';
    for (const name of ['유드 알레프', '빅뱅']) {
        battle(user); user.paradise.enemy.def = 10000;
        const defended = hit(user).damage;
        await skill(user, name);
        assert.equal(user.paradise.battle.tuningForkReady, true);
        dot(user); assert.equal(user.paradise.battle.tuningForkReady, true);
        const pierced = hit(user).damage;
        assert.ok(pierced > defended); assert.equal(user.paradise.battle.tuningForkReady, false);
        assert.equal(hit(user).damage, defended);
    }
});

test('향로·등불은 획득 이후 2승마다 발동하고 회복 봉쇄·시간 회복 60초 한도를 따른다', t => {
    const user = fresh(); user.paradise.battlesWon = 2;
    corridor.grantRelic(user, 'meditationCenser'); corridor.grantRelic(user, 'returnLantern');
    let now = Date.now(); t.mock.method(Date, 'now', () => now);
    user.paradise.clock = { remainingMs: 600000, limitMs: corridor.TIME_LIMIT_MS, updatedAt: now, paused: false };
    const stats = rpg.calculateUserStats(user);
    resources(user).hp = resources(user).mp = 1;
    for (let i = 1; i <= 21; i++) {
        now += 1000; corridor.victory(user, () => .99);
        if (i === 1) assert.deepEqual([resources(user).hp, resources(user).mp], [1, 1]);
        if (i === 2) {
            assert.equal(resources(user).hp, 1 + Math.round(stats.hp * .10));
            assert.equal(resources(user).mp, 1 + Math.round(stats.mp * .10));
            assert.equal(corridor.remainingTime(user.paradise), 608000);
            user.paradise.effects.noHealing = 1; resources(user).hp = resources(user).mp = 1;
        }
        if (i >= 4) assert.deepEqual([resources(user).hp, resources(user).mp], [1, 1]);
        if (i < 21) battle(user);
    }
    assert.equal(user.paradise.relicState.timeRestored, 60000);
    assert.equal(corridor.remainingTime(user.paradise), 639000);
});

test('룬 깃펜은 서로 다른 일반·습득 스킬로 3승마다 6성 계약을 최대 2장 주며 궁극기는 제외한다', async t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh('skillIgnition', 'skillBulwark'); corridor.grantRelic(user, 'runeQuill');
    for (let i = 0; i < 10; i++) {
        battle(user);
        resources(user).mp = rpg.calculateUserStats(user).mp;
        await skill(user, '유드 알레프'); await skill(user, '도화선 점화'); await skill(user, '도화선 점화');
        assert.equal(user.paradise.battle.quillSkills.length, 1);
        if (i > 0) { await skill(user, '자인'); await skill(user, '유리 방벽'); }
        corridor.victory(user, () => .99);
        assert.equal(user.paradise.contracts.filter(c => c.star === 6 && c.type === '일반').length, Math.min(Math.floor(i / 3), 2));
    }
});

test('탐험 시간이 끝나면 자동 피해·거울 행동·일반 공격·스킬보다 귀환 정산을 우선한다', async () => {
    for (const action of ['basic', 'skill']) {
        const user = fresh('skillIgnition');
        user.paradise.clock.updatedAt -= corridor.TIME_LIMIT_MS + 1000;
        const hp = user.paradise.enemy.hp;
        assert.match(rpg.buildHuntResult(user, {}, 1e10, { isBasic: false, dotAttack: true, summonAttack: true }), /제한 시간/);
        assert.equal(user.paradise.enemy.hp, hp);
        assert.equal(rpg.advanceParadiseMirror(user), false);
        const message = action === 'basic' ? await rpg.useBasicAttackInField(user) : await rpg.useSkillInField(user, '도화선 점화');
        assert.match(message, /자동 귀환/);
        assert.equal(user.paradise.outcome, 'timedOut'); assert.equal(user.paradise.claimed, true);
        assert.equal(user.paradise.enemy.hp, hp); assert.equal(user.field, null);
        assert.deepEqual([user.hp, user.mp], [19, 7]);
    }
});

test('도파민 중독은 확정 치명타도 20%로 고정하고 직접 적중에만 보상을 최대 30%p 지급한다', t => {
    const random = t.mock.method(Math, 'random', () => .199);
    const user = fresh('dopamineAddiction', 'dotCritical'), stats = rpg.calculateUserStats(user);
    assert.equal(stats.crit, .20);
    assert.equal(rpg.applyCriticalDamage(100, stats, { forceCritical: true }).isCritical, true);
    random.mock.mockImplementation(() => .20);
    assert.equal(rpg.applyCriticalDamage(100, stats, { forceCritical: true, critChanceBonus: 100 }).isCritical, false);
    random.mock.mockImplementation(() => 0);
    dot(user); hit(user, { summonAttack: true });
    assert.equal(user.paradise.effects.reward, undefined);
    hit(user, { comboHitCount: 3 });
    assert.equal(user.paradise.mechanics.dopamineAddiction, .09);
    assert.ok(!user.paradise.rewardReveal, '치명타마다 전투를 가리는 정산 창을 띄우지 않는다');
    assert.match(user.paradise.combatLog.join('\n'), /도파민 중독.*9%p/);
    for (let i = 0; i < 20; i++) hit(user);
    assert.equal(user.paradise.mechanics.dopamineAddiction, .30);
    assert.ok(Math.abs(user.paradise.effects.reward - .30) < 1e-9);
    user.paradise.status = 'ended';
    assert.equal(rpg.calculateUserStats(user).fixedCriticalChance, undefined);
});

test('새 지속 피해 증강은 고통을 다음 전투로 옮기고 3틱 평타 강화·8틱 초기화를 연계한다', t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh('bottledAgony', 'feverPitch', 'dotSabbatical');
    mechanics.addDot(user, 'test', '고통', 100, 4);
    hit(user, { isBasic: false, isSkill: true });
    assert.equal(user.paradise.mechanics.bottledDamage, 300); assert.equal(mechanics.dots(user).length, 0);
    battle(user);
    assert.equal(s(user).dots.bottledAgony.damage, 75); assert.equal(user.paradise.mechanics.bottledDamage, undefined);
    const baseline = hit(user).damage;
    for (let i = 0; i < 3; i++) dot(user);
    const stored = s(user).feverDamage;
    assert.ok(stored > 0); assert.equal(hit(user).damage, baseline + stored); assert.equal(s(user).feverDamage, 0);
    user.field.skillCooldowns['자인'] = user.field.skillCooldowns['유드 알레프'] = Date.now() + 60000;
    for (let i = 3; i < 8; i++) dot(user);
    assert.ok(user.field.skillCooldowns['자인'] <= Date.now());
    assert.ok(user.field.skillCooldowns['유드 알레프'] > Date.now());
    assert.equal(mechanics.incomingMultiplier(user), 0); assert.equal(mechanics.incomingMultiplier(user), 1);
    battle(user); assert.equal(mechanics.dots(user).length, 0);
});

test('검무 순서·연격 저축·룰렛은 다단 히트와 구분하여 다음 스킬과 방어에 사용한다', t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh('comboStaircase', 'comboSavings', 'comboRoulette');
    resources(user).hp = 1;
    assert.equal(hit(user).hits.length, 1);
    assert.equal(hit(user).hits.length, 2); assert.ok(resources(user).hp > 1);
    assert.equal(hit(user).hits.length, 3); assert.equal(s(user).guard, true);
    assert.equal(s(user).savedCombos, 3);
    const empowered = hit(user, { isBasic: false, isSkill: true }).damage;
    assert.equal(s(user).savedCombos, 0);
    const plain = hit(user, { isBasic: false, isSkill: true }).damage;
    assert.equal(empowered, Math.round(plain * 1.75));
    hit(user, { isBasic: false, isSkill: true, hitCount: 9 }); assert.equal(s(user).savedCombos, 0);
    assert.equal(hit(user).hits.length, 1);
});

test('유리 은행은 잔여 보호막을 정산하고 파괴 도화선·두 타 재생은 전투마다 한 번 발동한다', t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh('shieldEscrow', 'shieldFuse', 'shieldReforge'), stats = rpg.calculateUserStats(user);
    grantShield(user, 100);
    user.paradise.enemy.atk = stats.def * 5 + 1000;
    rpg.advanceParadiseCombat(user, user.field.nextEnemyAttackAt);
    assert.equal(s(user).dots.shieldFuse.damage, 50);
    hit(user); assert.equal(shields.summary(user.field, Date.now()).amount, 0);
    hit(user); assert.equal(shields.summary(user.field, Date.now()).amount, Math.round(stats.hp * .40));
    shields.absorb(user.field, 1e9); hit(user); hit(user);
    assert.equal(shields.summary(user.field, Date.now()).amount, 0);
    for (let i = 0; i < 8; i++) { grantShield(user, stats.hp); corridor.victory(user, () => .99); battle(user); }
    assert.equal(user.paradise.mechanics.shieldEscrow, .25);
});

test('궁극기 선불·저수지·마지막 막은 실제 MP 소비·재사용·10초 승리를 판정한다', async t => {
    let now = Date.now(); t.mock.method(Date, 'now', () => now); t.mock.method(Math, 'random', () => .99);
    const user = fresh('ultimateLoan', 'ultimateReservoir', 'ultimateWager');
    const mp = resources(user).mp; await skill(user, '자인');
    const stored = mp - resources(user).mp; assert.equal(s(user).reservoir, stored);
    await skill(user, '유드 알레프');
    assert.equal(user.field.skillCooldowns['유드 알레프'], now);
    assert.equal(shields.summary(user.field, now).amount, Math.round(Math.min(rpg.calculateUserStats(user).hp * .60, stored * 3)));
    await skill(user, '유드 알레프', false);
    const cd = rpg.getUltimateSkills(user)[0].skill.cooltime;
    assert.equal(user.field.skillCooldowns['유드 알레프'] - now, cd * 2);
    now += 10000; corridor.victory(user, () => .99);
    assert.equal(user.paradise.mechanics.ultimateWager, .05);
    battle(user); resources(user).mp = rpg.calculateUserStats(user).mp; await skill(user, '유드 알레프');
    now += 10001; corridor.victory(user, () => .99);
    assert.equal(user.paradise.mechanics.ultimateWager, .05);
});

test('생명 경매·방벽 투척·운명의 당김·내일 훔치기는 실제 자원·쿨타임과 연결한다', async t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh('skillBloodAuction', 'skillWardShatter', 'skillThreadPull', 'skillBorrowedTomorrow');
    const stats = rpg.calculateUserStats(user), hp = resources(user).hp;
    resources(user).mp = 0; await skill(user, '생명 경매');
    assert.equal(resources(user).hp, hp - Math.floor(hp * .15));
    assert.equal(resources(user).mp, Math.round(stats.mp * .25));
    assert.equal(mechanics.skillView(user).find(s => s.name === '방벽 투척').disabledReason, '보호막 없음');
    grantShield(user, 500); await skill(user, '방벽 투척');
    assert.equal(shields.summary(user.field, Date.now()).amount, 0);
    assert.ok(user.paradise.combatEvents.at(-1).damage >= 980); assert.equal(s(user).guard, true);
    await skill(user, '운명의 당김');
    assert.equal(hit(user).hits.length, 2 + Number(stats.maxCmb || 0));
    const mp = resources(user).mp; await skill(user, '자인'); assert.equal(resources(user).mp, mp);
    user.field.skillCooldowns['자인'] = Date.now() + 1e6;
    user.field.skillCooldowns['유드 알레프'] = Date.now() + 2e6;
    await skill(user, '내일 훔치기');
    assert.ok(user.field.skillCooldowns['자인'] <= Date.now());
    assert.ok(user.field.skillCooldowns['유드 알레프'] > Date.now());
    assert.equal(user.paradise.distortion, 5);
});

test('자비·영수증·마지막 티켓은 직접 공격과 승리 조건을 판정하고 계약 한도를 지킨다', async t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh('mercyLedger', 'secondReceipt', 'lastTicket', 'skillIgnition');
    resources(user).hp = 1;
    for (let i = 0; i < 4; i++) hit(user);
    dot(user); assert.equal(resources(user).hp, 1);
    hit(user); assert.ok(resources(user).hp > 1); assert.equal(s(user).guard, true);
    for (let i = 0; i < 12; i++) {
        battle(user); resources(user).mp = rpg.calculateUserStats(user).mp;
        await skill(user, '자인'); await skill(user, '도화선 점화');
        if (i > 0) user.paradise.battle.hasTakenHpDamage = true;
        resources(user).hp = 1; corridor.victory(user, () => .99);
        assert.equal(user.paradise.contracts.filter(c => c.name.startsWith('두 번째 영수증')).length, Math.min(2, Math.floor(i / 5)));
        assert.equal(user.paradise.contracts.filter(c => c.name.startsWith('마지막 티켓')).length, Math.min(2, i + 1));
    }
    assert.equal(user.paradise.contracts.filter(c => c.star === 7 && c.type === '각성').length, 2);
    assert.equal(user.paradise.contracts.filter(c => c.star === 7 && c.type === '일반').length, 2);
});

test('찰나의 소매치기는 피격 후 1.5초 이내에만 적 주기를 늦추며 공격마다 한 번 발동한다', async t => {
    let now = Date.now(); t.mock.method(Date, 'now', () => now); t.mock.method(Math, 'random', () => .99);
    const user = fresh('pilferTurn', 'skillBloodAuction');
    user.paradise.enemy.atk = 100;
    now += 3500; rpg.advanceParadiseCombat(user);
    const next = user.field.nextEnemyAttackAt;
    now += 1500; await skill(user, '생명 경매');
    assert.equal(user.field.nextEnemyAttackAt, next + 2000);
    await skill(user, '생명 경매'); assert.equal(user.field.nextEnemyAttackAt, next + 2000);
    now = next + 2000; rpg.advanceParadiseCombat(user);
    const unchanged = user.field.nextEnemyAttackAt;
    now += 1501; await skill(user, '생명 경매'); assert.equal(user.field.nextEnemyAttackAt, unchanged);
});

test('신규 유물은 등급별 효과를 적용하고 특수 유물은 일반 추첨에서 제외한다', async t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh();
    for (let i = 0; i < 50; i++) corridor.grantRelic(user, null, () => .99);
    assert.ok(user.paradise.relics.every(id => !corridor.RELICS.find(r => r.id === id).special));
    assert.equal(corridor.RELICS.length, 60);
    assert.deepEqual(new Set(corridor.RELICS.map(r => r.rarityLabel)), new Set(['일반', '고급', '특수']));
    user.paradise.relics = ['guardianClasp', 'hunterBadge', 'emberSeed', 'alchemistFlask', 'duelGlove', 'oracleLens'];
    battle(user); const stats = rpg.calculateUserStats(user);
    assert.equal(shields.summary(user.field, Date.now()).amount, Math.round(stats.hp * .10));
    const first = hit(user); assert.equal(first.hits.length, 3); assert.equal(first.criticalCount, 1);
    assert.equal(s(user).dots.emberSeed.damage, Math.round(stats.atk * .72));
    resources(user).mp = 1;
    for (let i = 0; i < 5; i++) dot(user);
    assert.equal(resources(user).mp, 1, '저장본에 증류병이 남아 있어도 발동하지 않음');
    assert.equal(shields.summary(user.field, Date.now()).amount, Math.round(stats.hp * .10));
    assert.ok(!corridor.view(user).run.relics.some(r => !r.id || r.id === 'alchemistFlask'));
    shields.absorb(user.field, 1e12); user.paradise.enemy.atk = stats.def * 5 + 100;
    rpg.advanceParadiseCombat(user, user.field.nextEnemyAttackAt); assert.equal(s(user).duelReady, true);
    const empowered = hit(user).damage, plain = hit(user).damage; assert.equal(empowered, Math.round(plain * 1.25));
    resources(user).mp = stats.mp; const now = Date.now(); await skill(user, '유드 알레프');
    assert.ok(user.field.skillCooldowns['유드 알레프'] - now <= rpg.getUltimateSkills(user)[0].skill.cooltime * .35 + 50);
    assert.equal(s(user).guard, true);
    user.paradise.relics = ['abyssDiadem']; battle(user);
    assert.equal(corridor.survive(user, 0, stats.hp), Math.round(stats.hp * .45));
    assert.equal(resources(user).mp, 0); assert.equal(corridor.survive(user, 0, stats.hp), 0);
});


test('독의 만기일은 새로 부여한 화상을 거두지 않고 기존 화상만 정산한다', async t => {
    let now = Date.now(); t.mock.method(Date, 'now', () => now); t.mock.method(Math, 'random', () => .99);
    const user = fresh('venomDetonator');
    user.equipments.hat = { id: data.Equipment.hat.findIndex(e => e.name === '잿불 모자'), level: 0, transcendStage: 1 };
    await skill(user, '자인');
    const burn = user.field.equipmentState.burn;
    assert.ok(burn && burn.nextTickAt > now, '첫 스킬이 부여한 화상을 유지해야 한다');
    assert.ok(!user.paradise.combatEvents.at(-1).hits.some(h => h.label === '독의 만기일'));
    now += 2000; assert.ok(mechanics.dots(user).some(d => d.key === 'burn'));
    const oldTotal = mechanics.dots(user).reduce((sum, d) => sum + d.damage * d.ticks, 0);
    await skill(user, '자인');
    assert.equal(user.field.equipmentState.burn, undefined);
    const fixed = user.paradise.combatEvents.at(-1).hits.find(h => h.label === '독의 만기일');
    assert.equal(fixed.damage, Math.round(oldTotal * .5)); assert.equal(fixed.fixed, true);
    now += 6000;
    await skill(user, '자인');
    assert.ok(user.field.equipmentState.burn, '내부 쿨타임 후 새 화상이 다시 발생해야 한다');
    const previous = user.field.equipmentState.burn;
    now += 6000; await skill(user, '자인');
    assert.ok(user.field.equipmentState.burn && user.field.equipmentState.burn !== previous, '같은 공격에서 갱신한 화상은 남겨야 한다');
    assert.ok(user.paradise.combatEvents.at(-1).hits.some(h => h.label === '독의 만기일'));
});

test('독의 만기일은 다른 증강이나 스킬이 이미 소비한 지속 피해를 중복 정산하지 않는다', async t => {
    t.mock.method(Math, 'random', () => .99);
    for (const other of ['bottledAgony', 'skillRupture']) {
        const user = fresh('venomDetonator', other);
        mechanics.addDot(user, 'test', '지속 피해', 100, 4);
        await skill(user, other === 'skillRupture' ? '응혈 폭발' : '자인');
        assert.ok(!user.paradise.combatEvents.at(-1).hits.some(h => h.label === '독의 만기일'), other);
        assert.equal(mechanics.dots(user).length, 0);
    }
});
