(function () {
    'use strict';

    const make = (tag, className, text) => {
        const node = document.createElement(tag);
        node.className = className;
        if (text) node.textContent = text;
        return node;
    };
    let context, output, muted = false;
    try { muted = localStorage.getItem('fusion-muted') === '1'; } catch (_) {}

    function updateVolume() {
        if (output) output.gain.value = muted || document.hidden ? 0 : .32;
    }
    document.addEventListener('visibilitychange', updateVolume);

    function unlockAudio() {
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!context && AudioContext) {
                context = new AudioContext();
                output = context.createGain();
                output.connect(context.destination);
            }
            updateVolume();
            if (context && context.state === 'suspended') return context.resume().catch(() => {});
        } catch (_) { /* Audio is optional; the result must always remain available. */ }
    }

    function sound(kind) {
        if (!context || !output || muted || document.hidden || context.state !== 'running') return;
        const notes = {
            gather: [130.81, 196, 261.63, 392], seal: [196, 293.66, 392],
            lucky: [659.25, 830.61, 987.77, 1318.51], protect: [196, 293.66, 587.33],
            success: [523.25, 659.25, 783.99, 1046.5], job: [440, 659.25, 880, 1108.73, 1318.51],
            fail: [220, 174.61, 130.81]
        }[kind];
        try {
            notes.forEach((frequency, i) => {
                const osc = context.createOscillator(), gain = context.createGain();
                const start = context.currentTime + i * .09, duration = kind === 'fail' ? .38 : .48;
                osc.type = kind === 'fail' || kind === 'gather' ? 'triangle' : 'sine';
                osc.frequency.setValueAtTime(frequency, start);
                if (kind === 'gather' || kind === 'fail') osc.frequency.exponentialRampToValueAtTime(frequency * (kind === 'fail' ? .65 : 1.8), start + duration);
                gain.gain.setValueAtTime(0, start);
                gain.gain.linearRampToValueAtTime(.22, start + .015);
                gain.gain.exponentialRampToValueAtTime(.001, start + duration);
                osc.connect(gain); gain.connect(output);
                osc.start(start); osc.stop(start + duration);
                osc.onended = () => { osc.disconnect(); gain.disconnect(); };
            });
        } catch (_) {}
    }

    function soundControl() {
        const button = make('button', 'fusion-sound');
        button.type = 'button';
        const update = () => {
            button.textContent = muted ? '♪ 효과음 꺼짐' : '♫ 효과음 켜짐';
            button.setAttribute('aria-label', '조합 효과음');
            button.setAttribute('aria-pressed', String(!muted));
        };
        update();
        button.onclick = () => {
            muted = !muted;
            try { localStorage.setItem('fusion-muted', muted ? '1' : '0'); } catch (_) {}
            unlockAudio();
            document.querySelectorAll('.fusion-sound').forEach(node => {
                node.textContent = muted ? '♪ 효과음 꺼짐' : '♫ 효과음 켜짐';
                node.setAttribute('aria-pressed', String(!muted));
            });
            if (!muted) sound('protect');
        };
        return button;
    }

    function begin(source, options = {}) {
        const audioReady = unlockAudio(); // Called directly from the user's click, before the request.
        const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
        const dialog = make('dialog', 'fusion-cinema' + (options.job ? ' job' : '') + (reduced ? ' reduced' : ''));
        dialog.setAttribute('aria-label', options.job ? '전직조합' : '카드 조합');
        const heading = make('h2', 'fusion-cinema-title', options.job ? '전직의 힘을 깨웁니다' : '카드의 힘을 하나로');
        const status = make('p', 'fusion-cinema-status', '재료 카드가 반응하고 있어요');
        status.setAttribute('role', 'status');
        const stage = source.cloneNode(true);
        stage.removeAttribute('id');
        stage.classList.remove('ready');
        stage.classList.add('fusion-cinema-stage');
        stage.setAttribute('aria-hidden', 'true');
        stage.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
        stage.querySelectorAll('button').forEach(node => { node.disabled = true; node.tabIndex = -1; });
        const result = stage.querySelector('.result');
        result.classList.add('empty');
        const materials = [0, 1, 2].map(i => stage.querySelector('.m' + i));
        const ring = make('div', 'fusion-ring');
        const core = make('div', 'fusion-core');
        const burst = make('div', 'fusion-burst');
        const sparks = make('div', 'fusion-sparks');
        for (let i = 0; i < 24; i++) {
            const spark = make('i', 'fusion-spark');
            spark.style.setProperty('--angle', (i * 137.5) + 'deg');
            spark.style.setProperty('--distance', (100 + i % 5 * 24) + 'px');
            spark.style.setProperty('--delay', (i % 6 * 35) + 'ms');
            sparks.append(spark);
        }
        const gif = make('img', 'fusion-original-effect');
        gif.alt = '';
        stage.append(ring, core, burst, sparks, gif);
        const support = options.protectIndex != null ? 'protect' : options.luckyRate != null ? 'lucky' : '';
        const badge = make('div', 'fusion-cinema-support ' + support);
        if (support) {
            const symbol = make('span', 'fusion-support-symbol', support === 'protect' ? '🛡' : '🍀');
            badge.append(symbol, make('span', '', support === 'protect' ? '보호 카드 · 재료에 보호막 부여' : '럭키 카드 · 성공 확률 ' + Math.round(options.luckyRate * 100) + '% 증가'));
            dialog.classList.add('with-' + support);
            if (support === 'protect') materials[options.protectIndex].classList.add('fusion-protected');
        }
        const details = make('div', 'fusion-cinema-details');
        const done = make('button', 'fusion-cinema-done', '결과 확인');
        done.type = 'button';
        done.disabled = true;
        dialog.append(soundControl(), heading, status, stage, badge, details, done);
        document.body.append(dialog);
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        dialog.showModal();
        const target = result.getBoundingClientRect();
        const bounds = stage.getBoundingClientRect();
        stage.style.setProperty('--core-x', ((target.left + target.width / 2 - bounds.left) / bounds.width * 100) + '%');
        stage.style.setProperty('--core-y', ((target.top + target.height / 2 - bounds.top) / bounds.height * 100) + '%');
        materials.forEach((card, i) => {
            const rect = card.getBoundingClientRect();
            card.style.setProperty('--merge-x', ((target.left + target.width / 2 - rect.left - rect.width / 2) / rect.width * 100) + '%');
            card.style.setProperty('--merge-y', ((target.top + target.height / 2 - rect.top - rect.height / 2) / rect.height * 100) + '%');
            card.style.setProperty('--tilt', (i - 1) * 14 + 'deg');
        });
        let closed = false, finish;
        const finished = new Promise(resolve => { finish = resolve; });
        const timers = new Map();
        const wait = ms => new Promise(resolve => {
            if (closed) return resolve();
            const timer = setTimeout(() => { timers.delete(timer); resolve(); }, ms);
            timers.set(timer, resolve);
        });
        function close() {
            if (closed) return;
            closed = true;
            timers.forEach((resolve, timer) => { clearTimeout(timer); resolve(); });
            timers.clear();
            gif.removeAttribute('src');
            dialog.close();
            dialog.remove();
            document.body.style.overflow = previousOverflow;
            if (output) output.gain.value = 0;
            window.removeEventListener('pagehide', close);
            finish();
        }
        window.addEventListener('pagehide', close);
        dialog.addEventListener('cancel', event => { event.preventDefault(); if (!done.disabled) close(); });
        done.onclick = close;
        const ready = (async () => {
            await Promise.race([audioReady, wait(150)]);
            if (closed) return;
            if (support) {
                sound(support);
                await wait(reduced ? 160 : 650);
            }
            if (closed) return;
            dialog.classList.add('gathering');
            sound('gather');
            await wait(reduced ? 160 : 950);
            if (closed) return;
            dialog.classList.add('sealing');
            if (!reduced) gif.src = '/combine-ui?file=' + encodeURIComponent('조합-이펙트.gif') + '&t=' + Date.now();
            sound('seal');
            await wait(reduced ? 120 : 1500);
            if (!closed) status.textContent = '조합 결과를 확인하고 있어요…';
        })();

        async function reveal(data) {
            await ready;
            if (closed) return;
            const card = data.resultCard;
            const img = result.querySelector('.slot-card');
            if (card && card.imageUrl) {
                // Give uncached card art a bounded head start without blocking the result.
                await Promise.race([new Promise(resolve => {
                    img.onload = img.onerror = resolve;
                    img.src = card.imageUrl;
                    if (img.complete) resolve();
                }), wait(1000)]);
                img.onload = img.onerror = null;
                result.classList.remove('empty');
            }
            if (closed) return;
            const message = String(data.message || '');
            const omega = message.startsWith('🌟 오메가');
            const success = options.job || !!data.success || omega;
            dialog.classList.add('revealed', success ? 'success' : 'failure');
            gif.removeAttribute('src');
            heading.textContent = options.job ? '전직조합 성공!' : omega ? '오메가 조합 완료!' : success ? (message.includes('확정') ? '확정 조합 성공!' : '조합 성공!') : '등급 상승 실패';
            status.textContent = options.job ? '새로운 힘이 깨어났습니다' : success ? '새로운 카드가 탄생했습니다' : '같은 등급의 카드를 획득했습니다';
            details.append(make('strong', 'fusion-cinema-card-name', card ? card.formatted || card.name : '조합 완료'));
            sound(success ? options.job ? 'job' : 'success' : 'fail');
            if (support === 'protect') {
                // Only announce preservation when the server confirms it.
                const preserved = !success && message.includes('재료 카드 1장을 보존');
                badge.replaceChildren(make('span', 'fusion-support-symbol', '🛡'), make('span', '', preserved ? '보호 성공 · 재료 카드 1장 보존' : '보호 카드 사용 완료'));
                if (preserved) {
                    const saved = materials[options.protectIndex].querySelector('img').cloneNode();
                    saved.className = 'fusion-saved-card';
                    saved.alt = options.cards[options.protectIndex].formatted || options.cards[options.protectIndex].name || '보존된 재료 카드';
                    details.append(make('div', 'fusion-saved-label', '보존된 재료'), saved);
                    dialog.classList.add('preserved');
                }
            } else if (support === 'lucky') {
                const decisive = success && message.startsWith('🍀');
                dialog.classList.toggle('lucky-triggered', decisive);
                badge.textContent = decisive ? '🍀 럭키 발동! 추가 확률로 조합 성공' : '🍀 럭키 카드 · 추가 확률 적용 완료';
            }
            await wait(reduced ? 60 : 450);
            if (closed) return;
            if (dialog.classList.contains('preserved')) sound('protect');
            if (dialog.classList.contains('lucky-triggered')) sound('lucky');
            await wait(reduced ? 60 : 400);
            if (closed) return;
            done.disabled = false;
            done.focus({ preventScroll: true });
            await finished;
        }
        return { ready, reveal, close };
    }

    window.FusionEffects = { begin, soundControl };
})();
