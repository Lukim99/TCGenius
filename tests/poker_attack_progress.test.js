const assert = require('assert');
const fs = require('fs');
const path = require('path');

for (const line of fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
}

const rpg = require('../rpgenius');

(async () => {
    await rpg.initRpgeniusData();

    const hitResult = rpg.calculateAttackHitResult(
        100,
        0,
        0,
        { crit: 0, critMul: 1.4, cmb: 0, maxCmb: 0 },
        {},
        { hitCount: 9, separateBasicAttackHits: true, tenthAtkStart: 5, tenthAtkBonus: .5, disableCritical: true },
        {}
    );
    assert.strictEqual(hitResult.attackUnitCount, 9);
    assert.deepStrictEqual(
        hitResult.hitDetails.map((hit, index) => hit.isTenthAtk ? index + 1 : null).filter(Boolean),
        [5],
        '6번째 공격부터 시작한 포커 9타 중 전체 10번째가 되는 5타에만 슬롯 효과가 적용되어야 한다.'
    );

    const ordinaryMultiHit = rpg.calculateAttackHitResult(
        100, 0, 0,
        { crit: 0, critMul: 1.4, cmb: 0, maxCmb: 0 },
        {},
        { hitCount: 9, tenthAtkStart: 5, tenthAtkBonus: .5, disableCritical: true },
        {}
    );
    assert.strictEqual(ordinaryMultiHit.attackUnitCount, 1, '포커가 아닌 고정 다단 공격은 기존대로 공격 1회로 집계해야 한다.');

    const user = new rpg.RPGUser('포커공격카운터테스트', 'poker-attack-progress-test');
    user.level = 141;
    user.main_card = { id: 12, star: 6, type: '전직' };
    user.card_slot = [{ id: 13, star: 4, type: '일반' }];
    user.equipments = { weapon: null, hat: null, armor: null, pants: null, shoes: null, accessory: {}, support: null, pet: [] };
    user.hp = 1000000000;
    user.mp = 1000000000;
    user.field = {
        name: '부타게임',
        enteredAt: Date.now(),
        nextActionAt: 0,
        skillCooldowns: {},
        attackCount: 5,
        nmmStacks: 0,
        equipmentState: {},
        elite: { hp: 1000000000 }
    };

    const resultText = rpg.useSkillInField(user, '포커 못 하시네');
    assert.ok(!resultText.startsWith('❌'), resultText);
    assert.strictEqual(resultText.split('피해를 입혔습니다!').length - 1, 9, '일반 엘리트전에서도 포커 못 하시네는 9타를 표시해야 한다.');
    assert.strictEqual(user.field.nmmStacks, 9, '포커 못 하시네 9타가 나인 멘스 모리스 중첩을 9회 쌓아야 한다.');
    assert.strictEqual(user.field.attackCount, 14, '포커 못 하시네 9타가 10번째 공격 슬롯 효과 카운터를 9회 진행해야 한다.');

    const hellUser = new rpg.RPGUser('포커헬엘리트테스트', 'poker-hell-elite-test');
    hellUser.level = 141;
    hellUser.main_card = { id: 12, star: 6, type: '전직' };
    hellUser.card_slot = [{ id: 13, star: 4, type: '일반' }];
    hellUser.equipments = { weapon: null, hat: null, armor: null, pants: null, shoes: null, accessory: {}, support: null, pet: [] };
    hellUser.hp = 1000000000;
    hellUser.mp = 1000000000;
    hellUser.field = {
        name: '부타게임[H]',
        hell: true,
        phase: 'elite',
        enteredAt: Date.now(),
        nextActionAt: 0,
        skillCooldowns: {},
        attackCount: 5,
        nmmStacks: 0,
        equipmentState: {},
        elite: { hp: 1000000000 }
    };

    const hellResultText = rpg.useSkillInField(hellUser, '포커 못 하시네');
    assert.ok(!hellResultText.startsWith('❌'), hellResultText);
    assert.strictEqual(hellResultText.split('피해를 입혔습니다!').length - 1, 9, '부타게임[H] 엘리트전에서도 포커 못 하시네는 9타를 표시해야 한다.');
    assert.strictEqual(hellUser.field.nmmStacks, 9, '부타게임[H] 엘리트전에서도 나인 멘스 모리스 중첩을 9회 쌓아야 한다.');
    assert.strictEqual(hellUser.field.attackCount, 14, '부타게임[H] 엘리트전에서도 10번째 공격 슬롯 효과 카운터를 9회 진행해야 한다.');

    console.log('poker_attack_progress.test.js: OK');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
