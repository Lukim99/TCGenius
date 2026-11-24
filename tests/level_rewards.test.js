'use strict';

const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const sandbox = require('../scripts/paradise-lab/sandbox');
const { rpg } = sandbox;
let base, cookie;
async function request(path, body) {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST',
        headers: { Cookie: cookie || '', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body) });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    return { status: response.status, data: await response.json() };
}
const user = () => rpg.getUserByPrimaryId(sandbox.account.id);
const claim = level => request('/api/levelreward', { level });
const itemId = name => rpg.getDataCache('Item', []).findIndex(item => item?.name === name);
const quantity = (value, name) => rpg.getInventoryItemCount(value, itemId(name));
before(async () => {
    base = 'http://127.0.0.1:' + await sandbox.start();
    assert.equal((await request('/api/login', { name: sandbox.account.name, code: 'LAB' })).status, 200);
});
beforeEach(async () => {
    const value = await user();
    Object.assign(value, { level: 140, maxCardLimit: 300, claimedLevelRewards: [], levelRewardReceipt: null,
        inventory: { card: [], item: [], equipment: [], pet: [] } });
    await value.save();
});
after(() => sandbox.close());

test('140레벨 미만의 빈 장비 상자 구간만 보충하고 120, 140 보상을 정확히 변경한다', async () => {
    const { data, status } = await request('/api/levelrewards');
    assert.equal(status, 200); assert.equal(data.list.length, 30);
    const byLevel = level => data.list.find(reward => reward.level === level);
    const items = level => byLevel(level).items.map(({ name, count }) => [name, count]);
    for (const level of [20, 30, 50, 60, 70, 80, 90, 100, 110, 120, 130]) {
        assert.deepEqual(items(level).filter(([name]) => name.includes('장비 상자')), [['유니크 장비 상자', 1]]);
    }
    assert.deepEqual(items(10).filter(([name]) => name.includes('장비 상자')), [['레어 장비 상자', 3]]);
    assert.deepEqual(items(40).filter(([name]) => name.includes('장비 상자')), [['유니크 장비 상자', 1]]);
    assert.deepEqual(items(120), [['황금 주머니', 10], ['딜러 지렁이', 200], ['아바타 상자', 1], ['유니크 장비 상자', 1]]);
    assert.deepEqual(items(140), [['황금 주머니', 10], ['6성 카드팩', 5], ['쥬얼', 20], ['헬 초대장', 300]]);
    assert.deepEqual(items(150), [['황금 주머니', 15], ['9성 카드팩', 1], ['9성 보호 카드', 1]]);
});

test('120레벨 실제 아이템과 수령 내역이 일치하고 재시도는 중복 지급하지 않는다', async () => {
    const first = await claim(120);
    assert.equal(first.status, 200);
    assert.deepEqual(first.data.rewards.map(({ name, count }) => [name, count]),
        [['황금 주머니', 10], ['딜러 지렁이', 200], ['아바타 상자', 1], ['유니크 장비 상자', 1]]);
    const again = await claim(120);
    assert.equal(again.status, 200); assert.deepEqual(again.data.rewards, first.data.rewards);
    const value = await user();
    assert.equal(quantity(value, '아바타 상자'), 1); assert.equal(quantity(value, '유니크 장비 상자'), 1);
    assert.deepEqual(value.claimedLevelRewards, [120]);
    assert.deepEqual((await request('/api/levelrewards')).data.receipt.rewards, first.data.rewards);
    assert.ok(!first.data.profile.user.levelRewards.available.includes(120));
});

test('140레벨 헬 초대장 300장과 개봉된 6성 카드 5장을 동시에 한 번만 지급한다', async () => {
    const results = await Promise.all([claim(140), claim(140)]);
    assert.ok(results.every(result => result.status === 200));
    assert.deepEqual(results[0].data.rewards, results[1].data.rewards);
    const value = await user();
    assert.equal(quantity(value, '헬 초대장'), 300);
    assert.equal(quantity(value, '6성 카드팩'), 0);
    assert.equal(value.inventory.card.length, 5);
    assert.ok(value.inventory.card.every(card => card.star === 5)); // Internal stars are zero based.
    assert.equal(results[0].data.rewards.filter(reward => reward.type === 'card').reduce((sum, reward) => sum + reward.count, 0), 5);
    assert.deepEqual(value.claimedLevelRewards, [140]);
});

test('미달성 보상과 과거 수령 기록은 지급하지 않으며 과거 보상을 소급 지급하지 않는다', async () => {
    const value = await user(); value.level = 130; value.claimedLevelRewards = [120]; await value.save();
    assert.equal((await claim(140)).status, 400);
    assert.equal((await claim(120)).status, 400);
    assert.equal((await claim(135)).status, 400);
    assert.equal(quantity(await user(), '아바타 상자'), 0);
    const listing = (await request('/api/levelrewards')).data;
    assert.equal(listing.list.find(r => r.level === 120).claimed, true);
    assert.ok(!listing.status.available.includes(120)); assert.ok(!listing.status.available.includes(140));
});

test('새 보상 조회와 프로필 알림은 저장하지 않고 캐시를 재사용한다', async t => {
    const original = DynamoDBDocumentClient.prototype.send, commands = [];
    t.mock.method(DynamoDBDocumentClient.prototype, 'send', function(command) {
        commands.push(command.constructor.name); return original.call(this, command);
    });
    for (let i = 0; i < 3; i++) {
        assert.equal((await request('/api/levelrewards')).status, 200);
        const profile = (await request('/api/profile')).data;
        assert.equal(profile.user.levelRewards.characterId, sandbox.account.id);
        assert.equal(profile.user.levelRewards.available.length, 14);
    }
    assert.deepEqual(commands, []);
});

test('아이템 정의가 없으면 부분 지급하거나 수령 완료로 저장하지 않는다', async () => {
    const items = rpg.getDataCache('Item', []), id = itemId('아바타 상자'), original = items[id];
    try {
        items[id] = null;
        assert.equal((await claim(120)).status, 503);
        const value = await user();
        assert.equal(quantity(value, '황금 주머니'), 0); assert.deepEqual(value.claimedLevelRewards, []);
    } finally { items[id] = original; }
});

test('저장 실패에는 성공 연출용 응답을 보내지 않으며 재시도는 한 번만 지급한다', async t => {
    const store = rpg.getCharacterStore(), original = store.commit;
    const mock = t.mock.method(store, 'commit', async () => { throw new Error('isolated storage failure'); });
    const failure = await claim(120);
    assert.equal(failure.status, 500); assert.equal(failure.data.ok, undefined); assert.equal(failure.data.rewards, undefined);
    mock.mock.restore(); assert.equal(store.commit, original);
    assert.equal((await claim(120)).status, 200);
    assert.equal(quantity(await user(), '아바타 상자'), 1);
});

test('가넷과 카드 공간 부족도 실제 획득 내역으로 표시한다', async () => {
    const value = await user(); value.maxCardLimit = 2; value.level = 210; await value.save();
    const cards = await claim(10);
    assert.equal(cards.status, 200); assert.equal(cards.data.discardedCards, 1);
    assert.equal(cards.data.rewards.filter(r => r.type === 'card').reduce((sum, r) => sum + r.count, 0), 2);
    assert.ok(cards.data.rewards.every(r => r.type !== 'discardedCard'));
    const before = Number((await user()).garnet || 0), currency = await claim(210);
    assert.equal(currency.status, 200);
    assert.deepEqual(currency.data.rewards.find(r => r.type === 'garnet').count, 1000);
    assert.equal((await user()).garnet, before + 1000);
});

test('보상 수령 기록과 마지막 획득 내역은 같은 계정의 캐릭터마다 독립적이다', async () => {
    assert.equal((await claim(140)).status, 200);
    const created = await request('/api/characters/create', { name: '보상부캐', cardId: 1, requestId: require('node:crypto').randomUUID() });
    assert.equal(created.status, 200);
    const alt = await rpg.getUserByPrimaryId(created.data.id); alt.level = 140; await alt.save();
    const select = id => request('/api/characters/select', { id, requestId: require('node:crypto').randomUUID() });
    try {
        assert.equal((await select(alt.id)).status, 200);
        const receipt = await claim(120); assert.equal(receipt.status, 200);
        assert.equal(receipt.data.profile.user.levelRewards.characterId, alt.id);
        assert.ok(receipt.data.profile.user.levelRewards.available.includes(140));
        assert.deepEqual((await user()).claimedLevelRewards, [140]);
        assert.equal((await user()).levelRewardReceipt.level, 140);
        assert.deepEqual((await rpg.getUserByPrimaryId(alt.id)).claimedLevelRewards, [120]);
    } finally { assert.equal((await select(sandbox.account.id)).status, 200); }
});
