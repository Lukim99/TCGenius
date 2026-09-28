// Builds seed.json for mock_dynamo.js: game data (repo JSON + production snapshots in tmp/)
// and a showcase account plus fictional rival accounts. Real player nicknames are replaced.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');   // repo root
const RPG = path.join(ROOT, 'DB', 'RPGenius');
const BACKUP = path.join(ROOT, 'tmp', 'avatar_migration_backup');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
const backup = prefix => readJson(path.join(BACKUP, fs.readdirSync(BACKUP).find(f => f.startsWith('backup-' + prefix + '-'))));

const FAKE_NAMES = ['별빛사냥꾼', '새벽달', '코인요정', '딜러의귀환', '포커페이스', '루나틱', '검은고양이', '한밤의연금술사',
    '카드장인', '폭풍전야', '은하수', '레이드대장', '파란불꽃', '초월자', '가넷부자', '밤하늘', '모험왕', '황금손', '무한동력', '에이스',
    '강화의신', '로열플러시', '마나번', '홍백전사', '심연의끝', '행운토끼', '첫눈', '오메가', '월광', '태풍의눈'];
const nameMap = new Map();
const fakeName = real => {
    if (!real) return real;
    if (!nameMap.has(real)) nameMap.set(real, FAKE_NAMES[nameMap.size % FAKE_NAMES.length] + (nameMap.size >= FAKE_NAMES.length ? nameMap.size : ''));
    return nameMap.get(real);
};

// ---------- game data ----------
const items = backup('Item');
// Equipment: repo JSON (base tiers) + the real transcend/mythic definitions shipped in transcend_equipment.js.
const transcend = require(path.join(ROOT, 'transcend_equipment.js'));
const equipment = readJson(path.join(RPG, 'Equipment.json'));
Object.entries(transcend.definitions).forEach(([type, list]) => {
    equipment[type] = [...(equipment[type] || []), ...JSON.parse(JSON.stringify(list))];
});
const data = {
    Bundle: readJson(path.join(RPG, 'Bundle.json')),
    Coupon: [],
    Equipment: equipment,
    Item: items,
    Pack: readJson(path.join(RPG, 'Pack.json')),
    Recipe: backup('Recipe'),
    Shop: backup('Shop'),
    Fashion: backup('Fashion'),
    Bait: readJson(path.join(RPG, 'Bait.json')),
    Banner: [],
    Patchnote: [
        { id: 'pn6', title: '추석 이벤트 & 사용 효과 표시', date: '2026-09-26T18:00:00+09:00', textbody: '## 🌕 추석 이벤트 오픈\n- 보름달을 눌러 [추석]5성 전직 카드팩을 받아가세요.\n- 송편 사냥 드랍이 추가되었습니다.\n\n## 개선\n- 아이템 사용 효과가 인벤토리에 표시됩니다.\n- 모바일 연출이 개선되었습니다.', replies: [], createdAt: '2026-09-26T09:00:00Z', updatedAt: '2026-09-26T09:00:00Z' },
        { id: 'pn5', title: '칭호 · 캐릭터 카드 개선', date: '2026-09-22T18:00:00+09:00', textbody: '- 칭호 스탯만 적용하는 기능이 추가되었습니다.\n- 캐릭터 카드 표시가 개선되었습니다.', replies: [], createdAt: '2026-09-22T09:00:00Z', updatedAt: '2026-09-22T09:00:00Z' },
        { id: 'pn4', title: '각성 스펙터 추가', date: '2026-09-15T18:00:00+09:00', textbody: '- 각성 카드 전용 스펙터가 추가되었습니다.\n- 각성조합 연출이 개선되었습니다.', replies: [], createdAt: '2026-09-15T09:00:00Z', updatedAt: '2026-09-15T09:00:00Z' },
        { id: 'pn3', title: '상점 개편', date: '2026-09-08T18:00:00+09:00', textbody: '- 핫딜샵이 새롭게 단장했습니다.\n- 초월 상점이 추가되었습니다.', replies: [], createdAt: '2026-09-08T09:00:00Z', updatedAt: '2026-09-08T09:00:00Z' },
        { id: 'pn2', title: '지혜의 보석 퀘스트', date: '2026-09-01T18:00:00+09:00', textbody: '- 게시판에서 지혜의 보석 퍼즐 퀘스트를 진행할 수 있습니다.', replies: [], createdAt: '2026-09-01T09:00:00Z', updatedAt: '2026-09-01T09:00:00Z' },
        { id: 'pn1', title: '윷놀이 이벤트 전체 공개', date: '2026-08-25T18:00:00+09:00', textbody: '- 윷놀이 이벤트가 모든 유저에게 공개되었습니다.\n- 흑막 칭호가 추가되었습니다.', replies: [], createdAt: '2026-08-25T09:00:00Z', updatedAt: '2026-08-25T09:00:00Z' }
    ]
};

// Pets: rebuilt from the real pet art (rarity + name), stats scaled by rarity.
const PET_STAT = { 레어: 0.02, 유니크: 0.04, 레전더리: 0.07, 고유: 0.09, 신화: 0.12 };
data.Pet = fs.readdirSync(path.join(RPG, 'itemImage', '펫')).filter(f => f.endsWith('.png')).map(f => {
    const base = f.replace(/\.png$/, '');
    const rarity = base.split(' ')[0];
    const name = base.slice(rarity.length + 1);
    const pet = { name, rarity, desc: '함께 모험을 떠나는 든든한 동료.', plusStat: { atk: PET_STAT[rarity] || 0.02, exp: 0.05 } };
    if (/^24/.test(name)) pet.set = '2024 베스티스';
    return pet;
});

// Market snapshots with anonymised nicknames.
const auction = backup('Auction');
const resolvable = entry => entry.kind != 'equipment' || (equipment[entry.payload.type] && equipment[entry.payload.type][entry.payload.id]);
auction.items = auction.items.filter(resolvable);
auction.items.forEach(entry => { entry.sellerName = fakeName(entry.sellerName); });
data.Auction = auction;
const buyOrder = backup('BuyOrder');
buyOrder.items.forEach(entry => { entry.buyerName = fakeName(entry.buyerName); });
data.BuyOrder = buyOrder;
const tradeLog = readJson(path.join(ROOT, 'tmp', 'TradeLog_backup_2026-08-27.json'));
(tradeLog.items || []).forEach(entry => { entry.seller = fakeName(entry.seller); entry.buyer = fakeName(entry.buyer); });
data.TradeLog = tradeLog.items || [];

const itemId = name => {
    const id = items.findIndex(item => item && item.name == name);
    if (id < 0) throw new Error('unknown item ' + name);
    return id;
};

// ---------- users ----------
const now = Date.now();
const DAY = 86400000;
const SHOWCASE = process.env.SHOWCASE_NAME || '지니어스';
const eqId = (type, name) => {
    const id = equipment[type].findIndex(e => e && e.name == name);
    if (id < 0) throw new Error('unknown equipment ' + type + ' ' + name);
    return id;
};
const petId = label => { const rarity = label.split(' ')[0]; const name = label.slice(rarity.length + 1); return data.Pet.findIndex(p => p.name == name && p.rarity == rarity); };
const legendaryPotential = lines => ({ rarity: '레전더리', option: lines.map(([grade, stat]) => Object.assign({ grade }, stat)), failCount: 0 });
const gear = (type, name, extra) => Object.assign({ type, id: eqId(type, name), level: 15 }, equipment[type][eqId(type, name)].rarity == '초월' ? { transcendStage: 3 } : {}, extra || {});
const expTable = readJson(path.join(RPG, 'ExpTable.json'));

const showcase = {
    id: 'showcase-1',
    name: SHOWCASE,
    code: 'PROMO2026',
    isAdmin: false,
    level: 287,
    exp: Math.floor(Number(expTable[286] || 0) * 0.68),
    main_card: { id: 3, star: 11, type: '전직', skin: '1억뷰' },
    prestige: true,
    jobPrestige: true,
    need_character_card_select: false,
    maxCardSlot: 6,
    card_slot: [
        { id: 10, star: 11, type: '전직', skin: '체리 바이트' },
        { id: 6, star: 11, type: '전직', skin: '킥백' },
        { id: 4, star: 10, type: '전직', skin: '피규어' },
        { id: 9, star: 10, type: '전직', skin: '아이돌' },
        { id: 0, star: 9, type: '전직', skin: '드레스' },
        { id: 2, star: 9, type: '전직' }
    ],
    equipments: {
        weapon: gear('weapon', '낮과 밤의 경계', { potential: legendaryPotential([['platinum', { plusStat: { atk: 0.12 } }], ['platinum', { plusStat: { finalDamage: 0.08 } }], ['gold', { plusStat: { critMul: 0.12 } }]]) }),
        hat: gear('hat', '마나번 햇', { potential: legendaryPotential([['gold', { plusStat: { atk: 0.09 } }], ['gold', { plusStat: { crit: 0.06 } }], ['silver', { stat: { atk: 40 } }]]) }),
        armor: gear('armor', '현자의 마나번 로브', { potential: legendaryPotential([['platinum', { plusStat: { hp: 0.12 } }], ['gold', { plusStat: { def: 0.09 } }], ['gold', { stat: { allElementAtk: 30 } }]]) }),
        pants: gear('pants', '마나번 트라우저', { potential: legendaryPotential([['gold', { plusStat: { atk: 0.09 } }], ['gold', { plusStat: { pnt: 0.06 } }], ['silver', { stat: { hp: 400 } }]]) }),
        shoes: gear('shoes', '마나번 슈즈', { potential: legendaryPotential([['gold', { plusStat: { critMul: 0.12 } }], ['silver', { plusStat: { atk: 0.06 } }], ['silver', { stat: { mp: 300 } }]]) }),
        accessory: {
            0: gear('accessory', '심판의 주사위', { level: 0 }),
            1: gear('accessory', '레인보우 프리즘', { level: 0 }),
            2: gear('accessory', '마나 증폭 장치', { level: 0 })
        },
        support: gear('support', '행운의 장갑', { level: 0, rolled: { stat: { atk: 0.94 }, plusStat: {} } }),
        pet: [
            { id: petId('신화 24FS 롤충에서탈출'), level: 5, expireAt: now + 23 * DAY, tradeCount: 0, shortcuts: {} },
            { id: petId('레전더리 잉여왕'), level: 4, expireAt: now + 17 * DAY, tradeCount: 0, shortcuts: {} },
            { id: petId('유니크 타부자고'), level: 3, expireAt: now + 12 * DAY, tradeCount: 0, shortcuts: {} }
        ]
    },
    inventory: { card: [], item: [], equipment: [], pet: [] },
    titles: ['newbieSlayer', 'allStar2024', 'dictatorBane', 'dictatorConqueror', 'hoduFriend', 'bloodPurifier', 'level200', 'enhanceMaster', 'enhanceGrandmaster', 'enhanceGod', 'sigmaBoy', 'omega3', 'burning', 'butaFirstClear', 'butaTribe'],
    equippedTitle: 'enhanceGod',
    blessings: { divine: now + 21 * DAY, rukim: now + 9 * DAY },
    gold: 3876540210,
    garnet: 128450,
    point: 24800,
    total_point: 186000,
    mileage: 5120,
    statPoint: 12,
    statPointStats: { atk: 180, hp: 90, mp: 40, def: 60, pnt: 50 },
    claimedLevelRewards: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 210, 220, 230, 240, 250, 260, 270, 280],
    avatarMigrated: true,
    mail: [],
    logged_in: ['showcase-1'],
    logged_in_agent: []
};
// Inventory: real card/item/equipment/pet assets in a lived-in mix.
[[9, '일반', 3], [9, '일반', 4], [9, '일반', 9], [11, '전직', 5], [11, '일반', 1], [10, '전직', 3], [10, '일반', 7], [9, '전직', 11], [9, '일반', 8], [8, '전직', 12], [8, '일반', 13], [7, '일반', 4], [7, '전직', 2], [6, '일반', 13], [6, '일반', 7], [5, '전직', 1], [5, '일반', 12], [4, '일반', 3], [3, '일반', 9], [3, '일반', 11], [2, '일반', 5]]
    .forEach(([star, type, id]) => showcase.inventory.card.push({ id, star, type }));
[['오메가 카드팩', 2], ['시그마 전직 카드팩', 3], ['제타 카드팩', 5], ['9성 카드팩', 12], ['초월 상자', 4], ['보주 상자', 6], ['유니크 장비 상자', 9],
 ['축복받은 장비 보호권', 7], ['고급 장비 보호권', 21], ['장비 보호권', 48], ['상급 강화석', 3120], ['강화석', 98450], ['초월 조각', 640], ['지니어스의 열쇠', 88],
 ['쥬얼', 245], ['화이트 쥬얼', 61], ['헬 초대장', 380], ['헬 도전장', 24], ['럭키카드100%', 3], ['럭키카드70%', 9], ['9성 보호 카드', 6], ['레전더리 잠재능력 주문서', 14],
 ['유니크 잠재능력 주문서', 32], ['오메가 캐릭터 변환석', 2], ['시그마 캐릭터 변환석', 5], ['전직 프레스티지 증표', 3], ['엘릭서', 150], ['고급 마나 포션', 420],
 ['8000000경험치비약', 6], ['골드 획득의 비약', 30], ['황금 주머니', 55], ['봉인된 자물쇠', 17], ['독재자의 영혼석', 9], ['2024올스타즈 알', 2], ['아리스 보주', 1], ['대탐정F 보주', 1]]
    .forEach(([name, count]) => showcase.inventory.item.push({ id: itemId(name), count }));
[['weapon', '감옥열쇠', 12], ['weapon', '콰트로 1악장', 9], ['armor', '피의 흐름', 11], ['hat', '천공의 모자', 10], ['shoes', '블라디미르', 13], ['pants', '구원자의 하의', 8],
 ['accessory', '777 목걸이', 0], ['accessory', '더 킹메이커', 0], ['support', '유생의 개지랄', 0], ['weapon', '운명의 아이온', 15], ['armor', '불멸하는 업화의 용갑', 14],
 ['accessory', '데우스 엑스 마키나', 0], ['support', '파이널리스트', 0], ['weapon', '여명의 아이온', 10], ['armor', '화룡의 비늘 갑주', 10]]
    .forEach(([type, name, level]) => showcase.inventory.equipment.push(gear(type, name, { level })));
['고유 24FS 롤충에서탈출', '레전더리 24BS 시그니를', '레전더리 24BS 코노모리', '유니크 24GM 브란도', '고유 대한독립만세', '레어 24GB 아르세우스']
    .forEach(label => { const id = petId(label); if (id >= 0 && !showcase.equipments.pet.some(p => p.id == id)) showcase.inventory.pet.push({ id, level: 1 }); });

const users = [showcase];
// Rivals: geared with the same real item pool at lower enhance levels so the ranking reads like a live server.
const RIVAL_SETS = [
    ['마나번 햇', '마나번 로브', '마나번 트라우저', '마나번 슈즈'], ['핏빛 모자', '피의 흐름', '흐르는 피', '블러디 슈즈'],
    ['잿불 모자', '잿불 갑옷', '잿불 하의', '잿불 신발'], ['심해의 모자', '심해의 갑옷', '심해의 하의', '심해의 신발'],
    ['천공의 모자', '천공의 갑옷', '천공의 하의', '천공의 신발'], ['최후통첩 모자', '최후통첩 아머', '최후통첩 트라우저', '최후통첩 슈즈']
];
const RIVAL_WEAPONS = ['초심권', '엘리멘탈 부스터', '과소평가', '불량 배터리'];
const RIVAL_ACCS = ['메가카운트 추첨기', '운명의 주사위', '해방의 열쇠', '777 목걸이', '모노레일 타이머', '킹메이커 목걸이', '유랄 반지', '예고편'];
FAKE_NAMES.slice(0, 24).forEach((name, i) => {
    const lv = Math.max(9, 15 - Math.floor(i / 3));
    const set = RIVAL_SETS[i % RIVAL_SETS.length];
    const stage = i < 6 ? 3 : i < 14 ? 2 : 1;
    const piece = (type, n, level) => Object.assign(gear(type, n, { level }), equipment[type][eqId(type, n)].rarity == '초월' ? { transcendStage: stage } : {});
    users.push({
        id: 'rival-' + i,
        name,
        code: 'RIVAL' + i,
        level: Math.max(120, 285 - i * 6 - (i % 3) * 3),
        exp: 0,
        main_card: { id: (i * 5 + 1) % 14, star: Math.max(7, 11 - Math.floor(i / 5)), type: i % 2 ? '전직' : '일반' },
        need_character_card_select: false,
        prestige: i < 12, jobPrestige: i < 8,
        maxCardSlot: 6,
        card_slot: Array.from({ length: i < 10 ? 6 : 4 }, (_, k) => ({ id: (i + k * 3) % 14, star: Math.max(8, 11 - Math.floor((i + k) / 6)), type: '전직' })),
        equipments: {
            weapon: piece('weapon', RIVAL_WEAPONS[i % RIVAL_WEAPONS.length], lv),
            hat: piece('hat', set[0], lv), armor: piece('armor', set[1], lv), pants: piece('pants', set[2], lv), shoes: piece('shoes', set[3], lv),
            accessory: { 0: piece('accessory', RIVAL_ACCS[i % RIVAL_ACCS.length], 0), 1: piece('accessory', RIVAL_ACCS[(i + 3) % RIVAL_ACCS.length], 0) },
            support: piece('support', ['777 장갑', '행운의 복주머니', 'DMC 마이크', '킹메이커 장갑'][i % 4], 0),
            pet: [{ id: (i * 7) % data.Pet.length, level: 3, expireAt: now + 20 * DAY, tradeCount: 0, shortcuts: {} }]
        },
        inventory: { card: [], item: [], equipment: [], pet: [] },
        titles: i % 3 == 0 ? ['enhanceMaster', 'level200'] : ['newbieSlayer'],
        equippedTitle: i < 3 ? 'enhanceGrandmaster' : (i % 3 == 0 ? 'enhanceMaster' : (i % 4 == 1 ? 'newbieSlayer' : null)),
        gold: 1000000 * (30 - i),
        garnet: 1000 * (30 - i),
        avatarMigrated: true,
        mail: []
    });
});

const seed = {
    rpgenius_data: Object.entries(data).map(([key, value]) => ({ key, data: value })),
    rpgenius_user: users,
    rpgenius_sid: [],
    rpgenius_mail: []
};
fs.writeFileSync(path.join(__dirname, 'seed.json'), JSON.stringify(seed));
console.log('seed.json written:', users.length, 'users,', Object.keys(data).length, 'data keys');
module.exports = { itemId };
