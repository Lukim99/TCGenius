import './assets/personal-draw/runtime/board.js';

const { startCharge, advanceCharge, boardPose } = globalThis.PersonalDraw;
const asset = path => '/rpg-ui?file=' + encodeURIComponent('퍼스널뽑기/' + path);
const num = value => Number(value || 0).toLocaleString('ko-KR');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const popFrames = Array.from({ length: 25 }, (_, index) => {
    const frame = Math.min(index, 23);
    return { backgroundPosition: (frame % 6 * 20) + '% ' + (Math.floor(frame / 6) / 3 * 100) + '%', offset: index / 24, easing: 'steps(1,end)' };
});
function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}
async function request(action = '', body) {
    const response = await fetch('/api/personal-draw' + (action ? '/' + action : ''), { method: body ? 'POST' : 'GET', cache: 'no-store', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error || '결과를 불러오지 못했습니다.'), data, { status: response.status });
    return data;
}

export function mountPersonalDraw(root, onPoints = () => {}) {
    let state, phase = 'idle', paused = false, pending = null, charge, frame, audio, muted = false;
    let generation = 0, dialog;
    const popSheet = new Image(); popSheet.src = asset('fx/cover_pop_crown_atlas.png');
    const popReady = popSheet.decode().catch(() => null);
    try { muted = localStorage.getItem('personal-draw-muted') === 'true'; } catch (_) {}
    root.innerHTML = `<section class="pd-shell" aria-label="퍼스널뽑기">
      <div class="pd-topline"><span>RPGENIUS</span><div><button type="button" class="pd-help">이용 안내</button><button type="button" class="pd-crafting">제작식</button><button type="button" class="pd-sound" aria-label="효과음 설정"></button></div></div>
      <div class="pd-layout">
        <header class="pd-hero"><div><h1>퍼스널<span>뽑기</span></h1></div><img src="${asset('scene/capsule.png')}" alt="별빛이 담긴 캡슐"></header>
        <div class="pd-board-column">
          <div class="pd-board-head"><span>남은 칸</span><strong class="pd-left">100 / 100</strong></div>
          <div class="pd-board-wrap"><div class="pd-board"><img class="pd-coords" src="${asset('board/coordinates.png')}" alt=""><div class="pd-grid" role="group" aria-label="10행 10열 뽑기판"></div><div class="pd-effects" aria-hidden="true"></div><button type="button" class="pd-reset">판 새로고침 <small>무료</small></button><div class="pd-white" hidden></div></div>
            <button class="pd-charge" type="button" hidden aria-label="연속 클릭으로 충전 가속"><div class="pd-charge-card"><strong>판 흔드는 중</strong><b class="pd-percent">0%</b><div class="pd-charge-track" role="progressbar" aria-label="판 흔들기 충전량" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span></span></div><img class="pd-charge-glint" src="${asset('gauge/charge_glint.png')}" alt=""><small>클릭하거나 스페이스를 누르면 더 빨리 차요</small></div></button>
          </div>
          <div class="pd-board-foot"><span>한 칸 <strong class="pd-single-cost">300 P</strong></span><span>열고 싶은 칸을 선택하세요.</span></div>
          <p class="pd-message" role="status" aria-live="polite"></p><button type="button" class="pd-retry" hidden>이전 요청 결과 확인</button>
        </div>
        <aside class="pd-panel">
          <div class="pd-reward-panel"><div class="pd-reward-heading"><h2>남은 보상</h2></div><ul class="pd-rewards"></ul></div>
          <div class="pd-wallet"><span>보유 포인트</span><strong class="pd-points">0 P</strong></div>
          <button type="button" class="pd-shake"><span>판 흔들기</span><strong>1,500 P</strong></button>
          <p class="pd-rule">기본 5칸 + 성공할 때마다 20% 추가 뽑기</p>
        </aside>
      </div><div class="pd-celebration" aria-hidden="true"></div>
    </section>`;
    const $ = selector => root.querySelector(selector);
    const shell = $('.pd-shell'), board = $('.pd-board'), grid = $('.pd-grid'), effects = $('.pd-effects'), message = $('.pd-message');
    const shake = $('.pd-shake'), reset = $('.pd-reset'), layer = $('.pd-charge'), veil = $('.pd-white');
    const tiles = Array.from({ length: 100 }, (_, index) => {
        const tile = node('button', 'pd-tile'); tile.type = 'button'; tile.dataset.index = index;
        tile.setAttribute('aria-label', cellName(index) + ' 열기');
        tile.addEventListener('click', () => { if (phase === 'idle' && !pending) perform('single', { index }); });
        grid.append(tile); return tile;
    });
    function cellName(index) { return String.fromCharCode(65 + Math.floor(index / 10)) + String(index % 10 + 1).padStart(2, '0'); }
    function say(text, error = false) { message.textContent = error ? text : ''; message.classList.toggle('pd-error', error); }
    function setPhase(value) {
        phase = value; shell.dataset.phase = value;
        const blocked = value !== 'idle' || !!pending || !state?.active;
        grid.inert = blocked;
        shake.disabled = blocked || state?.remaining === 0 || state?.point < state?.costs.shake;
        reset.disabled = blocked;
        $('.pd-retry').hidden = !pending || value !== 'idle';
    }
    function unlockAudio() {
        if (muted) return;
        const Context = window.AudioContext || window.webkitAudioContext;
        if (!Context) return;
        audio ||= new Context(); audio.resume().catch(() => {});
    }
    function tone(frequency, duration = .1, offset = 0, type = 'sine', volume = .06, end = frequency) {
        if (!audio || muted || paused) return;
        const time = audio.currentTime + offset, oscillator = audio.createOscillator(), gain = audio.createGain();
        oscillator.type = type; oscillator.frequency.setValueAtTime(frequency, time); oscillator.frequency.exponentialRampToValueAtTime(Math.max(30, end), time + duration);
        gain.gain.setValueAtTime(.001, time); gain.gain.exponentialRampToValueAtTime(volume, time + .012); gain.gain.exponentialRampToValueAtTime(.001, time + duration);
        oscillator.connect(gain); gain.connect(audio.destination); oscillator.start(time); oscillator.stop(time + duration + .02);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    }
    function sound(kind, progress = 0) {
        if (kind === 'charge') tone(180 + progress * 600, .09, 0, 'triangle', .035, 240 + progress * 850);
        if (kind === 'open') { tone(650, .10, 0, 'triangle', .06, 140); tone(1046, .28, .1, 'sine', .05); }
        if (kind === 'bonus') [523, 659, 784, 1046].forEach((f, i) => tone(f, .22, i * .07, 'triangle', .05));
        if (kind === 'first') [523, 659, 784, 1046, 1318, 1568].forEach((f, i) => tone(f, .7, i * .12, 'sine', .07));
        if (kind === 'refresh') { tone(180, .5, 0, 'triangle', .04, 1200); tone(1046, .6, .3, 'sine', .035); }
    }
    const soundButton = $('.pd-sound');
    function soundLabel() { soundButton.textContent = muted ? '소리 꺼짐' : '소리 켜짐'; soundButton.setAttribute('aria-pressed', String(!muted)); }
    soundLabel();
    soundButton.onclick = () => { muted = !muted; try { localStorage.setItem('personal-draw-muted', String(muted)); } catch (_) {} soundLabel(); if (muted) audio?.suspend(); else unlockAudio(); };
    function rewardImage(url, fallback = asset('scene/capsule.png')) {
        const image = node('img'); image.src = url || fallback; image.alt = '';
        image.onerror = () => { image.onerror = null; image.src = fallback; };
        return image;
    }
    function paintTile(index, result) {
        const tile = tiles[index]; tile.replaceChildren(); tile.disabled = !!result;
        tile.className = 'pd-tile' + (result ? ' pd-open pd-' + result.grade : '');
        tile.style.backgroundImage = result ? `url("${asset('tiles/result_' + result.grade + '.png')}")` : '';
        tile.setAttribute('aria-label', cellName(index) + (result ? ' ' + result.name + ' ' + result.count + '개 획득' : ' 열기'));
        tile.title = result ? result.name + (result.count > 1 ? ' ×' + result.count : '') : cellName(index) + ' 선택';
        if (result) { tile.append(rewardImage(result.iconUrl)); if (result.count > 1) tile.append(node('span', 'pd-tile-count', '×' + result.count)); }
    }
    function paint(next = state) {
        state = next;
        tiles.forEach((_, index) => paintTile(index, state.opened[index]));
        $('.pd-left').textContent = state.remaining + ' / 100';
        $('.pd-points').textContent = num(state.point) + ' P';
        onPoints(state.point);
        $('.pd-single-cost').textContent = num(state.costs.single) + ' P';
        shake.querySelector('strong').textContent = num(state.costs.shake) + ' P';
        reset.querySelector('small').textContent = state.costs.refresh ? num(state.costs.refresh) + ' P' : '무료';
        $('.pd-rewards').replaceChildren(...state.rewards.map(reward => {
            const row = node('li', 'pd-reward pd-' + reward.grade + (reward.remaining === 0 ? ' pd-empty' : ''));
            const copy = node('div', 'pd-reward-copy');
            copy.append(node('small', '', reward.type === 'pet' ? reward.rarity : reward.grade === 'first' ? '1등 재료' : '제작 재료'), node('strong', '', reward.name + (reward.count > 1 ? ' ×' + reward.count : '')));
            const count = node('div', 'pd-stock'); count.append(node('b', '', reward.remaining), node('small', '', '/ ' + reward.stock));
            row.append(rewardImage(reward.iconUrl), copy, count); return row;
        }));
        setPhase(phase);
    }
    function closeDialog() { dialog?.close(); dialog?.remove(); dialog = null; }
    function showDialog(title, content) {
        closeDialog(); dialog = node('dialog', 'pd-dialog');
        const close = node('button', 'pd-dialog-close', '닫기'); close.type = 'button'; close.onclick = closeDialog;
        dialog.append(node('h2', '', title), content, close); root.append(dialog); dialog.showModal();
        dialog.addEventListener('click', event => { if (event.target === dialog) closeDialog(); });
    }
    function showResults(results) {
        closeDialog();
        const tones = { '레전더리': 'legendary', '유니크': 'unique', '레어': 'rare' };
        const bonusCount = results.filter(result => result.bonus).length;
        const jackpot = results.some(result => result.grade === 'first');
        dialog = node('dialog', 'pd-dialog pd-result-dialog' + (jackpot ? ' pd-result-jackpot' : ''));
        dialog.setAttribute('aria-labelledby', 'pdResultTitle');
        const frame = node('div', 'pd-result-frame'), panel = node('div', 'pd-result-panel');
        const head = node('header', 'pd-result-head'), title = node('h2', 'pd-result-title', '뽑기 결과');
        title.id = 'pdResultTitle';
        const meta = node('p', 'pd-result-meta');
        meta.append(node('span', 'pd-result-chip', results.length + '칸 개봉'));
        if (bonusCount) meta.append(node('span', 'pd-result-chip pd-result-chip-bonus', 'BONUS ' + bonusCount));
        head.append(title, meta);
        const list = node('ul', 'pd-loot-grid');
        list.style.setProperty('--cols', Math.min(5, results.length));
        list.style.setProperty('--cols-md', Math.min(3, results.length));
        list.style.setProperty('--cols-sm', Math.min(2, results.length));
        results.forEach((result, index) => {
            const first = result.grade === 'first';
            const item = node('li', 'pd-loot pd-loot-' + (first ? 'first' : tones[result.rarity] || result.grade));
            item.style.setProperty('--i', Math.min(index, 24));
            const card = node('div', 'pd-loot-card'), art = node('div', 'pd-loot-art'), icon = rewardImage(result.iconUrl);
            icon.className = 'pd-loot-icon';
            art.append(icon, node('b', 'pd-loot-count', '×' + result.count));
            if (first) { const crown = node('img', 'pd-loot-crown'); crown.src = asset('fx/crown_mark.png'); crown.alt = ''; art.append(crown); }
            if (result.bonus) card.append(node('span', 'pd-loot-bonus', 'BONUS'));
            card.append(art, node('small', 'pd-loot-rarity', result.rarity || (first ? '1등 재료' : '제작 재료')), node('strong', 'pd-loot-name', result.name));
            item.append(card); list.append(item);
        });
        const foot = node('footer', 'pd-result-foot'), ok = node('button', 'pd-result-ok', '확인');
        ok.type = 'button'; ok.onclick = closeDialog; ok.autofocus = true;
        foot.append(ok); panel.append(head, list, foot); frame.append(panel); dialog.append(frame);
        dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
        dialog.addEventListener('click', event => { if (event.target === dialog) closeDialog(); });
        root.append(dialog); dialog.showModal();
    }
    $('.pd-help').onclick = () => {
        if (!state) return;
        const content = node('div', 'pd-help-content');
        for (const text of [
            '한 칸을 선택하면 ' + num(state.costs.single) + ' P로 해당 칸을 엽니다.',
            '판 흔들기는 ' + num(state.costs.shake) + ' P입니다. 기본 5칸을 연 뒤 20% 확률로 1칸을 추가로 열고, 성공할 때마다 다시 20%를 판정합니다.',
            '추가 횟수 제한은 없으며 남아 있는 칸까지만 열립니다. 남은 칸이 5개 미만이면 같은 비용으로 남은 칸을 모두 엽니다.',
            '판은 나만의 기록으로 저장됩니다. 무료 새로고침은 언제든 가능하며, 이미 받은 보상은 유지됩니다.',
            '표시 수량은 현재 판의 남은 보상입니다. 한 칸의 보상 확률은 해당 보상의 남은 수량 ÷ 남은 전체 칸 수입니다. 등급 내 펫은 같은 확률로 지급됩니다.',
            '재료는 거래 가능하며 펫의 거래횟수와 사용 기간은 기존 펫 규칙을 따릅니다.'
        ]) content.append(node('p', '', text));
        state.rewards.filter(r => r.pool).forEach(r => content.append(node('p', '', r.rarity + ': ' + r.pool.map(name => name.replace('유의게임X ', '')).join(', '))));
        showDialog('퍼스널뽑기 이용 안내', content);
    };
    $('.pd-crafting').onclick = () => {
        const content = node('div', 'pd-help-content');
        ['유리사의 잔상 3개 → 고유 유의게임X 유리사', '지나의 축복 20개 → 원하는 레어 유의게임X 펫', '지나의 축복 50개 → 원하는 유니크 유의게임X 펫', '지나의 축복 200개 → 원하는 레전더리 유의게임X 펫', '인벤토리에서 재료를 선택하면 제작할 수 있는 펫 목록이 표시됩니다.'].forEach(text => content.append(node('p', '', text)));
        showDialog('펫 제작식', content);
    };
    function celebrate(result) {
        if (paused || reduced()) return;
        const burst = $('.pd-celebration'); burst.replaceChildren();
        for (let i = 0; i < 24; i++) {
            const particle = node('i'); particle.style.setProperty('--x', (Math.random() * 100) + '%'); particle.style.setProperty('--delay', (Math.random() * .5) + 's'); particle.style.setProperty('--spin', (Math.random() * 600 - 300) + 'deg'); burst.append(particle);
        }
        shell.classList.remove('pd-jackpot'); void shell.offsetWidth; shell.classList.add('pd-jackpot');
        setTimeout(() => { burst.replaceChildren(); shell.classList.remove('pd-jackpot'); }, 2500);
        say('1등 당첨! ' + result.name + '을 획득했습니다.');
    }
    async function reveal(result, index, total, token) {
        if (paused || token !== generation) return;
        if (result.bonus) { sound('bonus'); say('추가 뽑기 ' + (index + 1) + '회차'); await wait(reduced() ? 0 : 350); }
        await popReady;
        if (paused || token !== generation) return;
        const tile = tiles[result.index], pop = node('span', 'pd-pop');
        const rect = tile.getBoundingClientRect(), area = effects.getBoundingClientRect();
        Object.assign(pop.style, { left: rect.left - area.left - rect.width / 2 + 'px', top: rect.top - area.top - rect.height / 2 + 'px', width: rect.width * 2 + 'px', height: rect.height * 2 + 'px' });
        effects.append(pop);
        // 단발 WebP는 같은 URL의 종료 프레임을 공유할 수 있으므로 원본 아틀라스를 매번 독립 재생한다.
        const animation = pop.animate(popFrames, { duration: reduced() ? 0 : 864, fill: 'forwards' });
        try {
            sound('open'); await wait(reduced() ? 0 : 252);
            if (paused || token !== generation) return;
            paintTile(result.index, result);
            if (result.grade === 'first') { sound('first'); celebrate(result); }
            await animation.finished;
        } finally { pop.remove(); }
    }
    async function perform(action, values = {}) {
        if (phase !== 'idle' && phase !== 'charged' || paused) return;
        unlockAudio();
        if (!pending) pending = { action, body: { ...values, revision: state.revision, expectedCost: state.costs[action], requestId: crypto.randomUUID() } };
        const token = ++generation, operation = pending;
        setPhase('waiting'); say('결과 확인 중…');
        try {
            const next = await request(operation.action, operation.body);
            pending = null;
            if (token !== generation || paused) { paint(next); return; }
            if (operation.action === 'refresh') {
                setPhase('refreshing'); sound('refresh'); veil.hidden = false; veil.style.opacity = '0';
                await veil.animate([{ opacity: 0 }, { opacity: 1 }], { duration: reduced() ? 0 : 240, fill: 'forwards' }).finished;
                paint(next);
                await wait(reduced() ? 0 : 160);
                await veil.animate([{ opacity: 1 }, { opacity: 0 }], { duration: reduced() ? 0 : 360, fill: 'forwards' }).finished;
                veil.hidden = true; say('판 새로고침 완료');
            } else {
                setPhase('revealing');
                const results = next.lastAction.results;
                for (let i = 0; i < results.length && token === generation; i++) await reveal(results[i], i, results.length, token);
                paint(next);
                if (!paused && token === generation) {
                    if (results.length > 1 || results.some(r => r.grade === 'first')) showResults(results);
                    say(results.length + '칸 개봉 완료. ' + num(next.lastAction.cost) + ' P를 사용했습니다.');
                }
            }
        } catch (error) {
            say(error.message, true);
            if (error.status && !error.retry) pending = null;
            if (error.refresh) { try { paint(await request()); } catch (_) {} }
        } finally { layer.hidden = true; board.style.transform = ''; setPhase('idle'); }
    }
    function tap() { if (phase !== 'charging') return; advanceCharge(charge, performance.now(), true); sound('charge', charge.progress); }
    function beginCharge() {
        if (phase !== 'idle' || pending || !state?.active || state.remaining < 1) return;
        unlockAudio(); closeDialog(); charge = startCharge(performance.now()); layer.hidden = false; setPhase('charging');
        let lastTone = 0;
        function step(now) {
            if (phase !== 'charging' || paused) return;
            const progress = advanceCharge(charge, now);
            $('.pd-percent').textContent = Math.floor(progress * 100) + '%';
            $('.pd-charge-track').setAttribute('aria-valuenow', Math.floor(progress * 100));
            $('.pd-charge-track span').style.transform = 'scaleX(' + progress + ')';
            $('.pd-charge-glint').style.left = (5.35 + 89.3 * progress) + '%';
            $('.pd-charge-glint').style.opacity = progress > 0 ? '1' : '0';
            if (!reduced()) { const pose = boardPose(charge); board.style.transform = `translate(${pose.x / 2}px,${pose.y / 2}px) rotate(${pose.degrees}deg)`; }
            if (now - lastTone > 220) { sound('charge', progress); lastTone = now; }
            if (progress >= 1) { setPhase('charged'); setTimeout(() => { if (phase === 'charged' && !paused) { layer.hidden = true; board.style.transform = ''; perform('shake'); } }, 180); return; }
            frame = requestAnimationFrame(step);
        }
        frame = requestAnimationFrame(step); layer.focus();
    }
    layer.onclick = tap;
    layer.addEventListener('keydown', event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); tap(); } });
    shake.onclick = beginCharge;
    reset.onclick = () => perform('refresh');
    $('.pd-retry').onclick = () => { if (pending) perform(pending.action); };
    return {
        async refresh() {
            paused = false;
            if (phase !== 'idle') return;
            setPhase('loading');
            try { paint(await request()); if (!state.active) say('이벤트가 종료되었습니다.', true); }
            finally { setPhase('idle'); }
        },
        pause() {
            paused = true; generation++; cancelAnimationFrame(frame); closeDialog(); audio?.suspend();
            layer.hidden = true; board.style.transform = ''; effects.replaceChildren(); veil.hidden = true;
            if (phase === 'charging' || phase === 'charged') setPhase('idle');
        }
    };
}
