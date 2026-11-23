/* 게임 화면 머리줄: 오른쪽 계정 조작을 계정 아이콘 하나로 모은다.
   포인트 잔액과 충전, OTP, 관리자, 로그아웃은 게임이 만든 원래 단추(#pointAmount, #pointAddBtn, #otpBtn, #adminLink, #logout)를
   그대로 계정 창 안으로 옮겨 쓴다. 그래서 충전, 인증, 로그아웃 동작은 app.js가 붙인 그대로다.
   골드, 가넷, 오늘 사냥 골드 한도는 GET /api/characters에서만 읽고, 주기적으로 묻지 않는다.
   게임이 상태를 다시 그릴 때(#pointAmount 갱신)와 창을 열 때만 새로 읽는다. */
(function () {
  'use strict';
  const doc = document;
  const bar = doc.querySelector('header .bar');
  if (!bar || doc.getElementById('agAccount')) return;
  const byId = id => doc.getElementById(id);
  const pointPill = byId('pointPill'), pointAmount = byId('pointAmount'), pointAdd = byId('pointAddBtn');
  const who = byId('who'), otp = byId('otpBtn'), admin = byId('adminLink'), logout = byId('logout');

  if (!doc.querySelector('link[href*="account-gameplay.css"]')) {
    const link = doc.createElement('link');
    link.rel = 'stylesheet'; link.href = '/static/account-gameplay.css';
    doc.head.appendChild(link);
  }

  function el(tag, cls, text) {
    const node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = String(text);
    return node;
  }
  const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const comma = v => num(v).toLocaleString('ko-KR');
  function icon(name) {
    const img = el('img', 'ag-ico');
    img.alt = '';
    img.addEventListener('error', () => img.remove());
    img.src = '/item-image?dir=' + encodeURIComponent('화폐') + '&file=' + encodeURIComponent(name + '.png');
    return img;
  }
  const PERSON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><circle cx="12" cy="8.2" r="3.9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M4.4 20.2c.8-4.1 3.7-6.3 7.6-6.3s6.8 2.2 7.6 6.3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

  /* 머리줄에는 계정 아이콘 하나만 남긴다. */
  const button = el('button', 'ag-account');
  button.id = 'agAccount'; button.type = 'button';
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-controls', 'agPanel');
  button.setAttribute('aria-label', '계정 메뉴');
  button.innerHTML = PERSON;
  const buttonBar = el('i', 'ag-account-bar');
  buttonBar.hidden = true;
  button.appendChild(buttonBar);
  bar.appendChild(button);

  /* 계정 창 */
  const panel = el('section', 'ag-panel');
  panel.id = 'agPanel'; panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', '계정');
  panel.tabIndex = -1;

  const head = el('div', 'ag-head');
  const badge = el('span', 'ag-badge');
  badge.innerHTML = PERSON;
  const names = el('div', 'ag-names');
  if (who) { who.classList.add('ag-who'); names.appendChild(who); }
  const account = el('span', 'ag-account-name');
  names.appendChild(account);
  const closeButton = el('button', 'ag-close', '닫기');
  closeButton.type = 'button';
  head.appendChild(badge); head.appendChild(names); head.appendChild(closeButton);
  panel.appendChild(head);

  const rows = el('dl', 'ag-rows'), values = {};
  [['gold', '골드'], ['garnet', '가넷'], ['point', '포인트']].forEach(row => {
    const term = el('dt');
    term.appendChild(icon(row[1])); term.appendChild(doc.createTextNode(row[1]));
    const value = el('dd');
    if (row[0] == 'point' && pointAmount) {
      // 포인트는 게임이 실시간으로 고치는 원래 숫자와 원래 충전 단추를 그대로 쓴다.
      value.appendChild(pointAmount);
      // 충전은 원래의 + 단추 그대로다(이름표, 누르면 열리는 충전 창 모두 app.js가 정한 대로).
      if (pointAdd) value.appendChild(pointAdd);
    } else { values[row[0]] = el('b', '', '…'); value.appendChild(values[row[0]]); }
    rows.appendChild(term); rows.appendChild(value);
  });
  panel.appendChild(rows);
  if (pointPill) pointPill.remove();

  const cap = el('div', 'ag-cap');
  cap.hidden = true;
  const capHead = el('div', 'ag-cap-head');
  capHead.appendChild(el('strong', '', '오늘 사냥 골드'));
  const capValue = el('span', 'ag-cap-value', '…');
  capHead.appendChild(capValue);
  const meter = el('div', 'ag-meter');
  meter.setAttribute('role', 'progressbar');
  meter.setAttribute('aria-label', '오늘 사냥 골드 한도 사용량');
  meter.setAttribute('aria-valuemin', '0');
  const meterFill = el('i');
  meter.appendChild(meterFill);
  const capLeft = el('p', 'ag-cap-left');
  const notes = el('ul', 'ag-notes');
  const noteLevel = el('li');
  [el('li', '', '계정의 모든 캐릭터가 함께 쓰는 한도입니다.'), el('li', '', '보너스가 붙기 전의 기본 사냥 골드로 셉니다.'), el('li', '', '매일 자정(한국 시간)에 초기화됩니다.'), noteLevel].forEach(n => notes.appendChild(n));
  cap.appendChild(capHead); cap.appendChild(meter); cap.appendChild(capLeft); cap.appendChild(notes);
  panel.appendChild(cap);

  const status = el('p', 'ag-status');
  status.setAttribute('role', 'status');
  panel.appendChild(status);

  const menu = el('div', 'ag-menu');
  const toChars = el('a', 'ag-item ag-item-main', '캐릭터 선택'); toChars.id = 'agChars'; toChars.href = '/characters';
  const toSupport = el('a', 'ag-item', '서포트 슬롯 연결'); toSupport.href = '/characters#links';
  menu.appendChild(toChars); menu.appendChild(toSupport);
  // 게임이 만든 단추를 그대로 옮긴다. 눌렀을 때 하는 일은 app.js가 붙인 그대로다.
  function adopt(node, label) {
    if (!node) return;
    node.style.padding = ''; node.style.fontSize = '';
    node.classList.remove('primary');
    node.classList.add('ag-item');
    if (label) node.textContent = label;
    menu.appendChild(node);
  }
  adopt(otp, '2단계 인증(OTP)');
  adopt(admin, '관리자');
  adopt(logout, '로그아웃');
  if (logout) logout.classList.add('ag-item-out');
  panel.appendChild(menu);
  doc.body.appendChild(panel);

  /* 값 읽기 */
  let loading = null, loadedAt = 0, queued = 0;
  function paint(data) {
    const wallet = data.wallet || {}, limit = data.goldCap || null;
    values.gold.textContent = comma(wallet.gold);
    values.garnet.textContent = comma(wallet.garnet);
    if (values.point) values.point.textContent = comma(wallet.point);
    account.textContent = data.accountName ? '계정 ' + data.accountName : '';
    const has = limit && num(limit.limit) > 0;
    cap.hidden = !has;
    buttonBar.hidden = !has;
    if (has) {
      const used = num(limit.used), max = num(limit.limit), ratio = Math.max(0, Math.min(1, used / max));
      const left = Number.isFinite(Number(limit.remaining)) ? num(limit.remaining) : Math.max(0, max - used);
      capValue.textContent = comma(used) + ' / ' + comma(max);
      capLeft.textContent = left > 0 ? '남은 한도 ' + comma(left) : '오늘 한도를 모두 썼습니다. 사냥 골드는 자정 이후에 다시 들어옵니다.';
      capLeft.classList.toggle('is-out', left <= 0);
      noteLevel.textContent = '한도는 계정에서 레벨이 가장 높은 캐릭터(지금 Lv.' + comma(limit.level) + ') 기준입니다.';
      meterFill.style.transform = 'scaleX(' + ratio.toFixed(4) + ')';
      buttonBar.style.setProperty('--fill', ratio.toFixed(4));
      button.classList.toggle('is-out', left <= 0);
      meter.setAttribute('aria-valuemax', String(max));
      meter.setAttribute('aria-valuenow', String(used));
      meter.setAttribute('aria-valuetext', comma(used) + ' / ' + comma(max));
    }
    status.textContent = '';
  }
  function load() {
    if (loading) return loading;
    loading = fetch('/api/characters', { credentials: 'same-origin', cache: 'no-store' })
      .then(res => res.json().catch(() => null).then(data => {
        if (!res.ok) throw new Error(data && typeof data.error == 'string' && data.error ? data.error : '계정 정보를 불러오지 못했습니다.');
        return data || {};
      }))
      .then(data => { loadedAt = Date.now(); paint(data); }, err => {
        status.textContent = (err && err.message && !/fetch/i.test(err.message) ? err.message : '서버에 닿지 못했습니다.') + ' 창을 다시 열면 새로 읽습니다.';
      })
      .then(() => { loading = null; });
    return loading;
  }
  // 게임이 상태를 다시 그릴 때마다 따라 읽되, 15초 안에는 한 번만 읽는다.
  function soon() {
    if (queued) return;
    const wait = Math.max(800, 15000 - (Date.now() - loadedAt));
    queued = setTimeout(() => { queued = 0; if (!doc.hidden) load(); }, wait);
  }
  if (pointAmount && window.MutationObserver) new MutationObserver(soon).observe(pointAmount, { childList: true, characterData: true, subtree: true });
  doc.addEventListener('visibilitychange', () => { if (!doc.hidden && Date.now() - loadedAt > 60000) load(); });

  /* 여닫기 */
  function label() {
    const name = who && who.textContent.trim();
    button.setAttribute('aria-label', name ? '계정 메뉴, ' + name : '계정 메뉴');
  }
  function place() {
    const header = doc.querySelector('header');
    const box = (header || button).getBoundingClientRect(), anchor = button.getBoundingClientRect();
    const top = Math.max(8, Math.round(box.bottom + 6));
    panel.style.top = top + 'px';
    panel.style.maxHeight = Math.max(160, window.innerHeight - top - 8) + 'px';
    const right = Math.max(8, Math.round(window.innerWidth - anchor.right));
    panel.style.right = Math.min(right, Math.max(8, window.innerWidth - 8 - panel.offsetWidth)) + 'px';
  }
  function focusables() { return Array.from(panel.querySelectorAll('a[href],button:not(:disabled)')).filter(n => n.offsetParent !== null); }
  function open() {
    panel.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    label(); place();
    panel.focus({ preventScroll: true });
    load();
  }
  function close(refocus) {
    if (panel.hidden) return;
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (refocus) button.focus();
  }
  button.addEventListener('click', () => { if (panel.hidden) open(); else close(true); });
  closeButton.addEventListener('click', () => close(true));
  panel.addEventListener('keydown', ev => {
    if (ev.key == 'Escape') { ev.stopPropagation(); close(true); return; }
    if (ev.key != 'Tab') return;
    const items = focusables();
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (ev.shiftKey && (doc.activeElement == first || doc.activeElement == panel)) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && doc.activeElement == last) { ev.preventDefault(); first.focus(); }
  });
  // 창 안의 단추(충전, OTP, 관리자, 로그아웃)를 누르면 그 일이 시작되므로 창은 접는다.
  [pointAdd, otp, admin, logout].forEach(node => { if (node) node.addEventListener('click', () => close(false)); });
  doc.addEventListener('pointerdown', ev => { if (!panel.hidden && !panel.contains(ev.target) && !button.contains(ev.target)) close(false); });
  panel.addEventListener('focusout', ev => { if (ev.relatedTarget && !panel.contains(ev.relatedTarget) && ev.relatedTarget != button) close(false); });
  window.addEventListener('resize', () => { if (!panel.hidden) place(); });

  label();
  load();
})();
