'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const accounts = require('../character_accounts');
const { fromLegacy, getProgress } = require('../raid_reward_progress');
const { prepare, transaction } = require('../scripts/migrate_raid_reward_progress');
const fixture = () => ({
    account: { id: 'account:a', recordType: 'account', characterIds: ['second', 'first'], activeCharacterId: 'second',
        titles: ['hoduExtreme', 'mansionNightmare', 'other'],
        titleProgress: { hoduRewardWeek: '2026-11-23', hoduRewardCount: 2, butaRewardWeek: '2026-11-23',
            mansionRewardWeek: '2026-11-23', mansionNightmareFirst: true, mansionClears: 7, birthdayClaim: true }, gold: 123 },
    members: [
        { id: 'first', accountId: 'account:a', characterNumber: 1, inventory: { item: [{ id: 8, count: 2 }] } },
        { id: 'second', accountId: 'account:a', characterNumber: 2 }
    ]
});

test('공유 칭호와 기존 계정 기록을 보존하고 1번에만 보상 기록을 승계한다', () => {
    const { account, members } = fixture(), before = structuredClone({ account, members });
    const plan = prepare(account, members);
    assert.deepEqual({ account, members }, before);
    const first = plan.updates.find(update => update.id === 'first');
    assert.deepEqual(first.progress, { hoduRewardWeek: '2026-11-23', hoduRewardCount: 2, butaRewardWeek: '2026-11-23',
        mansionRewardWeek: '2026-11-23', mansionNightmareFirst: true, hoduExtremeFirst: true });
    assert.deepEqual(plan.updates.find(update => update.id === 'second').progress, {});
    for (const update of plan.updates) members.find(member => member.id === update.id).raidRewardProgress = update.progress;
    assert.equal(prepare(account, members), null, '재실행하면 새 보상 기록도 초기화하지 않는다');
    members[1].raidRewardProgress.hoduRewardCount = 3;
    assert.equal(prepare(account, members), null);
    assert.deepEqual(account, before.account);
});

test('캐릭터 소속, 원본 진행도, 신규 필드 부재를 조건으로 계정의 모든 이전을 함께 확정한다', () => {
    const { account, members } = fixture();
    const writes = transaction(prepare(account, members)).TransactItems;
    assert.equal(writes.length, 3);
    assert.deepEqual(writes[0].ConditionCheck.Key, { id: account.id });
    assert.deepEqual(writes[0].ConditionCheck.ExpressionAttributeValues[':titleProgress'], account.titleProgress);
    assert.deepEqual(writes[0].ConditionCheck.ExpressionAttributeValues[':titles'], account.titles);
    assert.deepEqual(writes[0].ConditionCheck.ExpressionAttributeValues[':ids'], account.characterIds);
    for (const { Update: input } of writes.slice(1)) {
        assert.match(input.ConditionExpression, /attribute_not_exists\(#k0\)/);
        assert.match(input.ConditionExpression, /#account = :account AND #number = :number/);
        assert.equal(input.ExpressionAttributeNames['#k0'], 'raidRewardProgress');
        assert.equal(input.ExpressionAttributeValues[':account'], account.id);
    }
    delete account.titles; delete account.titleProgress;
    const empty = transaction(prepare(account, members)).TransactItems[0].ConditionCheck;
    assert.match(empty.ConditionExpression, /attribute_not_exists\(#titleProgress\)/);
    assert.match(empty.ConditionExpression, /attribute_not_exists\(#titles\)/);
});

test('소속 불일치, 누락된 캐릭터, 1번 중복, 손상된 새 기록은 이전하지 않는다', () => {
    const { account, members } = fixture();
    assert.throws(() => prepare(account, members.slice(1)), /캐릭터/);
    assert.throws(() => prepare(account, members.map(member => ({ ...member, accountId: 'other' }))), /캐릭터/);
    assert.throws(() => prepare(account, members.map(member => ({ ...member, characterNumber: 1 }))), /1번/);
    for (const value of [null, [], 'broken']) {
        assert.throws(() => prepare(account, members.map(member => ({ ...member, raidRewardProgress: value }))), /올바르지/);
    }
});

test('아직 분리되지 않은 기존 사용자를 1번 캐릭터로 바꿀 때 보상 기록도 보존한다', () => {
    const source = { id: 'legacy', ...fixture().account, inventory: { item: [], card: [], equipment: [], pet: [] } };
    delete source.recordType; delete source.characterIds;
    const { account, character } = accounts.migrate(source, []);
    assert.deepEqual(character.raidRewardProgress, fromLegacy(source));
    assert.equal(account.raidRewardProgress, undefined);
    assert.deepEqual(account.titles, source.titles);
    assert.deepEqual(account.titleProgress, source.titleProgress);
    assert.deepEqual(accounts.hydrate(character, account).raidRewardProgress, character.raidRewardProgress);
});

test('부캐는 공유 기록을 참조하지 않고 이전 누락을 최초 보상 미수령으로 취급하지 않는다', () => {
    const source = fixture().account;
    const alt = { ...source, accountId: source.id, characterNumber: 2, raidRewardProgress: {} };
    assert.deepEqual(getProgress(alt), {});
    delete alt.raidRewardProgress;
    assert.throws(() => getProgress(alt), /이전이 필요/);
    const legacy = { titles: source.titles, titleProgress: source.titleProgress };
    assert.deepEqual(getProgress(legacy), fromLegacy(source));
    legacy.raidRewardProgress.hoduRewardCount = 3;
    assert.equal(source.titleProgress.hoduRewardCount, 2);
});
