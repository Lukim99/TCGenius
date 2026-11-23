'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { marshall } = require('@aws-sdk/util-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const sandbox = require('../scripts/paradise-lab/sandbox');
const { rpg } = sandbox;
after(() => sandbox.close());

test('분리된 캐릭터의 천상 입장과 공격을 실제 DynamoDB 직렬화로 저장하고 재요청은 중복 실행하지 않는다', async t => {
    const send = DynamoDBDocumentClient.prototype.send;
    t.mock.method(DynamoDBDocumentClient.prototype, 'send', async function (command) {
        // 기존 격리 DB 앞에서 운영 SDK가 실제로 적용하는 데이터 변환도 통과시킨다.
        const writes = command.input.TransactItems?.map(operation => operation.Update || operation.Put) || [command.input];
        for (const write of writes) {
            if (write.Item) marshall(write.Item);
            if (write.ExpressionAttributeValues) marshall(write.ExpressionAttributeValues);
        }
        return send.call(this, command);
    });
    const base = 'http://127.0.0.1:' + await sandbox.start();
    let cookie;
    async function request(path, body) {
        const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: cookie || '' }, body: body === undefined ? undefined : JSON.stringify(body) });
        if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
        const result = await response.json();
        assert.equal(response.status, 200, path + ': ' + (result.error || ''));
        return result;
    }
    await request('/api/login', { name: sandbox.account.name, code: 'LAB' });
    const user = await rpg.getRPGUserByName(sandbox.account.name);
    const ticketId = rpg.getDataCache('Item').findIndex(item => item.name === '천상의 회랑 입장권');
    rpg.addInventoryItem(user, ticketId, 2);
    await user.save();
    const bodyFor = state => ({ requestId: crypto.randomUUID(), revision: state.revision, runId: state.runId });
    let state = await request('/api/paradise');
    state = (await request('/api/paradise/enter', bodyFor(state))).state;
    assert.equal(state.run.phase, 'combat');
    const attackBody = bodyFor(state);
    const attacked = await request('/api/paradise/attack', attackBody);
    assert.equal(attacked.ok, true);
    const saved = await rpg.getRPGUserByName(user.name);
    assert.equal(saved.paradiseReceipt.id, attackBody.requestId);
    assert.equal(rpg.getInventoryItemCount(saved, ticketId), 1);
    const replay = await request('/api/paradise/attack', attackBody);
    assert.equal(replay.ok, true);
    const repeated = await rpg.getRPGUserByName(user.name);
    assert.equal(repeated.paradise.revision, saved.paradise.revision);
    assert.equal(repeated.paradise.combatSequence, saved.paradise.combatSequence);
    assert.equal(repeated.paradiseReceipt.id, attackBody.requestId);
    // 공격 후 스킬과 전투 종료, 귀환, 결과 닫기까지 저장이 계속 가능하다.
    const ready = await rpg.getRPGUserByName(user.name);
    ready.field.nextActionAt = 0;
    await ready.save();
    state = await request('/api/paradise');
    assert.equal((await request('/api/paradise/skill', { ...bodyFor(state), skill: state.battle.skills[0].name })).ok, true);
    const finishing = await rpg.getRPGUserByName(user.name);
    await sandbox.win(finishing);
    await finishing.save();
    state = await request('/api/paradise');
    assert.notEqual(state.run.phase, 'combat');
    state = (await request('/api/paradise/retire', bodyFor(state))).state;
    assert.notEqual(state.run.status, 'active');
    if (!state.run.claimed) state = (await request('/api/paradise/claim', bodyFor(state))).state;
    assert.equal((await request('/api/paradise/dismiss', bodyFor(state))).ok, true);
});
