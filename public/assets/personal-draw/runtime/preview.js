(() => {
  'use strict';
  const {rules, dealBoard, planShake, startCharge, advanceCharge, boardPose, refreshOpacity} = globalThis.PersonalDraw;
  const byId = id => document.getElementById(id);
  const stage = byId('stage');
  const board = byId('board-motion');
  const grid = byId('grid');
  const effects = byId('effects');
  const action = byId('draw');
  const resetButton = byId('reset-board');
  const refreshVeil = byId('refresh-veil');
  const chargeLayer = byId('charge-surface');
  const prompt = byId('prompt');
  const meter = byId('gauge');
  const percent = byId('percent');
  const fill = byId('charge-fill');
  const glint = byId('charge-glint');
  const chargeBar = byId('charge-bar');
  const files = globalThis.PersonalDrawFiles || {};
  const url = path => files[path] || path;
  const cssURL = path => 'url("' + url(path) + '")';
  const sourceAtlas = 'fx/cover_pop_crown_atlas.png';

  const surfaces = {
    backdrop: 'scene/screen_backdrop.png', board: 'board/board_empty.png',
    'cover-idle':'tiles/cover_idle.png', 'cover-hover':'tiles/cover_hover.png', 'cover-pressed':'tiles/cover_pressed.png',
    'shake-idle':'status/draw_idle.png','shake-hover':'status/draw_hover.png','shake-pressed':'status/draw_pressed.png',
    'charge-frame':'gauge/charge_frame.png','charge-fill':'gauge/charge_fill.png','charge-glint':'gauge/charge_glint.png',
    'refresh-idle':'status/refresh_idle.png','refresh-hover':'status/refresh_hover.png',
    'refresh-pressed':'status/refresh_pressed.png','refresh-disabled':'status/refresh_disabled.png',
    'refresh-white':'fx/board_refresh_white.png',
    'bonus-tag':'fx/bonus_tag.png', pop: sourceAtlas
  };
  for (const [name, path] of Object.entries(surfaces)) stage.style.setProperty('--'+name, cssURL(path));
  for (const img of document.querySelectorAll('[data-file]')) img.src = url(img.dataset.file);

  // 펫과 등급별 재고는 시연용이다. 수동·자동 열기는 하나의 고정된 판을 공유한다.
  const rewards = {
    first:{grade:'1등',name:'유리사',max:1,color:'#f3d397'},
    upper:{grade:'상위',name:'오타니',max:3,color:'#dac2f8'},
    normal:{grade:'일반',name:'요나',max:96,color:'#9fd6f1'}
  };
  const remaining = Object.fromEntries(Object.entries(rewards).map(([type, r]) => [type, r.max]));
  const sample = location.hash === '#sample'
    ? [[12,'normal'],[27,'upper'],[44,'first'],[58,'normal'],[73,'normal'],[86,'normal']]
    : [];
  let prizes = dealBoard(remaining, sample);
  const opened = new Set();
  const cards = [];
  const counters = {};
  let phase = 'idle';
  let charge;
  let chargeFrame = 0;
  let pendingFull = 0;
  let refreshFrame = 0;
  const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  const atlasImage = new Image();
  const atlasLoaded = new Promise(resolve => {
    atlasImage.onload = () => resolve(true);
    atlasImage.onerror = () => resolve(false);
  });
  atlasImage.src = url(sourceAtlas);

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function icon(type) {
    const img = new Image();
    img.src = url('preview/item_'+type+'.png');
    img.alt = '';
    return img;
  }
  function cellName(i) { return String.fromCharCode(65+Math.floor(i/10))+String(i%10+1).padStart(2,'0'); }
  function message(text, bonus=false) { prompt.textContent = text; prompt.classList.toggle('bonus',bonus); }
  function setPhase(next) {
    phase = next;
    stage.dataset.phase = next;
    grid.inert = next !== 'idle';
    action.disabled = next === 'full' || next === 'revealing' || next === 'refreshing' || opened.size === prizes.length;
    resetButton.disabled = next !== 'idle';
  }
  function refresh() {
    const count = prizes.length-opened.size;
    byId('total').textContent = count;
    for (const type of Object.keys(rewards)) counters[type].textContent = remaining[type];
    for (let i=0;i<meter.children.length;i++) meter.children[i].classList.toggle('on',i<count);
    action.textContent = '판 흔들기';
    byId('rule').textContent = count === 0 ? '판 아래의 새로고침으로 다시 시작하세요.' :
      (count < rules.baseCount ? '남은 '+count+'칸을 모두 열어요.' : '기본 '+rules.baseCount+'칸 · 추가 한 칸마다 '+Math.round(rules.bonusChance*100)+'%');
  }
  function openResult(index) {
    if (opened.has(index)) return;
    const type = prizes[index], node = cards[index];
    opened.add(index);
    remaining[type]--;
    node.disabled = true;
    node.dataset.state = 'open';
    node.style.backgroundImage = cssURL('tiles/result_'+type+'.png');
    node.setAttribute('aria-label',cellName(index)+' · '+rewards[type].grade+' '+rewards[type].name);
    node.appendChild(icon(type));
    refresh();
  }
  async function playCell(index, progress, bonus) {
    const node = cards[index], type = prizes[index], xy = cellName(index);
    node.disabled = true;
    message(progress ? progress+' · '+xy : xy+' 열기',bonus);
    const play = !reduceMotion() && await atlasLoaded;
    node.dataset.state = 'opening';
    function reveal() {
      openResult(index);
      message((progress ? progress+' · ' : '')+xy+' '+rewards[type].name+' 획득',bonus);
    }
    if (!play) { reveal(); return; }
    const x=45+(index%10)*86, y=45+Math.floor(index/10)*86;
    const fx = el('div','pop');
    fx.style.left=(x-40)+'px'; fx.style.top=(y-40)+'px';
    effects.appendChild(fx);
    let tag;
    if (bonus) {
      tag=el('span','bonus-tag');
      tag.style.left=(x+40)+'px'; tag.style.top=(y-20)+'px';
      effects.appendChild(tag);
    }
    return new Promise(resolve => {
      const start=performance.now();
      let visible=false;
      function step(now) {
        const frame=Math.max(0,Math.floor((now-start)/rules.frameMs));
        if (frame>=rules.revealFrame && !visible) { reveal(); visible=true; }
        if (frame>=rules.frameCount) {
          fx.remove();
          if (tag) tag.remove();
          resolve();
          return;
        }
        fx.style.backgroundPosition=(-160*(frame%6))+'px '+(-160*Math.floor(frame/6))+'px';
        requestAnimationFrame(step);
      }
      step(start);
    });
  }
  async function manual(index) {
    if (phase!=='idle' || opened.has(index)) return;
    setPhase('revealing');
    try { await playCell(index,'',false); }
    finally { setPhase('idle'); }
  }
  async function release() {
    if (phase!=='full') return;
    pendingFull=0;
    setPhase('revealing');
    chargeLayer.hidden=true;
    board.style.transform='';
    const available = prizes.map((_,i)=>i).filter(i=>!opened.has(i));
    const batch = planShake(available);
    try {
      for (const [i,index] of batch.indices.entries()) {
        const extra = i >= batch.baseCount;
        const label = extra ? '추가 +'+(i-batch.baseCount+1) : '기본 '+(i+1)+'/'+batch.baseCount;
        await playCell(index,label,extra);
        if (reduceMotion() && i+1<batch.indices.length) await new Promise(resolve=>setTimeout(resolve,110));
      }
      const bonus=batch.indices.length-batch.baseCount;
      message('완료 · 기본 '+batch.baseCount+'칸'+(bonus?' + 추가 '+bonus+'칸':''),bonus>0);
    } finally { setPhase('idle'); }
  }
  function updateCharge(tap=false) {
    if (phase!=='charging') return;
    const now=performance.now();
    const p=advanceCharge(charge, now, tap);
    const value=Math.floor(p*100+1e-8);
    percent.textContent=value;
    chargeBar.setAttribute('aria-valuenow',String(value));
    fill.style.clipPath='inset(0 '+((1-p)*100)+'% 0 0)';
    glint.style.transform='translateX('+(500*p)+'px)';
    glint.style.opacity=p>0?'1':'0';
    if (!reduceMotion()) {
      const pose=boardPose(charge);
      board.style.transform='translate('+pose.x+'px,'+pose.y+'px) rotate('+pose.degrees+'deg)';
    }
    if (p>=1) {
      setPhase('full');
      cancelAnimationFrame(chargeFrame);
      board.style.transform='';
      byId('charge-title').textContent='충전 완료';
      byId('charge-hint').textContent='미개봉 칸을 자동으로 열어요';
      pendingFull=setTimeout(release,rules.fullHoldMs);
    }
  }
  function chargeLoop() {
    updateCharge();
    if (phase==='charging') chargeFrame=requestAnimationFrame(chargeLoop);
  }
  function startShake() {
    if (phase!=='idle') return;
    if (opened.size===prizes.length) return;
    setPhase('charging');
    charge=startCharge(performance.now());
    byId('charge-title').textContent='판 흔드는 중';
    byId('charge-hint').textContent='연속 클릭하면 더 빨리 차요';
    message('게이지를 채우면 자동으로 뽑아요.');
    chargeLayer.hidden=false;
    chargeLoop();
  }
  function replaceBoard() {
    for (const [type, reward] of Object.entries(rewards)) remaining[type] = reward.max;
    prizes = dealBoard(remaining);
    opened.clear();
    for (const [i, tile] of cards.entries()) {
      tile.replaceChildren();
      tile.disabled = false;
      tile.style.backgroundImage = '';
      tile.dataset.state = 'closed';
      tile.setAttribute('aria-label', cellName(i)+' 뽑기');
    }
    effects.replaceChildren();
    refresh();
    message('새 판이 준비됐어요.');
  }
  function startRefresh() {
    if (phase !== 'idle') return;
    setPhase('refreshing');
    message('새 판을 준비하고 있어요.');
    refreshVeil.hidden = false;
    refreshVeil.style.opacity = '0';
    const start = performance.now();
    const finish = rules.refreshFadeInMs + rules.refreshWhiteHoldMs + rules.refreshFadeOutMs + rules.refreshClearHoldMs;
    let firstWhite = null;
    function paint(now) {
      let elapsed = now - start;
      if (firstWhite === null && elapsed >= rules.refreshFadeInMs) {
        // 한 프레임이 늦어져도 완전 불투명한 흰 프레임을 확보한 뒤 딱 한 번 교체한다.
        firstWhite = now;
        refreshVeil.style.opacity = '1';
        replaceBoard();
      }
      if (firstWhite !== null) elapsed = rules.refreshFadeInMs + now - firstWhite;
      refreshVeil.style.opacity = String(refreshOpacity(elapsed));
      if (elapsed >= finish) {
        refreshVeil.hidden = true;
        refreshFrame = 0;
        setPhase('idle');
        return;
      }
      refreshFrame = requestAnimationFrame(paint);
    }
    paint(start);
  }
  function setup() {
    for (let i=0;i<prizes.length;i++) {
      const tile=el('button','tile');
      tile.type='button'; tile.dataset.state='closed';
      tile.setAttribute('aria-label',cellName(i)+' 뽑기');
      tile.addEventListener('click',()=>manual(i));
      grid.appendChild(tile); cards.push(tile); meter.appendChild(el('span'));
    }
    for (const [type,r] of Object.entries(rewards)) {
      const row=el('li','reward'), rank=el('span','rank',r.grade), count=el('span','count');
      row.style.backgroundImage=cssURL('status/reward_row_'+type+'.png');
      rank.style.color=r.color;
      counters[type]=el('span','',r.max);
      count.append(counters[type],el('span','denominator','/ '+r.max));
      row.append(icon(type),rank,el('span','name',r.name),count);
      byId('rewards').appendChild(row);
    }
    for (const [index] of sample) openResult(index);
    refresh();
    // Capture consumes the tap before a cell or the main button can also process it.
    stage.addEventListener('click',e=>{
      if (phase==='charging') { e.preventDefault(); e.stopPropagation(); updateCharge(true); }
    },true);
    document.addEventListener('keydown',e=>{
      if (phase==='charging' && (e.code==='Space' || e.code==='Enter')) {
        e.preventDefault();
        if (!e.repeat) updateCharge(true);
      }
    });
    action.addEventListener('click',startShake);
    resetButton.addEventListener('click',startRefresh);
    function resize() {
      stage.style.transform='translate(-50%,-50%) scale('+Math.min(innerWidth/1920,innerHeight/1080)+')';
    }
    addEventListener('resize',resize); resize();
    addEventListener('pagehide',e=>{
      if (!e.persisted) { cancelAnimationFrame(chargeFrame); cancelAnimationFrame(refreshFrame); clearTimeout(pendingFull); }
    });
  }
  setup();
})();
