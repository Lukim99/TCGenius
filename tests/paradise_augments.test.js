const { test, before, afterEach, mock } = require('node:test');
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
const cardContracts = require('../paradise_contracts');
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
    const augment = corridor.AUGMENTS.find(a => a.id === id);
    // 효과 검증은 적정 전투력을 전제로 한다. 실제 등장 조건은 아래에서 별도로 검증한다.
    const power = augment && cardContracts.isCombatReward(augment)
        ? mock.method(rpg, 'calculateCombatPower', () => ({ total: corridor.recommendedPower(user.paradise.floor + augment.floors) * (augment.quest?.forceElite ? 1.2 : 1) })) : null;
    let result;
    try { result = corridor.chooseAugment(user, id, random); } finally { power?.mock.restore(); }
    // 효과 단위 테스트는 증강 후 일반 전투를 시작한다. 갈림길 API는 paradise.test에서 검증한다.
    if (user.paradise.phase === 'route') corridor.startCombat(user, 'normal', null, random);
    return result;
}
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} !== ${expected}`);

test('전투 카드 계약은 증강 이동 후 적의 전투력이 내 전투력의 80~130%일 때만 제시하고 선택한다', t => {
    let playerPower = 1000000;
    t.mock.method(rpg, 'calculateCombatPower', () => ({ total: playerPower }));
    const user = fresh();
    assert.ok(!corridor.availableAugments(user).some(a => a.id === 'deathHandshake'), '초반 과성장 상태에서는 제외');
    user.paradise.floor = 85; // 사신 선택 후 100층 엘리트: 120만
    for (const [power, allowed] of [[1500000, true], [1500001, false], [1000000, true], [900000, false]]) {
        playerPower = power;
        assert.equal(corridor.availableAugments(user).some(a => a.id === 'deathHandshake'), allowed, String(power));
    }
    playerPower = 1000000;
    user.paradise.celestial.traits = ['fragileElites']; user.paradise.celestial.elites = 1;
    assert.ok(!corridor.availableAugments(user).some(a => a.id === 'deathHandshake'), 'HP 1 엘리트는 계약 대상에서 제외');
    user.paradise.celestial.elites = 2;
    assert.ok(corridor.availableAugments(user).some(a => a.id === 'deathHandshake'));
    user.paradise.startingAugments = ['prismatic'];
    assert.ok(!corridor.availableAugments(user).some(a => cardContracts.isCombatReward(a)), '시작 증강에서는 전투 계약 제외');
    delete user.paradise.startingAugments;
    user.paradise.celestial.traits = ['halfSteps'];
    playerPower = corridor.recommendedPower(93) * 1.2;
    assert.ok(corridor.availableAugments(user).some(a => a.id === 'deathHandshake'), '절반 이동 적용');
    user.paradise.phase = 'augment'; user.paradise.choices = ['deathHandshake']; playerPower = 1e8;
    const resources = { ...corridor.getResources(user) };
    assert.ok(corridor.chooseAugment(user, 'deathHandshake').error, '저장된 선택지도 선택 시 재검증');
    assert.deepEqual(corridor.getResources(user), resources);
    assert.equal(user.paradise.acquired.deathHandshake, undefined);
    assert.equal(user.paradise.quests?.length || 0, 0);
});

test('부적합해진 계약 선택지만 같은 등급으로 바꾸고 다른 선택지·리롤·보유 계약은 보존한다', t => {
    t.mock.method(rpg, 'calculateCombatPower', () => ({ total: 1e8 }));
    const user = fresh(), run = user.paradise;
    Object.assign(run, { phase: 'augment', choices: ['stolenTurn', 'deathHandshake', 'clockHeart'], offerRarity: 'prismatic', rerolled: [false, true, false], offerSeen: ['stolenTurn', 'deathHandshake', 'clockHeart'] });
    run.contracts.push({ star: 9, type: '각성', name: '9성 각성 카드' });
    assert.equal(corridor.normalizeAugmentOffer(user, () => .99), true);
    assert.equal(run.choices[0], 'stolenTurn'); assert.equal(run.choices[2], 'clockHeart');
    assert.equal(corridor.AUGMENTS.find(a => a.id === run.choices[1]).rarity, 'prismatic');
    assert.deepEqual(run.rerolled, [false, true, false]);
    assert.equal(run.contracts[0].star, 9);
    assert.equal(corridor.normalizeAugmentOffer(user, () => .99), false);
    assert.ok(!corridor.rerollAugment(user, run.choices[0], () => .99).error);
    assert.ok(!run.choices.some(id => cardContracts.isCombatReward(corridor.AUGMENTS.find(a => a.id === id))));
});

test('카드 계약은 같은 등급 안에서 일반 증강의 35% 가중치로 최초 제시·리롤한다', () => {
    const card = { cardContract: true }, normal = {};
    assert.equal(cardContracts.pick([card, normal], () => .2592), card);
    assert.equal(cardContracts.pick([card, normal], () => .2593), normal);
    const user = fresh(), run = user.paradise;
    const remaining = ['contract', 'stolenTurn', 'revengeVault', 'clockHeart'];
    for (const a of corridor.AUGMENTS) if (!remaining.includes(a.id)) run.acquired[a.id] = 1;
    corridor.offerAugments(user, () => .20, 'prismatic');
    assert.notEqual(run.choices[0], 'contract');
    run.choices = ['clockHeart']; run.offerSeen = ['clockHeart']; run.rerolled = [false];
    assert.equal(corridor.rerollAugment(user, 'clockHeart', () => .20).error, undefined);
    assert.notEqual(run.choices[0], 'contract');
});
test('악마의 거래는 공격력 대신 추가 피해 66.6%를 적용하고 구형 획득에도 같은 효과를 낸다', t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh(), original = rpg.calculateUserStats(user);
    Object.assign(user.paradise.enemy, { hp: 1e9, maxHp: 1e9, def: 0, atk: 0 });
    rpg.buildHuntResult(user, {}, 100, { isBasic: true });
    const baseDamage = user.paradise.combatEvents.at(-1).damage;
    choose(user, 'devil');
    const stats = rpg.calculateUserStats(user);
    assert.equal(stats.atk, original.atk);
    close(stats.extraDamage - original.extraDamage, .666);
    Object.assign(user.paradise.enemy, { hp: 1e9, maxHp: 1e9, def: 0, atk: 0 });
    rpg.buildHuntResult(user, {}, 100, { isBasic: true });
    const damage = user.paradise.combatEvents.at(-1).damage;
    assert.ok(damage >= baseDamage * 1.65 && damage <= baseDamage * 1.67, `${damage} / ${baseDamage}`);
    Object.assign(corridor.getResources(user), { hp: 1, mp: 0 });
    corridor.heal(user, 1, 1);
    assert.deepEqual(corridor.getResources(user), { hp: 1, mp: 0 });
    user.paradise.effects = { atk: .25, noHealing: 1 };
    const legacy = rpg.calculateUserStats(user);
    assert.equal(legacy.atk, original.atk);
    close(legacy.extraDamage, stats.extraDamage);
});

test('복제된 축복은 제거되며 저장된 선택지에만 남아 있어도 탐험을 계속할 수 있다', () => {
    const user = fresh();
    assert.ok(!corridor.AUGMENTS.some(a => a.id === 'duplicate'));
    user.paradise.phase = 'augment'; user.paradise.choices = ['duplicate'];
    assert.deepEqual(corridor.view(user).run.choices, []);
    assert.ok(corridor.chooseAugment(user, 'duplicate').error);
    assert.ok(!corridor.continueExploration(user, () => .99).error);
    assert.equal(user.paradise.phase, 'route');
});

test('결투 계약은 공격력 25%, 새 사신 계약은 완전 회복과 8성 각성 계약을 지급하고 수락한 계약은 보존한다', () => {
    for (const legacy of [false, true]) {
        const duel = fresh(); choose(duel, 'duelistContract');
        if (legacy) duel.paradise.quests[0].reward = { star: 7, type: '일반' };
        for (let i = 0; i < 3; i++) {
            if (i) corridor.startCombat(duel, 'normal', null, () => .99);
            corridor.victory(duel, () => .99);
        }
        close(duel.paradise.effects.atk, .25); assert.equal(duel.paradise.contracts.length, 0);
        corridor.startCombat(duel, 'normal', null, () => .99); corridor.victory(duel, () => .99);
        close(duel.paradise.effects.atk, .25);
        const death = fresh(); choose(death, 'deathHandshake');
        if (legacy) death.paradise.quests[0].reward = { star: 9, type: '각성', heal: true };
        corridor.getResources(death).mp = 0;
        corridor.victory(death, () => .99);
        const stats = rpg.calculateUserStats(death);
        assert.deepEqual(corridor.getResources(death), { hp: stats.hp, mp: stats.mp });
        const star = legacy ? 9 : 8;
        assert.deepEqual(death.paradise.contracts, [{ star, type: '각성', name: `${star}성 각성 카드` }]);
    }
    const blocked = fresh(); choose(blocked, 'devil'); choose(blocked, 'deathHandshake');
    corridor.getResources(blocked).mp = 0; corridor.victory(blocked, () => .99);
    assert.deepEqual(corridor.getResources(blocked), { hp: 1, mp: 0 });
    assert.equal(blocked.paradise.contracts[0].star, 8);
});
const equipmentAdditions = corridor.AUGMENTS.filter(a => a.equipment).slice(22);
const adventure = require('../paradise_augments_adventure');
function equipped(id, stage = 1) {
    const augment = corridor.AUGMENTS.find(a => a.id === id);
    const user = fresh();
    const [slot, list] = Object.entries(data.Equipment).find(([, list]) => Array.isArray(list) && list.some(e => e.name === augment.equipment));
    const index = list.findIndex(e => e.name === augment.equipment), definition = list[index];
    user.main_card.id = definition.requireMainCard?.[0] ?? 0;
    const gear = { id: index, level: 0, transcendStage: stage };
    user.equipments[slot] = slot === 'accessory' ? { 0: gear } : gear;
    corridor.startCombat(user, 'normal', null, () => .99);
    const stats = rpg.calculateUserStats(user); corridor.getResources(user).hp = stats.hp; corridor.getResources(user).mp = stats.mp;
    return user;
}

test('장비 증강 72개는 유효 장착 조건·중복 제한을 지키며 탐험이 끝날 때까지 유지된다', () => {
    assert.equal(equipmentAdditions.length, 50);
    const originals = structuredClone(rpg.getDataCache('Equipment', {}));
    for (const augment of corridor.AUGMENTS.filter(a => a.equipment)) {
        const user = equipped(augment.id);
        // 이 장비 증강만 남겨 추첨 확률에 의존하지 않고 노출 여부를 확인한다.
        for (const other of corridor.AUGMENTS) if (other.id !== augment.id) user.paradise.acquired[other.id] = 1;
        const gear = user.equipments; user.equipments = {};
        corridor.offerAugments(user, () => 0); assert.deepEqual(user.paradise.choices, [], augment.id);
        assert.ok(choose(user, augment.id).error, augment.id);
        user.equipments = gear;
        const definition = rpg.getEquippedEquipmentData(user)[0].data;
        if (definition.requireMainCard?.length) {
            const cardId = user.main_card.id; user.main_card.id = 99;
            corridor.offerAugments(user, () => 0); assert.deepEqual(user.paradise.choices, [], augment.id);
            user.main_card.id = cardId;
        }
        corridor.offerAugments(user, () => 0); assert.deepEqual(user.paradise.choices, [augment.id]);
        assert.ok(!choose(user, augment.id).error, augment.id);
        close(corridor.equipmentMultiplier(user, augment.equipment), augment.multiplier);
        for (let i = 0; i < 5; i++) {
            corridor.startCombat(user, 'normal', null, () => .99);
            corridor.victory(user, () => .99);
            close(corridor.equipmentMultiplier(user, augment.equipment), augment.multiplier);
        }
        assert.ok(!user.paradise.choices.includes(augment.id));
        corridor.offerAugments(user); corridor.finish(user);
        assert.equal(corridor.equipmentMultiplier(user, augment.equipment), 1);
    }
    assert.deepEqual(rpg.getDataCache('Equipment', {}), originals);
});

test('기존 장비 증강은 중복 적용 없이 영구화하며 대장장이 강화만 만료되고 거울 거래는 증강을 제거한다', () => {
    const user = equipped('manaHat'), name = '마나번 햇';
    user.paradise.acquired.manaHat = 1;
    user.paradise.temporary.push(
        { id: 'manaHat', name: name + ' 강화', equipment: name, multiplier: 2, battles: 1, combatOnly: true },
        { id: 'forge', name: name + ' · 대장장이 강화', equipment: name, multiplier: 2, battles: 3 }
    );
    assert.equal(corridor.equipmentMultiplier(user, name), 4);
    assert.equal(corridor.equipmentMultiplier(user, name, 'static'), 2);
    assert.deepEqual(corridor.view(user).run.temporary.map(b => b.name), [name + ' · 대장장이 강화']);
    for (let i = 0; i < 3; i++) {
        corridor.startCombat(user, 'normal', null, () => .99); corridor.victory(user, () => .99);
        assert.equal(corridor.equipmentMultiplier(user, name), i < 2 ? 4 : 2);
    }
    const restored = structuredClone(user.paradise);
    user.paradise = restored;
    assert.equal(corridor.equipmentMultiplier(user, name), 2);
    assert.equal(corridor.equipmentMultiplier(user, name, 'static'), 1);
    user.paradise.phase = 'event'; user.paradise.event = { id: 'mirror' };
    corridor.chooseEvent(user, 'trade', {}, () => .99);
    assert.equal(corridor.equipmentMultiplier(user, name), 1);
});

test('상시·조건부 장비 패시브 증강은 1·3단계 실제 스탯을 강화하고 기본 공격력·체력·방어력은 보존한다', () => {
    const observed = {
        gungtaek: ['afterSkill'], quattro: ['extraDamage', 'critMul'], dayNight: ['fireAtk', 'darkRes', 'crit'],
        baseball: ['afterSkill', 'finalDamage'], firstFist: ['ultimateDamage', 'ultimateCooldownFlat'],
        elementBooster: ['allElementAtk', 'allElementRes', 'elementalExtraDamage'], faultyBattery: ['afterSkill'],
        emberArmor: ['fireAtk', 'fireRes'], emberPants: ['burnDamage', 'burnDurationFlat'], deepPants: ['waterAtk', 'waterRes'],
        skyArmor: ['lightFinalDamage'], skyHat: ['critLightBonus'], skyPants: ['nonCritLightBonus'],
        skyShoes: ['lightAtk', 'lightRes'], blackHat: ['darkAtk', 'darkRes'], twelveTimer: ['crit', 'afterSkill'],
        kingNecklace: ['attackBuffEfficiency'], kingRing: ['shieldEfficiency'],
        theKingmaker: ['attackBuffEfficiency', 'shieldEfficiency', 'allElementRes'], pantheon: ['pnt', 'afterSkill'],
        bloodFlow: ['bloodFlowReduction'], bloodyShoes: ['bloodyShoesExtraDamage'],
        blackArmor: ['darkRes', 'darkAtk'], blackPants: ['blackEchoSkillDamage']
    };
    assert.deepEqual(new Set(Object.keys(observed)), new Set(equipmentAdditions.filter(a => a.staticPassive).map(a => a.id)));
    for (const [id, keys] of Object.entries(observed)) for (const stage of [1, 3]) {
        const user = equipped(id, stage), before = rpg.calculateUserStats(user);
        assert.ok(!choose(user, id).error, id);
        const after = rpg.calculateUserStats(user);
        for (const key of keys) assert.ok(after[key] > before[key], `${id} ${stage} ${key}: ${before[key]} → ${after[key]}`);
        for (const key of ['atk', 'hp', 'def']) assert.equal(after[key], before[key], `${id} ${key}`);
        if (id === 'baseball') assert.ok(after.takenDamage < before.takenDamage);
        corridor.offerAugments(user); corridor.finish(user);
        assert.deepEqual(rpg.calculateUserStats(user), before, id + ' 종료 후 원상복구');
    }
});

test('발동형 장비 증강은 조건에 맞는 실제 피해·추첨·중첩 효과를 증폭한다', t => {
    t.mock.method(Math, 'random', () => .01);
    const probes = {
        manaRobe: (u, e) => u.field.equipmentState.manaBurnElementBuff.value,
        manaPants: (u, e) => u.field.equipmentState.manaBurnCritBuff.value,
        manaShoes: (u, e) => u.field.equipmentState.manaBurnExtraBuff.value,
        sageRobe: (u, e) => u.field.equipmentState.manaBurnElementBuff.value,
        ultimatumHat: (u, e) => u.field.equipmentState.ultimatumHatBuff.value,
        ultimatumArmor: (u, e) => e.receivedDamageReduction,
        ultimatumPants: (u, e) => e.pntBonus,
        ultimatumShoes: (u, e) => e.extraDamageBonus,
        conquerorHat: (u, e) => e.finalDamageBonus,
        underestimate: (u, e) => e.damageBonusMul + e.critMulBonus,
        coin: (u, e) => u.field.equipmentState.coinBuff.value,
        prison: (u, e) => e.damageBonusMul,
        bamboo: (u, e) => e.damageBonusMul + e.extraDamageBonus,
        jinsai: (u, e) => e.finalDamageBonus,
        shieldClan: (u, e) => e.damageBonusMul,
        settlementRing: (u, e) => e.damageBonusMul + e.finalDamageBonus,
        manaAmplifier: (u, e) => e.damageBonusMul + e.extraDamageBonus,
        preview: (u, e) => u.field.equipmentState.previewNextFinal,
        flowingBlood: (u, e) => u.field.equipmentState.flowingBloodNext,
        fortunePouch: (u, e) => u.field.equipmentState.fortuneExtraDamage.value,
        emberHat: (u, e) => u.field.equipmentState.burn.tickDamage
    };
    for (const [id, probe] of Object.entries(probes)) {
        const values = [];
        for (const boosted of [false, true]) {
            const user = equipped(id);
            if (boosted) assert.ok(!choose(user, id).error);
            const stats = rpg.calculateUserStats(user), state = user.field.equipmentState;
            user.paradise.enemy.hp = user.paradise.enemy.maxHp * .2;
            corridor.getResources(user).hp = Math.floor(stats.hp * .1); corridor.getResources(user).mp = stats.mp;
            user.field.enteredAt = Date.now() - 11000;
            state.trueBeomUntil = Date.now() + 10000;
            if (id !== 'bamboo') delete state.trueBeomUntil;
            if (id === 'prison') user.paradise.effects.crit = 1.5;
            if (id === 'shieldClan') require('../combat_shields').grant(user.field, { source: 'test', caster: userName, amount: 100, expiresAt: Date.now() + 10000 });
            if (id === 'flowingBlood') user.equipments.hat = { id: data.Equipment.hat.findIndex(e => e.name === '핏빛 모자'), level: 0 };
            if (id === 'fortunePouch') {
                user.main_card.id = 7;
                user.equipments.weapon = { id: data.Equipment.weapon.findIndex(e => e.name === '교촌 주머니'), level: 0 };
                // 초특급한탕 실패가 복주머니의 골드 효과를 발동한다.
                const previous = Math.random; Math.random = () => .99;
                const result = rpg.prepareTranscendSkillEffects(user, { name: '초특급한탕' }, rpg.calculateUserStats(user));
                Math.random = previous; Object.assign(state, result.state);
            }
            const extra = {};
            rpg.applyTranscendPreAttack(user, rpg.getFieldCombatContext(user), 100, extra, 'skill', { name: 'test' });
            if (id === 'emberHat') extra.afterAttackUnit({ isCritical: false });
            values.push(probe(user, extra));
        }
        const multiplier = equipmentAdditions.find(a => a.id === id).multiplier;
        assert.ok(values[0] > 0, id + ' 기본 발동');
        assert.ok(Math.abs(values[1] - values[0] * multiplier) <= (id === 'emberHat' ? 1 : 1e-8), `${id}: ${values}`);
    }
});

test('스킬 장비 증강은 발동 횟수와 확률을 보존하고 피해 수치를 강화한다', t => {
    for (const id of ['dmc', 'rottenWater', 'blackShoes', 'judgeDice']) for (const roll of [.01, .99]) {
        const user = equipped(id);
        t.mock.method(Math, 'random', () => roll);
        const probe = () => {
            const state = user.field.equipmentState;
            state.dmcSkillCount = 2; state.rottenWaterStacks = 3;
            const result = rpg.prepareTranscendSkillEffects(user, { name: 'test' }, rpg.calculateUserStats(user));
            if (id === 'blackShoes') return result.state.blackEchoShoesBuff.value;
            return id === 'dmc' ? result.extra.finalDamageBonus : id === 'rottenWater' ? result.extra.damageBonusMul : roll < .5 ? result.extra.critChanceBonus : result.extra.critMulBonus;
        };
        const before = probe(); choose(user, id);
        close(probe(), before * equipmentAdditions.find(a => a.id === id).multiplier);
        t.mock.restoreAll();
    }
});

test('해류 신발 증강은 실제 스킬의 남은 쿨타임·회복을 강화하고 회복 금지 계약을 지킨다', async t => {
    t.mock.method(Math, 'random', () => .99);
    for (const boosted of [false, true]) for (const blocked of [false, true]) {
        const user = equipped('currentShoes');
        if (boosted) choose(user, 'currentShoes');
        user.paradise.effects.noHealing = blocked ? 1 : 0;
        user.paradise.enemy.hp = user.paradise.enemy.maxHp = 1e12; user.paradise.enemy.atk = 0;
        const skill = rpg.getMainCardSkills(user)[0].skill, stats = rpg.calculateUserStats(user);
        corridor.getResources(user).mp = Math.floor(stats.mp * .5);
        const beforeMp = corridor.getResources(user).mp, at = Date.now(), multiplier = boosted ? 1.5 : 1;
        const message = await rpg.useSkillInField(user, skill.name);
        assert.ok(!message.startsWith('❌'), message);
        assert.equal(corridor.getResources(user).mp, beforeMp - skill.mp_cost + (blocked ? 0 : Math.round(stats.mp * .03 * multiplier)));
        const reduction = Math.min(5000 * multiplier, skill.cooltime * .08 * multiplier);
        assert.ok(Math.abs(user.field.skillCooldowns[skill.name] - at - (skill.cooltime - reduction)) < 200);
    }
});

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

test('새 메커니즘 증강 30개는 조건을 만족할 때 선택할 수 있고 등급이 다양하게 나온다', () => {
    assert.equal(adventure.length, 30);
    for (const augment of adventure) {
        const user = fresh();
        user.paradise.relics = ['crown', 'compass', 'ring'];
        user.paradise.contracts = [{ star: 5, type: '전직', name: '5성 전직 카드' }];
        user.equipments.weapon = { id: data.Equipment.weapon.findIndex(e => e.name === '쿠루미의 힘이 깃든 지팡이'), level: 0 };
        const result = choose(user, augment.id);
        assert.ok(!result.error, augment.id + ': ' + result.error);
        assert.equal(user.paradise.acquired[augment.id], 1);
        assert.ok(choose(user, augment.id).error);
    }
    const user = fresh(), counts = {};
    let seed = 37;
    const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 1000; i++) {
        corridor.offerAugments(user, random);
        const rarities = user.paradise.choices.map(id => corridor.AUGMENTS.find(a => a.id === id).rarity);
        assert.equal(new Set(rarities).size, 1, '세 선택지가 같은 등급으로 제시됨');
        for (const rarity of rarities) counts[rarity] = (counts[rarity] || 0) + 1;
    }
    assert.ok(counts.silver > 800 && counts.prismatic > 400 && counts.gold < 1500, JSON.stringify(counts));
});

test('계약은 승리 조건·기한을 판정하고 보상 계약과 유물을 한 번만 지급한다', () => {
    for (const id of ['basicContract', 'criticalContract', 'spellContract', 'duelistContract', 'eliteBounty', 'checkpoint', 'relicParcel', 'deathHandshake']) {
        const user = fresh(); choose(user, id);
        const quest = user.paradise.quests[0];
        if (id === 'deathHandshake') { assert.equal(corridor.getResources(user).hp, 1); assert.equal(user.paradise.enemy.kind, 'elite'); }
        for (let i = 0; i < quest.battles; i++) {
            if (i) corridor.nextEncounter(user, () => .99);
            if (id === 'eliteBounty') assert.equal(user.paradise.enemy.kind, 'elite');
            Object.assign(user.paradise.battle, { skillNames: id === 'spellContract' ? ['A', 'B'] : [], criticalHits: 2 });
            corridor.victory(user, () => .99);
            if (i + 1 < quest.battles) assert.equal(user.paradise.contracts.length, 0);
        }
        assert.equal(quest.status, 'completed', id);
        assert.match(user.paradise.rewardReveal.text, /계약 달성/);
        const rewards = structuredClone({ cards: user.paradise.contracts, relics: user.paradise.relics });
        corridor.nextEncounter(user, () => .99); corridor.victory(user, () => .99);
        assert.deepEqual({ cards: user.paradise.contracts, relics: user.paradise.relics }, rewards);
        if (quest.reward.star) assert.equal(rewards.cards[0].star, quest.reward.star);
        if (quest.reward.relics) assert.equal(rewards.relics.length, quest.reward.relics);
    }
    const failed = fresh(); choose(failed, 'basicContract');
    corridor.onSkillUsed(failed, 10, 'test');
    assert.equal(failed.paradise.quests[0].status, 'failed');
    corridor.victory(failed, () => .99); assert.equal(failed.paradise.contracts.length, 0);
    for (const id of ['criticalContract', 'spellContract', 'duelistContract']) {
        const user = fresh(); choose(user, id);
        const quest = user.paradise.quests[0];
        for (let i = 0; i < quest.battles; i++) {
            corridor.startCombat(user, 'normal', null, () => .99); user.paradise.battle.hasTakenHpDamage = true;
            corridor.victory(user, () => .99);
        }
        assert.equal(quest.status, 'failed', id);
        assert.equal(user.paradise.contracts.length, 0); assert.equal(user.paradise.relics.length, 0);
    }
    const abandoned = fresh(); choose(abandoned, 'relicParcel'); corridor.offerAugments(abandoned); corridor.finish(abandoned);
    assert.equal(abandoned.paradise.quests[0].status, 'failed'); assert.equal(abandoned.paradise.relics.length, 0);
});

test('잭팟·계약 도박은 확정 결과를 공개하고 유물 교환은 특수 유물을 보존한다', () => {
    for (const [rolls, star, type] of [[[.99, .99, .99], 8, '각성'], [[0, 0, 0], 7, '전직'], [[0, 0, .99], 6, '일반'], [[0, .3, .99], 0, null]]) {
        const user = fresh(); let index = 0;
        const result = choose(user, 'sevenBells', () => rolls[index++] ?? .99);
        assert.ok(result.reveal.positive); assert.match(result.reveal.text, /\d, \d, \d/);
        if (star) assert.deepEqual(user.paradise.contracts[0], { star, type, name: `${star}성 ${type} 카드` });
        else assert.equal(user.paradise.relics.length, 2);
    }
    for (const roll of [0, .99]) {
        const user = fresh(); user.paradise.contracts.push({ star: 7, type: '일반', name: '7성 일반 카드' });
        const result = choose(user, 'doubleSignature', () => roll);
        assert.equal(result.reveal.positive, roll === 0);
        assert.equal(user.paradise.contracts.length, roll === 0 ? 2 : 0);
    }
    const user = fresh(); user.paradise.relics = ['crown', 'judgment'];
    const result = choose(user, 'relicRoulette', () => 0);
    assert.ok(result.reveal.text.includes('피 묻은 왕관 반납'));
    assert.ok(!user.paradise.relics.includes('crown')); assert.ok(user.paradise.relics.includes('judgment'));
    assert.equal(user.paradise.relics.length, 3);
    const crown = fresh(); crown.paradise.relics = ['crown', 'compass', 'ring', 'judgment'];
    choose(crown, 'emptyHand'); assert.deepEqual(crown.paradise.relics, ['judgment']); assert.equal(crown.paradise.contracts[0].star, 8);
});

test('사건 초대장은 실제 방을 열고 황금 방의 보호는 다음 황금 상자에만 적용된다', () => {
    for (const [id, event] of [['puzzleInvite', 'puzzle'], ['chestInvite', 'chests'], ['treasureMap', 'chests']]) {
        const user = fresh(); choose(user, id);
        assert.equal(user.paradise.phase, 'event'); assert.equal(user.paradise.event.id, event);
    }
    const user = fresh(); choose(user, 'treasureMap');
    const result = corridor.chooseEvent(user, 'gold', {}, () => .99);
    assert.ok(result.reveal.positive); assert.equal(user.paradise.relics.length, 1);
    assert.equal(user.paradise.effects.taken || 0, 0); assert.equal(user.paradise.effects.goldAmnesty, 0);
    user.paradise.phase = 'event'; user.paradise.event = { id: 'chests' };
    corridor.chooseEvent(user, 'gold', {}, () => .99); assert.equal(user.paradise.effects.taken, .15);
});

test('불꽃·메아리·복수·초과 피해는 실제 전투에 적용되고 자동 공격은 충전·소모하지 않는다', t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh(); choose(user, 'sparkJar');
    Object.assign(user.paradise.enemy, { hp: 1e9, maxHp: 1e9, def: 0, atk: 0 });
    for (let i = 0; i < 3; i++) rpg.buildHuntResult(user, {}, 100, { isBasic: true });
    assert.equal(user.paradise.battle.sparks, 3);
    rpg.buildHuntResult(user, {}, 100, { dotAttack: true }); assert.equal(user.paradise.battle.sparks, 3);
    rpg.buildHuntResult(user, {}, 100, { isBasic: true });
    assert.ok(user.paradise.combatEvents.at(-1).criticalCount > 0); assert.equal(user.paradise.battle.sparks, 0);
    choose(user, 'echoStrike');
    Object.assign(user.paradise.enemy, { hp: 1e9, maxHp: 1e9, def: 0, atk: 0 });
    rpg.buildHuntResult(user, {}, 100, { isBasic: true }); const first = user.paradise.combatEvents.at(-1).damage;
    rpg.buildHuntResult(user, {}, 100, { isBasic: true });
    assert.equal(user.paradise.combatEvents.at(-1).damage, first + Math.round(first * .4));
    const revenge = fresh(); choose(revenge, 'revengeVault');
    Object.assign(revenge.paradise.enemy, { hp: 1e9, maxHp: 1e9, def: 0, atk: 0 });
    corridor.onDamageTaken(revenge, 123);
    rpg.buildHuntResult(revenge, {}, 100, { isBasic: true }); const basic = revenge.paradise.combatEvents.at(-1).damage;
    rpg.buildHuntResult(revenge, {}, 100, { isSkill: true });
    assert.equal(revenge.paradise.combatEvents.at(-1).damage, basic + 123);
    assert.equal(revenge.paradise.battle.revengeDamage, 0);
    const parcel = fresh(); choose(parcel, 'overkillParcel'); Object.assign(parcel.paradise.enemy, { hp: 1, def: 0, atk: 0 });
    rpg.buildHuntResult(parcel, {}, 1000, { isBasic: true });
    assert.ok(parcel.paradise.overkillDamage > 0);
    const saved = parcel.paradise.overkillDamage;
    corridor.startCombat(parcel, 'normal', null, () => .99);
    Object.assign(parcel.paradise.enemy, { hp: 10000, maxHp: 10000, def: 0, atk: 0 });
    rpg.buildHuntResult(parcel, {}, 100, { isBasic: true });
    assert.equal(parcel.paradise.combatEvents.at(-1).damage, basic + Math.min(saved, 3000));
    assert.equal(parcel.paradise.overkillDamage, 0);
});

test('태엽·바통·훔친 턴·시계는 쿨타임과 방어 기회를 변경하고 보호막은 상한을 지킨다', () => {
    const user = fresh(); choose(user, 'windupKey'); choose(user, 'stolenTurn'); choose(user, 'skillRelay');
    const now = Date.now(); user.field.skillCooldowns = { A: now + 10000, B: now + 20000 };
    for (let i = 0; i < 3; i++) corridor.afterAttack(user, { isBasic: true }, { finalDamage: 1 });
    assert.equal(user.field.skillCooldowns.B, now + 17000);
    corridor.onSkillUsed(user, 1, 'A'); assert.equal(user.field.skillCooldowns.A, now + 10000); assert.equal(user.field.skillCooldowns.B, now + 15500);
    for (let i = 0; i < 2; i++) corridor.afterAttack(user, { isBasic: true }, { finalDamage: 1 });
    assert.ok(user.field.skillCooldowns.B <= Date.now());
    assert.equal(corridor.incomingMultiplier(user, 100), 0); assert.equal(corridor.incomingMultiplier(user, 100), 1);
    choose(user, 'clockHeart'); assert.equal(corridor.cooldownMultiplier(user), 0); assert.equal(corridor.cooldownMultiplier(user), 1);
    choose(user, 'paperWard'); corridor.onSkillUsed(user, 1e6, 'A');
    const shields = require('../combat_shields');
    assert.equal(shields.summary(user.field, Date.now()).amount, Math.round(rpg.calculateUserStats(user).hp * .25));
    corridor.onSkillUsed(user, 1, 'A'); assert.equal(shields.summary(user.field, Date.now()).amount, 3);
    choose(user, 'pocketSand'); assert.equal(corridor.incomingMultiplier(user, 0), 1);
    assert.equal(corridor.incomingMultiplier(user, 100), 0); assert.equal(corridor.incomingMultiplier(user, 100), 1);
});

test('불사조의 담보는 일반 유물을 세 번까지만 소각하고 회복 금지·유물 부족을 따른다', () => {
    const user = fresh(); choose(user, 'phoenixPact');
    user.paradise.relics = ['crown', 'compass', 'ring', 'orb', 'judgment'];
    for (let i = 0; i < 3; i++) assert.ok(corridor.survive(user, 0, 1000) > 0);
    assert.equal(user.paradise.phoenixUsed, 3); assert.equal(corridor.survive(user, 0, 1000), 0);
    assert.ok(user.paradise.relics.includes('judgment'));
    const blocked = fresh(); choose(blocked, 'phoenixPact'); blocked.paradise.effects.noHealing = 1; blocked.paradise.relics = ['crown', 'judgment'];
    assert.equal(corridor.survive(blocked, 0, 1000), 1); assert.equal(corridor.survive(blocked, 0, 1000), 0);
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
    corridor.getResources(user).mp = 0; corridor.getResources(user).hp = Math.floor(stats.hp * .50);
    corridor.afterAttack(user, { isBasic: true }, { finalDamage: 0, criticalCount: 0 });
    assert.equal(corridor.getResources(user).mp, 0);
    corridor.afterAttack(user, { isBasic: true }, { finalDamage: 100, criticalCount: 9 });
    assert.equal(corridor.getResources(user).mp, Math.round(stats.mp * .09));
    const hp = corridor.getResources(user).hp;
    corridor.onSkillUsed(user, 10);
    assert.equal(corridor.getResources(user).hp, hp + Math.round(stats.hp * .03));
    user.paradise.effects.noHealing = 1;
    const before = { hp: corridor.getResources(user).hp, mp: corridor.getResources(user).mp };
    corridor.afterAttack(user, { isBasic: true }, { finalDamage: 100, criticalCount: 9 });
    corridor.onSkillUsed(user, 10);
    assert.deepEqual({ hp: corridor.getResources(user).hp, mp: corridor.getResources(user).mp }, before);
    corridor.getResources(user).hp = 1; corridor.attackMultiplier(user, { isBasic: true });
    assert.equal(corridor.getResources(user).hp, 1);
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
    corridor.getResources(user).hp = Math.floor(stats.hp * .20);
    const low = corridor.getResources(user).hp;
    corridor.onDamageTaken(user, 100);
    assert.equal(corridor.getResources(user).hp, low + Math.round(stats.hp * .30));
    close(corridor.attackMultiplier(user, { isBasic: true }), 1);
    corridor.getResources(user).hp = low; corridor.onDamageTaken(user, 100);
    assert.equal(corridor.getResources(user).hp, low);
    corridor.startCombat(user, 'normal', null, () => .99);
    corridor.getResources(user).hp = 0; corridor.onDamageTaken(user, 100);
    assert.equal(corridor.getResources(user).hp, 0);
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
    corridor.getResources(user).hp = 1; corridor.getResources(user).mp = 0; user.paradise.distortion = 50;
    corridor.victory(user, () => .99);
    assert.equal(user.paradise.distortion, 47);
    assert.ok(corridor.getResources(user).hp > 1 && corridor.getResources(user).mp > 0);
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
    const skill = rpg.getMainCardSkills(user)[0].skill, beforeMp = corridor.getResources(user).mp, at = Date.now();
    const message = await rpg.useSkillInField(user, skill.name);
    assert.ok(!message.startsWith('❌'), message);
    assert.equal(corridor.getResources(user).mp, beforeMp - Math.round(skill.mp_cost * .75));
    assert.ok(user.field.skillCooldowns[skill.name] - at <= skill.cooltime * .75 + 100);
    corridor.offerAugments(user); corridor.finish(user);
    assert.equal(corridor.cooldownMultiplier(user), 1);
    assert.equal(rpg.calculateUserStats(user).mpReduce || 0, 0);
});
