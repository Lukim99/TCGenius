const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const server = read('server.js');
const app = read(path.join('public', 'app.js'));
const field = read(path.join('public', 'hfield.js'));
const css = read(path.join('public', 'hfield.css'));

assert.ok(app.indexOf("'[H]필드'") < app.indexOf("'버닝'"), '[H]필드 콘텐츠 탭은 버닝 앞에 있어야 합니다.');
assert.ok(server.includes("server.get('/hfield'"), '[H]필드는 독립 화면으로 제공되어야 합니다.');
assert.ok(server.includes('function renderHFieldApp'), '[H]필드 전용 화면이 필요합니다.');
assert.ok(app.includes("if (pageId === '[H]필드') { location.href = '/hfield'; return; }"), '대시보드 탭에서 독립 화면으로 이동해야 합니다.');

[
    "server.get('/api/hfield'",
    "server.post('/api/hfield/enter'",
    "server.post('/api/hfield/cancel-entry'",
    "server.post('/api/hfield/attack'",
    "server.post('/api/hfield/skill'",
    "server.post('/api/hfield/use-consumable'",
    "server.post('/api/hfield/leave'",
    'rpgenius.enqueueFieldAction',
    'rpgenius.enterField',
    'rpgenius.useBasicAttackInField',
    'rpgenius.useSkillInField',
    'rpgenius.leaveField'
].forEach(contract => assert.ok(server.includes(contract), '누락된 H필드 계약: ' + contract));
assert.ok(server.includes("mainCard && mainCard.type == '전직'"), '전직 스킬은 전직 카드에만 표시해야 합니다.');

assert.ok(field.includes("getContext('webgl'"), '전투 화면은 WebGL 컨텍스트를 사용해야 합니다.');
assert.ok(field.includes("canvas.addEventListener('pointerdown'"), '터치 입력이 필요합니다.');
assert.ok(!field.includes("key === 'a'") && !field.includes("pointermove"), '쓸모없는 좌우 이동 입력이 없어야 합니다.');
assert.ok(/key\s*={3}\s*' '\s*\|\|\s*key\s*={3}\s*'j'/.test(field), '키보드 공격 입력이 필요합니다.');
assert.ok(field.includes("'mythic'") && field.includes("'transcend'"), '고등급 보상 연출이 필요합니다.');
assert.ok(field.includes('AudioContext') && field.includes("tier==='mythic'"), '보상 사운드와 신화 연출이 필요합니다.');
assert.ok(field.includes("bgm: uiAsset('sfx/부타게임H.mp3')"), 'H필드는 부타게임 전용 배경음악을 재생해야 합니다.');
assert.ok(field.includes('actionButton(') && field.includes('rewardCard(') && field.includes('addDamage('), '파티퀘스트형 전투 HUD와 피해/보상 연출이 필요합니다.');
assert.ok(field.includes('logs.slice(-4)'), '전투 로그는 항상 최신 항목을 그려야 합니다.');
assert.ok(field.includes("const skin=['[𝛧]',state.player.cardSkin,state.player.cardName]") && !field.includes("'['+state.player.cardType+']'"), '장착 캐릭터는 [𝛧] 스킨명 캐릭터명 순서로 표시해야 합니다.');
assert.ok(field.includes('infoX=px+ps+9') && field.includes('infoW=infoRight-infoX') && field.includes('this.bar(infoX,hpBarY,infoW,6'), '플레이어 HP와 MP는 초상화를 침범하지 않는 정보 열에 배치해야 합니다.');
assert.ok(field.includes('[0,1].forEach') && server.includes('pillars: phase'), '기둥 두 개를 하나씩 표시해야 합니다.');
assert.ok(!field.includes('HELL DIFFICULTY') && !field.includes('COMBAT LOG') && !field.includes('LIVE'), '불필요한 HUD 문구가 없어야 합니다.');
assert.ok(!field.includes('·') && !server.includes('<title>부타게임 [H] ·'), 'H필드에는 가운데점 구분자를 사용하지 않아야 합니다.');
assert.ok(field.includes("number(state.ticket.count)+'/'+number(state.ticket.cost)") && field.includes('state.ticket.iconUrl'), '입장 버튼 안에 초대장 이미지와 보유량을 표시해야 합니다.');
assert.ok(field.includes('const bw=narrow?168:184') && field.includes('labelYRatio:.35') && field.includes('iconSize=narrow?28:30') && field.includes('rowW=iconSize+6+c.measureText(countText).width'), '입장 버튼은 좁게 만들고 입장 라벨 아래 큰 초대장을 중앙 배치해야 합니다.');
assert.ok(!field.includes('state.ticket.frameUrl') && !field.includes('transition.ticket.frameUrl'), '입장 버튼과 입장 연출에는 아이템 프레임을 겹치면 안 됩니다.');
assert.ok(field.includes('Array.from({length:30}') && field.includes('startEntryTransition(ticket)') && field.includes('entryTransitionLayer(w,h)'), '초대장 30장이 화면을 덮고 떨어지는 입장 전환 연출이 필요합니다.');
assert.ok(field.includes('hud.inEntryTransition()||!state') && field.includes('if(hud.inEntryTransition())return;'), '입장 전환 중에는 전투와 퇴장 입력을 잠가야 합니다.');
assert.ok(server.includes('H_FIELD_RECOVERY_TYPES') && server.includes('consumables: inField ? getHFieldRecoveryItems(user) : []'), '필드 상태에 보유 중인 회복 소모품을 제공해야 합니다.');
assert.ok(server.includes('회복할 HP나 MP가 없습니다.'), '이미 가득 찬 자원에는 회복 소모품을 낭비하지 않아야 합니다.');
assert.ok(field.includes('consumableLauncher') && field.includes('consumableLayer') && field.includes("event.code==='KeyP'"), 'PC와 터치에서 열 수 있는 회복 소모품 메뉴가 필요합니다.');
assert.ok(field.includes("request('/api/hfield/use-consumable'") && field.includes('recoveryBurst') && field.includes('addRecovery'), '아이템 사용 결과에 회복 수치와 전투 연출을 표시해야 합니다.');
assert.ok(field.includes("potion: uiAsset('sfx/potion.mp3')"), '회복 소모품 사용 시 포션 효과음을 재생해야 합니다.');
assert.ok(css.includes('overflow:hidden') && css.includes('position:fixed;inset:0'), '독립 화면은 스크롤 없이 전체 화면을 사용해야 합니다.');
assert.ok(!server.includes('class="page hfield-page"'), '대시보드 안에 H필드 페이지를 중복 배치하면 안 됩니다.');

const pngs = [
    path.join('DB', 'RPGenius', 'ui', '필드', '부타게임H.png'),
    path.join('DB', 'RPGenius', 'ui', '필드', 'hfield-buta.png'),
    path.join('DB', 'RPGenius', 'ui', '필드', 'hfield-pillar.png'),
    path.join('DB', 'RPGenius', 'ui', '필드', 'hfield-impact-v2.png'),
    path.join('DB', 'RPGenius', 'ui', '필드', 'hfield-mythic-sigil.png'),
    path.join('DB', 'RPGenius', 'ui', '필드', 'hfield-transcend-sigil.png')
];
pngs.forEach(file => {
    const buffer = fs.readFileSync(path.join(root, file));
    assert.strictEqual(buffer.subarray(1, 4).toString('ascii'), 'PNG', file + ' 파일은 PNG여야 합니다.');
    assert.ok(buffer.readUInt32BE(16) >= 512 && buffer.readUInt32BE(20) >= 512, file + ' 해상도가 너무 작습니다.');
});

const spriteRoot = path.join(root, 'DB', 'RPGenius', 'ui', '필드', '캐릭터');
const sprites = fs.readdirSync(spriteRoot).filter(file => String(file).endsWith('.png'));
assert.strictEqual(sprites.length, 14, 'H필드 전용 기본 캐릭터 14개가 모두 필요합니다.');
sprites.forEach(file => {
    const buffer = fs.readFileSync(path.join(spriteRoot, file));
    assert.strictEqual(buffer[25], 6, file + ' 스프라이트는 RGBA PNG여야 합니다.');
});
assert.ok(server.includes("path.join('필드', '캐릭터', mainCard.name + '.png')") && !server.includes("cardType + '__' + skin + '.png'"), 'H필드 캐릭터는 스킨과 전직 여부를 무시하고 캐릭터명으로만 선택해야 합니다.');

const rpg = read('rpgenius.js');
assert.ok(rpg.includes('const HELL_INVITATION_COST = 30;'));
assert.ok(rpg.includes("elite.name = '부타';"));
assert.ok(rpg.includes("name: '부타게임[H]', requireLevel: 141, maxLevel: 300, elite, isHell: true"));
assert.ok(rpg.includes('getHellDungeon,') && rpg.includes('HELL_INVITATION_COST,'));

console.log('hfield_web.test.js: OK');
