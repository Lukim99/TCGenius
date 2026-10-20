'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const AWS = require('aws-sdk');
AWS.S3 = class {
    listObjectsV2() { return { promise: async () => ({ Contents: [] }) }; }
    getObject() { return { promise: async () => { throw new Error('No remote assets in isolated tests'); } }; }
};

// 실제 AWS/운영 DB를 사용하지 않고, 기존 게임 데이터를 테스트용 메모리에 읽는다.
const fixture = { id: 'web-actions-test', name: '웹기능테스트', code: 'WEB-TEST-ONLY', _get: 1, avatarMigrated: true,
    logged_in: [], logged_in_agent: [], need_character_card_select: true };
let databaseWrites = 0;
let packageData = null;
DynamoDBDocumentClient.prototype.send = async command => {
    const input = command.input;
    if (command.constructor.name === 'GetCommand') {
        if (input.TableName !== 'rpgenius_data') return {};
        const file = path.join(__dirname, '..', 'DB', 'RPGenius', input.Key.key + '.json');
        let data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
        if (packageData && Object.hasOwn(packageData, input.Key.key)) data = structuredClone(packageData[input.Key.key]);
        if (input.Key.key === 'Coupon') data = [{ code: 'WEB-REWARD', maxUse: 1, usedCount: 0, reward: [{ type: '골드', count: 123 }] }];
        if (input.Key.key === 'Pet') data = [{ name: '테스트 펫', rarity: '레어', stat: { atk: 1 }, special: {} }];
        return { Item: { key: input.Key.key, data } };
    }
    if (command.constructor.name === 'ScanCommand') return { Items: input.TableName === 'rpgenius_user' ? [structuredClone(fixture)] : [] };
    if (['UpdateCommand', 'PutCommand', 'TransactWriteCommand', 'DeleteCommand'].includes(command.constructor.name)) { databaseWrites++; return {}; }
    throw new Error('Unexpected isolated DynamoDB command: ' + command.constructor.name);
};
const rpg = require('../rpgenius');
const { inventoryVersion } = require('../web_game_actions');
const startServer = require('../server');
let server, base, cookie;

async function request(url, body, authenticated = true) {
    const response = await fetch(base + url, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { ...(authenticated ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual'
    });
    return { status: response.status, data: await response.json() };
}
async function reset(overrides = {}) {
    const user = await rpg.getRPGUserByName(fixture.name);
    Object.assign(user, new rpg.RPGUser(fixture.name, fixture.id), {
        code: fixture.code, avatarMigrated: true, need_character_card_select: false,
        main_card: { id: 0, star: 4, type: '일반' }, level: 100, gold: 1000000, hp: 500, mp: 500,
        inventory: { item: [], card: Array.from({ length: 6 }, (_, i) => ({ id: i % 3, star: 4, type: '일반' })),
            equipment: [{ id: 0, type: 'weapon', level: 0 }, { id: 0, type: 'weapon', level: 0 }], pet: [{ id: 0, level: 0, tradeCount: 1 }] },
        ...overrides
    });
    await user.save();
    return user;
}
before(async () => {
    await rpg.initRpgeniusData();
    await reset();
    const previousPort = process.env.PORT;
    process.env.PORT = '0';
    server = startServer();
    if (previousPort === undefined) delete process.env.PORT; else process.env.PORT = previousPort;
    await new Promise(resolve => server.on('listening', resolve));
    base = 'http://127.0.0.1:' + server.address().port;
    const response = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: fixture.name, code: fixture.code }) });
    assert.equal(response.status, 200);
    cookie = response.headers.get('set-cookie').split(';')[0];
});
after(async () => {
    const user = await rpg.getRPGUserByName(fixture.name);
    await rpg.stopFishingForCommand(user);
    await new Promise(resolve => server.close(resolve));
});

test('인증 없는 상태에서 플레이 API에 접근할 수 없다', async () => {
    assert.equal((await request('/api/game/state', undefined, false)).status, 401);
    assert.equal((await request('/api/inventory/actions/confirm', {}, false)).status, 401);
});
test('회랑 증강 도감은 실제 증강 정의와 장착 조건을 읽기 전용으로 제공한다', async () => {
    const { AUGMENTS } = require('../paradise_content');
    assert.equal((await request('/api/dex/augments', undefined, false)).status, 401);
    const count = databaseWrites;
    const response = await request('/api/dex/augments');
    assert.equal(response.status, 200);
    assert.deepEqual(response.data.augments.map(entry => entry.id), AUGMENTS.map(entry => entry.id));
    for (const entry of response.data.augments) {
        const source = AUGMENTS.find(augment => augment.id === entry.id);
        assert.equal(entry.desc, source.desc);
        assert.equal(entry.floors, source.floors);
        assert.equal(entry.category, source.category);
        if (entry.equipment) assert.equal(entry.condition, entry.equipment + ' 장착 시에만 등장');
    }
    assert.equal(response.data.augments.find(entry => entry.id === 'duplicate').condition, '능력치 강화 효과를 획득한 뒤 등장');
    assert.equal(databaseWrites, count, '도감 열람은 데이터를 변경하지 않는다');
});
test('핫딜샵 중단 시 메뉴와 직접 구매를 막고 상품, 재화, 구매 기록을 보존한다', async () => {
    const user = await reset({ garnet: 5000, hotDealPurchases: { previous: [0] } });
    const snapshot = JSON.stringify({ gold: user.gold, garnet: user.garnet, inventory: user.inventory, hotDealPurchases: user.hotDealPurchases });
    const catalog = ['Shop', 'ShopState', 'HotDealOverride'].map(key => JSON.stringify(rpg.getDataCache(key, {})));
    const count = databaseWrites;
    const shop = await request('/api/shop');
    assert.equal(shop.status, 200);
    assert.ok(!shop.data.tabs.includes('핫딜샵'));
    assert.ok(shop.data.tabs.includes('일반'));
    const paused = await request('/api/hotdeal');
    assert.equal(paused.status, 503);
    assert.equal(paused.data.error, '핫딜샵은 잠시 이용할 수 없습니다.');
    for (const slot of [0, 1]) {
        const purchase = await request('/api/hotdeal/buy', { slot });
        assert.equal(purchase.status, 503);
        assert.equal(purchase.data.error, paused.data.error);
    }
    assert.equal((await request('/api/hotdeal/buy', { slot: 0 }, false)).status, 401);
    const current = await rpg.getRPGUserByName(fixture.name);
    assert.equal(JSON.stringify({ gold: current.gold, garnet: current.garnet, inventory: current.inventory, hotDealPurchases: current.hotDealPurchases }), snapshot);
    assert.deepEqual(['Shop', 'ShopState', 'HotDealOverride'].map(key => JSON.stringify(rpg.getDataCache(key, {}))), catalog);
    assert.equal(databaseWrites, count, '중단된 상점 요청은 DB에 쓰지 않는다');
});
test('시작 카드 선택은 초보자 키트와 HP/MP를 한 번만 지급한다', async () => {
    await reset({ need_character_card_select: true, main_card: {} });
    const cards = (await request('/api/game/starter-cards')).data.cards;
    assert.ok(cards.length > 0);
    const first = await request('/api/game/starter-card', { name: cards[0].name });
    assert.equal(first.status, 200, JSON.stringify(first.data));
    assert.equal(first.data.state.needsStarter, false);
    assert.equal(first.data.message, undefined);
    assert.equal(first.data.changes.mainCard.name, cards[0].name);
    assert.ok(first.data.changes.rewards.some(reward => reward.count === 1));
    assert.ok(first.data.profile.user.hp > 0);
    assert.ok(first.data.profile.user.mp > 0);
    assert.equal((await request('/api/game/starter-card', { name: cards[0].name })).status, 400);
    const user = await rpg.getRPGUserByName(fixture.name);
    assert.equal(rpg.getInventoryItemCount(user, 41), 1);
});
test('출석 동시 요청과 쿠폰 재등록은 보상을 중복 지급하지 않는다', async () => {
    await reset();
    const attempts = await Promise.all([request('/api/game/attendance', {}), request('/api/game/attendance', {})]);
    assert.equal(attempts.filter(r => r.status === 200).length, 1);
    assert.equal((await request('/api/game/attendance', {})).status, 400);
    const beforeGold = (await rpg.getRPGUserByName(fixture.name)).gold;
    assert.equal((await request('/api/game/coupon', { code: 'web-reward' })).status, 200);
    assert.equal((await request('/api/game/coupon', { code: 'WEB-REWARD' })).status, 400);
    assert.equal((await rpg.getRPGUserByName(fixture.name)).gold, beforeGold + 123);
});
test('생일 이벤트가 없는 날의 레이드 권한은 저장된 활성화 플래그가 아니라 현재 레벨로 결정한다', async t => {
    t.mock.method(Date, 'now', () => Date.parse('2026-10-05T12:00:00+09:00'));
    await reset({ level: 70, canPartyQuest: true });
    assert.equal((await request('/api/party/quests')).status, 403);
    await reset({ level: 71, canPartyQuest: false });
    assert.equal((await request('/api/party/quests')).status, 200);
    assert.equal((await request('/api/profile')).data.user.canPartyQuest, true);
});
test('카드 자동 선택은 같은 등급의 서로 다른 3장을 고르고 아직 소모하지 않는다', async () => {
    await reset();
    const result = await request('/api/combine/auto-select', { star: '5성' });
    assert.equal(result.status, 200);
    assert.equal(new Set(result.data.numbers).size, 3);
    assert.ok(result.data.numbers.every(n => result.data.cards.find(c => c.number === n).star === 4));
    assert.equal((await rpg.getRPGUserByName(fixture.name)).inventory.card.length, 6);
});
test('카드 판매는 미리보기 후 확정하며 재전송·번호 이동·잘못된 확인 토큰을 거부한다', async () => {
    let user = await reset();
    const body = { action: 'cards-sell', numbers: [1, 2], version: inventoryVersion(user, 'cards') };
    const preview = await request('/api/inventory/actions/preview', body);
    assert.equal(preview.status, 200, JSON.stringify(preview.data));
    assert.equal(preview.data.message, undefined);
    assert.equal(preview.data.targets.length, 2);
    assert.equal(preview.data.rewards[0].name, '골드');
    assert.equal(preview.data.rewards[0].min, rpg.getCardSalePrice(user.inventory.card[0]) * 2);
    assert.equal((await rpg.getRPGUserByName(fixture.name)).inventory.card.length, 6);
    assert.equal((await rpg.getRPGUserByName(fixture.name)).pendingAction, null);
    const confirmed = await request('/api/inventory/actions/confirm', { ...body, token: preview.data.token });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));
    assert.equal(confirmed.data.message, undefined);
    assert.equal(confirmed.data.changes.rewards.find(reward => reward.name === '골드').count, preview.data.rewards[0].min);
    assert.equal((await rpg.getRPGUserByName(fixture.name)).inventory.card.length, 4);
    assert.equal((await request('/api/inventory/actions/confirm', { ...body, token: preview.data.token })).status, 409);
    user = await reset();
    const fresh = { ...body, version: inventoryVersion(user, 'cards') };
    const oldPreview = await request('/api/inventory/actions/preview', fresh);
    user.inventory.card.shift(); await user.save();
    assert.equal((await request('/api/inventory/actions/confirm', { ...fresh, token: oldPreview.data.token })).status, 409);
    user = await reset();
    assert.equal((await request('/api/inventory/actions/confirm', { ...body, token: 'wrong' })).status, 409);
});
test('아이템 판매는 운영 판매가를 사용하고 수량 초과·음수는 거부한다', async () => {
    const user = await reset();
    const items = rpg.getDataCache('Item', []);
    const id = items.findIndex(i => i && Number(i.sellPrice) > 0);
    assert.ok(id >= 0);
    rpg.addInventoryItem(user, id, 5); await user.save();
    const body = { action: 'items-sell', id, count: 2, version: inventoryVersion(user, 'items') };
    for (const count of [-1, 0, 6, 1.5]) assert.equal((await request('/api/inventory/actions/preview', { ...body, count })).status, 400);
    const preview = await request('/api/inventory/actions/preview', body);
    assert.equal(preview.status, 200);
    const originalPrice = items[id].sellPrice;
    try {
        items[id].sellPrice = Number(originalPrice) + 1;
        assert.equal((await request('/api/inventory/actions/confirm', { ...body, token: preview.data.token })).status, 409);
        assert.equal(rpg.getInventoryItemCount(await rpg.getRPGUserByName(fixture.name), id), 5);
    } finally { items[id].sellPrice = originalPrice; }
    assert.equal((await request('/api/inventory/actions/confirm', { ...body, token: preview.data.token })).status, 200);
    const after = await rpg.getRPGUserByName(fixture.name);
    assert.equal(rpg.getInventoryItemCount(after, id), 3);
    assert.equal(after.gold, 1000000 + Number(items[id].sellPrice) * 2);
});
test('장비 잠금·해제, 잠긴 장비와 장착 장비 제외, 다중 분해를 검증한다', async () => {
    await reset();
    let equipment = (await request('/api/inventory/equipment')).data.equipment;
    assert.equal((await request('/api/inventory/equipment/lock', { number: 1, version: equipment[0].version })).status, 200);
    equipment = (await request('/api/inventory/equipment')).data.equipment;
    assert.equal(equipment[0].locked, true);
    assert.equal((await request('/api/inventory/actions/preview', { action: 'equipment-disassemble', numbers: [1], version: equipment[0].version })).status, 400);
    const equipped = equipment.find(e => e.equipped);
    assert.equal((await request('/api/inventory/actions/preview', { action: 'equipment-disassemble', numbers: [equipped.number], version: equipped.version })).status, 400);
    assert.equal((await request('/api/inventory/equipment/lock', { number: 1, version: equipment[0].version })).status, 200);
    equipment = (await request('/api/inventory/equipment')).data.equipment;
    const body = { action: 'equipment-disassemble', numbers: [1, 2], version: equipment[0].version };
    const preview = await request('/api/inventory/actions/preview', body);
    assert.equal(preview.status, 200, JSON.stringify(preview.data));
    assert.equal(preview.data.targets.length, 2);
    assert.ok(preview.data.rewards[0].max >= preview.data.rewards[0].min);
    const done = await request('/api/inventory/actions/confirm', { ...body, token: preview.data.token });
    assert.equal(done.status, 200);
    assert.equal(done.data.message, undefined);
    const gained = done.data.changes.rewards.find(reward => reward.name === '강화석').count;
    assert.ok(gained >= preview.data.rewards[0].min && gained <= preview.data.rewards[0].max);
    assert.equal((await rpg.getRPGUserByName(fixture.name)).inventory.equipment.length, 0);
});
test('강화 결과 화면은 실제 단계와 보호권 판정, 파괴와 최대 단계를 정확히 반환한다', async t => {
    const id = rpg.getDataCache('Equipment', {}).weapon.findIndex(equipment => equipment?.upgrade?.length === 15);
    assert.ok(id >= 0);
    const equipment = rpg.getEquipmentData('weapon', id);
    const scenarios = [
        { level: 0, roll: .5, kind: 'success', after: 1 },
        { level: 0, roll: .01, kind: 'great', after: 2 },
        { level: 8, roll: .6, kind: 'down', after: 7 },
        { level: 8, roll: .96, kind: 'destroy', after: null },
        { level: 8, roll: .96, protect: 'basic', ticket: rpg.EQUIPMENT_PROTECT_ITEM_ID, kind: 'protected', after: 0 },
        { level: 8, roll: .96, protect: 'advanced', ticket: rpg.EQUIPMENT_ADVANCED_PROTECT_ITEM_ID, kind: 'protected', after: 8 },
        { level: 8, roll: .6, protect: 'blessed', ticket: rpg.EQUIPMENT_BLESSED_PROTECT_ITEM_ID, kind: 'protected', after: 8 },
        { level: 14, roll: .005, kind: 'success', after: 15 }
    ];
    for (const scenario of scenarios) {
        const user = await reset({ gold: 1000000000 });
        user.inventory.equipment = [{ id, type: 'weapon', level: scenario.level }, { id, type: 'weapon', level: 2 }];
        const cost = rpg.getEquipmentUpgradeCost(equipment, 'weapon', scenario.level);
        const stoneId = cost.stoneItemId ?? rpg.EQUIPMENT_STONE_ITEM_ID;
        const stoneCount = cost.stone + 10;
        rpg.addInventoryItem(user, stoneId, stoneCount);
        if (scenario.ticket) rpg.addInventoryItem(user, scenario.ticket, 2);
        await user.save();
        const preview = await request('/api/equipment/upgrade/preview/1');
        assert.equal(preview.status, 200);
        assert.equal(preview.data.canUpgrade, true);
        assert.ok(preview.data.stoneIconUrl, '강화 재료의 실제 이미지 경로를 제공한다');
        const random = t.mock.method(Math, 'random', () => scenario.roll);
        let result;
        try { result = await request('/api/equipment/upgrade/run', { number: 1, protectLevel: scenario.protect || 'none' }); }
        finally { random.mock.restore(); }
        assert.equal(result.status, 200, JSON.stringify(result.data));
        assert.equal(result.data.resultKind, scenario.kind);
        assert.equal(result.data.levelBefore, scenario.level);
        assert.equal(result.data.levelAfter, scenario.after);
        const after = await rpg.getRPGUserByName(fixture.name);
        assert.equal(after.gold, 1000000000 - preview.data.cost.gold);
        assert.equal(rpg.getInventoryItemCount(after, stoneId), stoneCount - preview.data.cost.stone);
        assert.equal(after.pendingAction, null);
        if (scenario.ticket) assert.equal(rpg.getInventoryItemCount(after, scenario.ticket), 1);
        if (scenario.kind === 'destroy') {
            assert.equal(after.inventory.equipment.length, 1);
            assert.equal(after.inventory.equipment[0].level, 2);
            assert.deepEqual(result.data.appliedDiffs, [], '파괴 결과를 다음 장비의 능력치로 표시하지 않는다');
        } else {
            assert.equal(after.inventory.equipment[0].level, scenario.after);
            assert.equal(after.inventory.equipment[1].level, 2);
        }
        if (scenario.after === 15) assert.equal(result.data.preview.error, '이미 최대 강화 단계입니다.');
        if (scenario.protect === 'basic') assert.match(result.data.message, /0강으로 초기화/);
    }
});

test('펫 장착·해제·추출은 거래 횟수와 장착 상태를 지킨다', async () => {
    const user = await reset();
    const id = rpg.getDataCache('Pet', []).findIndex(p => p && rpg.PET_EXTRACT_YIELD[p.rarity] && Number(p.requireLevel || 0) <= user.level);
    user.inventory.pet = [{ id, level: 0, tradeCount: 1 }]; await user.save();
    let pet = (await request('/api/inventory/pet')).data.pet[0];
    assert.equal((await request('/api/inventory/pet/equip', { number: pet.number, version: pet.version })).status, 200);
    pet = (await request('/api/inventory/pet')).data.pet[0];
    assert.equal(pet.equipped, true); assert.equal(pet.tradeCount, 0);
    assert.equal((await request('/api/inventory/actions/preview', { action: 'pets-extract', numbers: [pet.number], version: pet.version })).status, 400);
    assert.equal((await request('/api/inventory/pet/unequip', { number: pet.number, version: pet.version })).status, 200);
    pet = (await request('/api/inventory/pet')).data.pet[0];
    const body = { action: 'pets-extract', numbers: [pet.number], version: pet.version };
    const preview = await request('/api/inventory/actions/preview', body);
    assert.equal(preview.status, 200);
    assert.equal((await request('/api/inventory/actions/confirm', { ...body, token: preview.data.token })).status, 200);
    const after = await rpg.getRPGUserByName(fixture.name);
    assert.equal(after.inventory.pet.length, 0);
    assert.equal(rpg.getInventoryItemCount(after, 155), rpg.PET_EXTRACT_YIELD[pet.rarity]);
});
test('낚시 시작은 멱등이며 살림망 수령은 한 번만 지급하고 낚시를 멈춘다', async () => {
    const user = await reset();
    const baitId = rpg.getCurrentBaitItemId(user);
    assert.ok(baitId >= 0);
    rpg.addInventoryItem(user, baitId, 5);
    user.fishingNet = { [baitId]: 2 }; await user.save();
    const preview = (await request('/api/fishing')).data;
    assert.equal(preview.baitCount, 5);
    assert.equal(preview.baits[0].count, 5);
    assert.equal(preview.baitIconUrl, preview.baits[0].iconUrl);
    assert.ok(Object.hasOwn(preview.baits[0], 'iconUrl'));
    assert.ok(Object.hasOwn(preview.baits[0], 'frameUrl'));
    assert.equal((await request('/api/fishing/start', {})).status, 200);
    assert.equal((await request('/api/fishing/start', {})).data.state.fishing.active, true);
    const results = await Promise.all([request('/api/fishing/collect', {}), request('/api/fishing/collect', {})]);
    assert.ok(results.some(r => r.status === 200));
    const after = await rpg.getRPGUserByName(fixture.name);
    assert.equal(rpg.getInventoryItemCount(after, baitId), 7);
    assert.equal(after.fishing, false);
    assert.equal(rpg.getFishingNetCount(after), 0);
});
test('대기 작업·사냥 중에는 인벤토리 조작을 거부하고 기존 대기를 보존한다', async () => {
    let user = await reset({ pendingAction: { type: '캐릭터변환', consumedItemId: 1 } });
    assert.equal((await request('/api/inventory/actions/preview', { action: 'cards-sell', numbers: [1], version: inventoryVersion(user, 'cards') })).status, 409);
    assert.equal((await rpg.getRPGUserByName(fixture.name)).pendingAction.type, '캐릭터변환');
    user = await reset({ field: { name: '테스트필드' } });
    assert.equal((await request('/api/inventory/equipment/lock', { number: 1, version: inventoryVersion(user, 'equipment') })).status, 409);
    await reset();
});

test('아이템 사용 결과는 명령어 문구 대신 실제 HP 변경을 반환한다', async () => {
    const user = await reset({ hp: 1 });
    const items = rpg.getDataCache('Item', []);
    const id = items.findIndex(item => item?.use_func?.some(effect => effect.type === '체력회복'));
    assert.ok(id >= 0);
    rpg.addInventoryItem(user, id, 1); await user.save();
    const result = await request('/api/inventory/items/' + id + '/use', { count: 1 });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.equal(result.data.message, undefined);
    const hp = result.data.changes.stats.find(stat => stat.label === 'HP');
    assert.equal(hp.before, 1);
    assert.ok(hp.after > 1);
});

test('제작 결과는 실제 지급된 장비의 이름·이미지·수량을 반환한다', async () => {
    const user = await reset();
    const recipe = rpg.getDataCache('Recipe', []).find(entry => entry?.materials?.length &&
        entry.materials.every(material => ['아이템', '골드'].includes(material.type)) &&
        entry.crafted.some(output => output.type === '장신구'));
    assert.ok(recipe);
    recipe.materials.forEach(material => {
        if (material.type === '아이템') rpg.addInventoryItem(user, material.item_id, Number(material.count || 1));
    });
    await user.save();
    const result = await request('/api/inventory/craft', { name: recipe.name, times: 1 });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.equal(result.data.message, undefined);
    const equipment = result.data.changes.rewards.find(reward => reward.kind === 'equipment');
    assert.ok(equipment.name && equipment.iconUrl);
    assert.equal(equipment.count, 1);
});

test('키노의 일반·전직·각성 도감과 장착 정보는 MP 대신 정신력 소모량을 표시한다', async () => {
    const user = await reset({ main_card: { id: 16, star: 4, type: '각성' } });
    const dex = await request('/api/dex/equipment');
    assert.equal(dex.status, 200);
    const kino = dex.data.character.find(card => card.name === '키노');
    assert.equal(kino.skills[0].resourceLabel, '정신력');
    assert.equal(kino.skills[0].mpCost, 40);
    assert.equal(kino.jobClass.skills[0].resourceLabel, '정신력');
    assert.equal(kino.jobClass.skills[0].mpCost, 80);
    assert.deepEqual(kino.awakening.skills.map(skill => [skill.resourceLabel, skill.mpCost]), [['정신력', 40], ['정신력', 80]]);
    assert.equal(dex.data.character.find(card => card.name === '워뇨띠').skills[0].resourceLabel, 'MP');
    assert.match(rpg.formatEquipmentInfo(user), /아이돌 할래\? \[ 40 정신력 \]/);
    assert.doesNotMatch(rpg.formatEquipmentInfo(user), /아이돌 할래\? \[ 0 MP \]/);
});

const randoPackages = require('../scripts/register_rando_packages');
function packageSource() {
    const source = Object.fromEntries(['Item', 'Bundle', 'Pack', 'Shop'].map(key => [key, JSON.parse(fs.readFileSync(path.join(__dirname, '../DB/RPGenius', key + '.json'), 'utf8'))]));
    for (const item of require('../scripts/register_rando_characters').itemDefinitions) {
        if (!source.Item.some(existing => existing?.name === item.name)) source.Item.push(structuredClone(item));
    }
    const orbData = JSON.parse(fs.readFileSync(path.join(__dirname, '../DB/RPGenius/Orb.json'), 'utf8'));
    for (const orb of orbData.orbs) {
        if (!source.Item.some(item => item?.name === orb.name)) source.Item.push({ name: orb.name, type: '사용', use: '보주' });
    }
    if (!source.Item.some(item => item?.name === '일리온 캐릭터 변환석')) source.Item.push({ name: '일리온 캐릭터 변환석', type: '사용', use: '변환', charId: 14 });
    if (!source.Item.some(item => item?.name === '헬 초대장')) source.Item.push({ name: '헬 초대장', type: '티켓', no_trade: true });
    if (!Array.isArray(source.Shop['패키지'])) source.Shop['패키지'] = [];
    return source;
}

test('패키지 등록은 기존 운영 꾸러미·인덱스·상품 설정을 보존하고 재실행해도 변경하지 않는다', () => {
    const source = packageSource(), snapshot = structuredClone(source);
    const prepared = randoPackages.prepare(source);
    assert.deepEqual(source, snapshot);
    for (const key of ['Item', 'Bundle', 'Pack']) assert.deepEqual(prepared[key].slice(0, source[key].length), source[key]);
    assert.deepEqual(prepared.Shop['패키지'].slice(0, source.Shop['패키지'].length), source.Shop['패키지']);
    assert.deepEqual(randoPackages.prepare(prepared), prepared);
    const orb = prepared.Item.find(item => item.name === randoPackages.randomOrbName);
    assert.equal(prepared.Pack[orb.pack].length, 13);
    assert.ok(prepared.Pack[orb.pack].every(reward => reward.roll === 1 / 13));
    const first = prepared.Item.find(item => item.name === randoPackages.definitions[0].name);
    prepared.Bundle[first.pack] = [];
    prepared.Shop['패키지'].at(-1).price.amount = 17;
    assert.deepEqual(randoPackages.prepare(prepared), prepared, '운영자가 변경하거나 비워 둔 신규 구성도 보존한다');
});

test('패키지 6종의 가격·구매 제한과 일반 구성품 수량을 적용하고 재구매·동시 구매를 막는다', async () => {
    packageData = randoPackages.prepare(packageSource());
    try {
        await Promise.all(Object.keys(packageData).map(key => rpg.loadRpgeniusDataEntry(key)));
        const catalog = (await request('/api/shop')).data.shop['패키지'];
        for (const definition of randoPackages.definitions) {
            const itemId = packageData.Item.findIndex(item => item.name === definition.name);
            const product = catalog.find(item => item.display.name === definition.name);
            assert.equal(product.price.amount, definition.price);
            assert.equal(product.limitInfo.limits.max, definition.max);
            if (definition.rewards.some(reward => reward.autoUse)) continue;
            await reset({ point: 50000, garnet: 0 });
            const results = definition.max === 1 && definition.price === 330
                ? await Promise.all([request('/api/shop/buy', { shopType: '패키지', shopId: product.shopId, count: 1 }), request('/api/shop/buy', { shopType: '패키지', shopId: product.shopId, count: 1 })])
                : [await request('/api/shop/buy', { shopType: '패키지', shopId: product.shopId, count: definition.max })];
            assert.equal(results.filter(result => result.status === 200).length, 1, JSON.stringify(results));
            const bought = results.find(result => result.status === 200);
            assert.ok(bought.data.bundleGranted.length);
            const user = await rpg.getRPGUserByName(fixture.name);
            assert.equal(user.point, 50000 - definition.price * definition.max);
            assert.equal(rpg.getInventoryItemCount(user, itemId), 0);
            for (const reward of definition.rewards) {
                if (reward.type === '가넷') assert.equal(user.garnet, reward.count * definition.max);
                else {
                    const rewardId = packageData.Item.findIndex(item => item.name === reward.name);
                    const isCard = rpg.isCardPackItem(rewardId);
                    assert.equal(rpg.getInventoryItemCount(user, rewardId), isCard ? 0 : reward.count * definition.max);
                    if (isCard) {
                        const pack = packageData.Item[rewardId].pack;
                        const type = pack.type === '전직 캐릭터 카드팩' ? '전직' : '일반';
                        assert.equal(user.inventory.card.filter(card => card.type === type && card.star === pack.range.min - 1).length, reward.count * definition.max);
                    }
                }
            }
            const snapshot = JSON.stringify({ inventory: user.inventory, point: user.point, garnet: user.garnet, mileage: user.mileage });
            assert.equal((await request('/api/shop/buy', { shopType: '패키지', shopId: product.shopId, count: 1 })).status, 400);
            const current = await rpg.getRPGUserByName(fixture.name);
            assert.equal(JSON.stringify({ inventory: current.inventory, point: current.point, garnet: current.garnet, mileage: current.mileage }), snapshot);
        }
    } finally { packageData = null; }
});

test('보주 패키지는 구매 수량만큼 즉시 추첨하며 가챠 아이템을 남기지 않고 잘못된 구성에서는 차감하지 않는다', async t => {
    packageData = randoPackages.prepare(packageSource());
    t.mock.method(Math, 'random', () => 0.05);
    try {
        await reset({ point: 50000 });
        const packageId = packageData.Item.findIndex(item => item.name === '란도랜드2보주출시패키지');
        const product = packageData.Shop['패키지'].find(item => item.item_id === packageId);
        const body = { shopType: '패키지', shopId: product.shopId, count: 2 };
        const bought = await request('/api/shop/buy', body);
        assert.equal(bought.status, 200, JSON.stringify(bought.data));
        assert.equal(bought.data.bundleGranted.length, 1);
        assert.equal(bought.data.bundleGranted[0].name, '급락전문 보주');
        assert.equal(bought.data.bundleGranted[0].count, 2);
        const randomId = packageData.Item.findIndex(item => item.name === randoPackages.randomOrbName);
        let user = await rpg.getRPGUserByName(fixture.name);
        assert.equal(user.point, 46000);
        assert.equal(rpg.getInventoryItemCount(user, randomId), 0);
        assert.equal(rpg.getInventoryItemCount(user, packageId), 0);
        assert.equal((await request('/api/shop/buy', body)).status, 400, '누적 3회 제한 초과');
        assert.equal((await request('/api/shop/buy', { ...body, count: 1 })).status, 200);
        user = await rpg.getRPGUserByName(fixture.name);
        assert.equal(rpg.getInventoryItemCount(user, packageData.Item.findIndex(item => item.name === '급락전문 보주')), 3);
        assert.equal(user.point, 44000);
        await reset({ point: 50000 });
        packageData.Pack[packageData.Item[randomId].pack] = [];
        const rejected = await request('/api/shop/buy', { ...body, count: 1 });
        assert.equal(rejected.status, 400);
        assert.match(rejected.data.error, /가챠 구성/);
        user = await rpg.getRPGUserByName(fixture.name);
        assert.equal(user.point, 50000);
        assert.equal(user.inventory.item.length, 0);
    } finally { packageData = null; }
});

test('신규 패키지 저장이 다른 재화 변경과 충돌하면 포인트·보상·구매 기록을 보존한다', async t => {
    packageData = randoPackages.prepare(packageSource());
    try {
        const user = await reset({ point: 50000 });
        const snapshot = JSON.parse(JSON.stringify(user));
        const originalSend = DynamoDBDocumentClient.prototype.send;
        t.mock.method(DynamoDBDocumentClient.prototype, 'send', async function(command) {
            const input = command.input;
            if (command.constructor.name === 'UpdateCommand' && input.TableName === 'rpgenius_user' && input.ConditionExpression?.startsWith('attribute_exists(id) AND')) throw Object.assign(new Error('Concurrent purchase'), { name: 'ConditionalCheckFailedException' });
            if (command.constructor.name === 'GetCommand' && input.TableName === 'rpgenius_user') return { Item: structuredClone(snapshot) };
            return originalSend.call(this, command);
        });
        const itemId = packageData.Item.findIndex(item => item.name === '왕꿈틀이맛보기패키지');
        const product = packageData.Shop['패키지'].find(item => item.item_id === itemId);
        const rejected = await request('/api/shop/buy', { shopType: '패키지', shopId: product.shopId, count: 1 });
        assert.equal(rejected.status, 400);
        const current = await rpg.getRPGUserByName(fixture.name);
        assert.equal(current.point, snapshot.point);
        assert.equal(current.garnet, snapshot.garnet);
        assert.equal(current.mileage, snapshot.mileage);
        assert.deepEqual(current.inventory, snapshot.inventory);
        assert.deepEqual(current.shopPurchases, snapshot.shopPurchases);
    } finally { packageData = null; }
});
