'use strict';

// 명시적인 콘텐츠 등록에서만 사용한다. 서버 시작/조회에서는 운영 데이터를 만들지 않는다.
const SET_NAME = '유의게임X';
const PETS = [
    ['고유', '유리사', '우승자', { cardCombineBonus: .02 }],
    ['레전더리', '펀쿨섹', '결승 진출자', { hpRegen: 20 }],
    ['레전더리', '겨울', '결승 진출자', { autoFragment: 1 }],
    ['레전더리', '은채', '결승 진출자', { autoPotion: true }],
    ['유니크', '홍진호', '준결승 진출자', { canShortcut: 2 }],
    ['유니크', '전술가', '준결승 진출자', { fishBasket: 100 }],
    ['유니크', '서출구', '준결승 진출자', { autoFragment: .5 }],
    ['유니크', '내게팀은없다', '준결승 진출자', { fishingSpeed: .07 }],
    ['레어', '씨잼', '9위', { canShortcut: 1 }],
    ['레어', '동그라미', '10위', { autoAttend: true }],
    ['레어', '요나', '11위', { fishingSpeed: .04 }],
    ['레어', '리인카네이션', '12위', { autoFragment: .25 }],
    ['레어', '한국인의밥상', '13위', {}, { potion: .1 }],
    ['레어', '흑자헬스', '14위', { fishBasket: 50 }],
    ['레어', '김영광', '15위', { mpRegen: 40 }],
    ['레어', '오타니', '16위', { hpRegen: 40 }],
    ['레어', '문철마삼', '17위', { fishingSpeed: .03 }],
    ['레어', '예수', '18위', { fishBasket: 30 }],
    ['레어', '카즈토', '19위', { mpRegen: 50 }],
    ['레어', '나화진', '20위', { hpRegen: 50 }]
].map(([rarity, name, place, special, plusStat = {}]) => ({
    name: SET_NAME + ' ' + name, rarity, desc: SET_NAME + ' ' + place + ' ' + name + ' 펫이다.',
    set: SET_NAME, stat: {}, plusStat, upgrade: [], special
}));
const SET_EFFECTS = [{ stat: { hp: 100 } }, { plusStat: { atk: .01 } }, { plusStat: { exp: .05, itemDropChance: .05 } }];
const MATERIALS = [
    { name: '유리사의 잔상', type: '재료', desc: '3개를 모아 고유 유의게임X 유리사 펫을 제작할 수 있다.', sell: 0 },
    { name: '지나의 축복', type: '재료', desc: '유의게임X 펫 제작 재료. 레어 20개, 유니크 50개, 레전더리 200개가 필요하다.', sell: 0 }
];
const DEFAULT_CONFIG = {
    active: true, singleCost: 300, shakeCost: 1500, refreshCost: 0,
    rewards: [
        { id: 'trace', name: '유리사의 잔상', type: 'item', stock: 1, count: 1, grade: 'first' },
        { id: 'legendary', name: '유의게임X 랜덤 펫', type: 'pet', rarity: '레전더리', stock: 2, count: 1, grade: 'upper' },
        { id: 'unique', name: '유의게임X 랜덤 펫', type: 'pet', rarity: '유니크', stock: 3, count: 1, grade: 'upper' },
        { id: 'rare', name: '유의게임X 랜덤 펫', type: 'pet', rarity: '레어', stock: 10, count: 1, grade: 'normal' },
        { id: 'blessing2', name: '지나의 축복', type: 'item', stock: 16, count: 2, grade: 'normal' },
        { id: 'blessing1', name: '지나의 축복', type: 'item', stock: 68, count: 1, grade: 'normal' }
    ]
};

function appendContent(current) {
    const next = structuredClone(current);
    for (const key of ['Pet', 'Item', 'Recipe']) if (!Array.isArray(next[key])) throw new Error(key + ' 운영 데이터를 확인해주세요.');
    for (const pet of PETS) if (!next.Pet.some(entry => entry?.name === pet.name)) next.Pet.push(structuredClone(pet));
    for (const item of MATERIALS) if (!next.Item.some(entry => entry?.name === item.name)) next.Item.push(structuredClone(item));
    for (const pet of PETS) {
        if (next.Recipe.some(entry => entry?.name === pet.name)) continue;
        const material = pet.rarity === '고유' ? MATERIALS[0].name : MATERIALS[1].name;
        next.Recipe.push({ name: pet.name,
            materials: [{ type: '아이템', item_id: next.Item.findIndex(entry => entry?.name === material), count: { 고유: 3, 레전더리: 200, 유니크: 50, 레어: 20 }[pet.rarity] }],
            crafted: [{ type: '펫', pet_id: next.Pet.findIndex(entry => entry?.name === pet.name) }]
        });
    }
    if (next.PersonalDraw === undefined) next.PersonalDraw = structuredClone(DEFAULT_CONFIG);
    return next;
}

module.exports = { SET_NAME, PETS, SET_EFFECTS, MATERIALS, DEFAULT_CONFIG, appendContent };
