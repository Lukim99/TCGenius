const assert = require('assert');
const fs = require('fs');
const path = require('path');

for (const line of fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
}

const rpg = require('../rpgenius');

function makeUser(name, level) {
    const user = new rpg.RPGUser(name, name + '-id');
    user.level = level;
    user.main_card = { id: 0, star: 6, type: '일반' };
    user.need_character_card_select = false;
    user.hp = 1000000000;
    user.mp = 1000000000;
    return user;
}

function sequence(values, fallback = 0) {
    const queue = values.slice();
    return () => queue.length > 0 ? queue.shift() : fallback;
}

(async () => {
    await rpg.initRpgeniusData();

    assert.deepStrictEqual(rpg.getAccessibleDailyDungeons(100).map(d => d.name), []);
    assert.deepStrictEqual(rpg.getAccessibleDailyDungeons(101).map(d => d.name), ['마동']);
    assert.deepStrictEqual(rpg.getAccessibleDailyDungeons(111).map(d => d.name), ['마동', '리조트']);
    assert.deepStrictEqual(rpg.getAccessibleDailyDungeons(141).map(d => d.name), ['마동', '리조트', '월도랜드4', '월도랜드5', '부타게임']);

    for (const dungeon of rpg.getAccessibleDailyDungeons(141)) {
        const combatData = rpg.getDailyDungeonCombatData(dungeon);
        for (const key of ['atk', 'pnt', 'pntPercent', 'def', 'hp', 'crit', 'critDef', 'cmb']) {
            assert.strictEqual(combatData[key], Number(dungeon[key] || 0) / 20, dungeon.name + ' ' + key + ' 능력치는 일반 필드의 1/20이어야 한다.');
        }
        assert.strictEqual(combatData.critMul, 1 + (Number(dungeon.critMul || 1) - 1) / 20);
        assert.strictEqual(combatData.maxCmb, Math.floor(Number(dungeon.maxCmb || 0) / 20));
        assert.strictEqual(combatData.reward, dungeon.reward, '보상 데이터는 변경하면 안 된다.');
        assert.strictEqual(combatData.dailyDungeon, dungeon.dailyDungeon, '클리어 보상 데이터는 변경하면 안 된다.');
    }

    const entryUser = makeUser('일일던전입장테스트', 141);
    assert.ok((await rpg.enterDailyDungeon(entryUser, '부타게임')).startsWith('✅'));
    assert.strictEqual(entryUser.field.dailyDungeon, true);
    assert.strictEqual(entryUser.dailyDungeonDaily.used, true);
    const dailyCombatContext = rpg.getFieldCombatContext(entryUser);
    assert.strictEqual(dailyCombatContext.dungeon.hp, rpg.findDailyDungeonByName('부타게임').hp / 20);
    assert.strictEqual(dailyCombatContext.dungeon.atk, rpg.findDailyDungeonByName('부타게임').atk / 20);
    assert.ok(rpg.leaveField(entryUser).includes('다시 입장할 수 없습니다'));
    assert.ok((await rpg.enterDailyDungeon(entryUser, '마동')).startsWith('❌'));

    const deathUser = makeUser('일일던전사망테스트', 101);
    assert.ok((await rpg.enterDailyDungeon(deathUser, '마동')).startsWith('✅'));
    deathUser.hp = 2;
    const originalRandom = Math.random;
    try {
        Math.random = () => 0.99;
        const deathText = rpg.buildHuntResult(deathUser, rpg.findDailyDungeonByName('마동'), 0, { precalculatedDamage: true, disableEquipmentBonusDamage: true });
        assert.ok(deathText.includes('오늘은 다시 입장할 수 없습니다'));
    } finally {
        Math.random = originalRandom;
    }
    assert.strictEqual(deathUser.field, null);
    assert.strictEqual(deathUser.dailyDungeonDaily.outcome, 'failed');
    assert.ok((await rpg.enterDailyDungeon(deathUser, '마동')).startsWith('❌'));

    const normalUser = makeUser('일반필드유지테스트', 141);
    assert.ok((await rpg.enterField(normalUser, '마동', { confirmed: true })).startsWith('✅'));
    assert.ok(!normalUser.field.dailyDungeon);
    assert.strictEqual(rpg.getFieldCombatContext(normalUser).dungeon.hp, rpg.findDailyDungeonByName('마동').hp, '일반 필드 능력치는 변경하면 안 된다.');
    rpg.leaveField(normalUser);

    const resetUser = makeUser('일일초기화테스트', 141);
    const todayState = rpg.getDailyDungeonDailyState(resetUser, new Date('2026-07-16T00:00:00+09:00'));
    todayState.used = true;
    const nextDayState = rpg.getDailyDungeonDailyState(resetUser, new Date('2026-07-17T00:00:00+09:00'));
    assert.strictEqual(nextDayState.used, false);

    const effectUser = makeUser('일일효과테스트', 141);
    effectUser.field = { name: '부타게임', dailyDungeon: true, dailyEffect: { triggered: false, type: null, expiresAt: 0 } };
    try {
        Math.random = sequence([0.49, 0]);
        const extra = {};
        rpg.applyDailyDungeonEffectToAttack(effectUser, extra, 'basic');
        assert.strictEqual(effectUser.field.dailyEffect.type, 'fever');
        assert.strictEqual(extra.finalDamageBonus, 3);
        assert.ok(extra.notice.includes('피버타임'));
    } finally {
        Math.random = originalRandom;
    }
    const expiresAt = effectUser.field.dailyEffect.expiresAt;
    assert.ok(rpg.getActiveDailyDungeonEffect(effectUser, expiresAt - 1));
    assert.strictEqual(rpg.getActiveDailyDungeonEffect(effectUser, expiresAt), null);
    assert.strictEqual(rpg.tryActivateDailyDungeonEffect(effectUser, expiresAt + 1, () => 0), null, '만료 후 재발동하면 안 된다.');

    const hitUser = makeUser('히트타임테스트', 141);
    hitUser.field = { name: '부타게임', dailyDungeon: true, dailyEffect: { triggered: true, type: 'hit', expiresAt: Date.now() + 10000 } };
    const hitExtra = {};
    rpg.applyDailyDungeonEffectToAttack(hitUser, hitExtra, 'skill');
    assert.strictEqual(hitExtra.extraDamageBonus, 2);

    const punchUser = makeUser('펀치타임테스트', 141);
    punchUser.field = { name: '부타게임', dailyDungeon: true, dailyEffect: { triggered: true, type: 'punch', expiresAt: Date.now() + 10000 } };
    assert.strictEqual(rpg.getFieldActionCooldownMs(punchUser), 1000);

    const autoUser = makeUser('자동공격효과제외테스트', 141);
    autoUser.field = { name: '부타게임', dailyDungeon: true, dailyEffect: { triggered: false, type: null, expiresAt: 0 } };
    rpg.applyDailyDungeonEffectToAttack(autoUser, { isBotAutoAttack: true }, 'basic');
    assert.strictEqual(autoUser.field.dailyEffect.triggered, false);

    const retryEffectUser = makeUser('효과재시도테스트', 141);
    retryEffectUser.field = { name: '부타게임', dailyDungeon: true, dailyEffect: { triggered: false, type: null, expiresAt: 0 } };
    assert.strictEqual(rpg.tryActivateDailyDungeonEffect(retryEffectUser, 1000, sequence([0.5])), null);
    assert.strictEqual(retryEffectUser.field.dailyEffect.triggered, false);
    assert.strictEqual(rpg.tryActivateDailyDungeonEffect(retryEffectUser, 2000, sequence([0.49, 0.34])).type, 'punch');

    const hitSelectionUser = makeUser('히트선택테스트', 141);
    hitSelectionUser.field = { name: '부타게임', dailyDungeon: true, dailyEffect: { triggered: false, type: null, expiresAt: 0 } };
    assert.strictEqual(rpg.tryActivateDailyDungeonEffect(hitSelectionUser, 1000, sequence([0.49, 0.99])).type, 'hit');

    assert.ok(rpg.leaveField(hitUser).includes('다시 입장할 수 없습니다'));
    assert.strictEqual(hitUser.field, null);
    assert.strictEqual(rpg.getActiveDailyDungeonEffect(hitUser), null);

    const dailyConfig = rpg.getAccessibleDailyDungeons(141).map(dungeon => ({
        name: dungeon.name,
        exp: dungeon.dailyDungeon.exp,
        gold: [dungeon.dailyDungeon.gold.min, dungeon.dailyDungeon.gold.max],
        itemRanges: dungeon.dailyDungeon.items.map(item => [item.name, item.count.min, item.count.max]),
        choices: dungeon.dailyDungeon.itemChoices.map(pool => pool.map(item => [item.name, item.weight, item.count]))
    }));
    assert.deepStrictEqual(dailyConfig, [
        { name: '마동', exp: 2500000, gold: [1500000, 3000000], itemRanges: [['일반 떡밥', 500, 1000], ['강화석', 500, 1000]], choices: [[['5성 카드팩', 100, 1]]] },
        { name: '리조트', exp: 4500000, gold: [3000000, 4500000], itemRanges: [['일반 떡밥', 500, 1000], ['강화석', 500, 1000]], choices: [[['5성 카드팩', 80, 1], ['6성 카드팩', 20, 1]]] },
        { name: '월도랜드4', exp: 8000000, gold: [4500000, 6000000], itemRanges: [['일반 떡밥', 1000, 1500], ['강화석', 1000, 1500]], choices: [[['5성 카드팩', 60, 1], ['6성 카드팩', 40, 1]]] },
        { name: '월도랜드5', exp: 13000000, gold: [6000000, 7500000], itemRanges: [['일반 떡밥', 1000, 1500], ['강화석', 1000, 1500]], choices: [[['5성 카드팩', 40, 1], ['6성 카드팩', 60, 1]]] },
        { name: '부타게임', exp: 25000000, gold: [7500000, 9000000], itemRanges: [['일반 떡밥', 1500, 2000], ['강화석', 1500, 2000], ['상급 강화석', 1, 3]], choices: [[['5성 카드팩', 20, 1], ['6성 카드팩', 80, 1]], [['헬 초대장', 50, 100], ['헬 도전장', 50, 60]]] }
    ]);

    const resort = rpg.findDailyDungeonByName('리조트');
    const resortReward = rpg.rollDailyDungeonClearReward(resort, sequence([0, 0, 0.8, 0, 0.5]));
    assert.strictEqual(resortReward.items['6성 카드팩'], 1, '80% 경계에서는 6성 카드팩을 선택해야 한다.');
    assert.strictEqual(resortReward.lucky, false);

    const butagame = rpg.findDailyDungeonByName('부타게임');
    const butaReward = rpg.rollDailyDungeonClearReward(butagame, sequence([0, 0, 0, 0, 0, 0, 0]));
    assert.strictEqual(butaReward.items['5성 카드팩'], 1);
    assert.strictEqual(butaReward.items['헬 초대장'], 100);
    assert.strictEqual(butaReward.items['상급 강화석'], 1);
    assert.strictEqual(butaReward.lucky, true);
    const butaBoundaryReward = rpg.rollDailyDungeonClearReward(butagame, sequence([0, 0, 0, 0.99, 0.5, 0, 0.5]));
    assert.strictEqual(butaBoundaryReward.items['6성 카드팩'], 1);
    assert.strictEqual(butaBoundaryReward.items['헬 도전장'], 60, '50% 경계에서는 헬 도전장을 선택해야 한다.');

    const rewardUser = makeUser('일일보상증가테스트', 101);
    rewardUser.field = { name: '마동', dailyDungeon: true, nextActionAt: 0, skillCooldowns: {}, killCount: 2000, dailyEffect: { triggered: true, type: null, expiresAt: 0 } };
    rewardUser.dailyDungeonDaily = { date: rpg.getDailyDungeonDailyState(rewardUser).date, used: true, dungeonName: '마동', outcome: 'in_progress' };
    const rewardResult = rpg.grantDailyDungeonClearReward(
        rewardUser,
        rpg.findDailyDungeonByName('마동'),
        { exp: 0, gold: 0 },
        { expBonus: 0.1, goldBonus: 0.2 },
        { goldBonus: 0.3 },
        sequence([0, 0, 0, 0, 0])
    );
    assert.strictEqual(rewardResult.lucky, true);
    assert.strictEqual(rewardResult.exp, 5500000);
    assert.strictEqual(rewardResult.gold, 4500000);
    assert.strictEqual(rpg.getInventoryItemCount(rewardUser, rpg.getDataCache('Item', []).findIndex(item => item && item.name === '일반 떡밥')), 1000);
    assert.strictEqual(rpg.getInventoryItemCount(rewardUser, rpg.getDataCache('Item', []).findIndex(item => item && item.name === '강화석')), 1000);
    assert.strictEqual(rpg.getInventoryItemCount(rewardUser, rpg.getDataCache('Item', []).findIndex(item => item && item.name === '5성 카드팩')), 2);
    assert.strictEqual(rewardUser.field, null);
    assert.strictEqual(rewardUser.dailyDungeonDaily.outcome, 'cleared');

    const progressUser = makeUser('일일진행테스트', 101);
    assert.ok((await rpg.enterDailyDungeon(progressUser, '마동')).startsWith('✅'));
    const dungeon = rpg.findDailyDungeonByName('마동');
    const beforeExp = progressUser.exp;
    const beforeGold = progressUser.gold;
    const beforeInventory = JSON.stringify(progressUser.inventory.item);
    const progressText = rpg.buildHuntResult(progressUser, dungeon, Number(dungeon.hp) * 1999, { precalculatedDamage: true, summonAttack: true, isBotAutoAttack: true, disableEquipmentBonusDamage: true });
    assert.ok(progressText.includes('1,999/2,000마리'));
    assert.strictEqual(progressUser.exp, beforeExp);
    assert.strictEqual(progressUser.gold, beforeGold);
    assert.strictEqual(JSON.stringify(progressUser.inventory.item), beforeInventory);
    assert.strictEqual(progressUser.field.elite, null);
    assert.strictEqual(progressUser.pendingFragment, null);
    try {
        Math.random = () => 0.99;
        const clearText = rpg.buildHuntResult(progressUser, dungeon, Number(dungeon.hp) * 10, { precalculatedDamage: true, summonAttack: true, isBotAutoAttack: true, disableEquipmentBonusDamage: true });
        assert.ok(clearText.includes('2,000/2,000마리'));
        assert.ok(clearText.includes('일일 던전 클리어'));
    } finally {
        Math.random = originalRandom;
    }
    assert.strictEqual(progressUser.field, null);
    assert.strictEqual(progressUser.dailyDungeonDaily.outcome, 'cleared');

    console.log('daily_dungeon.test.js: OK');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
