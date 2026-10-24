'use strict';

const crypto = require('crypto');
const characters = require('./DB/RPGenius/CharacterCards.json');
const awakening = require('./card_awakening');

const SECTORS = [
    { id: 'card-garnet', kind: 'card', currency: 'garnet' },
    { id: 'card-gold', kind: 'card', currency: 'gold' },
    { id: 'item-garnet', kind: 'item', currency: 'garnet' },
    { id: 'item-gold', kind: 'item', currency: 'gold' }
];
const ITEM_NAMES = {
    garnet: ['거래권', '고급 장비 보호권', '7성 보호 카드', '8성 보호 카드', '9성 보호 카드',
        ...[9, 10, 11].flatMap(level => [5, 10, 30, 50, 70, 90].map(percent => `${percent}프로 +${level} 장비 강화권`)),
        '유니크 잠재능력 주문서', '레전더리 잠재능력 주문서', '보주 상자', '보주 선택 상자',
        '유생의 축복 사용권 (7일)', '루킴의 축복 사용권 (7일)', '아티팩트 옵션 변경열쇠', '지정 캐릭터 변환석 주머니'],
    gold: ['장비 보호권', '캐릭터 변환석', '전직 캐릭터 변환석', '각성 캐릭터 변환석',
        '제타 캐릭터 변환석', '전직 제타 캐릭터 변환석', '제타 각성 캐릭터 변환석',
        '시그마 캐릭터 변환석', '전직 시그마 캐릭터 변환석', '시그마 각성 캐릭터 변환석',
        '보주 상자', '유생의 축복 사용권 (1일)', '루킴의 축복 사용권 (1일)', '지정 캐릭터 변환석 주머니']
};
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const dateKey = now => new Date(now + 9 * 3600000).toISOString().slice(0, 10);
const closesAt = date => Date.parse(date + 'T23:50:00+09:00');
const nextDayAt = date => Date.parse(date + 'T00:00:00+09:00') + 86400000;
const validDate = date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
    && Number.isFinite(closesAt(date)) && dateKey(closesAt(date)) === date;

function itemPool(items, currency) {
    const pool = ITEM_NAMES[currency].flatMap(name => {
        const id = items.findIndex(item => item?.name === name);
        return id < 0 ? [] : [{ payload: { id }, count: 1, name }];
    });
    if (currency === 'garnet') {
        const ticket = pool.find(entry => entry.name === '거래권');
        if (ticket) pool.push({ ...ticket, count: 5 });
    }
    // '랜덤 보주'는 목록의 한 칸으로 추첨한 뒤, 실제 보주 하나를 공개한다.
    const orbs = items.flatMap((item, id) => item?.use === '보주' ? [{ payload: { id }, count: 1, name: item.name }] : []);
    if (orbs.length) pool.push({ orbs });
    return pool;
}

function cardPool(admin = false) {
    return characters.flatMap((character, id) => ['일반', '전직', '각성'].flatMap(type => {
        if (type === '전직' && !character.class || type === '각성' && !awakening.getDefinition({ id, type })) return [];
        const firstStar = admin && type === '일반' ? 0 : 4, lastStar = admin ? 11 : 8;
        return Array.from({ length: lastStar - firstStar + 1 }, (_, index) => ({ payload: { id, star: firstStar + index, type }, count: 1, name: character.name }));
    }));
}

function pick(pool, seed) {
    if (!pool.length) fail('암시장 매물 데이터를 찾을 수 없습니다.', 503);
    return structuredClone(pool[crypto.createHash('sha256').update(seed).digest().readUInt32BE(0) % pool.length]);
}

function createBlackMarket({ read, commit, getItems, getUser, withUser, display, now = () => Date.now() }) {
    let queue = Promise.resolve();
    const serial = task => { const next = queue.catch(() => {}).then(task); queue = next; return next; };
    const options = sector => sector.kind === 'card' ? cardPool(true) : itemPool(getItems(), sector.currency).flatMap(entry => entry.orbs || [entry]);
    const lotView = lot => ({ sector: lot.sector, lotId: lot.lotId, kind: lot.kind, currency: lot.currency,
        payload: lot.payload, count: lot.count, display: display(lot), edited: !!lot.edited });
    const resultView = lot => ({ ...lotView(lot), winner: lot.winner ? { name: lot.winner.name, amount: lot.winner.amount } : null });

    function makeLots(date, overrides = {}) {
        return SECTORS.map(sector => {
            let selected = overrides[sector.id] || pick(sector.kind === 'card' ? cardPool() : itemPool(getItems(), sector.currency), date + sector.id);
            if (selected.orbs) selected = pick(selected.orbs, date + sector.id + ':orb');
            return { ...sector, ...selected, sector: sector.id, lotId: crypto.randomUUID(), bids: [], edited: !!overrides[sector.id] };
        });
    }

    async function save(previous, next, user, mail) {
        await commit(previous, next, user, mail);
        return next;
    }

    async function settle(state) {
        if (state.status === 'open') {
            const next = structuredClone(state);
            next.status = 'settling';
            for (const lot of next.lots) {
                lot.winner = [...lot.bids].sort((a, b) => b.amount - a.amount || a.order - b.order)[0] || null;
            }
            state = await save(state, next);
        }
        if (state.status !== 'settling') return state;
        for (let index = 0; index < state.lots.length; index++) {
            while (state.lots[index].bids.length) {
                const bid = state.lots[index].bids[0];
                state = await withUser(bid.name, async () => {
                    const user = await getUser(bid.name, bid.userId);
                    if (!user || user.id !== bid.userId) fail('정산 대상 계정을 확인할 수 없습니다.', 409);
                    const next = structuredClone(state), lot = next.lots[index];
                    lot.bids.shift();
                    let mail;
                    if (lot.winner?.userId === bid.userId) {
                        const id = 'black-market:' + state.date + ':' + lot.sector;
                        mail = { id, fromName: '암시장', toName: user.name, subject: '암시장 낙찰 보상',
                            body: `${state.date} ${lot.name} 낙찰을 축하합니다. 보관한 ${bid.amount.toLocaleString('ko-KR')} ${lot.currency === 'gold' ? '골드' : '가넷'}으로 결제되었습니다.`,
                            gifts: [lot.kind === 'card' ? { type: 'card', card: lot.payload } : { type: 'item', id: lot.payload.id, count: lot.count }], createdAt: now() };
                        user.mail = [...(user.mail || []), { id, read: false, readAt: null, claimed: false, createdAt: mail.createdAt }];
                        user.mailNotified = false;
                    } else {
                        user[lot.currency] = Number(user[lot.currency] || 0) + bid.amount;
                        if (!Number.isSafeInteger(user[lot.currency])) fail('반환할 재화의 보유 한도를 확인해주세요.', 409);
                    }
                    return save(state, next, user, mail);
                }, bid.userId);
            }
        }
        return save(state, { ...state, status: 'settled' });
    }

    async function advance() {
        let state = await read();
        const today = dateKey(now());
        if (state && now() >= closesAt(state.date)) state = await settle(state);
        if (!state || state.date < today && state.status === 'settled') {
            const next = { date: today, status: 'open', sequence: 0, lots: makeLots(today, state?.scheduled?.[today]),
                previous: state ? { date: state.date, lots: state.lots.map(resultView) } : null,
                scheduled: Object.fromEntries(Object.entries(state?.scheduled || {}).filter(([date]) => date > today)) };
            state = await save(state, next);
        }
        if (now() >= closesAt(state.date)) state = await settle(state);
        return state;
    }

    async function view(state, name) {
        const user = await getUser(name);
        if (!user) fail('유저를 찾을 수 없습니다.', 404);
        return { date: state.date, status: now() >= closesAt(state.date) ? 'settling' : state.status,
            serverNow: now(), closesAt: closesAt(state.date), nextDayAt: nextDayAt(state.date),
            balances: { gold: Number(user.gold || 0), garnet: Number(user.garnet || 0) },
            lots: state.lots.map(lot => {
                const bid = lot.bids.find(b => b.userId === user.id);
                return { ...lotView(lot), myBid: bid ? { amount: bid.amount, version: bid.version } : null };
            }), previous: state.status === 'settled' ? { date: state.date, lots: state.lots.map(resultView) } : state.previous };
    }

    return {
        tick: () => serial(advance),
        get: name => serial(async () => view(await advance(), name)),
        bid: (name, body) => serial(async () => {
            const state = await advance();
            return withUser(name, async () => {
                if (state.status !== 'open' || now() >= closesAt(state.date)) fail('23:50부터 정산 중입니다. 자정에 다시 입찰해주세요.', 409);
                const index = state.lots.findIndex(lot => lot.sector === body.sector && lot.lotId === body.lotId);
                if (body.date !== state.date || index < 0) fail('매물이 변경되었습니다. 새로고침해주세요.', 409);
                if (!Number.isSafeInteger(body.amount) || body.amount < 0) fail('입찰금은 1 이상의 정수여야 합니다.');
                const user = await getUser(name);
                if (!user) fail('유저를 찾을 수 없습니다.', 404);
                const next = structuredClone(state), lot = next.lots[index];
                const previous = lot.bids.find(bid => bid.userId === user.id);
                if ((body.bidVersion ?? null) !== (previous?.version ?? null)) fail('내 입찰이 변경되었습니다. 새로고침해주세요.', 409);
                if (body.amount === (previous?.amount || 0)) return view(state, name);
                const available = Number(user[lot.currency] || 0) + (previous?.amount || 0);
                if (body.amount > available) fail('입찰금을 보관할 재화가 부족합니다.');
                user[lot.currency] = available - body.amount;
                if (!Number.isSafeInteger(user[lot.currency])) fail('보유 재화를 확인해주세요.');
                lot.bids = lot.bids.filter(bid => bid.userId !== user.id);
                if (body.amount) {
                    lot.bids.push({ userId: user.id, name: user.name, amount: body.amount, order: ++next.sequence, version: crypto.randomUUID() });
                    lot.started = true;
                }
                // 정산 마감은 사용자 큐를 기다린 뒤, 저장 직전에도 검사한다.
                if (now() >= closesAt(state.date)) fail('입찰이 마감되었습니다.', 409);
                await save(state, next, user);
                return view(next, name);
            });
        }),
        admin: date => serial(async () => {
            const state = await advance(), target = date || state.date;
            if (!validDate(target) || target < state.date) fail('오늘 이후의 날짜를 선택해주세요.');
            const lots = target === state.date ? state.lots : makeLots(target, state.scheduled[target]);
            return { date: target, today: state.date, lots: lots.map(lot => ({ ...lotView(lot),
                locked: target === state.date && (!!lot.started || state.status !== 'open'),
                options: options(lot).map(option => ({ ...option, display: display({ ...lot, ...option }) })) })),
                missingItems: [...new Set(Object.values(ITEM_NAMES).flat())].filter(name => !getItems().some(item => item?.name === name)) };
        }),
        override: body => serial(async () => {
            const state = await advance(), sector = SECTORS.find(s => s.id === body.sector);
            if (!sector || !validDate(body.date) || body.date < state.date) fail('날짜와 섹터를 확인해주세요.');
            const current = state.lots.find(lot => lot.sector === sector.id);
            if (body.date === state.date && (current.started || state.status !== 'open' || now() >= closesAt(state.date))) fail('입찰이 시작된 매물은 변경할 수 없습니다. 다음 날짜를 선택해주세요.', 409);
            const selected = options(sector).find(option => option.payload.id === body.payload?.id && option.count === body.count &&
                (sector.kind !== 'card' || option.payload.star === body.payload?.star && option.payload.type === body.payload?.type));
            if (!body.reset && !selected) fail('암시장 목록에서 매물을 선택해주세요.');
            const next = structuredClone(state);
            if (body.date === state.date) {
                const replacement = makeLots(body.date, body.reset ? {} : { [sector.id]: selected }).find(lot => lot.sector === sector.id);
                next.lots[next.lots.findIndex(lot => lot.sector === sector.id)] = replacement;
            } else {
                next.scheduled[body.date] ||= {};
                if (body.reset) delete next.scheduled[body.date][sector.id]; else next.scheduled[body.date][sector.id] = selected;
                if (!Object.keys(next.scheduled[body.date]).length) delete next.scheduled[body.date];
            }
            await save(state, next);
            return { ok: true };
        })
    };
}

module.exports = { createBlackMarket, SECTORS, ITEM_NAMES, itemPool, cardPool, dateKey, closesAt };
