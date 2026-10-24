'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { isDeepStrictEqual } = require('node:util');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const AWS = require('aws-sdk');
AWS.S3 = class { listObjectsV2() { return { promise: async () => ({ Contents: [] }) }; } };
delete process.env.SUPABASE_URL_P;
delete process.env.SUPABASE_KEY_P;
process.env.ADMIN_SESSION_SECRET = 'black-market-isolated-test';
process.env.PORT = '0';
const { ITEM_NAMES, cardPool, itemPool, periodAt, lotTitle } = require('../black_market');
const data = Object.fromEntries(fs.readdirSync(path.join(__dirname, '../DB/RPGenius')).filter(name => name.endsWith('.json')).map(name => {
    return [name.slice(0, -5), JSON.parse(fs.readFileSync(path.join(__dirname, '../DB/RPGenius', name), 'utf8'))];
}));
data.Item = structuredClone(data.Item);
for (const name of new Set(Object.values(ITEM_NAMES).flat())) if (!data.Item.some(item => item?.name === name)) data.Item.push({ name, type: '사용' });
data.Auction = { items: [] }; data.BuyOrder = { items: [] }; data.Banner = [];
const users = new Map(['선입찰자', '후입찰자'].map((name, index) => [String(index + 1), {
    id: String(index + 1), name, code: 'isolated', _get: 1, avatarMigrated: true, need_character_card_select: false,
    main_card: { id: 0, star: 4, type: '일반' }, inventory: { item: [{ id: 1, count: 100 }], card: [], equipment: [], pet: [] },
    gold: 1000000, garnet: 10000, mail: [], mailNotified: true
}]));
const mails = new Map();
let transactionFault = null;
const row = input => input.TableName === 'rpgenius_data' ? (data[input.Key?.key] === undefined ? undefined : { key: input.Key.key, data: data[input.Key.key] })
    : input.TableName === 'rpgenius_mail' ? mails.get(input.Key?.id) : users.get(input.Key?.id);
function matches(input) {
    const current = input.Item ? (input.TableName === 'rpgenius_data' ? { data: data[input.Item.key] } : mails.get(input.Item.id)) : row(input);
    for (const condition of (input.ConditionExpression || '').split(' AND ')) {
        if (!condition) continue;
        if (condition === 'attribute_exists(id)' && !current) return false;
        const absent = condition.match(/^attribute_not_exists\(([^)]+)\)$/);
        if (absent) {
            const key = input.ExpressionAttributeNames?.[absent[1]] || absent[1];
            if (key === 'key' && data[input.Item.key] !== undefined || key !== 'key' && current?.[key] !== undefined) return false;
        }
        const equal = condition.match(/^(#[\w]+)\s*=\s*(:[\w]+)$/);
        if (equal && !isDeepStrictEqual(current?.[input.ExpressionAttributeNames[equal[1]]], input.ExpressionAttributeValues[equal[2]])) return false;
    }
    return true;
}
function write(input, put) {
    if (put) {
        if (input.TableName === 'rpgenius_data') data[input.Item.key] = structuredClone(input.Item.data);
        else if (input.TableName === 'rpgenius_mail') mails.set(input.Item.id, structuredClone(input.Item));
        else users.set(input.Item.id, structuredClone(input.Item));
        return;
    }
    const target = users.get(input.Key.id);
    assert.ok(target, 'isolated user exists');
    const set = input.UpdateExpression.match(/SET (.*?)(?: REMOVE|$)/)?.[1];
    if (set) for (const assignment of set.split(',')) {
        const [key, value] = assignment.split('=').map(part => part.trim());
        target[input.ExpressionAttributeNames[key]] = structuredClone(input.ExpressionAttributeValues[value]);
    }
    const remove = input.UpdateExpression.match(/REMOVE (.*)$/)?.[1];
    if (remove) for (const key of remove.split(',')) delete target[input.ExpressionAttributeNames[key.trim()]];
}
// 기존 DynamoDB SDK 경계만 메모리로 대체한다. 운영 자격 증명/환경 파일을 읽지 않는다.
DynamoDBDocumentClient.prototype.send = async command => {
    const input = command.input;
    if (command.constructor.name === 'GetCommand') return { Item: structuredClone(row(input)) };
    if (command.constructor.name === 'BatchGetCommand') return { Responses: Object.fromEntries(Object.entries(input.RequestItems).map(([table, request]) => [table, request.Keys.map(Key => structuredClone(row({ TableName: table, Key }))).filter(Boolean)])) };
    if (command.constructor.name === 'ScanCommand') return { Items: input.TableName === 'rpgenius_user' ? structuredClone([...users.values()]) : [] };
    if (command.constructor.name === 'TransactWriteCommand') {
        const fault = transactionFault; transactionFault = null;
        if (fault === 'before') throw new Error('isolated DB failure');
        if (!input.TransactItems.every(item => matches(item.Put || item.Update))) throw Object.assign(new Error('conditional conflict'), { name: 'TransactionCanceledException' });
        input.TransactItems.forEach(item => write(item.Put || item.Update, !!item.Put));
        if (fault === 'after') throw new Error('isolated response lost');
        return {};
    }
    if (command.constructor.name === 'UpdateCommand' || command.constructor.name === 'PutCommand') { write(input, command.constructor.name === 'PutCommand'); return {}; }
    throw new Error('Unexpected isolated database command: ' + command.constructor.name);
};
const rpg = require('../rpgenius');
const startServer = require('../server');
let http, origin, clock = Date.parse('2026-10-24T12:00:00+09:00');
const realNow = Date.now;
function cookie(name, admin = false) {
    const body = Buffer.from(JSON.stringify({ name, admin, exp: clock + 86400000 * 30 })).toString('base64url');
    return 'rpg_admin=' + body + '.' + crypto.createHmac('sha256', process.env.ADMIN_SESSION_SECRET).update(body).digest('base64url');
}
async function request(url, body, name = '선입찰자', admin = false) {
    const response = await fetch(origin + url, { method: body === undefined ? 'GET' : 'POST', headers: {
        ...(name ? { Cookie: cookie(name, admin) } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
    }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json(), cache: response.headers.get('cache-control') };
}
const state = async name => (await request('/api/black-market', undefined, name)).data;
const bidBody = (view, sector, amount) => { const lot = view.lots.find(lot => lot.sector === sector); return {
    date: view.date, periodId: view.periodId, sector, lotId: lot.lotId, amount, bidVersion: lot.myBid?.version || null
}; };
before(async () => {
    Date.now = () => clock;
    await rpg.initRpgeniusData();
    http = startServer(); await new Promise(resolve => http.on('listening', resolve));
    origin = 'http://127.0.0.1:' + http.address().port;
});
after(async () => { Date.now = realNow; await new Promise(resolve => http.close(resolve)); });

test('카드 5~9성 일반·전직·각성과 재화별 요청 아이템을 로테이션한다', () => {
    const cards = cardPool();
    assert.ok(cards.every(card => card.payload.star >= 4 && card.payload.star <= 8));
    assert.deepEqual([...new Set(cards.map(card => card.payload.type))], ['일반', '전직', '각성']);
    for (const currency of ['gold', 'garnet']) {
        const pool = itemPool(data.Item, currency);
        for (const name of ITEM_NAMES[currency]) assert.ok(pool.some(item => item.name === name), name);
        assert.ok(pool.some(item => item.orbs?.length));
    }
    assert.ok(itemPool(data.Item, 'garnet').some(item => item.name === '거래권' && item.count === 5));
});

test('한국 시간 09시/21시 회차 경계와 매물 이름 형식', () => {
    for (const [time, id, close] of [
        ['2026-10-24T00:00', '2026-10-23-21', '2026-10-24T08:50'],
        ['2026-10-24T08:59:59', '2026-10-23-21', '2026-10-24T08:50'],
        ['2026-10-24T09:00', '2026-10-24-09', '2026-10-24T20:50'],
        ['2026-10-24T20:59:59', '2026-10-24-09', '2026-10-24T20:50'],
        ['2026-10-24T21:00', '2026-10-24-21', '2026-10-25T08:50']
    ]) {
        const period = periodAt(Date.parse(time + '+09:00'));
        assert.equal(period.periodId, id); assert.equal(period.closesAt, Date.parse(close + '+09:00'));
        assert.equal(period.nextOpensAt - period.closesAt, 600000);
    }
    assert.equal(lotTitle({ kind: 'card', name: '워뇨띠', payload: { star: 4, type: '전직' } }), '[5성] 전직 워뇨띠');
    for (const [star, grade] of [[9, '𝛧'], [10, '𝛴'], [11, '𝛀']]) assert.equal(lotTitle({ kind: 'card', name: '워뇨띠', payload: { star, type: '일반' } }), '[' + grade + '] 워뇨띠');
    assert.equal(lotTitle({ kind: 'item', name: '거래권', count: 1 }), '거래권');
    assert.equal(lotTitle({ kind: 'item', name: '거래권', count: 7 }), '거래권 x7');
});

test('인증·관리자 권한, 4개 매물, 타인 입찰 비공개, 기존 상점 보존', async () => {
    const before = JSON.stringify(data.Shop);
    assert.equal((await request('/api/black-market', undefined, null)).status, 401);
    assert.equal((await request('/api/admin/black-market')).status, 401);
    assert.equal((await request('/api/admin/black-market', { date: '2026-10-24' })).status, 401);
    const result = await request('/api/black-market');
    assert.equal(result.status, 200); assert.equal(result.cache, 'no-store');
    assert.equal(result.data.lots.length, 4);
    assert.equal(JSON.stringify(data.Shop), before);
    assert.equal((await request('/api/shop')).data.tabs[0], '암시장');
    const serialized = JSON.stringify(result.data);
    for (const field of ['userId', 'bids', 'sequence']) assert.ok(!serialized.includes('"' + field + '"'));
});

test('기존 하루 매물은 입찰과 보관금을 보존하고 다음 정산 시각으로 전환한다', async () => {
    const initial = structuredClone(data.BlackMarket), initialClock = clock;
    for (const [time, close, periodId] of [['12:00', '2026-10-24T20:50', '2026-10-24-09'], ['20:55', '2026-10-25T08:50', '2026-10-24-21']]) {
        const current = await state(), lot = current.lots[0], balance = current.balances.garnet;
        await request('/api/black-market/bid', bidBody(current, lot.sector, 100));
        for (const key of ['periodId', 'round', 'opensAt', 'closesAt', 'nextOpensAt']) delete data.BlackMarket[key];
        const { payload, count, name } = data.BlackMarket.lots[3];
        data.BlackMarket.scheduled = { '2026-10-27': { 'item-gold': { payload, count, name } } };
        const escrow = structuredClone(data.BlackMarket.lots[0].bids);
        clock = Date.parse('2026-10-24T' + time + ':00+09:00');
        const migrated = await state();
        assert.equal(migrated.periodId, periodId); assert.equal(migrated.closesAt, Date.parse(close + '+09:00'));
        assert.equal(migrated.lots[0].lotId, lot.lotId); assert.equal(migrated.balances.garnet, balance - 100);
        assert.deepEqual(data.BlackMarket.lots[0].bids, escrow); assert.equal(data.BlackMarket.mailKey, '2026-10-24');
        assert.ok(data.BlackMarket.scheduled['2026-10-27-09']);
        const unchanged = JSON.stringify(data.BlackMarket); await state(); assert.equal(JSON.stringify(data.BlackMarket), unchanged, '전환은 한 번만 저장');
        assert.equal((await request('/api/black-market/bid', bidBody(migrated, lot.sector, 0))).status, 200);
        assert.equal((await state()).balances.garnet, balance);
        data.BlackMarket = structuredClone(initial); clock = initialClock;
    }
});

test('관리자 지정, 잘못된 매물 차단, 시작한 매물 변경 금지', async () => {
    const admin = (await request('/api/admin/black-market', undefined, '선입찰자', true)).data;
    for (const entry of admin.lots.filter(lot => lot.kind === 'card')) {
        assert.deepEqual([...new Set(entry.options.filter(o => o.payload.type === '일반').map(o => o.payload.star))], Array.from({ length: 12 }, (_, star) => star));
        for (const [star, type, label] of [[0, '일반', '1성'], [9, '일반', '𝛧'], [10, '전직', '𝛴'], [11, '각성', '𝛀']]) {
            const choice = entry.options.find(o => o.payload.star === star && o.payload.type === type);
            assert.equal(choice.display.name, '[' + label + '] ' + (type === '일반' ? '' : type + ' ') + choice.name);
            assert.equal((await request('/api/admin/black-market', { date: admin.date, round: admin.round, sector: entry.sector, payload: choice.payload, count: 1 }, '선입찰자', true)).status, 200);
            assert.deepEqual((await state()).lots.find(lot => lot.sector === entry.sector).payload, choice.payload);
        }
        for (const payload of [{ id: 0, star: -1, type: '일반' }, { id: 0, star: 12, type: '일반' }, { id: 0, star: 3, type: '각성' }]) {
            assert.equal((await request('/api/admin/black-market', { date: admin.date, round: admin.round, sector: entry.sector, payload, count: 1 }, '선입찰자', true)).status, 400);
        }
    }
    const lot = admin.lots[0], selected = lot.options.find(o => o.payload.star === 11 && o.payload.type === '각성');
    const view = await state(); assert.deepEqual(view.lots[0].payload, selected.payload);
    const body = bidBody(view, lot.sector, 100);
    assert.equal((await request('/api/black-market/bid', body)).status, 200);
    assert.equal((await request('/api/admin/black-market', { date: admin.date, round: admin.round, sector: lot.sector, reset: true }, '선입찰자', true)).status, 409);
    assert.equal((await request('/api/admin/black-market', { date: '2026-10-25', round: '09', sector: lot.sector, payload: { id: -1 }, count: 1 }, '선입찰자', true)).status, 400);
});

test('관리자 아이템 수량 지정, 잘못된 수량 차단 및 회차별 예약 분리', async () => {
    const admin = (await request('/api/admin/black-market', undefined, '선입찰자', true)).data;
    for (const [sector, name, count] of [['item-garnet', '거래권', 7], ['item-gold', '장비 보호권', 3]]) {
        const lot = admin.lots.find(lot => lot.sector === sector), option = lot.options.find(o => o.name === name);
        const body = { date: admin.date, round: admin.round, sector, payload: option.payload, count };
        for (const invalid of [0, -1, 1.5, '7', null, Number.MAX_SAFE_INTEGER + 1]) assert.equal((await request('/api/admin/black-market', { ...body, count: invalid }, '선입찰자', true)).status, 400);
        assert.equal((await request('/api/admin/black-market', body, '선입찰자', true)).status, 200);
        const selected = (await state()).lots.find(lot => lot.sector === sector);
        assert.equal(selected.count, count); assert.equal(selected.display.name, name + ' x' + count); assert.equal(selected.display.sub, undefined);
        for (const [round, quantity] of [['09', 2], ['21', 5]]) assert.equal((await request('/api/admin/black-market', { ...body, date: '2026-10-27', round, count: quantity }, '선입찰자', true)).status, 200);
        for (const [round, quantity] of [['09', 2], ['21', 5]]) {
            const scheduled = (await request('/api/admin/black-market?date=2026-10-27&round=' + round, undefined, '선입찰자', true)).data;
            assert.equal(scheduled.lots.find(lot => lot.sector === sector).count, quantity);
        }
    }
    const card = admin.lots[1].options[0];
    assert.equal((await request('/api/admin/black-market', { date: '2026-10-27', round: '09', sector: 'card-gold', payload: card.payload, count: 2 }, '선입찰자', true)).status, 400);
});

test('입찰금 보관·증감·취소 및 잔액 부족·중복 요청·잘못된 금액', async () => {
    let view = await state(); assert.equal(view.balances.garnet, 9900);
    assert.equal((await state('후입찰자')).lots[0].myBid, null);
    for (const amount of [-1, 1.5, '100', null, 1e15, 10001]) assert.equal((await request('/api/black-market/bid', bidBody(view, 'card-garnet', amount))).status, 400);
    const body = bidBody(view, 'card-garnet', 300);
    const concurrent = await Promise.all([request('/api/black-market/bid', body), request('/api/black-market/bid', body)]);
    assert.deepEqual(concurrent.map(result => result.status).sort(), [200, 409]);
    view = await state(); assert.equal(view.balances.garnet, 9700);
    view = (await request('/api/black-market/bid', bidBody(view, 'card-garnet', 150))).data;
    assert.equal(view.balances.garnet, 9850);
    view = (await request('/api/black-market/bid', bidBody(view, 'card-garnet', 0))).data;
    assert.equal(view.balances.garnet, 10000); assert.equal(view.lots[0].myBid, null);
});

test('트랜잭션 실패 시 차감 없음, 응답 유실 시 재차감 없음', async () => {
    let view = await state();
    transactionFault = 'before';
    assert.equal((await request('/api/black-market/bid', bidBody(view, 'card-gold', 500))).status, 500);
    assert.equal((await state()).balances.gold, 1000000);
    transactionFault = 'after';
    const body = bidBody(view, 'card-gold', 500);
    assert.equal((await request('/api/black-market/bid', body)).status, 200);
    assert.equal((await state()).balances.gold, 999500);
    assert.equal((await request('/api/black-market/bid', body)).status, 409);
});

test('20:50 정산: 최고가·동액 선입찰, 유찰 환불, 수량 포함 메일 보상, 재시도 중복 없음', async () => {
    for (const sector of ['card-garnet', 'item-garnet', 'item-gold']) {
        assert.equal((await request('/api/black-market/bid', bidBody(await state(), sector, 200))).status, 200);
        assert.equal((await request('/api/black-market/bid', bidBody(await state('후입찰자'), sector, sector === 'item-gold' ? 300 : 200), '후입찰자')).status, 200);
    }
    // 금액 변경 시 우선순위 갱신. 같은 금액 재전송은 갱신하지 않는다.
    await request('/api/black-market/bid', bidBody(await state(), 'item-garnet', 201));
    await request('/api/black-market/bid', bidBody(await state(), 'item-garnet', 200));
    const adminResponse = await request('/api/admin/black-market', undefined, '선입찰자', true);
    assert.equal(adminResponse.cache, 'no-store');
    assert.equal(adminResponse.data.status, 'open');
    assert.deepEqual(adminResponse.data.lots.map(lot => lot.bids), [
        [{ name: '선입찰자', amount: 200 }, { name: '후입찰자', amount: 200 }],
        [{ name: '선입찰자', amount: 500 }],
        [{ name: '후입찰자', amount: 200 }, { name: '선입찰자', amount: 200 }],
        [{ name: '후입찰자', amount: 300 }, { name: '선입찰자', amount: 200 }]
    ], '관리자에게만 전체 입찰을 금액 내림차순, 동액 선입찰순으로 반환');
    for (const name of [null, '선입찰자']) assert.equal((await request('/api/admin/black-market?date=2026-10-24&round=09', undefined, name)).status, 401);
    for (const name of ['선입찰자', '후입찰자']) {
        const publicView = await state(name);
        assert.ok(publicView.lots.every(lot => !('bids' in lot)));
        assert.ok(!JSON.stringify(publicView).includes(name === '선입찰자' ? '후입찰자' : '선입찰자'));
    }
    await request('/api/black-market/bid', bidBody(await state('후입찰자'), 'card-gold', 1), '후입찰자');
    await request('/api/black-market/bid', bidBody(await state('후입찰자'), 'card-gold', 0), '후입찰자');
    assert.deepEqual((await request('/api/admin/black-market', undefined, '선입찰자', true)).data.lots[1].bids, [{ name: '선입찰자', amount: 500 }], '취소한 입찰은 관리자 목록에서 제외');
    const closingBid = bidBody(await state(), 'item-gold', 999);
    clock = Date.parse('2026-10-24T20:49:59.999+09:00');
    assert.equal((await state()).status, 'open');
    clock++;
    assert.equal((await request('/api/black-market/bid', closingBid)).status, 409);
    const view = await state(); assert.equal(view.status, 'settling');
    assert.deepEqual(view.previous.lots.map(lot => lot.winner.name), ['선입찰자', '선입찰자', '후입찰자', '후입찰자']);
    assert.equal(view.balances.gold, 999500); assert.equal(view.balances.garnet, 9800);
    const second = await state('후입찰자'); assert.equal(second.balances.gold, 999700); assert.equal(second.balances.garnet, 9800);
    assert.equal(mails.size, 4);
    assert.equal([...mails.values()].filter(mail => mail.gifts[0].type === 'card').length, 2);
    assert.equal(mails.get('black-market:2026-10-24-09:item-garnet').gifts[0].count, 7);
    assert.equal(mails.get('black-market:2026-10-24-09:item-gold').gifts[0].count, 3);
    const itemMail = mails.get('black-market:2026-10-24-09:item-garnet');
    assert.equal(itemMail.fromName, '암시장'); assert.equal(itemMail.subject, '암시장 낙찰 보상');
    assert.equal(itemMail.body, '2026-10-24 09:00 거래권 x7 낙찰을 축하합니다. 보관한 200 가넷으로 결제되었습니다.');
    const settledAdmin = (await request('/api/admin/black-market', undefined, '선입찰자', true)).data;
    assert.equal(settledAdmin.status, 'settled'); assert.ok(settledAdmin.lots.every(lot => lot.bids.length === 0));
    const snapshot = JSON.stringify([...users.values()]);
    await state(); await state(); assert.equal(mails.size, 4); assert.equal(JSON.stringify([...users.values()]), snapshot);
});

test('21시 새 로테이션과 관리자 지정, 같은 날짜의 이전 회차 요청 거부', async () => {
    const admin = (await request('/api/admin/black-market?date=2026-10-24&round=21', undefined, '선입찰자', true)).data;
    assert.equal(admin.status, 'scheduled'); assert.ok(admin.lots.every(lot => lot.bids.length === 0));
    const lot = admin.lots[1], chosen = lot.options[0];
    await request('/api/admin/black-market', { date: admin.date, round: admin.round, sector: lot.sector, payload: chosen.payload, count: 1 }, '선입찰자', true);
    const stale = bidBody(await state(), 'card-gold', 10);
    clock = Date.parse('2026-10-24T21:00:00+09:00');
    const view = await state(); assert.equal(view.status, 'open'); assert.equal(view.periodId, '2026-10-24-21');
    assert.equal(view.previous.date, '2026-10-24'); assert.deepEqual(view.lots[1].payload, chosen.payload);
    assert.equal((await request('/api/black-market/bid', stale)).status, 409);
    assert.equal((await request('/api/admin/black-market', { date: admin.date, round: '09', sector: lot.sector, reset: true }, '선입찰자', true)).status, 400);
    const before = view.balances.garnet;
    await request('/api/black-market/bid', bidBody(view, 'card-garnet', 10));
    clock = Date.parse('2026-10-25T00:00:00+09:00');
    assert.equal((await state()).periodId, view.periodId, '자정에 야간 회차 유지');
    clock = Date.parse('2026-10-25T08:49:59.999+09:00'); assert.equal((await state()).status, 'open');
    clock++; assert.equal((await state()).status, 'settling');
    assert.ok(mails.has('black-market:2026-10-24-21:card-garnet'));
    assert.ok(mails.has('black-market:2026-10-24-09:card-garnet'), '같은 날짜 두 회차 보상은 별도 메일');
    clock = Date.parse('2026-10-25T09:00:00+09:00');
    const morning = await state(); assert.equal(morning.periodId, '2026-10-25-09');
    assert.equal(morning.balances.garnet, before - 10); assert.equal(mails.size, 5);
});

test('기존 하루 경매 정산 중 전환·저장 실패 후 재개하여 환불·보상 한 번만 반영', async () => {
    await request('/api/black-market/bid', bidBody(await state(), 'item-gold', 20));
    await request('/api/black-market/bid', bidBody(await state('후입찰자'), 'item-gold', 10), '후입찰자');
    // 프로세스 중단 직전 저장된 정산 단계에서 다시 시작하는 것과 동일한 영속 상태.
    data.BlackMarket.status = 'settling';
    for (const lot of data.BlackMarket.lots) lot.winner = [...lot.bids].sort((a, b) => b.amount - a.amount || a.order - b.order)[0] || null;
    for (const key of ['periodId', 'round', 'opensAt', 'closesAt', 'nextOpensAt']) delete data.BlackMarket[key];
    clock = Date.parse('2026-10-26T09:00:00+09:00');
    transactionFault = 'before';
    assert.equal((await request('/api/black-market')).status, 500);
    assert.equal(data.BlackMarket.periodId, undefined);
    assert.equal(data.BlackMarket.lots[3].bids.length, 2, '전환 저장 실패 시 미정산 입찰 보존');
    transactionFault = 'after';
    const result = await state(); assert.equal(result.date, '2026-10-26');
    assert.equal(result.previous.lots[3].winner.name, '선입찰자');
    assert.equal(mails.size, 6); assert.equal((await state('후입찰자')).balances.gold, 999700);
    assert.ok(mails.has('black-market:2026-10-25:item-gold'), '기존 회차의 보상 메일 ID 유지');
    assert.ok(!mails.has('black-market:2026-10-25-09:item-gold'));
});

test('팝니다·삽니다 각각 21번째 등록 허용', async () => {
    const itemId = data.Item.findIndex(item => item?.name && !item.no_trade);
    const user = await rpg.getRPGUserByName('선입찰자');
    user.inventory.item = [{ id: itemId, count: 30 }]; await user.save();
    for (let index = 0; index < 21; index++) {
        const body = { kind: 'item', currency: 'gold', price: 1, count: 1, itemId };
        assert.equal((await request('/api/auction/register', body)).status, 200, '팝니다 ' + (index + 1));
        assert.equal((await request('/api/buyorder/register', body)).status, 200, '삽니다 ' + (index + 1));
    }
    assert.equal(data.Auction.items.length, 21); assert.equal(data.BuyOrder.items.length, 21);
});

test('낙찰 메일 실제 수령: 저장 실패·동시 수령에도 보상을 한 번만 지급', async () => {
    const id = 'black-market:2026-10-24-09:card-garnet';
    transactionFault = 'before';
    assert.equal((await request('/api/mail/claim', { id })).status, 500);
    assert.equal((await rpg.getRPGUserByName('선입찰자')).inventory.card.length, 0);
    const results = await Promise.all([request('/api/mail/claim', { id }), request('/api/mail/claim', { id })]);
    assert.deepEqual(results.map(result => result.status).sort(), [200, 400]);
    assert.equal((await rpg.getRPGUserByName('선입찰자')).inventory.card.length, 1);
    assert.deepEqual((await rpg.getRPGUserByName('선입찰자')).inventory.card[0], mails.get(id).gifts[0].card);
    assert.equal((await rpg.getRPGUserByName('선입찰자')).inventory.card[0].star, 11, '관리자 지정 오메가 카드 그대로 지급');
    const itemMail = 'black-market:2026-10-24-09:item-garnet', itemId = mails.get(itemMail).gifts[0].id;
    const before = rpg.getInventoryItemCount(await rpg.getRPGUserByName('후입찰자'), itemId);
    assert.equal((await request('/api/mail/claim', { id: itemMail }, '후입찰자')).status, 200);
    assert.equal(rpg.getInventoryItemCount(await rpg.getRPGUserByName('후입찰자'), itemId), before + 7);
});

test('다른 구매 등록과 암시장 입찰이 겹쳐도 두 지출 모두 잔액에 반영', async () => {
    const view = await state(), before = view.balances.gold;
    const itemId = data.Item.findIndex(item => item?.name && !item.no_trade);
    const results = await Promise.all([
        request('/api/black-market/bid', bidBody(view, 'card-gold', 70)),
        request('/api/buyorder/register', { kind: 'item', currency: 'gold', price: 30, count: 1, itemId })
    ]);
    assert.ok(results.every(result => result.status === 200));
    assert.equal((await state()).balances.gold, before - 100);
});

test('판매 대금을 받는 중 입찰해도 판매 수익과 보관금을 모두 보존', async () => {
    const view = await state(), before = view.balances.gold;
    const entry = data.Auction.items[0];
    const results = await Promise.all([
        request('/api/black-market/bid', bidBody(view, 'card-gold', 90)),
        request('/api/auction/buy', { id: entry.id, count: 1 }, '후입찰자')
    ]);
    assert.ok(results.every(result => result.status === 200));
    assert.equal((await state()).balances.gold, before - 20 + 1);
});

test('실제 상점 브라우저: PC·태블릿·모바일 배치와 입찰', { skip: !process.env.BLACK_MARKET_BROWSER }, async () => {
    const { chromium } = require('playwright');
    fs.mkdirSync(path.join(__dirname, '../output/black-market'), { recursive: true });
    const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-swiftshader'] });
    try {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        await context.addInitScript(() => {
            window.playedSounds = [];
            const play = HTMLMediaElement.prototype.play;
            HTMLMediaElement.prototype.play = function() { window.playedSounds.push(this.src); return play.call(this); };
        });
        await context.addCookies([{ name: 'rpg_admin', value: cookie('선입찰자').slice('rpg_admin='.length), url: origin }]);
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(origin, { waitUntil: 'domcontentloaded' });
        await page.locator('#groupTabs [data-group="market"]').click();
        await page.locator('.bm-root').getByText('오늘의 카드', { exact: true }).waitFor();
        await page.locator('.bm-root').getByText('오늘의 아이템', { exact: true }).waitFor();
        await page.locator('.bm-lot').first().waitFor();
        assert.equal(await page.locator('.bm-lot').count(), 4);
        assert.equal(await page.locator('.bm-root').getAttribute('data-webgl'), 'ready', '실제 WebGL 셰이더 초기화');
        const lot = page.locator('[data-sector="card-garnet"]');
        const initial = (await state()).balances.garnet;
        await lot.locator('input').fill('321');
        await lot.getByRole('button', { name: '입찰하기', exact: true }).click();
        await page.screenshot({ path: path.join(__dirname, '../output/black-market/confirm-pc.png'), animations: 'disabled' });
        await page.getByRole('dialog').getByRole('button', { name: '입찰 확정', exact: true }).click();
        await page.getByText('입찰했습니다.', { exact: true }).waitFor();
        assert.equal((await state()).balances.garnet, initial - 321);
        await lot.locator('input').fill('123');
        await lot.getByRole('button', { name: '금액 변경', exact: true }).click();
        await page.getByRole('dialog').getByText('즉시 돌려받을 금액', { exact: true }).waitFor();
        await page.getByRole('dialog').getByRole('button', { name: '입찰 확정', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('[data-sector="card-garnet"] .bm-my-bid strong')?.textContent === '123 가넷');
        assert.equal((await state()).balances.garnet, initial - 123);
        // 자동 조회가 작성 중인 입찰 금액을 지우면 안 된다.
        await lot.locator('input').fill('456');
        await page.getByRole('button', { name: '새로고침', exact: true }).click();
        await page.waitForFunction(() => !document.querySelector('.bm-tools button:nth-child(2)').disabled);
        assert.equal(await lot.locator('input').inputValue(), '456');
        await lot.locator('input').fill('123');
        await page.mouse.move(0, 0);
        await page.evaluate(() => document.fonts.ready);
        assert.equal(await page.evaluate(() => [...document.fonts].some(font => font.family === 'Black Market Pretendard' && font.status === 'loaded')), true, '로컬 Pretendard 글꼴 로드');
        await page.waitForFunction(() => [...document.querySelectorAll('.bm-root img')].every(image => image.complete));
        assert.deepEqual(await page.locator('.bm-root img').evaluateAll(images => images.filter(image => !image.naturalWidth).map(image => image.src)), [], '게임 이미지 로드');
        // 실제 화면에서 긴 매물명, 닉네임과 큰 낙찰 금액을 생략 없이 표시한다.
        const resultNames = ['[8성] 전직 딜러장', '[5성] 워뇨띠', '수피아조씨와 리정현 기사단 보주', '제타 각성 캐릭터 변환석 x7'];
        const resultAmounts = [301, 15000000, 100, 99999999999999];
        const resultsRoute = async route => {
            const response = await route.fetch(), view = await response.json();
            view.previous = { date: '2026-10-24', round: '09', lots: view.lots.map((lot, index) => ({ ...lot,
                display: { ...lot.display, name: resultNames[index] }, winner: { name: '긴닉네임낙찰자확인', amount: resultAmounts[index] }
            })) };
            await route.fulfill({ response, json: view });
        };
        await page.route('**/api/black-market', resultsRoute);
        await page.getByRole('button', { name: '새로고침', exact: true }).click();
        await page.getByText(resultNames[2], { exact: true }).waitFor();
        for (const [label, width, height] of [['wide-pc', 1920, 1080], ['pc', 1440, 1000], ['small-pc', 1280, 900], ['tablet', 820, 1180], ['mobile', 390, 844], ['small-mobile', 360, 800]]) {
            await page.setViewportSize({ width, height });
            await page.evaluate(() => scrollTo(0, 0));
            await page.screenshot({ path: path.join(__dirname, '../output/black-market/' + label + '.png'), fullPage: true, animations: 'disabled' });
            await page.locator('.bm-results').screenshot({ path: path.join(__dirname, '../output/black-market/results-' + label + '.png'), animations: 'disabled' });
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), label + ' 가로 넘침 없음');
            assert.ok(await page.locator('.shop-wrap').evaluate(el => el.getBoundingClientRect().width >= document.documentElement.clientWidth - 1), label + ' 상점 전체 화면 너비');
            assert.deepEqual(await page.locator('.bm-result-name').allTextContents(), resultNames);
            assert.deepEqual(await page.locator('.bm-result-amount').allTextContents(), resultAmounts.map(value => value.toLocaleString('ko-KR')));
            assert.deepEqual(await page.locator('.bm-result-name, .bm-result-winner, .bm-result-price').evaluateAll(elements => elements.filter(el => {
                const style = getComputedStyle(el), rect = el.getBoundingClientRect(), card = el.closest('.bm-result').getBoundingClientRect();
                return style.textOverflow === 'ellipsis' || el.scrollWidth > el.clientWidth + 1 || rect.right > card.right || rect.bottom > card.bottom;
            }).map(el => el.textContent)), [], label + ' 지난 결과 전체 텍스트가 카드 안에 표시');
        }
        await page.unroute('**/api/black-market', resultsRoute);
        await lot.getByRole('button', { name: /입찰 취소/ }).click();
        await page.screenshot({ path: path.join(__dirname, '../output/black-market/confirm-mobile.png'), animations: 'disabled' });
        await page.getByRole('dialog').getByRole('button', { name: '취소하고 반환', exact: true }).click();
        await page.getByText('입찰을 취소하고 보관금을 돌려받았습니다.', { exact: true }).waitFor();
        assert.equal((await state()).balances.garnet, initial);
        assert.ok((await page.evaluate(() => playedSounds)).some(src => src.endsWith('/seal.ogg')));
        assert.ok((await page.evaluate(() => playedSounds)).some(src => src.endsWith('/cancel.ogg')));
        await page.getByRole('button', { name: '효과음 끄기', exact: true }).click();
        assert.equal(await page.evaluate(() => localStorage.getItem('blackMarketSound')), 'off');
        for (const [sector, first, second] of [['card-garnet', 200, 200], ['item-gold', 100000, 150000]]) {
            assert.equal((await request('/api/black-market/bid', bidBody(await state(), sector, first))).status, 200);
            assert.equal((await request('/api/black-market/bid', bidBody(await state('후입찰자'), sector, second), '후입찰자')).status, 200);
        }
        const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        await adminContext.addCookies([{ name: 'rpg_admin', value: cookie('선입찰자', true).slice('rpg_admin='.length), url: origin }]);
        const adminPage = await adminContext.newPage();
        adminPage.on('pageerror', error => errors.push(error.message));
        await adminPage.goto(origin + '/admin#blackmarket');
        await adminPage.locator('.bm-admin-bids table').first().waitFor();
        const adminCards = adminPage.locator('#bmAdminResult .hd-prev-card');
        assert.deepEqual(await adminCards.nth(0).locator('tbody tr').allTextContents(), ['1선입찰자200', '2후입찰자200']);
        assert.deepEqual(await adminCards.nth(3).locator('tbody tr').allTextContents(), ['1후입찰자150,000', '2선입찰자100,000']);
        assert.equal(await adminCards.nth(2).locator('.bm-admin-bids p').textContent(), '현재 입찰이 없습니다.');
        for (const [label, width, height] of [['pc', 1440, 1000], ['mobile', 390, 844]]) {
            await adminPage.setViewportSize({ width, height });
            await adminPage.screenshot({ path: path.join(__dirname, '../output/black-market/admin-bids-' + label + '.png'), fullPage: true });
            assert.ok(await adminPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), '관리자 입찰 현황 ' + label + ' 가로 넘침 없음');
        }
        await request('/api/black-market/bid', bidBody(await state('후입찰자'), 'item-gold', 0), '후입찰자');
        await adminPage.locator('#bmAdminReload').click();
        await adminPage.waitForFunction(() => document.querySelectorAll('#bmAdminResult .hd-prev-card:nth-child(4) tbody tr').length === 1);
        assert.deepEqual(await adminCards.nth(3).locator('tbody tr').allTextContents(), ['1선입찰자100,000']);
        await adminContext.close();
        clock = Date.parse('2026-10-26T20:50:00+09:00');
        await page.getByRole('button', { name: '새로고침', exact: true }).click();
        await page.getByText('정산 중', { exact: true }).waitFor();
        assert.equal(await page.locator('.bm-amount:disabled').count(), 4, '정산 시간에는 입찰 불가');
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.setViewportSize({ width: 1440, height: 1000 });
        // WebGL 문맥 상실 후 복구와 정적 배경 대체를 확인한다.
        await page.evaluate(() => { window.marketContextLoss = document.querySelector('.bm-atmosphere').getContext('webgl').getExtension('WEBGL_lose_context'); marketContextLoss.loseContext(); });
        await page.waitForFunction(() => document.querySelector('.bm-root').dataset.webgl === 'fallback');
        await page.evaluate(() => marketContextLoss.restoreContext());
        await page.waitForFunction(() => document.querySelector('.bm-root').dataset.webgl === 'ready');
        await page.evaluate(() => { window.previousMarketGL = document.querySelector('.bm-atmosphere').getContext('webgl'); });
        await page.locator('.shop-tabs button').nth(1).click();
        assert.equal(await page.evaluate(() => previousMarketGL.isContextLost()), true, '상점 이동 시 WebGL 해제');
        await page.waitForFunction(() => document.querySelector('.shop-wrap').dataset.shopGl === 'ready');
        const shopView = (await request('/api/shop')).data;
        const normalShopTabs = shopView.tabs.filter(tab => tab !== '암시장');
        for (const tab of normalShopTabs) {
            await page.locator('.shop-game-controls [data-action="category"][data-category="' + tab + '"]').click();
            await page.waitForFunction(() => document.querySelector('.shop-wrap').dataset.shopGl === 'ready');
            assert.equal(await page.locator('.shop-scene-canvas').count(), 1, tab + ' WebGL 장면은 하나만 실행');
            assert.equal(await page.locator('.shop-wrap').getAttribute('data-shop-category'), tab);
            assert.equal(await page.locator('.shop-card').count(), 0, '상품도 게임 캔버스에서 렌더링');
        }
        await page.locator('.shop-game-controls [data-action="category"][data-category="일반"]').click();
        await page.waitForLoadState('networkidle');
        for (const [label, width, height] of [['wide-pc', 1920, 1080], ['pc', 1440, 900], ['small-pc', 1280, 720], ['tablet', 820, 1100], ['small-tablet', 1024, 768], ['mobile', 390, 844], ['small-mobile', 360, 640]]) {
            await page.setViewportSize({ width, height });
            await page.evaluate(() => scrollTo(0, 0));
            await page.screenshot({ path: path.join(__dirname, '../output/black-market/shop-' + label + '.png'), animations: 'disabled' });
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), label + ' 일반 상점 가로 넘침 없음');
            assert.ok(await page.locator('.shop-scene-canvas').evaluate(el => {
                const rect = el.getBoundingClientRect();
                return rect.width >= innerWidth - 1 && rect.bottom <= innerHeight + 1;
            }), label + ' 게임 화면이 화면 너비와 높이에 맞음');
            assert.deepEqual(await page.locator('.shop-game-controls button').evaluateAll(elements => elements.filter(el => {
                const rect = el.getBoundingClientRect();
                return rect.width && (rect.left < -1 || rect.top < -1 || rect.right > innerWidth + 1 || rect.bottom > innerHeight + 1);
            }).map(el => el.getAttribute('aria-label'))), [], label + ' 조작 버튼이 화면 안에 표시');
            if (width < 640 || width < 1200 && height < 900) {
                await page.locator('.shop-game-controls [data-action="product"]').first().click();
                await page.screenshot({ path: path.join(__dirname, '../output/black-market/shop-detail-' + label + '.png') });
                await page.locator('.shop-game-controls [data-action="buy"]').click();
                await page.screenshot({ path: path.join(__dirname, '../output/black-market/shop-confirm-' + label + '.png') });
                await page.locator('.shop-game-controls [data-action="cancel"]').click();
                await page.locator('.shop-game-controls [data-action="back"]').click();
            }
        }
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.locator('.shop-game-controls [data-action="product"]').first().click();
        await page.locator('.shop-game-controls [data-action="qty-plus"]').click();
        await page.waitForFunction(() => document.querySelector('[data-action="qty-value"]').value === '2');
        assert.equal(await page.getByRole('spinbutton', { name: '구매 수량' }).inputValue(), '2');
        await page.getByRole('spinbutton', { name: '구매 수량' }).fill('3');
        await page.locator('.shop-game-controls [data-action="qty-minus"]').click();
        const beforeGold = users.get('1').gold, boughtItem = data.Shop['일반'][0];
        const beforeCount = users.get('1').inventory.item.filter(entry => entry.id === boughtItem.item_id).reduce((sum, entry) => sum + entry.count, 0);
        await page.locator('.shop-game-controls [data-action="buy"]').click();
        await page.screenshot({ path: path.join(__dirname, '../output/black-market/shop-confirm-pc.png') });
        await Promise.all([
            page.waitForResponse(response => response.url().endsWith('/api/shop/buy') && response.status() === 200),
            page.locator('.shop-game-controls [data-action="confirm"]').click()
        ]);
        await page.waitForLoadState('networkidle');
        assert.equal(users.get('1').gold, beforeGold - boughtItem.price.amount * 2, '실제 구매 API에서 수량만큼 차감');
        assert.equal(users.get('1').inventory.item.filter(entry => entry.id === boughtItem.item_id).reduce((sum, entry) => sum + entry.count, 0), beforeCount + boughtItem.count * 2, '실제 인벤토리에 지급');
        await page.screenshot({ path: path.join(__dirname, '../output/black-market/shop-success-pc.png') });
        await page.keyboard.press('Escape');
        await page.locator('.shop-game-controls [data-action="category"][data-category="패키지"]').click();
        await page.locator('.shop-game-controls [data-action="product"][data-id="' + shopView.shop['패키지'][0].shopId + '"]').waitFor();
        const packageItem = shopView.shop['패키지'].find(item => item.display.bundleContents?.length);
        if (packageItem) {
            for (let i = 0; i < 30 && !await page.locator('.shop-game-controls [data-action="product"][data-id="' + packageItem.shopId + '"]').count(); i++) {
                await page.locator('.shop-game-controls [data-action="next"]').click();
            }
            await page.locator('.shop-game-controls [data-action="product"][data-id="' + packageItem.shopId + '"]').click();
            await page.locator('.shop-game-controls [data-action="contents"]').click();
            await page.screenshot({ path: path.join(__dirname, '../output/black-market/shop-contents-pc.png') });
            await page.locator('.shop-game-controls [data-action="back"]').click();
        }
        await page.evaluate(() => {
            window.previousShopGL = document.querySelector('.shop-scene-canvas').getContext('webgl');
            window.shopContextLoss = previousShopGL.getExtension('WEBGL_lose_context');
            shopContextLoss.loseContext();
        });
        await page.waitForFunction(() => document.querySelector('.shop-wrap').dataset.shopGl === 'fallback');
        await page.evaluate(() => shopContextLoss.restoreContext());
        await page.waitForFunction(() => document.querySelector('.shop-wrap').dataset.shopGl === 'ready');
        await page.locator('.shop-game-controls [data-action="category"][data-category="암시장"]').click();
        await page.locator('.bm-lot').first().waitFor();
        assert.equal(await page.evaluate(() => previousShopGL.isContextLost()), true, '암시장 이동 시 일반 상점 WebGL 해제');
        assert.equal(await page.locator('.shop-scene-canvas').count(), 0, '암시장은 기존 WebGL 장면 하나만 실행');
        assert.equal(await page.getByRole('button', { name: '효과음 켜기', exact: true }).getAttribute('aria-pressed'), 'false');
        await context.addCookies([{ name: 'rpg_admin', value: cookie('선입찰자', true).slice('rpg_admin='.length), url: origin }]);
        await page.goto(origin + '/admin#blackmarket');
        await page.locator('#bmAdminResult .hd-prev-card').first().waitFor();
        assert.equal(await page.locator('#bmAdminResult .hd-prev-card').count(), 4);
        assert.equal(await page.locator('.bm-admin-bids').getByText('정산이 완료되었습니다.', { exact: true }).count(), 4);
        await page.locator('#bmAdminDate').fill('2026-10-27');
        await page.locator('#bmAdminRound').selectOption('21');
        await Promise.all([page.waitForResponse(response => response.url().includes('/api/admin/black-market?date=2026-10-27')), page.locator('#bmAdminReload').click()]);
        await page.locator('.bm-admin-bids').getByText('개장 전입니다.', { exact: true }).first().waitFor();
        for (const [index, label] of [[0, '[𝛀] 각성 빵귤'], [1, '[1성] 빵귤']]) {
            const adminCard = page.locator('#bmAdminResult .hd-prev-card').nth(index);
            await adminCard.locator('select').selectOption({ label });
            await adminCard.getByRole('button', { name: '매물 지정', exact: true }).click();
            await page.locator('.msg-modal').getByRole('button', { name: '확인', exact: true }).click();
            await adminCard.getByText(label + ' (관리자 지정)', { exact: true }).waitFor();
        }
        const adminItem = page.locator('#bmAdminResult .hd-prev-card').nth(3);
        await adminItem.locator('select').selectOption({ label: '제타 각성 캐릭터 변환석' });
        await adminItem.getByRole('spinbutton', { name: '아이템 수량' }).fill('7');
        await adminItem.getByRole('button', { name: '매물 지정', exact: true }).click();
        await page.locator('.msg-modal').getByRole('button', { name: '확인', exact: true }).click();
        await adminItem.getByText('제타 각성 캐릭터 변환석 x7 (관리자 지정)', { exact: true }).waitFor();
        assert.equal(await adminItem.getByRole('spinbutton', { name: '아이템 수량' }).inputValue(), '7');
        assert.equal(new URL(await adminItem.locator('img').getAttribute('src'), origin).searchParams.get('file'), '각성 캐릭터 변환석.png', '기존 각성 변환석 이미지 재사용');
        await page.screenshot({ path: path.join(__dirname, '../output/black-market/admin.png'), fullPage: true });
        clock = Date.parse('2026-10-27T21:00:00+09:00');
        await page.goto(origin); await page.locator('#groupTabs [data-group="market"]').click();
        await page.locator('[data-sector="card-garnet"] .bm-item-name').getByText('[𝛀] 각성 빵귤', { exact: true }).waitFor();
        assert.equal(await page.locator('[data-sector="item-gold"] .bm-item-name').textContent(), '제타 각성 캐릭터 변환석 x7');
        assert.equal(await page.locator('.bm-item-sub, .bm-quantity').count(), 0);
        assert.ok(!(await page.locator('.bm-root').textContent()).includes('·'), '암시장 사이점 없음');
        assert.equal(await page.locator('.bm-clock-note').textContent(), '08:50 마감 (한국 시간)');
        await page.screenshot({ path: path.join(__dirname, '../output/black-market/configured-items.png'), fullPage: true });
        assert.deepEqual(errors, []);
        await context.close();
    } finally { await browser.close(); }
});
