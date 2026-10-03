const { test, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const AWS = require('aws-sdk');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const artifacts = require('../artifacts');
const { appendMansion } = require('../scripts/init_mansion_content');
const { appendOctober } = require('../scripts/init_october_content');

// 기존 엔진과 인증된 Express 요청을 사용하며 모든 AWS 전송을 메모리로 격리한다.
const data = {};
for (const key of ['Item', 'Equipment', 'Pet', 'Recipe', 'Bundle', 'Pack']) {
    const file = path.join(__dirname, '..', 'DB', 'RPGenius', key + '.json');
    data[key] = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
}
data.Quest = []; data.Shop = {}; data.ShopState = {};
for (const name of ['제타 카드팩', '9성 카드팩', '8성 카드팩', '상급 강화석', '헬 도전장', '고유 보조 장비 상자', '고유의 보석', '용기의 보석', '초월 상자']) {
    if (!data.Item.some(item => item?.name === name)) data.Item.push({ name, type: name === '헬 도전장' ? '티켓' : name === '초월 상자' ? '가챠' : '재료' });
}
for (const name of ['조각 보주', '눈뜬 장님 보주', '오로라 보주']) {
    if (!data.Item.some(item => item?.name === name)) data.Item.push({ name, type: '사용', use: '보주' });
}
const registration = appendMansion(data);
Object.assign(data, registration.after);
const octoberBefore = structuredClone(data);
const october = appendOctober(data);
Object.assign(data, october.after);
const seeds = ['mansion-test', 'mansion-guest', 'mansion-third'].map(name => ({
    _get: 1, id: name + '-id', name, code: 'TEST', level: 300, logged_in: [], avatarMigrated: true,
    need_character_card_select: false, main_card: { id: 0, star: 6, type: '일반' },
    inventory: { item: [], card: [], equipment: [], pet: [] }
}));
const records = new Map(seeds.map(seed => [seed.id, structuredClone(seed)]));
const writes = [];
let failProtectedWrite = false;
process.env.ADMIN_SESSION_SECRET = 'mansion-isolated-test';
AWS.S3.prototype.makeRequest = function (operation) {
    if (operation === 'listObjectsV2') return { promise: async () => ({ Contents: [] }) };
    throw new Error('Unexpected isolated S3 operation: ' + operation);
};
DynamoDBDocumentClient.prototype.send = async command => {
    const input = command.input;
    if (command.constructor.name === 'GetCommand') {
        if (input.TableName === 'rpgenius_data') return { Item: { data: structuredClone(data[input.Key.key] || {}) } };
        if (input.TableName === 'rpgenius_user') return { Item: structuredClone(records.get(input.Key.id)) };
    }
    if (command.constructor.name === 'ScanCommand') return { Items: input.TableName === 'rpgenius_user' ? [...records.values()].map(record => structuredClone(record)) : [] };
    if (command.constructor.name === 'UpdateCommand' && input.TableName === 'rpgenius_user') {
        if (failProtectedWrite && input.ConditionExpression?.startsWith('attribute_exists(id) AND')) {
            failProtectedWrite = false;
            const error = new Error('simulated concurrent user change'); error.name = 'ConditionalCheckFailedException'; throw error;
        }
        writes.push(structuredClone(input));
        const record = records.get(input.Key.id);
        if (input.ConditionExpression?.startsWith('attribute_exists(id) AND')) {
            const reject = () => { const error = new Error('simulated concurrent user change'); error.name = 'ConditionalCheckFailedException'; throw error; };
            for (const match of input.ConditionExpression.matchAll(/(#k\d+)\s*=\s*(:p\d+)/g)) {
                if (!require('node:util').isDeepStrictEqual(record[input.ExpressionAttributeNames[match[1]]], input.ExpressionAttributeValues[match[2]])) reject();
            }
            for (const match of input.ConditionExpression.matchAll(/attribute_not_exists\((#k\d+)\)/g)) {
                if (Object.hasOwn(record, input.ExpressionAttributeNames[match[1]])) reject();
            }
        }
        for (const match of input.UpdateExpression.matchAll(/(#\w+)\s*=\s*(:\w+)/g)) {
            record[input.ExpressionAttributeNames[match[1]]] = structuredClone(input.ExpressionAttributeValues[match[2]]);
        }
        return {};
    }
    if (command.constructor.name === 'PutCommand' && input.TableName === 'rpgenius_data' && input.Item.key === 'EliteState') return {};
    throw new Error('Unexpected isolated DB command: ' + command.constructor.name + '/' + input.TableName);
};
const rpg = require('../rpgenius');
const party = require('../partyquest');
const raid = party.__test.mansionRaid;
const quests = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'DB', 'RPGenius', 'PartyQuest.json'), 'utf8')).quests;
let listener, base;
before(async () => {
    await rpg.initRpgeniusData();
    const listen = express.application.listen;
    mock.method(express.application, 'listen', function () { listener = listen.call(this, 0, '127.0.0.1'); return listener; });
    require('../server')();
    await new Promise(resolve => listener.once('listening', resolve));
    mock.restoreAll();
    base = 'http://127.0.0.1:' + listener.address().port;
});
after(async () => {
    for (const seed of seeds) { party.leaveRoom(seed.name); rpg.clearFieldRuntimeTimers(seed.name); }
    await new Promise(resolve => listener.close(resolve));
});
function cookie(name, admin = false) {
    const body = Buffer.from(JSON.stringify({ name, admin, canPartyQuest: true, exp: Date.now() + 3600000 })).toString('base64url');
    return 'rpg_admin=' + body + '.' + crypto.createHmac('sha256', process.env.ADMIN_SESSION_SECRET).update(body).digest('base64url');
}
async function request(route, body, name = seeds[0].name, admin = false) {
    const response = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', ...(name ? { Cookie: cookie(name, admin) } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
}
async function reset(name = seeds[0].name) {
    party.leaveRoom(name); rpg.clearFieldRuntimeTimers(name); rpg.__setQuestDefs([]);
    const user = await rpg.getRPGUserByName(name);
    Object.assign(user, new rpg.RPGUser(name, name + '-id'), structuredClone(seeds.find(seed => seed.name === name)));
    user.gold = 1000000000; user.battleCryPotion = null; user.field = null; user.unlockedRaids = []; user.titleProgress = {}; user.titles = []; user.quests = {};
    assert.equal((await user.save()).success, true);
    writes.length = 0;
    return user;
}
async function battle(difficulty = 'normal', count = 1, phaseIndex = 0) {
    for (const seed of seeds) party.leaveRoom(seed.name);
    const questId = 'mansion' + difficulty[0].toUpperCase() + difficulty.slice(1);
    for (const seed of seeds.slice(0, count)) {
        const user = await reset(seed.name); user.unlockedRaids = [questId]; await user.save();
    }
    const created = await party.createRoom(seeds[0].name, questId); assert.ok(created.roomId, JSON.stringify(created));
    for (const seed of seeds.slice(1, count)) assert.equal((await party.joinRoom(created.roomId, seed.name)).ok, true);
    for (const seed of seeds.slice(0, count)) party.setReady(seed.name, true);
    assert.equal((await party.start(seeds[0].name)).ok, true);
    const room = party.getRoomOf(seeds[0].name);
    room.introUntil = 0; room.awaitingChoices = true;
    room.phaseIndex = phaseIndex;
    room.monster = party.__test.createPhaseMonster(quests.find(quest => quest.id === questId).phases[phaseIndex]);
    raid.onSpawn(room, room.monster);
    for (const member of room.members) {
        Object.assign(member.runtime, { hp: 1000000, hpMax: 1000000, mp: 1000000, mpMax: 1000000, shield: 0, buffs: [], dead: false });
        Object.assign(member.baseSnapshot.stats, { atk: 0, avd: 0, takenDamage: 0, dmgReduce: 0 });
    }
    return room;
}
function fixedGimmick(room, index) {
    const mon = room.monster;
    mon.bossState.gimmickActive = {};
    mon.bossState.hpGimmicks[index].run(room, mon);
    return mon.bossState.events.at(-1);
}
function pattern(room, kind) {
    for (const key of Object.keys(room.monster.bossState.timers)) room.monster.bossState.timers[key] = 999;
    room.monster.bossState.timers[kind] = .2;
    raid.step(room, room.monster, .2);
    return room.monster.bossState.events.at(-1);
}
function tick(room) {
    room.awaitingChoices = false; party.__test.stepRoom(room); room.awaitingChoices = true;
}

test('신규 등록은 기존 운영 값·빈 제작식·상점 식별자를 보존하고 재실행해도 중복되지 않는다', () => {
    const again = appendMansion(data).after;
    assert.deepEqual(again, data);
    const edited = structuredClone(data);
    edited.Equipment.artifact[0].desc = '운영자 설명'; edited.Pet[registration.pets.조각].plusStat.finalAtk = .03;
    edited.Recipe.find(recipe => recipe.name === '[레어]아티팩트').materials = [];
    edited.Shop.레이드[0].price.amount = 99;
    assert.deepEqual(appendMansion(edited).after, edited);
    assert.throws(() => appendMansion({}), /초기화하지 않습니다/);
});

test('10월 등록은 9월 아이템과 운영 구성을 보존하고 자물쇠의 월별 두 항목만 교체한다', () => {
    assert.deepEqual(appendOctober(data).after, data);
    assert.deepEqual(data.Item.slice(0, octoberBefore.Item.length), octoberBefore.Item);
    assert.deepEqual(data.Bundle.slice(0, octoberBefore.Bundle.length), octoberBefore.Bundle);
    const expectedPack = structuredClone(octoberBefore.Pack);
    for (const entry of expectedPack[0]) {
        const name = octoberBefore.Item[entry.item_id]?.name;
        if (name === '[9월]8성 보호카드') entry.item_id = october.gemSetId;
        if (name === '[9월]9성 보호카드') entry.item_id = october.luckyId;
    }
    assert.deepEqual(data.Pack, expectedPack);
    assert.equal(data.Item[october.gemSetId].sellPrice, 60000000);
    assert.equal(data.Item[october.luckyId].sellPrice, 30000000);
    assert.equal(data.Item[october.luckyId].lucky, .3);
    assert.ok(!data.Item[october.gemSetId].no_trade && !data.Item[october.luckyId].no_trade);
    assert.deepEqual(data.Bundle[data.Item[october.gemSetId].pack].map(entry => [data.Item[entry.item_id].name, entry.count]), ['용기의 보석', '희생의 보석', '투지의 보석', '권능의 보석', '지혜의 보석', '인내의 보석'].map(name => [name, 1]));
    const edited = structuredClone(data);
    edited.Bundle[edited.Item[october.packageId].pack] = [];
    edited.Shop.패키지[0].price.amount = 999; edited.Item[october.keyId].desc = '운영자 설명';
    assert.deepEqual(appendOctober(edited).after, edited);
    assert.throws(() => appendOctober({}), /초기화하지 않습니다/);
});

test('옵션 변경열쇠는 등급별 모든 옵션을 추첨하고 재설정 횟수, 골드와 장비 신원을 유지한다', async () => {
    for (const [rarity, count] of Object.entries(artifacts.GRADES)) {
        let user = await reset(); const equip = rpg.grantArtifact(user, rarity);
        equip.artifact.rerollsUsed = 3; equip.tradeUsed = true; equip.tradeCount = 1;
        const old = structuredClone(equip); rpg.addInventoryItem(user, october.keyId, 2); await user.save();
        const started = await request('/api/inventory/items/' + october.keyId + '/use', { count: 1 });
        assert.equal(started.status, 200, JSON.stringify(started)); assert.equal(started.data.pending.type, '아티팩트옵션변경');
        assert.equal(started.data.pending.options[0].artifact.rerollsUsed, 3);
        assert.equal(started.data.pending.options[0].artifact.options.length, count);
        assert.equal(started.data.remainingCount, 2, '대상 적용 전에는 열쇠를 소모하지 않는다');
        const applied = await request('/api/inventory/item-use/resolve', { choice: started.data.pending.options[0].value });
        assert.equal(applied.status, 200, JSON.stringify(applied)); assert.equal(applied.data.pending, null);
        assert.equal(applied.data.remainingCount, 1);
        user = await rpg.getRPGUserByName(user.name); const next = user.inventory.equipment[0];
        assert.equal(next.artifact.options.length, count); assert.equal(new Set(next.artifact.options.map(option => option.type)).size, count);
        assert.ok(next.artifact.options.every(option => artifacts.ABILITIES[option.ability] && option.n >= 1 && option.n <= 10));
        assert.deepEqual({ ...next, artifact: { ...next.artifact, options: old.artifact.options } }, old);
        assert.equal(user.gold, 1000000000); assert.equal(rpg.getInventoryItemCount(user, october.keyId), 1);
        assert.equal(applied.data.result.target.after.artifact.rerollsUsed, 3);
        assert.equal((await request('/api/inventory/item-use/resolve', { choice: 1 })).status, 400);
    }
});

test('옵션 변경은 고정 UID 대상을 선택하며 잘못된 대상, 잠금, 전투와 일괄 사용을 거부하고 취소 시 열쇠를 보존한다', async () => {
    let user = await reset(); rpg.addInventoryItem(user, october.keyId, 2); await user.save();
    assert.equal((await request('/api/inventory/items/' + october.keyId + '/use', {})).status, 400);
    const target = rpg.grantArtifact(user, '유니크'); target.locked = true; await user.save();
    assert.equal((await request('/api/inventory/items/' + october.keyId + '/use', {})).status, 400);
    target.locked = false; await user.save();
    assert.equal((await request('/api/inventory/items/' + october.keyId + '/use', { count: 2 })).status, 400);
    const started = await request('/api/inventory/items/' + october.keyId + '/use', {});
    assert.equal(started.status, 200);
    assert.equal((await request('/api/artifact/reroll', { uid: target.uid, locks: [] })).status, 400);
    assert.equal((await request('/api/inventory/item-use/resolve', { choice: 999 })).status, 400);
    user = await rpg.getRPGUserByName(user.name);
    const other = rpg.grantArtifact(user, '레어'); user.inventory.equipment.reverse(); await user.save();
    const otherOptions = structuredClone(other.artifact);
    const applied = await request('/api/inventory/item-use/resolve', { choice: 1 });
    assert.equal(applied.status, 200); assert.equal(applied.data.result.target.before.artifact.uid, target.uid);
    user = await rpg.getRPGUserByName(user.name); assert.deepEqual(user.inventory.equipment[0].artifact, otherOptions);
    assert.equal((await request('/api/inventory/items/' + october.keyId + '/use', {})).status, 200);
    user = await rpg.getRPGUserByName(user.name); user.field = { name: '테스트 전투' }; await user.save();
    assert.equal((await request('/api/inventory/item-use/resolve', { choice: 1 })).status, 400);
    assert.equal((await request('/api/inventory/item-use/cancel', {})).status, 200);
    user = await rpg.getRPGUserByName(user.name); assert.equal(rpg.getInventoryItemCount(user, october.keyId), 1);
    user.field = null; await user.save();
});

test('옵션 변경 저장 충돌과 동시 적용은 열쇠 소실이나 중복 적용을 만들지 않는다', async () => {
    let user = await reset(); const equip = rpg.grantArtifact(user, '레전더리'); rpg.addInventoryItem(user, october.keyId, 2); await user.save();
    assert.equal((await request('/api/inventory/items/' + october.keyId + '/use', {})).status, 200);
    const old = structuredClone(equip.artifact); failProtectedWrite = true;
    assert.equal((await request('/api/inventory/item-use/resolve', { choice: 1 })).status, 400);
    user = await rpg.getRPGUserByName(user.name);
    assert.deepEqual(user.inventory.equipment[0].artifact, old); assert.equal(rpg.getInventoryItemCount(user, october.keyId), 2); assert.ok(user.pendingAction);
    const requests = await Promise.all([request('/api/inventory/item-use/resolve', { choice: 1 }), request('/api/inventory/item-use/resolve', { choice: 1 })]);
    assert.equal(requests.filter(result => result.status === 200).length, 1);
    user = await rpg.getRPGUserByName(user.name); assert.equal(rpg.getInventoryItemCount(user, october.keyId), 1);
    assert.equal(user.inventory.equipment[0].artifact.rerollsUsed, 0);
});

test('카카오 명령 경로에서도 옵션 변경 대상을 선택하고 취소하거나 적용할 수 있다', async () => {
    let user = await reset(); const equip = rpg.grantArtifact(user, '레전더리'); equip.artifact.rerollsUsed = 2;
    rpg.addInventoryItem(user, october.keyId, 1); await user.save();
    const replies = [];
    let receive;
    const channel = { channelId: 'web-chat:isolated-key', sendChat: text => { replies.push(text); receive(); } };
    const command = async text => {
        const reply = new Promise(resolve => { receive = resolve; });
        assert.equal(await rpg.onChat({ text, getSenderInfo: () => ({ userId: user.id }) }, channel, { getUser: () => rpg.getRPGUserByName(user.name), queueKey: 'isolated-key-command' }), true);
        await reply;
    };
    await command('/RPGenius 사용 아티팩트 옵션 변경열쇠');
    assert.match(replies.at(-1), /선택/);
    await command('/RPGenius 사용취소');
    user = await rpg.getRPGUserByName(user.name); assert.equal(rpg.getInventoryItemCount(user, october.keyId), 1); assert.equal(user.pendingAction, null);
    user = await reset(seeds[1].name); const second = rpg.grantArtifact(user, '레전더리'); second.artifact.rerollsUsed = 2;
    rpg.addInventoryItem(user, october.keyId, 1); await user.save();
    await command('/RPGenius 사용 아티팩트 옵션 변경열쇠'); await command('/RPGenius 선택 1');
    assert.match(replies.at(-1), /옵션 변경 완료/);
    user = await rpg.getRPGUserByName(user.name); assert.equal(rpg.getInventoryItemCount(user, october.keyId), 0);
    assert.equal(user.inventory.equipment[0].artifact.rerollsUsed, 2); assert.equal(user.gold, 1000000000);
});

test('아티팩트패키지는 550포인트로 구성품을 즉시 지급하며 계정 구매 2회와 저장 충돌을 검사한다', async () => {
    let user = await reset(); user.point = 549; user.shopPurchases = {}; await user.save();
    const product = data.Shop.패키지.find(entry => entry.item_id === october.packageId);
    const body = { shopType: '패키지', shopId: product.shopId, count: 1 };
    assert.equal((await request('/api/shop/buy', body)).status, 400);
    user.point = 1100; await user.save(); failProtectedWrite = true;
    assert.equal((await request('/api/shop/buy', body)).status, 400);
    user = await rpg.getRPGUserByName(user.name); assert.equal(user.point, 1100); assert.equal(rpg.getInventoryItemCount(user, october.keyId), 0);
    const attempts = await Promise.all([request('/api/shop/buy', { ...body, count: 2 }), request('/api/shop/buy', { ...body, count: 2 })]);
    assert.equal(attempts.filter(result => result.status === 200).length, 1);
    assert.equal((await request('/api/shop/buy', body)).status, 400);
    user = await rpg.getRPGUserByName(user.name); assert.equal(user.point, 0);
    assert.equal(rpg.getInventoryItemCount(user, october.keyId), 2);
    assert.equal(rpg.getInventoryItemCount(user, data.Item.findIndex(item => item?.name === '황금 주머니')), 40);
    assert.equal(rpg.getInventoryItemCount(user, data.Item.findIndex(item => item?.name === '윷')), 8);
    assert.equal(rpg.getInventoryItemCount(user, october.packageId), 0);
    user.point = 10000; await user.save(); data.Shop.패키지.reverse();
    assert.equal((await request('/api/shop/buy', body)).status, 400); data.Shop.패키지.reverse();
    assert.equal((await rpg.getRPGUserByName(user.name)).point, 10000);
});

test('아티팩트 등급별 조건 종류는 중복 없고, 발현도와 네 임계 보너스가 실제 충족 조건만 누적한다', () => {
    for (const [rarity, count] of Object.entries(artifacts.GRADES)) for (let i = 0; i < 60; i++) {
        const equip = artifacts.create(rarity, 0, [{ name: '빵귤' }, { name: '뭔마' }]);
        assert.equal(equip.artifact.options.length, count);
        assert.equal(new Set(equip.artifact.options.map(option => option.type)).size, count);
        assert.ok(equip.artifact.options.every(option => option.n >= 1 && option.n <= 10));
    }
    const equip = { uid: 'manifest', artifact: { options: [
        { type: 'mainStar', condition: 7, ability: 'hp', n: 10 },
        { type: 'character', condition: 0, ability: 'pnt', n: 10 },
        { type: 'cardType', condition: '일반', ability: 'crit', n: 10 }
    ] } };
    const user = { main_card: { id: 0, star: 6, type: '일반' } };
    const all = artifacts.evaluate(equip, '레전더리', user, {}, () => null);
    assert.equal(all.manifestation, 30); assert.equal(all.values.finalDamage, .08); assert.equal(all.values.finalAtk, .12);
    assert.equal(all.values.extraDamage, .1); assert.equal(all.values.cooldown, .1);
    user.main_card.type = '전직';
    const partial = artifacts.evaluate(equip, '레전더리', user, {}, () => null);
    assert.equal(partial.manifestation, 20); assert.equal(partial.values.cooldown, undefined); assert.equal(partial.values.crit, undefined);
    equip.artifact.options[0].condition = 12;
    assert.equal(artifacts.view(equip, '레전더리', user, {}, () => null, []).options[0].conditionValue, '오메가');
});

test('실제 스탯·장착·프리셋 경로에서 아티팩트는 전용 슬롯이며 최초 장착으로 거래 1회가 소모된다', async () => {
    const user = await reset(); const baseline = rpg.calculateUserStats(user);
    const equip = rpg.grantArtifact(user, '레전더리');
    equip.artifact.options = [
        { type: 'mainStar', condition: 7, ability: 'hp', n: 10 },
        { type: 'character', condition: 0, ability: 'pnt', n: 10 },
        { type: 'cardType', condition: '일반', ability: 'crit', n: 10 }
    ];
    assert.match(rpg.equipItemByNumber(user, 1), /장착/);
    assert.equal(user.equipments.artifact.uid, equip.uid); assert.equal(user.equipments.artifact.tradeCount, 1);
    assert.equal(rpg.equipmentTypeSupportsPotential('artifact'), false);
    const current = rpg.calculateUserStats(user);
    assert.equal(current.hp, Math.round(baseline.hp * 1.1)); assert.equal(current.pnt, Math.round(baseline.pnt * 1.1));
    assert.ok(Math.abs(current.crit - baseline.crit - .1) < 1e-10);
    assert.equal(current.atk, Math.round(baseline.atk * 1.12));
    user.blessings = { rukim: Date.now() - 1000 }; user.hp = current.hp;
    rpg.calculateUserStats(user);
    assert.equal(user.hp, current.hp, '다른 축복이 만료돼도 아티팩트로 늘어난 HP를 잃지 않는다');
    const options = structuredClone(equip.artifact);
    rpg.saveUserPreset(user, 0);
    const number = rpg.getAllUserEquipments(user).findIndex(entry => entry.equip.uid === equip.uid) + 1;
    assert.match(rpg.unequipEquipmentByNumber(user, number), /해제/);
    assert.deepEqual(user.inventory.equipment.find(entry => entry.uid === equip.uid).artifact, options);
    assert.equal(rpg.applyUserPreset(user, 0).ok, true);
    assert.deepEqual(user.equipments.artifact.artifact, options);
    assert.equal(rpg.getEquipmentTradeLimitInfo(user.equipments.artifact).remaining, 0);
});

test('재설정 API는 소유자·변수 잠금·1억 비용·최대 3회 및 동시 요청을 검증한다', async () => {
    let user = await reset(); await reset(seeds[1].name); const equip = rpg.grantArtifact(user, '레전더리'); await user.save();
    assert.equal((await request('/api/artifact/' + equip.uid, undefined, null)).status, 401);
    assert.equal((await request('/api/artifact/' + equip.uid, undefined, seeds[1].name)).status, 404);
    assert.equal((await request('/api/artifact/reroll', { uid: equip.uid, locks: ['0.bad'] })).status, 400);
    const locks = ['0.condition', '0.ability', '0.n', '1.condition', '1.ability', '1.n'];
    const old = structuredClone(equip.artifact.options);
    const result = await request('/api/artifact/reroll', { uid: equip.uid, locks });
    assert.equal(result.status, 200, JSON.stringify(result)); assert.equal(result.data.cost, 100000000);
    user = await rpg.getRPGUserByName(user.name);
    assert.deepEqual(user.inventory.equipment[0].artifact.options.slice(0, 2), old.slice(0, 2)); assert.equal(user.gold, 900000000);
    const concurrent = await Promise.all([request('/api/artifact/reroll', { uid: equip.uid, locks: [] }), request('/api/artifact/reroll', { uid: equip.uid, locks: [] })]);
    assert.ok(concurrent.every(result => result.status === 200)); user = await rpg.getRPGUserByName(user.name); assert.equal(user.inventory.equipment[0].artifact.rerollsUsed, 3); assert.equal(user.gold, 899999800);
    assert.equal((await request('/api/artifact/reroll', { uid: equip.uid, locks: [] })).status, 400);
    assert.ok(writes.some(write => write.ConditionExpression?.includes('attribute_exists(id) AND')));
});

test('저장 충돌 시 재설정 골드·옵션·횟수는 되돌리고 최신 저장 데이터를 복구한다', async () => {
    let user = await reset(); const equip = rpg.grantArtifact(user, '레어'); await user.save();
    const before = structuredClone(equip.artifact); const gold = user.gold;
    failProtectedWrite = true;
    const result = await request('/api/artifact/reroll', { uid: equip.uid, locks: [] });
    assert.equal(result.status, 400); assert.match(result.data.error, /변경|저장/);
    user = await rpg.getRPGUserByName(user.name);
    assert.equal(user.gold, gold); assert.deepEqual(user.inventory.equipment[0].artifact, before);
});

test('제작·꾸러미 지급은 옵션과 UID를 생성하고 분해는 등급에 맞는 아티팩트 재료만 지급한다', async () => {
    const user = await reset(); rpg.addInventoryItem(user, registration.materialId, 300);
    assert.match(rpg.craftRecipeByName(user, '[레전더리]아티팩트', 1), /제작/);
    assert.equal(rpg.getInventoryItemCount(user, registration.materialId), 0);
    const equip = user.inventory.equipment[0]; assert.equal(equip.artifact.options.length, 3);
    const summary = {}; rpg.grantPackReward(user, { type: '아티팩트', artifact_id: registration.artifactIds.레어, count: 2 }, summary);
    assert.equal(new Set(user.inventory.equipment.map(entry => entry.uid)).size, 3);
    user.pendingAction = { type: '장비분해', numbers: [1] }; assert.match(rpg.runDisassemble(user), /분해/);
    const material = rpg.getInventoryItemCount(user, registration.materialId); assert.ok(material >= 45 && material <= 50);
    assert.equal(user.inventory.equipment.length, 2);
});

test('레이드 상점은 파편 탭·계정 1회 상품을 제공하고 재정렬 및 중복 요청으로 제한을 우회할 수 없다', async () => {
    let user = await reset(); rpg.addInventoryItem(user, registration.shardId, 100); await user.save();
    const product = data.Shop.레이드.find(product => product.contentKey === 'mansion-shard-legendary-first');
    const body = { shopType: '레이드', shopId: product.shopId, count: 1 };
    const result = await request('/api/shop/buy', body); assert.equal(result.status, 200, JSON.stringify(result));
    user = await rpg.getRPGUserByName(user.name);
    assert.equal(user.inventory.equipment[0].artifact.options.length, 3); assert.equal(rpg.getInventoryItemCount(user, registration.shardId), 80);
    data.Shop.레이드.reverse();
    assert.equal((await request('/api/shop/buy', body)).status, 400);
    assert.equal(rpg.getInventoryItemCount(user, registration.shardId), 80);
    data.Shop.레이드.reverse();
});

test('세 난이도는 기본 잠금이며 생성·참가·시작 때 모든 참가자의 해금을 검사한다', async () => {
    const user = await reset(); await reset(seeds[1].name);
    for (const id of ['mansionNormal', 'mansionHard', 'mansionNightmare']) assert.match((await party.createRoom(user.name, id)).error, /해금/);
    user.unlockedRaids = ['mansionNormal']; await user.save();
    const created = await party.createRoom(user.name, 'mansionNormal');
    assert.match((await party.joinRoom(created.roomId, seeds[1].name)).error, /해금/);
    user.unlockedRaids = []; await user.save(); party.setReady(user.name, true);
    assert.match((await party.start(user.name)).error, /해금/); party.leaveRoom(user.name);
});

test('파티 준비 API는 레이드 표지, 메인 카드와 물약 이미지를 제공하며 선택한 물약 수량을 유지한다', async () => {
    const user = await reset();
    user.unlockedRaids = ['mansionNightmare'];
    const potionId = data.Item.findIndex(item => item?.name === '상급 체력 포션');
    rpg.addInventoryItem(user, potionId, 5); await user.save();
    assert.equal((await request('/api/party/rooms', { questId: 'mansionNightmare' })).status, 200);
    try {
        const available = await request('/api/party/potions/available');
        const potion = available.data.potions.find(item => item.name === '상급 체력 포션');
        assert.equal(potion.count, 5);
        const image = new URL(potion.iconUrl, base);
        assert.equal(image.searchParams.get('dir'), '소모품');
        assert.equal(image.searchParams.get('file'), '상급 체력 포션.png');
        assert.equal((await request('/api/party/potions', { items: [{ name: potion.name, count: 2 }] })).status, 200);
        const response = await request('/api/party/me');
        assert.equal(response.status, 200);
        const room = response.data.room;
        const definition = quests.find(quest => quest.id === 'mansionNightmare');
        for (const field of ['coverImage', 'minLevel', 'minPlayers', 'maxPlayers', 'recommendedPower']) assert.equal(room.questDef[field], definition[field] ?? null);
        assert.equal(room.members[0].card.star, user.main_card.star);
        assert.ok(room.members[0].card.imageUrl);
        assert.deepEqual(room.members[0].potions, [{ name: potion.name, count: 2, iconUrl: potion.iconUrl }]);
        assert.equal(rpg.getInventoryItemCount(await rpg.getRPGUserByName(user.name), potionId), 5, '준비 단계에서는 인벤토리 물약을 소모하지 않는다');
    } finally { party.leaveRoom(user.name); }
});

test('기둥은 0.5초 조작 간격을 검사하며 공용 하중 6 성공과 노말 피해·하드 전멸을 판정한다', async () => {
    let room = await battle('normal', 2); let event = fixedGimmick(room, 0);
    event.loads = [7, 5, 7, 5];
    assert.equal(raid.action(room, seeds[0].name, { eventId: event.id, action: 'transfer', from: 0, to: 1 }).ok, true);
    assert.match(raid.action(room, seeds[0].name, { eventId: event.id, action: 'transfer', from: 2, to: 3 }).error, /0.5초/);
    assert.equal(raid.action(room, seeds[1].name, { eventId: event.id, action: 'transfer', from: 2, to: 3 }).ok, true);
    assert.equal(room.monster.stunRemain, 6); assert.equal(room.supportGauge, 30);
    const oldId = event.id; room.phaseIndex++; event = fixedGimmick(room, 0); assert.notEqual(event.id, oldId);
    room.monster.bossState.gimmickActive.tick(room, room.monster, 9);
    assert.equal(room.members[0].runtime.hp, 500000);
    room = await battle('hard', 2); fixedGimmick(room, 0); room.monster.bossState.gimmickActive.tick(room, room.monster, 9);
    assert.equal(room.state, 'failed'); assert.ok(room.members.every(member => member.runtime.dead));
});

test('마지막 파티원 전투불능과 기믹 전멸은 3초 연출 시간을 보내며 실패 로그와 재접속 결과를 보존한다', async t => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-03T03:00:00Z') });
    let room = await battle('normal', 2);
    party.__test.applyDamageToMember(room, room.members[0], 99999999, '테스트 공격');
    assert.equal(room.state, 'inProgress');
    party.__test.applyDamageToMember(room, room.members[1], 99999999, '마지막 공격');
    assert.equal(room.state, 'failed');
    const first = party.getMyRoomSnapshot(seeds[0].name);
    assert.equal(first.result.defeatRemainingMs, 3000);
    assert.ok(first.combatLog.some(entry => entry.text.includes('마지막 공격')));
    assert.ok(first.members.every(member => member.runtime.hp === 0 && member.runtime.dead));
    assert.equal((await request('/api/party/attack', {})).status, 400, '연출 중에도 종료된 전투에서 추가 행동은 허용하지 않는다.');
    t.mock.timers.tick(1200);
    const reconnect = party.getMyRoomSnapshot(seeds[1].name);
    assert.equal(reconnect.result.defeatRemainingMs, 1800);
    assert.deepEqual(reconnect.combatLog, first.combatLog);
    t.mock.timers.tick(1800);
    assert.equal(party.getMyRoomSnapshot(seeds[0].name).result.defeatRemainingMs, 0);
    assert.equal(party.restartQuest(seeds[0].name).ok, true);
    for (const member of room.members) party.setReady(member.name, true);
    assert.equal((await party.start(seeds[0].name)).ok, true);
    assert.equal(room.combatLog.length, 0, '재도전의 전투 기록은 새로 시작한다.');
    room = await battle('hard', 2);
    party.__test.wipeParty(room, '기둥 붕괴', '기둥 붕괴로 전원 전투불능');
    const wipe = party.getMyRoomSnapshot(seeds[0].name);
    assert.equal(wipe.result.defeatRemainingMs, 3000);
    assert.ok(wipe.combatLog.some(entry => entry.text === '기둥 붕괴로 전원 전투불능'));
});

test('석재는 본체 HP 대신 피해를 받으며 공대장 판정·75% 히든 지원군·히든 칭호가 연결된다', async () => {
    const room = await battle('hard', 2); const mon = room.monster; const event = fixedGimmick(room, 1); const hp = mon.hp;
    party.__test.applyBossHpDamage(room, mon, 100000); assert.equal(mon.hp, hp); assert.equal(event.damage, 100000);
    assert.match(raid.action(room, seeds[1].name, { eventId: event.id, action: 'finish' }).error, /공대장/);
    room.supportGauge = 100; assert.match(party.useSupportSkill(seeds[1].name, '눈뜬 장님').error, /공대장/);
    assert.equal(party.useSupportSkill(seeds[0].name, '눈뜬 장님').ok, true); assert.equal(event.damage, event.hpMax * .75);
    assert.equal(raid.action(room, seeds[0].name, { eventId: event.id, action: 'finish' }).ok, true);
    await Promise.all(room.pendingTitleGrants); const user = await rpg.getRPGUserByName(seeds[0].name);
    assert.ok(rpg.getUnlockedTitles(user).includes('mansionEyes')); assert.equal(room.monster.bossState.gimmickActive, null);
});

test('석재는 성공 구간 밖에서도 완성 요청을 받아 실패를 판정한다', async () => {
    for (const pct of [.1, .99]) {
        const room = await battle(); const mon = room.monster; const event = fixedGimmick(room, 1);
        event.damage = Math.round(event.hpMax * pct);
        assert.equal(raid.action(room, seeds[0].name, { eventId: event.id, action: 'finish' }).ok, true);
        assert.equal(mon.bossState.outcome.ok, false);
        assert.equal(mon.bossState.gimmickActive, null);
        assert.equal(mon.bossState.events.length, 0);
        assert.equal(room.members[0].runtime.hp, 500000);
    }
});

test('진행 중인 받아쓰기, 수락한 축복, 단단해지기와 조의 의지가 끝난 뒤 체력 기믹을 먼저 시작한다', async () => {
    for (const kind of ['dictation', 'blessing', 'harden', 'burden']) {
        const room = await battle('normal', 2); const mon = room.monster; const event = pattern(room, kind);
        if (kind === 'blessing') raid.action(room, event.target, { eventId: event.id, action: 'accept' });
        if (kind === 'harden') raid.tickEvents(room, mon, 1);
        mon.hp = mon.hpMax * .7; mon.bossState.timers.shards = 0;
        tick(room);
        assert.deepEqual(mon.bossState.events.map(e => e.id), [event.id], kind);
        assert.equal(mon.bossState.gimmickActive, null, kind);
        let ticks = 0;
        while (mon.bossState.events.includes(event) && ticks++ < 45) {
            tick(room);
            assert.ok(mon.bossState.events.length <= 1, kind);
        }
        assert.equal(mon.bossState.events.length, 0, kind);
        tick(room);
        assert.deepEqual(mon.bossState.events.map(e => e.kind), ['pillars'], kind);
        for (let i = 0; i < 5; i++) tick(room);
        assert.deepEqual(mon.bossState.events.map(e => e.kind), ['pillars'], kind);
    }
});

test('조의 의지는 지정 대상 혼자 또는 받쳐준 사람과 피해를 나누며 축복은 5초 미응답 거절·수락 후 8초다', async () => {
    const room = await battle('normal', 2); let event = pattern(room, 'burden');
    assert.equal(raid.view(room.monster).events[0].damage, 18000);
    const target = room.members.find(member => member.name === event.target); raid.tickEvents(room, room.monster, 4);
    assert.equal(target.runtime.hp, 982000);
    assert.equal(room.monster.nextPattern, null);
    for (const member of room.members) member.runtime.hp = 1000000;
    event = pattern(room, 'burden'); const helper = room.members.find(member => member.name !== event.target);
    raid.action(room, helper.name, { eventId: event.id, action: 'support' }); raid.tickEvents(room, room.monster, 4);
    assert.ok(room.members.every(member => member.runtime.hp === 991000));
    event = pattern(room, 'blessing'); raid.tickEvents(room, room.monster, 5);
    assert.ok(!room.monster.bossState.events.includes(event)); assert.equal(target.runtime.buffs.length, 0);
    event = pattern(room, 'blessing');
    assert.equal(raid.action(room, event.target, { eventId: event.id, action: 'accept' }).ok, true); assert.equal(event.remain, 8);
    const blessed = room.members.find(member => member.name === event.target); const hp = blessed.runtime.hp;
    raid.tickEvents(room, room.monster, 8); assert.equal(blessed.runtime.hp, hp - 120000);
});

test('받아쓰기는 오답 이후에도 정해진 글자 수를 입력하며 성공과 실패를 관문 내 누적하고 시간 초과를 판정한다', async () => {
    const room = await battle('hard', 2); const event = pattern(room, 'dictation'); assert.equal(event.sequence.length, 6);
    const wrong = event.sequence[0] === 'a' ? 'b' : 'a';
    raid.action(room, seeds[0].name, { eventId: event.id, action: 'letter', letter: wrong });
    assert.ok(!event.responded.includes(seeds[0].name));
    for (const letter of event.sequence.slice(1)) raid.action(room, seeds[0].name, { eventId: event.id, action: 'letter', letter });
    assert.equal(room.members[0].runtime.mansionDictationTaken, .1);
    for (const letter of event.sequence) raid.action(room, seeds[1].name, { eventId: event.id, action: 'letter', letter });
    assert.equal(room.members[1].runtime.mansionDictationDamage, .1);
    pattern(room, 'dictation'); raid.tickEvents(room, room.monster, 6);
    assert.equal(room.members[0].runtime.mansionDictationTaken, .2);
    assert.equal(room.members[1].runtime.mansionDictationTaken, .1);
    room.monster.hp = 0; tick(room);
    assert.equal(room.phaseIndex, 1); assert.equal(room.members[0].runtime.mansionDictationTaken, 0);
    assert.equal(room.members[1].runtime.mansionDictationDamage, 0);
});

test('잔향 시련은 실제 본체 피해만 기록하며 지원군 제외·보호막 하한·8초 성공 버프를 적용한다', async () => {
    const room = await battle('hard', 1, 1); const mon = room.monster; const event = fixedGimmick(room, 0); const hp = mon.hp;
    party.__test.applyBossHpDamage(room, mon, 100000); party.__test.applyBossHpDamage(room, mon, 650000, 'support');
    assert.equal(mon.hp, hp - 750000); assert.equal(event.recorded, 100000);
    mon.bossState.gimmickActive.tick(room, mon, 8); assert.equal(mon.shield, 600000); const bodyHp = mon.hp;
    room.supportGauge = 100; assert.equal(party.useSupportSkill(seeds[0].name, '피카츄').ok, true);
    assert.equal(mon.shield, 0); assert.equal(mon.hp, bodyHp);
    mon.bossState.gimmickActive.tick(room, mon, .2);
    const buff = room.members[0].runtime.buffs.find(buff => buff.id === 'mansionTrial');
    assert.equal(buff.remain, 8); assert.equal(buff.value, .2); assert.equal(mon.stunRemain, 8); assert.equal(room.supportGauge, 30);
});

test('맥동 제어와 봉인 역전은 반대 답이며 타인이 입력할 수 없고 실패 피해는 난이도별이다', async () => {
    const room = await battle('normal', 2, 1); const event = pattern(room, 'pulse');
    const other = room.members.find(member => member.name !== event.target);
    assert.match(raid.action(room, other.name, { eventId: event.id, action: 'absorb' }).error, /지정 대상/);
    const correct = event.pulse === 'gather' ? 'release' : 'absorb';
    raid.action(room, event.target, { eventId: event.id, action: correct }); assert.equal(room.monster.stunRemain, 3);
    room.monster.stunRemain = 0; const failed = pattern(room, 'pulse');
    raid.action(room, failed.target, { eventId: failed.id, action: failed.pulse === 'gather' ? 'absorb' : 'release' });
    assert.ok(room.members.every(member => member.runtime.hp === 750000));
});

test('본체 1HP 전환은 실제 tick에서 4초 동결 후 잔향으로 진행하고 봉인 역전은 그로기·사망자 순서를 반영한다', async () => {
    const room = await battle('hard', 3, 1); const mon = room.monster; const member = room.members[0];
    member.runtime.cooldownsUntil = { test: Date.now() + 10000 }; member.runtime.buffs = [{ id: 'pause-test', remain: 7 }];
    const cooldown = member.runtime.cooldownsUntil.test; const enrage = mon.enrageRemain;
    party.__test.applyBossHpDamage(room, mon, mon.hpMax); assert.equal(mon.bossState.form, 'transition');
    assert.match(party.useSupportSkill(seeds[0].name, '피카츄').error, /카운트다운/);
    for (let i = 0; i < 19; i++) tick(room);
    assert.equal(mon.bossState.form, 'transition'); assert.equal(mon.enrageRemain, enrage); assert.equal(member.runtime.buffs[0].remain, 7);
    tick(room); assert.equal(mon.bossState.form, 'echo'); assert.equal(mon.hpMax, 4000000); assert.equal(mon.enrageRemain, 60);
    assert.equal(member.runtime.cooldownsUntil.test, cooldown + 4000); assert.equal(room.supportGauge, 20);
    mon.stunRemain = 20; raid.step(room, mon, 10);
    let event = mon.bossState.events.find(event => event.kind === 'inversion'); assert.equal(event.target, seeds[0].name);
    raid.action(room, event.target, { eventId: event.id, action: event.pulse === 'gather' ? 'absorb' : 'release' });
    assert.equal(mon.hp, 3600000); room.members[1].runtime.dead = true;
    raid.step(room, mon, 12); event = mon.bossState.events.find(event => event.kind === 'inversion'); assert.equal(event.target, seeds[2].name);
});

test('봉인 역전 중에는 잔향 파열을 대기시키고 울리는 벽 표시 중에도 다른 패턴을 시작하지 않는다', async () => {
    let room = await battle('hard', 2, 1); let mon = room.monster;
    party.__test.applyBossHpDamage(room, mon, mon.hpMax); raid.transition(room, 4);
    mon.bossState.echoElapsed = 9.8; mon.bossState.echoTimer = .2;
    const hp = room.members.map(member => member.runtime.hp);
    raid.step(room, mon, .2);
    assert.deepEqual(mon.bossState.events.map(e => e.kind), ['inversion']);
    assert.deepEqual(room.members.map(member => member.runtime.hp), hp);
    raid.step(room, mon, .2);
    assert.deepEqual(mon.bossState.events.map(e => e.kind), ['inversion']);
    assert.deepEqual(room.members.map(member => member.runtime.hp), hp);
    const event = mon.bossState.events[0];
    raid.action(room, event.target, { eventId: event.id, action: event.pulse === 'gather' ? 'absorb' : 'release' });
    raid.step(room, mon, .2);
    assert.deepEqual(mon.bossState.events.map(e => e.kind), ['rupture']);
    assert.equal(raid.view(mon).events[0].message, '...');
    assert.ok(room.members.every((member, i) => member.runtime.hp < hp[i]));

    room = await battle('normal', 2, 1); mon = room.monster;
    const wall = pattern(room, 'wall'); mon.bossState.timers.echo = 0;
    assert.equal(raid.view(mon).events[0].message, '우우웅.... 위잉....');
    raid.step(room, mon, .2);
    assert.deepEqual(mon.bossState.events.map(e => e.id), [wall.id]);
    raid.step(room, mon, 1.3);
    assert.equal(mon.bossState.events.length, 0);
    raid.step(room, mon, .2);
    assert.deepEqual(mon.bossState.events.map(e => e.kind), ['echo']);
});

test('클리어로 다음 난이도를 해금하지 않으며 통합 주간 보상과 칭호 진행을 중복 없이 저장한다', async () => {
    const room = await battle(); room.state = 'cleared'; room.result = {};
    let user = await rpg.getRPGUserByName(seeds[0].name); const gold = user.gold;
    await Promise.all([party.__test.grantPartyQuestClearRewards(room), party.__test.grantPartyQuestClearRewards(room)]);
    user = await rpg.getRPGUserByName(user.name);
    assert.equal(user.gold, gold + 60000000); assert.equal(user.inventory.equipment.length, 3);
    assert.deepEqual(user.unlockedRaids, ['mansionNormal']); assert.equal(user.titleProgress.mansionClears, 1);
    const second = { ...room, questId: 'mansionHard', rewardPromise: null, result: {} };
    await party.__test.grantPartyQuestClearRewards(second);
    user = await rpg.getRPGUserByName(user.name);
    assert.equal(user.gold, gold + 60000000); assert.equal(second.result.rewards[0].weeklyLocked, true);
    assert.deepEqual(user.unlockedRaids, ['mansionNormal']); assert.equal(user.titleProgress.mansionClears, 2);
    assert.ok(rpg.getUnlockedTitles(user).includes('mansionBlessing'));
    for (let i = 0; i < 3; i++) await party.__test.grantPartyQuestClearRewards({ ...room, rewardPromise: null, result: {} });
    user = await rpg.getRPGUserByName(user.name);
    assert.ok(rpg.getUnlockedTitles(user).includes('mansionMaster'));
    assert.ok(!rpg.getUnlockedTitles(user).includes('mansionFirstClear'));
});

test('레이드별 퀘스트 조건은 모든 난이도를 합산하고 주간 보상 제한과 무관하게 저장한다', async () => {
    const room = await battle();
    const objectives = [
        { type: 'partyClear', quest: '흑화 호두 (난이도 상관 없이)', count: 10 },
        { type: 'partyClear', quest: '부타게임 (난이도 상관 없이)', count: 10 },
        { type: 'partyClear', quest: 'E세계대저택 (난이도 상관 없이)', count: 10 },
        { type: 'partyClear', quest: 'E세계대저택', count: 10 }
    ];
    rpg.__setQuestDefs([{ id: 951, name: '레이드 클리어 테스트', categories: ['일반'], minLevel: 1, objectives, rewards: [] }]);
    try {
        let user = await rpg.getRPGUserByName(seeds[0].name);
        assert.equal(rpg.recordQuestEvent(user, 'partyJoin', { questId: 'mansionNormal' }), false);
        assert.equal(rpg.recordQuestEvent(user, 'partyClear', { questId: 'otherRaid', quest: '다른 레이드' }), false);
        assert.equal(rpg.recordQuestEvent(user, 'partyClear', { quest: '흑화 호두' }), false, '이름만 같은 다른 전투는 집계하지 않는다');
        await party.__test.grantPartyQuestClearRewards(room);
        assert.deepEqual(user.quests[951]?.counters || {}, {}, '진행 중인 레이드는 클리어로 집계하지 않는다');
        const week = rpg.getKoreanWeekKey(new Date());
        Object.assign(user.titleProgress, { hoduRewardWeek: week, hoduRewardCount: 3, butaRewardWeek: week, mansionRewardWeek: week });
        await user.save();
        room.state = 'cleared'; room.result = {};
        await Promise.all([party.__test.grantPartyQuestClearRewards(room), party.__test.grantPartyQuestClearRewards(room)]);
        user = await rpg.getRPGUserByName(user.name);
        assert.deepEqual(user.quests[951].counters, { 2: 1, 3: 1 }, '중복 지급 요청은 퀘스트도 한 번만 집계한다');
        for (const questId of ['blackHodu', 'blackHoduExtreme', 'butaGame', 'butaGameHard', 'mansionHard', 'mansionNightmare']) {
            const cleared = { ...room, questId, rewardPromise: null, result: {} };
            await party.__test.grantPartyQuestClearRewards(cleared);
            assert.equal(cleared.result.rewards[0].weeklyLocked, questId !== 'mansionNightmare');
        }
        user = await rpg.getRPGUserByName(user.name);
        assert.deepEqual(user.quests[951].counters, { 0: 2, 1: 2, 2: 3, 3: 1 });
        const board = await request('/api/quests');
        assert.equal(board.status, 200);
        const view = board.data.list.find(quest => quest.id === 951);
        assert.deepEqual(view.objectives.map(objective => objective.current), [2, 2, 3, 1]);
        assert.deepEqual(view.objectives.slice(0, 3).map(objective => objective.label), objectives.slice(0, 3).map(objective => '파티 퀘스트 클리어 — ' + objective.quest));
        assert.equal((await request('/api/lookup/quest-targets')).status, 401);
        const targets = await request('/api/lookup/quest-targets', undefined, seeds[0].name, true);
        assert.equal(targets.status, 200);
        assert.deepEqual(targets.data.partyQuestClearGroups, objectives.slice(0, 3).map(objective => objective.quest));
        assert.deepEqual(targets.data.partyQuests, quests.map(quest => quest.name));
    } finally { rpg.__setQuestDefs([]); }
});

test('나이트메어는 최초 보상만 한 번 지급하고 주가 바뀌어도 후속 보상이 없으며 노말과 하드의 기회를 소모하지 않는다', async t => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-03T03:00:00Z') });
    const room = await battle('nightmare', 1, 1); room.state = 'cleared'; room.result = {};
    t.mock.method(Math, 'random', () => 0);
    let user = await rpg.getRPGUserByName(seeds[0].name); const gold = user.gold;
    await Promise.all([party.__test.grantPartyQuestClearRewards(room), party.__test.grantPartyQuestClearRewards(room)]);
    user = await rpg.getRPGUserByName(user.name);
    assert.equal(user.gold, gold); assert.equal(user.inventory.equipment.length, 2);
    assert.equal(user.inventory.equipment.filter(equip => rpg.getEquipmentData('artifact', equip.id).rarity === '레전더리').length, 2);
    assert.equal(rpg.getInventoryItemCount(user, registration.shardId), 50); assert.equal(user.garnet, 3000);
    assert.ok(user.titleProgress.mansionNightmareFirst); assert.ok(rpg.getUnlockedTitles(user).includes('mansionNightmare'));
    assert.equal(user.titleProgress.mansionRewardWeek, undefined);
    assert.ok(!rpg.getUnlockedTitles(user).includes('mansionFirstClear'));
    assert.ok(room.result.rewards[0].firstClear); assert.deepEqual(room.result.rewards[0].items, []);
    assert.equal(room.result.rewards[0].item, null);
    const received = structuredClone(user.inventory);
    const second = { ...room, rewardPromise: null, result: {} };
    await party.__test.grantPartyQuestClearRewards(second);
    assert.equal(second.result.rewards[0].firstClear, null); assert.equal(second.result.rewards[0].weeklyLocked, false);
    user = await rpg.getRPGUserByName(user.name);
    assert.deepEqual(user.inventory, received); assert.equal(user.titleProgress.mansionClears, 2);
    t.mock.timers.tick(7 * 86400000);
    const third = { ...room, rewardPromise: null, result: {} }; await party.__test.grantPartyQuestClearRewards(third);
    user = await rpg.getRPGUserByName(user.name);
    assert.deepEqual(user.inventory, received); assert.equal(user.gold, gold); assert.equal(user.garnet, 3000);
    assert.equal(third.result.rewards[0].firstClear, null); assert.equal(third.result.rewards[0].item, null);
    await party.__test.grantPartyQuestClearRewards({ ...room, questId: 'mansionNormal', rewardPromise: null, result: {} });
    user = await rpg.getRPGUserByName(user.name);
    assert.equal(user.gold, gold + 60000000); assert.equal(user.inventory.equipment.length, 5);
    const hard = { ...room, questId: 'mansionHard', rewardPromise: null, result: {} };
    await party.__test.grantPartyQuestClearRewards(hard);
    assert.equal(hard.result.rewards[0].weeklyLocked, true);
});

test('이미 주간 보상을 받은 계정의 나이트메어 최초 보상은 주간 보상과 독립적으로 지급된다', async () => {
    const room = await battle('nightmare', 1, 1); room.state = 'cleared'; room.result = {};
    let user = await rpg.getRPGUserByName(seeds[0].name); const gold = user.gold;
    user.titleProgress.mansionRewardWeek = rpg.getKoreanWeekKey(new Date()); await user.save();
    await party.__test.grantPartyQuestClearRewards(room);
    user = await rpg.getRPGUserByName(user.name);
    assert.equal(user.gold, gold); assert.equal(user.inventory.equipment.length, 2); assert.equal(room.result.rewards[0].weeklyLocked, false);
    assert.equal(rpg.getInventoryItemCount(user, registration.shardId), 50); assert.equal(user.garnet, 3000);
    assert.equal(user.titleProgress.mansionRewardWeek, rpg.getKoreanWeekKey(new Date()));
});

test('카드 추가 보상은 문서 성급과 유효한 일반·전직·각성 캐릭터를 지급하며 투신 포션은 최종 공격력을 올린다', async () => {
    const user = await reset(); const summary = {};
    for (const id of ['mansionNormal', 'mansionHard']) for (const entry of quests.find(quest => quest.id === id).rewards.bonus.filter(entry => entry.type === '캐릭터카드')) {
        const result = party.__test.grantPartyQuestPackReward(user, entry, summary); assert.equal(result.card.star + 1, entry.display_star);
    }
    const atk = rpg.calculateUserStats(user).atk;
    rpg.addInventoryItem(user, registration.potionId, 1);
    assert.match(await rpg.useItem(user, '투신의 함성 포션', '1'), /사용/);
    assert.equal(rpg.calculateUserStats(user).atk, Math.round(atk * 1.25));
});

test('시련 보호막의 상한·하한과 실패 판정은 노말·하드·나이트메어에 각각 적용된다', async () => {
    for (const [difficulty, maximum, minimum, failHp] of [['normal', 900000, 350000, 400000], ['hard', 1600000, 600000, 0], ['nightmare', 2700000, 1000000, 0]]) {
        const room = await battle(difficulty, 1, 1), mon = room.monster;
        let event = fixedGimmick(room, 0); event.recorded = 100000000;
        mon.bossState.gimmickActive.tick(room, mon, 8); assert.equal(mon.shield, maximum);
        party.__test.endBossGimmick(mon); mon.bossState.events = []; party.__test.clearBossShield(mon);
        event = fixedGimmick(room, 1); mon.bossState.gimmickActive.tick(room, mon, 8); assert.equal(mon.shield, minimum);
        mon.bossState.gimmickActive.tick(room, mon, event.duration);
        assert.equal(room.members[0].runtime.hp, failHp);
        assert.equal(room.state, difficulty === 'normal' ? 'inProgress' : 'failed');
    }
});

test('단단해지기는 축복 직후를 피하고 막은 피해만큼 회복하며 석재 파괴는 실패다', async () => {
    let room = await battle(); const mon = room.monster; mon.hp = 5000000;
    mon.bossState.blessingAt = mon.bossState.elapsed;
    assert.equal(pattern(room, 'harden'), undefined);
    mon.bossState.elapsed += 8; raid.step(room, mon, .2);
    const harden = mon.bossState.events.find(event => event.kind === 'harden'); assert.ok(harden);
    raid.tickEvents(room, mon, 1); assert.equal(harden.stage, 'active');
    assert.equal(party.__test.applyBossHpDamage(room, mon, 1000000), 400000); assert.equal(mon.hp, 5200000);
    room = await battle(); const stone = fixedGimmick(room, 1); const hp = room.monster.hp;
    party.__test.applyBossHpDamage(room, room.monster, stone.hpMax);
    assert.equal(room.monster.hp, hp); assert.equal(room.members[0].runtime.hp, 500000);
    assert.equal(room.monster.bossState.outcome.ok, false);
});

test('레이드 보상은 티켓, 가챠, 카드, 펫과 아티팩트의 이미지 경로를 제공한다', async () => {
    const room = await battle('nightmare'); room.state = 'cleared'; room.result = { cleared: true };
    mock.method(Math, 'random', () => .6);
    try { await party.__test.grantPartyQuestClearRewards(room); } finally { mock.restoreAll(); }
    const reward = room.result.rewards[0];
    const all = [...reward.items, ...reward.firstClear.rewards];
    const normal = { ...room, questId: 'mansionNormal', rewardPromise: null, result: {} };
    mock.method(Math, 'random', () => .6);
    try { await party.__test.grantPartyQuestClearRewards(normal); } finally { mock.restoreAll(); }
    all.push(...normal.result.rewards[0].items);
    const user = await rpg.getRPGUserByName(seeds[0].name);
    all.push(party.__test.grantPartyQuestPackReward(user, { type: '캐릭터카드', card_id: 0, display_star: 7, card_type: '일반', count: 1 }, {}));
    all.push(party.__test.grantPartyQuestPackReward(user, { type: '펫', pet_name: '조각', count: 1 }, {}));
    const ticket = all.find(item => item.name === '헬 도전장');
    const box = all.find(item => item.name === '초월 상자');
    assert.equal(new URL(ticket.iconUrl, base).searchParams.get('dir'), '티켓');
    assert.equal(new URL(box.iconUrl, base).searchParams.get('dir'), '가챠');
    assert.ok(all.find(item => item.kind === 'card')?.iconUrl);
    assert.ok(all.find(item => item.kind === 'pet')?.iconUrl);
    for (const url of all.map(item => item.iconUrl).filter(Boolean)) assert.match(new URL(url, base).pathname, /^\/((item|card)-image|rpg-ui-title)$/);
    assert.equal(new URL(all.find(item => item.kind === 'pet').iconUrl, base).searchParams.get('dir'), '펫');
});

test('두 펫과 최종 공격력 정보 표시는 지정 효과를 반영하고 레이드 투신 포션은 중첩 없이 지속시간을 연장한다', async () => {
    const user = await reset(); const baseline = rpg.calculateUserStats(user);
    user.equipments.pet = [{ id: registration.pets.조각, level: 0 }];
    assert.equal(rpg.calculateUserStats(user).atk, Math.round(baseline.atk * 1.01));
    user.equipments.pet = [{ id: registration.pets.위플래쉬, level: 0 }];
    assert.ok(Math.abs(rpg.calculateUserStats(user).gold - baseline.gold - .1) < 1e-10);
    user.equipments.pet = [{ id: registration.pets.조각, level: 0 }]; await user.save();
    const profile = (await request('/api/profile')).data;
    assert.ok(profile.statGroups.flatMap(group => group.items).some(item => item.label === '최종 공격력 증가' && item.value === '1%'));
    const room = await battle(); const member = room.members[0]; member.baseSnapshot.stats.atk = 1000;
    member.potions = [{ name: '투신의 함성 포션', count: 2 }];
    assert.equal((await party.usePotion(member.name, '투신의 함성 포션')).ok, true); assert.equal(member.baseSnapshot.stats.atk, 1250);
    member.runtime.potionUntil = 0;
    assert.equal((await party.usePotion(member.name, '투신의 함성 포션')).ok, true);
    const buff = member.runtime.buffs.find(buff => buff.id === 'battleCry'); assert.equal(buff.remain, 120); assert.equal(member.baseSnapshot.stats.atk, 1250);
    buff.remain = .2; tick(room); assert.equal(member.baseSnapshot.stats.atk, 1000);
});
