const assert = require('assert');
const fs = require('fs');
const path = require('path');

for (const line of fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
}

const rpg = require('../rpgenius');

const characterCards = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'DB', 'RPGenius', 'CharacterCards.json'), 'utf8'));
const cardIdByName = name => characterCards.findIndex(c => c && c.name === name);

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
