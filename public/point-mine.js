import { sprite } from './point-mine-sprites.js';

const asset = name => '/static/assets/point-mine/' + name;
const number = value => Number(value || 0).toLocaleString('ko-KR');
const percent = chance => (chance * 100).toLocaleString('ko-KR', { maximumFractionDigits: 3 }) + '%';
function node(tag, attrs = {}, ...children) {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
        if (key === 'class') element.className = value;
        else if (key.startsWith('on')) element.addEventListener(key.slice(2), value);
        else if (key === 'disabled') element.disabled = !!value;
        else element.setAttribute(key, value);
    }
    element.append(...children.filter(child => child != null));
    return element;
}
async function request(path, body) {
    const response = await fetch('/api/point-mine' + path, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.error || '광산을 불러오지 못했습니다.'), result, { status: response.status });
    return result;
}

export function mountPointMine(root) {
    let state, busy = false, pending = null, paused = false, view = 'mine', error = '', dialog = null;
    let muted = false;
    try { muted = localStorage.getItem('point-mine-muted') === 'true'; } catch (_) {}
    const sounds = { hit: new Audio(asset('mine-hit.wav')), reward: new Audio(asset('reward.wav')) };
    let soundTimer, resultTimer, minedResult = null, renderedView;
    const selected = new Set();
    const typeOf = pickaxe => state.pickaxeTypes.find(type => type.id === pickaxe?.id);
    const currentTool = () => state.pickaxes.find(tool => tool.uid === state.equippedUid);
    const blocked = () => busy || !!pending || !state.active;
    const button = (text, callback, disabled = false, primary = false) => node('button', { type: 'button', class: primary ? 'pm-button pm-primary' : 'pm-button', disabled: disabled || blocked(), onclick: callback }, text);
    const changeView = id => { view = id; closeDialog(); render(); };
    const durability = tool => node('progress', { max: tool.maxDurability, value: tool.durability, 'aria-label': '곡괭이 내구도' });
    function sound(kind) {
        if (muted || paused) return;
        sounds[kind].currentTime = 0;
        sounds[kind].play().catch(() => {});
    }
    function closeDialog() { if (dialog) { dialog.close(); dialog.remove(); dialog = null; } }
    function openDialog(title, content) {
        closeDialog();
        dialog = node('dialog', { class: 'pm-dialog' }, node('div', { class: 'pm-dialog-head' }, node('h2', {}, title), node('button', { type: 'button', 'aria-label': '닫기', onclick: closeDialog }, '×')), content);
        dialog.addEventListener('click', event => { if (event.target === dialog) closeDialog(); });
        const popup = dialog;
        popup.addEventListener('close', () => { popup.remove(); if (dialog === popup) dialog = null; });
        root.append(dialog); dialog.showModal();
    }
    async function perform(action, values = {}) {
        if (busy) return;
        if (!pending) pending = { action, body: { ...values, requestId: crypto.randomUUID(), revision: state.revision } };
        busy = true; error = ''; closeDialog(); render();
        const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
        const delay = pending.action === 'mine' && !reduced ? state.mineIntervalMs : pending.action === 'open' && !reduced ? 650 : 0;
        if (pending.action === 'mine') soundTimer = setTimeout(() => sound('hit'), reduced ? 0 : 280);
        let opened;
        try {
            const [next] = await Promise.all([request('/' + pending.action, pending.body), new Promise(resolve => setTimeout(resolve, delay))]);
            const completed = pending.action;
            state = next; pending = null; selected.clear();
            if (completed === 'open' || completed === 'exchange') sound('reward');
            if (completed === 'open') opened = next.lastAction.result;
            if (completed === 'mine') {
                minedResult = next.lastAction.result;
                clearTimeout(resultTimer);
                resultTimer = setTimeout(() => { minedResult = null; root.querySelector('.pm-mine-result')?.remove(); }, 1300);
            }
        } catch (failure) {
            error = failure.message;
            // 응답이 유실돼도 동일한 요청 ID로 저장된 결과를 확인한다.
            if (failure.status && !failure.retry) pending = null;
            if (failure.refresh) {
                try { state = await request(''); } catch (loadError) { error = loadError.message; }
            }
        } finally { busy = false; render(); }
        if (opened && !paused) {
            const type = typeOf(opened.pickaxe);
            openDialog('곡괭이 획득', node('div', { class: 'pm-chest-reveal' }, sprite('pickaxes', type.spriteIndex, type.name, 'pm-large'), node('span', { class: 'pm-kicker' }, 'NEW PICKAXE'), node('h3', {}, type.name), node('p', {}, '내구도 +' + number(opened.addedDurability) + ' · 합산 내구도 ' + number(opened.pickaxe.durability) + ' / ' + number(opened.pickaxe.maxDurability)), node('button', { type: 'button', class: 'pm-button pm-primary', onclick: closeDialog }, '확인')));
        }
    }
    function resultMessage() {
        const last = state.lastAction;
        if (!last) return '필드에서 열쇠를 얻고, 곡괭이 상자를 열어보세요.';
        const result = last.result;
        if (last.action === 'mine') return result.name + ' ×' + number(result.count) + ' 획득';
        if (last.action === 'open') return result.name + ' 획득!';
        if (last.action === 'equip') return result.name + ' 장착';
        if (last.action === 'sell') return '광산 포인트 +' + number(result.points);
        return '';
    }
    function chestProbabilities() {
        openDialog('곡괭이 상자 확률', node('div', { class: 'pm-probabilities' }, ...state.pickaxeTypes.map(type => node('div', {}, sprite('pickaxes', type.spriteIndex, type.name), node('span', {}, type.name), node('strong', {}, percent(type.chance))))));
    }
    function mineView() {
        const tool = currentTool(), type = typeOf(tool);
        const scene = node('div', { class: 'pm-scene' + (busy && pending?.action === 'mine' ? ' pm-striking' : '') }, node('img', { class: 'pm-rock', src: asset('mine-rock.webp'), alt: '광물이 박힌 광맥', width: 960, height: 640 }));
        if (type) scene.append(node('div', { class: 'pm-swing' }, sprite('pickaxes', type.spriteIndex, type.name, 'pm-large')));
        scene.append(node('span', { class: 'pm-impact', 'aria-hidden': 'true' }));
        const controls = node('div', { class: 'pm-mine-controls' }, node('p', {}, type ? type.name + ' 장착 중' : '상자에서 곡괭이를 얻고 장착하세요'), tool ? durability(tool) : null,
            button(node('span', {}, node('span', { 'aria-hidden': 'true' }, '⛏'), busy && pending?.action === 'mine' ? '채굴 중…' : '광맥 채굴'), () => perform('mine'), !tool || tool.durability < 1 || !state.ready, true),
            node('small', {}, tool ? '남은 내구도 ' + number(tool.durability) + ' / ' + number(tool.maxDurability) : '열쇠 1개로 곡괭이 상자를 열 수 있습니다.'),
            tool?.durability === 0 ? node('small', { class: 'pm-short' }, '내구도가 소진되었습니다. 상자에서 같은 종류를 얻거나 다른 곡괭이를 장착하세요.') : null);
        const stage = node('div', { class: 'pm-stage' }, node('div', { class: 'pm-cave-light', 'aria-hidden': 'true' }), node('span', { class: 'pm-chain pm-chain-left', 'aria-hidden': 'true' }), node('span', { class: 'pm-chain pm-chain-right', 'aria-hidden': 'true' }), scene, controls);
        if (minedResult) {
            const ore = state.ores.find(ore => ore.id === minedResult.oreId);
            stage.append(node('div', { class: 'pm-mine-result' }, sprite('ores', ore.spriteIndex, ore.name), node('strong', {}, ore.name + ' ×' + number(minedResult.count)), node('small', {}, '+' + number(ore.value) + 'P 가치')));
        }
        const chances = () => openDialog('채굴 가능한 광물', node('div', { class: 'pm-probabilities' }, ...state.ores.filter(ore => ore.chance > 0).map(ore => node('div', {}, sprite('ores', ore.spriteIndex, ore.name), node('span', {}, ore.name), node('strong', {}, percent(ore.chance))))));
        return node('section', { class: 'pm-workbench' }, node('div', { class: 'pm-workbench-head' }, node('div', {}, node('span', { class: 'pm-kicker' }, '초보 광맥 · 포인트 광산'), node('h2', {}, '빛바랜 채굴장')), node('div', { class: 'pm-mine-meta' }, node('span', {}, '누적 채굴 ' + number(state.totalMined) + '회'), node('button', { type: 'button', class: 'pm-text-button', disabled: !type, onclick: chances }, '광물 확률'))), stage);
    }
    function profilePanel() {
        const tool = currentTool(), type = typeOf(tool);
        return node('aside', { class: 'pm-wood-panel pm-profile' }, node('div', { class: 'pm-miner-avatar', 'aria-hidden': 'true' }, '⛏'), node('span', { class: 'pm-kicker' }, '광부 정보'), node('h2', {}, '나의 광산'),
            node('div', { class: 'pm-balance-card' }, node('span', {}, '보유 광산 포인트'), node('strong', {}, number(state.points), node('small', {}, 'P'))),
            node('div', { class: 'pm-balance-card' }, node('span', {}, '곡괭이 상자 열쇠'), node('strong', {}, number(state.keyCount), node('small', {}, '개'))),
            node('div', { class: 'pm-equipped-card' }, node('span', { class: 'pm-inventory-label' }, '현재 장비'), type ? sprite('pickaxes', type.spriteIndex, type.name, 'pm-medium') : node('p', { class: 'pm-muted' }, '장착된 곡괭이 없음'), type ? node('strong', {}, type.name) : null, tool ? durability(tool) : null,
                tool ? node('small', { class: 'pm-muted' }, number(tool.durability) + ' / ' + number(tool.maxDurability)) : null),
            node('p', { class: 'pm-profile-help pm-help' }, '필드에서 열쇠를 획득하세요.', node('br'), '하루 최대 2개까지 드랍됩니다.'));
    }
    function chestView() {
        return node('section', { class: 'pm-shop-panel pm-chest-panel' }, node('div', { class: 'pm-panel-heading' }, node('div', {}, node('span', { class: 'pm-kicker' }, 'PICKAXE CHEST'), node('h2', {}, '곡괭이 상자')), node('span', { class: 'pm-slot-count' }, '보유 열쇠 ' + number(state.keyCount) + '개')),
            node('div', { class: 'pm-chest-showcase' }, node('article', { class: 'pm-chest-card' }, node('div', { class: 'pm-chest-art' + (busy && pending?.action === 'open' ? ' pm-opening' : '') }, node('span', { class: 'pm-chest-aura', 'aria-hidden': 'true' }), sprite(busy && pending?.action === 'open' ? 'openChests' : 'chests', 0, '곡괭이 상자', 'pm-large')),
                node('div', { class: 'pm-chest-copy' }, node('span', { class: 'pm-kicker' }, 'NORMAL CHEST'), node('h3', {}, '곡괭이 상자'), node('p', {}, '나무 곡괭이부터 마스터 곡괭이까지', node('br'), number(state.pickaxeTypes.length) + '종 중 하나를 획득합니다.'), node('button', { type: 'button', class: 'pm-text-button', onclick: chestProbabilities }, '곡괭이 확률 보기')),
                button(node('span', { class: 'pm-buy-label' }, node('span', {}, busy && pending?.action === 'open' ? '상자를 여는 중…' : '상자 열기'), node('strong', {}, '열쇠 1개')), () => perform('open'), state.keyCount < 1 || !state.ready, false))),
            node('p', { class: 'pm-shop-footnote' }, '같은 종류의 곡괭이는 내구도가 합산됩니다. 필드 사냥에서 상자 열쇠를 얻을 수 있습니다.'));
    }
    function toolSection() {
        const tools = node('section', { class: 'pm-tools' }, node('div', { class: 'pm-shelf-head' }, node('h3', {}, '곡괭이'), node('span', { class: 'pm-slot-count' }, number(state.pickaxes.length)), node('span', { class: 'pm-shelf-rule', 'aria-hidden': 'true' })));
        const list = node('div', { class: 'pm-tool-list' });
        for (const entry of [...state.pickaxes].reverse()) {
            const definition = typeOf(entry);
            if (!definition) continue;
            const equipped = entry.uid === state.equippedUid;
            list.append(node('div', { class: 'pm-tool' + (equipped ? ' pm-equipped' : '') + (entry.durability === 0 ? ' pm-broken' : '') }, node('span', { class: 'pm-tool-socket' }, sprite('pickaxes', definition.spriteIndex, definition.name)),
                node('div', { class: 'pm-tool-info' }, node('div', { class: 'pm-tool-title' }, node('strong', {}, definition.name), equipped ? node('span', { class: 'pm-equipped-tag' }, '장착') : null), node('small', {}, '내구도 ' + number(entry.durability) + ' / ' + number(entry.maxDurability)), durability(entry),
                    node('div', { class: 'pm-tool-actions' }, button(equipped ? '장착 중' : '장착', () => perform('equip', { uid: entry.uid }), equipped || entry.durability < 1)))));
        }
        if (!state.pickaxes.length) list.append(node('p', { class: 'pm-empty' }, '상자를 열어 첫 곡괭이를 얻어보세요.'));
        tools.append(list);
        return tools;
    }
    function oreView() {
        const sum = () => state.ores.reduce((total, ore) => total + (selected.has(ore.id) ? ore.count * ore.value : 0), 0);
        const total = node('strong', {}, number(sum()), node('small', {}, ' P'));
        const sell = button(node('span', { class: 'pm-buy-label' }, node('span', {}, '광물 판매'), total), () => perform('sell', { ores: [...selected].map(id => ({ id })) }), sum() < 1);
        sell.classList.add('pm-sell-button');
        const grid = node('div', { class: 'pm-ore-grid' });
        const owned = state.ores.filter(ore => ore.count > 0);
        for (const ore of owned) {
            const checked = selected.has(ore.id);
            const tile = node('article', { class: 'pm-ore' + (checked ? ' pm-selected' : ''), 'data-ore': ore.id });
            const select = node('button', { type: 'button', class: 'pm-ore-select', 'data-pm-ore': ore.id, 'aria-label': ore.name + ' 선택', 'aria-pressed': String(checked), disabled: blocked(), onclick: () => { if (selected.has(ore.id)) selected.delete(ore.id); else selected.add(ore.id); render(); } },
                node('span', { class: 'pm-ore-art' }, sprite('ores', ore.spriteIndex, ore.name), node('span', { class: 'pm-stack' }, '×' + number(ore.count))), node('strong', {}, ore.name), node('span', { class: 'pm-ore-price' }, '개당 ', node('b', {}, number(ore.value)), 'P'), node('span', { class: 'pm-check', 'aria-hidden': 'true' }, '✓'));
            tile.append(select);
            grid.append(tile);
        }
        const allSelected = owned.length > 0 && owned.every(ore => selected.has(ore.id));
        return { content: node('section', { class: 'pm-ores' }, node('div', { class: 'pm-shelf-head' }, node('h3', {}, '광물'), node('span', { class: 'pm-slot-count' }, number(owned.length)), node('span', { class: 'pm-shelf-rule', 'aria-hidden': 'true' }), button(allSelected ? '선택 해제' : '전체 선택', () => { selected.clear(); if (!allSelected) owned.forEach(ore => selected.add(ore.id)); render(); }, owned.length === 0)),
                owned.length ? grid : node('p', { class: 'pm-empty' }, '아직 채굴한 광물이 없습니다.'), node('p', { class: 'pm-help' }, '선택한 광물은 보유 수량 전체를 판매합니다.')),
            dock: node('div', { class: 'pm-sale-bar' }, sell, node('small', { class: 'pm-muted' }, '광산 포인트는 계정 포인트와 별도로 보관됩니다.')) };
    }
    function inventoryPanel(compact = false) {
        const ores = oreView();
        return node('section', { class: 'pm-stone-panel pm-inventory' + (compact ? ' pm-compact-inventory' : ' pm-full-inventory') },
            node('div', { class: 'pm-panel-heading' }, node('div', {}, node('span', { class: 'pm-kicker' }, '보관함'), node('h2', {}, '인벤토리')), node('span', { class: 'pm-slot-count' }, number(state.pickaxes.length + state.ores.filter(ore => ore.count > 0).length) + '칸')),
            node('div', { class: 'pm-inventory-scroll', 'data-pm-scroll': compact ? 'side' : 'inventory' }, toolSection(), ores.content), ores.dock);
    }
    function rewardView() {
        return node('section', { class: 'pm-shop-panel' }, node('div', { class: 'pm-panel-heading' }, node('div', {}, node('span', { class: 'pm-kicker' }, 'MINERAL EXCHANGE'), node('h2', {}, '광산 교환소')), node('span', { class: 'pm-slot-count' }, number(state.points) + ' P')),
            node('div', { class: 'pm-shop-scroll', 'data-pm-scroll': 'rewards' }, node('p', { class: 'pm-help' }, '광물을 판매해 얻은 포인트로 교환합니다. 보상별 가격과 교환 한도를 확인하세요.'),
            node('div', { class: 'pm-reward-grid' }, ...state.rewards.map(reward => {
                const complete = reward.limit > 0 && reward.exchanged >= reward.limit;
                const art = node('div', { class: 'pm-reward-art' });
                if (reward.iconUrl) art.append(node('img', { src: reward.iconUrl, alt: '', loading: 'lazy' }));
                else art.append(node('span', {}, '🎁'));
                return node('article', { class: 'pm-reward' + (complete ? ' pm-complete' : '') }, node('span', { class: 'pm-reward-limit' }, reward.limit ? '교환 ' + number(reward.exchanged) + ' / ' + number(reward.limit) + '회' : '반복 교환'), art, node('h3', {}, reward.name), node('p', { class: 'pm-muted' }, number(reward.count) + '개 지급'),
                    button(node('span', { class: 'pm-buy-label' }, node('span', {}, complete ? '교환 완료' : !reward.available ? '보상 준비 중' : '교환하기'), node('strong', {}, number(reward.cost) + ' P')), () => perform('exchange', { rewardId: reward.id }), complete || !reward.available || state.points < reward.cost));
            }))));
    }
    function render() {
        if (!state) return;
        const focus = document.activeElement?.getAttribute('data-pm-tab');
        const oreFocus = document.activeElement?.getAttribute('data-pm-ore');
        const scrolls = renderedView === view ? [...root.querySelectorAll('[data-pm-scroll]')].map(element => [element.dataset.pmScroll, element.scrollTop]) : [];
        const toggle = node('button', { type: 'button', class: 'pm-sound', 'aria-label': muted ? '효과음 켜기' : '효과음 끄기', 'aria-pressed': String(!muted), onclick: () => {
            muted = !muted; try { localStorage.setItem('point-mine-muted', String(muted)); } catch (_) {}
            toggle.textContent = muted ? '♩' : '♫'; toggle.setAttribute('aria-pressed', String(!muted)); toggle.setAttribute('aria-label', muted ? '효과음 켜기' : '효과음 끄기');
        } }, muted ? '♩' : '♫');
        const tabs = node('nav', { class: 'pm-tabs', 'aria-label': '광산 메뉴' }, ...[['mine', '채굴장', '⛏'], ['chest', '곡괭이 상자', '▣'], ['ores', '인벤토리', '▦'], ['rewards', '교환소', '◆']].map(([id, label, icon]) => node('button', { type: 'button', 'data-pm-tab': id, 'aria-current': view === id ? 'page' : 'false', class: (view === id ? 'selected' : '') + (id === 'ores' ? ' pm-mobile-tab' : ''), onclick: () => changeView(id) }, node('span', { class: 'pm-tab-icon', 'aria-hidden': 'true' }, icon), node('span', {}, label))));
        const shell = node('div', { class: 'pm-game' }, node('header', { class: 'pm-header' }, node('div', { class: 'pm-brand' }, node('span', { class: 'pm-brand-mark', 'aria-hidden': 'true' }, '⛏'), node('div', {}, node('h1', {}, '포인트 광산'), node('small', {}, 'POINT MINE'))), tabs,
            node('div', { class: 'pm-balances' }, toggle, node('div', { class: 'pm-header-key' }, node('img', { src: state.keyIcon, alt: '열쇠' }), node('strong', {}, number(state.keyCount))), node('div', { class: 'pm-header-balance' }, node('span', {}, '광산 포인트'), node('strong', {}, number(state.points) + ' P')))));
        shell.append(node('div', { class: 'pm-layout' + (view === 'mine' ? '' : ' pm-wide-layout') }, profilePanel(), view === 'mine' ? mineView() : view === 'chest' ? chestView() : view === 'ores' ? inventoryPanel() : rewardView(), view === 'mine' ? inventoryPanel(true) : null));
        const message = error || (!state.active ? '포인트 광산 이벤트가 종료되었습니다.' : resultMessage());
        if (message || (pending && !busy)) shell.append(node('div', { class: 'pm-status' + (error ? ' pm-error' : ''), role: error ? 'alert' : 'status', 'aria-live': 'polite' }, message,
            pending && !busy ? node('button', { type: 'button', class: 'pm-button pm-primary', onclick: () => perform(pending.action) }, '결과 다시 확인') : null));
        root.replaceChildren(shell);
        for (const [id, scrollTop] of scrolls) { const element = root.querySelector('[data-pm-scroll="' + id + '"]'); if (element) element.scrollTop = scrollTop; }
        renderedView = view;
        if (focus) root.querySelector('[data-pm-tab="' + focus + '"]')?.focus({ preventScroll: true });
        if (oreFocus) root.querySelector('[data-pm-ore="' + oreFocus + '"]')?.focus({ preventScroll: true });
    }
    return {
        async refresh() { paused = false; if (busy) return; state = await request(''); if (pending && state.lastAction?.requestId === pending.body.requestId) pending = null; render(); },
        pause() { paused = true; clearTimeout(soundTimer); clearTimeout(resultTimer); minedResult = null; closeDialog(); Object.values(sounds).forEach(audio => audio.pause()); }
    };
}
