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
let failTradeWrite = false, loseTradeResponse = false;
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
    if (command.constructor.name === 'TransactWriteCommand' && input.TransactItems.every(entry => entry.Update?.TableName === 'rpgenius_user')) {
        if (failTradeWrite) { failTradeWrite = false; throw new Error('simulated trade transaction failure'); }
        const staged = new Map();
        for (const { Update: update } of input.TransactItems) {
            const record = structuredClone(records.get(update.Key.id));
            const reject = () => { const error = new Error('simulated concurrent trade change'); error.name = 'TransactionCanceledException'; throw error; };
            if (!record) reject();
            for (const match of update.ConditionExpression.matchAll(/(#k\d+)\s*=\s*(:p\d+)/g)) {
                if (!require('node:util').isDeepStrictEqual(record[update.ExpressionAttributeNames[match[1]]], update.ExpressionAttributeValues[match[2]])) reject();
            }
            for (const match of update.ConditionExpression.matchAll(/attribute_not_exists\((#k\d+)\)/g)) {
                if (Object.hasOwn(record, update.ExpressionAttributeNames[match[1]])) reject();
            }
            for (const match of update.UpdateExpression.matchAll(/(#\w+)\s*=\s*(:\w+)/g)) record[update.ExpressionAttributeNames[match[1]]] = structuredClone(update.ExpressionAttributeValues[match[2]]);
            for (const match of (update.UpdateExpression.split('REMOVE ')[1] || '').matchAll(/#\w+/g)) delete record[update.ExpressionAttributeNames[match[0]]];
            staged.set(update.Key.id, record);
        }
        for (const [id, record] of staged) records.set(id, record);
        writes.push(...input.TransactItems.map(entry => structuredClone(entry.Update)));
        if (loseTradeResponse) { loseTradeResponse = false; throw new Error('simulated lost transaction response'); }
        return {};
    }
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
    for (const seed of seeds) {
        const state = rpg.getDirectTradeState(seed.name);
        const user = await rpg.getRPGUserByName(seed.name);
        if (state.status === 'active') await rpg.cancelTradeByUser(user);
        if (state.status === 'outgoing') rpg.cancelTradeRequest(user);
        party.stopSpectating(seed.name); party.leaveRoom(seed.name); rpg.clearFieldRuntimeTimers(seed.name);
    }
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
    party.stopSpectating(name); party.leaveRoom(name); rpg.clearFieldRuntimeTimers(name); rpg.__setQuestDefs([]);
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

function combatMember(stats = {}) {
    return {
        name: seeds[0].name, position: '브루저', skills: [], skillDefs: {},
        baseSnapshot: {
            stats: { atk: 1000, def: 0, hp: 1000000, mp: 1000000, crit: 0, critMul: 1.5, ...stats },
            slotEffects: {}, mainCardSkills: [], elementChain: {}, transcendEquipment: { entries: [], setCounts: {} }
        },
        runtime: { hp: 1000000, hpMax: 1000000, mp: 1000000, mpMax: 1000000, dead: false, buffs: [],
            equipmentState: {}, equipmentAtkBuffs: {}, cooldownsUntil: {}, stackCounters: {}, actionUntil: 0 }
    };
}

test('관전은 비밀번호와 인증을 확인하며 참가 인원, 전투 조작과 계정 데이터를 변경하지 않는다', async () => {
    const room = await battle(); room.password = 'raid-secret';
    const viewer = await reset(seeds[1].name);
    const before = structuredClone(viewer.inventory), writeCount = writes.length;
    const url = '/api/party/rooms/' + room.id + '/spectate';
    assert.equal((await request(url, {}, '')).status, 401);
    assert.equal((await request(url, {}, viewer.name)).status, 400);
    assert.equal((await request(url, { password: 'wrong' }, viewer.name)).status, 400);
    const watched = await request(url, { password: 'raid-secret' }, viewer.name);
    assert.equal(watched.status, 200); assert.equal(watched.data.room.spectating, true);
    assert.equal(watched.data.room.spectatorCount, 1);
    assert.equal(room.members.length, 1); assert.equal(party.getMyRoomSnapshot(viewer.name), null);
    assert.equal((await request('/api/party/me', undefined, viewer.name)).data.room.id, room.id);
    assert.ok(party.publicRoomList().some(entry => entry.id === room.id && entry.state === 'inProgress'));
    for (const [route, body] of [['attack', {}], ['skill', { skill: '방어' }], ['mansion-action', { action: 'finish' }], ['support-skill', { skill: '오로라' }], ['use-potion', { name: '상급 체력 포션' }], ['chat', { text: '관전' }], ['restart', {}]]) {
        assert.equal((await request('/api/party/' + route, body, viewer.name)).status, 400, route);
    }
    assert.equal(writes.length, writeCount); assert.deepEqual(viewer.inventory, before);
    assert.equal((await request('/api/party/spectate/leave', {}, viewer.name)).status, 200);
    assert.equal(party.getMyViewSnapshot(viewer.name), null); assert.equal(room.members.length, 1);
});

test('관전 SSE는 로그와 최신 관문을 전달하며 선택지와 보상은 노출하지 않고 방 종료 시 정리한다', async () => {
    const room = await battle(); const viewer = (await reset(seeds[1].name)).name;
    room.members[0].pendingChoices = ['private-choice'];
    assert.equal(party.spectateRoom(room.id, viewer, '').ok, true);
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(base + '/api/party/spectate/stream', { headers: { Cookie: cookie(viewer) }, signal: controller.signal });
    assert.equal(response.status, 200);
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let text = '';
    const readUntil = async needle => { while (!text.includes(needle)) { const value = await reader.read(); assert.equal(value.done, false); text += decoder.decode(value.value); } };
    try {
        await readUntil('\n\n');
        assert.ok(text.includes('"spectating":true')); assert.ok(!text.includes('private-choice'));
        text = ''; tick(room); await readUntil('\n\n'); assert.ok(text.includes('event: tick')); assert.ok(!text.includes('private-choice'));
        room.result = { cleared: true, rewards: [{ name: room.members[0].name, items: ['private-reward'] }] };
        const view = party.getMyViewSnapshot(viewer);
        assert.deepEqual(view.result.rewards, []); assert.equal(view.members[0].pendingChoices, null);
        const snapshot = party.getMyRoomSnapshot(room.members[0].name);
        assert.equal(snapshot.result.rewards[0].items[0], 'private-reward');
        party.leaveRoom(room.members[0].name); await readUntil('event: room-closed');
        assert.equal(party.getMyViewSnapshot(viewer), null);
        assert.equal((await request('/api/party/spectate/stream', undefined, viewer)).status, 403);
    } finally { clearTimeout(timeout); controller.abort(); party.stopSpectating(viewer); }
});

test('관전은 참가자의 접속을 바꾸지 않고 새 파티 참가 시 종료된다', async () => {
    const room = await battle(); const viewer = await reset(seeds[1].name);
    assert.ok(party.spectateRoom(room.id, seeds[0].name, '').error);
    assert.equal(party.spectateRoom(room.id, viewer.name, '').ok, true);
    viewer.unlockedRaids = ['mansionNormal'];
    await viewer.save();
    const created = await party.createRoom(viewer.name, 'mansionNormal'); assert.ok(created.roomId);
    assert.equal(room.spectators.size, 0); assert.equal(party.getMyViewSnapshot(viewer.name).spectating, undefined);
    party.leaveRoom(viewer.name);
});

test('보스와 관문 컷씬은 투명 보스 이미지와 별도의 전투 배경을 제공한다', async () => {
    const room = await battle();
    const mon = party.getMyRoomSnapshot(seeds[0].name).monster;
    assert.equal(mon.sprite, true); assert.ok(decodeURIComponent(mon.image).endsWith('레이드/sculpture-scene.png'));
    assert.ok(decodeURIComponent(mon.background).endsWith('레이드/sculpture-hall.png'));
    assert.equal(mon.scene.framed, true); assert.ok(mon.scene.aspect > 1.7);
    const upcoming = party.getMyRoomSnapshot(seeds[0].name).questDef.phases[1].artwork;
    assert.ok(decodeURIComponent(upcoming.image).endsWith('레이드/whiplash-scene.png'));
    party.__test.proceedToNextPhase(room);
    const cut = party.getMyRoomSnapshot(seeds[0].name).phaseTransition;
    assert.ok(decodeURIComponent(cut.toImage).endsWith('레이드/whiplash-scene.png'));
    assert.ok(decodeURIComponent(cut.toBackground).endsWith('레이드/whiplash-hall.png'));
    assert.equal(cut.fromScene.framed, true); assert.equal(cut.toScene.framed, true);
    const custom = party.__test.serializeMonster({ ...room.monster, image: 'custom-boss.png' });
    assert.equal(custom.sprite, false); assert.equal(custom.image, '/rpg-ui?file=custom-boss.png');
    const hardRoom = await battle('hard', 1, 1);
    const echoArt = party.__test.serializeMonster(hardRoom.monster).mansion.transitionArt;
    assert.ok(decodeURIComponent(echoArt.image).endsWith('레이드/whiplash-echo-scene.png'));
    assert.ok(decodeURIComponent(echoArt.background).endsWith('레이드/whiplash-echo-hall.png'));
    assert.equal(echoArt.scene.framed, true);
});

test('호두 두 난이도의 어둠 정화와 부하 관문은 전용 배경을 유지하고 호두의 붉은 기운으로 전환한다', async () => {
    for (const id of ['blackHodu', 'blackHoduExtreme']) {
        const user = await reset();
        assert.ok((await party.createRoom(user.name, id)).roomId);
        party.setPosition(user.name, '브루저'); party.setReady(user.name, true);
        assert.equal((await party.start(user.name)).ok, true);
        const room = party.getRoomOf(user.name); room.awaitingChoices = true;
        const snap = party.getMyRoomSnapshot(user.name);
        assert.equal(snap.phaseName, '어둠 정화'); assert.equal(snap.monster, null);
        assert.ok(decodeURIComponent(snap.phaseArtwork.background).endsWith('레이드/hodu-retainer-court.png'));
        party.__test.proceedToNextPhase(room);
        const elite = party.getMyRoomSnapshot(user.name);
        assert.equal(elite.monster.name, '흑화한 호두 부하');
        assert.ok(decodeURIComponent(elite.monster.image).endsWith('레이드/hodu-retainer.png'));
        assert.equal(elite.monster.background, snap.phaseArtwork.background);
        assert.equal(elite.phaseTransition.fromImage, null);
        assert.equal(elite.phaseTransition.fromBackground, elite.phaseTransition.toBackground);
        party.__test.proceedToNextPhase(room);
        const boss = party.getMyRoomSnapshot(user.name);
        assert.ok(decodeURIComponent(boss.monster.background).endsWith('레이드/black-hodu-aura.png'));
        assert.equal(boss.phaseTransition.toBackground, boss.monster.background);
        party.leaveRoom(user.name);
    }
});

test('레이드 타격 계산은 필드 공통 계산과 치명타, 연격, 속성, 고정 피해까지 일치한다', () => {
    const random = mock.method(Math, 'random', () => .23);
    try {
        for (const type of ['mob', 'elite', 'boss']) for (const options of [
            { stats: { cmb: 1, maxCmb: 2, comboDamage: .3, crit: .7, critMul: 2, comboCritMul: .2, extraDamage: .2 }, extra: { isBasic: true } },
            { stats: { lightAtk: 200, lightFinalDamage: .1, crit: 1, critLightBonus: .3, elementalExtraDamage: .1 }, extra: { isSkill: true, skillElement: '명', hitCount: 3, skillTrueDmg: 70 } },
            { stats: { trueDamageChance: 1, pntPercent: .2, nonElementDamage: .3 }, extra: { isSkill: true, oneTimeTrueDmg: 250, oneTimeFinalDamage: 170 } },
            { stats: { crit: 0, '000': 1, extraDamage: .3 }, extra: { hitCount: 2, disableCritical: true } },
            { stats: { crit: 1 }, extra: { isSkill: true, hitCount: 2, extraOnCrit: { max: 5 } } },
            { stats: { crit: 1 }, extra: { isBasic: true, trueDamageOnCrit: true } },
            { stats: { crit: 1, cmb: 1 }, extra: { isBasic: true, hitCount: 9, separateBasicAttackHits: true } },
            { stats: { crit: 1, finalDamage: .4, extraDamage: .5 }, extra: { hitCount: 1, dotAttack: true, summonAttack: true, precalculatedDamage: true } }
        ]) {
            const member = combatMember(options.stats);
            const monster = { type, hp: 1000000, hpMax: 1000000, def: 350, stats: { lightRes: 90, critDef: .25 }, debuffs: [] };
            const extra = { ...options.extra };
            const expected = rpg.calculateAttackHitResult(1357, monster.def, 0, member.baseSnapshot.stats, {},
                { ...extra, attackElement: extra.skillElement }, monster.stats);
            const actual = party.__test.calculateOutgoingDamage(member, monster, {}, 1357, extra);
            assert.equal(actual.damage, expected.finalDamage, type + '/' + JSON.stringify(options));
            assert.deepEqual(actual.hitDamages, expected.hitDamages);
            assert.equal(actual.criticalCount, expected.criticalCount);
            assert.equal(actual.attackUnitCount, expected.attackUnitCount);
        }
        const zero = party.__test.calculateOutgoingDamage(combatMember(), { type: 'boss', def: 0, stats: {} }, {}, 0, { hitCount: 1 });
        assert.equal(zero.damage, 0, '피해가 0일 때 강제로 1 피해를 만들면 안 된다.');
        assert.equal(party.__test.computeBasicDamage(combatMember({ atk: 0 }), { type: 'boss', def: 0, stats: {} }, {}).damage, 0);
    } finally { random.mock.restore(); }
});

test('보스 화상도 필드 계산의 방어력과 속성 저항을 적용하고 장비 및 다음 공격 버프를 발동시키지 않는다', async () => {
    const room = await battle();
    const member = room.members[0]; Object.assign(member, combatMember({ fireAtk: 200, finalDamage: .2, pnt: 30 }));
    member.baseSnapshot.transcendEquipment.entries = [{ name: '잿불 모자', stage: 1 }, { name: '최후통첩 모자', stage: 1 }];
    member.runtime.critBoostNext = .3; member.runtime.trueDamageOnCritNext = true;
    room.monster.def = 200; room.monster.stats = { fireRes: 80 };
    room.monster.hp = Math.round(room.monster.hpMax * .4);
    room.monster.bossState.hpGimmicks = []; room.monster.bossState.timers = {};
    const burn = { id: 'emberBurn:' + member.name, type: 'dot', label: '화상', element: '화', disableCritical: true,
        dmg: 600, interval: 2, tick: .2, remain: 8, sourceName: member.name, sourceSkill: '화상' };
    party.__test.addMonsterDebuff(room.monster, burn);
    const random = mock.method(Math, 'random', () => .5);
    try {
        const expected = rpg.calculateAttackHitResult(600, 200, 30, member.baseSnapshot.stats, {},
            { hitCount: 1, disableCritical: true, disableEquipmentBonusDamage: true, summonAttack: true, dotAttack: true, attackElement: '화' }, room.monster.stats);
        const hp = room.monster.hp; tick(room);
        assert.equal(hp - room.monster.hp, expected.finalDamage);
        assert.equal(member.runtime.battleStats.damage, expected.finalDamage);
        assert.equal(member.runtime.equipmentState.attackCount, undefined);
        assert.equal(member.runtime.equipmentState.ultimatumHatReadyAt, undefined);
        assert.equal(member.runtime.critBoostNext, .3); assert.equal(member.runtime.trueDamageOnCritNext, true);
    } finally { random.mock.restore(); }
});

test('잡몹 단계에서 화상과 유서새김은 유지되고 지속 피해가 처치 수와 전투 기록에 반영된다', async () => {
    const user = await reset();
    assert.ok((await party.createRoom(user.name, 'blackHodu')).roomId);
    assert.equal(party.setPosition(user.name, '브루저').ok, true); party.setReady(user.name, true);
    const started = await party.start(user.name); assert.equal(started.ok, true, JSON.stringify(started));
    const room = party.getRoomOf(user.name); room.introUntil = 0; room.awaitingChoices = true;
    const member = room.members[0]; Object.assign(member, combatMember());
    member.baseSnapshot.transcendEquipment.entries = [{ name: '잿불 모자', stage: 1 }];
    member.skills = ['유서새김'];
    member.skillDefs = { '유서새김': { type: 'active', source: 'mainCard', mp: 0, cd: 1, star: 0,
        raw: { name: '유서새김', format: [{ base: .2 }, { base: .5 }] } } };
    const random = mock.method(Math, 'random', () => .5);
    try {
        room.awaitingChoices = false; assert.equal(party.attackMobPhase(user.name).ok, true); room.awaitingChoices = true;
        assert.ok(room.mobMonster?.debuffs.some(debuff => debuff.label === '화상'));
        const target = room.mobMonster;
        member.runtime.actionUntil = 0;
        room.awaitingChoices = false; assert.equal(party.useSkill(user.name, '유서새김').ok, true); room.awaitingChoices = true;
        assert.equal(room.mobMonster, target);
        assert.ok(target.debuffs.some(debuff => debuff.id === '유서새김-def'));
        assert.ok(target.debuffs.some(debuff => debuff.id === '유서새김'));
        const kills = room.sharedKillCount, damage = member.runtime.battleStats.damage;
        for (let i = 0; i < 11; i++) tick(room);
        assert.ok(room.sharedKillCount > kills); assert.ok(member.runtime.battleStats.damage > damage);
        assert.ok(room.combatLog.some(log => /화상/.test(log.text)));
        assert.ok(room.combatLog.some(log => /유서새김/.test(log.text) && /정화/.test(log.text)));
        assert.equal(member.runtime.equipmentState.attackCount, 1, '지속 피해로 장비 공격 횟수가 추가되면 안 된다.');
        for (let i = 0; i < 40; i++) tick(room);
        assert.equal(target.debuffs.length, 0, '정해진 마지막 틱까지 적용한 뒤 디버프가 만료되어야 한다.');
        assert.equal(room.combatLog.filter(log => /\[화상\]/.test(log.text) && /정화/.test(log.text)).length, 4);
        assert.equal(room.combatLog.filter(log => /\[유서새김\]/.test(log.text) && /정화/.test(log.text)).length, 5);
        member.skills.push(...quests.find(quest => quest.id === 'blackHodu').randomSkillPool[member.position]);
        room.sharedKillCount = room.killTarget - 1;
        party.__test.addMonsterDebuff(target, { id: 'last-burn', label: '화상', type: 'dot', element: '화', disableCritical: true,
            dmg: 300, tick: .2, interval: 2, remain: 1, sourceName: member.name });
        tick(room);
        assert.equal(room.phaseIndex, 1, '지속 피해의 마지막 처치도 실제 관문 완료 경로를 거쳐야 한다.');
        assert.equal(room.mobMonster, null); assert.equal(room.monster.type, 'elite');
        assert.equal(room.monster.hp, room.monster.hpMax);
        assert.equal(room.monster.debuffs?.length || 0, 0);
    } finally { room.awaitingChoices = true; random.mock.restore(); }
});

test('흑화 호두 시전은 공통 카드에 원래 이름, 남은 시간과 안정된 식별자만 공개한다', async () => {
    const room = await battle(); room.questId = 'blackHodu'; room.phaseIndex = 2;
    room.monster = party.__test.createPhaseMonster(quests.find(quest => quest.id === room.questId).phases[2]);
    room.monster.hp = room.monster.hpMax * .49;
    tick(room);
    const first = party.getMyRoomSnapshot(seeds[0].name).monster.patternEvents;
    assert.equal(first.length, 1); assert.equal(first[0].kind, 'raidCue'); assert.equal(first[0].label, '파멸의 정화');
    assert.equal(first[0].remain, 2); assert.equal(first[0].duration, 2); assert.equal(first[0].tag, '시전');
    assert.equal(first[0].onFinish, undefined);
    tick(room);
    const following = party.getMyRoomSnapshot(seeds[0].name).monster.patternEvents[0];
    assert.equal(following.id, first[0].id); assert.ok(following.remain < first[0].remain);
    room.monster.bossState.casting = null;
    party.__test.startBossCast(room, room.monster, 'half', '파멸의 정화', 2, () => {});
    assert.notEqual(party.__test.serializeMonster(room.monster).patternEvents[0].id, first[0].id);
});

test('익스트림의 저주와 역할 방패는 원래 명칭과 지속시간을 공통 카드에 표시한다', async () => {
    const room = await battle(); room.questId = 'blackHoduExtreme'; room.phaseIndex = 2;
    room.monster = party.__test.createPhaseMonster(quests.find(quest => quest.id === room.questId).phases[2]);
    const st = room.monster.bossState;
    st.curseRemain = 4.8; st.shieldRemain = 9.8; st.shieldRole = '탱커'; st.buffRemain = 14.8;
    const events = party.__test.serializeMonster(room.monster).patternEvents;
    assert.equal(events.length, 3); assert.equal(new Set(events.map(event => event.id)).size, 3);
    for (const [id, type, remain] of [['curse', 'curseRevive', 4.8], ['role-shield', 'roleDamageLock', 9.8], ['self-buff', 'selfBuff', 14.8]]) {
        const event = events.find(event => event.id === id);
        assert.equal(event.label, room.monster.patterns.find(pattern => pattern.type === type).name);
        assert.equal(event.remain, remain); assert.ok(event.duration >= remain);
    }
    assert.equal(events.find(event => event.id === 'role-shield').tag, '탱커');
    assert.equal(events.find(event => event.id === 'role-shield').effect, 'dark-shield');
    assert.equal(events.find(event => event.id === 'self-buff').effect, 'empower');
});

test('시전 완료의 타격 연출은 실제 완료 신호를 사용하며 마지막 순간 기절은 타격을 만들지 않는다', async () => {
    const room = await battle(); room.questId = 'blackHodu'; room.phaseIndex = 2;
    const mon = room.monster = party.__test.createPhaseMonster(quests.find(quest => quest.id === room.questId).phases[2]);
    const handler = party.__test.BOSS_HANDLERS[mon.bossKey];
    let hits = 0;
    party.__test.startBossCast(room, mon, 'half', '파멸의 정화', .2, () => { hits++; });
    const id = mon.bossState.casting.uiId;
    handler.step(room, mon, .2);
    const finished = party.__test.serializeMonster(mon).patternEvents.find(e => e.id === id);
    assert.equal(hits, 1); assert.equal(finished.stage, 'resolved'); assert.equal(finished.effect, 'purge');
    assert.ok(finished.remain <= 0); assert.equal(finished.onFinish, undefined);
    mon.bossState.finishedCast.finishedAt -= 700;
    assert.equal(party.__test.serializeMonster(mon).patternEvents.length, 0);
    party.__test.startBossCast(room, mon, 'half', '파멸의 정화', 2, () => { hits++; });
    mon.bossState.casting.remain = .1; mon.stunRemain = 1;
    tick(room);
    assert.equal(mon.bossState.casting, null); assert.equal(hits, 1);
    assert.equal(party.__test.serializeMonster(mon).patternEvents.length, 0);
});

test('재생 효과는 실제 회복 때만 발생하고 반복 회복과 만료를 스냅샷에 반영한다', async () => {
    const room = await battle(); room.questId = 'blackHodu'; room.phaseIndex = 2;
    const mon = room.monster = party.__test.createPhaseMonster(quests.find(quest => quest.id === room.questId).phases[2]);
    const st = mon.bossState, handler = party.__test.BOSS_HANDLERS[mon.bossKey];
    st.phase50Started = true; st.phase10Started = true; st.shockTimer = st.buffTimer = 999;
    mon.hp = mon.hpMax * .25; st.healTimer = 1;
    handler.step(room, mon, .2);
    assert.equal(party.__test.serializeMonster(mon).patternEvents.length, 0);
    const hp = mon.hp;
    st.healTimer = 0; handler.step(room, mon, .2);
    const first = party.__test.serializeMonster(mon).patternEvents[0];
    assert.equal(first.effect, 'regenerate'); assert.equal(first.label, '재생');
    assert.equal(first.amount, mon.hp - hp); assert.equal(first.amount, Math.round(mon.hpMax * .05));
    assert.equal(first.duration, 1.4); assert.ok(first.remain > 1.2);
    assert.equal(party.__test.serializeMonster(mon).patternEvents[0].id, first.id);
    assert.equal(first.startedAt, undefined);
    st.visualCues.regenerate.startedAt -= 1500;
    assert.equal(party.__test.serializeMonster(mon).patternEvents.length, 0);
    mon.hp = mon.hpMax * .25; st.healTimer = 0; handler.step(room, mon, .2);
    assert.notEqual(party.__test.serializeMonster(mon).patternEvents[0].id, first.id);
    st.visualCues.regenerate.startedAt -= 1500;
    mon.hp = mon.hpMax * .6; st.healTimer = 0; handler.step(room, mon, .2);
    assert.equal(mon.hp, mon.hpMax * .6);
    assert.equal(party.__test.serializeMonster(mon).patternEvents.length, 0);
});

test('타부자고의 즉시 패턴 효과는 실제 발동과 누적 단계에 연결된다', async () => {
    const room = await battle(); room.questId = 'butaGame'; room.phaseIndex = 0;
    const mon = room.monster = party.__test.createPhaseMonster(quests.find(quest => quest.id === room.questId).phases[0]);
    const st = mon.bossState, handler = party.__test.BOSS_HANDLERS[mon.bossKey];
    handler.onSpawn(room, mon);
    st.hpGimmicks = []; st.reflectTimer = st.mochiTimer = st.dealingTimer = 999; st.puzzleTimer = 0;
    handler.step(room, mon, .2);
    const puzzle = party.__test.serializeMonster(mon).patternEvents.find(e => e.effect === 'puzzle');
    assert.equal(puzzle.label, '퍼즐 던지기'); assert.equal(puzzle.duration, 1.2);
    assert.equal(party.__test.serializeMonster(mon).patternEvents.find(e => e.effect === 'puzzle').id, puzzle.id);
    st.puzzleTimer = 999; st.dealingTimer = 0; handler.step(room, mon, .2);
    const prepare = party.__test.serializeMonster(mon).patternEvents.find(e => e.effect === 'dealing');
    assert.equal(prepare.count, 1);
    st.dealingCount = 2; st.dealingTimer = 0;
    const before = room.members[0].runtime.hp;
    handler.step(room, mon, .2);
    const strike = party.__test.serializeMonster(mon).patternEvents.find(e => e.effect === 'dealing-strike');
    assert.equal(strike.label, '확실한 딜링'); assert.equal(st.dealingCount, 0);
    assert.ok(room.members[0].runtime.hp < before);
});

test('확실한 딜링은 마지막 3초에만 전조를 보내고 기존 시점과 피해량으로 공격한다', async () => {
    const room = await battle(); room.questId = 'butaGame'; room.phaseIndex = 0;
    const mon = room.monster = party.__test.createPhaseMonster(quests.find(quest => quest.id === room.questId).phases[0]);
    const st = mon.bossState, handler = party.__test.BOSS_HANDLERS[mon.bossKey], member = room.members[0];
    handler.onSpawn(room, mon); st.hpGimmicks = [];
    st.puzzleTimer = st.reflectTimer = st.mochiTimer = 999; st.dealingCount = 2; st.dealingTimer = 4;
    const hp = member.runtime.hp, sent = [];
    member.sseRes = { writableEnded: false, write: text => sent.push(text), end() {} };
    handler.step(room, mon, .2);
    assert.ok(!party.__test.serializeMonster(mon).patternEvents.some(event => event.effect === 'dealing-ready'));
    st.dealingTimer = 3; handler.step(room, mon, .2);
    const warning = party.__test.serializeMonster(mon).patternEvents.find(event => event.effect === 'dealing-ready');
    assert.equal(warning.duration, 3); assert.equal(warning.remain, 2.8); assert.equal(member.runtime.hp, hp);
    assert.equal(party.__test.serializeMonster(mon).patternEvents.find(event => event.effect === 'dealing-ready').id, warning.id);
    st.reflectWindow = 1;
    assert.ok(!party.__test.serializeMonster(mon).patternEvents.some(event => event.effect === 'dealing-ready'));
    st.reflectWindow = 0; mon.stunRemain = 1;
    assert.ok(!party.__test.serializeMonster(mon).patternEvents.some(event => event.effect === 'dealing-ready'));
    mon.stunRemain = 0; st.dealingTimer = .2; handler.step(room, mon, .2);
    assert.equal(hp - member.runtime.hp, Math.ceil(member.runtime.hpMax * .3));
    assert.equal(st.dealingTimer, 20); assert.equal(st.dealingCount, 0);
    assert.ok(party.__test.serializeMonster(mon).patternEvents.some(event => event.effect === 'dealing-strike'));
    assert.ok(!party.__test.serializeMonster(mon).patternEvents.some(event => event.effect === 'dealing-ready'));
    assert.ok(!sent.includes('event: notice\n'));
    st.dealingCount = 2; st.dealingTimer = 3;
    assert.notEqual(party.__test.serializeMonster(mon).patternEvents.find(event => event.effect === 'dealing-ready').id, warning.id);
});

test('타부자고의 외침은 말풍선으로 전달하며 생존자의 서로 다른 응답이 충분하면 즉시 한 번만 그로기된다', async () => {
    const room = await battle('normal', 3); room.questId = 'butaGame'; room.phaseIndex = 0;
    const mon = room.monster = party.__test.createPhaseMonster(quests.find(quest => quest.id === room.questId).phases[0]);
    party.__test.BOSS_HANDLERS[mon.bossKey].onSpawn(room, mon);
    const sent = [];
    room.members[0].sseRes = { writableEnded: false, write: text => sent.push(text), end() {} };
    mon.hp = mon.hpMax * mon.bossState.hpGimmicks[0].ratio * .99; tick(room);
    const g = mon.bossState.chatGimmick, call = party.__test.serializeMonster(mon).patternEvents.find(event => event.presentation === 'speech');
    assert.equal(g.need, 2); assert.equal(call.message, '야, 김쁠뿡!!!!!!'); assert.equal(call.effect, 'tabujago-call');
    assert.equal(party.__test.serializeMonster(mon).patternEvents.find(event => event.presentation === 'speech').id, call.id);
    assert.equal((await request('/api/party/chat', { text: '   ' })).status, 400); assert.equal(g.responded.size, 0);
    assert.equal((await request('/api/party/chat', { text: '대답' })).status, 200);
    assert.equal((await request('/api/party/chat', { text: '또 대답' })).status, 200); assert.equal(g.responded.size, 1);
    room.members[2].runtime.dead = true; room.members[2].runtime.hp = 0;
    assert.equal((await request('/api/party/chat', { text: '사망자 대답' }, seeds[2].name)).status, 200); assert.equal(g.responded.size, 1);
    assert.equal(mon.stunRemain, 0); assert.ok(mon.bossState.gimmickActive);
    const gauge = room.supportGauge;
    assert.equal((await request('/api/party/chat', { text: '두 번째 생존자 대답' }, seeds[1].name)).status, 200);
    assert.equal(mon.bossState.chatGimmick, null); assert.equal(mon.bossState.gimmickActive, null);
    assert.equal(mon.stunRemain, 8); assert.equal(mon.debuffs.find(debuff => debuff.id === 'groggyTakenUp').value, .2);
    const cry = party.__test.serializeMonster(mon).patternEvents.find(event => event.presentation === 'speech');
    assert.equal(cry.message, '으악!'); assert.equal(cry.effect, 'tabujago-cry'); assert.notEqual(cry.id, call.id);
    assert.equal(room.supportGauge, gauge + 20);
    assert.equal((await request('/api/party/chat', { text: '추가 대답' }, seeds[1].name)).status, 200);
    assert.equal(room.supportGauge, gauge + 20); assert.ok(!sent.includes('event: notice\n'));
});

test('타부자고 응답 시간 초과는 기존 전멸 판정을 유지하고 다른 채팅 기믹은 마감 시점에 판정한다', async () => {
    const room = await battle(); room.questId = 'butaGame'; room.phaseIndex = 0;
    const mon = room.monster = party.__test.createPhaseMonster(quests.find(quest => quest.id === room.questId).phases[0]);
    party.__test.BOSS_HANDLERS[mon.bossKey].onSpawn(room, mon);
    mon.hp = mon.hpMax * mon.bossState.hpGimmicks[0].ratio * .99; tick(room);
    mon.bossState.chatGimmick.remain = .2; tick(room);
    assert.equal(room.state, 'failed'); assert.equal(mon.stunRemain, 0);
    const other = await battle('normal', 3); let finished = 0;
    party.__test.startChatGimmick(other, other.monster, { label: '다른 채팅 기믹', seconds: 10, onFinish: () => { finished++; } });
    party.chat(seeds[0].name, '대답'); party.chat(seeds[1].name, '대답');
    assert.equal(finished, 0); assert.equal(other.monster.bossState.chatGimmick.responded.size, 2);
    other.monster.bossState.chatGimmick.remain = .2; tick(other);
    assert.equal(finished, 1); assert.equal(other.monster.bossState.chatGimmick, null);
});

test('잉여왕의 주시, 레인 보호막과 저지 시전은 대상자와 참여 상태를 중복 없이 제공한다', async () => {
    const room = await battle('normal', 3); room.questId = 'butaGame'; room.phaseIndex = 1;
    room.monster = party.__test.createPhaseMonster(quests.find(quest => quest.id === room.questId).phases[1]);
    party.__test.BOSS_HANDLERS[room.monster.bossKey].onSpawn(room, room.monster);
    const st = room.monster.bossState;
    let events = party.__test.serializeMonster(room.monster).patternEvents;
    assert.equal(events.length, 1); assert.equal(events[0].remain, null); assert.deepEqual(events[0].targets, [st.markName]);
    room.monster.hp = room.monster.hpMax * .7; tick(room);
    events = party.__test.serializeMonster(room.monster).patternEvents;
    const rain = events.find(event => event.id === 'rain');
    assert.equal(rain.label, '레인! 도와줘!'); assert.equal(rain.duration, 10); assert.deepEqual(rain.targets, [st.markName]);
    assert.equal(rain.effect, 'rain-shield');
    assert.equal(new Set(events.map(event => event.id)).size, events.length);
    st.gimmickActive = null; st.hpGimmicks = []; st.flameTimer = 999; st.chargeTimer = .2;
    tick(room);
    const charge = party.__test.serializeMonster(room.monster).patternEvents.find(event => event.tag === '저지');
    assert.equal(charge.requiresResponse, true); assert.deepEqual(charge.responded, []);
    st.blockUsers.add(seeds[0].name);
    const progress = party.__test.serializeMonster(room.monster).patternEvents.find(event => event.id === charge.id);
    assert.deepEqual(progress.responded, [seeds[0].name]); assert.equal(progress.label, charge.label);
});

test('모든 레이드 관문 컷씬은 3초 동안 실제 전투와 모든 전투 행동을 멈춘다', async () => {
    for (const questId of ['blackHodu', 'blackHoduExtreme', 'butaGame', 'butaGameHard', 'mansionNormal', 'mansionHard', 'mansionNightmare']) {
        const room = await battle(); room.questId = questId;
        const quest = quests.find(quest => quest.id === questId);
        room.phaseIndex = quest.phases.length - 2;
        room.monster = null; // 실제 처치 경로에서도 이전 보스 이미지를 복원한다.
        const member = room.members[0];
        if (quest.reviveOnPhaseClear) { member.runtime.dead = true; member.runtime.hp = 0; }
        let now = Date.now(); const clock = mock.method(Date, 'now', () => now);
        try {
            party.__test.proceedToNextPhase(room);
            const transition = party.getMyRoomSnapshot(member.name).phaseTransition;
            assert.equal(transition.startedAt, now); assert.equal(transition.endsAt, now + 3000);
            assert.equal(room.introUntil, transition.endsAt); assert.equal(transition.phaseNumber, quest.phases.length);
            assert.equal(transition.toName, room.monster.name); assert.ok(transition.fromImage); assert.ok(transition.toImage);
            if (quest.reviveOnPhaseClear) { assert.equal(member.runtime.dead, false); assert.equal(member.runtime.hp, member.runtime.hpMax); }
            member.potions = [{ name: '상급 체력 포션', count: 2 }]; room.supportGauge = 100;
            const skill = member.skills.find(name => member.skillDefs[name]?.type === 'active');
            member.runtime.buffs = [{ id: 'cut-test', label: 'test', remain: 5 }];
            const hp = room.monster.hp, mp = member.runtime.mp, gauge = room.monster.gauge, enrage = room.monster.enrageRemain;
            const cooldowns = party.getMyCooldownState(member.name);
            now += 1500;
            const reconnect = party.getMyRoomSnapshot(member.name);
            assert.equal(reconnect.phaseTransition.id, transition.id); assert.equal(reconnect.phaseTransition.endsAt - reconnect.serverNow, 1500);
            party.__test.stepRoom(room);
            assert.equal(room.monster.hp, hp); assert.equal(room.monster.gauge, gauge); assert.equal(room.monster.enrageRemain, enrage);
            assert.equal(member.runtime.buffs[0].remain, 5);
            for (const [route, payload] of [['attack', {}], ['skill', { skill }], ['use-potion', { name: '상급 체력 포션' }], ['support-skill', { skill: 'X' }], ['mansion-action', { eventId: 'test', action: 'complete' }]]) {
                const denied = await request('/api/party/' + route, payload);
                assert.equal(denied.status, 400, questId + '/' + route); assert.equal(denied.data.error, '관문 전환 중입니다.');
            }
            assert.equal(member.runtime.mp, mp); assert.equal(member.potions[0].count, 2); assert.equal(room.supportGauge, 100);
            assert.deepEqual({ ...party.getMyCooldownState(member.name), serverNow: cooldowns.serverNow }, cooldowns);
            now = transition.endsAt;
            assert.equal(party.getMyRoomSnapshot(member.name).phaseTransition, null);
            party.__test.stepRoom(room);
            assert.equal(member.runtime.buffs[0].remain, 4.8);
        } finally { room.awaitingChoices = true; clock.mock.restore(); }
    }
});

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

test('파티 스냅샷과 전투 tick은 반올림된 잔여 시간이 아닌 실제 쿨타임 종료 시각을 유지한다', async () => {
    const room = await battle(); const member = room.members[0];
    let now = Date.now() + 37;
    mock.method(Date, 'now', () => now);
    const deadlines = { actionUntil: now + 1234, potionUntil: now + 2678, cooldownsUntil: { test: now + 5678 } };
    Object.assign(member.runtime, structuredClone(deadlines));
    const chunks = [];
    member.sseRes = { writableEnded: false, write: chunk => chunks.push(chunk) };
    try {
        const snapshot = party.getMyRoomSnapshot(member.name);
        assert.equal(snapshot.serverNow, now);
        for (const [key, value] of Object.entries(deadlines)) assert.deepEqual(snapshot.members[0].runtime[key], value);
        assert.equal(snapshot.members[0].runtime.actionCdRemain, 1.2);
        now += 237; tick(room);
        const payload = JSON.parse(chunks[chunks.findLastIndex(chunk => chunk === 'event: tick\n') + 1].slice(6));
        assert.equal(payload.serverNow, now);
        for (const [key, value] of Object.entries(deadlines)) assert.deepEqual(payload.members[0].runtime[key], value);
        snapshot.members[0].runtime.cooldownsUntil.test = 0;
        assert.equal(member.runtime.cooldownsUntil.test, deadlines.cooldownsUntil.test, '직렬화된 맵은 전투 상태와 독립적이다');
    } finally { member.sseRes = null; mock.restoreAll(); }
});

test('공격·스킬·물약 API는 실제 감소된 쿨타임을 반환하고 거절된 행동은 새 쿨타임을 만들지 않는다', async () => {
    const room = await battle(); const member = room.members[0];
    const skill = member.skills.find(name => member.skillDefs[name]?.type === 'active' && member.skillDefs[name].mp > 0);
    assert.ok(skill); const definition = member.skillDefs[skill];
    Object.assign(member.baseSnapshot.stats, { cooldown: .5, skillCooldown: 0 });
    const now = Date.now() + 43;
    mock.method(Date, 'now', () => now);
    room.awaitingChoices = false;
    try {
        member.runtime.mp = 0;
        const denied = await request('/api/party/skill', { skill });
        assert.equal(denied.status, 400); assert.match(denied.data.error, /MP/);
        assert.equal(denied.data.cooldowns.actionUntil, 0); assert.deepEqual(denied.data.cooldowns.cooldownsUntil, {});
        member.runtime.mp = 1000000;
        const used = await request('/api/party/skill', { skill });
        assert.equal(used.status, 200, JSON.stringify(used));
        assert.equal(used.data.cooldowns.serverNow, now); assert.equal(used.data.cooldowns.roomId, room.id);
        assert.equal(used.data.cooldowns.cooldownsUntil[skill], now + Math.max(500, definition.cd * .5 * 1000));
        assert.equal(used.data.cooldowns.actionUntil, member.runtime.actionUntil);
        const repeat = await request('/api/party/skill', { skill });
        assert.equal(repeat.status, 400); assert.deepEqual(repeat.data.cooldowns, used.data.cooldowns);
        const attack = await request('/api/party/attack', {});
        assert.equal(attack.status, 400); assert.deepEqual(attack.data.cooldowns, used.data.cooldowns);
        member.runtime.actionUntil = 0;
        const attacked = await request('/api/party/attack', {});
        assert.equal(attacked.status, 200); assert.equal(attacked.data.cooldowns.actionUntil, member.runtime.actionUntil);
        member.potions = [{ name: '상급 체력 포션', count: 2 }];
        const potion = await request('/api/party/use-potion', { name: '상급 체력 포션' });
        assert.equal(potion.status, 200); assert.equal(potion.data.cooldowns.potionUntil, now + 3000);
        const potionRepeat = await request('/api/party/use-potion', { name: '상급 체력 포션' });
        assert.equal(potionRepeat.status, 400); assert.deepEqual(potionRepeat.data.cooldowns, potion.data.cooldowns);
        assert.equal(member.potions[0].count, 1);
    } finally { room.awaitingChoices = true; mock.restoreAll(); }
});

test('부타게임 지원군 X가 초기화한 스킬 쿨타임은 빈 종료 시각 맵으로 전달된다', async () => {
    const user = await reset();
    assert.ok((await party.createRoom(user.name, 'butaGame')).roomId);
    party.setReady(user.name, true); assert.equal((await party.start(user.name)).ok, true);
    const room = party.getRoomOf(user.name); room.introUntil = 0; room.awaitingChoices = true; room.supportGauge = 100;
    const member = room.members[0];
    member.runtime.cooldownsUntil = { test: Date.now() + 60000 };
    member.runtime.actionUntil = Date.now() + 2500;
    assert.equal(party.useSupportSkill(user.name, 'X').ok, true);
    assert.deepEqual(party.getMyRoomSnapshot(user.name).members[0].runtime.cooldownsUntil, {});
    assert.deepEqual(party.getMyCooldownState(user.name).cooldownsUntil, {});
    assert.equal(party.getMyCooldownState(user.name).actionUntil, member.runtime.actionUntil);
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
    assert.equal(raid.view(mon).events[0].carveHits, 1);
    assert.match(raid.action(room, seeds[1].name, { eventId: event.id, action: 'finish' }).error, /공대장/);
    room.supportGauge = 100; assert.match(party.useSupportSkill(seeds[1].name, '눈뜬 장님').error, /공대장/);
    assert.equal(party.useSupportSkill(seeds[0].name, '눈뜬 장님').ok, true); assert.equal(event.damage, event.hpMax * .75);
    assert.equal(raid.view(mon).events[0].carveHits, 2);
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

test('석재는 0.1초마다 0.1% 감소하며 전투 틱 사이의 완성 요청에도 같은 진행률로 판정한다', async () => {
    for (const difficulty of ['normal', 'hard', 'nightmare']) {
        const room = await battle(difficulty); const mon = room.monster;
        let now = Date.now(); const clock = mock.method(Date, 'now', () => now);
        try {
            const event = fixedGimmick(room, 1); const max = event.hpMax;
            party.__test.applyBossHpDamage(room, mon, max * .1);
            now += 99; assert.equal(raid.view(mon).events[0].damage, max * .1);
            now++; assert.equal(raid.view(mon).events[0].damage, max * .099);
            now += 100; mon.bossState.gimmickActive.tick(room, mon, .2);
            assert.equal(event.damage, max * .098);
            assert.equal(raid.view(mon).events[0].carveHits, 1, '시간 감소는 세공 타격을 만들지 않는다');
            party.__test.applyBossHpDamage(room, mon, max * .1);
            assert.equal(event.damage, max * .198, '같은 시점의 공격은 감소량을 중복 적용하지 않는다');
            event.damage = Math.round(max * (event.minPct + .001));
            now += 100;
            assert.equal(raid.action(room, seeds[0].name, { eventId: event.id, action: 'finish' }).ok, true);
            assert.equal(mon.bossState.outcome.ok, true);
            assert.equal(mon.bossState.events.length, 0);
        } finally { clock.mock.restore(); }
    }
});

test('석재 진행률은 0 아래로 감소하지 않으며 대기 중 감소량을 다음 공격에 이월하지 않는다', async () => {
    const room = await battle(); const mon = room.monster;
    let now = Date.now(); const clock = mock.method(Date, 'now', () => now);
    try {
        const event = fixedGimmick(room, 1); const max = event.hpMax;
        now += 1000;
        assert.equal(raid.view(mon).events[0].damage, 0);
        party.__test.applyBossHpDamage(room, mon, max * .003);
        assert.equal(event.damage, max * .003);
        now += 500;
        assert.equal(raid.view(mon).events[0].damage, 0);
        mon.bossState.gimmickActive.tick(room, mon, .5);
        assert.equal(event.damage, 0);
        party.__test.applyBossHpDamage(room, mon, max * .01);
        assert.equal(event.damage, max * .01);
        event.damage = Math.round(max * event.minPct);
        now += 100;
        raid.action(room, seeds[0].name, { eventId: event.id, action: 'finish' });
        assert.equal(mon.bossState.outcome.ok, false, '틱 사이에도 감소한 수치로 완성 여부를 판정한다');
    } finally { clock.mock.restore(); }
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

async function prepareDirectTrade() {
    for (const seed of seeds) {
        const state = rpg.getDirectTradeState(seed.name), user = await rpg.getRPGUserByName(seed.name);
        if (state.status === 'active') await rpg.cancelTradeByUser(user);
        if (state.status === 'outgoing') rpg.cancelTradeRequest(user);
    }
    for (const seed of seeds) await reset(seed.name);
    const sent = await request('/api/trade/request', { name: seeds[1].name });
    assert.equal(sent.status, 200, JSON.stringify(sent));
    const accepted = await request('/api/trade/accept', { requestId: sent.data.state.request.id }, seeds[1].name);
    assert.equal(accepted.status, 200, JSON.stringify(accepted));
    return (await request('/api/trade')).data.state;
}
const tradeVersion = state => ({ sessionId: state.session.id, revision: state.session.revision });

test('웹 거래는 채팅처럼 진행 중인 아이템 선택과 편린을 먼저 처리하고 낚시를 중단한다', async () => {
    for (const seed of seeds) await reset(seed.name);
    for (const blocked of [{ need_character_card_select: true }, { pendingFragment: { count: 1 } }, { pendingAction: { type: '캐릭터변환' } }]) {
        const user = await reset(); Object.assign(user, blocked); await user.save();
        assert.equal((await request('/api/trade/request', { name: seeds[1].name })).status, 409);
        assert.equal(rpg.getDirectTradeState(user.name).status, 'idle');
    }
    const sender = await reset(); sender.fishing = true; await sender.save();
    const sent = await request('/api/trade/request', { name: seeds[1].name }); assert.equal(sent.status, 200);
    assert.equal((await rpg.getRPGUserByName(sender.name)).fishing, false);
    const receiver = await rpg.getRPGUserByName(seeds[1].name); receiver.pendingAction = { type: '캐릭터변환' }; await receiver.save();
    assert.equal((await request('/api/trade/accept', { requestId: sent.data.state.request.id }, receiver.name)).status, 409);
    assert.equal(rpg.getDirectTradeState(receiver.name).status, 'incoming');
    assert.equal((await request('/api/trade/request-cancel', { requestId: sent.data.state.request.id })).status, 200);
    receiver.pendingAction = null; await receiver.save();
});

test('1:1거래 API는 인증과 본인 거래만 허용하고 채팅에서 보낸 신청을 같은 세션으로 수락한다', async () => {
    for (const seed of seeds) await reset(seed.name);
    assert.equal((await request('/api/trade', undefined, null)).status, 401);
    assert.equal((await request('/api/trade/request', { name: '없는 테스트 유저' })).status, 404);
    const replies = []; let receive;
    const channel = { channelId: 'web-chat:isolated-trade', sendChat: text => { replies.push(text); receive(); } };
    const reply = new Promise(resolve => { receive = resolve; });
    assert.equal(await rpg.onChat({ text: '/RPGenius 거래신청 ' + seeds[1].name, getSenderInfo: () => ({ userId: seeds[0].id }) }, channel,
        { getUser: () => rpg.getRPGUserByName(seeds[0].name), queueKey: 'account:' + seeds[0].id }), true);
    await reply; assert.match(replies.at(-1), /거래를 신청/);
    const incoming = (await request('/api/trade', undefined, seeds[1].name)).data.state;
    assert.equal(incoming.status, 'incoming'); assert.equal(incoming.request.partnerName, seeds[0].name);
    assert.equal((await request('/api/trade/accept', { requestId: incoming.request.id }, seeds[2].name)).status, 409);
    assert.equal((await request('/api/trade/accept', { requestId: incoming.request.id }, seeds[1].name)).status, 200);
    const state = (await request('/api/trade')).data.state;
    const registered = await request('/api/trade/register', { ...tradeVersion(state), kind: 'gold', amount: 100 });
    assert.equal(registered.status, 200, JSON.stringify(registered));
    assert.equal(rpg.getDirectTradeState(seeds[1].name).session.partnerOffer.gold, 100);
    const outsider = (await request('/api/trade', undefined, seeds[2].name)).data.state;
    assert.equal(outsider.status, 'idle'); assert.equal(outsider.session, undefined); assert.equal(outsider.partner, null);
    assert.equal((await request('/api/trade/cancel', tradeVersion(state), seeds[2].name)).status, 409);
    assert.equal((await request('/api/trade/cancel', tradeVersion(registered.data.state))).status, 200);
    assert.equal((await rpg.getRPGUserByName(seeds[0].name)).gold, 1000000000);
});

test('품목 변경은 양쪽 확정을 해제하고 중복 등록과 이전 내역으로 보낸 확정을 거부한다', async () => {
    let state = await prepareDirectTrade();
    const body = { ...tradeVersion(state), kind: 'gold', amount: 1000 };
    const added = await request('/api/trade/register', body); assert.equal(added.status, 200, JSON.stringify(added)); state = added.data.state;
    assert.equal((await request('/api/trade/register', body)).status, 409);
    assert.equal((await request('/api/trade/confirm', tradeVersion(state))).status, 200);
    const stale = tradeVersion(state);
    const changed = await request('/api/trade/register', { ...stale, kind: 'garnet', amount: 1 }, seeds[1].name);
    assert.equal(changed.status, 409, '가넷이 부족하면 품목/확정 상태를 변경하지 않는다');
    const user = await rpg.getRPGUserByName(seeds[1].name); user.garnet = 50; await user.save();
    const changedAgain = await request('/api/trade/register', { ...stale, kind: 'garnet', amount: 10 }, seeds[1].name);
    assert.equal(changedAgain.status, 200, JSON.stringify(changedAgain)); state = changedAgain.data.state;
    assert.equal(state.session.confirmed, false); assert.equal(state.session.partnerConfirmed, false);
    assert.equal((await request('/api/trade/confirm', stale)).status, 409);
    assert.equal(state.session.partnerOffer.net.gold, 950); assert.equal(state.session.partnerOffer.fees.gold, 50);
    assert.equal((await request('/api/trade/cancel', tradeVersion(state), seeds[1].name)).status, 200);
    assert.equal((await rpg.getRPGUserByName(seeds[0].name)).gold, 1000000000);
    assert.equal((await rpg.getRPGUserByName(seeds[1].name)).garnet, 50);
});

test('1:1거래는 카드 거래권, 재화 수수료와 아티팩트 옵션/거래 횟수를 기존 규칙대로 정산한다', async () => {
    let state = await prepareDirectTrade();
    let a = await rpg.getRPGUserByName(seeds[0].name), b = await rpg.getRPGUserByName(seeds[1].name);
    a.inventory.card.push({ id: 0, star: 6, type: '일반', skin: '테스트' });
    const equip = rpg.grantArtifact(a, '레전더리'); equip.artifact.rerollsUsed = 2; const original = structuredClone(equip);
    b.garnet = 100; const ticketId = data.Item.findIndex(item => item?.name === '거래권'); rpg.addInventoryItem(b, ticketId, 5);
    await a.save(); await b.save();
    const candidates = (await request('/api/trade/inventory')).data;
    assert.equal(candidates.equipment[0].artifact.options.length, 3);
    for (const [kind, entry] of [['card', candidates.cards[0]], ['equipment', candidates.equipment[0]]]) {
        const out = await request('/api/trade/register', { ...tradeVersion(state), kind, number: entry.number, version: entry.version });
        assert.equal(out.status, 200, JSON.stringify({ kind, ...out })); state = out.data.state;
    }
    let out = await request('/api/trade/register', { ...tradeVersion(state), kind: 'gold', amount: 1000 });
    assert.equal(out.status, 200); state = out.data.state;
    out = await request('/api/trade/register', { ...tradeVersion(state), kind: 'garnet', amount: 10 }, seeds[1].name);
    assert.equal(out.status, 200); state = out.data.state;
    assert.equal(state.session.partnerOffer.ticketCost, 3);
    assert.equal((await request('/api/trade/confirm', tradeVersion(state))).status, 200);
    out = await request('/api/trade/confirm', tradeVersion(state), seeds[1].name);
    assert.equal(out.status, 200, JSON.stringify(out)); assert.equal(out.data.state.result.status, 'completed');
    a = await rpg.getRPGUserByName(a.name); b = await rpg.getRPGUserByName(b.name);
    assert.equal(a.gold, 1000000000 - 1000); assert.equal(a.garnet, 9); assert.equal(b.gold, 1000000000 + 950); assert.equal(b.garnet, 90);
    assert.equal(rpg.getInventoryItemCount(b, ticketId), 2); assert.equal(b.inventory.card[0].skin, undefined);
    assert.equal(b.inventory.equipment[0].uid, original.uid); assert.deepEqual(b.inventory.equipment[0].artifact, original.artifact);
    assert.equal(b.inventory.equipment[0].tradeCount, 1); assert.equal(rpg.getEquipmentTradeLimitInfo(b.inventory.equipment[0]).remaining, 0);
    assert.equal(a.tradeEscrow, undefined); assert.equal(b.tradeEscrow, undefined);
    assert.equal((await request('/api/trade/confirm', tradeVersion(state), seeds[1].name)).status, 409);
    assert.equal((await rpg.getRPGUserByName(b.name)).gold, 1000000950);
});

test('거래 저장 실패는 양쪽 자산과 보관 품목을 유지하며 응답 유실은 중복 지급 없이 완료한다', async () => {
    for (const mode of ['fail', 'lost']) {
        let state = await prepareDirectTrade();
        const added = await request('/api/trade/register', { ...tradeVersion(state), kind: 'gold', amount: 1000 }); state = added.data.state;
        assert.equal((await request('/api/trade/confirm', tradeVersion(state))).status, 200);
        if (mode === 'fail') failTradeWrite = true; else loseTradeResponse = true;
        const completed = await request('/api/trade/confirm', tradeVersion(state), seeds[1].name);
        assert.equal(completed.status, mode === 'fail' ? 500 : 200, JSON.stringify(completed));
        const a = await rpg.getRPGUserByName(seeds[0].name), b = await rpg.getRPGUserByName(seeds[1].name);
        if (mode === 'fail') {
            assert.equal(a.gold, 999999000); assert.equal(b.gold, 1000000000);
            assert.equal(a.tradeEscrow.offer.gold, 1000); assert.equal(b.tradeEscrow.offer.gold, 0);
            const latest = (await request('/api/trade')).data.state;
            assert.equal(latest.session.confirmed, false); assert.equal(latest.session.partnerConfirmed, false);
            assert.equal((await request('/api/trade/cancel', tradeVersion(latest))).status, 200);
            assert.equal((await rpg.getRPGUserByName(a.name)).gold, 1000000000);
        } else {
            assert.equal(a.gold, 999999000); assert.equal(b.gold, 1000000950); assert.equal(completed.data.state.result.status, 'completed');
            assert.equal(a.tradeEscrow, undefined); assert.equal(b.tradeEscrow, undefined);
        }
    }
});

test('아이템 거래는 귀속 수량과 이전 보유 목록을 제외하고 취소 시 등록한 수량을 반환한다', async () => {
    let state = await prepareDirectTrade(); const user = await rpg.getRPGUserByName(seeds[0].name);
    const id = data.Item.findIndex(item => item?.name === '황금 주머니');
    rpg.addInventoryItem(user, id, 5); user.boundItems = { [id]: 2 }; await user.save();
    let candidate = (await request('/api/trade/inventory')).data.items.find(item => item.id === id);
    assert.equal(candidate.count, 3);
    const base = { ...tradeVersion(state), kind: 'item', itemId: id, version: candidate.version };
    assert.equal((await request('/api/trade/register', { ...base, count: 4 })).status, 409);
    const added = await request('/api/trade/register', { ...base, count: 3 }); assert.equal(added.status, 200, JSON.stringify(added)); state = added.data.state;
    assert.equal((await rpg.getRPGUserByName(user.name)).inventory.item.find(item => item.id === id).count, 2);
    assert.equal(state.session.offer.items[0].count, 3); assert.ok(state.session.offer.items[0].iconUrl);
    assert.equal((await request('/api/trade/register', { ...base, ...tradeVersion(state), count: 1 })).status, 409);
    assert.equal((await request('/api/trade/cancel', tradeVersion(state))).status, 200);
    const restored = await rpg.getRPGUserByName(user.name);
    assert.equal(rpg.getInventoryItemCount(restored, id), 5); assert.equal(rpg.getBoundItemCount(restored, id), 2);
});

test('동시에 확정과 취소가 도착해도 정산을 시작한 거래는 한 번만 완료한다', async () => {
    let state = await prepareDirectTrade();
    state = (await request('/api/trade/register', { ...tradeVersion(state), kind: 'gold', amount: 1000 })).data.state;
    assert.equal((await request('/api/trade/confirm', tradeVersion(state))).status, 200);
    const send = DynamoDBDocumentClient.prototype.send;
    let release, entered;
    const held = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { entered = resolve; });
    const control = mock.method(DynamoDBDocumentClient.prototype, 'send', async function (command) {
        if (command.constructor.name === 'TransactWriteCommand') { entered(); await held; }
        return send.call(this, command);
    });
    try {
        const completing = request('/api/trade/confirm', tradeVersion(state), seeds[1].name);
        await started;
        assert.equal((await request('/api/trade/cancel', tradeVersion(state))).status, 409);
        assert.equal((await request('/api/trade/register', { ...tradeVersion(state), kind: 'gold', amount: 1000 })).status, 409);
        release(); assert.equal((await completing).status, 200);
        assert.equal((await rpg.getRPGUserByName(seeds[0].name)).gold, 999999000);
        assert.equal((await rpg.getRPGUserByName(seeds[1].name)).gold, 1000000950);
    } finally { release(); control.mock.restore(); }
});

test('자물쇠 화면은 실제 열쇠 수량을 제공하며 개봉 결과에는 소모 후 수량을 제공한다', async () => {
    const user = await reset(); const id = data.Item.findIndex(item => item?.name === '지니어스의 열쇠');
    assert.ok(id >= 0); rpg.addInventoryItem(user, id, 25); await user.save();
    assert.equal((await request('/api/lockbox', undefined, null)).status, 401);
    const before = await request('/api/lockbox');
    assert.equal(before.data.keyCount, 25); assert.match(before.data.keyIconUrl, /지니어스|%EC%A7%80/);
    const lockbox = data.Item.find(item => item?.name === '봉인된 자물쇠');
    const need = lockbox.require.find(entry => entry.id === id).count;
    const opened = await request('/api/inventory/use-lockbox', { count: 1 });
    assert.equal(opened.status, 200, JSON.stringify(opened)); assert.equal(opened.data.keyCount, 25 - need);
    assert.equal((await request('/api/lockbox')).data.keyCount, 25 - need);
});

test('거래소 판매 후보와 올라온 아티팩트는 모든 조건, 능력, 수치와 재설정 횟수를 제공한다', async () => {
    const user = await reset(); const equip = rpg.grantArtifact(user, '레전더리'); equip.artifact.rerollsUsed = 2; await user.save();
    const sellable = await request('/api/auction/sellable');
    const artifact = sellable.data.equipment[0].artifact;
    assert.equal(artifact.options.length, 3); assert.equal(artifact.rerollsUsed, 2); assert.equal(artifact.uid, equip.uid);
    for (const option of artifact.options) { assert.ok(option.conditionPrefix && option.conditionValue && option.abilityLabel); assert.ok(option.n >= 1 && option.n <= 10); }
    data.Auction = { items: [{ id: 'isolated-artifact', sellerName: user.name, kind: 'equipment', payload: structuredClone(equip), count: 1, currency: 'gold', price: 1000 }] };
    await rpg.loadRpgeniusDataEntry('Auction');
    const listed = await request('/api/auction', undefined, seeds[1].name);
    const view = listed.data.items[0].display.equipmentDetail.artifact;
    assert.equal(view.uid, equip.uid); assert.equal(view.rerollsUsed, 2);
    assert.deepEqual(view.options.map(({ active, ...option }) => option), artifact.options.map(({ active, ...option }) => option));
    data.Auction = { items: [] }; await rpg.loadRpgeniusDataEntry('Auction');
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

test('엔진을 다시 불러오면 보관한 거래 품목을 복구하고 확정은 해제한 상태로 이어간다', async () => {
    let state = await prepareDirectTrade(); let user = await rpg.getRPGUserByName(seeds[0].name);
    const equip = rpg.grantArtifact(user, '레전더리'); equip.artifact.rerollsUsed = 2; const original = structuredClone(equip); await user.save();
    const candidate = (await request('/api/trade/inventory')).data.equipment[0];
    state = (await request('/api/trade/register', { ...tradeVersion(state), kind: 'equipment', number: candidate.number, version: candidate.version })).data.state;
    state = (await request('/api/trade/register', { ...tradeVersion(state), kind: 'gold', amount: 1000 })).data.state;
    assert.equal((await request('/api/trade/confirm', tradeVersion(state))).status, 200);
    const snapshots = seeds.slice(0, 2).map(seed => structuredClone(records.get(seed.id)));
    await rpg.cancelTradeByUser(await rpg.getRPGUserByName(seeds[0].name));
    for (const record of snapshots) records.set(record.id, record);
    const modulePath = require.resolve('../rpgenius'), cached = require.cache[modulePath];
    let recovered;
    try { delete require.cache[modulePath]; recovered = require('../rpgenius'); }
    finally { require.cache[modulePath] = cached; }
    await recovered.initRpgeniusData();
    user = await recovered.getRPGUserByName(seeds[0].name);
    const restored = recovered.getDirectTradeState(user.name);
    assert.equal(restored.session.id, state.session.id); assert.equal(restored.session.revision, state.session.revision);
    assert.equal(restored.session.confirmed, false); assert.equal(restored.session.partnerConfirmed, false);
    assert.equal(restored.session.offer.gold, 1000); assert.deepEqual(restored.session.offer.equipments[0], original);
    await recovered.cancelTradeByUser(user);
    assert.equal((await recovered.getRPGUserByName(user.name)).gold, 1000000000);
    assert.deepEqual((await recovered.getRPGUserByName(user.name)).inventory.equipment[0], original);
    await rpg.reloadAllUsersFromDb(true);
});
