const assert = require('assert');
const fs = require('fs');
const path = require('path');

for (const line of fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
}

const rpg = require('../rpgenius');
const partyquest = require('../partyquest');

const characterCards = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'DB', 'RPGenius', 'CharacterCards.json'), 'utf8'));
const skills = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'DB', 'RPGenius', 'Skills.json'), 'utf8'));
const cardIdByName = name => characterCards.findIndex(c => c && c.name === name);
const skillByName = name => skills.find(skill => skill && skill.name === name);

function makeFieldUser(name, cardName, dungeonName) {
    const user = new rpg.RPGUser(name, name + '-id');
    user.level = 200;
    user.main_card = { id: cardIdByName(cardName), star: 6, type: '일반' };
    user.need_character_card_select = false;
    user.hp = 1000000000;
    user.mp = 1000000000;
    user.field = { name: dungeonName, enteredAt: Date.now(), nextActionAt: 0, skillCooldowns: {}, killCount: 0, elite: null };
    return user;
}

(async () => {
    await rpg.initRpgeniusData();
    const dungeonName = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'DB', 'RPGenius', 'Dungeon.json'), 'utf8'))[0].name;

    const expectedBalance = {
        '안면강타': { format: [[4.6, .25]], mp: 510, cooldown: 116000 },
        '감사합니다 친구야': { format: [[3.5, .35], [.18, .03]], mp: 520, cooldown: 106000 },
        'SUPER EASY': { format: [[1.4, .1], [.1, .02]], mp: 65, cooldown: 11000 },
        'KICK BACK': { format: [[5.6, .25], [.3, .03]], mp: 540, cooldown: 128000 },
        '초특급한탕': { format: [[1.8, .2], [7.77, .77]], mp: 777, cooldown: 77000 },
        '끝판왕': { format: [[6.4, .15]], mp: 820, cooldown: 164000 }
    };
    for (const [name, expected] of Object.entries(expectedBalance)) {
        const skill = skillByName(name);
        assert.ok(skill, name + ' 스킬이 존재해야 한다');
        assert.deepStrictEqual(skill.format.map(value => [value.base, value.per_star]), expected.format, name + ' 배율');
        assert.strictEqual(skill.mp_cost, expected.mp, name + ' MP');
        assert.strictEqual(skill.cooltime, expected.cooldown, name + ' 쿨타임');
    }

    // ===== 시벌론 (뭔마) =====
    const munma = makeFieldUser('테스트뭔마', '뭔마', dungeonName);
    assert.ok(cardIdByName('뭔마') >= 0, '뭔마 카드가 존재해야 한다');

    // 충전 없이 사용 → 거부
    let r = await rpg.useSkillInField(munma, '시벌론');
    assert.ok(String(r).includes('일반 공격을 5회'), '충전 부족 시 거부: ' + r);

    // 일반 공격 5회 → 충전 5
    for (let i = 0; i < 5; i++) {
        munma.field.nextActionAt = 0;
        munma.hp = 1000000000;
        await rpg.useBasicAttackInField(munma, null);
        assert.ok(munma.field, '일반 공격 후 필드 유지');
    }
    assert.strictEqual(Number(munma.field.sivalonCharge || 0), 5, '충전 5/5');

    // 시벌론 발동 → 상태 진입 + 충전 초기화
    munma.field.nextActionAt = 0;
    r = await rpg.useSkillInField(munma, '시벌론');
    assert.ok(String(r).includes('시벌론!'), '발동 메시지: ' + r);
    assert.ok(munma.field.sivalon && munma.field.sivalon.expired_at > Date.now(), '시벌론 상태 활성');
    const expectedDurMs = Math.round((6 + 0.3 * 6) * 1000);
    assert.ok(Math.abs(munma.field.sivalon.expired_at - Date.now() - expectedDurMs) < 1500, '지속시간 6+0.3*성');
    assert.strictEqual(Number(munma.field.sivalonCharge || 0), 0, '발동 후 충전 0');
    assert.ok(Number(munma.field.nextActionAt || 0) <= Date.now(), '발동 즉시 평타 가능 (행동 쿨타임 초기화)');

    // 상태 중 일반 공격 → 쿨타임 0.5초 + 충전 미증가
    munma.field.nextActionAt = 0;
    munma.hp = 1000000000;
    const before = Date.now();
    await rpg.useBasicAttackInField(munma, null);
    const cd = Number(munma.field.nextActionAt || 0) - before;
    assert.ok(cd > 0 && cd <= 700, '상태 중 일반 공격 쿨타임 0.5초 (실측 ' + cd + 'ms)');
    assert.strictEqual(Number(munma.field.sivalonCharge || 0), 0, '상태 중 충전 미증가');

    // 안면강타 → 시벌론 즉시 활성화(충전 5/5), 기존 다음 피해 감소는 부여하지 않음
    const jobMunma = makeFieldUser('테스트전직뭔마', '뭔마', dungeonName);
    jobMunma.main_card.type = '전직';
    r = await rpg.useSkillInField(jobMunma, '안면강타');
    assert.ok(String(r).includes('시벌론 활성화'), '안면강타 발동 메시지: ' + r);
    assert.strictEqual(Number(jobMunma.field.sivalonCharge || 0), 5, '안면강타 사용 후 시벌론 충전 5/5');
    assert.ok(!(jobMunma.field.buffs && jobMunma.field.buffs.nextDamageReduction), '안면강타는 다음 피해 감소를 부여하지 않아야 한다');

    // 감사합니다 친구야 → 솔로에서는 자기 보호막 없이 피해 감소만 10초
    const jin = makeFieldUser('테스트진필규', '진필규', dungeonName);
    jin.main_card.type = '전직';
    const thanksUsedAt = Date.now();
    r = await rpg.useSkillInField(jin, '감사합니다 친구야');
    const thanksBuff = jin.field.buffs && jin.field.buffs.receivedDamageReduction;
    assert.ok(String(r).includes('10초 동안 받는 피해 30% 감소'), '감사합니다 친구야 발동 메시지: ' + r);
    assert.ok(thanksBuff && thanksBuff.value === .3, '받는 피해 30% 감소');
    assert.ok(Math.abs(Number(thanksBuff.expired_at) - thanksUsedAt - 10000) < 1500, '피해 감소 지속시간 10초');
    assert.ok(!jin.field.shield, '솔로에서는 자기 보호막을 획득하지 않아야 한다');

    // 파티에서는 시전자 최대 HP 기준 보호막을 생존 파티원 모두에게 10초 부여
    const partyJin = makeFieldUser('테스트파티진필규', '진필규', dungeonName);
    partyJin.main_card.type = '전직';
    partyJin.save = async () => {};
    const partyAlly = makeFieldUser('테스트파티아군', '뭔마', dungeonName);
    partyAlly.save = async () => {};
    const partyUsers = { [partyJin.name]: partyJin, [partyAlly.name]: partyAlly };
    const originalGetUser = rpg.getRPGUserByName;
    rpg.getRPGUserByName = async name => partyUsers[name] || null;
    try {
        const created = await partyquest.createRoom(partyJin.name, 'blackHodu');
        assert.ok(created.roomId, '파티방 생성');
        assert.ok((await partyquest.joinRoom(created.roomId, partyAlly.name)).ok, '파티원 입장');
        assert.ok(partyquest.setPosition(partyJin.name, partyquest.POSITION_LIST[0]).ok, '시전자 포지션 선택');
        assert.ok(partyquest.setPosition(partyAlly.name, partyquest.POSITION_LIST[1]).ok, '파티원 포지션 선택');
        assert.ok(partyquest.setReady(partyJin.name, true).ok && partyquest.setReady(partyAlly.name, true).ok, '파티 준비');
        assert.ok((await partyquest.start(partyJin.name)).ok, '파티 퀘스트 시작');
        const room = partyquest.getRoomOf(partyJin.name);
        room.introUntil = 0;
        room.members.forEach(member => { member.runtime.mp = 1000000000; member.runtime.actionUntil = 0; });
        const partyThanksUsedAt = Date.now();
        assert.ok(partyquest.useSkill(partyJin.name, '감사합니다 친구야').ok, '파티에서 감사합니다 친구야 사용');
        const caster = room.members.find(member => member.name === partyJin.name);
        const ally = room.members.find(member => member.name === partyAlly.name);
        assert.ok(caster.runtime.shield > 0 && ally.runtime.shield > 0, '생존 파티원 전체에게 보호막 부여');
        assert.ok(Math.abs(caster.runtime.shieldExpireAt - partyThanksUsedAt - 10000) < 1500, '시전자 보호막 지속시간 10초');
        assert.ok(Math.abs(ally.runtime.shieldExpireAt - partyThanksUsedAt - 10000) < 1500, '파티원 보호막 지속시간 10초');
        assert.strictEqual(caster.runtime.takenDmgMul, .7, '시전자 받는 피해 30% 감소');
    } finally {
        partyquest.leaveRoom(partyAlly.name);
        partyquest.leaveRoom(partyJin.name);
        rpg.getRPGUserByName = originalGetUser;
    }

    // ===== 건력 (타이란트) =====
    const tyrant = makeFieldUser('테스트타이란트', '타이란트', dungeonName);
    assert.ok(cardIdByName('타이란트') >= 0, '타이란트 카드가 존재해야 한다');
    const baseMaxHp = Number(rpg.calculateUserStats(tyrant).hp || 0);

    r = await rpg.useSkillInField(tyrant, '건력');
    assert.ok(String(r).includes('건력!'), '건력 발동: ' + r);
    assert.ok(tyrant.field.gunryeok && tyrant.field.gunryeok.expired_at > Date.now(), '건력 상태 활성');
    const sealedMaxHp = Number(rpg.calculateUserStats(tyrant).hp || 0);
    assert.strictEqual(sealedMaxHp, Math.max(1, Math.round(baseMaxHp * 0.3)), '최대 HP 70% 봉인');
    assert.ok(Number(tyrant.hp) <= sealedMaxHp, '현재 HP가 봉인 최대치로 클램프');
    assert.ok(Math.abs(Number(tyrant.field.gunryeok.dmgReduce) - (0.25 + 0.01 * 6)) < 1e-9, '피해감소 25%+1%/성');
    assert.ok(Math.abs(Number(tyrant.field.gunryeok.atkBuff) - (0.6 + 0.05 * 6)) < 1e-9, '공격력 60%+5%/성');

    // 재사용(쿨타임 해제 후) → 상태 해제 + 최대 HP 복구
    tyrant.field.nextActionAt = 0;
    tyrant.field.skillCooldowns['건력'] = 0;
    r = await rpg.useSkillInField(tyrant, '건력');
    assert.ok(String(r).includes('해제'), '재사용 시 해제: ' + r);
    assert.ok(!tyrant.field.gunryeok, '건력 상태 제거');
    assert.strictEqual(Number(rpg.calculateUserStats(tyrant).hp || 0), baseMaxHp, '봉인 해제 후 최대 HP 복구');

    console.log('skill_remake.test.js OK');
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
