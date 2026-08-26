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

(async () => {
    await rpg.initRpgeniusData();
    const items = rpg.getDataCache('Item', []);
    const specterItemId = items.findIndex(it => it && it.name === '빅뱅 스펙터');
    assert.ok(specterItemId >= 0, '빅뱅 스펙터 아이템이 존재해야 한다');
    assert.strictEqual(items[specterItemId].use, '스펙터', '아이템 use=스펙터');

    const user = new rpg.RPGUser('테스트스펙터', '테스트스펙터-id');
    user.save = async () => {};
    user.level = 200;
    user.need_character_card_select = false;
    user.inventory.card.push({ id: cardIdByName('뭔마'), star: 5, type: '일반' });
    user.inventory.card.push({ id: cardIdByName('뭔마'), star: 5, type: '전직' });

    // 1) 사용 → 스펙터부여 pending, 웹 대상은 일반 카드만
    rpg.addInventoryItem(user, specterItemId, 1);
    let r = await rpg.useItem(user, '빅뱅 스펙터', 1);
    assert.ok(String(r).includes('부여할 카드를 선택'), '사용 시 카드 선택 안내: ' + r);
    assert.ok(user.pendingAction && user.pendingAction.type === '스펙터부여', 'pendingAction=스펙터부여');
    const pendingView = rpg.getWebItemUsePending(user);
    assert.ok(pendingView && pendingView.options.length === 1 && pendingView.options[0].value === 1, '웹 대상은 일반 카드 1장만');

    // 2) 전직 카드 선택 거부
    r = rpg.resolveWebItemUsePending(user, 2);
    assert.ok(String(r).includes('일반 카드에만'), '전직 카드 거부: ' + r);

    // 3) 일반 카드 부여 성공 + 아이템 소모
    r = rpg.resolveWebItemUsePending(user, 1);
    assert.ok(String(r).includes('부여했습니다'), '부여 성공: ' + r);
    assert.strictEqual(user.inventory.card[0].specter, '빅뱅 스펙터', '카드에 specter 기록');
    assert.strictEqual(user.pendingAction, null, 'pending 해제');
    assert.strictEqual(rpg.getInventoryItemCount(user, specterItemId), 0, '아이템 소모');

    // 4) 메인 장착 시 스킬 목록 마지막(=궁극기)이 빅뱅
    user.main_card = user.inventory.card.splice(0, 1)[0];
    const skills = rpg.getMainCardSkills(user);
    assert.ok(skills.length >= 2, '기본 스킬 + 빅뱅: ' + skills.length);
    assert.strictEqual(skills[skills.length - 1].skill.name, '빅뱅', '빅뱅이 마지막(궁극기 판정)');

    // 5) 필드에서 사용 가능 + MP 소모/쿨타임 기록
    const dungeonName = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'DB', 'RPGenius', 'Dungeon.json'), 'utf8'))[0].name;
    user.hp = 1000000000;
    user.mp = 1000000000;
    user.field = { name: dungeonName, enteredAt: Date.now(), nextActionAt: 0, skillCooldowns: {}, killCount: 0, elite: null };
    const mpBefore = user.mp;
    r = await rpg.useSkillInField(user, '빅뱅');
    assert.ok(!String(r).startsWith('❌'), '필드 사용 성공: ' + r);
    assert.ok(Number(user.field.skillCooldowns['빅뱅'] || 0) > Date.now(), '쿨타임 기록');
    assert.ok(mpBefore - user.mp >= 400, 'MP 소모: ' + (mpBefore - user.mp));

    // 6) 이미 부여된 카드 → 교체 확인 흐름
    user.inventory.card.unshift(user.main_card);
    user.main_card = {};
    rpg.addInventoryItem(user, specterItemId, 1);
    await rpg.useItem(user, '빅뱅 스펙터', 1);
    r = rpg.resolveWebItemUsePending(user, 1);
    assert.ok(String(r).includes('교체하시겠습니까'), '교체 확인 요구: ' + r);
    assert.strictEqual(user.pendingAction.cardNumber, 1, '확인 대상 기록');
    r = rpg.resolveWebItemUsePending(user, null, true);
    assert.ok(String(r).includes('부여했습니다'), '교체 성공: ' + r);

    // 7) 한 번에 1개만 사용 가능
    rpg.addInventoryItem(user, specterItemId, 2);
    r = await rpg.useItem(user, '빅뱅 스펙터', 2);
    assert.ok(String(r).includes('한 번에 1개만'), '개수 제한: ' + r);

    console.log('✅ specter.test.js 통과');
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
