'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const compositor = require('../card_composite');
const characters = require('../DB/RPGenius/CharacterCards.json');
const manifest = require('../scripts/card_icon_assets.json');

test('정사각형 원본 79개는 업로드 명세와 일치하며 800×800 RGBA PNG다', () => {
    assert.equal(manifest.length, 79);
    for (const asset of manifest) {
        const bytes = fs.readFileSync(path.join(__dirname, '../DB/RPGenius', asset.category, asset.file));
        assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), asset.sha256, asset.file);
        const image = compositor.decodePng(bytes);
        assert.equal(image.width, 800); assert.equal(image.height, 800);
    }
});

test('전체 캐릭터·12성급·3유형 아이콘을 찾고 5성 미만 전직/각성은 일반 프레임을 쓴다', () => {
    for (const character of characters) for (const type of ['일반', '전직', '각성']) for (let star = 0; star < 12; star++) {
        const layers = compositor.resolveCardLayers({ name: character.name, type, star, square: true });
        assert.ok(layers, character.name + ' ' + type + ' ' + star);
        const effectiveType = star < 4 ? '일반' : type;
        assert.equal(path.basename(layers.character), effectiveType + ' ' + character.name + '.png');
        const grade = ['제타', '시그마', '오메가'][star - 9] || (star + 1) + '성';
        assert.equal(path.basename(layers.border), effectiveType + ' ' + grade + ' 프레임.png');
    }
    assert.equal(compositor.resolveCardLayers({ name: '../키노', star: 0, square: true }), null);
    assert.equal(compositor.resolveCardLayers({ name: '키노', star: 12, square: true }), null);
});

test('아이콘은 프레임 투명 영역에 원본 그림을 보존하고 세로 카드와 별도로 캐시한다', () => {
    for (const type of ['일반', '전직', '각성']) {
        const spec = { name: '키노', star: 10, type, square: true };
        const layers = compositor.resolveCardLayers(spec);
        const art = compositor.decodePng(fs.readFileSync(layers.character));
        const border = compositor.decodePng(fs.readFileSync(layers.border));
        const bytes = compositor.composeCardImage(spec), image = compositor.decodePng(bytes);
        assert.equal(image.width, 800); assert.equal(image.height, 800);
        const clear = border.rgba.findIndex((v, i) => i % 4 === 3 && v === 0) - 3;
        const solid = border.rgba.findIndex((v, i) => i % 4 === 3 && v === 255) - 3;
        assert.ok(clear >= 0 && solid >= 0);
        assert.deepEqual(image.rgba.subarray(clear, clear + 4), art.rgba.subarray(clear, clear + 4));
        assert.deepEqual(image.rgba.subarray(solid, solid + 4), border.rgba.subarray(solid, solid + 4));
        assert.equal(compositor.composeCardImage(spec), bytes);
        assert.equal(compositor.composeCardImage({ ...spec, skin: '미제공 스킨', prestige: true }), bytes);
    }
    const portrait = compositor.decodePng(compositor.composeCardImage({ name: '키노', star: 10, type: '전직' }));
    assert.notEqual(portrait.width, portrait.height);
    const marked = compositor.decodePng(compositor.composeCardImage({ name: '키노', star: 10, type: '전직', square: true, specter: true, awakeningSpecter: true }));
    assert.equal(marked.width, 800); assert.equal(marked.height, 800);
});
