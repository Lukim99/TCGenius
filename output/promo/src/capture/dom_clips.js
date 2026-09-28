// Deterministic capture of the real DOM/CSS effects (card fusion cinema, enhancement result).
// JS timers run on Playwright's fake clock; every CSS animation/transition is paused and seeked to the
// same virtual time through the Web Animations API; the fusion GIF is swapped frame-by-frame from its
// decoded frames. Result: frame-exact 60 fps footage of the actual UI code.
// Usage: RPG_BASE=http://localhost:3901 node dom_clips.js <fusion|enhance>
const path = require('path');
const fs = require('fs');
const { open, settle } = require('./browser');

const FPS = 60;
const OUT = path.join(__dirname, '..', 'assets', 'clips');
const GIF_DIR = path.join(__dirname, '..', 'assets', 'gif_fusion');

const CONTROLLER = () => {
    const gifFrames = 43, gifStep = 30;
    let gifStart = null, gifImg = null;
    new MutationObserver(list => {
        for (const m of list) {
            const img = m.target;
            if (!(img instanceof HTMLImageElement) || !img.classList.contains('fusion-original-effect')) continue;
            const src = img.getAttribute('src') || '';
            if (src.includes('%EC%A1%B0%ED%95%A9') || src.includes('조합-이펙트')) { gifStart = Date.now(); gifImg = img; img.setAttribute('src', '/__gif/00.png'); }
            else if (!src) { gifStart = null; gifImg = null; }
        }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ['src'] });
    window.__step = () => {
        const now = Date.now();
        for (const a of document.getAnimations()) {
            if (a.__v0 == null) { a.__v0 = now; a.pause(); }
            a.currentTime = now - a.__v0;
        }
        if (gifImg && gifStart != null) {
            const k = Math.floor((now - gifStart) / gifStep) % gifFrames;
            const want = '/__gif/' + String(k).padStart(2, '0') + '.png';
            if (gifImg.getAttribute('src') !== want) gifImg.setAttribute('src', want);
        }
        // Only the swapped GIF frame must be decoded before the shot (lazy off-screen images never load).
        return gifImg && !gifImg.complete ? gifImg.decode().catch(() => {}) : null;
    };
};

async function recorder(name, viewport) {
    const dir = path.join(OUT, name);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    console.log('open…');
    const vp = Object.assign({ width: 1920, height: 1080, scale: 1 }, viewport);
    const session = await open(vp);
    console.log('opened');
    const { page, context, BASE } = session;
    await context.route('**/__gif/*.png', route => {
        const file = path.basename(new URL(route.request().url()).pathname);
        route.fulfill({ status: 200, contentType: 'image/png', body: fs.readFileSync(path.join(GIF_DIR, file)) });
    });
    await page.addInitScript(CONTROLLER);
    console.log('init script');
    await page.clock.install({ time: Date.now() });
    console.log('clock installed');
    const cdp = await context.newCDPSession(page);
    let n = 0, stepIndex = 0;
    const marks = [];
    const nextStep = () => { const d = Math.round((stepIndex + 1) * 1000 / FPS) - Math.round(stepIndex * 1000 / FPS); stepIndex++; return d; };
    return {
        page, BASE,
        async goto(url) {
            await page.goto(BASE + url, { waitUntil: 'load' });
            await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1500));
            for (let k = 0; k < 10; k++) { await page.clock.runFor(200); await page.waitForTimeout(200); }
            await this.imagesReady();
        },
        async warm(ms) { await page.clock.runFor(ms); await page.waitForTimeout(150); },
        async imagesReady(maxSteps = 60) {
            await page.evaluate(() => document.querySelectorAll('img[loading="lazy"]').forEach(img => { img.loading = 'eager'; }));
            for (let k = 0; k < maxSteps; k++) {
                const done = await page.evaluate(() => [...document.images].every(i => !i.getAttribute('src') || i.complete));
                if (done) return;
                await page.clock.runFor(100); await page.waitForTimeout(150);
            }
        },
        async frames(count, label) {
            if (label) marks.push({ frame: n, label });
            for (let i = 0; i < count; i++) {
                await page.clock.runFor(nextStep());
                await page.evaluate(() => window.__step());
                const r = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 93, clip: { x: 0, y: 0, width: vp.width, height: vp.height, scale: vp.scale } });
                fs.writeFileSync(path.join(dir, String(n++).padStart(5, '0') + '.jpg'), Buffer.from(r.data, 'base64'));
            }
            console.log(name, 'frames', n, label || '');
        },
        async done() {
            fs.writeFileSync(path.join(dir, 'log.json'), JSON.stringify({ fps: FPS, frames: n, marks }, null, 1));
            await session.browser.close();
            console.log(name, 'DONE', n);
        }
    };
}

const CLIPS = {
    async fusion(args) {
        const rec = await recorder(args.out || 'fusion', args.w ? { width: args.w, height: args.h, scale: args.scale || 2 } : undefined);
        const { page } = rec;
        console.log('goto'); await rec.goto('/?tab=combine'); console.log('loaded');
        for (const who of ['[𝛧] 오버라이드', '[𝛧] 일레이나', '[𝛧] 마쉐비']) { await page.locator('.combine-pool-card:has-text("' + who + '")').first().evaluate(el => el.click()); await rec.warm(300); }
        // Lucky card 100%: open the support-card picker on the stage and choose the 100% row.
        await page.locator('#combineStage .lucky').first().evaluate(el => el.click()); await rec.warm(400);
        await page.locator('#modalBody >> text=100%').first().evaluate(el => el.click()); await rec.warm(400);
        console.log('selected'); await rec.frames(20, 'ready');
        const resp = page.waitForResponse(r => r.url().includes('/api/combine'), { timeout: 20000 });
        await page.locator('#combineBtn').first().evaluate(el => el.click());
        await rec.frames(12, 'begin');
        const res = await resp; const body = await res.text(); console.log('combine', body.slice(0, 300));
        if (!JSON.parse(body).success) { console.log('not a success roll'); process.exit(3); }
        await rec.frames(330, 'cinema');
        await rec.done();
    },
    async enhance(args) {
        const rec = await recorder(args.out || 'enhance', args.w ? { width: args.w, height: args.h, scale: args.scale || 2 } : undefined);
        const { page } = rec;
        await rec.goto('/?tab=inventory');
        await page.locator('.inv-kind-tab[data-kind="equipment"]').first().evaluate(el => el.click()); await rec.warm(600); await rec.imagesReady();
        const target = args.item || '불멸하는 업화의 용갑';
        await page.locator('.inventory-viewer >> text=' + target).first().evaluate(el => el.click()); await rec.warm(500);
        console.log('modal buttons', await page.$$eval('#modalBody button, .modal button', b => b.map(x => x.textContent.trim()).slice(0, 12)));
        await page.locator('.modal-action-button.enhance').first().evaluate(el => el.click()); await rec.warm(800); await rec.imagesReady();
        await rec.frames(24, 'preview');
        const resp = page.waitForResponse(r => r.url().includes('/api/equipment/upgrade/run'), { timeout: 20000 });
        await page.locator('#enhanceConfirmBtn').first().evaluate(el => el.click());
        const res = await resp; const body = await res.text(); console.log('enhance', body.slice(0, 200));
        const kind = JSON.parse(body).resultKind;
        if (kind !== 'success' && kind !== 'great') { console.log('not a success roll:', kind); process.exit(3); }
        await rec.warm(0);
        await rec.frames(240, 'result:' + (JSON.parse(body).resultKind || '?'));
        await rec.done();
    }
};

(async () => {
    const name = process.argv[2];
    const args = process.argv[3] ? JSON.parse(process.argv[3]) : {};
    await CLIPS[name](args);
})().catch(e => { console.error(e); process.exit(1); });
