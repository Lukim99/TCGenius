'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { prepare, names } = require('../scripts/init_november_content');
const { readShopCatalog } = require('../shop_catalog');

function fixture() {
    const data = Object.fromEntries(['Item', 'Bundle', 'Pack', 'Shop'].map(key => [key, JSON.parse(fs.readFileSync(path.join(__dirname, '../DB/RPGenius', key + '.json'), 'utf8'))]));
    const lockbox = data.Item.find(item => item?.name === '봉인된 자물쇠');
    ['[10월]각성보석세트', '[10월]조합성공률30%증가럭키카드'].forEach((name, index) => {
        data.Pack[lockbox.pack][index].item_id = data.Item.findIndex(item => item?.name === name);
    });
    return data;
}
const idOf = (data, name) => data.Item.findIndex(item => item?.name === name);

test('신규 구성과 판매 위치만 추가하고 운영 확률·수량·상품 ID를 보존한다', () => {
    const before = fixture(), original = structuredClone(before), after = prepare(before);
    assert.deepEqual(before, original);
    assert.deepEqual(after.Item.slice(0, before.Item.length), before.Item);
    assert.deepEqual(after.Bundle.slice(0, before.Bundle.length), before.Bundle);
    const cardId = idOf(after, names[0]), orbId = idOf(after, names[1]), ticketId = idOf(after, names[2]);
    assert.deepEqual(after.Bundle[after.Item[cardId].pack], [
        { type: '아이템', item_id: idOf(after, '7성 카드팩'), count: { min: 1, max: 1 } },
        { type: '아이템', item_id: idOf(after, '6성 카드팩'), count: { min: 3, max: 3 } }
    ]);
    const shop = after.Shop['가넷'], index = shop.findIndex(product => product.item_id === cardId);
    assert.equal(after.Item[shop[index - 1].item_id].name, '카드박스III');
    assert.deepEqual(shop[index].price, { goods: 'garnet', amount: 800 });
    assert.equal(shop[index].count, 1);
    assert.deepEqual(shop[index].limits, {});
    assert.match(shop[index].shopId, /^shop_[0-9a-f]{32}$/);
    const oldShops = structuredClone(after.Shop);
    oldShops['가넷'].splice(index, 1);
    assert.deepEqual(oldShops, readShopCatalog(before.Shop));
    const oldPacks = structuredClone(after.Pack.slice(0, before.Pack.length));
    const lockId = after.Item[idOf(after, '봉인된 자물쇠')].pack;
    assert.equal(oldPacks[lockId][0].item_id, orbId);
    assert.equal(oldPacks[lockId][1].item_id, ticketId);
    oldPacks[lockId][0].item_id = before.Pack[lockId][0].item_id;
    oldPacks[lockId][1].item_id = before.Pack[lockId][1].item_id;
    assert.deepEqual(oldPacks, before.Pack);
    assert.equal(after.Item[orbId].use, '보주상자');
    assert.equal(after.Item[orbId].sellPrice, 60000000);
    assert.equal(after.Item[ticketId].sellPrice, 30000000);
    assert.notEqual(after.Item[orbId].no_trade, true);
    assert.notEqual(after.Item[ticketId].no_trade, true);
    const rewards = after.Pack[after.Item[ticketId].pack];
    assert.deepEqual(rewards.map(entry => entry.roll), [0.5, 0.32, 0.084, 0.063, 0.019, 0.014]);
    assert.deepEqual(rewards.map(entry => after.Item[entry.item_id].ug), [0.05, 0.1, 0.3, 0.5, 0.7, 0.9].map(roll => ({ level: 11, roll })));
    assert.ok(rewards.every(entry => entry.count.min === 1 && entry.count.max === 1));
});

test('재실행은 운영자가 수정하거나 비워둔 신규 구성도 보존한다', () => {
    const after = prepare(fixture());
    assert.deepEqual(prepare(after), after);
    after.Bundle[after.Item[idOf(after, names[0])].pack] = [];
    after.Pack[after.Item[idOf(after, names[2])].pack] = [];
    after.Item[idOf(after, names[1])].sellPrice = 123;
    assert.deepEqual(prepare(after), after);
});

test('삽입으로 이동한 기존 상품의 구매 기록 주소를 유지한다', () => {
    const before = fixture();
    before.Shop['가넷'].forEach(product => { delete product.shopId; });
    const expected = readShopCatalog(before.Shop), after = prepare(before);
    assert.deepEqual(after.Shop['가넷'].filter(product => product.item_id !== idOf(after, names[0])), expected['가넷']);
});

test('누락된 구성품이나 모호한 월간 슬롯은 원본을 변경하지 않고 거부한다', () => {
    const before = fixture();
    before.Item[idOf(before, '90프로 +11 장비 강화권')] = null;
    const original = structuredClone(before);
    assert.throws(() => prepare(before), /운영 구성품이 없습니다/);
    assert.deepEqual(before, original);
    const duplicate = fixture(), pack = duplicate.Pack[duplicate.Item[idOf(duplicate, '봉인된 자물쇠')].pack];
    pack.push(structuredClone(pack[0]));
    assert.throws(() => prepare(duplicate), /이달의 아이템 슬롯/);
});

test('기존 게임 엔진으로 구매 비용과 11월 상자 실제 지급 결과를 확인한다', async () => {
    const data = prepare(fixture());
    const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
    // 환경 파일을 읽지 않는다. 실제 DB 호출/쓰기 없이 기존 엔진을 실행한다.
    const send = DynamoDBDocumentClient.prototype.send;
    DynamoDBDocumentClient.prototype.send = async command => {
        if (command.constructor.name === 'GetCommand') return { Item: { data: structuredClone(data[command.input.Key.key] ?? {}) } };
        if (command.constructor.name === 'ScanCommand') return { Items: [] };
        throw new Error('운영 DB 쓰기를 허용하지 않습니다: ' + command.constructor.name);
    };
    const random = Math.random;
    try {
        const rpg = require('../rpgenius');
        await rpg.initRpgeniusData();
        const user = new rpg.RPGUser('11월테스트', 'november-test-only');
        user.save = async () => {};
        user.garnet = 799;
        const cardId = idOf(data, names[0]), product = data.Shop['가넷'].find(entry => entry.item_id === cardId);
        assert.match(await rpg.purchaseShopItem(user, '가넷', product.shopId, 1), /재화가 부족/);
        assert.equal(user.garnet, 799);
        user.garnet = 800;
        assert.match(await rpg.purchaseShopItem(user, '가넷', product.shopId, 1), /구매 완료/);
        assert.equal(user.garnet, 0);
        assert.deepEqual(user.inventory.card.map(card => card.star).sort(), [5, 5, 5, 6]);
        assert.equal(rpg.getInventoryItemCount(user, cardId), 0);
        const orbId = idOf(data, names[1]);
        user.inventory.item = [{ id: orbId, count: 1 }];
        Math.random = () => 0;
        assert.match(await rpg.useItem(user, names[1], 1), /획득 결과/);
        assert.equal(rpg.getInventoryItemCount(user, orbId), 0);
        const orb = user.inventory.item.find(entry => data.Item[entry.id]?.use === '보주');
        assert.equal(orb.count, 1);
        const ticketId = idOf(data, names[2]), rewards = data.Pack[data.Item[ticketId].pack];
        let start = 0;
        for (const reward of rewards) {
            user.inventory.item = [{ id: ticketId, count: 1 }];
            const draw = start + reward.roll / 2;
            Math.random = () => draw;
            assert.match(await rpg.useItem(user, names[2], 1), /획득 결과/);
            assert.deepEqual(user.inventory.item, [{ id: reward.item_id, count: 1 }]);
            start += reward.roll;
        }
        const keyId = idOf(data, '지니어스의 열쇠');
        for (const [draw, monthlyId] of [[0.001, orbId], [0.006, ticketId]]) {
            user.inventory.item = [{ id: keyId, count: 3 }];
            Math.random = () => draw;
            const result = rpg.openSealedLockbox(user, 1);
            assert.equal(result.error, undefined);
            assert.equal(result.opens.length, 1);
            assert.equal(rpg.getInventoryItemCount(user, keyId), 0);
            assert.equal(rpg.getInventoryItemCount(user, monthlyId), 2);
        }
    } finally {
        Math.random = random;
        DynamoDBDocumentClient.prototype.send = send;
    }
});
