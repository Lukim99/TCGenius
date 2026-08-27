const assert = require('assert');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');

DynamoDBDocumentClient.prototype.send = async function (command) {
    if (command.constructor.name === 'ScanCommand') return { Items: [] };
    if (command.constructor.name === 'GetCommand') return {};
    if (command.constructor.name === 'UpdateCommand') return {};
    throw new Error('Unexpected command: ' + command.constructor.name);
};

const rpg = require('../rpgenius');
const pvp = require('../pvp');

const NOW = Date.parse('2026-08-27T12:00:00+09:00');

{
    const user = new rpg.RPGUser('축복구매', 'blessing-purchase');
    user.point = 5000;
    const first = rpg.purchaseBlessing(user, 'yusaeng', NOW);
    assert.strictEqual(first.ok, true);
    assert.strictEqual(user.point, 3500);
    assert.strictEqual(first.expiresAt, NOW + rpg.BLESSING_DURATION_MS);

    const extension = rpg.purchaseBlessing(user, 'yusaeng', NOW + 1000);
    assert.strictEqual(extension.expiresAt, NOW + rpg.BLESSING_DURATION_MS * 2, '활성 축복은 남은 기간 뒤로 30일 연장돼야 한다.');
    assert.strictEqual(user.point, 2000);
    assert.strictEqual(rpg.isBlessingActive(user, 'yusaeng', extension.expiresAt - 1), true);
    assert.strictEqual(rpg.isBlessingActive(user, 'yusaeng', extension.expiresAt), false, '만료 시각부터 효과가 종료돼야 한다.');
}

{
    const user = new rpg.RPGUser('축복사용권', 'blessing-pass');
    const oneDay = rpg.extendBlessing(user, 'divine', rpg.BLESSING_DAY_MS, NOW);
    assert.strictEqual(oneDay.expiresAt, NOW + rpg.BLESSING_DAY_MS);
    const sevenDays = rpg.extendBlessing(user, 'divine', rpg.BLESSING_DAY_MS * 7, NOW + 1000);
    assert.strictEqual(sevenDays.expiresAt, NOW + rpg.BLESSING_DAY_MS * 8, '사용권은 남은 기간 뒤로 연장돼야 한다.');
    assert.strictEqual(rpg.extendBlessing(user, 'unknown', rpg.BLESSING_DAY_MS, NOW).error, '존재하지 않는 축복입니다.');
}

{
    const user = new rpg.RPGUser('할인', 'blessing-discount');
    user.blessings.yusaeng = NOW + 1000;
    assert.deepStrictEqual(
        rpg.applyBlessingEnhancementDiscount(user, { stone: 101, gold: 1001 }, NOW),
        { stone: 96, gold: 951, originalStone: 101, originalGold: 1001, discountRate: 0.05 }
    );
    user.blessings.divine = NOW + 1000;
    const divine = rpg.applyBlessingEnhancementDiscount(user, { stone: 101, gold: 1001 }, NOW);
    assert.strictEqual(divine.stone, 86);
    assert.strictEqual(divine.gold, 851);
    assert.strictEqual(divine.discountRate, 0.15, '유생 계열 할인은 동시에 활성화되면 합산돼야 한다.');
    assert.strictEqual(rpg.getMailFeeRate(user, NOW), 0.02);
    assert.strictEqual(rpg.mailGoldFee(1000, user, NOW), 20);
}

{
    const user = new rpg.RPGUser('루킴', 'blessing-rukim');
    const before = rpg.calculateUserStats(user);
    user.blessings.rukim = Date.now() + 60_000;
    const after = rpg.calculateUserStats(user);
    assert.strictEqual(after.itemDropChance - before.itemDropChance, 0.10);
    assert.strictEqual(after.exp - before.exp, 0.10);
    assert.strictEqual(after.gold - before.gold, 0.10);
    assert.strictEqual(after.bossDmg - before.bossDmg, 0.05);
    assert.strictEqual(after.hp - before.hp, 1000);
    assert.strictEqual(after.mp - before.mp, 200);
    user.hp = after.hp;
    user.mp = after.mp;
    user.blessings.rukim = Date.now() - 1;
    const expired = rpg.calculateUserStats(user);
    assert.strictEqual(user.hp, expired.hp, '루킴 축복 만료 후 현재 체력은 최대 체력으로 정리돼야 한다.');
    assert.strictEqual(user.mp, expired.mp, '루킴 축복 만료 후 현재 MP는 최대 MP로 정리돼야 한다.');
}

{
    const user = new rpg.RPGUser('PVP', 'blessing-pvp');
    pvp.__setNow(() => NOW);
    assert.strictEqual(pvp.getExtraPlayCost(user), 10);
    user.blessings.divine = NOW + 1000;
    assert.strictEqual(pvp.getExtraPlayCost(user), 0);
}

console.log('blessing.test.js: OK');
