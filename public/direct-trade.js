// 채팅 거래의 실제 상태를 읽는 거래대. 품목/확정 버전을 함께 보내 이전 내역으로 정산하지 않는다.
(() => {
    'use strict';
    let state = null, timer = 0, busy = false, polling = false, epoch = 0, signature = '';
    let requestName = '', errorText = '', notice = '', modalOpen = false, dismissedResult = '';
    const labels = { gold: '골드', garnet: '가넷', card: '카드', equipment: '장비', item: '아이템' };
    const root = () => document.getElementById('directTradeRoot');
    const active = () => document.querySelector('[data-page="directtrade"]')?.classList.contains('active');
    const button = (text, action, cls = '', key = '') => el('button', { type: 'button', class: 'dt-btn ' + cls, disabled: busy || !!state?.session?.processing, 'data-dt-key': key, onclick: action }, text);
    const currencyImage = kind => el('img', { src: QUEST_REWARD_CURRENCY_ICONS[labels[kind]], alt: '' });
    const version = session => ({ sessionId: session.id, revision: session.revision });
    function playerFace(player) {
        return el('div', { class: 'dt-party-face' }, player?.mainCard?.imageUrl
            ? el('img', { src: player.mainCard.imageUrl, alt: player.mainCard.name || player.name })
            : el('span', null, (player?.name || '?').slice(0, 1)));
    }
    function coin(kind, amount, detail = '') {
        return el('div', { class: 'dt-coin' }, currencyImage(kind), el('span', null, labels[kind], detail ? el('small', null, detail) : null), el('b', null, comma(amount)));
    }
    function detail(entry, kind) {
        modalOpen = true;
        if (kind === 'card') openRichModal(entry.name || entry.formatted, '', [el('div', { class: 'dt-detail-context' }, ...mainCardDetailNodes(entry))]);
        else if (kind === 'equipment') openRichModal(entry.name, '', [el('div', { class: 'dt-detail-context' }, ...equipmentModalView(entry, false))]);
        else openRichModal(entry.name, '아이템', [el('div', { class: 'dt-detail dt-detail-context' },
            el('img', { src: entry.iconUrl, alt: entry.name }), el('b', null, comma(entry.count) + '개'))]);
    }
    function tile(entry, kind) {
        const art = el('span', { class: 'dt-tile-art ' + (kind === 'card' ? 'dt-tile-card' : '') },
            entry.frameUrl ? el('img', { class: 'dt-tile-frame', src: entry.frameUrl, alt: '' }) : null,
            entry.imageUrl || entry.iconUrl ? el('img', { class: 'dt-tile-image', src: entry.imageUrl || entry.iconUrl, alt: '' }) : null,
            el('span', { class: 'dt-badge' }, kind === 'card' ? entry.starText : kind === 'item' ? '×' + comma(entry.count) : entry.level > 0 ? '+' + entry.level : entry.rarity));
        return el('button', { type: 'button', class: 'dt-tile', 'aria-label': (entry.name || entry.formatted) + ' 상세 보기', onclick: () => detail(entry, kind) },
            art, el('span', { class: 'dt-tile-name' }, entry.name || entry.formatted), entry.artifact ? el('small', null, '옵션 ' + entry.artifact.options.length + '개') : null);
    }
    function offerNode(offer) {
        const nodes = [];
        for (const kind of ['gold', 'garnet']) if (offer[kind] > 0) nodes.push(coin(kind, offer[kind]));
        for (const [key, kind] of [['cards', 'card'], ['equipment', 'equipment'], ['items', 'item']]) {
            const entries = offer[key] || [];
            if (entries.length) nodes.push(el('div', { class: 'dt-offer-group' },
                el('p', { class: 'dt-group-label' }, labels[kind] + ' ' + entries.length + (kind === 'card' ? '장' : kind === 'item' ? '종' : '개')),
                el('div', { class: 'dt-grid' }, ...entries.map(entry => tile(entry, kind)))));
        }
        return el('div', { class: 'dt-offer' }, ...(nodes.length ? nodes : [el('div', { class: 'dt-offer-empty' }, '아직 올린 물품이 없습니다.') ]));
    }
    function side(player, offer, confirmed, mine) {
        return el('section', { class: 'dt-side ' + (mine ? 'dt-side-mine' : 'dt-side-theirs') },
            el('div', { class: 'dt-party' }, playerFace(player), el('div', null,
                el('h3', null, mine ? '내가 줄 것' : '내가 받을 것'), el('strong', null, player?.name || state.session.partnerName),
                el('small', null, 'Lv.' + (player?.level || ''))),
                el('span', { class: 'dt-seal' + (confirmed ? ' confirmed' : '') }, confirmed ? '✓ 확정함' : '검토 중')),
            offerNode(offer), mine ? button('+ 물품 올리기', openPicker, 'dt-add', 'add') : null);
    }
    function ledger(session) {
        const receive = session.partnerOffer, give = session.offer;
        const short = state.balances.tickets < receive.ticketCost;
        const full = state.cardSpace < receive.cards.length;
        const settlement = el('section', { class: 'dt-ledger' }, el('h3', null, '정산 미리보기'));
        for (const [title, offer, incoming] of [['내가 주는 재화', give, false], ['내가 받는 재화', receive, true]]) {
            settlement.append(el('p', { class: 'dt-group-label' }, title));
            let hasMoney = false;
            for (const kind of ['gold', 'garnet']) if (offer[kind] > 0) {
                hasMoney = true;
                settlement.append(coin(kind, incoming ? offer.net[kind] : offer[kind], incoming ? '수수료 ' + comma(offer.fees[kind]) + ' 제외' : ''));
            }
            if (!hasMoney) settlement.append(el('p', { class: 'dt-note' }, '등록된 재화 없음'));
        }
        settlement.append(el('div', { class: 'dt-ticket' + (short ? ' dt-short' : '') },
            state.ticketIconUrl ? el('img', { src: state.ticketIconUrl, alt: '' }) : null,
            el('span', null, '거래권', el('small', null, '보유 ' + comma(state.balances.tickets) + '장')),
            el('b', null, comma(receive.ticketCost) + '장 소모')),
            el('p', { class: 'dt-note' }, '재화 수수료 ' + Math.round(state.feeRate * 100) + '%. 품목이 바뀌면 양쪽 확정이 해제됩니다.'),
            el('p', { class: 'dt-note' }, '올린 물품은 거래가 끝날 때까지 보관됩니다. 거래 취소 시 모두 반환됩니다.'));
        if (short || full) settlement.append(el('p', { class: 'dt-short', role: 'status' }, short ? '받는 카드에 필요한 거래권이 부족합니다.' : '받는 카드를 보관할 공간이 부족합니다.'));
        const confirm = button(session.confirmed ? '확정 취소' : '거래 확정', () => mutate(session.confirmed ? 'unconfirm' : 'confirm', version(session)), session.confirmed ? 'dt-btn-undo' : 'dt-btn-main', 'confirm');
        confirm.disabled ||= !session.confirmed && (short || full);
        settlement.append(el('div', { class: 'dt-actions' },
            el('p', { class: 'dt-actions-state', role: 'status' }, session.processing ? '거래 처리 중' : session.confirmed ? '상대방의 확정을 기다립니다.' : session.partnerConfirmed ? '상대방이 확정했습니다. 내역을 확인해주세요.' : '서로 확정하면 거래가 완료됩니다.'), confirm,
            button('거래 취소', async () => { if (await showConfirm('거래를 취소하고 올린 물품을 모두 돌려받을까요?')) mutate('cancel', version(session)); }, 'dt-btn-danger', 'cancel')));
        return settlement;
    }
    function render(force = false) {
        if (!state || !active()) return;
        const next = JSON.stringify([state.status, state.session, state.request, state.result, state.balances, state.me, state.partner, busy, errorText, notice, dismissedResult]);
        if (!force && signature === next) { updateTimer(); return; }
        signature = next;
        const oldFocus = root().contains(document.activeElement) ? document.activeElement : null;
        const focusKey = oldFocus?.dataset.dtKey, caret = oldFocus?.selectionStart;
        const nodes = [el('header', { class: 'dt-head' }, el('h2', null, '1:1 거래'),
            el('p', { 'aria-live': 'polite' }, state.status === 'active' ? '내역을 확인하고 거래를 확정하세요.' : '닉네임으로 거래를 신청하세요.'))];
        if (notice) nodes.push(el('div', { class: 'dt-reset-banner', role: 'status' }, notice));
        if (errorText) nodes.push(el('div', { class: 'dt-error', role: 'alert' }, errorText));
        if (state.status === 'active') {
            nodes.push(el('div', { class: 'dt-counter' }, side(state.me, state.session.offer, state.session.confirmed, true),
                ledger(state.session), side(state.partner, state.session.partnerOffer, state.session.partnerConfirmed, false)));
        } else if (state.status === 'outgoing' || state.status === 'incoming') {
            const incoming = state.status === 'incoming';
            nodes.push(el('section', { class: 'dt-invite' }, playerFace(state.partner),
                el('div', null, el('h3', null, state.request.partnerName), el('p', null, incoming ? '거래를 신청했습니다.' : '거래 수락을 기다리고 있습니다.'),
                    el('span', { class: 'dt-timer', role: 'timer', 'aria-live': 'off' })),
                incoming ? button('수락', () => mutate('accept', { requestId: state.request.id }), 'dt-btn-main', 'accept')
                    : button('신청 취소', () => mutate('request-cancel', { requestId: state.request.id }), 'dt-btn-danger', 'request-cancel')));
        } else if (state.result && state.result.id !== dismissedResult) {
            nodes.push(el('section', { class: 'dt-result', role: 'status' },
                el('div', { class: 'dt-result-mark' }, state.result.status === 'completed' ? '✓' : '↶'),
                el('h3', null, state.result.status === 'completed' ? '거래 완료' : '거래 취소'), el('p', null, state.result.message),
                state.result.receivedOffer ? offerNode(state.result.receivedOffer) : el('p', null, '올린 물품은 모두 돌려받았습니다.'),
                button('새 거래 신청', () => { dismissedResult = state.result.id; render(true); }, 'dt-btn-main', 'new')));
        } else {
            const input = el('input', { class: 'dt-input', id: 'directTradeName', autocomplete: 'off', maxLength: 100, placeholder: '상대방 닉네임', value: requestName, disabled: busy, 'data-dt-key': 'name', oninput: e => { requestName = e.target.value; } });
            nodes.push(el('form', { class: 'dt-request', onsubmit: e => { e.preventDefault(); if (!busy) mutate('request', { name: requestName.trim() }); } },
                playerFace(state.me), el('div', null, el('label', { for: 'directTradeName' }, '거래할 상대'), input),
                el('button', { type: 'submit', class: 'dt-btn dt-btn-main', disabled: busy }, '거래 신청')),
                el('section', { class: 'dt-rules' }, el('h3', null, '거래 안내'),
                    el('p', null, '골드, 가넷, 카드, 장비, 아이템을 거래할 수 있습니다.'),
                    el('p', null, '양쪽이 모두 확정하면 거래가 완료됩니다. 올린 물품은 거래 취소 시 반환됩니다.'),
                    el('p', null, '골드와 가넷 수수료는 ' + Math.round(state.feeRate * 100) + '%. 5성 이상 카드를 받을 때는 거래권이 필요합니다.'),
                    el('p', null, '거래 신청은 5분 동안 유효합니다. 채팅에서 진행한 거래도 여기에 표시됩니다.')));
        }
        root().replaceChildren(...nodes);
        if (focusKey) {
            const target = root().querySelector('[data-dt-key="' + focusKey + '"]');
            target?.focus({ preventScroll: true });
            if (caret != null && target?.type === 'text') target.setSelectionRange(caret, caret);
        }
        updateTimer();
    }
    function updateTimer() {
        const node = root()?.querySelector('.dt-timer');
        if (!node || !state?.request) return;
        const seconds = Math.max(0, Math.ceil((state.request.expiresAt - Date.now()) / 1000));
        node.textContent = '남은 시간 ' + Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
    }
    function applyState(next) {
        if (state?.session && next.session?.id === state.session.id && next.session.revision !== state.session.revision && (state.session.confirmed || state.session.partnerConfirmed)) notice = '품목이 변경되어 양쪽 확정이 해제되었습니다.';
        else if (state?.status !== next.status || next.session?.confirmed || next.session?.partnerConfirmed) notice = '';
        if (state?.status === 'active' && next.status !== 'active' && modalOpen && document.querySelector('#modalBg .dt-modal, #modalBg .dt-detail-context')) { modalOpen = false; closeModal(); }
        state = next;
        render();
    }
    async function refresh() {
        if (!active() || document.hidden || busy || polling) return;
        polling = true; const current = epoch;
        try {
            const result = await api('/api/trade');
            if (current === epoch && !busy && active()) applyState(result.state);
        } catch (error) { if (current === epoch && active()) { errorText = error.message; render(); } }
        finally { polling = false; }
    }
    async function mutate(action, payload) {
        if (busy) return false;
        busy = true; epoch++; errorText = ''; render(true);
        try {
            const result = await postApi('/api/trade/' + action, payload);
            if (result.profile) renderProfile(result.profile);
            applyState(result.state);
            return true;
        } catch (error) { errorText = error.message; return false; }
        finally { busy = false; render(true); refresh(); }
    }
    async function openPicker() {
        const sessionId = state.session.id;
        modalOpen = true;
        openRichModal('물품 올리기', '', [el('div', { class: 'dt-modal' }, el('p', { class: 'dt-note' }, '보유 목록 확인 중'))]);
        let data;
        try { data = await api('/api/trade/inventory'); }
        catch (error) { if (modalOpen) openRichModal('물품 올리기', '', [el('p', { class: 'dt-error' }, error.message)]); return; }
        if (!active() || !document.getElementById('modalBg').classList.contains('active') || state.session?.id !== sessionId) return;
        let kind = 'gold', selected = null;
        const body = el('div', { class: 'dt-modal' });
        const warning = el('p', { class: 'dt-note' }, '품목을 올리면 양쪽 확정이 해제됩니다. 개별 회수는 거래 취소로 진행하세요.');
        const tabs = el('div', { class: 'dt-kinds', role: 'tablist', 'aria-label': '올릴 품목 종류' });
        const list = el('div', { class: 'dt-pick-list', role: 'tabpanel' });
        const selection = el('div', { class: 'dt-selection' });
        const err = el('p', { class: 'dt-error', role: 'alert' }); err.hidden = true;
        const retry = button('목록 새로고침', openPicker); retry.hidden = true;
        const submit = button('올리기', async () => {
            if (state.session?.id !== sessionId) return;
            const amount = Number(amountInput.value);
            const payload = { ...version(data.state.session), kind };
            if (kind === 'gold' || kind === 'garnet') payload.amount = amount;
            else if (!selected) { err.textContent = '올릴 품목을 선택해주세요.'; err.hidden = false; return; }
            else if (kind === 'item') Object.assign(payload, { itemId: selected.id, count: amount, version: selected.version });
            else Object.assign(payload, { number: selected.number, version: selected.version });
            submit.disabled = true;
            const ok = await mutate('register', payload);
            if (ok) { modalOpen = false; closeModal(); }
            else { err.textContent = errorText; err.hidden = false; retry.hidden = false; submit.disabled = false; }
        }, 'dt-btn-main');
        let amountInput;
        function renderSelection() {
            amountInput = el('input', { type: 'number', class: 'dt-input', min: 1, step: 1, value: kind === 'item' ? 1 : '', placeholder: '수량', id: 'directTradeAmount' });
            const amountKind = kind === 'gold' || kind === 'garnet' || kind === 'item';
            const available = kind === 'item' ? selected?.count || 0 : state.balances[kind];
            amountInput.max = available;
            selection.replaceChildren(...[selected ? el('strong', null, selected.name || selected.formatted) : null,
                selected?.artifact ? artifactOptionSummary(selected.artifact) : null,
                amountKind ? el('label', { for: 'directTradeAmount' }, kind === 'item' ? '등록 수량' : '등록할 ' + labels[kind], el('small', null, '보유 ' + comma(available || 0)), amountInput) : null].filter(Boolean));
            submit.disabled = !(kind === 'gold' || kind === 'garnet') && !selected;
        }
        function choose(next) {
            kind = next; selected = null; err.hidden = true;
            tabs.querySelectorAll('button').forEach(tab => { tab.setAttribute('aria-selected', String(tab.dataset.kind === kind)); tab.tabIndex = tab.dataset.kind === kind ? 0 : -1; });
            const entries = kind === 'card' ? data.cards : kind === 'equipment' ? data.equipment : kind === 'item' ? data.items : null;
            list.replaceChildren(...(entries ? entries.length ? entries.map(entry => el('button', {
                type: 'button', class: 'dt-pick', 'aria-pressed': 'false', onclick: e => {
                    selected = entry; list.querySelectorAll('button').forEach(pick => pick.setAttribute('aria-pressed', String(pick === e.currentTarget))); renderSelection();
                }
            }, el('img', { src: entry.imageUrl || entry.iconUrl, alt: '' }), el('span', null,
                el('b', null, entry.name || entry.formatted), el('small', null, kind === 'card' ? entry.starText : kind === 'item' ? '거래 가능 ' + comma(entry.count) + '개' : entry.rarity + (entry.level ? ' +' + entry.level : '')),
                entry.artifact ? artifactOptionSummary(entry.artifact) : null))) : [el('p', { class: 'dt-note' }, '올릴 수 있는 ' + labels[kind] + '가 없습니다.')] : []));
            list.hidden = !entries;
            renderSelection();
        }
        Object.keys(labels).forEach((key, index) => tabs.append(el('button', { type: 'button', role: 'tab', class: 'dt-btn', 'data-kind': key, onclick: () => choose(key), onkeydown: e => {
            if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
            e.preventDefault(); const next = (index + (e.key === 'ArrowRight' ? 1 : 4)) % 5; choose(Object.keys(labels)[next]); tabs.children[next].focus();
        } }, key === 'gold' || key === 'garnet' ? currencyImage(key) : null, labels[key])));
        body.append(warning, tabs, list, selection, err, retry, el('div', { class: 'dt-modal-actions' }, button('닫기', () => { modalOpen = false; closeModal(); }), submit));
        openRichModal('물품 올리기', '', [body]);
        choose(kind);
    }
    function open() {
        close(); signature = '';
        root().replaceChildren(el('p', { class: 'dt-note' }, '거래 내역 확인 중'));
        refresh(); timer = setInterval(() => { updateTimer(); refresh(); }, 2000);
    }
    function close() { epoch++; clearInterval(timer); timer = 0; }
    document.addEventListener('visibilitychange', () => { if (!document.hidden && active()) refresh(); });
    window.DirectTradeUI = { open, close };
})();
