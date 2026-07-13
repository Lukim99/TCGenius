const assert = require('assert');
const fs = require('fs');
const path = require('path');

const adminSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const expectedSlots = ['weapon', 'hat', 'armor', 'pants', 'shoes', 'accessory', 'support'];

const slotDefs = adminSource.match(/const EQUIPMENT_SLOT_DEFS = \[(.*?)\];/s);
assert.ok(slotDefs, '관리자 Equipment 부위 정의가 있어야 한다.');
for (const slot of expectedSlots) assert.ok(slotDefs[1].includes("'" + slot + "'"), '관리자 Equipment 탭에 ' + slot + ' 부위가 있어야 한다.');

assert.ok(adminSource.includes('equipData = Object.assign({}, eq);'), '로드한 Equipment 객체의 부위를 누락 없이 보존해야 한다.');
assert.ok(adminSource.includes('EQUIPMENT_SLOT_KEYS.forEach(key => { equipData[key] = Array.isArray(eq[key]) ? eq[key] : []; });'), '일곱 부위를 배열로 정규화해야 한다.');

const requiredSlots = serverSource.match(/const requiredSlots = \[(.*?)\];/s);
assert.ok(requiredSlots, 'Equipment 저장 요청에 대한 필수 부위 검증이 있어야 한다.');
for (const slot of expectedSlots) assert.ok(requiredSlots[1].includes("'" + slot + "'"), '서버 저장 검증에 ' + slot + ' 부위가 있어야 한다.');

console.log('admin_equipment_slots.test.js: OK');
