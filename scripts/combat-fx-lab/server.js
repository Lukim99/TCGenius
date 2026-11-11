// 전투 연출 실험실. 게임 서버 없이 public/과 DB/RPGenius/ui/만으로 모든 이펙트를 재생해 본다.
// 실행: node scripts/combat-fx-lab/server.js  →  http://localhost:4173
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const PUBLIC = path.join(ROOT, 'public');
// 이미지 자산은 git 밖(S3 동기화 폴더)에 있다. 다른 작업 사본에서 돌릴 때는 RPG_UI_DIR로 그 폴더를 가리킨다.
const UI = process.env.RPG_UI_DIR || path.join(ROOT, 'DB', 'RPGenius', 'ui');
const PORT = Number(process.env.PORT || 4173);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.json': 'application/json; charset=utf-8' };

function send(res, file) {
    fs.readFile(file, (error, data) => {
        if (error) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
        res.end(data);
    });
}
function inside(base, target) { const full = path.resolve(base, target); return full.startsWith(path.resolve(base) + path.sep) ? full : null; }

// ---- 모의 필드: 실제 public/hfield.js를 가짜 전투 API로 돌려 호스트 연결을 확인한다 (/lab/field) ----
const combatEffects = require(path.join(PUBLIC, 'combat-effects.js'));
const uiUrl = file => '/rpg-ui?file=' + encodeURIComponent(file);
const mock = { hp: 90000, bossHp: 5000000, summons: new Map(), ticks: [], skills: ['익테봇 소환', '수나타 소환', '자폭', '처형박수', '끝판왕', '빅뱅', '럭키펀치'] };
function mockState() {
    const now = Date.now();
    for (const [name, summon] of mock.summons) {
        if (summon.until <= now) { mock.summons.delete(name); continue; }
        if (now >= summon.next) {
            summon.next = now + (name === '익테봇' ? 4000 : 5000);
            const damage = 30000 + Math.floor(Math.random() * 20000);
            mock.bossHp = Math.max(1, mock.bossHp - damage);
            mock.ticks.push(combatEffects.annotateEvent({ action: 'tick', source: name, effectKind: 'summon', damage, killedCount: 0, hits: [{ damage, critical: false, destiny: false, label: name }], rewards: [] }));
        }
    }
    return {
        serverNow: now, inField: true, canEnter: true, phase: 'elite', nextActionAt: 0, consumables: [], events: mock.ticks.splice(0),
        player: { name: '실험실', hp: mock.hp, maxHp: 90000, mp: 5000, maxMp: 5000, cardName: '이익태', cardFormatted: '전직 이익태', cardStar: 10, cardType: '전직', cardImageUrl: null, spriteUrl: uiUrl('필드/캐릭터/이익태__전직.png'), basicUntil: 0, summons: [...mock.summons].map(([name, summon]) => ({ name, until: summon.until })) },
        target: { name: '부타 [H]', hp: mock.bossHp, maxHp: 5000000 },
        skills: mock.skills.map(name => ({ name, mpCost: 0, cooldownEnd: 0 }))
    };
}
function mockAction(pathname, body) {
    const now = Date.now(), skillName = body && body.skillName, isSkill = pathname.endsWith('/skill');
    const event = { action: isSkill ? 'skill' : 'attack' };
    if (isSkill) {
        event.skillName = skillName;
        if (skillName === '익테봇 소환') mock.summons.set('익테봇', { until: now + 20000, next: now + 4000 });
        if (skillName === '수나타 소환') mock.summons.set('수나타', { until: now + 45000, next: now + 5000 });
        if (skillName === '자폭') mock.summons.clear();
    }
    const target = isSkill ? combatEffects.SKILL_TARGETS[skillName] : 'target';
    if (target !== 'actor' || skillName === '자폭') {
        const count = !isSkill && Math.random() < .35 ? 2 : skillName === '포커 못 하시네' ? 5 : 1, critical = Math.random() < .3;
        event.hits = Array.from({ length: count }, (_, index) => ({ damage: 20000 + Math.floor(Math.random() * 60000), critical: critical && index === 0, destiny: false, isComboHit: index > 0 && !isSkill }));
        event.damage = event.hits.reduce((sum, hit) => sum + hit.damage, 0);
        event.criticalCount = critical ? 1 : 0;
        event.effectElement = isSkill ? null : ['화', '수', '명', '암', null][Math.floor(Math.random() * 5)];
        if (!isSkill && Math.random() < .3) event.triggeredEffectIds = ['equipment:레인보우 프리즘'];
        mock.bossHp = Math.max(1, mock.bossHp - event.damage);
    }
    // 보스의 반격. 익테봇이 있으면 대신 받는다.
    if (!isSkill && Math.random() < .5) {
        const damage = 3000 + Math.floor(Math.random() * 4000), guarded = mock.summons.has('익테봇');
        event.received = guarded ? 0 : damage;
        event.receivedHits = [guarded ? { damage, type: 'summonAbsorbed', label: '익테봇 피해 대행' } : { damage, critical: false }];
        if (!guarded) mock.hp = Math.max(1, mock.hp - damage);
    }
    return { ok: true, message: (isSkill ? skillName : '공격') + ' ' + Number(event.damage || 0).toLocaleString('ko-KR'), event: combatEffects.annotateEvent(event), state: mockState() };
}
const DEBUG_HOOK = `<script>
// 검수용: 엔진 인스턴스를 window.__fx로 꺼내고, window.__freezeOn = { id, t }가 있으면 그 이펙트가 재생된 t초 뒤 화면에서 멈춘다.
(() => {
    const create = CombatFX.create;
    CombatFX.create = options => {
        const fx = window.__fx = create(Object.assign({ preserve: true }, options));
        if (!fx) return fx;
        const play = fx.play;
        fx.play = (ids, o) => {
            const result = play(ids, o), wanted = window.__freezeOn;
            (window.__played = window.__played || []).push((ids || []).join(',') + ' → ' + JSON.stringify(result));
            if (wanted && (ids || []).includes(wanted.id) && result.count) { fx.freezeAfter(wanted.t); window.__freezeOn = null; }
            return result;
        };
        return fx;
    };
})();
</script>`;
const FIELD_PAGE = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>모의 필드</title>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">
<link rel="stylesheet" href="/static/hfield.css"></head><body>
<main id="hFieldRoot" class="hf-root"><canvas id="hfCanvas"></canvas><canvas id="hfHud"></canvas></main>
<script>window.HFIELD_ME="실험실";</script>
<script src="/static/combat-effects.js"></script>
<script src="/static/combat-fx.js"></script>
<script src="/static/combat-fx-scenes.js"></script>
${DEBUG_HOOK}
<script src="/static/hfield.js"></script>
</body></html>`;

// ---- 모의 월드보스 (/lab/worldboss): 실제 public/worldboss.js ----
const wb = { hp: 80000, bossHp: 90000000, summons: new Map(), skills: ['익테봇 소환', '처형박수', '끝판왕', '불사조', '자인', '빅뱅'] };
function wbAssets(name) {
    const sheet = (file, frames, fps, loop, hitFrame) => ({ url: uiUrl('월드보스/' + name + '/' + file), frameWidth: 270, frameHeight: 480, columns: 5, frames, fps, loop: !!loop, hitFrame });
    return {
        artUrl: uiUrl('월드보스/' + name + '.png'), backgroundUrl: uiUrl('월드보스/' + name + '/background.png'),
        animations: { idle: sheet('idle.png', 24, 8, true), darkPulse: sheet('dark-pulse.png', 25, 30, false, 9), icham: sheet('icham.png', 25, 30, false, 10), curse: sheet('curse.png', 25, 30, false, 15), defeat: sheet('defeat.png', 25, 8, false) },
        effects: { darkPulse: uiUrl('월드보스/' + name + '/effects/dark-pulse.png'), icham: uiUrl('월드보스/' + name + '/effects/icham.png'), curse: uiUrl('월드보스/' + name + '/effects/curse.png') }
    };
}
function wbState() {
    const now = Date.now(), boss = { name: '흑막', hp: wb.bossHp, maxHp: 90000000, alive: true, contribution: 0, myRank: 1, assets: wbAssets('흑막') };
    for (const [name, summon] of wb.summons) if (summon.until <= now) wb.summons.delete(name);
    return {
        serverNow: now, inField: true, canEnter: true, selecting: false, current: boss, bosses: [boss], nextActionAt: 0, consumables: [], events: [], elapsedMs: 1000,
        player: { name: '실험실', hp: wb.hp, maxHp: 80000, mp: 5000, maxMp: 5000, cardName: '이익태', cardFormatted: '전직 이익태', cardStar: 10, cardType: '전직', cardImageUrl: null, spriteUrl: uiUrl('필드/캐릭터/이익태__전직.png'), basicUntil: 0, summons: [...wb.summons].map(([name, summon]) => ({ name, until: summon.until })) },
        skills: wb.skills.map(name => ({ name, mpCost: 0, cooldownEnd: 0 }))
    };
}
function wbAction(pathname, body) {
    const isSkill = pathname.endsWith('/skill'), skillName = body && body.skillName, event = { action: isSkill ? 'skill' : 'attack' };
    if (isSkill) { event.skillName = skillName; if (skillName === '익테봇 소환') wb.summons.set('익테봇', { until: Date.now() + 20000 }); }
    if (!isSkill || combatEffects.SKILL_TARGETS[skillName] !== 'actor') {
        const critical = Math.random() < .35;
        event.hits = [{ damage: 400000 + Math.floor(Math.random() * 600000), critical }];
        event.damage = event.hits[0].damage; event.criticalCount = critical ? 1 : 0;
        event.effectElement = isSkill ? null : ['화', '명', null][Math.floor(Math.random() * 3)];
        wb.bossHp = Math.max(1, wb.bossHp - event.damage);
    }
    if (!isSkill && Math.random() < .5) {
        const damage = 5000, guarded = wb.summons.has('익테봇');
        event.bossAction = 'percentSlash'; event.received = guarded ? 0 : damage;
        event.receivedHits = [guarded ? { damage, type: 'summonAbsorbed', label: '익테봇 피해 대행' } : { damage }];
    }
    return { ok: true, message: (isSkill ? skillName : '공격'), event: combatEffects.annotateEvent(event), state: wbState() };
}
const WB_PAGE = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>모의 월드보스</title>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">
<link rel="stylesheet" href="/static/worldboss.css"></head><body>
<main id="worldBossRoot" class="wb-root"><canvas id="wbCanvas"></canvas><canvas id="wbHud" tabindex="-1"></canvas>
  <section id="wbSelection" class="wb-selection" hidden><div class="wb-selection-content"><header><h1 id="wbSelectionTitle"></h1></header><div id="wbSkillCards" class="wb-skill-cards"></div><button id="wbCancelSelection" type="button">선택 취소</button></div></section>
</main>
<dialog id="wbRewardDialog"><h2 id="wbRewardTitle"></h2><p id="wbRewardSummary"></p><ul id="wbRewardList"></ul><details id="wbRewardDetails"><summary></summary><p id="wbRewardMessage"></p></details><button id="wbRewardClose" type="button">확인</button></dialog>
<script>window.WORLD_BOSS_ME="실험실";</script>
<script src="/static/combat-effects.js"></script>
<script src="/static/combat-fx.js"></script>
<script src="/static/combat-fx-scenes.js"></script>
${DEBUG_HOOK}
<script src="/static/worldboss.js"></script>
</body></html>`;

// ---- 모의 대전 (/lab/pvp): 실제 public/pvp.js. 상대도 스킬과 소환수를 쓰므로 좌우 반전 장면을 볼 수 있다 ----
const duel = { seq: 0, step: 0, polls: 0, hp: { me: 90000, opp: 90000 }, summon: { me: null, opp: null }, queue: [] };
const DUEL_SCRIPT = [['opp', 'skill', '수나타 소환'], ['opp', 'skill', '처형박수'], ['opp', 'attack'], ['opp', 'summon', '수나타'], ['opp', 'skill', '정권'], ['opp', 'skill', '끝판왕'], ['opp', 'attack'], ['opp', 'skill', '럭키펀치'], ['opp', 'summon', '수나타'], ['opp', 'skill', '불사조']];
function duelEvent(actor, action, name) {
    const target = actor === 'me' ? 'opp' : 'me', event = { seq: ++duel.seq, actor, action, text: actor + ' ' + (name || action) };
    if (action === 'skill') {
        event.skillName = name;
        if (name === '익테봇 소환') duel.summon[actor] = { name: '익테봇', until: Date.now() + 20000 };
        if (name === '수나타 소환') duel.summon[actor] = { name: '수나타', until: Date.now() + 45000 };
        if (name === '자폭') duel.summon[actor] = null;
    }
    if (action === 'summon') event.source = name;
    if (action !== 'skill' || combatEffects.SKILL_TARGETS[name] !== 'actor') {
        const damage = 2000 + Math.floor(Math.random() * 3000), critical = action !== 'summon' && Math.random() < .3;
        const guarded = action === 'attack' && duel.summon[target] && duel.summon[target].name === '익테봇';
        event.hits = [guarded ? { damage, type: 'summonAbsorbed', label: '익테봇 피해 대행' } : { damage, critical, label: action === 'summon' ? name : undefined }];
        event.damage = damage; event.criticalCount = critical ? 1 : 0;
        if (!guarded) duel.hp[target] = Math.max(1, duel.hp[target] - damage);
    }
    return event;
}
function duelView(since) {
    const now = Date.now(), side = key => ({
        name: key === 'me' ? '실험실' : '상대', level: 99, rating: 1500, hp: duel.hp[key], maxHp: 90000, mp: 5000, maxMp: 5000, shield: 0, buffs: [],
        cardName: key === 'me' ? '이익태' : '오버라이드', cardFormatted: key === 'me' ? '전직 이익태' : '전직 오버라이드', cardStar: 10, cardType: '전직', cardImageUrl: null,
        spriteUrl: uiUrl('필드/캐릭터/' + (key === 'me' ? '이익태__전직' : '오버라이드__전직') + '.png'), summon: duel.summon[key] && duel.summon[key].until > now ? duel.summon[key] : null,
        skills: ['익테봇 소환', '처형박수', '정권', '자폭', '헤즈업', '빙결'].map(name => ({ name, mpCost: 0, cooldownEnd: 0 })), nextActionAt: 0, basicUntil: 0, defendCooldownEnd: 0, defendUntil: 0
    });
    return { active: true, phase: 'fight', seq: duel.seq, serverNow: now, startedAt: now - 5000, endsAt: now + 600000, me: side('me'), opp: side('opp'), events: duel.queue.filter(event => event.seq > since), result: null };
}
const PVP_PAGE = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>모의 대전</title>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">
<link rel="stylesheet" href="/static/pvp.css"></head><body>
<main id="pvpStage" class="pvp-root"><canvas id="pvpCanvas"></canvas><canvas id="pvpHud"></canvas></main>
<script>window.PVP_ME="실험실";window.PVP_OPPONENT="상대";</script>
<script src="/static/combat-effects.js"></script>
<script src="/static/combat-fx.js"></script>
<script src="/static/combat-fx-scenes.js"></script>
${DEBUG_HOOK}
<script src="/static/pvp.js"></script>
</body></html>`;
const json = (res, value) => { res.writeHead(200, { 'Content-Type': TYPES['.json'] }); res.end(JSON.stringify(value)); };
const readBody = (req, done) => { let raw = ''; req.on('data', chunk => { raw += chunk; }); req.on('end', () => { let body = {}; try { body = JSON.parse(raw || '{}'); } catch (_) {} done(body); }); };

http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/') return send(res, path.join(__dirname, 'index.html'));
    if (url.pathname === '/lab/field') {
        if (url.searchParams.get('skills')) mock.skills = url.searchParams.get('skills').split(',');
        res.writeHead(200, { 'Content-Type': TYPES['.html'] }); return res.end(FIELD_PAGE);
    }
    if (url.pathname === '/lab/worldboss') { res.writeHead(200, { 'Content-Type': TYPES['.html'] }); return res.end(WB_PAGE); }
    if (url.pathname === '/api/worldboss' && req.method === 'GET') return json(res, wbState());
    if (url.pathname.startsWith('/api/worldboss/') && req.method === 'POST') return readBody(req, body => json(res, wbAction(url.pathname, body)));
    if (url.pathname === '/lab/pvp') { res.writeHead(200, { 'Content-Type': TYPES['.html'] }); return res.end(PVP_PAGE); }
    if (url.pathname === '/api/pvp/battle' && req.method === 'GET') {
        // 폴링마다 상대가 대본대로 한 번씩 행동한다. ?auto=0이면 가만히 있는다.
        const since = Number(url.searchParams.get('since') || 0);
        if (duel.polls++ > 0 && duel.auto !== false) { const [actor, action, name] = DUEL_SCRIPT[duel.step++ % DUEL_SCRIPT.length]; duel.queue.push(duelEvent(actor, action, name)); }
        return json(res, duelView(since));
    }
    if (url.pathname.startsWith('/api/pvp/battle/') && req.method === 'POST') return readBody(req, body => {
        const action = url.pathname.split('/').pop();
        if (action === 'attack' || action === 'skill') duel.queue.push(duelEvent('me', action, body.skillName));
        if (action === 'script') { duel.auto = body.auto !== false; if (body.event) duel.queue.push(duelEvent(body.event[0], body.event[1], body.event[2])); }
        json(res, duelView(Number(body.since || duel.seq - 1)));
    });
    if (url.pathname === '/api/hfield' && req.method === 'GET') { res.writeHead(200, { 'Content-Type': TYPES['.json'] }); return res.end(JSON.stringify(mockState())); }
    if (url.pathname.startsWith('/api/hfield/') && req.method === 'POST') {
        let raw = '';
        req.on('data', chunk => { raw += chunk; });
        req.on('end', () => { let body = {}; try { body = JSON.parse(raw || '{}'); } catch (_) {} res.writeHead(200, { 'Content-Type': TYPES['.json'] }); res.end(JSON.stringify(mockAction(url.pathname, body))); });
        return;
    }
    if (url.pathname === '/rpg-ui') { const file = inside(UI, url.searchParams.get('file') || ''); return file ? send(res, file) : (res.writeHead(400), res.end()); }
    if (url.pathname.startsWith('/static/')) { const file = inside(PUBLIC, decodeURIComponent(url.pathname.slice(8))); return file ? send(res, file) : (res.writeHead(400), res.end()); }
    if (url.pathname === '/lab/effects') {
        const base = path.join(UI, '필드', '이펙트'), kinds = { skill: '스킬', summon: '소환수', element: '속성', combat: '전투', set: '세트', equipment: '장비' }, out = {};
        for (const [kind, dir] of Object.entries(kinds)) out[kind] = fs.readdirSync(path.join(base, dir)).filter(name => name.endsWith('.png')).map(name => name.slice(0, -4) === '아이돌 할래' ? '아이돌 할래?' : name.slice(0, -4));
        res.writeHead(200, { 'Content-Type': TYPES['.json'] }); return res.end(JSON.stringify(out));
    }
    res.writeHead(404); res.end('not found');
}).listen(PORT, () => console.log('combat fx lab: http://localhost:' + PORT));
