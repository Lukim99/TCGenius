(function () {
  'use strict';
  var A = '/static/assets/account-stage/';
  var WIDE = '(min-width:1100px) and (min-height:600px)';
  var KIND = {
    card: { label: '카드', ticket: '카드 전송기', list: 'cards', rule: '소지품에 있는 카드만 옮길 수 있습니다.' },
    equipment: { label: '장비', ticket: '장비 전송기', list: 'equipment', rule: '장착을 해제한 초월 등급 장비만 옮길 수 있습니다. 잠긴 장비는 목록에 나오지 않습니다.' }
  };
  var STEPS = [['item', '물품'], ['who', '받는 이'], ['confirm', '확인']];

  function h(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    if (tag === 'button') e.type = 'button';
    return e;
  }
  function img(cls, src) {
    var e = h('img', cls);
    e.alt = ''; e.decoding = 'async'; e.draggable = false;
    if (src) e.src = src;
    return e;
  }
  function setSrc(el, src) { if (el.getAttribute('src') !== src) el.setAttribute('src', src || ''); }
  function add(p) { for (var i = 1; i < arguments.length; i++) p.appendChild(arguments[i]); return p; }
  function cardText(node, text) {
    node.textContent = '';
    String(text || '').split(/(할로윈)/).forEach(function (part) {
      node.appendChild(part === '할로윈' ? h('span', 'card-name-halloween', part) : document.createTextNode(part));
    });
    return node;
  }
  function characterName(node, c) {
    node.textContent = '';
    if (c.level != null) node.appendChild(h('small', 'tr-char-lv', 'Lv.' + c.level));
    node.appendChild(h('span', 'tr-char-nick', c.name));
    return node;
  }

  function mount(o) {
    var root = o.root, chars = (o.characters || []).slice(), dead = false, anims = [];
    var equipmentArt = new Map();
    var wide = window.matchMedia(WIDE);
    var S = {
      source: o.initialSourceId, target: null, kind: 'card', item: null, show: null, done: null,
      step: 'item', stepAt: 0, inv: null, load: 'loading', busy: false, error: '', seq: 0, listKey: ''
    };
    if (!chars.some(function (c) { return c.id === S.source; }) && chars[0]) S.source = chars[0].id;

    function gone() { return dead || (o.isAlive && !o.isAlive()); }
    function sound(n, v) { try { if (o.playSound) o.playSound(n, v); } catch (e) { /* 소리 실패는 무시 */ } }
    function rm() { try { return !!(o.reducedMotion && o.reducedMotion()); } catch (e) { return false; } }
    function byId(id) { for (var i = 0; i < chars.length; i++) if (chars[i].id === id) return chars[i]; return null; }
    function sub(c) { return c.cardLabel || ''; }
    function items() { return (S.inv && S.inv[KIND[S.kind].list]) || []; }
    function tickets(k) { return Number(S.inv && S.inv.tickets && S.inv.tickets[k || S.kind]) || 0; }
    function icon(k) { return (S.inv && S.inv.ticketIcons && S.inv.ticketIcons[k || S.kind]) || ''; }
    // 거래 화면처럼 투명 여백을 제외한 실제 장비 그림을 칸에 맞춘다. 원본 파일은 바꾸지 않는다.
    function itemArt(node, it) {
      var src = it.imageUrl || (it.detail && it.detail.iconUrl) || '';
      if (node._artSource === src) return node;
      node._artSource = src; setSrc(node, src);
      if (S.kind !== 'equipment' || !src) return node;
      if (!equipmentArt.has(src)) equipmentArt.set(src, new Promise(function (resolve) {
        var original = new Image();
        original.onload = function () {
          try {
            var probe = document.createElement('canvas'); probe.width = probe.height = 96;
            var ctx = probe.getContext('2d', { willReadFrequently: true }); ctx.drawImage(original, 0, 0, 96, 96);
            var px = ctx.getImageData(0, 0, 96, 96).data, l = 96, t = 96, r = -1, b = -1;
            for (var y = 0; y < 96; y++) for (var x = 0; x < 96; x++) if (px[(y * 96 + x) * 4 + 3] > 28) { l = Math.min(l, x); r = Math.max(r, x); t = Math.min(t, y); b = Math.max(b, y); }
            if (r < l) { resolve(src); return; }
            l = Math.max(0, l - 2); t = Math.max(0, t - 2); r = Math.min(95, r + 2); b = Math.min(95, b + 2);
            var sx = l / 96 * original.naturalWidth, sy = t / 96 * original.naturalHeight;
            var sw = (r - l + 1) / 96 * original.naturalWidth, sh = (b - t + 1) / 96 * original.naturalHeight;
            var scale = Math.min(1, 512 / Math.max(sw, sh));
            probe.width = Math.max(1, Math.round(sw * scale)); probe.height = Math.max(1, Math.round(sh * scale));
            ctx.drawImage(original, sx, sy, sw, sh, 0, 0, probe.width, probe.height);
            resolve(probe.toDataURL('image/png'));
          } catch (_) { resolve(src); }
        };
        original.onerror = function () { resolve(src); }; original.src = src;
      }));
      equipmentArt.get(src).then(function (url) { if (!gone() && node._artSource === src) setSrc(node, url); });
      return node;
    }

    /* 카드는 이름 자체에 성급과 타입이 있으며, 장비만 강화와 초월 단계를 덧붙인다. */
    function meta(it) {
      var d = it && it.detail;
      if (S.kind === 'card' || !d) return '';
      var p = [d.typeLabel, d.transcendStage ? '초월 ' + d.transcendStage + '단계' : d.rarity, '강화 +' + Number(d.level || 0)];
      return p.filter(Boolean).join(' ');
    }
    // 기존 장비 상세의 dexTranscendStageText와 같은 단계 환산 규칙.
    function stageDescription(text, stage) {
      return String(text || '').replace(/([+-]?\d+(?:\.\d+)?)(%?)\s*\((?:초월\s*)?(?:단계당\s*)?([+-]\d+(?:\.\d+)?)(%?)\)/g, function (_, base, unit, delta, deltaUnit) {
        var value = Number(base) + Number(delta) * (stage - 1);
        var decimals = Math.max((base.split('.')[1] || '').length, (delta.split('.')[1] || '').length);
        return (base.charAt(0) === '+' && value >= 0 ? '+' : '') + (decimals ? value.toFixed(decimals).replace(/\.0+$/, '') : String(Math.round(value))) + (unit || deltaUnit);
      });
    }
    function lines(v) {
      if (v == null || v === '' || v === false) return [];
      if (Array.isArray(v)) return v.reduce(function (a, x) { return a.concat(lines(x)); }, []);
      return String(v).split('\n').map(function (s) { return s.replace(/^-\s*/, '').trim(); }).filter(Boolean);
    }
    function sec(box, title, ls, cls) {
      ls = lines(ls);
      if (!ls.length) return;
      var s = h('section', 'tr-sec' + (cls ? ' ' + cls : ''));
      s.appendChild(h('h4', 'tr-h', title));
      ls.forEach(function (t) { s.appendChild(h('p', 'tr-line', t)); });
      box.appendChild(s);
    }

    /* ---------- DOM ---------- */
    var scene = h('div', 'tr-scene');
    var live = h('div', 'tr-sr'); live.setAttribute('aria-live', 'polite');

    function fig(role, label) {
      var b = h('button', 'tr-fig tr-fig-' + role), ring = h('span', 'tr-fig-ring'), im = img('tr-fig-img');
      var name = h('span', 'tr-fig-name'), s = h('span', 'tr-fig-sub');
      add(b, add(ring, im), h('span', 'tr-fig-role', label), name, s);
      b.addEventListener('click', function () { if (!S.busy) setStep('who'); });
      return { el: b, ring: ring, im: im, name: name, sub: s, label: label };
    }
    function setFig(f, c) {
      f.el.classList.toggle('is-empty', !c);
      setSrc(f.im, c ? c.imageUrl : A + 'marker.webp');
      if (c) characterName(f.name, c); else f.name.textContent = '선택 전';
      cardText(f.sub, c ? sub(c) : '');
      f.el.setAttribute('aria-label', f.label + ' ' + (c ? c.name + ' ' + sub(c) : '선택 전') + ', 바꾸기');
    }
    var stage = h('section', 'tr-stage'), figS = fig('src', '보내는 이'), figT = fig('dst', '받는 이');
    var altar = h('div', 'tr-altar'), plate = h('div', 'tr-plate');
    var altarImg = img('tr-altar-img'), altarName = h('p', 'tr-altar-name');
    var dev = img('tr-device');
    add(stage, figS.el, add(altar, add(plate, img('tr-sigil', A + 'sigil.webp'), dev, altarImg), altarName), figT.el);

    var nav = h('nav', 'tr-nav'); nav.setAttribute('aria-label', '전송 단계');
    var navBtns = STEPS.map(function (s, i) {
      var b = h('button', 'tr-step');
      add(b, h('span', 'tr-step-n', String(i + 1)), h('span', '', s[1]));
      b.addEventListener('click', function () { sound('tap', 0.5); setStep(s[0]); });
      nav.appendChild(b);
      return b;
    });

    /* 물품 패널 */
    var pItem = h('section', 'tr-panel tr-p-item'); pItem.setAttribute('aria-label', '옮길 물품');
    var tabs = h('div', 'tr-tabs'), tabEls = {};
    Object.keys(KIND).forEach(function (k) {
      var b = h('button', 'tr-tab'), ic = img('tr-tab-icon'), n = h('span', 'tr-tab-count');
      add(b, ic, add(h('span', 'tr-tab-text'), h('span', 'tr-tab-label', KIND[k].label), n));
      b.addEventListener('click', function () {
        if (S.kind === k) return;
        S.kind = k; S.item = null; S.error = ''; search.value = ''; sound('tap', 0.6);
        render();
      });
      tabEls[k] = { el: b, ic: ic, n: n };
      tabs.appendChild(b);
    });
    var rule = h('p', 'tr-rule');
    var search = h('input', 'tr-search');
    search.type = 'search'; search.placeholder = '이름으로 찾기'; search.setAttribute('aria-label', '물품 이름으로 찾기');
    search.autocomplete = 'off';
    search.addEventListener('input', syncList);
    var state = h('div', 'tr-state'), stateText = h('p', 'tr-state-text'), retry = h('button', 'tr-retry', '다시 불러오기');
    add(state, img('tr-state-sigil', A + 'sigil.webp'), stateText, retry);
    retry.addEventListener('click', function () { sound('tap', 0.6); load(false); });
    var list = h('div', 'tr-list'); list.setAttribute('role', 'group'); list.setAttribute('aria-label', '물품 목록');
    add(pItem, tabs, rule, search, state, list);

    /* 캐릭터 패널 */
    var pWho = h('section', 'tr-panel tr-p-who'); pWho.setAttribute('aria-label', '보내는 이와 받는 이');
    function group(role, title) {
      var g = h('div', 'tr-group'), row = h('div', 'tr-picks');
      row.setAttribute('role', 'group'); row.setAttribute('aria-label', title);
      add(g, h('h3', 'tr-h', title), row);
      var btns = chars.map(function (c) {
        var b = h('button', 'tr-pick');
        add(b, img('tr-pick-img', c.imageUrl), add(h('span', 'tr-pick-text'), characterName(h('span', 'tr-pick-name'), c), cardText(h('span', 'tr-pick-sub'), sub(c))));
        b.addEventListener('click', function () { pick(role, c.id); });
        row.appendChild(b);
        return { el: b, id: c.id };
      });
      return { el: g, btns: btns };
    }
    var gT = group('target', '받는 이'), gS = group('source', '보내는 이');
    var lonely = h('p', 'tr-note', '물품을 받을 다른 캐릭터가 없습니다. 캐릭터를 하나 더 만든 뒤 이용하세요.');
    add(pWho, gT.el, lonely, gS.el);

    /* 확인 패널 */
    var pConf = h('section', 'tr-panel tr-p-confirm'); pConf.setAttribute('aria-label', '전송 내용 확인');
    var confBody = h('div', 'tr-conf');
    add(pConf, h('h3', 'tr-h', '전송 내용'), confBody);

    /* 살펴보기: 고른 물품의 큰 그림과 실제 옵션 */
    var pInsp = h('section', 'tr-panel tr-p-insp'); pInsp.setAttribute('aria-label', '고른 물품 살펴보기');
    var back = h('button', 'tr-back', '목록으로'), inspBody = h('div', 'tr-insp');
    pInsp.tabIndex = -1;
    back.addEventListener('click', function () {
      sound('tap', 0.5); setStep('item');
      var selected = list.querySelector('.tr-item.is-on');
      if (selected) selected.focus({ preventScroll: true });
    });
    add(pInsp, back, inspBody);

    /* 하단 실행부 */
    var foot = h('form', 'tr-foot'); foot.noValidate = true;
    var cost = h('div', 'tr-cost'), costUse = h('span', 'tr-cost-use'), costHave = h('span', 'tr-cost-have');
    add(cost, add(h('span', 'tr-cost-text'), costUse, costHave));
    var msg = h('p', 'tr-msg'); msg.setAttribute('role', 'status');
    var err = h('p', 'tr-err'); err.setAttribute('role', 'alert');
    var go = h('button', 'tr-go'); go.type = 'submit';
    add(foot, cost, add(h('div', 'tr-foot-text'), msg, err), go);
    foot.addEventListener('submit', submit);

    add(scene, stage, nav, pItem, pInsp, pWho, pConf, foot, live);
    root.appendChild(scene);
    var lockable = [nav, pItem, pInsp, pWho, stage];

    /* ---------- 상태 ---------- */
    function setStep(s) { S.step = s; S.stepAt = Date.now(); render(); }

    function pick(role, id) {
      if (S.busy) return;
      if (role === 'target') {
        if (id === S.source) return;
        S.target = id; S.error = ''; sound('tap', 0.7); render();
      } else if (id !== S.source) {
        S.source = id; S.item = null; S.done = null; S.error = '';
        search.value = '';
        if (S.target === id) S.target = null;
        sound('tap', 0.7); load(false);
      }
    }

    function load(silent) {
      var seq = ++S.seq, src = S.source;
      if (!silent) { S.load = 'loading'; S.inv = null; S.item = null; live.textContent = '소지품을 불러오는 중입니다'; }
      render();
      var p;
      try { p = Promise.resolve(o.loadInventory(src)); } catch (e) { p = Promise.reject(e); }
      return p.then(function (inv) {
        if (seq !== S.seq || gone()) return;
        S.inv = inv || {}; S.load = 'ready';
        if (S.item) {
          var tok = S.item.token, found = null;
          items().forEach(function (it) { if (!found && tok != null && it.token === tok) found = it; });
          S.item = found;
        }
        if (!silent) live.textContent = '소지품을 불러왔습니다';
        render();
      }, function () {
        if (seq !== S.seq || gone()) return;
        S.inv = null; S.item = null; S.load = 'error';
        render();
      });
    }

    function reason() {
      var narrow = !wide.matches, K = KIND[S.kind], early = S.step === 'item' || S.step === 'inspect';
      if (S.load === 'loading') return '소지품을 불러오는 중입니다';
      if (S.load === 'error') return '소지품을 불러오지 못했습니다. 물품 단계에서 다시 불러오세요';
      if (!S.item) return narrow && !early ? '물품 단계에서 옮길 물품을 고르세요' : '옮길 물품을 고르세요';
      if (narrow && early) return '';
      if (!S.target) return narrow && S.step !== 'who' ? '받는 이 단계에서 받을 캐릭터를 고르세요' : '받는 이를 고르세요';
      if (narrow && S.step === 'who') return '';
      if (tickets() < 1) return K.ticket + '가 없습니다. ' + K.ticket + '를 얻은 뒤 다시 시도하세요';
      return '';
    }

    /* ---------- 그리기 ---------- */
    function buildList() {
      var key = S.seq + '|' + S.kind + '|' + S.load + '|' + items().length + '|' + (S.inv ? 1 : 0);
      if (key === S.listKey && S.invRef === S.inv) return;
      S.listKey = key; S.invRef = S.inv;
      list.textContent = '';
      items().forEach(function (it) {
        var b = h('button', 'tr-item');
        add(b, add(h('span', 'tr-item-art'), itemArt(img('tr-item-img'), it)), cardText(h('span', 'tr-item-name'), it.name));
        if (meta(it)) b.appendChild(h('span', 'tr-item-meta', meta(it)));
        b._it = it;
        b.addEventListener('click', function () {
          if (S.busy) return;
          S.item = it; S.done = null; S.error = ''; sound('tap', 0.8);
          if (wide.matches) render(); else { setStep('inspect'); pInsp.focus({ preventScroll: true }); }
        });
        list.appendChild(b);
      });
    }
    function syncList() {
      var q = search.value.trim().toLowerCase(), shown = 0, n = list.children.length;
      for (var i = 0; i < n; i++) {
        var b = list.children[i], hit = !q || String(b._it.name || '').toLowerCase().indexOf(q) >= 0;
        b.hidden = !hit; if (hit) shown++;
        var on = b._it === S.item;
        b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
      var text = '', K = KIND[S.kind];
      if (S.load === 'loading') text = '소지품을 불러오는 중입니다';
      else if (S.load === 'error') text = '소지품을 불러오지 못했습니다';
      else if (!n) text = '옮길 수 있는 ' + K.label + '가 없습니다';
      else if (!shown) text = '찾는 이름의 ' + K.label + '가 없습니다';
      state.hidden = !text; stateText.textContent = text;
      state.className = 'tr-state is-' + (S.load === 'ready' ? 'empty' : S.load);
      retry.hidden = S.load !== 'error';
      list.hidden = !n || S.load !== 'ready';
      search.hidden = S.load !== 'ready' || n <= 8;
    }
    function syncWho() {
      gS.btns.forEach(function (b) {
        var on = b.id === S.source;
        b.el.classList.toggle('is-on', on); b.el.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      gT.btns.forEach(function (b) {
        var on = b.id === S.target, self = b.id === S.source;
        b.el.classList.toggle('is-on', on); b.el.setAttribute('aria-pressed', on ? 'true' : 'false');
        b.el.hidden = self;
      });
      lonely.hidden = chars.length > 1;
    }
    function row(dl, k, v, s) {
      var d = h('div', 'tr-row'), dd = h('dd', '', v);
      if (k === '카드') cardText(dd, v);
      if (s) dd.appendChild(cardText(h('span', 'tr-row-sub'), s));
      add(dl, add(d, h('dt', '', k), dd));
    }
    function renderConfirm() {
      confBody.textContent = '';
      var it = S.show || S.item, K = KIND[S.kind], src = byId(S.source), dst = byId(S.target);
      if (!it) { confBody.appendChild(h('p', 'tr-note', S.done ? S.done : '물품과 받는 이를 고르면 이곳에서 내용을 확인합니다.')); return; }
      var dl = h('dl', 'tr-rows');
      row(dl, K.label, it.name, meta(it));
      if (src) row(dl, '보내는 이', src.name, sub(src));
      row(dl, '받는 이', dst ? dst.name : '선택 전', dst ? sub(dst) : '');
      row(dl, '사용', K.ticket + ' 1개', '보유 ' + tickets() + '개');
      confBody.appendChild(dl);
      sec(confBody, '전송 전 확인', it.details, 'is-warn');
    }
    function renderInspect() {
      var it = S.show || S.item;
      if (inspBody._it === it && inspBody._done === S.done && inspBody._kind === S.kind) return; /* 같은 물품이면 다시 그리지 않아 읽던 위치를 지킨다 */
      inspBody._it = it; inspBody._done = S.done; inspBody._kind = S.kind;
      inspBody.textContent = ''; pInsp.scrollTop = 0;
      if (!it) { inspBody.appendChild(h('p', 'tr-note', S.done || '물품을 고르면 이곳에서 그림과 옵션을 살펴봅니다.')); return; }
      var d = it.detail || {}, body = h('div', 'tr-insp-body');
      add(inspBody, add(h('div', 'tr-insp-art'), itemArt(img('tr-insp-img'), it)), body);
      add(body, cardText(h('h3', 'tr-insp-name'), it.name));
      if (meta(it)) body.appendChild(h('p', 'tr-insp-meta', meta(it)));
      sec(body, '전송 전 확인', it.details, 'is-warn');
      if (S.kind === 'card') return;
      var art = d.artifact, pot = d.potentialDisplay, set = d.setInfo, setName = d.setName || (set && set.name);
      if (art && (art.options || []).length) sec(body, '아티팩트 옵션', art.options.map(function (x) {
        return (x.conditionPrefix || '') + (x.conditionValue || '') + (x.conditionSuffix || '') + ' ' + x.abilityLabel + ' +' + x.n + '%' + (x.active === false ? ' (비활성)' : '');
      }).concat('재설정 ' + Math.max(0, Number(art.maxRerolls || 3) - Number(art.rerollsUsed || 0)) + '회 남음'));
      sec(body, '능력치', d.statLines);
      if (d.soul && d.soul.name) sec(body, '영혼', d.soul.name);
      if (pot && (pot.entries || []).length) sec(body, '잠재 ' + (pot.tierLabel || ''), pot.entries.map(function (e) { return (e.gradeLabel ? e.gradeLabel + ' ' : '') + e.text; }));
      else sec(body, '잠재', d.potentialLines);
      var description = stageDescription(d.description, Number(d.transcendStage) || 1), passive = d.passive;
      if (description || passive) sec(body, passive && passive.name ? '고유 효과 ' + passive.name : '고유 효과', [description || passive.desc,
        passive && Number(passive.cooltime) > 0 ? '재사용 ' + (passive.cooltime % 60000 === 0 ? passive.cooltime / 60000 + '분' : Math.round(passive.cooltime / 1000) + '초') : '']);
      if (setName) sec(body, setName + ' 세트', set && (set.tiers || []).length ? set.tiers.map(function (t) { return t.tier + '세트 ' + t.description; }) : '세트 장비');
    }
    function render() {
      if (dead) return;
      var K = KIND[S.kind], it = S.show || S.item, narrow = !wide.matches;
      if (S.step === 'inspect' && !it) S.step = 'item';
      scene.setAttribute('data-step', S.step);
      scene.classList.toggle('is-busy', S.busy);
      scene.classList.toggle('tr-rm', rm());
      setFig(figS, byId(S.source)); setFig(figT, byId(S.target));
      altar.classList.toggle('is-empty', !it);
      altarImg.hidden = !it; if (it) itemArt(altarImg, it);
      dev.hidden = !icon(); if (icon()) setSrc(dev, icon());
      plate.classList.toggle('is-bare', !icon());
      if (it) cardText(altarName, it.name); else altarName.textContent = S.done || '옮길 물품을 고르세요';
      altarName.classList.toggle('is-done', !it && !!S.done);
      navBtns.forEach(function (b, i) {
        var s = STEPS[i][0];
        if (s === S.step || (s === 'item' && S.step === 'inspect')) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
        b.classList.toggle('is-set', s === 'item' ? !!S.item : s === 'who' ? !!S.target : false);
      });
      Object.keys(tabEls).forEach(function (k) {
        var t = tabEls[k], on = k === S.kind;
        t.el.classList.toggle('is-on', on); t.el.setAttribute('aria-pressed', on ? 'true' : 'false');
        t.ic.hidden = !icon(k); if (icon(k)) setSrc(t.ic, icon(k));
        t.n.textContent = S.inv ? '전송기 ' + tickets(k) + '개' : '';
      });
      rule.textContent = K.rule + ' ' + K.ticket + ' 1개를 쓰며, 거래권은 쓰지 않습니다.';
      buildList(); syncList(); syncWho(); renderConfirm(); renderInspect();
      costUse.textContent = K.ticket + ' 1개 사용';
      costHave.textContent = S.inv ? '보유 ' + tickets() + '개' : '';
      cost.classList.toggle('is-short', !!S.inv && tickets() < 1);
      var why = S.busy ? '' : reason();
      msg.textContent = S.busy ? '전송하는 중입니다. 잠시 기다려 주세요' : why;
      err.textContent = S.error; err.hidden = !S.error;
      var label = '전송하기';
      if (S.busy) label = '전송 중';
      else if (narrow && (S.step === 'item' || S.step === 'inspect')) label = '받는 이 고르기';
      else if (narrow && S.step === 'who') label = '내용 확인하기';
      else if (S.error) label = '다시 전송하기';
      go.textContent = label;
      go.setAttribute('aria-disabled', S.busy || why ? 'true' : 'false');
      go.classList.toggle('is-final', !narrow || S.step === 'confirm');
      lockable.forEach(function (el) { el.inert = S.busy; });
    }

    /* ---------- 전송 ---------- */
    function setBusy(b) { S.busy = b; try { if (o.onBusy) o.onBusy(b); } catch (e) { /* 호출자 오류 무시 */ } }

    function submit(e) {
      e.preventDefault();
      if (S.busy || gone()) return;
      if (reason()) { sound('deny', 0.6); return; }
      if (!wide.matches && S.step !== 'confirm') {
        sound('tap', 0.7); setStep(S.step === 'who' ? 'confirm' : 'who'); return;
      }
      if (Date.now() - S.stepAt < 400) return; /* 단계 전환 직후의 연속 입력은 확정으로 보지 않음 */
      var item = S.item, kind = S.kind, dst = byId(S.target);
      var req = { sourceId: S.source, targetId: S.target, kind: kind, index: item.index, itemToken: item.token };
      S.error = ''; S.done = null;
      setBusy(true); render(); sound('tap', 0.9);
      var p;
      try { p = Promise.resolve(o.transferItem(req)); } catch (ex) { p = Promise.reject(ex); }
      p.then(function () {
        if (gone()) return;
        S.show = item;
        var re = load(true);
        return Promise.all([ceremony().catch(function () {}), re]).then(function () {
          if (gone()) return;
          S.show = null;
          S.done = '전송 완료. ' + (dst ? dst.name : '') + '에게 보냈습니다';
          live.textContent = item.name + ' 전송 완료. 받는 이 ' + (dst ? dst.name + ' ' + sub(dst) : '');
          if (!S.item) S.step = 'item';
        });
      }, function (ex) {
        if (gone()) return;
        S.error = (ex && ex.message) || '전송하지 못했습니다. 다시 시도해 주세요';
        sound('deny', 0.8);
        if (ex && ex.status === 409) { S.step = 'item'; return load(false); }
      }).then(function () {
        S.show = null; clearFx();
        if (dead) return;
        setBusy(false); S.stepAt = Date.now(); render();
      });
    }

    /* ---------- 의식 연출 ---------- */
    function play(el, kf, opt) {
      if (dead || !el.animate) return Promise.resolve();
      var a = el.animate(kf, opt); anims.push(a);
      return new Promise(function (res) { a.onfinish = res; a.oncancel = res; });
    }
    function box(el) {
      var r = el.getBoundingClientRect(), s = scene.getBoundingClientRect();
      return { x: r.left - s.left, y: r.top - s.top, w: r.width, h: r.height, cx: r.left - s.left + r.width / 2, cy: r.top - s.top + r.height / 2 };
    }
    function ghost(node, b) {
      node.classList.add('tr-fx');
      node.style.cssText = 'left:' + b.x + 'px;top:' + b.y + 'px;width:' + b.w + 'px;height:' + b.h + 'px';
      scene.appendChild(node);
      return node;
    }
    function clearFx() {
      anims.forEach(function (a) { try { a.cancel(); } catch (e) { /* 이미 끝남 */ } });
      anims = [];
      Array.prototype.slice.call(scene.querySelectorAll('.tr-fx')).forEach(function (n) { n.remove(); });
      scene.classList.remove('is-casting'); figT.el.classList.remove('is-got');
      altarImg.style.visibility = '';
    }
    function ceremony() {
      scene.classList.add('is-casting');
      if (rm()) {
        sound('coin', 0.8); figT.el.classList.add('is-got');
        return play(altarImg, [{ opacity: 1 }, { opacity: 0.15 }], { duration: 700, fill: 'forwards' });
      }
      /* 1 장치 충전과 물품의 빛 응축, 2 빛줄기 비행, 3 받는 이 앞에서 재구성 후 흡수 */
      var a = box(altarImg), t = box(figT.ring), tx = t.cx, ty = t.y + t.h * 0.45;
      if (!a.w || !t.w) { sound('coin', 0.8); figT.el.classList.add('is-got'); return Promise.resolve(); }
      play(dev, [
        { transform: 'scale(1.38)', filter: 'brightness(1)' },
        { transform: 'scale(1.45)', filter: 'brightness(1.7)', offset: 0.7 },
        { transform: 'scale(1.38)', filter: 'brightness(1.1)' }
      ], { duration: 1000, easing: 'ease-in-out' });
      return play(altarImg, [
        { transform: 'translate(-50%,-50%) scale(1)', filter: 'brightness(1)' },
        { transform: 'translate(-50%,-60%) scale(1.2)', filter: 'brightness(1.5)', offset: 0.55 },
        { transform: 'translate(-50%,-60%) scale(.04,1.6)', filter: 'brightness(4)' }
      ], { duration: 780, easing: 'cubic-bezier(.5,0,.3,1)', fill: 'forwards' }).then(function () {
        if (dead) return;
        altarImg.style.visibility = 'hidden';
        var dx = tx - a.cx, dy = ty - a.cy, lift = Math.max(40, Math.abs(dx) * 0.35), kf = [], dots = [];
        for (var i = 0; i <= 10; i++) {
          var u = i / 10, pos = 'translate(' + dx * u + 'px,' + (dy * u - 4 * lift * u * (1 - u)) + 'px) ';
          kf.push({ transform: pos + 'scale(' + (1 + Math.sin(u * Math.PI) * 0.9) + ')' });
          dots.push({ transform: pos + 'scale(' + (1 - u * 0.6) + ')', opacity: i === 0 || i === 10 ? 0 : 0.9 });
        }
        var T = { duration: 660, easing: 'cubic-bezier(.6,0,.3,1)', fill: 'forwards' };
        for (var d = 1; d <= 8; d++) {
          var sp = ghost(h('span', 'tr-fx-spark'), { x: a.cx - 4, y: a.cy - 4, w: 8, h: 8 });
          sp.style.opacity = '0';
          play(sp, dots, { duration: 660, delay: d * 38, easing: T.easing, fill: 'forwards' });
        }
        var orb = ghost(h('span', 'tr-fx-orb'), { x: a.cx - 12, y: a.cy - 12, w: 24, h: 24 });
        sound('whoosh', 0.9);
        return play(orb, kf, T).then(function () { orb.remove(); });
      }).then(function () {
        if (dead) return;
        scene.classList.remove('is-casting');
        figT.el.classList.add('is-got'); sound('coin', 0.9);
        var w = Math.max(44, Math.min(a.w, t.w * 0.7)), hh = w * a.h / a.w;
        var g = ghost(img('tr-fx-item', altarImg.getAttribute('src')), { x: tx - w / 2, y: ty - hh / 2, w: w, h: hh });
        return play(g, [
          { transform: 'scale(.04,1.6)', filter: 'brightness(4)', opacity: 1 },
          { transform: 'scale(1.14)', filter: 'brightness(1.4)', opacity: 1, offset: 0.28 },
          { transform: 'scale(1)', filter: 'brightness(1)', opacity: 1, offset: 0.7 },
          { transform: 'translateY(16px) scale(.3)', filter: 'brightness(2.4)', opacity: 0 }
        ], { duration: 1300, easing: 'ease-out', fill: 'forwards' }).then(function () { g.remove(); });
      });
    }

    /* ---------- 시작과 정리 ---------- */
    function onMedia() { render(); }
    if (wide.addEventListener) wide.addEventListener('change', onMedia); else if (wide.addListener) wide.addListener(onMedia);
    load(false);

    return {
      destroy: function () {
        if (dead) return;
        clearFx();
        dead = true; S.seq++;
        equipmentArt.clear();
        if (wide.removeEventListener) wide.removeEventListener('change', onMedia); else if (wide.removeListener) wide.removeListener(onMedia);
        if (S.busy) { S.busy = false; try { if (o.onBusy) o.onBusy(false); } catch (e) { /* 무시 */ } }
        if (scene.parentNode) scene.parentNode.removeChild(scene);
      }
    };
  }

  window.RPGTransferScene = { mount: mount };
})();
