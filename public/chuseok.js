const ASSETS = '/static/assets/chuseok-2026/';
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const make = (tag, className, text) => {
    const node = document.createElement(tag);
    node.className = className;
    if (text) node.textContent = text;
    return node;
};
async function request(path = '', method = 'GET') {
    const response = await fetch('/api/event/chuseok' + path, { method, cache: 'no-store', signal: AbortSignal.timeout(12000) });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error || '잠시 후 다시 확인해주세요.'), { status: response.status });
    return data;
}

// 이미지 위에 GPU로 달빛, 금빛 입자와 보상 충격파를 합성한다. 2D 캔버스는 사용하지 않는다.
function moonlight(canvas) {
    const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false, antialias: false });
    if (!gl) return { draw() {}, dispose() {} };
    const shaders = [];
    const shader = (type, source) => {
        const value = gl.createShader(type);
        shaders.push(value); gl.shaderSource(value, source); gl.compileShader(value);
        if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) throw new Error('Moonlight shader failed');
        return value;
    };
    const program = gl.createProgram();
    try {
        gl.attachShader(program, shader(gl.VERTEX_SHADER, 'attribute vec2 p; void main(){gl_Position=vec4(p,0.,1.);}'));
        gl.attachShader(program, shader(gl.FRAGMENT_SHADER, `
            precision mediump float;
            uniform vec2 size, moon;
            uniform float time, burst, radius, quiet;
            float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
            void main(){
                vec2 uv=gl_FragCoord.xy/size;
                vec2 p=(gl_FragCoord.xy-moon)/size.y;
                float r=length(p), a=atan(p.y,p.x), glow=0.;
                float edge=radius/size.y;
                glow+=exp(-abs(r-edge)*70.)*(.14+.035*sin(time*1.3));
                vec2 grid=vec2(28.,28.*size.y/size.x);
                vec2 drift=uv*grid+vec2(time*.025,-time*.07)*(1.-quiet);
                vec2 cell=floor(drift), point=fract(drift)-.5;
                float seed=hash(cell);
                float twinkle=pow(.5+.5*sin(time*(1.+seed)+seed*40.),3.);
                float star=exp(-length(point)*100.)+exp(-abs(point.x)*180.-abs(point.y)*22.)*.2;
                glow+=star*twinkle*step(.72,seed)*.7;
                if(burst>=0. && burst<3.5){
                    float t=burst;
                    glow+=exp(-pow((r-t*.32)*45.,2.))*exp(-t*1.6)*.65;
                    glow+=exp(-r*5.)*exp(-t*2.)*.32;
                    for(int i=0;i<32;i++){
                        float f=float(i), angle=f*2.39996;
                        float speed=.12+fract(f*.618)*.25;
                        vec2 q=vec2(cos(angle),sin(angle))*t*speed;
                        q.y-=t*t*.025;
                        float d=length(p-q);
                        glow+=exp(-d*400.)*max(0.,1.-t/3.2)*.9;
                    }
                    glow+=pow(max(0.,sin(a*11.+time*.15)),18.)*exp(-r*4.)*exp(-t)*.22;
                }
                gl_FragColor=vec4(1.,.78,.40,clamp(glow,0.,.85));
            }`));
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Moonlight program failed');
    } catch (_) {
        shaders.forEach(value => gl.deleteShader(value)); gl.deleteProgram(program);
        return { draw() {}, dispose() {} };
    }
    gl.useProgram(program);
    const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
    const attribute = gl.getAttribLocation(program, 'p');
    gl.enableVertexAttribArray(attribute); gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0);
    const uniforms = Object.fromEntries(['size', 'moon', 'time', 'burst', 'radius', 'quiet'].map(key => [key, gl.getUniformLocation(program, key)]));
    return {
        draw(w, h, x, y, radius, time, burst) {
            if (gl.isContextLost()) return;
            const dpr = Math.min(devicePixelRatio || 1, 1.5);
            if (canvas.width !== Math.round(w*dpr) || canvas.height !== Math.round(h*dpr)) {
                canvas.width = Math.round(w*dpr); canvas.height = Math.round(h*dpr);
                gl.viewport(0, 0, canvas.width, canvas.height);
            }
            gl.uniform2f(uniforms.size, canvas.width, canvas.height);
            gl.uniform2f(uniforms.moon, x*dpr, (h-y)*dpr);
            gl.uniform1f(uniforms.radius, radius*dpr);
            gl.uniform1f(uniforms.time, time); gl.uniform1f(uniforms.burst, burst);
            gl.uniform1f(uniforms.quiet, reduced ? 1 : 0);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
        },
        dispose() {
            gl.deleteBuffer(buffer); shaders.forEach(value => gl.deleteShader(value)); gl.deleteProgram(program);
            gl.getExtension('WEBGL_lose_context')?.loseContext();
        }
    };
}

async function prepare() {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = '/static/chuseok.css';
    const loaded = new Promise((resolve, reject) => { css.onload = resolve; css.onerror = reject; });
    document.head.append(css);
    await Promise.all([loaded, ...['moon.webp', 'greeting.webp', 'reward.webp'].map(async file => {
        const img = new Image(); img.src = ASSETS + file; await img.decode();
    })]);
}

function showEvent(state, onClose) {
    const dialog = make('dialog', 'chuseok');
    dialog.setAttribute('aria-label', '즐거운 추석 보내세요. 추석엔 RPGenius');
    const scene = make('div', 'chuseok-scene');
    const canvas = make('canvas', 'chuseok-light'); canvas.setAttribute('aria-hidden', 'true');
    const date = make('div', 'chuseok-date', '2026. 09. 25');
    const greeting = make('div', 'chuseok-greeting'); greeting.setAttribute('aria-hidden', 'true');
    for (const part of ['first', 'second']) {
        const img = make('img', 'chuseok-lettering ' + part); img.src = ASSETS + 'greeting.webp'; img.alt = '';
        greeting.append(img);
    }
    const moon = make('button', 'chuseok-moon');
    moon.setAttribute('aria-label', '보름달을 눌러 ' + state.reward.name + ' 1개 받기'); moon.disabled = true;
    const hint = make('p', 'chuseok-hint', '보름달을 눌러 추석 선물을 받아보세요');
    const message = make('p', 'chuseok-message'); message.setAttribute('role', 'status');
    const close = make('button', 'chuseok-close', '나중에 받기');
    const reward = make('div', 'chuseok-reward'); reward.hidden = true;
    const art = make('img', 'chuseok-pack'); art.src = ASSETS + 'reward.webp'; art.alt = '';
    reward.append(make('p', 'chuseok-reward-eyebrow', '보름달이 전하는 선물'), art,
        make('h2', 'chuseok-reward-title', state.reward.name), make('p', 'chuseok-reward-detail', '1개를 가방에 담았어요'));
    dialog.append(scene, canvas, date, greeting, moon, hint, message, reward, close);
    document.body.append(dialog);
    const previousFocus = document.activeElement;
    dialog.showModal(); close.focus();
    const effects = moonlight(canvas);
    const audioContext = window.AudioContext || window.webkitAudioContext;
    let audio = null;
    try { if (audioContext) audio = new audioContext(); } catch (_) {}
    const buffers = new Map(); const sources = new Set();
    let gain;
    if (audio) {
        gain = audio.createGain(); gain.gain.value = .3; gain.connect(audio.destination);
        for (const key of ['moonrise', 'reward']) fetch(ASSETS + key + '-v2.mp3')
            .then(response => response.arrayBuffer()).then(data => audio.decodeAudioData(data))
            .then(buffer => buffers.set(key, buffer)).catch(() => {});
    }
    let enabled = false, busy = false, claimed = false, disposed = false, burstAt = -1;
    let frame, revealTimer, readyTimer, lastFrame = 0;
    const start = performance.now();
    const deadline = performance.now() + state.endsAt - state.serverNow;
    function play(key) {
        if (!enabled || !audio || audio.state !== 'running' || !buffers.has(key) || document.hidden) return;
        const source = audio.createBufferSource(); source.buffer = buffers.get(key); source.connect(gain);
        sources.add(source); source.onended = () => sources.delete(source); source.start();
    }
    async function unlock() {
        if (!audio) return;
        try { await audio.resume(); enabled = audio.state === 'running'; } catch (_) {}
    }
    const visibility = () => {
        if (gain) gain.gain.value = document.hidden ? 0 : .3;
    };
    document.addEventListener('visibilitychange', visibility);
    function closeEvent() {
        if (busy) return;
        disposed = true; cancelAnimationFrame(frame); clearTimeout(revealTimer); clearTimeout(readyTimer);
        document.removeEventListener('visibilitychange', visibility);
        sources.forEach(source => source.stop()); if (audio) audio.close().catch(() => {});
        effects.dispose(); dialog.close(); dialog.remove();
        if (previousFocus?.isConnected) previousFocus.focus();
        onClose(claimed);
    }
    close.onclick = closeEvent;
    dialog.addEventListener('keydown', event => event.stopPropagation());
    dialog.addEventListener('cancel', event => { event.preventDefault(); closeEvent(); });
    function draw(time) {
        if (disposed) return;
        if (time-lastFrame < 32) { frame = requestAnimationFrame(draw); return; }
        lastFrame = time;
        const w = dialog.clientWidth, h = dialog.clientHeight;
        const scale = Math.min(Math.max(w/1536, h/1024), w/600, h/950);
        const top = Math.max(0, (h-1024*scale)*.1);
        const shift = h <= 650 && w/h >= 1.3 ? w*.23 : 0;
        const x = w/2-4*scale-shift, y = top+304*scale, radius = 256*scale;
        scene.style.backgroundSize = `${1536*scale}px ${1024*scale}px`;
        scene.style.backgroundPosition = `${(w-1536*scale)/2-shift}px ${top}px`;
        moon.style.cssText = `left:${x-radius}px;top:${y-radius}px;width:${radius*2}px;height:${radius*2}px`;
        const greetingWidth = Math.min(w*.94, h*.65, 840);
        greeting.style.width = greetingWidth + 'px';
        greeting.style.top = Math.max(h*.47, y+radius-greetingWidth*.667*.22+16) + 'px';
        if (!document.hidden) effects.draw(w,h,claimed?w/2:x,claimed?h*.43:y, radius,
            reduced ? 0 : (time-start)/1000, reduced || burstAt < 0 ? -1 : (time-burstAt)/1000);
        if (!busy && !claimed && time >= deadline) {
            moon.disabled = true; hint.textContent = '추석 선물 이벤트가 종료되었습니다'; close.textContent = '닫기';
        }
        frame = requestAnimationFrame(draw);
    }
    frame = requestAnimationFrame(draw);
    readyTimer = setTimeout(() => { if (performance.now() < deadline) moon.disabled = false; }, 3400);
    moon.onclick = async () => {
        if (busy || claimed) return;
        busy = true; moon.disabled = true; close.disabled = true;
        message.textContent = ''; hint.textContent = '달빛 속에서 선물이 깨어납니다';
        dialog.classList.add('gathering');
        // 사용자 클릭 안에서 오디오를 활성화하여 모바일 자동재생 제한도 지킨다.
        await unlock();
        play('moonrise');
        const clickedAt = performance.now();
        try {
            const result = await request('/claim', 'POST');
            if (!result.claimed) throw new Error('수령 기록을 다시 확인해주세요.');
            const reveal = () => {
                claimed = true; busy = false; burstAt = performance.now();
                dialog.classList.remove('gathering'); dialog.classList.add('received');
                reward.hidden = false; moon.hidden = true; hint.hidden = true;
                close.disabled = false; close.textContent = '모험 계속하기'; close.focus();
                message.textContent = result.reward.name + ' 1개를 받았습니다.'; play('reward');
                window.dispatchEvent(new CustomEvent('chuseok:claimed'));
            };
            revealTimer = setTimeout(reveal, Math.max(0, 2200-(performance.now()-clickedAt)));
        } catch (error) {
            busy = false; dialog.classList.remove('gathering'); close.disabled = false;
            message.textContent = error.message;
            moon.disabled = error.status === 410;
            hint.textContent = error.status === 410 ? '이벤트가 종료되었습니다' : '보름달을 다시 눌러 선물을 확인해주세요';
        }
    };
}

async function startEvent() {
    const state = await request();
    if (!state.active || state.claimed) return;
    const launcher = make('button', 'chuseok-launcher', '추석 선물 받기');
    let prepared = false, opening = false;
    const end = performance.now() + state.endsAt - state.serverNow;
    const open = async () => {
        if (opening) return;
        opening = true; launcher.disabled = true;
        try {
            if (!prepared) { await prepare(); prepared = true; }
            const entry = await request('/enter', 'POST');
            launcher.remove();
            if (entry.claimed) return;
            showEvent(entry, claimed => {
                opening = false; launcher.disabled = false;
                if (!claimed && performance.now() < end) document.body.append(launcher);
            });
        } catch (error) {
            opening = false; launcher.disabled = false;
            if (error.status === 410) launcher.remove();
            else { launcher.textContent = '추석 선물 다시 열기'; launcher.title = error.message; }
        }
    };
    // 로딩에 실패해도 선물을 놓치지 않도록 수령 전에는 재진입 버튼을 제공한다.
    launcher.style.cssText = 'position:fixed;right:18px;bottom:90px;z-index:9000;padding:12px 20px;border:1px solid #d6b678;border-radius:30px;background:#111a30;color:#ffe4b3;cursor:pointer';
    launcher.onclick = open; document.body.append(launcher);
    setTimeout(() => launcher.remove(), Math.max(0, end-performance.now()));
    if (!state.seen) {
        // 같은 계정의 여러 탭은 enter 응답의 showIntro로 자동 연출을 한 번만 연다.
        opening = true; launcher.disabled = true;
        try {
            await prepare(); prepared = true;
            const entry = await request('/enter', 'POST');
            if (entry.claimed) { launcher.remove(); return; }
            if (entry.showIntro) {
                launcher.remove();
                showEvent(entry, claimed => {
                    opening = false; launcher.disabled = false;
                    if (!claimed && performance.now() < end) document.body.append(launcher);
                });
                return;
            }
        } finally { opening = false; launcher.disabled = false; }
    }
}
startEvent().catch(error => console.warn('[chuseok]', error.message));
