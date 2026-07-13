const assert = require('assert');
const fs = require('fs');
const path = require('path');

for (const line of fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
}

const rpg = require('../rpgenius');
const partyquest = require('../partyquest');
const transcendEquipment = require('../transcend_equipment');

const party = partyquest.__test;

function makeMember(name, entries, setCounts, stats) {
    return {
        name,
        position: '딜러',
        baseSnapshot: {
            stats: Object.assign({ atk: 100, def: 0, hp: 1000, mp: 1000, crit: 0, critMul: 1.5 }, stats || {}),
            slotEffects: {},
            mainCardSkills: [],
            transcendEquipment: { entries: entries || [], setCounts: setCounts || {} }
        },
        runtime: {
            dead: false,
            hp: 1000,
            hpMax: 1000,
            mp: 1000,
            mpMax: 1000,
            atkBuff: 0,
            equipmentAtkBuffs: {},
            equipmentState: {},
            cooldownsUntil: {},
            buffs: [],
            actionUntil: 0
        }
    };
}

const originalRandom = Math.random;
Math.random = () => 0.5;
try {
    const baseStats = { atk: 100, crit: 0, critMul: 1.5, comboDamage: 0.5 };
    const fixed = rpg.calculateAttackHitResult(100, 0, 0, baseStats, {}, { hitCount: 3, disableCritical: true }, {});
    assert.strictEqual(fixed.hitCount, 3);
    assert.strictEqual(fixed.attackUnitCount, 1, '고정 다단 공격은 공격 1회로 집계해야 한다.');
    assert.deepStrictEqual(fixed.hitDetails.map(hit => hit.isComboHit), [false, false, false]);
    assert.strictEqual(fixed.finalDamage, 300, '연격 전용 피해는 고정 다단 공격에 적용되면 안 된다.');

    const combo = rpg.calculateAttackHitResult(100, 0, 0, baseStats, {}, { comboHitCount: 3, disableCritical: true }, {});
    assert.strictEqual(combo.attackUnitCount, 3, '연격은 타격마다 공격으로 집계해야 한다.');
    assert.deepStrictEqual(combo.hitDetails.map(hit => hit.isComboHit), [false, true, true]);
    assert.strictEqual(combo.finalDamage, 400);

    const cooldownNecklace = makeMember('쿨다운 목걸이', [{ name: '쿨다운 목걸이', stage: 1 }], {}, { cmb: 1, maxCmb: 1 });
    cooldownNecklace.skills = ['테스트 스킬'];
    cooldownNecklace.skillDefs = { '테스트 스킬': { type: 'active', cd: 10 } };
    cooldownNecklace.runtime.cooldownsUntil['테스트 스킬'] = Date.now() + 10000;
    cooldownNecklace.runtime.hp = 900;
    const cooldownTarget = { name: '대상', type: 'boss', hp: 1000, hpMax: 1000, def: 0, stats: { def: 0 }, debuffs: [] };
    const cooldownBasic = party.computeBasicDamage(cooldownNecklace, cooldownTarget, {});
    assert.strictEqual(cooldownBasic.attackUnitCount, 3);
    assert.strictEqual(cooldownNecklace.runtime.hp, 903, '쿨다운 목걸이의 일반 공격 회복은 연격 타격마다 적용되어야 한다.');

    const yuralStats = { atk: 100, crit: 1, critMul: 1.5, comboCritMul: 0.5 };
    const fixedCrit = rpg.calculateAttackHitResult(100, 0, 0, yuralStats, {}, { hitCount: 2 }, {});
    const comboCrit = rpg.calculateAttackHitResult(100, 0, 0, yuralStats, {}, { comboHitCount: 3 }, {});
    assert.deepStrictEqual(fixedCrit.hitDamages, [150, 150], '유랄 목걸이는 고정 다단 공격에 적용되면 안 된다.');
    assert.deepStrictEqual(comboCrit.hitDamages, [150, 200, 200], '유랄 목걸이는 연격 추가 타격에만 적용되어야 한다.');

    const rotten = makeMember('썩은물', [{ name: '썩어버린 물', stage: 1 }]);
    const firstWater = party.preparePartyTranscendSkill(rotten, '청정수 투척', false, {});
    assert.strictEqual(firstWater.mpCostMul, 1);
    assert.strictEqual(Number(firstWater.extra.damageBonusMul || 0), 0);
    rotten.runtime.equipmentState = firstWater.state;
    const nextSkill = party.preparePartyTranscendSkill(rotten, '다음 스킬', false, {});
    assert.strictEqual(nextSkill.mpCostMul, 1.06);
    assert.strictEqual(nextSkill.extra.damageBonusMul, 0.05);

    const hpCost = makeMember('HP소모', [], { '검은 잔향': 4 });
    hpCost.runtime.hp = 1;
    const hpCostSkill = party.preparePartyTranscendSkill(hpCost, '스킬', false, {});
    assert.strictEqual(hpCostSkill.hpAfter, 1, '장비 HP 소모는 최소 HP 1을 유지해야 한다.');
    assert.strictEqual(hpCostSkill.shadowDamageRate, 0.5);
    hpCost.runtime.equipmentState = hpCostSkill.state;
    const hpCostCooldownSkill = party.preparePartyTranscendSkill(hpCost, '다음 스킬', false, {});
    assert.strictEqual(hpCostCooldownSkill.hpAfter, undefined, '검은 잔향 4세트는 12초 쿨타임 중 HP를 다시 소모하면 안 된다.');
    assert.strictEqual(hpCostCooldownSkill.shadowDamageRate, undefined, '검은 잔향 4세트는 12초 쿨타임 중 그림자를 다시 발동하면 안 된다.');

    const blackEchoShoes = makeMember('검은 잔향 신발', [{ name: '검은 잔향 신발', stage: 1 }]);
    const firstBlackEchoShoes = party.preparePartyTranscendSkill(blackEchoShoes, '첫 스킬', false, {});
    blackEchoShoes.runtime.equipmentState = firstBlackEchoShoes.state;
    const secondBlackEchoShoes = party.preparePartyTranscendSkill(blackEchoShoes, '다음 스킬', false, {});
    assert.strictEqual(secondBlackEchoShoes.state.blackEchoShoesReadyAt, firstBlackEchoShoes.state.blackEchoShoesReadyAt,
        '검은 잔향 신발은 10초 쿨타임 중 효과를 갱신하면 안 된다.');
    assert.strictEqual(secondBlackEchoShoes.state.darkAttackBuff.expiredAt, firstBlackEchoShoes.state.darkAttackBuff.expiredAt);

    const abyssShoes = makeMember('심연의 신발', [{ name: '심연의 신발', stage: 1 }]);
    const abyssSkill = party.preparePartyTranscendSkill(abyssShoes, '스킬', false, {});
    assert.strictEqual(abyssSkill.state.ignoreHealingUntil, undefined, '심연의 신발은 원문에 없는 회복 무시를 부여하면 안 된다.');

    const beom = makeMember('범부', [{ name: '범부의 대나무', stage: 1 }]);
    beom.baseSnapshot.elementChain = { rest: '명' };
    beom.runtime.equipmentState = {
        beomStacks: 7,
        beomStacksUntil: Date.now() + 10000,
        trueBeomUntil: Date.now() + 10000,
        fortuneExtraDamage: { value: 0.1, expiredAt: Date.now() + 10000 }
    };
    const beomMonster = { name: '대상', type: 'boss', hp: 1000, hpMax: 1000, def: 0, stats: { def: 0 }, debuffs: [] };
    const beomSkill = party.calculateOutgoingDamage(beom, beomMonster, {}, 100, { isSkill: true, skillElement: '명', hitCount: 1 });
    assert.strictEqual(beomSkill.damage, 159,
        '파티 스킬에도 범부 명속성 피해·진정한 범부 추가 피해·행운의 복주머니 추가 피해가 모두 적용되어야 한다.');

    const summon = makeMember('소환수', [{ name: '예고편', stage: 1 }]);
    party.preparePartyAttackUnits({}, summon, null, { summonAttack: true }, summon.baseSnapshot.stats);
    assert.strictEqual(Number(summon.runtime.equipmentState.attackCount || 0), 0, '소환수 공격은 공격 시 장비 효과를 발동하면 안 된다.');

    const pantheon = makeMember('판테온', [{ name: '판테온 레거시', stage: 1 }]);
    const returns = makeMember('리턴즈', [{ name: '리턴즈파겜', stage: 1 }]);
    assert.strictEqual(party.getPartyAttackOrderPreview(pantheon), 1);
    const foreshadowing = makeMember('복선 회수', [{ name: '판테온 레거시', stage: 1 }], { '복선 회수': 4 });
    assert.strictEqual(party.preparePartyTranscendSkill(foreshadowing, '첫 번째 스킬', false, {}).mpCostMul, 0.8,
        '복선 회수 4세트는 첫 번째 공격의 MP 소모량을 20% 감소시켜야 한다.');
    const foreshadowingReturns = makeMember('복선 회수 리턴즈', [{ name: '리턴즈파겜', stage: 1 }], { '복선 회수': 4 });
    assert.strictEqual(party.preparePartyTranscendSkill(foreshadowingReturns, '첫 번째 스킬', false, {}).mpCostMul, 1,
        '리턴즈파괴를 장착한 첫 공격은 2번째 공격으로 집계되어 MP 감소가 적용되지 않아야 한다.');
    assert.strictEqual(party.getPartyAttackOrderPreview(returns), 2, '리턴즈파겜은 첫 번째 공격 순서를 건너뛰어야 한다.');

    const judgment = makeMember('심판', [], { '천공의 심판': 4 });
    const judgmentRoom = { phaseIndex: 2 };
    party.preparePartyAttackUnits(judgmentRoom, judgment, { name: '대상' }, {}, judgment.baseSnapshot.stats);
    assert.ok(judgment.runtime.equipmentState.judgment);
    party.recordPartyJudgmentDamage(judgmentRoom, judgment, { damage: 1000, equipmentTriggerAllowed: true });
    assert.strictEqual(judgment.runtime.equipmentState.judgment.damage, 1000);
    party.recordPartyJudgmentDamage(judgmentRoom, judgment, { damage: 1000, equipmentTriggerAllowed: false });
    assert.strictEqual(judgment.runtime.equipmentState.judgment.damage, 1000, '장비 추가 피해는 심판 누적 피해를 다시 발동하면 안 된다.');

    const source = makeMember('버프제공자', [{ name: '성역의 인도자 모자', stage: 1 }], {}, { attackBuffEfficiency: 0.5 });
    const target = makeMember('버프대상', [], {}, { attackBuffEfficiency: 2 });
    party.applyTranscendAllyEffect({ members: [source, target] }, source, target, 'buff');
    assert.strictEqual(target.runtime.equipmentAtkBuffs.sanctuaryHat.value, 0.12);
    assert.strictEqual(party.getPartyAttackBuffValue(target), 0.12, '받는 사람의 공격력 증가 효율은 타인이 준 버프를 증폭하면 안 된다.');

    const king1 = makeMember('킹메이커1', [], { '킹메이커': 4 });
    const king2 = makeMember('킹메이커2', [], { '킹메이커': 4 });
    const kingTarget = makeMember('복수킹');
    const kingRoom = { members: [king1, king2, kingTarget] };
    party.applyTranscendAllyEffect(kingRoom, king1, kingTarget, 'buff');
    party.applyTranscendAllyEffect(kingRoom, king2, kingTarget, 'buff');
    assert.deepStrictEqual(Object.keys(kingTarget.runtime.kingmakerBuffs).sort(), ['kingmaker:킹메이커1', 'kingmaker:킹메이커2']);
    assert.strictEqual(party.getPartyAttackBuffValue(kingTarget), 0.36, '서로 다른 착용자가 지정한 킹 효과는 함께 존재해야 한다.');
    const secondTarget = makeMember('두번째대상');
    kingRoom.members.push(secondTarget);
    party.applyTranscendAllyEffect(kingRoom, king1, secondTarget, 'buff');
    assert.strictEqual(secondTarget.runtime.kingmakerBuffs, undefined, '같은 착용자는 한 파티 퀘스트에서 킹을 다시 지정하면 안 된다.');

    const monster = { debuffs: [] };
    party.addMonsterDebuff(monster, { id: 'burn:test', type: 'dot', dmg: 100, tick: 2, interval: 2, remain: 8 });
    party.addMonsterDebuff(monster, { id: 'burn:test', type: 'dot', dmg: 250, tick: 2, interval: 2, remain: 5 });
    assert.strictEqual(monster.debuffs.length, 1, '화상 재부여는 중첩되면 안 된다.');
    assert.deepStrictEqual(monster.debuffs[0], { id: 'burn:test', type: 'dot', dmg: 250, tick: 2, interval: 2, remain: 5 });

    const passives = rpg.getEquipmentPassives();
    for (const [name, desc] of Object.entries(transcendEquipment.uniquePassiveDescriptions)) {
        const id = transcendEquipment.uniquePassiveIds[name];
        const data = Object.values(transcendEquipment.definitions).flat().find(equipment => equipment.name === name);
        assert.ok(data, `${name}: 장비 정의가 필요하다.`);
        assert.strictEqual(data.passive_id, id, `${name}: passive_id가 EquipmentPassive와 일치해야 한다.`);
        assert.deepStrictEqual(passives[id], { name, desc, format: [] });
    }
} finally {
    Math.random = originalRandom;
}

console.log('transcend_combat_rules.test.js: OK');
