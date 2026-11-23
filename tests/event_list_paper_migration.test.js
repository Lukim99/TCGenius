'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { prepare, transaction } = require('../scripts/migrate_event_list_paper');
const fixture = () => ({
    account: { id: 'account:a', name: '계정', recordType: 'account', characterIds: ['second', 'first'],
        activeCharacterId: 'second', gold: 1000, items: [{ id: 50, count: 3 }, { id: 8, count: 9 }], boundItems: { 50: 1, 8: 4 } },
    character: { id: 'first', accountId: 'account:a', characterNumber: 1, name: '첫캐릭터', level: 200,
        inventory: { card: [{ id: 7, star: 8 }], equipment: [{ uid: 'keep' }], pet: [], item: [{ id: 50, count: 2 }, { id: 1, count: 8 }] }, boundItems: { 50: 1, 1: 3 } }
});

test('기존 공유분과 귀속 수량을 1번 캐릭터에 합산하고 다른 자산은 보존하며 재실행은 변경이 없다', () => {
    const { account, character } = fixture(), before = structuredClone({ account, character });
    const plan = prepare(account, character, 50);
    assert.equal(plan.count, 3); assert.equal(plan.bound, 1);
    assert.deepEqual({ account, character }, before, '원본을 변경하지 않는다');
    const source = { ...account, ...plan.updates[0].changes }, target = { ...character, ...plan.updates[1].changes };
    assert.deepEqual(source, { ...account, items: [{ id: 8, count: 9 }], boundItems: { 8: 4 } });
    assert.deepEqual(target, { ...character, inventory: { ...character.inventory, item: [{ id: 50, count: 5 }, { id: 1, count: 8 }] }, boundItems: { 50: 2, 1: 3 } });
    assert.equal(prepare(source, target, 50), null);
    const writes = transaction(plan, 50).TransactItems;
    assert.equal(writes.length, 3);
    assert.equal(writes[0].ConditionCheck.ExpressionAttributeValues[':name'], '이벤트 리스트 종이');
    assert.deepEqual(writes.slice(1).map(write => write.Update.Key.id), [account.id, character.id]);
    for (const { Update: input } of writes.slice(1)) {
        assert.match(input.ConditionExpression, /#k0 = :p0/);
        assert.match(input.ConditionExpression, /#g0 = :g0 AND #g1 = :g1/);
    }
    assert.deepEqual(writes[1].Update.ExpressionAttributeValues[':g1'], account.characterIds);
    assert.equal(writes[2].Update.ExpressionAttributeValues[':g0'], account.id);
    assert.equal(writes[2].Update.ExpressionAttributeValues[':g1'], 1);
});

test('기존 종이가 없는 1번 캐릭터에 새 묶음을 만들되 없는 귀속 필드는 만들지 않는다', () => {
    const { account, character } = fixture();
    delete account.boundItems; delete character.boundItems;
    character.inventory.item = [{ id: 1, count: 8 }];
    const plan = prepare(account, character, 50);
    assert.deepEqual(plan.updates[1].changes.inventory.item, [{ id: 1, count: 8 }, { id: 50, count: 3 }]);
    assert.equal(plan.updates[0].changes.boundItems, undefined);
    assert.equal(plan.updates[1].changes.boundItems, undefined);
});

test('잘못된 대상과 손상된 수량은 쓰기 계획을 만들지 않는다', () => {
    const { account, character } = fixture();
    for (const replacement of [{ accountId: 'account:other' }, { characterNumber: 2 }, { id: 'outside' }]) {
        assert.throws(() => prepare(account, { ...character, ...replacement }, 50), /1번 캐릭터/);
    }
    for (const count of [-1, 1.5, '3', NaN]) {
        assert.throws(() => prepare({ ...account, items: [{ id: 50, count }] }, character, 50), /수량/);
    }
    assert.throws(() => prepare({ ...account, boundItems: { 50: 4 } }, character, 50), /귀속 수량/);
});
