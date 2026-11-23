'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const accounts = require('../character_accounts');
const { createStore } = require('../character_store');
const usage = require('../point_usage');
const items = [{ name: '물약', type: '소모품' }, { name: '[이벤트]상자', type: '가챠' }, { name: '송편', type: '가챠' }];
const original = () => ({ id: 'original-id', name: '원래이름', code: 'login-code', level: 200, exp: 123,
    gold: 900, point: 5000, prestige: true, avatars: [{ id: 'avatar-1', name: '의상' }],
    main_card: { id: 0, type: '일반', star: 4 }, card_slot: [{ id: 0, type: '전직', star: 5 }, { id: 1, type: '일반', star: 4 }, { id: 1, type: '각성', star: 8 }],
    inventory: { card: [{ id: 2, star: 9, type: '일반', skin: '보존' }], equipment: [{ id: 3, uid: 'equip', soul: { value: 7 } }], pet: [], item: [{ id: 0, count: 20 }, { id: 1, count: 4 }, { id: 2, count: 8 }] },
    boundItems: { 0: 2, 1: 3 }, quests: { quest: 'accepted' }, paradiseWeekly: { bestFloor: 10 }, shopPurchases: { shop: { max: 1 } },
    unknownFutureCharacterField: { keep: true } });
const load = raw => {
    const user = structuredClone(raw);
    Object.defineProperty(user, '__loaded', { value: Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, JSON.stringify(value)])) });
    return user;
};

test('기존 사용자는 1번 캐릭터로 보존되고 공유 재화와 이벤트 아이템만 계정에 옮긴다', () => {
    const legacy = original(), untouched = structuredClone(legacy);
    const { account, character } = accounts.migrate(legacy, items);
    assert.deepEqual(legacy, untouched);
    assert.equal(character.id, legacy.id);
    assert.equal(character.characterNumber, 1);
    assert.equal(account.capacity, 6);
    assert.equal(account.activeCharacterId, legacy.id);
    assert.equal(account.gold, 900);
    assert.equal(character.gold, undefined);
    assert.deepEqual(account.items, [{ id: 1, count: 4 }, { id: 2, count: 8 }]);
    assert.deepEqual(character.inventory.item, [{ id: 0, count: 20 }]);
    for (const key of ['level', 'exp', 'avatars', 'quests', 'paradiseWeekly', 'unknownFutureCharacterField']) assert.deepEqual(character[key], legacy[key]);
    assert.deepEqual(character.inventory.equipment, legacy.inventory.equipment);
    assert.deepEqual(character.card_slot, []);
    assert.deepEqual(character.inventory.card, [...legacy.inventory.card, ...legacy.card_slot]);
    assert.deepEqual(accounts.hydrate(character, account).boundItems, legacy.boundItems);
});

test('기존 슬롯 카드 전부를 속성 그대로 반환하고 다시 실행해도 복제하지 않는다', () => {
    const user = original();
    user.card_slot.unshift({ ...user.main_card, marker: 'duplicate' });
    accounts.normalizeSlots(user);
    assert.equal(user.card_slot.length, 0);
    assert.equal(user.inventory.card.find(card => card.marker === 'duplicate').id, 0);
    const cards = structuredClone(user.inventory.card);
    accounts.normalizeSlots(user);
    assert.deepEqual(user.inventory.card, cards);
});

test('하루 골드 한도는 승인된 레벨 구간과 5레벨 단위를 따른다', () => {
    for (const [level, limit] of [[1, 20], [99, 20], [100, 40], [199, 40], [200, 80], [204, 80], [205, 85], [259, 135], [260, 150], [265, 160], [300, 230]]) {
        assert.equal(accounts.goldLimit(level), limit * 1e6, String(level));
    }
});

function fixture() {
    const { account, character } = accounts.migrate(original(), items);
    const records = new Map([account, character].map(raw => [raw.id, structuredClone(raw)]));
    const entries = new Map(), commands = [];
    const putEntry = raw => entries.set(raw.id, { raw: structuredClone(raw), dbSnap: Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, JSON.stringify(value)])), dirty: false });
    [account, character].forEach(putEntry);
    let reject = false;
    const client = { async send(command) {
        const input = command.input, type = command.constructor.name;
        commands.push(type);
        if (type === 'GetCommand') return { Item: structuredClone(records.get(input.Key.id)) };
        if (reject) throw new Error('isolated write failure');
        const operations = type === 'UpdateCommand' ? [{ Update: input }] : input.TransactItems;
        const staged = new Map([...records].map(([id, raw]) => [id, structuredClone(raw)]));
        for (const op of operations) {
            if (op.Put) { staged.set(op.Put.Item.id, structuredClone(op.Put.Item)); continue; }
            const update = op.Update, raw = staged.get(update.Key.id), values = update.ExpressionAttributeValues || {};
            for (const [alias, key] of Object.entries(update.ExpressionAttributeNames)) {
                const index = alias.slice(2);
                if (update.ConditionExpression.includes(alias + ' = :p' + index)) assert.deepEqual(raw[key], values[':p' + index]);
                else assert.equal(raw[key], undefined);
                if (Object.hasOwn(values, ':v' + index)) raw[key] = structuredClone(values[':v' + index]);
                else delete raw[key];
            }
        }
        records.clear(); staged.forEach((raw, id) => records.set(id, raw));
        return {};
    } };
    const store = createStore({ table: 'test-only', client, entries, putEntry, flush: async () => ({ success: true }),
        items: () => items, usage, deliver: () => {}, schedule: () => {} });
    return { store, records, entries, commands, account, character, reject: () => { reject = true; },
        user: () => load(store.hydrate(entries.get(character.id).raw)) };
}

test('공유 지갑만 바꾸면 트랜잭션 추가 비용 없이 조건부 쓰기 한 번만 한다', async () => {
    const f = fixture(), user = f.user();
    user.gold += 10;
    await f.store.commit([user]);
    assert.deepEqual(f.commands, ['UpdateCommand']);
    assert.equal(f.records.get(f.account.id).gold, 910);
    assert.equal(f.records.get(user.id).gold, undefined);
    await f.store.commit([user]);
    assert.equal(f.commands.length, 1, '변경 없는 저장은 DB를 호출하지 않는다');
});

test('계정과 캐릭터를 바꾸는 보상은 한 트랜잭션으로 저장한다', async () => {
    const f = fixture(), user = f.user();
    user.gold += 10; user.exp += 20;
    await f.store.commit([user]);
    assert.deepEqual(f.commands, ['TransactWriteCommand']);
    assert.equal(f.records.get(user.id).exp, 143);
    assert.equal(f.records.get(f.account.id).gold, 910);
});

test('반복 사냥 저장은 합쳐지고 전환 전 flush에서 계정과 캐릭터를 함께 확정한다', async () => {
    const f = fixture();
    for (let i = 0; i < 10; i++) {
        const user = f.user(); user.gold += 10; user.exp += 20;
        await f.store.commit([user], { defer: true });
    }
    assert.equal(f.commands.length, 0);
    assert.equal(f.user().gold, 1000);
    assert.equal(f.records.get(f.account.id).gold, 900);
    assert.equal((await f.store.flushGroup(f.account.id)).success, true);
    assert.deepEqual(f.commands, ['TransactWriteCommand']);
    assert.equal(f.records.get(f.account.id).gold, 1000);
    assert.equal(f.records.get(f.character.id).exp, 323);
});

test('오래된 화면의 지연 저장이 최신 공유 잔액을 덮어쓰지 못한다', async () => {
    const f = fixture(), old = f.user(), fresh = f.user();
    fresh.gold += 20; await f.store.commit([fresh], { defer: true });
    old.gold += 5;
    await assert.rejects(f.store.commit([old], { defer: true }), /변경/);
    assert.equal(f.user().gold, 920);
});

test('전송·보상 저장 실패 시 캐시와 DB에는 차감·지급이 모두 반영되지 않는다', async () => {
    const f = fixture(), user = f.user();
    const before = structuredClone([...f.records]);
    user.gold -= 100; user.inventory.card.pop();
    f.reject();
    await assert.rejects(f.store.commit([user]), /isolated write failure/);
    assert.deepEqual([...f.records], before);
    assert.equal(f.user().gold, 900);
    assert.equal(f.user().inventory.card.length, 4);
});

test('공용 상자를 열면 수량만 계정에서 줄고 결과 카드는 여는 캐릭터에 생긴다', async () => {
    const f = fixture(), user = f.user();
    user.inventory.item.find(item => item.id === 1).count--;
    user.inventory.card.push({ id: 3, star: 11, type: '각성' });
    await f.store.commit([user]);
    assert.equal(f.records.get(f.account.id).items.find(item => item.id === 1).count, 3);
    assert.equal(f.records.get(user.id).inventory.card.at(-1).star, 11);
    assert.equal(f.records.get(f.account.id).inventory, undefined);
});

test('부캐에서 쓴 포인트도 기존 계정 ID와 계정 이름으로 집계한다', () => {
    const user = { id: 'character:second', accountId: 'account:original-id', accountName: '원래이름', name: '새이름', point: 700 };
    usage.record(user, { amount: 300, category: 'character', action: 'rename', productName: '닉네임 변경권' });
    const event = usage.pending(user, 1000)[0];
    assert.equal(event.user_id, 'original-id');
    assert.equal(event.nickname, '원래이름');
    assert.equal(event.details.characterName, '새이름');
});

test('신규 티켓 등록은 기존 운영 설정과 인덱스를 보존하며 재실행해도 중복하지 않는다', () => {
    const { prepare } = require('../scripts/register_character_items');
    const before = { Item: [{ name: '기존 아이템', type: '재료', desc: '운영 설정' }], Shop: { 포인트: [], 패키지: [] } };
    const after = prepare(before);
    assert.deepEqual(after.Item[0], before.Item[0]);
    assert.equal(before.Item.length, 1);
    assert.equal(after.Item.length, 5);
    assert.equal(after.Shop.포인트.length, 1);
    assert.equal(after.Shop.포인트[0].price.amount, 300);
    after.Item[1].desc = '운영자가 수정'; after.Shop.포인트[0].price.amount = 123;
    assert.deepEqual(prepare(after), after);
    const itemsOnly = prepare(before, { itemsOnly: true });
    assert.equal(itemsOnly.Item.length, 5);
    assert.deepEqual(itemsOnly.Shop, before.Shop);
});
