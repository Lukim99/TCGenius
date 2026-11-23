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

test('기본 2000골드와 50% 보너스는 3000골드를 지급하고 공용 한도에는 2000만 적립한다', async () => {
    const user = await rpg.getUserByPrimaryId(sandbox.account.id);
    user.main_card = { id: 0, type: '일반', star: 4 }; user.slotCharacterLinks = []; user.card_slot = [];
    user.equipments = {}; user.battleCryPotion = null; user.goldPotion = null; user.jobPrestige = false;
    const original = require('../DB/RPGenius/Dungeon.json')[0];
    const dungeon = { ...original, reward: { ...original.reward, exp: 0, gold: { min: 2000, max: 2000 } } };
    user.level = dungeon.requireLevel + 10; user.hp = user.mp = 1000000; user.huntingGold = null;
    user.field = { name: dungeon.name, enteredAt: Date.now(), nextActionAt: 0, skillCooldowns: {}, killCount: 0, elite: null };
    const before = user.gold;
    await rpg.buildHuntResult(user, dungeon, dungeon.hp, { isBasic: true, goldBonus: .5 });
    assert.equal(user.gold - before, 3000);
    assert.equal(user.huntingGold.used, 2000);
    await rpg.getCharacterStore().commit([user]);
    assert.equal((await request('/api/characters')).goldCap.used, 2000);
    assert.equal(rpg.getAccountGoldState(await rpg.getUserByPrimaryId(altId)).used, 2000);
    const state = rpg.getAccountGoldState(user);
    user.huntingGold.used = state.limit - 1000;
    const nearLimit = user.gold;
    await rpg.buildHuntResult(user, dungeon, dungeon.hp, { isBasic: true, goldBonus: .5 });
    assert.equal(user.gold - nearLimit, 1500);
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
