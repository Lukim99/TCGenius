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
const transcendEquipment = require('../transcend_equipment');

const baseStats = {
    atk: 1000,
    def: 500,
    hp: 10000,
    mp: 1000,
    pnt: 100,
    crit: .2,
    critMul: 1.5,
    cmb: .3,
    maxCmb: 1
};

function power(extraStats, modifiers) {
    return rpg.computeCombatPowerFromStats(Object.assign({}, baseStats, extraStats || {}), {}, modifiers);
}

const base = power();

assert.ok(power({ allElementAtk: 100 }).offense > base.offense, '모든 속성 강화는 공격 전투력에 반영되어야 한다.');
assert.ok(power({ fireAtk: 100 }).offense > base.offense, '단일 속성 강화는 사용 가능 비중만큼 공격 전투력에 반영되어야 한다.');
assert.ok(power({ allElementRes: 100 }).defense > base.defense, '모든 속성 저항은 방어 전투력에 반영되어야 한다.');
assert.ok(power({ fireRes: 100 }).defense > base.defense, '단일 속성 저항은 사용 가능 비중만큼 방어 전투력에 반영되어야 한다.');
assert.ok(power({ shieldEfficiency: .2 }).defense > base.defense, '보호막 효율은 방어 전투력에 반영되어야 한다.');
assert.strictEqual(power({ shieldEfficiency: .2, disableShield: 1 }).defense, base.defense, '보호막 사용 불가 상태에서는 보호막 효율을 환산하면 안 된다.');
assert.ok(power({ critLightBonus: .7 }).offense > base.offense, '치명타 명속성 추가 피해는 공격 전투력에 반영되어야 한다.');
assert.ok(power({ nonCritLightBonus: .35 }).offense > base.offense, '비치명타 명속성 추가 피해는 공격 전투력에 반영되어야 한다.');
assert.ok(power({ ultimateDamage: .5, ultimateCooldownFlat: 10000 }).offense > base.offense, '궁극기 피해와 쿨타임 감소는 공격 전투력에 반영되어야 한다.');
assert.ok(power({ elementalExtraDamage: .1 }).offense > base.offense, '속성 추가 피해는 공격 전투력에 반영되어야 한다.');
assert.ok(power({ burnDamage: .25, burnDurationFlat: 2 }).offense > base.offense, '화상 피해와 지속시간은 공격 전투력에 반영되어야 한다.');
assert.ok(power({ summonDuration: .7 }).offense > base.offense, '소환 지속시간은 공격 전투력에 반영되어야 한다.');
assert.ok(power({ summonDuration: -.5 }).offense < base.offense, '소환 지속시간 감소 페널티도 공격 전투력에 반영되어야 한다.');
assert.ok(power({ cooldown: .1 }).offense > base.offense, '스킬 쿨타임 감소는 공격 빈도만큼 공격 전투력을 높여야 한다.');
assert.ok(power({ cooldown: -.6 }).offense < base.offense, '스킬 쿨타임 증가 페널티도 공격 전투력에 반영되어야 한다.');
assert.ok(power({ attackBuffEfficiency: .3 }).offense > base.offense, '공격력 버프 효율은 공격 전투력에 반영되어야 한다.');
assert.ok(power({ partyAllElementAtk: 40 }).offense > base.offense, '파티 속성 강화는 할인된 파티 기여도로 반영되어야 한다.');

const comboPower = power({ comboDamage: .08, comboCritMul: .15, comboLastCrit: 1, comboLastCritMul: .3 });
assert.ok(comboPower.offense > base.offense, '연격 전용 피해와 치명타 효과는 도달 확률을 반영해 계산되어야 한다.');

assert.ok(power({ mpReduce: -.15 }).utility > base.utility, 'MP 소모 감소는 유틸 전투력을 높여야 한다.');
assert.ok(power({ mpReduce: .15 }).utility < base.utility, 'MP 소모 증가는 유틸 전투력을 낮춰야 한다.');
assert.ok(power({ skillCooldown: -1000 }).utility > base.utility, '고정 스킬 쿨타임 감소는 유틸 전투력을 높여야 한다.');
assert.ok(power({ skillCooldown: 1000 }).utility < base.utility, '고정 스킬 쿨타임 증가는 유틸 전투력을 낮춰야 한다.');
assert.ok(power({ equipmentEffectDurationFlat: 3 }).utility > base.utility, '장비 효과 지속시간은 유틸 전투력에 반영되어야 한다.');

const conditional = power({}, { offense: .1, defense: .2, utility: .3 });
assert.ok(conditional.offense > base.offense && conditional.defense > base.defense && conditional.utility > base.utility,
    '발동형 장비 기대값은 해당 전투력 항목에 반영되어야 한다.');

const kurumiStage1 = transcendEquipment.resolveConditionalCombatPowerEffect('쿠루미의 힘이 깃든 지팡이', 1, baseStats);
const kurumiStage3 = transcendEquipment.resolveConditionalCombatPowerEffect('쿠루미의 힘이 깃든 지팡이', 3, baseStats);
assert.ok(kurumiStage3.offense > kurumiStage1.offense, '발동형 초월 장비도 단계 상승분이 환산되어야 한다.');
assert.deepStrictEqual(transcendEquipment.resolveConditionalCombatPowerEffect('심해의 갑옷', 3, Object.assign({}, baseStats, { disableShield: 1 })),
    { offense: 0, defense: 0, utility: 0 }, '보호막 사용 불가 상태에서는 보호막 발동형 장비의 기대값을 환산하면 안 된다.');

const inactiveRainbow = transcendEquipment.resolveConditionalCombatPowerEffect('레인보우 프리즘', 3, baseStats);
const activeRainbow = transcendEquipment.resolveConditionalCombatPowerEffect('레인보우 프리즘', 3, Object.assign({}, baseStats, { allElementAtk: 250 }));
assert.strictEqual(inactiveRainbow.offense, 0, '레인보우 프리즘은 속성 강화 조건 미달 시 조건부 전투력을 받지 않아야 한다.');
assert.ok(activeRainbow.offense > 0, '레인보우 프리즘은 속성 강화 합계 1000 이상일 때 조건부 전투력을 받아야 한다.');

const advancedEquipmentNames = new Set(Object.values(transcendEquipment.definitions).flat().map(data => data.name));
for (const [name, effect] of Object.entries(transcendEquipment.conditionalCombatPowerEffects)) {
    assert.ok(advancedEquipmentNames.has(name), `${name}: 존재하는 초월·신화 장비에만 조건부 전투력을 지정할 수 있다.`);
    for (const key of ['offense', 'defense', 'utility']) {
        if (!effect[key]) continue;
        assert.strictEqual(effect[key].length, 2, `${name}: ${key} 전투력 값은 [1단계, 단계당] 형식이어야 한다.`);
        assert.ok(effect[key].every(Number.isFinite), `${name}: ${key} 전투력 값은 유한한 숫자여야 한다.`);
        assert.ok(effect[key][1] >= 0, `${name}: 초월 단계 상승으로 조건부 전투력이 낮아지면 안 된다.`);
    }
}
for (const set of Object.keys(transcendEquipment.conditionalSetCombatPowerEffects)) {
    assert.ok(transcendEquipment.setEffects[set], `${set}: 존재하는 세트에만 조건부 전투력을 지정할 수 있다.`);
}

const supportedEquipmentStatKeys = new Set([
    'atk', 'def', 'hp', 'mp', 'pnt', 'pntPercent', 'crit', 'critMul', 'critDef', 'cmb', 'maxCmb',
    'afterBasic', 'afterSkill', 'takenDamage', 'damageBonus', 'finalDamage', 'extraDamage', 'bossDmg',
    'summonDuration', 'cooldown', 'dotDamage', 'ultimateDamage', 'elementalExtraDamage', 'burnDamage',
    'lightFinalDamage', 'nonElementDamage', 'mpReduce', 'gold', 'plusGold', 'potion', 'exp', 'eliteDmg',
    'itemDropChance', 'recoveryEfficiency', 'avd', '000', 'skillCooldown', 'skillTrueDmg',
    'attackHpRecovery', 'attackMpRecovery', 'atkDefReduce', 'trueDamageChance', 'waldolandDmg',
    'butagamePartyQuestDmg', 'fireAtk', 'waterAtk', 'lightAtk', 'darkAtk', 'allElementAtk',
    'fireRes', 'waterRes', 'lightRes', 'darkRes', 'allElementRes', 'attackBuffEfficiency',
    'shieldEfficiency', 'ultimateCooldownFlat', 'burnDurationFlat', 'critLightBonus', 'nonCritLightBonus',
    'manaAmplifierFinalAtk', 'equipmentEffectDurationFlat', 'equipmentEffectCooldownFlat',
    'partyAllElementAtk', 'comboCritMul', 'comboDamage', 'comboLastCrit', 'comboLastCritMul'
]);
const advancedEquipmentStatKeys = new Set(Object.values(transcendEquipment.definitions).flat().flatMap(data => [
    ...Object.keys(data.stat || {}),
    ...Object.keys(data.plusStat || {})
]));
assert.deepStrictEqual([...advancedEquipmentStatKeys].filter(key => !supportedEquipmentStatKeys.has(key)), [],
    '초월·신화 장비의 모든 정적 능력치는 전투력 환산 목록에 있어야 한다.');

console.log('combat_power.test.js: OK');
