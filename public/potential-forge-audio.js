// CC0 외부 음원 재생. 원본 출처와 편집 내역은 assets/potential-forge/CREDITS.md 참고.
(() => {
    'use strict';
    const FILES = ['select', 'charge', 'impact', 'resonance', 'bloom', 'victory'];
    const PREF = 'potential-forge-sound';
    let enabled = true;
    try { enabled = localStorage.getItem(PREF) !== 'off'; } catch (_) { }
    let context, master, epoch = 0;
    const buffers = new Map(), loading = new Map(), voices = new Set();

    function load(name) {
        if (buffers.has(name)) return Promise.resolve(buffers.get(name));
        if (!loading.has(name)) {
            const task = fetch('/static/assets/potential-forge/' + name + '.mp3')
                .then(response => { if (!response.ok) throw new Error('Audio unavailable'); return response.arrayBuffer(); })
                .then(bytes => context.decodeAudioData(bytes))
                .then(buffer => { buffers.set(name, buffer); return buffer; })
                .catch(() => null)
                .finally(() => loading.delete(name));
            loading.set(name, task);
        }
        return loading.get(name);
    }

    // 사용자 입력 안에서 AudioContext를 열고 재개한다. 재생 준비가 게임 동작을 막지 않는다.
    function unlock() {
        if (!enabled) return Promise.resolve();
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) return Promise.resolve();
        if (!context) {
            context = new Audio();
            master = context.createGain();
            master.gain.value = 0.6;
            const compressor = context.createDynamicsCompressor();
            compressor.threshold.value = -12;
            compressor.knee.value = 12;
            compressor.ratio.value = 5;
            compressor.attack.value = 0.004;
            compressor.release.value = 0.2;
            master.connect(compressor).connect(context.destination);
        }
        const resumed = context.state === 'suspended' ? context.resume().catch(() => {}) : Promise.resolve();
        return Promise.all([resumed, ...FILES.map(load)]);
    }

    function fade(voice) {
        const now = context.currentTime;
        voice.gain.gain.cancelScheduledValues(now);
        voice.gain.gain.setTargetAtTime(0, now, 0.015);
        try { voice.source.stop(now + 0.06); } catch (_) { }
    }

    function stop() {
        epoch++;
        if (context) voices.forEach(fade);
    }

    function sample(name, volume, rate, delay, token) {
        load(name).then(buffer => {
            if (!buffer || !enabled || token !== epoch || document.hidden || context.state !== 'running') return;
            while (voices.size >= 10) {
                const oldest = voices.values().next().value;
                fade(oldest); voices.delete(oldest);
            }
            const source = context.createBufferSource(), gain = context.createGain();
            source.buffer = buffer;
            source.playbackRate.value = rate;
            gain.gain.value = volume;
            source.connect(gain).connect(master);
            const voice = { source, gain };
            voices.add(voice);
            source.onended = () => { voices.delete(voice); source.disconnect(); gain.disconnect(); };
            source.start(context.currentTime + delay);
        });
    }

    function play(name, grade) {
        if (!enabled || !context || document.hidden) return;
        if (name === 'win' || name === 'tier') stop();
        const token = epoch;
        const cue = (file, volume = 0.5, rate = 1, delay = 0) => sample(file, volume, rate, delay, token);
        switch (name) {
            case 'select': cue('select', 0.6); break;
            case 'charge': cue('charge', 0.55); cue('impact', 0.25, 0.85); break;
            case 'tick': cue('impact', 0.38, 1.1); break;
            case 'line':
                cue('impact', 0.3, grade === 'platinum' ? 0.85 : 1);
                if (grade === 'platinum' || grade === 'gold') cue('resonance', grade === 'platinum' ? 0.58 : 0.35, grade === 'platinum' ? 1.12 : 1, 0.04);
                break;
            case 'lamp': cue('bloom', 0.4, 1.05); break;
            case 'win': cue('impact', 0.65, 0.8); cue('victory', 0.7, 1, 0.08); cue('bloom', 0.35, 0.9, 0.1); break;
            case 'tier': cue('impact', 0.75, 0.7); cue('victory', 0.8, 0.94, 0.12); cue('bloom', 0.5, 0.82, 0.18); break;
            case 'halt': cue('impact', 0.23, 0.75); break;
        }
    }

    function toggle() {
        enabled = !enabled;
        try { localStorage.setItem(PREF, enabled ? 'on' : 'off'); } catch (_) { }
        if (enabled) unlock(); else stop();
        return enabled;
    }

    window.addEventListener('pagehide', stop);
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
    window.PotentialForgeAudio = { get enabled() { return enabled; }, unlock, toggle, play, stop };
})();
