'use strict';

const crypto = require('node:crypto');
const pointUsage = require('./point_usage');
const { inventoryLocks } = require('./yut_event');
const { PETS } = require('./personal_draw_content');
const fail = (status, message, extra = {}) => { throw Object.assign(new Error(message), { status, ...extra }); };
const nonnegative = n => Number.isSafeInteger(n) && n >= 0;

function validateConfig(config) {
    const bad = () => fail(503, '퍼스널뽑기 운영 설정을 확인 중입니다.');
    if (!config || typeof config.active !== 'boolean' || !['singleCost', 'shakeCost', 'refreshCost'].every(key => nonnegative(config[key])) || !Array.isArray(config.rewards) || !config.rewards.length) bad();
    if (new Set(config.rewards.map(r => r?.id)).size !== config.rewards.length) bad();
    for (const r of config.rewards) {
        if (!r || !/^[a-z0-9_-]{1,40}$/.test(r.id) || !['item', 'pet'].includes(r.type) || !['first', 'upper', 'normal'].includes(r.grade) || typeof r.name !== 'string' || !nonnegative(r.stock) || r.stock < 1 || !nonnegative(r.count) || r.count < 1) bad();
        if (r.type === 'pet' && (r.count !== 1 || !['레전더리', '유니크', '레어'].includes(r.rarity))) bad();
    }
    if (config.rewards.reduce((n, r) => n + r.stock, 0) !== 100) bad();
    return config;
}

function shuffle(pool, random) {
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool;
}
function newBoard(config, random) {
    return { rewards: structuredClone(config.rewards), cells: shuffle(config.rewards.flatMap(r => Array(r.stock).fill(r.id)), random), opened: {} };
}
function planShake(unopened, random) {
    const baseCount = Math.min(5, unopened.length);
    let count = baseCount;
    while (count < unopened.length && random() < .2) count++;
    return { baseCount, indices: shuffle([...unopened], random).slice(0, count) };
}

function registerPersonalDrawRoutes(server, { rpgenius: rpg, requireUser, serializeItemUse = handler => handler, getPetIconUrl, getItemDisplayAssets, random = () => crypto.randomInt(0x100000000) / 0x100000000 }) {
    const config = () => validateConfig(rpg.getDataCache('PersonalDraw', null));
    const stateOf = user => user.personalDraw || { revision: 0, board: null, lastAction: null };
    const petNames = new Set(PETS.map(pet => pet.name));
    const petPool = rarity => rpg.getDataCache('Pet', []).map((pet, id) => ({ pet, id })).filter(({ pet }) => pet && pet.rarity === rarity && petNames.has(pet.name));
    const itemId = name => rpg.getDataCache('Item', []).findIndex(item => item?.name === name);
    function icon(reward) {
        if (reward.type === 'pet') return getPetIconUrl(petPool(reward.rarity)[0]?.pet);
        return getItemDisplayAssets(rpg.getDataCache('Item', [])[itemId(reward.name)])?.iconUrl;
    }
    const withCurrentIcon = result => ({ ...result, iconUrl: result.type === 'pet'
        ? getPetIconUrl(rpg.getDataCache('Pet', [])[result.id])
        : getItemDisplayAssets(rpg.getDataCache('Item', [])[result.id])?.iconUrl });
    function status(user, definition) {
        const state = stateOf(user), board = state.board;
        const opened = Object.fromEntries(Object.entries(board?.opened || {}).map(([index, result]) => [index, withCurrentIcon(result)]));
        return { revision: state.revision, active: definition.active, point: Number(user.point || 0),
            costs: { single: definition.singleCost, shake: definition.shakeCost, refresh: definition.refreshCost },
            remaining: 100 - Object.keys(opened).length, opened,
            lastAction: state.lastAction ? { ...state.lastAction, results: state.lastAction.results.map(withCurrentIcon) } : null,
            rewards: (board?.rewards || definition.rewards).map(reward => ({ ...reward, iconUrl: icon(reward),
                remaining: reward.stock - Object.values(opened).filter(result => result.rewardId === reward.id).length,
                ...(reward.type === 'pet' ? { pool: petPool(reward.rarity).map(({ pet }) => pet.name) } : {})
            })) };
    }
    async function save(user) {
        const saved = await user.save();
        if (!saved?.success) fail(503, '저장을 확인 중입니다. 같은 요청으로 결과를 다시 확인해주세요.', { retry: true });
    }
    server.get('/api/personal-draw', requireUser, async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        try {
            const user = await rpg.getRPGUserByName(req.session.name);
            if (!user) fail(404, '유저를 찾을 수 없습니다.');
            if (user.personalDraw?.lastAction) await save(user);
            res.json(status(user, config()));
        } catch (error) { res.status(error.status || 503).json({ error: error.status ? error.message : '퍼스널뽑기를 불러오지 못했습니다.' }); }
    });
    for (const action of ['single', 'shake', 'refresh']) server.post('/api/personal-draw/' + action, requireUser, serializeItemUse(async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        try {
            const input = req.body || {};
            if (!/^[a-zA-Z0-9-]{16,80}$/.test(input.requestId || '') || !nonnegative(input.revision) || !nonnegative(input.expectedCost)) fail(400, '올바르지 않은 뽑기 요청입니다.');
            const seed = await rpg.getRPGUserByName(req.session.name);
            if (!seed) fail(404, '유저를 찾을 수 없습니다.');
            const response = await rpg.enqueueFieldAction(seed, async () => {
                if (inventoryLocks.has(seed.name)) fail(409, '아이템을 처리 중입니다. 잠시 후 다시 이용해주세요.');
                inventoryLocks.add(seed.name);
                try {
                    const user = await rpg.getRPGUserByName(seed.name), definition = config();
                    const previous = stateOf(user);
                    if (previous.lastAction) await save(user);
                    if (previous.lastAction?.requestId === input.requestId) {
                        if (previous.lastAction.action !== action || action === 'single' && previous.lastAction.index !== input.index) fail(409, '다른 행동에 사용된 요청입니다.', { refresh: true });
                        return { ...status(user, definition), replayed: true };
                    }
                    if (!definition.active) fail(410, '퍼스널뽑기 이벤트가 종료되었습니다.');
                    if (previous.revision !== input.revision) fail(409, '다른 화면에서 진행한 기록을 불러옵니다.', { refresh: true });
                    const blocked = rpg.getWebGameActionBlock(user);
                    if (blocked) fail(409, blocked);
                    const cost = definition[action + 'Cost'];
                    if (input.expectedCost !== cost) fail(409, '이용 비용이 변경되었습니다. 최신 비용을 확인해주세요.', { refresh: true });
                    if (Number(user.point || 0) < cost) fail(400, '포인트가 부족합니다.');
                    const state = structuredClone(previous);
                    if (!state.board || action === 'refresh') state.board = newBoard(definition, random);
                    const board = state.board;
                    const unopened = board.cells.map((_, index) => index).filter(index => !Object.hasOwn(board.opened, index));
                    let indices = [], baseCount = 0;
                    if (action === 'single') {
                        if (!Number.isInteger(input.index) || !unopened.includes(input.index)) fail(400, '아직 열지 않은 칸을 선택해주세요.');
                        indices = [input.index]; baseCount = 1;
                    } else if (action === 'shake') {
                        if (!unopened.length) fail(400, '모든 칸을 열었습니다. 판을 새로고침해주세요.');
                        ({ indices, baseCount } = planShake(unopened, random));
                    }
                    // 지급 가능한지 모두 확인한 뒤 차감한다. 숨겨진 칸/추첨값은 응답에 포함하지 않는다.
                    const results = indices.map((index, i) => {
                        const reward = board.rewards.find(r => r.id === board.cells[index]);
                        if (!reward) fail(503, '보상 정보를 확인 중입니다.');
                        let id, name = reward.name, rarity = reward.rarity, iconUrl = icon(reward);
                        if (reward.type === 'pet') {
                            const pool = petPool(reward.rarity);
                            if (!pool.length) fail(503, '해당 등급의 펫이 등록되지 않았습니다.');
                            const chosen = pool[Math.floor(random() * pool.length)];
                            id = chosen.id; name = chosen.pet.name; iconUrl = getPetIconUrl(chosen.pet);
                        } else {
                            id = itemId(reward.name);
                            if (id < 0) fail(503, '보상 재료가 등록되지 않았습니다.');
                        }
                        return { index, rewardId: reward.id, type: reward.type, id, name, rarity: rarity || '재료', count: reward.count, grade: reward.grade, bonus: i >= baseCount, iconUrl };
                    });
                    user.point = Number(user.point || 0) - cost;
                    for (const result of results) {
                        if (result.type === 'pet') rpg.addPetInventory(user, result.id);
                        else rpg.addInventoryItem(user, result.id, result.count);
                        board.opened[result.index] = result;
                    }
                    state.revision++;
                    state.lastAction = { requestId: input.requestId, action, ...(action === 'single' ? { index: input.index } : {}), cost, baseCount, results, at: Date.now() };
                    pointUsage.record(user, { amount: cost, category: 'personal_draw', action, productId: action,
                        productName: { single: '퍼스널뽑기 · 한 칸', shake: '퍼스널뽑기 · 흔들기', refresh: '퍼스널뽑기 · 새로고침' }[action],
                        details: { requestId: input.requestId, revision: state.revision, selectedIndex: action === 'single' ? input.index : null,
                            openedCount: results.length, baseCount, bonusCount: results.length - baseCount,
                            rewards: results.map(({ type, id, name, count, bonus }) => ({ type, id, name, count, bonus })) } });
                    user.personalDraw = state;
                    await save(user);
                    return status(user, definition);
                } finally { inventoryLocks.delete(seed.name); }
            });
            res.json(response);
        } catch (error) {
            if (!error.status) console.error('[personal-draw]', error.message);
            res.status(error.status || 503).json({ error: error.status ? error.message : '결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.', ...(error.retry || !error.status ? { retry: true } : {}), ...(error.refresh ? { refresh: true } : {}) });
        }
    }));
}
module.exports = { validateConfig, newBoard, planShake, registerPersonalDrawRoutes };
