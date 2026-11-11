'use strict';

const { uniquePassiveIds } = require('./transcend_equipment');
const PEPERO_NAMES = ['[이벤트]빼빼로', '[이벤트]누드 빼빼로', '[이벤트]아몬드 빼빼로'];
const KING_NAME = '[이벤트]대왕 빼빼로';
const EVENT_CONFIG = {
    active: true, endsAt: '2026-12-13T00:00:00+09:00', dropChance: .05, dailyLimit: 10,
    drops: PEPERO_NAMES.map((name, index) => ({ name, weight: [50, 30, 20][index] }))
};
const accessory = { name: '레지에로', rarity: '고유', desc: '검은 우산이다.', stat: {}, passive_id: uniquePassiveIds['흑백'] };

function prepare(before) {
    if (!Array.isArray(before.Item) || !Array.isArray(before.Pack) || !Array.isArray(before.Equipment?.accessory) || !Array.isArray(before.Paradise?.weeklyRewards?.ranks)) throw new Error('운영 Item/Pack/Equipment/Paradise 데이터를 확인해주세요. 초기화하지 않습니다.');
    const after = structuredClone(before);
    const itemId = name => {
        const id = after.Item.findIndex(item => item?.name === name);
        if (id < 0) throw new Error('운영 보상 아이템이 없습니다: ' + name);
        return id;
    };
    const addPack = (name, desc, rewards) => {
        if (after.Item.some(item => item?.name === name)) return;
        after.Item.push({ name, type: '가챠', no_trade: true, desc, pack: after.Pack.length });
        after.Pack.push(rewards);
    };
    if (!after.Item.some(item => item?.name === KING_NAME)) {
        const stones = after.Item.map((item, id) => ({ item, id })).filter(({ item }) => item?.use === '변환' && Number.isInteger(item.charId));
        if (!stones.length) throw new Error('지정 캐릭터 변환석이 없습니다.');
        addPack(KING_NAME, '지정 캐릭터 변환석(랜덤 1종), 곡괭이 상자 열쇠, 아바타 상자, 바인드 큐브, 거래권 중 1개를 각각 20% 확률로 획득한다.', [
            ...stones.map(({ id }) => ({ type: '아이템', item_id: id, count: 1, roll: .2 / stones.length })),
            ...['곡괭이 상자 열쇠', '아바타 상자', '바인드 큐브', '거래권'].map(name => ({ type: '아이템', item_id: itemId(name), count: 1, roll: .2 }))
        ]);
    }
    PEPERO_NAMES.forEach((name, index) => {
        const cardType = ['일반', '전직', '각성'][index];
        addPack(name, cardType + ' 5성(50%), 6성(30%), 7성(15%) 캐릭터 카드 또는 [이벤트]대왕 빼빼로(5%)를 획득한다.', [
            ...[5, 6, 7].map((star, i) => ({ type: '캐릭터카드', card_type: cardType, display_star: star, count: 1, roll: [.5, .3, .15][i] })),
            { type: '아이템', item_id: itemId(KING_NAME), count: 1, roll: .05 }
        ]);
    });
    if (!after.Equipment.accessory.some(item => item?.name === accessory.name)) after.Equipment.accessory.push(structuredClone(accessory));
    if (after.PeperoEvent === undefined) after.PeperoEvent = structuredClone(EVENT_CONFIG);
    // 요청한 두 순위 구간만 변경한다. 1등·참가상·지급 수량과 기존 정산 기록은 보존한다.
    const ranks = after.Paradise.weeklyRewards.ranks;
    const second = ranks.find(rank => rank.from === 2 && [2, 3].includes(rank.to));
    const lower = ranks.find(rank => rank.from === 3 && rank.to === 5 || rank.from === 4 && rank.to === 7);
    if (!second || !lower) throw new Error('기존 낙원 2등/3~5등 보상 구성을 확인해주세요.');
    second.to = 3; lower.from = 4; lower.to = 7;
    return after;
}

function newDungeon(source) {
    if (source?.name !== '란도랜드1') throw new Error('란도랜드1 기준 필드가 필요합니다.');
    const dungeon = structuredClone(source);
    Object.assign(dungeon, { name: '대저택리턴즈', requireLevel: 176, atk: 5200, pnt: 390, def: 335, hp: 13405,
        monsterAtlas: { file: 'field-atlas-5-clean.png', row: 2, rows: 4 } });
    Object.assign(dungeon.elite, { name: '유스티티아', atk: 17340, pnt: 810, def: 905, hp: 201600 });
    const drop = dungeon.elite.reward.find(reward => reward.type === '장신구' && reward.accessory_name === '장충동왕족발보쌈');
    if (!drop) throw new Error('란도랜드1 엘리트 장신구 드랍 구성을 확인해주세요.');
    drop.accessory_name = accessory.name;
    dungeon.dailyDungeon = {
        enabled: true, exp: 80000000, gold: { min: 14500000, max: 16500000 },
        items: ['일반 떡밥', '강화석', '상급 강화석'].map((name, i) => ({ name, count: i === 2 ? { min: 13, max: 23 } : { min: 3000, max: 3500 } })),
        itemChoices: [
            [6, 7].flatMap(star => ['', ' 전직', ' 각성'].map((kind, i) => ({ name: star + '성' + kind + ' 카드팩', weight: [3900, 1000, 100][i], count: 1 }))),
            [{ name: '헬 초대장', weight: 50, count: 160 }, { name: '헬 도전장', weight: 50, count: 120 }]
        ]
    };
    return dungeon;
}
module.exports = { PEPERO_NAMES, KING_NAME, EVENT_CONFIG, accessory, prepare, newDungeon };
