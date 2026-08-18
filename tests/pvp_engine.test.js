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
        defending: false,
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
    pvp.evaluateRules(ruleSide({ rules: [{ cond: 'enemyDefending', action: 'skill', skill: '글버지' }, { cond: 'always', action: 'attack' }] }), ruleSide({ defending: true }), BASE),
    { action: 'skill', skillName: '글버지' },
    '상대 방어 중 조건과 지정 스킬이 동작해야 한다.');
assert.deepStrictEqual(
    pvp.evaluateRules(ruleSide({ skillCooldowns: { '글버지': BASE + 5000 }, rules: [{ cond: 'always', action: 'skill', skill: '글버지' }, { cond: 'always', action: 'defend' }] }), enemySide, BASE),
    { action: 'defend', skillName: null },
    '지정 스킬이 쿨타임이면 다음 규칙으로 넘어가야 한다.');

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

    const oppHpBefore = battle1.opp.hp;
    const attacked = pvp.playerAttack(attacker);
    assert.ok(attacked.ok, attacked.message);
    assert.ok(battle1.opp.hp < oppHpBefore, '일반 공격은 상대 HP를 깎아야 한다.');
    const attackEvent = battle1.events[battle1.events.length - 1];
    assert.strictEqual(attackEvent.actor, 'me');
    assert.strictEqual(attackEvent.action, 'attack');
    assert.ok(attackEvent.damage > 0 && /공격 — /.test(attackEvent.text), '공격 로그가 남아야 한다.');
    assert.ok(battle1.me.nextActionAt >= clock + 2000 && battle1.me.nextActionAt <= clock + 3000, '행동 쿨타임은 2~3초여야 한다.');

    const tooSoon = pvp.playerAttack(attacker);
    assert.strictEqual(tooSoon.ok, false);
    assert.strictEqual(tooSoon.message, '아직 행동할 수 없습니다.');

    // --- 방어 ---
    advanceTo(battle1.me.nextActionAt);
    const defended = pvp.playerDefend(attacker);
    assert.ok(defended.ok, defended.message);
    assert.strictEqual(battle1.me.defending, true, '방어 태세가 설정돼야 한다.');
    assert.ok(battle1.events.some(event => event.action == 'defend'), '방어 이벤트가 있어야 한다.');

    // --- 스킬 (보호막) ---
    advanceTo(battle1.me.nextActionAt);
    const mpBefore = battle1.me.mp;
    const skilled = pvp.playerSkill(attacker, '글버지');
    assert.ok(skilled.ok, skilled.message);
    assert.ok(battle1.me.mp < mpBefore, '스킬은 MP를 소모해야 한다.');
    assert.ok(battle1.me.skillCooldowns['글버지'] > clock, '스킬 쿨타임이 설정돼야 한다.');
    assert.ok(battle1.me.shield && battle1.me.shield.amount > 0, '글버지는 보호막을 부여해야 한다.');
    assert.ok(battle1.events.some(event => event.action == 'shield'), '보호막 이벤트가 있어야 한다.');
    assert.strictEqual(battle1.me.defending, false, '다른 행동을 하면 방어 태세가 풀려야 한다.');

    advanceTo(battle1.me.nextActionAt);
    const onCooldown = pvp.playerSkill(attacker, '글버지');
    assert.strictEqual(onCooldown.ok, false);
    assert.strictEqual(onCooldown.message, '스킬 쿨타임입니다.');
    assert.strictEqual(pvp.playerSkill(attacker, '없는스킬').message, '사용할 수 없는 스킬입니다.');

    // --- AI 캐치업 ---
    const seqBefore = battle1.seq;
    advanceTo(BASE + 3000 + 20000);
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

    // --- 대시보드 페이로드 ---
    const overview = await pvp.buildPvpOverview(attacker);
    assert.strictEqual(overview.ok, true);
    assert.strictEqual(overview.daily.battlesUsed, 5);
    assert.strictEqual(overview.daily.battlesMax, 5);
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
    assert.strictEqual(overview.history.length, 5);
    assert.strictEqual(overview.battle, null);

    console.log('pvp_engine.test.js: OK');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
