const assert = require('assert');
const fs = require('fs');
const path = require('path');

for (const line of fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
}

const rpg = require('../rpgenius');

const MAX = rpg.STAT_POINT_BUY_MAX;
const makeUser = (buyCount = 0) => ({ gold: 1e20, statPoint: 0, statPointBuyCount: buyCount, statPointStats: {} });
const priceOf = (nth) => rpg.getStatPointInfo(makeUser(nth - 1)).nextPrice;
const 억 = 1e8, 조 = 1e12, 경 = 1e16;

// 가격 곡선: 100개째는 억 단위, 200개째는 조 단위 안에 머물러야 한다
assert.ok(priceOf(100) >= 억 && priceOf(100) < 조, '100번째 가격이 억 단위를 벗어남: ' + priceOf(100));
assert.ok(priceOf(200) >= 조 && priceOf(200) < 경, '200번째 가격이 조 단위를 벗어남: ' + priceOf(200));

// 가격은 단조 증가해야 한다 (감쇠가 증가율을 역전시키면 안 됨)
for (let nth = 2; nth <= MAX; nth++) {
    assert.ok(priceOf(nth) >= priceOf(nth - 1), nth + '번째 가격이 이전보다 싸짐');
}

// 상한까지는 구매 가능, 상한 도달 시 다음 가격을 안내하지 않는다
let user = makeUser();
let result = rpg.buyStatPoint(user, MAX);
assert.ok(result.startsWith('✅'), result);
assert.strictEqual(user.statPointBuyCount, MAX);
assert.ok(!result.includes('다음 1개 가격'), result);

// 상한 도달 후 추가 구매는 거부되고 상태가 변하지 않는다
const goldBefore = user.gold;
result = rpg.buyStatPoint(user, 1);
assert.ok(result.startsWith('❌') && result.includes('최대'), result);
assert.strictEqual(user.statPointBuyCount, MAX);
assert.strictEqual(user.gold, goldBefore);

// 경계: 상한을 넘기는 묶음 구매는 거부, 딱 맞는 구매는 허용
user = makeUser(MAX - 1);
assert.ok(rpg.buyStatPoint(user, 2).startsWith('❌'));
assert.strictEqual(user.statPointBuyCount, MAX - 1);
assert.ok(rpg.buyStatPoint(user, 1).startsWith('✅'));
assert.strictEqual(user.statPointBuyCount, MAX);

// 상한 미만이면 다음 가격을 안내한다
assert.ok(rpg.buyStatPoint(makeUser(), 1).includes('다음 1개 가격'));

// 현황 표시와 웹 정보가 상한을 반영한다
assert.ok(rpg.formatStatPointStatus(makeUser(MAX)).includes(MAX + '/' + MAX));
assert.ok(!rpg.formatStatPointStatus(makeUser(MAX)).includes('다음 1개 가격'));
assert.ok(rpg.formatStatPointStatus(makeUser()).includes('다음 1개 가격'));
assert.strictEqual(rpg.getStatPointInfo(makeUser(MAX)).nextPrice, null);
assert.strictEqual(rpg.getStatPointInfo(makeUser()).buyMax, MAX);
assert.ok(rpg.getStatPointInfo(makeUser()).nextPrice > 0);

console.log('stat_point_buy_cap: OK');
