const assert = require('assert');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
        const match = line.match(/^\s*([^#=]+)=(.*)$/);
        if (match) process.env[match[1].trim()] = match[2].trim();
    }
}

const rpg = require('../rpgenius');
const pvp = require('../pvp');

const characterCards = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'DB', 'RPGenius', 'CharacterCards.json'), 'utf8'));

// server.js의 serializeCard/getHFieldCharacterSprite 대신 최소 구현을 주입한다 (DB 접근 없음).
pvp.configure({
    serializeCard: card => card && characterCards[card.id] ? {
        id: Number(card.id),
        star: Number(card.star || 0),
        type: card.type || '일반',
        skin: card.skin || '',
        name: characterCards[card.id].name,
        formatted: rpg.formatUserCard(card),
        imageUrl: null,
        skills: [],
        classInfo: null
    } : null,
    getCharacterSprite: () => null
});

const BASE = Date.parse('2026-08-18T05:00:00+09:00');
let clock = BASE;
pvp.__setNow(() => clock);

// 연격과 추가 피해는 최종 피해를 재분배하지 않고 원래 계산 구성요소로 남아야 한다.
{
    const originalRandom = Math.random;
    Math.random = () => 0;
    const result = rpg.calculateAttackHitResult(1000, 0, 0, {
        atk: 1000, crit: 0, critMul: 1.5, cmb: 1, maxCmb: 2, extraDamage: .5
    }, {}, { comboHitCount: 4 }, {});
    const fixedExtras = rpg.calculateAttackHitResult(1000, 0, 0, {
        atk: 1000, crit: 0, critMul: 1.5, cmb: 0, maxCmb: 0, '000': 1
    }, {}, { comboHitCount: 1, skillTrueDmg: 100, oneTimeTrueDmg: 50 }, {});
    Math.random = originalRandom;
    assert.strictEqual(result.damageComponents.filter(component => component.type == 'hit').length, 4, '연격 4타는 기본 피해 4개로 유지돼야 한다.');
    assert.strictEqual(result.damageComponents.filter(component => component.type == 'additional').length, 1, '추가 피해는 연격 합계와 별도 구성요소여야 한다.');
    assert.strictEqual(result.damageComponents.reduce((sum, component) => sum + component.damage, 0), result.finalDamage, '표시 구성요소 합은 실제 피해와 같아야 한다.');
    assert.ok(result.damageComponents.filter(component => component.type == 'additional').every(component => !component.isCritical && !component.isDestinyDamage), '별도 추가 피해에 기본 타격 치명/운명 표식을 상속하면 안 된다.');
    const fixedLabels = fixedExtras.damageComponents.map(component => component.label).filter(Boolean);
    assert.ok(fixedLabels.includes('000 추가 피해') && fixedLabels.includes('스킬 고정 피해') && fixedLabels.includes('일회 고정 피해'), '각 고정/추가 피해도 기본 타격 합계와 분리돼야 한다.');
    assert.strictEqual(fixedExtras.damageComponents.reduce((sum, component) => sum + component.damage, 0), fixedExtras.finalDamage);
}

function makeUser(name, id, mainCard, overrides) {
    return Object.assign({
        name,
        id,
        level: 100,
        main_card: mainCard,
        card_slot: [],
        equipments: {},
        statPointStats: {},
        inventory: { card: [], item: [], equipment: [] },
        maxCardSlot: 5,
        saveCalls: 0,
        // 실제 save가 아닌 카운터 스텁 — 테스트는 DB에 절대 쓰지 않는다
        save: async function () { this.saveCalls++; }
    }, overrides || {});
}

// ===== 1. Elo =====

assert.strictEqual(pvp.eloDelta(1000, 1000), 16, '동률 레이팅에서는 K/2 만큼 이동해야 한다.');
assert.ok(pvp.eloDelta(1000, 1400) > 16, '낮은 레이팅이 이기면 변동 폭이 커야 한다.');
assert.ok(pvp.eloDelta(1400, 1000) < 16, '높은 레이팅이 이기면 변동 폭이 작아야 한다.');
assert.strictEqual(pvp.eloDelta(3000, 0), 1, '레이팅 변동은 최소 1이어야 한다.');

// ===== 2. 상태 초기화 / 일일 리셋 =====

const stateUser = makeUser('상태', 900, { id: 0, star: 8, type: '일반' });
const state = pvp.ensurePvpState(stateUser);
assert.strictEqual(state.rating, 1000, '초기 레이팅은 1000이어야 한다.');
assert.strictEqual(state.wins, 0);
assert.strictEqual(state.losses, 0);
assert.strictEqual(state.battle, null);
assert.strictEqual(state.daily.date, rpg.getKoreanDateKey(new Date(BASE)), '일일 키는 KST 날짜여야 한다.');
state.daily.date = '2000-01-01';
state.daily.refreshUsed = 2;
state.daily.opponents = [{ name: '지난상대' }];
pvp.ensurePvpState(stateUser);
assert.strictEqual(stateUser.pvp.daily.opponents.length, 0, '날짜가 바뀌면 상대 목록이 초기화돼야 한다.');
assert.strictEqual(stateUser.pvp.daily.refreshUsed, 0, '날짜가 바뀌면 새로고침 횟수가 초기화돼야 한다.');

// ===== 3. 스냅샷 =====

const snapshotUser = makeUser('스냅샷', 901, { id: 2, star: 8, type: '전직' });
const snapshot = pvp.buildSideSnapshot(snapshotUser, { mainCard: snapshotUser.main_card, cardSlot: [] });
assert.ok(snapshot.stats.hp > 0 && snapshot.stats.mp > 0 && snapshot.stats.atk > 0, '스냅샷 스탯이 채워져야 한다.');
assert.ok(snapshot.skillIndexes.length >= 2, '전직 카드는 기본 + 전직 스킬을 모두 가져야 한다.');
assert.strictEqual(snapshot.display.cardName, '글렌첵');
assert.strictEqual(snapshot.display.skillsMeta[0].name, '글버지');
assert.strictEqual(snapshot.star, 8);
assert.strictEqual(typeof snapshot.staticAtkPlus, 'number', '동적 공격력 버프를 솔로 공식대로 합산하려면 정적 공격력% 스냅샷이 필요하다.');
assert.strictEqual(snapshotUser.hp, undefined, '스냅샷은 유저의 hp/mp를 건드리지 않아야 한다.');
assert.strictEqual(snapshotUser.field, undefined, '스냅샷은 유저의 field를 건드리지 않아야 한다.');

// ===== 4. 방어 덱 해석 / 검증 =====

const deckUser = makeUser('덱', 902, { id: 2, star: 8, type: '전직' }, {
    card_slot: [{ id: 3, star: 5, type: '일반' }],
    inventory: {
        card: [
            { id: 11, star: 8, type: '전직' },
            { id: 4, star: 2, type: '일반' },
            { id: 3, star: 6, type: '일반' }
        ],
        item: [],
        equipment: []
    }
});
pvp.ensurePvpState(deckUser);

const equippedDeck = pvp.resolveDefenseDeck(deckUser);
assert.strictEqual(equippedDeck.useEquipped, true, '방어 덱 미설정 시 장착 덱을 사용해야 한다.');
assert.strictEqual(equippedDeck.valid, true);
assert.strictEqual(equippedDeck.mainCard.id, 2);
assert.deepStrictEqual(equippedDeck.rules, pvp.DEFAULT_RULES);

const sig = card => rpg.cardPresetSignature(card);
const savedDeck = pvp.saveDefense(deckUser, {
    useEquipped: false,
    mainCard: sig({ id: 11, star: 8, type: '전직' }),
    slotCards: [sig({ id: 3, star: 5, type: '일반' })],
    rules: [{ cond: 'hpBelow', value: 40, action: 'defend' }, { cond: 'always', action: 'skill', skill: '수나타 소환' }]
});
assert.ok(savedDeck.ok, savedDeck.message);
const customDeck = pvp.resolveDefenseDeck(deckUser);
assert.strictEqual(customDeck.useEquipped, false);
assert.strictEqual(customDeck.valid, true);
assert.strictEqual(customDeck.mainCard.id, 11, '저장한 방어 메인 카드가 해석돼야 한다.');
assert.strictEqual(customDeck.cardSlot.length, 1);
assert.strictEqual(customDeck.cardSlot[0].id, 3);
assert.strictEqual(customDeck.rules.length, 2);

assert.ok(pvp.validateDefensePayload(deckUser, { mainCard: sig({ id: 2, star: 8, type: '전직' }), slotCards: [sig({ id: 4, star: 2, type: '일반' })] }).error, '4성 이하 카드는 슬롯에 넣을 수 없어야 한다.');
assert.ok(pvp.validateDefensePayload(deckUser, {
    mainCard: sig({ id: 2, star: 8, type: '전직' }),
    slotCards: [sig({ id: 3, star: 5, type: '일반' }), sig({ id: 3, star: 6, type: '일반' })]
}).error, '같은 캐릭터를 두 번 넣을 수 없어야 한다.');
assert.ok(pvp.validateDefensePayload(deckUser, { mainCard: { id: 99, star: 0, type: '일반', prestige: false, fashion: null } }).error, '보유하지 않은 카드는 등록할 수 없어야 한다.');
assert.ok(pvp.validateDefensePayload(deckUser, { mainCard: sig({ id: 2, star: 8, type: '전직' }), rules: new Array(9).fill({ cond: 'always', action: 'attack' }) }).error, '규칙은 8개를 넘을 수 없어야 한다.');
assert.ok(pvp.validateDefensePayload(deckUser, { mainCard: sig({ id: 2, star: 8, type: '전직' }), rules: [{ cond: 'hpBelow', value: 0, action: 'defend' }] }).error, '조건 수치는 1~99여야 한다.');
assert.ok(pvp.validateDefensePayload(deckUser, { mainCard: sig({ id: 2, star: 8, type: '전직' }), rules: [{ cond: 'always', action: 'skill', skill: '유서새김' }] }).error, '메인 카드가 가진 스킬만 지정할 수 있어야 한다.');
assert.ok(!pvp.validateDefensePayload(deckUser, { useEquipped: true, rules: [{ cond: 'always', action: 'attack' }] }).error, '장착 덱 사용은 카드 없이도 저장돼야 한다.');

deckUser.pvp.defense = { mainCard: { id: 99, star: 0, type: '일반', prestige: false, fashion: null }, slotCards: [], rules: pvp.DEFAULT_RULES };
const staleDeck = pvp.resolveDefenseDeck(deckUser);
assert.strictEqual(staleDeck.valid, false, '카드를 찾을 수 없으면 valid=false여야 한다.');
assert.strictEqual(staleDeck.mainCard.id, 2, '해석 실패 시 장착 덱으로 대체돼야 한다.');

// ===== 5. 방어 AI 규칙 =====

function ruleSide(over) {
    return Object.assign({
        name: '규칙',
        hp: 100, maxHp: 100, mp: 100, maxMp: 100,
        defendUntil: 0, defendCooldownEnd: 0,
        skillCooldowns: {},
        rules: null,
        runtime: { buffs: {}, nmmStacks: 0, sivalonCharge: 0, sivalon: null, gunryeok: null, summon: null, mark: null },
        snapshot: { stats: {}, slotEffects: {}, skillIndexes: [2, 18], star: 0, elementChain: {}, display: {} } // 글버지(82) / 핫식스의정력(650)
    }, over || {});
}

const enemySide = ruleSide({ name: '적' });
assert.deepStrictEqual(
    pvp.evaluateRules(ruleSide({ hp: 20, rules: pvp.DEFAULT_RULES }), enemySide, BASE),
    { action: 'defend', skillName: null },
    'HP 30% 이하에서는 기본 규칙이 방어를 선택해야 한다.');
assert.deepStrictEqual(
    pvp.evaluateRules(ruleSide({ mp: 700, rules: pvp.DEFAULT_RULES }), enemySide, BASE),
    { action: 'skill', skillName: '핫식스의정력' },
    '스킬 사용 가능 시 궁극기 쪽부터 선택해야 한다.');
assert.deepStrictEqual(
    pvp.evaluateRules(ruleSide({ mp: 0, rules: pvp.DEFAULT_RULES }), enemySide, BASE),
    { action: 'attack', skillName: null },
    'MP가 부족하면 스킬 규칙을 건너뛰어야 한다.');
assert.deepStrictEqual(
    pvp.evaluateRules(ruleSide({ rules: [{ cond: 'hpBelow', value: 1, action: 'defend' }] }), enemySide, BASE),
    { action: 'attack', skillName: null },
    '어떤 규칙도 만족하지 않으면 공격해야 한다.');
assert.deepStrictEqual(
    pvp.evaluateRules(ruleSide({ rules: [{ cond: 'enemyDefending', action: 'skill', skill: '글버지' }, { cond: 'always', action: 'attack' }] }), ruleSide({ defendUntil: BASE + 4000 }), BASE),
    { action: 'skill', skillName: '글버지' },
    '상대 방어 중 조건과 지정 스킬이 동작해야 한다.');
assert.deepStrictEqual(
    pvp.evaluateRules(ruleSide({ skillCooldowns: { '글버지': BASE + 5000 }, rules: [{ cond: 'always', action: 'skill', skill: '글버지' }, { cond: 'always', action: 'defend' }] }), enemySide, BASE),
    { action: 'defend', skillName: null },
    '지정 스킬이 쿨타임이면 다음 규칙으로 넘어가야 한다.');
assert.deepStrictEqual(
    pvp.evaluateRules(ruleSide({ defendCooldownEnd: BASE + 5000, rules: [{ cond: 'always', action: 'defend' }, { cond: 'always', action: 'attack' }] }), enemySide, BASE),
    { action: 'attack', skillName: null },
    '방어가 쿨타임이면 다음 규칙으로 넘어가야 한다.');
assert.deepStrictEqual(
    pvp.evaluateRules(ruleSide({
        mp: 0,
        rules: [{ cond: 'always', action: 'skill', skill: '글버지' }],
        snapshot: { stats: {}, slotEffects: {}, skillIndexes: [2], star: 0, elementChain: {}, display: {}, equipment: { entries: [{ name: '불량 배터리', stage: 1 }], setCounts: {} } }
    }), enemySide, BASE),
    { action: 'skill', skillName: '글버지' },
    '상대 AI도 MP가 없을 때 불량 배터리 무료 발동을 한 번은 시도해야 한다.');

// ===== 6. 전투 시뮬레이션 =====

const STUB_SLOT_EFFECTS = {
    expBonus: 0, hpDamageReduction: 0, killRecoveryChance: 0, crit: 0, mpCostReduction: 0,
    damageBonus: 0, critMul: 0, goldBonus: 0, itemDropChance: 0, defReduction: 0,
    basicDamageBonus: 0, skillDamageBonus: 0, nonElementFinalDamage: 0, tenthHitFinalAtk: 0
};

// DB에 의존하지 않도록 전투 수치를 고정한다.
function stubSide(side, over) {
    side.snapshot.stats = Object.assign({
        hp: 3000, mp: 2000, atk: 300, def: 100, pnt: 0, crit: 0, critMul: 1, cmb: 0, maxCmb: 0,
        avd: 0, takenDamage: 0, afterBasic: 0, afterSkill: 0, damageBonus: 0, finalDamage: 0,
        skillCooldown: 0, cooldown: 0, mpReduce: 0, shieldEfficiency: 0, summonDuration: 0, dotDamage: 0
    }, over || {});
    side.snapshot.slotEffects = Object.assign({}, STUB_SLOT_EFFECTS);
    side.maxHp = side.snapshot.stats.hp;
    side.hp = side.maxHp;
    side.maxMp = side.snapshot.stats.mp;
    side.mp = side.maxMp;
}

const attacker = makeUser('공격자', 1, { id: 2, star: 8, type: '전직' }); // 글버지 / 핫식스의정력
const defenders = [
    makeUser('수비1', 11, { id: 13, star: 8, type: '전직' }), // 유서새김 / 범인은 이 안에
    makeUser('수비2', 12, { id: 8, star: 8, type: '전직' }),
    makeUser('수비3', 13, { id: 10, star: 8, type: '전직' }),
    makeUser('수비4', 14, { id: 6, star: 8, type: '전직' }),
    makeUser('수비5', 15, { id: 7, star: 8, type: '전직' })
];
const fakeDb = {};
[attacker].concat(defenders).forEach(user => { fakeDb[user.name] = user; });

// DB 접근 지점만 가짜로 대체한다 (읽기/쓰기 모두 발생하지 않는다).
rpg.getRPGUserByName = async name => fakeDb[name] || null;
rpg.getAllRPGUsers = async () => Object.keys(fakeDb).map(name => fakeDb[name]);
rpg.enqueueFieldAction = (seed, task) => Promise.resolve().then(task);
// 플레이 보상 표가 참조하는 아이템 정의 (DynamoDB 로드와 무관하게 결정적으로 검증)
const FAKE_ITEMS = [
    { name: '지니어스의 열쇠', type: '재료' }, { name: '카드팩 상자', type: '가챠' },
    { name: '딜러 지렁이', type: '미끼' }, { name: '익명 지렁이', type: '미끼' },
    { name: '쥬얼', type: '티켓' }, { name: '화이트 쥬얼', type: '티켓' }, { name: '쥬얼 패키지', type: '번들' }
];
const REWARD_NAMES = new Set(['지니어스의 열쇠', '카드팩 상자', '딜러 지렁이', '익명 지렁이', '쥬얼', '화이트 쥬얼']);
rpg.getDataCache = (key, fallback) => key == 'Item' ? FAKE_ITEMS : fallback;

const flush = () => new Promise(resolve => setImmediate(resolve));
const advanceTo = ms => { clock = Math.max(clock, ms); };

(async () => {
    assert.strictEqual(await pvp.ensureDaily(attacker), true, '첫 조회에서는 오늘의 상대가 생성돼야 한다.');
    const daily = attacker.pvp.daily;
    assert.strictEqual(daily.opponents.length, 5, '오늘의 상대는 5명이어야 한다.');
    assert.strictEqual(new Set(daily.opponents.map(slot => slot.name)).size, 5, '상대는 중복되지 않아야 한다.');
    assert.ok(daily.opponents.every(slot => slot.name != attacker.name), '자기 자신은 매칭되지 않아야 한다.');
    assert.deepStrictEqual(daily.opponents.map(slot => slot.kind), ['near', 'near', 'near', 'higher', 'random'], '매칭 구성은 근접 3 / 상위 1 / 랜덤 1이어야 한다.');
    assert.ok(daily.opponents.every(slot => slot.cardName), '상대 표시용 카드 정보가 채워져야 한다.');

    const refreshed = await pvp.refreshOpponents(attacker);
    assert.ok(refreshed.ok, refreshed.message);
    assert.strictEqual(attacker.pvp.daily.refreshUsed, 1);
    assert.strictEqual(attacker.pvp.daily.opponents.length, 5);
    const secondRefresh = await pvp.refreshOpponents(attacker);
    assert.ok(secondRefresh.ok, secondRefresh.message);
    const thirdRefresh = await pvp.refreshOpponents(attacker);
    assert.strictEqual(thirdRefresh.ok, false);
    assert.strictEqual(thirdRefresh.message, '새로고침 횟수를 모두 사용했습니다.');

    const rolledNames = attacker.pvp.daily.opponents.map(slot => slot.name);
    // 첫 전투는 유서새김(지속 피해)을 가진 수비1로 고정한다
    const slotNames = ['수비1'].concat(rolledNames.filter(name => name != '수비1'));
    assert.strictEqual(slotNames.length, 5);

    async function openBattle(opponentName, meOver, oppOver) {
        clock = BASE;
        const started = await pvp.startBattle(attacker, opponentName);
        assert.ok(started.ok, started.message);
        assert.strictEqual(started.battle.phase, 'countdown');
        const battle = attacker.pvp.battle;
        stubSide(battle.me, meOver);
        stubSide(battle.opp, oppOver);
        return battle;
    }

    // --- 카운트다운 / 기본 행동 ---
    const battle1 = await openBattle(slotNames[0]);
    assert.strictEqual(battle1.startedAt, BASE + 3000);
    assert.strictEqual(battle1.endsAt, BASE + 3000 + 120000);

    clock = BASE + 1000;
    pvp.advanceBattle(attacker);
    assert.strictEqual(battle1.phase, 'countdown', '카운트다운 중에는 전투가 시작되지 않아야 한다.');
    const early = pvp.playerAttack(attacker);
    assert.strictEqual(early.ok, false);
    assert.strictEqual(early.message, '전투 시작 전입니다.');

    clock = BASE + 3000;
    pvp.advanceBattle(attacker);
    assert.strictEqual(battle1.phase, 'fight');
    assert.ok(battle1.events.some(event => event.action == 'start'), '전투 시작 이벤트가 있어야 한다.');

    // --- 시작 시 모든 행동은 최대 쿨타임 상태 (일반 행동 3초, 방어 10초, 스킬은 각자 쿨 ≤ 60초) ---
    [battle1.me, battle1.opp].forEach(side => {
        assert.strictEqual(side.nextActionAt, battle1.startedAt + 3000, '시작 시 일반 행동 쿨타임은 3초여야 한다.');
        assert.strictEqual(side.defendCooldownEnd, battle1.startedAt + 10000, '시작 시 방어 쿨타임은 10초여야 한다.');
    });
    assert.strictEqual(battle1.me.skillCooldowns['글버지'], battle1.startedAt + 24000, '스킬은 자기 쿨타임(24초)만큼 대기해야 한다.');
    assert.strictEqual(battle1.me.skillCooldowns['핫식스의정력'], battle1.startedAt + 60000, '스킬 초기 쿨타임은 60초를 넘지 않아야 한다.');
    assert.strictEqual(pvp.playerAttack(attacker).message, '아직 행동할 수 없습니다.');
    assert.strictEqual(pvp.playerDefend(attacker).message, '아직 행동할 수 없습니다.');

    advanceTo(battle1.me.nextActionAt);
    battle1.me.snapshot.stats = Object.assign({}, battle1.me.snapshot.stats, {
        cmb: 1, maxCmb: 2, fireAtk: 250, waterAtk: 250, lightAtk: 250, darkAtk: 250
    });
    battle1.me.snapshot.equipment = {
        entries: [
            { name: '레인보우 프리즘', stage: 1 }, { name: '마나번 햇', stage: 1 },
            { name: '마나번 로브', stage: 1 }, { name: '마나번 트라우저', stage: 1 },
            { name: '마나번 슈즈', stage: 1 }, { name: '잿불 모자', stage: 1 }
        ],
        setCounts: { '천공의 심판': 4, '잿불의 장송곡': 4 }
    };
    const equipmentMpBefore = battle1.me.mp;
    const oppHpBefore = battle1.opp.hp;
    const originalAttackRandom = Math.random;
    Math.random = () => .5;
    const attacked = pvp.playerAttack(attacker);
    Math.random = originalAttackRandom;
    assert.ok(attacked.ok, attacked.message);
    assert.ok(battle1.opp.hp < oppHpBefore, '일반 공격은 상대 HP를 깎아야 한다.');
    const attackEvent = battle1.events[battle1.events.length - 1];
    assert.strictEqual(attackEvent.actor, 'me');
    assert.strictEqual(attackEvent.action, 'attack');
    assert.ok(attackEvent.damage > 0 && /공격 — /.test(attackEvent.text), '공격 로그가 남아야 한다.');
    assert.strictEqual(attackEvent.hits.filter(hit => hit.type == 'hit').length, 4, '연격 추가타는 실제 타격 수만큼 기본 피해로 전달돼야 한다.');
    assert.ok(attackEvent.hits.some(hit => hit.type == 'additional' && hit.label == '프리즘 추가 공격'), '프리즘 추가 공격은 연격 합계와 별도 수치여야 한다.');
    assert.ok(attackEvent.hits.some(hit => hit.type == 'additional' && hit.label == '추가 피해'), '추가 피해율 피해는 최종 합계와 별도 수치여야 한다.');
    assert.strictEqual(attackEvent.hits.filter(hit => hit.type != 'absorbed').reduce((sum, hit) => sum + hit.damage, 0), attackEvent.damage, 'PVP 실제 피해와 개별 표시 수치 합이 같아야 한다.');
    const baseComboHits = attackEvent.hits.filter(hit => hit.type == 'hit');
    assert.ok(attackEvent.effectIds.includes('equipment:마나번 햇') && attackEvent.effectIds.includes('equipment:잿불 모자'), '실제로 발동한 마나번/화상 장비의 개별 이펙트가 이벤트에 포함돼야 한다.');
    assert.ok(baseComboHits.slice(1).every(hit => hit.effectIds.includes('combat:연격 추가타')), '연격 추가타마다 연격 이펙트가 따로 포함돼야 한다.');
    assert.ok(attackEvent.hits.find(hit => hit.label == '프리즘 추가 공격').effectIds.includes('equipment:레인보우 프리즘'), '프리즘 추가 피해 수치에는 프리즘 전용 이펙트가 붙어야 한다.');
    assert.ok(baseComboHits[1].damage > baseComboHits[0].damage, '첫 타가 만든 화상은 같은 연격의 두 번째 타격부터 잿불 4세트 피해 증가를 적용해야 한다.');
    assert.ok(battle1.me.mp < equipmentMpBefore, 'PVP에서도 마나번 장비가 MP를 소모해야 한다.');
    assert.ok(battle1.me.runtime.equipment.manaBurnAttackBuff, 'PVP 마나번 버프가 생성돼야 한다.');
    assert.ok(battle1.me.runtime.equipment.rainbowReadyAt > clock, 'PVP 프리즘 추가타 쿨타임이 시작돼야 한다.');
    assert.ok(battle1.me.runtime.equipment.burn, 'PVP 화상이 부여돼야 한다.');
    assert.ok(battle1.me.runtime.equipment.judgment, 'PVP 천공의 심판 누적 상태가 시작돼야 한다.');
    assert.ok(battle1.me.nextActionAt >= clock + 2000 && battle1.me.nextActionAt <= clock + 3000, '행동 쿨타임은 2~3초여야 한다.');

    const tooSoon = pvp.playerAttack(attacker);
    assert.strictEqual(tooSoon.ok, false);
    assert.strictEqual(tooSoon.message, '아직 행동할 수 없습니다.');

    const savedOppNextActionAt = battle1.opp.nextActionAt;
    battle1.opp.nextActionAt = battle1.endsAt;
    battle1.opp.maxHp = 1000000000;
    battle1.opp.hp = battle1.opp.maxHp;
    const equipmentSeq = battle1.seq;
    const directAttackCountAfterHit = battle1.me.attackCount;
    const directAttackMpAfterHit = battle1.me.mp;
    advanceTo(clock + 8000);
    pvp.advanceBattle(attacker);
    const equipmentEvents = battle1.events.filter(event => event.seq > equipmentSeq);
    assert.ok(equipmentEvents.some(event => event.action == 'dot' && event.skillName == '화상' && event.damage > 0), 'PVP 화상은 2초 틱 피해를 줘야 한다.');
    assert.ok(equipmentEvents.filter(event => event.skillName == '화상').every(event => event.hits.every(hit => hit.effectIds.includes('combat:화상 틱'))), '모든 화상 틱 수치에 화상 전용 이펙트가 붙어야 한다.');
    assert.ok(equipmentEvents.some(event => event.action == 'dot' && event.skillName == '천공 폭발' && event.damage > 0), 'PVP 천공 폭발은 누적 피해를 폭발시켜야 한다.');
    assert.ok(equipmentEvents.some(event => event.action == 'dot' && event.skillName == '장송곡 폭발' && event.damage > 0), '잿불 4세트는 마지막 화상 틱 뒤에 만료 폭발을 별도 피해로 줘야 한다.');
    const lastBurnIndex = equipmentEvents.reduce((found, event, index) => event.skillName == '화상' ? index : found, -1);
    const funeralIndex = equipmentEvents.findIndex(event => event.skillName == '장송곡 폭발');
    assert.ok(funeralIndex > lastBurnIndex, '장송곡 폭발은 마지막 화상 수치가 표시된 뒤에 별도 이벤트로 나와야 한다.');
    const funeralEvent = equipmentEvents[funeralIndex];
    assert.strictEqual(funeralEvent.hits.filter(hit => hit.type != 'absorbed').reduce((sum, hit) => sum + hit.damage, 0), funeralEvent.damage, '장송곡 폭발도 표시 수치와 실제 피해가 같아야 한다.');
    assert.strictEqual(battle1.me.attackCount, directAttackCountAfterHit, '화상/천공 틱은 공격 카운터를 전진시키면 안 된다.');
    assert.strictEqual(battle1.me.mp, directAttackMpAfterHit, '화상/천공 틱은 마나번 공격 MP 회복을 발동시키면 안 된다.');
    battle1.me.nextActionAt = clock;
    const firstPrism = attackEvent.hits.find(hit => hit.label == '프리즘 추가 공격');
    const originalBuffedAttackRandom = Math.random;
    Math.random = () => .5;
    assert.ok(pvp.playerAttack(attacker).ok, '활성 마나번 버프 상태의 다음 공격이 성공해야 한다.');
    Math.random = originalBuffedAttackRandom;
    const buffedAttack = battle1.events[battle1.events.length - 1];
    const buffedPrism = buffedAttack.hits.find(hit => hit.label == '프리즘 추가 공격');
    assert.ok(firstPrism && buffedPrism && buffedPrism.damage > firstPrism.damage, '이미 활성인 마나번 공격력 버프는 다음 프리즘 추가타 수치에도 반영돼야 한다.');
    battle1.me.snapshot.equipment = { entries: [], setCounts: {} };
    battle1.me.snapshot.stats.cmb = 0;
    battle1.me.snapshot.stats.maxCmb = 0;
    battle1.me.runtime.equipment = {};
    battle1.me.nextActionAt = clock;
    battle1.opp.maxHp = battle1.opp.snapshot.stats.hp;
    battle1.opp.hp = battle1.opp.maxHp;
    battle1.opp.nextActionAt = Math.max(clock, savedOppNextActionAt);

    // --- 상대 AI도 동일한 연격/프리즘/마나번/화상/천공 경로를 사용 ---
    battle1.opp.snapshot.stats = Object.assign({}, battle1.opp.snapshot.stats, {
        cmb: 1, maxCmb: 2, fireAtk: 250, waterAtk: 250, lightAtk: 250, darkAtk: 250
    });
    battle1.opp.snapshot.equipment = {
        entries: [
            { name: '레인보우 프리즘', stage: 1 }, { name: '마나번 햇', stage: 1 },
            { name: '마나번 로브', stage: 1 }, { name: '마나번 트라우저', stage: 1 },
            { name: '마나번 슈즈', stage: 1 }, { name: '잿불 모자', stage: 1 }
        ],
        setCounts: { '천공의 심판': 4, '잿불의 장송곡': 4 }
    };
    battle1.opp.runtime.equipment = {};
    const opponentRulesBeforeParityCheck = battle1.opp.rules;
    battle1.opp.rules = [{ cond: 'always', value: null, action: 'attack', skill: null }];
    battle1.me.maxHp = 1000000000;
    battle1.me.hp = battle1.me.maxHp;
    const oppMpBefore = battle1.opp.mp;
    const opponentSeq = battle1.seq;
    battle1.opp.nextActionAt = clock;
    const originalOpponentRandom = Math.random;
    Math.random = () => .5;
    pvp.advanceBattle(attacker);
    Math.random = originalOpponentRandom;
    const opponentAttack = battle1.events.find(event => event.seq > opponentSeq && event.actor == 'opp' && event.action == 'attack');
    assert.ok(opponentAttack, '상대 일반 공격 이벤트가 발생해야 한다.');
    assert.strictEqual(opponentAttack.hits.filter(hit => hit.type == 'hit').length, 4, '상대 연격도 4개의 개별 기본 피해로 전달돼야 한다.');
    assert.ok(opponentAttack.hits.some(hit => hit.label == '프리즘 추가 공격'), '상대 프리즘 추가 공격도 별도 표시돼야 한다.');
    assert.ok(opponentAttack.effectIds.includes('equipment:마나번 햇') && opponentAttack.hits.find(hit => hit.label == '프리즘 추가 공격').effectIds.includes('equipment:레인보우 프리즘'), '상대 장비 이펙트도 내 장비와 같은 경로로 전달돼야 한다.');
    const opponentBaseHits = opponentAttack.hits.filter(hit => hit.type == 'hit');
    assert.ok(opponentBaseHits[1].damage > opponentBaseHits[0].damage, '상대 첫 타의 화상도 같은 연격 후속타에 잿불 4세트 효과를 적용해야 한다.');
    assert.ok(battle1.opp.mp < oppMpBefore && battle1.opp.runtime.equipment.manaBurnAttackBuff, '상대 마나번도 MP를 소모하고 버프를 생성해야 한다.');
    assert.ok(battle1.opp.runtime.equipment.burn, '상대 화상도 부여돼야 한다.');
    assert.ok(battle1.opp.runtime.equipment.judgment, '상대 천공의 심판도 누적돼야 한다.');
    const opponentAttackCountAfterHit = battle1.opp.attackCount;
    const opponentMpAfterHit = battle1.opp.mp;
    const opponentEquipmentSeq = battle1.seq;
    battle1.opp.nextActionAt = battle1.endsAt;
    advanceTo(clock + 8000);
    pvp.advanceBattle(attacker);
    const opponentEquipmentEvents = battle1.events.filter(event => event.seq > opponentEquipmentSeq && event.actor == 'opp');
    assert.ok(opponentEquipmentEvents.some(event => event.action == 'dot' && event.skillName == '화상' && event.damage > 0), '상대의 화상 틱도 실제 피해를 줘야 한다.');
    assert.ok(opponentEquipmentEvents.some(event => event.action == 'dot' && event.skillName == '천공 폭발' && event.damage > 0), '상대의 천공 폭발도 누적 피해를 별도로 줘야 한다.');
    assert.ok(opponentEquipmentEvents.some(event => event.action == 'dot' && event.skillName == '장송곡 폭발' && event.damage > 0), '상대의 잿불 4세트 만료 폭발도 별도 피해로 줘야 한다.');
    const opponentLastBurnIndex = opponentEquipmentEvents.reduce((found, event, index) => event.skillName == '화상' ? index : found, -1);
    const opponentFuneralIndex = opponentEquipmentEvents.findIndex(event => event.skillName == '장송곡 폭발');
    assert.ok(opponentFuneralIndex > opponentLastBurnIndex, '상대의 장송곡 폭발도 마지막 화상 표시 뒤에 나와야 한다.');
    assert.strictEqual(battle1.opp.attackCount, opponentAttackCountAfterHit, '상대의 지속/폭발 피해도 공격 카운터를 올리면 안 된다.');
    assert.strictEqual(battle1.opp.mp, opponentMpAfterHit, '상대의 지속/폭발 피해도 마나번 MP 회복을 발동시키면 안 된다.');
    battle1.opp.snapshot.equipment = { entries: [], setCounts: {} };
    battle1.opp.snapshot.stats.cmb = 0;
    battle1.opp.snapshot.stats.maxCmb = 0;
    battle1.opp.runtime.equipment = {};
    battle1.opp.rules = opponentRulesBeforeParityCheck;
    battle1.me.maxHp = battle1.me.snapshot.stats.hp;
    battle1.me.hp = battle1.me.maxHp;

    // --- 방어: 4초 지속, 10초 재사용 대기, 다른 행동을 해도 지속 시간 동안 유지 ---
    advanceTo(Math.max(battle1.me.nextActionAt, battle1.me.defendCooldownEnd));
    const defended = pvp.playerDefend(attacker);
    assert.ok(defended.ok, defended.message);
    assert.strictEqual(battle1.me.defendUntil, clock + 4000, '방어는 4초간 유지돼야 한다.');
    assert.strictEqual(battle1.me.defendCooldownEnd, clock + 10000, '방어 쿨타임은 10초여야 한다.');
    assert.ok(battle1.events.some(event => event.action == 'defend'), '방어 이벤트가 있어야 한다.');
    const defendedAt = clock;
    advanceTo(battle1.me.nextActionAt);
    assert.strictEqual(pvp.playerDefend(attacker).message, '방어 쿨타임입니다.', '방어 쿨타임 중에는 다시 방어할 수 없다.');
    // 방어 중 받는 피해 -50%: 같은 피해를 방어 중/방어 후에 넣어 비교 (변량 ±2%라 20% 이상 차이면 절반 적용으로 본다)
    {
        const savedRules = battle1.opp.rules;
        battle1.opp.rules = [{ cond: 'always', value: null, action: 'attack', skill: null }]; // 비교 동안 AI는 일반 공격만
        const hpBefore = battle1.me.hp;
        battle1.opp.nextActionAt = clock;
        pvp.advanceBattle(attacker); // 방어 중 AI 공격
        const guardedLoss = hpBefore - battle1.me.hp;
        assert.ok(guardedLoss >= 0);
        battle1.me.hp = hpBefore;
        clock = defendedAt + 4001;
        battle1.opp.nextActionAt = clock;
        pvp.advanceBattle(attacker); // 방어 종료 후 AI 공격
        const openLoss = hpBefore - battle1.me.hp;
        battle1.me.hp = hpBefore;
        assert.ok(pvp.buildBattleView(attacker, -1).me.defending === false, '4초가 지나면 방어가 풀려야 한다.');
        assert.ok(guardedLoss > 0 && openLoss > 0, 'AI 일반 공격이 두 번 모두 들어가야 한다.');
        assert.ok(guardedLoss < openLoss * 0.8, '방어 중 피해(' + guardedLoss + ')는 방어 후 피해(' + openLoss + ')보다 확실히 작아야 한다.');
        battle1.opp.rules = savedRules;
    }

    // --- 스킬 (보호막) ---
    advanceTo(Math.max(battle1.me.nextActionAt, battle1.me.skillCooldowns['글버지']));
    const mpBefore = battle1.me.mp;
    const skilled = pvp.playerSkill(attacker, '글버지');
    assert.ok(skilled.ok, skilled.message);
    assert.ok(battle1.me.mp < mpBefore, '스킬은 MP를 소모해야 한다.');
    assert.ok(battle1.me.skillCooldowns['글버지'] > clock, '스킬 쿨타임이 설정돼야 한다.');
    assert.ok(battle1.me.shield && battle1.me.shield.amount > 0, '글버지는 보호막을 부여해야 한다.');
    assert.ok(battle1.events.some(event => event.action == 'shield'), '보호막 이벤트가 있어야 한다.');

    advanceTo(battle1.me.nextActionAt);
    const onCooldown = pvp.playerSkill(attacker, '글버지');
    assert.strictEqual(onCooldown.ok, false);
    assert.strictEqual(onCooldown.message, '스킬 쿨타임입니다.');
    assert.strictEqual(pvp.playerSkill(attacker, '없는스킬').message, '사용할 수 없는 스킬입니다.');

    // --- AI 캐치업 ---
    const seqBefore = battle1.seq;
    battle1.me.hp = battle1.me.maxHp; // 캐치업 구간 동안 KO되지 않도록 체력을 채운다
    advanceTo(clock + 24000);
    pvp.advanceBattle(attacker);
    const newEvents = battle1.events.filter(event => event.seq > seqBefore);
    assert.ok(newEvents.length >= 5, 'AI가 밀린 시간만큼 행동해야 한다.');
    assert.ok(newEvents.some(event => event.actor == 'opp'), 'AI 행동 이벤트가 있어야 한다.');
    assert.ok(newEvents.every(event => event.at <= clock), '이벤트 시각은 현재 시각을 넘지 않아야 한다.');
    for (let i = 1; i < newEvents.length; i++) {
        assert.ok(newEvents[i].at >= newEvents[i - 1].at, '이벤트는 시간 순서대로 처리돼야 한다.');
        assert.strictEqual(newEvents[i].seq, newEvents[i - 1].seq + 1, 'seq는 1씩 증가해야 한다.');
    }
    assert.ok(newEvents.some(event => event.action == 'dot'), '유서새김 표식의 지속 피해 틱이 발생해야 한다.');
    assert.ok(battle1.me.hp < battle1.me.maxHp, 'AI 공격으로 내 HP가 줄어야 한다.');

    const view = pvp.buildBattleView(attacker, seqBefore);
    assert.strictEqual(view.active, true);
    assert.strictEqual(view.events.length, newEvents.length, 'since 이후 이벤트만 내려가야 한다.');
    assert.ok(view.me.name && view.opp.name && view.me.maxHp > 0, '전투 뷰가 채워져야 한다.');
    assert.ok(Array.isArray(view.me.skills) && view.me.skills.length >= 2);
    assert.ok(battle1.events.length <= 60, '이벤트는 최근 60개만 유지해야 한다.');

    // --- KO 승리 + 레이팅 반영 ---
    const defender1 = fakeDb[slotNames[0]];
    const myRatingBefore = attacker.pvp.rating;
    const oppRatingBefore = defender1.pvp ? defender1.pvp.rating : 1000;
    battle1.opp.hp = 1;
    advanceTo(battle1.me.nextActionAt);
    const finishing = pvp.playerAttack(attacker);
    assert.ok(finishing.ok, finishing.message);
    assert.strictEqual(battle1.phase, 'ended');
    assert.strictEqual(battle1.result.outcome, 'win');
    assert.strictEqual(battle1.result.reason, 'ko');
    assert.ok(battle1.events.some(event => event.action == 'ko'), 'KO 이벤트가 있어야 한다.');
    assert.strictEqual(attacker.pvp.rating, myRatingBefore + battle1.result.ratingDelta);
    assert.ok(battle1.result.ratingDelta > 0, '승리 시 레이팅이 올라야 한다.');
    assert.strictEqual(battle1.result.oppRatingDelta, -battle1.result.ratingDelta);
    assert.strictEqual(attacker.pvp.wins, 1);
    assert.strictEqual(attacker.pvp.history[0].role, 'attack');
    assert.strictEqual(attacker.pvp.history[0].result, 'win');
    const foughtSlot = attacker.pvp.daily.opponents.find(slot => slot.name == slotNames[0]);
    assert.strictEqual(foughtSlot.result, 'win');
    assert.strictEqual(foughtSlot.ratingDelta, battle1.result.ratingDelta);
    assert.strictEqual(battle1.result.oppRatingBefore, oppRatingBefore);
    assert.strictEqual(battle1.result.oppRatingAfter, oppRatingBefore - battle1.result.ratingDelta, '결과에 방어측 레이팅 변화가 담겨야 한다.');
    assert.strictEqual(foughtSlot.rating, battle1.result.oppRatingAfter, '상대 슬롯 표시 레이팅도 갱신돼야 한다.');

    await flush();
    assert.strictEqual(defender1.pvp.rating, oppRatingBefore - battle1.result.ratingDelta, '상대 레이팅도 반대로 움직여야 한다.');
    assert.strictEqual(defender1.pvp.losses, 1);
    assert.strictEqual(defender1.pvp.history[0].role, 'defense');
    assert.strictEqual(defender1.pvp.history[0].result, 'lose');
    assert.ok(defender1.saveCalls > 0, '상대 레코드는 자기 큐에서 저장돼야 한다.');
    assert.strictEqual(attacker.saveCalls, 0, '공격자 저장은 라우트가 담당하므로 엔진에서 저장하면 안 된다.');

    pvp.closeBattle(attacker);
    assert.strictEqual(attacker.pvp.battle, null, '종료된 전투는 close로 정리돼야 한다.');
    assert.strictEqual((await pvp.startBattle(attacker, slotNames[0])).message, '이미 대결한 상대입니다.');

    // --- 시간 초과: HP 비율이 높은 쪽 승리 ---
    const battle2 = await openBattle(slotNames[1]);
    const duplicate = await pvp.startBattle(attacker, slotNames[2]);
    assert.strictEqual(duplicate.ok, false, '진행 중인 전투가 있으면 새 전투를 시작할 수 없다.');
    assert.strictEqual(duplicate.message, '이미 진행 중인 전투가 있습니다.');
    clock = BASE + 3000;
    pvp.advanceBattle(attacker);
    battle2.opp.nextActionAt = battle2.endsAt; // AI 행동을 멈춰 판정만 검증한다
    battle2.me.hp = 2000;
    battle2.opp.hp = 1000;
    advanceTo(battle2.endsAt + 1);
    pvp.advanceBattle(attacker);
    assert.strictEqual(battle2.phase, 'ended');
    assert.strictEqual(battle2.result.reason, 'timeout');
    assert.strictEqual(battle2.result.outcome, 'win', 'HP 비율이 높은 쪽이 판정승해야 한다.');
    assert.ok(battle2.events.some(event => event.action == 'timeout'));
    await flush();
    pvp.closeBattle(attacker);

    // --- 시간 초과 동률: 방어자 승리 ---
    const battle3 = await openBattle(slotNames[2]);
    clock = BASE + 3000;
    pvp.advanceBattle(attacker);
    battle3.opp.nextActionAt = battle3.endsAt;
    advanceTo(battle3.endsAt + 1);
    pvp.advanceBattle(attacker);
    assert.strictEqual(battle3.result.reason, 'timeout');
    assert.strictEqual(battle3.result.outcome, 'lose', '동률이면 방어자가 승리해야 한다.');
    assert.ok(battle3.result.ratingDelta < 0);
    await flush();
    pvp.closeBattle(attacker);

    // --- 전투 포기 ---
    const battle4 = await openBattle(slotNames[3]);
    advanceTo(BASE + 4000);
    const forfeited = pvp.forfeit(attacker);
    assert.ok(forfeited.ok);
    assert.strictEqual(battle4.result.reason, 'forfeit');
    assert.strictEqual(battle4.result.outcome, 'lose');
    assert.ok(battle4.events.some(event => event.action == 'forfeit'));
    await flush();
    pvp.closeBattle(attacker);

    // --- KO 패배 ---
    const battle5 = await openBattle(slotNames[4]);
    clock = BASE + 3000;
    pvp.advanceBattle(attacker);
    battle5.me.hp = 1;
    advanceTo(battle5.opp.nextActionAt);
    pvp.advanceBattle(attacker);
    assert.strictEqual(battle5.phase, 'ended');
    assert.strictEqual(battle5.result.reason, 'ko');
    assert.strictEqual(battle5.result.outcome, 'lose');
    await flush();
    pvp.closeBattle(attacker);

    assert.strictEqual(attacker.pvp.wins, 2);
    assert.strictEqual(attacker.pvp.losses, 3);
    assert.ok(attacker.pvp.rating >= 0, '레이팅은 0 밑으로 내려가지 않아야 한다.');
    assert.strictEqual((await pvp.startBattle(attacker, slotNames[0])).ok, false, '하루 5회를 모두 사용하면 더 싸울 수 없다.');

    // --- 플레이 보상: 승패/사유와 무관하게 전투마다 1개, 표의 아이템만, 인벤토리에 실제 지급 ---
    [battle1, battle2, battle3, battle4, battle5].forEach(battle => {
        assert.ok(battle.result.reward && REWARD_NAMES.has(battle.result.reward.name), '전투마다 보상 표의 아이템이 지급돼야 한다: ' + JSON.stringify(battle.result.reward));
        assert.strictEqual(battle.result.reward.count, 1);
    });
    assert.strictEqual(attacker.inventory.item.reduce((sum, entry) => sum + Number(entry.count || 0), 0), 5, '보상 5개가 인벤토리에 들어가야 한다.');
    assert.ok(attacker.inventory.item.every(entry => REWARD_NAMES.has(FAKE_ITEMS[entry.id].name)));
    assert.ok(attacker.pvp.history.every(entry => REWARD_NAMES.has(entry.reward)), '전적에도 보상 이름이 기록돼야 한다.');
    assert.ok(attacker.pvp.daily.opponents.every(slot => REWARD_NAMES.has(slot.reward)));

    // --- 유료 추가 플레이 (10가넷, 하루 2회, 이미 대결한 상대와 재대결 허용) ---
    attacker.garnet = 5;
    const poor = await pvp.buyExtraPlay(attacker);
    assert.strictEqual(poor.ok, false);
    assert.strictEqual(poor.message, '가넷이 부족합니다. (10가넷 필요)');
    attacker.garnet = 25;
    const extra1 = await pvp.buyExtraPlay(attacker);
    assert.ok(extra1.ok, extra1.message);
    assert.strictEqual(attacker.garnet, 15, '추가 플레이 1회에 가넷 10을 내야 한다.');
    assert.strictEqual(attacker.pvp.daily.opponents.length, 6);
    assert.strictEqual(attacker.pvp.daily.opponents[5].kind, 'extra');
    assert.strictEqual(attacker.pvp.daily.opponents[5].result, null);
    assert.strictEqual(extra1.daily.battlesMax, 6);
    assert.strictEqual(extra1.daily.extraUsed, 1);
    const extra2 = await pvp.buyExtraPlay(attacker);
    assert.ok(extra2.ok, extra2.message);
    assert.strictEqual(attacker.garnet, 5);
    assert.strictEqual(attacker.pvp.daily.opponents.length, 7);
    const extra3 = await pvp.buyExtraPlay(attacker);
    assert.strictEqual(extra3.ok, false, '추가 플레이는 하루 2회까지다.');
    assert.strictEqual(attacker.garnet, 5, '거절된 구매는 가넷을 차감하지 않아야 한다.');
    // 재대결: 같은 이름의 대결 완료 슬롯이 있어도 새 추가 슬롯으로 전투가 열리고 결과도 그 슬롯에 기록된다
    const extraName = attacker.pvp.daily.opponents[5].name;
    const battle6 = await openBattle(extraName);
    advanceTo(BASE + 4000);
    assert.ok(pvp.forfeit(attacker).ok);
    await flush();
    pvp.closeBattle(attacker);
    const sameName = attacker.pvp.daily.opponents.filter(slot => slot.name == extraName);
    assert.ok(sameName.length >= 2 && sameName.every(slot => slot.result), '재대결 결과는 추가 슬롯에 기록돼야 한다.');
    assert.ok(battle6.result.reward, '추가 플레이도 보상을 받아야 한다.');
    assert.strictEqual(attacker.pvp.losses, 4);

    // --- 대시보드 페이로드 ---
    const overview = await pvp.buildPvpOverview(attacker);
    assert.strictEqual(overview.ok, true);
    assert.strictEqual(overview.daily.battlesUsed, 6);
    assert.strictEqual(overview.daily.battlesMax, 7);
    assert.strictEqual(overview.daily.extraUsed, 2);
    assert.strictEqual(overview.daily.extraMax, 2);
    assert.strictEqual(overview.daily.extraCost, 10);
    assert.strictEqual(overview.daily.canBuyExtra, false);
    assert.strictEqual(overview.me.garnet, 5);
    assert.strictEqual(overview.daily.canRefresh, false);
    assert.strictEqual(overview.me.name, attacker.name);
    assert.strictEqual(overview.me.rating, attacker.pvp.rating);
    assert.ok(overview.ranking.length <= 3 && overview.ranking.length > 0, '랭킹은 최대 3명이어야 한다.');
    assert.deepStrictEqual(overview.ranking.map(entry => entry.rank), overview.ranking.map((entry, index) => index + 1));
    assert.ok(overview.ranking.every((entry, index) => index == 0 || overview.ranking[index - 1].rating >= entry.rating), '랭킹은 레이팅 내림차순이어야 한다.');
    assert.strictEqual(overview.defense.maxSlots, 5);
    assert.strictEqual(overview.defense.slotCards.length, 5);
    assert.ok(Array.isArray(overview.defense.rules) && overview.defense.rules.length > 0);
    assert.ok(Array.isArray(overview.cards) && overview.cards.every(card => card.sig && card.location));
    assert.strictEqual(overview.history.length, 6);
    assert.ok(overview.history.every(entry => REWARD_NAMES.has(entry.reward)));
    assert.strictEqual(overview.battle, null);

    // --- 동시각 양측 예약 피해: me 삽입 순서에 관계없이 상대 효과까지 해석 ---
    const simultaneousBattle = JSON.parse(JSON.stringify(battle6));
    const simultaneousAt = clock + 1000;
    simultaneousBattle.phase = 'fight';
    simultaneousBattle.startedAt = clock;
    simultaneousBattle.endsAt = simultaneousAt + 10000;
    simultaneousBattle.lastAdvancedAt = clock;
    simultaneousBattle.seq = 0;
    simultaneousBattle.events = [];
    simultaneousBattle.result = null;
    [simultaneousBattle.me, simultaneousBattle.opp].forEach(side => {
        side.snapshot.stats = Object.assign({}, side.snapshot.stats, { atk: 100, def: 0, pnt: 0, crit: 0, cmb: 0, maxCmb: 0, avd: 0, takenDamage: 0, damageBonus: 0, finalDamage: 0, extraDamage: 0 });
        side.snapshot.staticAtkPlus = 0;
        side.snapshot.slotEffects = Object.assign({}, STUB_SLOT_EFFECTS);
        side.snapshot.equipment = { entries: [], setCounts: {} };
        side.snapshot.passiveIds = [];
        side.maxHp = 1000;
        side.maxMp = 1000;
        side.mp = 1000;
        side.shield = null;
        side.nextActionAt = simultaneousBattle.endsAt;
        side.runtime = { buffs: {}, nmmStacks: 0, sivalonCharge: 0, sivalon: null, gunryeok: null, summon: null, mark: null, equipment: { burn: { tickDamage: 100, nextTickAt: simultaneousAt, until: simultaneousAt } } };
    });
    simultaneousBattle.me.hp = 200;
    simultaneousBattle.opp.hp = 50;
    simultaneousBattle.opp.runtime.equipment.dragonRegen = { ticksLeft: 1, nextTickAt: simultaneousAt };
    attacker.pvp.battle = simultaneousBattle;
    advanceTo(simultaneousAt);
    pvp.advanceBattle(attacker);
    const simultaneousBurns = simultaneousBattle.events.filter(event => event.action == 'dot' && event.skillName == '화상');
    const simultaneousRegen = simultaneousBattle.events.find(event => event.actor == 'opp' && event.action == 'heal');
    assert.ok(simultaneousRegen && simultaneousRegen.seq < simultaneousBurns[0].seq, '같은 ms의 불굴 재생은 양측 예약 피해보다 먼저 처리해 삽입 순서에 따른 부활 편향을 막아야 한다.');
    assert.deepStrictEqual(simultaneousBurns.map(event => event.actor), ['me', 'opp'], '내 화상이 먼저 KO를 내더라도 같은 ms의 상대 화상도 반드시 적용돼야 한다.');
    assert.ok(simultaneousBurns.every(event => event.hits.filter(hit => hit.type != 'absorbed').reduce((sum, hit) => sum + hit.damage, 0) == event.damage), '동시각 양측 화상도 각 표시 수치 합과 실제 피해가 같아야 한다.');
    assert.strictEqual(simultaneousBattle.result.outcome, 'win');
    await flush();
    pvp.closeBattle(attacker);

    console.log('pvp_engine.test.js: OK');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
