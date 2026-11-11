const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
globalThis.CombatEffects = require('../public/combat-effects');
const combatEffects = globalThis.CombatEffects;
const combatFx = require('../public/combat-fx');
require('../public/combat-fx-scenes');

// 이미지 자산은 git 밖(S3 동기화 폴더)에 있다. 다른 작업 사본에서는 RPG_UI_DIR로 그 폴더를 가리킨다.
const UI_ROOT = process.env.RPG_UI_DIR || path.join(ROOT, 'DB', 'RPGenius', 'ui');
const EFFECT_ROOT = path.join(UI_ROOT, '필드', '이펙트');
const SOUND_ROOT = path.join(ROOT, 'public', 'assets', 'combat-fx', 'sfx');
const imagePath = effectId => path.join(UI_ROOT, combatEffects.assetPath(effectId));

// 이펙트 그림마다 장면이 있어야 한다. 스킬, 소환수, 속성과 전투 공통 이펙트는 원형에 맡기지 않고 따로 연출한다.
const effectIds = [];
for (const [kind, dir] of Object.entries(combatEffects.DIRS)) {
    for (const file of fs.readdirSync(path.join(EFFECT_ROOT, dir))) {
        if (!file.endsWith('.png')) continue;
        const name = path.basename(file, '.png');
        effectIds.push(kind + ':' + (name === '아이돌 할래' ? '아이돌 할래?' : name));
    }
}
assert.ok(effectIds.length >= 224, '이펙트 그림 목록');
for (const effectId of effectIds) {
    const definition = combatFx.resolve(effectId);
    assert.ok(definition && typeof definition.run === 'function', effectId + ' 장면');
    assert.ok(Number(definition.impact || 0) >= 0 && Number(definition.impact || 0) <= .6, effectId + ' 타격 시각은 0.6초 안이어야 조작감이 늦지 않다.');
    (definition.images || []).forEach(id => assert.ok(fs.existsSync(imagePath(id)), effectId + ' 장면이 쓰는 그림 ' + id));
    if (/^(skill|summon|element|combat):/.test(effectId)) assert.ok(combatFx.defined(effectId), effectId + '는 전용 장면이 있어야 한다.');
}

// 장면이 부르는 소리는 모두 파일로 있어야 하고, 쓰지 않는 파일은 남기지 않는다.
const source = fs.readFileSync(path.join(ROOT, 'public', 'combat-fx-scenes.js'), 'utf8');
const sounds = new Set(combatFx.commonSounds);
effectIds.forEach(effectId => (combatFx.resolve(effectId).sounds || []).forEach(name => sounds.add(name)));
for (const match of source.matchAll(/S\.(?:sfx|hit)\(\s*'([a-z_]+)'/g)) sounds.add(match[1]);
for (const match of source.matchAll(/sound: '([a-z_]+)'/g)) sounds.add(match[1]);
const files = new Set(fs.readdirSync(SOUND_ROOT).filter(name => name.endsWith('.mp3')).map(name => path.basename(name, '.mp3')));
sounds.forEach(name => assert.ok(files.has(name), '효과음 파일 ' + name + '.mp3'));
files.forEach(name => assert.ok(sounds.has(name), '쓰지 않는 효과음 ' + name + '.mp3'));
Object.keys(combatFx.soundHits).forEach(name => assert.ok(files.has(name), '타격점 표의 ' + name));
const credits = fs.readFileSync(path.join(ROOT, 'public', 'assets', 'combat-fx', 'CREDITS.md'), 'utf8');
files.forEach(name => assert.ok(credits.includes('| ' + name + '.mp3 |'), name + '.mp3의 출처 기록'));
assert.ok(!/AudioContext\s*\(\)\.createOscillator|createOscillator|OscillatorNode/.test(fs.readFileSync(path.join(ROOT, 'public', 'combat-fx.js'), 'utf8')), '전투 연출 엔진은 소리를 합성하지 않고 녹음 음원만 재생한다.');

// 그림에서 잘라 쓰는 조각은 실제 그림 위의 다각형이어야 한다.
for (const [effectId, spec] of combatFx.partSpecs()) {
    assert.ok(fs.existsSync(imagePath(effectId)), effectId + ' 조각의 원본 그림');
    for (const [name, piece] of Object.entries(spec)) {
        assert.ok(Array.isArray(piece.poly) && piece.poly.length >= 3, effectId + '#' + name + ' 다각형');
        piece.poly.concat(piece.pivot ? [piece.pivot] : []).forEach(([x, y]) => assert.ok(x >= 0 && x <= 512 && y >= 0 && y <= 512, effectId + '#' + name + ' 좌표는 512 그림 안이어야 한다.'));
    }
}

// 세 전투 화면이 엔진을 싣고, 엔진이 없으면 기존 표시로 남아야 한다.
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
assert.strictEqual(server.split('<script src="/static/combat-fx.js"></script>').length - 1, 4, '필드, 일반 필드, 월드보스, PVP 페이지가 연출 엔진을 싣는다.');
assert.strictEqual(server.split('<script src="/static/combat-fx-scenes.js"></script>').length - 1, 4, '네 페이지가 장면집을 싣는다.');
assert.strictEqual(server.split('summons: getFieldSummonViews(user),').length - 1, 3, '필드와 월드보스 상태가 곁에 둘 소환수를 내려보낸다.');
for (const file of ['hfield.js', 'pvp.js', 'worldboss.js']) {
    const client = fs.readFileSync(path.join(ROOT, 'public', file), 'utf8');
    assert.ok(/combatFx\s*&&\s*effectCatalog\s*\?\s*combatFx\.create\(/.test(client), file + '는 연출 엔진을 만들 수 없을 때를 대비해야 한다.');
    assert.ok(client.includes('combatFx.companions(this.fx,'), file + '는 소환수를 곁에 띄운다.');
    assert.ok(client.includes('effectSprites'), file + '는 엔진이 없을 때 쓰는 기존 그림 표시를 지우지 않는다.');
}
console.log('combat fx scenes test passed (' + effectIds.length + ' effects, ' + files.size + ' sounds)');
