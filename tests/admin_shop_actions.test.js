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
const data = { Shop: { 일반: [first, second], 다른상점: [other] }, ShopState: {}, Item: [], Bundle: [], Fashion: [] };
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
        console.log('admin_shop_actions.test.js: OK (관리자 인증, 선택 초기화, 전체 검증, 순서 변경, 패키지·이미지 연결, 중복 방지; DB/S3 격리)');
    } finally { await new Promise(resolve => http.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
