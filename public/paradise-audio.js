(function () {
    'use strict';
    const base = '/static/assets/paradise/audio/';
    const effects = new Set(), last = new Map();
    let muted = localStorage.getItem('paradise-muted') === '1', scene = null, track = null, previous = null, pending = null, fade = 0, generation = 0;
    const audible = () => !muted && !document.hidden;
    function stopEffects() { effects.forEach(sound => sound.pause()); effects.clear(); }
    function pauseMusic() {
        generation++; cancelAnimationFrame(fade); fade = 0;
        track?.pause(); previous?.pause(); pending?.pause(); previous = pending = null;
        if (track) track.volume = .22;
    }
    function playUrl(url, volume = .5, throttle = 0) {
        if (!audible()) return;
        const time = performance.now();
        if (time - (last.get(url) ?? -10000) < throttle) return;
        last.set(url, time);
        const sound = new Audio(url);
        sound.volume = volume;
        effects.add(sound); sound.onended = sound.onerror = () => effects.delete(sound);
        sound.play().then(() => { if (!audible() || !effects.has(sound)) sound.pause(); }).catch(() => effects.delete(sound));
    }
    function play(name, volume) {
        const key = name === 'tap' ? 'hover' : name;
        playUrl(base + key + '.mp3', volume ?? (key === 'hover' ? .17 : .50), key === 'hover' ? 90 : 65);
    }
    function music() {
        if (!audible() || !scene) return;
        const url = base + scene + '.mp3';
        if (track?.getAttribute('src') === url) {
            if (track.paused) { const token = generation, current = track; current.play().then(() => { if (token !== generation || !audible()) current.pause(); }).catch(() => {}); }
            return;
        }
        if (pending?.getAttribute('src') === url) return;
        pending?.pause(); const token = ++generation, next = pending = new Audio(url);
        next.loop = true; next.volume = track ? 0 : .22;
        next.play().then(() => {
            if (token !== generation || !audible() || !scene) { next.pause(); return; }
            cancelAnimationFrame(fade); previous?.pause(); previous = track; track = next; pending = null;
            if (!previous) return;
            const started = performance.now(), old = previous;
            const step = time => {
                if (token !== generation) return;
                const p = Math.min(1, (time - started) / 1500);
                next.volume = .22 * Math.sin(p * Math.PI / 2); old.volume = .22 * Math.cos(p * Math.PI / 2);
                if (p < 1) fade = requestAnimationFrame(step); else { old.pause(); previous = null; fade = 0; }
            };
            fade = requestAnimationFrame(step);
        }).catch(() => { if (pending === next) pending = null; });
    }
    window.ParadiseAudio = {
        get muted() { return muted; }, play, playUrl,
        unlock: music,
        setScene(next) { scene = next; if (scene) music(); else { pauseMusic(); track = null; } },
        toggle() { muted = !muted; localStorage.setItem('paradise-muted', muted ? '1' : '0'); if (muted) { pauseMusic(); stopEffects(); } else { music(); play('tap'); } },
        visibility() { if (document.hidden) { pauseMusic(); stopEffects(); } else music(); },
        stop() { scene = null; pauseMusic(); stopEffects(); track = null; }
    };
})();
