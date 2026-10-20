const { test, before, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const AWS = require('aws-sdk');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const data = {};
for (const key of ['Item', 'Equipment', 'Bundle', 'Recipe', 'Pack']) data[key] = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'DB/RPGenius', key + '.json'), 'utf8'));
data.Item.push({ type: '티켓', name: '천상의 회랑 입장권' });
data.Paradise = { enabled: true, baseRewards: [] };
// 기존 회랑 테스트와 같은 로컬 데이터 경계. 모든 운영 DB 쓰기는 실패시킨다.
AWS.S3.prototype.makeRequest = function (operation) {
    if (operation === 'listObjectsV2') return { promise: async () => ({ Contents: [] }) };
    throw new Error('Unexpected isolated S3 operation: ' + operation);
};
DynamoDBDocumentClient.prototype.send = async command => {
    const input = command.input;
    if (command.constructor.name === 'GetCommand' && input.TableName === 'rpgenius_data') return { Item: data[input.Key.key] === undefined ? undefined : { data: structuredClone(data[input.Key.key]) } };
    if (command.constructor.name === 'ScanCommand' && input.TableName === 'rpgenius_user') return { Items: [] };
    throw new Error('Unexpected isolated DB command: ' + command.constructor.name + '/' + input.TableName);
};
const rpg = require('../rpgenius');
const corridor = require('../paradise');
const added = require('../paradise_augments_extra');
const userName = 'paradise-augment-test';
before(() => rpg.initRpgeniusData());
afterEach(() => rpg.clearFieldRuntimeTimers(userName));
function fresh() {
    rpg.clearFieldRuntimeTimers(userName);
    const user = new rpg.RPGUser(userName, userName);
    user.level = 300; user.main_card = { id: 0, star: 6, type: '일반' }; user.need_character_card_select = false;
    rpg.addInventoryItem(user, data.Item.length - 1, 1);
    const result = corridor.enter(user, () => .99);
    assert.ok(!result.error, result.error);
    return user;
}
function choose(user, id, random = () => .99) {
    user.paradise.phase = 'augment'; user.paradise.choices = [id];
    return corridor.chooseAugment(user, id, random);
}
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} !== ${expected}`);

test('새 증강 64개는 모두 선택할 수 있고 같은 탐험에서 다시 제시되지 않는다', () => {
    assert.equal(added.length, 64);
    assert.equal(new Set(corridor.AUGMENTS.map(augment => augment.id)).size, corridor.AUGMENTS.length);
    for (const augment of added) {
        const user = fresh(), result = choose(user, augment.id);
        assert.ok(!result.error, augment.id + ': ' + result.error);
        assert.equal(user.paradise.acquired[augment.id], 1);
        assert.ok(augment.category && augment.desc, augment.id);
        corridor.offerAugments(user, () => .99);
        assert.ok(!user.paradise.choices.includes(augment.id), augment.id);
        assert.ok(choose(user, augment.id).error, augment.id + ' repeated acquisition');
    }
});

test('교대·연속·세 번째 공격은 직접 공격만 세고 재접속 후에도 순서를 유지한다', () => {
    const user = fresh(), battle = user.paradise.battle;
    user.paradise.effects = { alternating: .35, thirdStrike: .60 };
    close(corridor.attackMultiplier(user, { isBasic: true }), 1);
    close(corridor.attackMultiplier(user, { summonAttack: true }), 1);
    close(corridor.attackMultiplier(user, { dotAttack: true }), 1);
    close(corridor.attackMultiplier(user, {}), 1.35);
    const restored = structuredClone(user);
    close(corridor.attackMultiplier(restored, { isBasic: true }), 1.35 * 1.60);
    assert.equal(restored.paradise.battle.attackCount, 3);
    user.paradise.effects = { sameRhythm: .12 }; battle.attackCount = 0; battle.lastAttackType = null;
    for (let n = 0; n < 7; n++) close(corridor.attackMultiplier(user, { isBasic: true }), 1 + Math.min(.48, n * .12));
    close(corridor.attackMultiplier(user, {}), 1);
});

test('일반 공격 충전·스킬 직후 강화·첫 공격 주문은 서로의 소모 조건을 지킨다', () => {
    const user = fresh();
    user.paradise.effects = { swordCharge: .60, openingSpell: .75, spellWeave: .50 };
    for (let i = 0; i < 3; i++) close(corridor.attackMultiplier(user, { isBasic: true }), 1);
    corridor.onSkillUsed(user, 10);
    assert.equal(user.paradise.battle.openingSpellUsed, undefined, '회복/보조 스킬은 첫 공격 주문을 소모하지 않는다');
    close(corridor.attackMultiplier(user, {}), 1.60 * 1.75);
    close(corridor.attackMultiplier(user, { isBasic: true }), 1.50);
    close(corridor.attackMultiplier(user, {}), 1);
    corridor.startCombat(user, 'normal', null, () => .99);
    close(corridor.attackMultiplier(user, {}), 1.75);
});

test('장기전·단기전·노스킬 전략은 전투가 바뀌면 초기화된다', () => {
    const user = fresh();
    user.paradise.effects = { patientHunter: .04, briefGlory: 1, quietBlade: .40 };
    for (let n = 0; n < 12; n++) close(corridor.attackMultiplier(user, { isBasic: true }), (1 + Math.min(.40, n * .04)) * (n < 3 ? 1.35 : .85) * 1.40);
    corridor.onSkillUsed(user, 10);
    close(corridor.attackMultiplier(user, { isBasic: true }), 1.40 * .85);
    corridor.startCombat(user, 'normal', null, () => .99);
    close(corridor.attackMultiplier(user, { isBasic: true }), 1.35 * 1.40);
});

test('새 회복 효과는 적중·치명타 수·회복 봉쇄를 따르며 피의 비용은 죽이지 않는다', () => {
    const user = fresh(), stats = rpg.calculateUserStats(user);
    user.paradise.effects = { basicMp: .04, criticalMp: .01, basicHpCost: .02, skillHeal: .03 };
    user.mp = 0; user.hp = Math.floor(stats.hp * .50);
    corridor.afterAttack(user, { isBasic: true }, { finalDamage: 0, criticalCount: 0 });
    assert.equal(user.mp, 0);
    corridor.afterAttack(user, { isBasic: true }, { finalDamage: 100, criticalCount: 9 });
    assert.equal(user.mp, Math.round(stats.mp * .09));
    const hp = user.hp;
    corridor.onSkillUsed(user, 10);
    assert.equal(user.hp, hp + Math.round(stats.hp * .03));
    user.paradise.effects.noHealing = 1;
    const before = { hp: user.hp, mp: user.mp };
    corridor.afterAttack(user, { isBasic: true }, { finalDamage: 100, criticalCount: 9 });
    corridor.onSkillUsed(user, 10);
    assert.deepEqual({ hp: user.hp, mp: user.mp }, before);
    user.hp = 1; corridor.attackMultiplier(user, { isBasic: true });
    assert.equal(user.hp, 1);
});

test('피격 방어 횟수·보호 예약·비상약은 전투 상태에 기록되고 사망을 회복시키지 않는다', () => {
    const user = fresh(), stats = rpg.calculateUserStats(user);
    user.paradise.effects = { arrivalGuard: .50, basicGuard: .25, skillGuard: .25, reserveHeal: .30, untouched: .25 };
    close(corridor.attackMultiplier(user, { isBasic: true }), 1.25);
    corridor.afterAttack(user, { isBasic: true }, { finalDamage: 100 });
    corridor.onSkillUsed(user, 10);
    close(corridor.incomingMultiplier(user, 0), 1);
    close(corridor.incomingMultiplier(user, 100), .50 * .75 * .75);
    close(corridor.incomingMultiplier(user, 100), .50);
    close(corridor.incomingMultiplier(user, 100), 1);
    user.hp = Math.floor(stats.hp * .20);
    const low = user.hp;
    corridor.onDamageTaken(user, 100);
    assert.equal(user.hp, low + Math.round(stats.hp * .30));
    close(corridor.attackMultiplier(user, { isBasic: true }), 1);
    user.hp = low; corridor.onDamageTaken(user, 100);
    assert.equal(user.hp, low);
    corridor.startCombat(user, 'normal', null, () => .99);
    user.hp = 0; corridor.onDamageTaken(user, 100);
    assert.equal(user.hp, 0);
});

test('빌린 힘은 정확한 승리 수 뒤에 만료되고 약속한 대가와 보상은 한 번만 적용된다', () => {
    const user = fresh(), initial = rpg.calculateUserStats(user);
    choose(user, 'borrowedTomorrow'); choose(user, 'rapidDividend');
    close(corridor.sumEffects(user.paradise).atk, .50);
    corridor.victory(user, () => .99);
    close(corridor.sumEffects(user.paradise).atk, .50);
    assert.equal(user.paradise.effects.reward, undefined);
    corridor.startCombat(user, 'normal', null, () => .99); corridor.victory(user, () => .99);
    close(corridor.sumEffects(user.paradise).atk, -.15);
    close(user.paradise.effects.reward, .15);
    assert.equal(user.paradise.temporary.length, 0);
    assert.equal(rpg.calculateUserStats(user).atk, Math.round(initial.atk * .85));
    corridor.startCombat(user, 'normal', null, () => .99); corridor.victory(user, () => .99);
    close(user.paradise.effects.reward, .15);
});

test('승리 성장에는 상한이 있고 회복·뒤틀림 감소가 실제 승리에만 적용된다', () => {
    const user = fresh(), initial = rpg.calculateUserStats(user);
    user.paradise.effects = { victoryAtkGrowth: .03, victoryHpGrowth: .02, victoryHp: .02, victoryMp: .08, victoryDistortion: -3 };
    user.hp = 1; user.mp = 0; user.paradise.distortion = 50;
    corridor.victory(user, () => .99);
    assert.equal(user.paradise.distortion, 47);
    assert.ok(user.hp > 1 && user.mp > 0);
    for (let n = 1; n < 15; n++) { corridor.startCombat(user, 'normal', null, () => .99); corridor.victory(user, () => .99); }
    close(user.paradise.attackGrowth, .30); close(user.paradise.hpGrowth, .20);
    assert.equal(rpg.calculateUserStats(user).atk, Math.round(initial.atk * 1.30));
    assert.equal(rpg.calculateUserStats(user).hp, Math.round(initial.hp * 1.20));
});

test('확률형 증강은 양쪽 결과와 유물 이름을 즉시 공개하며 실제 효과가 설명과 일치한다', () => {
    for (const [roll, expected] of [[.1, { final: .25 }], [.9, { hp: -.10 }]]) {
        const user = fresh(), result = choose(user, 'coinOfPower', () => roll);
        assert.ok(result.reveal?.text);
        assert.equal(result.reveal.positive, roll < .60);
        for (const [key, value] of Object.entries(expected)) close(user.paradise.effects[key], value);
    }
    for (const [roll, key] of [[.1, 'crit'], [.9, 'cmb']]) {
        const user = fresh(), result = choose(user, 'twinFate', () => roll);
        close(user.paradise.effects[key], .25);
        assert.match(result.reveal.text, key === 'crit' ? /치명타 확률 \+25%p/ : /연격 확률 \+25%p/);
    }
    const user = fresh(), result = choose(user, 'relicSeeker');
    assert.equal(user.paradise.relics.length, 1);
    const relic = corridor.RELICS.find(entry => entry.id === user.paradise.relics[0]);
    assert.ok(result.reveal.text.includes(relic.name));
});

test('MP 소모·쿨타임 증강은 실제 스킬 경로에 반영되고 종료 뒤에는 남지 않는다', async () => {
    const user = fresh();
    choose(user, 'magicDiscount'); choose(user, 'quickChant');
    user.paradise.enemy.hp = user.paradise.enemy.maxHp = 1e12; user.paradise.enemy.atk = 0;
    const skill = rpg.getMainCardSkills(user)[0].skill, beforeMp = user.mp, at = Date.now();
    const message = await rpg.useSkillInField(user, skill.name);
    assert.ok(!message.startsWith('❌'), message);
    assert.equal(user.mp, beforeMp - Math.round(skill.mp_cost * .75));
    assert.ok(user.field.skillCooldowns[skill.name] - at <= skill.cooltime * .75 + 100);
    corridor.finish(user);
    assert.equal(corridor.cooldownMultiplier(user), 1);
    assert.equal(rpg.calculateUserStats(user).mpReduce || 0, 0);
});
