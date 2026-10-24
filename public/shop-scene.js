/* Game shop: WebGL scene and UI texture, with matching accessible hit targets. */
(function () {
    'use strict';
    const COLORS = { 일반: '#d5b681', 가넷: '#ae87de', 포인트: '#7faee0', 아바타: '#d89db8', 마일리지: '#8bc9be', 패키지: '#dbb569', 출석: '#a3c287', 초월: '#aaa0e9', 레이드: '#d78f70' };
    const VS = 'attribute vec2 p;varying vec2 uv;void main(){uv=p*.5+.5;gl_Position=vec4(p,0.,1.);}';
    const FS = `precision mediump float;
        varying vec2 uv;uniform sampler2D ui;uniform vec2 resolution;uniform vec3 accent;uniform float time;uniform float burst;
        float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        void main(){
            vec2 q=vec2(uv.x*resolution.x/resolution.y,uv.y);
            vec2 center=vec2(resolution.x/resolution.y*.31,.55);
            float light=exp(-length((q-center)*vec2(.8,1.))*2.4);
            vec3 color=mix(vec3(.018,.025,.035),vec3(.048,.063,.080),uv.y)+accent*light*.16;
            color+=accent*exp(-abs(uv.y-.17)*90.)*.05;
            vec2 grid=q*18.;grid.y+=time*.12;
            vec2 cell=floor(grid),local=fract(grid)-.5;
            float seed=hash(cell);
            float dust=smoothstep(.045,0.,length(local))*step(.92,seed)*(.4+.6*sin(time*.7+seed*30.));
            color+=accent*dust*.2;
            float wave=exp(-abs(length(q-center)-burst*1.1)*65.)*(1.-burst)*step(.001,burst);
            color+=accent*wave*.34;
            vec4 ink=texture2D(ui,uv);gl_FragColor=vec4(mix(color,ink.rgb,ink.a),1.);
        }`;
    let current;
    function mount(shell, options) {
        unmount();
        if (options.tab === '암시장') {
            shell.classList.add('shop-market-shell');
            current = { dispose() { shell.classList.remove('shop-market-shell'); } };
            return;
        }
        const body = shell.querySelector('#shopBody'); body.hidden = true; shell.classList.add('shop-game-shell');
        const root = document.createElement('div'); root.className = 'shop-game';
        const canvas = document.createElement('canvas'); canvas.className = 'shop-scene-canvas'; canvas.setAttribute('aria-hidden', 'true');
        const fallback = document.createElement('canvas'); fallback.className = 'shop-game-fallback'; fallback.setAttribute('aria-hidden', 'true');
        const controls = document.createElement('div'); controls.className = 'shop-game-controls'; controls.setAttribute('aria-label', '상점 조작');
        const live = document.createElement('div'); live.className = 'shop-game-live'; live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite');
        root.append(canvas, fallback, controls, live); shell.append(root);
        const ui = document.createElement('canvas'), ctx = ui.getContext('2d'), media = matchMedia('(prefers-reduced-motion: reduce)');
        const s = { data: options.data, tab: options.tab, selected: null, page: 0, perPage: 1, qty: 1, mode: 'browse', material: '', detailPage: 0, detailPages: 1, busy: false, message: '', success: null, hover: '', focus: '' };
        const images = new Map(), buttons = new Map(), iconBounds = new WeakMap();
        let gl, program, buffer, texture, vertex, fragment, uniforms, disposed = false, lost = false, visible = true, dirty = true, reduced = media.matches;
        let width = 0, height = 0, dpr = 1, raf = 0, lastFrame = 0, pulseAt = 0, regions = [];
        const rgb = () => (COLORS[s.tab] || '#a7b7cc').slice(1).match(/../g).map(v => parseInt(v, 16) / 255);
        const notify = text => { live.textContent = text || ''; dirty = true; };
        const invalidate = () => { if (!disposed) { dirty = true; schedule(); } };
        function image(url) {
            if (!url) return null;
            if (!images.has(url)) {
                const img = new Image();
                if (new URL(url, location.href).origin !== location.origin) img.crossOrigin = 'anonymous';
                img.onload = invalidate; img.onerror = invalidate; img.src = url; images.set(url, img);
            }
            const img = images.get(url); return img.complete && img.naturalWidth ? img : null;
        }
        function contained(url, x, y, w, h) {
            const img = image(url); if (!img || w <= 0 || h <= 0) return false;
            const scale = Math.min(w / img.naturalWidth, h / img.naturalHeight), iw = img.naturalWidth * scale, ih = img.naturalHeight * scale;
            ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih); return true;
        }
        // Existing currency/item files have large transparent margins. Normalize display only.
        function icon(url, x, y, w, h) {
            const img = image(url); if (!img) return false;
            if (!iconBounds.has(img)) {
                const probe = document.createElement('canvas'); probe.width = probe.height = 128;
                const p = probe.getContext('2d', { willReadFrequently: true }); p.drawImage(img, 0, 0, 128, 128);
                const pixels = p.getImageData(0, 0, 128, 128).data;
                let left = 128, top = 128, right = -1, bottom = -1;
                for (let yy = 0; yy < 128; yy++) for (let xx = 0; xx < 128; xx++) if (pixels[(yy * 128 + xx) * 4 + 3] > 28) {
                    left = Math.min(left, xx); right = Math.max(right, xx); top = Math.min(top, yy); bottom = Math.max(bottom, yy);
                }
                iconBounds.set(img, right < left ? [0, 0, img.naturalWidth, img.naturalHeight] : [left / 128 * img.naturalWidth, top / 128 * img.naturalHeight, (right - left + 1) / 128 * img.naturalWidth, (bottom - top + 1) / 128 * img.naturalHeight]);
            }
            const [sx, sy, sw, sh] = iconBounds.get(img), scale = Math.min(w / sw, h / sh) * .88;
            ctx.drawImage(img, sx, sy, sw, sh, x + (w - sw * scale) / 2, y + (h - sh * scale) / 2, sw * scale, sh * scale); return true;
        }
        function art(display, x, y, w, h) {
            if (!display) return;
            if (display.frameUrl) contained(display.frameUrl, x, y, w, h);
            const url = display.iconUrl || display.imgUrl;
            if (url) (display.frameUrl ? contained : icon)(url, x, y, w, h);
            else if (display.label) { ctx.save(); ctx.fillStyle = '#c9d6e3'; ctx.font = '700 20px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(display.label, x + w / 2, y + h / 2); ctx.restore(); }
        }
        function currency(goods, x, y, size, price) {
            const url = goods === 'item' ? price?.iconUrl : options.currencyIcons[goods];
            if (!icon(url, x, y, size, size)) { ctx.save(); ctx.fillStyle = '#b8d3e2'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '700 ' + Math.round(size * .6) + 'px sans-serif'; ctx.fillText(goods === 'mileage' ? 'M' : '◇', x + size / 2, y + size / 2); ctx.restore(); }
        }
        function view() {
            let items = s.data.shop[s.tab] || [], materials = [];
            if (s.tab === '레이드') {
                materials = [...new Set(items.map(item => item.materialTab || item.price.name || '레이드 재료'))];
                if (!materials.includes(s.material)) s.material = materials[0] || '';
                items = items.filter(item => (item.materialTab || item.price.name || '레이드 재료') === s.material);
            }
            let item = items.find(item => item.shopId === s.selected);
            if (!item && items.length) { item = items[0]; s.selected = item.shopId; }
            const balance = item ? Number(item.price.goods === 'item' ? item.priceItemCount || 0 : s.data.currencies[item.price.goods] || 0) : 0;
            let max = 999;
            for (const value of Object.values(item?.limitInfo?.remaining || {})) if (typeof value === 'number') max = Math.min(max, value);
            if (item?.price.amount > 0) max = Math.min(max, Math.floor(balance / item.price.amount));
            if (item?.type === '아바타') max = Math.min(max, 1);
            if (!item || item.owned || item.soldOut) max = 0;
            max = Math.max(0, max); s.qty = Math.max(1, Math.min(s.qty, max || 1));
            const limits = Object.entries({ max: '전체', daily: '일일', weekly: '주간', monthly: '월간', global: '선착순' }).filter(([key]) => item?.limitInfo?.limits[key] != null)
                .map(([key, label]) => ({ label, limit: item.limitInfo.limits[key], remaining: Math.max(0, item.limitInfo.remaining[key] || 0) }));
            return { items, item, balance, max, limits, materials };
        }
        function act(action, id) {
            if (disposed || s.busy) return;
            const v = view(); s.message = '';
            switch (action) {
                case 'category':
                    if (id === '암시장') { options.onTab(id); return; }
                    s.tab = id; s.page = 0; s.selected = null; s.qty = 1; s.mode = 'browse'; s.detailPage = 0; options.onCategory?.(id); break;
                case 'categories': s.mode = 'categories'; break;
                case 'product': s.selected = id; s.qty = 1; s.detailPage = 0; if (width < 1200) s.mode = 'detail'; pulseAt = performance.now(); break;
                case 'next': s.page = Math.min(Math.ceil(v.items.length / s.perPage) - 1, s.page + 1); break;
                case 'previous': s.page = Math.max(0, s.page - 1); break;
                case 'qty-plus': s.qty = Math.min(v.max || 1, s.qty + 1); break;
                case 'qty-minus': s.qty = Math.max(1, s.qty - 1); break;
                case 'qty-max': s.qty = Math.max(1, v.max); break;
                case 'buy': if (v.max > 0) s.mode = 'confirm'; break;
                case 'confirm': if (v.max > 0 && s.mode === 'confirm') { buy(v.item); return; } break;
                case 'contents': s.mode = 'contents'; s.detailPage = 0; break;
                case 'content-next': s.detailPage = Math.min(s.detailPages - 1, s.detailPage + 1); break;
                case 'content-previous': s.detailPage = Math.max(0, s.detailPage - 1); break;
                case 'materials': s.mode = 'materials'; break;
                case 'material': s.material = id; s.selected = null; s.page = 0; s.qty = 1; s.mode = 'browse'; break;
                case 'success-close': s.mode = 'browse'; s.success = null; break;
                case 'cancel': s.mode = width < 1200 ? 'detail' : 'browse'; break;
                case 'back': s.mode = ['confirm', 'contents'].includes(s.mode) && width < 1200 ? 'detail' : 'browse'; s.success = null; break;
            }
            shell.dataset.shopCategory = s.tab; notify(action === 'product' ? view().item?.display.name : ''); invalidate();
        }
        async function buy(item) {
            const count = s.qty, tab = s.tab; s.busy = true; notify('구매 중'); invalidate();
            let response;
            try { response = await options.onBuy(item, count, tab); }
            catch (error) { if (!disposed) { s.busy = false; s.mode = width < 1200 ? 'detail' : 'browse'; s.message = error.message; notify(error.message); invalidate(); } return; }
            if (disposed) return;
            s.data = response.data; s.success = { name: item.display.name, count, rewards: response.result.bundleGranted?.length ? response.result.bundleGranted : [{ ...item.display, count }] };
            s.qty = 1; s.mode = 'success'; s.detailPage = 0; pulseAt = performance.now(); s.busy = false; notify('구매 완료. ' + item.display.name + ' ' + count + '개'); invalidate();
            if (response.result.choicePouch || response.result.grantedCards?.some(card => card.type === '각성')) await options.onSpecial?.(response.result);
        }
        function hit(action, id, x, y, w, h, label, disabled = false, pressed = false) {
            if (w > 0 && h > 0) regions.push({ action, id: String(id ?? ''), x, y, w, h, label: String(label || action), disabled: disabled || s.busy, pressed });
        }
        function syncControls() {
            const keys = new Set();
            for (const r of regions) {
                const key = r.action + ':' + r.id; keys.add(key); let button = buttons.get(key);
                if (!button) {
                    const quantity = r.action === 'qty-value';
                    button = document.createElement(quantity ? 'input' : 'button'); button.type = quantity ? 'number' : 'button'; button.dataset.action = r.action; button.dataset.id = r.id;
                    if (r.action === 'category') button.dataset.category = r.id;
                    button.onclick = quantity ? () => button.select() : () => act(r.action, r.id);
                    if (quantity) {
                        button.inputMode = 'numeric'; button.min = '1';
                        button.oninput = () => { s.qty = Math.max(1, Math.min(view().max || 1, Math.floor(Number(button.value)) || 1)); invalidate(); };
                        button.onkeydown = event => { if (event.key === 'Enter' || event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); button.blur(); resize(); } };
                    }
                    button.onpointerenter = () => { s.hover = key; invalidate(); }; button.onpointerleave = () => { s.hover = ''; invalidate(); };
                    button.onfocus = () => { s.focus = key; invalidate(); }; button.onblur = () => { s.focus = ''; invalidate(); };
                    controls.append(button); buttons.set(key, button);
                }
                const geometry = `${r.x},${r.y},${r.w},${r.h}`;
                if (button.dataset.box !== geometry) { button.style.cssText = `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px`; button.dataset.box = geometry; }
                if (button.getAttribute('aria-label') !== r.label) button.setAttribute('aria-label', r.label);
                if (button.disabled !== r.disabled) button.disabled = r.disabled;
                if (r.action === 'qty-value') { button.max = String(view().max || 1); if (button.value !== String(s.qty)) button.value = String(s.qty); }
                else if (button.getAttribute('aria-pressed') !== String(!!r.pressed)) button.setAttribute('aria-pressed', !!r.pressed);
            }
            for (const [key, button] of buttons) if (!keys.has(key)) { button.remove(); buttons.delete(key); }
        }
        function initGl() {
            try {
                gl ||= canvas.getContext('webgl', { alpha: false, depth: false, stencil: false, antialias: false, powerPreference: 'low-power' });
                if (!gl || gl.isContextLost()) return false;
                const shader = (type, code) => { const obj = gl.createShader(type); gl.shaderSource(obj, code); gl.compileShader(obj); if (!gl.getShaderParameter(obj, gl.COMPILE_STATUS)) { gl.deleteShader(obj); throw new Error('shop shader'); } return obj; };
                vertex = shader(gl.VERTEX_SHADER, VS); fragment = shader(gl.FRAGMENT_SHADER, FS);
                program = gl.createProgram(); gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
                if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('shop program');
                gl.useProgram(program); buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
                const loc = gl.getAttribLocation(program, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
                texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
                uniforms = Object.fromEntries(['ui', 'resolution', 'accent', 'time', 'burst'].map(key => [key, gl.getUniformLocation(program, key)]));
                gl.uniform1i(uniforms.ui, 0); allocate(); lost = false; shell.dataset.shopGl = 'ready'; fallback.hidden = true; canvas.hidden = false; return true;
            } catch (_) { releaseGl(); return false; }
        }
        function allocate() {
            if (!gl || !texture || gl.isContextLost() || !ui.width || !ui.height) return;
            gl.bindTexture(gl.TEXTURE_2D, texture); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, ui.width, ui.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        }
        function fallbackMode() { shell.dataset.shopGl = 'fallback'; fallback.hidden = false; canvas.hidden = true; dirty = true; }
        function releaseGl() { if (!gl || gl.isContextLost()) return; if (texture) gl.deleteTexture(texture); if (buffer) gl.deleteBuffer(buffer); if (program) gl.deleteProgram(program); if (vertex) gl.deleteShader(vertex); if (fragment) gl.deleteShader(fragment); texture = buffer = program = vertex = fragment = null; }
        function resize() {
            if (disposed) return;
            const top = shell.getBoundingClientRect().top, bottom = document.querySelector('.bottom-tabs');
            const bottomHeight = bottom && getComputedStyle(bottom).display !== 'none' ? bottom.getBoundingClientRect().height : 0;
            const nextW = Math.round(shell.clientWidth), nextH = Math.max(260, Math.floor((visualViewport?.height || innerHeight) - Math.max(0, top) - bottomHeight));
            if (width === nextW && nextH < height && controls.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
            const ratio = Math.min(devicePixelRatio || 1, 2, Math.sqrt(4000000 / Math.max(1, nextW * nextH)));
            if (width === nextW && height === nextH && dpr === ratio) return;
            width = nextW; height = nextH; dpr = ratio; root.style.height = height + 'px';
            for (const target of [canvas, fallback, ui]) { target.width = Math.round(width * dpr); target.height = Math.round(height * dpr); }
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0); allocate(); invalidate();
        }
        function draw(now) {
            const v = view(); regions = []; ctx.clearRect(0, 0, width, height);
            window.ShopPainter.draw({ ctx, w: width, h: height, t: reduced ? 0 : now / 1000, reduced, s, ...v, art, currency, hit, currencyIcons: options.currencyIcons });
            syncControls();
            if (gl && !lost && program) {
                gl.viewport(0, 0, canvas.width, canvas.height); gl.useProgram(program); gl.bindTexture(gl.TEXTURE_2D, texture);
                gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, ui);
                gl.uniform2f(uniforms.resolution, width, height); gl.uniform3fv(uniforms.accent, rgb()); gl.uniform1f(uniforms.time, reduced ? 0 : now / 1000);
                gl.uniform1f(uniforms.burst, reduced || !pulseAt ? 0 : Math.min(1, (now - pulseAt) / 900)); gl.drawArrays(gl.TRIANGLES, 0, 3);
            } else {
                const f = fallback.getContext('2d'); f.fillStyle = '#0b121a'; f.fillRect(0, 0, fallback.width, fallback.height); f.drawImage(ui, 0, 0);
            }
            dirty = false;
        }
        function schedule() { if (!raf && !disposed && visible && !document.hidden) raf = requestAnimationFrame(tick); }
        function tick(now) { raf = 0; if (disposed || !visible || document.hidden) return; if (dirty || !reduced && now - lastFrame >= 1000 / 30) { draw(now); lastFrame = now; } if (!reduced) schedule(); }
        const motion = () => { reduced = media.matches; invalidate(); };
        const visibility = () => { if (document.hidden) { cancelAnimationFrame(raf); raf = 0; } else invalidate(); };
        const keydown = event => { if (event.key === 'Escape' && !document.querySelector('dialog[open], .msg-modal-bg, .fusion-overlay')) { event.preventDefault(); act('back', ''); } };
        const loss = event => { event.preventDefault(); lost = true; fallbackMode(); invalidate(); };
        const restore = () => { if (!disposed) { if (!initGl()) fallbackMode(); invalidate(); } };
        canvas.addEventListener('webglcontextlost', loss); canvas.addEventListener('webglcontextrestored', restore);
        document.addEventListener('visibilitychange', visibility); document.addEventListener('keydown', keydown); media.addEventListener('change', motion);
        window.addEventListener('resize', resize); visualViewport?.addEventListener('resize', resize);
        const observer = new ResizeObserver(resize); observer.observe(shell);
        const intersection = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; if (visible) invalidate(); else { cancelAnimationFrame(raf); raf = 0; } }); intersection.observe(root);
        shell.dataset.shopCategory = s.tab;
        current = { dispose() {
            disposed = true; cancelAnimationFrame(raf); observer.disconnect(); intersection.disconnect();
            document.removeEventListener('visibilitychange', visibility); document.removeEventListener('keydown', keydown); media.removeEventListener('change', motion);
            window.removeEventListener('resize', resize); visualViewport?.removeEventListener('resize', resize);
            canvas.removeEventListener('webglcontextlost', loss); canvas.removeEventListener('webglcontextrestored', restore);
            for (const img of images.values()) img.onload = img.onerror = null;
            releaseGl(); gl?.getExtension('WEBGL_lose_context')?.loseContext(); root.remove(); body.hidden = false; shell.classList.remove('shop-game-shell'); delete shell.dataset.shopGl; delete shell.dataset.shopCategory;
        } };
        resize(); if (!initGl()) fallbackMode();
        document.fonts?.load('600 16px "Black Market Pretendard"').then(invalidate).catch(() => {}); invalidate();
    }
    function unmount() { current?.dispose(); current = null; }
    window.ShopSceneUI = { mount, unmount };
})();
