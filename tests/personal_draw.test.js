'use strict';

const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const AWS = require('aws-sdk');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { PETS, DEFAULT_CONFIG, appendContent } = require('../personal_draw_content');
const { newBoard, planShake, validateConfig } = require('../personal_draw_event');
const autoPotion = require('../pet_auto_potion');

// 실제 게임/HTTP 서버를 사용하며 AWS 경계만 격리한다. 환경 파일/운영 DB 쓰기 없음.
const seed = { id: 'personal-draw-test', name: '퍼스널테스트', code: 'DRAW-TEST-ONLY', _get: 1, avatarMigrated: true, logged_in: [], logged_in_agent: [], need_character_card_select: false };
let failWrites = false, writes = [];
AWS.S3.prototype.makeRequest = operation => {
    if (operation === 'listObjectsV2') return { promise: async () => ({ Contents: [] }) };
    throw new Error('Unexpected isolated S3 operation: ' + operation);
};
DynamoDBDocumentClient.prototype.send = async command => {
    const input = command.input;
    if (command.constructor.name === 'GetCommand') {
        if (input.TableName !== 'rpgenius_data') return {};
        const file = path.join(__dirname, '../DB/RPGenius', input.Key.key + '.json');
        return { Item: { key: input.Key.key, data: fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [] } };
    }
    if (command.constructor.name === 'ScanCommand') return { Items: input.TableName === 'rpgenius_user' ? [structuredClone(seed)] : [] };
    if (['UpdateCommand', 'PutCommand', 'TransactWriteCommand'].includes(command.constructor.name)) {
        if (failWrites && input.TableName === 'rpgenius_user') throw new Error('isolated personal draw save failure');
        writes.push(structuredClone(input)); return {};
    }
    throw new Error('Unexpected isolated DB command: ' + command.constructor.name);
};
const rpg = require('../rpgenius');
const party = require('../partyquest');
const startServer = require('../server');
let server, base, cookie;
const petId = name => rpg.getDataCache('Pet').findIndex(pet => pet?.name === '유의게임X ' + name);
const itemId = name => rpg.getDataCache('Item').findIndex(item => item?.name === name);
const body = (revision, expectedCost = 300, extra = {}) => ({ revision, expectedCost, requestId: crypto.randomUUID(), ...extra });
async function request(action = '', data, authenticated = true, prefix = '/api/personal-draw') {
    const response = await fetch(base + prefix + (action ? '/' + action : ''), { method: data ? 'POST' : 'GET', headers: { ...(authenticated ? { Cookie: cookie } : {}), ...(data ? { 'Content-Type': 'application/json' } : {}) }, body: data ? JSON.stringify(data) : undefined });
    return { status: response.status, data: await response.json() };
}
async function setUser(changes) { const user = await rpg.getRPGUserByName(seed.name); Object.assign(user, changes); await user.save(); return user; }
async function fixedRandom(value, run) {
    const original = crypto.randomInt;
    crypto.randomInt = max => max === 0x100000000 ? Math.floor(value * max) : original(max);
    try { return await run(); } finally { crypto.randomInt = original; }
}
before(async () => {
    await rpg.initRpgeniusData(); process.env.PORT = '0'; server = startServer();
    await new Promise(resolve => server.on('listening', resolve)); base = 'http://127.0.0.1:' + server.address().port;
    const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: seed.name, code: seed.code }) });
    assert.equal(login.status, 200); cookie = login.headers.get('set-cookie').split(';')[0];
});
beforeEach(async () => {
    party.leaveRoom(seed.name);
    failWrites = false; Object.assign(rpg.getDataCache('PersonalDraw'), structuredClone(DEFAULT_CONFIG));
    await setUser({ point: 50000, gold: 100000000, personalDraw: null, field: null, pendingAction: null, pendingFragment: null, autoPotion: null, autoPotionAt: 0,
        main_card: { id: 0, star: 6, type: '일반' }, equipments: { pet: [] }, hp: 1, mp: 1,
        inventory: { item: [], card: [], pet: [], equipment: [] } }); writes = [];
});
after(() => { party.leaveRoom(seed.name); return new Promise(resolve => server.close(resolve)); });

test('신규 콘텐츠만 추가하고 기존 운영 항목/빈 제작식/인덱스는 보존한다', () => {
    const current = { Pet: [{ ...PETS[0], desc: '운영 수정' }], Item: [{ name: '지나의 축복', desc: '운영 수정' }], Recipe: [{ name: PETS[0].name, materials: [], crafted: [] }], PersonalDraw: { active: false } };
    const snapshot = structuredClone(current), next = appendContent(current);
    assert.deepEqual(current, snapshot); assert.deepEqual(next.Pet[0], current.Pet[0]); assert.deepEqual(next.Item[0], current.Item[0]);
    assert.deepEqual(next.Recipe[0], current.Recipe[0]); assert.deepEqual(next.PersonalDraw, current.PersonalDraw);
    assert.equal(next.Pet.length, 20); assert.equal(next.Recipe.length, 20); assert.deepEqual(appendContent(next), next);
    for (const recipe of next.Recipe.slice(1)) assert.equal(next.Pet[recipe.crafted[0].pet_id].name, recipe.name);
});
test('100칸 구성과 추가 독립시행은 남은 칸까지만 적용한다', () => {
    assert.equal(newBoard(DEFAULT_CONFIG, () => .5).cells.length, 100);
    assert.equal(planShake(Array.from({ length: 100 }, (_, i) => i), () => 0).indices.length, 100);
    assert.equal(planShake([0, 1, 2], () => 0).baseCount, 3);
    const full = planShake(Array.from({ length: 99 }, (_, i) => i), () => 0);
    assert.equal(new Set(full.indices).size, 99);
    let rolls = 0; assert.equal(planShake(Array.from({ length: 20 }, (_, i) => i), () => ++rolls <= 2 ? .1 : .9).indices.length, 7);
    assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, singleCost: -1 }));
});
test('인증과 이벤트 메뉴, 조회는 쓰기 없이 숨겨진 칸을 비공개로 유지한다', async () => {
    assert.equal((await request('', undefined, false)).status, 401);
    const result = await request(); assert.equal(result.data.remaining, 100); assert.equal(result.data.rewards.length, 6);
    assert.equal(result.data.board, undefined); assert.equal(result.data.cells, undefined); assert.equal(writes.length, 0);
    const html = await (await fetch(base + '/', { headers: { Cookie: cookie } })).text(); assert.match(html, /data-page="퍼스널뽑기"/);
});
test('단일 개봉 300P, 거래 가능한 재료 지급, 요청 재전송/오래된 판은 중복 지급하지 않는다', async () => {
    await setUser({ personalDraw: { revision: 0, board: newBoard(DEFAULT_CONFIG, () => .999), lastAction: null } });
    const input = body(0, 300, { index: 0 });
    const result = await request('single', input); assert.equal(result.status, 200);
    assert.equal(result.data.point, 49700); assert.equal(result.data.remaining, 99); assert.equal(result.data.opened[0].name, '유리사의 잔상');
    assert.equal((await request('single', input)).data.replayed, true);
    assert.equal((await request('single', body(0, 300, { index: 1 }))).status, 409);
    assert.equal((await request('single', body(1, 300, { index: 0 }))).status, 400);
    const user = await rpg.getRPGUserByName(seed.name); assert.equal(rpg.getInventoryItemCount(user, itemId('유리사의 잔상')), 1);
    assert.equal(rpg.getBoundItemCount(user, itemId('유리사의 잔상')), 0);
});
test('동시 뽑기, 잘못된 비용/좌표, 잔액 부족 요청은 추가 차감하지 않는다', async () => {
    assert.equal((await request('single', body(0, 0, { index: 0 }))).status, 409);
    assert.equal((await request('single', body(0, 300, { index: -1 }))).status, 400);
    const results = await Promise.all([request('single', body(0, 300, { index: 0 })), request('single', body(0, 300, { index: 1 }))]);
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    assert.equal((await request()).data.point, 49700);
    await setUser({ point: 299 }); assert.equal((await request('single', body(1, 300, { index: 2 }))).status, 400);
    assert.equal((await request()).data.remaining, 99);
});
test('5칸 1500P와 무제한 추가 추첨, 정확한 전체 지급량, 기존 펫 거래횟수 적용', async () => {
    let result = await fixedRandom(.9, () => request('shake', body(0, 1500)));
    assert.equal(result.status, 200); assert.equal(result.data.lastAction.results.length, 5); assert.equal(result.data.point, 48500);
    await setUser({ personalDraw: null, point: 50000, inventory: { item: [], pet: [], card: [], equipment: [] } });
    result = await fixedRandom(0, () => request('shake', body(0, 1500)));
    assert.equal(result.status, 200); assert.equal(result.data.remaining, 0); assert.equal(result.data.lastAction.results.length, 100);
    assert.equal(result.data.lastAction.results.filter(r => r.bonus).length, 95);
    assert.equal(result.data.rewards.every(r => r.remaining === 0), true);
    const user = await rpg.getRPGUserByName(seed.name);
    assert.equal(user.inventory.pet.length, 15); assert.ok(user.inventory.pet.every(pet => pet.tradeCount === 1 && !pet.expireAt));
    assert.equal(rpg.getInventoryItemCount(user, itemId('지나의 축복')), 100); assert.equal(rpg.getInventoryItemCount(user, itemId('유리사의 잔상')), 1);
    assert.equal((await request('shake', body(1, 1500))).status, 400);
});
test('무료 새로고침은 보상/포인트를 보존하고 재고 100칸만 복원한다', async () => {
    await request('single', body(0, 300, { index: 0 }));
    const beforeUser = await rpg.getRPGUserByName(seed.name), before = structuredClone(beforeUser.inventory);
    const result = await request('refresh', body(1, 0)); assert.equal(result.status, 200); assert.equal(result.data.remaining, 100); assert.equal(result.data.point, 49700);
    assert.deepEqual((await rpg.getRPGUserByName(seed.name)).inventory, before);
    assert.equal((await request('single', body(1, 300, { index: 1 }))).status, 409);
});
test('저장 실패 후 같은 요청을 재시도해도 차감/보상은 한 번뿐이다', async () => {
    const input = body(0, 300, { index: 0 }); failWrites = true;
    const failed = await request('single', input); assert.equal(failed.status, 503); assert.equal(failed.data.retry, true);
    failWrites = false;
    const replay = await request('single', input); assert.equal(replay.status, 200); assert.equal(replay.data.replayed, true);
    assert.equal(replay.data.point, 49700); assert.equal(replay.data.remaining, 99);
});
test('현재 판은 운영 설정 변경에도 보존되고 다음 판부터 새 설정을 사용한다', async () => {
    await request('single', body(0, 300, { index: 0 }));
    const config = rpg.getDataCache('PersonalDraw'); config.rewards[4].stock = 20; config.rewards[5].stock = 64;
    assert.equal((await request()).data.rewards.find(r => r.id === 'blessing2').stock, 16);
    assert.equal((await request('refresh', body(1, 0))).data.rewards.find(r => r.id === 'blessing2').stock, 20);
});
test('신규 펫 20종 제작은 등급별 재료를 정확히 소모하고 기본 펫을 지급한다', async () => {
    const user = await rpg.getRPGUserByName(seed.name);
    for (const pet of PETS) {
        const material = pet.rarity === '고유' ? '유리사의 잔상' : '지나의 축복';
        const amount = { 고유: 3, 레전더리: 200, 유니크: 50, 레어: 20 }[pet.rarity];
        rpg.addInventoryItem(user, itemId(material), amount);
        const result = rpg.craftRecipeByName(user, pet.name, 1); assert.doesNotMatch(result, /❌/);
        assert.equal(rpg.getInventoryItemCount(user, itemId(material)), 0);
        assert.equal(rpg.getPetData(user.inventory.pet.at(-1).id).name, pet.name); assert.equal(user.inventory.pet.at(-1).tradeCount, 1);
    }
});
test('유의게임X 세트와 특수효과는 장착 중에 적용되고 만료되면 제외된다', async () => {
    const user = await rpg.getRPGUserByName(seed.name);
    user.equipments.pet = ['유리사', '겨울', '한국인의밥상'].map(name => ({ id: petId(name), level: 0, expireAt: Date.now() + 100000 }));
    assert.equal(rpg.getActivePetSpecials(user).cardCombineBonus, .02); assert.equal(rpg.getActivePetSpecials(user).autoFragment, 1);
    const set = rpg.getActivePetSetEffects(user).find(set => set.name === '유의게임X'); assert.equal(set.count, 3);
    assert.deepEqual(set.applied[2].effect.plusStat, { exp: .05, itemDropChance: .05 });
    user.equipments.pet[0].expireAt = 1; assert.equal(rpg.getActivePetSpecials(user).cardCombineBonus, 0);
});
test('유리사 확률은 럭키 카드 곱연산 뒤 2%p 합산한다', async () => {
    const user = await rpg.getRPGUserByName(seed.name), info = rpg.getCardCombineInfo(5);
    user.equipments.pet = [{ id: petId('유리사'), expireAt: Date.now() + 100000 }];
    const luckyId = rpg.getDataCache('Item').findIndex(item => Number(item?.lucky) === .1);
    assert.ok(luckyId >= 0);
    for (const [offset, success] of [[.019, true], [.021, false]]) {
        user.inventory.card = [0, 1, 2].map(id => ({ id, star: 5, type: '일반' }));
        user.cardCombineCounts = {}; rpg.addInventoryItem(user, luckyId, 1);
        user.pendingAction = { type: '카드조합', numbers: [1, 2, 3], luckyRate: .1 };
        const original = Math.random; Math.random = () => info.rate * 1.1 + offset;
        try { rpg.runCardCombine(user); } finally { Math.random = original; }
        assert.equal(user.inventory.card.some(card => card.star === 6), success);
    }
});
test('자동 물약 설정 API는 장착 권한과 유효한 물약/기준을 확인한다', async () => {
    const hpId = rpg.getDataCache('Item').findIndex(item => autoPotion.supports(item, 'hp'));
    const config = { hp: { enabled: true, threshold: 50, itemId: hpId }, mp: { enabled: false, threshold: 50, itemId: null } };
    assert.equal((await request('', config, true, '/api/pet/auto-potion')).status, 400);
    await setUser({ equipments: { pet: [{ id: petId('은채'), expireAt: Date.now() + 100000 }] } });
    assert.equal((await request('', config, true, '/api/pet/auto-potion')).status, 200);
    assert.equal((await request('', { ...config, hp: { ...config.hp, threshold: 100 } }, true, '/api/pet/auto-potion')).status, 400);
    const user = await rpg.getRPGUserByName(seed.name); assert.deepEqual(user.autoPotion, config);
});
test('사냥 자동 물약은 기준/재고/3초 간격/사망/만료를 지키며 물약 효율을 적용한다', async () => {
    const user = await rpg.getRPGUserByName(seed.name), hpId = rpg.getDataCache('Item').findIndex(item => autoPotion.supports(item, 'hp'));
    user.equipments.pet = ['은채', '한국인의밥상'].map(name => ({ id: petId(name), expireAt: Date.now() + 100000 }));
    user.field = { name: '테스트 필드' }; const stats = rpg.calculateUserStats(user); user.hp = 1; user.mp = stats.mp;
    user.autoPotion = { hp: { enabled: true, threshold: 50, itemId: hpId }, mp: { enabled: false, threshold: 50, itemId: null } };
    rpg.addInventoryItem(user, hpId, 5);
    assert.equal(rpg.applyAutoPotion(user, stats, []), true); assert.ok(user.hp > 1); assert.equal(rpg.getInventoryItemCount(user, hpId), 4);
    user.hp = 1; assert.equal(rpg.applyAutoPotion(user, stats), false); user.autoPotionAt = 0;
    user.hp = 0; assert.equal(rpg.applyAutoPotion(user, stats), false);
    user.hp = 1; user.equipments.pet[0].expireAt = 1; assert.equal(rpg.applyAutoPotion(user, stats), false);
    assert.equal(rpg.getInventoryItemCount(user, hpId), 4);
});

test('레이드 자동 물약은 가져간 물약만 소비하고 봉인/회복불가/만료/쿨타임을 지킨다', async () => {
    const hpId = rpg.getDataCache('Item').findIndex(item => autoPotion.supports(item, 'hp'));
    const item = rpg.getDataCache('Item')[hpId];
    const user = await setUser({ level: 200, unlockedRaids: ['mansionNormal'], equipments: { pet: [{ id: petId('은채'), expireAt: Date.now() + 100000 }] },
        autoPotion: { hp: { enabled: true, threshold: 50, itemId: hpId }, mp: { enabled: false, threshold: 50, itemId: null } } });
    rpg.addInventoryItem(user, hpId, 5); await user.save();
    const created = await party.createRoom(seed.name, 'mansionNormal'); assert.ok(created.roomId, JSON.stringify(created));
    assert.equal((await party.setPotions(seed.name, [{ name: item.name, count: 3 }])).ok, true);
    party.setReady(seed.name, true); assert.equal((await party.start(seed.name)).ok, true);
    const room = party.getRoomOf(seed.name), member = room.members[0], runtime = member.runtime;
    room.introUntil = 0; runtime.hp = 1;
    party.__test.stepRoom(room);
    assert.ok(runtime.hp > 1); assert.equal(member.potions[0].count, 2);
    assert.equal(rpg.getInventoryItemCount(await rpg.getRPGUserByName(seed.name), hpId), 2);
    runtime.hp = 1; party.__test.stepRoom(room); assert.equal(member.potions[0].count, 2);
    runtime.potionUntil = 0; runtime.sealRemain = 2; party.__test.stepRoom(room); assert.equal(member.potions[0].count, 2);
    runtime.sealRemain = 0; runtime.equipmentState.ignoreHealingUntil = Date.now() + 10000; party.__test.stepRoom(room); assert.equal(member.potions[0].count, 2);
    runtime.equipmentState.ignoreHealingUntil = 0; runtime.autoPotionExpireAt = 1; party.__test.stepRoom(room); assert.equal(member.potions[0].count, 2);
    assert.equal((await request('', user.autoPotion, true, '/api/pet/auto-potion')).status, 409);
});

test('잔여 3칸 흔들기는 1500P로 3칸만 열고 소진 후 추가 차감은 없다', async () => {
    const board = newBoard(DEFAULT_CONFIG, () => .999);
    for (let i = 0; i < 97; i++) board.opened[i] = { rewardId: board.cells[i] };
    await setUser({ personalDraw: { revision: 0, board, lastAction: null } });
    const result = await fixedRandom(0, () => request('shake', body(0, 1500)));
    assert.equal(result.status, 200); assert.equal(result.data.lastAction.results.length, 3); assert.equal(result.data.lastAction.baseCount, 3);
    assert.equal(result.data.point, 48500); assert.equal(result.data.remaining, 0);
    assert.equal((await request('shake', body(1, 1500))).status, 400);
});
