const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const express = require('express');
const crypto = require('crypto');
const { registerYutRoutes, advance, rollSticks, REWARD_NAMES } = require('../yut_event');

// DB 경계만 메모리로 대체한다. 운영 DB/환경 파일은 로드하지 않는다.
const items = [{ name: '윷', type: '이벤트' }, ...REWARD_NAMES.map(name => ({ name }))];
let user, server, base, failSave = false, saves = 0, slowLoad = false;
const rpg = {
    getDataCache: () => items,
    async getRPGUserByName() { if (slowLoad) await new Promise(resolve => setTimeout(resolve, 30)); return user; },
    getInventoryItemCount: (u, id) => u.inventory.item.find(item => item.id === id)?.count || 0,
    removeInventoryItem(u, id, count) { const item = u.inventory.item.find(item => item.id === id); if (!item || item.count < count) return false; item.count -= count; return true; },
    addInventoryItem(u, id, count) { const item = u.inventory.item.find(item => item.id === id); if (item) item.count += count; else u.inventory.item.push({ id, count }); }
};
function reset(position = 0, laps = 0, count = 100) {
    failSave = false; saves = 0; slowLoad = false;
    user = { isAdmin: false, inventory: { item: [{ id: 0, count }] }, yutEvent: { position, laps, revision: 0, lastRoll: null }, async save() { saves++; return { success: !failSave }; } };
}
const post = async (body, auth = 'admin') => {
    const response = await fetch(base + '/api/yut/roll', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: auth }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
};
const request = revision => ({ requestId: crypto.randomUUID(), revision });
before(async () => {
    const app = express(); app.use(express.json());
    registerYutRoutes(app, { rpgenius: rpg, requireUser(req, res, next) { if (!req.headers.authorization) return res.status(401).json({ error: '로그인 필요' }); req.session = { name: '테스트', admin: false }; next(); }, getItemDisplayAssets: () => ({ iconUrl: null, frameUrl: null }) });
    server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    base = 'http://127.0.0.1:' + server.address().port;
});
after(() => new Promise(resolve => server.close(resolve)));

test('바깥길, 모서리 진입, 중앙 지름길과 완주 경계', () => {
    assert.deepEqual(advance(0, 5), { position: 5, path: [1, 2, 3, 4, 5], finished: false });
    assert.deepEqual(advance(4, 3).path, [5, 6, 7]);
    assert.deepEqual(advance(5, 5).path, [21, 22, 29, 23, 24]);
    assert.deepEqual(advance(10, 5).path, [25, 26, 29, 27, 28]);
    assert.deepEqual(advance(29, 4), { position: 0, path: [27, 28, 20, 0], finished: true });
    assert.equal(advance(19, 1).finished, false);
    assert.deepEqual(advance(20, 5), { position: 0, path: [0], finished: true });
    assert.deepEqual(advance(22, 2).path, [29, 23]);
    assert.deepEqual(advance(26, 2).path, [29, 27]);
});
test('네 윷 앞뒷면과 도/개/걸/윷/모 결과가 일치한다', () => {
    for (let i = 0; i < 200; i++) {
        const roll = rollSticks(), sum = roll.faces.reduce((a, b) => a + b);
        assert.equal(roll.faces.length, 4); assert.ok(roll.faces.every(face => face === 0 || face === 1));
        assert.equal(roll.steps, sum || 5); assert.equal(roll.name, ['모', '도', '개', '걸', '윷'][sum]);
    }
});
test('로그인은 필수이며 일반 유저도 조회와 던지기를 이용한다', async () => {
    reset();
    assert.equal((await fetch(base + '/api/yut')).status, 401);
    assert.equal((await post(request(0), '')).status, 401);
    assert.equal(rpg.getInventoryItemCount(user, 0), 100); assert.equal(saves, 0);
    assert.equal((await fetch(base + '/api/yut', { headers: { Authorization: 'user' } })).status, 200);
    assert.equal((await post(request(0), 'user')).status, 200);
    assert.equal(rpg.getInventoryItemCount(user, 0), 96); assert.equal(saves, 1);
    user = null;
    assert.equal((await fetch(base + '/api/yut', { headers: { Authorization: 'user' } })).status, 404);
    assert.equal((await post(request(0), 'user')).status, 404);
});
test('4개 차감, 같은 요청 재전송, 오래된 화면과 동시 클릭', async () => {
    reset(); const body = request(0);
    const first = await post(body); assert.equal(first.status, 200); assert.equal(first.data.itemCount, 96);
    const replay = await post(body); assert.equal(replay.status, 200); assert.equal(replay.data.replayed, true);
    assert.deepEqual(replay.data.lastRoll, first.data.lastRoll); assert.equal(replay.data.itemCount, 96);
    assert.equal((await post(request(0))).status, 409); assert.equal(user.yutEvent.revision, 1);
    reset(); slowLoad = true;
    const concurrent = await Promise.all([post(request(0)), post(request(0))]);
    assert.deepEqual(concurrent.map(result => result.status).sort(), [200, 409]); assert.equal(rpg.getInventoryItemCount(user, 0), 96);
});
test('1~10회 보상과 11회 이후 반복 보상을 한 번씩 지급하고 기록을 유지한다', async () => {
    for (let laps = 0; laps < 13; laps++) {
        reset(20, laps); const body = request(0), expected = REWARD_NAMES[Math.min(laps, 10)];
        const result = await post(body); assert.equal(result.status, 200);
        assert.equal(result.data.lastRoll.reward.name, expected); assert.equal(result.data.laps, laps + 1); assert.equal(result.data.position, 0);
        const rewardId = items.findIndex(item => item.name === expected);
        assert.equal(rpg.getInventoryItemCount(user, rewardId), 1);
        await post(body); assert.equal(rpg.getInventoryItemCount(user, rewardId), 1);
        const persisted = await (await fetch(base + '/api/yut', { headers: { Authorization: 'admin' } })).json();
        assert.equal(persisted.laps, laps + 1); assert.equal(persisted.revision, 1); assert.equal(persisted.itemCount, 96);
    }
});
test('부족한 윷, 잘못된 요청, 누락된 보상은 차감 없이 거절한다', async () => {
    reset(20, 0, 3); assert.equal((await post(request(0))).status, 400); assert.equal(saves, 0);
    reset(); assert.equal((await post({ ...request(0), revision: -1 })).status, 400);
    assert.equal((await post({ ...request(0), requestId: 'x' })).status, 400);
    const saved = items[1]; items[1] = null;
    try { assert.equal((await post(request(0))).status, 503); assert.equal(rpg.getInventoryItemCount(user, 0), 100); }
    finally { items[1] = saved; }
});
test('저장 실패 시 성공을 응답하지 않고 같은 요청으로 저장을 재확인한다', async () => {
    reset(20); failSave = true; const body = request(0);
    assert.equal((await post(body)).status, 503);
    failSave = false;
    const result = await post(body); assert.equal(result.status, 200); assert.equal(result.data.replayed, true);
    assert.equal(result.data.laps, 1); assert.equal(result.data.itemCount, 96); assert.equal(rpg.getInventoryItemCount(user, 1), 1);
});

test('윷·모는 무료 추가 던지기를 주며 연속으로 나오면 다시 이어진다', async () => {
    reset(0, 0, 4);
    const original = crypto.randomInt;
    try {
        crypto.randomInt = () => 1; // 윷
        const first = await post(request(0));
        assert.equal(first.data.lastRoll.name, '윷');
        assert.equal(first.data.itemCount, 0);
        assert.equal(first.data.bonusRoll, true);
        assert.equal(first.data.cost, 0);
        assert.equal(first.data.lastRoll.cost, 4);
        const loaded = await (await fetch(base + '/api/yut', { headers: { Authorization: 'admin' } })).json();
        assert.equal(loaded.bonusRoll, true, '새로고침해도 추가 던지기를 유지한다');
        crypto.randomInt = () => 0; // 모
        const body = request(1);
        const second = await post(body);
        assert.equal(second.data.lastRoll.name, '모');
        assert.equal(second.data.itemCount, 0);
        assert.equal(second.data.lastRoll.cost, 0);
        assert.equal(second.data.bonusRoll, true);
        const replay = await post(body);
        assert.equal(replay.data.revision, 2);
        assert.equal(replay.data.bonusRoll, true);
        let i = 0;
        crypto.randomInt = () => [1, 0, 0, 0][i++]; // 도
        const third = await post(request(2));
        assert.equal(third.data.lastRoll.name, '도');
        assert.equal(third.data.lastRoll.cost, 0);
        assert.equal(third.data.bonusRoll, false);
        assert.equal(third.data.cost, 4);
        assert.equal((await post(request(3))).status, 400);
    } finally { crypto.randomInt = original; }
});

test('완주 때 얻은 무료 던지기도 저장 실패/재전송 후 보존한다', async () => {
    reset(20, 0, 4);
    const original = crypto.randomInt;
    try {
        crypto.randomInt = () => 0;
        failSave = true;
        const body = request(0);
        assert.equal((await post(body)).status, 503);
        failSave = false;
        const result = await post(body);
        assert.equal(result.data.laps, 1);
        assert.equal(result.data.bonusRoll, true);
        assert.equal(result.data.itemCount, 0);
        assert.equal(rpg.getInventoryItemCount(user, 1), 1);
        assert.equal(result.data.revision, 1);
    } finally { crypto.randomInt = original; }
});

test('클라이언트가 무료 던지기 값을 보내도 서버 기록 없이는 차감한다', async () => {
    reset(0, 0, 4);
    const result = await post({ ...request(0), bonusRoll: true, cost: 0 });
    assert.equal(result.status, 200);
    assert.equal(result.data.lastRoll.cost, 4);
    assert.equal(result.data.itemCount, 0);
});
