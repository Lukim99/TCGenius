'use strict';

// 추석 이벤트와 기존 아이템 처리가 사용하는 인벤토리 잠금은 유지한다.
const inventoryLocks = new Set();

function registerYutRoutes(server, { requireUser }) {
    const ended = (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.status(410).json({ error: '윷놀이 이벤트가 종료되었습니다. 포인트 광산을 이용해주세요.' });
    };
    server.get('/api/yut', requireUser, ended);
    server.post('/api/yut/roll', requireUser, ended);
}

module.exports = { registerYutRoutes, inventoryLocks };
