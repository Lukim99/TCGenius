(function () {
  'use strict';
  if (window.NicknameColors) return;
  let colors = Object.create(null), pending, refreshed = 0, queued = false, revision = 0;
  const valid = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
  const selector = '[data-nickname], .as-slot-nick, .as-create-owner, .tr-char-nick, #profileName, #who';
  const color = name => Object.hasOwn(colors, name) && valid(colors[name]) ? colors[name] : null;
  function paint(node, name = node.dataset.nickname ?? node.textContent.trim()) {
    const value = color(name);
    node.classList.toggle('rpg-nickname-color', !!value);
    if (value) node.style.setProperty('--nickname-color', value);
    else node.style.removeProperty('--nickname-color');
    return node;
  }
  function mark(node, name) { node.dataset.nickname = name; return paint(node, name); }
  function repaint() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; document.querySelectorAll(selector).forEach(node => paint(node)); });
  }
  async function refresh(force = false) {
    if (pending) return pending;
    if (!force && Date.now() - refreshed < 60000) return;
    const startedAtRevision = revision;
    pending = fetch('/api/characters/nickname-colors', { credentials: 'same-origin' })
      .then(async response => {
        if (!response.ok) return;
        const latest = await response.json();
        if (startedAtRevision !== revision) return;
        colors = latest; refreshed = Date.now(); repaint();
      }).catch(() => {}).finally(() => { pending = null; });
    return pending;
  }
  // 각 캔버스의 닉네임 그리기 지점에서만 호출한다. 카드명과 아이템명에는 적용하지 않는다.
  function draw(ctx, name, render) {
    const value = color(name);
    if (!value) return render();
    ctx.save();
    try { ctx.fillStyle = value; ctx.shadowColor = value; ctx.shadowBlur = 5; render(); }
    finally { ctx.restore(); }
  }
  function node(tag, className, text) {
    const el = document.createElement(tag); el.className = className || '';
    if (text != null) el.textContent = text;
    return el;
  }
  function openEditor(character, onSave) {
    if (!character || document.querySelector('.nc-dialog')) return;
    const previousFocus = document.activeElement, dialog = node('dialog', 'nc-dialog');
    const form = node('form', 'nc-form'), heading = node('h2', '', '닉네임 색상');
    heading.id = 'ncTitle'; dialog.setAttribute('aria-labelledby', heading.id);
    const close = node('button', 'nc-close', '닫기'); close.type = 'button';
    const preview = node('strong', 'nc-preview', character.name);
    const subtitle = node('p', 'nc-caption', '이 캐릭터의 닉네임 색을 자유롭게 변경합니다.');
    const swatches = node('div', 'nc-swatches'); swatches.setAttribute('aria-label', '추천 색상');
    const field = node('label', 'nc-field', '직접 선택');
    const picker = node('input', 'nc-picker'); picker.type = 'color'; picker.setAttribute('aria-label', '닉네임 색 고르기');
    const hex = node('input', 'nc-hex'); hex.type = 'text'; hex.maxLength = 7; hex.spellcheck = false;
    hex.setAttribute('aria-label', '색상 코드'); hex.setAttribute('autocomplete', 'off');
    const status = node('p', 'nc-status'); status.setAttribute('role', 'status');
    const actions = node('div', 'nc-actions'), reset = node('button', '', '기본 색상'), save = node('button', 'nc-save', '적용');
    reset.type = 'button'; save.type = 'submit';
    let chosen = character.nicknameColor || color(character.name), saving = false;
    function select(value) {
      chosen = value;
      picker.value = value || '#FFFFFF'; hex.value = value || '';
      hex.placeholder = '기본 색상'; hex.setCustomValidity(''); status.textContent = '';
      preview.style.color = value || ''; preview.style.textShadow = value ? '0 0 8px ' + value + '80' : '';
      swatches.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.color === value)));
      reset.setAttribute('aria-pressed', String(value === null));
    }
    for (const [value, label] of [['#FFFFFF', '흰색'], ['#FFD780', '금색'], ['#FF9D71', '주황색'], ['#FF809E', '분홍색'], ['#CFADFF', '보라색'], ['#83C7FF', '하늘색'], ['#75E0C3', '청록색'], ['#ABE781', '연두색']]) {
      const button = node('button', 'nc-swatch'); button.type = 'button'; button.dataset.color = value;
      button.style.setProperty('--swatch', value); button.setAttribute('aria-label', label);
      button.addEventListener('click', () => select(value)); swatches.append(button);
    }
    picker.addEventListener('input', () => select(picker.value.toUpperCase()));
    hex.addEventListener('input', () => {
      if (valid(hex.value)) select(hex.value.toUpperCase());
      else hex.setCustomValidity('색상 코드를 #RRGGBB 형식으로 입력해주세요.');
    });
    reset.addEventListener('click', () => select(null));
    close.addEventListener('click', () => dialog.close());
    dialog.addEventListener('keydown', event => event.stopPropagation());
    dialog.addEventListener('close', () => { dialog.remove(); previousFocus?.focus(); });
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (saving) return;
      saving = true; save.disabled = true; save.textContent = '저장 중';
      try {
        const response = await fetch('/api/characters/nickname-color', { method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: character.id, color: chosen }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || '저장하지 못했습니다. 다시 시도해주세요.');
        character.nicknameColor = result.color;
        revision++;
        if (result.color) colors[result.name] = result.color; else delete colors[result.name];
        repaint();
        // 다른 탭에도 알려준다. 색상 선택 중에는 저장 요청을 보내지 않는다.
        try { localStorage.setItem('rpgenius-nickname-color-changed', String(Date.now())); } catch (_) {}
        onSave?.(result); dialog.close();
      } catch (error) { status.textContent = error.message; }
      finally { saving = false; save.disabled = false; save.textContent = '적용'; }
    });
    field.append(picker, hex); actions.append(reset, save);
    form.append(close, heading, preview, subtitle, swatches, field, status, actions);
    dialog.append(form); document.body.append(dialog); select(chosen || null); dialog.showModal();
  }
  window.NicknameColors = { color, mark, paint, draw, refresh, openEditor };
  function start() {
    if (document.body.dataset.screen === 'login') return;
    refresh(); repaint();
    new MutationObserver(repaint).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-nickname'] });
    setInterval(() => { if (!document.hidden) refresh(); }, 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
    window.addEventListener('storage', event => { if (event.key === 'rpgenius-nickname-color-changed') refresh(true); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
