'use strict';
// 팝니다, 삽니다 시세 기록(TradeLog.prices)과 /api/market/history. DynamoDB SDK 경계만 메모리로 대체한다.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const AWS = require('aws-sdk');
AWS.S3 = class { listObjectsV2() { return { promise: async () => ({ Contents: [] }) }; } };
delete process.env.SUPABASE_URL_P;
delete process.env.SUPABASE_KEY_P;
process.env.ADMIN_SESSION_SECRET = 'market-price-isolated-test';
process.env.PORT = '0';

const data = Object.fromEntries(fs.readdirSync(path.join(__dirname, '../DB/RPGenius')).filter(name => name.endsWith('.json'))
    .map(name => [name.slice(0, -5), JSON.parse(fs.readFileSync(path.join(__dirname, '../DB/RPGenius', name), 'utf8'))]));
const itemId = data.Item.findIndex(item => item && item.no_trade !== true && item.type === '소모품');
const weaponId = data.Equipment.weapon.findIndex(item => item && item.no_trade !== true && item.rarity !== '신화');
// 예전 거래 로그: 처음 시세를 만들 때 이 기록으로 채운다. 삽니다 체결은 조건 값(종류 무관=null)을 쓴다.
const OLD = Date.parse('2026-11-01T12:00:00+09:00');
data.TradeLog = { items: [
    { id: 'old2', time: OLD + 60000, tradeType: '삽니다', buyer: '옛구매자', seller: '옛판매자', kind: 'card', payload: { id: 1, star: 3 }, count: 1, unitPrice: 700, totalPrice: 700, fee: 35, currency: 'gold' },
    { id: 'old1', time: OLD, tradeType: '경매장', buyer: '옛구매자', seller: '옛판매자', kind: 'card', payload: { id: 1, star: 3, type: '전직', skin: '' }, count: 1, unitPrice: 900, totalPrice: 900, fee: 45, currency: 'gold' }
] };
data.Auction = { items: [] }; data.BuyOrder = { items: [] }; data.Banner = [];
const user = (id, name, inventory) => [id, { id, name, code: 'isolated', _get: 1, avatarMigrated: true, need_character_card_select: false,
    main_card: { id: 0, star: 0, type: '일반' }, inventory: { item: [], card: [], equipment: [], pet: [], ...inventory }, gold: 10000000, garnet: 10000, mail: [], mailNotified: true }];
const users = new Map([
    user('1', '판매자', { card: [{ id: 1, star: 3, type: '전직', skin: '' }, { id: 1, star: 3, type: '일반', skin: '' }], equipment: [{ type: 'weapon', id: weaponId, level: 7 }], item: [{ id: itemId, count: 100 }] }),
    user('2', '구매자', {})
]);
const row = input => input.TableName === 'rpgenius_data' ? (data[input.Key?.key] === undefined ? undefined : { key: input.Key.key, data: data[input.Key.key] }) : users.get(input.Key?.id);
function write(input, put) {
    if (put) { if (input.TableName === 'rpgenius_data') data[input.Item.key] = structuredClone(input.Item.data); else users.set(input.Item.id, structuredClone(input.Item)); return; }
    const target = users.get(input.Key.id);
    const set = input.UpdateExpression.match(/SET (.*?)(?: REMOVE|$)/)?.[1];
    if (set) for (const assignment of set.split(',')) { const [key, value] = assignment.split('=').map(part => part.trim()); target[input.ExpressionAttributeNames[key]] = structuredClone(input.ExpressionAttributeValues[value]); }
    const remove = input.UpdateExpression.match(/REMOVE (.*)$/)?.[1];
    if (remove) for (const key of remove.split(',')) delete target[input.ExpressionAttributeNames[key.trim()]];
}
DynamoDBDocumentClient.prototype.send = async command => {
    const input = command.input, name = command.constructor.name;
    if (name === 'GetCommand') return { Item: structuredClone(row(input)) };
    if (name === 'BatchGetCommand') return { Responses: Object.fromEntries(Object.entries(input.RequestItems).map(([table, request]) => [table, request.Keys.map(Key => structuredClone(row({ TableName: table, Key }))).filter(Boolean)])) };
    if (name === 'ScanCommand') return { Items: input.TableName === 'rpgenius_user' ? structuredClone([...users.values()]) : [] };
    if (name === 'TransactWriteCommand') { input.TransactItems.forEach(item => write(item.Put || item.Update, !!item.Put)); return {}; }
    if (name === 'UpdateCommand' || name === 'PutCommand') { write(input, name === 'PutCommand'); return {}; }
    throw new Error('Unexpected isolated database command: ' + name);
};
const rpg = require('../rpgenius');
const startServer = require('../server');
let http, origin;
function cookie(name, admin = false) {
    const body = Buffer.from(JSON.stringify({ name, admin, exp: Date.now() + 86400000 })).toString('base64url');
    return 'rpg_admin=' + body + '.' + crypto.createHmac('sha256', process.env.ADMIN_SESSION_SECRET).update(body).digest('base64url');
}
async function request(url, body, name = '판매자', method) {
    const response = await fetch(origin + url, { method: method || (body === undefined ? 'GET' : 'POST'), headers: {
        ...(name ? { Cookie: cookie(name, name === '관리자') } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
    }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
}
const history = async (key, name = '판매자') => request('/api/market/history?key=' + encodeURIComponent(key), undefined, name);
before(async () => {
    assert.ok(itemId >= 0 && weaponId >= 0, '시험용 아이템과 무기');
    await rpg.initRpgeniusData();
    http = startServer(); await new Promise(resolve => http.on('listening', resolve));
    origin = 'http://127.0.0.1:' + http.address().port;
});
after(async () => { await new Promise(resolve => http.close(resolve)); });

test('로그인과 품목 키를 확인한다', async () => {
    assert.equal((await history('c:1:3', null)).status, 401);
    for (const key of ['', 'x:1', 'c:1', 'e:WEAPON:1', 'c:1:3;drop']) assert.equal((await history(key)).status, 400, key);
});

test('처음에는 남은 거래 로그로 시세를 채우고, 팝니다 체결은 실제 카드 종류로 쌓는다', async () => {
    const seeded = await history('c:1:3');
    assert.equal(seeded.status, 200);
    assert.deepEqual(seeded.data.trades.map(t => [t.price, t.variant]), [[900, '전직'], [700, null]]);

    const listing = await request('/api/auction/register', { kind: 'card', index: 0, currency: 'gold', price: 1200 });
    assert.equal(listing.status, 200);
    const open = await history('c:1:3', '구매자');
    assert.deepEqual(open.data.asks, [{ price: 1200, count: 1, currency: 'gold', variant: '전직', mine: false }]);
    assert.equal((await history('c:1:3')).data.asks[0].mine, true, '내 매물 표시');

    assert.equal((await request('/api/auction/buy', { id: listing.data.id }, '구매자')).status, 200);
    const after = (await history('c:1:3')).data;
    assert.deepEqual(after.trades.map(t => [t.price, t.count, t.currency, t.variant]), [[900, 1, 'gold', '전직'], [700, 1, 'gold', null], [1200, 1, 'gold', '전직']]);
    assert.deepEqual(after.asks, []);
    const text = JSON.stringify(after);
    for (const name of ['판매자', '구매자', '옛판매자', '옛구매자']) assert.ok(!text.includes(name), '거래 상대 이름을 내보내지 않는다: ' + name);
});

test('삽니다 체결은 조건이 아니라 실제로 판 장비의 강화 수치로 쌓는다', async () => {
    const order = await request('/api/buyorder/register', { kind: 'equipment', equipType: 'weapon', equipId: weaponId, currency: 'gold', price: 5000, count: 1 }, '구매자');
    assert.equal(order.status, 200);
    const open = (await history('e:weapon:' + weaponId)).data;
    assert.deepEqual(open.bids, [{ price: 5000, count: 1, currency: 'gold', variant: null, mine: false }], '강화 무관 조건은 null');
    assert.equal((await request('/api/buyorder/fulfill', { id: order.data.id, index: 0 })).status, 200);
    const done = (await history('e:weapon:' + weaponId)).data;
    assert.deepEqual(done.trades.map(t => [t.price, t.variant]), [[5000, 7]]);
    assert.deepEqual(done.bids, []);
});

test('품목마다 최근 30건만 남기고, 관리자가 거래 로그를 비워도 시세는 남는다', async () => {
    for (let i = 1; i <= 32; i++) {
        const listing = await request('/api/auction/register', { kind: 'item', itemId, count: 1, currency: 'garnet', price: i });
        assert.equal(listing.status, 200, '등록 ' + i);
        assert.equal((await request('/api/auction/buy', { id: listing.data.id, count: 1 }, '구매자')).status, 200, '구매 ' + i);
    }
    const trades = (await history('i:' + itemId)).data.trades;
    assert.equal(trades.length, 30);
    assert.deepEqual([trades[0].price, trades[29].price], [3, 32]);
    assert.ok(trades.every(t => t.currency === 'garnet' && t.variant === null));

    assert.equal((await request('/api/admin/tradelog', undefined, '관리자', 'DELETE')).status, 200);
    assert.deepEqual(data.TradeLog.items, []);
    assert.equal((await history('i:' + itemId)).data.trades.length, 30);
});

test('시세 크기가 상한을 넘으면 가장 오래된 체결부터 지운다', async () => {
    const prices = rpg.getDataCache('TradeLog').prices;
    for (let k = 0; k < 200; k++) prices['a:가짜' + k] = Array.from({ length: 30 }, (_, i) => [OLD - 1e9 + k * 1000 + i, 123456789, 1, 'gold', null]);
    const listing = await request('/api/auction/register', { kind: 'card', index: 0, currency: 'gold', price: 1500 });
    assert.equal((await request('/api/auction/buy', { id: listing.data.id }, '구매자')).status, 200);
    const saved = data.TradeLog.prices;
    assert.ok(JSON.stringify(saved).length <= 150000, '저장된 시세 ' + JSON.stringify(saved).length);
    assert.ok(!saved['a:가짜0'], '가장 오래된 품목부터 지운다');
    assert.ok(saved['a:가짜199'], '최근 품목은 남는다');
    assert.equal(saved['c:1:3'].at(-1)[1], 1500, '방금 체결은 남는다');
    assert.equal(saved['c:1:3'].at(-1)[4], '일반');
});
