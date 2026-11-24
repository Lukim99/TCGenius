'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const sandbox = require('../scripts/paradise-lab/sandbox');
const { rpg } = sandbox;
const compositor = require('../card_composite');
const ticketMigration = require('../scripts/rename_nickname_color_ticket');
let base, cookie, altId;
async function request(path, body) {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST',
        headers: { Cookie: cookie || '', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body) });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    return { status: response.status, data: await response.json() };
}
const setColor = (id, color) => request('/api/characters/nickname-color', { id, color });
before(async () => {
    base = 'http://127.0.0.1:' + await sandbox.start();
    assert.equal((await request('/api/login', { name: sandbox.account.name, code: 'LAB' })).status, 200);
    const result = await request('/api/characters/create', { name: '색상부캐', cardId: 1, requestId: crypto.randomUUID() });
    assert.equal(result.status, 200); altId = result.data.id;
});
after(() => sandbox.close());

test('권한 없이 색을 설정할 수 없으며 변경권은 기존 아이템 번호와 +5% 혜택을 유지한다', async () => {
    assert.equal((await setColor(sandbox.account.id, '#83C7FF')).status, 403);
    const user = await rpg.getUserByPrimaryId(sandbox.account.id);
    const items = rpg.getDataCache('Item', []), id = items.findIndex(item => item.use === '전직프레스티지');
    assert.equal(id, 178); assert.equal(items[id].name, '닉네임 색깔 변경권');
    rpg.addInventoryItem(user, id, 2); await user.save();
    const result = await rpg.useItem(user, items[id].name, 1);
    assert.match(result, /닉네임 색깔 변경 권한/); assert.match(result, /골드 획득량 \+5%/);
    assert.equal((await rpg.getUserByPrimaryId(altId)).jobPrestige, true);
    assert.equal((await request('/api/characters')).data.canChangeNicknameColor, true);
    const hero = await rpg.getUserByPrimaryId(user.id);
    const source = require('../DB/RPGenius/Dungeon.json')[0];
    const dungeon = { ...source, requireLevel: hero.level - 10, reward: { ...source.reward, exp: 0, gold: { min: 1000, max: 1000 } } };
    const earnings = [];
    for (const owned of [false, true]) {
        hero.jobPrestige = owned; hero.huntingGold = null; hero.hp = hero.mp = 1000000;
        hero.field = { name: dungeon.name, enteredAt: Date.now(), nextActionAt: 0, skillCooldowns: {}, killCount: 0, elite: null };
        const gold = hero.gold;
        await rpg.buildHuntResult(hero, dungeon, dungeon.hp, { isBasic: true });
        earnings.push(hero.gold - gold);
        assert.equal(hero.huntingGold.used, 1000);
    }
    assert.equal(earnings[1] - earnings[0], 50, '기존 골드 획득량 +5%는 실제 지급에 유지된다');
    hero.field = null; await hero.save();
    const reloaded = await rpg.getUserByPrimaryId(user.id), mileage = Number(reloaded.mileage || 0);
    await rpg.useItem(reloaded, items[id].name, 1);
    assert.equal((await rpg.getUserByPrimaryId(user.id)).mileage, mileage + 20000);
    assert.equal(rpg.getInventoryItemCount(await rpg.getUserByPrimaryId(user.id), id), 0);
});

test('색상은 캐릭터별로 저장되고 다른 계정 지정과 CSS 주입을 거부한다', async () => {
    for (const value of ['red', '#FFF', '#123456;display:none', '#12345678', {}, 123456, '']) {
        assert.equal((await setColor(sandbox.account.id, value)).status, 400);
    }
    assert.equal((await setColor('another-account-character', '#FFFFFF')).status, 403);
    assert.equal((await setColor(sandbox.account.id, '#83c7ff')).status, 200);
    assert.equal((await setColor(altId, '#FF809E')).status, 200);
    const main = await rpg.getUserByPrimaryId(sandbox.account.id), alt = await rpg.getUserByPrimaryId(altId);
    assert.equal(main.nicknameColor, '#83C7FF'); assert.equal(alt.nicknameColor, '#FF809E');
    const state = (await request('/api/characters')).data;
    assert.equal(state.characters.find(c => c.id === altId).nicknameColor, '#FF809E');
    assert.equal(rpg.getCharacterStore().accountFor(main).nicknameColor, undefined);
});

test('전투 또는 파견 중 외형을 바꿔도 전투 상태와 공유 재화를 덮어쓰지 않는다', async () => {
    const user = await rpg.getUserByPrimaryId(sandbox.account.id);
    user.field = { name: '테스트 사냥터', hp: 1234, nextActionAt: Date.now() + 10000 };
    user.dispatch = { status: 'active', destination: 'heaven', endsAt: Date.now() + 600000 };
    await user.save();
    user.field.hp = 987;
    await rpg.getCharacterStore().commit([user], { keys: ['field'], defer: true });
    const before = await rpg.getUserByPrimaryId(user.id);
    assert.equal((await setColor(user.id, '#FFD780')).status, 200);
    const current = await rpg.getUserByPrimaryId(user.id);
    for (const key of ['field', 'dispatch', 'gold', 'point', 'mileage', 'inventory', 'jobPrestige']) assert.deepEqual(current[key], before[key], key);
    assert.equal(current.nicknameColor, '#FFD780');
    current.field = null; current.dispatch = null; await current.save();
});

test('공개 표시 목록은 DB 읽기 없이 캐시를 사용하며 기본색 복원과 권한을 반영한다', async t => {
    const send = DynamoDBDocumentClient.prototype.send;
    let reads = 0;
    const mock = t.mock.method(DynamoDBDocumentClient.prototype, 'send', function(command) {
        if (['GetCommand', 'ScanCommand', 'BatchGetCommand'].includes(command.constructor.name)) reads++;
        return send.call(this, command);
    });
    for (let i = 0; i < 3; i++) {
        const result = await request('/api/characters/nickname-colors');
        assert.equal(result.status, 200); assert.equal(result.data['색상부캐'], '#FF809E');
        assert.equal(result.data[sandbox.account.name], '#FFD780');
    }
    assert.equal(reads, 0); mock.mock.restore();
    assert.equal((await setColor(altId, null)).status, 200);
    assert.equal((await request('/api/characters/nickname-colors')).data['색상부캐'], undefined);
    const user = await rpg.getUserByPrimaryId(sandbox.account.id);
    user.jobPrestige = false; await user.save();
    assert.deepEqual((await request('/api/characters/nickname-colors')).data, {});
    user.jobPrestige = true; await user.save();
    assert.equal((await request('/api/characters/nickname-colors')).data[sandbox.account.name], '#FFD780');
    const response = await fetch(base + '/api/characters/nickname-colors');
    assert.equal(response.status, 401);
});

test('전직 프레스티지 프레임은 제거하고 일반 프레스티지와 아바타는 유지한다', () => {
    for (const star of [9, 10, 11]) {
        const job = { name: '빵귤', type: '전직', star };
        const normal = { ...job, type: '일반' };
        assert.deepEqual(compositor.resolveCardLayers({ ...job, prestige: true }), compositor.resolveCardLayers(job));
        assert.notDeepEqual(compositor.resolveCardLayers({ ...normal, prestige: true }), compositor.resolveCardLayers(normal));
        const skin = { ...job, skin: '할로윈' };
        assert.deepEqual(compositor.resolveCardLayers({ ...skin, prestige: true }), compositor.resolveCardLayers(skin));
    }
});

test('프로필 카드 주소는 전직 프레스티지를 요청하지 않고 일반 프레스티지는 유지한다', async () => {
    const user = await rpg.getUserByPrimaryId(sandbox.account.id);
    user.jobPrestige = user.prestige = true;
    user.main_card = { id: 0, star: 9, type: '전직' }; await user.save();
    const job = (await request('/api/profile')).data.mainCard;
    assert.equal(new URL(job.imageUrl, base).searchParams.has('prestige'), false);
    assert.equal(new URL(job.iconUrl, base).searchParams.has('prestige'), false);
    user.main_card.type = '일반'; await user.save();
    const normal = (await request('/api/profile')).data.mainCard;
    assert.equal(new URL(normal.imageUrl, base).searchParams.get('prestige'), '1');
});

test('카탈로그 변경은 같은 아이템의 이름과 설명만 바꾸며 운영 설정과 번호를 보존한다', () => {
    const item = { name: '전직 프레스티지 증표', desc: '기존 운영 설명', use: '전직프레스티지', no_trade: true, type: '사용', operatorValue: 123 };
    const list = [{ name: '다른 아이템' }, item], before = structuredClone(list);
    const plan = ticketMigration.prepare(list), command = ticketMigration.update(plan);
    assert.deepEqual(list, before); assert.equal(plan.index, 1);
    assert.deepEqual(plan.after, { ...item, name: '닉네임 색깔 변경권', desc: plan.after.desc });
    assert.match(command.UpdateExpression, /^SET #data\[1\].#name = :name, #data\[1\].#desc = :desc$/);
    assert.deepEqual(command.ExpressionAttributeValues[':before'], item);
    assert.equal(ticketMigration.prepare([{ ...plan.after, desc: '이후 운영자 편집' }]), null);
    assert.throws(() => ticketMigration.prepare([item, item]));
});
