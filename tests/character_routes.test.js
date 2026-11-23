'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const sandbox = require('../scripts/paradise-lab/sandbox');
const { rpg } = sandbox;
let base, cookie, oldCookie, secondId, cardTicket, transferTicket;
async function request(path, body, options = {}) {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST',
        headers: { Cookie: options.cookie || cookie || '', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...options.headers },
        body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    if (!options.keepCookie && response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    return { status: response.status, body: await response.json() };
}
const action = (path, body = {}, requestId = crypto.randomUUID()) => request('/api/characters/' + path, { ...body, requestId });

before(async () => {
    base = 'http://127.0.0.1:' + await sandbox.start();
    const user = await rpg.getRPGUserByName(sandbox.account.name);
    user.point = 5000; user.gold = 1000; user.level = 200;
    await user.save();
    const items = rpg.getDataCache('Item', []);
    cardTicket = items.findIndex(item => item.name === '거래권');
    transferTicket = items.length;
    items.push({ name: '카드 전송기', type: '티켓', no_trade: true });
    const login = await request('/api/login', { name: sandbox.account.name, code: 'LAB' });
    assert.equal(login.status, 200);
});
after(() => sandbox.close());

test('첫 로그인에서 기존 계정을 보존해 1번 캐릭터로 옮기고 선택 화면 데이터를 준다', async () => {
    const result = await request('/api/characters');
    assert.equal(result.status, 200);
    assert.equal(result.body.capacity, 6);
    assert.equal(result.body.characters.length, 1);
    assert.equal(result.body.characters[0].id, sandbox.account.id);
    assert.equal(result.body.characters[0].cardLabel, '[7성] 빵귤');
    assert.equal(result.body.wallet.point, 5000);
    assert.equal(result.body.goldCap.level, 200);
    assert.equal(result.body.goldCap.limit, 80000000);
    assert.equal(result.body.starters.length, 17);
});

test('부캐 생성은 1레벨과 시작 키트를 지급하고 재전송으로 캐릭터를 중복 생성하지 않는다', async () => {
    const requestId = crypto.randomUUID();
    const first = await action('create', { name: '두번째', cardId: 1 }, requestId);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    secondId = first.body.id;
    const again = await action('create', { name: '두번째', cardId: 1 }, requestId);
    assert.deepEqual(again.body, first.body);
    const second = await rpg.getUserByPrimaryId(secondId);
    assert.equal(second.level, 1);
    assert.equal(second.main_card.id, 1);
    assert.equal(second.need_character_card_select, false);
    assert.equal(rpg.getInventoryItemCount(second, 41), 1);
    assert.equal(second.point, 5000);
    assert.equal((await request('/api/characters')).body.characters.length, 2);
});

test('이름 변경 비용 안내는 활성 캐릭터가 아니라 선택한 캐릭터의 변경권 수량을 제공한다', async () => {
    const items = rpg.getDataCache('Item');
    const ticket = items.length;
    items.push({ name: '닉네임 변경권', type: '티켓', no_trade: true });
    const first = await rpg.getUserByPrimaryId(sandbox.account.id);
    rpg.addInventoryItem(first, ticket, 2); await first.save();
    const result = (await request('/api/characters')).body;
    assert.equal(result.characters.find(c => c.id === first.id).renameTickets, 2);
    assert.equal(result.characters.find(c => c.id === secondId).renameTickets, 0);
});

test('캐릭터 전환은 공유 지갑을 유지하며 이전 세션과 다른 캐릭터의 화면 요청을 막는다', async () => {
    oldCookie = cookie;
    const selected = await action('select', { id: secondId });
    assert.equal(selected.status, 200, JSON.stringify(selected.body));
    const stale = await request('/api/me', undefined, { cookie: oldCookie, keepCookie: true });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.code, 'CHARACTER_CHANGED');
    const oldTab = await request('/api/me', undefined, { headers: { 'X-Character-Id': sandbox.account.id } });
    assert.equal(oldTab.status, 409);
    assert.equal((await request('/api/me')).body.name, '두번째');
    assert.equal((await request('/api/characters')).body.wallet.gold, 1000);
});

test('전투 중 전환과 타 계정 캐릭터 선택은 거부한다', async () => {
    const user = await rpg.getUserByPrimaryId(secondId);
    user.field = { name: '사냥 중' }; await user.save();
    assert.equal((await action('select', { id: sandbox.account.id })).status, 409);
    const revision = rpg.getCharacterStore().accountFor(user).selectionRevision;
    assert.equal((await action('select', { id: secondId })).status, 200, '현재 캐릭터로는 전투를 이어서 플레이할 수 있다');
    assert.equal(rpg.getCharacterStore().accountFor(user).selectionRevision, revision);
    assert.equal((await rpg.getUserByPrimaryId(secondId)).field.name, '사냥 중');
    user.field = null; await user.save();
    assert.equal((await action('select', { id: 'unknown-other-account' })).status, 403);
});

test('변경권 사용을 확인한 뒤 보유 수량이 달라지면 포인트를 대신 차감하지 않는다', async () => {
    const result = await action('rename', { id: secondId, name: '차감하면안됨', payment: 'ticket' });
    assert.equal(result.status, 409);
    const user = await rpg.getUserByPrimaryId(secondId);
    assert.equal(user.name, '두번째');
    assert.equal(user.point, 5000);
    assert.equal((await action('rename', { id: sandbox.account.id, name: '차감하면안됨', payment: 'point' })).status, 409);
    assert.equal((await request('/api/characters')).body.wallet.point, 5000);
});

test('닉네임을 바꿔도 계정 로그인 이름과 원래 캐릭터 주소는 유지한다', async () => {
    const changed = await action('rename', { id: secondId, name: '두번째새이름', payment: 'point' });
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    assert.equal((await request('/api/characters')).body.wallet.point, 4700);
    assert.equal((await rpg.getAccountUserByLogin(sandbox.account.name)).id, secondId);
    assert.equal(await rpg.getAccountUserByLogin('두번째새이름'), null);
    assert.equal((await rpg.getRPGUserByName('두번째')).id, secondId);
    assert.equal((await request('/api/me')).body.name, '두번째새이름');
});

test('이름 변경 전 월드보스 기여도와 수령 기록은 같은 캐릭터로 합치고 다시 합산하지 않는다', () => {
    const state = rpg.getWorldBossState('이름변경검증');
    state.contributions = { 두번째: 100, 두번째새이름: 200 };
    state.claimedRewards = { 두번째: 3, 두번째새이름: 1 };
    state.rankRewards = { 두번째: { rank: 2, claimed: true } };
    const current = rpg.getWorldBossState('이름변경검증');
    assert.deepEqual(current.contributions, { 두번째새이름: 300 });
    assert.deepEqual(current.claimedRewards, { 두번째새이름: 3 });
    assert.deepEqual(current.rankRewards, { 두번째새이름: { rank: 2, claimed: true } });
    assert.deepEqual(rpg.getWorldBossState('이름변경검증').contributions, { 두번째새이름: 300 });
});

test('카드를 따로 장착하지 않고 5성 이상 부캐를 슬롯에 지정하며 현재 캐릭터는 제외한다', async () => {
    assert.equal((await action('select', { id: sandbox.account.id })).status, 200);
    const first = await rpg.getUserByPrimaryId(sandbox.account.id);
    const second = await rpg.getUserByPrimaryId(secondId);
    assert.equal((await action('link', { characterId: first.id, index: 0, linkedId: secondId })).status, 400, '5성 미만 부캐는 지정할 수 없다');
    second.main_card.star = 4; await second.save();
    assert.deepEqual(first.card_slot, []);
    const linked = await action('link', { characterId: first.id, index: 0, linkedId: secondId });
    assert.equal(linked.status, 200, JSON.stringify(linked.body));
    assert.equal(linked.body.levelSum, 1);
    assert.equal((await action('link', { characterId: first.id, index: 0, linkedId: first.id })).status, 400);
    const effects = rpg.calculateCardSlotEffects(await rpg.getUserByPrimaryId(first.id));
    assert.equal(effects.linkedHp, 1);
    assert.ok(effects.goldBonus >= .001);
});

test('카드 전송기는 1개만 소모하고 거래권 없이 카드 속성을 보존해 이전한다', async () => {
    const first = await rpg.getUserByPrimaryId(sandbox.account.id);
    rpg.addInventoryItem(first, transferTicket, 2);
    first.inventory.card.push({ id: 3, star: 11, type: '각성', awakeningSpecter: '보존할 특수 속성' });
    const index = first.inventory.card.length - 1;
    await first.save();
    const targetBefore = await rpg.getUserByPrimaryId(secondId);
    const transferable = (await request('/api/characters/transferable?sourceId=' + encodeURIComponent(first.id))).body;
    const requestId = crypto.randomUUID(), body = { sourceId: first.id, targetId: secondId, kind: 'card', index, itemToken: transferable.cards.find(card => card.index === index).token };
    const sent = await action('transfer', body, requestId);
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    assert.equal((await action('transfer', body, requestId)).status, 200);
    assert.equal(rpg.getInventoryItemCount(await rpg.getUserByPrimaryId(first.id), transferTicket), 1);
    const target = await rpg.getUserByPrimaryId(secondId);
    assert.equal(target.inventory.card.length, targetBefore.inventory.card.length + 1);
    assert.equal(target.inventory.card.at(-1).awakeningSpecter, '보존할 특수 속성');
    assert.equal(rpg.getInventoryItemCount(target, cardTicket), rpg.getInventoryItemCount(targetBefore, cardTicket));
});

test('슬롯 확장 재전송으로 포인트를 중복 차감하지 않는다', async () => {
    const requestId = crypto.randomUUID();
    assert.equal((await action('expand', {}, requestId)).status, 200);
    assert.equal((await action('expand', {}, requestId)).status, 200);
    const view = (await request('/api/characters')).body;
    assert.equal(view.capacity, 7);
    assert.equal(view.wallet.point, 3900);
});

test('오래된 전송 목록의 인덱스가 다른 카드로 바뀌면 전송기와 카드를 보존한다', async () => {
    const user = await rpg.getUserByPrimaryId(sandbox.account.id);
    user.inventory.card = [{ id: 0, star: 4, type: '일반' }]; await user.save();
    const list = (await request('/api/characters/transferable?sourceId=' + user.id)).body;
    user.inventory.card.unshift({ id: 2, star: 4, type: '일반' }); await user.save();
    const before = structuredClone(user.inventory);
    const sent = await action('transfer', { sourceId: user.id, targetId: secondId, kind: 'card', index: 0, itemToken: list.cards[0].token });
    assert.equal(sent.status, 409);
    assert.deepEqual((await rpg.getUserByPrimaryId(user.id)).inventory, before);
});

test('기존 초월 장비도 거래가 금지되고 전송기로 강화·잠재·고유 ID를 보존해 이전한다', async () => {
    const equipment = rpg.getDataCache('Equipment', {});
    const id = equipment.weapon.length;
    equipment.weapon.push({ name: '검증용 초월', rarity: '초월', no_trade: false, stat: { atk: 10 } });
    const items = rpg.getDataCache('Item', []), ticket = items.length;
    items.push({ name: '장비 전송기', type: '티켓' });
    const user = await rpg.getUserByPrimaryId(sandbox.account.id);
    const equip = { type: 'weapon', id, uid: 'preserved-transcend', level: 15, transcendStage: 3, potential: { rarity: '레전더리' }, boundOwner: user.name };
    assert.match(rpg.getEquipmentTradeBlockReason(equip, user.name), /초월 장비는 거래할 수 없습니다/);
    user.inventory.equipment.push(equip); rpg.addInventoryItem(user, ticket, 1); await user.save();
    const entry = (await request('/api/characters/transferable?sourceId=' + user.id)).body.equipment.find(entry => entry.name === '검증용 초월');
    const sent = await action('transfer', { sourceId: user.id, targetId: secondId, kind: 'equipment', index: entry.index, itemToken: entry.token });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    const target = await rpg.getUserByPrimaryId(secondId);
    assert.deepEqual(target.inventory.equipment.at(-1), { ...equip, boundOwner: target.name });
    assert.equal(rpg.getInventoryItemCount(await rpg.getUserByPrimaryId(user.id), ticket), 0);
});

test('카드 우편은 받는 캐릭터의 거래권을 한 번만 소모하고 반송은 거래권 없이 원본을 돌려준다', async () => {
    const created = await rpg.webRegisterRPGUser('우편받는이', '');
    assert.ok(created.user, JSON.stringify(created));
    let receiver = await rpg.ensureCharacterAccount(await rpg.getRPGUserByName('우편받는이'));
    let sender = await rpg.getUserByPrimaryId(sandbox.account.id);
    const card = { id: 5, star: 4, type: '각성', awakeningSpecter: '특수 속성 보존' };
    sender.inventory.card = [card, { ...card, id: 7 }]; await sender.save();
    const first = await rpg.sendMail(sender, receiver.name, '거래권 수령', '', [{ type: 'card', index: 0 }]);
    assert.equal(first.ok, true, first.error);
    receiver = await rpg.getUserByPrimaryId(receiver.id);
    assert.match((await rpg.claimMailGifts(receiver, first.mailId)).error, /거래권/);
    rpg.addInventoryItem(receiver, cardTicket, rpg.getCardTicketCost(card)); await receiver.save();
    assert.equal((await rpg.claimMailGifts(receiver, first.mailId)).ok, true);
    assert.deepEqual(receiver.inventory.card.at(-1), card);
    assert.equal(rpg.getInventoryItemCount(receiver, cardTicket), 0);
    assert.ok((await rpg.claimMailGifts(receiver, first.mailId)).error);
    sender = await rpg.getUserByPrimaryId(sender.id);
    const second = await rpg.sendMail(sender, receiver.name, '반송', '', [{ type: 'card', index: 0 }]);
    receiver = await rpg.getUserByPrimaryId(receiver.id);
    assert.equal((await rpg.returnMailGifts(receiver, second.mailId)).ok, true);
    assert.ok((await rpg.returnMailGifts(receiver, second.mailId)).error);
    sender = await rpg.getUserByPrimaryId(sender.id);
    assert.equal((await rpg.claimMailGifts(sender, 'return:' + second.mailId)).ok, true);
    assert.deepEqual(sender.inventory.card.at(-1), { ...card, id: 7 });
});

test('기존 카드 슬롯 장착 요청은 카드나 인벤토리를 변경하지 않고 거절한다', async () => {
    const user = await rpg.getUserByPrimaryId(secondId);
    user.main_card = { id: 1, star: 4, type: '일반' }; user.card_slot = [];
    user.inventory.card = [{ id: 1, star: 4, type: '각성' }, { id: 1, star: 4, type: '전직' }, { id: 1, star: 4, type: '일반' }];
    assert.match(rpg.equipCharacterCardSlot(user, 1), /^❌/);
    assert.match(rpg.equipCharacterCardSlot(user, 1), /^❌/);
    assert.match(rpg.equipCharacterCardSlot(user, 2), /^❌/);
    assert.equal(user.card_slot.length, 0);
    assert.equal(user.inventory.card.length, 3);
});

test('전투력 랭킹은 캐릭터별 마을 전투력을 표시하고 전투 버프나 현재 체력에 흔들리지 않는다', async () => {
    const user = await rpg.getUserByPrimaryId(sandbox.account.id);
    user.main_card = { id: 8, star: 11, type: '각성' };
    user.field = null; user.hp = 1; user.battleCryPotion = { amount: 10, expired_at: Date.now() + 60000 };
    const before = JSON.stringify(user), town = rpg.calculateTownCombatPower(user).total;
    assert.equal(JSON.stringify(user), before, '랭킹 계산은 플레이 상태를 수정하지 않는다');
    assert.notEqual(rpg.calculateCombatPower(user).total, town);
    const fresh = { ...user, hp: 99999999, field: { buffs: { attack: { value: 10, expired_at: Date.now() + 60000 } } } };
    assert.equal(rpg.calculateTownCombatPower(fresh).total, town);
    await user.save();
    const ranking = (await request('/api/ranking')).body;
    assert.equal(ranking.cp.find(row => row.name === user.name).value, town);
    assert.ok(ranking.cp.some(row => row.name === '두번째새이름'));
});

test('프리셋을 다시 장착해도 직접 연결한 부캐를 보존한다', async () => {
    const user = await rpg.getUserByPrimaryId(sandbox.account.id);
    user.slotCharacterLinks = [secondId];
    user.inventory.card = [];
    rpg.saveUserPreset(user, 0);
    const applied = rpg.applyUserPreset(user, 0);
    assert.equal(applied.ok, true, applied.error);
    assert.deepEqual(user.slotCharacterLinks, [secondId, null, null, null, null]);
    assert.deepEqual(user.inventory.card, [], '프리셋이 부캐의 카드를 인벤토리로 복제하지 않는다');
});

test('계정 공용 구매 제한과 초보자 패키지의 캐릭터별 구매 제한을 구분한다', async () => {
    const user = await rpg.getUserByPrimaryId(sandbox.account.id), items = rpg.getDataCache('Item');
    const starter = { shopId: require('../shop_catalog').newShopItemId(), type: '아이템', item_id: items.findIndex(item => item.name === '초보자 지원 패키지'), limits: { max: 1 } };
    const shared = { shopId: require('../shop_catalog').newShopItemId(), type: '아이템', item_id: 0, limits: { max: 1 } };
    rpg.getShopRemainingLimits(user, '패키지', 0, starter, new Date()).rec.max = 1;
    rpg.getShopRemainingLimits(user, '일반', 0, shared, new Date()).rec.max = 1;
    await user.save();
    const other = await rpg.getUserByPrimaryId(secondId);
    assert.equal(rpg.getShopRemainingLimits(other, '패키지', 0, starter, new Date()).remaining.max, 1);
    assert.equal(rpg.getShopRemainingLimits(other, '일반', 0, shared, new Date()).remaining.max, 0);
});

test('계정 최고 레벨로 사냥 한도를 계산하고 보너스 전 골드만 한도에서 차감한다', async () => {
    const other = await rpg.getUserByPrimaryId(secondId); other.level = 260; await other.save();
    const user = await rpg.getUserByPrimaryId(sandbox.account.id);
    user.main_card = { id: 0, type: '일반', star: 4 }; user.card_slot = []; user.battleCryPotion = null;
    const state = rpg.getAccountGoldState(user);
    assert.equal(state.limit, 150000000);
    user.huntingGold = { date: state.date, used: state.limit - 1 };
    const dungeon = require('../DB/RPGenius/Dungeon.json')[0];
    user.level = dungeon.requireLevel + 10; user.hp = user.mp = 1000000;
    user.field = { name: dungeon.name, enteredAt: Date.now(), nextActionAt: 0, skillCooldowns: {}, killCount: 0, elite: null };
    const before = user.gold, random = Math.random; Math.random = () => .5;
    try { await rpg.buildHuntResult(user, dungeon, dungeon.hp * 2, { isBasic: true, goldBonus: 2 }); }
    finally { Math.random = random; }
    assert.equal(user.huntingGold.used, state.limit);
    assert.equal(user.gold - before, 3);
    const capped = user.gold;
    Math.random = () => .5;
    try { await rpg.buildHuntResult(user, dungeon, dungeon.hp * 2, { isBasic: true, goldBonus: 2 }); }
    finally { Math.random = random; }
    assert.equal(user.gold, capped);
    user.huntingGold.date = '2000-01-01';
    assert.equal(rpg.getAccountGoldState(user).remaining, state.limit);
});

test('연결 부캐 레벨 합산은 실제 드랍 확률에도 적용된다', async () => {
    const dungeon = require('../DB/RPGenius/Dungeon.json')[0], items = rpg.getDataCache('Item');
    if (!items.some(item => item.name === '인내의 보석')) items.push({ name: '인내의 보석', type: '재료' });
    const gemId = items.findIndex(item => item.name === '인내의 보석');
    for (const linked of [false, true]) {
        const user = await rpg.getUserByPrimaryId(sandbox.account.id);
        user.main_card = { id: 0, star: 4, type: '일반' }; user.level = dungeon.requireLevel + 10; user.hp = user.mp = 1000000;
        user.card_slot = [{ id: 1, star: 4, type: '각성' }]; user.slotCharacterLinks = linked ? [secondId] : [];
        assert.equal(rpg.getLinkedCharacterLevelSum(user), linked ? 260 : 0);
        user.field = { name: dungeon.name, enteredAt: Date.now(), nextActionAt: 0, skillCooldowns: {}, killCount: 0, elite: null };
        const before = rpg.getInventoryItemCount(user, gemId), random = Math.random; Math.random = () => .0011;
        try { await rpg.buildHuntResult(user, dungeon, dungeon.hp * 2, { isBasic: true }); }
        finally { Math.random = random; }
        assert.equal(rpg.getInventoryItemCount(user, gemId) - before, linked ? 1 : 0);
    }
});

test('웹에 접속하지 않은 기존 채팅 유저도 첫 게임 명령에서 계정을 분리한다', async () => {
    const legacy = new rpg.RPGUser('채팅기존', 'chat-legacy');
    legacy.logged_in = ['chat-sender']; legacy.gold = 777;
    legacy.main_card = { id: 0, type: '일반', star: 4 };
    legacy.card_slot = [{ id: 1, type: '일반', star: 4 }, { id: 1, type: '각성', star: 4 }];
    await legacy.save();
    const messages = [];
    await rpg.onChat({ text: '/rpg 정보', getSenderInfo: () => ({ userId: 'chat-sender' }) },
        { channelId: 'web-chat:isolated', sendChat: text => messages.push(text) });
    await rpg.enqueueFieldAction(legacy, async () => {});
    const user = await rpg.getRPGUserById('chat-sender');
    assert.equal(user.accountId, 'account:chat-legacy');
    assert.equal(user.characterNumber, 1); assert.equal(user.gold, 777);
    assert.equal(user.card_slot.length, 0);
    assert.ok(user.inventory.card.some(card => card.id === 1 && card.type === '일반'));
    assert.ok(user.inventory.card.some(card => card.id === 1 && card.type === '각성'));
    assert.ok(messages.length > 0);
});

test('편지 작성 중 카드 순서가 바뀌면 다른 카드를 발송하지 않고 재선택을 요청한다', async () => {
    const user = await rpg.getUserByPrimaryId(sandbox.account.id);
    user.inventory.card = [{ id: 3, type: '각성', star: 11 }, { id: 4, type: '일반', star: 4 }];
    await user.save();
    const listed = (await request('/api/mail/giftable')).body.cards[0];
    user.inventory.card.reverse(); await user.save();
    const before = structuredClone(user.inventory.card);
    const sent = await request('/api/mail/send', { to: '두번째새이름', subject: '목록 검증', gifts: [{ type: 'card', index: listed.index, version: listed.version }] });
    assert.equal(sent.status, 409);
    assert.match(sent.body.error, /카드 목록이 변경/);
    assert.deepEqual((await rpg.getUserByPrimaryId(user.id)).inventory.card, before);
});

test('부캐 5명의 메인 카드와 레벨이 실제 슬롯이 되고 메인 고유 효과만 함께 적용된다', async () => {
    const main = await rpg.getUserByPrimaryId(sandbox.account.id);
    main.main_card = { id: 0, type: '일반', star: 11 };
    main.card_slot = []; main.slotCharacterLinks = []; main.field = null; main.pendingAction = null;
    await main.save();
    const second = await rpg.getUserByPrimaryId(secondId);
    second.main_card = { id: 1, type: '일반', star: 4 }; second.level = 200; await second.save();
    const members = [second];
    for (const [index, cardId] of [2, 3, 4, 6, 5].entries()) {
        const created = await action('create', { name: '슬롯검증' + index, cardId });
        assert.equal(created.status, 200, JSON.stringify(created.body));
        const member = await rpg.getUserByPrimaryId(created.body.id);
        member.main_card = { id: cardId, type: cardId === 6 ? '각성' : '일반', star: 4 };
        member.level = [180, 120, 100, 100, 80][index]; await member.save();
        members.push(member);
    }
    for (let index = 0; index < 5; index++) {
        const chosen = await action('link', { characterId: main.id, index, linkedId: members[index].id });
        assert.equal(chosen.status, 200, JSON.stringify(chosen.body));
    }
    assert.equal((await action('link', { characterId: main.id, index: 5, linkedId: members[5].id })).status, 400);
    assert.equal((await action('link', { characterId: main.id, index: 0, linkedId: 'another-account' })).status, 403);
    assert.equal((await action('link', { characterId: main.id, index: 0, linkedId: main.id })).status, 400);
    const user = await rpg.getUserByPrimaryId(main.id), beforeCards = structuredClone(user.inventory.card);
    const effects = rpg.calculateCardSlotEffects(user);
    assert.equal(effects.linkedHp, 700);
    assert.equal(effects.goldBonus, .7); assert.equal(effects.expBonus, .7); assert.equal(effects.itemDropChance, .7);
    assert.equal(effects.skillCoolReduction, .1, '슬롯에 빵귤이 없어도 메인 빵귤 고유 효과가 적용된다');
    assert.equal(effects.finalAttackBonus, .05, '5성 부캐 5명의 1%만 적용하고 오메가 메인의 12%는 제외한다');
    assert.equal(effects.critMul, .15); assert.equal(effects.crit, -.05);
    assert.deepEqual(user.card_slot, []);
    assert.deepEqual(user.inventory.card, beforeCards);
    const profile = (await request('/api/profile')).body;
    assert.deepEqual(profile.cardSlots.map(card => card.slotCharacterId), members.slice(0, 5).map(member => member.id));
    assert.equal(profile.cardSlots[4].type, '각성');
    const linksView = (await request('/api/characters/links')).body;
    assert.match(linksView.slots[4].name, /각성 켄시/);
    assert.ok(linksView.slots[4].effects.some(effect => effect.name === '치명타 피해량' && effect.value === '+15%' && effect.active));
    assert.ok(linksView.slots[4].effects.some(effect => effect.name === '치명타 확률 감소' && effect.value === '5%' && effect.negative && effect.active));
    assert.ok(linksView.slots[4].effects.some(effect => effect.grade && effect.value === '+1%'));
    assert.ok(linksView.character.effects.every(effect => !effect.grade), '메인의 등급 공격력을 슬롯 효과로 표시하지 않는다');
    assert.ok(linksView.slots.every(slot => slot.effects.length && slot.candidates.every(candidate => Array.isArray(candidate.effects))));

    rpg.saveUserPreset(user, 0);
    const preset = structuredClone(user.presets[0]);
    assert.equal(preset.slotCards, undefined, '프리셋에는 부캐 ID를 저장하고 다른 캐릭터의 카드를 소유한 것으로 저장하지 않는다');
    user.slotCharacterLinks = [];
    assert.equal(rpg.applyUserPreset(user, 0).ok, true);
    assert.deepEqual(user.slotCharacterLinks, members.slice(0, 5).map(member => member.id));
    assert.deepEqual(user.inventory.card, beforeCards);
    await user.save();
    const presetView = (await request('/api/presets')).body;
    assert.deepEqual(presetView.current.slotCards.map(card => card.slotCharacterId), members.slice(0, 5).map(member => member.id));
    assert.deepEqual(presetView.presets[0].slotCards.map(card => card.slotCharacterName), members.slice(0, 5).map(member => member.name));

    const pvp = require('../pvp');
    const defense = { useEquipped: false, mainCard: rpg.cardPresetSignature(user.main_card),
        slotCharacterLinks: user.slotCharacterLinks, rules: pvp.DEFAULT_RULES };
    const saved = await request('/api/pvp/defense', defense);
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.ok, true, JSON.stringify(saved.body));
    const defender = await rpg.getUserByPrimaryId(main.id), deck = pvp.resolveDefenseDeck(defender);
    const snapshot = pvp.buildSideSnapshot(defender, deck);
    assert.equal(snapshot.slotEffects.linkedHp, 700);
    assert.equal(snapshot.slotEffects.finalAttackBonus, .05);
    assert.ok(pvp.validateDefensePayload(user, { ...defense, slotCharacterLinks: [main.id] }).error);
    assert.ok(pvp.validateDefensePayload(user, { ...defense, slotCharacterLinks: [members[0].id, members[0].id] }).error);

    members[0].level = 220; await members[0].save();
    assert.equal(rpg.calculateCardSlotEffects(await rpg.getUserByPrimaryId(main.id)).linkedHp, 720);
    members[5].main_card = { id: 1, type: '전직', star: 4 }; await members[5].save();
    assert.equal((await action('link', { characterId: main.id, index: 4, linkedId: members[5].id })).status, 400, '슬롯끼리는 다른 타입도 동일 캐릭터 중복 불가');
    members[5].main_card = { id: 0, type: '일반', star: 4 }; await members[5].save();
    assert.equal((await action('link', { characterId: main.id, index: 4, linkedId: members[5].id })).status, 400, '메인과 타입까지 같으면 불가');
    members[5].main_card.type = '전직'; await members[5].save();
    assert.equal((await action('link', { characterId: main.id, index: 4, linkedId: members[5].id })).status, 200, '메인과 같은 캐릭터도 다른 타입이면 부캐 1명 허용');
    assert.ok(Math.abs(rpg.calculateCardSlotEffects(await rpg.getUserByPrimaryId(main.id)).skillCoolReduction - .15) < 1e-12);
    members[5].main_card.type = '일반'; await members[5].save();
    const state = (await request('/api/characters/links')).body;
    assert.match(state.slots[4].error, /타입이 다를 때/);
    assert.equal(rpg.calculateCardSlotEffects(await rpg.getUserByPrimaryId(main.id)).skillCoolReduction, .1, '부캐 카드가 바뀌어 중복 조건에 걸리면 효과를 중복 적용하지 않는다');
});
