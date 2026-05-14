const express = require('express');
const crypto = require('crypto');
const path = require('path');
const rpgenius = require('./rpgenius.js');

const SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || 'tcgenius-default-secret-change-me';
const SESSION_COOKIE = 'tcg_admin';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

const server = express();
server.use(express.json({ limit: '5mb' }));
server.use(express.urlencoded({ extended: false }));

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
    const keysJson = JSON.stringify(rpgenius.RPGENIUS_DATA_KEYS);
    return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>TCGenius 관리자 대시보드</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:#0b0d12;color:#e5e7eb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px}
header{display:flex;align-items:center;justify-content:space-between;padding:14px 22px;border-bottom:1px solid #1f2330;background:#0e1118;position:sticky;top:0;z-index:5}
header h1{margin:0;font-size:16px;font-weight:600}
header .who{color:#9aa3b2;font-size:13px;margin-right:12px}
header button{background:#1f2330;color:#e5e7eb;border:1px solid #2a2f3d;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:13px}
header button:hover{background:#272c3b}
.tabs{display:flex;gap:4px;padding:14px 22px 0;border-bottom:1px solid #1f2330;background:#0e1118}
.tab{padding:10px 16px;background:transparent;border:0;color:#9aa3b2;cursor:pointer;border-radius:6px 6px 0 0;font-size:13px;font-weight:500}
.tab.active{color:#e5e7eb;background:#13161d;border:1px solid #1f2330;border-bottom-color:#13161d;margin-bottom:-1px}
main{padding:24px 22px;max-width:1100px;margin:0 auto}
.panel{display:none}
.panel.active{display:block}
section{background:#13161d;border:1px solid #1f2330;border-radius:12px;padding:20px;margin-bottom:18px}
h2{margin:0 0 14px;font-size:15px;font-weight:600;color:#e5e7eb}
label{display:block;font-size:12px;color:#9aa3b2;margin:10px 0 5px}
input,select,textarea{width:100%;padding:9px 11px;background:#0b0d12;border:1px solid #2a2f3d;border-radius:7px;color:#e5e7eb;font-size:13px;outline:none;font-family:inherit}
input:focus,select:focus,textarea:focus{border-color:#5865f2}
textarea{font-family:ui-monospace,'Cascadia Code',monospace;min-height:380px;line-height:1.5;font-size:12.5px;tab-size:2;white-space:pre;overflow:auto;resize:vertical}
button.primary{background:#5865f2;color:#fff;border:0;border-radius:7px;padding:9px 16px;cursor:pointer;font-weight:600;font-size:13px}
button.primary:hover{background:#4752c4}
button.ghost{background:transparent;color:#9aa3b2;border:1px solid #2a2f3d;border-radius:7px;padding:9px 14px;cursor:pointer;font-size:13px}
button.ghost:hover{color:#e5e7eb;border-color:#3a4055}
.row{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap}
.row > *{flex:1;min-width:140px}
.row > .btnwrap{flex:0 0 auto}
.muted{color:#9aa3b2;font-size:12.5px}
.kv{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin-top:10px}
.kv div{background:#0b0d12;border:1px solid #1f2330;border-radius:7px;padding:9px 11px}
.kv div b{display:block;font-size:11px;color:#9aa3b2;font-weight:500;margin-bottom:3px}
.toast{position:fixed;bottom:20px;right:20px;padding:11px 16px;border-radius:8px;background:#13161d;border:1px solid #2a2f3d;color:#e5e7eb;font-size:13px;box-shadow:0 8px 24px rgba(0,0,0,.4);opacity:0;transition:opacity .2s;pointer-events:none;z-index:10}
.toast.show{opacity:1}
.toast.ok{border-color:#16a34a}
.toast.err{border-color:#dc2626}
.bar{display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap}
</style></head><body>
<header>
  <h1>🛠️ RPGenius 관리자</h1>
  <div><span class="who">${escapeHtml(sess.name)}</span><button id="logout">로그아웃</button></div>
</header>
<div class="tabs">
  <button class="tab active" data-tab="grant">유저 / 재화 지급</button>
  <button class="tab" data-tab="data">rpgenius_data</button>
</div>
<main>
  <div class="panel active" data-panel="grant">
    <section>
      <h2>유저 검색</h2>
      <div class="row">
        <div><label>닉네임</label><input id="searchName" placeholder="닉네임"></div>
        <div class="btnwrap"><button class="primary" id="searchBtn">검색</button></div>
      </div>
      <div id="userInfo" class="kv" style="display:none"></div>
    </section>
    <section>
      <h2>재화 / 아이템 지급</h2>
      <p class="muted">차감하려면 음수를 입력하세요. 예) -100</p>
      <div class="row">
        <div><label>대상 닉네임</label><input id="grantName" placeholder="닉네임"></div>
        <div><label>종류</label><select id="grantKind">
          <option value="gold">🪙 골드</option>
          <option value="garnet">💠 가넷</option>
          <option value="point">💰 포인트</option>
          <option value="mileage">Ⓜ️ 마일리지</option>
          <option value="item">📦 아이템</option>
        </select></div>
        <div id="itemNameWrap" style="display:none"><label>아이템명</label><input id="grantItemName" placeholder="예) 강화석"></div>
        <div><label>수량</label><input id="grantAmount" type="number" placeholder="100" value="0"></div>
        <div class="btnwrap"><button class="primary" id="grantBtn">지급/차감</button></div>
      </div>
    </section>
  </div>

  <div class="panel" data-panel="data">
    <section>
      <h2>rpgenius_data JSON 에디터</h2>
      <div class="bar">
        <select id="dataKey"></select>
        <button class="ghost" id="dataReload">불러오기</button>
        <button class="primary" id="dataSave">저장</button>
        <button class="ghost" id="dataFormat">정렬</button>
        <span class="muted" id="dataStatus"></span>
      </div>
      <textarea id="dataText" spellcheck="false" placeholder="키를 선택하고 불러오기를 눌러주세요."></textarea>
    </section>
  </div>
</main>
<div class="toast" id="toast"></div>
<script>
const KEYS=${keysJson};
const $=s=>document.querySelector(s);
const toast=(m,ok=true)=>{const t=$('#toast');t.textContent=m;t.className='toast show '+(ok?'ok':'err');setTimeout(()=>t.classList.remove('show'),2400)};
const j=async(url,opt)=>{const r=await fetch(url,opt);const x=await r.json();if(!r.ok)throw new Error(x.error||r.status);return x};

document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{
  document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b===t));
  document.querySelectorAll('.panel').forEach(p=>p.classList.toggle('active',p.dataset.panel===t.dataset.tab));
});

$('#logout').onclick=async()=>{await fetch('/api/logout',{method:'POST'});location.reload()};

// ----- 유저 검색 -----
$('#searchBtn').onclick=async()=>{
  const name=$('#searchName').value.trim();if(!name)return toast('닉네임을 입력하세요',false);
  try{const u=await j('/api/users/search?name='+encodeURIComponent(name));
    $('#userInfo').style.display='grid';
    $('#userInfo').innerHTML=['name','level','gold','garnet','point','mileage','isAdmin'].map(k=>'<div><b>'+k+'</b>'+u[k]+'</div>').join('');
    $('#grantName').value=u.name;
  }catch(e){$('#userInfo').style.display='none';toast(e.message,false)}};

// ----- 지급 -----
$('#grantKind').onchange=()=>{$('#itemNameWrap').style.display=$('#grantKind').value==='item'?'':'none'};
$('#grantBtn').onclick=async()=>{
  const body={name:$('#grantName').value.trim(),kind:$('#grantKind').value,amount:Number($('#grantAmount').value),itemName:$('#grantItemName').value.trim()};
  try{const r=await j('/api/users/grant',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(r.kind==='item')toast('✅ '+r.name+' '+r.itemName+' '+(r.delta>0?'+':'')+r.delta);
    else toast('✅ '+r.name+' '+r.kind+': '+r.before+' → '+r.after);
  }catch(e){toast(e.message,false)}};

// ----- rpgenius_data -----
const sel=$('#dataKey');KEYS.forEach(k=>{const o=document.createElement('option');o.value=k;o.textContent=k;sel.appendChild(o)});
async function loadData(){const k=sel.value;$('#dataStatus').textContent='불러오는 중...';
  try{const r=await j('/api/data/'+encodeURIComponent(k));$('#dataText').value=JSON.stringify(r.data,null,2);$('#dataStatus').textContent=k+' 로드 완료';}
  catch(e){$('#dataStatus').textContent='';toast(e.message,false)}}
$('#dataReload').onclick=loadData;sel.onchange=loadData;
$('#dataFormat').onclick=()=>{try{$('#dataText').value=JSON.stringify(JSON.parse($('#dataText').value),null,2);toast('✅ 포맷 완료');}catch(e){toast('JSON 파싱 실패: '+e.message,false)}};
$('#dataSave').onclick=async()=>{const k=sel.value;let data;try{data=JSON.parse($('#dataText').value);}catch(e){return toast('JSON 파싱 실패: '+e.message,false)}
  if(!confirm(k+' 데이터를 DynamoDB에 저장합니다. 계속할까요?'))return;
  try{await j('/api/data/'+encodeURIComponent(k),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({data})});toast('✅ '+k+' 저장 완료');}
  catch(e){toast(e.message,false)}};
loadData();
</script></body></html>`;
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function keepAlive() {
    const port = Number(process.env.PORT || 3000);
    server.listen(port, () => console.log('서버 준비 완료! http://localhost:' + port));
}

module.exports = keepAlive;
