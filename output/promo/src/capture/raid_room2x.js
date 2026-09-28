// Forms a real 5-player raid party (showcase + 4 rivals) for 흑화 호두 and screenshots the ready room.
const path = require('path');
const fs = require('fs');
const { open, settle } = require('./browser');

const MEMBERS = [['별빛사냥꾼', 'RIVAL0', '탱커'], ['새벽달', 'RIVAL1', '서포터'], ['코인요정', 'RIVAL2', '서브딜러'], ['딜러의귀환', 'RIVAL3', '브루저']];
(async () => {
    const lead = await open({ scale: 2, width: 520, height: 780 });
    const post = (pg, p, b) => pg.evaluate(async ([p, b]) => { const r = await fetch(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }); return r.json(); }, [p, b]);
    const get = (pg, p) => pg.evaluate(async p => (await fetch(p)).json(), p);
    console.log('create', JSON.stringify(await post(lead.page, '/api/party/rooms', { questId: 'blackHodu' })).slice(0, 200));
    const rooms = await get(lead.page, '/api/party/rooms');
    const roomId = (rooms.rooms || rooms || [])[0] && ((rooms.rooms || rooms)[0].id);
    console.log('room', roomId);
    console.log('lead pos', JSON.stringify(await post(lead.page, '/api/party/position', { position: '메인딜러' })).slice(0, 120));
    const others = [];
    for (const [name, code, pos] of MEMBERS) {
        const s = await open({ scale: 1, name, code });
        others.push(s);
        console.log(name, 'join', JSON.stringify(await post(s.page, '/api/party/rooms/' + roomId + '/join', {})).slice(0, 120));
        console.log(name, 'pos', JSON.stringify(await post(s.page, '/api/party/position', { position: pos })).slice(0, 120));
        console.log(name, 'ready', JSON.stringify(await post(s.page, '/api/party/ready', { ready: true })).slice(0, 120));
    }
    for (const s of others) { await s.page.goto(s.BASE + '/party'); }
    console.log('lead ready', JSON.stringify(await post(lead.page, '/api/party/ready', { ready: true })).slice(0, 120));
    await lead.page.goto(lead.BASE + '/party');
    await settle(lead.page, 1500);
    const out = path.join(__dirname, '..', 'assets', 'shots_extra');
    fs.mkdirSync(out, { recursive: true });
    await lead.page.screenshot({ path: path.join(out, 'raid_room2x.png') });
    await Promise.all(others.map(s => s.browser.close()));
    await lead.browser.close();
})().catch(e => { console.error(e); process.exit(1); });
