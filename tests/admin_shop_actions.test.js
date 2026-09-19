// 실제 관리자 HTTP 경로를 사용하되 DB와 이미지 저장소는 메모리로 격리한다.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { isDeepStrictEqual } = require('node:util');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const catalog = require('../shop_catalog');

process.env.ADMIN_SESSION_SECRET = 'admin-workflow-test';
process.env.PORT = '0';
delete process.env.SUPABASE_URL_P;
delete process.env.SUPABASE_KEY_P;
const product = name => ({ shopId: catalog.newShopItemId(), type: '가넷', name, count: 1, price: { goods: 'gold', amount: 10 } });
const [first, second, other] = ['첫 상품', '둘째 상품', '다른 상점 상품'].map(product);
const data = {
    Shop: { 일반: [first, second], 다른상점: [other], 패키지: [] }, ShopState: {}, Item: [], Bundle: [],
    Fashion: [{ name: '테스트 아바타', primary_card: [0], requireStar: 6 }],
    Equipment: Object.fromEntries(['weapon', 'armor', 'accessory', 'support'].map(slot => [slot, [{ name: slot, rarity: '일반', stat: {}, plusStat: {} }]])),
    Pet: [{ name: '테스트 펫', rarity: '일반', stat: {}, plusStat: {} }]
};
const writes = [];
DynamoDBDocumentClient.prototype.send = async function(command) {
    const input = command.input;
    if (command.constructor.name === 'GetCommand') return Object.hasOwn(data, input.Key.key) ? { Item: { key: input.Key.key, data: structuredClone(data[input.Key.key]) } } : {};
    if (command.constructor.name === 'ScanCommand') return { Items: [] };
    if (command.constructor.name === 'TransactWriteCommand') {
        const changes = input.TransactItems.map(item => item.Put);
        assert.ok(changes.every(change => isDeepStrictEqual(data[change.Item.key], change.ExpressionAttributeValues[':previous'])));
        changes.forEach(change => { data[change.Item.key] = structuredClone(change.Item.data); writes.push(change.Item.key); });
        return {};
    }
    if (command.constructor.name === 'PutCommand' && input.TableName === 'rpgenius_data') {
        data[input.Item.key] = structuredClone(input.Item.data); writes.push(input.Item.key); return {};
    }
    throw new Error('Unexpected DB access: ' + command.constructor.name);
};
const assetPath = require.resolve('../asset_store');
const images = new Map();
require.cache[assetPath] = { id: assetPath, filename: assetPath, loaded: true, exports: {
    ready: Promise.resolve(), CATEGORY_NAMES: ['itemImage'], syncState: { status: 'done', checked: 0 },
    getLocalFilePath: (category, path) => images.has(category + '/' + path) ? '/isolated-image.png' : null,
    saveAsset: async (category, path, bytes) => { images.set(category + '/' + path, Buffer.from(bytes)); return { ok: true }; }
} };
const rpg = require('../rpgenius');
const records = () => ({ '@items': Object.fromEntries([first, second, other].map(item => [item.shopId, { max: 3, global: 5 }])) });
let userSaves = 0;
const user = { name: 'admin-workflow-test', shopPurchases: records(), save: async () => { userSaves++; } };
rpg.getAllRPGUsers = async () => [user];
const buyer = new rpg.RPGUser(user.name, 'isolated-buyer');
buyer.gold = 1000;
buyer.save = async () => {};
rpg.getRPGUserByName = async () => buyer;

(async () => {
    await rpg.initRpgeniusData();
    data.ShopState = records();
    const express = require('express');
    const originalListen = express.application.listen;
    let http;
    express.application.listen = function(...args) { http = originalListen.apply(this, args); return http; };
    require('../server')();
    express.application.listen = originalListen;
    await once(http, 'listening');
    const origin = 'http://127.0.0.1:' + http.address().port;
    const payload = Buffer.from(JSON.stringify({ name: user.name, admin: true, exp: Date.now() + 60000 })).toString('base64url');
    const cookie = 'rpg_admin=' + payload + '.' + crypto.createHmac('sha256', process.env.ADMIN_SESSION_SECRET).update(payload).digest('base64url');
    const post = (path, body, authenticated = true) => fetch(origin + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(authenticated ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
    const reset = body => post('/api/admin/shop-limits/reset', body);
    try {
        assert.equal((await post('/api/admin/shop-limits/reset', { scope: 'all' }, false)).status, 401);
        for (const shopIds of [[], [null], ['missing'], [first.shopId, other.shopId]]) {
            const response = await reset({ scope: 'items', shopType: '일반', shopIds });
            assert.ok([400, 409].includes(response.status));
        }
        assert.equal(userSaves, 0, '전체 선택 검증이 끝나기 전에는 유저 기록을 변경하지 않는다');
        assert.equal(writes.length, 0);
        // 화면에서 선택한 ID를 보내므로 서버에서 상품 순서가 바뀌어도 그대로 처리한다.
        data.Shop.일반.reverse();
        const response = await reset({ scope: 'items', shopType: '일반', shopIds: [first.shopId, second.shopId, first.shopId] });
        assert.equal(response.status, 200);
        const out = await response.json();
        assert.equal(out.userUpdated, 1);
        assert.equal(out.globalUpdated, 2);
        assert.deepEqual(Object.keys(user.shopPurchases['@items']), [other.shopId]);
        assert.deepEqual(Object.keys(data.ShopState['@items']), [other.shopId]);
        const repeated = await reset({ scope: 'items', shopType: '일반', shopIds: [first.shopId] });
        assert.equal((await repeated.json()).userUpdated, 0);

        const body = { name: '테스트 패키지', rewards: [{ type: '골드', count: 20 }], shopType: '일반', price: { goods: 'garnet', amount: 100 }, withImage: true };
        const created = await post('/api/admin/package/create', body);
        assert.equal(created.status, 200);
        const result = await created.json();
        assert.equal(data.Item[result.itemIndex].name, body.name);
        assert.equal(data.Item[result.itemIndex].pack, result.bundleIndex);
        assert.equal(data.Shop.일반[result.shopIndex].shopId, result.shopId);
        assert.equal((await post('/api/admin/package/create', body)).status, 409, '중복 등록으로 기존 아이템 이미지를 덮어쓰지 않는다');
        images.set('itemImage/번들/기존 이미지.png', Buffer.from('existing'));
        assert.equal((await post('/api/admin/package/create', { ...body, name: '기존 이미지' })).status, 409);
        assert.equal((await post('/api/admin/package/create', { ...body, name: '../경로' })).status, 400);
        const upload = await fetch(origin + '/api/admin/assets/upload?category=itemImage', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'image/png', 'X-Asset-Path': encodeURIComponent('번들/테스트 패키지.png') }, body: Buffer.from('isolated-image') });
        assert.equal(upload.status, 200);
        assert.ok(images.has('itemImage/번들/테스트 패키지.png'));
        const title = rpg.getTitleDefs()[0];
        const rewardGroups = [
            [
                { type: '아이템', item_id: result.itemIndex, count: { min: 2, max: 3 } },
                { type: '캐릭터카드', card_id: 0, display_star: 7, card_type: '일반', skin: '테스트 아바타', count: 2 },
                { type: '아바타', fashion: '테스트 아바타', count: 1 },
                ...Object.entries({ 무기: 'weapon_id', 갑옷: 'armor_id', 장신구: 'accessory_id', 보조: 'support_id' }).map(([type, key]) => ({ type, [key]: 0, count: 1 })),
                { type: '펫', pet_id: 0, count: 1 },
                { type: '칭호', title_id: title.id, count: 1 }
            ],
            ['골드', '가넷', '포인트', '마일리지', '경험치'].map(type => ({ type, count: 5 }))
        ];
        for (const [index, rewards] of rewardGroups.entries()) {
            const response = await post('/api/admin/package/create', { name: '확장 패키지 ' + index, rewards, shopType: '패키지', price: { goods: 'gold', amount: 10 } });
            const created = await response.json();
            assert.equal(response.status, 200, JSON.stringify(created));
            assert.deepEqual(data.Bundle[created.bundleIndex], rewards.map(reward => ({ ...reward, count: typeof reward.count === 'object' ? reward.count : { min: reward.count, max: reward.count } })));
            const purchase = await post('/api/shop/buy', { shopType: '패키지', shopId: created.shopId, count: 1 });
            const granted = await purchase.json();
            assert.equal(purchase.status, 200, JSON.stringify(granted));
            assert.equal(granted.bundleGranted.length, rewards.length);
            if (index === 0) {
                const titleReward = granted.bundleGranted.find(reward => reward.type === 'title');
                assert.equal(titleReward.name, title.name + ' 칭호');
                assert.equal(titleReward.iconUrl, rpg.getTitleImageUrl(title.name));
                assert.ok(!titleReward.name.includes('🏅'));
            }
        }
        assert.ok([2, 3].includes(rpg.getInventoryItemCount(buyer, result.itemIndex)));
        assert.equal(buyer.inventory.card.length, 2);
        assert.ok(buyer.inventory.card.every(card => card.id === 0 && card.star === 6 && card.skin === '테스트 아바타'));
        assert.equal(buyer.inventory.equipment.length, 4);
        assert.equal(buyer.inventory.pet[0].id, 0);
        assert.ok(buyer.titles.includes(title.id));
        assert.ok(rpg.hasAvatar(buyer, '테스트 아바타'));
        assert.equal(buyer.gold, 985);
        for (const key of ['garnet', 'point', 'mileage', 'exp']) assert.equal(buyer[key], 5, key);
        const writesBeforeInvalid = writes.length;
        for (const reward of [
            { type: '골드', count: { min: 3, max: 2 } }, { type: '골드', count: 1.5 },
            { type: '칭호', title_id: 'missing', count: 1 }, { type: '칭호', title_id: title.id, count: 2 },
            { type: '무기', weapon_id: 999, count: 1 }, { type: '펫', pet_id: 999, count: 1 },
            { type: '아바타', fashion: 'missing', count: 1 },
            { type: '캐릭터카드', card_id: 0, display_star: 1, skin: '테스트 아바타', count: 1 },
            { type: '캐릭터카드', card_id: 0, display_star: 13, count: 1 }
        ]) {
            assert.equal((await post('/api/admin/package/create', { ...body, name: '잘못된 보상', withImage: false, rewards: [reward] })).status, 400, JSON.stringify(reward));
        }
        assert.equal(writes.length, writesBeforeInvalid, '잘못된 보상은 운영 데이터에 저장하지 않는다');
        console.log('admin_shop_actions.test.js: OK (관리자 인증, 선택 초기화, 패키지 14종 등록·구매·지급, 칭호 이미지, 잘못된 보상 차단; DB/S3 격리)');
    } finally { await new Promise(resolve => http.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
