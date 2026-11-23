(function () {
    'use strict';
    // 도감 무대: 종류 난간, 목록 칸, 상세 창으로 이뤄진 게임식 탐색 화면.
    // 내용과 탐색 동작은 app.js의 도감 함수가 맡고, 이 파일은 닫기, Esc, 종류 단추 따라가기, 효과음만 맡는다.
    const shell = document.getElementById('dexShell');
    if (!shell) return;
    const page = shell.closest('.page'), sound = document.getElementById('dexSound');
    const tabs = [...shell.querySelectorAll('.dex-tab')];
    const sheet = window.matchMedia('(max-width: 900px), (orientation: portrait) and (max-width: 1100px)');
    const MUTE_KEY = 'dex-muted';
    let tap = null;

    const muted = () => { try { return localStorage.getItem(MUTE_KEY) === '1'; } catch (_) { return false; } };
    // 종류를 옮길 때만 짧은 녹음 효과음을 낸다(assets/account-stage/CREDITS.md).
    function playTap() {
        if (muted() || document.hidden) return;
        try {
            tap = tap || new Audio('/static/assets/account-stage/tap.mp3');
            tap.volume = .26; tap.currentTime = 0;
            const played = tap.play(); if (played) played.catch(() => {});
        } catch (_) { /* 소리 없이도 도감은 그대로 동작한다. */ }
    }

    function follow() {
        const active = tabs.find(tab => tab.classList.contains('active'));
        tabs.forEach(tab => { if (tab === active) tab.setAttribute('aria-current', 'true'); else tab.removeAttribute('aria-current'); });
        if (active && page.classList.contains('active')) active.scrollIntoView({ block: 'nearest', inline: 'center' });
    }
    // 상세 창의 단추로 다른 종류로 건너가도 난간이 따라가게 한다.
    new MutationObserver(follow).observe(shell.querySelector('.dex-tabs'), { attributes: true, attributeFilter: ['class'], subtree: true });
    new MutationObserver(follow).observe(page, { attributes: true, attributeFilter: ['class'] });

    tabs.forEach((tab, i) => {
        tab.addEventListener('click', playTap);
        tab.addEventListener('keydown', event => {
            const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
            if (!step) return;
            event.preventDefault();
            tabs[(i + step + tabs.length) % tabs.length].focus();
        });
    });

    function exit() { if (typeof activatePage === 'function') activatePage('home'); }
    document.getElementById('dexExit').addEventListener('click', exit);
    document.addEventListener('keydown', event => {
        if (event.key !== 'Escape' || !page.classList.contains('active')) return;
        if (document.querySelector('.modal-bg.active, dialog[open], .enhance-overlay.active')) return;
        event.preventDefault();
        // 좁은 화면에서는 먼저 상세 창을 내리고, 그다음 Esc에 도감을 나간다.
        if (sheet.matches && shell.dataset.dock === 'open') { document.getElementById('dexDockBack').click(); return; }
        if (document.activeElement && document.activeElement.id === 'dexSearch' && document.activeElement.value) { document.getElementById('dexSearchClear').click(); return; }
        exit();
    }, true); // 공용 모달이 같은 Esc로 닫히기 전에 먼저 확인한다.

    sound.setAttribute('aria-pressed', String(!muted()));
    sound.addEventListener('click', () => {
        const next = !muted();
        try { localStorage.setItem(MUTE_KEY, next ? '1' : '0'); } catch (_) { /* 저장하지 못하면 이번 방문에만 적용된다. */ }
        sound.setAttribute('aria-pressed', String(!next));
        if (!next) playTap();
    });
    follow();
})();
