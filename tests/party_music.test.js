const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'public', 'party.js'), 'utf8');
const music = source.slice(source.indexOf('    const RAID_BGM ='), source.indexOf('    // ====== 효과음'));

function player(onPlay) {
    const gestures = {}, audios = [], frames = new Map();
    let clock = 0, frameId = 0;
    const context = vm.createContext({
        sound: { bgm: .18 },
        preloadSfx() {},
        document: { addEventListener: (name, handler) => { gestures[name] = handler; } },
        performance: { now: () => clock },
        requestAnimationFrame: handler => { frames.set(++frameId, handler); return frameId; },
        cancelAnimationFrame: id => frames.delete(id),
        Audio: class {
            constructor(url) { this.paused = true; this.currentTime = 0; this.plays = 0; this.loads = 0; if (url) this.src = url; audios.push(this); }
            set src(url) { this.url = url; this.loads++; this.currentTime = 0; }
            get src() { return this.url; }
            play() {
                this.paused = false; this.plays++;
                return (onPlay ? onPlay(this) : Promise.resolve()).then(() => { this.paused = false; }, error => { this.paused = true; throw error; });
            }
            pause() { this.paused = true; }
        }
    });
    vm.runInContext(music + '\nglobalThis.player = { get bgm() { return bgm; }, get fading() { return fadingBgm; }, sound, syncBgm, updateBgmVolume, finishBgmFade, tracks: RAID_BGM, defeat: value => { defeatActive = value; } };', context);
    return Object.assign(context.player, {
        gestures, audios,
        settle: () => new Promise(setImmediate),
        advance(ms) { clock += ms; const callbacks = [...frames.values()]; frames.clear(); for (const handler of callbacks) handler(clock); },
        getFrameCount: () => frames.size
    });
}

test('모든 레이드 난이도에 음악이 있으며 흑화 호두는 기존 음원을 유지한다', () => {
    const { tracks, bgm } = player();
    const quests = JSON.parse(fs.readFileSync(path.join(root, 'DB', 'RPGenius', 'PartyQuest.json'), 'utf8')).quests;
    for (const quest of quests) assert.ok(tracks[quest.id], quest.id);
    assert.equal(tracks.blackHodu[0], 'boss fight.mp3');
    assert.deepEqual(tracks.blackHoduExtreme, tracks.blackHodu);
    assert.equal(tracks.butaGame[0], 'sfx/부타게임.mp3');
    assert.deepEqual(tracks.butaGameHard, tracks.butaGame);
    assert.deepEqual(tracks.mansionHard, tracks.mansionNormal);
    assert.deepEqual(tracks.mansionNightmare, tracks.mansionNormal);
    assert.equal(tracks.mansionNormal[0], 'sfx/E세계대저택 1관문.mp3');
    assert.equal(tracks.mansionNormal[1], 'sfx/E세계대저택 2관문.mp3');
    assert.equal(new Set(Object.values(tracks).flat()).size, 4);
    assert.equal(bgm.loop, true);
    assert.equal(bgm.volume, .18);
    assert.equal(bgm.preload, 'none');
});

test('음악은 레이드 전환 때 교체되고 전투 갱신 때 이어지며 종료·음소거·재생 재시도를 지원한다', async () => {
    const p = player();
    const { sound, syncBgm, tracks, defeat, gestures } = p;
    const room = (questId, state = 'inProgress') => ({ questId, state });
    const url = file => '/rpg-ui?file=' + encodeURIComponent(file);
    syncBgm(room('blackHodu', 'lobby'));
    assert.equal(p.bgm.plays, 0);
    syncBgm(room('blackHodu'));
    await p.settle();
    assert.equal(p.bgm.src, url(tracks.blackHodu[0]));
    p.bgm.currentTime = 12;
    syncBgm(room('blackHodu'));
    syncBgm(room('blackHoduExtreme'));
    assert.equal(p.bgm.currentTime, 12);
    assert.equal(p.bgm.plays, 1);
    assert.equal(p.bgm.loads, 1);
    syncBgm(room('butaGame'));
    await p.settle();
    assert.equal(p.bgm.src, url(tracks.butaGame[0]));
    assert.equal(p.bgm.currentTime, 0);
    p.bgm.currentTime = 8;
    syncBgm(room('butaGameHard'));
    assert.equal(p.bgm.currentTime, 8);
    syncBgm(room('mansionNightmare'));
    await p.settle();
    assert.equal(p.bgm.src, url(tracks.mansionNormal[0]));
    defeat(true);
    syncBgm(room('mansionNightmare', 'failed'));
    assert.equal(p.bgm.paused, false);
    defeat(false);
    syncBgm(room('mansionNightmare', 'failed'));
    assert.equal(p.bgm.paused, true);
    assert.equal(p.bgm.currentTime, 0);
    sound.bgm = 0;
    syncBgm(room('butaGame'));
    const plays = p.bgm.plays;
    gestures.pointerdown();
    assert.equal(p.bgm.plays, plays);
    sound.bgm = .3;
    gestures.keydown();
    await p.settle();
    assert.equal(p.bgm.paused, false);
    syncBgm(null);
    gestures.pointerdown();
    assert.equal(p.bgm.paused, true);
    assert.ok(p.audios.every(audio => audio.paused));
});

test('대저택은 모든 난이도에서 관문별로 교체하고 같은 관문 갱신에서는 음악을 이어간다', async () => {
    for (const questId of ['mansionNormal', 'mansionHard', 'mansionNightmare']) {
        const p = player();
        const { syncBgm } = p;
        const room = phaseIndex => ({ questId, phaseIndex, state: 'inProgress' });
        syncBgm(room(0));
        await p.settle();
        assert.equal(p.bgm.src, '/rpg-ui?file=' + encodeURIComponent('sfx/E세계대저택 1관문.mp3'));
        p.bgm.currentTime = 45;
        syncBgm(room(0));
        assert.equal(p.bgm.currentTime, 45);
        syncBgm(room(1));
        await p.settle();
        assert.equal(p.bgm.src, '/rpg-ui?file=' + encodeURIComponent('sfx/E세계대저택 2관문.mp3'));
        assert.equal(p.bgm.currentTime, 0);
        assert.equal(p.bgm.paused, false);
        p.bgm.currentTime = 30;
        syncBgm(room(1));
        assert.equal(p.bgm.currentTime, 30);
        syncBgm(room(0));
        await p.settle();
        assert.equal(p.bgm.src, '/rpg-ui?file=' + encodeURIComponent('sfx/E세계대저택 1관문.mp3'));
        assert.equal(p.bgm.currentTime, 0);
    }
});

test('다른 곡은 1.5초 동안 교차하며 중간 음량과 사용자의 볼륨 설정을 유지한다', async () => {
    const p = player();
    p.syncBgm({ questId: 'mansionNormal', phaseIndex: 0, state: 'inProgress' }); await p.settle();
    const previous = p.bgm; previous.currentTime = 42;
    p.syncBgm({ questId: 'mansionNormal', phaseIndex: 1, state: 'inProgress' }); await p.settle();
    const next = p.bgm;
    assert.equal(previous.paused, false); assert.equal(previous.currentTime, 42); assert.equal(next.volume, 0);
    p.advance(750);
    assert.ok(Math.abs(previous.volume - .18 / Math.sqrt(2)) < 1e-9);
    assert.ok(Math.abs(next.volume - previous.volume) < 1e-9);
    p.sound.bgm = .4; p.updateBgmVolume();
    assert.ok(Math.abs(next.volume - .4 / Math.sqrt(2)) < 1e-9);
    assert.ok(Math.abs(previous.volume - next.volume) < 1e-9);
    p.advance(750);
    assert.equal(previous.paused, true); assert.equal(next.volume, .4); assert.equal(next.paused, false);
    assert.equal(p.fading, null); assert.equal(p.getFrameCount(), 0);
});

test('부타게임의 같은 곡은 다음 관문과 하드 전환에도 멈추거나 교차하지 않는다', async () => {
    const p = player();
    p.syncBgm({ questId: 'butaGame', phaseIndex: 0, state: 'inProgress' }); await p.settle();
    const original = p.bgm; original.currentTime = 90;
    p.syncBgm({ questId: 'butaGame', phaseIndex: 1, state: 'inProgress' });
    p.syncBgm({ questId: 'butaGameHard', phaseIndex: 1, state: 'inProgress' });
    assert.equal(p.bgm, original); assert.equal(original.currentTime, 90); assert.equal(original.volume, .18);
    assert.equal(original.plays, 1); assert.equal(p.fading, null); assert.equal(p.getFrameCount(), 0);
});

test('다음 곡이 준비될 때까지 이전 곡이 유지되고 방을 떠난 뒤 늦게 끝난 재생도 정리한다', async () => {
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const p = player(audio => audio.src.includes(encodeURIComponent('2관문')) ? pending : Promise.resolve());
    p.syncBgm({ questId: 'mansionNormal', phaseIndex: 0, state: 'inProgress' }); await p.settle();
    const previous = p.bgm;
    p.syncBgm({ questId: 'mansionNormal', phaseIndex: 1, state: 'inProgress' });
    p.advance(5000);
    assert.equal(previous.paused, false); assert.equal(previous.volume, .18); assert.equal(p.bgm.volume, 0);
    assert.equal(p.getFrameCount(), 0);
    p.syncBgm(null); release(); await p.settle();
    assert.ok(p.audios.every(audio => audio.paused)); assert.equal(p.fading, null); assert.equal(p.getFrameCount(), 0);
});

test('교차 도중 음소거하면 두 곡과 프레임을 정리하고 다시 켰을 때 현재 곡만 재생한다', async () => {
    const p = player(), room = { questId: 'mansionNormal', phaseIndex: 0, state: 'inProgress' };
    p.syncBgm(room); await p.settle(); const previous = p.bgm;
    p.syncBgm({ ...room, phaseIndex: 1 }); await p.settle(); p.advance(500);
    p.sound.bgm = 0; p.updateBgmVolume(); p.finishBgmFade(); p.bgm.pause();
    assert.ok(p.audios.every(audio => audio.paused)); assert.equal(p.getFrameCount(), 0);
    p.sound.bgm = .3; p.updateBgmVolume(); p.gestures.pointerdown(); await p.settle();
    assert.equal(p.bgm.paused, false); assert.equal(previous.paused, true); assert.equal(p.bgm.volume, .3);
});

test('자동 재생 차단 후 사용자 입력에서 다시 재생한다', async () => {
    let blocked = true;
    const p = player(() => blocked ? Promise.reject(new Error('NotAllowedError')) : Promise.resolve());
    p.syncBgm({ questId: 'blackHodu', state: 'inProgress' }); await p.settle();
    assert.equal(p.bgm.paused, true);
    blocked = false; p.gestures.pointerdown(); await p.settle();
    assert.equal(p.bgm.paused, false); assert.equal(p.bgm.plays, 2);
});
