(function () {
    'use strict';
    // 쌍문(雙門) 파견 화면: 화면 전체를 두 세계의 문으로 가르고, 고른 문이 열리며 출발한다.
    const STAGE = '/static/assets/account-stage/';
    const ART = { hell: '/rpg-ui?file=' + encodeURIComponent('필드/부타게임H.png'), heaven: '/static/assets/paradise/corridor.webp' };
    const MUTE_KEY = 'dispatch-muted', SEEN_KEY = 'dispatch-return-seen', CLOSED_KEY = 'dispatch-report-closed';
    const DEPART_MS = 2300, RETURN_MS = 2400, RETURN_REVEAL_MS = 940;
    const ICONS = {
        back: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M12.5 4.5L7 10l5.5 5.5"/></svg>',
        sound: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 8v4h3l4 3.2V4.8L6.5 8z"/><path class="wave" d="M13.2 7.4a3.6 3.6 0 010 5.2M15.2 5.4a6.4 6.4 0 010 9.2"/><path class="cut" d="M13.4 7.8l4 4.4M17.4 7.8l-4 4.4"/></svg>'
    };

    let root, api, postApi, onClose, state = null, clock = 0, generation = 0, offset = 0, busy = false, pending = null;
    let refreshAt = 0, lastFetch = 0, fetchToken = 0, lastSig = '';
    let frozen = null, fresh = false, cineChain = Promise.resolve(), cineSkip = null, returnsQueued = 0;
    let parts = null;
    const bank = {};

    const el = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text != null) node.textContent = text; return node; };
    const fmt = value => Number(value || 0).toLocaleString('ko-KR');
    const load = key => { try { return localStorage.getItem(key) || ''; } catch (_) { return ''; } };
    const save = (key, value) => { try { localStorage.setItem(key, value); } catch (_) { /* 저장소를 못 쓰면 이번 방문에만 적용한다. */ } };
    const characterKey = key => key + ':' + state.characterName;
    const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const now = () => Date.now() + offset;
    function time(ms) {
        const seconds = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(seconds / 3600), m = Math.floor(seconds % 3600 / 60), s = seconds % 60;
        if (h) return h + '시간' + (m ? ' ' + m + '분' : '');
        if (m) return m + '분' + (s ? ' ' + s + '초' : '');
        return s + '초';
    }
    function button(label, fn, cls) { const node = el('button', cls, label); node.type = 'button'; node.onclick = fn; return node; }
    function iconButton(icon, label, fn, cls) { const node = button(null, fn, cls); node.innerHTML = ICONS[icon]; node.setAttribute('aria-label', label); return node; }
    const destinationOf = id => state.destinations.find(dest => dest.id === id) || { id, name: '' };

    // 효과음은 사용자 동작과 실제 출발, 귀환에만 짧게 낸다. 녹음 출처는 assets/account-stage/CREDITS.md.
    function sfx(name, volume) {
        if (load(MUTE_KEY) === '1' || document.hidden) return;
        try {
            const audio = bank[name] || (bank[name] = new Audio(STAGE + name + '.mp3'));
            audio.volume = volume; audio.currentTime = 0;
            const played = audio.play(); if (played) played.catch(() => {});
        } catch (_) { /* 소리를 못 내도 화면은 그대로 동작한다. */ }
    }

    function error(message) { if (parts) parts.error.textContent = message || ''; }

    function receive(data, started) {
        if (state && !started && data.serverTime < state.serverTime) return; // 늦게 도착한 옛 응답
        state = data; offset = data.serverTime - Date.now(); refreshAt = 0; error('');
        const run = data.run;
        if (started && run) enqueue('depart', run);
        if (run && run.status === 'completed' && load(characterKey(SEEN_KEY)) !== run.id && load(SEEN_KEY) !== run.id) {
            // 귀환 연출은 서버가 완료를 알려 준 파견마다 한 번만 보여 준다.
            save(characterKey(SEEN_KEY), run.id);
            enqueue('return', run);
        }
        render();
    }

    async function refresh() {
        if (busy) return;
        const turn = generation, token = ++fetchToken; lastFetch = Date.now();
        try {
            const data = await api('/api/dispatch');
            if (root && turn === generation && token === fetchToken && !busy) receive(data);
        } catch (e) {
            if (root && turn === generation && token === fetchToken) { error(e.message); refreshAt = Date.now() + 5000; if (!state) renderFailure(); }
        }
    }

    async function start(destination) {
        if (busy || !state) return;
        if (pending && pending.destination !== destination) return;
        pending ||= { destination, requestId: crypto.randomUUID(), previousId: state.run?.id || null };
        busy = true; fetchToken++; error(''); renderButtons();
        const turn = generation, request = pending;
        try {
            const data = await postApi('/api/dispatch/start', request);
            pending = null;
            if (root && turn === generation) receive(data, !!data.run && data.run.id !== request.previousId);
        } catch (e) {
            if (root && turn === generation) {
                if (e.status && e.status < 500) pending = null;
                // 응답만 잃은 경우를 새 구매 없이 확인한다.
                try {
                    const data = await api('/api/dispatch');
                    const arrived = !!data.run && data.run.id === request.requestId;
                    if (arrived) pending = null;
                    else if (!data.run || data.run.id === request.previousId) { /* 같은 요청으로 다시 시도할 수 있게 둔다. */ }
                    else pending = null;
                    if (turn === generation) receive(data, arrived);
                    if (arrived) return;
                } catch (_) { /* 연결이 돌아오면 같은 요청을 다시 보낼 수 있다. */ }
                error(e.message); sfx('deny', .3);
            }
        } finally {
            busy = false;
            if (root && turn === generation) renderButtons();
            else if (root && !state) refresh();
        }
    }

    function renderButtons() {
        if (!root || !state) return;
        root.querySelectorAll('[data-dispatch]').forEach(node => {
            const destination = destinationOf(node.dataset.dispatch), mine = pending?.destination === destination.id;
            node.disabled = busy || !!destination.blocked || !!pending && !mine;
            node.textContent = busy && mine ? '출발 중' : mine ? '같은 요청 재시도' : '파견 보내기';
            node.closest('.dispatch-door')?.classList.toggle('is-charging', busy && mine);
        });
    }

    function tick() {
        if (!root || !state) return;
        const shown = frozen || state.run;
        if (shown?.status === 'active') {
            const left = Math.max(0, shown.endsAt - now()), label = root.querySelector('.dispatch-clock');
            if (label) label.textContent = left > 0 ? time(left) : '귀환 처리 중';
            root.style.setProperty('--p', Math.min(100, 100 * (1 - left / Math.max(1, shown.endsAt - shown.startedAt))).toFixed(2));
        }
        const run = state.run;
        if (run?.status === 'active' && !busy && run.endsAt - now() <= 0 && Date.now() >= refreshAt) { refreshAt = Date.now() + 5000; refresh(); }
    }

    function fact(list, label, value) { const row = el('div'); row.append(el('dt', '', label), el('dd', '', value)); list.append(row); }

    function door(destination) {
        const box = el('section', 'dispatch-door ' + destination.id), plate = el('div', 'dispatch-plate');
        box.dataset.realm = destination.id;
        plate.append(el('p', 'dispatch-eyebrow', destination.subtitle), el('h2', '', destination.name));
        const facts = el('dl', 'dispatch-facts');
        fact(facts, '소요 시간', time(destination.duration));
        if (destination.floor) fact(facts, '도달 층', fmt(destination.floor) + '층');
        if (destination.id === 'heaven') fact(facts, '마을 전투력', fmt(state.power)); else fact(facts, '보상', '필드 보상 획득');
        if (destination.minLevel > 1) fact(facts, '필요 레벨', fmt(destination.minLevel));
        const cost = el('div', 'dispatch-cost' + (Number(destination.count) < Number(destination.cost) ? ' is-short' : ''));
        if (destination.ticketIcon) {
            const icon = el('img'); icon.src = destination.ticketIcon; icon.alt = '';
            icon.onerror = () => { icon.onerror = null; if (destination.id === 'heaven') icon.src = '/static/assets/paradise/ticket.webp'; else icon.remove(); };
            cost.append(icon);
        }
        const label = el('div'); label.append(el('span', '', destination.ticket), el('strong', '', fmt(destination.cost) + '장 소모'));
        cost.append(label, el('small', '', '보유 ' + fmt(destination.count) + '장'));
        plate.append(facts, cost);
        if (destination.blocked) plate.append(el('p', 'dispatch-block', destination.blocked));
        const send = button('파견 보내기', () => { sfx('tap', .3); start(destination.id); }, 'dispatch-send'); send.dataset.dispatch = destination.id;
        plate.append(send); box.append(plate);
        const focus = on => { if (!root) return; if (on) root.dataset.focus = destination.id; else if (root.dataset.focus === destination.id) delete root.dataset.focus; };
        box.addEventListener('pointerenter', () => focus(true)); box.addEventListener('pointerleave', () => focus(false));
        box.addEventListener('focusin', () => focus(true)); box.addEventListener('focusout', () => focus(false));
        return box;
    }

    function report(run) {
        const destination = destinationOf(run.destination), active = run.status === 'active';
        const box = el('section', 'dispatch-report ' + (active ? 'is-active' : 'is-complete') + (!active && fresh ? ' is-fresh' : '')), copy = el('div', 'dispatch-report-copy');
        const owner = el('p', 'dispatch-eyebrow');
        owner.append(window.NicknameColors.mark(el('span', '', state.characterName), state.characterName), active ? ' 파견 중' : ' 귀환');
        copy.append(owner, el('h2', '', destination.name));
        if (run.floor) copy.append(el('p', 'dispatch-floor', '천상 ' + fmt(run.floor) + '층'));
        if (active) {
            copy.append(el('strong', 'dispatch-clock', time(run.endsAt - now())),
                el('p', 'dispatch-note', '파견 중에는 이 캐릭터를 플레이할 수 없습니다. 다른 캐릭터로 전환할 수 있습니다.'));
        } else {
            copy.append(el('p', 'dispatch-note', '보상을 소지품에 지급했습니다.' + (run.floor ? ' 천상 랭킹에 기록되었습니다.' : '')));
            const rewards = el('ul', 'dispatch-rewards');
            const entries = run.rewardItems?.length ? run.rewardItems : (run.result || []).map(name => ({ name }));
            if (!entries.length) rewards.append(el('li', 'dispatch-reward-empty', '획득 보상 없음'));
            entries.forEach((reward, index) => {
                const item = el('li', 'dispatch-loot'), art = el('div', 'dispatch-loot-art');
                item.style.setProperty('--i', Math.min(index, 14));
                if (reward.frameUrl) { const frame = el('img', 'dispatch-loot-frame'); frame.src = reward.frameUrl; frame.alt = ''; art.append(frame); }
                if (reward.iconUrl) { const icon = el('img', 'dispatch-loot-icon'); icon.src = reward.iconUrl; icon.alt = ''; art.append(icon); }
                else art.append(el('span', 'dispatch-loot-symbol', reward.kind === 'exp' ? 'EXP' : reward.name.slice(0, 2)));
                if (reward.count != null) art.append(el('strong', 'dispatch-loot-count', '×' + fmt(reward.count)));
                item.append(art, el('strong', 'dispatch-loot-name', reward.name));
                if (reward.rarity) item.append(el('span', 'dispatch-loot-rarity', reward.rarity));
                rewards.append(item);
            });
            copy.append(rewards, button('다음 파견 고르기', () => { sfx('tap', .3); save(characterKey(CLOSED_KEY), run.id); render(true); }, 'dispatch-send dispatch-next'));
        }
        box.append(copy);
        return box;
    }

    function render(force) {
        if (!root || !state || !parts) return;
        const run = frozen || state.run;
        const view = run?.status === 'active' ? 'active' : run?.status === 'completed' && load(characterKey(CLOSED_KEY)) !== run.id ? 'done' : 'select';
        root.dataset.view = view;
        if (view === 'select') delete root.dataset.realm; else root.dataset.realm = run.destination;
        parts.who.textContent = state.characterName;
        const sig = JSON.stringify([view, run?.id, run?.status, run?.result, state.characterName, state.power, state.destinations]);
        if (force || sig !== lastSig) {
            lastSig = sig; delete root.dataset.focus;
            if (view === 'select') {
                const nodes = state.destinations.map(door);
                if (state.run?.status === 'completed') nodes.push(button('지난 보고 보기', () => { sfx('tap', .3); save(characterKey(CLOSED_KEY), ''); render(true); }, 'dispatch-recall'));
                parts.main.replaceChildren(...nodes);
            } else parts.main.replaceChildren(report(run));
            fresh = false;
        }
        renderButtons(); tick();
    }

    function renderFailure() {
        if (!parts || state) return;
        parts.main.replaceChildren(el('p', 'dispatch-loading', '파견 정보를 불러오지 못했습니다.'), button('다시 불러오기', () => { parts.main.replaceChildren(el('p', 'dispatch-loading', '파견 정보를 불러오는 중')); refresh(); }, 'dispatch-send dispatch-retry'));
    }

    // 연출은 서버 상태를 받은 뒤에만 재생하고, 그동안 아래 화면은 직전 장면에 멈춰 둔다.
    function enqueue(kind, run) {
        const turn = generation;
        frozen = { ...run, status: 'active' };
        if (kind === 'return') returnsQueued++;
        cineChain = cineChain.then(() => {
            if (!root || turn !== generation) return;
            if (kind === 'return') returnsQueued--;
            return play(kind, run, turn);
        });
    }

    function play(kind, run, turn) {
        return new Promise(resolve => {
            const alive = () => root && turn === generation;
            const reveal = () => {
                if (kind !== 'return' || !alive() || !frozen) return;
                frozen = null; fresh = true; render(true); sfx('coin', .38);
            };
            if (reducedMotion()) {
                if (kind === 'depart') { sfx('whoosh', .3); if (!returnsQueued) { frozen = null; render(true); } } else reveal();
                resolve(); return;
            }
            const destination = destinationOf(run.destination), timers = [];
            const layer = el('div', 'dispatch-cine ' + kind); layer.dataset.realm = run.destination;
            const marker = el('img', 'dispatch-cine-marker'); marker.src = STAGE + 'marker.webp'; marker.alt = '';
            const caption = el('div', 'dispatch-cine-caption');
            caption.append(window.NicknameColors.mark(el('span', '', state.characterName), state.characterName), el('strong', '', destination.name), el('em', '', kind === 'depart' ? '출발' : '귀환'));
            layer.append(el('i', 'dispatch-cine-veil'), el('i', 'dispatch-cine-sigil'), marker, caption, el('span', 'dispatch-cine-skip', '눌러서 건너뛰기'));
            let done = false;
            const finish = () => {
                if (done) return; done = true;
                timers.forEach(clearTimeout); cineSkip = null; layer.remove();
                if (alive()) {
                    root.classList.remove('is-cine');
                    if (kind === 'return') reveal(); else if (!returnsQueued) { frozen = null; render(true); }
                }
                resolve();
            };
            layer.onclick = finish; cineSkip = finish;
            root.classList.add('is-cine'); root.append(layer);
            if (kind === 'depart') sfx('whoosh', .34); else timers.push(setTimeout(reveal, RETURN_REVEAL_MS));
            timers.push(setTimeout(finish, kind === 'depart' ? DEPART_MS : RETURN_MS));
        });
    }

    function close() {
        if (cineSkip) { cineSkip(); return; }
        if (onClose) onClose(); else if (typeof window.activatePage === 'function') window.activatePage('home');
    }
    function onKey(event) {
        if (event.key !== 'Escape' || !root || document.querySelector('.modal-bg.active, dialog[open]')) return;
        event.preventDefault(); close();
    }
    function onWake() {
        if (!root || document.hidden || busy || Date.now() - lastFetch < 4000) return;
        if (!state || state.run?.status === 'active') refresh();
    }

    function build() {
        root.className = 'dispatch-screen'; root.dataset.view = 'loading';
        const scene = el('div', 'dispatch-scene'); scene.setAttribute('aria-hidden', 'true');
        ['hell', 'heaven'].forEach(id => { const art = el('div', 'dispatch-art ' + id), image = el('i'); image.style.backgroundImage = 'url("' + ART[id] + '")'; art.append(image); scene.append(art); });
        scene.insertAdjacentHTML('beforeend', '<svg class="dispatch-seam" viewBox="0 0 100 100" preserveAspectRatio="none"><line class="land" x1="56" y1="0" x2="44" y2="100"/><line class="port" x1="0" y1="56" x2="100" y2="44"/></svg>');
        const dial = el('div', 'dispatch-dial'), marker = el('img', 'dispatch-marker'); marker.src = STAGE + 'marker.webp'; marker.alt = '';
        dial.append(el('i', 'dispatch-sigil'), el('i', 'dispatch-ring dispatch-progress-fill'), marker); scene.append(dial);

        const top = el('div', 'dispatch-top'), exit = iconButton('back', '파견 화면 나가기', close, 'dispatch-exit');
        exit.append(el('span', '', '나가기'));
        const title = el('div', 'dispatch-title'), who = el('strong', 'dispatch-who');
        const whoLine = el('p', 'dispatch-who-line'); whoLine.append(el('span', '', '파견 캐릭터'), who);
        title.append(el('h1', '', '파견'), whoLine);
        const mute = iconButton('sound', '효과음', () => {
            const muted = load(MUTE_KEY) !== '1'; save(MUTE_KEY, muted ? '1' : '0'); mute.setAttribute('aria-pressed', String(!muted)); if (!muted) sfx('tap', .3);
        }, 'dispatch-mute');
        mute.setAttribute('aria-pressed', String(load(MUTE_KEY) !== '1'));
        const tools = el('div', 'dispatch-tools'); tools.append(mute, button('캐릭터 전환', () => { location.href = '/characters'; }, 'dispatch-switch'));
        top.append(exit, title, tools);

        const main = el('div', 'dispatch-main'); main.append(el('p', 'dispatch-loading', '파견 정보를 불러오는 중'));
        const message = el('p', 'dispatch-error'); message.setAttribute('role', 'alert');
        root.replaceChildren(scene, main, top, message);
        parts = { main, who, error: message };
    }

    function unmount() {
        generation++; clearInterval(clock);
        document.removeEventListener('keydown', onKey); document.removeEventListener('visibilitychange', onWake); window.removeEventListener('focus', onWake);
        if (cineSkip) cineSkip();
        if (root) { root.replaceChildren(); root.className = ''; root.removeAttribute('style'); ['view', 'realm', 'focus'].forEach(key => delete root.dataset[key]); }
        root = null; state = null; parts = null; frozen = null; fresh = false; lastSig = ''; returnsQueued = 0; cineChain = Promise.resolve();
    }

    window.DispatchUI = {
        mount(node, deps) {
            unmount(); root = node; api = deps.api; postApi = deps.postApi; onClose = deps.onClose || null;
            build(); refresh(); clock = setInterval(tick, 250);
            document.addEventListener('keydown', onKey); document.addEventListener('visibilitychange', onWake); window.addEventListener('focus', onWake);
        }, unmount
    };
})();
