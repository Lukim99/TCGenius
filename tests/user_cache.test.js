// 유저 캐시 계층 검증 (전부 목 — 실 DB 미접촉)
// 1) 부팅 스캔 후 이름/코드/기본키 조회가 캐시에서 동작
// 2) save() 기본 = 즉시 UpdateCommand, save({defer:true}) = 지연 후 flush
// 3) 로드-변이-미저장 = 폐기 (기존 의미 유지)
// 4) 서로 다른 인스턴스의 서로 다른 속성 저장이 병합됨 (lost-update 방지)
// 5) getRPGUserById 폴백: 캐시의 logged_in 검색 + sid 매핑 백필
const assert = require('assert');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');

const baseUser = name => ({
    _get: 1,
    id: name + '-id',
    name,
    code: name.toUpperCase() + 'CODE',
    logged_in: [],
    logged_in_agent: [],
    gold: 123,
    level: 1,
    mail: [],
    inventory: { card: [], item: [], equipment: [], pet: [] },
    equipments: { weapon: null, hat: null, armor: null, pants: null, shoes: null, accessory: {}, support: null, pet: [] }
});
const userA = baseUser('cache-user-a');
const userB = baseUser('cache-user-b');
userB.logged_in = ['cache-sender-1'];

const updates = [];
const sidPuts = [];
DynamoDBDocumentClient.prototype.send = async function (command) {
    const input = command.input || {};
    if (command.constructor.name === 'ScanCommand') {
        if (input.TableName === 'rpgenius_user') return { Items: [userA, userB].map(u => JSON.parse(JSON.stringify(u))) };
        return { Items: [] };
    }
    if (command.constructor.name === 'GetCommand') return {}; // rpgenius_data/sid 매핑 없음
    if (command.constructor.name === 'UpdateCommand') {
        if (input.TableName === 'rpgenius_user') updates.push(JSON.parse(JSON.stringify(input)));
        return {};
    }
    if (command.constructor.name === 'PutCommand') {
        if (input.TableName === 'rpgenius_sid') sidPuts.push(JSON.parse(JSON.stringify(input.Item)));
        return {};
    }
    throw new Error('Unexpected command: ' + command.constructor.name);
};

const rpg = require('../rpgenius');

(async () => {
    // 1) 캐시 조회
    const byName = await rpg.getRPGUserByName('cache-user-a');
    assert.ok(byName && byName.id === 'cache-user-a-id', '이름 조회는 캐시에서 되어야 한다');
    const byCode2 = await rpg.getRPGUserByCode(userB.code);
    assert.ok(byCode2 && byCode2.id === 'cache-user-b-id', '코드 조회는 캐시에서 되어야 한다');
    const all = await rpg.getAllRPGUsers();
    assert.strictEqual(all.length, 2, '전체 조회는 캐시 전체를 돌려줘야 한다');

    // 2) 기본 save = 즉시 flush (변경 키 포함)
    const before = updates.length;
    byName.gold = 200;
    await byName.save();
    assert.strictEqual(updates.length, before + 1, '기본 save는 즉시 DB에 기록해야 한다');
    assert.ok(updates[updates.length - 1].UpdateExpression.includes('#gold'), '변경된 gold가 기록돼야 한다');

    // 3) 로드-변이-미저장 = 폐기
    const throwaway = await rpg.getRPGUserByName('cache-user-a');
    throwaway.gold = 999999;
    const fresh1 = await rpg.getRPGUserByName('cache-user-a');
    assert.strictEqual(fresh1.gold, 200, '저장하지 않은 변이는 다른 조회에 보이면 안 된다');

    // 4) 서로 다른 인스턴스의 서로 다른 속성 병합
    const inst1 = await rpg.getRPGUserByName('cache-user-a');
    const inst2 = await rpg.getRPGUserByName('cache-user-a');
    inst1.gold = 300;
    await inst1.save();
    inst2.level = 7;
    await inst2.save();
    const merged = await rpg.getRPGUserByName('cache-user-a');
    assert.strictEqual(merged.gold, 300, '먼저 저장한 gold가 유지돼야 한다');
    assert.strictEqual(merged.level, 7, '나중에 저장한 level도 반영돼야 한다');

    // 5) 지연 저장: 즉시 기록 없음 → 메모리에는 보임 → flush 시 기록
    const beforeDefer = updates.length;
    const deferInst = await rpg.getRPGUserByName('cache-user-b');
    deferInst.exp = 555;
    await deferInst.save({ defer: true });
    assert.strictEqual(updates.length, beforeDefer, '지연 저장은 즉시 DB에 기록하면 안 된다');
    const memView = await rpg.getRPGUserByName('cache-user-b');
    assert.strictEqual(memView.exp, 555, '지연 저장도 메모리(다른 조회)에는 즉시 보여야 한다');
    const flushed = await rpg.flushAllDirtyUsers();
    assert.ok(flushed >= 1, 'flushAllDirtyUsers가 dirty 유저를 flush해야 한다');
    assert.strictEqual(updates.length, beforeDefer + 1, 'flush 시 지연 변경이 DB에 기록돼야 한다');
    assert.ok(updates[updates.length - 1].UpdateExpression.includes('#exp'), '지연 저장된 exp가 기록돼야 한다');

    // 6) senderId 폴백: 캐시 logged_in 검색 + sid 백필
    const bySender = await rpg.getRPGUserById('cache-sender-1');
    assert.ok(bySender && bySender.id === 'cache-user-b-id', 'logged_in 검색 폴백이 동작해야 한다');
    assert.ok(sidPuts.some(p => p.senderId === 'cache-sender-1' && p.accountId === 'cache-user-b-id'), 'sid 매핑이 백필돼야 한다');

    console.log('user_cache.test.js: OK');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
