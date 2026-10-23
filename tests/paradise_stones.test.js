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
const rpg = require('../rpgenius'), corridor = require('../paradise'), stones = require('../paradise_stones');
const catalog = require('../paradise_augments_stones'), shields = require('../combat_shields');
const name = 'paradise-stones-test';
before(() => rpg.initRpgeniusData());
afterEach(() => rpg.clearFieldRuntimeTimers(name));
function fresh(...ids) {
    rpg.clearFieldRuntimeTimers(name);
    const user = new rpg.RPGUser(name, name);
    user.level = 300; user.main_card = { id: 0, star: 9, type: '전직' }; user.need_character_card_select = false;
    rpg.addInventoryItem(user, data.Item.length - 1, 1);
    assert.equal(corridor.enter(user, () => .99).error, undefined);
    for (const id of ['stoneThrow', ...ids]) user.paradise.acquired[id] = 1;
    battle(user);
    return user;
}
function battle(user) {
    corridor.startCombat(user, 'normal', null, () => .99);
    Object.assign(user.paradise.enemy, { hp: 1e12, maxHp: 1e12, atk: 0, def: 0, pnt: 0, crit: 0, cmb: 0 });
}
function s(user) { return user.paradise.battle.stones; }
function event(user) { return user.paradise.combatEvents.at(-1); }
function labels(user) { return event(user).hits.map(hit => hit.label || '').join(','); }
async function cast(user, reset = true) {
    if (reset) { user.field.nextActionAt = 0; delete user.field.skillCooldowns[stones.NAME]; }
    const text = await rpg.useSkillInField(user, stones.NAME);
    assert.ok(!text.startsWith('❌'), text);
    return text;
}
function basic(user, extra = {}) {
    rpg.buildHuntResult(user, {}, 100, { isBasic: true, comboHitCount: 1, ...extra });
    return event(user);
}
function absorb(user, amount) {
    const stats = rpg.calculateUserStats(user), before = shields.summary(user.field, Date.now()).amount;
    shields.expire(user.field, Date.now()); const result = shields.absorb(user.field, amount);
    corridor.getResources(user).hp = Math.max(1, corridor.getResources(user).hp - result.damage);
    stones.onDamage(user, stats, result.absorbed, result.damage, before, {});
}

test('돌 트리는 시작 하나와 후속 108개이며 모든 선행과 택일 조건이 실제 노드를 가리킨다', () => {
    assert.equal(catalog.length, 109); assert.equal(new Set(catalog.map(a => a.id)).size, 109);
    assert.equal(catalog.filter(a => a.isStoneEntry).length, 9);
    for (const [branch] of Object.entries(catalog.BRANCHES)) if (branch !== 'shared') assert.equal(catalog.filter(a => a.stoneBranch === branch).length, 10);
    for (const choice of catalog) {
        assert.ok(choice.desc.endsWith('니다.'), choice.id);
        assert.ok(['silver', 'gold', 'prismatic'].includes(choice.rarity));
        for (const id of [...choice.stoneRequires, ...(choice.stoneExcludes || [])]) assert.ok(catalog.some(a => a.id === id), id);
        assert.ok(choice.stoneRequires.length <= 2, choice.id);
    }
    const user = { paradise: { acquired: {} } };
    assert.ok(stones.eligible(user, catalog[0]));
    assert.ok(catalog.slice(1).every(a => !stones.eligible(user, a)));
    user.paradise.acquired.stoneThrow = 1;
    assert.ok(catalog.filter(a => a.isStoneEntry).every(a => stones.eligible(user, a)));
    user.paradise.acquired.stoneBankShot = 1; user.paradise.acquired.stoneCushion = 1;
    assert.ok(stones.eligible(user, catalog.find(a => a.id === 'stonePinball')));
    user.paradise.acquired.stoneStraightShot = 1;
    assert.equal(stones.eligible(user, catalog.find(a => a.id === 'stonePinball')), false);
});

test('돌은 카드 기본 액티브만 바꾸고 MP 0에서도 사용하며 행동 간격은 유지한다', async t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh(), stats = rpg.calculateUserStats(user);
    assert.equal(stones.cast(user, stats, {}), stats.atk * .10 * (1 + Number(stats.afterSkill || 0) + Number(rpg.calculateCardSlotEffects(user).skillDamageBonus || 0)));
    assert.equal(rpg.getMainCardSkills(user)[0].skill.name, stones.NAME);
    assert.ok(rpg.getUltimateSkills(user).length > 0);
    assert.ok(rpg.getUltimateSkills(user).every(entry => entry.skill.name !== stones.NAME));
    corridor.getResources(user).mp = 0;
    await cast(user); assert.equal(corridor.getResources(user).mp, 0);
    assert.ok(user.field.skillCooldowns[stones.NAME] > Date.now());
    assert.match(await rpg.useSkillInField(user, stones.NAME), /아직 행동|쿨타임/);
    const casts = s(user).casts; basic(user); assert.equal(s(user).casts, casts);
});

test('입문 도탄은 즉시 세 번 튕기며 도탄은 별도 스킬 사용이나 연격으로 집계하지 않는다', async t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh('stoneBankShot', 'stoneCushion', 'stoneCornerPocket', 'stoneChalk');
    const before = Number(user.paradise.battle.skillsUsed || 0);
    await cast(user); assert.equal(event(user).hits.filter(hit => hit.label?.startsWith('도탄')).length, 4);
    assert.equal(user.paradise.battle.skillsUsed, before + 1); assert.equal(s(user).casts, 1);
    basic(user); assert.equal(s(user).chalk, true);
    await cast(user); assert.equal(s(user).chalk, false);
    await cast(user); assert.ok(event(user).hits.filter(hit => hit.label?.startsWith('도탄')).at(-1).critical);
});

test('첫 번째 일격의 배율은 직접 돌과 도탄에 함께 적용되며 한 번만 소비한다', async t => {
    t.mock.method(Math, 'random', () => .99);
    let user = fresh('stoneBankShot');
    await cast(user); const normal = event(user).damage, normalBounce = event(user).hits.filter(hit => hit.label?.startsWith('도탄')).map(hit => hit.damage);
    user = fresh('stoneBankShot'); user.paradise.effects.firstStrike = true;
    await cast(user);
    assert.equal(event(user).damage, normal * 2);
    assert.deepEqual(event(user).hits.filter(hit => hit.label?.startsWith('도탄')).map(hit => hit.damage), normalBounce.map(damage => damage * 2));
    await cast(user); assert.equal(event(user).damage, normal);
});

test('투석기는 일반 공격으로 장전하고 레일건은 탄창 소비와 최소 6초를 적용한다', async t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh('stonePocket', 'stoneHeavyAmmo', 'stoneRailgun', 'stoneDryFire', 'stoneFuse', 'stoneRecoil');
    assert.equal(s(user).ammo, 2);
    basic(user); basic(user); assert.equal(s(user).ammo, 4);
    await cast(user); assert.equal(s(user).ammo, 0); assert.match(labels(user), /투석 관통탄/);
    assert.ok(user.field.skillCooldowns[stones.NAME] - Date.now() >= 5900);
    assert.ok(s(user).queue.some(item => item.kind === 'fuse'));
    basic(user); assert.match(labels(user), /반동 휘두르기/);
    basic(user); assert.match(labels(user), /불발탄/);
    s(user).ammo = 0; await cast(user); assert.equal(s(user).ammo, 1); assert.match(labels(user), /빈 주머니/);
});

test('돌탑은 돌과 일반 공격의 순서로 무너지고 철거 효과는 재귀 철거하지 않는다', async t => {
    t.mock.method(Math, 'random', () => .10);
    const user = fresh('stoneTower', 'stoneKeystone', 'stoneTowerDice', 'stoneDice', 'stoneTowerGuard', 'stoneGuard', 'stoneQuake');
    assert.equal(s(user).tower, 2);
    await cast(user); assert.equal(s(user).tower, 3);
    basic(user); assert.match(labels(user), /돌탑 붕괴/); assert.match(labels(user), /층간 소음/);
    assert.equal(s(user).tower, 3);
    assert.equal(event(user).hits.filter(hit => hit.label === '돌탑 붕괴').length, 1);
    assert.ok(shields.summary(user.field, Date.now()).amount > 0);
});

test('주사위 결과와 잭팟을 즉시 알려주며 카지노 정산은 탐험 한도를 넘지 않는다', async t => {
    t.mock.method(Math, 'random', () => .99);
    let user = fresh('stoneDice', 'stoneJackpot', 'stoneCashOut');
    assert.match(await cast(user), /주사위 6/);
    assert.match(await cast(user), /주사위 4/);
    assert.match(await cast(user), /육육 잭팟/);
    await cast(user); assert.equal(s(user).jackpot, true);
    user = fresh('stoneDice', 'stoneHouseWins');
    for (let i = 0; i < 72; i++) await cast(user);
    assert.equal(user.paradise.stoneState.stoneHouseWins, .10);
    assert.equal(user.paradise.effects.reward, .10);
    assert.equal(s(user).lastDie, 6);
});

test('원소 돌은 화상과 직접 투사체를 구분하고 화수 증기 및 명암 순서를 유지한다', async t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh('stoneSeasons', 'stoneSteam', 'stoneEmber', 'stoneThunder', 'stoneObsidian');
    await cast(user); assert.equal(s(user).lastElement, '화');
    assert.ok(require('../paradise_mechanics').dots(user).some(dot => dot.key === 'stoneBurn'));
    await cast(user); assert.match(labels(user), /뜨거운 증기/); assert.equal(s(user).lastElement, '수');
    await cast(user); basic(user); assert.match(labels(user), /돌려준 번개/);
    await cast(user); assert.equal(s(user).lastElement, '암'); assert.equal(stones.incomingMultiplier(user), .75);
    await cast(user); assert.match(labels(user), /흑요석의 앙심/);
});

test('위성은 쌓기와 발사 선택을 제공하며 한도를 넘지 않는다', async t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh('stoneOrbit', 'stoneLagrange', 'stoneSolarSystem', 'stoneGravity');
    assert.equal(s(user).orbits, 1);
    for (let i = 0; i < 8; i++) await cast(user);
    assert.equal(s(user).orbits, 5); assert.equal(stones.incomingMultiplier(user), .8);
    basic(user); assert.equal(event(user).hits.filter(hit => hit.label === '돌 위성').length, 5);
    assert.equal(s(user).orbits, 1);
    assert.equal(stones.view(user).find(entry => entry.label === '위성').max, 5);
});

test('발굴은 실제 서로 다른 결과를 주고 보석 및 생중계 보상에는 탐험 상한이 있다', async t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh('stoneDig', 'stoneBrush', 'stoneSurvey', 'stoneGem', 'stoneAmber', 'stoneMuseum');
    for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 6; j++) await cast(user);
        assert.deepEqual(s(user).finds, ['화석', '보석', '호박']);
        assert.ok(s(user).broadcast);
        battle(user);
    }
    assert.equal(user.paradise.stoneState.stoneMuseum, .12);
    for (let j = 0; j < 12; j++) await cast(user);
    assert.equal(user.paradise.stoneState.stoneGem, .10);
    assert.equal(user.paradise.stoneState.stoneMuseum, .12);
    assert.equal(user.paradise.effects.reward, .22);
});

test('두 번 발굴에서 보석과 호박이 중복되어도 두 보상을 모두 얻는다', async t => {
    let roll = .40;
    t.mock.method(Math, 'random', () => roll);
    const user = fresh('stoneDig', 'stoneGoldRush', 'stoneBrush');
    await cast(user); await cast(user); assert.equal(s(user).gem, 6);
    await cast(user); assert.equal(s(user).gem, 0); assert.match(labels(user), /발굴한 보석/);
    roll = .90;
    await cast(user);
    const layers = shields.active(user.field, Date.now()).filter(layer => layer.source.startsWith('paradise:stone:amber'));
    assert.equal(layers.length, 2);
    const stats = rpg.calculateUserStats(user);
    assert.equal(layers.reduce((sum, layer) => sum + layer.amount, 0), 2 * Math.round(stats.hp * .10 * (1 + Number(stats.shieldEfficiency || 0))));
});

test('반격은 실제 보호막 흡수량을 저장하며 골렘은 보호막을 소비하고 다시 발동하지 않는다', async t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh('stoneGuard', 'stoneParry', 'stoneSlingShield', 'stoneGolem', 'stoneSplinter'), stats = rpg.calculateUserStats(user);
    await cast(user); const before = shields.summary(user.field, Date.now()).amount;
    absorb(user, before / 2); assert.ok(s(user).counter >= stats.atk * 2.5);
    const stored = s(user).counter; assert.ok(stored <= stats.atk * 3.5);
    await cast(user); assert.match(labels(user), /골렘의 오른손/); assert.match(labels(user), /돌 반격/);
    assert.equal(s(user).counter, 0);
    const currentWard = shields.summary(user.field, Date.now()).amount;
    absorb(user, currentWard); assert.equal(s(user).splinters, 3);
    await cast(user); assert.match(labels(user), /부서진 방패/); assert.equal(s(user).splinters, 2);
});

test('시간의 돌은 두 번의 직접 행동 뒤 도착하고 지속 피해나 부가 투사체가 시간을 진행시키지 않는다', async t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh('stoneTime', 'stoneTimeBank', 'stoneBankShot');
    await cast(user); assert.equal(s(user).queue.length, 1); assert.equal(s(user).queue[0].remaining, 2);
    basic(user, { isBasic: false, dotAttack: true, summonAttack: true, paradiseDot: true, hitCount: 1 });
    assert.equal(s(user).queue[0].remaining, 2);
    basic(user); assert.equal(s(user).queue[0].remaining, 1); assert.doesNotMatch(labels(user), /시간의 돌/);
    basic(user); assert.equal(s(user).queue.length, 0); assert.match(labels(user), /시간의 돌/); assert.match(labels(user), /과거의 도탄/);
    assert.equal(s(user).casts, 1);
});

test('예약 운석은 세 투사체를 합쳐 한 번 배달하며 JSON 복원 뒤에도 같은 진행도를 보존한다', async t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh('stoneTime', 'stoneDelay', 'stoneMeteorShower');
    await cast(user); await cast(user); await cast(user);
    assert.equal(s(user).queue.length, 1); assert.ok(s(user).queue[0].meteor);
    assert.equal(s(user).queue[0].ratio, 15.75);
    user.paradise = JSON.parse(JSON.stringify(user.paradise));
    basic(user); basic(user); basic(user);
    assert.equal(event(user).hits.filter(hit => hit.label === '예약 운석').length, 1);
    assert.equal(s(user).queue.length, 0);
});

test('계열 연결은 두 기반이 필요하며 발굴 위성과 보호막 장전이 자원을 만든다', async t => {
    t.mock.method(Math, 'random', () => 0);
    const user = fresh('stoneDig', 'stoneOrbit', 'stoneDigOrbit', 'stonePocket', 'stoneGuard', 'stoneGuardSiege');
    const choice = catalog.find(a => a.id === 'stoneDigOrbit');
    assert.ok(stones.eligible(user, choice));
    delete user.paradise.acquired.stoneOrbit; assert.equal(stones.eligible(user, choice), false); user.paradise.acquired.stoneOrbit = 1;
    await cast(user); await cast(user); s(user).orbits = 0;
    await cast(user); assert.equal(s(user).orbits, 3);
    s(user).ammo = 0; absorb(user, 1); assert.equal(s(user).ammo, 1);
});

test('카지노를 보유해도 두 번의 완전 장전 확정 눈금 계약은 먼저 적용한다', async t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh('stonePocket', 'stoneDice', 'stoneHouseWins', 'stoneSiegeDice');
    s(user).ammo = 3; await cast(user); assert.equal(s(user).lastDie, 6);
    s(user).ammo = 3; await cast(user); assert.equal(s(user).lastDie, 6);
    s(user).ammo = 3; await cast(user); assert.equal(s(user).lastDie, 3);
    assert.equal(s(user).siegeRigged, 2);
});

test('돌로 이룬 정산과 과잉 피해는 한도를 지키며 비활성 탐험에는 효과가 없다', async t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh('stoneBankShot', 'stoneOverkill', 'stoneLuckyReceipt');
    for (let i = 0; i < 8; i++) {
        user.paradise.enemy.kind = 'elite';
        await cast(user); await cast(user); await cast(user);
        user.paradise.enemy.hp = 1; await cast(user);
        assert.equal(user.paradise.status, 'active');
        assert.ok(user.paradise.stoneState.carriedDamage <= rpg.calculateUserStats(user).atk * 3);
        battle(user);
    }
    assert.equal(user.paradise.stoneState.stoneLuckyReceipt, .15);
    user.paradise.mode = 'hell';
    assert.equal(stones.skill(user), null); assert.deepEqual(stones.view(user), []); assert.equal(stones.incomingMultiplier(user), 1);
    user.paradise.mode = undefined; user.paradise.phase = 'augment'; assert.equal(stones.skill(user), null);
});
