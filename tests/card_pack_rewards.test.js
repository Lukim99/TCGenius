'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const AWS = require('aws-sdk');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');

// 기존 게임/HTTP 서버를 실행하고 외부 저장소만 메모리로 대체한다. 환경 파일은 읽지 않는다.
const read = key => {
    const file = path.join(__dirname, '../DB/RPGenius', key + '.json');
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
};
const seed = { id: 'card-reward-http', name: '즉시카드HTTP', code: 'CARD-TEST-ONLY', _get: 1,
    avatarMigrated: true, logged_in: [], logged_in_agent: [], need_character_card_select: false };
const mail = new Map();
const writes = [];
AWS.S3.prototype.makeRequest = operation => {
    if (operation === 'listObjectsV2') return { promise: async () => ({ Contents: [] }) };
    throw new Error('Unexpected isolated S3 operation: ' + operation);
};
DynamoDBDocumentClient.prototype.send = async command => {
    const input = command.input;
    if (command.constructor.name === 'GetCommand') {
        if (input.TableName === 'rpgenius_data') return { Item: { key: input.Key.key, data: read(input.Key.key) } };
        if (input.TableName === 'rpgenius_mail') return { Item: mail.get(input.Key.id) };
        return {};
    }
    if (command.constructor.name === 'ScanCommand') return { Items: input.TableName === 'rpgenius_user' ? [structuredClone(seed)] : [] };
    if (['PutCommand', 'UpdateCommand', 'TransactWriteCommand', 'DeleteCommand'].includes(command.constructor.name)) {
        writes.push(structuredClone(input)); return {};
    }
    throw new Error('Unexpected isolated DB command: ' + command.constructor.name);
};
const rpg = require('../rpgenius');
const party = require('../partyquest').__test;
const pvp = require('../pvp');
const startServer = require('../server');
let sequence = 0, server, base, cookie;
const itemId = name => rpg.getDataCache('Item').findIndex(item => item?.name === name);
function user(limit = 52) {
    const value = new rpg.RPGUser('즉시카드' + ++sequence, 'card-reward-' + sequence);
    value.avatarMigrated = true; value.maxCardLimit = limit;
    value.main_card = { id: 0, star: 6, type: '일반' }; value.need_character_card_select = false;
    value.hp = value.mp = 1000000000;
    return value;
}
async function fixed(value, run) {
    const original = Math.random; Math.random = () => value;
    try { return await run(); } finally { Math.random = original; }
}
async function post(endpoint, body) {
    const response = await fetch(base + endpoint, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
}
before(async () => {
    await rpg.initRpgeniusData();
    process.env.PORT = '0'; server = startServer();
    await new Promise(resolve => server.on('listening', resolve));
    base = 'http://127.0.0.1:' + server.address().port;
    const response = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: seed.name, code: seed.code }) });
    assert.equal(response.status, 200); cookie = response.headers.get('set-cookie').split(';')[0];
});
after(() => new Promise(resolve => server.close(resolve)));

test('일반·전직 카드팩은 운영 등급과 수량대로 즉시 카드가 되고 초과분은 버린다', async () => {
    for (const [name, type, star] of [['8성 카드팩', '일반', 7], ['9성 전직 카드팩', '전직', 8]]) {
        const value = user(2), id = itemId(name);
        const result = await fixed(0, () => rpg.grantItemReward(value, id, 5));
        assert.equal(result.converted, true); assert.equal(result.discarded, 3);
        assert.equal(value.inventory.card.length, 2);
        assert.ok(value.inventory.card.every(card => card.type === type && card.star === star));
        assert.equal(rpg.getInventoryItemCount(value, id), 0);
        assert.match(rpg.formatItemReward(result).join('\n'), /버려진.*x3/);
    }
});

test('카드팩 상자·카드박스·특정 캐릭터 팩을 재귀적으로 개봉하고 일반 상자는 보존한다', async () => {
    const packsBefore = structuredClone(rpg.getDataCache('Pack'));
    const bundlesBefore = structuredClone(rpg.getDataCache('Bundle'));
    for (const name of ['카드팩 상자', '카드박스I', '딜러장 카드팩', '[6월]패션 카드팩']) {
        const value = user(), id = itemId(name);
        const result = await fixed(0, () => rpg.grantItemReward(value, id, 1));
        assert.equal(result.converted, true, name);
        assert.ok(value.inventory.card.length > 0, name);
        assert.equal(value.inventory.item.length, 0, name);
    }
    const ordinary = user(), id = itemId('엘리트 토벌 상자');
    assert.equal(rpg.grantItemReward(ordinary, id, 1).converted, false);
    assert.equal(rpg.getInventoryItemCount(ordinary, id), 1);
    assert.deepEqual(rpg.getDataCache('Pack'), packsBefore);
    assert.deepEqual(rpg.getDataCache('Bundle'), bundlesBefore);
});

test('운영자가 지정한 중첩 구성·추첨 횟수·전직 등급을 그대로 사용한다', async () => {
    const items = rpg.getDataCache('Item'), packs = rpg.getDataCache('Pack'), bundles = rpg.getDataCache('Bundle');
    const job = items.push({ name: '운영 전직 카드팩', type: '가챠', pack: { type: '전직 캐릭터 카드팩', range: { min: 6, max: 6 } } }) - 1;
    const pack = packs.push([{ type: '아이템', item_id: job, count: 2, roll: 1 }]) - 1;
    const wrapper = items.push({ name: '운영 추첨', type: '가챠', pack, num: 3 }) - 1;
    const bundle = bundles.push([{ type: '아이템', item_id: wrapper, count: 2 }]) - 1;
    const container = items.push({ name: '운영 카드 꾸러미', type: '번들', pack: bundle }) - 1;
    const value = user(7);
    const result = await fixed(0, () => rpg.grantItemReward(value, container, 1));
    assert.equal(value.inventory.card.length, 7); assert.equal(result.discarded, 5);
    assert.ok(value.inventory.card.every(card => card.type === '전직' && card.star === 5));
    assert.equal(value.inventory.item.length, 0);
});

test('카드팩 4개 사용 시 3칸에 들어가는 3개만 소비하고 1개는 남긴다', async () => {
    for (const name of ['5성 카드팩', '9성 전직 카드팩', '카드팩 상자', '딜러장 카드팩', '[6월]패션 카드팩']) {
        const value = user(5), id = itemId(name);
        value.inventory.card.push({ id: 0, star: 0, type: '일반' }, { id: 1, star: 0, type: '일반' });
        rpg.addInventoryItem(value, id, 4);
        const message = await fixed(0, () => rpg.useItem(value, name, 4));
        assert.equal(value.inventory.card.length, 5, name);
        assert.equal(rpg.getInventoryItemCount(value, id), 1, name);
        assert.match(message, /x3 사용/);
        assert.match(message, /공간.*부족/);
        assert.doesNotMatch(message, /버려진/);
    }
});

test('카드 공간이 없으면 카드팩을 보존한다', async () => {
    const value = user(1), id = itemId('5성 카드팩');
    value.inventory.card.push({ id: 0, star: 0, type: '일반' });
    rpg.addInventoryItem(value, id, 4);
    const before = structuredClone(value.inventory);
    assert.match(await rpg.useItem(value, '5성 카드팩', 4), /^❌.*공간.*부족/);
    assert.deepEqual(value.inventory, before);
});

test('중첩 카드 꾸러미는 한 개의 전체 보상이 들어갈 때만 사용하고 실제 사용분의 재료만 소비한다', async () => {
    const items = rpg.getDataCache('Item'), packs = rpg.getDataCache('Pack'), bundles = rpg.getDataCache('Bundle');
    const material = itemId('강화석');
    const pack = packs.push([{ type: '아이템', item_id: itemId('5성 카드팩'), count: 1, roll: 1 }]) - 1;
    const wrapper = items.push({ name: '공간 검증 중첩 팩', type: '가챠', pack, num: 2 }) - 1;
    const bundle = bundles.push([{ type: '골드', count: 17 }, { type: '아이템', item_id: wrapper, count: 1 }]) - 1;
    const id = items.push({ name: '공간 검증 꾸러미', type: '번들', pack: bundle, require: [{ id: material, count: 2 }] }) - 1;
    const value = user(3), gold = value.gold;
    rpg.addInventoryItem(value, id, 2); rpg.addInventoryItem(value, material, 2);
    const message = await fixed(0, () => rpg.useItem(value, items[id].name, 2));
    assert.match(message, /x1 사용/);
    assert.equal(value.inventory.card.length, 2);
    assert.equal(rpg.getInventoryItemCount(value, id), 1);
    assert.equal(rpg.getInventoryItemCount(value, material), 0);
    assert.equal(value.gold, gold + 17);
    const before = structuredClone(value.inventory), goldBefore = value.gold;
    assert.match(await fixed(0, () => rpg.useItem(value, items[id].name, 1)), /^❌.*공간.*부족/);
    assert.deepEqual(value.inventory, before); assert.equal(value.gold, goldBefore);
});

test('랜덤 카드 수량은 실제 추첨 결과로 공간을 확인하고 다시 추첨하지 않는다', async () => {
    const items = rpg.getDataCache('Item'), packs = rpg.getDataCache('Pack');
    const pack = packs.push([{ type: '캐릭터카드', card_id: 0, star: 4, count: { min: 1, max: 3 }, roll: 1 }]) - 1;
    const id = items.push({ name: '공간 검증 랜덤 팩', type: '가챠', pack }) - 1;
    const value = user(3);
    rpg.addInventoryItem(value, id, 4);
    assert.match(await fixed(0, () => rpg.useItem(value, items[id].name, 4)), /x3 사용/);
    assert.equal(value.inventory.card.length, 3);
    assert.equal(rpg.getInventoryItemCount(value, id), 1);
    const crowded = user(2); rpg.addInventoryItem(crowded, id, 1);
    assert.match(await fixed(.999, () => rpg.useItem(crowded, items[id].name, 1)), /^❌.*공간.*부족/);
    assert.equal(crowded.inventory.card.length, 0);
    assert.equal(rpg.getInventoryItemCount(crowded, id), 1);
});

test('혼합 가챠는 확정된 수량을 지급하고 공간을 초과하는 회차부터 남긴다', async () => {
    const items = rpg.getDataCache('Item'), packs = rpg.getDataCache('Pack'), material = itemId('강화석');
    const pack = packs.push([{ type: '아이템', item_id: material, count: { min: 2, max: 4 }, roll: .5 },
        { type: '캐릭터카드', card_id: 0, star: 4, count: 1, roll: .5 }]) - 1;
    const id = items.push({ name: '공간 검증 혼합 가챠', type: '가챠', pack }) - 1;
    const value = user(1); value.inventory.card.push({ id: 1, star: 0, type: '일반' });
    rpg.addInventoryItem(value, id, 2);
    const original = Math.random, rolls = [.1, .5, .9]; let draws = 0;
    Math.random = () => { assert.ok(draws < rolls.length, '지급 시 다시 추첨하지 않는다'); return rolls[draws++]; };
    let message;
    try { message = await rpg.useItem(value, items[id].name, 2); }
    finally { Math.random = original; }
    assert.match(message, /x1 사용/); assert.equal(draws, 3);
    assert.equal(rpg.getInventoryItemCount(value, id), 1);
    assert.equal(rpg.getInventoryItemCount(value, material), 3);
    assert.equal(value.inventory.card.length, 1);
});

test('공간이 충분하면 요청한 카드팩을 모두 사용하고 카드가 없는 꾸러미는 가득 차도 사용한다', async () => {
    const value = user(3), id = itemId('5성 카드팩');
    rpg.addInventoryItem(value, id, 3);
    const message = await rpg.useItem(value, '5성 카드팩', 3);
    assert.match(message, /x3 사용/); assert.doesNotMatch(message, /공간.*부족/);
    assert.equal(value.inventory.card.length, 3); assert.equal(rpg.getInventoryItemCount(value, id), 0);
    const items = rpg.getDataCache('Item'), bundles = rpg.getDataCache('Bundle');
    const bundle = bundles.push([{ type: '골드', count: 7 }]) - 1;
    const ordinary = items.push({ name: '공간 검증 일반 꾸러미', type: '번들', pack: bundle }) - 1;
    const gold = value.gold;
    rpg.addInventoryItem(value, ordinary, 2);
    assert.match(await rpg.useItem(value, items[ordinary].name, 2), /x2 사용/);
    assert.equal(value.gold, gold + 14); assert.equal(rpg.getInventoryItemCount(value, ordinary), 0);
});

test('명령어 선택권은 카드 공간이 부족하면 반환하고 공간 확보 후 정상 사용한다', async () => {
    const items = rpg.getDataCache('Item');
    const id = items.push({ name: '공간 검증 명령어 선택권', type: '사용', use: '아이템선택', choices: [{ id: itemId('9성 카드팩'), count: 2 }] }) - 1;
    const value = user(1);
    rpg.addInventoryItem(value, id, 1);
    assert.match(await rpg.useItem(value, items[id].name, 1), /^✅/);
    assert.match(await rpg.resolveWebItemUsePending(value, 1), /^❌.*공간.*부족/);
    assert.equal(value.inventory.card.length, 0); assert.equal(rpg.getInventoryItemCount(value, id), 1);
    assert.equal(value.pendingAction, null);
    value.maxCardLimit = 2;
    await rpg.useItem(value, items[id].name, 1);
    assert.match(await rpg.resolveWebItemUsePending(value, 1), /^✅/);
    assert.equal(value.inventory.card.length, 2); assert.equal(rpg.getInventoryItemCount(value, id), 0);
});

test('꾸러미·가챠 보상은 다른 구성품을 보존하고 카드팩만 즉시 지급한다', async () => {
    const value = user(1), summary = {};
    rpg.grantPackReward(value, { type: '아이템', item_id: itemId('5성 카드팩'), count: 3 }, summary);
    rpg.grantPackReward(value, { type: '아이템', item_id: itemId('강화석'), count: 17 }, summary);
    assert.equal(value.inventory.card.length, 1); assert.equal(summary.discardedCard.count, 2);
    assert.equal(rpg.getInventoryItemCount(value, itemId('강화석')), 17);
});

test('낚시는 카드팩을 살림망에 쌓지 않고 즉시 카드로 지급·초과 폐기한다', () => {
    const value = user(1);
    rpg.addFishingReward(value, itemId('6성 카드팩'));
    rpg.addFishingReward(value, itemId('6성 카드팩'));
    assert.equal(value.inventory.card.length, 1);
    assert.equal(value.fishingCards.length, 0);
    assert.equal(value.fishingNet[itemId('6성 카드팩')], undefined);
});

test('사냥과 일일 던전에서 카드팩을 남기지 않고 실제 카드를 지급한다', async () => {
    const value = user(), dungeon = rpg.getRegularFieldDungeons()[0];
    value.level = dungeon.requireLevel; value.field = { name: dungeon.name, killCount: 0, nextActionAt: 0, skillCooldowns: {}, equipmentState: {} };
    await fixed(0, () => rpg.buildHuntResult(value, dungeon, dungeon.hp * 2, { precalculatedDamage: true, disableEquipmentBonusDamage: true }));
    assert.equal(rpg.getInventoryItemCount(value, itemId('카드팩 상자')), 0);
    assert.ok(value.inventory.card.length > 0);
    const daily = user(1); daily.level = 101;
    daily.field = { name: '마동', dailyDungeon: true, killCount: 5000 };
    const result = rpg.grantDailyDungeonClearReward(daily, rpg.findDailyDungeonByName('마동'), {}, {}, {}, () => 0);
    assert.equal(daily.inventory.card.length, 1);
    assert.equal(rpg.getInventoryItemCount(daily, itemId('5성 카드팩')), 0);
    assert.match(result.text, /버려진.*x1/);
});

test('레이드 아이템 보상은 기존 팩 이미지와 실제 카드·버림 수량을 반환한다', () => {
    const value = user(1), summary = {};
    const result = party.grantPartyQuestPackReward(value, { type: '아이템', item_id: itemId('8성 전직 카드팩'), count: 3 }, summary);
    assert.equal(result.kind, 'card'); assert.equal(result.discarded, 2);
    assert.equal(value.inventory.card.length, 1); assert.equal(summary.discardedCard.count, 2);
    assert.ok(result.iconUrl);
});

test('PVP 카드팩 상자 당첨은 실제 카드가 되고 가득 찼으면 버림 결과를 반환한다', async () => {
    const value = user(1);
    for (let i = 0; i < 2; i++) {
        const battle = { phase: 'fighting', opponent: seed.name, opp: { rating: 1000, userId: seed.id }, me: { name: value.name } };
        await fixed(0, () => pvp.finishBattle(value, battle, 'win', '검증', Date.now()));
        assert.equal(battle.result.reward.kind, 'card');
        assert.equal(battle.result.reward.discarded, i);
    }
    assert.equal(value.inventory.card.length, 1);
    assert.equal(rpg.getInventoryItemCount(value, itemId('카드팩 상자')), 0);
});

test('퀘스트 카드팩 보상은 공간 초과분을 버리고 완료 기록으로 중복을 막는다', () => {
    const value = user(1);
    const id = 900001;
    rpg.getDataCache('Quest').push({ id, name: '즉시 카드 검증', enabled: true, minLevel: 1, maxLevel: 300,
        categories: ['일반'], unlock: { type: 'always' }, objectives: [], rewards: [{ type: '아이템', item_id: itemId('6성 카드팩'), count: 3 }] });
    const result = rpg.claimQuestReward(value, id);
    assert.equal(value.inventory.card.length, 1); assert.equal(result.rewardSummary.discardedCard.count, 2);
    const inventory = structuredClone(value.inventory);
    assert.ok(rpg.claimQuestReward(value, id).error);
    assert.deepEqual(value.inventory, inventory);
});

test('일반 상점 카드박스 구매는 즉시 카드 지급·초과 폐기 후 가격을 소비한다', async () => {
    const value = user(1); value.garnet = 10000;
    const shop = rpg.getDataCache('Shop')['가넷'];
    const index = shop.findIndex(entry => entry.item_id === itemId('카드박스I'));
    assert.ok(index >= 0);
    const cost = shop[index].price.amount, result = {};
    const message = await rpg.purchaseShopItem(value, '가넷', index + 1, 1, result);
    assert.match(message, /^✅/); assert.equal(value.garnet, 10000 - cost);
    assert.equal(value.inventory.card.length, 1); assert.equal(result.bundleGranted.discardedCard.count, 3);
    assert.equal(rpg.getInventoryItemCount(value, itemId('카드박스I')), 0);
});

test('쿠폰과 우편 수령은 공간이 없어도 보상을 소비하며 재수령하지 않는다', async () => {
    const value = user(1); value.inventory.card.push({ id: 0, star: 0, type: '일반' });
    rpg.getDataCache('Coupon').push({ code: 'CARD-REWARD-TEST', reward: [{ type: '아이템', item_id: itemId('9성 카드팩'), count: 2 }] });
    assert.match(await rpg.useCoupon(value, 'CARD-REWARD-TEST'), /버려진.*x2/);
    assert.match(await rpg.useCoupon(value, 'CARD-REWARD-TEST'), /이미 사용/);
    mail.set('card-mail-test', { id: 'card-mail-test', gifts: [{ type: 'item', id: itemId('9성 카드팩'), count: 3 }] });
    value.mail = [{ id: 'card-mail-test' }];
    const claim = await rpg.claimMailGifts(value, 'card-mail-test');
    assert.equal(claim.ok, true); assert.match(claim.lines.join('\n'), /버려진.*x3/);
    assert.match((await rpg.claimMailGifts(value, 'card-mail-test')).error, /이미/);
    assert.equal(value.inventory.card.length, 1);
});

test('웹 카드팩 사용은 들어가는 수량만 소비하고 가득 차면 남은 아이템을 보존한다', async () => {
    const value = await rpg.getRPGUserByName(seed.name), id = itemId('9성 카드팩');
    value.maxCardLimit = 3; value.inventory = { card: [], item: [], equipment: [], pet: [] };
    rpg.addInventoryItem(value, id, 4); await value.save();
    const result = await post('/api/inventory/items/' + id + '/use', { count: 4 });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.equal(result.data.remainingCount, 1);
    assert.equal((await rpg.getRPGUserByName(seed.name)).inventory.card.length, 3);
    assert.equal((await post('/api/inventory/items/' + id + '/use', { count: 1 })).status, 400);
    assert.equal(rpg.getInventoryItemCount(await rpg.getRPGUserByName(seed.name), id), 1);
});

test('웹 선택권은 공간 부족 시 보존하고 공간 확보 후 같은 개봉 번호로 한 번만 지급한다', async () => {
    const value = await rpg.getRPGUserByName(seed.name);
    value.maxCardLimit = 1; value.inventory = { card: [], item: [], equipment: [], pet: [] }; value.itemChoiceState = {};
    const items = rpg.getDataCache('Item');
    const pouch = items.push({ name: '즉시 카드 선택권', type: '사용', use: '아이템선택', choices: [{ id: itemId('9성 카드팩'), count: 3 }] }) - 1;
    rpg.addInventoryItem(value, pouch, 1); await value.save();
    const body = { itemId: itemId('9성 카드팩'), version: 0 };
    const blocked = await post('/api/inventory/items/' + pouch + '/choose', body);
    assert.equal(blocked.status, 400);
    assert.match(blocked.data.error, /공간.*부족/);
    assert.equal(value.inventory.card.length, 0);
    assert.equal(rpg.getInventoryItemCount(value, pouch), 1);
    assert.deepEqual(value.itemChoiceState, {});
    value.maxCardLimit = 3; await value.save();
    const first = await post('/api/inventory/items/' + pouch + '/choose', body);
    assert.equal(first.status, 200); assert.equal(first.data.reward.discarded, 0);
    const replay = await post('/api/inventory/items/' + pouch + '/choose', body);
    assert.deepEqual(replay.data.reward, first.data.reward);
    const after = await rpg.getRPGUserByName(seed.name);
    assert.equal(after.inventory.card.length, 3); assert.equal(rpg.getInventoryItemCount(after, pouch), 0);
    assert.equal(rpg.getInventoryItemCount(after, body.itemId), 0);
});

test('레벨 보상 HTTP 수령은 카드로 지급하며 수령 기록으로 중복을 막는다', async () => {
    const value = await rpg.getRPGUserByName(seed.name);
    value.level = 10; value.maxCardLimit = 2; value.claimedLevelRewards = [];
    value.inventory = { card: [], item: [], equipment: [], pet: [] }; await value.save();
    const result = await post('/api/levelreward', { level: 10 });
    assert.equal(result.status, 200); assert.equal(result.data.discardedCards, 1);
    const after = await rpg.getRPGUserByName(seed.name);
    assert.equal(after.inventory.card.length, 2);
    assert.equal(rpg.getInventoryItemCount(after, itemId('5성 카드팩')), 0);
    assert.equal((await post('/api/levelreward', { level: 10 })).status, 400);
});

test('반환용 원시 인벤토리 추가는 기존 카드팩을 자동 개봉하지 않는다', () => {
    const value = user(), id = itemId('9성 카드팩');
    rpg.addInventoryItem(value, id, 4);
    assert.equal(value.inventory.card.length, 0); assert.equal(rpg.getInventoryItemCount(value, id), 4);
    assert.ok(writes.length > 0);
});

async function resetWebCards(cards = [], extra = {}) {
    const value = await rpg.getRPGUserByName(seed.name);
    Object.assign(value, { maxCardLimit: 52, garnet: 5000, gold: 10000000, field: null, pendingAction: null, pendingFragment: null,
        bulkCombineReceipt: null, cardInventoryReceipt: null, inventory: { card: cards, item: [], equipment: [], pet: [] } }, extra);
    await value.save();
    return value;
}

test('실제 필드 공격 API는 카드팩 상자 대신 카드 보상을 표시하고 한도 초과 시 상자도 남기지 않는다', async () => {
    const dungeon = rpg.getRegularFieldDungeons()[0];
    for (const full of [false, true]) {
        await resetWebCards(full ? [{ id: 0, star: 0, type: '일반' }] : [], { maxCardLimit: 1,
            level: dungeon.requireLevel, main_card: { id: 0, star: 11, type: '일반' }, hp: 1000000, mp: 1000000,
            field: { name: dungeon.name, killCount: 0, nextActionAt: 0, skillCooldowns: {}, equipmentState: {} } });
        const result = await fixed(0, () => post('/api/field/attack', {}));
        assert.equal(result.status, 200); assert.equal(result.data.ok, true, result.data.message);
        assert.ok(!result.data.event.rewards.some(reward => reward.name === '카드팩 상자'));
        if (!full) assert.ok(result.data.event.rewards.some(reward => reward.kind === 'card' && reward.card && reward.iconUrl?.includes('square=1')));
        else assert.match(result.data.message, /버려진.*x1/);
        const after = await rpg.getRPGUserByName(seed.name);
        assert.equal(after.inventory.card.length, 1); assert.equal(rpg.getInventoryItemCount(after, itemId('카드팩 상자')), 0);
    }
});

test('웹 인벤토리는 세로 카드와 정사각형 아이콘을 제공하고 삽니다 목록·이미지 API도 아이콘을 사용한다', async () => {
    await resetWebCards([{ id: 0, star: 10, type: '각성' }]);
    const get = async endpoint => fetch(base + endpoint, { headers: { Cookie: cookie } });
    const inventory = await (await get('/api/inventory/cards')).json();
    assert.ok(!inventory.cards[0].imageUrl.includes('square=1'));
    assert.match(inventory.cards[0].iconUrl, /square=1/);
    const lookups = await (await get('/api/buyorder/lookups')).json();
    assert.ok(lookups.cards.every(card => card.imageUrl.includes('square=1')));
    const response = await get(inventory.cards[0].iconUrl);
    assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /image\/png/);
    const image = require('../card_composite').decodePng(Buffer.from(await response.arrayBuffer()));
    assert.equal(image.width, 800); assert.equal(image.height, 800);
});

test('자물쇠 개봉은 카드 보상 식별자·아이콘을 보존하고 초과 폐기는 획득 카드로 표시하지 않는다', async () => {
    const lock = rpg.getDataCache('Item')[itemId('봉인된 자물쇠')], packs = rpg.getDataCache('Pack');
    const previous = packs[lock.pack], num = lock.num;
    packs[lock.pack] = [{ type: '아이템', item_id: itemId('9성 카드팩'), count: 1, roll: 1 }];
    lock.num = 2;
    try {
        for (const count of [1, 10]) {
            const value = await resetWebCards([], { maxCardLimit: 1 });
            for (const req of lock.require || []) rpg.addInventoryItem(value, req.id, req.count * count);
            await value.save();
            const result = await post('/api/inventory/use-lockbox', { count });
            assert.equal(result.status, 200); assert.equal(result.data.opens.length, count);
            const rewards = result.data.opens.flatMap(open => [...open.main, ...open.bonus]);
            assert.equal(rewards.filter(reward => reward.type === 'card').length, 1);
            assert.match(rewards[0].iconUrl, /square=1/);
            assert.equal(rewards[0].frameUrl, null);
            assert.equal(rewards.filter(reward => reward.type === 'discardedCard').length, count * 2 - 1);
            assert.ok(rewards.filter(reward => reward.type === 'discardedCard').every(reward => !reward.iconUrl));
        }
    } finally { packs[lock.pack] = previous; lock.num = num; }
});

test('카드 인벤토리는 51/52를 반환하며 8칸씩 31회 확장하고 비용 10~310가넷을 한 번씩만 차감한다', async () => {
    await resetWebCards(Array.from({ length: 51 }, () => ({ id: 0, star: 0 })), { garnet: 4960 });
    const inventory = await (await fetch(base + '/api/inventory/cards', { headers: { Cookie: cookie } })).json();
    assert.equal(inventory.capacity.used, 51); assert.equal(inventory.capacity.limit, 52); assert.equal(inventory.capacity.nextCost, 10);
    for (let step = 0; step < 31; step++) {
        const body = { requestId: 'expand-inventory-' + step, limit: 52 + 8 * step };
        const result = await post('/api/inventory/cards/expand', body);
        assert.equal(result.status, 200, JSON.stringify(result.data));
        assert.equal(result.data.expansion.cost, (step + 1) * 10); assert.equal(result.data.capacity.limit, 60 + 8 * step);
        const replay = await post('/api/inventory/cards/expand', body);
        assert.equal(replay.status, 200); assert.deepEqual(replay.data.expansion, result.data.expansion);
    }
    const after = await rpg.getRPGUserByName(seed.name);
    assert.equal(after.maxCardLimit, 300); assert.equal(after.garnet, 0); assert.equal(after.inventory.card.length, 51);
    assert.equal((await post('/api/inventory/cards/expand', { requestId: 'expand-over-limit-31', limit: 300 })).status, 400);
});

test('확장은 가넷 부족·오래된 한도·동시 요청·저장 실패 재시도에서 중복 차감하지 않는다', async () => {
    await resetWebCards([], { garnet: 9 });
    assert.equal((await post('/api/inventory/cards/expand', { requestId: 'expand-no-money-00', limit: 52 })).status, 400);
    await resetWebCards();
    const body = { requestId: 'expand-concurrent-00', limit: 52 };
    const results = await Promise.all([post('/api/inventory/cards/expand', body), post('/api/inventory/cards/expand', body)]);
    assert.ok(results.some(result => result.status === 200));
    assert.equal((await rpg.getRPGUserByName(seed.name)).garnet, 4990);
    assert.equal((await post('/api/inventory/cards/expand', { requestId: 'expand-stale-limit-00', limit: 52 })).status, 409);
    await resetWebCards();
    const original = DynamoDBDocumentClient.prototype.send;
    let fail = true;
    DynamoDBDocumentClient.prototype.send = async function(command) {
        if (fail && command.constructor.name === 'UpdateCommand' && command.input.TableName === 'rpgenius_user') { fail = false; throw new Error('isolated save failure'); }
        return original.call(this, command);
    };
    try {
        const request = { requestId: 'expand-save-retry-00', limit: 52 };
        assert.equal((await post('/api/inventory/cards/expand', request)).status, 503);
        assert.equal((await post('/api/inventory/cards/expand', request)).status, 200);
        const after = await rpg.getRPGUserByName(seed.name);
        assert.equal(after.maxCardLimit, 60); assert.equal(after.garnet, 4990);
    } finally { DynamoDBDocumentClient.prototype.send = original; }
});

test('일괄 조합은 선택 성급·종류만 처음 카드 3장씩 처리하고 잠금·나머지 카드와 보조 아이템을 보존한다', async () => {
    const cards = [...Array.from({ length: 7 }, (_, id) => ({ id: id % 3, star: 4, type: '일반' })),
        { id: 0, star: 4, type: '일반', locked: true }, { id: 1, star: 4, type: '전직' }, { id: 0, star: 5, type: '일반' }];
    const value = await resetWebCards(cards);
    const items = rpg.getDataCache('Item');
    value.inventory.item = [items.findIndex(item => item?.protect?.star === 4), items.findIndex(item => Number(item?.lucky) > 0)].filter(id => id >= 0).map(id => ({ id, count: 1 }));
    const savedItems = structuredClone(value.inventory.item); await value.save();
    const meta = await (await fetch(base + '/api/combine/cards', { headers: { Cookie: cookie } })).json();
    const body = { requestId: 'bulk-combine-first-00', revision: meta.meta.bulkRevision, version: meta.cards[0].version, star: 4, cardType: '일반' };
    const result = await fixed(0, () => post('/api/combine/bulk', body));
    assert.equal(result.status, 200, JSON.stringify(result.data)); assert.equal(result.data.times, 2);
    assert.equal(result.data.spentGold, rpg.getCardCombineInfo(4).gold * 2);
    assert.ok(result.data.results.every(entry => entry.success && entry.card.star === 5));
    assert.equal(result.data.results.length, 2);
    const replay = await fixed(.99, () => post('/api/combine/bulk', body));
    assert.equal(replay.status, 200); assert.deepEqual(replay.data.results, result.data.results);
    const after = await rpg.getRPGUserByName(seed.name);
    assert.equal(after.inventory.card.length, 6); assert.equal(after.inventory.card.filter(card => card.locked).length, 1);
    assert.equal(after.inventory.card.filter(card => card.type === '전직').length, 1);
    assert.equal(after.gold, 10000000 - result.data.spentGold); assert.equal(after.pendingAction, null);
    assert.deepEqual(after.inventory.item, savedItems);
    assert.equal((await post('/api/combine/bulk', { ...body, requestId: 'bulk-combine-stale-00' })).status, 409);
});

test('일괄 조합 실패 결과를 다시 사용하지 않고 오메가도 원래 재료 수만큼 처리한다', async () => {
    for (const star of [0, 4, 11]) {
        await resetWebCards(Array.from({ length: 9 }, () => ({ id: 0, star, type: '일반' })));
        const data = await (await fetch(base + '/api/combine/cards', { headers: { Cookie: cookie } })).json();
        const body = { requestId: 'bulk-same-star-' + star + '-00', star, cardType: '일반', revision: 0, version: data.cards[0].version };
        const result = await fixed(.99, () => post('/api/combine/bulk', body));
        assert.equal(result.status, 200, JSON.stringify(result.data)); assert.equal(result.data.times, 3);
        assert.equal((await rpg.getRPGUserByName(seed.name)).inventory.card.length, 3);
        if (star === 4) assert.deepEqual(result.data.results.map(entry => entry.success), [false, false, true]);
        else assert.ok(result.data.results.every(entry => entry.card.star === star && entry.success === (star === 11)));
    }
});

test('일괄 조합은 오래된 카드 목록·골드 부족·사냥 중·잘못된 종류를 처리하기 전에 거부한다', async () => {
    for (const endpoint of ['/api/combine/bulk', '/api/inventory/cards/expand']) {
        const response = await fetch(base + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        assert.equal(response.status, 401);
    }
    await resetWebCards(Array.from({ length: 6 }, () => ({ id: 0, star: 4, type: '일반' })), { gold: 0 });
    const data = await (await fetch(base + '/api/combine/cards', { headers: { Cookie: cookie } })).json();
    const body = { requestId: 'bulk-rejected-case-00', star: 4, cardType: '일반', revision: 0, version: data.cards[0].version };
    assert.equal((await post('/api/combine/bulk', body)).status, 400);
    assert.equal((await post('/api/combine/bulk', { ...body, version: 'old' })).status, 409);
    assert.equal((await post('/api/combine/bulk', { ...body, cardType: 'all' })).status, 400);
    const value = await rpg.getRPGUserByName(seed.name); value.field = { name: '왕십리역' }; await value.save();
    assert.equal((await post('/api/combine/bulk', body)).status, 409);
    assert.equal((await rpg.getRPGUserByName(seed.name)).inventory.card.length, 6);
});

test('일괄 조합은 동시 요청과 저장 실패 재시도에서도 결과·골드를 한 번만 처리한다', async () => {
    for (const saveFailure of [false, true]) {
        const value = await resetWebCards(Array.from({ length: 6 }, () => ({ id: 0, star: 0, type: '일반' })));
        const luckyId = rpg.getDataCache('Item').findIndex(item => Number(item?.lucky) > 0);
        value.inventory.item = [{ id: luckyId, count: 2 }]; await value.save();
        const data = await (await fetch(base + '/api/combine/cards', { headers: { Cookie: cookie } })).json();
        const body = { requestId: 'bulk-save-retry-' + saveFailure, star: 0, cardType: '일반', revision: 0, version: data.cards[0].version, assist: { itemId: luckyId } };
        const original = DynamoDBDocumentClient.prototype.send;
        let fail = saveFailure;
        DynamoDBDocumentClient.prototype.send = async function(command) {
            if (fail && command.constructor.name === 'UpdateCommand' && command.input.TableName === 'rpgenius_user') { fail = false; throw new Error('isolated bulk save failure'); }
            return original.call(this, command);
        };
        try {
            if (saveFailure) {
                assert.equal((await post('/api/combine/bulk', body)).status, 503);
                assert.equal((await post('/api/combine/bulk', body)).status, 200);
            } else {
                const results = await Promise.all([post('/api/combine/bulk', body), post('/api/combine/bulk', body)]);
                assert.ok(results.some(result => result.status === 200));
            }
            const after = await rpg.getRPGUserByName(seed.name);
            assert.equal(after.inventory.card.length, 2); assert.equal(after.bulkCombineReceipt.times, 2);
            assert.equal(rpg.getInventoryItemCount(after, luckyId), 0);
            assert.equal(after.gold, 10000000 - 2 * rpg.getCardCombineInfo(0).gold);
        } finally { DynamoDBDocumentClient.prototype.send = original; }
    }
});

test('일괄 조합 럭키는 선택한 이벤트 아이템만 매회 1장 소모하고 곱연산 확률을 적용한다', async () => {
    const items = rpg.getDataCache('Item');
    const luckyIds = items.flatMap((item, id) => item?.lucky === .3 ? [id] : []);
    assert.ok(luckyIds.length >= 2);
    const chosen = luckyIds.at(-1), other = luckyIds[0];
    const value = await resetWebCards(Array.from({ length: 6 }, () => ({ id: 0, star: 4, type: '일반' })), { cardCombineCounts: {} });
    value.inventory.item = [{ id: chosen, count: 2 }, { id: other, count: 10 }]; await value.save();
    const data = await (await fetch(base + '/api/combine/cards', { headers: { Cookie: cookie } })).json();
    assert.deepEqual(data.meta.assists.map(item => [item.id, item.count]).sort((a, b) => a[0] - b[0]), [[other, 10], [chosen, 2]]);
    const body = { requestId: 'bulk-lucky-exact-item', star: 4, cardType: '일반', revision: 0, version: data.cards[0].version, assist: { itemId: chosen } };
    const baseRate = rpg.getCardCombineInfo(4).rate;
    const result = await fixed(baseRate * 1.15, () => post('/api/combine/bulk', body));
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.ok(result.data.results.every(entry => entry.success && entry.card.star === 5 && !entry.preservedCard));
    const after = await rpg.getRPGUserByName(seed.name);
    assert.equal(rpg.getInventoryItemCount(after, chosen), 0); assert.equal(rpg.getInventoryItemCount(after, other), 10);
    assert.equal(result.data.assist.itemId, chosen); assert.equal(result.data.assist.count, 2);
    const replay = await fixed(.99, () => post('/api/combine/bulk', body));
    assert.deepEqual(replay.data.results, result.data.results);
    assert.equal((await post('/api/combine/bulk', { ...body, assist: { itemId: other } })).status, 409);
    assert.equal((await post('/api/combine/bulk', { ...body, assist: null })).status, 409);
});

test('일괄 조합 보호는 각 묶음의 선택 위치를 실패할 때만 보존하며 보존 카드를 재사용하지 않는다', async () => {
    const protectId = rpg.getDataCache('Item').findIndex(item => item?.protect?.star === 4);
    for (const protectIndex of [0, 1, 2]) {
        const cards = Array.from({ length: 9 }, (_, id) => ({ id: id % 3, star: 4, type: '일반', skin: id % 3 }));
        const value = await resetWebCards(cards, { cardCombineCounts: {} });
        value.inventory.item = [{ id: protectId, count: 3 }]; await value.save();
        const data = await (await fetch(base + '/api/combine/cards', { headers: { Cookie: cookie } })).json();
        const body = { requestId: 'bulk-protect-position-' + protectIndex, star: 4, cardType: '일반', revision: 0, version: data.cards[0].version, assist: { itemId: protectId, protectIndex } };
        const result = await fixed(.99, () => post('/api/combine/bulk', body));
        assert.equal(result.status, 200, JSON.stringify(result.data));
        assert.deepEqual(result.data.results.map(entry => entry.success), [false, false, true]);
        assert.deepEqual(result.data.results.map(entry => entry.preservedCard?.id ?? null), [protectIndex, protectIndex, null]);
        const after = await rpg.getRPGUserByName(seed.name);
        assert.equal(after.inventory.card.length, 5); assert.equal(rpg.getInventoryItemCount(after, protectId), 0);
        assert.equal(after.inventory.card.filter(card => card.skin === protectIndex).length, 2);
        const replay = await post('/api/combine/bulk', body);
        assert.deepEqual(replay.data.results, result.data.results);
        assert.equal((await post('/api/combine/bulk', { ...body, assist: { itemId: protectId, protectIndex: (protectIndex + 1) % 3 } })).status, 409);
    }
});

test('일괄 보조 카드의 수량·성급·보호 위치·오메가 제한을 소모 전에 검증한다', async () => {
    const items = rpg.getDataCache('Item'), protectId = items.findIndex(item => item?.protect?.star === 4), luckyId = items.findIndex(item => Number(item?.lucky) > 0);
    for (const [star, assist] of [[4, { itemId: luckyId }], [4, { itemId: protectId, protectIndex: 1 }],
        [3, { itemId: protectId, protectIndex: 1 }], [4, { itemId: protectId, protectIndex: 3 }],
        [4, { itemId: luckyId, protectIndex: 0 }], [4, { itemId: -1 }], [4, { itemId: '1' }], [4, []],
        [11, { itemId: luckyId }], [11, { itemId: protectId, protectIndex: 0 }]]) {
        const value = await resetWebCards(Array.from({ length: 6 }, () => ({ id: 0, star, type: '일반' })), { cardCombineCounts: {} });
        value.inventory.item = [{ id: luckyId, count: 1 }, { id: protectId, count: 1 }]; await value.save();
        const beforeCards = structuredClone(value.inventory), gold = value.gold;
        const data = await (await fetch(base + '/api/combine/cards', { headers: { Cookie: cookie } })).json();
        const body = { requestId: 'bulk-invalid-support-00', star, cardType: '일반', revision: 0, version: data.cards[0].version, assist };
        const result = await post('/api/combine/bulk', body);
        assert.equal(result.status, 400, JSON.stringify({ assist, result }));
        const after = await rpg.getRPGUserByName(seed.name);
        assert.deepEqual(after.inventory, beforeCards); assert.equal(after.gold, gold); assert.equal(after.bulkCombineReceipt, null);
    }
});


test('프리셋 기존 가격은 가넷으로 유지하고 추가 슬롯은 500가넷이며 재시도·동시 요청은 중복 차감하지 않는다', async () => {
    let u = await resetWebCards([], { presets: [null, { name: '기존' }], presetSlotsUnlocked: 5, garnet: 7500, point: 777 });
    const first = await post('/api/presets/unlock', { slot: 5 });
    assert.equal(first.status, 200); assert.equal(first.data.slotCount, 20); assert.equal(first.data.unlocked, 6);
    assert.ok(first.data.costs.slice(1).every(c => c.currency === 'garnet'));
    assert.deepEqual(first.data.costs.slice(1, 5).map(c => c.amount), [100, 100, 300, 500]);
    assert.ok(first.data.costs.slice(5).every(c => c.amount === 500));
    assert.equal(u.presets[1].name, '기존');
    await post('/api/presets/unlock', { slot: 5 }); u = await rpg.getRPGUserByName(seed.name); assert.equal(u.garnet, 7000);
    await Promise.all([post('/api/presets/unlock', { slot: 6 }), post('/api/presets/unlock', { slot: 6 })]);
    u = await rpg.getRPGUserByName(seed.name); assert.equal(u.garnet, 6500); assert.equal(u.presetSlotsUnlocked, 7);
    assert.equal((await post('/api/presets/unlock', { slot: 9 })).status, 400);
    for (let slot = 7; slot < 20; slot++) assert.equal((await post('/api/presets/unlock', { slot })).status, 200);
    u = await rpg.getRPGUserByName(seed.name); assert.equal(u.garnet, 0); assert.equal(u.point, 777); assert.equal(u.presetSlotsUnlocked, 20);
    assert.equal((await post('/api/presets/unlock', { slot: 20 })).status, 400);
    u.presetSlotsUnlocked = 19; await u.save(); assert.equal((await post('/api/presets/unlock', { slot: 19 })).status, 400);
});

test('잠긴 보조장비는 검은 환생의 불꽃 목록과 사용 직전 모두 차단하고 취소 시 반환한다', async () => {
    const u = user(), flame = itemId('검은 환생의 불꽃');
    const support = { type: 'support', id: 0, locked: true, rolled: { atk: 123 } };
    u.inventory.equipment = [support]; rpg.addInventoryItem(u, flame, 1);
    assert.match(await rpg.useItem(u, '검은 환생의 불꽃', 1), /잠금 해제된.*없어/);
    assert.equal(rpg.getInventoryItemCount(u, flame), 1); assert.deepEqual(support.rolled, { atk: 123 });
    support.locked = false;
    await rpg.useItem(u, '검은 환생의 불꽃', 1);
    const option = rpg.getWebItemUsePending(u).options[0]; assert.ok(option);
    support.locked = true;
    assert.match(rpg.resolveWebItemUsePending(u, option.value ?? option.number), /잠긴 장비/);
    assert.deepEqual(support.rolled, { atk: 123 }); assert.equal(rpg.getWebItemUsePending(u).options.length, 0);
    rpg.cancelWebItemUsePending(u); assert.equal(rpg.getInventoryItemCount(u, flame), 1);
});

test('WebGL 일반·H필드·월드보스에서 최대 HP/MP로도 투신의 함성 포션을 사용한다', async () => {
    const regular = rpg.getRegularFieldDungeons()[0], id = itemId('투신의 함성 포션');
    for (const [endpoint, field] of [
        ['/api/field', { name: regular.name, killCount: 0 }],
        ['/api/hfield', { name: '부타게임[H]', phase: 'normal', killCount: 0 }],
        ['/api/worldboss', { name: '흑막', worldBoss: true, skillSelecting: false, chosenSkillId: 0 }]
    ]) {
        let u = await resetWebCards([], { level: 300, equipments: {}, main_card: { id: 0, star: 6, type: '일반' }, battleCryPotion: null, field: { ...field, enteredAt: Date.now(), skillCooldowns: {}, equipmentState: {} } });
        u.equipments.support = { id: rpg.getDataCache('Equipment').support.findIndex(e => e.name === '판테온 레거시') };
        const stats = rpg.calculateUserStats(u); u.hp = stats.hp; u.mp = stats.mp;
        rpg.addInventoryItem(u, id, 2); if (endpoint === '/api/worldboss') u.field.blackCurtain = { curseApplied: true }; await u.save();
        const result = await post(endpoint + '/use-consumable', { itemId: id });
        assert.equal(result.status, 200); assert.equal(result.data.ok, true, result.data.message);
        u = await rpg.getRPGUserByName(seed.name); assert.equal(rpg.getInventoryItemCount(u, id), 1); assert.equal(u.battleCryPotion.amount, .25);
        assert.ok(result.data.state.consumables.some(item => item.id === id && item.effect.includes('25%')));
        assert.equal(result.data.state.player.level, 300); assert.equal(result.data.state.player.attackOrder, 1);
        assert.ok(rpg.calculateUserStats(u).atk >= Math.round(stats.atk * 1.25));
        rpg.clearFieldRuntimeTimers(u.name);
    }
});

test('판테온·리턴즈 공격 순서는 실제 타격 횟수와 PvP 공개 상태에 일치한다', async () => {
    const u = user(), equipment = rpg.getDataCache('Equipment');
    const dungeon = rpg.getRegularFieldDungeons()[0];
    for (const [name, orders] of [['판테온 레거시', [1, 2, 3, 1]], ['리턴즈파겜', [2, 3, 1, 2]]]) {
        u.equipments = { support: { id: equipment.support.findIndex(e => e.name === name) } };
        u.field = { name: dungeon.name, killCount: 0, enteredAt: Date.now(), equipmentState: {} };
        for (const expected of orders) {
            assert.equal(rpg.getEquipmentAttackOrderPreview(u), expected);
            rpg.applyTranscendPreAttack(u, { type: 'normal', dungeon }, 100, {}, 'basic', null);
        }
    }
    const a = user(), b = user(); a.equipments.support = { id: equipment.support.findIndex(e => e.name === '판테온 레거시') }; a.level = 123;
    await a.save(); await b.save(); pvp.ensurePvpState(a).daily.opponents = [{ name: b.name, rating: 1000 }];
    assert.equal((await pvp.startBattle(a, b.name)).ok, true);
    assert.equal(pvp.buildBattleView(a).me.level, 123); assert.equal(pvp.buildBattleView(a).me.attackOrder, 1);
    a.pvp.battle.me.runtime.equipment.attackCount = 2;
    assert.equal(pvp.buildBattleView(a).me.attackOrder, 3); assert.equal(pvp.buildBattleView(a).opp.attackOrder, null);
});

function tcgUser() {
    const u = user(), equipment = rpg.getDataCache('Equipment');
    u.equipments = { hat: { id: equipment.hat.findIndex(e => e.name === '마나번 햇'), transcendStage: 3 },
        support: { id: equipment.support.findIndex(e => e.name === '행운의 복주머니') }, accessory: {} };
    for (const [index, name] of ['메가카운트 추첨기', '운명의 주사위', '해방의 열쇠'].entries()) u.equipments.accessory[index] = { id: equipment.accessory.findIndex(e => e.name === name) };
    return u;
}

test('TCG 필드·월드보스 추가 발동은 장착 방어구의 쿨타임을 무시하고 원래 쿨타임은 보존한다', async () => {
    for (const worldBoss of [false, true]) {
        const u = tcgUser(), dungeon = rpg.getRegularFieldDungeons()[0], now = Date.now();
        u.field = { name: worldBoss ? '흑막' : dungeon.name, worldBoss, enteredAt: now, skillCooldowns: {}, equipmentState: { manaBurnAttackBuffReadyAt: now + 60000, liberationReadyAt: now + 60000 } };
        const stats = rpg.calculateUserStats(u); u.mp = stats.mp;
        const extra = { attackUnitCount: 1 };
        await fixed(0, () => rpg.applyTranscendPreAttack(u, { type: 'normal', dungeon }, 100, extra, 'basic', null));
        assert.ok(u.field.equipmentState.manaBurnAttackBuff?.expiredAt > now, '공격 장비 발동이 다른 장착 방어구를 실행');
        assert.equal(u.field.equipmentState.manaBurnAttackBuffReadyAt, now + 60000);
        assert.ok(u.mp < stats.mp); assert.ok(extra.triggeredEffectIds.includes('set:TCG의 유산'));
        assert.equal(u.field.equipmentState.tcgSources, undefined, '추가 발동은 재연쇄하지 않는다');
        rpg.clearFieldRuntimeTimers(u.name);
    }
});

test('TCG 레이드와 PvP에서도 원래 조건을 무시해 장착 방어구가 발동한다', async () => {
    const u = tcgUser(), now = Date.now(), stats = rpg.calculateUserStats(u);
    const member = { name: u.name, baseSnapshot: { stats, slotEffects: {}, transcendEquipment: rpg.getTranscendEquipmentSnapshot(u, { includeAllActive: true }) },
        runtime: { hp: stats.hp, hpMax: stats.hp, mp: stats.mp, mpMax: stats.mp, cooldownsUntil: {}, equipmentState: { manaBurnAttackReadyAt: now + 60000, liberationReadyAt: now + 60000 } } };
    const monster = { name: 'TCG 검증', type: 'boss', hp: 100000, hpMax: 100000, stats: {}, debuffs: [] };
    const room = { members: [member], monster, phaseIndex: 0, questId: 'mansionNormal' };
    const extra = { comboHitCount: 1 };
    await fixed(0, () => party.preparePartyAttackUnits(room, member, monster, extra, stats));
    assert.ok(member.runtime.equipmentAtkBuffs.manaBurnAttack?.expiredAt > now);
    assert.equal(member.runtime.equipmentState.manaBurnAttackReadyAt, now + 60000);
    const a = tcgUser(), b = user(); await a.save(); await b.save();
    pvp.ensurePvpState(a).daily.opponents = [{ name: b.name, rating: 1000 }];
    assert.equal((await pvp.startBattle(a, b.name)).ok, true);
    const battle = a.pvp.battle; battle.startedAt = now - 10000; battle.lastTickAt = now;
    battle.me.nextActionAt = 0; battle.opp.nextActionAt = now + 100000;
    battle.me.runtime.equipment = { manaBurnAttackBuffReadyAt: now + 60000, liberationReadyAt: now + 60000 };
    await fixed(0, () => pvp.playerAttack(a));
    assert.ok(battle.me.runtime.equipment.manaBurnAttackBuff?.until > now);
    assert.equal(battle.me.runtime.equipment.manaBurnAttackBuffReadyAt, now + 60000);
});

test('TCG는 4세트에서만 발동하고 지속 중인 버프는 새 발동으로 세지 않는다', async () => {
    const tcg = require('../tcg_equipment_effects');
    const state = { manaBurnAttackBuff: { value: .15, expiredAt: Date.now() + 60000 } };
    tcg.collect(state, tcg.capture(state)); assert.equal(state.tcgSources, undefined);
    const u = tcgUser(); delete u.equipments.support;
    const dungeon = rpg.getRegularFieldDungeons()[0];
    u.field = { name: dungeon.name, enteredAt: Date.now(), equipmentState: { manaBurnAttackBuffReadyAt: Date.now() + 60000 } };
    const extra = {}; await fixed(0, () => rpg.applyTranscendPreAttack(u, { type: 'normal', dungeon }, 100, extra, 'basic', null));
    assert.equal(u.field.equipmentState.manaBurnAttackBuff, undefined);
    assert.ok(!extra.triggeredEffectIds.includes('set:TCG의 유산'));
});

test('신규 방어구 등록은 기존 장비와 인덱스를 보존하며 0강과 15강 수치를 맞춘다', () => {
    const { definitions } = require('../armor_expansion'), { appendEquipment } = require('../scripts/register_armor_expansion');
    const before = read('Equipment');
    for (const [slot, entries] of Object.entries(definitions)) before[slot] = before[slot].filter(item => !entries.some(entry => entry.name === item.name));
    before.hat[0].desc = '운영 설명'; before.hat[0].upgrade = [];
    const snapshot = structuredClone(before), after = appendEquipment(before);
    assert.deepEqual(before, snapshot);
    for (const slot of Object.keys(before)) assert.deepEqual(after[slot].slice(0, before[slot].length), before[slot]);
    const expected = {
        hat: [[2,30,31,30],[14,67,66,907],[34,395,143,2454],[91,725,374,6728]],
        pants: [[2,40,42,40],[18,90,88,1210],[46,526,192,3272],[122,967,500,8971]],
        shoes: [[2,25,29,25],[12,56,60,758],[29,329,124,2048],[76,605,315,5608]]
    };
    for (const [slot, entries] of Object.entries(definitions)) entries.forEach((entry, i) => {
        const live = rpg.getDataCache('Equipment')[slot].find(item => item.name === entry.name);
        const {evolution, ...definition} = live;
        assert.deepEqual(definition, entry);
        if (entry.rarity === '유니크') assert.equal(rpg.getDataCache('Equipment')[slot][evolution].name, entries.find(item => item.rarity === '레전더리').name);
        const start = rpg.getEquipmentStatsAtLevel(live, 0), end = rpg.getEquipmentStatsAtLevel(live, 15);
        assert.deepEqual([start.def,start.hp,end.def,end.hp], expected[slot][i], entry.name);
        for (const key of Object.keys(start).filter(key => !['def','hp'].includes(key))) assert.equal(end[key], start[key]);
        assert.ok(live.upgrade.every(step => Object.keys(step.plusStat).length === 0));
        if (entry.passive_id != null) assert.equal(rpg.getEquipmentPassives()[entry.passive_id].desc, entry.desc);
    });
    after.hat.at(-1).stat.def = 777;
    assert.deepEqual(appendEquipment(after), after, '재실행 시 운영자가 수정한 신규 장비도 보존');
    before.weapon.push({name:'패시브 충돌',passive_id:97});
    assert.throws(() => appendEquipment(before), /충돌/);
});

test('신규 유니크 3종은 같은 장비 10강 3개로 같은 부위의 레전더리에 진화한다', () => {
    const {definitions} = require('../armor_expansion'), equipment = rpg.getDataCache('Equipment');
    for (const [slot, entries] of Object.entries(definitions)) {
        const unique = entries.find(item => item.rarity === '유니크'), legendary = entries.find(item => item.rarity === '레전더리');
        const id = equipment[slot].findIndex(item => item.name === unique.name), u = user();
        u.equipments = {}; u.inventory.equipment = Array.from({length:3}, () => ({type:slot,id,level:10}));
        assert.ok(rpg.formatEquipmentSynthesisPreview(u,[1,2,3]).includes(legendary.name));
        assert.ok(rpg.runEquipmentSynthesis(u).includes(legendary.name));
        assert.equal(u.inventory.equipment.length,1);
        assert.equal(u.inventory.equipment[0].type,slot);
        assert.equal(equipment[slot][u.inventory.equipment[0].id].name,legendary.name);
    }
});

test('기존 등급별 장비 상자를 개봉해 신규 모자·하의·신발 12종을 획득할 수 있다', async () => {
    const { definitions } = require('../armor_expansion'), equipment = rpg.getDataCache('Equipment'), items = rpg.getDataCache('Item');
    for (const [slot, entries] of Object.entries(definitions)) for (const entry of entries) {
        const pool = ['weapon','hat','armor','pants','shoes','accessory'].flatMap(type => equipment[type].map((item,id) => ({type,id,item})))
            .filter(({item}) => item.rarity === entry.rarity && !(item.rarity === '유니크' && item.isRaid));
        const index = pool.findIndex(({item}) => item.name === entry.name);
        assert.ok(index >= 0);
        const id = items.push({name:'검증 상자 ' + entry.name,type:'가챠',pack:{type:'장비 상자',rarity:entry.rarity}}) - 1;
        const u = user(); rpg.addInventoryItem(u, id, 1);
        const message = await fixed((index + .5) / pool.length, () => rpg.useItem(u, items[id].name, 1));
        assert.ok(message.includes(entry.name), message);
        assert.equal(rpg.getInventoryItemCount(u, id), 0);
        assert.equal(u.inventory.equipment.length, 1);
        assert.equal(u.inventory.equipment[0].type, slot);
        assert.equal(u.inventory.equipment[0].id, pool[index].id);
    }
});

test('천리안은 실제 치명타 확률 30%부터 발동하며 타격 보정과 고정 확률을 반영한다', async t => {
    const armor = require('../armor_expansion'), equipment = rpg.getDataCache('Equipment'), u = user();
    u.equipments = {hat:{id:equipment.hat.findIndex(item => item.name === '천리안의 왕관')}};
    const stats = {...rpg.calculateUserStats(u),atk:1000,crit:.29,critMul:1.5,clairvoyanceBonus:0};
    assert.equal(stats.hasClairvoyance, true);
    armor.applyConditionalStats(stats); assert.equal(stats.critMul, 1.5);
    const hit = extra => rpg.calculateAttackHitResult(1000,0,0,stats,{}, {forceCritical:true,disableEquipmentBonusDamage:true,...extra},{}).finalDamage;
    t.mock.method(Math, 'random', () => .5);
    assert.equal(hit({}),1500); assert.equal(hit({critChanceBonus:.01}),1700);
    stats.crit = .30; armor.applyConditionalStats(stats); armor.applyConditionalStats(stats);
    assert.equal(stats.critMul,1.7); assert.equal(hit({}),1700);
    stats.fixedCriticalChance = .20; armor.applyConditionalStats(stats);
    assert.equal(stats.critMul,1.5);
    t.mock.method(Math, 'random', () => .1);
    const fixedHit = hit({critChanceBonus:1}); stats.hasClairvoyance = false;
    assert.equal(fixedHit,hit({critChanceBonus:1}), '고정 20%일 때 천리안 미발동');
});

test('폭풍을 걷는 자는 쿨타임 감소 20% 초과부터 적용되고 반복 계산해도 중첩되지 않는다', () => {
    const armor = require('../armor_expansion'), u = user(), equipment = rpg.getDataCache('Equipment');
    u.equipments = {shoes:{id:equipment.shoes.findIndex(item => item.name === '폭풍을 걷는 발걸음')}};
    const stats = {...rpg.calculateUserStats(u),cooldown:.20,stormWalkerBonus:0};
    assert.equal(stats.hasStormWalker,true);
    armor.applyConditionalStats(stats); assert.equal(stats.cooldown,.20); assert.equal(rpg.getSkillCooldownRate(stats),.8);
    stats.cooldown = .201; armor.applyConditionalStats(stats); armor.applyConditionalStats(stats);
    assert.ok(Math.abs(stats.cooldown - .251) < 1e-9);
    assert.ok(Math.abs(rpg.getSkillCooldownRate(stats) - .749) < 1e-9);
    stats.cooldown -= .001; armor.applyConditionalStats(stats);
    assert.ok(Math.abs(stats.cooldown - .20) < 1e-9);
});

test('업화는 필드에서 HP 20%에 발동하고 5초 지속·15초 쿨타임을 지킨다', t => {
    let now = Date.now(); t.mock.method(Date,'now',() => now);
    const u = user(), equipment = rpg.getDataCache('Equipment');
    u.equipments = {pants:{id:equipment.pants.findIndex(item => item.name === '불멸하는 업화의 하의')}};
    u.field = {name:rpg.getRegularFieldDungeons()[0].name,enteredAt:now,equipmentState:{}};
    const before = rpg.calculateUserStats(u), lines = [];
    assert.equal(before.hasHellfireRage,true); assert.equal(equipment.pants[u.equipments.pants.id].stat.fireRes,200);
    u.hp = Math.ceil(before.hp * .21); assert.equal(rpg.tryHellfireRage(u,before.hp,lines),false);
    u.hp = Math.floor(before.hp * .20); const hp = u.hp;
    assert.equal(rpg.tryHellfireRage(u,before.hp,lines),true);
    assert.ok(Math.abs(rpg.calculateUserStats(u).atk - before.atk * 1.2) <= 2);
    assert.equal(u.hp,hp); assert.equal(lines.length,1);
    now += 4999; assert.ok(rpg.calculateUserStats(u).atk > before.atk);
    now++; assert.equal(rpg.calculateUserStats(u).atk,before.atk);
    now += 9999; assert.equal(rpg.tryHellfireRage(u,before.hp,lines),false);
    now++; assert.equal(rpg.tryHellfireRage(u,before.hp,lines),true);
    now += 15000; u.hp = 0; assert.equal(rpg.tryHellfireRage(u,before.hp,lines),false);
    rpg.clearFieldRuntimeTimers(u.name);
});

test('업화는 거울/PvP와 레이드의 실제 피격 경로에서도 발동한다', t => {
    let now = Date.now(); t.mock.method(Date,'now',() => now);
    const u = user(), equipment = rpg.getDataCache('Equipment');
    u.equipments = {pants:{id:equipment.pants.findIndex(item => item.name === '불멸하는 업화의 하의')}};
    const side = pvp.createCorridorMirror(u), before = pvp.getCorridorMirrorStats(side).atk;
    side.hp = Math.floor(side.maxHp * .20) + 1;
    pvp.corridorMirrorHit(side,user(),1,{});
    assert.ok(side.runtime.equipment.hellfireRage);
    assert.ok(pvp.getCorridorMirrorStats(side).atk > before);
    const member = {name:u.name,position:'브루저',skills:[],baseSnapshot:{stats:{atk:1000,hp:1000,mp:1000,hasHellfireRage:true},slotEffects:{},passives:[]},
        runtime:{hp:201,hpMax:1000,mp:1000,mpMax:1000,dead:false,buffs:[],equipmentState:{},equipmentAtkBuffs:{},cooldownsUntil:{},stackCounters:{}}};
    const room = {members:[member],phaseIndex:0,questId:'mansionNormal',monster:{name:'검증',hp:10000,hpMax:10000,stats:{},debuffs:[]}};
    party.applyDamageToMember(room,member,1,'검증');
    assert.equal(member.runtime.hp,200); assert.equal(party.getPartyAttackBuffValue(member),.20);
    now += 5000;
    assert.equal(pvp.getCorridorMirrorStats(side).atk,before); assert.equal(party.getPartyAttackBuffValue(member),0);
});

test('천공 장비 패치는 지정한 수치와 설명만 바꾸고 기존 운영 설정과 배열 순서를 보존한다', () => {
    const { PATCHES, patchEquipment } = require('../scripts/update_sky_equipment_balance');
    const before = read('Equipment');
    for (const patch of PATCHES) {
        const item = before[patch.slot].find(entry => entry.name === patch.name);
        item[patch.group][patch.key] = .99; item.desc = '운영 중인 이전 설명';
        item.stat.def = 777; item.no_trade = true; item.upgrade = [];
    }
    const snapshot = structuredClone(before), after = patchEquipment(before);
    assert.deepEqual(before, snapshot);
    const restored = structuredClone(after);
    for (const patch of PATCHES) {
        const item = after[patch.slot].find(entry => entry.name === patch.name);
        assert.equal(item[patch.group][patch.key], patch.value);
        assert.equal(item.desc, patch.desc);
        const original = before[patch.slot].find(entry => entry.name === patch.name);
        const entry = restored[patch.slot].find(entry => entry.name === patch.name);
        entry[patch.group][patch.key] = original[patch.group][patch.key]; entry.desc = original.desc;
    }
    assert.deepEqual(restored, before);
    assert.deepEqual(patchEquipment(after), after);
    delete before.hat;
    assert.throws(() => patchEquipment(before), /운영 장비/);
});

test('천공 장비의 초월 1~3단계 스탯과 공통 전투 피해 및 장비 표기가 새 수치와 일치한다', t => {
    t.mock.method(Math, 'random', () => .5);
    const content = require('../transcend_equipment');
    const equipment = rpg.getDataCache('Equipment');
    for (const [slot, name, key, rates] of [
        ['hat', '천공의 모자', 'critLightBonus', [.10, .14, .18]],
        ['armor', '천공의 갑옷', 'lightFinalDamage', [.10, .15, .20]],
        ['pants', '천공의 하의', 'nonCritLightBonus', [.08, .11, .14]]
    ]) {
        const id = equipment[slot].findIndex(item => item.name === name), definition = equipment[slot][id];
        assert.equal(definition.desc, content.definitions[slot].find(item => item.name === name).desc);
        for (let stage = 1; stage <= 3; stage++) {
            const u = user(); u.equipments = { [slot]: { id, level: 0, transcendStage: stage } };
            const rate = rates[stage - 1], stats = rpg.calculateUserStats(u);
            assert.ok(Math.abs(stats[key] - rate) < 1e-9, name + ' ' + stage);
            assert.ok(rpg.formatCurrentEquipmentStatLines(definition, 0, null, { transcendStage: stage }).includes('+' + Math.round(rate * 100) + '%'));
            const damageStats = { atk: 1000, crit: 0, critMul: 1.5, [key]: stats[key] };
            const extra = slot === 'hat' ? { forceCritical: true } : { disableCritical: true, attackElement: slot === 'armor' ? '명' : '화' };
            const hit = rpg.calculateAttackHitResult(1000, 0, 0, damageStats, {}, extra, {});
            assert.equal(hit.finalDamage, (slot === 'hat' ? 1500 : 1000) + Math.round(1000 * rate));
            const opposite = rpg.calculateAttackHitResult(1000, 0, 0, damageStats, {}, slot === 'pants' ? { forceCritical: true } : { disableCritical: true, attackElement: '화' }, {});
            assert.equal(opposite.finalDamage, slot === 'pants' ? 1500 : 1000);
        }
    }
});

test('TCG의 유산으로 재발동하는 천공 모자와 하의도 새 초월 단계 배율로 피해를 준다', () => {
    const tcg = require('../tcg_equipment_effects');
    for (const [name, damage] of [['천공의 모자', [100, 140, 180]], ['천공의 하의', [80, 110, 140]]]) {
        for (let stage = 1; stage <= 3; stage++) {
            const state = {}, extra = {};
            tcg.record(state, '핏빛 모자');
            const activated = tcg.activate({ state, stats: { atk: 1000 }, runtime: {}, extra, now: 1000, setCount: 4,
                entries: [{ name: '핏빛 모자', stage: 1 }, { name, stage }], element: () => 1 });
            assert.deepEqual(activated, [name]);
            assert.equal(extra.oneTimeFinalDamage, damage[stage - 1]);
        }
    }
});

test('TCG 추첨은 원래 장비를 제외하며 다른 장비 발동에도 정확히 한 번 실행한다', async () => {
    const tcg = require('../tcg_equipment_effects');
    for (const random of [0, .49, .99]) {
        const state = {}, actor = { hp: 100, mp: 100 }, extra = {}, calls = [];
        const ctx = tcg.context({ mode: 'field', state, runtime: {}, actor, stats: { hp: 1000, mp: 1000 }, now: 1000, extra, setCount: 4,
            entries: [{ name: '심해의 갑옷', stage: 1 }, { name: '진사이', stage: 1 }, { name: '핏빛 모자', stage: 1 }],
            heal: amount => { calls.push('진사이'); actor.hp += amount; }, shield: () => calls.push('심해의 갑옷') });
        tcg.record(state, '심해의 갑옷');
        const selected = await fixed(random, () => tcg.activate(ctx));
        assert.equal(selected.length, 1); assert.notEqual(selected[0], '심해의 갑옷');
        assert.equal(state.tcgSources, undefined); assert.deepEqual(tcg.activate(ctx), []);
        if (selected[0] === '진사이') assert.equal(actor.hp, 300);
        else { assert.equal(actor.hp, 97); assert.equal(state.bloodHatBuff.expiredAt, 16000); }
        assert.ok(!calls.includes('심해의 갑옷'));
    }
});

test('TCG 예약 공격 효과는 지속 피해가 소모하지 않으며 추가 피해는 재연쇄 없이 한 번 계산된다', async () => {
    const tcg = require('../tcg_equipment_effects'), state = { tcgPendingExtra: { tcgCelestia: 1, tcgExtraHit: 1 } };
    const dot = { dotAttack: true }; tcg.consumeAttack(state, dot);
    assert.ok(state.tcgPendingExtra); assert.equal(dot.tcgCelestia, undefined);
    const extra = { hitCount: 1, disableCritical: true }; tcg.consumeAttack(state, extra);
    assert.equal(state.tcgPendingExtra, undefined);
    const procs = []; extra.onEquipmentProc = name => procs.push(name);
    const hit = await fixed(.5, () => rpg.calculateAttackHitResult(100, 0, 0, { atk: 100, crit: 0 }, {}, extra, {}));
    assert.equal(hit.finalDamage, 215); assert.deepEqual(procs, []);
    const next = {}; tcg.consumeAttack(state, next); assert.deepEqual(next, {});
});

test('TCG로 새로 발동한 앵콜의 치명타 피해는 필드 스탯과 타격 보정에 중복되지 않는다', async () => {
    const u = tcgUser(), equipment = rpg.getDataCache('Equipment'); u.equipments.hat = null;
    const id = equipment.weapon.findIndex(e => e.name === '앵콜');
    u.equipments.weapon = { id }; u.main_card.id = equipment.weapon[id].requireMainCard[0];
    const dungeon = rpg.getRegularFieldDungeons()[0];
    u.field = { name: dungeon.name, enteredAt: Date.now(), equipmentState: {}, skillCooldowns: {} };
    const before = rpg.calculateUserStats(u), extra = {};
    await fixed(0, () => rpg.applyTranscendPreAttack(u, { type: 'normal', dungeon }, 100, extra, 'basic', null));
    const after = rpg.calculateUserStats(u), hitExtra = {};
    extra.beforeAttackUnit({ hitExtra });
    assert.ok(Math.abs(after.critMul - before.critMul - .20) < 1e-8);
    assert.equal(Number(hitExtra.critMulBonus || 0), 0);
});

test('TCG 추가 발동은 보호막 금지와 회복 금지를 우회하지 않으며 실패한 스킬은 효과를 커밋하지 않는다', async () => {
    const u = tcgUser(), equipment = rpg.getDataCache('Equipment');
    u.equipments.hat = null;
    u.equipments.armor = { id: equipment.armor.findIndex(e => e.name === '심해의 갑옷') };
    const dungeon = rpg.getRegularFieldDungeons()[0];
    u.field = { name: dungeon.name, enteredAt: Date.now(), skillCooldowns: {}, equipmentState: {} };
    u.mp = 0;
    const before = structuredClone(u);
    assert.match(await rpg.useSkillInField(u, rpg.getMainCardSkills(u)[0].skill.name), /MP가 부족/);
    assert.deepEqual(u.field.equipmentState, before.field.equipmentState);
    for (const name of ['콰트로 1악장', '진사이']) {
        const target = tcgUser(), id = equipment.weapon.findIndex(e => e.name === name), data = equipment.weapon[id];
        target.main_card.id = data.requireMainCard[0]; target.equipments.hat = null;
        target.equipments.weapon = { id };
        target.equipments.armor = name === '콰트로 1악장' ? { id: equipment.armor.findIndex(e => e.name === '심해의 갑옷') } : null;
        target.field = { name: '흑막', worldBoss: true, blackCurtain: { curseApplied: true }, enteredAt: Date.now(), equipmentState: {}, skillCooldowns: {} };
        const stats = rpg.calculateUserStats(target); target.hp = Math.round(stats.hp / 2); target.mp = stats.mp;
        const hp = target.hp, extra = {};
        await fixed(0, () => rpg.applyTranscendPreAttack(target, { type: 'normal', dungeon }, 100, extra, 'basic', null));
        if (name === '콰트로 1악장') { assert.equal(stats.disableShield, 1); assert.ok(!target.field.shield?.amount); }
        else assert.equal(target.hp, hp);
        rpg.clearFieldRuntimeTimers(target.name);
    }
});
