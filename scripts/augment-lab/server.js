// 증강 연출 실험실. 천상 증강 30종을 하나씩 골라 연출과 효과음을 보고(연출 보기),
// 메모리 DB로 돈 실제 천상 전투에서 그 증강을 직접 써 본다(실전). 운영 DynamoDB와 S3에 닿지 않는다(../paradise-lab/sandbox.js).
// 실행: node scripts/augment-lab/server.js  →  http://localhost:4176
//   ?augment=fruition  그 증강을 골라 연다   &play=1  열자마자 흐름 재생   &mode=live  실전으로 연다   &size=mobile  모바일 크기
const http = require('http');
const fs = require('fs');
const path = require('path');
const sandbox = require('../paradise-lab/sandbox');
const live = require('./live');
const PORT = Number(process.env.PORT || 4176);
const HERE = __dirname;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp' };
// 이번 개편에서 새로 받은 효과음: CREDITS.md의 '천상 증강 음원' 표들에서 그때그때 읽는다(파일을 지우거나 더해도 목록이 맞는다).
// 표의 칸: 파일 | 제작자 | 원본 | 사용 구간 | 길이 | 타격점 | 쓰는 곳 | (대신한 소리)
function newSounds() {
    let text = '';
    try { text = fs.readFileSync(path.join(sandbox.ROOT, 'public', 'assets', 'combat-fx', 'CREDITS.md'), 'utf8'); } catch (_) { return []; }
    return text.split(/^## /m).filter(part => part.startsWith('천상 증강 음원')).flatMap(part => part.split(/\r?\n/)
        .filter(line => /^\|\s*[a-z0-9_]+\.mp3\s*\|/.test(line) && fs.existsSync(path.join(sandbox.ROOT, 'public', 'assets', 'combat-fx', 'sfx', line.split('|')[1].trim())))
        .map(line => {
            const cells = line.split('|').map(cell => cell.trim()), link = cells[3].match(/\[([^\]]*)\]\(([^)]*)\)/);
            return { name: cells[1].replace(/\.mp3$/, ''), label: cells[1].replace(/\.mp3$/, ''), author: cells[2], source: link ? link[2] : '', use: cells[7] || '' };
        }));
}

function send(res, file) {
    fs.readFile(file, (error, data) => {
        if (error) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
        res.end(data);
    });
}
function json(res, status, body) { res.writeHead(status, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); }
function readBody(req) {
    return new Promise((resolve, reject) => {
        let text = '';
        req.on('data', chunk => { text += chunk; if (text.length > 1e5) req.destroy(); });
        req.on('end', () => { try { resolve(text ? JSON.parse(text) : {}); } catch (error) { reject(error); } });
        req.on('error', reject);
    });
}
// 내부 서버에 실험자 쿠키로 GET 요청을 보낸다.
function fetchInner(port, url) {
    return new Promise((resolve, reject) => {
        http.get({ host: '127.0.0.1', port, path: url, headers: { cookie: sandbox.cookie() } }, reply => {
            let text = ''; reply.setEncoding('utf8');
            reply.on('data', chunk => { text += chunk; });
            reply.on('end', () => { try { resolve(JSON.parse(text)); } catch (error) { reject(new Error(url + ' ' + reply.statusCode + ' ' + text.slice(0, 200))); } });
        }).on('error', reject);
    });
}
const catalog = () => ({
    augments: sandbox.AUGMENTS.map(({ id, name, category, lines, text, note, iconUrl, skill }) => ({ id, name, category, lines, text, note: note || null, iconUrl, skill: skill || null })),
    // 증강이 주는 스킬(쿨타임, MP). 무대의 스킬 단추를 실제 천상 화면과 같은 모양으로 만든다.
    skills: sandbox.prism.SKILLS.map(({ id, name, cooldown, mp }) => ({ id, name, cooldown, mp })),
    newSounds: newSounds()
});
// 연출 보기 무대가 쓸 실제 전투 화면 한 장(내 캐릭터, 스킬, 회랑의 적). 서버를 켤 때 한 번 만든다.
let scene = null;
async function makeScene(port) {
    await sandbox.queue(() => sandbox.scenario('combat'));
    const state = await fetchInner(port, '/api/paradise');
    scene = { battle: state.battle, enemy: state.run && state.run.enemy, runId: state.runId || null };
    await sandbox.queue(() => sandbox.scenario('lobby'));
}

(async () => {
    const target = await sandbox.start();
    await makeScene(target);
    http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname === '/' || url.pathname === '/index.html') return send(res, path.join(HERE, 'index.html'));
        if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
        if (url.pathname === '/lab/api/catalog') return json(res, 200, catalog());
        if (url.pathname === '/lab/api/scene') return json(res, 200, scene);
        if (url.pathname === '/lab/api/live' && req.method === 'POST') {
            try { json(res, 200, await live.act(await readBody(req))); }
            catch (error) { json(res, 500, { ok: false, message: String(error.message || error) }); }
            return;
        }
        if (url.pathname.startsWith('/lab/')) {
            const file = path.resolve(HERE, '.' + decodeURIComponent(url.pathname.slice(4)));
            if (!file.startsWith(HERE + path.sep)) { res.writeHead(400); res.end(); return; }
            return send(res, file);
        }
        // 낙원 그림(회랑 배경 등)은 S3에만 있어 로컬 ui 폴더에 없으면 public/assets/paradise의 같은 이름 파일로 대신한다(실험실 전용).
        const asset = url.pathname === '/rpg-ui' && /^낙원\/[^/\\]+$/.test(url.searchParams.get('file') || '') ? url.searchParams.get('file').slice(3) : null;
        if (asset && !fs.existsSync(path.join(sandbox.ROOT, 'DB', 'RPGenius', 'ui', '낙원', asset))) {
            const local = path.join(sandbox.ROOT, 'public', 'assets', 'paradise', asset);
            if (fs.existsSync(local)) return send(res, local);
        }
        sandbox.proxy(req, res, target);
    }).listen(PORT, () => console.log('증강 연출 실험실: http://localhost:' + PORT));
})();
