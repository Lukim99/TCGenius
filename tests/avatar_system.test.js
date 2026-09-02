const assert = require('assert');
const fs = require('fs');
const path = require('path');

for (const line of fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
}

const rpg = require('../rpgenius');

(async () => {
    await rpg.initRpgeniusData();
    const items = rpg.getDataCache('Item', []);
    const fashions = rpg.getFashionData();
    assert.ok(fashions.length > 0, 'Fashion 데이터 로드');

    const exclusiveFashion = fashions.find(f => f && f.exclusive === true);
    const highFashion = fashions.find(f => f && f.isHigh === true && f.exclusive !== true);
    const normalFashion = fashions.find(f => f && !f.isHigh && !f.exclusive && Array.isArray(f.primary_card) && f.primary_card.length > 0);
    assert.ok(exclusiveFashion && highFashion && normalFashion, '등급별 패션 존재');

    // 1) 등급 판정
    assert.strictEqual(rpg.getAvatarGradeByName(exclusiveFashion.name), '한정', 'exclusive → 한정');
    assert.strictEqual(rpg.getAvatarGradeByName(highFashion.name), '프레스티지', 'isHigh → 프레스티지');
    assert.strictEqual(rpg.getAvatarGradeByName(normalFashion.name), '일반', '기본 → 일반');
    assert.strictEqual(rpg.getAvatarGradeByName('없는아바타'), null, '미존재 → null');

    // 2) 해금/중복
    const user = new rpg.RPGUser('아바타테스트', '아바타테스트-id');
    user.save = async () => {};
    assert.strictEqual(rpg.hasAvatar(user, normalFashion.name), false, '초기 미보유');
    assert.strictEqual(rpg.unlockAvatar(user, normalFashion.name, 0), true, '해금 성공');
    assert.strictEqual(rpg.unlockAvatar(user, normalFashion.name, 0), false, '중복 해금 거부');
    assert.strictEqual(rpg.hasAvatar(user, normalFashion.name), true, '보유 확인');

    // 3) 거래 가능 규칙: 일반=가능, 프레스티지=불가, 한정=1회
    rpg.unlockAvatar(user, highFashion.name, 0);
    rpg.unlockAvatar(user, exclusiveFashion.name, 0);
    assert.strictEqual(rpg.getAvatarTradeBlockReason(user, normalFashion.name), null, '일반 거래 가능');
    assert.ok(String(rpg.getAvatarTradeBlockReason(user, highFashion.name)).includes('프레스티지'), '프레스티지 거래 불가');
    assert.strictEqual(rpg.getAvatarTradeBlockReason(user, exclusiveFashion.name), null, '한정 trades=0 거래 가능');
    rpg.findUserAvatar(user, exclusiveFashion.name).trades = 1;
    assert.ok(String(rpg.getAvatarTradeBlockReason(user, exclusiveFashion.name)).includes('최초 1회'), '한정 trades=1 거래 불가');
    assert.ok(String(rpg.getAvatarTradeBlockReason(user, '없는아바타')).includes('보유하지'), '미보유 거래 불가');

    // 4) 장착/해제
    const isJobFashion = normalFashion.type === '전직';
    const cardId = Number(normalFashion.primary_card[0]);
    const card = { id: cardId, star: Math.max(6, Number(normalFashion.requireStar || 0)), type: isJobFashion ? '전직' : '일반' };
    user.inventory.card.push(card);
    assert.strictEqual(rpg.equipAvatarOnCard(user, card, normalFashion.name), null, '장착 성공');
    assert.strictEqual(card.skin, normalFashion.name, 'card.skin 기록');
    assert.strictEqual(rpg.equipAvatarOnCard(user, card, ''), null, '해제 성공');
    assert.strictEqual(typeof card.skin, 'undefined', 'card.skin 제거');
    // 미보유 아바타 장착 거부
    const lockedFashion = fashions.find(f => f && !f.isHigh && !f.exclusive && f !== normalFashion && Array.isArray(f.primary_card) && f.primary_card.length > 0);
    if (lockedFashion) {
        const lockedCard = { id: Number(lockedFashion.primary_card[0]), star: 11, type: lockedFashion.type === '전직' ? '전직' : '일반' };
        assert.ok(String(rpg.equipAvatarOnCard(user, lockedCard, lockedFashion.name)).includes('보유하지'), '미보유 장착 거부');
    }
    // 성급 미달 거부
    if (Number(normalFashion.requireStar || 0) > 0) {
        const lowCard = { id: cardId, star: 0, type: isJobFashion ? '전직' : '일반' };
        assert.ok(String(rpg.equipAvatarOnCard(user, lowCard, normalFashion.name)).includes('성 이상'), '성급 미달 거부');
    }

    // 5) getAvatarOptionsForCard: 타입/캐릭터 필터 + 상태 플래그
    rpg.equipAvatarOnCard(user, card, normalFashion.name);
    const options = rpg.getAvatarOptionsForCard(user, card);
    assert.ok(options.length > 0, '옵션 목록 존재');
    options.forEach(option => {
        assert.ok(option.fashion.primary_card.map(Number).includes(cardId), '캐릭터 일치');
        assert.strictEqual(option.fashion.type === '전직', isJobFashion, '타입 일치');
    });
    const equippedOption = options.find(option => option.name === normalFashion.name);
    assert.ok(equippedOption && equippedOption.equipped && equippedOption.unlocked, '장착/해금 플래그');

    // 6) removeUserAvatar: 해금 제거 + 장착 카드에서 스킨 해제 (거래 등록 시나리오)
    const removed = rpg.removeUserAvatar(user, normalFashion.name);
    assert.ok(removed && removed.name === normalFashion.name, '해금 제거 반환');
    assert.strictEqual(typeof card.skin, 'undefined', '등록 시 카드에서 스킨 해제');
    assert.strictEqual(rpg.hasAvatar(user, normalFashion.name), false, '해금 목록에서 제거');
    rpg.unlockAvatar(user, normalFashion.name, Number(removed.trades || 0));

    // 7) 마이그레이션: 전용 적용권 보유자만 한정 해금 + 티켓 회수, 미해금 스킨 일괄 해제
    const ticketId = items.findIndex(it => it && it.fashion && fashions.some(f => f && f.name == it.fashion && f.exclusive === true));
    assert.ok(ticketId >= 0, '전용 적용권 아이템 존재');
    const ticketFashion = items[ticketId].fashion;
    const migrUser = new rpg.RPGUser('아바타이전', '아바타이전-id');
    migrUser.save = async () => {};
    const rawData = JSON.parse(JSON.stringify(Object.assign({}, migrUser)));
    delete rawData.avatars;
    delete rawData.avatarMigrated;
    rawData.inventory.item.push({ id: ticketId, count: 1 });
    rawData.inventory.card.push({ id: 0, star: 6, type: '일반', skin: normalFashion.name }); // 미해금 스킨 → 해제되어야 함
    rawData.main_card = { id: 0, star: 6, type: '일반', skin: ticketFashion }; // 티켓 해금 대상 스킨 → 유지
    const loaded = new rpg.RPGUser('아바타이전', '아바타이전-id').load(rawData);
    loaded.save = async () => {};
    assert.strictEqual(loaded.avatarMigrated, true, '마이그레이션 완료 플래그');
    assert.strictEqual(rpg.hasAvatar(loaded, ticketFashion), true, '티켓 보유자 한정 해금');
    assert.strictEqual(rpg.getInventoryItemCount(loaded, ticketId), 0, '티켓 회수');
    assert.strictEqual(typeof loaded.inventory.card[0].skin, 'undefined', '미해금 스킨 해제');
    assert.strictEqual(loaded.main_card.skin, ticketFashion, '해금된 한정 스킨 유지');
    // 재로드 시 중복 실행 안 함 (idempotent)
    const reloaded = new rpg.RPGUser('아바타이전', '아바타이전-id').load(JSON.parse(JSON.stringify(Object.assign({}, loaded))));
    assert.strictEqual(rpg.getUserAvatars(reloaded).filter(a => a.name === ticketFashion).length, 1, '재로드 중복 해금 없음');

    // 8) 적용권 아이템 사용 차단 (데이터 상태와 무관하게 useItem이 거부해야 함)
    const legacyTicketId = items.findIndex(it => it && it.name === '패션 적용권');
    if (legacyTicketId >= 0) {
        const useUser = new rpg.RPGUser('아바타사용', '아바타사용-id');
        useUser.save = async () => {};
        useUser.need_character_card_select = false;
        rpg.addInventoryItem(useUser, legacyTicketId, 1);
        const reply = await rpg.useItem(useUser, '패션 적용권', 1);
        assert.ok(String(reply).includes('❌'), '패션 적용권 사용 차단: ' + reply);
        assert.strictEqual(useUser.pendingAction, null, 'pending 미생성');
        assert.strictEqual(rpg.getInventoryItemCount(useUser, legacyTicketId), 1, '아이템 미소모');
    }

    // 9) grantPackReward '아바타' 보상
    const rewardUser = new rpg.RPGUser('아바타보상', '아바타보상-id');
    rewardUser.save = async () => {};
    const summary = {};
    rpg.grantPackReward(rewardUser, { type: '아바타', fashion: normalFashion.name, count: 1 }, summary);
    assert.strictEqual(rpg.hasAvatar(rewardUser, normalFashion.name), true, '아바타 보상 해금');
    assert.ok(Object.keys(summary).some(key => key === 'avatar:' + normalFashion.name), '보상 요약 기록');

    console.log('avatar_system.test.js: 모든 검증 통과');
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
