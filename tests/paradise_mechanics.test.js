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

test('62개 증강의 분류·고유 ID·문체와 궁극기 보유 조건을 확인한다', () => {
    assert.equal(catalog.length, 62);
    assert.deepEqual(Object.fromEntries(['dot', 'combo', 'shield', 'ultimate', 'active', 'passive'].map(key => [key, catalog.filter(a => a.category === key).length])), { dot: 21, combo: 10, shield: 10, ultimate: 5, active: 6, passive: 10 });
    assert.equal(new Set(corridor.AUGMENTS.map(a => a.id)).size, 288);
    for (const augment of catalog) {
        assert.match(augment.desc, /니다\.$/);
        const user = fresh();
        user.paradise.phase = 'augment'; user.paradise.choices = [augment.id];
        assert.ok(!corridor.chooseAugment(user, augment.id, () => .99).error, augment.id);
        assert.ok(!user.paradise.choices.includes(augment.id), '중복 제시 ' + augment.id);
    }
    const user = fresh(); user.main_card.type = '일반';
    assert.equal(rpg.getUltimateSkills(user).length, 0);
    assert.equal(rpg.isUltimateSkillForUser(user, rpg.getMainCardSkills(user).at(-1).skill), false);
    for (const augment of catalog.filter(a => a.requiresUltimate)) {
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
    for (let i = 0; i < 3; i++) {
        user.paradise.enemy.hp = 1; dot(user, 100);
        assert.ok(user.paradise.mechanics.carriedAsh > 0);
        battle(user); assert.ok(s(user).dots.ash);
    }
    assert.equal(user.paradise.contracts.filter(c => c.name.startsWith('장례 보험금')).length, 1);
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

test('스킬 연격도 집계하고 고정 다단 타격은 연격 계약에 넣지 않는다', t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh('comboRelay', 'comboWard', 'comboEscrow', 'comboBalance', 'comboJackpot');
    resources(user).hp = 100; resources(user).mp = 0;
    user.field.skillCooldowns['자인'] = Date.now() + 60000;
    const until = user.field.skillCooldowns['자인'];
    hit(user, { isBasic: false, isSkill: true, hitCount: 9 });
    assert.equal(s(user).comboHits, 0); assert.equal(user.field.skillCooldowns['자인'], until);
    hit(user); assert.ok(resources(user).hp > 100);
    for (let i = 0; i < 3; i++) hit(user, { isBasic: false, isSkill: true, comboHitCount: 3 });
    assert.equal(s(user).comboHits, 6); assert.equal(user.field.skillCooldowns['자인'], until - 3000);
    assert.ok(shields.summary(user.field, Date.now()).amount > 0); assert.ok(resources(user).mp > 0);
    assert.ok(s(user).freeAny); assert.equal(user.paradise.relics.length, 1);
});

test('보호막 소모 공격과 파괴 반격·재사용 효과를 실제 피격에 적용한다', t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh('shedArmor', 'glassBastion', 'shieldCooldown'), stats = rpg.calculateUserStats(user);
    user.field.shieldLayers = []; grantShield(user, 100);
    const attack = hit(user); assert.ok(attack.damage >= 50); assert.equal(shields.summary(user.field, Date.now()).amount, 75);
    user.field.skillCooldowns['자인'] = Date.now() + 60000;
    user.paradise.enemy.atk = stats.def * 5 + 500;
    hit(user); assert.ok(s(user).glassReady); assert.ok(user.field.skillCooldowns['자인'] <= Date.now());
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
    resources(user).mp = rpg.calculateUserStats(user).mp;
    await skill(user, '빅뱅'); resources(user).mp = rpg.calculateUserStats(user).mp;
    await skill(user, '빅뱅');
    assert.equal(user.paradise.contracts.filter(c => c.star === 8).length, 1);
});

test('신규 스킬 6개를 실제로 사용하고 미보유·쿨타임·스킬 봉인·탐험 밖 사용을 막는다', async t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh(...catalog.filter(a => a.category === 'active').map(a => a.id));
    assert.equal(mechanics.skillView(user).length, 6);
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

test('삼색·첫 주문·세 빛 수집·삼중 서약을 실제 기술과 치명타 종류로 완성한다', async t => {
    t.mock.method(Math, 'random', () => 0);
    const user = fresh('spellTriad', 'firstSpellMemory', 'collectorTrinity', 'threefoldPact', 'dotCritical', 'skillIgnition', 'skillBulwark');
    await skill(user, '자인'); await skill(user, '도화선 점화'); await skill(user, '유리 방벽');
    assert.equal(s(user).triadReady, '유리 방벽');
    hit(user); assert.ok(user.field.skillCooldowns['유리 방벽'] <= Date.now());
    hit(user); hit(user); assert.equal(s(user).freeNamed, '자인');
    assert.ok(user.field.skillCooldowns['자인'] <= Date.now());
    dot(user); assert.equal(user.paradise.relics.length, 1);
    mechanics.onVictory(user); assert.equal(user.paradise.effects.reward, .03);
});

test('새 유물의 첫 스킬 보호막·세 스킬 후 평타 배율은 실제 전투와 전투별 한도를 따른다', async t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh('skillIgnition'), stats = rpg.calculateUserStats(user);
    corridor.grantRelic(user, 'starlightSpool'); corridor.grantRelic(user, 'echoBell');
    await skill(user, '도화선 점화');
    const amount = Math.round(stats.hp * .10 * (1 + Number(stats.shieldEfficiency || 0)));
    assert.equal(shields.summary(user.field, Date.now()).amount, amount);
    shields.absorb(user.field, amount / 2);
    await skill(user, '도화선 점화'); await skill(user, '도화선 점화');
    assert.equal(shields.summary(user.field, Date.now()).amount, amount / 2);
    assert.equal(user.paradise.battle.echoBellReady, true);
    dot(user); assert.equal(user.paradise.battle.echoBellReady, true);
    const doubled = hit(user).damage, plain = hit(user).damage;
    assert.equal(doubled, plain * 2); assert.equal(user.paradise.battle.echoBellReady, false);
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

test('향로·등불은 획득 이후 3승마다 발동하고 회복 봉쇄·시간 회복 2분 한도를 따른다', t => {
    const user = fresh(); user.paradise.battlesWon = 2;
    corridor.grantRelic(user, 'meditationCenser'); corridor.grantRelic(user, 'returnLantern');
    let now = Date.now(); t.mock.method(Date, 'now', () => now);
    user.paradise.clock = { remainingMs: 600000, updatedAt: now, paused: false };
    const stats = rpg.calculateUserStats(user);
    resources(user).hp = resources(user).mp = 1;
    for (let i = 1; i <= 21; i++) {
        now += 1000; corridor.victory(user, () => .99);
        if (i === 2) assert.deepEqual([resources(user).hp, resources(user).mp], [1, 1]);
        if (i === 3) {
            assert.equal(resources(user).hp, 1 + Math.round(stats.hp * .20));
            assert.equal(resources(user).mp, 1 + Math.round(stats.mp * .20));
            assert.equal(corridor.remainingTime(user.paradise), 617000);
            user.paradise.effects.noHealing = 1; resources(user).hp = resources(user).mp = 1;
        }
        if (i >= 6) assert.deepEqual([resources(user).hp, resources(user).mp], [1, 1]);
        if (i < 21) battle(user);
    }
    assert.equal(user.paradise.relicState.timeRestored, 120000);
    assert.equal(corridor.remainingTime(user.paradise), 699000);
});

test('룬 깃펜은 서로 다른 일반·습득 스킬을 요구하고 궁극기를 제외하며 카드 계약은 최대 2회 준다', async t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh('skillIgnition', 'skillBulwark'); corridor.grantRelic(user, 'runeQuill');
    for (let i = 0; i < 4; i++) {
        battle(user);
        resources(user).mp = rpg.calculateUserStats(user).mp;
        await skill(user, '유드 알레프'); await skill(user, '도화선 점화'); await skill(user, '도화선 점화');
        assert.equal(user.paradise.battle.quillSkills.length, 1);
        if (i > 0) { await skill(user, '자인'); await skill(user, '유리 방벽'); }
        corridor.victory(user, () => .99);
        assert.equal(user.paradise.contracts.filter(c => c.star === 7 && c.type === '일반').length, Math.min(i, 2));
    }
    assert.match(user.paradise.rewardReveal.text, /룬 깃펜.*7성 일반/);
});

test('탐험 시간이 끝나면 자동 피해·거울 행동·일반 공격·스킬보다 귀환 정산을 우선한다', async () => {
    for (const action of ['basic', 'skill']) {
        const user = fresh('skillIgnition');
        user.paradise.clock.updatedAt -= 1000000;
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
