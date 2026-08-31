const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const items = JSON.parse(fs.readFileSync(path.join(root, 'DB', 'RPGenius', 'Item.json'), 'utf8'));
const packs = JSON.parse(fs.readFileSync(path.join(root, 'DB', 'RPGenius', 'Pack.json'), 'utf8'));

const nineId = items.findIndex(item => item && item.name === '[9월]9성 보호카드');
const eightId = items.findIndex(item => item && item.name === '[9월]8성 보호카드');

assert.ok(nineId >= 0 && eightId >= 0, '9월 보호카드 정의가 필요합니다.');
assert.deepStrictEqual(items[nineId].protect, { star: 8 });
assert.deepStrictEqual(items[eightId].protect, { star: 7 });
assert.strictEqual(items[nineId].type, '티켓');
assert.strictEqual(items[eightId].type, '티켓');
assert.notStrictEqual(items[nineId].no_trade, true);
assert.notStrictEqual(items[eightId].no_trade, true);
assert.strictEqual(items[nineId].sellPrice, 3000000);
assert.strictEqual(items[eightId].sellPrice, 1500000);

const lockboxId = items.findIndex(item => item && item.name === '봉인된 자물쇠');
const lockboxDrops = packs[items[lockboxId].pack];
assert.strictEqual(lockboxDrops[0].item_id, eightId, '일반 초대장 구슬 자리는 9월 8성 보호카드여야 합니다.');
assert.strictEqual(lockboxDrops[1].item_id, nineId, '상급 초대장 구슬 자리는 9월 9성 보호카드여야 합니다.');
assert.strictEqual(lockboxDrops[0].roll, 0.005);
assert.strictEqual(lockboxDrops[1].roll, 0.002);

for (const name of ['[9월]9성 보호카드.png', '[9월]8성 보호카드.png']) {
    assert.ok(fs.existsSync(path.join(root, 'DB', 'RPGenius', 'itemImage', '티켓', name)), name + ' 이미지가 필요합니다.');
}

const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const style = fs.readFileSync(path.join(root, 'public', 'style.css'), 'utf8');
assert.ok(!server.includes('/api/burning') && !server.includes('data-page="버닝"'));
assert.ok(!app.includes('loadBurning') && !app.includes("'버닝': '버닝'"));
assert.ok(!style.includes('.burning-'));

console.log('september lockbox update tests passed');
