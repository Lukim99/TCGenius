const express = require('express');
const crypto = require('crypto');
const path = require('path');
const rpgenius = require('./rpgenius.js');

const SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || 'tcgenius-default-secret-change-me';
const SESSION_COOKIE = 'tcg_admin';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

const fs = require('fs');

const server = express();
server.use(express.json({ limit: '5mb' }));
server.use(express.urlencoded({ extended: false }));

const ADMIN_HTML_PATH = path.join(__dirname, 'public', 'admin.html');
const ADMIN_JS_PATH = path.join(__dirname, 'public', 'admin.js');
server.get('/static/admin.js', (req, res) => {
    if (!getSession(req)) return res.status(401).end();
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.send(fs.readFileSync(ADMIN_JS_PATH, 'utf8'));
});

function sign(payload) {
    const json = JSON.stringify(payload);
    const body = Buffer.from(json, 'utf8').toString('base64url');
    const sig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
    return body + '.' + sig;
}

function verify(token) {
    if (!token || typeof token != 'string') return null;
    const [body, sig] = token.split('.');
    if (!body || !sig) return null;
    const expected = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
    const a = Buffer.from(sig), b = Buffer.from(expected);
    if (a.length != b.length || !crypto.timingSafeEqual(a, b)) return null;
    try {
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
        if (Number(payload.exp || 0) < Date.now()) return null;
        return payload;
    } catch (e) {
        return null;
    }
}

function parseCookies(req) {
    const header = req.headers.cookie || '';
    const out = {};
    header.split(';').forEach(part => {
        const idx = part.indexOf('=');
        if (idx > 0) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    });
    return out;
}

function getSession(req) {
    const cookies = parseCookies(req);
    return verify(cookies[SESSION_COOKIE]);
}

function setSession(res, payload) {
    const token = sign(payload);
    res.setHeader('Set-Cookie', SESSION_COOKIE + '=' + encodeURIComponent(token) + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + Math.floor(SESSION_TTL_MS / 1000));
}

function clearSession(res) {
    res.setHeader('Set-Cookie', SESSION_COOKIE + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

function requireAdmin(req, res, next) {
    const sess = getSession(req);
    if (!sess || !sess.admin) return res.status(401).json({ error: '로그인이 필요합니다.' });
    req.session = sess;
    next();
}

server.get('/', (req, res) => {
    const sess = getSession(req);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (sess && sess.admin) return res.send(renderDashboard(sess));
    res.send(renderLogin());
});

server.post('/api/login', async (req, res) => {
    const code = String((req.body && req.body.code) || '').trim();
    if (!code) return res.status(400).json({ error: '코드를 입력해주세요.' });
    try {
        const user = await rpgenius.getRPGUserByCode(code);
        if (!user) return res.status(401).json({ error: '존재하지 않는 코드입니다.' });
        if (!user.isAdmin) return res.status(403).json({ error: '관리자 권한이 없습니다.' });
        setSession(res, { name: user.name, admin: true, exp: Date.now() + SESSION_TTL_MS });
        res.json({ ok: true, name: user.name });
    } catch (e) {
        console.error('login error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.post('/api/logout', (req, res) => {
    clearSession(res);
    res.json({ ok: true });
});

server.get('/api/me', requireAdmin, (req, res) => {
    res.json({ name: req.session.name });
});

// ===== 유저 검색 / 재화 지급 =====

server.get('/api/users/search', requireAdmin, async (req, res) => {
    const name = String(req.query.name || '').trim();
    if (!name) return res.status(400).json({ error: '닉네임을 입력해주세요.' });
    try {
        const user = await rpgenius.getRPGUserByName(name);
        if (!user) return res.status(404).json({ error: '존재하지 않는 유저입니다.' });
        res.json({
            name: user.name,
            level: user.level,
            gold: user.gold,
            garnet: user.garnet,
            point: user.point,
            mileage: user.mileage,
            isAdmin: !!user.isAdmin
        });
    } catch (e) {
        console.error('search error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

const GOODS_KEYS = ['gold', 'garnet', 'point', 'mileage'];

server.post('/api/users/grant', requireAdmin, async (req, res) => {
    const name = String((req.body && req.body.name) || '').trim();
    const kind = String((req.body && req.body.kind) || '').trim();
    const amount = Number((req.body && req.body.amount) || 0);
    if (!name) return res.status(400).json({ error: '닉네임을 입력해주세요.' });
    if (!Number.isInteger(amount) || amount == 0) return res.status(400).json({ error: '수량은 0이 아닌 정수여야 합니다.' });

    try {
        const user = await rpgenius.getRPGUserByName(name);
        if (!user) return res.status(404).json({ error: '존재하지 않는 유저입니다.' });

        if (GOODS_KEYS.includes(kind)) {
            const before = Number(user[kind] || 0);
            const after = before + amount;
            if (after < 0) return res.status(400).json({ error: '결과가 0보다 작을 수 없습니다. (현재 ' + before + ')' });
            user[kind] = after;
            await user.save();
            return res.json({ ok: true, name: user.name, kind, before, after, delta: amount });
        }

        if (kind == 'item') {
            const itemName = String((req.body && req.body.itemName) || '').trim();
            if (!itemName) return res.status(400).json({ error: '아이템명을 입력해주세요.' });
            const items = rpgenius.getDataCache('Item', []);
            const itemId = items.findIndex(item => item && item.name == itemName);
            if (itemId == -1) return res.status(404).json({ error: '존재하지 않는 아이템입니다.' });
            if (amount > 0) {
                rpgenius.addInventoryItem(user, itemId, amount);
            } else {
                const have = rpgenius.getInventoryItemCount(user, itemId);
                if (have < -amount) return res.status(400).json({ error: '대상 보유 수량이 부족합니다. (보유 ' + have + ')' });
                rpgenius.removeInventoryItem(user, itemId, -amount);
                rpgenius.cleanupInventoryItems(user);
            }
            await user.save();
            return res.json({ ok: true, name: user.name, kind: 'item', itemId, itemName, delta: amount });
        }

        return res.status(400).json({ error: '알 수 없는 종류입니다.' });
    } catch (e) {
        console.error('grant error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

// ===== Lookup (드롭다운 / 픽커 데이터) =====

server.get('/api/lookup/items', requireAdmin, (req, res) => {
    const items = rpgenius.getDataCache('Item', []);
    res.json(items.map((it, id) => it ? { id, name: it.name, type: it.type, desc: it.desc } : null).filter(Boolean));
});

server.get('/api/lookup/equipment', requireAdmin, (req, res) => {
    const eq = rpgenius.getDataCache('Equipment', {});
    const pack = list => (list || []).map((e, id) => e ? { id, name: e.name, rarity: e.rarity } : null).filter(Boolean);
    res.json({ weapon: pack(eq.weapon), armor: pack(eq.armor), accessory: pack(eq.accessory) });
});

// ===== rpgenius_data 관리 =====

server.get('/api/data', requireAdmin, (req, res) => {
    res.json({ keys: rpgenius.RPGENIUS_DATA_KEYS });
});

server.get('/api/data/:key', requireAdmin, async (req, res) => {
    const key = String(req.params.key);
    if (!rpgenius.RPGENIUS_DATA_KEYS.includes(key)) return res.status(400).json({ error: '허용되지 않은 키입니다.' });
    try {
        await rpgenius.loadRpgeniusDataEntry(key);
        const data = rpgenius.getDataCache(key, null);
        res.json({ key, data });
    } catch (e) {
        console.error('data get error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.put('/api/data/:key', requireAdmin, async (req, res) => {
    const key = String(req.params.key);
    if (!rpgenius.RPGENIUS_DATA_KEYS.includes(key)) return res.status(400).json({ error: '허용되지 않은 키입니다.' });
    if (!req.body || typeof req.body.data == 'undefined') return res.status(400).json({ error: 'data 필드가 비어있습니다.' });
    try {
        await rpgenius.saveRpgeniusDataEntry(key, req.body.data);
        res.json({ ok: true, key });
    } catch (e) {
        console.error('data put error:', e);
        res.status(500).json({ error: e.message || '서버 오류' });
    }
});

// ===== HTML =====

function renderLogin() {
    return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>TCGenius 관리자</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0d12;color:#e5e7eb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
.card{background:#13161d;border:1px solid #232734;border-radius:14px;padding:28px;width:min(380px,92vw);box-shadow:0 10px 40px rgba(0,0,0,.4)}
h1{margin:0 0 6px;font-size:20px}
p.sub{margin:0 0 20px;color:#9aa3b2;font-size:13px}
label{display:block;font-size:12px;color:#9aa3b2;margin-bottom:6px}
input{width:100%;padding:11px 12px;background:#0b0d12;border:1px solid #2a2f3d;border-radius:8px;color:#e5e7eb;font-size:14px;outline:none;font-family:ui-monospace,monospace;letter-spacing:.05em}
input:focus{border-color:#5865f2}
button{width:100%;margin-top:14px;padding:11px;background:#5865f2;color:#fff;border:0;border-radius:8px;font-weight:600;cursor:pointer;font-size:14px}
button:hover{background:#4752c4}
button:disabled{opacity:.6;cursor:wait}
.err{margin-top:12px;color:#f87171;font-size:13px;min-height:18px}
</style></head><body>
<form class="card" id="f">
  <h1>🔐 RPGenius 관리자</h1>
  <p class="sub">RPGenius 계정의 로그인 코드를 입력하세요.</p>
  <label>로그인 코드</label>
  <input id="code" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCDE12345" required>
  <button type="submit">로그인</button>
  <div class="err" id="err"></div>
</form>
<script>
const f=document.getElementById('f'),err=document.getElementById('err'),code=document.getElementById('code');
f.addEventListener('submit',async e=>{e.preventDefault();err.textContent='';f.querySelector('button').disabled=true;
try{const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:code.value.trim()})});
const j=await r.json();if(!r.ok)throw new Error(j.error||'로그인 실패');location.reload();
}catch(x){err.textContent='❌ '+x.message;f.querySelector('button').disabled=false}});
</script></body></html>`;
}

function renderDashboard(sess) {
    const html = fs.readFileSync(ADMIN_HTML_PATH, 'utf8');
    return html
        .replace(/{{ADMIN_NAME}}/g, escapeHtml(sess.name))
        .replace(/{{DATA_KEYS}}/g, JSON.stringify(rpgenius.RPGENIUS_DATA_KEYS));
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function keepAlive() {
    const port = Number(process.env.PORT || 3000);
    server.listen(port, () => console.log('서버 준비 완료! http://localhost:' + port));
}

module.exports = keepAlive;
