// DynamoDB는 전부 메모리로 대체한다. 운영 자격 증명/DB를 사용하지 않는다.
const assert = require('assert/strict');
const { isDeepStrictEqual } = require('util');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const catalog = require('../shop_catalog');

const product = count => ({ type: '가넷', count, price: { goods: 'gold', amount: 10 }, limits: { max: 10, daily: 5, weekly: 8, monthly: 10, global: 20 } });
const initial = { '일반': [product(10), product(20), product(30)], '이동': [] };
const data = { Shop: structuredClone(initial), Item: [], Bundle: [], ShopState: { '일반': { '1': { global: 4 }, '2': { global: 7 } } } };
const writes = [];
DynamoDBDocumentClient.prototype.send = async function (command) {
    const input = command.input;
    if (command.constructor.name == 'GetCommand') return Object.hasOwn(data, input.Key.key)
        ? { Item: { key: input.Key.key, data: structuredClone(data[input.Key.key]) } } : {};
    if (command.constructor.name == 'ScanCommand') return { Items: [] };
    if (command.constructor.name == 'TransactWriteCommand') {
        const changes = input.TransactItems.map(entry => entry.Put);
        if (changes.some(entry => !isDeepStrictEqual(data[entry.Item.key], entry.ExpressionAttributeValues[':previous']))) {
            throw Object.assign(new Error('conflict'), { name: 'TransactionCanceledException', CancellationReasons: [{ Code: 'ConditionalCheckFailed' }] });
        }
        changes.forEach(entry => { writes.push(structuredClone(entry.Item)); data[entry.Item.key] = structuredClone(entry.Item.data); });
        return {};
    }
    if (command.constructor.name == 'PutCommand' && input.TableName == 'rpgenius_data') {
        if (input.Item.key == 'Shop') {
            assert.equal(input.ConditionExpression, '#data = :previous');
            if (!isDeepStrictEqual(data.Shop, input.ExpressionAttributeValues[':previous'])) throw Object.assign(new Error('conflict'), { name: 'ConditionalCheckFailedException' });
        }
        writes.push(structuredClone(input.Item));
        data[input.Item.key] = structuredClone(input.Item.data);
        return {};
    }
    throw new Error('Unexpected DB command: ' + command.constructor.name);
};
const rpg = require('../rpgenius');

(async () => {
    await rpg.initRpgeniusData();
    assert.equal(writes.length, 0, '부팅/조회 시 운영 데이터 쓰기가 없어야 한다');
    let shop = rpg.getDataCache('Shop', {});
    const [a, b, c] = shop['일반'];
    assert.deepEqual(data.Shop, initial, 'ID가 포함된 조회는 원본을 수정하지 않는다');
    assert.equal(rpg.getDataCache('Shop', {})['일반'][1].shopId, b.shopId, '저장 전 조회도 같은 ID');
    const user = { gold: 10000, garnet: 0, shopPurchases: {}, save: async () => {} };
    const now = new Date();
    const status = (item, group = '일반', index = 0) => rpg.getShopRemainingLimits(user, group, index, item, now);
    Object.assign(status(b, '일반', 1).rec, { max: 2, daily: 1, weekly: 2, monthly: 2 });
    Object.assign(status(c, '일반', 2).rec, { max: 3, daily: 2, weekly: 3, monthly: 3 });

    // 앞 상품 삭제와 다른 상점 이동: 개인/기간/전체 기록 모두 원래 상품에 남는다.
    shop['일반'].shift();
    shop['이동'].push(shop['일반'].pop());
    await rpg.saveRpgeniusDataEntry('Shop', shop);
    assert.deepEqual(status(b).remaining, { max: 8, daily: 4, weekly: 6, monthly: 8, global: 16 });
    assert.deepEqual(status(c, '이동').remaining, { max: 7, daily: 3, weekly: 5, monthly: 7, global: 13 });
    assert.deepEqual(data.Shop['일반'][0].price, initial['일반'][1].price);
    assert.equal(data.Shop['일반'][0].count, initial['일반'][1].count);

    // 같은 아이템을 다시 추가해도 기존 상품 기록을 공유하지 않는다.
    const added = { ...structuredClone(b), shopId: catalog.newShopItemId() };
    shop['일반'].unshift(added);
    await rpg.saveRpgeniusDataEntry('Shop', shop);
    assert.equal(status(added).rec.max, 0);
    assert.equal(status(added).globalCount, 0);
    assert.ok((await rpg.purchaseShopItem(user, '일반', added.shopId, 1)).startsWith('✅'));
    assert.equal(user.garnet, 20);
    assert.equal(status(added).rec.daily, 1);
    assert.equal(status(added).globalCount, 1);
    assert.equal(status(b).rec.daily, 1);

    // 오래 열어둔 웹 화면의 상품 ID는 새 순서에서도 동일 상품만 구매한다.
    assert.ok((await rpg.purchaseShopItem(user, '일반', b.shopId, 1)).startsWith('✅'));
    assert.equal(user.garnet, 40);
    assert.equal(status(b).rec.daily, 2);
    assert.equal(status(b).globalCount, 5);
    shop['이동'].push(shop['일반'].pop());
    await rpg.saveRpgeniusDataEntry('Shop', shop);
    const before = user.gold;
    assert.ok((await rpg.purchaseShopItem(user, '일반', b.shopId, 1)).startsWith('❌'));
    assert.equal(user.gold, before);
    assert.ok((await rpg.purchaseShopItem(user, '이동', b.shopId, 1)).startsWith('✅'));
    assert.equal(status(b, '이동').rec.daily, 3);
    assert.equal(status(b, '이동').globalCount, 6);
    assert.ok((await rpg.purchaseShopItem(user, '이동', b.shopId, 3)).includes('구매 제한'));

    // 기존 채팅 명령의 1부터 시작하는 상품 번호도 유지한다.
    assert.ok((await rpg.purchaseShopItem(user, '일반', '1', 1)).startsWith('✅'));
    assert.equal(status(added).rec.daily, 2);
    const loaded = new rpg.RPGUser('shop-test', 'shop-test');
    loaded.load({ shopPurchases: structuredClone(user.shopPurchases), avatarMigrated: true });
    assert.deepEqual(loaded.shopPurchases, user.shopPurchases, '유저 로드 시 고정 ID 기록 보존');

    // 이동한 상점 기준 초기화는 실제 상품들의 옛 주소/새 ID 기록만 초기화한다.
    const globalRecords = structuredClone(data.ShopState);
    assert.equal(catalog.resetShopRecords(globalRecords, [b.shopId, c.shopId]), 2);
    assert.equal(globalRecords['@items'][added.shopId].global, 2);
    assert.equal(catalog.resetShopRecords(user.shopPurchases, [b.shopId]), 1);
    assert.equal(status(b, '이동').rec.max, 0);
    assert.equal(status(c, '이동').rec.max, 3);
    assert.equal(status(added).rec.max, 2);

    // 일/주/월 만료 처리와 누적 제한은 고정 ID에도 동일하게 적용된다.
    const nextMonth = new Date(now.getTime() + 40 * 86400000);
    const later = rpg.getShopRemainingLimits(user, '이동', 0, c, nextMonth);
    assert.equal(later.rec.max, 3);
    assert.equal(later.rec.daily, 0);
    assert.equal(later.rec.weekly, 0);
    assert.equal(later.rec.monthly, 0);

    // 삭제한 상품 ID는 뒤 상품이나 새 상품으로 대체되지 않는다.
    shop['이동'] = shop['이동'].filter(item => item.shopId != b.shopId);
    await rpg.saveRpgeniusDataEntry('Shop', shop);
    assert.ok((await rpg.purchaseShopItem(user, '이동', b.shopId, 1)).startsWith('❌'));
    assert.ok((await rpg.purchaseShopItem(user, '일반', a.shopId, 1)).startsWith('❌'));
    const duplicate = rpg.getDataCache('Shop', {});
    duplicate['일반'].push(structuredClone(duplicate['일반'][0]));
    await assert.rejects(rpg.saveRpgeniusDataEntry('Shop', duplicate), /중복/);
    const noId = rpg.getDataCache('Shop', {});
    delete noId['일반'][0].shopId;
    await assert.rejects(rpg.saveRpgeniusDataEntry('Shop', noId), /상품 ID/);
    assert.throws(() => catalog.readShopCatalog(JSON.parse('{"__proto__":[]}')), /상점 목록/);

    // 관리자 JSON 편집은 버전과 ID를 보존해야 하며, 중간 변경을 덮어쓰지 않는다.
    shop = rpg.getDataCache('Shop', {});
    const revision = catalog.shopCatalogRevision(shop);
    const edited = structuredClone(shop);
    edited['이름 변경'] = edited['이동'];
    delete edited['이동'];
    await rpg.saveRpgeniusDataEntry('Shop', edited, { revision });
    assert.equal(status(c, '이름 변경').globalCount, 7);
    await assert.rejects(rpg.saveRpgeniusDataEntry('Shop', structuredClone(shop), { revision }), error => error.status == 409);
    await assert.rejects(rpg.saveRpgeniusDataEntry('Shop', structuredClone(edited)), error => error.status == 409);
    const raced = rpg.getDataCache('Shop', {});
    data.Shop['일반'][0].price.amount = 100;
    await assert.rejects(rpg.saveRpgeniusDataEntry('Shop', raced), error => error.status == 409);
    assert.equal(data.Shop['일반'][0].price.amount, 100);

    // 패키지 생성 중 상점 저장이 충돌하면 번들/아이템만 남는 부분 저장도 없어야 한다.
    await rpg.loadRpgeniusDataEntry('Shop');
    const packageShop = rpg.getDataCache('Shop', {});
    const packageItem = { name: '꾸러미', type: '번들', pack: 0 };
    const packageBundle = [{ type: '골드', count: { min: 100, max: 100 } }];
    packageShop['패키지'] = [{ shopId: catalog.newShopItemId(), type: '아이템', item_id: 0, count: 1, price: { goods: 'gold', amount: 10 } }];
    data.Shop['일반'][0].price.amount = 200;
    await assert.rejects(rpg.saveShopPackage(packageShop, [packageItem], [packageBundle]), error => error.status == 409);
    assert.deepEqual(data.Item, []);
    assert.deepEqual(data.Bundle, []);
    assert.deepEqual(rpg.getDataCache('Item', []), []);
    await rpg.loadRpgeniusDataEntry('Shop');
    const retryShop = rpg.getDataCache('Shop', {});
    retryShop['패키지'] = packageShop['패키지'];
    await rpg.saveShopPackage(retryShop, [packageItem], [packageBundle]);
    assert.equal(data.Shop['패키지'][0].shopId, packageShop['패키지'][0].shopId);
    assert.deepEqual(data.Item, [packageItem]);
    assert.deepEqual(data.Bundle, [packageBundle]);

    // 구매 저장을 기다리는 중 상품이 이동해도 전역 수량은 같은 상품에 적립한다.
    const globalBeforeMove = status(added).globalCount;
    user.save = async () => {
        const moving = rpg.getDataCache('Shop', {});
        moving['이름 변경'].push(moving['일반'].shift());
        await rpg.saveRpgeniusDataEntry('Shop', moving);
    };
    assert.ok((await rpg.purchaseShopItem(user, '일반', added.shopId, 1)).startsWith('✅'));
    assert.equal(status(added, '이름 변경').globalCount, globalBeforeMove + 1);
    assert.equal(status(c, '이름 변경').globalCount, 7);
    console.log('shop_identity.test.js: OK (삭제·이동·재정렬·기존 기록·구매·초기화·기간 만료·동시 편집·패키지 원자적 저장, DB 격리)');
})().catch(error => { console.error(error); process.exitCode = 1; });
