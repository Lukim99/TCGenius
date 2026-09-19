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
DynamoDBDocumentClient.prototype.send = async command => {
    const input = command.input;
    if (command.constructor.name === 'GetCommand') {
        if (input.TableName !== 'rpgenius_data') return {};
        const file = path.join(__dirname, '..', 'DB', 'RPGenius', input.Key.key + '.json');
        let data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
        if (input.Key.key === 'Coupon') data = [{ code: 'WEB-REWARD', maxUse: 1, usedCount: 0, reward: [{ type: '골드', count: 123 }] }];
        if (input.Key.key === 'Pet') data = [{ name: '테스트 펫', rarity: '레어', stat: { atk: 1 }, special: {} }];
        return { Item: { key: input.Key.key, data } };
    }
    if (command.constructor.name === 'ScanCommand') return { Items: input.TableName === 'rpgenius_user' ? [structuredClone(fixture)] : [] };
    if (['UpdateCommand', 'PutCommand', 'TransactWriteCommand', 'DeleteCommand'].includes(command.constructor.name)) return {};
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
test('레이드 권한은 저장된 활성화 플래그가 아니라 현재 레벨로 결정한다', async () => {
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
