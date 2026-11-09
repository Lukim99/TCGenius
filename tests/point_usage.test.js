// Real game persistence and HTTP routes, with both database transports isolated.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
process.env.SUPABASE_URL = 'https://point-usage.test';
process.env.SUPABASE_KEY = 'sb_publishable_isolated_test';
process.env.SUPABASE_SECRET_KEY = 'isolated-test-secret-key';
process.env.ADMIN_SESSION_SECRET = 'point-usage-test';
delete process.env.SUPABASE_URL_P; delete process.env.SUPABASE_KEY_P;
const originalFetch = global.fetch;
const rows = new Map(), requests = [], writes = [];
let failWallet = false, failDelivery = false, deliveryGate, deliveryStarted, rpcBody, rpcResponse = {};
global.fetch = async (input, options) => {
    const url = new URL(String(input));
    if (url.hostname === '127.0.0.1') return originalFetch(input, options);
    assert.equal(url.hostname, 'point-usage.test', 'No external network calls in tests');
    assert.equal(new Headers(options.headers).get('apikey'), 'isolated-test-secret-key');
    const body = JSON.parse(options.body); requests.push({ url, options, body });
    if (url.pathname.endsWith('/rpc/rpgenius_point_usage_report')) {
        rpcBody = body; return Response.json(rpcResponse);
    }
    assert.equal(url.searchParams.get('on_conflict'), 'id');
    assert.match(new Headers(options.headers).get('prefer'), /resolution=ignore-duplicates/);
    if (failDelivery) return Response.json({ code: 'OUTAGE', message: 'isolated outage' }, { status: 503 });
    if (deliveryGate) { deliveryStarted(); await deliveryGate; }
    for (const event of body) if (!rows.has(event.id)) rows.set(event.id, event);
    return new Response(null, { status: 201 });
};
const seed = (id, admin = false) => ({ id, name: id, code: 'test-only', point: 10000, isAdmin: admin, avatarMigrated: true, _get: 1,
    inventory: { card: [], item: [], equipment: [], pet: [] }, mail: [], equipments: { pet: [] }, presetSlotsUnlocked: 3 });
let fixtures = [seed('spend'), seed('recipient'), seed('admin', true)];
const data = { Item: [{ name: '테스트 물약', type: '소모품' }], Shop: { 포인트: [
    { shopId: 'shop_00000000000000000000000000000001', type: '아이템', item_id: 0, count: 2, price: { goods: 'point', amount: 100 }, limits: {} }
] } };
DynamoDBDocumentClient.prototype.send = async command => {
    const input = command.input;
    if (command.constructor.name === 'ScanCommand') return { Items: input.TableName === 'rpgenius_user' ? structuredClone(fixtures) : [] };
    if (command.constructor.name === 'GetCommand') return input.TableName === 'rpgenius_data' ? { Item: { data: data[input.Key.key] || [] } } : {};
    if (command.constructor.name === 'UpdateCommand' || command.constructor.name === 'TransactWriteCommand') {
        writes.push(structuredClone(input));
        if (failWallet && input.TableName === 'rpgenius_user' && input.UpdateExpression.startsWith('SET')) throw new Error('wallet failure');
        return {};
    }
    throw new Error('Unexpected DynamoDB operation: ' + command.constructor.name);
};
const assetPath = require.resolve('../asset_store');
require.cache[assetPath] = { id: assetPath, filename: assetPath, loaded: true, exports: { ready: Promise.resolve() } };
const usage = require('../point_usage');
const rpg = require('../rpgenius');
const startServer = require('../server');
let server, base;
const eventsIn = input => Object.values(input.ExpressionAttributeValues?.[':v_pointUsageOutbox'] || {});
const cookie = admin => {
    const payload = Buffer.from(JSON.stringify({ name: admin ? 'admin' : 'spend', admin, exp: Date.now() + 3600000 })).toString('base64url');
    return 'rpg_admin=' + payload + '.' + crypto.createHmac('sha256', process.env.ADMIN_SESSION_SECRET).update(payload).digest('base64url');
};
before(async () => {
    await rpg.initRpgeniusData(); await rpg.getAllRPGUsers();
    process.env.PORT = '0'; server = startServer();
    await new Promise(resolve => server.on('listening', resolve)); base = 'http://127.0.0.1:' + server.address().port;
});
after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); global.fetch = originalFetch; });

test('상점 구매는 상품·수량·가격·잔액과 함께 한 번 저장하고 같은 저장을 반복해도 중복되지 않는다', async () => {
    const user = await rpg.getRPGUserByName('spend');
    assert.match(await rpg.purchaseShopItem(user, '포인트', 1, 3), /구매 완료/);
    const wallet = writes.find(input => eventsIn(input).some(e => e.category === 'shop'));
    assert.ok(wallet.UpdateExpression.includes('#point='));
    const event = eventsIn(wallet)[0];
    assert.equal(event.amount, 300); assert.equal(event.quantity, 3); assert.equal(event.product_name, '테스트 물약');
    assert.equal(event.details.rewardQuantity, 6); assert.equal(event.balance_before, 10000); assert.equal(event.balance_after, 9700);
    await rpg.flushPointUsageOutboxes(); assert.ok(rows.has(event.id));
    const count = rows.size; await user.save(); await rpg.flushPointUsageOutboxes(); assert.equal(rows.size, count);
    assert.equal(rpg.getPointUsageDeliveryStatus().pending, 0);
});

test('저장 실패는 통계에 전송하지 않고 지연 저장 재시도에서 동일 거래를 한 번 보낸다', async () => {
    const user = await rpg.getRPGUserByName('spend'); user.point -= 25;
    usage.record(user, { amount: 25, category: 'personal_draw', action: 'single', productName: '격리 뽑기', details: { requestId: 'request-one' } });
    failWallet = true;
    assert.equal((await user.save()).success, false);
    await rpg.flushPointUsageOutboxes(); assert.equal([...rows.values()].filter(e => e.details.requestId === 'request-one').length, 0);
    failWallet = false;
    await rpg.flushAllDirtyUsers(); await rpg.flushPointUsageOutboxes();
    assert.equal([...rows.values()].filter(e => e.details.requestId === 'request-one').length, 1);
});

test('Supabase 장애 뒤 재시작해도 지갑에 남은 미전송 내역을 복구하며 UUID 중복은 무시한다', async () => {
    failDelivery = true;
    const user = await rpg.getRPGUserByName('spend'); user.point -= 50;
    usage.record(user, { amount: 50, category: 'preset', action: 'unlock', productName: '슬롯' });
    await user.save(); await rpg.flushPointUsageOutboxes();
    const wallet = writes.filter(input => eventsIn(input).some(e => e.category === 'preset')).at(-1);
    const event = eventsIn(wallet).find(e => e.category === 'preset'); assert.equal(rows.has(event.id), false);
    fixtures = [Object.assign(seed('spend'), { point: user.point, pointUsageOutbox: { [event.id]: event } }), seed('recipient'), seed('admin', true)];
    failDelivery = false; await rpg.reloadAllUsersFromDb(true); await rpg.flushPointUsageOutboxes();
    assert.equal(rows.has(event.id), true);
    await usage.publish([event]); assert.equal([...rows.values()].filter(e => e.id === event.id).length, 1);
});

test('다른 인스턴스의 오래된 잔액을 저장해 포인트나 기록을 덮어쓰지 않는다', async () => {
    const a = await rpg.getRPGUserByName('spend'), b = await rpg.getRPGUserByName('spend');
    a.point -= 10; await a.save(); b.point -= 20;
    await assert.rejects(b.save(), /잔액이 변경/);
    assert.equal((await rpg.getRPGUserByName('spend')).point, a.point);
    await rpg.flushPointUsageOutboxes();
    assert.ok([...rows.values()].some(e => e.category === 'unclassified' && e.amount === 10));
});

test('축복과 조건부 저장 경로도 감사 기록을 포함한다', async () => {
    const user = await rpg.getRPGUserByName('spend'); rpg.purchaseBlessing(user, 'rukim');
    await rpg.commitProtectedUserChange(user, ['point', 'blessings', 'mileage']);
    await rpg.flushPointUsageOutboxes();
    assert.ok([...rows.values()].some(e => e.category === 'blessing' && e.amount === 990));
});

test('전송 중 다음 구매가 저장되어도 새 미전송 내역을 지우지 않는다', async () => {
    let release;
    deliveryGate = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { deliveryStarted = resolve; });
    const first = await rpg.getRPGUserByName('spend'); first.point -= 20;
    const firstId = usage.record(first, { amount: 20, category: 'shop', action: 'purchase', productName: '동시 첫 구매' });
    await first.save(); await started;
    const second = await rpg.getRPGUserByName('spend'); second.point -= 30;
    const secondId = usage.record(second, { amount: 30, category: 'shop', action: 'purchase', productName: '동시 다음 구매' });
    const saved = second.save(); deliveryGate = null; release();
    await saved; await rpg.flushPointUsageOutboxes();
    assert.ok(rows.has(firstId)); assert.ok(rows.has(secondId)); assert.equal(rpg.getPointUsageDeliveryStatus().pending, 0);
});

test('메일 선물은 정상 차감하되 포인트 사용 원장에는 기록하지 않는다', async () => {
    const user = await rpg.getRPGUserByName('spend');
    const beforePoint = user.point, beforeCount = rows.size;
    assert.equal((await rpg.sendMail(user, 'recipient', '선물', '', [{ type: 'point', amount: 75 }])).ok, true);
    const tx = writes.findLast(input => input.TransactItems);
    const values = tx.TransactItems[0].Update.ExpressionAttributeValues;
    assert.equal(values[':new_pointUsageOutbox'], undefined);
    assert.equal(values[':new_point'], beforePoint - 75);
    await rpg.flushPointUsageOutboxes(); assert.equal(rows.size, beforeCount);
    await user.save(); await rpg.flushPointUsageOutboxes(); assert.equal(rows.size, beforeCount);
});

test('관리자 API는 인증·날짜 경계·현재 관리자 제외를 강제하고 페이지 전체 집계를 그대로 반환한다', async () => {
    assert.equal((await fetch(base + '/api/admin/point-usage')).status, 401);
    assert.equal((await fetch(base + '/api/admin/point-usage', { headers: { Cookie: cookie(false) } })).status, 401);
    const headers = { Cookie: cookie(true) };
    assert.equal((await fetch(base + '/api/admin/point-usage?from=2026-02-30', { headers })).status, 400);
    assert.equal((await fetch(base + '/api/admin/point-usage?kind=transfer', { headers })).status, 400);
    const sample = { ...[...rows.values()][0], source: 'backfill', balance_before: null, balance_after: null };
    rpcResponse = { summary: { amount: 120100, count: 1201, users: 2, paidCount: 1201, recoveredCount: 1 },
        daily: [{ date: '2026-11-09', amount: 120100, count: 1201, users: 2 }],
        categories: [{ category: 'shop', amount: 120100, count: 1201, users: 2 }],
        products: [{ category: 'shop', product_name: sample.product_name, amount: 120100, quantity: 1201, count: 1201, users: 2 }],
        entries: [sample], firstRecordedAt: sample.occurred_at };
    const result = await fetch(base + '/api/admin/point-usage?from=2026-11-01&to=2026-11-09&page=2&excludeAdmin=false', { headers });
    assert.equal(result.status, 200);
    const payload = await result.json();
    assert.equal(payload.summary.count, 1201); assert.equal(payload.summary.recoveredCount, 1);
    assert.equal(payload.entries[0].balance_before, null);
    assert.equal(rpcBody.p_from, '2026-10-31T15:00:00.000Z'); assert.equal(rpcBody.p_to, '2026-11-09T15:00:00.000Z');
    assert.deepEqual(rpcBody.p_admin_ids, ['admin']); assert.equal(rpcBody.p_offset, 100); assert.equal(rpcBody.p_exclude_admin, undefined);
    const html = await (await fetch(base + '/admin', { headers })).text(); assert.match(html, /pointUsageForm/);
});
