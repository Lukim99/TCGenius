const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

for (const line of read('.env.local').split(/\r?\n/)) {
    const match = line.match(/^\s*([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
}

const server = read('server.js');
const app = read(path.join('public', 'app.js'));
const rpg = require('../rpgenius');

assert.ok(app.indexOf("'equipment-synthesis'") < app.indexOf("'dex'"), '장비합성은 콘텐츠 탭에서 도감 앞에 있어야 합니다.');
assert.ok(server.includes('data-page="equipment-synthesis"'), '장비합성 페이지가 필요합니다.');
assert.ok(server.includes('id="equipmentSynthesisDock"'), '모바일 고정 합성대가 필요합니다.');
assert.ok(server.includes("server.get('/api/equipment-synthesis'"), '장비합성 목록 API가 필요합니다.');
assert.ok(server.includes("server.post('/api/equipment-synthesis'"), '장비합성 실행 API가 필요합니다.');
assert.ok(server.includes('rpgenius.getEquipmentSynthesisSelection(user, numbers)'), '웹 API도 기존 장비합성 검증 로직을 사용해야 합니다.');
assert.ok(server.includes('rpgenius.runEquipmentSynthesis(user)'), '웹 API도 기존 장비합성 실행 로직을 사용해야 합니다.');
assert.ok(app.includes('level: Number(first.level || 0)'), '초월 합성 결과에는 첫 장비의 강화 단계가 표시되어야 합니다.');
assert.ok(app.includes('potentialDisplay: first.potentialDisplay || null'), '초월 합성 결과에는 첫 장비의 잠재능력이 표시되어야 합니다.');
assert.ok(app.includes("'✦ ' + soul.name"), '초월 합성 결과에는 첫 장비의 영혼이 표시되어야 합니다.');
assert.ok(app.includes("window.matchMedia('(max-width: 760px)')"), '고정 합성대는 모바일 화면에서만 동작해야 합니다.');
assert.ok(app.includes("board.getBoundingClientRect().bottom <= headerBottom"), '원래 합성 패널이 사라진 뒤 고정 합성대를 표시해야 합니다.');

(async () => {
    await rpg.initRpgeniusData();
    const equipment = rpg.getDataCache('Equipment', {});
    const source = Object.entries(equipment).flatMap(([type, list]) =>
        (list || []).map((data, id) => ({ type, id, data }))
    ).find(entry => entry.data && typeof entry.data.evolution !== 'undefined');
    assert.ok(source, '합성 진화 가능한 장비 데이터가 필요합니다.');

    const user = new rpg.RPGUser('웹장비합성테스트', 'web-equipment-synthesis-test');
    user.inventory.equipment = [1, 2, 3].map(() => ({ type: source.type, id: source.id, level: 10 }));
    const selection = rpg.getEquipmentSynthesisSelection(user, [1, 2, 3]);
    assert.ok(!selection.error, selection.error);
    user.pendingAction = { type: '장비합성', numbers: selection.numbers };
    assert.ok(rpg.runEquipmentSynthesis(user).includes('장비 합성이 완료되었습니다.'));
    assert.strictEqual(user.inventory.equipment.length, 1);
    assert.strictEqual(Number(user.inventory.equipment[0].id), Number(source.data.evolution));

    const transcend = Object.entries(equipment).flatMap(([type, list]) =>
        (list || []).map((data, id) => ({ type, id, data }))
    ).find(entry => entry.data && entry.data.rarity === '초월');
    assert.ok(transcend, '초월 장비 데이터가 필요합니다.');
    const transcendUser = new rpg.RPGUser('웹초월합성테스트', 'web-transcend-synthesis-test');
    transcendUser.inventory.equipment = [
        { type: transcend.type, id: transcend.id, level: 7, transcendStage: 1 },
        { type: transcend.type, id: transcend.id, level: 2, transcendStage: 1 }
    ];
    const transcendSelection = rpg.getEquipmentSynthesisSelection(transcendUser, [1, 2]);
    assert.ok(!transcendSelection.error, transcendSelection.error);
    transcendUser.pendingAction = { type: '장비합성', numbers: transcendSelection.numbers };
    assert.ok(rpg.runEquipmentSynthesis(transcendUser).includes('초월 2단계'));
    assert.strictEqual(transcendUser.inventory.equipment[0].transcendStage, 2);
    assert.strictEqual(transcendUser.inventory.equipment[0].level, 7, '첫 장비의 강화 상태를 유지해야 합니다.');

    console.log('equipment_synthesis_web.test.js: OK');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
