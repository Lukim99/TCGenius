const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
// 서버를 시작하지 않고 실제 선택 함수와 로컬 스프라이트 파일을 검증한다.
const spriteSource = source.slice(source.indexOf('function getHFieldSpritePart'), source.indexOf('function buildHFieldState'));
const getSprite = new Function('fs', 'path', 'RPG_UI_PATH', spriteSource + '\nreturn getHFieldCharacterSprite;')(
    fs, path, path.join(root, 'DB', 'RPGenius', 'ui')
);
const spriteFile = card => decodeURIComponent(getSprite(card).split('file=')[1]);

test('일반 전용 아바타를 전직 카드에 장착해도 해당 스킨을 표시한다', () => {
    for (const name of ['딜러장', '흠시원']) {
        for (const skin of ['수영장 파티', '고급 수영장 파티']) {
            for (const type of ['일반', '전직']) {
                assert.equal(spriteFile({ name, skin, type }), '필드/캐릭터/' + name + '__일반__' + skin + '.png');
            }
        }
    }
});

test('전직 전용 아바타도 카드 타입과 관계없이 표시한다', () => {
    for (const type of ['일반', '전직']) {
        assert.equal(spriteFile({ name: '딜러장', skin: '산타', type }), '필드/캐릭터/딜러장__전직__산타.png');
    }
});

test('동일한 아바타의 일반/전직 파일이 모두 있어도 같은 외형을 선택한다', () => {
    for (const type of ['일반', '전직']) {
        assert.equal(spriteFile({ name: '딜러장', skin: '체리 바이트', type }), '필드/캐릭터/딜러장__일반__체리 바이트.png');
    }
});

test('외형 미장착 또는 파일 누락 시 기존 기본 캐릭터를 표시한다', () => {
    for (const skin of ['', '없는 아바타']) {
        assert.equal(spriteFile({ name: '딜러장', skin, type: '일반' }), '필드/캐릭터/딜러장.png');
        assert.equal(spriteFile({ name: '딜러장', skin, type: '전직' }), '필드/캐릭터/딜러장__전직.png');
    }
    assert.equal(spriteFile({ name: '딜러장', type: '전직', statSkin: '수영장 파티' }), '필드/캐릭터/딜러장__전직.png');
    assert.equal(spriteFile(null), '필드/hfield-hunter.png');
    assert.equal(spriteFile({ name: '없는 캐릭터' }), '필드/hfield-hunter.png');
});

test('일반 필드, 헬 필드, 월드보스와 PVP가 공통 스프라이트 선택을 사용한다', () => {
    for (const name of ['buildGeneralFieldState', 'buildHFieldState', 'buildWorldBossState']) {
        const body = source.match(new RegExp('^function ' + name + '\\([^]*?^}', 'm'));
        assert.ok(body && body[0].includes('spriteUrl: getHFieldCharacterSprite(mainCard)'), name);
    }
    assert.ok(source.includes('pvp.configure({ serializeCard, getCharacterSprite: getHFieldCharacterSprite,'));
});
