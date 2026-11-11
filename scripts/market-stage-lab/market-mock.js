// 실험실용 팝니다, 삽니다 가짜 API. 응답 모양은 server.js의 serializeAuctionEntry, serializeBuyOrderEntry,
// buildSellableAssets, buildBuyOrderLookups, buildFulfillableAssets와 같다. 메모리 안에서만 바뀐다.
module.exports = function createMarket(h) {
    const { me, CARDS, ITEMS, EQUIP, PETS, serializeCard, serializeEquipment, itemAssets, itemImageUrl, frameUrl, formatUserCard, cardImageUrl } = h;
    const LABEL = { weapon: '무기', hat: '모자', armor: '갑옷', pants: '하의', shoes: '신발', accessory: '장신구', support: '보조', artifact: '아티팩트' };
    const now = Date.now();
    let seq = 0;
    const petAssets = id => ({ iconUrl: itemImageUrl('펫', PETS[id].rarity + ' ' + PETS[id].name + '.png'), frameUrl: frameUrl('equipment', PETS[id].rarity) });
    const petLines = (id, level, trades) => ['HP +' + (100 + level * 20), '공격력 +' + (10 + level * 3), '낚시 속도 +5%', '세트: 2024 베스티스', '남은 거래 가능 횟수: ' + trades];
    const items = Object.keys(ITEMS).map(Number).filter(id => ITEMS[id] && itemAssets(ITEMS[id]).iconUrl && ITEMS[id].no_trade !== true);
    const equipIds = type => (EQUIP[type] || []).map((d, id) => ({ d, id })).filter(e => e.d && itemImageUrl('장비', e.d.rarity + ' ' + e.d.name + '.png'));
    const auctions = [], orders = [];
    const add = (list, who, kind, payload, price, currency, count = 1, ago = 0) => list.push({ id: 'm' + (++seq), [list === auctions ? 'sellerName' : 'buyerName']: who, kind, payload, price, currency, count, createdAt: now - ago * 60000 });
    // 팝니다 매물: 같은 품목을 여러 값에 올려 최저가 표시를 볼 수 있게 한다.
    add(auctions, '달빛상인', 'card', { id: 3, star: 8, type: '전직' }, 4200000, 'gold', 1, 5);
    add(auctions, '부타', 'card', { id: 3, star: 8, type: '전직' }, 3900000, 'gold', 1, 30);
    add(auctions, '이익태', 'card', { id: 4, star: 9, type: '각성' }, 1800, 'garnet', 1, 60);
    add(auctions, '흠시원', 'card', { id: 11, star: 6, type: '일반', skin: '' }, 250000, 'gold', 1, 90);
    add(auctions, '실험실', 'card', { id: 7, star: 7, type: '전직' }, 2600000, 'gold', 1, 2);
    const w = equipIds('weapon'), a = equipIds('armor'), art = equipIds('artifact');
    add(auctions, '켄시', 'equipment', { type: 'weapon', id: w[3].id, level: 12, potential: '유니크' }, 9800000, 'gold', 1, 15);
    add(auctions, '제우스', 'equipment', { type: 'armor', id: a[2].id, level: 15 }, 5200, 'garnet', 1, 40);
    if (art.length) add(auctions, '타이란트', 'equipment', { type: 'artifact', id: art[art.length - 1].id, level: 0 }, 3100, 'garnet', 1, 120);
    add(auctions, '빵귤', 'item', { id: items[4] }, 1200, 'gold', 250, 8);
    add(auctions, '뭔마', 'item', { id: items[4] }, 990, 'gold', 40, 25);
    add(auctions, '글렌첵', 'item', { id: items[11] }, 35, 'garnet', 12, 200);
    add(auctions, '딜러장', 'pet', { id: 0, level: 3, tradeCount: 2 }, 760000, 'gold', 1, 300);
    add(auctions, '일리온', 'avatar', { name: me.avatars[1].name, grade: '한정' }, 9000, 'garnet', 1, 400);
    // 삽니다 요청: 일부는 내 보관함으로 채울 수 있다.
    add(orders, '달빛상인', 'card', { id: 3, star: 8, type: '일반' }, 3500000, 'gold', 2, 3);
    add(orders, '부타', 'card', { id: 11, star: 10 }, 7600, 'garnet', 1, 20);
    add(orders, '키노', 'card', { id: 0, star: 4 }, 90000, 'gold', 3, 33);
    add(orders, '이익태', 'equipment', { type: me.equipment[0].type, id: me.equipment[0].id }, 2200000, 'gold', 1, 50);
    add(orders, '켄시', 'equipment', { type: 'weapon', id: w[5].id, level: 15 }, 12000, 'garnet', 1, 70);
    add(orders, '빵귤', 'item', { id: [...me.items.keys()][3] }, 800, 'gold', 50, 80);
    add(orders, '실험실', 'item', { id: items[20] }, 60, 'garnet', 10, 1);
    add(orders, '워뇨띠', 'pet', { id: me.pets[1].id }, 500000, 'gold', 1, 110);
    add(orders, '제우스', 'avatar', { name: me.avatars[0].name }, 4000, 'garnet', 1, 160);

    const ticketCost = kind => (payload) => kind === 'card' ? Math.max(0, Number(payload.star || 0) - 3) : 0;
    function identity(e) {
        const p = e.payload;
        if (e.kind === 'card') return { cardId: p.id, cardType: p.type || null, skin: p.skin || null, formatted: formatUserCard({ ...p, type: p.type || '일반' }) };
        if (e.kind === 'equipment') return { equipId: p.id };
        if (e.kind === 'item') return { itemId: p.id, itemType: ITEMS[p.id].type };
        if (e.kind === 'pet') return { petId: p.id };
        return {};
    }
    function display(e, buy) {
        const p = e.payload, base = { imageUrl: null, frameUrl: null, iconUrl: null, statLines: null, potentialDisplay: null, soul: null, equipmentDetail: null, orbDetail: null, ...identity(e) };
        if (e.kind === 'card') return { ...base, name: CARDS[p.id].name, sub: buy ? (p.star + 1) + '성' + (p.type ? ' · 타입: ' + p.type : '') : formatUserCard(p), star: p.star, imageUrl: cardImageUrl({ id: p.id, star: p.star, type: p.type || '일반' }) };
        if (e.kind === 'equipment') {
            const d = EQUIP[p.type][p.id], detail = buy ? null : serializeEquipment({ type: p.type, id: p.id, level: p.level, potential: p.potential }, 2);
            return { ...base, name: d.name, sub: d.rarity, rarity: d.rarity, equipType: p.type, level: typeof p.level === 'number' ? p.level : null, iconUrl: itemImageUrl('장비', d.rarity + ' ' + d.name + '.png'), frameUrl: frameUrl('equipment', d.rarity), equipmentDetail: detail, statLines: detail ? detail.statLines : null };
        }
        if (e.kind === 'item') return { ...base, name: ITEMS[p.id].name, sub: ITEMS[p.id].type, ...itemAssets(ITEMS[p.id]) };
        if (e.kind === 'pet') return { ...base, name: PETS[p.id].name, sub: PETS[p.id].rarity, rarity: PETS[p.id].rarity, ...petAssets(p.id), statLines: buy ? null : petLines(p.id, p.level || 0, p.tradeCount || 1) };
        return { ...base, name: p.name, sub: '아바타', rarity: p.grade || '일반', iconUrl: itemImageUrl('아바타', p.name + ' 아바타.png'), frameUrl: frameUrl('equipment', p.grade === '한정' ? '초월' : '일반'), statLines: ['공격력 +80', '체력 +1,000', '메인카드 장착 시 스탯 적용'] };
    }
    const serialize = (e, buy) => ({ id: e.id, [buy ? 'buyerName' : 'sellerName']: e[buy ? 'buyerName' : 'sellerName'], kind: e.kind, count: e.count, currency: e.currency, price: e.price, unitPrice: e.price, totalPrice: e.price * e.count, ticketCost: ticketCost(e.kind)(e.payload), ticketTotal: ticketCost(e.kind)(e.payload) * e.count, createdAt: e.createdAt, mine: e[buy ? 'buyerName' : 'sellerName'] === me.name, display: display(e, buy) });

    function sellable() {
        return {
            cards: me.cards.map((c, index) => ({ index, ...serializeCard(c) })),
            equipment: me.equipment.map((q, index) => { const v = serializeEquipment(q, index + 1); return { index, type: q.type, typeLabel: LABEL[q.type], id: q.id, name: v.name, rarity: v.rarity, level: v.level, tradeCount: 2, statLines: v.statLines, artifact: v.artifact, potentialDisplay: v.potentialDisplay, soul: v.soul, iconUrl: v.iconUrl, frameUrl: v.frameUrl, detail: v }; }),
            items: [...me.items].filter(([, n]) => n > 0).map(([id, count]) => ({ id, name: ITEMS[id].name, type: ITEMS[id].type, desc: ITEMS[id].desc || '', count, ...itemAssets(ITEMS[id]) })),
            pets: me.pets.map((p, index) => ({ index, id: p.id, name: PETS[p.id].name, rarity: PETS[p.id].rarity, level: p.level, tradeCount: 2, statLines: petLines(p.id, p.level, 2), ...petAssets(p.id) })),
            avatars: me.avatars.map(a => ({ id: a.id, name: a.name, grade: a.grade, trades: 0, iconUrl: itemImageUrl('아바타', a.name + ' 아바타.png'), frameUrl: frameUrl('equipment', a.grade === '한정' ? '초월' : '일반'), imageUrl: null }))
        };
    }
    function lookups() {
        const equipment = {}; for (const t of Object.keys(LABEL)) equipment[t] = equipIds(t).map(({ d, id }) => ({ id, name: d.name, rarity: d.rarity, iconUrl: itemImageUrl('장비', d.rarity + ' ' + d.name + '.png'), frameUrl: frameUrl('equipment', d.rarity) }));
        return {
            cards: CARDS.map((c, id) => ({ id, name: c.name, imageUrl: cardImageUrl({ id, star: 0, type: '일반' }) })),
            equipment, items: items.slice(0, 80).map(id => ({ id, name: ITEMS[id].name, type: ITEMS[id].type, ...itemAssets(ITEMS[id]) })),
            pets: PETS.map((p, id) => p && ({ id, name: p.name, rarity: p.rarity, ...petAssets(id) })).filter(p => p && p.iconUrl),
            avatars: me.avatars.map(a => ({ name: a.name, grade: a.grade, iconUrl: itemImageUrl('아바타', a.name + ' 아바타.png'), frameUrl: frameUrl('equipment', '일반'), imageUrl: null }))
        };
    }
    function fulfillable(o) {
        const r = { cards: [], equipment: [], itemCount: 0, pets: [], feeRate: .05 }, p = o.payload;
        if (o.kind === 'card') me.cards.forEach((c, index) => { if (c.id === p.id && c.star === p.star && (!p.type || (c.type || '일반') === p.type)) r.cards.push({ index, ...serializeCard(c) }); });
        if (o.kind === 'equipment') me.equipment.forEach((q, index) => { if (q.type === p.type && q.id === p.id && (typeof p.level !== 'number' || (q.level || 0) === p.level)) { const v = serializeEquipment(q, index + 1); r.equipment.push({ index, type: q.type, typeLabel: LABEL[q.type], id: q.id, name: v.name, rarity: v.rarity, level: v.level, tradeCount: 2, statLines: v.statLines, iconUrl: v.iconUrl, frameUrl: v.frameUrl, detail: v }); } });
        if (o.kind === 'item') r.itemCount = me.items.get(p.id) || 0;
        if (o.kind === 'pet') me.pets.forEach((q, index) => { if (q.id === p.id) r.pets.push({ index, id: q.id, name: PETS[q.id].name, rarity: PETS[q.id].rarity, level: q.level, tradeCount: 2, statLines: petLines(q.id, q.level, 2), ...petAssets(q.id) }); });
        if (o.kind === 'avatar') { const inst = me.avatars.filter(a => a.name === p.name); r.avatar = { name: p.name, owned: inst.length > 0, instances: inst.map(a => ({ id: a.id, name: a.name, trades: 0 })), tradeBlockReason: null, grade: inst[0] ? inst[0].grade : '일반', iconUrl: itemImageUrl('아바타', p.name + ' 아바타.png'), frameUrl: frameUrl('equipment', '일반') }; }
        return r;
    }
    const fail = message => [400, { error: message }];
    return function route(path, q, body) {
        if (path === '/api/auction') return [200, { items: auctions.map(e => serialize(e, false)) }];
        if (path === '/api/auction/sellable') return [200, sellable()];
        if (path === '/api/auction/register') {
            if (!(body.price >= 1)) return fail('가격은 1 이상의 정수여야 합니다.');
            let payload, count = 1;
            if (body.kind === 'card') { const c = me.cards.splice(body.index, 1)[0]; if (!c) return fail('카드를 찾을 수 없습니다.'); payload = c; }
            else if (body.kind === 'equipment') { const e = me.equipment.splice(body.index, 1)[0]; if (!e) return fail('장비를 찾을 수 없습니다.'); payload = e; }
            else if (body.kind === 'pet') { const pt = me.pets.splice(body.index, 1)[0]; if (!pt) return fail('펫을 찾을 수 없습니다.'); payload = { ...pt, tradeCount: 2 }; }
            else if (body.kind === 'avatar') { const i = me.avatars.findIndex(a => a.id === body.avatarId); if (i < 0) return fail('아바타를 찾을 수 없습니다.'); payload = { name: me.avatars.splice(i, 1)[0].name }; }
            else { const have = me.items.get(body.itemId) || 0; if (!(body.count >= 1) || body.count > have) return fail('갯수가 부족합니다.'); me.items.set(body.itemId, have - body.count); payload = { id: body.itemId }; count = body.count; }
            add(auctions, me.name, body.kind, payload, body.price, body.currency, count, 0); return [200, { ok: true, id: 'm' + seq }];
        }
        if (path === '/api/auction/buy') {
            const e = auctions.find(x => x.id === body.id); if (!e) return fail('존재하지 않거나 이미 판매된 경매입니다.');
            const n = e.kind === 'item' ? Math.max(1, Number(body.count) || 1) : 1, cost = e.price * n;
            if (me[e.currency] < cost) return fail((e.currency === 'gold' ? '골드' : '가넷') + '가 부족합니다.');
            me[e.currency] -= cost; e.count -= n; if (e.count <= 0) auctions.splice(auctions.indexOf(e), 1);
            if (e.kind === 'item') me.items.set(e.payload.id, (me.items.get(e.payload.id) || 0) + n); else if (e.kind === 'card') me.cards.push(e.payload); else if (e.kind === 'equipment') me.equipment.push(e.payload);
            return [200, { ok: true }];
        }
        if (path === '/api/auction/cancel') { const i = auctions.findIndex(x => x.id === body.id && x.sellerName === me.name); if (i < 0) return fail('취소할 수 없습니다.'); const e = auctions.splice(i, 1)[0]; if (e.kind === 'card') me.cards.push(e.payload); if (e.kind === 'equipment') me.equipment.push(e.payload); if (e.kind === 'item') me.items.set(e.payload.id, (me.items.get(e.payload.id) || 0) + e.count); return [200, { ok: true }]; }
        if (path === '/api/buyorder') return [200, { items: orders.map(e => serialize(e, true)) }];
        if (path === '/api/buyorder/lookups') return [200, lookups()];
        if (path === '/api/buyorder/fulfillable') { const o = orders.find(x => x.id === q.get('id')); return o ? [200, fulfillable(o)] : [404, { error: '존재하지 않는 구매 등록입니다.' }]; }
        if (path === '/api/buyorder/register') {
            if (!(body.price >= 1)) return fail('가격은 1 이상의 정수여야 합니다.');
            const total = body.price * (body.count || 1); if (me[body.currency] < total) return fail('재화가 부족합니다.'); me[body.currency] -= total;
            const payload = body.kind === 'card' ? { id: body.cardId, star: body.star, ...(body.type ? { type: body.type } : {}) } : body.kind === 'equipment' ? { type: body.equipType, id: body.equipId, ...(body.level != null ? { level: body.level } : {}) } : body.kind === 'item' ? { id: body.itemId } : body.kind === 'pet' ? { id: body.petId } : { name: body.name };
            add(orders, me.name, body.kind, payload, body.price, body.currency, body.count || 1, 0); return [200, { ok: true, id: 'm' + seq }];
        }
        if (path === '/api/buyorder/fulfill') {
            const o = orders.find(x => x.id === body.id); if (!o) return fail('존재하지 않거나 이미 종료된 구매 등록입니다.');
            let n = 1;
            if (o.kind === 'item') { n = Math.max(1, Number(body.count) || 1); const have = me.items.get(o.payload.id) || 0; if (n > have || n > o.count) return fail('수량이 올바르지 않습니다.'); me.items.set(o.payload.id, have - n); }
            else if (o.kind === 'card') { if (!me.cards[body.index]) return fail('카드를 찾을 수 없습니다.'); me.cards.splice(body.index, 1); }
            else if (o.kind === 'equipment') { if (!me.equipment[body.index]) return fail('장비를 찾을 수 없습니다.'); me.equipment.splice(body.index, 1); }
            else if (o.kind === 'pet') { if (!me.pets[body.index]) return fail('펫을 찾을 수 없습니다.'); me.pets.splice(body.index, 1); }
            else { const i = me.avatars.findIndex(a => a.id === body.avatarId); if (i < 0) return fail('아바타를 찾을 수 없습니다.'); me.avatars.splice(i, 1); }
            me[o.currency] += Math.floor(o.price * n * .95); o.count -= n; if (o.count <= 0) orders.splice(orders.indexOf(o), 1);
            return [200, { ok: true }];
        }
        if (path === '/api/buyorder/cancel') { const i = orders.findIndex(x => x.id === body.id && x.buyerName === me.name); if (i < 0) return fail('취소할 수 없습니다.'); const o = orders.splice(i, 1)[0]; me[o.currency] += o.price * o.count; return [200, { ok: true }]; }
        return null;
    };
};
