(() => {
    'use strict';
    const $ = (selector, root = document) => root.querySelector(selector);
    const node = (tag, className, text) => {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (text !== undefined) element.textContent = text;
        return element;
    };
    const button = (className, text, action) => {
        const element = node('button', className, text);
        element.type = 'button'; element.onclick = action;
        return element;
    };
    const read = key => { try { return localStorage.getItem(key); } catch (_) { return null; } };
    const write = (key, value) => { try { localStorage.setItem(key, value); } catch (_) {} };
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let state = null, status = null, muted = read('level-reward-muted') === '1';
    const sounds = new Map();
    let lastSound = 0;
    function sound(name) {
        if (muted || document.hidden || Date.now() - lastSound < 100) return;
        lastSound = Date.now();
        if (!sounds.has(name)) {
            const audio = new Audio('/static/assets/market-stage/' + name + '.mp3');
            audio.volume = name === 'deal' ? .24 : .18; sounds.set(name, audio);
        }
        const audio = sounds.get(name); audio.currentTime = 0; audio.play().catch(() => {});
    }
    function stopSounds() { sounds.forEach(audio => { audio.pause(); audio.currentTime = 0; }); }
    document.addEventListener('visibilitychange', () => { if (document.hidden) stopSounds(); });

    function updateBadge() {
        const count = status?.available?.length || 0;
        document.querySelectorAll('.subnav-tab[data-page="레벨보상"], [data-group="content"]').forEach(target => {
            target.querySelector('.lr-badge')?.remove();
            if (!count) return;
            const badge = node('span', 'lr-badge', String(count));
            badge.setAttribute('aria-label', '받을 레벨 보상 ' + count + '개'); target.append(badge);
        });
    }
    function observe(next, onOpen) {
        if (!next) return;
        status = next; updateBadge();
        if (!next.available.length || state) { $('.lr-notice')?.remove(); return; }
        const highest = Math.max(...next.available), key = 'level-reward-seen:' + next.characterId;
        if (Number(read(key)) >= highest || !onOpen) return;
        write(key, String(highest)); $('.lr-notice')?.remove();
        const notice = node('aside', 'lr-notice'); notice.setAttribute('aria-label', '새 레벨 보상');
        const open = button('lr-notice-open', '', () => { notice.remove(); onOpen(); });
        open.append(node('span', 'lr-notice-seal', String(highest)), node('span', 'lr-notice-copy'));
        open.lastChild.append(node('strong', '', '새 레벨 보상이 열렸습니다'), node('span', '', '받을 보상 ' + next.available.length + '개'), node('b', '', '보상 확인 →'));
        const close = button('lr-notice-close', '×', () => notice.remove()); close.setAttribute('aria-label', '알림 닫기');
        notice.append(open, close); document.body.append(notice);
    }
    function thumbnail(item) {
        const thumb = node('div', 'lr-item-art' + (item.type === 'card' ? ' lr-card-art' : ''));
        if (item.iconUrl) {
            const icon = node('img', 'lr-item-icon'); icon.src = item.iconUrl; icon.alt = ''; icon.draggable = false; thumb.append(icon);
        } else thumb.append(node('span', 'lr-item-fallback', '◇'));
        if (item.frameUrl) {
            thumb.classList.add('has-frame');
            const frame = node('img', 'lr-item-frame'); frame.src = item.frameUrl; frame.alt = ''; frame.draggable = false; thumb.append(frame);
        }
        return thumb;
    }
    function rewardTile(item, index) {
        const tile = node('li', 'lr-reward' + (item.type === 'card' ? ' is-card' : ''));
        tile.style.setProperty('--order', index);
        const name = node('strong', 'lr-item-name');
        // Halloween avatars retain the same orange treatment as the inventory.
        const parts = item.name.split('할로윈');
        parts.forEach((part, i) => { if (i) name.append(node('span', 'lr-halloween', '할로윈')); name.append(document.createTextNode(part)); });
        tile.append(thumbnail(item), name, node('span', 'lr-item-count', '×' + Number(item.count).toLocaleString()));
        return tile;
    }
    function previewItems(reward) {
        const items = [...reward.items];
        if (reward.garnet) items.push({ name: '가넷', count: reward.garnet, iconUrl: reward.garnetIconUrl });
        return items;
    }
    function stateName(reward) { return reward.claimed ? '수령 완료' : reward.unlocked ? '받을 수 있음' : '미도달'; }
    function renderDial(s) {
        if (!s.ticks) {
            s.dial.append(node('div', 'lr-gears'), node('div', 'lr-inner-ring'));
            s.ticks = s.list.map((reward, i) => {
                const tick = button('lr-tick', '', () => select(s, i)); tick.tabIndex = -1;
                tick.append(node('span', 'lr-tick-number', String(reward.level)), node('span', 'lr-tick-mark'));
                s.dial.append(tick); return tick;
            });
        }
        s.dial.style.setProperty('--turn', (-s.selected * 13) + 'deg');
        s.list.forEach((reward, i) => {
            const delta = i - s.selected;
            const tick = s.ticks[i];
            tick.className = 'lr-tick ' + (reward.claimed ? 'is-claimed' : reward.unlocked ? 'is-ready' : 'is-locked') + (delta === 0 ? ' is-selected' : '');
            tick.style.setProperty('--step', delta);
            tick.hidden = Math.abs(delta) > 3;
            tick.setAttribute('aria-label', '레벨 ' + reward.level + ', ' + stateName(reward));
            tick.lastChild.textContent = reward.claimed ? '✓' : reward.unlocked ? '◆' : '';
        });
        const selected = s.list[s.selected];
        s.dialControl.setAttribute('aria-valuenow', selected.level);
        s.dialControl.setAttribute('aria-valuetext', '레벨 ' + selected.level + ', ' + stateName(selected));
        s.prev.disabled = s.selected === 0 || s.busy; s.next.disabled = s.selected === s.list.length - 1 || s.busy;
        const availableCount = s.list.filter(r => r.unlocked && !r.claimed).length;
        s.remaining.textContent = '받을 보상 ' + availableCount + '개'; s.remaining.disabled = availableCount === 0 || s.busy;
    }
    function renderDetail(s) {
        const reward = s.list[s.selected];
        s.screen.dataset.state = reward.claimed ? 'claimed' : reward.unlocked ? 'ready' : 'locked';
        s.stage.replaceChildren();
        const heading = node('div', 'lr-stage-heading');
        heading.append(node('span', 'lr-state-label', reward.claimed ? '수령 완료' : reward.unlocked ? '새 보상' : '다음 성장 보상'));
        const title = node('h2', 'lr-level-title'); title.append(node('span', '', '레벨'), node('strong', '', String(reward.level)));
        heading.append(title, node('p', 'lr-stage-sub', reward.claimed ? '이 레벨의 보상을 모두 받았습니다' : reward.unlocked ? '달성한 레벨의 보상을 받아보세요' : '현재 레벨 ' + s.userLevel + ' / 목표 레벨 ' + reward.level));
        const rewards = node('ul', 'lr-rewards'); previewItems(reward).forEach((item, i) => rewards.append(rewardTile(item, i)));
        const shelf = node('div', 'lr-shelf'); shelf.append(rewards);
        const footer = node('div', 'lr-stage-footer');
        s.error = node('p', 'lr-error'); s.error.setAttribute('role', 'alert');
        if (reward.claimed) {
            footer.append(node('span', 'lr-complete-stamp', '✓ 수령 완료'));
            if (s.receipt?.level === reward.level) footer.append(button('lr-text-button', '받은 보상 확인', () => showReceipt(s, s.receipt, false)));
        } else if (reward.unlocked) {
            s.claim = button('lr-primary', '보상 받기', () => claim(s, reward));
            s.claim.disabled = s.busy;
            footer.append(s.claim);
            if (reward.items.some(item => item.name.includes('카드팩'))) footer.append(node('p', 'lr-pack-note', '카드팩은 캐릭터 카드로 바로 지급됩니다'));
        } else footer.append(node('p', 'lr-locked-note', '레벨 ' + (reward.level - s.userLevel) + ' 더 올리면 열립니다'));
        footer.append(s.error); s.stage.append(heading, shelf, footer);
    }
    function select(s, index, audible = true) {
        if (state !== s || s.busy || s.overlay) return;
        const next = Math.max(0, Math.min(s.list.length - 1, index));
        if (s.selected === next) return;
        s.selected = next; if (audible) sound('select'); renderDial(s); renderDetail(s);
    }
    async function claim(s, reward) {
        if (s.busy || state !== s) return;
        s.busy = true; s.claim.disabled = true; s.claim.textContent = '받는 중'; s.error.textContent = ''; sound('select'); renderDial(s);
        try {
            const result = await s.options.postApi('/api/levelreward', { level: reward.level });
            if (state !== s) return;
            reward.claimed = true; s.receipt = result;
            if (result.profile) s.options.onProfile(result.profile);
            s.busy = false; renderDial(s); renderDetail(s); showReceipt(s, result, true);
        } catch (error) {
            if (state !== s) return;
            s.busy = false; s.claim.disabled = false; s.claim.textContent = '다시 시도';
            s.error.textContent = error.message; renderDial(s);
        }
    }
    function showReceipt(s, receipt, animate) {
        const overlay = node('section', 'lr-receipt' + (animate && !reduced.matches ? ' is-revealing' : ''));
        s.overlay = overlay; overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-labelledby', 'lrReceiptTitle');
        const panel = node('div', 'lr-receipt-panel');
        const heading = node('h2', 'lr-receipt-title', '보상을 받았습니다'); heading.id = 'lrReceiptTitle';
        panel.append(node('span', 'lr-receipt-seal', '✓'), node('p', 'lr-receipt-level', '레벨 ' + receipt.level + ' 달성'), heading);
        const list = node('ul', 'lr-received-items'); list.tabIndex = 0; list.setAttribute('aria-label', '받은 보상 목록');
        [...(receipt.rewards || [])].sort((a, b) => Number(a.type === 'card') - Number(b.type === 'card')).forEach((item, i) => list.append(rewardTile(item, i)));
        panel.append(list);
        if (receipt.discardedCards) panel.append(node('p', 'lr-discarded', '카드 보관함이 가득 차서 카드 ' + receipt.discardedCards + '장을 받지 못했습니다'));
        const confirm = button('lr-primary', '확인', () => {
            if (overlay.classList.contains('is-revealing')) { finishReveal(); return; }
            stopSounds(); overlay.remove(); s.overlay = null; s.stage.inert = false; s.dialControl.inert = false; s.header.inert = false; s.remaining.inert = false;
            const next = s.list.findIndex(r => r.unlocked && !r.claimed);
            if (next >= 0) select(s, next, false);
            s.dialControl.focus({ preventScroll: true });
        });
        panel.append(confirm); overlay.append(panel); s.screen.append(overlay);
        s.stage.inert = true; s.dialControl.inert = true; s.header.inert = true; s.remaining.inert = true;
        const finishReveal = () => { overlay.classList.remove('is-revealing'); clearTimeout(s.revealTimer); confirm.textContent = '확인'; };
        overlay.addEventListener('keydown', event => {
            if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') {
                if (overlay.classList.contains('is-revealing')) { event.preventDefault(); event.stopPropagation(); finishReveal(); }
                else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); confirm.click(); }
            }
            if (event.key === 'Tab') {
                event.preventDefault(); finishReveal();
                (document.activeElement === confirm ? list : confirm).focus({ preventScroll: true });
            }
        });
        overlay.addEventListener('pointerdown', event => { if (event.target !== confirm && overlay.classList.contains('is-revealing')) finishReveal(); });
        if (animate) sound('deal');
        if (overlay.classList.contains('is-revealing')) {
            confirm.textContent = '연출 건너뛰기';
            s.revealTimer = setTimeout(finishReveal, Math.min(2200, 600 + (receipt.rewards?.length || 0) * 130));
        }
        confirm.focus({ preventScroll: true });
    }
    function build(s) {
        const screen = s.screen;
        screen.replaceChildren();
        s.header = node('header', 'lr-header');
        const exit = button('lr-tool', '‹ 나가기', s.options.onClose);
        const soundButton = button('lr-tool lr-sound', '', () => { muted = !muted; write('level-reward-muted', muted ? '1' : '0'); updateSound(); if (muted) stopSounds(); else sound('select'); });
        function updateSound() { soundButton.textContent = muted ? '소리 꺼짐' : '소리 켜짐'; soundButton.setAttribute('aria-pressed', String(!muted)); }
        updateSound();
        s.header.append(exit, node('h1', '', '레벨 보상'), soundButton);
        s.remaining = button('lr-ready-count', '', () => { const index = s.list.findIndex(r => r.unlocked && !r.claimed); if (index >= 0) select(s, index); });
        const body = node('div', 'lr-body');
        s.dialControl = node('div', 'lr-dial-control'); s.dialControl.tabIndex = 0;
        s.dialControl.setAttribute('role', 'slider'); s.dialControl.setAttribute('aria-label', '보상 레벨 선택');
        s.dialControl.setAttribute('aria-valuemin', '10'); s.dialControl.setAttribute('aria-valuemax', '300');
        s.dial = node('div', 'lr-dial');
        s.prev = button('lr-dial-prev', '‹', () => select(s, s.selected - 1)); s.prev.setAttribute('aria-label', '이전 레벨');
        s.next = button('lr-dial-next', '›', () => select(s, s.selected + 1)); s.next.setAttribute('aria-label', '다음 레벨');
        s.dialControl.append(s.dial, node('div', 'lr-needle'), s.prev, s.next);
        const progress = node('div', 'lr-progress');
        progress.append(node('span', '', '현재 레벨'), node('strong', '', String(s.userLevel)), s.remaining);
        s.stage = node('article', 'lr-stage'); s.stage.setAttribute('aria-live', 'polite');
        body.append(s.dialControl, progress, s.stage); screen.append(s.header, body);
        s.dialControl.addEventListener('keydown', event => {
            const jumps = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, PageDown: 5, PageUp: -5, Home: -30, End: 30 };
            if (jumps[event.key] !== undefined) { event.preventDefault(); select(s, s.selected + jumps[event.key]); }
        });
        let drag = null, wheelAt = 0;
        s.dialControl.addEventListener('pointerdown', event => {
            if (event.button !== 0 || s.busy) return;
            drag = { id: event.pointerId, x: event.clientX, y: event.clientY, index: s.selected, moved: false };
        });
        s.dialControl.addEventListener('pointermove', event => {
            if (!drag || drag.id !== event.pointerId) return;
            const horizontal = matchMedia('(max-width: 760px) and (min-height: 501px), (max-width: 1024px) and (max-aspect-ratio: 4/5)').matches;
            const distance = horizontal ? drag.x - event.clientX : drag.y - event.clientY;
            if (Math.abs(distance) > 12) { drag.moved = true; s.dialControl.setPointerCapture(event.pointerId); select(s, drag.index + Math.round(distance / 55)); }
        });
        s.dialControl.addEventListener('click', event => { if (drag?.moved) { event.preventDefault(); event.stopPropagation(); } }, true);
        s.dialControl.addEventListener('pointercancel', () => { drag = null; });
        s.dialControl.addEventListener('pointerup', () => { setTimeout(() => { drag = null; }, 0); });
        s.dialControl.addEventListener('wheel', event => { event.preventDefault(); if (Date.now() - wheelAt < 160) return; wheelAt = Date.now(); select(s, s.selected + Math.sign(event.deltaY || event.deltaX)); }, { passive: false });
        renderDial(s); renderDetail(s); s.dialControl.focus({ preventScroll: true });
    }
    async function mount(root, options) {
        unmount(); $('.lr-notice')?.remove();
        const s = state = { root, options, list: [], selected: -1, busy: false, focus: document.activeElement };
        s.screen = node('section', 'lr-screen'); s.screen.setAttribute('aria-label', '레벨 보상');
        root.append(s.screen); document.body.classList.add('level-rewards-open');
        s.inert = [...document.body.children].filter(child => !child.contains(root) && !child.inert && !['SCRIPT', 'LINK', 'STYLE'].includes(child.tagName));
        s.inert.forEach(child => { child.inert = true; });
        s.keyHandler = event => { if (event.key === 'Escape' && !s.overlay && !s.busy) options.onClose(); };
        document.addEventListener('keydown', s.keyHandler);
        const loading = node('div', 'lr-loading'); loading.append(node('p', '', '보상 불러오는 중'), button('lr-tool', '나가기', options.onClose)); s.screen.append(loading);
        try {
            const data = await options.api('/api/levelrewards');
            if (state !== s) return;
            s.list = data.list; s.userLevel = data.userLevel; s.receipt = data.receipt;
            observe(data.status);
            s.selected = s.list.findIndex(r => r.unlocked && !r.claimed);
            if (s.selected < 0) s.selected = s.list.findIndex(r => !r.unlocked);
            if (s.selected < 0) s.selected = s.list.length - 1;
            build(s);
        } catch (error) {
            if (state !== s) return;
            loading.replaceChildren(node('p', 'lr-error', error.message), button('lr-primary', '다시 불러오기', () => mount(root, options)), button('lr-tool', '나가기', options.onClose));
        }
    }
    function unmount() {
        if (!state) return;
        const s = state; state = null;
        clearTimeout(s.revealTimer); stopSounds(); document.removeEventListener('keydown', s.keyHandler);
        s.root.replaceChildren(); document.body.classList.remove('level-rewards-open');
        s.inert.forEach(child => { child.inert = false; });
        if (s.focus?.isConnected) s.focus.focus({ preventScroll: true });
    }
    window.LevelRewardsUI = { mount, unmount, observe, updateBadge };
})();
