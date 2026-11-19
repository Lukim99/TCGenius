// 증강 연출 실험실 검수 도구. 머리 없는 크롬으로 실험실을 열어 증강마다 흐름(또는 장면 단추)을 재생하며
// 무대를 여러 번 찍어 시간이 적힌 한 장으로 모으고, 자막과 오류와 효과음 받기 결과를 report.json에 남긴다.
// 실험실 서버가 켜져 있어야 한다: node scripts/augment-lab/server.js
// 사용: node scripts/augment-lab/check.js --augments fruition,conqueror --out <폴더>
//       [--signals] 흐름 대신 장면 단추를 하나씩   [--size mobile]   [--every 0.3] 찍는 간격(초)   [--max 16] 장면당 최대 장수   [--port 4176]
const fs = require('fs');
const path = require('path');
const puppeteer = require(path.join(__dirname, '..', '..', 'node_modules', 'puppeteer-core'));
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const args = process.argv.slice(2), flag = name => args.includes('--' + name), opt = (name, fallback) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : fallback; };
const port = Number(opt('port', 4176)), out = path.resolve(opt('out', 'tmp/augment-lab-check')), every = Number(opt('every', .3)), max = Number(opt('max', 16)), size = opt('size', 'desktop');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
    fs.mkdirSync(out, { recursive: true });
    const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--mute-audio', '--window-size=1600,900'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 900 });
    const consoleErrors = [];
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('pageerror', error => consoleErrors.push(error.message));
    page.on('requestfailed', request => consoleErrors.push('요청 실패 ' + request.url()));
    page.on('response', response => { if (response.status() >= 400 && !/favicon/.test(response.url())) consoleErrors.push(response.status() + ' ' + decodeURIComponent(response.url())); });
    await page.goto(`http://localhost:${port}/?augment=fruition${size === 'mobile' ? '&size=mobile' : ''}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.AugLab && window.AugLab.ready, { timeout: 60000 });
    await page.evaluate(() => window.AugLab.ready);
    await page.evaluate(() => document.dispatchEvent(new Event('pointerdown')));
    const all = await page.evaluate(() => window.AugLab.defined());
    const ids = (opt('augments', '') || all.join(',')).split(',').filter(Boolean);
    const report = [];
    async function film(id, label, start) {
        const box = await page.$eval('#stageBox', node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
        const began = Date.now(); let finished = false;
        start().then(() => { finished = true; }, () => { finished = true; });
        const tiles = [];
        while (tiles.length < max) {
            const t = (Date.now() - began) / 1000;
            tiles.push({ t, png: await page.screenshot({ clip: box, encoding: 'base64', type: 'jpeg', quality: 72 }) });
            if (finished) break;
            await sleep(every * 1000);
        }
        const sheet = await page.evaluate(async (list, title) => {
            const images = await Promise.all(list.map(tile => new Promise(resolve => { const image = new Image(); image.onload = () => resolve(image); image.src = 'data:image/jpeg;base64,' + tile.png; })));
            const scale = .42, w = Math.round(images[0].width * scale), h = Math.round(images[0].height * scale), cols = Math.min(4, images.length), rows = Math.ceil(images.length / cols);
            const canvas = document.createElement('canvas'); canvas.width = w * cols; canvas.height = h * rows + 26;
            const g = canvas.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, canvas.width, canvas.height);
            g.font = '600 15px sans-serif'; g.fillStyle = '#ffd36b'; g.fillText(title, 8, 18);
            images.forEach((image, i) => { const x = (i % cols) * w, y = 26 + Math.floor(i / cols) * h; g.drawImage(image, x, y, w, h); g.fillStyle = 'rgba(0,0,0,.75)'; g.fillRect(x, y, 58, 20); g.fillStyle = '#ff0'; g.fillText(list[i].t.toFixed(2) + 's', x + 5, y + 15); });
            return canvas.toDataURL('image/png');
        }, tiles, id + ' ' + label);
        const file = path.join(out, (id + '-' + label).replace(/[^a-zA-Z0-9가-힣_.-]+/g, '_') + '.png');
        fs.writeFileSync(file, Buffer.from(sheet.split(',')[1], 'base64'));
        return { file, frames: tiles.length, seconds: Math.round((Date.now() - began) / 100) / 10 };
    }
    for (const id of ids) {
        consoleErrors.length = 0;
        await page.evaluate(id => window.AugLab.select(id), id);
        await sleep(700);
        const entry = { id, sheets: [] };
        if (flag('signals')) {
            const labels = await page.evaluate(() => window.AugLab.signals());
            for (let i = 0; i < labels.length; i++) {
                await page.evaluate(id => window.AugLab.select(id), id); await sleep(500);
                entry.sheets.push(Object.assign({ signal: labels[i] }, await film(id, 'signal' + (i + 1), () => page.evaluate(i => window.AugLab.runSignal(i).then(() => new Promise(resolve => setTimeout(resolve, 2400))), i))));
            }
        } else entry.sheets.push(await film(id, 'demo', () => page.evaluate(() => window.AugLab.playDemo())));
        await sleep(300);
        entry.captions = await page.evaluate(() => window.AugLab.captions);
        entry.sounds = await page.evaluate(() => window.AugLab.soundStatus());
        entry.errors = (await page.evaluate(() => window.AugLab.errors())).concat(consoleErrors.splice(0));
        report.push(entry);
        console.log(id, entry.sheets.map(sheet => path.basename(sheet.file) + ' ' + sheet.frames + '장 ' + sheet.seconds + '초').join(', '), entry.errors.length ? '오류 ' + entry.errors.length : '오류 없음');
        await page.evaluate(() => window.AugLab.clearErrors());
    }
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
