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
const HALF_DAY = 12 * 3600000, SETTLEMENT_TIME = 10 * 60000;
const dateKey = now => new Date(now + 9 * 3600000).toISOString().slice(0, 10);
const validDate = date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
    && Number.isFinite(Date.parse(date + 'T09:00:00+09:00')) && dateKey(Date.parse(date + 'T09:00:00+09:00')) === date;

function periodAt(time) {
    // 한국 시간 09시/21시는 UTC 00시/12시다.
    const opensAt = Math.floor(time / HALF_DAY) * HALF_DAY;
    const date = dateKey(opensAt), round = new Date(opensAt).getUTCHours() === 0 ? '09' : '21';
    return { date, round, periodId: date + '-' + round, opensAt, closesAt: opensAt + HALF_DAY - SETTLEMENT_TIME, nextOpensAt: opensAt + HALF_DAY };
}

function selectedPeriod(date, round) {
    if (!validDate(date) || !['09', '21'].includes(round)) fail('날짜와 09시/21시 회차를 선택해주세요.');
    return periodAt(Date.parse(date + 'T' + round + ':00:00+09:00'));
}

function lotTitle(lot) {
    const name = lot.name || lot.display?.baseName || lot.display?.name;
    if (lot.kind === 'card') {
        const grade = ['𝛧', '𝛴', '𝛀'][lot.payload.star - 9] || (lot.payload.star + 1) + '성';
        return '[' + grade + '] ' + (lot.payload.type === '일반' ? '' : lot.payload.type + ' ') + name;
    }
    return name + (lot.count > 1 ? ' x' + lot.count : '');
}

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
    const options = sector => sector.kind === 'card' ? cardPool(true)
        : [...new Map(itemPool(getItems(), sector.currency).flatMap(entry => entry.orbs || [entry]).map(entry => [entry.payload.id, { ...entry, count: 1 }])).values()];
    const lotView = lot => ({ sector: lot.sector, lotId: lot.lotId, kind: lot.kind, currency: lot.currency,
        payload: lot.payload, count: lot.count, display: display(lot), edited: !!lot.edited });
    const resultView = lot => ({ ...lotView(lot), winner: lot.winner ? { name: lot.winner.name, amount: lot.winner.amount } : null });
    const result = state => ({ date: state.date, round: state.round, periodId: state.periodId, lots: state.lots.map(resultView) });

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
                        const id = 'black-market:' + (state.mailKey || state.periodId) + ':' + lot.sector;
                        mail = { id, fromName: '암시장', toName: user.name, subject: '암시장 낙찰 보상',
                            body: `${state.date} ${state.round}:00 ${lotTitle(lot)} 낙찰을 축하합니다. 보관한 ${bid.amount.toLocaleString('ko-KR')} ${lot.currency === 'gold' ? '골드' : '가넷'}으로 결제되었습니다.`,
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
        if (state && !state.periodId) {
            // 기존 하루 매물의 입찰·보관금은 보존하고 다음 정산 시각으로 옮긴다.
            // 이미 마감된 회차는 즉시 정산하며, 지급 도중 재시작해도 기존 메일 ID를 유지한다.
            const legacyOpen = state.status === 'open' && now() < Date.parse(state.date + 'T23:50:00+09:00');
            const period = legacyOpen ? periodAt(now() + SETTLEMENT_TIME) : selectedPeriod(state.date, '09');
            state = await save(state, { ...state, ...period, mailKey: state.date,
                scheduled: Object.fromEntries(Object.entries(state.scheduled || {}).map(([key, value]) => [key.length === 10 ? key + '-09' : key, value])) });
        }
        if (state && now() >= state.closesAt) state = await settle(state);
        if (!state || now() >= state.nextOpensAt && state.status === 'settled') {
            const period = periodAt(now());
            const next = { ...period, status: 'open', sequence: 0, lots: makeLots(period.periodId, state?.scheduled?.[period.periodId]),
                previous: state ? result(state) : null,
                scheduled: Object.fromEntries(Object.entries(state?.scheduled || {}).filter(([key]) => key > period.periodId)) };
            state = await save(state, next);
        }
        if (now() >= state.closesAt) state = await settle(state);
        return state;
    }

    async function view(state, name) {
        const user = await getUser(name);
        if (!user) fail('유저를 찾을 수 없습니다.', 404);
        return { date: state.date, round: state.round, periodId: state.periodId, status: now() >= state.closesAt ? 'settling' : state.status,
            serverNow: now(), opensAt: state.opensAt, closesAt: state.closesAt, nextOpensAt: state.nextOpensAt, nextDayAt: state.nextOpensAt,
            balances: { gold: Number(user.gold || 0), garnet: Number(user.garnet || 0) },
            lots: state.lots.map(lot => {
                const bid = lot.bids.find(b => b.userId === user.id);
                return { ...lotView(lot), myBid: bid ? { amount: bid.amount, version: bid.version } : null };
            }), previous: state.status === 'settled' ? result(state) : state.previous ? result(state.previous) : null };
    }

    return {
        tick: () => serial(advance),
        get: name => serial(async () => view(await advance(), name)),
        bid: (name, body) => serial(async () => {
            const state = await advance();
            return withUser(name, async () => {
                if (state.status !== 'open' || now() >= state.closesAt) fail('정산 중입니다. 09시 또는 21시 새 회차에 다시 입찰해주세요.', 409);
                const index = state.lots.findIndex(lot => lot.sector === body.sector && lot.lotId === body.lotId);
                if (body.date !== state.date || body.periodId && body.periodId !== state.periodId || index < 0) fail('매물이 변경되었습니다. 새로고침해주세요.', 409);
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
                if (now() >= state.closesAt) fail('입찰이 마감되었습니다.', 409);
                await save(state, next, user);
                return view(next, name);
            });
        }),
        admin: (date, round) => serial(async () => {
            const state = await advance(), target = selectedPeriod(date || state.date, round || (date && date !== state.date ? '09' : state.round));
            if (target.periodId < state.periodId) fail('현재 이후의 회차를 선택해주세요.');
            const current = target.periodId === state.periodId;
            const lots = current ? state.lots : makeLots(target.periodId, state.scheduled[target.periodId]);
            return { ...target, today: state.date, lots: lots.map(lot => ({ ...lotView(lot),
                locked: current && (!!lot.started || state.status !== 'open'),
                options: options(lot).map(option => ({ ...option, display: display({ ...lot, ...option }) })) })),
                missingItems: [...new Set(Object.values(ITEM_NAMES).flat())].filter(name => !getItems().some(item => item?.name === name)) };
        }),
        override: body => serial(async () => {
            const state = await advance(), sector = SECTORS.find(s => s.id === body.sector);
            const target = selectedPeriod(body.date, body.round);
            if (!sector || target.periodId < state.periodId) fail('회차와 섹터를 확인해주세요.');
            const current = state.lots.find(lot => lot.sector === sector.id);
            if (target.periodId === state.periodId && (current.started || state.status !== 'open' || now() >= state.closesAt)) fail('입찰이 시작된 매물은 변경할 수 없습니다. 다음 회차를 선택해주세요.', 409);
            const selected = options(sector).find(option => option.payload.id === body.payload?.id &&
                (sector.kind !== 'card' || option.payload.star === body.payload?.star && option.payload.type === body.payload?.type));
            if (!body.reset && !selected) fail('암시장 목록에서 매물을 선택해주세요.');
            if (!body.reset && (!Number.isSafeInteger(body.count) || body.count < 1 || sector.kind === 'card' && body.count !== 1)) fail('아이템 수량은 1 이상의 정수, 카드 수량은 1개여야 합니다.');
            const chosen = selected && { ...selected, count: body.count };
            const next = structuredClone(state);
            if (target.periodId === state.periodId) {
                const replacement = makeLots(target.periodId, body.reset ? {} : { [sector.id]: chosen }).find(lot => lot.sector === sector.id);
                next.lots[next.lots.findIndex(lot => lot.sector === sector.id)] = replacement;
            } else {
                next.scheduled[target.periodId] ||= {};
                if (body.reset) delete next.scheduled[target.periodId][sector.id]; else next.scheduled[target.periodId][sector.id] = chosen;
                if (!Object.keys(next.scheduled[target.periodId]).length) delete next.scheduled[target.periodId];
            }
            await save(state, next);
            return { ok: true };
        })
    };
}

module.exports = { createBlackMarket, SECTORS, ITEM_NAMES, itemPool, cardPool, dateKey, periodAt, lotTitle };
