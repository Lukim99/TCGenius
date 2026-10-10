'use strict';

// 명시적 콘텐츠 등록에만 사용한다. 실행 중의 규칙은 운영 PointMine 레코드에서 읽는다.
const KEY_NAME = '곡괭이 상자 열쇠';
const KEY_DEFINITION = { type: '이벤트', name: KEY_NAME, desc: '포인트 광산에서 곡괭이 상자 1개를 여는 열쇠. 필드 사냥으로 하루 최대 2개 획득할 수 있다.' };
const PICKAXES = [
    ['wood', '나무 곡괭이', 0, 0, 5, 2400, []],
    ['stone', '돌 곡괭이', 1, 1, 8, 2400, [['stone', 2]]],
    ['rusty_iron', '녹슨 철 곡괭이', 2, 2, 12, 2000, [['copper', 1]]],
    ['bronze', '청동 곡괭이', 4, 3, 18, 1600, [['coal', 2]]],
    ['steel', '강철 곡괭이', 3, 4, 26, 900, [['copper', 2]]],
    ['gold', '황금 곡괭이', 5, 5, 38, 400, [['iron', 1]]],
    ['titanium', '티타늄 곡괭이', 6, 6, 55, 150, [['silver', 1], ['coal', 1], ['stone', 1]]],
    ['platinum', '백금 곡괭이', 7, 7, 80, 80, [['silver', 2], ['coal', 2]]],
    ['obsidian', '흑요석 곡괭이', 8, 8, 115, 30, [['obsidian', 1]]],
    ['alloy', '강화 합금 곡괭이', 9, 9, 165, 15, [['obsidian', 1], ['silver', 1], ['iron', 1]]],
    ['ruby', '루비 곡괭이', 10, 10, 235, 10, [['amethyst', 1], ['coal', 1], ['stone', 1]]],
    ['sapphire', '사파이어 곡괭이', 11, 11, 330, 6, [['amethyst', 1], ['gold', 1], ['stone', 1]]],
    ['orichalcum', '오리하르콘 곡괭이', 12, 12, 460, 4, [['amethyst', 1], ['iron', 1], ['coal', 1]]],
    ['adamantium', '아다만티움 곡괭이', 13, 13, 640, 3, [['aquamarine', 1]]],
    ['astral', '아스트랄 곡괭이', 14, 14, 880, 1.5, [['emerald', 1], ['obsidian', 1], ['coal', 1]]],
    ['master', '마스터 곡괭이', 15, 15, 1200, 0.5, [['diamond', 1], ['silver', 1]]]
].map(([id, name, spriteIndex, rank, durability, weight, repair]) => ({ id, name, spriteIndex, rank, durability, weight, repair: repair.map(([oreId, count]) => ({ oreId, count })) }));
const ORES = [
    ['stone', '돌', 1, 0], ['coal', '석탄', 2, 0], ['copper', '구리 광석', 3, 1], ['iron', '철 광석', 5, 1],
    ['silver', '은 광석', 10, 2], ['gold', '금 광석', 15, 3], ['jade', '비취석', 25, 4], ['obsidian', '흑요석', 40, 6],
    ['topaz', '토파즈', 60, 7], ['amethyst', '자수정', 80, 8], ['aquamarine', '아쿠아마린', 100, 9],
    ['ruby', '루비', 250, null], ['sapphire', '사파이어', 300, null], ['emerald', '에메랄드', 150, 12],
    ['diamond', '다이아몬드', 400, 14], ['mithril', '미스릴', 1000, 15]
].map(([id, name, value, minRank], index) => ({ id, name, value, minRank, weight: 0.55 ** index, spriteIndex: id === 'ruby' ? 13 : id === 'emerald' ? 11 : index,
    ...(id === 'ruby' || id === 'sapphire' ? { exactPickaxe: id } : {}), ...(id === 'jade' ? { blockedPickaxe: 'gold' } : {}) }));
const DEFAULT_CONFIG = {
    active: true, mineIntervalMs: 640, pickaxes: PICKAXES, ores: ORES,
    rewards: [
        ['orb-choice', '보주 선택 상자', 10000, 1, 1], ['orb', '보주 상자', 3900, 1, 1],
        ['character-stone-pouch', '지정 캐릭터 변환석 주머니', 4900, 1, 1], ['zeta', '제타 카드팩', 3500, 1, 1],
        ['card9', '9성 카드팩', 2900, 1, 1], ['job8', '8성 전직 카드팩', 2000, 1, 10],
        ['card8', '8성 카드팩', 1000, 1, 10], ['genius-key', '지니어스의 열쇠', 100, 3, 0]
    ].map(([id, name, cost, count, limit]) => ({ id, name, cost, count, limit }))
};

module.exports = { KEY_NAME, KEY_DEFINITION, DEFAULT_CONFIG };
