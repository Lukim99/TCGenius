// 거래, 상점, 메일 화면 실험실. 실제 public/ 클라이언트와 server.js의 대시보드 마크업을 가짜 API로 돌린다.
// 운영 DB와 게임 서버에 닿지 않는다. 게임 데이터 JSON은 이 저장소에서, 이미지는 git에 없으므로 MARKET_LAB_ASSETS(기본값: 원래 작업 폴더)에서 읽는다.
// 실행: node scripts/market-stage-lab/server.js  →  http://localhost:4174/?tab=shop | directtrade | mail
//   거래 상태 바로가기: &trade=active | incoming | outgoing | result     WebGL 끄기: &nogl=1
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'DB', 'RPGenius');
const ASSET_ROOT = path.resolve(process.env.MARKET_LAB_ASSETS || path.join(ROOT, '..', 'tcgenius'));
const ASSET_DATA = path.join(ASSET_ROOT, 'DB', 'RPGenius');
const ITEM_IMAGE = path.join(ASSET_DATA, 'itemImage');
const PORT = Number(process.env.PORT || 4174);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.mp4': 'video/mp4', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8' };
// 카드 합성기는 자기 폴더 기준으로 카드 그림을 찾으므로 그림이 있는 쪽의 사본을 쓴다.
const cardComposite = require(path.join(ASSET_ROOT, 'card_composite.js'));
const readData = name => JSON.parse(fs.readFileSync(path.join(DATA, name + '.json'), 'utf8'));
const ITEMS = readData('Item'), EQUIP = readData('Equipment'), CARDS = readData('CharacterCards'), SHOP = readData('Shop'), PETS = readData('Pet'), BUNDLES = readData('Bundle');
const comma = n => Number(n || 0).toLocaleString('ko-KR');

// ---- server.js와 같은 규칙의 표시 도우미 ----
const itemImageUrl = (dir, file) => fs.existsSync(path.join(ITEM_IMAGE, dir, file)) ? '/item-image?dir=' + encodeURIComponent(dir) + '&file=' + encodeURIComponent(file) : null;
const frameUrl = (kind, rarity) => kind === 'item' ? itemImageUrl('프레임', '아이템.png') : itemImageUrl('프레임', '[장비]' + String(rarity || '') + '.png');
const CURR = { gold: itemImageUrl('화폐', '골드.png'), garnet: itemImageUrl('화폐', '가넷.png'), point: itemImageUrl('화폐', '포인트.png') };
function itemAssets(item) {
    if (!item || !item.name) return { frameUrl: frameUrl('item'), iconUrl: null };
    const box = String(item.name).match(/^(.+)\s장비\s상자$/);
    if (box) return { frameUrl: frameUrl('equipment', box[1]), iconUrl: itemImageUrl('가챠', '개봉 후 장비 상자.png') };
    const dir = item.use === '보주' ? '보주' : item.use === '스펙터' ? '스펙터' : String(item.type);
    return { frameUrl: item.type === '미끼' ? itemImageUrl('프레임', '미끼.png') : frameUrl('item'), iconUrl: itemImageUrl(dir, item.name + '.png') };
}
const formatStar = star => { const n = Number(star || 0) + 1; return n === 10 ? '𝛧' : n === 11 ? '𝛴' : n === 12 ? '𝛀' : n + '성'; };
// rpgenius.js formatUserCard와 같은 순서: [성급] 종류 스킨 이름
const formatUserCard = card => '[' + formatStar(card.star) + '] ' + (card.type && card.type !== '일반' ? card.type + ' ' : '') + (card.skin ? card.skin + ' ' : '') + CARDS[card.id].name;
function cardImageUrl(card) {
    const spec = { name: CARDS[card.id].name, star: Number(card.star || 0), type: card.type || '일반', skin: card.skin || '' };
    if (!cardComposite.canCompose(spec)) return null;
    return '/card-image?name=' + encodeURIComponent(spec.name) + '&star=' + spec.star + '&type=' + encodeURIComponent(spec.type) + (spec.skin ? '&skin=' + encodeURIComponent(spec.skin) : '');
}
function serializeCard(card) {
    const data = CARDS[card.id];
    return {
        id: card.id, star: card.star, starText: formatStar(card.star), type: card.type || '일반', skin: card.skin || '', name: data.name,
        formatted: formatUserCard(card), imageUrl: cardImageUrl(card), skills: [], classInfo: null, awakening: null, slotEffect: null,
        specter: card.specter ? { name: card.specter, skill: null } : null
    };
}
const EQUIP_LABELS = { weapon: '무기', hat: '모자', armor: '갑옷', pants: '하의', shoes: '신발', accessory: '장신구', support: '보조', artifact: '아티팩트' };
// 능력치 줄: 실제 서버(formatEquipmentStatLines)와 같은 한글 라벨을 rpgenius.js의 표에서 읽어 쓴다(코드를 실행하지 않고 'key: 라벨' 쌍만 읽음).
const STAT_LABELS = (() => {
    const source = fs.readFileSync(path.join(ROOT, 'rpgenius.js'), 'utf8'), read = name => {
        const start = source.indexOf('const ' + name + ' = {'); if (start < 0) return {};
        const body = source.slice(start, source.indexOf('};', start)), out = {};
        for (const m of body.matchAll(/(\w+)\s*:\s*'([^']+)'/g)) out[m[1]] = m[2];
        return out;
    };
    return { stat: read('EQUIP_STAT_LABELS'), plus: read('EQUIP_PLUSSTAT_LABELS') };
})();
const statLines = data => [
    ...Object.entries(data.stat || {}).map(([key, value]) => (STAT_LABELS.stat[key] || key) + ' +' + comma(value)),
    ...Object.entries(data.plusStat || {}).map(([key, value]) => (STAT_LABELS.plus[key] || STAT_LABELS.stat[key] || key) + (Number(value) < 0 ? ' ' : ' +') + Math.round(Number(value) * 1000) / 10 + '%')
];
function serializeEquipment(equip, number) {
    const data = EQUIP[equip.type][equip.id];
    return {
        type: equip.type, typeLabel: EQUIP_LABELS[equip.type], id: equip.id, number, source: 'inventory', index: number - 1, name: data.name, baseName: data.name,
        locked: false, rarity: data.rarity, baseRarity: data.rarity, artifact: null, transcendStage: data.rarity === '초월' ? 1 : null, setName: data.set || null,
        level: equip.level || 0, equipped: false, statLines: statLines(data), description: data.desc || '',
        passive: data.passive_id != null || number % 3 === 1 ? { name: '업화의 의지', desc: '공격 시 10% 확률로 10초간 공격력 +12%.\n쿨타임 30초.', cooltime: 30 } : null, potentialLines: [],
        potentialDisplay: equip.potential ? { tierKey: 'unique', tierLabel: equip.potential, entries: [{ gradeLabel: '유니크', text: '공격력 +9%' }, { gradeLabel: '에픽', text: '치명타 확률 +6%' }, { gradeLabel: '에픽', text: '최대 HP +4%' }] } : null, potential: null, canPotential: true,
        soul: number % 4 === 2 ? { name: '불꽃 영혼', expiredAt: Date.now() + 86400000 } : null,
        artifact: equip.type === 'artifact' ? { rarity: data.rarity, options: [{ conditionPrefix: '메인 카드가 ', conditionValue: '오버라이드', conditionSuffix: '일 때', abilityLabel: '공격력', n: 12, active: true }, { conditionPrefix: 'HP가 ', conditionValue: '50%', conditionSuffix: ' 이하일 때', abilityLabel: '받는 피해 감소', n: 8, active: false }, { conditionPrefix: '', conditionValue: '보스', conditionSuffix: '와 전투 중', abilityLabel: '치명타 피해', n: 15, active: true }], rerollsUsed: 1, maxRerolls: 3 } : null,
        noTrade: data.no_trade === true, bound: false, uid: 'lab-' + number, iconUrl: itemImageUrl('장비', data.rarity + ' ' + data.name + '.png'), frameUrl: frameUrl('equipment', data.rarity)
    };
}
function bundleContents(item) {
    const bundle = BUNDLES[item.pack];
    if (!Array.isArray(bundle)) return null;
    return bundle.map(entry => {
        const count = entry.count && typeof entry.count === 'object' ? (entry.count.min === entry.count.max ? String(entry.count.min) : entry.count.min + '~' + entry.count.max) : String(entry.count ?? 1);
        if (entry.type === '아이템') { const data = ITEMS[entry.item_id]; return data ? { type: '아이템', name: data.name, count, ...itemAssets(data) } : null; }
        if (entry.type === '골드' || entry.type === '가넷') return { type: entry.type, name: entry.type, count, imgUrl: CURR[entry.type === '골드' ? 'gold' : 'garnet'] };
        if (entry.type === '캐릭터카드') {
            const id = Number(entry.card_id ?? entry.id ?? -1), data = CARDS[id], cardType = entry.card_type || '일반';
            const star = entry.star && typeof entry.star === 'object' ? Number(entry.star.min || 1) - 1 : Number(entry.star || 0);
            const starText = entry.star && typeof entry.star === 'object' && entry.star.min !== entry.star.max ? entry.star.min + '~' + entry.star.max + '성' : (star + 1) + '성';
            if (!data) return { type: '캐릭터카드', cardType, name: starText + ' ' + (cardType === '일반' ? '' : cardType + ' ') + '랜덤 캐릭터 카드', count, label: '🃏' };
            return { type: '캐릭터카드', cardType, name: (cardType !== '일반' ? '[' + cardType + '] ' : '') + data.name + ' ' + starText, count, iconUrl: cardImageUrl({ id, star, type: cardType }), frameUrl: null };
        }
        return { type: entry.type, name: entry.type, count, label: '?' };
    }).filter(Boolean);
}
function shopDisplay(shopItem) {
    if (shopItem.type === '아티팩트') { const data = EQUIP.artifact[shopItem.artifact_id]; return { name: '[' + data.rarity + ']아티팩트', iconUrl: itemImageUrl('장비', data.rarity + ' ' + data.name + '.png'), frameUrl: frameUrl('equipment', data.rarity) }; }
    if (shopItem.type === '아이템') {
        const data = ITEMS[shopItem.item_id];
        if (!data) return { name: '알 수 없음', iconUrl: null, frameUrl: null };
        return { name: data.name + (shopItem.count > 1 ? ' x' + shopItem.count : ''), itemType: data.type || null, ...itemAssets(data), bundleContents: data.type === '번들' ? bundleContents(data) : null, choiceOptions: null };
    }
    if (shopItem.type === '아바타') {
        const name = String(shopItem.fashion || '').trim();
        return { name: name + ' 아바타', iconUrl: itemImageUrl('아바타', name + ' 아바타.png'), frameUrl: frameUrl('equipment', '일반'), isAvatar: true };
    }
    if (shopItem.type === '가넷') return { name: '가넷 ' + shopItem.count + '개', iconUrl: CURR.garnet, frameUrl: null, isCurrency: true };
    if (shopItem.type === '골드') return { name: '골드 ' + shopItem.count, iconUrl: CURR.gold, frameUrl: null, isCurrency: true };
    return { name: shopItem.type, iconUrl: null, frameUrl: null };
}

// ---- 가짜 계정 ----
const me = {
    name: '실험실', level: 187, gold: 48250000, garnet: 12840, point: 5600, mileage: 930, tickets: 3,
    cards: [
        { id: 3, star: 8, type: '전직' }, { id: 3, star: 8, type: '일반' }, { id: 3, star: 5, type: '일반', skin: '백만뷰' }, { id: 11, star: 10, type: '전직' },
        { id: 11, star: 6, type: '일반' }, { id: 0, star: 4, type: '일반' }, { id: 4, star: 9, type: '각성' }, { id: 7, star: 7, type: '전직' }, { id: 7, star: 2, type: '일반' },
        { id: 12, star: 11, type: '전직', specter: '불사조' }, { id: 15, star: 6, type: '전직' }, { id: 16, star: 8, type: '일반' }, { id: 1, star: 0, type: '일반' }, { id: 9, star: 5, type: '전직' }
    ],
    equipment: [],
    items: new Map(),
    pets: [], avatars: [], mails: []
};
const main = { id: 11, star: 10, type: '전직' };
const partner = { name: '달빛상인', level: 203, main: { id: 3, star: 8, type: '전직' } };
(() => {
    const pick = (type, count, levels) => EQUIP[type].map((data, id) => ({ data, id })).filter(entry => entry.data && itemImageUrl('장비', entry.data.rarity + ' ' + entry.data.name + '.png'))
        .filter((entry, index, list) => index % Math.max(1, Math.floor(list.length / count)) === 0).slice(0, count).forEach((entry, index) => me.equipment.push({ type, id: entry.id, level: levels[index % levels.length], potential: index % 3 === 0 ? '유니크' : null }));
    pick('weapon', 5, [0, 7, 12, 3, 9]); pick('armor', 3, [5, 0, 10]); pick('accessory', 4, [0, 4, 8, 2]); pick('support', 2, [6, 0]); pick('hat', 2, [3, 0]); pick('artifact', 1, [0]);
    let seen = 0;
    ITEMS.forEach((data, id) => { if (data && itemAssets(data).iconUrl && id % 9 === 2 && seen++ < 34) me.items.set(id, [1, 3, 12, 250, 4096, 77][seen % 6]); });
    const ticket = ITEMS.findIndex(item => item && item.name === '거래권'); if (ticket >= 0) me.items.set(ticket, me.tickets);
    PETS.forEach((data, id) => { if (data && me.pets.length < 4 && itemImageUrl('펫', data.rarity + ' ' + data.name + '.png')) me.pets.push({ id, level: me.pets.length * 2 }); });
    fs.readdirSync(path.join(ITEM_IMAGE, '아바타')).slice(0, 5).forEach((file, index) => me.avatars.push({ id: 'av' + index, name: file.replace(/ 아바타\.png$/, ''), grade: index === 1 ? '한정' : index === 3 ? '프레스티지' : '일반' }));
})();
const inventoryCards = () => me.cards.map((card, index) => ({ ...serializeCard(card), number: index + 1, version: 'c1', salePrice: 1000 }));
const inventoryEquipment = () => me.equipment.map((equip, index) => ({ ...serializeEquipment(equip, index + 1), version: 'e1' }));
const inventoryItems = () => [...me.items].filter(([, count]) => count > 0).map(([id, count]) => ({ id, name: ITEMS[id].name, type: ITEMS[id].type, desc: ITEMS[id].desc || '', count, version: 'i1', noTrade: ITEMS[id].no_trade === true, ...itemAssets(ITEMS[id]) }));

// ---- 팝니다, 삽니다 ----
const market = require('./market-mock')({ me, CARDS, ITEMS, EQUIP, PETS, serializeCard, serializeEquipment, itemAssets, itemImageUrl, frameUrl, formatUserCard, cardImageUrl });

// ---- 상점 ----
const shopBought = new Map();
function shopData() {
    const order = ['일반', '가넷', '포인트', '아바타', '마일리지', '패키지', '출석', '초월'], keys = Object.keys(SHOP);
    const tabs = [...order.filter(key => keys.includes(key)), ...keys.filter(key => !order.includes(key))], shop = {};
    for (const tab of tabs) shop[tab] = SHOP[tab].map((item, index) => {
        const limits = item.limits || {}, used = shopBought.get(item.shopId) || 0, rec = {}, remaining = {};
        for (const key of ['max', 'daily', 'weekly', 'monthly']) if (typeof limits[key] === 'number') { rec[key] = used; remaining[key] = Math.max(0, limits[key] - used); }
        if (typeof limits.global === 'number') remaining.global = Math.max(0, limits.global - used - 3);
        const priceItem = item.price.goods === 'item' ? ITEMS[item.price.item_id] : null;
        return {
            index, shopId: item.shopId, materialTab: item.materialTab || null, type: item.type, fashion: item.type === '아바타' ? item.fashion : undefined, count: item.count, display: shopDisplay(item),
            price: priceItem ? { goods: 'item', amount: item.price.amount, name: priceItem.name, iconUrl: itemAssets(priceItem).iconUrl } : { goods: item.price.goods, amount: item.price.amount, imgUrl: CURR[item.price.goods] || null },
            priceItemCount: priceItem ? 40 : null, soldOut: Object.values(remaining).some(value => value <= 0), owned: false,
            limitInfo: Object.keys(limits).length ? { limits, rec, globalCount: used + 3, remaining } : null
        };
    });
    return { tabs: ['암시장', ...tabs.filter(tab => tab !== '핫딜샵' && tab !== '암시장')], shop, currencies: { gold: me.gold, garnet: me.garnet, point: me.point, mileage: me.mileage } };
}
function shopBuy(body) {
    const item = (SHOP[body.shopType] || []).find(entry => entry.shopId === body.shopId), count = Math.max(1, Number(body.count) || 1);
    if (!item) return [400, { error: '상점 정보를 새로고침한 뒤 구매해주세요.' }];
    if (item.price.goods !== 'item') { const cost = item.price.amount * count; if (me[item.price.goods] < cost) return [400, { error: '재화가 부족합니다.' }]; me[item.price.goods] -= cost; }
    shopBought.set(item.shopId, (shopBought.get(item.shopId) || 0) + count);
    const data = item.type === '아이템' ? ITEMS[item.item_id] : null, contents = data && data.type === '번들' ? bundleContents(data) : null;
    return [200, { ok: true, currencies: { gold: me.gold, garnet: me.garnet, point: me.point, mileage: me.mileage }, grantedCards: [], choicePouch: null,
        bundleGranted: contents ? contents.map(entry => ({ type: entry.type, name: entry.name, count: Number(String(entry.count).split('~')[0]) * count, iconUrl: entry.iconUrl || entry.imgUrl || null, frameUrl: entry.frameUrl || null })) : null }];
}

// ---- 1:1 거래 ----
const trade = { status: 'idle', session: null, request: null, result: null, timers: [] };
const emptyOffer = () => ({ gold: 0, garnet: 0, cards: [], equipments: [], items: {} });
const FEE = 0.05;
function offerView(offer) {
    const fees = { gold: Math.round(offer.gold * FEE), garnet: Math.round(offer.garnet * FEE) };
    return {
        gold: offer.gold, garnet: offer.garnet, fees, net: { gold: offer.gold - fees.gold, garnet: offer.garnet - fees.garnet },
        ticketCost: offer.cards.filter(card => card.star >= 4).length,
        cards: offer.cards.map(serializeCard), equipment: offer.equipments.map((equip, index) => serializeEquipment(equip, index + 1)),
        items: Object.entries(offer.items).filter(([, count]) => count > 0).map(([id, count]) => ({ id: Number(id), count, name: ITEMS[id].name, ...itemAssets(ITEMS[id]) }))
    };
}
function tradeState() {
    const player = (entry, card) => ({ name: entry.name, level: entry.level, mainCard: serializeCard(card) });
    const ticket = ITEMS.find(item => item && item.name === '거래권');
    const state = {
        status: trade.status, session: null, request: trade.request, result: null, me: player(me, main), partner: trade.status === 'idle' && !trade.result ? null : player(partner, partner.main),
        serverNow: Date.now(), feeRate: FEE, ticketIconUrl: ticket ? itemAssets(ticket).iconUrl : null, cardSpace: 30, balances: { gold: me.gold, garnet: me.garnet, tickets: me.tickets }
    };
    if (trade.session) state.session = { ...trade.session, offer: offerView(trade.session.offer), partnerOffer: offerView(trade.session.partnerOffer) };
    if (trade.result) state.result = { ...trade.result, receivedOffer: trade.result.receivedOffer ? offerView(trade.result.receivedOffer) : null };
    return state;
}
const later = (ms, task) => trade.timers.push(setTimeout(task, ms));
function bump() { const s = trade.session; s.revision++; s.confirmed = false; s.partnerConfirmed = false; }
function startSession(prefill) {
    trade.timers.forEach(clearTimeout); trade.timers = [];
    trade.status = 'active'; trade.request = null; trade.result = null;
    trade.session = { id: 'lab-' + Date.now(), revision: 0, partnerName: partner.name, confirmed: false, partnerConfirmed: false, processing: false, offer: emptyOffer(), partnerOffer: emptyOffer() };
    const theirs = trade.session.partnerOffer;
    const steps = [() => theirs.cards.push({ id: 4, star: 9, type: '각성' }), () => { theirs.gold = 3000000; }, () => theirs.cards.push({ id: 7, star: 7, type: '전직', skin: '' }),
        () => theirs.equipments.push({ type: 'weapon', id: me.equipment[2].id, level: 11 }), () => { const id = [...me.items.keys()][5]; theirs.items[id] = 30; }];
    if (prefill) { steps.forEach(step => step()); trade.session.offer.cards.push(me.cards[1]); trade.session.offer.gold = 500000; trade.session.revision = 6; }
    else steps.forEach((step, index) => later(2500 + index * 3500, () => { if (trade.session) { step(); bump(); } }));
}
function finishTrade(status) {
    trade.timers.forEach(clearTimeout); trade.timers = [];
    const received = status === 'completed' ? trade.session.partnerOffer : null;
    trade.result = { id: 'r' + Date.now(), status, message: status === 'completed' ? partner.name + '님과의 거래가 완료되었습니다.' : '거래가 취소되었습니다.', receivedOffer: received };
    trade.session = null; trade.status = 'idle';
}
function tradeAction(action, body) {
    const session = trade.session, stale = () => !session || body.sessionId !== session.id || body.revision !== session.revision;
    if (action === 'request') {
        if (!body.name) return [400, { error: '상대방 닉네임을 입력해주세요.' }];
        if (body.name === '없는사람') return [404, { error: '해당 닉네임의 유저를 찾을 수 없습니다.' }];
        partner.name = body.name; trade.status = 'outgoing'; trade.result = null; trade.request = { id: 'q' + Date.now(), partnerName: body.name, expiresAt: Date.now() + 300000 };
        later(4000, () => { if (trade.status === 'outgoing') startSession(false); });
    } else if (action === 'request-cancel') { trade.timers.forEach(clearTimeout); trade.status = 'idle'; trade.request = null; }
    else if (action === 'accept') startSession(false);
    else if (stale()) return [409, { error: '현재 거래 내역을 다시 확인해주세요.' }];
    else if (action === 'register') {
        const offer = session.offer;
        if (body.kind === 'gold' || body.kind === 'garnet') { if (!(body.amount > 0) || body.amount > me[body.kind]) return [409, { error: '보유 재화가 부족합니다.' }]; me[body.kind] -= body.amount; offer[body.kind] += body.amount; }
        else if (body.kind === 'card') { const card = me.cards.splice(body.number - 1, 1)[0]; if (!card) return [409, { error: '보유 목록이 변경되었습니다. 다시 선택해주세요.' }]; offer.cards.push(card); }
        else if (body.kind === 'equipment') { const equip = me.equipment.splice(body.number - 1, 1)[0]; if (!equip) return [409, { error: '보유 목록이 변경되었습니다. 다시 선택해주세요.' }]; offer.equipments.push(equip); }
        else if (body.kind === 'item') { const have = me.items.get(body.itemId) || 0; if (!(body.count > 0) || body.count > have) return [400, { error: '등록할 아이템과 수량을 확인해주세요.' }]; me.items.set(body.itemId, have - body.count); offer.items[body.itemId] = (offer.items[body.itemId] || 0) + body.count; }
        else return [400, { error: '등록할 품목을 선택해주세요.' }];
        bump();
    } else if (action === 'confirm') { session.confirmed = true; if (session.partnerConfirmed) finishTrade('completed'); else later(3500, () => { if (trade.session && trade.session.confirmed) finishTrade('completed'); }); }
    else if (action === 'unconfirm') session.confirmed = false;
    else if (action === 'cancel') {
        const offer = session.offer; me.gold += offer.gold; me.garnet += offer.garnet; me.cards.push(...offer.cards); me.equipment.push(...offer.equipments);
        for (const [id, count] of Object.entries(offer.items)) me.items.set(Number(id), (me.items.get(Number(id)) || 0) + count);
        finishTrade('cancelled');
    } else return [404, { error: '알 수 없는 요청' }];
    return [200, { ok: true, state: tradeState(), profile: profile() }];
}
function presetTrade(kind) {
    if (kind === 'active') startSession(true);
    else if (kind === 'incoming') { trade.status = 'incoming'; trade.request = { id: 'q1', partnerName: partner.name, expiresAt: Date.now() + 240000 }; }
    else if (kind === 'outgoing') { trade.status = 'outgoing'; trade.request = { id: 'q1', partnerName: partner.name, expiresAt: Date.now() + 240000 }; }
    else if (kind === 'result') { startSession(true); finishTrade('completed'); }
    else if (kind === 'idle') { trade.timers.forEach(clearTimeout); trade.status = 'idle'; trade.session = trade.request = trade.result = null; }
}

// ---- 메일 ----
const mailGift = gift => {
    if (gift.type === 'equipment') { const view = serializeEquipment(gift.equip, 1); return { type: 'equipment', equipType: gift.equip.type, equipId: gift.equip.id, rarity: view.rarity, level: view.level, name: view.name, label: view.name + (view.level > 0 ? ' +' + view.level : ''), iconUrl: view.iconUrl, frameUrl: view.frameUrl, detail: view }; }
    if (gift.type === 'gold' || gift.type === 'garnet') return { type: gift.type, amount: gift.amount, name: gift.type === 'gold' ? '골드' : '가넷', label: comma(gift.amount) + (gift.type === 'gold' ? ' 골드' : ' 가넷'), iconUrl: CURR[gift.type] };
    if (gift.type === 'point') return { type: 'point', amount: gift.amount, name: '포인트', label: comma(gift.amount) + 'P', iconUrl: CURR.point };
    if (gift.type === 'item') { const data = ITEMS[gift.id]; return { type: 'item', id: gift.id, count: gift.count, name: data.name, label: data.name + ' x' + comma(gift.count), ...itemAssets(data) }; }
    if (gift.type === 'equipment') { const view = serializeEquipment(gift.equip, 1); return { type: 'equipment', equipType: gift.equip.type, equipId: gift.equip.id, rarity: view.rarity, level: view.level, name: view.name, label: view.name + (view.level > 0 ? ' +' + view.level : ''), iconUrl: view.iconUrl, frameUrl: view.frameUrl }; }
    if (gift.type === 'pet') { const data = PETS[gift.pet.id]; return { type: 'pet', petId: gift.pet.id, level: gift.pet.level, name: data.name, label: data.name + (gift.pet.level > 0 ? ' +' + gift.pet.level : ''), iconUrl: itemImageUrl('펫', data.rarity + ' ' + data.name + '.png'), frameUrl: frameUrl('equipment', data.rarity) }; }
    if (gift.type === 'card') { const label = formatUserCard(gift.card); return { type: 'card', cardId: gift.card.id, star: gift.card.star, cardType: gift.card.type || '일반', name: label, label, iconUrl: cardImageUrl(gift.card) }; }
    if (gift.type === 'avatar') return { type: 'avatar', avatarName: gift.name, grade: '일반', name: gift.name + ' 아바타', label: '🧥 ' + gift.name + ' 아바타', iconUrl: itemImageUrl('아바타', gift.name + ' 아바타.png'), frameUrl: frameUrl('equipment', '일반') };
    return null;
};
(() => {
    const now = Date.now(), ids = [...me.items.keys()], H = 3600000;
    const add = (from, subject, body, gifts, ago, flags = {}) => me.mails.push({ id: 'm' + me.mails.length, from, gm: !!flags.gm, subject, body, createdAt: now - ago, read: !!flags.read, claimed: gifts.length ? !!flags.claimed : true, gifts });
    add('GM', '11월 정기 점검 보상', '점검에 협조해 주셔서 감사합니다.\n보상을 수령해 주세요.', [{ type: 'garnet', amount: 500 }, { type: 'item', id: ids[3], count: 10 }, { type: 'item', id: ids[8], count: 3 }], 12 * 60000, { gm: true });
    add('암시장', '낙찰을 축하합니다', '어제 암시장에서 낙찰받은 물품입니다.', [{ type: 'card', card: { id: 3, star: 8, type: '전직' } }], 5 * H);
    add('달빛상인', '지난번 거래 고마웠어요', '덕분에 무기 강화 끝냈습니다. 작은 답례입니다.\n다음에도 잘 부탁드려요.', [{ type: 'gold', amount: 1500000 }, { type: 'equipment', equip: { type: 'weapon', id: me.equipment[1].id, level: 7 } }], 9 * H);
    add('부타', '안녕', '레이드 같이 갈 사람 구함. 오늘 밤 10시.', [], 26 * H, { read: true });
    add('GM', '출석 이벤트 안내', '이번 주 출석 보상이 두 배로 지급됩니다.', [{ type: 'point', amount: 300 }], 30 * H, { gm: true, read: true, claimed: true });
    add('이익태', '펫 맡겨둡니다', '잠깐 맡아주세요.', [{ type: 'pet', pet: { id: me.pets[0].id, level: 4 } }, { type: 'avatar', name: me.avatars[0].name }], 50 * H, { read: true });
    add('시스템', '경매 판매 대금', '등록하신 물품이 판매되었습니다.', [{ type: 'gold', amount: 23750000 }], 72 * H, { read: true, claimed: true });
    for (let i = 0; i < 16; i++) add('시스템', '일일 보상 ' + (i + 1) + '일차', '오늘의 접속 보상입니다.', [{ type: 'item', id: ids[(i * 3) % ids.length], count: i + 1 }], (80 + i * 24) * H, { read: i > 1, claimed: i > 3 });
})();
function mailbox(page) {
    const size = 20, total = me.mails.length, totalPages = Math.max(1, Math.ceil(total / size)); page = Math.min(totalPages, Math.max(1, Number(page) || 1));
    const mails = me.mails.slice((page - 1) * size, page * size).map(mail => ({ ...mail, hasGifts: mail.gifts.length > 0, gifts: mail.gifts.map(mailGift).filter(Boolean) }));
    return { mails, unread: me.mails.filter(mail => !mail.read).length, page, totalPages, total };
}
function giftable() {
    return {
        gold: me.gold, garnet: me.garnet, point: me.point, goldIconUrl: CURR.gold, garnetIconUrl: CURR.garnet, pointIconUrl: CURR.point, feeRate: 0.05, feeMin: 1, maxGifts: 5,
        equipment: inventoryEquipment().map(entry => ({ detail: entry, number: entry.number, name: entry.name, rarity: entry.rarity, level: entry.level, iconUrl: entry.iconUrl, frameUrl: entry.frameUrl })),
        pets: me.pets.map((pet, index) => ({ index, name: PETS[pet.id].name, rarity: PETS[pet.id].rarity, level: pet.level, statLines: ['HP +' + (100 + pet.level * 20), '공격력 +' + (10 + pet.level * 3), '낚시 속도 +5%'], iconUrl: itemImageUrl('펫', PETS[pet.id].rarity + ' ' + PETS[pet.id].name + '.png'), frameUrl: frameUrl('equipment', PETS[pet.id].rarity) })),
        items: inventoryItems().filter(item => !item.noTrade).map(item => ({ id: item.id, name: item.name, count: item.count, iconUrl: item.iconUrl, frameUrl: item.frameUrl })),
        avatars: me.avatars.map(entry => ({ ...entry, iconUrl: itemImageUrl('아바타', entry.name + ' 아바타.png'), frameUrl: frameUrl('equipment', entry.grade === '한정' ? '초월' : entry.grade === '프레스티지' ? '레전더리' : '일반'), imageUrl: null }))
    };
}

// ---- 프리셋 (/api/presets): 실제 서버 buildPresetPayload와 같은 모양. 장비는 uid('lab-번호')로, 카드는 표시 이름으로 맞춘다 ----
const presetLab = (() => {
    const of = type => me.equipment.map((equip, index) => ({ equip, index })).filter(entry => entry.equip.type === type).map(entry => entry.index);
    const [w, h, a, acc, sup, art] = ['weapon', 'hat', 'armor', 'accessory', 'support', 'artifact'].map(of);
    const gear = (list, accessories) => list.filter(i => i != null).map(i => ({ index: i })).concat(accessories.map((i, k) => ({ index: i, slotKey: String(k) })));
    const current = { main: { id: 11, star: 10, type: '전직' }, slots: [me.cards[0], me.cards[3], me.cards[6]], gear: gear([w[1], h[0], a[0], sup[0], art[0]], acc.slice(0, 3)) };
    const presets = Array.from({ length: 20 }, () => null);
    presets[0] = { name: '사냥용', savedAt: Date.now() - 3 * 3600e3, ...JSON.parse(JSON.stringify(current)) };
    presets[1] = { name: '보스전', savedAt: Date.now() - 26 * 3600e3, main: { id: 12, star: 11, type: '전직', specter: '불사조' }, slots: [me.cards[0], me.cards[7], me.cards[10], me.cards[11], me.cards[13]], gear: gear([w[2], a[2], sup[1], art[0]], [acc[1], acc[3]]), missing: 1 };
    return { current, presets, unlocked: 3 };
})();
function presetPayload() {
    const L = presetLab, cost = i => i ? { currency: 'garnet', amount: [0, 100, 100, 300, 500][i] ?? 500, label: comma([0, 100, 100, 300, 500][i] ?? 500) + ' 가넷', iconUrl: CURR.garnet } : null;
    const view = s => s && {
        mainCard: s.main ? serializeCard(s.main) : null, slotCards: s.slots.map(serializeCard),
        equipment: s.gear.map(g => ({ ...serializeEquipment(me.equipment[g.index], g.index + 1), equipped: false, slotKey: g.slotKey ?? null }))
    };
    const current = view(L.current); current.equipment.forEach(e => { e.equipped = true; });
    return { ok: true, slotCount: 20, unlocked: L.unlocked, costs: Array.from({ length: 20 }, (_, i) => cost(i)), garnet: me.garnet, point: me.point, accessorySlots: 3, cardSlots: 5, current,
        presets: L.presets.map(p => p && { name: p.name, savedAt: p.savedAt, missing: p.missing || 0, ...view(p) }) };
}
function presetAction(action, body) {
    const L = presetLab, slot = Number(body.slot);
    if (!Number.isInteger(slot) || slot < 0 || slot >= 20) return [400, { error: '사용할 수 없는 프리셋 슬롯입니다.' }];
    if (action === 'unlock') {
        if (slot !== L.unlocked) return [400, { error: '슬롯은 순서대로 해금할 수 있습니다.' }];
        const amount = [0, 100, 100, 300, 500][slot] ?? 500; if (me.garnet < amount) return [400, { error: '가넷이 부족합니다.' }];
        me.garnet -= amount; L.unlocked++; return [200, presetPayload()];
    }
    if (slot >= L.unlocked) return [400, { error: '사용할 수 없는 프리셋 슬롯입니다.' }];
    if (action === 'save') { L.presets[slot] = { name: L.presets[slot]?.name || null, savedAt: Date.now(), ...JSON.parse(JSON.stringify(L.current)) }; return [200, presetPayload()]; }
    if (action === 'rename') { if (!L.presets[slot]) return [400, { error: '저장된 프리셋이 없습니다.' }]; L.presets[slot].name = String(body.name || '').trim().slice(0, 12) || null; return [200, presetPayload()]; }
    if (action === 'apply') {
        const p = L.presets[slot]; if (!p) return [400, { error: '저장된 프리셋이 없습니다.' }];
        L.current = { main: p.main ? JSON.parse(JSON.stringify(p.main)) : L.current.main, slots: JSON.parse(JSON.stringify(p.slots)), gear: JSON.parse(JSON.stringify(p.gear)) };
        return [200, { ...presetPayload(), warnings: p.missing ? ['장신구 장비를 찾을 수 없어 건너뛰었습니다.'] : [], profile: profile() }];
    }
    return [404, { error: '실험실에 없는 API: ' + action }];
}

function profile() {
    return {
        user: { name: me.name, level: me.level, exp: 4200, maxExp: 9000, point: me.point, gold: me.gold, garnet: me.garnet, mileage: me.mileage, title: null, canPartyQuest: false, isAdmin: false, maxAccessory: 3 },
        combatPower: { total: 1284500 }, mainCard: serializeCard(main), cardSlots: [], statGroups: [], statPoint: null, blessings: [], equippedPets: [], equippedEquipment: [], currencyIcons: CURR
    };
}

// ---- 대시보드 마크업: server.js의 renderUserDashboard 본문을 그대로 가져와 가짜 도우미로 평가한다 ----
// 평가하는 문자열은 이 저장소의 server.js뿐이다. 요청 값은 섞지 않는다.
function dashboardHtml(query) {
    const source = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    const start = source.indexOf('function renderUserDashboard('), end = source.indexOf('\nfunction renderHFieldApp', start);
    const render = new Function('getItemImageUrl', 'getAuctionFrameUrl', 'SHOP_CURR_IMG', 'escapeHtml', source.slice(start, end) + '\nreturn renderUserDashboard;')(
        (dir, file) => itemImageUrl(dir, file), frameUrl, CURR, text => String(text).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])));
    let html = render({ name: me.name, admin: false, canPartyQuest: false }, {});
    if (query.get('nogl') === '1') html = html.replace('<head>', '<head><script>HTMLCanvasElement.prototype.getContext=(original=>function(type,...rest){return /webgl/.test(type)?null:original.call(this,type,...rest);})(HTMLCanvasElement.prototype.getContext);</script>');
    return html;
}

function sendFile(res, file) {
    fs.readFile(file, (error, data) => {
        if (error) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
        res.end(data);
    });
}
const inside = (base, target) => { const full = path.resolve(base, target); return full.startsWith(path.resolve(base) + path.sep) ? full : null; };
const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
const cardCache = new Map();

http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost'), route = decodeURIComponent(url.pathname), q = url.searchParams;
    if (route === '/') {
        if (q.get('trade')) presetTrade(q.get('trade'));
        res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-store' }); res.end(dashboardHtml(q)); return;
    }
    if (route.startsWith('/static/')) { const file = inside(PUBLIC, route.slice(8)); return file ? sendFile(res, file) : json(res, 400, {}); }
    if (route === '/item-image') { const file = inside(ITEM_IMAGE, path.join(q.get('dir') || '', q.get('file') || '')); return file ? sendFile(res, file) : json(res, 400, {}); }
    if (route === '/rpg-ui' || route === '/combine-ui') { const file = inside(path.join(ASSET_DATA, 'ui'), (route === '/combine-ui' ? '조합/' : '') + (q.get('file') || '')); return file ? sendFile(res, file) : json(res, 400, {}); }
    if (route === '/card-image') {
        const key = url.search; let buffer = cardCache.get(key);
        if (!buffer) { buffer = cardComposite.composeCardImage({ name: q.get('name'), star: Number(q.get('star') || 0), type: q.get('type') || '일반', skin: q.get('skin') || '' }); if (buffer) cardCache.set(key, buffer); }
        if (!buffer) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=3600' }); res.end(buffer); return;
    }
    if (!route.startsWith('/api/')) { res.writeHead(404); res.end('not found'); return; }
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
        let body = {}; try { body = raw ? JSON.parse(raw) : {}; } catch { /* 빈 본문 */ }
        const reply = (status, payload) => setTimeout(() => json(res, status, payload), Number(q.get('lag') || 120));
        if (route === '/api/me') return reply(200, { name: me.name });
        if (route === '/api/profile') return reply(200, profile());
        if (route === '/api/shop') return reply(200, shopData());
        if (route === '/api/shop/buy') return reply(...shopBuy(body));
        if (route === '/api/black-market') return reply(503, { error: '실험실에서는 암시장을 열지 않습니다.' });
        if (route === '/api/trade') return reply(200, { state: tradeState() });
        if (route === '/api/trade/inventory') return trade.status === 'active' ? reply(200, { state: tradeState(), cards: inventoryCards(), equipment: inventoryEquipment(), items: inventoryItems().filter(item => !item.noTrade) }) : reply(409, { error: '진행 중인 거래가 없습니다.' });
        if (route.startsWith('/api/trade/')) return reply(...tradeAction(route.slice(11), body));
        if (route === '/api/mail') return reply(200, mailbox(q.get('page')));
        if (route === '/api/mail/giftable') return reply(200, giftable());
        if (route === '/api/mail/recipient-fee') return q.get('to') === '없는사람' ? reply(404, { error: '존재하지 않는 닉네임입니다.' }) : reply(200, { feeRate: q.get('to') === '달빛상인' ? 0.03 : 0.05, feeMin: 1 });
        if (route === '/api/mail/read') { const mail = me.mails.find(entry => entry.id === body.id); if (mail) mail.read = true; return reply(200, { ok: true, unread: me.mails.filter(entry => !entry.read).length }); }
        if (route === '/api/mail/claim') { const mail = me.mails.find(entry => entry.id === body.id); if (!mail || mail.claimed) return reply(400, { error: '이미 수령한 메일입니다.' }); mail.claimed = true; return reply(200, { ok: true, lines: [] }); }
        if (route === '/api/mail/send') {
            if (body.to === '없는사람') return reply(400, { error: '존재하지 않는 닉네임입니다.' });
            me.mails.unshift({ id: 'm' + Date.now(), from: me.name, gm: false, subject: body.subject || '(제목 없음)', body: body.body || '', createdAt: Date.now(), read: false, claimed: !(body.gifts || []).length,
                gifts: (body.gifts || []).map(gift => gift.type === 'equipment' ? { type: 'equipment', equip: me.equipment[gift.number - 1] } : gift.type === 'pet' ? { type: 'pet', pet: me.pets[gift.index] } : gift) });
            return reply(200, { ok: true, fee: (body.gifts || []).filter(gift => gift.type === 'gold' || gift.type === 'garnet').reduce((sum, gift) => sum + Math.max(1, Math.floor(gift.amount * 0.05)), 0) });
        }
        const marketReply = market(route, q, body); if (marketReply) return reply(...marketReply);
        if (route === '/api/inventory') return reply(200, { name: me.name, items: inventoryItems(), cards: inventoryCards(), equipment: inventoryEquipment(), pets: [] });
        if (route === '/api/presets') return reply(200, presetPayload());
        // 실험실 전용: 장비 하나를 직접 벗은 상태(어느 프리셋에도 없는 장착)를 만든다.
        if (route === '/api/presets/lab-unequip') { presetLab.current.gear.shift(); return reply(200, presetPayload()); }
        if (route.startsWith('/api/presets/')) return reply(...presetAction(route.slice(13), body));
        reply(404, { error: '실험실에 없는 API: ' + route });
    });
}).listen(PORT, () => console.log('거래, 상점, 메일 실험실: http://localhost:' + PORT + '/?tab=shop'));
