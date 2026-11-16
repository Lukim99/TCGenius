(() => {
    'use strict';
    let overlay, timer;
    function close() { clearTimeout(timer); overlay?.remove(); overlay = null; }
    function play(event) {
        const scene = event?.uniqueCutscene;
        if (!scene?.url || document.hidden) return;
        close();
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        overlay = document.createElement('div');
        overlay.setAttribute('role', 'status');
        overlay.setAttribute('aria-label', scene.characterName + ' 유니크 궁극기 ' + scene.skillName);
        const stage = document.querySelector('.pq-game-stagewrap');
        Object.assign(overlay.style, { position: stage ? 'absolute' : 'fixed', inset: '0', zIndex: stage ? '20' : '850', pointerEvents: 'none', display: 'grid', placeItems: 'center', background: 'rgba(5,8,13,.68)', visibility: 'hidden' });
        const art = document.createElement('img'); art.src = reduced && scene.posterUrl ? scene.posterUrl : scene.url; art.alt = '';
        Object.assign(art.style, { width: '100%', height: '100%', objectFit: 'contain', maxHeight: '100dvh' });
        const label = document.createElement('div'); label.textContent = scene.characterName + ' · ' + scene.skillName;
        Object.assign(label.style, { position: 'absolute', bottom: '8%', padding: '10px 28px', color: '#fff4d2', background: '#111720', borderTop: '1px solid #c8a45c', font: '700 18px Pretendard, sans-serif' });
        overlay.append(art, label); (stage || document.body).append(overlay);
        const current = overlay;
        art.onload = () => {
            if (overlay !== current) return;
            current.style.visibility = 'visible';
            if (!reduced) current.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140 });
            clearTimeout(timer);
            timer = setTimeout(close, reduced ? 700 : 1800);
        };
        art.onerror = () => { if (overlay === current) close(); };
        timer = setTimeout(close, 10000);
    }
    document.addEventListener('visibilitychange', () => { if (document.hidden) close(); });
    window.addEventListener('pagehide', close);
    window.UniqueAvatarCutscene = { play, close };
})();
