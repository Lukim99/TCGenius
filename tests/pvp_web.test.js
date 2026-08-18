const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const server = read('server.js');
const app = read(path.join('public', 'app.js'));
const page = read(path.join('public', 'pvp.js'));
const css = read(path.join('public', 'pvp.css'));
const engine = read('pvp.js');

// 대시보드 진입점: 콘텐츠 그룹 안 'pvp' 페이지 (독립 화면으로 리다이렉트하지 않음)
assert.ok(app.includes("PAGE_LABELS") && /pvp:\s*'PVP'/.test(app), 'PVP 페이지 라벨이 필요합니다.');
const contentGroup = (app.match(/id: 'content',[^\n]*/) || [''])[0];
assert.ok(contentGroup.includes("'[H]필드', 'pvp', '버닝'"), 'PVP 탭은 콘텐츠 그룹에서 [H]필드와 버닝 사이에 있어야 합니다.');
assert.ok(app.includes("if (pageId === 'pvp') loadPvp();"), 'PVP 탭은 대시보드 안에서 로드해야 합니다.');
assert.ok(server.includes('<div class="page" data-page="pvp">') && server.includes('id="pvpRoot"'), '대시보드에 PVP 페이지 컨테이너가 필요합니다.');
assert.ok(app.includes("'/pvp?opponent='"), '도전 버튼은 독립 전투 화면으로 이동해야 합니다.');

// 독립 WebGL 전투 화면
assert.ok(server.includes("server.get('/pvp'") && server.includes('function renderPvpApp'), 'PVP 전투 화면 라우트가 필요합니다.');
assert.ok(server.includes('id="pvpCanvas"') && server.includes('id="pvpHud"') && server.includes('/static/pvp.js'), 'PVP 화면은 두 캔버스와 전용 스크립트를 사용해야 합니다.');
assert.ok(page.includes("getContext('webgl'"), 'PVP 전투 화면은 WebGL 컨텍스트를 사용해야 합니다.');
assert.ok(page.includes("uiAsset('필드/뉴비즈.png')"), 'PVP 배경은 필드/뉴비즈.png 이어야 합니다.');
assert.ok(page.includes("'/api/pvp/battle/defend'") && page.includes("'/api/pvp/battle/attack'") && page.includes("'/api/pvp/battle/skill'"), '공격/스킬/방어 행동이 필요합니다.');
assert.ok(css.includes('position:fixed;inset:0') && css.includes('overflow:hidden'), '독립 화면은 스크롤 없이 전체 화면을 사용해야 합니다.');

// API 계약
[
    "server.get('/api/pvp'",
    "server.post('/api/pvp/refresh'",
    "server.post('/api/pvp/extra'",
    "server.post('/api/pvp/defense'",
    "server.post('/api/pvp/battle/start'",
    "server.get('/api/pvp/battle'",
    "server.post('/api/pvp/battle/attack'",
    "server.post('/api/pvp/battle/skill'",
    "server.post('/api/pvp/battle/defend'",
    "server.post('/api/pvp/battle/forfeit'",
    "server.post('/api/pvp/battle/close'",
    'rpgenius.enqueueFieldAction',
    'pvp.configure('
].forEach(contract => assert.ok(server.includes(contract), '누락된 PVP 계약: ' + contract));

// 엔진 규칙: 방어 -50%, 하루 5명, 새로고침 2회, 근접 3/상위 1/랜덤 1, 상위 3명 랭킹
assert.ok(engine.includes('damage = Math.round(damage * 0.5)'), '방어 중 받는 최종 피해 -50%가 필요합니다.');
assert.ok(engine.includes('DAILY_BATTLE_MAX = 5') && engine.includes('DAILY_REFRESH_MAX = 2'), '하루 5명 / 새로고침 2회 제한이 필요합니다.');
assert.ok(engine.includes('EXTRA_PLAY_MAX = 2') && engine.includes('EXTRA_PLAY_COST = 10'), '유료 추가 플레이는 하루 2회, 회당 10가넷이어야 합니다.');
assert.ok(/chance: \.40[^\n]*카드팩 상자/.test(engine) && /chance: \.40[^\n]*지렁이/.test(engine) && /chance: \.10[^\n]*쥬얼/.test(engine) && /chance: \.10[^\n]*지니어스의 열쇠/.test(engine), '플레이 보상 표(40/40/10/10)가 필요합니다.');
assert.ok(app.includes("'/api/pvp/extra'") && page.includes('reward'), '추가 플레이 구매 UI와 결과 화면 보상 표시가 필요합니다.');
assert.ok(engine.includes("['near', 'near', 'near', 'higher', 'random']"), '근접 3 / 상위 1 / 랜덤 1 매칭 구성이 필요합니다.');
assert.ok(engine.includes('.slice(0, 3)'), '랭킹은 상위 3명만 공개해야 합니다.');

const background = path.join(root, 'DB', 'RPGenius', 'ui', '필드', '뉴비즈.png');
const buffer = fs.readFileSync(background);
assert.strictEqual(buffer.subarray(1, 4).toString('ascii'), 'PNG', '뉴비즈.png 파일은 PNG여야 합니다.');

console.log('pvp_web.test.js: OK');
