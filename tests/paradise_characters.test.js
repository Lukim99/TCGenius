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
// 기존 게임 엔진을 사용하되 운영 DB·S3에는 쓰지 않는다.
AWS.S3.prototype.makeRequest = operation => {
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
const characters = require('../paradise_augments_characters');
const shields = require('../combat_shields');
const definitions = require('../DB/RPGenius/CharacterCards.json');
const userName = 'paradise-character-test';
before(() => rpg.initRpgeniusData());
afterEach(() => rpg.clearFieldRuntimeTimers(userName));
function fresh(id, ...augments) {
    rpg.clearFieldRuntimeTimers(userName);
    const user = new rpg.RPGUser(userName, userName);
    user.level = 300; user.main_card = { id, star: 9, type: '전직' }; user.need_character_card_select = false;
    user.hp = 19; user.mp = 7;
    rpg.addInventoryItem(user, data.Item.length - 1, 1);
    assert.ok(!corridor.enter(user, () => .99).error);
    for (const augment of augments) user.paradise.acquired[augment] = 1;
    dummy(user);
    return user;
}
function dummy(user) {
    Object.assign(user.paradise.enemy, { hp: 1e12, maxHp: 1e12, atk: 0, def: 0, pnt: 0, crit: 0, cmb: 0 });
}
function ready(user) { user.field.nextActionAt = 0; user.field.basicUntil = 0; }
async function skill(user, name, reset = true) {
    ready(user);
    if (reset) delete user.field.skillCooldowns[name];
    const result = await rpg.useSkillInField(user, name);
    assert.ok(!result.startsWith('❌'), result);
    return result;
}
async function basic(user) {
    ready(user);
    const result = await rpg.useBasicAttackInField(user);
    assert.ok(!result.startsWith('❌'), result);
    return result;
}
function lastHit(user) { return user.paradise.combatEvents.at(-1); }

test('17개 캐릭터마다 전용 증강 2개를 제공하며 메인 카드와 실제 보유 스킬로 노출·선택을 검증한다', () => {
    assert.equal(characters.length, definitions.length * 2);
    assert.equal(new Set(characters.map(a => a.id)).size, characters.length);
    for (const [id, card] of definitions.entries()) {
        const own = characters.filter(a => a.character === id);
        assert.equal(own.length, 2, card.name);
        for (const augment of own) {
            assert.equal(augment.characterName, card.name);
            assert.match(augment.desc, /니다\.$/);
            const user = fresh(id);
            for (const other of corridor.AUGMENTS) if (other.id !== augment.id) user.paradise.acquired[other.id] = 1;
            user.main_card.id = (id + 1) % definitions.length;
            corridor.offerAugments(user, () => 0);
            assert.deepEqual(user.paradise.choices, []);
            user.paradise.choices = [augment.id];
            assert.ok(corridor.chooseAugment(user, augment.id).error);
            user.main_card.id = id;
            if (augment.requiresSkill != null) {
                user.main_card.type = '일반';
                corridor.offerAugments(user, () => 0);
                assert.deepEqual(user.paradise.choices, []);
                user.main_card.type = '전직';
            }
            corridor.offerAugments(user, () => 0);
            assert.deepEqual(user.paradise.choices, [augment.id]);
            assert.ok(!corridor.chooseAugment(user, augment.id, () => .99).error);
            assert.equal(characters.has(user, augment.id), true);
            corridor.offerAugments(user, () => 0);
            assert.deepEqual(user.paradise.choices, []);
            user.paradise = structuredClone(user.paradise);
            assert.equal(characters.has(user, augment.id), true, '재접속 저장본');
            user.main_card.id = (id + 1) % definitions.length;
            assert.equal(characters.has(user, augment.id), false, '카드 교체');
            user.main_card.id = id; user.paradise.mode = 'hell';
            assert.equal(characters.has(user, augment.id), false, '지옥에서 미적용');
            user.paradise.mode = undefined; user.paradise.status = 'ended';
            assert.equal(characters.has(user, augment.id), false, '탐험 종료');
        }
    }
});

test('빵귤: 자인 뒤 평타로 자인을 다시 쓰고 세 번째 자인으로 궁극기를 준비한다', async () => {
    const user = fresh(0, 'zainRefrain', 'timeThief');
    user.field.skillCooldowns['유드 알레프'] = Date.now() + 120000;
    for (let i = 0; i < 3; i++) {
        await skill(user, '자인', false);
        assert.ok(user.field.skillCooldowns['자인'] > Date.now());
        await basic(user);
        assert.ok(user.field.skillCooldowns['자인'] <= Date.now());
    }
    assert.ok(user.field.skillCooldowns['유드 알레프'] <= Date.now());
    assert.deepEqual([user.hp, user.mp], [19, 7]);
});

test('뭔마: 충전이 두 개씩 쌓이며 시벌론 연장은 전투당 5초로 제한한다', async () => {
    const user = fresh(1, 'sivalonWarmup', 'endlessFrenzy');
    await basic(user); assert.equal(user.field.sivalonCharge, 2);
    await basic(user); assert.equal(user.field.sivalonCharge, 4);
    await basic(user); assert.equal(user.field.sivalonCharge, 5);
    await skill(user, '시벌론');
    const until = user.field.sivalon.expired_at;
    for (let i = 0; i < 12; i++) await basic(user);
    assert.equal(user.field.sivalon.expired_at, until + 5000);
    assert.equal(user.field.sivalonCharge, 0);
});

test('글렌첵: 실제 보호막 흡수 피해를 다음 평타에 돌려주고 글버지 후 회복한다', async t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh(2, 'shieldFist', 'glenCheers');
    const stats = rpg.calculateUserStats(user);
    corridor.getResources(user).hp = Math.floor(stats.hp / 2);
    user.paradise.enemy.atk = 500;
    await skill(user, '글버지');
    user.field.nextEnemyAttackAt = Date.now(); rpg.advanceParadiseCombat(user);
    const stored = user.paradise.battle.characters.shieldDamage;
    assert.ok(stored > 0);
    const before = corridor.getResources(user).hp;
    user.paradise.enemy.atk = 0;
    const text = await basic(user);
    assert.match(text, /방패 속의 주먹/);
    assert.equal(user.paradise.battle.characters.shieldDamage, 0);
    assert.ok(corridor.getResources(user).hp > before);
});

test('오버라이드: 부활은 탐험당 한 번만 발동하며 후속 불사조와 잔불 회복은 회복 금지를 지킨다', async t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh(3, 'phoenixAsh', 'phoenixEmber'), stats = rpg.calculateUserStats(user);
    user.field.skillCooldowns['불사조'] = user.field.skillCooldowns['처형박수'] = Date.now() + 100000;
    corridor.getResources(user).hp = 1;
    user.paradise.enemy.atk = 1e8;
    await basic(user);
    user.field.nextEnemyAttackAt = Date.now(); rpg.advanceParadiseCombat(user);
    assert.equal(corridor.getResources(user).hp, 1);
    assert.ok(user.field.skillCooldowns['불사조'] <= Date.now());
    assert.ok(user.field.skillCooldowns['처형박수'] <= Date.now());
    user.paradise.enemy.atk = 0;
    await skill(user, '불사조', false);
    assert.ok(corridor.getResources(user).hp >= Math.round(stats.hp * .30));
    const before = corridor.getResources(user).hp;
    await basic(user);
    assert.ok(corridor.getResources(user).hp > before);
    corridor.startCombat(user, 'normal', null, () => .99);
    assert.equal(corridor.survive(user, 0, stats.hp), 0);
    dummy(user); user.paradise.effects.noHealing = 1;
    corridor.getResources(user).hp = 10;
    await skill(user, '불사조'); await basic(user);
    assert.ok(corridor.getResources(user).hp <= 10);
});

test('일레이나: 피아스트 뒤 MP가 회복되고 보호막 완전 방어가 궁극기 쿨타임을 줄인다', async t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh(4, 'manaSpring', 'tidalBarrier');
    const until = Date.now() + 100000;
    user.field.skillCooldowns['이어브피'] = until;
    user.paradise.enemy.atk = 500;
    await skill(user, '피아스트');
    user.field.nextEnemyAttackAt = Date.now(); rpg.advanceParadiseCombat(user);
    assert.equal(user.field.skillCooldowns['이어브피'], until - 5000);
    const before = corridor.getResources(user).mp;
    await basic(user);
    assert.ok(corridor.getResources(user).mp > before);
});

test('진필규: 수업끝 뒤 두 평타로 재시전하며 피해 감소 상태 피격으로도 쿨타임을 줄인다', async t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh(5, 'extraClass', 'thanksFist');
    user.paradise.enemy.atk = 500;
    await skill(user, '수업끝');
    const until = user.field.skillCooldowns['수업끝'];
    await basic(user);
    user.field.nextEnemyAttackAt = Date.now(); rpg.advanceParadiseCombat(user);
    assert.equal(user.field.skillCooldowns['수업끝'], until - 1000);
    await basic(user);
    assert.ok(user.field.skillCooldowns['수업끝'] <= Date.now());
});

test('켄시: 비치명 재시전은 전투당 한 번이며 치명타 두 번 후 궁극기를 확정 치명타로 만든다', async t => {
    const random = t.mock.method(Math, 'random', () => .99);
    const user = fresh(6, 'failedEncore', 'lastChorus');
    await skill(user, 'SUPER EASY');
    assert.ok(user.field.skillCooldowns['SUPER EASY'] <= Date.now());
    await skill(user, 'SUPER EASY');
    assert.ok(user.field.skillCooldowns['SUPER EASY'] > Date.now());
    random.mock.mockImplementation(() => 0);
    user.field.skillCooldowns['KICK BACK'] = Date.now() + 120000;
    await skill(user, 'SUPER EASY'); await skill(user, 'SUPER EASY');
    assert.ok(user.field.skillCooldowns['KICK BACK'] <= Date.now());
    random.mock.mockImplementation(() => .99);
    await skill(user, 'KICK BACK', false);
    assert.ok(lastHit(user).criticalCount > 0);
    assert.equal(user.paradise.battle.characters.chorusReady, false);
});

test('켄시: 연격의 치명타를 각각 집계하고 남은 치명타를 다음 후렴에 이어간다', async t => {
    t.mock.method(Math, 'random', () => 0);
    const user = fresh(6, 'lastChorus');
    Object.assign(user.paradise.effects, { crit: 1, cmb: 1, maxCmb: 1 });
    user.field.skillCooldowns['KICK BACK'] = Date.now() + 100000;
    await skill(user, 'SUPER EASY');
    assert.equal(lastHit(user).criticalCount, 3);
    assert.ok(user.field.skillCooldowns['KICK BACK'] <= Date.now());
    assert.equal(user.paradise.battle.characters.chorusCrits, 1);
    await skill(user, 'KICK BACK', false);
    assert.equal(user.paradise.battle.characters.chorusReady, false);
    user.paradise.effects.cmb = 0;
    await skill(user, 'SUPER EASY');
    assert.equal(lastHit(user).criticalCount, 1);
    assert.ok(user.field.skillCooldowns['KICK BACK'] <= Date.now());
    assert.equal(user.paradise.battle.characters.chorusCrits, 0);
    assert.equal(user.paradise.battle.characters.chorusReady, true);
});

test('제우스: 세 번의 백억이요 마무리로 실제 카드 계약을 얻고 첫 궁극기는 대박이 된다', async t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh(7, 'jackpotSavings', 'riggedJackpot');
    const result = await skill(user, '초특급한탕');
    assert.match(result, /초특급 대박/);
    assert.equal(user.paradise.battle.characters.jackpotUsed, true);
    for (let i = 0; i < 3; i++) {
        user.paradise.enemy.hp = 1;
        await skill(user, '백억이요');
        if (i < 2) { corridor.startCombat(user, 'normal', null, () => .99); dummy(user); }
    }
    assert.equal(user.paradise.contracts.filter(c => c.star === 7 && c.type === '일반').length, 1);
    assert.match(user.paradise.rewardReveal.text, /7성 일반 카드/);
});

test('제우스: 강제 대박은 교촌 주머니의 실패 효과와 겹치지 않고 시전 실패로 소모되지 않는다', async t => {
    t.mock.method(Math, 'random', () => .99);
    const now = Date.now(); t.mock.method(Date, 'now', () => now);
    const user = fresh(7, 'riggedJackpot');
    user.equipments.weapon = { id: data.Equipment.weapon.findIndex(e => e.name === '교촌 주머니'), level: 0, transcendStage: 1 };
    user.equipments.support = { id: data.Equipment.support.findIndex(e => e.name === '행운의 복주머니'), level: 0, transcendStage: 1 };
    corridor.getResources(user).mp = 0;
    assert.match(await rpg.useSkillInField(user, '초특급한탕'), /MP가 부족/);
    assert.equal(characters.forceJackpot(user), true);
    corridor.getResources(user).mp = rpg.calculateUserStats(user).mp;
    assert.match(await skill(user, '초특급한탕'), /초특급 대박/);
    assert.equal(user.field.equipmentState.kyochonGoldBuff, undefined);
    assert.equal(user.field.equipmentState.fortuneExtraDamage, undefined);
    assert.equal(characters.forceJackpot(user), false);
    const jackpotCooldown = user.field.skillCooldowns['초특급한탕'] - now;
    corridor.getResources(user).mp = rpg.calculateUserStats(user).mp;
    assert.doesNotMatch(await skill(user, '초특급한탕'), /초특급 대박/);
    assert.ok(user.field.equipmentState.kyochonGoldBuff);
    assert.ok(user.field.equipmentState.fortuneExtraDamage);
    assert.equal(user.field.skillCooldowns['초특급한탕'] - now, jackpotCooldown - 30000);
});

test('타이란트: 봉인 중 세 평타로 보호막을 얻고 다른 스킬을 사용해도 건력을 유지한다', async t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh(8, 'sealDividend', 'endlessMight');
    await skill(user, '건력');
    for (let i = 0; i < 3; i++) await basic(user);
    assert.ok(shields.summary(user.field, Date.now()).amount > 0);
    await skill(user, '끝판왕');
    assert.ok(user.field.gunryeok);
    await skill(user, '건력');
    assert.equal(user.field.gunryeok, undefined);
});

test('마쉐비: 청정수 다음 평타가 방어력을 무시하며 세 번 사용하면 댄져가 재사용된다', async t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh(9, 'pureChain', 'deepSpring');
    user.field.skillCooldowns['댄져'] = Date.now() + 100000;
    for (let i = 0; i < 3; i++) {
        await skill(user, '청정수 투척');
        assert.equal(user.paradise.battle.characters.pureReady, true);
        const text = await basic(user);
        assert.match(text, /청정한 연쇄/);
        assert.equal(user.paradise.battle.characters.pureReady, false);
    }
    assert.ok(user.field.skillCooldowns['댄져'] <= Date.now());
});

test('딜러장: 비리 장부의 추가 피해와 54버스트 뒤 비리 무료 재사용을 연결한다', async t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh(10, 'bribeLedger', 'burstReprise');
    for (let i = 0; i < 3; i++) await skill(user, '비리');
    const result = await basic(user);
    assert.match(result, /비리 장부/);
    await skill(user, '54버스트');
    assert.ok(user.field.skillCooldowns['비리'] <= Date.now());
    corridor.getResources(user).mp = 0;
    await skill(user, '비리', false);
    assert.equal(corridor.getResources(user).mp, 0);
    assert.equal(characters.freeSkill(user, '비리'), false);
});

test('이익태: 광란의 익테봇은 실제 타이머를 2초로 설정하고 일반 탐험 밖에서는 4초를 유지한다', async t => {
    const intervals = [];
    t.mock.method(global, 'setInterval', (callback, delay) => { intervals.push(delay); return { unref() {} }; });
    t.mock.method(global, 'clearInterval', () => {});
    const user = fresh(11, 'frenziedIktaeBot');
    await skill(user, '익테봇 소환');
    assert.ok(intervals.includes(2000));
    assert.equal(characters.iktaeInterval(user), 2000);
    corridor.offerAugments(user); corridor.finish(user);
    assert.equal(characters.iktaeInterval(user), 4000);
});

test('이익태: 고독한 이익태는 스킬을 소모 없이 차단하며 평타 피해만 정확히 두 배로 만든다', async t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh(11);
    await basic(user);
    const baseline = lastHit(user).damage;
    user.paradise.acquired.solitaryIktae = 1;
    await basic(user);
    assert.equal(lastHit(user).damage, baseline * 2);
    const mp = corridor.getResources(user).mp;
    ready(user);
    assert.match(await rpg.useSkillInField(user, '익테봇 소환'), /스킬이 봉인/);
    assert.match(await rpg.useSkillInField(user, '자폭'), /스킬이 봉인/);
    assert.equal(corridor.getResources(user).mp, mp);
    assert.equal(user.field.iktaeBot, undefined);
    user.main_card.id = 0;
    assert.equal(characters.skillBlocked(user), null);
});

test('안성재: 세 중첩을 유지하며 아홉 중첩 재사용은 전투당 한 번만 적용한다', async () => {
    const user = fresh(12, 'threeMoves', 'perfectNine');
    user.field.nmmStacks = 9;
    await skill(user, '나인 멘스 모리스');
    assert.equal(user.field.nmmStacks, 3);
    assert.ok(user.field.skillCooldowns['나인 멘스 모리스'] <= Date.now());
    user.field.nmmStacks = 9;
    await skill(user, '나인 멘스 모리스');
    assert.equal(user.field.nmmStacks, 3);
    assert.ok(user.field.skillCooldowns['나인 멘스 모리스'] > Date.now());
});

test('흠시원: 유서새김이 20초 유지되고 마지막 문장이 남은 지속 피해를 다음 평타에 보낸다', async () => {
    const user = fresh(13, 'willMargin', 'lastSentence');
    const before = Date.now();
    await skill(user, '유서새김');
    assert.ok(user.field.mark.expired_at >= before + 20000);
    await skill(user, '범인은 이 안에');
    assert.equal(user.field.mark, undefined);
    assert.ok(user.paradise.battle.characters.lastSentence > 0);
    const result = await basic(user);
    assert.match(result, /마지막 문장/);
    assert.equal(user.paradise.battle.characters.lastSentence, 0);
});

test('일리온: 헤즈업이 서로 다른 두 장을 뽑으며 각 카드 지속시간을 늘린다', async t => {
    t.mock.method(Math, 'random', () => 0);
    const user = fresh(14, 'doubleDraw', 'lingeringFate');
    const now = Date.now();
    const result = await skill(user, '헤즈업');
    assert.deepEqual(user.field.ilion.deck.map(c => c.name), ['삼두사', '광기']);
    assert.ok(user.field.ilion.deck[0].until >= now + 32000);
    assert.ok(user.field.ilion.deck[1].until >= now + 60000);
    assert.match(result, /삼두사.*광기/);
    await skill(user, '헤즈업');
    assert.equal(user.field.ilion.deck.length, 2);
    assert.equal(new Set(user.field.ilion.deck.map(c => c.name)).size, 2);
});

test('워뇨띠: 세 번째 전환은 럭키비키가 되며 기본·즐리·쉐비 평타 순환은 한 번 회복한다', async t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh(15, 'guaranteedLucky', 'maskCycle'), stats = rpg.calculateUserStats(user);
    corridor.getResources(user).hp = Math.floor(stats.hp / 2);
    corridor.getResources(user).mp = Math.floor(stats.mp / 2);
    await basic(user);
    await skill(user, '모드 전환'); await basic(user);
    const hp = corridor.getResources(user).hp, mp = corridor.getResources(user).mp;
    await skill(user, '모드 전환'); await basic(user);
    assert.ok(corridor.getResources(user).hp > hp);
    assert.ok(corridor.getResources(user).mp > mp);
    assert.equal(user.paradise.battle.characters.maskHealed, true);
    const text = await skill(user, '모드 전환');
    assert.equal(user.field.wonyoddi.mode, '럭키비키');
    assert.match(text, /럭키비키/);
});

test('키노: 앙코르 요청은 일반 공격 3회로 쿨타임을 초기화하고 다음 스킬을 한 번 강화한다', async t => {
    t.mock.method(Math, 'random', () => .99);
    const freeze = Date.now(); t.mock.method(Date, 'now', () => freeze);
    const user = fresh(16, 'stageHeat', 'emergencyComeback');
    await skill(user, '아이돌 할래?');
    assert.ok(user.field.kino.value >= 80 && user.field.kino.value < 81);
    const first = lastHit(user).damage;
    await basic(user); await basic(user);
    assert.ok(user.field.skillCooldowns['아이돌 할래?'] > freeze);
    await basic(user);
    assert.equal(user.field.skillCooldowns['아이돌 할래?'], freeze);
    assert.equal(user.paradise.battle.characters.kinoEncoreReady, true);
    user.field.kino.value = 100;
    await skill(user, '아이돌 할래?', false);
    assert.equal(lastHit(user).damage, first * 2);
    assert.equal(user.paradise.battle.characters.kinoEncoreReady, false);
    user.field.kino.value = 100;
    await skill(user, '아이돌 할래?');
    assert.equal(lastHit(user).damage, first);
});
