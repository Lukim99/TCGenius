'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const sandbox = require('../scripts/paradise-lab/sandbox');
const { rpg } = sandbox;
let base, cookie, altId, artifactId;
async function request(path, body) {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST',
        headers: { Cookie: cookie || '', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    assert.equal(response.status, 200, path);
    return response.json();
}
before(async () => {
    base = 'http://127.0.0.1:' + await sandbox.start();
    await request('/api/login', { name: sandbox.account.name, code: 'LAB' });
    altId = (await request('/api/characters/create', { name: '아티팩트부캐', cardId: 1, requestId: crypto.randomUUID() })).id;
    const equipment = rpg.getDataCache('Equipment'); equipment.artifact ||= [];
    artifactId = equipment.artifact.length;
    equipment.artifact.push({ name: '격리 검증 아티팩트', rarity: '레전더리', artifact: true });
});
after(() => sandbox.close());

test('일일 던전 골드는 보너스와 럭키 타임을 온전히 지급하고 사냥 한도에는 적립하지 않는다', async () => {
    const user = await rpg.getUserByPrimaryId(sandbox.account.id);
    user.goldPotion = null; user.jobPrestige = false;
    const original = rpg.findDailyDungeonByName('마동');
    const dungeon = { ...original, dailyDungeon: { ...original.dailyDungeon, exp: 0, gold: { min: 1000, max: 1000 }, items: [], itemChoices: [] } };
    const cap = rpg.getAccountGoldState(user);
    for (const used of [0, cap.limit - 500, cap.limit]) for (const lucky of [false, true]) {
        user.huntingGold = { date: cap.date, used };
        user.field = { name: dungeon.name, dailyDungeon: true, enteredAt: Date.now(), skillCooldowns: {} };
        const before = user.gold;
        const result = rpg.grantDailyDungeonClearReward(user, dungeon, { gold: .2 }, { goldBonus: .3 }, { goldBonus: .5 }, () => lucky ? 0 : .9);
        assert.equal(result.error, undefined);
        assert.equal(result.gold, lucky ? 4000 : 2000);
        assert.equal(user.gold - before, result.gold);
        assert.deepEqual(user.huntingGold, { date: cap.date, used });
        await rpg.getCharacterStore().commit([user]);
        assert.equal(rpg.getAccountGoldState(await rpg.getUserByPrimaryId(altId)).used, used);
    }
    user.huntingGold = null; await rpg.getCharacterStore().commit([user]);
});

test('슬롯이 없어도 메인 레벨을 체력과 세 보너스에 더하고 잘못된 슬롯은 중복 합산하지 않는다', async () => {
    const user = await rpg.getUserByPrimaryId(sandbox.account.id), alt = await rpg.getUserByPrimaryId(altId);
    user.level = 200; user.main_card = { id: 0, type: '일반', star: 0 };
    user.equipments = {}; user.card_slot = []; user.slotCharacterLinks = [];
    alt.level = 100; await rpg.getCharacterStore().commit([alt]);
    const check = sum => {
        const effects = rpg.calculateCardSlotEffects(user);
        assert.equal(rpg.getLinkedCharacterLevelSum(user), sum);
        assert.equal(effects.linkedHp, sum);
        for (const key of ['goldBonus', 'expBonus', 'itemDropChance']) assert.equal(effects[key], sum / 1000);
        assert.equal(rpg.calculateUserStats(user).hp - rpg.calculateUserStats({ ...user, accountId: null }).hp, sum);
    };
    check(200);
    user.slotCharacterLinks = [user.id, altId, altId, 'missing']; check(300);
    alt.main_card.star = 3; await rpg.getCharacterStore().commit([alt]); check(200);
    alt.main_card.star = 4; await rpg.getCharacterStore().commit([alt]);
    user.slotCharacterLinks = []; user.level = 201; check(201);
    user.level = 200; await rpg.getCharacterStore().commit([user]);
    assert.equal((await request('/api/characters/links')).levelSum, 200);
    await request('/api/characters/select', { id: altId, requestId: crypto.randomUUID() });
    assert.equal((await request('/api/characters/links')).levelSum, 100, '전환한 캐릭터의 레벨을 사용한다');
    await request('/api/characters/select', { id: user.id, requestId: crypto.randomUUID() });
});

test('메인 200레벨만으로 실제 골드와 경험치가 20% 증가하고 드롭 확률도 증가한다', async () => {
    const user = await rpg.getUserByPrimaryId(sandbox.account.id);
    user.level = 200; user.exp = 0; user.main_card = { id: 0, type: '일반', star: 4 };
    user.slotCharacterLinks = []; user.card_slot = []; user.equipments = {};
    user.goldPotion = user.expPotion = user.battleCryPotion = null;
    user.prestige = user.jobPrestige = false; user.statTitle = user.equippedTitle = null; user.huntingGold = null;
    const original = require('../DB/RPGenius/Dungeon.json')[0];
    const dungeon = { ...original, requireLevel: 190, reward: { exp: 1000, gold: { min: 2000, max: 2000 } } };
    const items = rpg.getDataCache('Item');
    let gemId = items.findIndex(item => item.name === '인내의 보석');
    if (gemId < 0) { gemId = items.length; items.push({ name: '인내의 보석', type: '재료' }); }
    user.field = { name: dungeon.name, enteredAt: Date.now(), nextActionAt: 0, skillCooldowns: {}, killCount: 0, elite: null };
    user.hp = user.mp = 1000000;
    const goldBefore = user.gold, gemBefore = rpg.getInventoryItemCount(user, gemId), random = Math.random;
    Math.random = () => .0011; // 기본 0.1%는 실패하고 레벨 보너스가 적용된 0.12%는 성공한다.
    try { await rpg.buildHuntResult(user, dungeon, dungeon.hp, { isBasic: true }); }
    finally { Math.random = random; }
    assert.equal(user.gold - goldBefore, 2400);
    assert.equal(user.exp, 1200);
    assert.equal(user.huntingGold.used, 2000);
    assert.equal(rpg.getInventoryItemCount(user, gemId) - gemBefore, 1);
    user.field = null; await rpg.getCharacterStore().commit([user]);
});

test('기본 골드만 한도에 적립하고 메인 레벨과 추가 골드 보너스는 지급에만 적용한다', async () => {
    const user = await rpg.getUserByPrimaryId(sandbox.account.id);
    user.main_card = { id: 0, type: '일반', star: 4 }; user.slotCharacterLinks = []; user.card_slot = [];
    user.equipments = {}; user.battleCryPotion = null; user.goldPotion = null; user.jobPrestige = false;
    const original = require('../DB/RPGenius/Dungeon.json')[0];
    const dungeon = { ...original, reward: { ...original.reward, exp: 0, gold: { min: 2000, max: 2000 } } };
    user.level = dungeon.requireLevel + 10; user.hp = user.mp = 1000000; user.huntingGold = null;
    user.field = { name: dungeon.name, enteredAt: Date.now(), nextActionAt: 0, skillCooldowns: {}, killCount: 0, elite: null };
    const before = user.gold;
    await rpg.buildHuntResult(user, dungeon, dungeon.hp, { isBasic: true, goldBonus: .5 });
    assert.equal(user.gold - before, Math.round(2000 * (1.5 + user.level / 1000)));
    assert.equal(user.huntingGold.used, 2000);
    await rpg.getCharacterStore().commit([user]);
    assert.equal((await request('/api/characters')).goldCap.used, 2000);
    assert.equal(rpg.getAccountGoldState(await rpg.getUserByPrimaryId(altId)).used, 2000);
    const state = rpg.getAccountGoldState(user);
    user.huntingGold.used = state.limit - 1000;
    const nearLimit = user.gold;
    await rpg.buildHuntResult(user, dungeon, dungeon.hp, { isBasic: true, goldBonus: .5 });
    assert.equal(user.gold - nearLimit, Math.round(1000 * (1.5 + user.level / 1000)));
    assert.equal(user.huntingGold.used, state.limit);
    const capped = user.gold;
    await rpg.buildHuntResult(user, dungeon, dungeon.hp, { isBasic: true, goldBonus: .5 });
    assert.equal(user.gold, capped);
    user.field = null; await rpg.getCharacterStore().commit([user]);
});

test('아티팩트 슬롯 조건은 연결 부캐로 판정하며 상세 표시와 실제 발현 효과가 일치한다', async () => {
    const alt = await rpg.getUserByPrimaryId(altId);
    alt.main_card = { id: 1, type: '각성', star: 8 }; await rpg.getCharacterStore().commit([alt]);
    const user = await rpg.getUserByPrimaryId(sandbox.account.id);
    user.main_card = { id: 0, type: '일반', star: 4 }; user.card_slot = [];
    user.slotCharacterLinks = [altId, null, null, null, null];
    const equip = { type: 'artifact', id: artifactId, level: 0, uid: 'isolated-slot-artifact', artifact: { options: [
        { type: 'slotStar', condition: 9, ability: 'finalDamage', n: 10 },
        { type: 'mainStar', condition: 5, ability: 'finalDamage', n: 10 },
        { type: 'character', condition: 0, ability: 'finalDamage', n: 5 }
    ] } };
    user.equipments.artifact = equip;
    const compare = async (expectedActive, manifestation, bonus) => {
        const equipped = rpg.calculateUserStats(user);
        delete user.equipments.artifact;
        const plain = rpg.calculateUserStats(user);
        user.equipments.artifact = equip;
        assert.ok(Math.abs(equipped.finalDamage - plain.finalDamage - bonus) < 1e-8);
        const view = rpg.getArtifactView(user, equip);
        assert.deepEqual(view.options.map(option => option.active), expectedActive);
        assert.equal(view.manifestation, manifestation);
        assert.equal(view.bonuses.find(row => row.threshold === 25).active, manifestation >= 25);
        await rpg.getCharacterStore().commit([user]);
        const response = await request('/api/artifact/' + equip.uid);
        assert.deepEqual(response.artifact.options.map(option => option.active), expectedActive);
        assert.equal(response.artifact.manifestation, manifestation);
    };
    await compare([true, true, true], 25, .33);
    user.slotCharacterLinks = [];
    await compare([false, true, true], 15, .23);
    user.slotCharacterLinks = [altId];
    alt.main_card.star = 7; await rpg.getCharacterStore().commit([alt]);
    await compare([false, true, true], 15, .23);
    alt.main_card.star = 8; await rpg.getCharacterStore().commit([alt]);
    await compare([true, true, true], 25, .33);
});
