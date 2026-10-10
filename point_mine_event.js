'use strict';

const crypto = require('crypto');
const { KEY_NAME } = require('./point_mine_config');
const { inventoryLocks } = require('./yut_event');
const positive = value => Number.isSafeInteger(value) && value > 0;
const fail = (status, message, extra = {}) => { throw Object.assign(new Error(message), { status, ...extra }); };

function validateConfig(config) {
    const invalid = () => fail(503, '광산 운영 설정을 확인 중입니다. 잠시 후 다시 이용해주세요.');
    if (!config || typeof config.active !== 'boolean' || !positive(config.mineIntervalMs) || !Array.isArray(config.pickaxes) || !config.pickaxes.length || !Array.isArray(config.ores) || !config.ores.length || !Array.isArray(config.rewards)) invalid();
    const unique = entries => entries.every(entry => entry && typeof entry.id === 'string' && /^[a-zA-Z0-9_-]{1,60}$/.test(entry.id) && typeof entry.name === 'string') && new Set(entries.map(entry => entry.id)).size === entries.length;
    if (![config.pickaxes, config.ores, config.rewards].every(unique)) invalid();
    const oreIds = new Set(config.ores.map(ore => ore.id));
    const pickaxeIds = new Set(config.pickaxes.map(pickaxe => pickaxe.id));
    for (const ore of config.ores) {
        if (!positive(ore.value) || !Number.isFinite(ore.weight) || ore.weight <= 0 || !Number.isInteger(ore.spriteIndex) || ore.spriteIndex < 0 || ore.spriteIndex > 15 || !(Number.isInteger(ore.minRank) && ore.minRank >= 0 || pickaxeIds.has(ore.exactPickaxe)) || ore.blockedPickaxe && !pickaxeIds.has(ore.blockedPickaxe)) invalid();
    }
    for (const pickaxe of config.pickaxes) {
        if (!positive(pickaxe.durability) || !Number.isFinite(pickaxe.weight) || pickaxe.weight <= 0 || !Number.isInteger(pickaxe.rank) || pickaxe.rank < 0 || !Number.isInteger(pickaxe.spriteIndex) || pickaxe.spriteIndex < 0 || pickaxe.spriteIndex > 15 || !Array.isArray(pickaxe.repair) || new Set(pickaxe.repair.map(cost => cost.oreId)).size !== pickaxe.repair.length || pickaxe.repair.some(cost => !oreIds.has(cost.oreId) || !positive(cost.count))) invalid();
        if (!oreDistribution(config, pickaxe).length) invalid();
    }
    if (config.rewards.some(reward => !positive(reward.count) || !positive(reward.cost) || !Number.isSafeInteger(reward.limit) || reward.limit < 0)) invalid();
    return config;
}

function oreDistribution(config, pickaxe) {
    return config.ores.filter(ore => ore.exactPickaxe ? ore.exactPickaxe === pickaxe.id : pickaxe.rank >= ore.minRank && ore.blockedPickaxe !== pickaxe.id)
        .map(ore => ({ ...ore, weight: ore.weight * 0.9 ** Math.pow(Math.max(pickaxe.rank - (ore.minRank ?? pickaxe.rank), 0), 2) }));
}

function draw(entries, random) {
    let roll = random() * entries.reduce((sum, entry) => sum + entry.weight, 0);
    return entries.find(entry => (roll -= entry.weight) < 0) || entries.at(-1);
}

function getState(user) {
    return user.pointMine || { revision: 0, pickaxes: [], equippedUid: null, ores: {}, points: 0, exchanges: {}, totalMined: 0, nextMineAt: 0, lastAction: null };
}

function registerPointMineRoutes(server, { rpgenius: rpg, requireUser, getItemDisplayAssets, serializeItemUse = handler => handler, now = Date.now, random = () => crypto.randomInt(0x100000000) / 0x100000000 }) {
    const configuration = () => validateConfig(rpg.getDataCache('PointMine', null));
    const keyId = () => rpg.getDataCache('Item', []).findIndex(item => item?.name === KEY_NAME);
    function status(user, config) {
        const state = getState(user);
        const items = rpg.getDataCache('Item', []);
        const equipped = state.pickaxes.find(pickaxe => pickaxe.uid === state.equippedUid);
        const definition = config.pickaxes.find(pickaxe => pickaxe.id === equipped?.id);
        const distribution = definition ? oreDistribution(config, definition) : [];
        const totalWeight = distribution.reduce((sum, ore) => sum + ore.weight, 0);
        const totalChestWeight = config.pickaxes.reduce((sum, pickaxe) => sum + pickaxe.weight, 0);
        const id = keyId();
        return { ...state, active: config.active, serverNow: now(), keyName: KEY_NAME, keyCount: id >= 0 ? rpg.getInventoryItemCount(user, id) : 0, keyIcon: '/static/assets/point-mine/key.png',
            ready: id >= 0, mineIntervalMs: config.mineIntervalMs,
            pickaxeTypes: config.pickaxes.map(pickaxe => ({ ...pickaxe, chance: pickaxe.weight / totalChestWeight })),
            ores: config.ores.map(ore => ({ ...ore, count: state.ores[ore.id] || 0, chance: (distribution.find(entry => entry.id === ore.id)?.weight || 0) / (totalWeight || 1) })),
            rewards: config.rewards.map(reward => { const itemId = items.findIndex(item => item?.name === reward.name); return { ...reward, available: itemId >= 0, exchanged: state.exchanges[reward.id] || 0, ...getItemDisplayAssets(items[itemId]) }; }) };
    }
    async function save(user) {
        const result = await user.save();
        if (!result?.success) fail(503, '결과 저장을 확인 중입니다. 같은 요청을 다시 확인해주세요.', { retry: true });
    }
    server.get('/api/point-mine', requireUser, async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        try {
            const user = await rpg.getRPGUserByName(req.session.name);
            if (!user) fail(404, '유저를 찾을 수 없습니다.');
            if (user.pointMine?.lastAction) await save(user);
            res.json(status(user, configuration()));
        } catch (error) { res.status(error.status || 503).json({ error: error.status ? error.message : '광산 정보를 불러오지 못했습니다.' }); }
    });
    for (const action of ['open', 'equip', 'mine', 'repair', 'sell', 'exchange']) {
        server.post('/api/point-mine/' + action, requireUser, serializeItemUse(async (req, res) => {
            res.setHeader('Cache-Control', 'no-store');
            try {
                const request = req.body || {};
                if (typeof request.requestId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(request.requestId) || !Number.isSafeInteger(request.revision) || request.revision < 0) fail(400, '올바르지 않은 광산 요청입니다.');
                const seed = await rpg.getRPGUserByName(req.session.name);
                if (!seed) fail(404, '유저를 찾을 수 없습니다.');
                const response = await rpg.enqueueFieldAction(seed, async () => {
                    if (inventoryLocks.has(seed.name)) fail(409, '아이템을 처리 중입니다. 잠시 후 다시 이용해주세요.');
                    inventoryLocks.add(seed.name);
                    try {
                        const user = await rpg.getRPGUserByName(req.session.name);
                        if (!user) fail(404, '유저를 찾을 수 없습니다.');
                        const config = configuration();
                        const previous = getState(user);
                        // 캐시에서 보존한 직전 실패도 먼저 저장한다. 새 행동으로 덮어쓰지 않는다.
                        if (previous.lastAction) await save(user);
                        if (previous.lastAction?.requestId === request.requestId) {
                            if (previous.lastAction.action !== action) fail(409, '다른 행동에 사용된 요청입니다.', { refresh: true });
                            return { ...status(user, config), replayed: true };
                        }
                        if (!config.active) fail(410, '포인트 광산 이벤트가 종료되었습니다.');
                        if (request.revision !== previous.revision) fail(409, '다른 화면에서 진행한 기록이 있습니다. 최신 기록을 불러와주세요.', { refresh: true });
                        const state = structuredClone(previous);
                        const pickaxe = state.pickaxes.find(entry => entry.uid === (action === 'mine' ? state.equippedUid : request.uid));
                        const definition = config.pickaxes.find(entry => entry.id === pickaxe?.id);
                        let result;
                        if (action === 'open') {
                            const id = keyId();
                            if (id < 0) fail(503, '곡괭이 상자 열쇠가 등록되지 않았습니다.');
                            if (rpg.getInventoryItemCount(user, id) < 1) fail(400, '곡괭이 상자 열쇠가 부족합니다. 필드 사냥으로 획득해주세요.');
                            const type = draw(config.pickaxes, random);
                            const tool = { uid: crypto.randomUUID(), id: type.id, durability: type.durability, maxDurability: type.durability };
                            state.pickaxes.push(tool);
                            if (!state.pickaxes.some(entry => entry.uid === state.equippedUid && entry.durability > 0)) state.equippedUid = tool.uid;
                            if (!rpg.removeInventoryItem(user, id, 1)) fail(409, '열쇠 보유량이 변경되었습니다.', { refresh: true });
                            result = { pickaxe: tool, name: type.name };
                        } else if (['equip', 'mine', 'repair'].includes(action)) {
                            if (!pickaxe || !definition) fail(400, '곡괭이를 선택해주세요. 상자에서 곡괭이를 얻을 수 있습니다.');
                            if (action === 'equip') {
                                if (pickaxe.durability <= 0) fail(400, '내구도가 소진된 곡괭이입니다. 먼저 수리해주세요.');
                                state.equippedUid = pickaxe.uid;
                                result = { name: definition.name };
                            } else if (action === 'mine') {
                                if (pickaxe.durability <= 0) fail(400, '곡괭이 내구도가 소진되었습니다. 수리하거나 다른 곡괭이를 장착해주세요.');
                                if (now() < state.nextMineAt) fail(429, '채굴 중입니다. 잠시 후 다시 눌러주세요.');
                                const ore = draw(oreDistribution(config, definition), random);
                                state.ores[ore.id] = (state.ores[ore.id] || 0) + 1;
                                pickaxe.durability--;
                                state.totalMined++;
                                state.nextMineAt = now() + config.mineIntervalMs;
                                result = { oreId: ore.id, name: ore.name, count: 1, durability: pickaxe.durability };
                            } else {
                                const amount = request.amount;
                                if (!positive(amount) || amount > pickaxe.maxDurability - pickaxe.durability) fail(400, '수리할 내구도 수량을 확인해주세요.');
                                if (!definition.repair.length) fail(400, '이 곡괭이는 수리할 수 없습니다.');
                                const costs = definition.repair.map(cost => ({ ...cost, count: cost.count * amount }));
                                if (costs.some(cost => !positive(cost.count) || (state.ores[cost.oreId] || 0) < cost.count)) fail(400, '수리할 광물이 부족합니다.');
                                for (const cost of costs) state.ores[cost.oreId] -= cost.count;
                                pickaxe.durability += amount;
                                result = { name: definition.name, amount, costs };
                            }
                        } else if (action === 'sell') {
                            if (!Array.isArray(request.ores) || !request.ores.length || request.ores.length > config.ores.length || new Set(request.ores.map(ore => ore?.id)).size !== request.ores.length) fail(400, '포인트로 바꿀 광물을 선택해주세요.');
                            let points = 0;
                            for (const entry of request.ores) {
                                const ore = config.ores.find(ore => ore.id === entry?.id);
                                if (!ore || !positive(entry.count) || (state.ores[entry.id] || 0) < entry.count) fail(400, '광물 보유량과 수량을 확인해주세요.');
                                points += ore.value * entry.count;
                            }
                            if (!positive(points) || !Number.isSafeInteger(state.points + points)) fail(400, '교환할 광물 수량을 확인해주세요.');
                            for (const entry of request.ores) state.ores[entry.id] -= entry.count;
                            state.points += points;
                            result = { points };
                        } else {
                            const reward = config.rewards.find(entry => entry.id === request.rewardId);
                            if (!reward) fail(400, '교환할 보상을 선택해주세요.');
                            const redeemed = state.exchanges[reward.id] || 0;
                            if (reward.limit && redeemed >= reward.limit) fail(400, '이미 교환한 보상입니다.');
                            if (state.points < reward.cost) fail(400, '광산 포인트가 부족합니다.');
                            const id = rpg.getDataCache('Item', []).findIndex(item => item?.name === reward.name);
                            if (id < 0) fail(503, '보상 아이템을 확인 중입니다. 포인트는 소모되지 않았습니다.');
                            state.points -= reward.cost;
                            state.exchanges[reward.id] = redeemed + 1;
                            rpg.addInventoryItem(user, id, reward.count);
                            result = { name: reward.name, count: reward.count, ...getItemDisplayAssets(rpg.getDataCache('Item', [])[id]) };
                        }
                        state.revision++;
                        state.lastAction = { requestId: request.requestId, action, result, at: now() };
                        // 열쇠/보상 인벤토리와 광산 상태를 같은 유저 레코드로 저장한다.
                        user.pointMine = state;
                        await save(user);
                        return status(user, config);
                    } finally { inventoryLocks.delete(seed.name); }
                });
                res.json(response);
            } catch (error) {
                if (!error.status) console.error('[point-mine]', error.message);
                res.status(error.status || 503).json({ error: error.status ? error.message : '결과를 확인하지 못했습니다. 같은 요청을 다시 확인해주세요.', ...(error.retry || !error.status ? { retry: true } : {}), ...(error.refresh ? { refresh: true } : {}) });
            }
        }));
    }
}

module.exports = { registerPointMineRoutes, validateConfig, oreDistribution };
