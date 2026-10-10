const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const express = require('express');
const { registerYutRoutes } = require('../yut_event');
let server, base;
before(async () => {
    const app = express(); app.use(express.json());
    registerYutRoutes(app, { requireUser(req, res, next) { if (!req.headers.authorization) return res.status(401).json({ error: '로그인 필요' }); next(); }, rpgenius: {
        getRPGUserByName() { throw new Error('종료된 이벤트는 유저나 인벤토리를 변경하면 안 됩니다.'); }
    } });
    server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    base = 'http://127.0.0.1:' + server.address().port;
});
after(() => new Promise(resolve => server.close(resolve)));
test('종료된 윷놀이 조회·던지기는 로그인 후에도 410이며 아이템과 기록에 접근하지 않는다', async () => {
    for (const [path, method] of [['/api/yut', 'GET'], ['/api/yut/roll', 'POST']]) {
        assert.equal((await fetch(base + path, { method })).status, 401);
        const response = await fetch(base + path, { method, headers: { Authorization: 'user' } });
        assert.equal(response.status, 410);
        assert.match((await response.json()).error, /종료/);
    }
});
