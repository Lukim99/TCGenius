// Frame renderer for the ad: seeks the deterministic timeline in headless Chromium and saves every frame.
// Usage: node render.js --from 0 --to 60 --fps 60 --out frames [--workers 3] [--stills 3.2,16.4]
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, cur, i, arr) => (cur.startsWith('--') ? acc.concat([[cur.slice(2), arr[i + 1]]]) : acc), []));
const FPS = Number(args.fps || 60);
const OUT = path.resolve(__dirname, args.out || 'frames');
const PAGE = 'file://' + path.join(__dirname, 'ad', 'index.html');
fs.mkdirSync(OUT, { recursive: true });

async function session() {
    const browser = await chromium.launch({ args: ['--allow-file-access-from-files', '--disable-gpu-vsync', '--disable-frame-rate-limit'] });
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    page.on('pageerror', e => console.log('[pageerror]', e.message));
    page.on('console', m => { if (m.type() === 'error') console.log('[console]', m.text().slice(0, 200)); });
    await page.goto(PAGE);
    await page.evaluate(() => window.ready);
    const cdp = await page.context().newCDPSession(page);
    return { browser, page, cdp };
}

async function renderFrames(frames, label) {
    const { browser, page, cdp } = await session();
    const t0 = Date.now();
    for (let k = 0; k < frames.length; k++) {
        const f = frames[k];
        await page.evaluate(t => window.seek(t), f / FPS);
        const r = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 95, optimizeForSpeed: false });
        fs.writeFileSync(path.join(OUT, String(f).padStart(5, '0') + '.jpg'), Buffer.from(r.data, 'base64'));
        if (k % 60 === 0) console.log(label, 'frame', f, 'of chunk', frames.length, ((Date.now() - t0) / (k + 1)).toFixed(0), 'ms/frame');
    }
    await browser.close();
}

(async () => {
    if (args.cues) {
        const { browser, page } = await session();
        fs.writeFileSync(path.resolve(__dirname, args.cues), await page.evaluate(() => window.exportCues()));
        await browser.close();
        console.log('cues written');
        return;
    }
    let frames;
    if (args.stills) frames = args.stills.split(',').map(s => Math.round(Number(s) * FPS));
    else {
        const a = Math.round(Number(args.from || 0) * FPS), b = Math.round(Number(args.to || 60) * FPS);
        frames = Array.from({ length: b - a }, (_, i) => a + i);
    }
    const workers = Math.max(1, Number(args.workers || 1));
    // interleaved split keeps all workers busy on similar-cost scenes
    const chunks = Array.from({ length: workers }, (_, w) => frames.filter((_, i) => i % workers === w));
    await Promise.all(chunks.map((c, w) => renderFrames(c, 'w' + w)));
    console.log('done', frames.length, 'frames ->', OUT);
})().catch(e => { console.error(e); process.exit(1); });
