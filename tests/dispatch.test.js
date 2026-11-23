'use strict';

const { test, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const sandbox = require('../scripts/paradise-lab/sandbox');
const { rpg, corridor } = sandbox;
const dispatch = require('../dispatch');
let base, cookie, altId;
const ticketId = name => rpg.getDataCache('Item', []).findIndex(item => item?.name === name);
async function request(path, body, auth = cookie) {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST',
        headers: { Cookie: auth || '', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    return { status: response.status, data: await response.json() };
}
const character = (action, data) => request('/api/characters/' + action, { ...data, requestId: crypto.randomUUID() });
async function reset(id = sandbox.account.id) {
    const user = await rpg.getUserByPrimaryId(id);
    user.level = 200; user.dispatch = null; user.field = null; user.paradise = null; user.fishing = false;
    user.pendingAction = null; user.pendingFragment = null; user.gold = 1000;
    user.inventory.equipment = []; user.inventory.item = [];
    rpg.addInventoryItem(user, ticketId('헬 초대장'), 100);
    rpg.addInventoryItem(user, ticketId(corridor.TICKET), 5);
    await rpg.getCharacterStore().commit([user]);
    return user;
}
const bodyFor = (user, destination) => ({ destination, previousId: user.dispatch?.id || null, requestId: crypto.randomUUID() });
before(async () => {
    base = 'http://127.0.0.1:' + await sandbox.start();
    // The sandbox intentionally omits unrelated optional operational tables.
    mock.method(rpg, 'isRuntimeReady', async () => true);
    assert.equal((await request('/api/login', { name: sandbox.account.name, code: 'LAB' })).status, 200);
    const created = await character('create', { name: '파견부캐', cardId: 1 });
    assert.equal(created.status, 200); altId = created.data.id;
});
after(() => sandbox.close());

test('파견 전투력은 기존 천상 권장 전투력을 따르며 1~150층으로 제한한다', () => {
    assert.equal(dispatch.floorForPower(0), 1);
    for (const floor of [2, 50, 100, 149, 150]) {
        assert.equal(dispatch.floorForPower(corridor.recommendedPower(floor)), floor);
        assert.equal(dispatch.floorForPower(corridor.recommendedPower(floor) - 1), floor - 1);
    }
    assert.equal(dispatch.floorForPower(1e12), 150);
});

test('대저택은 모든 난이도에서 161레벨부터 입장하고 권장 전투력을 제공한다', async () => {
    const party = require('../partyquest');
    for (const [id, power] of [['mansionNormal', 550000], ['mansionHard', 1000000], ['mansionNightmare', 1500000]]) {
        let user = await reset(); user.level = 160; user.unlockedRaids = [id]; await rpg.getCharacterStore().commit([user]);
        assert.match((await party.createRoom(user.name, id)).error, /161/);
        user = await rpg.getUserByPrimaryId(user.id); user.level = 161; await rpg.getCharacterStore().commit([user]);
        try {
            assert.ok((await party.createRoom(user.name, id)).roomId);
            const listing = await request('/api/party/quests');
            const quest = listing.data.quests.find(quest => quest.id === id);
            assert.equal(quest.minLevel, 161); assert.equal(quest.recommendedPower, power);
        } finally { party.leaveRoom(user.name); }
    }
});

test('인증, 입장 레벨, 초대장, 진행 중인 콘텐츠를 검증하고 실패 시 소모하지 않는다', async () => {
    assert.equal((await request('/api/dispatch', undefined, '')).status, 401);
    let user = await reset(); user.level = 140; await rpg.getCharacterStore().commit([user]);
    assert.equal((await request('/api/dispatch/start', bodyFor(user, 'hell'))).status, 409);
    user = await rpg.getUserByPrimaryId(user.id);
    assert.equal(rpg.getInventoryItemCount(user, ticketId('헬 초대장')), 100);
    user.level = 141; user.fishing = true; await rpg.getCharacterStore().commit([user]);
    assert.match((await request('/api/dispatch/start', bodyFor(user, 'hell'))).data.error, /낚시/);
    user.fishing = false; rpg.removeInventoryItem(user, ticketId('헬 초대장'), 100); await rpg.getCharacterStore().commit([user]);
    assert.match((await request('/api/dispatch/start', bodyFor(user, 'hell'))).data.error, /부족/);
});

test('중복 출발은 한 번만 소모하고 파견 캐릭터의 플레이를 차단한다', async () => {
    const user = await reset(), body = bodyFor(user, 'hell');
    const responses = await Promise.all([request('/api/dispatch/start', body), request('/api/dispatch/start', body)]);
    assert.ok(responses.every(response => response.status === 200));
    const saved = await rpg.getUserByPrimaryId(user.id);
    assert.equal(rpg.getInventoryItemCount(saved, ticketId('헬 초대장')), 70);
    assert.equal(saved.dispatch.endsAt - saved.dispatch.startedAt, 2000);
    assert.equal((await request('/api/hfield/enter', {})).status, 409);
    assert.equal((await request('/api/inventory/items/0/use', {})).status, 409);
    assert.equal((await request('/api/dispatch/start', { ...body, destination: 'heaven' })).status, 409);
    assert.equal((await request('/api/dispatch/start', { ...body, requestId: crypto.randomUUID() })).status, 409);
    assert.equal((await dispatch.complete(user.id, saved.dispatch.endsAt - 1)).dispatch.status, 'active');
    await dispatch.complete(user.id, saved.dispatch.endsAt);
    const equipment = structuredClone((await rpg.getUserByPrimaryId(user.id)).inventory.equipment);
    assert.ok(equipment.length >= 1);
    await dispatch.complete(user.id, saved.dispatch.endsAt + 1);
    assert.deepEqual((await rpg.getUserByPrimaryId(user.id)).inventory.equipment, equipment);
    assert.equal((await request('/api/dispatch/start', body)).status, 200);
    assert.deepEqual((await rpg.getUserByPrimaryId(user.id)).inventory.equipment, equipment);
});

test('확정 장비는 유지하며 두 번째 장비만 20%에서 10%로 줄고 아드 효과를 사용하지 않는다', async () => {
    const user = await reset();
    const normal = structuredClone(user), sent = structuredClone(user);
    const random = mock.method(Math, 'random', () => .15);
    try { rpg.grantHellRewards(normal); rpg.grantHellRewards(sent, .10); }
    finally { random.mock.restore(); }
    assert.equal(normal.inventory.equipment.length, 2);
    assert.equal(sent.inventory.equipment.length, 1);
});

test('캐릭터마다 파견하며 전환 뒤에도 원래 캐릭터의 보상과 랭킹을 처리한다', async () => {
    const first = await reset(), other = await reset(altId);
    await dispatch.start(first, bodyFor(first, 'heaven'));
    assert.equal((await character('select', { id: altId })).status, 200);
    assert.equal((await request('/api/dispatch/start', bodyFor(other, 'hell'))).status, 200);
    assert.equal((await request('/api/characters')).data.characters.filter(row => row.dispatch?.status === 'active').length, 2);
    assert.equal((await character('select', { id: first.id })).status, 200);
    const saved = await rpg.getUserByPrimaryId(first.id);
    assert.equal(saved.dispatch.endsAt - saved.dispatch.startedAt, 3600000);
    assert.equal(saved.dispatch.floor, dispatch.floorForPower(rpg.calculateTownCombatPower(saved).total));
    assert.equal(rpg.getInventoryItemCount(saved, ticketId(corridor.TICKET)), 4);
    const config = rpg.getDataCache('Paradise'); const original = config.baseRewards[0].count;
    config.baseRewards[0].count = 99999;
    try {
        await Promise.all([dispatch.complete(first.id, saved.dispatch.endsAt), dispatch.complete(altId, saved.dispatch.endsAt)]);
    } finally { config.baseRewards[0].count = original; }
    const completed = await rpg.getUserByPrimaryId(first.id);
    assert.equal(completed.gold, 1000 + saved.dispatch.floor * original);
    assert.equal(completed.paradiseWeekly.bestFloor, saved.dispatch.floor);
    assert.equal(completed.paradiseWeekly.reachedAt, saved.dispatch.endsAt);
    assert.equal(completed.paradise, null, '기존 천상 탐험 상태를 덮어쓰지 않는다');
    assert.equal((await rpg.getUserByPrimaryId(altId)).gold, completed.gold, '계정 공용 지갑에 지급한다');
});

test('완료 저장 실패와 응답 유실을 재시도해도 보상과 완료 상태는 한 번만 저장한다', async () => {
    for (const loseResponse of [false, true]) {
        const user = await reset(); await dispatch.start(user, bodyFor(user, 'heaven'));
        const saved = await rpg.getUserByPrimaryId(user.id), send = DynamoDBDocumentClient.prototype.send;
        let failed = false;
        const patch = mock.method(DynamoDBDocumentClient.prototype, 'send', async function(command) {
            if (!failed && command.constructor.name === 'TransactWriteCommand') {
                failed = true;
                if (loseResponse) await send.call(this, command);
                throw new Error('dispatch simulated storage failure');
            }
            return send.call(this, command);
        });
        try { await dispatch.complete(user.id, saved.dispatch.endsAt).catch(() => {}); }
        finally { patch.mock.restore(); }
        const mid = await rpg.getUserByPrimaryId(user.id);
        assert.equal(mid.gold, loseResponse ? 1000 + saved.dispatch.floor * 100 : 1000);
        await dispatch.complete(user.id, saved.dispatch.endsAt);
        await dispatch.complete(user.id, saved.dispatch.endsAt);
        const result = await rpg.getUserByPrimaryId(user.id);
        assert.equal(result.gold, 1000 + saved.dispatch.floor * 100);
        assert.equal(result.dispatch.status, 'completed');
    }
});

test('서버 재시작으로 지난 주 파견이 늦게 완료되어도 해당 주 기록을 보존한다', async () => {
    const user = await reset(); await dispatch.start(user, bodyFor(user, 'heaven'));
    const saved = await rpg.getUserByPrimaryId(user.id), ended = Date.parse('2026-11-22T14:59:59Z');
    saved.dispatch.endsAt = ended;
    saved.paradiseWeekly = { week: rpg.getKoreanWeekKey(new Date('2026-11-23T00:00:00Z')), bestFloor: 200, reachedAt: ended + 1 };
    await rpg.getCharacterStore().commit([saved]);
    await dispatch.settleDue(ended + 3600000);
    const completed = await rpg.getUserByPrimaryId(user.id), week = rpg.getKoreanWeekKey(new Date(ended));
    assert.equal(completed.dispatch.status, 'completed');
    assert.equal(completed.paradiseWeekly.bestFloor, 200);
    assert.equal(completed.paradiseWeeklyHistory[week].bestFloor, saved.dispatch.floor);
});

test('상태 조회와 진행 중인 파견 시계는 DB 요청을 추가하지 않는다', async () => {
    const user = await reset(); await dispatch.start(user, bodyFor(user, 'heaven'));
    const send = DynamoDBDocumentClient.prototype.send, commands = [];
    const patch = mock.method(DynamoDBDocumentClient.prototype, 'send', function(command) { commands.push(command.constructor.name); return send.call(this, command); });
    try {
        await dispatch.settleDue(); await dispatch.settleDue();
        assert.equal((await request('/api/dispatch')).status, 200);
        assert.deepEqual(commands, []);
    } finally { patch.mock.restore(); }
    await dispatch.complete(user.id, user.dispatch.endsAt);
});

test('공용 보상 처리를 사용해도 일반 천상 귀환 보상과 중복 수령 방지를 유지한다', async () => {
    const user = await reset(); assert.ok(!corridor.enter(user).error);
    Object.assign(user.paradise, { status: 'ended', outcome: 'retired', clearedFloor: 80, highestFloor: 80, rewardBonus: 0, contracts: [] });
    user.field = null;
    assert.ok(!corridor.claim(user).error);
    assert.equal(user.gold, 9000);
    assert.ok(!corridor.claim(user).error);
    assert.equal(user.gold, 9000);
});

test('운영 설정이 비어 있으면 보상을 만들지 않고, 닫힌 천상과 잘못된 보상은 입장권을 소모하지 않는다', async () => {
    const config = rpg.getDataCache('Paradise'), original = structuredClone(config);
    try {
        let user = await reset(); config.enabled = false;
        await assert.rejects(dispatch.start(user, bodyFor(user, 'heaven')), /열리지/);
        assert.equal(rpg.getInventoryItemCount(user, ticketId(corridor.TICKET)), 5);
        config.enabled = true; config.baseRewards = [{ type: '아이템', name: '없는 파견 아이템', count: 1, perFloors: 1 }];
        await assert.rejects(dispatch.start(user, bodyFor(user, 'heaven')), /보상 설정/);
        assert.equal(rpg.getInventoryItemCount(user, ticketId(corridor.TICKET)), 5);
        config.baseRewards = [];
        await dispatch.start(user, bodyFor(user, 'heaven'));
        user = await dispatch.complete(user.id, user.dispatch.endsAt);
        assert.equal(user.gold, 1000); assert.deepEqual(user.dispatch.result, []);
    } finally { Object.assign(config, original); }
});
