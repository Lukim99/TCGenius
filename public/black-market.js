/* 암시장: 실제 게임 데이터 위에 WebGL 분위기와 접근 가능한 거래 조작을 겹친다. */
(() => {
    'use strict';
    const ASSETS = '/static/assets/black-market/';
    const LABEL = { garnet: '가넷', gold: '골드' };
    const CURRENCY_IMAGES = Object.fromEntries(Object.entries(LABEL).map(([key, name]) => [key, '/item-image?dir=' + encodeURIComponent('화폐') + '&file=' + encodeURIComponent(name + '.png')]));
    const SECTORS = ['card-garnet', 'card-gold', 'item-garnet', 'item-gold'];
    const number = value => Number(value || 0).toLocaleString('ko-KR');
    let active;
    function node(tag, className, text) {
        const result = document.createElement(tag);
        if (className) result.className = className;
        if (text != null) result.textContent = text;
        return result;
    }
    function picture(url, className, alt = '') {
        const image = node('img', className); image.src = url; image.alt = alt; image.draggable = false;
        image.addEventListener('error', () => { image.hidden = true; }, { once: true });
        if (['bm-item-image', 'bm-currency-image'].includes(className)) image.addEventListener('load', () => fitIcon(image), { once: true });
        return image;
    }
    // 기존 원본 파일을 유지하면서 투명 여백이 큰 아이콘도 진열대에서 같은 크기로 표시한다.
    function fitIcon(image) {
        try {
            const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
            const context = canvas.getContext('2d', { willReadFrequently: true });
            const scale = Math.min(128 / image.naturalWidth, 128 / image.naturalHeight), width = image.naturalWidth * scale, height = image.naturalHeight * scale;
            context.drawImage(image, (128 - width) / 2, (128 - height) / 2, width, height);
            const pixels = context.getImageData(0, 0, 128, 128).data; let left = 128, top = 128, right = -1, bottom = -1;
            for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) if (pixels[(y * 128 + x) * 4 + 3] > 28) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
            if (right < left) return;
            const zoom = Math.min(4, 112 / Math.max(right - left + 1, bottom - top + 1));
            image.style.transform = `scale(${zoom}) translate(${(64 - (left + right + 1) / 2) / 128 * 100}%, ${(64 - (top + bottom + 1) / 2) / 128 * 100}%)`;
        } catch { /* 읽을 수 없는 외부 이미지도 원래 비율로 표시한다. */ }
    }
    function currencyArt(currency) {
        const wrap = node('span', 'bm-currency-art'); wrap.setAttribute('aria-hidden', 'true'); wrap.append(picture(CURRENCY_IMAGES[currency], 'bm-currency-image')); return wrap;
    }
    function button(className, text, click) {
        const result = node('button', className, text); result.type = 'button'; result.addEventListener('click', click); return result;
    }
    function toolIcon(target, name, label) {
        const paths = { sound: 'M11 5 6 9H3v6h3l5 4V5m4 3a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14', muted: 'M11 5 6 9H3v6h3l5 4V5m5 4 5 6m0-6-5 6', refresh: 'M20 7v5h-5M4 17v-5h5M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3A7 7 0 0 0 18 17', mail: 'M3 5h18v14H3V5m0 1 9 7 9-7' };
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), path = document.createElementNS(svg.namespaceURI, 'path');
        svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.6'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
        path.setAttribute('d', paths[name]); svg.append(path); target.replaceChildren(svg); target.setAttribute('aria-label', label); target.title = label;
    }
    function notice(ctx, message, error = false) {
        ctx.notice.textContent = message; ctx.notice.classList.toggle('is-error', error);
    }
    function play(ctx, name) {
        if (!ctx.sound || ctx.disposed || document.hidden) return;
        const audio = ctx.audio[name] ||= new Audio(ASSETS + name + '.ogg');
        audio.volume = name === 'click' ? .16 : .28; audio.currentTime = 0;
        audio.play().catch(() => {});
    }
    function silence(ctx) { Object.values(ctx.audio).forEach(audio => { audio.pause(); audio.currentTime = 0; }); }
    const closed = ctx => !ctx.data || ctx.data.status !== 'open' || Date.now() + ctx.offset >= ctx.data.closesAt;
    function updateControls(ctx) {
        const disabled = closed(ctx) || ctx.busy || ctx.uncertain;
        ctx.root.classList.toggle('is-settling', !!ctx.data && closed(ctx));
        ctx.lots.forEach(view => {
            view.input.disabled = disabled; view.submit.disabled = disabled; view.cancel.disabled = disabled;
            view.cancel.hidden = !view.lot.myBid;
            view.submit.textContent = closed(ctx) ? '입찰 마감' : view.lot.myBid ? '금액 변경' : '입찰하기';
            view.input.title = '최대 ' + number((ctx.data?.balances[view.lot.currency] || 0) + (view.lot.myBid?.amount || 0)) + ' ' + LABEL[view.lot.currency];
        });
    }
    function tick(ctx) {
        if (!ctx.data || ctx.disposed) return;
        const isClosed = closed(ctx), target = isClosed ? ctx.data.nextDayAt : ctx.data.closesAt;
        const seconds = Math.max(0, Math.ceil((target - Date.now() - ctx.offset) / 1000));
        ctx.countdown.textContent = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(n => String(n).padStart(2, '0')).join(':');
        ctx.status.textContent = isClosed ? '정산 중' : '비공개 입찰';
        ctx.clockNote.textContent = isClosed ? '다음 개장까지' : '23:50 마감 · 한국 시간';
        updateControls(ctx);
        const boundary = ctx.data.date + (seconds === 0 ? ':next' : isClosed ? ':closed' : ':open');
        if (ctx.boundary && ctx.boundary !== boundary && !ctx.busy) refresh(ctx);
        ctx.boundary = boundary;
    }
    function art(lot, small = false) {
        const wrap = node('div', small ? 'bm-result-art' : 'bm-art');
        const display = lot.display || {}, url = display.imageUrl || display.iconUrl;
        if (url) wrap.append(picture(url, lot.kind === 'card' ? 'bm-card-image' : 'bm-item-image', display.name));
        if (!small && lot.count > 1) wrap.append(node('span', 'bm-quantity', '×' + number(lot.count)));
        return wrap;
    }
    function makeLot(ctx, lot) {
        const root = node('article', 'bm-lot bm-' + lot.kind + ' bm-' + lot.currency);
        root.dataset.sector = lot.sector;
        const top = node('div', 'bm-lot-top');
        const currencyLabel = node('span', 'bm-currency-label'); currencyLabel.append(currencyArt(lot.currency), node('span', '', LABEL[lot.currency] + ' 입찰')); top.append(currencyLabel);
        const display = node('div', 'bm-display'); display.append(art(lot), node('div', 'bm-pedestal'));
        const title = node('div', 'bm-item-title'); title.append(node('h4', 'bm-item-name', lot.display.name), node('p', 'bm-item-sub', lot.display.sub));
        const mine = node('div', 'bm-my-bid'), amount = node('strong');
        mine.append(node('span', '', '내 보관금'), amount);
        const form = node('form', 'bm-bid-form'), label = node('label', 'bm-input-label', '입찰 금액');
        const input = node('input', 'bm-amount'); input.type = 'text'; input.inputMode = 'numeric'; input.autocomplete = 'off'; input.maxLength = 16;
        input.id = 'bm-amount-' + lot.sector; input.placeholder = '금액 입력'; label.htmlFor = input.id;
        input.setAttribute('aria-label', lot.display.name + ' ' + LABEL[lot.currency] + ' 입찰 금액');
        input.addEventListener('input', () => input.setCustomValidity(''));
        const inputWrap = node('div', 'bm-input-wrap'), unit = node('span', 'bm-unit'); unit.append(currencyArt(lot.currency), node('span', '', LABEL[lot.currency])); inputWrap.append(input, unit);
        const submit = node('button', 'bm-bid-button', '입찰하기'); submit.type = 'submit';
        const view = { root, lot, input, amount, submit };
        const cancel = button('bm-cancel-button', '취소', () => confirmBid(ctx, view, 0)); view.cancel = cancel;
        cancel.setAttribute('aria-label', lot.display.name + ' 입찰 취소');
        const actions = node('div', 'bm-actions'); actions.append(submit, cancel); form.append(label, inputWrap, actions);
        form.addEventListener('submit', event => {
            event.preventDefault();
            const raw = input.value.trim(), value = Number(raw), max = Number(ctx.data.balances[view.lot.currency]) + (view.lot.myBid?.amount || 0);
            if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < 1 || value > max) {
                input.setCustomValidity('보유 재화와 현재 보관금 이내의 양의 정수를 입력해주세요.'); input.reportValidity(); return;
            }
            confirmBid(ctx, view, value);
        });
        root.append(top, display, title, mine, form);
        return view;
    }
    function renderResults(ctx, previous) {
        const key = JSON.stringify(previous);
        if (ctx.previousKey === key) return;
        ctx.previousKey = key; ctx.resultGrid.replaceChildren(); ctx.resultDate.textContent = previous?.date || '';
        if (!previous) { ctx.resultGrid.append(node('p', 'bm-empty', '아직 낙찰 결과가 없습니다.')); return; }
        for (const sector of SECTORS) {
            const lot = previous.lots.find(entry => entry.sector === sector); if (!lot) continue;
            const entry = node('article', 'bm-result bm-' + lot.currency), info = node('div', 'bm-result-info');
            info.append(node('span', 'bm-result-sector', (lot.kind === 'card' ? '카드' : '아이템') + ' · ' + LABEL[lot.currency]),
                node('strong', 'bm-result-name', lot.display.name),
                node('span', 'bm-result-winner', lot.winner ? lot.winner.name + ' 낙찰' : '입찰 없이 종료'),
                node('span', 'bm-result-price'));
            info.lastChild.append(currencyArt(lot.currency), node('span', '', lot.winner ? number(lot.winner.amount) + ' ' + LABEL[lot.currency] : '—'));
            entry.append(art(lot, true), info); ctx.resultGrid.append(entry);
        }
    }
    function apply(ctx, data) {
        if (ctx.disposed) return;
        ctx.data = data; ctx.offset = data.serverNow - Date.now(); ctx.uncertain = false;
        ctx.onBalances?.(data.balances);
        Object.entries(ctx.balances).forEach(([currency, value]) => { value.textContent = number(data.balances[currency]); });
        data.lots.forEach(lot => {
            let view = ctx.lots.get(lot.sector);
            const replaced = !view || view.lot.lotId !== lot.lotId;
            if (replaced) {
                const next = makeLot(ctx, lot);
                if (view) view.root.replaceWith(next.root); else ctx.groups[lot.kind].append(next.root);
                view = next; ctx.lots.set(lot.sector, view);
            }
            if (replaced || (view.lot.myBid?.version || null) !== (lot.myBid?.version || null)) view.input.value = lot.myBid ? String(lot.myBid.amount) : '';
            view.lot = lot; view.amount.textContent = lot.myBid ? number(lot.myBid.amount) + ' ' + LABEL[lot.currency] : '미입찰';
        });
        if (ctx.dialog && !sameContract(ctx, ctx.dialog.contract)) { closeDialog(ctx); notice(ctx, '매물 또는 내 입찰이 변경되었습니다. 현재 내역을 확인해주세요.'); }
        renderResults(ctx, data.previous); tick(ctx);
    }
    async function refresh(ctx, force = false) {
        if (ctx.disposed || ctx.busy && !force) return;
        if (ctx.fetching) return ctx.fetching;
        ctx.refreshButton.disabled = true;
        ctx.fetching = (async () => {
            try { const data = await ctx.request('/api/black-market'); apply(ctx, data); return true; }
            catch (error) { if (!ctx.disposed) notice(ctx, error.message + ' 새로고침으로 다시 확인해주세요.', true); return false; }
            finally { ctx.fetching = null; if (!ctx.disposed) ctx.refreshButton.disabled = false; }
        })();
        return ctx.fetching;
    }
    function sameContract(ctx, contract) {
        const lot = ctx.lots.get(contract.sector)?.lot;
        return ctx.data?.date === contract.date && lot?.lotId === contract.lotId && (lot.myBid?.version || null) === contract.bidVersion && !closed(ctx);
    }
    function closeDialog(ctx) {
        if (!ctx.dialog) return;
        const { overlay, focus } = ctx.dialog; overlay.remove(); ctx.dialog = null; ctx.scene.inert = false;
        if (focus?.isConnected) focus.focus({ preventScroll: true });
    }
    function confirmBid(ctx, view, amount) {
        if (closed(ctx) || ctx.busy || ctx.uncertain || ctx.dialog) return;
        const lot = view.lot, current = lot.myBid?.amount || 0;
        if (amount === current) { notice(ctx, '현재 보관금과 같은 금액입니다. 입찰 순서는 유지됩니다.'); return; }
        play(ctx, 'click');
        const contract = { date: ctx.data.date, sector: lot.sector, lotId: lot.lotId, amount, bidVersion: lot.myBid?.version || null };
        const overlay = node('div', 'bm-overlay'), dialog = node('section', 'bm-dialog');
        dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', 'bm-confirm-title');
        const heading = node('h3', 'bm-dialog-title', amount ? '입찰 확인' : '입찰 취소'); heading.id = 'bm-confirm-title';
        dialog.append(picture(ASSETS + 'seal.webp', 'bm-stamp'), heading, node('p', 'bm-dialog-item', lot.display.name + ' · ' + lot.display.sub));
        const detail = node('dl', 'bm-contract'), delta = amount - current;
        [['현재 보관금', current], ['변경 후 입찰금', amount], [delta >= 0 ? '추가로 맡길 금액' : '즉시 돌려받을 금액', Math.abs(delta)], ['변경 후 보유 재화', ctx.data.balances[lot.currency] - delta]].forEach(([label, value]) => {
            const row = node('div'); row.append(node('dt', '', label), node('dd', '', number(value) + ' ' + LABEL[lot.currency])); detail.append(row);
        });
        dialog.append(detail, node('p', 'bm-dialog-note', amount ? '입찰금은 즉시 보관됩니다. 유찰 시 전액 반환되며, 동액은 해당 금액을 먼저 입찰한 사람이 낙찰받습니다.' : '보관금 전액을 돌려받습니다. 다시 입찰하면 새로운 입찰 순서가 적용됩니다.'));
        const back = button('bm-back-button', '돌아가기', () => { if (!ctx.busy) closeDialog(ctx); });
        const confirm = button('bm-confirm-button', amount ? '입찰 확정' : '취소하고 반환', async () => {
            if (ctx.busy) return;
            ctx.busy = true; confirm.disabled = true; back.disabled = true; updateControls(ctx);
            if (ctx.fetching) await ctx.fetching;
            if (ctx.disposed) return;
            if (!sameContract(ctx, contract)) { ctx.busy = false; closeDialog(ctx); updateControls(ctx); notice(ctx, '입찰 내역이 변경되었거나 마감되었습니다. 다시 확인해주세요.', true); return; }
            try {
                const data = await ctx.request('/api/black-market/bid', contract);
                if (ctx.disposed) return;
                closeDialog(ctx); apply(ctx, data);
                notice(ctx, amount ? '입찰했습니다.' : '입찰을 취소하고 보관금을 돌려받았습니다.');
                play(ctx, amount ? 'seal' : 'cancel');
                const timer = setTimeout(() => { ctx.timeouts.delete(timer); play(ctx, 'coins'); }, 180); ctx.timeouts.add(timer);
                view.root.classList.remove('bm-flourish'); void view.root.offsetWidth; view.root.classList.add('bm-flourish');
            } catch (error) {
                if (ctx.disposed) return;
                closeDialog(ctx); ctx.uncertain = true;
                await refresh(ctx, true);
                notice(ctx, error.message + (ctx.uncertain ? ' 새로고침 후 현재 보관금을 확인해주세요.' : ' 현재 보관금을 다시 확인했습니다.'), true);
            } finally { ctx.busy = false; if (!ctx.disposed) updateControls(ctx); }
        });
        const actions = node('div', 'bm-dialog-actions'); actions.append(back, confirm); dialog.append(actions); overlay.append(dialog);
        ctx.dialog = { overlay, contract, focus: document.activeElement }; ctx.scene.inert = true; ctx.root.append(overlay); back.focus();
        overlay.addEventListener('click', event => { if (event.target === overlay && !ctx.busy) closeDialog(ctx); });
        overlay.addEventListener('keydown', event => {
            if (event.key === 'Escape' && !ctx.busy) { event.preventDefault(); closeDialog(ctx); }
            if (event.key === 'Tab') {
                const buttons = [...dialog.querySelectorAll('button:not(:disabled)')]; if (!buttons.length) { event.preventDefault(); return; }
                if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1).focus(); }
                else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0].focus(); }
            }
        });
    }
    function sectionHeading(title) {
        const heading = node('div', 'bm-section-heading'); heading.append(node('h3', '', title)); return heading;
    }
    function mount(root, options) {
        unmount();
        const ctx = active = { root, ...options, disposed: false, offset: 0, lots: new Map(), groups: {}, balances: {}, audio: {}, timeouts: new Set(), abort: new AbortController() };
        try { ctx.sound = localStorage.getItem('blackMarketSound') !== 'off'; } catch { ctx.sound = true; }
        root.classList.add('bm-root'); root.replaceChildren();
        const canvas = node('canvas', 'bm-atmosphere'); canvas.setAttribute('aria-hidden', 'true');
        const scene = ctx.scene = node('div', 'bm-scene'), header = node('header', 'bm-header'), brand = node('div', 'bm-brand'), brandText = node('div');
        brandText.append(node('h2', 'bm-title', '암시장')); brand.append(picture(ASSETS + 'seal.webp', 'bm-emblem'), brandText);
        const clock = node('div', 'bm-clock'); ctx.status = node('span', 'bm-status', '경매장에 입장하는 중'); ctx.countdown = node('strong', 'bm-countdown', '--:--:--'); ctx.clockNote = node('span', 'bm-clock-note', '한국 표준시 · KST'); clock.append(ctx.status, ctx.countdown, ctx.clockNote);
        const tools = node('div', 'bm-tools'), sound = button('bm-icon-button', '', () => {
            ctx.sound = !ctx.sound; try { localStorage.setItem('blackMarketSound', ctx.sound ? 'on' : 'off'); } catch {}
            updateSound(); if (ctx.sound) play(ctx, 'click'); else silence(ctx);
        });
        const updateSound = () => { toolIcon(sound, ctx.sound ? 'sound' : 'muted', ctx.sound ? '효과음 끄기' : '효과음 켜기'); sound.setAttribute('aria-pressed', String(ctx.sound)); }; updateSound();
        ctx.refreshButton = button('bm-icon-button', '새로고침', () => { play(ctx, 'click'); refresh(ctx); });
        const mail = button('bm-icon-button', '보상 메일', () => { play(ctx, 'click'); ctx.onMail?.(); });
        toolIcon(ctx.refreshButton, 'refresh', '새로고침'); toolIcon(mail, 'mail', '보상 메일');
        tools.append(sound, ctx.refreshButton, mail); header.append(brand, clock, tools);
        const wallet = node('div', 'bm-wallet');
        for (const currency of ['garnet', 'gold']) { const entry = node('div', 'bm-balance bm-' + currency), icon = node('span', 'bm-currency-icon'); icon.append(currencyArt(currency)); const value = ctx.balances[currency] = node('strong', '', '—'); entry.append(icon, node('span', '', LABEL[currency]), value); wallet.append(entry); }
        ctx.notice = node('div', 'bm-notice'); ctx.notice.setAttribute('role', 'status'); ctx.notice.setAttribute('aria-live', 'polite');
        const market = node('div', 'bm-market');
        for (const kind of ['card', 'item']) { const wing = node('section', 'bm-wing'); ctx.groups[kind] = node('div', 'bm-lots'); wing.append(sectionHeading(kind === 'card' ? '오늘의 카드' : '오늘의 아이템'), ctx.groups[kind]); market.append(wing); }
        const results = node('section', 'bm-results'), resultHeading = sectionHeading('지난 결과'); ctx.resultDate = node('span', 'bm-result-date'); resultHeading.append(ctx.resultDate); ctx.resultGrid = node('div', 'bm-result-grid'); results.append(resultHeading, ctx.resultGrid);
        const rules = node('details', 'bm-rules'), rulesBody = node('div', 'bm-rules-body'); rules.append(node('summary', '', '거래 규칙'), rulesBody);
        ['매일 네 매물에 비공개로 입찰합니다. 다른 사람의 입찰금은 마감 전까지 공개되지 않습니다.', '입찰금은 즉시 보관합니다. 마감 전 금액 변경·취소가 가능하며, 취소·유찰 시 전액 반환합니다.', '최고 금액을 제시한 사람이 낙찰받습니다. 같은 금액이면 해당 금액을 먼저 입찰한 사람이 우선합니다. 금액을 바꾸면 순서도 새로 적용됩니다.', '낙찰자는 본인의 입찰금으로 결제하며 보상은 메일함에서 수령합니다. 매일 23:50부터 자정까지 정산하고 00:00에 새 매물이 등장합니다.'].forEach(text => rulesBody.append(node('p', '', text)));
        scene.append(header, wallet, ctx.notice, market, results, rules);
        root.append(canvas, scene); ctx.atmosphere = atmosphere(canvas, root);
        document.addEventListener('visibilitychange', () => { if (document.hidden) silence(ctx); else { tick(ctx); refresh(ctx); } }, { signal: ctx.abort.signal });
        ctx.timer = setInterval(() => tick(ctx), 1000);
        ctx.poll = setInterval(() => { if (!document.hidden) refresh(ctx); }, 30000);
        refresh(ctx);
    }
    function unmount() {
        if (!active) return; const ctx = active; active = null; ctx.disposed = true;
        closeDialog(ctx); clearInterval(ctx.timer); clearInterval(ctx.poll); ctx.timeouts.forEach(clearTimeout); ctx.abort.abort(); silence(ctx); ctx.atmosphere?.destroy();
        Object.values(ctx.audio).forEach(audio => { audio.removeAttribute('src'); audio.load(); });
    }

    // 실제 WebGL: 투명한 안개, 빛 기둥과 작은 입자를 배경 원화 위에 합성한다.
    function atmosphere(canvas, root) {
        const reduced = matchMedia('(prefers-reduced-motion: reduce)'), abort = new AbortController();
        let gl, program, buffer, frame = 0, destroyed = false, last = 0;
        const vertex = 'attribute vec2 p; varying vec2 uv; void main(){uv=p*.5+.5;gl_Position=vec4(p,0.,1.);}';
        const fragment = `precision mediump float;
            varying vec2 uv; uniform float t; uniform vec2 size;
            float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
            float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
            void main(){vec2 p=uv;float aspect=size.x/max(size.y,1.);vec2 q=p*vec2(aspect,1.);
            float fog=noise(q*4.+vec2(t*.018,-t*.012))*.6+noise(q*8.+vec2(-t*.012,t*.009))*.4;
            fog=pow(fog,3.)*.24*(1.-p.y*.45);
            float beam=pow(max(0.,1.-abs(p.x-.5+sin(p.y*2.+t*.09)*.025)*2.),16.)*.045;
            vec3 color=mix(vec3(.35,.19,.62),vec3(.82,.54,.22),smoothstep(.35,.95,abs(p.x-.5)*2.));
            float dust=0.;for(int i=0;i<24;i++){float f=float(i);vec2 pos=vec2(hash(vec2(f,2.)),fract(hash(vec2(f,7.))+t*(.006+hash(vec2(f,3.))*.006)));pos.x+=sin(t*.12+f)*.018;float d=length((p-pos)*vec2(aspect,1.));dust+=max(0.,1.-d/.0035)*(.3+.35*sin(f+t*.6));}
            float a=clamp(fog+beam+dust*.6,0.,.5);gl_FragColor=vec4(color+vec3(dust*.35),a);}`;
        function disposeGL() { if (gl) { if (buffer) gl.deleteBuffer(buffer); if (program) gl.deleteProgram(program); } buffer = program = null; }
        function init() {
            try {
                gl = canvas.getContext('webgl', { alpha: true, antialias: false, premultipliedAlpha: false, powerPreference: 'low-power' });
                if (!gl) return false;
                const shader = (type, source) => { const result = gl.createShader(type); gl.shaderSource(result, source); gl.compileShader(result); if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) { gl.deleteShader(result); throw new Error('shader'); } return result; };
                const v = shader(gl.VERTEX_SHADER, vertex), f = shader(gl.FRAGMENT_SHADER, fragment);
                program = gl.createProgram(); gl.attachShader(program, v); gl.attachShader(program, f); gl.linkProgram(program); gl.deleteShader(v); gl.deleteShader(f);
                if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('program');
                gl.useProgram(program); buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
                const position = gl.getAttribLocation(program, 'p'); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
                root.dataset.webgl = 'ready'; resize(); return true;
            } catch { disposeGL(); root.dataset.webgl = 'fallback'; return false; }
        }
        function resize() {
            if (!gl || !program) return;
            const dpr = Math.min(devicePixelRatio || 1, 1.25), scale = Math.min(1, 1600 / Math.max(root.clientWidth, root.clientHeight));
            canvas.width = Math.max(1, Math.floor(root.clientWidth * dpr * scale)); canvas.height = Math.max(1, Math.floor(root.clientHeight * dpr * scale));
            gl.viewport(0, 0, canvas.width, canvas.height); draw(performance.now());
        }
        function draw(time) {
            if (!gl || !program || gl.isContextLost()) return;
            gl.uniform1f(gl.getUniformLocation(program, 't'), reduced.matches ? 0 : time / 1000); gl.uniform2f(gl.getUniformLocation(program, 'size'), canvas.width, canvas.height); gl.drawArrays(gl.TRIANGLES, 0, 6);
        }
        function loop(time) { if (destroyed || document.hidden || reduced.matches || !program) return; if (time - last >= 40) { last = time; draw(time); } frame = requestAnimationFrame(loop); }
        function resume() { cancelAnimationFrame(frame); if (!destroyed && !document.hidden && !reduced.matches && program) frame = requestAnimationFrame(loop); else if (!destroyed && program) draw(0); }
        canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); cancelAnimationFrame(frame); program = buffer = null; root.dataset.webgl = 'fallback'; }, { signal: abort.signal });
        canvas.addEventListener('webglcontextrestored', () => { if (!destroyed && init()) resume(); }, { signal: abort.signal });
        document.addEventListener('visibilitychange', resume, { signal: abort.signal }); reduced.addEventListener('change', resume, { signal: abort.signal });
        const observer = new ResizeObserver(resize); observer.observe(root); if (init()) resume(); else root.dataset.webgl = 'fallback';
        return { destroy() { destroyed = true; cancelAnimationFrame(frame); observer.disconnect(); abort.abort(); disposeGL(); gl?.getExtension('WEBGL_lose_context')?.loseContext(); } };
    }
    window.BlackMarketUI = { mount, unmount };
})();
