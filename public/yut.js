import * as THREE from './vendor/yut/three.module.min.js';


// 그림 속 칸의 중심 좌표(%). 0은 출발 대기, 20은 완주 직전 같은 모서리.
const POINTS = [
    [88.2, 87.8], [88.2, 72.3], [88.2, 57.5], [88.2, 42.3], [88.2, 27.4], [88.2, 11.8],
    [72.7, 11.8], [57.6, 11.8], [42.6, 11.8], [27.4, 11.8], [11.7, 11.8],
    [11.7, 27.4], [11.7, 42.3], [11.7, 57.5], [11.7, 72.3], [11.7, 87.8],
    [27.4, 87.8], [42.6, 87.8], [57.6, 87.8], [72.7, 87.8], [88.2, 87.8],
    [73.4, 27], [64.1, 36.2], [37.1, 62.4], [28.5, 71.1],
    [26.3, 26.9], [35.6, 36.3], [62.3, 62.1], [71.2, 71], [50, 50]
];
const $el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
};
const image = (src, alt, cls) => {
    const node = $el('img', cls); node.src = src; node.alt = alt; return node;
};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const RESULT_ART = { '도': 'do', '개': 'gae', '걸': 'geol', '윷': 'yut', '모': 'mo', '완주': 'finish', '한 번 더': 'again' };

function createThrowScene(host) {
    const scene = new THREE.Scene();
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.setAttribute('aria-label', '나무 윷 네 개의 던지기 연출');
    host.append(renderer.domElement);
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 60);
    camera.position.set(0, 11.5, 8.5); camera.lookAt(0, 0, 0);
    scene.add(new THREE.HemisphereLight(0xfff8e4, 0x324c45, 2.0));
    const light = new THREE.DirectionalLight(0xffedc9, 2.6);
    light.position.set(-4, 10, 5); light.castShadow = true;
    light.shadow.mapSize.set(1024, 1024);
    Object.assign(light.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7 });
    light.shadow.bias = -0.001;
    scene.add(light);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.ShadowMaterial({ opacity: 0.32 }));
    plane.rotation.x = -Math.PI / 2; plane.receiveShadow = true; scene.add(plane);

    // 반원 단면을 길게 압출해 평평한 앞면과 둥근 뒷면을 가진 실제 윷 모양을 만든다.
    const shape = new THREE.Shape();
    shape.moveTo(-0.27, 0);
    shape.absarc(0, 0, 0.27, Math.PI, 0, true);
    shape.lineTo(-0.27, 0);
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: 2.35, bevelEnabled: true, bevelThickness: 0.045, bevelSize: 0.035, bevelSegments: 3, steps: 1, curveSegments: 16 });
    geometry.translate(0, -0.115, -1.175);
    const vertices = geometry.attributes.position, uv = geometry.attributes.uv;
    for (let i = 0; i < vertices.count; i++) uv.setXY(i, (vertices.getX(i) + 0.31) / 0.62, (vertices.getZ(i) + 1.22) / 2.44);
    const grain = document.createElement('canvas'); grain.width = 128; grain.height = 512;
    const ctx = grain.getContext('2d');
    ctx.fillStyle = '#89603a'; ctx.fillRect(0, 0, 128, 512);
    for (let i = 0; i < 120; i++) {
        ctx.strokeStyle = i % 3 ? 'rgba(84,39,14,.18)' : 'rgba(255,225,170,.3)';
        ctx.lineWidth = 0.5 + Math.random(); ctx.beginPath();
        const x = Math.random() * 128;
        ctx.moveTo(x, 0); ctx.bezierCurveTo(x + 12, 180, x - 15, 350, x + 5, 512); ctx.stroke();
    }
    const texture = new THREE.CanvasTexture(grain); texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    const flatGrain = grain.cloneNode(), flatContext = flatGrain.getContext('2d');
    flatContext.fillStyle = '#edcfa2'; flatContext.fillRect(0, 0, 128, 512);
    flatContext.globalAlpha = 0.13; flatContext.drawImage(grain, 0, 0);
    const flatTexture = new THREE.CanvasTexture(flatGrain); flatTexture.colorSpace = THREE.SRGBColorSpace;
    const wood = new THREE.MeshStandardMaterial({ map: texture, color: 0xffffff, roughness: 0.68 });
    const flat = new THREE.MeshStandardMaterial({ map: flatTexture, roughness: 0.78 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x582614, roughness: 0.8 });
    const stickMeshes = Array.from({ length: 4 }, () => {
        const group = new THREE.Group(); group.name = 'yut-stick';
        const body = new THREE.Mesh(geometry, wood); body.castShadow = true; body.receiveShadow = true;
        group.add(body);
        const face = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 2.32), flat);
        face.rotation.x = Math.PI / 2; face.position.y = -0.153; group.add(face);
        for (let n = 0; n < 4; n++) {
            for (const angle of [-0.65, 0.65]) {
                const mark = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.018, 0.24), dark);
                mark.position.set(0, 0.195, -0.77 + n * 0.51); mark.rotation.y = angle; group.add(mark);
            }
        }
        scene.add(group); return group;
    });
    let frame = 0, cancel = null;
    const baseY = face => face ? 0.195 : 0.155;
    const clamp = t => Math.max(0, Math.min(1, t));
    const ease = t => t * t * (3 - 2 * t);
    const readyX = [-1.8, -0.6, 0.6, 1.8];
    const readyYaw = [-0.12, 0.08, -0.07, 0.12];
    const setPose = (i, face, x, z, height, yaw, wobble = 0) => {
        const mesh = stickMeshes[i];
        mesh.position.set(x, baseY(face) + height, z);
        mesh.rotation.set((face ? Math.PI : 0) + wobble, yaw, 0, 'YXZ');
    };
    const aimCamera = zoom => {
        camera.zoom = zoom; camera.updateProjectionMatrix();
    };
    function show(faces = [0, 0, 0, 0]) {
        aimCamera(1.5);
        faces.forEach((face, i) => setPose(i, face, readyX[i], 0, 0, readyYaw[i]));
        renderer.render(scene, camera);
    }
    const resize = () => {
        const width = host.clientWidth || 500, height = host.clientHeight || 320;
        renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
        renderer.render(scene, camera);
    };
    const observer = new ResizeObserver(resize); observer.observe(host); resize(); show();
    return {
        show,
        async throw(faces, reduced, cue) {
            // 회전은 공중에서 끝낸다. 착지한 뒤에는 서버가 정한 같은 면을 유지한다.
            const scatter = [
                { x: -2.15, z: -0.35, yaw: -0.62 }, { x: -0.72, z: 0.45, yaw: 0.32 },
                { x: 0.8, z: -0.25, yaw: -0.28 }, { x: 2.2, z: 0.5, yaw: 0.52 }
            ].map((target, i) => {
                const yaw = target.yaw + (Math.random() - 0.5) * 0.18;
                return {
                    x: target.x + (Math.random() - 0.5) * 0.14,
                    z: target.z + (Math.random() - 0.5) * 0.24, yaw,
                    release: 460 + i * 35, flight: 1030 + Math.random() * 130,
                    height: 2.3 + Math.random() * 0.3, slide: (i % 2 ? 1 : -1) * 0.15,
                    start: stickMeshes[i].position.clone(), rotation: stickMeshes[i].quaternion.clone(),
                    launch: new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.48, -0.1 + i * 0.06, 0.06, 'YXZ')),
                    landing: new THREE.Quaternion().setFromEuler(new THREE.Euler(faces[i] ? Math.PI : 0, yaw, 0, 'YXZ')),
                    spins: 2 + (i % 2), hit: false, bounced: false
                };
            });
            const gatherAt = Math.max(...scatter.map(t => t.release + t.flight)) + 820;
            const duration = reduced ? 180 : gatherAt + 540;
            const spinX = new THREE.Quaternion(), spinZ = new THREE.Quaternion();
            const axisX = new THREE.Vector3(1, 0, 0), axisZ = new THREE.Vector3(0, 0, 1);
            let released = false;
            await new Promise(resolve => {
                cancel = resolve;
                const began = performance.now();
                const draw = now => {
                    const elapsed = now - began;
                    aimCamera(reduced ? 1.5 : 1.5 - 0.48 * ease(clamp(elapsed / 460)) + 0.48 * ease(clamp((elapsed - 1750) / 740)));
                    if (!reduced && !released && elapsed >= 460) { released = true; cue('release', 1); }
                    faces.forEach((face, i) => {
                        const target = scatter[i], mesh = stickMeshes[i];
                        const flight = clamp((elapsed - target.release) / target.flight);
                        const afterLanding = elapsed - target.release - target.flight;
                        const bounce = clamp(afterLanding / 560);
                        const gather = reduced ? clamp(elapsed / duration) : clamp((elapsed - gatherAt) / 540);
                        if (reduced || elapsed >= gatherAt) {
                            const t = ease(gather);
                            setPose(i, face, THREE.MathUtils.lerp(target.x, readyX[i], t), target.z * (1 - t), 0,
                                THREE.MathUtils.lerp(target.yaw, readyYaw[i], t));
                        } else if (elapsed < target.release) {
                            const t = ease(clamp(elapsed / 460));
                            const shake = Math.sin(elapsed / 37) * Math.sin(t * Math.PI);
                            mesh.position.set(
                                THREE.MathUtils.lerp(target.start.x, i % 2 ? 0.36 : -0.36, t) + shake * 0.065,
                                THREE.MathUtils.lerp(target.start.y, baseY(face) + 0.8 + Math.floor(i / 2) * 0.5, t) + Math.abs(shake) * 0.09,
                                THREE.MathUtils.lerp(target.start.z, 1.7, t));
                            mesh.quaternion.copy(target.rotation).slerp(target.launch, t);
                        } else if (flight < 1) {
                            const height = (0.8 + Math.floor(i / 2) * 0.5) * (1 - flight) + 4 * target.height * flight * (1 - flight);
                            mesh.position.set(
                                THREE.MathUtils.lerp(i % 2 ? 0.36 : -0.36, target.x - target.slide, flight),
                                baseY(face) + height, THREE.MathUtils.lerp(1.7, target.z - 0.22, flight));
                            const rotation = ease(clamp(flight / 0.92));
                            mesh.quaternion.copy(target.launch).slerp(target.landing, rotation);
                            spinX.setFromAxisAngle(axisX, Math.PI * 2 * target.spins * rotation);
                            spinZ.setFromAxisAngle(axisZ, Math.PI * 2 * rotation);
                            mesh.quaternion.multiply(spinX).multiply(spinZ);
                        } else {
                            const height = 0.38 * Math.abs(Math.sin(bounce * Math.PI * 2)) * (1 - bounce) ** 2;
                            const wobble = 0.075 * Math.sin(bounce * Math.PI * 5) * (1 - bounce) ** 2;
                            const slide = 1 - (1 - bounce) ** 3;
                            setPose(i, face, target.x - target.slide * (1 - slide), target.z - 0.22 * (1 - slide), height,
                                target.yaw + Math.sin(bounce * Math.PI) * 0.06 * (1 - bounce), wobble);
                            if (!target.hit) { target.hit = true; cue('impact', 0.8 + i * 0.06); }
                            if (!target.bounced && afterLanding >= 280) { target.bounced = true; cue('impact', 0.25); }
                        }
                    });
                    renderer.render(scene, camera);
                    if (elapsed < duration) frame = requestAnimationFrame(draw);
                    else { frame = 0; cancel = null; resolve(); }
                };
                frame = requestAnimationFrame(draw);
            });
        },
        stop() { cancelAnimationFrame(frame); if (cancel) cancel(); cancel = null; },
        dispose() {
            this.stop(); observer.disconnect();
            scene.traverse(node => { if (node.geometry) node.geometry.dispose(); });
            [wood, flat, dark, plane.material].forEach(material => material.dispose());
            texture.dispose(); flatTexture.dispose(); renderer.dispose(); renderer.domElement.remove();
        }
    };
}

export function mountYut(root) {
    let state = null, busy = false, pending = null, scene = null, paused = false, sound = true, audio = null;
    const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches || paused;
    root.innerHTML = `<section class="yut-game">
        <div class="yut-header"><h1><img class="yut-title-art" src="/rpg-ui?file=%EC%9C%B7%EB%86%80%EC%9D%B4%2Ftitle.png" alt="윷놀이 이벤트" width="2172" height="724"></h1><div class="yut-header-tools"><span class="yut-laps">완주 <strong class="yut-lap-count">0회</strong></span>
        <button type="button" class="yut-sound" aria-pressed="true">소리 켜짐</button></div></div>
        <div class="yut-arena"><div class="yut-board-column"><div class="yut-board">
        <img class="yut-board-art" src="/rpg-ui?file=%EC%9C%B7%EB%86%80%EC%9D%B4%2Fboard-simple.png" alt="나무에 바깥길과 대각선 지름길이 새겨진 윷판">
        <span class="yut-start-label">출발</span><div class="yut-token" role="img" aria-label="내 말, 출발 대기"><svg viewBox="0 0 32 32" aria-hidden="true"><g fill="currentColor"><ellipse cx="16" cy="9" rx="4.5" ry="7"/><ellipse cx="16" cy="9" rx="4.5" ry="7" transform="rotate(72 16 16)"/><ellipse cx="16" cy="9" rx="4.5" ry="7" transform="rotate(144 16 16)"/><ellipse cx="16" cy="9" rx="4.5" ry="7" transform="rotate(216 16 16)"/><ellipse cx="16" cy="9" rx="4.5" ry="7" transform="rotate(288 16 16)"/></g><circle cx="16" cy="16" r="3" fill="#c288aa"/></svg></div>
        </div><div class="yut-position" aria-live="polite"></div></div>
        <div class="yut-console"><div class="yut-throw-shell"><div class="yut-idle-sticks" aria-hidden="true"></div><div class="yut-throw-stage"></div><div class="yut-burst" aria-hidden="true"></div><div class="yut-result" role="status" aria-live="polite"></div></div>
        <div class="yut-last-result"></div><div class="yut-action"><div class="yut-balance"></div><button type="button" class="yut-roll" disabled><span>윷 던지기</span><small>윷 4개 사용</small></button><p class="yut-message" role="status" aria-live="polite"></p></div>
        <div class="yut-next"><span>다음 보상</span><div class="yut-next-content"></div></div></div></div>
        <section class="yut-rewards"><div class="yut-reward-heading"><h2>완주 보상</h2><span>11회부터 매번 5성 카드팩 1개</span></div><div class="yut-reward-list"></div></section>
    </section>`;
    const q = selector => root.querySelector(selector);
    const board = q('.yut-board'), tray = q('.yut-throw-shell'), token = q('.yut-token'), rollButton = q('.yut-roll'), message = q('.yut-message');
    // 결과 발표 전에 미리 읽어 이미지가 늦게 나타나는 일을 막는다.
    const resultArt = Object.fromEntries(Object.entries(RESULT_ART).map(([name, file]) => {
        const art = image('/rpg-ui?file=%EC%9C%B7%EB%86%80%EC%9D%B4%2Fresult-' + file + '.png', name, 'yut-result-art');
        return [name, { art, ready: art.decode().catch(() => {}) }];
    }));
    function artNode(name, cls) {
        const art = resultArt[name]?.art;
        const node = art?.naturalWidth ? art.cloneNode() : $el('strong', '', name);
        node.className = cls; return node;
    }
    for (let i = 0; i < 4; i++) q('.yut-idle-sticks').append(image('/item-image?dir=%EC%9D%B4%EB%B2%A4%ED%8A%B8&file=%EC%9C%B7.png', '', ''));
    function tone(frequency, duration = 0.1, type = 'sine', volume = 0.06) {
        if (!sound || !audio || paused) return;
        const oscillator = audio.createOscillator(), gain = audio.createGain();
        oscillator.type = type; oscillator.frequency.setValueAtTime(frequency, audio.currentTime);
        gain.gain.setValueAtTime(volume, audio.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + duration);
        oscillator.connect(gain); gain.connect(audio.destination); oscillator.start(); oscillator.stop(audio.currentTime + duration);
    }
    function throwSound(kind, strength) {
        if (!sound || !audio || paused) return;
        const release = kind === 'release', duration = release ? 0.24 : 0.065;
        const buffer = audio.createBuffer(1, Math.ceil(audio.sampleRate * duration), audio.sampleRate);
        const samples = buffer.getChannelData(0);
        for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
        const source = audio.createBufferSource(), filter = audio.createBiquadFilter(), gain = audio.createGain();
        source.buffer = buffer; filter.type = 'bandpass'; filter.Q.value = release ? 0.6 : 2.4;
        filter.frequency.setValueAtTime(release ? 650 : 1350 + Math.random() * 600, audio.currentTime);
        gain.gain.setValueAtTime(release ? 0.001 : 0.16 * strength, audio.currentTime);
        if (release) gain.gain.linearRampToValueAtTime(0.1, audio.currentTime + 0.065);
        gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + duration);
        source.connect(filter); filter.connect(gain); gain.connect(audio.destination);
        source.start(); source.stop(audio.currentTime + duration);
        if (!release) tone(190 + Math.random() * 100, 0.07, 'triangle', 0.035 * strength);
    }
    async function prepareAudio() {
        if (sound) {
            try { audio ||= new (window.AudioContext || window.webkitAudioContext)(); await audio.resume(); }
            catch (_) { sound = false; }
        }
        q('.yut-sound').textContent = sound ? '소리 켜짐' : '소리 꺼짐';
        q('.yut-sound').setAttribute('aria-pressed', String(sound));
    }
    q('.yut-sound').onclick = async () => {
        sound = !sound; await prepareAudio(); tone(660);
    };
    function place(position) {
        const [x, y] = POINTS[position];
        token.style.left = x + '%'; token.style.top = y + '%';
        token.setAttribute('aria-label', '내 말, ' + (position === 0 ? '출발 대기' : position === 29 ? '중앙' : position + '번 칸'));
    }
    function rewardNode(reward, cls) {
        const wrap = $el('div', cls);
        if (reward.iconUrl) wrap.append(image(reward.iconUrl, reward.name, 'yut-reward-icon'));
        const text = $el('strong', '', reward.name); wrap.append(text); return wrap;
    }
    function updateButton() {
        rollButton.disabled = busy || (!pending && (!state.ready || state.itemCount < state.cost));
        rollButton.classList.toggle('bonus', !!state.bonusRoll && !pending);
        rollButton.querySelector('span').textContent = pending ? '이전 결과 확인' : state.bonusRoll ? '윷 한 번 더 던지기' : '윷 던지기';
        rollButton.querySelector('small').textContent = pending ? '추가 소모 없음' : state.bonusRoll ? '' : '윷 4개 사용';
        rollButton.querySelector('small').hidden = !!state.bonusRoll && !pending;
    }
    function render() {
        token.style.transition = 'none';
        place(state.position);
        void token.offsetWidth;
        token.style.transition = '';
        q('.yut-lap-count').textContent = state.laps.toLocaleString() + '회';
        q('.yut-next-content').replaceChildren(rewardNode(state.rewards[Math.min(state.laps, 10)], 'yut-next-reward'));
        q('.yut-balance').replaceChildren(image(state.itemIcon, '', ''), $el('span', '', '보유 윷'), $el('strong', '', state.itemCount.toLocaleString() + '개'));
        q('.yut-position').textContent = state.position === 29 ? '다음 던지기는 완주 지름길' : [5, 10].includes(state.position) ? '다음 던지기는 지름길' : '';
        q('.yut-reward-list').replaceChildren(...state.rewards.slice(0, 10).map((reward, i) => {
            const card = $el('div', 'yut-reward-card' + (i < state.laps ? ' claimed' : i === state.laps ? ' next' : ''));
            card.append($el('span', 'yut-reward-lap', (i + 1) + '회'), rewardNode(reward, 'yut-prize'));
            if (i < state.laps) card.append($el('span', 'yut-reward-check', '✓'));
            return card;
        }));
        const last = state.lastRoll;
        q('.yut-last-result').replaceChildren(...(last ? [$el('strong', '', last.name), $el('span', '', last.steps + '칸'), ...(state.bonusRoll ? [artNode('한 번 더', 'yut-again-badge')] : [])] : []));
        updateButton();
        message.textContent = !state.ready ? '아이템 등록을 확인해 주세요.' : state.itemCount < state.cost ? '윷이 부족합니다.' : '';
        if (last && !scene && !paused) {
            scene = createThrowScene(q('.yut-throw-stage'));
            tray.classList.add('has-scene');
        }
        if (scene) scene.show(last?.faces);
    }
    async function request(url, body) {
        const response = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' });
        const data = await response.json();
        if (!response.ok) { const error = new Error(data.error || '결과를 확인하지 못했습니다.'); error.refresh = data.refresh; error.retry = data.retry || response.status >= 500 || response.status === 409; throw error; }
        return data;
    }
    function burst(big) {
        if (reduced()) return;
        const host = q('.yut-burst'); host.replaceChildren();
        for (let i = 0; i < (big ? 36 : 20); i++) {
            const particle = $el('i');
            const angle = Math.random() * Math.PI * 2, distance = 65 + Math.random() * 160;
            particle.style.setProperty('--x', Math.cos(angle) * distance + 'px'); particle.style.setProperty('--y', Math.sin(angle) * distance + 'px');
            particle.style.setProperty('--r', Math.random() * 360 + 'deg'); particle.style.background = ['#c27dbe', '#ecd295', '#f6bacb', '#fff9e8'][i % 4];
            host.append(particle);
        }
    }
    async function reveal(roll) {
        const asset = resultArt[roll.name];
        await Promise.all([asset?.ready, resultArt['한 번 더'].ready, resultArt['완주'].ready]);
        if (paused) return;
        const result = q('.yut-result');
        result.replaceChildren(asset?.art.naturalWidth ? asset.art.cloneNode() : $el('strong', '', roll.name), $el('span', 'yut-result-steps', roll.steps + '칸 이동'));
        if (roll.bonusAwarded) result.append(artNode('한 번 더', 'yut-again-art'));
        result.classList.add('visible'); burst(roll.bonusAwarded);
        tone(523, 0.2, 'triangle'); setTimeout(() => tone(784, 0.25, 'triangle'), 100); setTimeout(() => tone(1047, 0.35, 'triangle'), 210);
        await wait(reduced() ? 180 : 1150); result.classList.remove('visible');
    }
    rollButton.onclick = async () => {
        if (busy || !state) return;
        busy = true; paused = false; updateButton();
        if (innerWidth <= 700) tray.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' });
        message.textContent = pending ? '결과 확인 중…' : '던지는 중…';
        q('.yut-result').classList.remove('visible');
        try {
            // 첫 던지기 클릭 안에서 오디오를 열어 브라우저 자동재생 제한을 따른다.
            await prepareAudio();
            // WebGL 준비에 실패하면 요청을 보내지 않아 아이템이 차감되지 않는다.
            scene ||= createThrowScene(q('.yut-throw-stage'));
            tray.classList.add('has-scene');
            pending ||= { requestId: crypto.randomUUID(), revision: state.revision };
            const next = await request('/api/yut/roll', pending);
            pending = null;
            const roll = next.lastRoll;
            state = next;
            q('.yut-balance strong').textContent = next.itemCount.toLocaleString() + '개';
            tray.classList.add('rolling');
            q('.yut-last-result').replaceChildren();
            if (!paused) await scene.throw(roll.faces, reduced(), (kind, strength) => {
                throwSound(kind, strength);
                if (kind === 'impact' && strength >= 0.8) {
                    tray.classList.remove('impact'); void tray.offsetWidth; tray.classList.add('impact');
                }
            });
            if (scene) scene.show(roll.faces);
            await reveal(roll); tray.classList.remove('rolling');
            if (!paused && innerWidth <= 700) board.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' });
            place(roll.from);
            for (const position of roll.path) {
                place(position); tone(370 + position * 17, 0.08, 'sine', 0.04);
                if (!reduced()) {
                    token.classList.remove('hop'); void token.offsetWidth; token.classList.add('hop');
                    await wait(240);
                }
            }
            state = next; render();
            if (roll.reward && !paused) {
                if (innerWidth <= 700) tray.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' });
                const result = q('.yut-result');
                result.replaceChildren(artNode('완주', 'yut-finish-art'), rewardNode(roll.reward, 'yut-won-reward'), $el('span', 'yut-result-steps', '1개 획득'));
                result.classList.add('visible', 'finish'); burst(true);
                [523, 659, 784, 1047].forEach((frequency, i) => setTimeout(() => tone(frequency, 0.4, 'triangle'), i * 130));
                await wait(reduced() ? 250 : 1600); result.classList.remove('visible', 'finish');
            }
            message.textContent = state.itemCount < state.cost ? '윷이 부족합니다.' : '';
        } catch (error) {
            if (!error.retry && !(error instanceof TypeError)) pending = null;
            if (error.refresh) { pending = null; state = await request('/api/yut').catch(() => state); render(); }
            message.textContent = error.message;
        } finally {
            busy = false; tray.classList.remove('rolling', 'impact'); token.classList.remove('hop'); updateButton();
            if (paused && scene) { scene.dispose(); scene = null; tray.classList.remove('has-scene'); }
        }
    };
    return {
        async refresh() { paused = false; if (busy) return; state = await request('/api/yut'); await resultArt['한 번 더'].ready; render(); },
        pause() {
            paused = true;
            if (scene) {
                scene.stop();
                if (!busy) { scene.dispose(); scene = null; tray.classList.remove('has-scene'); }
            }
        },
    };
}
