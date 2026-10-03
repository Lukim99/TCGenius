const { test, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const express = require('express');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const AWS = require('aws-sdk');
AWS.S3.prototype.makeRequest = function (operation) {
    if (operation === 'listObjectsV2') return { promise: async () => ({ Contents: [] }) };
    throw new Error('Unexpected isolated S3 operation: ' + operation);
};
const puzzles = require('../wisdom_puzzle');
const { makeDefinition } = require('../scripts/init_wisdom_quest');

// 실제 RPGUser 캐시/저장, 인증, Express 라우트를 사용하고 DB 전송 경계만 격리한다.
const items = [{ name: '지혜의 보석', type: '재료' }];
const definition = makeDefinition([], items);
const account = { _get: 1, id: 'wisdom-test-id', name: 'wisdom-test', code: 'TEST', level: 300,
    logged_in: [], avatarMigrated: true, need_character_card_select: false,
    inventory: { item: [], card: [], equipment: [], pet: [] } };
const writes = [];
let failWrites = false;
process.env.ADMIN_SESSION_SECRET = 'wisdom-isolated-test';
DynamoDBDocumentClient.prototype.send = async command => {
    const input = command.input;
    if (command.constructor.name === 'GetCommand') {
        if (input.TableName !== 'rpgenius_data') return {};
        const key = input.Key.key;
        return { Item: { data: key === 'Quest' ? [definition] : key === 'Item' ? items : ['Equipment', 'Shop', 'EliteState', 'WorldBossState'].includes(key) ? {} : [] } };
    }
    if (command.constructor.name === 'ScanCommand') return { Items: input.TableName === 'rpgenius_user' ? [structuredClone(account)] : [] };
    if (command.constructor.name === 'UpdateCommand' && input.TableName === 'rpgenius_user') {
        if (failWrites) throw new Error('isolated storage failure');
        writes.push(structuredClone(input));
        return {};
    }
    throw new Error('Unexpected isolated DB command: ' + command.constructor.name + '/' + input.TableName);
};
const rpg = require('../rpgenius');
let listener, base;
before(async () => {
    await rpg.initRpgeniusData();
    const listen = express.application.listen;
    mock.method(express.application, 'listen', function () {
        listener = listen.call(this, 0, '127.0.0.1');
        return listener;
    });
    require('../server')();
    await new Promise(resolve => listener.once('listening', resolve));
    mock.restoreAll();
    base = 'http://127.0.0.1:' + listener.address().port;
});
after(() => new Promise(resolve => listener.close(resolve)));

function cookie() {
    const body = Buffer.from(JSON.stringify({ name: account.name, admin: false, exp: Date.now() + 3600000 })).toString('base64url');
    return 'rpg_admin=' + body + '.' + crypto.createHmac('sha256', process.env.ADMIN_SESSION_SECRET).update(body).digest('base64url');
}
async function request(route, body, authenticated = true) {
    const response = await fetch(base + '/api/quests' + route, {
        method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(authenticated ? { Cookie: cookie() } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: response.status, data: await response.json() };
}
async function reset() {
    failWrites = false;
    rpg.__setQuestDefs([structuredClone(definition)]);
    const user = await rpg.getRPGUserByName(account.name);
    user.quests = {};
    user.inventory.item = [];
    assert.equal((await user.save()).success, true);
    writes.length = 0;
    return user;
}
function answerBody(quest) {
    return { id: quest.id, period: quest.period, puzzleId: quest.puzzle.id,
        answer: puzzles.getPuzzle(quest.period, account.id, quest.id).solution };
}

test('로그인 필수, 새로고침 시 문제 고정, 서버 해답/시드 비공개', async () => {
    await reset();
    assert.equal((await request('', undefined, false)).status, 401);
    assert.equal((await request('/puzzle/answer', {}, false)).status, 401);
    assert.equal((await request('/claim', {}, false)).status, 401);
    const first = (await request('')).data.list[0];
    assert.deepEqual((await request('')).data.list[0].puzzle, first.puzzle);
    assert.equal(first.complete, false);
    assert.equal(first.canSkip, false);
    assert.equal(first.puzzle.solution, undefined);
    assert.equal(first.puzzle.seed, undefined);
    assert.equal(writes.length, 0, '게시판 조회는 운영/유저 데이터를 저장하지 않는다.');
});

test('게시판은 운영 목표와 보상을 대상, 이름, 수량, 실제 이미지로 나누어 표시한다', async () => {
    await reset();
    const questDefinition = { ...definition, id: 91, name: '게시판 표시', categories: ['일반'],
        objectives: [{ type: 'kill', field: '인트리그미션', count: 10 },
            { type: 'partyClear', quest: 'E세계대저택 (난이도 상관 없이)', count: 1 },
            { type: 'deliver', item_id: 0, count: 2 }],
        rewards: [{ type: '골드', count: { min: 500, max: 1500 } },
            { type: '아이템', item_id: 0, count: 3 }, { type: '경험치', count: 2500 },
            { type: '캐릭터카드', card_id: 0, display_star: 7, count: 2 }] };
    rpg.__setQuestDefs([questDefinition]);
    const { data } = await request('');
    const quest = data.list[0];
    assert.deepEqual(quest.objectives.map(o => [o.subject, o.actionLabel]),
        [['인트리그미션', '몬스터 처치'], ['E세계대저택 (난이도 상관 없이)', '파티 퀘스트 클리어'], ['지혜의 보석', '아이템 납품']]);
    assert.ok(quest.objectives.every(o => !o.actionLabel.includes('—') && !o.subject.includes('—')));
    assert.deepEqual(quest.rewards.slice(0, 3).map(r => [r.name, r.amountText]),
        [['골드', '500~1,500'], ['지혜의 보석', '3'], ['경험치', '2,500']]);
    assert.equal(decodeURIComponent(quest.rewards[0].iconUrl), '/item-image?dir=화폐&file=골드.png');
    assert.deepEqual(quest.rewards[3].card, { id: 0, star: 6, type: '일반' });
    assert.equal(quest.rewards[3].amountText, '2');
    assert.doesNotMatch(quest.rewards[3].name, /\s+x2$/);
    assert.equal(writes.length, 0, '조회와 표시 변경으로 운영 데이터나 보상을 쓰지 않는다.');
    assert.deepEqual(rpg.getDataCache('Quest', [])[0].rewards, questDefinition.rewards);
});

test('수령한 일반, 전직, 각성, 랜덤 성급 카드의 실제 정보로 보상 이미지를 연결하고 재전송에도 유지한다', async t => {
    const user = await reset();
    user.inventory.card = [];
    t.mock.method(Math, 'random', () => .5);
    const questDefinition = { ...definition, id: 92, name: '카드 보상 표시', categories: ['일반'],
        objectives: [{ type: 'kill', count: 1 }],
        rewards: [{ type: '골드', count: { min: 500, max: 1500 } },
            ...['일반', '전직', '각성'].map(card_type => ({ type: '캐릭터카드', card_id: 0, display_star: 7, card_type, count: card_type === '전직' ? 2 : 1 })),
            { type: '캐릭터카드', card_id: 0, range: { min: 8, max: 9 }, count: 1 },
            { type: '아이템', item_id: 0, count: 4 }, { type: '경험치', count: 2500 }] };
    rpg.__setQuestDefs([questDefinition]);
    rpg.recordQuestEvent(user, 'kill', { count: 1 });
    assert.equal((await user.save()).success, true);
    const received = await request('/claim', { id: 92, period: 'once' });
    assert.equal(received.status, 200);
    assert.ok(Array.isArray(received.data.rewards));
    assert.deepEqual(received.data.rewards.filter(reward => reward.type !== 'card').map(reward => [reward.type, reward.count]),
        [['exp', 2500], ['gold', 1000], ['item', 4]]);
    const cards = received.data.rewards.filter(reward => reward.type === 'card');
    const actualCards = (await rpg.getRPGUserByName(account.name)).inventory.card;
    assert.deepEqual(cards.map(reward => [reward.name, reward.count]),
        [['[7성] 빵귤', 1], ['[7성] 전직 빵귤', 2], ['[7성] 각성 빵귤', 1], ['[9성] 빵귤', 1]]);
    const cardComposite = require('../card_composite');
    cards.forEach(reward => {
        const card = actualCards.find(card => rpg.formatUserCard(card) === reward.name);
        assert.ok(card);
        if (cardComposite.canCompose({ name: '빵귤', star: card.star, type: card.type })) {
            const url = new URL(reward.iconUrl, base);
            assert.equal(url.pathname, '/card-image');
            assert.equal(url.searchParams.get('name'), '빵귤');
            assert.equal(Number(url.searchParams.get('star')), card.star);
            assert.equal(url.searchParams.get('type'), card.type);
        } else assert.equal(reward.iconUrl, null);
    });
    assert.equal(decodeURIComponent(received.data.rewards.find(reward => reward.type === 'gold').iconUrl), '/item-image?dir=화폐&file=골드.png');
    assert.deepEqual((await request('/claim', { id: 92, period: 'once' })).data.rewards, received.data.rewards);
    assert.equal((await rpg.getRPGUserByName(account.name)).inventory.card.length, 5);
    assert.deepEqual(rpg.getDataCache('Quest', [])[0].rewards, questDefinition.rewards);
});

test('잘못된 형식·다른 계정의 문제·스킵·이벤트 위조로 퍼즐 보상을 받을 수 없다', async () => {
    const user = await reset();
    const quest = rpg.buildQuestBoard(user)[0];
    const body = answerBody(quest);
    assert.equal((await request('/puzzle/answer', { ...body, answer: { correct: true } })).status, 400);
    assert.equal((await request('/puzzle/answer', { ...body, puzzleId: 'another-player' })).status, 400);
    rpg.__setQuestDefs([{ ...definition, skippable: true }]);
    assert.equal(rpg.buildQuestBoard(user)[0].canSkip, false);
    assert.equal((await request('/claim', { id: quest.id, period: quest.period, skip: true })).status, 400);
    assert.equal(rpg.recordQuestEvent(user, puzzles.OBJECTIVE_TYPE, { count: 100 }), false);
    user.quests[quest.id].counters[0] = 100;
    assert.equal(rpg.buildQuestBoard(user)[0].complete, false);
    assert.ok(rpg.claimQuestReward(user, quest.id, { period: quest.period }).error);
    assert.equal(writes.length, 0);
});

test('오답 후 5초 간격 재도전, 정답 진행 저장, 보상은 기존 수령 버튼으로 1개만 지급', async t => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-12T03:00:00Z') });
    await reset();
    const quest = (await request('')).data.list[0], body = answerBody(quest);
    const wrong = body.answer.slice(1) + body.answer[0];
    const miss = await request('/puzzle/answer', { ...body, answer: wrong });
    assert.equal(miss.data.correct, false);
    assert.equal(miss.data.list[0].puzzle.attempts, 1);
    assert.equal((await request('/puzzle/answer', body)).status, 400);
    t.mock.timers.tick(5000);
    const correct = await request('/puzzle/answer', body);
    assert.equal(correct.data.correct, true);
    assert.equal(correct.data.list[0].complete, true);
    let user = await rpg.getRPGUserByName(account.name);
    assert.equal(rpg.getInventoryItemCount(user, 0), 0);
    const received = await request('/claim', { id: quest.id, period: quest.period });
    assert.equal(received.status, 200);
    assert.match(received.data.lines.join(' '), /지혜의 보석.*x1/);
    assert.equal(received.data.list[0].claimed, true);
    user = await rpg.getRPGUserByName(account.name);
    assert.equal(rpg.getInventoryItemCount(user, 0), 1);
    assert.ok(writes.at(-1).ExpressionAttributeValues[':v_quests'][quest.id].claimed);
    assert.equal(writes.at(-1).ExpressionAttributeValues[':v_inventory'].item[0].count, 1);
});

test('정답/수령 동시 요청과 응답 유실 재전송에서도 보상 중복 없음', async () => {
    await reset();
    const quest = (await request('')).data.list[0], body = answerBody(quest);
    const answers = await Promise.all([request('/puzzle/answer', body), request('/puzzle/answer', body)]);
    assert.ok(answers.every(result => result.status === 200 && result.data.correct));
    const claims = await Promise.all([request('/claim', { id: quest.id, period: quest.period }), request('/claim', { id: quest.id, period: quest.period })]);
    assert.ok(claims.every(result => result.status === 200));
    assert.equal((await request('/claim', { id: quest.id, period: quest.period })).status, 200);
    assert.equal(rpg.getInventoryItemCount(await rpg.getRPGUserByName(account.name), 0), 1);
    assert.equal(writes.filter(input => input.ExpressionAttributeValues[':v_inventory']).length, 1);
});

test('답안/보상 저장 실패 시 성공 응답 금지, 재시도로 저장하고 보상은 한 번만 지급', async () => {
    await reset();
    const quest = (await request('')).data.list[0], body = answerBody(quest);
    failWrites = true;
    assert.equal((await request('/puzzle/answer', body)).status, 503);
    failWrites = false;
    assert.equal((await request('/puzzle/answer', body)).status, 200);
    failWrites = true;
    assert.equal((await request('/claim', { id: quest.id, period: quest.period })).status, 503);
    failWrites = false;
    assert.equal((await request('/claim', { id: quest.id, period: quest.period })).status, 200);
    assert.equal(rpg.getInventoryItemCount(await rpg.getRPGUserByName(account.name), 0), 1);
});

test('한국시간 자정에 자동 초기화, 이전 날짜 답안/수령 거부, 새 문제 보상 가능', async t => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-16T14:59:59Z') });
    await reset();
    const yesterday = (await request('')).data.list[0];
    assert.equal((await request('/puzzle/answer', answerBody(yesterday))).status, 200);
    assert.equal((await request('/claim', { id: yesterday.id, period: yesterday.period })).status, 200);
    t.mock.timers.tick(1000);
    const today = (await request('')).data.list[0];
    assert.equal(today.period, '2026-09-17');
    assert.equal(today.claimed, false);
    assert.equal(today.complete, false);
    assert.equal(today.puzzle.attempts, 0);
    assert.notEqual(today.puzzle.kind, yesterday.puzzle.kind);
    assert.equal((await request('/puzzle/answer', answerBody(yesterday))).status, 400);
    assert.equal((await request('/claim', { id: yesterday.id, period: yesterday.period })).status, 400);
    assert.equal((await request('/puzzle/answer', answerBody(today))).status, 200);
    assert.equal((await request('/claim', { id: today.id, period: today.period })).status, 200);
    assert.equal(rpg.getInventoryItemCount(await rpg.getRPGUserByName(account.name), 0), 2);
});

test('60종 전체: 실제 게시판 → 정답 제출 → 보상 수령 API가 새 답안 형식을 처리한다', async t => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse(puzzles.EXPANDED_FROM + 'T03:00:00Z') });
    for (const kind of puzzles.KINDS) {
        await reset();
        const quest = (await request('')).data.list[0];
        assert.equal(quest.puzzle.kind, kind);
        assert.equal(quest.puzzle.typeCount, 60);
        assert.equal(quest.puzzle.solution, undefined);
        const result = await request('/puzzle/answer', answerBody(quest));
        assert.equal(result.status, 200, kind);
        assert.equal(result.data.correct, true, kind);
        assert.equal(result.data.list[0].complete, true, kind);
        assert.equal((await request('/claim', { id: quest.id, period: quest.period })).status, 200, kind);
        assert.equal((await request('/claim', { id: quest.id, period: quest.period })).status, 200, kind);
        assert.equal(rpg.getInventoryItemCount(await rpg.getRPGUserByName(account.name), 0), 1, kind);
        t.mock.timers.tick(86400000);
    }
});

test('확장일 자정에도 이전 퍼즐의 답안은 거부하고 60종 순환을 시작한다', async t => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse(puzzles.EXPANDED_FROM + 'T00:00:00+09:00') - 1000 });
    await reset();
    const before = (await request('')).data.list[0];
    assert.equal(before.puzzle.typeCount, undefined);
    t.mock.timers.tick(1000);
    const after = (await request('')).data.list[0];
    assert.equal(after.puzzle.typeCount, 60);
    assert.equal((await request('/puzzle/answer', answerBody(before))).status, 400);
    assert.equal((await request('/puzzle/answer', answerBody(after))).status, 200);
});

test('관리자 비활성·레벨 제한·운영 보상 수량 변경을 존중하고 보상 누락 시 완료 처리하지 않는다', async () => {
    await reset();
    for (const patch of [{ enabled: false }, { minLevel: 301 }]) {
        rpg.__setQuestDefs([{ ...definition, ...patch }]);
        assert.deepEqual((await request('')).data.list, []);
        assert.equal((await request('/puzzle/answer', { id: definition.id })).status, 400);
    }
    rpg.__setQuestDefs([{ ...definition, rewards: [{ type: '아이템', item_id: 0, count: { min: 3, max: 3 } }] }]);
    const quest = (await request('')).data.list[0];
    await request('/puzzle/answer', answerBody(quest));
    const item = items[0]; items[0] = null;
    try { assert.equal((await request('/claim', { id: quest.id, period: quest.period })).status, 400); }
    finally { items[0] = item; }
    assert.equal((await request('/claim', { id: quest.id, period: quest.period })).status, 200);
    assert.equal(rpg.getInventoryItemCount(await rpg.getRPGUserByName(account.name), 0), 3);
});

test('기존 1회성 퀘스트도 저장 실패 후 재수령 요청으로 복구하며 목록에서 정상 제거된다', async () => {
    const user = await reset();
    rpg.__setQuestDefs([{ ...definition, id: 90, name: '기존 처치 퀘스트', categories: ['일반'], objectives: [{ type: 'kill', count: 1 }] }]);
    rpg.recordQuestEvent(user, 'kill', { count: 1 });
    await user.save();
    failWrites = true;
    assert.equal((await request('/claim', { id: 90, period: 'once' })).status, 503);
    failWrites = false;
    const retry = await request('/claim', { id: 90, period: 'once' });
    assert.equal(retry.status, 200);
    assert.deepEqual(retry.data.list, []);
    assert.equal(rpg.getInventoryItemCount(await rpg.getRPGUserByName(account.name), 0), 1);
});
