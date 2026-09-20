// 기존 모달·카드·색상 체계를 사용하는 플레이 편의 기능.
let gameHomeState = null;
let fishingRefreshTimer = null;
let fishingRequest = 0;

async function refreshGameHome() {
    gameHomeState = await api('/api/game/state');
    renderGameHome(gameHomeState);
}

function renderGameHome(state) {
    const root = $('#gameHome');
    if (!root) return;
    window.HAS_PARTY = state.canPartyQuest;
    const start = state.needsStarter ? el('div', { class: 'game-start' },
        el('div', null, el('strong', null, '함께할 첫 캐릭터를 선택하세요'), el('p', null, '캐릭터를 선택하면 초보자 키트를 받습니다.')),
        el('button', { type: 'button', class: 'primary', onclick: openStarterSelection }, '캐릭터 선택')) : null;
    root.replaceChildren(...(start ? [start] : []),
        el('div', { class: 'game-home-head' }, el('h2', null, '오늘의 플레이'), el('span', null, '출석은 매일 자정에 초기화됩니다.')),
        el('div', { class: 'game-home-actions' },
            el('button', { type: 'button', class: state.attended ? '' : 'primary', disabled: state.attended || state.needsStarter,
                onclick: e => runGameAction('/api/game/attendance', {}, e.currentTarget) }, state.attended ? '출석 완료' : '출석체크'),
            el('button', { type: 'button', disabled: state.needsStarter, onclick: openCouponModal }, '쿠폰 등록'),
            el('button', { type: 'button', disabled: state.needsStarter, onclick: () => activatePage('낚시') }, state.fishing.active ? '낚시 중 · 살림망 확인' : '낚시')));
}

async function runGameAction(url, body, button, options = {}) {
    if (button) button.disabled = true;
    try {
        const result = await postApi(url, body);
        if (result.profile) renderProfile(result.profile);
        if (result.state) { gameHomeState = result.state; renderGameHome(result.state); }
        if (options.close) closeModal();
        if (pageIsActive('inventory')) await loadInventory(currentInventoryKind);
        if (pageIsActive('낚시')) await loadFishing(true);
        if (!options.quiet) showGameActionResult(result);
        return result;
    } catch (error) {
        await showAlert(error.message);
        return null;
    } finally { if (button && button.isConnected) button.disabled = false; }
}

async function openStarterSelection() {
    try {
        const data = await api('/api/game/starter-cards');
        if (!data.needsStarter) { await refreshGameHome(); return; }
        const search = el('input', { type: 'search', placeholder: '캐릭터 이름 검색', 'aria-label': '시작 캐릭터 검색' });
        const list = el('div', { class: 'starter-grid' });
        const render = () => {
            const cards = data.cards.filter(c => c.name.toLowerCase().includes(search.value.trim().toLowerCase()));
            list.replaceChildren(...cards.map(card => {
                const button = el('button', { type: 'button', class: 'starter-card' },
                    el('img', { src: card.imageUrl, alt: '', loading: 'lazy' }), el('strong', null, card.name));
                button.onclick = () => {
                    openMainCardModal(card);
                    $('#modalBody').appendChild(el('div', { class: 'row game-actions-row' },
                        el('button', { type: 'button', onclick: openStarterSelection }, '목록으로'),
                        el('button', { type: 'button', class: 'primary', onclick: async e => {
                            const selected = e.currentTarget;
                            selected.disabled = true;
                            if (await showConfirm(card.name + '을(를) 시작 캐릭터로 선택할까요?', '선택')) {
                                await runGameAction('/api/game/starter-card', { name: card.name }, selected, { close: true });
                            } else selected.disabled = false;
                        } }, '이 캐릭터로 시작')));
                };
                return button;
            }));
            if (!cards.length) list.appendChild(el('p', { class: 'empty' }, '검색 결과가 없습니다.'));
        };
        search.oninput = render;
        openRichModal('시작 캐릭터 선택', '카드를 눌러 능력과 스킬을 확인하세요. 최초 한 번 선택할 수 있습니다.', [search, list]);
        render();
    } catch (error) { showAlert(error.message); }
}

function openCouponModal() {
    const input = el('input', { type: 'text', maxLength: 200, autocomplete: 'off', placeholder: '쿠폰 코드 입력', 'aria-label': '쿠폰 코드' });
    const submit = el('button', { type: 'submit', class: 'primary' }, '보상 받기');
    const form = el('form', { class: 'game-form', onsubmit: async e => {
        e.preventDefault();
        if (!input.value.trim() || submit.disabled) return;
        await runGameAction('/api/game/coupon', { code: input.value.trim() }, submit, { close: true });
    } }, el('label', null, '쿠폰 코드', input), submit);
    openRichModal('쿠폰 등록', '보상은 인벤토리에 지급됩니다.', [form]);
    input.focus();
}

function stopFishingRefresh() {
    clearTimeout(fishingRefreshTimer);
    fishingRefreshTimer = null;
    fishingRequest++;
}

async function loadFishing(force = false) {
    clearTimeout(fishingRefreshTimer);
    const request = ++fishingRequest;
    try {
        const data = await api('/api/fishing');
        if (request !== fishingRequest || !pageIsActive('낚시')) return;
        const focused = document.activeElement;
        if (force || !focused || !$('#fishingPanel').contains(focused) || !['INPUT', 'BUTTON'].includes(focused.tagName)) renderFishing(data);
    } catch (error) {
        if (request === fishingRequest && pageIsActive('낚시')) $('#fishingPanel').replaceChildren(el('p', { class: 'err' }, error.message), el('button', { onclick: loadFishing }, '다시 불러오기'));
    } finally {
        if (request === fishingRequest && pageIsActive('낚시')) fishingRefreshTimer = setTimeout(loadFishing, 5000);
    }
}

function gameChoiceChips(label, choices, value, onChange) {
    const root = el('div', { class: 'game-choice-chips', role: 'group', 'aria-label': label });
    root.value = value;
    choices.forEach(choice => {
        const button = el('button', { type: 'button', class: 'game-chip', 'aria-pressed': choice.value === value,
            onclick: () => {
                root.value = choice.value;
                [...root.children].forEach(node => node.setAttribute('aria-pressed', node === button));
                onChange?.(choice.value);
            } }, choice.label);
        root.appendChild(button);
    });
    return root;
}

function renderFishing(data) {
    const root = $('#fishingPanel');
    const previous = root.querySelector('.fishing-bait .game-choice-chips')?.value;
    const selected = data.baits.some(b => b.name === previous) ? previous : data.baits.some(b => b.name === data.bait) ? data.bait : data.baits[0]?.name;
    const bait = gameChoiceChips('낚시 미끼', data.baits.map(b => ({ value: b.name, label: b.name + ' · ' + comma(b.count) + '개' + (b.name === data.bait ? ' · 사용 중' : '') })), selected,
        value => { change.disabled = value === data.bait; });
    if (!data.baits.length) bait.appendChild(el('span', { class: 'game-note' }, '보유한 미끼가 없습니다.'));
    const change = el('button', { type: 'button', class: 'game-button', disabled: !data.baits.length || selected === data.bait,
        onclick: e => runGameAction('/api/fishing/bait', { name: bait.value }, e.currentTarget) }, '미끼 적용');
    const items = el('div', { class: 'fishing-net' }, ...data.items.map(item => el('div', { class: 'fishing-catch' },
        item.iconUrl ? el('img', { src: item.iconUrl, alt: '' }) : null,
        el('span', null, item.name), el('b', null, '×' + comma(item.count)))));
    if (!data.items.length) items.appendChild(el('div', { class: 'empty' }, '아직 살림망이 비어 있습니다. 미끼를 준비하고 낚시를 시작해보세요.'));
    root.replaceChildren(
        el('div', { class: 'game-home-head' }, el('h2', null, '낚시'), el('span', { class: data.active ? 'fishing-active' : '' }, data.active ? '낚시 중' : '대기 중')),
        el('p', { class: 'game-note' }, '자동으로 미끼를 소모해 살림망에 보상을 모읍니다. 살림망이 가득 차거나 미끼가 없으면 멈춥니다.'),
        el('div', { class: 'fishing-summary' },
            el('div', { class: 'kv' }, el('span', null, '사용 중인 미끼'), el('b', null, data.bait + ' · ' + comma(data.baitCount) + '개')),
            el('div', { class: 'kv' }, el('span', null, '살림망'), el('b', null, comma(data.count) + ' / ' + comma(data.capacity)))),
        el('div', { class: 'fishing-capacity', role: 'progressbar', 'aria-label': '살림망 사용량', 'aria-valuenow': data.count, 'aria-valuemax': data.capacity },
            el('i', { style: { width: Math.min(100, data.count / Math.max(1, data.capacity) * 100) + '%' } })),
        el('div', { class: 'game-actions-row' },
            el('button', { type: 'button', class: 'primary', disabled: !data.active && (!data.baitCount || data.count >= data.capacity),
                onclick: e => runGameAction('/api/fishing/' + (data.active ? 'stop' : 'start'), {}, e.currentTarget, { quiet: true }) }, data.active ? '낚시 중단' : '낚시 시작'),
            el('button', { type: 'button', disabled: !data.count, onclick: e => runGameAction('/api/fishing/collect', {}, e.currentTarget) }, '모두 받기')),
        el('div', { class: 'fishing-bait' }, el('span', { class: 'game-field-label' }, '미끼 선택'), bait, change),
        el('p', { class: 'game-note' }, '보상 받기와 미끼 변경은 낚시를 중단합니다. 다른 명령이나 인벤토리 작업을 실행할 때도 낚시가 중단될 수 있습니다.'), items);
}

const INVENTORY_ACTIONS = {
    cards: { label: '판매', action: 'cards-sell', eligible: c => c.salePrice > 0, list: 'cards' },
    equipment: { label: '분해', action: 'equipment-disassemble', eligible: e => !e.equipped && !e.locked, list: 'equipment' },
    pet: { label: '추출', action: 'pets-extract', eligible: p => p.extractable, list: 'pet' }
};

function renderInventoryActions(kind, data) {
    const root = $('#inventoryActions');
    if (!root) return;
    const config = INVENTORY_ACTIONS[kind];
    const own = !!myName && (!currentInventoryName || currentInventoryName === myName);
    root.replaceChildren();
    if (!own || !config) return;
    const available = (data[config.list] || []).filter(config.eligible).length;
    root.appendChild(el('div', { class: 'inventory-action-copy' },
        el('strong', null, kind === 'cards' ? '카드 정리' : kind === 'equipment' ? '장비 정리' : '펫 추출'),
        el('span', null, kind === 'equipment' ? '잠금·장착 장비는 제외됩니다.' : kind === 'pet' ? '사용하지 않는 펫을 재료로 바꾸세요.' : '여러 장을 선택해 한 번에 판매하세요.')));
    root.appendChild(el('button', { type: 'button', class: 'game-button accent', disabled: !available, onclick: () => openInventoryBatch(kind) },
        '선택 ' + config.label, el('span', { class: 'game-button-count' }, comma(available))));
}

async function openInventoryBatch(kind) {
    const config = INVENTORY_ACTIONS[kind];
    try {
        const data = await api('/api/inventory/' + kind);
        const entries = (data[config.list] || []).filter(config.eligible);
        const selected = new Set();
        const gradeOf = entry => kind === 'cards' ? entry.starText : entry.rarity;
        const grades = [...new Set(entries.map(gradeOf))];
        const filter = gameChoiceChips('등급 필터', [{ value: '', label: '전체' }, ...grades.map(grade => ({ value: grade, label: grade }))], '', () => render());
        const list = el('div', { class: 'game-selection-list ' + kind });
        const submit = el('button', { type: 'button', class: 'game-button primary', disabled: true }, '미리보기');
        const summary = el('div', { class: 'game-selection-summary' });
        const visible = () => entries.filter(entry => !filter.value || gradeOf(entry) === filter.value);
        const render = () => {
            list.replaceChildren(...visible().map(entry => {
                const input = el('input', { type: 'checkbox', checked: selected.has(entry.number), onchange: () => {
                    input.checked ? selected.add(entry.number) : selected.delete(entry.number);
                    update();
                } });
                return el('label', { class: 'game-selection-row' }, input,
                    entry.imageUrl || entry.iconUrl ? el('img', { src: entry.imageUrl || entry.iconUrl, alt: '', loading: 'lazy' }) : el('span', { class: 'game-selection-icon', 'aria-hidden': 'true' }, '◇'),
                    el('span', null, el('strong', null, entry.name), el('small', null, gradeOf(entry) + (entry.level ? ' · +' + entry.level : '')), entry.salePrice ? gameGoldAmount(entry.salePrice) : null));
            }));
            if (!visible().length) list.appendChild(el('p', { class: 'empty' }, '선택 가능한 항목이 없습니다.'));
            update();
        };
        const update = () => {
            submit.disabled = !selected.size;
            const gold = entries.filter(entry => selected.has(entry.number)).reduce((sum, entry) => sum + Number(entry.salePrice || 0), 0);
            summary.replaceChildren(el('strong', null, selected.size + '개 선택'),
                kind === 'cards' ? gameGoldAmount(gold) : el('span', null, '예상 보상 확인'));
        };
        submit.onclick = () => previewInventoryAction({ action: config.action, numbers: [...selected], version: entries[0].version }, submit);
        openRichModal('선택 ' + config.label, '대상과 보상을 확인한 후 최종 확정합니다.', [
            filter, el('div', { class: 'game-batch-tools' },
                el('button', { type: 'button', class: 'game-button', onclick: () => { visible().forEach(e => selected.add(e.number)); render(); } }, '보이는 항목 모두 선택'),
                el('button', { type: 'button', class: 'game-button', onclick: () => { selected.clear(); render(); } }, '선택 해제')), list, el('div', { class: 'game-action-footer' }, summary, submit)]);
        render();
    } catch (error) { showAlert(error.message); }
}

async function previewInventoryAction(body, button) {
    if (button) button.disabled = true;
    try {
        const preview = await postApi('/api/inventory/actions/preview', body);
        const label = body.action === 'equipment-disassemble' ? '분해' : body.action === 'pets-extract' ? '추출' : '판매';
        const submit = el('button', { type: 'button', class: 'game-button primary', onclick: () => runGameAction('/api/inventory/actions/confirm', { ...body, token: preview.token }, submit, { close: true }) }, label + '하기');
        openRichModal(label + ' 확인', '확정하기 전에 대상과 보상을 확인해주세요.', [
            gameAssetSection('선택한 대상', preview.targets, 'target'),
            gameAssetSection('예상 획득', preview.rewards, 'reward'),
            el('p', { class: 'game-action-notice' }, '선택한 대상은 소모되며 되돌릴 수 없습니다.'),
            el('div', { class: 'game-confirm-actions' }, el('button', { type: 'button', class: 'game-button', onclick: closeModal }, '취소'), submit)]);
    } catch (error) { showAlert(error.message); }
    finally { if (button && button.isConnected) button.disabled = false; }
}

function gameGoldAmount(amount) {
    const icon = shopCurrNode('gold', 18);
    icon.alt = '골드';
    return el('span', { class: 'game-gold-amount' }, icon, el('b', null, comma(amount)));
}

function gameAssetSection(label, entries, kind = 'reward') {
    if (!entries?.length) return null;
    const currencyKinds = { '골드': 'gold', '가넷': 'garnet', '포인트': 'point', '마일리지': 'mileage' };
    return el('section', { class: 'game-asset-section ' + kind },
        el('div', { class: 'game-section-head' }, el('strong', null, label)),
        el('div', { class: 'game-asset-list' }, ...entries.map(entry => {
            const range = entry.min != null && entry.max !== entry.min;
            const amount = range ? comma(entry.min) + '–' + comma(entry.max) : comma(entry.count ?? entry.min ?? 1);
            const currency = entry.kind === 'currency';
            return el('div', { class: 'game-asset-tile' + (currency ? ' currency' : ''), title: entry.name },
                el('div', { class: 'game-asset-art' },
                    entry.frameUrl && !currency ? el('img', { class: 'game-asset-frame', src: entry.frameUrl, alt: '' }) : null,
                    currency ? shopCurrNode(currencyKinds[entry.name], 48) : entry.iconUrl ? el('img', { class: 'game-asset-icon', src: entry.iconUrl, alt: '' }) : el('span', { 'aria-hidden': 'true' }, '◇')),
                el('strong', { class: 'game-asset-name' }, entry.name),
                entry.detail ? el('span', { class: 'game-asset-detail' }, entry.detail) : null,
                el('b', { class: 'game-asset-amount' }, kind === 'target' ? '×' + amount : '+' + amount));
        })));
}

function gameChangesView(changes, options = {}) {
    const data = changes || {};
    return el('div', { class: 'game-result-details' },
        gameAssetSection(options.rewardsLabel || '획득 보상', data.rewards),
        data.mainCard ? gameAssetSection('현재 메인 카드', [{ name: data.mainCard.name, detail: data.mainCard.starText, iconUrl: data.mainCard.imageUrl, count: 1 }], 'target') : null,
        data.stats?.length ? el('div', { class: 'game-result-stats' }, ...data.stats.map(stat => el('div', null,
            el('span', null, stat.label), el('span', null, el('s', null, comma(stat.before)), el('b', null, comma(stat.after)))))) : null,
        data.effectsChanged ? el('p', { class: 'game-note' }, '캐릭터 효과가 갱신되었습니다. 캐릭터 정보에서 확인할 수 있습니다.') : null);
}

function showGameActionResult(result) {
    const titles = {
        starter: '첫 모험을 시작하세요', attendance: '오늘의 출석 완료', coupon: '쿠폰 보상을 받았어요',
        'cards-sell': '카드 판매 완료', 'items-sell': '아이템 판매 완료', 'equipment-disassemble': '장비 분해 완료',
        'pets-extract': '펫 추출 완료', 'equipment-locked': '장비를 잠갔어요', 'equipment-unlocked': '잠금을 해제했어요',
        'pet-equipped': '펫 장착 완료', 'pet-unequipped': '펫 장착 해제', 'fishing-collect': '살림망 보상 수령',
        'fishing-bait': '미끼 변경 완료', craft: '제작 완료', 'item-use': '아이템 적용 완료'
    };
    const title = titles[result.action] || '처리 완료';
    if (['equipment-locked', 'equipment-unlocked', 'pet-equipped', 'pet-unequipped', 'fishing-bait'].includes(result.action)) {
        document.querySelector('.game-toast')?.remove();
        const toast = el('div', { class: 'game-toast', role: 'status' }, el('span', { 'aria-hidden': 'true' }, '✓'), title);
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2800);
        return;
    }
    openRichModal(title, '', [
        el('div', { class: 'game-result-banner' }, el('span', { 'aria-hidden': 'true' }, '✦'),
            el('p', null, result.targets?.length ? result.targets.reduce((sum, entry) => sum + entry.count, 0) + '개 ' + (result.action === 'equipment-disassemble' ? '분해' : result.action === 'pets-extract' ? '추출' : '판매') + ' 완료' : '보상이 지급되었습니다.'), el('span', { 'aria-hidden': 'true' }, '✦')),
        gameChangesView(result.changes)]);
}

function itemSaleEntry(item) {
    if (!(item.sellPrice > 0) || !item.version || !ownEquipContext()) return null;
    return el('div', { class: 'item-sale-entry' },
        el('span', null, '판매가 ', gameGoldAmount(item.sellPrice), ' / 개'),
        el('button', { type: 'button', class: 'game-button accent', onclick: () => openRichModal('아이템 판매', '판매할 수량을 정하고 예상 골드를 확인하세요.', [
            gameAssetSection('보유 아이템', [{ name: item.name, iconUrl: item.iconUrl, frameUrl: item.frameUrl, count: item.count }], 'target'), itemSaleControls(item)
        ]) }, '판매'));
}

function itemSaleControls(item) {
    if (!(item.sellPrice > 0) || !item.version || !ownEquipContext()) return null;
    const count = el('input', { type: 'number', min: 1, max: item.count, value: 1, step: 1, 'aria-label': '판매 수량' });
    const total = el('strong');
    const minus = el('button', { type: 'button', 'aria-label': '판매 수량 줄이기', onclick: () => setCount(Number(count.value) - 1) }, '−');
    const plus = el('button', { type: 'button', 'aria-label': '판매 수량 늘리기', onclick: () => setCount(Number(count.value) + 1) }, '+');
    const submit = el('button', { type: 'button', class: 'game-button accent', onclick: () => previewInventoryAction({ action: 'items-sell', id: item.id, count: Number(count.value), version: item.version }, submit) }, '판매 미리보기');
    const update = () => {
        const value = Number(count.value);
        const valid = Number.isSafeInteger(value) && value >= 1 && value <= item.count;
        submit.disabled = !valid;
        minus.disabled = value <= 1; plus.disabled = value >= item.count;
        total.replaceChildren(valid ? gameGoldAmount(value * item.sellPrice) : el('span', null, '수량을 확인해주세요'));
    };
    const setCount = value => { count.value = Math.max(1, Math.min(item.count, value || 1)); update(); };
    count.oninput = update;
    update();
    return el('section', { class: 'item-sale-controls' },
        el('div', { class: 'game-section-head' }, el('strong', null, '아이템 판매'), el('span', null, '개당 ', gameGoldAmount(item.sellPrice))),
        el('div', { class: 'item-sale-quantity' },
            el('span', { class: 'game-note' }, '판매 수량'),
            el('div', { class: 'game-quantity-stepper' }, minus, count, plus),
            el('button', { type: 'button', class: 'game-button', onclick: () => setCount(item.count) }, '최대')),
        el('div', { class: 'game-sale-total' }, el('span', null, '예상 획득'), total), submit);
}

function equipmentManagementControls(eq) {
    const toggle = el('button', { type: 'button', class: 'game-button' + (eq.locked ? ' accent' : ''),
        'aria-pressed': !!eq.locked,
        onclick: e => runGameAction('/api/inventory/equipment/lock', { number: eq.number, version: eq.version }, e.currentTarget, { close: true }) },
        svgIcon('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="' + (eq.locked ? 'M8 10V7a4 4 0 0 1 8 0v3' : 'M8 10V7a4 4 0 0 1 8 0') + '"/><path d="M12 14v3"/></svg>'), eq.locked ? '잠금 해제' : '잠금');
    return el('section', { class: 'game-management' },
        el('div', { class: 'game-management-row' }, el('div', { class: 'game-management-copy' },
            el('strong', null, eq.locked ? '잠금 설정됨' : '장비 보호'),
            el('span', null, eq.locked ? '실수로 강화·분해하지 않도록 보호 중입니다.' : '잠그면 강화·분해를 방지합니다.')), toggle),
        !eq.equipped && !eq.locked ? el('div', { class: 'game-management-row' },
            el('div', { class: 'game-management-copy' }, el('strong', null, '장비 분해'), el('span', null, '장비를 소모해 강화석을 얻습니다.')),
            el('button', { type: 'button', class: 'game-button accent', onclick: e => previewInventoryAction({ action: 'equipment-disassemble', numbers: [eq.number], version: eq.version }, e.currentTarget) }, '분해')) : null);
}

async function changePetEquipment(pet, button) {
    button.disabled = true;
    if (!pet.equipped && !(await showConfirm('장착 시 펫의 거래 가능 횟수가 0이 되며, 최초 장착이면 사용 기간이 시작됩니다. 장착할까요?', '장착'))) {
        button.disabled = false;
        return;
    }
    await runGameAction('/api/inventory/pet/' + (pet.equipped ? 'unequip' : 'equip'), { number: pet.number, version: pet.version }, button, { close: true });
}

function addCombineAutoSelect() {
    const clear = $('#combineClear');
    if (!clear) return;
    const previousGrade = $('#combineAutoGrade')?.value;
    $('#combineAutoControls')?.remove();
    const grades = [...new Map(combineState.cards.filter(c => c.combinable).map(c => [c.star, c.starText])).entries()].sort((a, b) => a[0] - b[0]);
    const selectedGrade = grades.some(([, label]) => label === previousGrade) ? previousGrade : grades[0]?.[1];
    const select = gameChoiceChips('자동 선택 카드 등급', grades.map(([, label]) => ({ value: label, label })), selectedGrade);
    select.id = 'combineAutoGrade';
    if (!grades.length) select.appendChild(el('span', { class: 'game-note' }, '조합 가능한 카드가 없습니다.'));
    const button = el('button', { id: 'combineAutoSelect', type: 'button', class: 'game-button accent', onclick: async () => {
        if (combineState.busy || !select.value) return;
        combineState.busy = true;
        button.disabled = true;
        try {
            const data = await postApi('/api/combine/auto-select', { star: select.value });
            combineState.cards = data.cards;
            combineState.slots = data.numbers.map(number => data.cards.find(card => card.number === number));
            combineState.protectIndex = null; combineState.luckyRate = null; combineState.result = null;
            combineState.busy = false;
            renderCombineStage();
        } catch (error) { showAlert(error.message); }
        finally { combineState.busy = false; button.disabled = false; }
    } }, '3장 자동 선택');
    button.disabled = !select.value;
    clear.after(el('div', { id: 'combineAutoControls', class: 'combine-auto-controls' }, el('span', { class: 'game-field-label' }, '자동 선택'), select, button));
}
