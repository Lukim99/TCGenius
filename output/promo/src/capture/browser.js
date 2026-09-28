// Shared Playwright helpers: launches Chromium, serves Pretendard locally (CDN is unreachable here),
// and logs into the showcase account on the locally running real server.
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const BASE = process.env.RPG_BASE || 'http://localhost:3900';
const FONT_DIR = path.join(__dirname, '..', 'node_modules', 'pretendard', 'dist', 'web', 'static');
const PRETENDARD_CSS = 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard-dynamic-subset.min.css';

async function open({ width = 1440, height = 900, scale = 2, name = process.env.SHOWCASE_NAME || '지니어스', code = 'PROMO2026', mobile = false } = {}) {
    const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--disable-gpu-vsync', '--disable-frame-rate-limit'] });
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, locale: 'ko-KR', timezoneId: 'Asia/Seoul', isMobile: mobile, hasTouch: mobile, reducedMotion: 'no-preference' });
    await context.route(PRETENDARD_CSS, route => {
        const css = fs.readFileSync(path.join(FONT_DIR, 'pretendard-dynamic-subset.css'), 'utf8')
            .replace(/url\(\.\/woff2-dynamic-subset\//g, 'url(https://pretendard.local/');
        route.fulfill({ status: 200, contentType: 'text/css', body: css });
    });
    await context.route('https://pretendard.local/**', route => {
        const file = decodeURIComponent(new URL(route.request().url()).pathname.slice(1));
        route.fulfill({ status: 200, contentType: 'font/woff2', body: fs.readFileSync(path.join(FONT_DIR, 'woff2-dynamic-subset', file)) });
    });
    // Black Han Sans ships in the repo; answer the Google Fonts CSS locally instead of going through the proxy.
    await context.route('https://fonts.googleapis.com/css2?family=Black+Han+Sans**', route => route.fulfill({
        status: 200, contentType: 'text/css',
        body: "@font-face{font-family:'Black Han Sans';src:url('" + BASE + "/static/fonts/black-han-sans/BlackHanSans-Regular.ttf') format('truetype');font-weight:400;font-display:block}"
    }));
    const page = await context.newPage();
    page.on('pageerror', e => console.log('[pageerror]', e.message));
    await page.goto(BASE + '/');
    // Known user-agent logs in without a code; otherwise use the seeded one-time code.
    const res = await page.evaluate(async ({ name, code }) => {
        const post = body => fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
        const first = await post({ name });
        return first.ok ? first : post({ name, code });
    }, { name, code });
    if (!res.ok) throw new Error('login failed: ' + JSON.stringify(res));
    return { browser, context, page, BASE };
}

async function settle(page, ms = 800) {
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.evaluate(() => document.fonts && document.fonts.ready);
    // Lazy images below the fold never load in a static capture: force eager and wait until decoded.
    await page.evaluate(async () => {
        document.querySelectorAll('img[loading="lazy"]').forEach(img => { img.loading = 'eager'; });
        const deadline = Date.now() + 20000;
        while (Date.now() < deadline && [...document.images].some(img => img.src && !img.complete)) await new Promise(r => setTimeout(r, 150));
    }).catch(() => {});
    await page.waitForTimeout(ms);
}

module.exports = { open, settle, BASE };
