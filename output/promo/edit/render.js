// 사용: node render.js out_dir [t1 t2 ...]  (시각 미지정 시 전체 프레임 렌더)
const fs = require('fs'), path = require('path'), http = require('http');
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const DIR = __dirname, OUT = process.argv[2]; fs.mkdirSync(OUT, { recursive: true });
const range = process.argv[3] === 'range' ? [Number(process.argv[4]), Number(process.argv[5])] : null;
const times = range ? [] : process.argv.slice(3).map(Number);
const types = { '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.ttf': 'font/ttf', '.otf': 'font/otf' };
const srv = http.createServer((req, res) => {
    const p = path.join(DIR, decodeURIComponent(req.url.split('?')[0]));
    fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' }); res.end(d); });
}).listen(0, async () => {
    const b = await chromium.launch();
    const pg = await b.newPage({ viewport: { width: 1920, height: 1080 } });
    pg.on('pageerror', e => console.log('pageerror', e.message)); pg.on('console', m => console.log('console', m.text()));
    await pg.goto('http://127.0.0.1:' + srv.address().port + '/comp.html');
    await pg.evaluate(() => window.init());
    const dur = await pg.evaluate(() => window.DURATION);
    let list = times.length ? times : Array.from({ length: Math.round(dur * 30) }, (_, i) => i / 30);
    const idx0 = range ? range[0] : 0; if (range) list = list.slice(range[0], range[1]);
    const t0 = Date.now();
    for (const [i, t] of list.entries()) {
        await pg.evaluate(t => window.render(t), t);
        const name = times.length ? 't' + t.toFixed(2) + '.jpg' : String(i + idx0).padStart(5, '0') + '.jpg';
        await pg.screenshot({ path: path.join(OUT, name), type: 'jpeg', quality: 94 });
        if (i % 150 === 0) console.log(i, '/', list.length, ((Date.now() - t0) / 1000).toFixed(0) + 's');
    }
    await b.close(); srv.close();
});
