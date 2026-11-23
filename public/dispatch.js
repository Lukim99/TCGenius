(function () {
    'use strict';
    let root, api, postApi, state, clock, generation = 0, offset = 0, busy = false, pending = null, refreshAt = 0;
    const el = (tag, cls, text) => { const node = document.createElement(tag); node.className = cls || ''; if (text != null) node.textContent = text; return node; };
    const fmt = value => Number(value || 0).toLocaleString('ko-KR');
    const time = ms => { const seconds = Math.max(0, Math.ceil(ms / 1000)); return seconds >= 3600 ? '1시간' : seconds >= 60 ? Math.floor(seconds / 60) + '분 ' + seconds % 60 + '초' : seconds + '초'; };
    const art = id => id === 'hell' ? '/rpg-ui?file=' + encodeURIComponent('필드/부타게임H.png') : '/static/assets/paradise/corridor.webp';
    function button(label, fn, cls = '') { const node = el('button', cls, label); node.type = 'button'; node.onclick = fn; return node; }
    function error(message) { const node = root?.querySelector('.dispatch-error'); if (node) node.textContent = message; }
    function receive(data) { state = data; offset = data.serverTime - Date.now(); refreshAt = 0; render(); }
    async function refresh() {
        const turn = generation;
        try { const data = await api('/api/dispatch'); if (root && turn === generation) receive(data); }
        catch (e) { if (turn === generation) { error(e.message); refreshAt = Date.now() + 5000; } }
    }
    async function start(destination) {
        if (busy) return;
        if (pending && pending.destination !== destination) return;
        pending ||= { destination, requestId: crypto.randomUUID(), previousId: state.run?.id || null };
        busy = true; render();
        const turn = generation;
        try {
            const data = await postApi('/api/dispatch/start', pending);
            pending = null;
            if (root && turn === generation) receive(data);
        } catch (e) {
            if (root && turn === generation) {
                if (e.status && e.status < 500) pending = null;
                // Refresh resolves a lost response without making a second purchase.
                try {
                    const data = await api('/api/dispatch');
                    if (data.run?.id === pending?.requestId) pending = null;
                    else if (!data.run || data.run.id === pending?.previousId) { /* Keep the same request for retry. */ }
                    else pending = null;
                    if (turn === generation) receive(data);
                } catch (_) { /* The same request stays available when the connection returns. */ }
                error(e.message);
            }
        } finally { busy = false; if (root && turn === generation) renderButtons(); }
    }
    function renderButtons() {
        root.querySelectorAll('[data-dispatch]').forEach(node => {
            const destination = state.destinations.find(dest => dest.id === node.dataset.dispatch);
            node.disabled = busy || !!destination.blocked || !!pending && pending.destination !== destination.id;
            node.textContent = busy && pending?.destination === destination.id ? '출발 중' : pending?.destination === destination.id ? '같은 요청 재시도' : '파견 보내기';
        });
    }
    function tick() {
        if (!root || state?.run?.status !== 'active') return;
        const run = state.run, left = Math.max(0, run.endsAt - Date.now() - offset);
        const label = root.querySelector('.dispatch-clock'), bar = root.querySelector('.dispatch-progress-fill');
        if (label) label.textContent = left > 0 ? time(left) : '귀환 처리 중';
        if (bar) bar.style.width = Math.min(100, 100 * (1 - left / (run.endsAt - run.startedAt))) + '%';
        if (!left && Date.now() >= refreshAt) { refreshAt = Date.now() + 5000; refresh(); }
    }
    function render() {
        if (!root || !state) return;
        root.className = 'dispatch-screen';
        const head = el('header', 'dispatch-heading'), titles = el('div');
        titles.append(el('p', 'dispatch-eyebrow', state.characterName), el('h1', '', '파견'));
        head.append(titles, button('캐릭터 전환', () => { location.href = '/characters'; }, 'dispatch-switch'));
        const message = el('p', 'dispatch-error'); message.setAttribute('role', 'alert');
        root.replaceChildren(head, message);
        const run = state.run;
        if (run?.status === 'active' || run?.status === 'completed') {
            const destination = state.destinations.find(dest => dest.id === run.destination);
            const report = el('section', 'dispatch-report ' + (run.status === 'completed' ? 'is-complete' : 'is-active'));
            report.style.setProperty('--dispatch-art', 'url("' + art(run.destination) + '")');
            const copy = el('div', 'dispatch-report-copy');
            copy.append(el('p', 'dispatch-eyebrow', run.status === 'active' ? '파견 중' : '파견 완료'), el('h2', '', destination.name));
            if (run.floor) copy.append(el('p', 'dispatch-floor', '천상 ' + fmt(run.floor) + '층'));
            if (run.status === 'active') {
                copy.append(el('strong', 'dispatch-clock', time(run.endsAt - Date.now() - offset)));
                const progress = el('div', 'dispatch-progress'); progress.append(el('span', 'dispatch-progress-fill'));
                copy.append(progress, el('p', 'dispatch-note', '파견 중에는 이 캐릭터를 플레이할 수 없습니다. 다른 캐릭터로 전환할 수 있습니다.'));
            } else {
                copy.append(el('p', 'dispatch-note', '보상을 소지품에 지급했습니다.' + (run.floor ? ' 천상 랭킹에 기록되었습니다.' : '')));
                const rewards = el('ul', 'dispatch-rewards');
                (run.result || []).forEach(line => rewards.append(el('li', '', line)));
                if (!run.result?.length) rewards.append(el('li', '', '획득 보상 없음'));
                copy.append(rewards);
            }
            report.append(copy); root.append(report);
        }
        if (run?.status !== 'active') {
            const grid = el('div', 'dispatch-destinations');
            state.destinations.forEach(destination => {
                const card = el('section', 'dispatch-destination ' + destination.id);
                const image = el('img', 'dispatch-scene'); image.src = art(destination.id); image.alt = '';
                const content = el('div', 'dispatch-destination-copy');
                const top = el('div', 'dispatch-destination-top'); top.append(el('p', 'dispatch-eyebrow', destination.subtitle), el('span', 'dispatch-duration', time(destination.duration)));
                content.append(top, el('h2', '', destination.name));
                if (destination.floor) content.append(el('p', 'dispatch-floor', '도달 ' + fmt(destination.floor) + '층'), el('p', 'dispatch-note', '마을 전투력 ' + fmt(state.power)));
                else content.append(el('p', 'dispatch-note', '필드 보상 획득'));
                const cost = el('div', 'dispatch-cost');
                if (destination.ticketIcon) {
                    const icon = el('img'); icon.src = destination.ticketIcon; icon.alt = '';
                    icon.onerror = () => { icon.onerror = null; if (destination.id === 'heaven') icon.src = '/static/assets/paradise/ticket.webp'; else icon.remove(); };
                    cost.append(icon);
                }
                const label = el('div'); label.append(el('span', '', destination.ticket), el('strong', '', fmt(destination.cost) + '장 소모'));
                cost.append(label, el('small', '', '보유 ' + fmt(destination.count) + '장')); content.append(cost);
                if (destination.blocked) content.append(el('p', 'dispatch-block', destination.blocked));
                const send = button('파견 보내기', () => start(destination.id), 'dispatch-send'); send.dataset.dispatch = destination.id;
                content.append(send); card.append(image, content); grid.append(card);
            });
            root.append(grid);
        }
        renderButtons(); tick();
    }
    function unmount() { generation++; clearInterval(clock); root = null; state = null; }
    window.DispatchUI = {
        mount(node, deps) {
            unmount(); root = node; api = deps.api; postApi = deps.postApi;
            root.className = 'dispatch-screen'; root.replaceChildren(el('p', '', '파견 정보를 불러오는 중'), el('p', 'dispatch-error'));
            refresh(); clock = setInterval(tick, 250);
        }, unmount
    };
})();
