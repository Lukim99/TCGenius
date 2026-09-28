// Deterministic frame capture of the real WebGL battle screens (1920x1080, 30 fps).
// The page clock is faked (Playwright clock): each output frame jumps exactly 1/30 s of game time and renders once,
// so the software-rendered WebGL (~4 s per 1080p frame here) still yields smooth, correctly timed footage.
// Server calls run in real time; we wait for each response before the next frame, so actions land instantly.
// Usage: node clips.js <clipName> ['{"json":"args"}']
const path = require('path');
const fs = require('fs');
const { open } = require('./browser');

const FPS = 30;
const OUT = path.join(__dirname, '..', 'assets', 'clips');

async function recorder(name, opts) {
    const dir = path.join(OUT, name);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const session = await open(Object.assign({ width: 1920, height: 1080, scale: 1 }, opts));
    const { page, context, BASE } = session;
    await page.clock.install({ time: Date.now() });
    const cdp = await context.newCDPSession(page);
    let n = 0, stepIndex = 0;
    const marks = [];
    const started = Date.now();
    // exact frame pacing: integer-ms deltas that average to 1000/FPS
    const nextStep = () => { const d = Math.round((stepIndex + 1) * 1000 / FPS) - Math.round(stepIndex * 1000 / FPS); stepIndex++; return d; };
    const rec = {
        page, BASE, session,
        async goto(url) {
            await page.goto(BASE + url, { waitUntil: 'load' });
            // Freeze page time: from here on, only runFor/fastForward move the game clock.
            await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1500));
            for (let k = 0; k < 8; k++) { await page.clock.runFor(150); await page.waitForTimeout(250); }
        },
        async frames(count, label) {
            if (label) marks.push({ frame: n, label });
            for (let i = 0; i < count; i++) {
                await page.clock.fastForward(nextStep());
                const r = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 93 });
                fs.writeFileSync(path.join(dir, String(n++).padStart(5, '0') + '.jpg'), Buffer.from(r.data, 'base64'));
            }
            console.log(name, 'frames', n, 'elapsed', ((Date.now() - started) / 1000) | 0, 's', label || '');
        },
        async skip(ms) { await page.clock.fastForward(ms); },
        async press(key, urlPart) {
            const wait = urlPart ? page.waitForResponse(r => r.url().includes(urlPart), { timeout: 20000 }).catch(() => null) : null;
            await page.keyboard.press(key);
            let ok = null;
            if (wait) {
                const res = await wait;
                if (res) { await res.finished().catch(() => {}); ok = await res.json().catch(() => null); }
                await page.waitForTimeout(150);
            }
            return ok;
        },
        async click(x, y) { await page.mouse.click(x, y); await page.waitForTimeout(120); },
        async get(apiPath) { return page.evaluate(async p => (await fetch(p)).json(), apiPath); },
        async post(apiPath, body) { return page.evaluate(async ([p, b]) => (await fetch(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) })).json(), [apiPath, body]); },
        async done() {
            fs.writeFileSync(path.join(dir, 'log.json'), JSON.stringify({ fps: FPS, frames: n, marks }, null, 1));
            await session.browser.close();
            console.log(name, 'DONE frames', n);
        }
    };
    return rec;
}

// Run a list of beats: press key, record `len` frames, then jump `gap` ms of game time (cooldowns) off-camera.
async function beats(rec, api, list, len = 30, gap = 3200) {
    for (const key of list) {
        const isAttack = key === ' ';
        const res = await rec.press(key, isAttack ? api + '/attack' : api + '/skill');
        const ok = res && res.ok !== false;
        await rec.frames(len, (isAttack ? 'attack' : 'skill' + key) + (ok ? '' : ':rejected'));
        await rec.skip(gap);
        await rec.frames(1);
    }
}

const CLIPS = {
    async field(args) {
        const rec = await recorder('field');
        await rec.goto('/field');
        for (const [x, y] of args.select || []) { await rec.click(x, y); await rec.frames(2); }
        await rec.frames(10, 'lobby');
        await rec.press('e', '/api/field/enter');
        await rec.frames(48, 'entry');
        await beats(rec, '/api/field', [' ', '1', ' ', '2', ' ', ' ', '1', ' ']);
        await rec.post('/api/field/leave');
        await rec.done();
    },
    async hfield() {
        const rec = await recorder('hfield');
        await rec.goto('/hfield');
        await rec.frames(8, 'lobby');
        await rec.press('e', '/api/hfield/enter');
        await rec.frames(72, 'entry');
        await beats(rec, '/api/hfield', [' ', '1', ' ', '2', ' ']);
        await rec.post('/api/hfield/leave');
        await rec.done();
    },
    async pvp(args) {
        const rec = await recorder('pvp');
        await rec.goto('/');
        const lobby = await rec.get('/api/pvp');
        const opponents = (lobby.daily && lobby.daily.opponents || []).map(o => o.name);
        const opponent = args.opponent || opponents[0];
        console.log('pvp opponents', opponents, '->', opponent);
        await rec.goto('/pvp?opponent=' + encodeURIComponent(opponent));
        await rec.frames(15, 'lobby');
        await rec.press('e', '/api/pvp/battle/start');
        await rec.frames(36, 'start');
        await beats(rec, '/api/pvp/battle', [' ', '1', ' ', '2', ' ']);
        await rec.done();
    }
};

(async () => {
    const name = process.argv[2];
    const args = process.argv[3] ? JSON.parse(process.argv[3]) : {};
    if (!CLIPS[name]) throw new Error('unknown clip ' + name);
    await CLIPS[name](args);
})().catch(e => { console.error(e); process.exit(1); });
