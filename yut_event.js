const crypto = require('crypto');

const ITEM_NAME = '윷';
const COST = 4;
// 송편 사용과 윷 던지기는 같은 인벤토리를 바꾸므로 잠금을 공유한다.
const inventoryLocks = new Set();
const REWARD_NAMES = [
    '장비 보호권', '고급 장비 보호권', '7성 전직 카드팩', '8성 카드팩',
    '8성 보호 카드', '8성 전직 카드팩', '9성 카드팩', '9성 보호 카드',
    '9성 전직 카드팩', '제타 카드팩', '5성 카드팩'
];
// 0: 출발 대기, 1~20: 바깥길, 21~28: 대각선, 29: 중앙.
// 모서리/중앙에 정확히 도착한 다음 던지기부터 지름길을 탄다.
const NEXT = { 21: 22, 22: 29, 23: 24, 24: 15, 25: 26, 26: 29, 27: 28, 28: 20 };
function advance(position, steps) {
    let node = position;
    let diagonalExit = position === 29 || position === 25 || position === 26 ? 27 : 23;
    const path = [];
    for (let i = 0; i < steps; i++) {
        if (i === 0 && node === 5) node = 21;
        else if (i === 0 && node === 10) { node = 25; diagonalExit = 27; }
        else if (node === 29) node = diagonalExit;
        else if (NEXT[node]) node = NEXT[node];
        else if (node === 20) { path.push(0); return { position: 0, path, finished: true }; }
        else node++;
        path.push(node);
    }
    return { position: node, path, finished: false };
}

function rollSticks() {
    const faces = Array.from({ length: 4 }, () => crypto.randomInt(2));
    const flat = faces.reduce((a, b) => a + b, 0);
    return { faces, steps: flat || 5, name: ['모', '도', '개', '걸', '윷'][flat] };
}

function getState(user) {
    return { bonusRoll: false, ...(user.yutEvent || { position: 0, laps: 0, revision: 0, lastRoll: null }) };
}

function registerYutRoutes(server, { rpgenius, requireUser, getItemDisplayAssets }) {
    const locks = inventoryLocks;
    function status(user) {
        const state = getState(user);
        const items = rpgenius.getDataCache('Item', []);
        const itemId = items.findIndex(item => item && item.name === ITEM_NAME);
        const rewards = REWARD_NAMES.map((name, i) => {
            const id = items.findIndex(item => item && item.name === name);
            return { lap: i + 1, name, count: 1, available: id >= 0, ...getItemDisplayAssets(items[id]) };
        });
        return {
            ...state, cost: state.bonusRoll ? 0 : COST, itemName: ITEM_NAME,
            itemIcon: '/item-image?dir=%EC%9D%B4%EB%B2%A4%ED%8A%B8&file=%EC%9C%B7.png',
            itemCount: itemId >= 0 ? rpgenius.getInventoryItemCount(user, itemId) : 0,
            ready: itemId >= 0 && rewards.every(reward => reward.available), rewards
        };
    }
    async function adminUser(req, res) {
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) { res.status(404).json({ error: '유저를 찾을 수 없습니다.' }); return null; }
        if (!user.isAdmin) { res.status(403).json({ error: '관리자만 이용할 수 있습니다.' }); return null; }
        return user;
    }
    server.get('/api/yut', requireUser, async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        try {
            const user = await adminUser(req, res);
            if (user) res.json(status(user));
        } catch (error) {
            console.error('[yut] status:', error.message);
            res.status(500).json({ error: '윷놀이 정보를 불러오지 못했습니다.' });
        }
    });
    server.post('/api/yut/roll', requireUser, async (req, res) => {
        const key = req.session.name;
        if (locks.has(key)) return res.status(409).json({ error: '윷 또는 송편을 처리하고 있습니다. 잠시 후 다시 확인해 주세요.' });
        locks.add(key);
        try {
            const user = await adminUser(req, res);
            if (!user) return;
            const { requestId, revision } = req.body || {};
            if (typeof requestId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(requestId) || !Number.isSafeInteger(revision) || revision < 0) {
                return res.status(400).json({ error: '올바르지 않은 던지기 요청입니다.' });
            }
            const state = getState(user);
            const cost = state.bonusRoll ? 0 : COST;
            if (state.lastRoll && state.lastRoll.requestId === requestId) {
                // 저장 응답이 유실되거나 캐시 flush가 실패해 재시도해도 추가 차감하지 않는다.
                const saved = await user.save();
                if (!saved || !saved.success) return res.status(503).json({ error: '저장을 확인하고 있습니다. 같은 던지기를 다시 확인해 주세요.', retry: true });
                return res.json({ ...status(user), replayed: true });
            }
            if (revision !== state.revision) return res.status(409).json({ error: '다른 화면에서 진행한 기록이 있습니다. 최신 기록을 불러와 주세요.', refresh: true });
            const items = rpgenius.getDataCache('Item', []);
            const itemId = items.findIndex(item => item && item.name === ITEM_NAME);
            const rewardName = REWARD_NAMES[Math.min(state.laps, 10)];
            const rewardId = items.findIndex(item => item && item.name === rewardName);
            if (itemId < 0 || rewardId < 0) return res.status(503).json({ error: '윷 또는 완주 보상 아이템이 등록되지 않았습니다.' });
            if (rpgenius.getInventoryItemCount(user, itemId) < cost) return res.status(400).json({ error: '윷이 부족합니다. 던지기에 4개가 필요합니다.' });
            const roll = rollSticks();
            const movement = advance(state.position, roll.steps);
            const reward = movement.finished ? { name: rewardName, count: 1, ...getItemDisplayAssets(items[rewardId]) } : null;
            if (cost > 0 && !rpgenius.removeInventoryItem(user, itemId, cost)) return res.status(409).json({ error: '윷 보유 수량이 변경되었습니다.', refresh: true });
            if (reward) rpgenius.addInventoryItem(user, rewardId, 1);
            user.yutEvent = {
                position: movement.position, laps: state.laps + (movement.finished ? 1 : 0), revision: state.revision + 1,
                bonusRoll: roll.steps >= 4,
                lastRoll: { ...roll, ...movement, from: state.position, requestId, reward, cost, bonusAwarded: roll.steps >= 4, at: Date.now() }
            };
            // 차감, 이동, 완주 횟수, 보상을 같은 유저 레코드에 한 번에 저장한다.
            const saved = await user.save();
            if (!saved || !saved.success) return res.status(503).json({ error: '저장을 확인하고 있습니다. 같은 던지기를 다시 확인해 주세요.', retry: true });
            res.json(status(user));
        } catch (error) {
            console.error('[yut] roll:', error.message);
            res.status(500).json({ error: '던지기 결과를 확인하지 못했습니다. 다시 확인해 주세요.', retry: true });
        } finally {
            locks.delete(key);
        }
    });
}

module.exports = { ITEM_NAME, COST, REWARD_NAMES, advance, rollSticks, registerYutRoutes, inventoryLocks };
