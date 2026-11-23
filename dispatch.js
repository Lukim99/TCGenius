'use strict';

const paradise = require('./paradise');
const rpg = () => require('./rpgenius');
const DESTINATIONS = {
    hell: { name: '도전! 헬 필드', subtitle: '부타게임', ticket: '헬 초대장', cost: 30, duration: 2000, minLevel: 141 },
    heaven: { name: '도전! 천상', subtitle: '천상의 회랑', ticket: paradise.TICKET, cost: 1, duration: 3600000, minLevel: paradise.MIN_LEVEL }
};
const active = user => user?.dispatch?.status === 'active';
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
let timer, work, workUntil = 0, retryAt = 0;

function floorForPower(power) {
    let floor = 1;
    while (floor < 150 && paradise.recommendedPower(floor + 1) <= power) floor++;
    return floor;
}

function block(user) {
    return rpg().getWebGameActionBlock(user) || (user.fishing ? '낚시를 마친 뒤 출발해주세요.' : null)
        || (user.paradise?.status === 'active' || require('./partyquest').getRoomOf(user.name)
            || user.pvp?.battle && user.pvp.battle.phase !== 'ended' ? '진행 중인 전투나 탐험을 먼저 마쳐주세요.' : null)
        || (rpg().getDirectTradeState(user.name).status !== 'idle' ? '거래 요청을 완료하거나 취소해주세요.' : null);
}

function view(user) {
    const power = rpg().calculateTownCombatPower(user).total, reason = block(user);
    const config = rpg().getDataCache('Paradise', null);
    return { serverTime: Date.now(), characterName: user.name, power, run: user.dispatch || null,
        destinations: Object.entries(DESTINATIONS).map(([id, dest]) => {
            const ticketId = rpg().getDataCache('Item', []).findIndex(item => item?.name === dest.ticket);
            const count = ticketId < 0 ? 0 : rpg().getInventoryItemCount(user, ticketId);
            return { id, ...dest, count, ...(id === 'heaven' ? { floor: floorForPower(power) } : {}),
                blocked: reason || (user.level < dest.minLevel ? dest.minLevel + '레벨부터 출발할 수 있습니다.' : null)
                    || (id === 'heaven' && (paradise.validateConfig(config) || !config.enabled) ? '천상 입장이 아직 열리지 않았습니다.' : null)
                    || (count < dest.cost ? dest.ticket + '이 부족합니다.' : null) };
        }) };
}

async function start(user, body) {
    if (typeof body.requestId !== 'string' || !/^[\w-]{16,80}$/.test(body.requestId)) fail('요청 번호가 올바르지 않습니다.');
    if (user.dispatch?.id === body.requestId) {
        if (user.dispatch.destination !== body.destination) fail('다른 파견에 사용한 요청 번호입니다.', 409);
        return;
    }
    if ((user.dispatch?.id || null) !== (body.previousId || null)) fail('파견 상태가 바뀌었습니다. 화면을 다시 열어주세요.', 409);
    const destination = view(user).destinations.find(dest => dest.id === body.destination);
    if (!destination) fail('파견할 지역을 선택해주세요.');
    if (destination.blocked) fail(destination.blocked, 409);
    const now = Date.now();
    const run = { id: body.requestId, destination: destination.id, status: 'active', startedAt: now, endsAt: now + destination.duration };
    if (destination.id === 'heaven') {
        run.power = rpg().calculateTownCombatPower(user).total;
        run.floor = floorForPower(run.power);
        const config = rpg().getDataCache('Paradise', null);
        // Ordinary return rewards, with no combat augment/contract bonuses. Preserve the live configuration.
        run.rewards = paradise.previewRewards({ status: 'ended', outcome: 'retired', clearedFloor: run.floor, highestFloor: run.floor,
            baseRewards: config.baseRewards, milestoneRewards: config.milestoneRewards, rewardBonus: 0, effects: {}, relics: [], contracts: [] });
        const items = rpg().getDataCache('Item', []);
        if (run.rewards.some(reward => reward.type === '아이템' && !items.some(item => item?.name === reward.name))) fail('천상 보상 설정을 확인할 수 없습니다. 운영자에게 문의해주세요.');
    }
    const ticketId = rpg().getDataCache('Item', []).findIndex(item => item?.name === destination.ticket);
    rpg().removeInventoryItem(user, ticketId, destination.cost);
    user.dispatch = run;
    await rpg().commitProtectedUserChange(user, ['dispatch', 'inventory', 'boundItems']);
}

async function complete(id, now = Date.now()) {
    const seed = await rpg().getUserByPrimaryId(id);
    if (!active(seed) || seed.dispatch.endsAt > now) return seed;
    return rpg().enqueueFieldAction(seed, async () => {
        const user = await rpg().getUserByPrimaryId(id);
        if (!active(user) || user.dispatch.endsAt > now) return user;
        const run = user.dispatch;
        if (run.destination === 'hell') {
            run.rewardItems = [];
            run.result = rpg().grantHellRewards(user, .10, run.rewardItems).filter(line => line.startsWith('- ')).map(line => line.slice(2));
        } else {
            paradise.grantBaseRewards(user, run.rewards);
            paradise.recordWeeklyFloor(user, run.floor, new Date(run.endsAt));
            run.result = run.rewards.map(reward => (reward.name || reward.type) + ' ×' + reward.count.toLocaleString('ko-KR'));
        }
        run.status = 'completed';
        run.completedAt = run.endsAt;
        // Rewards and completion are one conditional transaction. A retry cannot award the same run twice.
        await rpg().getCharacterStore().commit([user]);
        return user;
    });
}

function settleDue(now = Date.now()) {
    if (work) return now > workUntil ? work.then(() => settleDue(now)) : work;
    workUntil = now;
    work = (async () => {
        if (!await rpg().isRuntimeReady()) return;
        const pending = await rpg().getActiveDispatches();
        let failure;
        for (const entry of pending) if (entry.endsAt <= now) {
            try { await complete(entry.id, now); } catch (error) { failure ||= error; }
        }
        if (failure) throw failure;
    })().finally(() => { work = null; });
    return work;
}

function startScheduler() {
    if (timer) return;
    const tick = () => {
        if (Date.now() < retryAt) return;
        settleDue().catch(error => { retryAt = Date.now() + 60000; console.error('[dispatch]', error.message); });
    };
    timer = setInterval(tick, 1000); timer.unref();
    setImmediate(tick);
}

function registerDispatchRoutes(server, { requireUser, itemIcon, rewardView }) {
    const state = user => {
        const result = view(user), items = rpg().getDataCache('Item', []);
        result.destinations.forEach(dest => { dest.ticketIcon = itemIcon(items.find(item => item?.name === dest.ticket)); });
        if (result.run?.status === 'completed') {
            const rewards = result.run.rewardItems || (result.run.destination === 'heaven'
                ? result.run.rewards.map(reward => ({ kind: reward.type === '아이템' ? 'item' : reward.type === '경험치' ? 'exp' : 'currency', name: reward.name || reward.type, count: reward.count }))
                : result.run.result || []);
            result.run = { ...result.run, rewardItems: rewards.map(rewardView) };
        }
        return result;
    };
    server.get('/api/dispatch', requireUser, async (req, res, next) => {
        try {
            const user = await rpg().getRPGUserByName(req.session.name);
            res.json(state(await complete(user.id)));
        } catch (error) { next(error); }
    });
    server.post('/api/dispatch/start', requireUser, async (req, res) => {
        try {
            const seed = await rpg().getRPGUserByName(req.session.name);
            await rpg().enqueueFieldAction(seed, async () => {
                const user = await complete(seed.id);
                await start(user, req.body || {});
                res.json(state(user));
            });
        } catch (error) {
            if (!error.status) console.error('[dispatch start]', error.message);
            res.status(error.status || 503).json({ error: error.status ? error.message : '출발 저장을 확인하지 못했습니다. 같은 요청으로 재시도해주세요.', retryable: !error.status });
        }
    });
    startScheduler();
}

module.exports = { active, floorForPower, view, start, complete, settleDue, registerDispatchRoutes };
