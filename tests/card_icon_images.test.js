'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const workerThreads = require('node:worker_threads');
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

test('비동기 합성은 타이머를 실행시키며 동시 요청에도 기존 PNG 바이트를 보존한다', async () => {
    const specs = [
        { name: '키노', star: 10, type: '전직' },
        { name: '키노', star: 10, type: '전직', square: true },
        { name: '키노', star: 10, type: '전직', square: true, specter: true, awakeningSpecter: true }
    ];
    let ticks = 0;
    const timer = setInterval(() => ticks++, 10);
    let buffers;
    try {
        buffers = await Promise.all(specs.map(spec => compositor.composeCardImageAsync(spec)));
    } finally {
        clearInterval(timer);
    }
    assert.ok(ticks > 0, '합성 도중 메인 이벤트 루프의 타이머가 실행되어야 한다');
    for (let i = 0; i < specs.length; i++) {
        assert.ok(Buffer.isBuffer(buffers[i]));
        assert.deepEqual(buffers[i], compositor.composeCardImage(specs[i]));
        assert.deepEqual(await compositor.composeCardImageAsync(specs[i]), buffers[i], 'worker 캐시 Buffer는 반환 후에도 유효하다');
    }
    assert.equal(await compositor.composeCardImageAsync({ name: '../키노', star: 0, square: true }), null);
});

test('단일 작업 스레드는 mtime 변경을 반영하고 종료·오류 뒤 다음 요청에서 복구한다', async t => {
    // 원본 에셋을 변경하지 않고 같은 모듈과 레이어를 임시 디렉터리에 복사한다.
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rpgenius-card-worker-'));
    assert.equal(path.dirname(fixtureRoot), path.resolve(os.tmpdir()));
    const modulePath = path.join(fixtureRoot, 'card_composite.js');
    const workerPath = path.join(fixtureRoot, 'card_composite_worker.js');
    const workers = [];
    t.after(async () => {
        await Promise.all(workers.map(worker => worker.terminate()));
        delete require.cache[modulePath];
        assert.equal(path.dirname(path.resolve(fixtureRoot)), path.resolve(os.tmpdir()));
        fs.rmSync(fixtureRoot, { recursive: true, force: true });
    });
    fs.copyFileSync(path.join(__dirname, '../card_composite.js'), modulePath);
    fs.copyFileSync(path.join(__dirname, '../card_composite_worker.js'), workerPath);
    const source = compositor.resolveCardLayers({ name: '키노', type: '일반', star: 10, square: true });
    const artDir = path.join(fixtureRoot, 'DB/RPGenius/cardImage/아이콘/이미지');
    const frameDir = path.join(fixtureRoot, 'DB/RPGenius/cardImage/아이콘/프레임');
    fs.mkdirSync(artDir, { recursive: true });
    fs.mkdirSync(frameDir, { recursive: true });
    const art = path.join(artDir, '일반 fixture.png');
    fs.copyFileSync(source.character, art);
    fs.copyFileSync(source.border, path.join(frameDir, path.basename(source.border)));
    const OriginalWorker = workerThreads.Worker;
    const workerMock = t.mock.method(workerThreads, 'Worker', class extends OriginalWorker {
        constructor(...args) {
            super(...args);
            workers.push(this);
        }
    });
    const isolated = require(modulePath);
    workerMock.mock.restore();
    const spec = { name: 'fixture', type: '일반', star: 10, square: true };
    const [first, repeated] = await Promise.all([isolated.composeCardImageAsync(spec), isolated.composeCardImageAsync(spec)]);
    assert.equal(workers.length, 1, '동시 요청은 작업 스레드를 공유한다');
    assert.deepEqual(first, repeated);
    assert.deepEqual(first, isolated.composeCardImage(spec));

    const originalMtime = fs.statSync(art).mtimeMs;
    const replacement = compositor.resolveCardLayers({ name: '키노', type: '전직', star: 10, square: true });
    fs.copyFileSync(replacement.character, art);
    fs.utimesSync(art, new Date(), new Date(originalMtime + 2000));
    const changed = await isolated.composeCardImageAsync(spec);
    assert.notDeepEqual(changed, first, '에셋 변경 시 이전 PNG를 반환하면 안 된다');
    assert.deepEqual(changed, isolated.composeCardImage(spec));

    // 구조화 복제 실패도 대기 요청을 남기지 않고 다음 요청을 처리한다.
    await assert.rejects(isolated.composeCardImageAsync({ ...spec, invalid: () => {} }), { name: 'DataCloneError' });
    assert.deepEqual(await isolated.composeCardImageAsync(spec), changed);
    fs.utimesSync(art, new Date(), new Date(originalMtime + 4000));
    const interrupted = [isolated.composeCardImageAsync(spec), isolated.composeCardImageAsync(spec)];
    const rejected = Promise.all(interrupted.map(job => assert.rejects(job, /Card image worker exited/)));
    await workers[0].terminate();
    await rejected;

    fs.writeFileSync(workerPath, "throw new Error('test worker failure');\n");
    await Promise.all([0, 1].map(() => assert.rejects(isolated.composeCardImageAsync(spec), /test worker failure/)));
    assert.equal(workers.length, 2);
    fs.copyFileSync(path.join(__dirname, '../card_composite_worker.js'), workerPath);
    assert.deepEqual(await isolated.composeCardImageAsync(spec), changed);
    assert.equal(workers.length, 3, '실패한 스레드는 다음 요청에서 다시 생성한다');
});
