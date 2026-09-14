const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const characters = require('../DB/RPGenius/CharacterCards.json');
const awakening = require('../card_awakening');
const items = [...require('../scripts/init_awakening_items').definitions, ...require('../DB/RPGenius/Item.json').filter(i => ['캐릭터 변환석', '[7월]만능 캐릭터 변환석'].includes(i.name))];
const writes = [];
// 실제 게임 모듈을 사용하되 모든 DB 입출력은 격리한다. 환경 파일을 읽지 않는다.
DynamoDBDocumentClient.prototype.send = async command => {
    const input = command.input;
    if (command.constructor.name === 'GetCommand') {
        if (input.TableName !== 'rpgenius_data') return {};
        const file = path.join(__dirname, '../DB/RPGenius', input.Key.key + '.json');
        return { Item: { data: input.Key.key === 'Item' ? structuredClone(items) : fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {} } };
    }
    if (command.constructor.name === 'ScanCommand') return { Items: [] };
    if (['UpdateCommand', 'PutCommand'].includes(command.constructor.name)) { writes.push(structuredClone(input)); return {}; }
    throw new Error('Unexpected isolated DB command: ' + command.constructor.name);
};
const rpg = require('../rpgenius');
const party = require('../partyquest').__test;
const pvp = require('../pvp');
const card = (name, star = 4, type = '각성') => ({ id: characters.findIndex(c => c.name === name), star, type });
const passive = (name, star) => awakening.getPassive(card(name, star));
function user(name, star = 4, type = '각성') {
    const u = new rpg.RPGUser('각성테스트-' + name, 'awakening-' + name);
    u.main_card = card(name, star, type); u.equipments = {}; u.need_character_card_select = false;
    u.hp = u.mp = 100000; u.avatarMigrated = true;
    return u;
}
async function rolls(value, fn) {
    const original = Math.random; let i = 0;
    Math.random = () => Array.isArray(value) ? value[i++ % value.length] : value;
    try { return await fn(); } finally { Math.random = original; }
}
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, actual + ' ≠ ' + expected);
test.before(() => rpg.initRpgeniusData());

test('14종 × 8등급의 패시브·슬롯·스킬과 각성 이미지 레이어', () => {
    const compositor = require('../card_composite');
    for (const definition of awakening.definitions) for (let star = 4; star <= 11; star++) {
        const u = user(definition.name, star);
        assert.ok(rpg.calculateUserStats(u).awakening);
        const base = characters[u.main_card.id];
        assert.equal(rpg.getMainCardSkills(u).length, base.skills.length + base.class.skills.length);
        assert.ok(!awakening.formatPassive(u.main_card).includes('${'));
        const layers = compositor.resolveCardLayers({ name: definition.name, star, type: '각성' });
        assert.ok(layers, definition.name + ' ' + star);
        assert.ok(layers.character.includes('각성')); assert.ok(layers.background.includes('각성카드'));
        u.main_card = {}; u.card_slot = [card(definition.name, star)];
        assert.equal(rpg.calculateUserStats(u).awakening, null);
        const effects = rpg.calculateCardSlotEffects(u);
        for (const effect of definition.slots) {
            const key = effect.effect === 'basicDamageReduction' ? 'basicDamageBonus' : effect.effect;
            const sign = effect.effect === 'basicDamageReduction' ? -1 : 1;
            near(effects[key], sign * effect.values[star - 4]);
        }
    }
});

test('글렌첵·일레이나의 원래 기준 및 소수 배수, 오버라이드·진필규·안성재 공격력', () => {
    for (const [name, stat, divisor] of [['글렌첵', 'hp', 10000], ['일레이나', 'mp', 1000]]) {
        const u = user(name); u.statPointStats[stat] = divisor * 1.5;
        const normal = rpg.calculateUserStats({ ...u, main_card: { ...u.main_card, type: '전직' } });
        const awakened = rpg.calculateUserStats(u);
        assert.equal(awakened.atk, Math.round(normal.atk + normal[stat] / divisor * 20));
        near(awakening.runtimeAttackRatio({ atk: 100, hp: 10000, mp: 1000, awakening: passive(name), awakeningAttackMultiplier: 1 }, {}, 15000, 1500, 0, 0), 1.1);
    }
    near(awakening.getAttackMultiplier(passive('오버라이드', 11), 0, 0), 1.29);
    near(awakening.getAttackMultiplier(passive('진필규', 11), .4 - .1, 0), 1.18);
    near(awakening.getAttackMultiplier(passive('진필규'), -.1, 0), 1);
    near(awakening.getAttackMultiplier(passive('안성재', 11), 0, 12), 1.153);
    const jin = user('진필규'); jin.field = { buffs: { receivedDamageReduction: { value: .4, expired_at: Date.now() + 10000 }, receivedDamageMultiplier: { value: 1.1, expired_at: Date.now() + 10000 } } };
    near(rpg.calculateUserStats(jin).awakeningAttackMultiplier, 1.075);
});

test('빵귤 공격 종류 전환·첫 공격 제외·간접 피해 제외·실제 피해 기준 추가 피해', async () => {
    const stats = { atk: 1000, crit: 0, extraDamage: .5, awakening: passive('빵귤') }, runtime = {};
    for (const [kind, indirect, expected] of [['basic', false, 0], ['skill', false, .1], ['skill', false, 0], ['ultimate', true, 0], ['ultimate', false, .1], ['basic', false, .1]]) {
        const extra = { isBasic: kind === 'basic', summonAttack: indirect };
        awakening.prepareAttack(stats, runtime, {}, extra, kind, 1000);
        near(extra.awakeningExtraDamage || 0, expected);
        awakening.prepareAttack(stats, runtime, {}, extra, kind, 1000);
        near(extra.awakeningExtraDamage || 0, expected);
    }
    await rolls(.5, () => {
        const base = rpg.calculateAttackHitResult(1000, 200, 0, stats, {}, {}, {});
        const bonus = rpg.calculateAttackHitResult(1000, 200, 0, stats, {}, { awakeningExtraDamage: .1 }, {});
        assert.equal(bonus.finalDamage, base.finalDamage + Math.round(base.finalDamage * .1));
        assert.equal(bonus.damageComponents.reduce((sum, c) => sum + c.damage, 0), bonus.finalDamage);
    });
});

test('뭔마 연격 독립 추첨, 켄시 치확 감소, 마쉐비 수속성, 딜러장 확정 치명타', async () => {
    await rolls([0, .5, .5, .99, .5, .5], () => {
        const hits = rpg.calculateAttackHitResult(1000, 0, 0, { crit: 0, awakening: passive('뭔마') }, {}, { isBasic: true, comboHitCount: 2 }, {});
        assert.deepEqual(hits.hitDamages, [2000, 1000]);
    });
    near(awakening.skillCritMultiplier(card('켄시', 11)), .67);
    for (const [name, expected] of [['마쉐비', '수'], ['딜러장', true]]) {
        const extra = { isBasic: true, attackElement: '화' };
        awakening.prepareAttack({ awakening: passive(name) }, {}, {}, extra, 'basic', 0);
        assert.equal(name === '마쉐비' ? extra.attackElement : extra.forceCritical, expected);
    }
});

test('제우스 및 켄시 슬롯 최종 피해는 치명타 여부에 맞춰 반영', async () => {
    await rolls(.5, () => {
        const stats = { crit: 0, critMul: 1.5, awakening: passive('제우스'), criticalFinalDamage: .12 };
        const hit = extra => rpg.calculateAttackHitResult(1000, 0, 0, stats, {}, extra, {}).finalDamage;
        assert.equal(hit({}), 750);
        assert.equal(hit({ forceCritical: true }), 2055);
    });
    near(awakening.summonMultiplier({ awakening: passive('이익태', 11) }), 1.6);
});

test('흠시원 최초 타격·파티 공유·최고 수치·4초 갱신·대상 분리', () => {
    const target = {}, second = {}, extra = {};
    awakening.prepareAttack({ awakening: passive('흠시원', 11) }, {}, target, extra, 'basic', 1000);
    near(extra.awakeningCritChanceBonus, .08);
    awakening.prepareAttack({ awakening: passive('흠시원') }, {}, target, {}, 'basic', 2000);
    assert.deepEqual(target.awakeningCriticalResistance, { value: .08, until: 6000 });
    awakening.prepareAttack({}, {}, target, extra, 'basic', 5999); near(extra.awakeningCritChanceBonus, .08);
    awakening.prepareAttack({}, {}, second, extra, 'basic', 5999); assert.equal(extra.awakeningCritChanceBonus, undefined);
    awakening.prepareAttack({}, {}, target, extra, 'basic', 6000); assert.equal(extra.awakeningCritChanceBonus, undefined);
    awakening.prepareAttack({ awakening: passive('흠시원') }, {}, second, extra, 'basic', 6001); near(extra.awakeningCritChanceBonus, .01);
});

test('타이란트 HP 1·3초 무적·210초 재사용·전멸 예외 및 저장 후 카드 교체', async () => {
    const state = {}, p = passive('타이란트');
    assert.equal(awakening.resolveSurvival(p, state, 100, 0, 1000), 1);
    assert.equal(awakening.resolveSurvival(p, state, 1, 0, 3999), 1);
    assert.equal(awakening.resolveSurvival(p, state, 1, 0, 4000), 0);
    assert.equal(awakening.resolveSurvival(p, state, 100, 0, 211000), 1);
    assert.equal(awakening.resolveSurvival(p, state, 100, 0, 211001, true), 0);
    assert.equal(awakening.resolveSurvival(p, state, 0, 0, 211001), 0);
    const untouched = {}; assert.equal(awakening.resolveSurvival(p, untouched, 1, 1, 1000), 1); assert.deepEqual(untouched, {});
    const u = user('타이란트'); await u.save();
    const stats = rpg.calculateUserStats(u);
    assert.equal(rpg.resolveAwakeningHp(u.name, stats, 100, 0, 1000), 1);
    u.main_card = card('빵귤'); u.field = null; await u.save();
    const saved = await rpg.getRPGUserByName(u.name);
    assert.equal(saved.awakeningSurvival.readyAt, 211000);
    assert.equal(rpg.resolveAwakeningHp(u.name, stats, 100, 0, 4000), 0);
});

test('각성조합 3장·6재료 소모와 잘못된 조합의 무차감', () => {
    const u = user('빵귤'); u.inventory.card = [card('빵귤', 4, '전직'), card('빵귤', 4, '전직'), card('빵귤', 4, '전직')];
    u.inventory.item = items.slice(0, 6).map((_, id) => ({ id, count: 1 }));
    const before = structuredClone(u.inventory);
    for (const numbers of [[1, 1, 2], [1, 2], [1, 2, 4]]) assert.ok(rpg.runAwakeningCombine(u, numbers).error);
    assert.deepEqual(u.inventory, before);
    u.inventory.card[2].type = '각성'; assert.ok(rpg.runAwakeningCombine(u, [1, 2, 3]).error);
    u.inventory = structuredClone(before); u.inventory.item[5].count = 0;
    assert.ok(rpg.runAwakeningCombine(u, [1, 2, 3]).error); assert.equal(u.inventory.card.length, 3);
    u.inventory = structuredClone(before);
    assert.deepEqual(rpg.runAwakeningCombine(u, [1, 2, 3]).resultCard, card('빵귤'));
    assert.deepEqual(u.inventory.card, [card('빵귤')]); assert.equal(u.inventory.item.length, 0);
    assert.ok(rpg.runAwakeningCombine(u, [1, 2, 3]).error);
});

test('견고함과 빅뱅 동시 장착·일반 타입 유지·메인 전용 스탯', async () => {
    const u = user('빵귤', 4, '일반');
    const before = rpg.calculateUserStats(u);
    u.inventory.card = [{ ...u.main_card, specter: '빅뱅 스펙터' }]; u.main_card = {};
    rpg.addInventoryItem(u, 6, 1);
    assert.match(await rpg.useItem(u, '견고함 스펙터', 1), /카드/);
    assert.match(rpg.resolveWebItemUsePending(u, 1), /부여했습니다/);
    u.main_card = u.inventory.card.pop();
    assert.equal(u.main_card.type, '일반'); assert.equal(u.main_card.specter, '빅뱅 스펙터'); assert.equal(u.main_card.awakeningSpecter, '견고함 스펙터');
    const after = rpg.calculateUserStats(u);
    assert.equal(after.hp - before.hp, 100); near(after.pntPercent - before.pntPercent, .05); near(after.crit - before.crit, .05); near(after.cooldown - before.cooldown, .05);
    assert.equal(after.awakening, null); assert.equal(rpg.getMainCardSkills(u).at(-1).skill.name, '빅뱅');
    assert.match(rpg.formatSpecterLines(rpg.getCardAwakeningSpecter(u.main_card), 4).join('\n'), /100/);
});

test('각성 스펙터의 전직 카드 대상 선택·부여·교체 및 전직 스킬 유지', async () => {
    const u = user('빵귤', 4, '전직');
    const before = rpg.calculateUserStats(u);
    const skills = rpg.getMainCardSkills(u);
    u.inventory.card = [card('빵귤'), { ...u.main_card }, card('빵귤', 4, '일반')];
    rpg.addInventoryItem(u, 6, 2);
    assert.match(await rpg.useItem(u, '견고함 스펙터', 1), /일반·전직/);
    const pending = rpg.getWebItemUsePending(u);
    assert.deepEqual(pending.options.map(option => option.value), [2, 3]);
    assert.match(pending.description, /일반·전직/);
    const cards = structuredClone(u.inventory.card);
    assert.match(rpg.resolveWebItemUsePending(u, 1), /일반·전직 카드에만/);
    assert.deepEqual(u.inventory.card, cards);
    assert.match(rpg.resolveWebItemUsePending(u, 2), /부여했습니다/);
    assert.equal(rpg.getInventoryItemCount(u, 6), 1);
    u.main_card = u.inventory.card[1];
    assert.equal(u.main_card.type, '전직');
    assert.equal(u.main_card.awakeningSpecter, '견고함 스펙터');
    const after = rpg.calculateUserStats(u);
    assert.equal(after.hp - before.hp, 100);
    near(after.pntPercent - before.pntPercent, .05);
    near(after.crit - before.crit, .05);
    near(after.cooldown - before.cooldown, .05);
    assert.deepEqual(rpg.getMainCardSkills(u), skills);
    assert.equal(after.awakening, null);
    assert.equal(rpg.getCardAwakeningSpecter({ ...u.main_card, type: '각성' }), null);
    await rpg.useItem(u, '견고함 스펙터', 1);
    assert.match(rpg.resolveWebItemUsePending(u, 2), /교체하시겠습니까/);
    assert.equal(rpg.getWebItemUsePending(u).confirmOnly, true);
    assert.match(rpg.resolveWebItemUsePending(u, 2, true), /부여했습니다/);
    assert.equal(rpg.getInventoryItemCount(u, 6), 0);
    assert.equal(rpg.calculateUserStats(u).hp, after.hp);
});

test('전직 타입 스펙터는 전직·각성 카드 대상에서 제외하고 직접 선택도 차단', () => {
    const u = user('빵귤');
    u.inventory.card = [card('빵귤', 4, '전직'), card('빵귤'), card('빵귤', 4, '일반')];
    u.pendingAction = { type: '스펙터부여', specterName: '빅뱅 스펙터' };
    assert.deepEqual(rpg.getWebItemUsePending(u).options.map(option => option.value), [3]);
    assert.match(rpg.resolveWebItemUsePending(u, 1), /일반 카드에만/);
    assert.match(rpg.resolveWebItemUsePending(u, 2), /일반 카드에만/);
    assert.equal(u.inventory.card[0].specter, undefined);
    assert.equal(u.inventory.card[1].specter, undefined);
    assert.match(rpg.resolveWebItemUsePending(u, 3), /부여했습니다/);
    assert.equal(u.inventory.card[2].specter, '빅뱅 스펙터');
});

test('스펙터 보석 합성은 두 독립 영역에만 표시되고 캐시가 부여 상태를 구분한다', () => {
    const compositor = require('../card_composite');
    const spec = { name: '빵귤', star: 11, type: '일반' };
    const base = compositor.decodePng(compositor.composeCardImage(spec));
    const job = compositor.decodePng(compositor.composeCardImage({ ...spec, specter: true }));
    const awake = compositor.decodePng(compositor.composeCardImage({ ...spec, awakeningSpecter: true }));
    const bothBuffer = compositor.composeCardImage({ ...spec, specter: true, awakeningSpecter: true });
    const both = compositor.decodePng(bothBuffer);
    let jobChanges = 0, awakeningChanges = 0;
    for (let y = 0; y < base.height; y++) for (let x = 0; x < base.width; x++) {
        const offset = (y * base.width + x) * 4;
        const inColumn = x >= base.width - 80 && x < base.width - 16;
        const inJob = inColumn && y >= 20 && y < 84;
        const inAwakening = inColumn && y >= 94 && y < 158;
        const original = base.rgba.readUInt32BE(offset);
        const actual = both.rgba.readUInt32BE(offset);
        assert.equal(actual, (inJob ? job : inAwakening ? awake : base).rgba.readUInt32BE(offset));
        if (inJob && actual !== original) jobChanges++;
        if (inAwakening && actual !== original) awakeningChanges++;
    }
    assert.ok(jobChanges > 0 && awakeningChanges > 0);
    assert.equal(compositor.composeCardImage({ ...spec, specter: true, awakeningSpecter: true }), bothBuffer);
    assert.deepEqual(compositor.decodePng(compositor.composeCardImage(spec)).rgba, base.rgba);
});

test('각성 카드 등급 상승 및 일반 변환석 차단·만능 변환석 각성 유지', async () => {
    const u = user('빵귤'); u.gold = 1e10;
    u.inventory.card = [card('빵귤'), card('빵귤'), card('빵귤')];
    u.pendingAction = { type: '카드조합', numbers: [1, 2, 3] };
    await rolls(0, () => assert.ok(!rpg.runCardCombine(u).startsWith('❌')));
    assert.deepEqual(u.inventory.card, [card('빵귤', 5)]);
    for (const name of ['캐릭터 변환석', '[7월]만능 캐릭터 변환석']) {
        const id = items.findIndex(i => i.name === name); rpg.addInventoryItem(u, id, 1);
        await rpg.useItem(u, name, 1);
        if (name === '캐릭터 변환석') {
            assert.equal(rpg.getWebItemUsePending(u).options.length, 0);
            assert.match(rpg.resolveWebItemUsePending(u, 1), /만능 캐릭터 변환석/);
            rpg.cancelWebItemUsePending(u);
            assert.equal(rpg.getInventoryItemCount(u, id), 1);
        } else {
            await rolls(.5, () => assert.match(rpg.resolveWebItemUsePending(u, 1), /변환되었습니다/));
            assert.notEqual(u.inventory.card[0].id, card('빵귤').id);
            assert.equal(u.inventory.card[0].type, '각성'); assert.equal(u.inventory.card[0].star, 5);
        }
    }
});

test('실제 일반 사냥의 인내의 보석 0.1%와 드랍율 슬롯 적용', async () => {
    const dungeon = require('../DB/RPGenius/Dungeon.json')[0];
    for (const [withSlot, expected] of [[false, 0], [true, 1]]) {
        const u = user('빵귤'); u.level = Number(dungeon.requireLevel || 1) + 10; // 기존 레벨 드랍 배율 1배 구간
        if (withSlot) u.card_slot = [card('제우스', 11)];
        u.field = { name: dungeon.name, enteredAt: Date.now(), nextActionAt: 0, skillCooldowns: {}, killCount: 0, elite: null };
        await rolls(.0011, () => rpg.buildHuntResult(u, dungeon, dungeon.hp * 2, { isBasic: true }));
        assert.equal(rpg.getInventoryItemCount(u, 5), expected);
    }
});

test('공유 파티 엔진에서 제우스·딜러장·빵귤 패시브 동작', async () => {
    const member = { name: '파티각성', position: '메인딜러', baseSnapshot: { stats: { atk: 1000, crit: 0, critMul: 1.5 }, slotEffects: {}, mainCardSkills: [] }, runtime: { hp: 1000, hpMax: 1000, mp: 1000, mpMax: 1000, equipmentState: {}, equipmentAtkBuffs: {}, buffs: [], cooldownsUntil: {} } };
    const monster = { name: '테스트', type: 'boss', hp: 1e9, hpMax: 1e9, stats: { def: 0 }, debuffs: [] };
    const room = { questId: 'blackHodu', members: [member], monster };
    await rolls(.5, () => {
        const damage = () => party.calculateOutgoingDamage(member, monster, room, 1000, { isBasic: true });
        const normal = damage().damage;
        member.baseSnapshot.stats.awakening = passive('제우스'); assert.ok(Math.abs(damage().damage - normal * .75) <= 1);
        member.baseSnapshot.stats.awakening = passive('딜러장'); assert.equal(damage().criticalCount, 1);
        member.baseSnapshot.stats.awakening = passive('빵귤'); damage();
        const alternate = party.calculateOutgoingDamage(member, monster, room, 1000, { isSkill: true, skillName: '빙결' });
        assert.equal(alternate.damage, normal + Math.round(normal * .1));
    });
});

test('보석 드랍 경계 확률과 거래 가능 정의', async () => {
    const u = user('빵귤');
    await rolls(.049999, () => assert.ok(rpg.rollAwakeningGemDrop(u, '투지의 보석', .05)));
    await rolls(.05, () => assert.equal(rpg.rollAwakeningGemDrop(u, '투지의 보석', .05), null));
    await rolls(.001999, () => assert.ok(rpg.rollAwakeningGemDrop(u, '인내의 보석', .001 * 2)));
    assert.ok(items.slice(0, 6).every(item => !item.no_trade));
});

test('PVP 실제 시작·공격 경로의 확정 치명타와 생존, 승패 무관 공격자 전용 5% 보석', async () => {
    let time = Date.now(); pvp.__setNow(() => time);
    const attacker = user('딜러장'); attacker.name = 'pvp-awake-attacker'; attacker.id = attacker.name; await attacker.save();
    const defender = user('타이란트'); defender.name = 'pvp-awake-defender'; defender.id = defender.name; await defender.save();
    const state = pvp.ensurePvpState(attacker);
    state.daily.opponents = [{ name: defender.name, rating: 1000 }];
    assert.equal((await pvp.startBattle(attacker, defender.name)).ok, true);
    const battle = attacker.pvp.battle;
    time = battle.me.nextActionAt; battle.opp.nextActionAt = time + 60000;
    battle.me.snapshot.stats.atk = 1e8; battle.opp.snapshot.stats.avd = 0; battle.opp.hp = 100;
    const result = await rolls(.5, () => pvp.playerAttack(attacker));
    assert.equal(result.ok, true); assert.equal(battle.opp.hp, 1); assert.equal(battle.phase, 'fight');
    const event = battle.events.find(e => e.action === 'attack');
    assert.ok(event && event.criticalCount > 0);
    const id = items.findIndex(i => i.name === '투지의 보석');
    await rolls(.01, () => pvp.finishBattle(attacker, battle, 'win', '테스트', time));
    assert.equal(rpg.getInventoryItemCount(attacker, id), 1);
    assert.equal(pvp.buildBattleView(attacker).result.bonusReward.name, '투지의 보석');
    await rolls(.01, () => pvp.finishBattle(attacker, battle, 'win', '중복 호출', time));
    assert.equal(rpg.getInventoryItemCount(attacker, id), 1);
    const lossBattle = { ...battle, phase: 'fight', result: null };
    await rolls(.01, () => pvp.finishBattle(attacker, lossBattle, 'lose', '테스트', time));
    assert.equal(rpg.getInventoryItemCount(attacker, id), 2);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(rpg.getInventoryItemCount(await rpg.getRPGUserByName(defender.name), id), 0);
    pvp.__setNow(null);
});

test('레이드 보상 횟수가 있을 때만 용기의 보석 5%, 드랍율 보너스 제외', async () => {
    const original = rpg.getRPGUserByName;
    try {
        for (const [questId, locked] of [['blackHodu', false], ['blackHodu', true], ['butaGame', false], ['butaGameHard', true]]) {
            const u = user('빵귤'); u.save = async () => ({ success: true });
            const week = rpg.getKoreanWeekKey(new Date());
            if (locked) u.titleProgress = { hoduRewardWeek: week, hoduRewardCount: 3, butaRewardWeek: week };
            rpg.getRPGUserByName = async () => u;
            const member = { name: u.name, potions: [], position: '메인딜러', baseSnapshot: { stats: { itemDropChance: 1000 }, slotEffects: { itemDropChance: 1000 } }, runtime: { hp: 100, hpMax: 100, buffs: [], cooldownsUntil: {} } };
            const room = { id: 'test', questId, members: [member], result: {}, notices: [], combatLog: [], chatLog: [], streams: new Map(), state: 'finished' };
            await rolls(.01, () => party.grantPartyQuestClearRewards(room));
            assert.equal(rpg.getInventoryItemCount(u, 0), locked ? 0 : 1);
            assert.equal(room.result.rewards[0].weeklyLocked, locked);
        }
        const u = user('빵귤'); u.save = async () => ({ success: true });
        rpg.getRPGUserByName = async () => u;
        const room = { id: 'test', questId: 'blackHodu', chatLog: [], members: [{ name: u.name, potions: [], baseSnapshot: { stats: { itemDropChance: 1000 }, slotEffects: {} }, runtime: {} }], result: {}, streams: new Map() };
        await rolls(.05, () => party.grantPartyQuestClearRewards(room));
        assert.equal(rpg.getInventoryItemCount(u, 0), 0);
    } finally { rpg.getRPGUserByName = original; }
});

test('파티의 일반 피해에는 타이란트가 생존하고 전멸 기믹에는 사망', () => {
    const member = { name: '파티타이란트검증', potions: [], position: '탱커', baseSnapshot: { stats: { hp: 1000, awakening: passive('타이란트') }, slotEffects: {} }, runtime: { hp: 1000, hpMax: 1000, mp: 100, mpMax: 100, buffs: [], cooldownsUntil: {}, equipmentState: {} } };
    const room = { id: 'awakening-wipe-test', questId: 'blackHodu', members: [member], state: 'inProgress', startedAt: Date.now(), phaseIndex: 2, chatLog: [], combatLog: [] };
    party.applyDamageToMember(room, member, 2000, '일반 피해');
    assert.equal(member.runtime.hp, 1); assert.ok(!member.runtime.dead);
    party.applyDamageToMember(room, member, 2000, '무적 중 피해'); assert.equal(member.runtime.hp, 1);
    party.wipeParty(room, '전멸 기믹'); assert.equal(member.runtime.hp, 0); assert.equal(member.runtime.dead, true);
});
