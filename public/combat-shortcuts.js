(function () {
    'use strict';
    // 사냥과 월드보스가 같은 계정의 물약 배치를 이 브라우저에서 공유한다.
    window.createCombatShortcuts = function ({ account, getState, use }) {
        const keys = 'QWRTYUIOADFGHKLZXCVBNM'.split('');
        const defaults = ['Z', 'X', 'C'];
        const storageKey = 'rpg-potion-shortcuts:' + account;
        let slots = defaults.map(key => ({ key, name: '' }));
        try {
            const saved = JSON.parse(localStorage.getItem(storageKey));
            if (Array.isArray(saved) && saved.length === 3 && saved.every(s => keys.includes(s.key) && typeof s.name === 'string') && new Set(saved.map(s => s.key)).size === 3) slots = saved;
        } catch (_) {}
        function node(tag, className, text) {
            const n = document.createElement(tag); n.className = className || '';
            if (text != null) n.textContent = text;
            return n;
        }
        const bar = node('nav', 'combat-quickbar');
        bar.setAttribute('aria-label', '물약 단축 슬롯');
        const buttons = defaults.map((_, i) => {
            const button = node('button', 'combat-quickslot'); button.type = 'button';
            button.onclick = () => { activate(i); button.blur(); };
            bar.append(button); return button;
        });
        const settings = node('button', 'combat-quick-settings', '설정'); settings.type = 'button';
        settings.setAttribute('aria-label', '물약과 단축키 설정'); bar.append(settings);
        const dialog = node('dialog', 'combat-shortcut-dialog');
        const title = node('h2', '', '물약 단축키'); title.id = 'combatShortcutTitle';
        dialog.setAttribute('aria-labelledby', title.id);
        dialog.addEventListener('close', () => settings.blur());
        document.body.append(bar, dialog);
        function activate(i) {
            const state = getState(), item = (state.items || []).find(item => item.name === slots[i].name);
            if (dialog.open || !state.active || state.busy || !item || item.disabled || item.count < 1) return;
            use(item.id);
        }
        function refresh() {
            const state = getState(); bar.hidden = !state.active;
            settings.disabled = !!state.busy;
            if (!state.active && dialog.open) dialog.close();
            slots.forEach((slot, i) => {
                const item = (state.items || []).find(item => item.name === slot.name), button = buttons[i];
                button.disabled = !!state.busy || !item || item.disabled || item.count < 1;
                const contentKey = JSON.stringify([slot.key, slot.name, item?.iconUrl, item?.count, item?.effect, item?.disabled]);
                if (button.dataset.contentKey === contentKey) return;
                button.dataset.contentKey = contentKey;
                button.replaceChildren(node('kbd', '', slot.key));
                if (item?.iconUrl) {
                    const image = node('img'); image.src = item.iconUrl; image.alt = ''; button.append(image);
                } else button.append(node('span', 'combat-quick-empty', slot.name ? '0' : '+'));
                button.append(node('span', 'combat-quick-count', item ? item.disabled ? '봉인' : String(item.count) : slot.name ? '소진' : '지정'));
                button.title = slot.name ? slot.name + ' · ' + (item?.effect || '보유 물약 없음') : '설정에서 물약을 지정하세요';
                button.setAttribute('aria-label', slot.key + ' · ' + button.title);
            });
        }
        settings.onclick = () => {
            if (getState().busy) return;
            const items = getState().items || [], rows = [], error = node('p', 'combat-shortcut-error');
            error.setAttribute('role', 'alert');
            dialog.replaceChildren(title, node('p', 'combat-shortcut-note', '물약과 키를 지정하면 전투 중 바로 사용할 수 있습니다. 슬롯을 눌러도 사용됩니다.'));
            slots.forEach((slot, i) => {
                const row = node('div', 'combat-shortcut-row'), label = node('label', '', '슬롯 ' + (i + 1));
                const itemSelect = node('select'), keySelect = node('select');
                itemSelect.id = 'combatPotion' + i; label.htmlFor = itemSelect.id;
                itemSelect.add(new Option('물약 선택', ''));
                items.forEach(item => itemSelect.add(new Option(item.name + ' ×' + item.count, item.name)));
                if (slot.name && !items.some(item => item.name === slot.name)) itemSelect.add(new Option(slot.name + ' (소진)', slot.name));
                itemSelect.value = slot.name;
                keySelect.setAttribute('aria-label', '슬롯 ' + (i + 1) + ' 단축키');
                keys.forEach(key => keySelect.add(new Option(key, key))); keySelect.value = slot.key;
                row.append(label, itemSelect, keySelect); dialog.append(row); rows.push({ itemSelect, keySelect });
            });
            const footer = node('div', 'combat-shortcut-footer'), cancel = node('button', '', '취소'), save = node('button', 'primary', '저장');
            cancel.onclick = () => dialog.close();
            save.onclick = () => {
                const next = rows.map(row => ({ name: row.itemSelect.value, key: row.keySelect.value }));
                if (new Set(next.map(slot => slot.key)).size !== 3) { error.textContent = '슬롯마다 서로 다른 단축키를 선택해주세요.'; return; }
                try { localStorage.setItem(storageKey, JSON.stringify(next)); }
                catch (_) { error.textContent = '설정을 저장할 수 없습니다. 브라우저 저장소 설정을 확인해주세요.'; return; }
                slots = next; dialog.close(); refresh();
            };
            footer.append(cancel, save); dialog.append(error, node('p', 'combat-shortcut-note', '이 계정의 설정은 현재 브라우저에 저장됩니다.'), footer); dialog.showModal();
        };
        document.addEventListener('keydown', event => {
            if (dialog.open) { event.stopImmediatePropagation(); return; }
            if (event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.target.closest?.('input,select,textarea,[contenteditable="true"]')) return;
            const i = slots.findIndex(slot => 'Key' + slot.key === event.code);
            if (i < 0 || !getState().active) return;
            event.preventDefault(); event.stopImmediatePropagation(); activate(i);
        }, true);
        refresh();
        return { refresh };
    };
})();
