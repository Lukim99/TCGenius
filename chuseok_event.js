'use strict';

const { inventoryLocks } = require('./yut_event');
const START_AT = Date.parse('2026-09-25T00:00:00+09:00');
const END_AT = Date.parse('2026-09-26T00:00:00+09:00');
const REWARD_NAME = '[추석]5성 전직 카드팩';

function isChuseokDay(now = Date.now()) {
    return now >= START_AT && now < END_AT;
}

// 일반 사냥 카드팩 상자만 기본 3% → 5%. 장비·레벨 보정은 호출부에서 유지한다.
function regularCardPackBaseChance(now = Date.now()) {
    return isChuseokDay(now) ? 0.05 : 0.03;
}

function registerChuseokRoutes(server, { rpgenius: rpg, requireUser, now = Date.now }) {
    function status(user) {
        const time = now();
        return { active: isChuseokDay(time), seen: !!user.chuseok2026?.seenAt,
            claimed: !!user.chuseok2026?.claimedAt, serverNow: time, endsAt: END_AT,
            reward: { name: REWARD_NAME, count: 1 } };
    }
    function route(method, path, action) {
        server[method]('/api/event/chuseok' + path, requireUser, async (req, res) => {
            res.setHeader('Cache-Control', 'no-store');
            try {
                const seed = await rpg.getRPGUserByName(req.session.name);
                if (!seed) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
                const result = await rpg.enqueueFieldAction(seed, async () => {
                    // 웹/채팅/사냥은 계정 큐, 윷·송편은 공유 인벤토리 잠금으로 직렬화한다.
                    if (inventoryLocks.has(seed.name)) throw Object.assign(new Error('아이템을 처리 중입니다. 잠시 후 다시 눌러주세요.'), { status: 409 });
                    inventoryLocks.add(seed.name);
                    try {
                        const user = await rpg.getRPGUserByName(req.session.name);
                        if (!user) throw Object.assign(new Error('유저를 찾을 수 없습니다.'), { status: 404 });
                        return await action(user);
                    } finally { inventoryLocks.delete(seed.name); }
                });
                res.json(result);
            } catch (error) {
                if (!error.status) console.error('[chuseok]', error.message);
                res.status(error.status || 503).json({ error: error.status ? error.message : '저장을 확인하지 못했습니다. 잠시 후 다시 눌러주세요.' });
            }
        });
    }
    const save = async user => {
        const result = await user.save();
        if (!result?.success) throw new Error('Chuseok user save failed');
    };
    const requireActive = () => {
        if (!isChuseokDay(now())) throw Object.assign(new Error('추석 선물은 9월 25일에만 받을 수 있습니다.'), { status: 410 });
    };
    route('get', '', user => status(user));
    route('post', '/enter', async user => {
        requireActive();
        const showIntro = !user.chuseok2026?.seenAt && !user.chuseok2026?.claimedAt;
        if (showIntro) user.chuseok2026 = { seenAt: now() };
        await save(user);
        return { ...status(user), showIntro };
    });
    route('post', '/claim', async user => {
        // 날짜가 바뀌어도 이미 처리한 지급의 재확인은 허용한다. 새 지급은 금지한다.
        if (user.chuseok2026?.claimedAt) {
            await save(user);
            return { ...status(user), replayed: true };
        }
        requireActive();
        if (!user.chuseok2026?.seenAt) throw Object.assign(new Error('추석 화면을 먼저 열어주세요.'), { status: 409 });
        const items = rpg.getDataCache('Item', []);
        const id = items.findIndex(item => item?.name === REWARD_NAME);
        if (id < 0) throw Object.assign(new Error('선물을 준비 중입니다. 잠시 후 다시 눌러주세요.'), { status: 503 });
        rpg.addInventoryItem(user, id, 1);
        user.chuseok2026 = { ...user.chuseok2026, claimedAt: now() };
        // 아이템과 수령 기록을 같은 유저 레코드에 저장. 실패 시 캐시의 기록을 보존해 재지급을 막는다.
        await save(user);
        return { ...status(user), replayed: false };
    });
}

module.exports = { START_AT, END_AT, REWARD_NAME, isChuseokDay, regularCardPackBaseChance, registerChuseokRoutes };
