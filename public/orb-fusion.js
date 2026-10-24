/* 보주 합성: WebGL 의식 제단 위에 접근 가능한 DOM 조작을 겹친다. 연출은 서버가 확정한 결과만 보여준다. */
(() => {
    'use strict';
    const ASSETS = '/static/assets/orb-fusion/';
    const SOUND_KEY = 'orbFusionSound';
    const VOLUME = { select: .3, charge: .42, reveal: .5, cancel: .26 };
    const MIN_CHARGE = 1100, RELEASE = 1300, REVEAL_AT = .18;
    const AETHER = [.56, .91, 1];
    const colorCache = new Map();
    let active = null;

    function node(tag, className, text) {
        const result = document.createElement(tag);
        if (className) result.className = className;
        if (text != null) result.textContent = text;
        return result;
    }
    function button(className, text, click) {
        const result = node('button', className, text); result.type = 'button';
        if (click) result.addEventListener('click', click);
        return result;
    }
    const ICONS = {
        sound: 'M11 5 6 9H3v6h3l5 4V5m4 3a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14',
        muted: 'M11 5 6 9H3v6h3l5 4V5m5 4 5 6m0-6-5 6',
        refresh: 'M20 7v5h-5M4 17v-5h5M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3A7 7 0 0 0 18 17',
        help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18m-2.6-11.5a2.7 2.7 0 0 1 5.2 1c0 1.8-2.6 2.3-2.6 4m0 2.6h.01',
        clear: 'M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13',
        lock: 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5V11',
        info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18m0-5v-5m0-3h.01',
        warn: 'M12 3 2 21h20L12 3m0 7v5m0 3h.01'
    };
    function icon(name) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), path = document.createElementNS(svg.namespaceURI, 'path');
        svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.7'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
        path.setAttribute('d', ICONS[name]); svg.append(path); return svg;
    }
    function toolButton(name, label, click) {
        const result = button('of-tool', '', click); result.append(icon(name)); result.setAttribute('aria-label', label); result.title = label; return result;
    }
    function hue(name) {
        let hash = 0; for (const ch of String(name)) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
        return hash % 360;
    }
    function hslRgb(h, s, l) {
        const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
        return [0, 8, 4].map(n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)));
    }
    // 이미지가 없거나 깨지면 이름 해시 색으로 CSS 유리 구체를 그린다(회색 실루엣 대체 이미지는 쓰지 않는다).
    function orbArt(orb, className = '') {
        const wrap = node('span', 'of-orb ' + className); wrap.setAttribute('aria-hidden', 'true');
        wrap.style.setProperty('--h', hue(orb.name));
        if (!orb.imageUrl) { wrap.classList.add('is-procedural'); return wrap; }
        const image = node('img'); image.alt = ''; image.draggable = false; image.decoding = 'async'; image.src = orb.imageUrl;
        image.addEventListener('error', () => { image.remove(); wrap.classList.add('is-procedural'); }, { once: true });
        fitImage(image, orb.imageUrl);
        wrap.append(image); return wrap;
    }
    // 원본 PNG의 투명 여백을 측정해 보주가 소켓을 꽉 채우도록 확대한다. 측정할 수 없으면 원래 비율 그대로 둔다.
    const fitCache = new Map();
    function fitImage(image, url) {
        if (!fitCache.has(url)) fitCache.set(url, new Promise(resolve => {
            const probe = new Image(); probe.crossOrigin = 'anonymous'; probe.decoding = 'async';
            probe.onerror = () => resolve('');
            probe.onload = () => {
                try {
                    const size = 96, canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
                    const context = canvas.getContext('2d', { willReadFrequently: true });
                    const scale = Math.min(size / probe.naturalWidth, size / probe.naturalHeight), w = probe.naturalWidth * scale, h = probe.naturalHeight * scale;
                    context.drawImage(probe, (size - w) / 2, (size - h) / 2, w, h);
                    const pixels = context.getImageData(0, 0, size, size).data; let left = size, top = size, right = -1, bottom = -1;
                    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (pixels[(y * size + x) * 4 + 3] > 24) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
                    if (right < left) return resolve('');
                    const zoom = Math.min(3, size * .96 / Math.max(right - left + 1, bottom - top + 1));
                    if (zoom < 1.04) return resolve('');
                    resolve(`scale(${zoom.toFixed(3)}) translate(${((size / 2 - (left + right + 1) / 2) / size * 100).toFixed(2)}%, ${((size / 2 - (top + bottom + 1) / 2) / size * 100).toFixed(2)}%)`);
                } catch { resolve(''); }
            };
            probe.src = url;
        }));
        fitCache.get(url).then(transform => { if (transform) image.style.transform = transform; });
    }
    // 결과 연출의 광원 색: 보주 이미지의 채도 가중 평균. 읽을 수 없으면 이름 해시 색.
    function sampleColor(orb) {
        const key = orb.imageUrl || '#' + orb.name;
        if (colorCache.has(key)) return colorCache.get(key);
        const fallback = hslRgb(hue(orb.name), .7, .62);
        const promise = !orb.imageUrl ? Promise.resolve(fallback) : new Promise(resolve => {
            const image = new Image(); image.decoding = 'async';
            image.onload = () => {
                try {
                    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 16;
                    const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(image, 0, 0, 16, 16);
                    const data = context.getImageData(0, 0, 16, 16).data; let r = 0, g = 0, b = 0, w = 0;
                    for (let i = 0; i < data.length; i += 4) {
                        const max = Math.max(data[i], data[i + 1], data[i + 2]), min = Math.min(data[i], data[i + 1], data[i + 2]);
                        const weight = data[i + 3] / 255 * ((max - min) / 255 + .08) * (max / 255);
                        r += data[i] * weight; g += data[i + 1] * weight; b += data[i + 2] * weight; w += weight;
                    }
                    if (w < .01) return resolve(fallback);
                    const color = [r / w / 255, g / w / 255, b / w / 255], peak = Math.max(...color, .01);
                    resolve(color.map(value => Math.min(1, value / peak * .95 + .05)));
                } catch { resolve(fallback); }
            };
            image.onerror = () => resolve(fallback);
            image.src = orb.imageUrl;
        });
        colorCache.set(key, promise); return promise;
    }
    function preload(url) {
        if (!url) return Promise.resolve();
        return new Promise(resolve => { const image = new Image(); image.onload = image.onerror = () => resolve(); image.src = url; });
    }
    const within = (promise, ms) => Promise.race([promise, new Promise(resolve => setTimeout(resolve, ms))]);
    function uuid() {
        if (crypto.randomUUID) return crypto.randomUUID();
        const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = bytes[6] & 15 | 64; bytes[8] = bytes[8] & 63 | 128;
        const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
    const toInt = value => Math.max(0, Math.floor(Number(value) || 0));
    function normalizeOrb(orb) {
        return { id: Number(orb.id), name: String(orb.name ?? ''), count: toInt(orb.count), boundCount: toInt(orb.boundCount), description: String(orb.description ?? ''), imageUrl: String(orb.imageUrl ?? ''), series: String(orb.series ?? '') };
    }
    function normalize(data) {
        if (!data || !Array.isArray(data.orbs)) throw new Error('보주 정보를 읽지 못했습니다.');
        return { revision: Number(data.revision), poolSize: toInt(data.poolSize), orbs: data.orbs.map(normalizeOrb).filter(orb => Number.isInteger(orb.id) && orb.count > 0) };
    }

    // ---------- 상태 ----------
    const orbById = (ctx, id) => ctx.data?.orbs.find(orb => orb.id === id) || null;
    const picked = (ctx, id) => ctx.slots.filter(slot => slot === id).length;
    const locked = ctx => ctx.busy || !!ctx.pending || ctx.phase === 'release';
    function play(ctx, name) {
        if (!ctx.sound || !ctx.gestured || ctx.disposed || document.hidden) return;
        try {
            const audio = ctx.audio[name] ||= new Audio(ASSETS + name + '.ogg');
            audio.volume = VOLUME[name]; audio.currentTime = 0;
            audio.play()?.catch(() => {});
        } catch { /* 소리 실패는 진행을 막지 않는다. */ }
    }
    function silence(ctx) { Object.values(ctx.audio).forEach(audio => { try { audio.pause(); } catch {} }); }
    function later(ctx, fn, ms) {
        const timer = setTimeout(() => { ctx.timers.delete(timer); if (!ctx.disposed) fn(); }, ms); ctx.timers.add(timer); return timer;
    }
    function notice(ctx, message, tone = '') {
        ctx.status.textContent = message || ''; ctx.status.dataset.tone = tone;
    }

    function apply(ctx, data) {
        ctx.data = data;
        const dropped = [];
        // 대기 중인 요청이 있으면 재시도용 재료 표시를 그대로 둔다.
        if (!ctx.pending) ctx.slots.forEach((id, index) => {
            if (id == null) return;
            const orb = orbById(ctx, id);
            if (!orb || ctx.slots.slice(0, index + 1).filter(slot => slot === id).length > orb.count) { ctx.slots[index] = null; dropped.push(index); }
        });
        if (ctx.filter !== 'all' && !data.orbs.some(orb => orb.series === ctx.filter)) ctx.filter = 'all';
        if (dropped.length) notice(ctx, '보유 수량이 바뀌어 일부 재료를 뺐습니다.', 'warn');
        ctx.rulesPool.textContent = data.poolSize ? `결과는 등록된 보주 ${data.poolSize.toLocaleString('ko-KR')}종 중 하나가 같은 확률로 나옵니다.` : '결과는 등록된 모든 보주 중 하나가 같은 확률로 나옵니다.';
        render(ctx);
    }
    async function refresh(ctx, { quiet = false } = {}) {
        if (ctx.disposed) return false;
        if (ctx.fetching) return ctx.fetching;
        ctx.refreshButton.classList.add('is-spinning'); ctx.refreshButton.disabled = true;
        ctx.fetching = (async () => {
            try {
                const data = normalize(await ctx.api('/api/orb-fusion'));
                if (ctx.disposed) return false;
                apply(ctx, data);
                if (!quiet) notice(ctx, '보유 보주를 새로 불러왔습니다.');
                return true;
            } catch (error) {
                if (!ctx.disposed) notice(ctx, (error?.message || '보주 정보를 불러오지 못했습니다.') + ' 새로고침으로 다시 시도해주세요.', 'error');
                return false;
            } finally {
                ctx.fetching = null;
                if (!ctx.disposed) { ctx.refreshButton.classList.remove('is-spinning'); ctx.refreshButton.disabled = false; ctx.loaded = true; render(ctx); }
            }
        })();
        return ctx.fetching;
    }

    // ---------- 렌더 ----------
    function render(ctx) {
        renderSockets(ctx); renderInventory(ctx); renderDock(ctx);
        ctx.root.classList.toggle('is-locked', locked(ctx));
        ctx.root.classList.toggle('is-ready', ctx.slots.every(slot => slot != null));
    }
    function renderSockets(ctx) {
        ctx.sockets.forEach((socket, index) => {
            const consumed = ctx.consumed?.[index], id = consumed ? consumed.id : ctx.slots[index];
            const orb = consumed || (id != null ? orbById(ctx, id) : null), key = orb ? String(orb.id) : '';
            if (socket.root.dataset.key !== key) {
                socket.root.dataset.key = key; socket.well.replaceChildren();
                if (orb) socket.well.append(orbArt(orb, 'of-socket-orb'));
                socket.root.classList.toggle('is-filled', !!orb);
            }
            socket.button.setAttribute('aria-label', orb ? `재료 ${index + 1} ${orb.name} 빼기` : `재료 ${index + 1} 비어 있음`);
            socket.button.disabled = locked(ctx) && !!orb;
        });
        ctx.fx?.setSockets(ctx.sockets.map((socket, index) => ctx.consumed?.[index] || orbById(ctx, ctx.slots[index])));
    }
    function renderInventory(ctx) {
        const data = ctx.data, list = ctx.list;
        const focusedId = list.contains(document.activeElement) ? document.activeElement.closest('[data-id]')?.dataset.id : null;
        const focusedInfo = document.activeElement?.classList.contains('of-info');
        list.replaceChildren();
        ctx.invCount.textContent = data ? data.orbs.reduce((sum, orb) => sum + orb.count, 0).toLocaleString('ko-KR') : '';
        const series = data ? [...new Set(data.orbs.map(orb => orb.series).filter(Boolean))] : [];
        ctx.filters.hidden = series.length < 2;
        ctx.filters.replaceChildren();
        if (series.length >= 2) ['all', ...series].forEach(value => {
            const chip = button('of-chip' + (ctx.filter === value ? ' is-active' : ''), value === 'all' ? '전체' : value, () => { ctx.filter = value; renderInventory(ctx); });
            chip.setAttribute('aria-pressed', String(ctx.filter === value)); ctx.filters.append(chip);
        });
        ctx.empty.hidden = true;
        if (!data) { ctx.empty.hidden = !ctx.loaded; ctx.empty.textContent = '보주 정보를 불러오지 못했습니다.'; return; }
        const orbs = data.orbs.filter(orb => ctx.filter === 'all' || orb.series === ctx.filter);
        if (!orbs.length) { ctx.empty.hidden = false; ctx.empty.textContent = '보유한 보주가 없습니다.'; return; }
        const full = ctx.slots.every(slot => slot != null), isLocked = locked(ctx);
        for (const orb of orbs) {
            const count = picked(ctx, orb.id), spent = count >= orb.count;
            const item = node('li', 'of-item'); item.dataset.id = orb.id;
            if (count) item.classList.add('is-picked');
            if (ctx.highlightId === orb.id) item.classList.add('is-new');
            const row = button('of-row', null, () => addMaterial(ctx, orb.id));
            row.disabled = isLocked || spent || full;
            row.classList.toggle('is-spent', spent);
            row.setAttribute('aria-label', `${orb.name}, 보유 ${orb.count}개` + (orb.boundCount ? `, 귀속 ${orb.boundCount}개` : '') + (count ? `, ${count}개 선택됨` : ''));
            // 진열장 칸: 보석 소켓(보주 + 수량 명판 + 선택 보석) 아래에 이름.
            const jewel = node('span', 'of-row-case'); jewel.setAttribute('aria-hidden', 'true');
            sampleColor(orb).then(rgb => jewel.style.setProperty('--oc', rgb.map(value => Math.round(value * 255)).join(',')));
            const qty = node('span', 'of-row-count');
            qty.append(node('small', '', '×'), document.createTextNode(orb.count.toLocaleString('ko-KR')));
            const pips = node('span', 'of-row-pips');
            for (let i = 0; i < count; i++) pips.append(node('i'));
            jewel.append(node('span', 'of-row-halo'), orbArt(orb, 'of-row-orb'), node('span', 'of-row-gloss'), pips, qty);
            const text = node('span', 'of-row-text'); text.append(node('strong', 'of-row-name', orb.name));
            if (orb.series) text.append(node('span', 'of-row-series', orb.series));
            row.append(jewel, text);
            if (orb.boundCount) {
                const bound = node('span', 'of-row-bound'); bound.title = `귀속 ${orb.boundCount}개`; bound.setAttribute('aria-hidden', 'true');
                bound.append(icon('lock'), document.createTextNode(orb.boundCount.toLocaleString('ko-KR'))); row.append(bound);
            }
            item.append(row);
            if (orb.description) {
                const desc = node('p', 'of-desc', orb.description); desc.id = `of-desc-${orb.id}`; desc.hidden = !ctx.openInfo.has(orb.id);
                const info = button('of-info', null, () => {
                    if (ctx.openInfo.has(orb.id)) ctx.openInfo.delete(orb.id); else ctx.openInfo.add(orb.id);
                    desc.hidden = !ctx.openInfo.has(orb.id); info.setAttribute('aria-expanded', String(!desc.hidden)); item.classList.toggle('is-open', !desc.hidden);
                });
                info.append(icon('info')); info.setAttribute('aria-label', `${orb.name} 설명`); info.setAttribute('aria-controls', desc.id); info.setAttribute('aria-expanded', String(!desc.hidden));
                item.classList.toggle('is-open', !desc.hidden); item.append(info, desc);
            }
            list.append(item);
            if (focusedId === String(orb.id)) (focusedInfo ? item.querySelector('.of-info') : row.disabled ? null : row)?.focus({ preventScroll: true });
        }
    }
    function renderDock(ctx) {
        const filled = ctx.slots.filter(slot => slot != null).length, waiting = !!ctx.pending && !ctx.busy;
        ctx.pips.forEach((pip, index) => pip.classList.toggle('is-on', index < filled));
        ctx.fuseLabel.textContent = ctx.busy ? '합성 중' : waiting ? '다시 시도' : '합성';
        ctx.fuse.disabled = ctx.busy || ctx.phase === 'release' || (!waiting && (filled < 3 || !ctx.data));
        ctx.fuse.setAttribute('aria-label', waiting ? '같은 요청으로 다시 시도' : `합성, 재료 ${filled}/3`);
        ctx.fuse.classList.toggle('is-retry', waiting);
        ctx.discard.hidden = !waiting;
        ctx.clear.disabled = locked(ctx) || !filled;
    }

    // ---------- 조작 ----------
    function addMaterial(ctx, id) {
        if (locked(ctx)) return;
        const orb = orbById(ctx, id); if (!orb) return;
        if (picked(ctx, id) >= orb.count) return;
        const index = ctx.slots.indexOf(null); if (index < 0) return;
        clearResult(ctx);
        ctx.slots[index] = id; play(ctx, 'select');
        if (ctx.status.dataset.tone !== 'error') notice(ctx, '');
        render(ctx);
        const socket = ctx.sockets[index].root;
        socket.classList.remove('is-landing'); void socket.offsetWidth; socket.classList.add('is-landing');
    }
    function removeMaterial(ctx, index) {
        if (locked(ctx) || ctx.slots[index] == null) return;
        ctx.slots[index] = null; play(ctx, 'cancel'); render(ctx);
    }
    function clearResult(ctx) {
        if (!ctx.result) return;
        ctx.result = null; ctx.core.classList.remove('is-revealed'); ctx.coreOrb.replaceChildren(); ctx.plate.hidden = true; ctx.fx?.clearResult();
    }

    function closeDialog(ctx, sound = false) {
        if (!ctx.dialog) return;
        const { overlay, focus } = ctx.dialog; overlay.remove(); ctx.dialog = null;
        ctx.scene.forEach(part => { part.inert = false; });
        if (sound) play(ctx, 'cancel');
        if (focus?.isConnected && !focus.disabled) focus.focus({ preventScroll: true });
    }
    function openConfirm(ctx) {
        if (locked(ctx) || ctx.dialog || ctx.slots.some(slot => slot == null)) return;
        const materials = ctx.slots.map(id => orbById(ctx, id)); if (materials.some(orb => !orb)) return;
        play(ctx, 'select');
        const overlay = node('div', 'of-overlay'), dialog = node('section', 'of-dialog');
        dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', 'of-dialog-title'); dialog.setAttribute('aria-describedby', 'of-dialog-warn');
        const title = node('h3', 'of-dialog-title', '합성 확인'); title.id = 'of-dialog-title';
        const mats = node('ul', 'of-dialog-mats'); mats.setAttribute('aria-label', '소모되는 재료');
        materials.forEach(orb => {
            const entry = node('li', 'of-dialog-mat'); entry.append(orbArt(orb, 'of-dialog-orb'), node('span', 'of-dialog-name', orb.name));
            if (orb.boundCount) { const bound = node('span', 'of-dialog-bound'); bound.append(icon('lock'), document.createTextNode('귀속 보유')); entry.append(bound); }
            mats.append(entry);
        });
        const out = node('div', 'of-dialog-out');
        const outText = node('div', 'of-dialog-out-text'); outText.append(node('strong', '', '무작위 보주 1개'));
        if (ctx.data.poolSize) outText.append(node('span', '', `${ctx.data.poolSize.toLocaleString('ko-KR')}종 중 하나`));
        out.append(node('span', 'of-dialog-arrow'), outText, node('span', 'of-tag', '거래 가능'));
        const warn = node('p', 'of-dialog-warn'); warn.id = 'of-dialog-warn'; warn.append(icon('warn'), node('span', '', '재료 3개가 소모되며 되돌릴 수 없습니다.'));
        const back = button('of-btn of-btn-ghost', '돌아가기', () => closeDialog(ctx, true));
        const confirm = button('of-btn of-btn-gold', '합성', () => { if (ctx.busy) return; closeDialog(ctx); startFusion(ctx); });
        const actions = node('div', 'of-dialog-actions'); actions.append(back, confirm);
        dialog.append(title, mats, out, warn, actions); overlay.append(dialog);
        ctx.dialog = { overlay, focus: document.activeElement };
        ctx.scene.forEach(part => { part.inert = true; });
        ctx.root.append(overlay); confirm.focus();
        overlay.addEventListener('click', event => { if (event.target === overlay) closeDialog(ctx, true); });
        overlay.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.preventDefault(); closeDialog(ctx, true); }
            if (event.key === 'Tab') {
                const buttons = [back, confirm];
                if (event.shiftKey && document.activeElement === back) { event.preventDefault(); confirm.focus(); }
                else if (!event.shiftKey && document.activeElement === confirm) { event.preventDefault(); back.focus(); }
                else if (!buttons.includes(document.activeElement)) { event.preventDefault(); confirm.focus(); }
            }
        });
    }

    // 같은 요청(requestId, revision, materialIds)은 성공하거나 사용자가 취소하기 전까지 재사용한다.
    async function startFusion(ctx) {
        if (ctx.busy || ctx.disposed || !ctx.data) return;
        if (!ctx.pending) {
            if (ctx.slots.some(slot => slot == null)) return;
            ctx.pending = { requestId: uuid(), revision: ctx.data.revision, materialIds: ctx.slots.slice() };
        }
        const pending = ctx.pending, startedAt = performance.now();
        ctx.busy = true; ctx.phase = 'charging'; ctx.root.classList.add('is-charging');
        notice(ctx, ''); play(ctx, 'charge'); ctx.fx?.charge(true); render(ctx);
        let response;
        try {
            response = await ctx.postApi('/api/orb-fusion', { requestId: pending.requestId, revision: pending.revision, materialIds: pending.materialIds.slice() });
            if (!response || response.ok !== true || !response.result) throw Object.assign(new Error(response?.error || '합성 결과를 확인하지 못했습니다.'), { uncertain: true });
        } catch (error) {
            if (ctx.disposed) return;
            ctx.busy = false; ctx.phase = 'idle'; ctx.root.classList.remove('is-charging'); ctx.fx?.charge(false); play(ctx, 'cancel');
            const message = error?.message || '';
            const uncertain = error?.uncertain || error?.name === 'TypeError' || !message || /^HTTP 5|fetch|network|load failed/i.test(message);
            notice(ctx, uncertain ? '서버 응답을 확인하지 못했습니다. 다시 시도하면 같은 요청으로 확인합니다.' : message + ' 다시 시도하거나 선택을 초기화해주세요.', 'error');
            render(ctx); ctx.fuse.focus({ preventScroll: true });
            return;
        }
        if (ctx.disposed) return;
        // 서버 확정분을 연출보다 먼저 반영한다. 연출은 이 결과를 바꾸지 못한다.
        const result = normalizeOrb(response.result);
        ctx.consumed = pending.materialIds.map(id => ({ ...(orbById(ctx, id) || { id, name: '', imageUrl: '' }) }));
        ctx.pending = null; ctx.slots = [null, null, null];
        try { apply(ctx, normalize(response)); } catch { refresh(ctx, { quiet: true }); }
        const reduced = ctx.reduced.matches;
        const [color] = await Promise.all([
            within(sampleColor(result), 500),
            within(preload(result.imageUrl), 900),
            new Promise(resolve => setTimeout(resolve, reduced ? 0 : Math.max(0, MIN_CHARGE - (performance.now() - startedAt))))
        ]);
        if (ctx.disposed) return;
        release(ctx, result, color || hslRgb(hue(result.name), .7, .62));
    }
    function release(ctx, result, color) {
        const reduced = ctx.reduced.matches;
        ctx.phase = 'release'; ctx.root.classList.remove('is-charging'); ctx.root.classList.add('is-release');
        const coreRect = ctx.core.getBoundingClientRect(), cx = coreRect.left + coreRect.width / 2, cy = coreRect.top + coreRect.height / 2;
        ctx.sockets.forEach(socket => {
            const rect = socket.root.getBoundingClientRect();
            socket.root.style.setProperty('--to-x', (cx - rect.left - rect.width / 2) + 'px'); socket.root.style.setProperty('--to-y', (cy - rect.top - rect.height / 2) + 'px');
            socket.root.classList.add('is-consumed');
        });
        ctx.fx?.release(color);
        ctx.result = result;
        later(ctx, () => {
            ctx.root.style.setProperty('--rc', color.map(value => Math.round(value * 255)).join(','));
            ctx.coreOrb.replaceChildren(orbArt(result, 'of-core-orb-art'));
            ctx.plateName.textContent = result.name; ctx.plateSeries.textContent = result.series; ctx.plateSeries.hidden = !result.series;
            ctx.plateDesc.textContent = result.description; ctx.plateDesc.hidden = !result.description;
            ctx.plate.hidden = false; ctx.core.classList.add('is-revealed');
            play(ctx, 'reveal'); notice(ctx, `${result.name} 획득`, 'success');
        }, reduced ? 0 : RELEASE * REVEAL_AT);
        later(ctx, () => {
            ctx.consumed = null; ctx.busy = false; ctx.phase = 'idle'; ctx.root.classList.remove('is-release');
            ctx.sockets.forEach(socket => socket.root.classList.remove('is-consumed'));
            ctx.highlightId = result.id; render(ctx);
            ctx.list.querySelector(`[data-id="${result.id}"]`)?.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
            later(ctx, () => { ctx.highlightId = null; ctx.list.querySelectorAll('.is-new').forEach(item => item.classList.remove('is-new')); }, 2600);
            if (ctx.fuse.disabled) ctx.list.querySelector('.of-row:not(:disabled)')?.focus({ preventScroll: true });
        }, reduced ? 60 : RELEASE);
    }
    async function discardPending(ctx) {
        if (ctx.busy || !ctx.pending) return;
        const revision = ctx.pending.revision; ctx.pending = null; play(ctx, 'cancel'); render(ctx);
        const ok = await refresh(ctx, { quiet: true });
        if (ctx.disposed || !ok) return;
        ctx.slots = [null, null, null]; render(ctx);
        notice(ctx, ctx.data.revision !== revision ? '합성이 처리되었습니다. 보유 보주를 확인해주세요.' : '선택을 초기화했습니다. 이미 전송한 합성은 취소되지 않습니다.', 'warn');
    }

    // ---------- 레이아웃 ----------
    function measure(ctx) {
        const top = ctx.root.getBoundingClientRect().top + window.scrollY;
        ctx.root.style.setProperty('--of-top', Math.max(0, Math.round(top)) + 'px');
        const tabs = document.querySelector('.bottom-tabs');
        const dock = tabs && getComputedStyle(tabs).display !== 'none' && getComputedStyle(tabs).position === 'fixed' ? tabs.offsetHeight : 0;
        ctx.root.style.setProperty('--of-dock', dock + 'px');
    }

    // ---------- 마운트 ----------
    function mount(root, options = {}) {
        unmount();
        const ctx = active = {
            root, api: options.api, postApi: options.postApi, data: null, slots: [null, null, null], filter: 'all', openInfo: new Set(),
            busy: false, phase: 'idle', pending: null, consumed: null, result: null, highlightId: null, loaded: false,
            audio: {}, timers: new Set(), abort: new AbortController(), gestured: false, disposed: false,
            reduced: matchMedia('(prefers-reduced-motion: reduce)')
        };
        const signal = ctx.abort.signal;
        try { ctx.sound = localStorage.getItem(SOUND_KEY) !== 'off'; } catch { ctx.sound = true; }
        root.classList.add('orb-fusion-root'); root.replaceChildren(); root.dataset.gl = 'pending';

        // 무대
        const stage = node('section', 'of-stage'); stage.setAttribute('aria-label', '합성 제단');
        const head = node('header', 'of-head'), title = node('h2', 'of-title', '보주 합성'), tools = node('div', 'of-tools');
        const rules = node('div', 'of-rules'); rules.id = 'of-rules'; rules.hidden = true; rules.setAttribute('role', 'note');
        const rulesList = node('ul');
        ['재료 보주 3개를 소모해 보주 1개를 얻습니다.', '같은 보주는 보유 수량만큼 겹쳐 넣을 수 있습니다.', null, '귀속 보주도 재료로 쓸 수 있고, 결과 보주는 거래할 수 있습니다.', '비용 없이 항상 성공합니다.'].forEach(line => {
            const entry = node('li', '', line); if (line == null) ctx.rulesPool = entry; rulesList.append(entry);
        });
        ctx.rulesPool.textContent = '결과는 등록된 모든 보주 중 하나가 같은 확률로 나옵니다.';
        rules.append(node('strong', 'of-rules-title', '합성 규칙'), rulesList);
        const help = toolButton('help', '합성 규칙', () => setRules(rules.hidden));
        help.setAttribute('aria-controls', rules.id); help.setAttribute('aria-expanded', 'false');
        const setRules = open => { rules.hidden = !open; help.setAttribute('aria-expanded', String(open)); help.classList.toggle('is-active', open); };
        const sound = toolButton('sound', '', () => {
            ctx.sound = !ctx.sound; try { localStorage.setItem(SOUND_KEY, ctx.sound ? 'on' : 'off'); } catch {}
            updateSound(); if (ctx.sound) play(ctx, 'select'); else silence(ctx);
        });
        const updateSound = () => {
            sound.replaceChildren(icon(ctx.sound ? 'sound' : 'muted'));
            const label = ctx.sound ? '효과음 끄기' : '효과음 켜기'; sound.setAttribute('aria-label', label); sound.title = label; sound.setAttribute('aria-pressed', String(ctx.sound));
        };
        updateSound();
        ctx.refreshButton = toolButton('refresh', '새로고침', () => refresh(ctx));
        tools.append(help, sound, ctx.refreshButton); head.append(title, tools, rules);

        const altarWrap = node('div', 'of-altar-wrap'), altar = node('div', 'of-altar');
        const ring = node('img', 'of-ring'); ring.src = ASSETS + 'ritual-ring.webp'; ring.alt = ''; ring.setAttribute('aria-hidden', 'true'); ring.draggable = false;
        ring.addEventListener('error', () => ring.remove(), { once: true });
        const canvas = node('canvas', 'of-canvas'); canvas.setAttribute('aria-hidden', 'true');
        const glow = node('div', 'of-static-glow'); glow.setAttribute('aria-hidden', 'true');
        altar.append(glow, ring, canvas);
        ctx.sockets = [0, 1, 2].map(index => {
            const socketRoot = node('div', `of-socket of-socket-${index + 1}`);
            const socketButton = button('of-socket-button', null, () => {
                if (ctx.slots[index] != null) removeMaterial(ctx, index);
                else if (!locked(ctx)) {
                    const row = ctx.list.querySelector('.of-row:not(:disabled)');
                    if (row) { row.focus({ preventScroll: true }); row.scrollIntoView({ block: 'nearest', behavior: ctx.reduced.matches ? 'auto' : 'smooth' }); }
                }
            });
            const well = node('span', 'of-socket-well');
            socketButton.append(node('span', 'of-socket-rim'), well, node('span', 'of-socket-glass'), node('span', 'of-socket-num', String(index + 1)));
            socketRoot.append(socketButton); altar.append(socketRoot);
            return { root: socketRoot, button: socketButton, well };
        });
        const core = ctx.core = node('div', 'of-core');
        ctx.coreOrb = node('span', 'of-core-orb');
        const plate = ctx.plate = node('div', 'of-plate'); plate.hidden = true;
        ctx.plateName = node('strong', 'of-plate-name'); ctx.plateSeries = node('span', 'of-plate-series'); ctx.plateDesc = node('p', 'of-plate-desc');
        const plateHead = node('div', 'of-plate-head'); plateHead.append(ctx.plateSeries, node('span', 'of-tag', '거래 가능'));
        plate.append(plateHead, ctx.plateName, ctx.plateDesc);
        core.append(node('span', 'of-core-rim'), node('span', 'of-core-well'), ctx.coreOrb, node('span', 'of-core-glass'));
        altar.append(core, plate); altarWrap.append(altar); stage.append(head, altarWrap);

        // 인벤토리
        const inv = node('aside', 'of-inv'); inv.setAttribute('aria-labelledby', 'of-inv-title');
        const invHead = node('header', 'of-inv-head'), invTitle = node('h3', 'of-inv-title', '보유 보주'); invTitle.id = 'of-inv-title';
        ctx.invCount = node('span', 'of-inv-count'); invHead.append(invTitle, ctx.invCount);
        ctx.filters = node('div', 'of-filters'); ctx.filters.setAttribute('role', 'group'); ctx.filters.setAttribute('aria-label', '시리즈'); ctx.filters.hidden = true;
        ctx.list = node('ul', 'of-list'); ctx.list.setAttribute('aria-label', '보유 보주 목록');
        ctx.empty = node('p', 'of-empty'); ctx.empty.hidden = true;
        inv.append(invHead, ctx.filters, ctx.list, ctx.empty);

        // 실행 바
        const dock = node('div', 'of-dock');
        ctx.status = node('p', 'of-status'); ctx.status.setAttribute('role', 'status'); ctx.status.setAttribute('aria-live', 'polite');
        const actions = node('div', 'of-actions');
        ctx.clear = toolButton('clear', '재료 비우기', () => {
            if (locked(ctx) || ctx.slots.every(slot => slot == null)) return;
            ctx.slots = [null, null, null]; play(ctx, 'cancel'); render(ctx);
        });
        ctx.clear.classList.add('of-clear');
        ctx.fuse = button('of-fuse', null, () => { if (ctx.pending && !ctx.busy) startFusion(ctx); else openConfirm(ctx); });
        ctx.fuseLabel = node('span', 'of-fuse-label', '합성');
        const pips = node('span', 'of-fuse-pips'); pips.setAttribute('aria-hidden', 'true');
        ctx.pips = [0, 1, 2].map(() => pips.appendChild(node('i')));
        ctx.fuse.append(node('span', 'of-fuse-sheen'), ctx.fuseLabel, pips);
        ctx.discard = button('of-btn of-btn-ghost of-discard', '선택 초기화', () => discardPending(ctx)); ctx.discard.hidden = true;
        actions.append(ctx.clear, ctx.fuse, ctx.discard); dock.append(ctx.status, actions);

        ctx.scene = [stage, inv, dock];
        root.append(stage, inv, dock);

        root.addEventListener('pointerdown', () => { ctx.gestured = true; }, { capture: true, signal });
        root.addEventListener('keydown', () => { ctx.gestured = true; }, { capture: true, signal });
        document.addEventListener('pointerdown', event => { if (!rules.hidden && !rules.contains(event.target) && !help.contains(event.target)) setRules(false); }, { signal });
        root.addEventListener('keydown', event => { if (event.key === 'Escape' && !rules.hidden) { setRules(false); help.focus(); } }, { signal });
        document.addEventListener('visibilitychange', () => { if (document.hidden) silence(ctx); else if (!ctx.busy && !ctx.dialog) refresh(ctx, { quiet: true }); }, { signal });
        window.addEventListener('resize', () => measure(ctx), { signal });
        ctx.layoutObserver = new ResizeObserver(() => measure(ctx)); ctx.layoutObserver.observe(root);
        ctx.frame = requestAnimationFrame(() => measure(ctx));

        ctx.fx = createRenderer(ctx, canvas, altar);
        render(ctx);
        refresh(ctx, { quiet: true });
    }
    function unmount() {
        if (!active) return;
        const ctx = active; active = null; ctx.disposed = true;
        closeDialog(ctx);
        ctx.timers.forEach(clearTimeout); ctx.timers.clear(); cancelAnimationFrame(ctx.frame);
        ctx.abort.abort(); ctx.layoutObserver?.disconnect(); ctx.fx?.destroy(); ctx.fx = null;
        silence(ctx); Object.values(ctx.audio).forEach(audio => { audio.removeAttribute('src'); audio.load(); }); ctx.audio = {};
        ctx.root.classList.remove('orb-fusion-root', 'is-locked', 'is-ready', 'is-charging', 'is-release');
        ['--rc', '--of-top', '--of-dock'].forEach(name => ctx.root.style.removeProperty(name));
        ctx.root.replaceChildren(); delete ctx.root.dataset.gl;
    }

    // ---------- WebGL 의식 렌더러 ----------
    const VERTEX = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
    const FRAGMENT = `precision highp float;
uniform vec2 C;uniform float T,CH,BU,RS,RD,U,SR;
uniform vec3 S0,S1,S2,K0,K1,K2,RC;
const float TAU=6.2831853;
float h(float n){return fract(sin(n*12.9898)*43758.5453);}
float h2(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float nz(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h2(i),h2(i+vec2(1.,0.)),f.x),mix(h2(i+vec2(0.,1.)),h2(i+vec2(1.,1.)),f.x),f.y);}
float ln(float x,float w){return exp(-x*x/(w*w));}
float sg(vec2 p,vec2 a,vec2 b,out float t){vec2 pa=p-a,ba=b-a;t=clamp(dot(pa,ba)/max(dot(ba,ba),1e-5),0.,1.);return length(pa-ba*t);}
float hole(vec2 p){return smoothstep(SR*.92,SR*1.3,length(p-S0.xy))*smoothstep(SR*.92,SR*1.3,length(p-S1.xy))*smoothstep(SR*.92,SR*1.3,length(p-S2.xy));}
vec3 trail(vec2 p,vec3 s,vec3 k,float px,float m){
 if(s.z<.01)return vec3(0.);
 float t;float d=sg(p,s.xy,vec2(0.),t);
 float flow=pow(.5+.5*sin(t*20.-T*(3.5+CH*16.)),3.);
 float core=ln(d,.005+px)*(.3+.7*flow);
 float glow=exp(-d*(24.-CH*10.))*(.18+.3*flow);
 return k*(core*1.2+glow*.6)*s.z*m*smoothstep(.12,.3,length(p))*(.55+CH*1.8);
}
vec3 halo(vec2 p,vec3 s,vec3 k,vec3 ae,float px){
 float d=length(p-s.xy);
 vec3 c=k*(ln(d-SR*1.06,.008+px)*.9+exp(-max(d-SR,0.)*12.)*.22)*s.z*(1.+CH*1.4);
 c+=ae*ln(d-SR*1.06,.005+px)*.16*(1.-s.z);
 return c*(.85+.15*sin(T*1.7+s.x*5.));
}
void main(){
 vec2 p=(gl_FragCoord.xy-C)/U;float px=1./U;float r=length(p);float a=atan(p.y,p.x);
 vec3 ae=vec3(.56,.91,1.),vi=vec3(.64,.55,1.),go=vec3(1.,.85,.54);
 vec3 tint=mix(ae,RC,RS*.75);
 float sp=T*(.035+CH*.8);
 vec3 c=vec3(0.);
 float mist=nz(p*2.1+vec2(T*.05,-T*.03))*.6+nz(p*4.6-vec2(T*.04,T*.06))*.4;
 c+=vi*pow(mist,2.6)*exp(-r*1.05)*.26;
 c+=tint*exp(-r*2.2)*.05;
 c+=tint*(ln(r-1.,.0035+px)*.5+ln(r-1.,.035)*.1)*(1.+CH*2.2);
 float ra=(a+sp)/TAU*72.;
 float dash=step(.42,h(mod(floor(ra),72.)))*smoothstep(.1,.25,fract(ra))*(1.-smoothstep(.75,.9,fract(ra)));
 c+=ae*(1.-smoothstep(0.,.012+px,abs(r-.88)))*dash*.22*(1.+CH*2.5);
 float rb=(a-sp*1.7)/TAU*36.;
 c+=vi*(1.-smoothstep(0.,.006+px,abs(r-1.15)))*(.25+.2*step(.5,fract(rb)))*(1.+CH);
 c+=go*ln(r-.36,.003+px)*.32*(1.+CH*1.5);
 float tk=abs(fract((a+sp*2.)/TAU*48.)-.5);
 c+=go*(1.-smoothstep(0.,.08,tk))*step(.36,r)*step(r,.4)*.25*(1.+CH*2.);
 float ca=T*(.5+CH*3.2);
 float da=mod(a-ca+3.14159265,TAU)-3.14159265;
 float comet=exp(-da*da*500.)*1.8+step(da,0.)*exp(da*2.6)*.55;
 c+=mix(ae,go,.35)*ln(r-1.,.012+px)*comet;
 float da2=mod(a+ca*.7+3.14159265,TAU)-3.14159265;
 c+=vi*ln(r-1.15,.01+px)*(exp(-da2*da2*400.)*1.2+step(0.,da2)*exp(-da2*3.)*.35);
 float m=hole(p);
 c+=halo(p,S0,K0,ae,px)+halo(p,S1,K1,ae,px)+halo(p,S2,K2,ae,px);
 float t;
 float e=min(min(sg(p,S0.xy,S1.xy,t),sg(p,S1.xy,S2.xy,t)),sg(p,S2.xy,S0.xy,t));
 float ef=.5+.5*sin(T*2.+a*3.);
 c+=tint*(ln(e,.004+px)*.55+exp(-e*28.)*.12)*RD*m*(.7+.3*ef)*(1.+CH*2.);
 c+=trail(p,S0,K0,px,m)+trail(p,S1,K1,px,m)+trail(p,S2,K2,px,m);
 for(int i=0;i<40;i++){
  float f=float(i);float s1=h(f+1.),s2=h(f+7.3),s3=h(f+13.1);
  float r0=.22+s1*1.2;float dir=s3>.5?1.:-1.;
  float inw=CH*fract(s2+T*(.22+.3*s1));
  float rr=r0*(1.-inw*.94);
  float an=s2*TAU+dir*T*(.07+.09*s1)+inw*4.*dir;
  vec2 q=vec2(cos(an),sin(an))*rr+vec2(0.,sin(T*.35+f)*.025);
  float an2=an-dir*(.04+CH*.32);
  vec2 q2=vec2(cos(an2),sin(an2))*(rr+CH*.05)+vec2(0.,sin(T*.35+f)*.025);
  float tt;float d=sg(p,q,q2,tt);
  float tw=.55+.45*sin(T*2.3+f*3.7);
  vec3 pc=mix(mix(ae,vi,s3),RC,RS*.6);
  c+=pc*(ln(d,.0045+px*1.4)*(1.-tt*.75)*.95+exp(-d*55.)*.07)*tw*(.45+CH*1.6);
 }
 c+=mix(ae,vec3(1.),.45)*exp(-r*r/(.003+CH*.028))*CH*2.4;
 c+=tint*exp(-r*(9.-CH*5.))*CH*.65;
 if(BU>0.){
  float b=BU;
  float fl=exp(-r*r/(.008+b*.22))*pow(1.-b,1.5)*4.2;
  float sw=ln(r-b*2.3,.025+b*.09)*pow(1.-b,1.3)*1.7;
  float sw2=ln(r-b*1.5,.015+b*.05)*pow(1.-b,2.)*.9;
  vec2 dirv=vec2(cos(a),sin(a));
  float ry=pow(nz(dirv*3.2+vec2(T*.9,0.)),4.)*exp(-r*(1.1+b))*(1.-b)*2.6*smoothstep(0.,.12,b);
  vec3 bc=mix(vec3(1.),RC,.3+b*.5);
  c+=bc*(fl+sw+ry)+go*sw2;
 }
 c+=RC*RS*(exp(-r*4.2)*.55*(.82+.18*sin(T*1.5))+ln(r-.44,.025)*.22+ln(r-1.,.02)*.12);
 c=1.-exp(-c*1.15);
 gl_FragColor=vec4(c,clamp(max(c.r,max(c.g,c.b)),0.,1.));
}`;

    function createRenderer(ctx, canvas, altar) {
        const root = ctx.root, reduced = ctx.reduced, abort = new AbortController(), signal = abort.signal;
        const state = {
            charge: 0, chargeOn: false, chargeAt: 0, burst: -1, burstAt: 0, result: 0, resultTarget: 0, resultColor: AETHER.slice(),
            fill: [0, 0, 0], fillTarget: [0, 0, 0], colors: [AETHER.slice(), AETHER.slice(), AETHER.slice()], ready: 0,
            geo: null
        };
        let gl = null, program = null, buffer = null, loc = {}, frame = 0, last = 0, previous = 0, destroyed = false, visible = true;

        function disposeGL() {
            if (gl && !gl.isContextLost()) { if (buffer) gl.deleteBuffer(buffer); if (program) gl.deleteProgram(program); }
            buffer = program = null;
        }
        function init() {
            try {
                gl = canvas.getContext('webgl', { alpha: true, antialias: false, premultipliedAlpha: true, depth: false, stencil: false, powerPreference: 'high-performance' });
                if (!gl) throw new Error('webgl');
                const shader = (type, source) => {
                    const result = gl.createShader(type); gl.shaderSource(result, source); gl.compileShader(result);
                    if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) { gl.deleteShader(result); throw new Error('shader'); }
                    return result;
                };
                let fragment = FRAGMENT;
                const precision = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
                if (!precision || precision.precision === 0) fragment = fragment.replace('precision highp float;', 'precision mediump float;');
                const v = shader(gl.VERTEX_SHADER, VERTEX), f = shader(gl.FRAGMENT_SHADER, fragment);
                program = gl.createProgram(); gl.attachShader(program, v); gl.attachShader(program, f); gl.linkProgram(program); gl.deleteShader(v); gl.deleteShader(f);
                if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('program');
                gl.useProgram(program);
                buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
                gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
                const position = gl.getAttribLocation(program, 'p'); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
                loc = {};
                ['C', 'T', 'CH', 'BU', 'RS', 'RD', 'U', 'SR', 'S0', 'S1', 'S2', 'K0', 'K1', 'K2', 'RC'].forEach(name => { loc[name] = gl.getUniformLocation(program, name); });
                gl.clearColor(0, 0, 0, 0);
                root.dataset.gl = 'on'; resize(); return true;
            } catch {
                disposeGL(); root.dataset.gl = 'off'; return false;
            }
        }
        function resize() {
            const rect = canvas.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            const dpr = Math.min(window.devicePixelRatio || 1, 1.5), scale = Math.min(1, 1400 / Math.max(rect.width * dpr, rect.height * dpr));
            const width = Math.max(1, Math.round(rect.width * dpr * scale)), height = Math.max(1, Math.round(rect.height * dpr * scale));
            if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
            const k = width / rect.width, coreRect = ctx.core.getBoundingClientRect();
            const toCanvas = box => [(box.left + box.width / 2 - rect.left) * k, (rect.bottom - (box.top + box.height / 2)) * k];
            const center = toCanvas(coreRect);
            const sockets = ctx.sockets.map(socket => toCanvas(socket.button.getBoundingClientRect()));
            const unit = Math.max(1, Math.hypot(sockets[0][0] - center[0], sockets[0][1] - center[1]));
            state.geo = { center, unit, socketR: ctx.sockets[0].button.getBoundingClientRect().width * k / 2 / unit, sockets: sockets.map(([x, y]) => [(x - center[0]) / unit, (y - center[1]) / unit]) };
            if (gl && program) gl.viewport(0, 0, width, height);
            request();
        }
        function step(now) {
            const dt = Math.min(.1, previous ? (now - previous) / 1000 : 0); previous = now;
            if (state.chargeOn) state.charge = reduced.matches ? .6 : .92 * (1 - Math.exp(-(now - state.chargeAt) / 650));
            else state.charge *= Math.exp(-dt * 5.5);
            if (state.burstAt) {
                state.burst = (now - state.burstAt) / RELEASE;
                if (state.burst >= 1 || reduced.matches) { state.burst = -1; state.burstAt = 0; }
            }
            const ease = reduced.matches ? 1 : Math.min(1, dt * 5);
            state.result += (state.resultTarget - state.result) * (reduced.matches ? 1 : Math.min(1, dt * 2.6));
            state.fill = state.fill.map((value, index) => value + (state.fillTarget[index] - value) * ease);
            state.ready += ((state.fillTarget.every(Boolean) ? 1 : 0) - state.ready) * ease;
        }
        function draw(now) {
            if (!gl || !program || gl.isContextLost() || !state.geo) return;
            const { center, unit, socketR, sockets } = state.geo;
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.uniform2f(loc.C, center[0], center[1]);
            gl.uniform1f(loc.T, reduced.matches ? 12 : (now / 1000) % 3600);
            gl.uniform1f(loc.CH, state.charge); gl.uniform1f(loc.BU, state.burst); gl.uniform1f(loc.RS, state.result); gl.uniform1f(loc.RD, state.ready);
            gl.uniform1f(loc.U, unit); gl.uniform1f(loc.SR, socketR);
            sockets.forEach(([x, y], index) => { gl.uniform3f(loc['S' + index], x, y, state.fill[index]); gl.uniform3fv(loc['K' + index], state.colors[index]); });
            gl.uniform3fv(loc.RC, state.resultColor);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
        }
        const busy = () => state.chargeOn || state.charge > .01 || state.burstAt || Math.abs(state.result - state.resultTarget) > .01;
        function loop(now) {
            frame = 0;
            if (destroyed || !program || document.hidden || !visible) return;
            if (now - last >= (busy() ? 15 : 32)) { last = now; step(now); draw(now); }
            frame = requestAnimationFrame(loop);
        }
        // 움직임 줄이기: 루프 없이 상태가 바뀔 때만 한 프레임 그린다.
        function request() {
            if (destroyed || !program) return;
            if (reduced.matches) { cancelAnimationFrame(frame); frame = requestAnimationFrame(now => { frame = 0; previous = 0; step(now); draw(now); }); return; }
            if (!frame && !document.hidden && visible) { previous = 0; frame = requestAnimationFrame(loop); }
        }
        canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); cancelAnimationFrame(frame); frame = 0; program = buffer = null; root.dataset.gl = 'off'; }, { signal });
        canvas.addEventListener('webglcontextrestored', () => { if (!destroyed && init()) request(); }, { signal });
        document.addEventListener('visibilitychange', request, { signal });
        reduced.addEventListener('change', () => { cancelAnimationFrame(frame); frame = 0; request(); }, { signal });
        const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(altar);
        const intersection = new IntersectionObserver(entries => { visible = entries.some(entry => entry.isIntersecting); request(); });
        intersection.observe(canvas);
        init();

        return {
            setSockets(orbs) {
                orbs.forEach((orb, index) => {
                    state.fillTarget[index] = orb ? 1 : 0;
                    if (!orb) return;
                    const key = orb.imageUrl || orb.name;
                    if (state.colors[index].key === key) return;
                    const color = hslRgb(hue(orb.name), .65, .66); color.key = key; state.colors[index] = color;
                    sampleColor(orb).then(rgb => { if (state.colors[index].key === key) { const next = rgb.slice(); next.key = key; state.colors[index] = next; request(); } });
                });
                request();
            },
            charge(on) { state.chargeOn = on; if (on) state.chargeAt = performance.now(); request(); },
            release(color) {
                state.chargeOn = false; state.resultColor = color.slice(); state.resultTarget = 1; state.fillTarget = [0, 0, 0];
                if (!reduced.matches) { state.burstAt = performance.now(); state.burst = 0; } else state.charge = 0;
                request();
            },
            clearResult() { state.resultTarget = 0; request(); },
            destroy() {
                destroyed = true; cancelAnimationFrame(frame); abort.abort(); resizeObserver.disconnect(); intersection.disconnect();
                disposeGL(); gl?.getExtension('WEBGL_lose_context')?.loseContext(); gl = null;
            }
        };
    }

    window.OrbFusionUI = { mount, unmount };
})();
