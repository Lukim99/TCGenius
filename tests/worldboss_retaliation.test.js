const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

// Importing rpgenius runs live-data migrations. Execute the actual combat
// functions in isolation, as in worldboss_black_curtain.test.js, without AWS.
const source = fs.readFileSync(path.join(__dirname, '..', 'rpgenius.js'), 'utf8');
const names = [
    'calculateAttackHitResult', 'dealDamageToWorldBoss',
    'isBlackCurtainBoss', 'ensureBlackCurtainPatternState',
    'applyBlackCurtainFixedDamage', 'resolveBlackCurtainDamageRetaliation',
    'formatHitDetailLines', 'hasSeparateDamageComponents', 'formatWorldBossDamageLines',
    'applyWorldBossDamageAction', 'useWorldBossChosenSkill', 'defeatWorldBossPlayer'
];
const combatSource = names.map(name => {
    const match = source.match(new RegExp('^(?:async )?function ' + name + '\\([^]*?^}', 'm'));
    assert.ok(match, name + ' must exist');
    return match[0];
}).join('\n');

function fixture() {
    const boss = { name: '흑막', pattern: 'blackCurtain', hp: 1000000000 };
    const state = { hp: boss.hp, contributions: {} };
    const user = {
        name: '반격 테스트', hp: 100000, mp: 1000,
        field: { name: boss.name, worldBoss: true, enteredAt: Date.now(), chosenSkillId: 1 }
    };
    const stats = { atk: 1000, hp: 100000, mp: 1000 };
    const rewardTotals = [];
    const noop = () => {};
    const deps = {
        calculateUserStats: () => stats,
        calculateCardSlotEffects: () => ({ mpCostReduction: 0 }),
        getManaResonanceBonus: () => 0,
        getWorldBossDefenderStats: () => ({}),
        getComboHitCount: () => 1,
        getElementDamageMultiplier: () => 1,
        applyCriticalDamage: damage => ({ damage, isCritical: false }),
        getDamageAfterReducedDefense: damage => damage,
        getTotalDefenseReductionRate: () => 0,
        randomInt: () => 100, // deterministic 100% damage variance
        recordFieldJudgmentDamage: noop, applyNmmStackGain: noop,
        applyTenthAtkCounter: noop, queueBlackShadow: noop,
        ensureWorldBossRevived: () => state,
        getWorldBossState: () => state,
        persistWorldBossState: noop,
        comma: value => Number(value).toLocaleString('en-US'),
        applyPetRegen: noop, forceDefeatExpiredWorldBoss: noop,
        clearWorldBossSkillTimer: noop, recordQuestEvent: noop,
        applyAttackPotentialRecovery: noop, getPassiveMpRecovery: () => 0,
        grantWorldBossThresholdRewards: () => rewardTotals.push(state.contributions[user.name]),
        appendWorldBossStatusLines: noop, setWorldBossNextActionAt: noop,
        finalizeWorldBossDefeat: async player => { player.field = null; },
        findWorldBossByName: () => boss,
        getAttackElement: () => '수',
        getExtraSkillById: () => ({ name: '빙결', mp_cost: 0, cooltime: 0 }),
        getSkillValue: (skill, index) => index === 0 ? 10000 : 0,
        getSkillCooldownRate: () => 1, getGunryeokState: () => null
    };
    const combat = new Function(...Object.keys(deps), combatSource + '\nreturn {' + names.join(',') + '};')(...Object.values(deps));
    const act = (damage, extra = {}, type = 'basic') => combat.applyWorldBossDamageAction(user, boss, damage, extra, type, { name: '직접 스킬' });
    const tick = (damage, extra) => {
        const result = combat.dealDamageToWorldBoss(user, boss, damage, extra);
        const lines = [];
        const retaliation = combat.resolveBlackCurtainDamageRetaliation(user, boss, result, lines);
        return { result, retaliation, lines };
    };
    return { boss, state, user, stats, rewardTotals, combat, act, tick };
}

test('one basic action with combo hits and additional damage retaliates only once', async () => {
    const f = fixture();
    f.stats.extraDamage = 0.5;
    const message = await f.act(6000, { comboHitCount: 3, oneTimeTrueDmg: 2000 });
    assert.equal(f.state.contributions[f.user.name], 30000);
    assert.equal(f.user.hp, 97000);
    assert.equal((message.match(/피해 누적 반격/g) || []).length, 1);
    assert.equal(f.user.field.blackCurtain.damageSinceIcham, 25000, 'existing overflow carries forward');
    assert.deepEqual(f.rewardTotals, [30000]);
});

test('one main-card multi-hit skill retaliates only once', async () => {
    const f = fixture();
    const message = await f.act(6000, { isSkill: true, hitCount: 5, skillTrueDmg: 1000 }, 'skill');
    assert.equal(f.state.contributions[f.user.name], 35000);
    assert.equal(f.user.hp, 97000);
    assert.equal((message.match(/피해 누적 반격/g) || []).length, 1);
});

test('chosen world-boss skill also retaliates once per cast', async () => {
    const f = fixture();
    const first = await f.combat.useWorldBossChosenSkill(f.user, '빙결');
    const second = await f.combat.useWorldBossChosenSkill(f.user, '빙결');
    assert.equal(f.user.hp, 94000);
    for (const message of [first, second]) assert.equal((message.match(/피해 누적 반격/g) || []).length, 1);
    assert.equal(f.state.contributions[f.user.name], 20000);
});

for (const [name, extra] of [
    ['summon', { summonAttack: true }],
    ['damage over time', { dotAttack: true }],
    ['automatic attack', { isBotAutoAttack: true }],
    ['counter damage', { disableBlackCurtainRetaliation: true }],
    ['burn / delayed equipment damage', { summonAttack: true, dotAttack: true, isBotAutoAttack: true, precalculatedDamage: true }]
]) {
    test(name + ' still counts as contribution but neither builds nor triggers retaliation', async () => {
        const f = fixture();
        await f.act(4000);
        for (let i = 0; i < 3; i++) {
            const tick = f.tick(10000, { hitCount: 1, ...extra });
            assert.equal(tick.result.dealt, 10000);
            assert.equal(tick.retaliation, 0);
            assert.deepEqual(tick.lines, []);
            assert.equal(f.user.hp, 100000);
            assert.equal(f.user.field.blackCurtain.damageSinceIcham, 4000);
        }
        await f.act(999);
        assert.equal(f.user.hp, 100000);
        await f.act(1);
        assert.equal(f.user.hp, 97000);
        assert.equal(f.state.contributions[f.user.name], 35000);
        assert.equal(f.rewardTotals.at(-1), 35000, 'threshold rewards see all direct and indirect damage');
    });
}

test('indirect damage does not consume a pending retaliation from a large direct action', async () => {
    const f = fixture();
    await f.act(20000);
    for (let i = 0; i < 3; i++) assert.equal(f.tick(6000, { summonAttack: true }).retaliation, 0);
    assert.equal(f.user.hp, 97000);
    assert.equal(f.user.field.blackCurtain.damageSinceIcham, 15000);
    await f.act(1);
    assert.equal(f.user.hp, 94000);
});

test('zero damage and a boss-killing hit do not retaliate', async () => {
    const f = fixture();
    await f.act(20000);
    await f.act(0);
    assert.equal(f.user.hp, 97000);
    f.state.hp = 100;
    await f.act(50000);
    assert.equal(f.user.hp, 97000);
    assert.equal(f.user.field, null);
    assert.equal(f.state.contributions[f.user.name], 20100);
});

test('other world bosses do not gain the black-curtain retaliation', async () => {
    const f = fixture();
    f.boss.pattern = 'other';
    await f.act(20000);
    assert.equal(f.user.hp, 100000);
    assert.equal(f.user.field.blackCurtain, undefined);
});
