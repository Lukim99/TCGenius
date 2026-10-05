// E세계 대저택 레이드 광고 렌더러
//   node render.js stills 1.2 8.9 30     → .cache/stills/*.png (검토용 정지 화면)
//   node render.js frames [--workers 3]  → .cache/frames/*.jpg (전체 프레임)
//   node render.js encode                → output/mansion-raid-ad/*.mp4 (audio.js 결과와 합친다)
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawnSync } = require('child_process');
const TL = require('./timeline');

const DIR = __dirname;
const CACHE = path.join(DIR, '.cache');
const OUT_DIR = path.join(DIR, '..', '..', 'output', 'mansion-raid-ad');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.ttf': 'font/ttf' };

function serve() {
    const server = http.createServer((req, res) => {
        const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
        const file = path.join(DIR, rel);
        if (!file.startsWith(DIR) || !fs.existsSync(file)) {
            res.writeHead(404);
            res.end();
            return;
        }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
        fs.createReadStream(file).pipe(res);
    });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function openPage(browser, port) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    page.on('pageerror', err => console.error('pageerror', err.message));
    page.on('console', msg => {
        if (msg.type() === 'error') console.error('console', msg.text());
    });
    await page.goto(`http://127.0.0.1:${port}/index.html`);
    await page.waitForFunction(() => window.ready && window.renderFrame, null, { timeout: 120000 });
    await page.evaluate(() => window.ready);
    return page;
}

async function grab(page, t, frame, type) {
    const data = await page.evaluate(([tt, fr, ty]) => {
        window.renderFrame(tt, fr);
        return document.getElementById('c').toDataURL(ty === 'png' ? 'image/png' : 'image/jpeg', 0.95);
    }, [t, frame, type]);
    return Buffer.from(data.slice(data.indexOf(',') + 1), 'base64');
}

async function withBrowser(fn) {
    const { chromium } = require('playwright');
    const server = await serve();
    const browser = await chromium.launch({ args: ['--disable-web-security', '--font-render-hinting=none'] });
    try {
        return await fn(browser, server.address().port);
    } finally {
        await browser.close();
        server.close();
    }
}

async function stills(times) {
    const dir = path.join(CACHE, 'stills');
    fs.mkdirSync(dir, { recursive: true });
    await withBrowser(async (browser, port) => {
        const page = await openPage(browser, port);
        for (const t of times) {
            const t0 = Date.now();
            const buf = await grab(page, t, Math.round(t * TL.FPS), 'png');
            const file = path.join(dir, `t_${t.toFixed(3).padStart(7, '0')}.png`);
            fs.writeFileSync(file, buf);
            console.log(path.relative(DIR, file), `${Date.now() - t0}ms`);
        }
    });
}

async function frames(workers) {
    const dir = path.join(CACHE, 'frames');
    fs.mkdirSync(dir, { recursive: true });
    const total = Math.round(TL.DURATION * TL.FPS);
    const todo = [];
    for (let f = 0; f < total; f++) {
        if (!fs.existsSync(path.join(dir, `f_${String(f).padStart(5, '0')}.jpg`))) todo.push(f);
    }
    console.log(`frames: ${todo.length}/${total} to render with ${workers} workers`);
    const started = Date.now();
    let done = 0;
    await withBrowser(async (browser, port) => {
        // 각 작업자가 연속 구간을 맡아야 정지 화면 버퍼를 한 번만 만든다.
        const chunk = Math.ceil(todo.length / workers);
        await Promise.all(Array.from({ length: workers }, async (_, w) => {
            const mine = todo.slice(w * chunk, (w + 1) * chunk);
            if (!mine.length) return;
            const page = await openPage(browser, port);
            for (const f of mine) {
                const buf = await grab(page, f / TL.FPS, f, 'jpeg');
                fs.writeFileSync(path.join(dir, `f_${String(f).padStart(5, '0')}.jpg`), buf);
                done++;
                if (done % 120 === 0) {
                    const rate = done / ((Date.now() - started) / 1000);
                    console.log(`${done}/${todo.length}  ${rate.toFixed(1)} fps  eta ${((todo.length - done) / rate).toFixed(0)}s`);
                }
            }
            await page.close();
        }));
    });
    console.log(`rendered in ${((Date.now() - started) / 1000).toFixed(0)}s`);
}

function encode() {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const audio = path.join(CACHE, 'audio.wav');
    if (!fs.existsSync(audio)) throw new Error('run audio.js first');
    const out = path.join(OUT_DIR, 'mansion-raid-ad-60s.mp4');
    // 필름 그레인 때문에 CRF로는 100MB를 넘는다. 2-pass 평균 6.2Mbps로 저장소에 둘 수 있는 크기에 맞춘다.
    const input = ['-y', '-framerate', String(TL.FPS), '-i', path.join(CACHE, 'frames', 'f_%05d.jpg')];
    const video = [
        '-c:v', 'libx264', '-preset', 'slow', '-tune', 'film', '-b:v', '6200k', '-maxrate', '11000k', '-bufsize', '16000k',
        '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
        '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
        '-profile:v', 'high', '-level', '4.2', '-g', String(TL.FPS * 2)
    ];
    const log = path.join(CACHE, 'x264pass');
    const run = args => {
        const r = spawnSync('ffmpeg', args, { stdio: 'inherit' });
        if (r.status !== 0) throw new Error('ffmpeg failed');
    };
    run([...input, ...video, '-pass', '1', '-passlogfile', log, '-an', '-f', 'mp4', '/dev/null']);
    run([...input, '-i', audio, ...video, '-pass', '2', '-passlogfile', log, '-movflags', '+faststart',
        '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-shortest', out]);
    // 대표 이미지: 마지막 타이틀 화면
    run(['-v', 'error', '-y', '-ss', '57.5', '-i', out, '-frames:v', '1', '-q:v', '2', path.join(OUT_DIR, 'poster.jpg')]);
    console.log('wrote', path.relative(process.cwd(), out));
}

(async () => {
    const [cmd, ...rest] = process.argv.slice(2);
    if (cmd === 'stills') await stills(rest.map(Number));
    else if (cmd === 'frames') {
        const i = rest.indexOf('--workers');
        await frames(i >= 0 ? Number(rest[i + 1]) : 3);
    } else if (cmd === 'encode') encode();
    else console.log('usage: node render.js stills <t...> | frames [--workers N] | encode');
})().catch(err => {
    console.error(err);
    process.exit(1);
});
