'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setImmediate: nextTurn } = require('node:timers/promises');
const sandbox = require('../scripts/paradise-lab/sandbox');
const { rpg } = sandbox;
const party = require('../partyquest');
const quests = require('../DB/RPGenius/PartyQuest.json').quests;
let altName = '레이드부캐';

before(async () => {
    const base = 'http://127.0.0.1:' + await sandbox.start();
    const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: sandbox.account.name, code: 'LAB' }) });
    assert.equal(login.status, 200);
    const response = await fetch(base + '/api/characters/create', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: login.headers.get('set-cookie').split(';')[0] },
        body: JSON.stringify({ name: altName, cardId: 1, requestId: require('node:crypto').randomUUID() }) });
    assert.equal(response.status, 200);
    assert.deepEqual((await rpg.getRPGUserByName(altName)).raidRewardProgress, {});
});
after(() => sandbox.close());

async function prepareRoom(t, questId = 'blackHodu') {
    const user = await rpg.getRPGUserByName(sandbox.account.name);
    user.unlockedRaids = [questId];
    user.titleProgress = {}; user.titles = [];
    user.raidRewardProgress = {};
    await user.save();
    const created = await party.createRoom(user.name, questId);
    assert.equal(created.error, undefined);
    t.after(() => party.leaveRoom(user.name));
    const room = party.getRoomOf(user.name);
    room.state = 'inProgress';
    room.phaseIndex = quests.find(quest => quest.id === room.questId).phases.length - 1;
    room.members[0].potions = [{ name: '상급 체력 포션', count: 2 }];
    room.members[0].runtime = { pendingEquipmentGold: 123 };
    return { room, user };
}

for (const quest of quests.filter(quest => quest.id !== require('../birthday_raid').ID)) {
    test(quest.name + ' 종료 시 물약 반환, 보상, 장비 효과 골드를 한 번씩 저장한다', async t => {
        t.mock.method(Math, 'random', () => 0);
        const { room, user } = await prepareRoom(t, quest.id);
        const potionId = rpg.getDataCache('Item').findIndex(item => item.name === '상급 체력 포션');
        assert.ok(potionId >= 0);
        const beforeCount = rpg.getInventoryItemCount(user, potionId);
        party.__test.proceedToNextPhase(room);
        for (let i = 0; i < 50 && !room.result.rewards.length; i++) await nextTurn();
        assert.equal(room.state, 'cleared');
        assert.equal(room.result.rewards.length, 1);
        assert.equal(room.result.rewards[0].error, undefined);
        const saved = await rpg.getRPGUserByName(user.name);
        assert.equal(rpg.getInventoryItemCount(saved, potionId), beforeCount + 2);
        const regularGold = quest.id === 'mansionNightmare' ? 0 : (quest.rewards.gold.min || quest.rewards.gold);
        assert.equal(saved.gold, user.gold + regularGold + (quest.id === 'blackHoduExtreme' ? 1000000 : 0) + 123);
        assert.equal(room.members[0].runtime.pendingEquipmentGold, 0);
        if (quest.id.startsWith('blackHodu')) assert.equal(saved.raidRewardProgress.hoduRewardCount, 1);
        // 종료 통지의 중복 호출로 주간 횟수, 최초 보상, 아이템이 다시 지급되지 않는다.
        await Promise.all([party.__test.grantPartyQuestClearRewards(room), party.__test.grantPartyQuestClearRewards(room)]);
        const repeated = await rpg.getRPGUserByName(user.name);
        for (const key of ['gold', 'garnet', 'inventory', 'titleProgress', 'titles', 'exp', 'raidRewardProgress']) assert.deepEqual(repeated[key], saved[key]);
    });
}

test('반환과 칭호 저장을 기다리는 동안 재도전과 중복 보상 요청을 막는다', async t => {
    t.mock.method(Math, 'random', () => 0);
    const { room, user } = await prepareRoom(t);
    let release;
    room.pendingTitleGrants = [new Promise(resolve => { release = resolve; })];
    t.after(() => release());
    party.__test.proceedToNextPhase(room);
    const payment = party.__test.grantPartyQuestClearRewards(room);
    assert.equal(payment, room.rewardPromise);
    await Promise.all(room.refundTasks);
    assert.equal(room.result.rewards.length, 0);
    assert.equal(party.restartQuest(user.name).error, '보상 지급이 끝난 후 다시 시도해주세요.');
    const titleUser = await rpg.getRPGUserByName(user.name);
    titleUser.titleProgress.rainDefense = true;
    await titleUser.save();
    release();
    await payment;
    const saved = await rpg.getRPGUserByName(user.name);
    assert.equal(room.result.rewards[0].error, undefined);
    assert.equal(saved.titleProgress.rainDefense, true);
    assert.equal(saved.raidRewardProgress.hoduRewardCount, 1);
    assert.equal(party.restartQuest(user.name).ok, true);
});

test('보상 저장이 실패하면 성공 안내를 보내지 않고 미지급 장비 골드를 유지한다', async t => {
    const { room, user } = await prepareRoom(t);
    room.state = 'cleared'; room.result = {};
    const messages = [];
    room.members[0].sseRes = { write: chunk => messages.push(chunk), end() {} };
    t.mock.method(rpg.RPGUser.prototype, 'save', async () => { throw new Error('isolated reward save failure'); });
    const errors = t.mock.method(console, 'error', () => {});
    await party.__test.grantPartyQuestClearRewards(room);
    assert.equal(room.result.rewards[0].error, '보상 지급 실패');
    assert.equal(room.members[0].runtime.pendingEquipmentGold, 123);
    assert.ok(messages.some(message => message.includes('일부 보상 지급 실패')));
    assert.ok(messages.every(message => !message.includes('보상 지급 완료')));
    assert.deepEqual(errors.mock.calls[0].arguments[2], { questId: room.questId, roomId: room.id });
    const saved = await rpg.getRPGUserByName(user.name);
    for (const key of ['gold', 'garnet', 'inventory', 'titleProgress', 'raidRewardProgress']) assert.deepEqual(saved[key], user[key]);
    room.members[0].potions = [];
});

async function clearAs(name, questId) {
    const created = await party.createRoom(name, questId);
    assert.equal(created.error, undefined);
    const room = party.getRoomOf(name);
    room.state = 'cleared'; room.result = {};
    try {
        await party.__test.grantPartyQuestClearRewards(room);
        assert.equal(room.result.rewards[0].error, undefined);
        return room.result.rewards[0];
    } finally { party.leaveRoom(name); }
}

test('1번 캐릭터의 최초 보상과 주간 제한을 이어받고 부캐는 칭호 공유와 무관하게 따로 받는다', async t => {
    t.mock.method(Math, 'random', () => 0);
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    const first = await rpg.getRPGUserByName(sandbox.account.name);
    const week = rpg.getKoreanWeekKey(new Date());
    const inherited = { hoduRewardWeek: week, hoduRewardCount: 3, butaRewardWeek: week, mansionRewardWeek: week,
        hoduExtremeFirst: true, mansionNightmareFirst: true };
    first.raidRewardProgress = { ...inherited };
    first.titles = ['hoduExtreme', 'mansionNightmare'];
    first.unlockedRaids = quests.map(quest => quest.id);
    await first.save();
    const alt = await rpg.getRPGUserByName(altName);
    alt.level = 300; alt.unlockedRaids = [...first.unlockedRaids]; alt.raidRewardProgress = {};
    await alt.save();
    for (const id of ['blackHoduExtreme', 'butaGame', 'mansionHard']) {
        const result = await clearAs(first.name, id);
        assert.equal(result.weeklyLocked, true); assert.equal(result.firstClear, null);
    }
    assert.equal((await clearAs(first.name, 'mansionNightmare')).firstClear, null);
    for (const id of ['blackHoduExtreme', 'mansionNightmare']) {
        const result = await clearAs(altName, id);
        assert.ok(result.firstClear);
        assert.equal(result.weeklyLocked, false);
        assert.ok(result.firstClear.rewards.every(reward => reward.kind !== 'title'), '이미 공유 중인 칭호를 새 획득으로 표시하지 않는다');
        assert.equal((await clearAs(altName, id)).firstClear, null);
    }
    assert.equal((await clearAs(altName, 'blackHodu')).weeklyLocked, false);
    assert.equal((await clearAs(altName, 'blackHoduExtreme')).weeklyLocked, true, '일반/익스트림은 해당 캐릭터 안에서 3회 통합');
    for (const [normal, hard] of [['butaGame', 'butaGameHard'], ['mansionNormal', 'mansionHard']]) {
        assert.equal((await clearAs(altName, normal)).weeklyLocked, false);
        assert.equal((await clearAs(altName, hard)).weeklyLocked, true);
    }
    const savedFirst = await rpg.getRPGUserByName(first.name);
    assert.deepEqual(savedFirst.raidRewardProgress, inherited, '부캐의 보상이 1번 캐릭터 기록을 바꾸지 않는다');
    assert.equal(rpg.getCharacterStore().accountFor(savedFirst).raidRewardProgress, undefined);
    for (const title of ['hoduExtreme', 'mansionNightmare']) assert.equal(savedFirst.titles.filter(value => value === title).length, 1);
    t.mock.timers.tick(7 * 86400000);
    for (const name of [first.name, altName]) {
        const result = await clearAs(name, 'blackHoduExtreme');
        assert.equal(result.weeklyLocked, false); assert.equal(result.firstClear, null);
        assert.equal((await rpg.getRPGUserByName(name)).raidRewardProgress.hoduRewardCount, 1);
    }
});

test('부캐가 먼저 공유 칭호를 얻어도 1번 캐릭터의 최초 보상은 남아 있다', async t => {
    t.mock.method(Math, 'random', () => 0);
    for (const name of [sandbox.account.name, altName]) {
        const user = await rpg.getRPGUserByName(name);
        user.raidRewardProgress = {}; user.titles = [];
        await user.save();
    }
    for (const id of ['blackHoduExtreme', 'mansionNightmare']) {
        assert.ok((await clearAs(altName, id)).firstClear);
        const result = await clearAs(sandbox.account.name, id);
        assert.ok(result.firstClear);
        assert.ok(result.firstClear.rewards.every(reward => reward.kind !== 'title'));
        assert.equal((await clearAs(sandbox.account.name, id)).firstClear, null);
    }
});

test('클리어되지 않은 레이드에는 보상을 지급하지 않는다', async t => {
    const { room, user } = await prepareRoom(t);
    await party.__test.grantPartyQuestClearRewards(room);
    assert.equal(room.result, null);
    assert.equal((await rpg.getRPGUserByName(user.name)).gold, user.gold);
    room.members[0].potions = [];
});
