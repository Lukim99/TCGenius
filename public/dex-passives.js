(function (root) {
    'use strict';

    // 표시만 변환한다. 운영 설명에서 확인할 수 없는 조건이나 수치는 만들지 않는다.
    function stageText(text, stage) {
        const level = Math.min(3, Math.max(1, Number(stage) || 1));
        const scale = (base, delta) => {
            const value = Number(base) + Number(delta) * (level - 1);
            return (base.startsWith('+') && value >= 0 ? '+' : '') + Number(value.toFixed(4));
        };
        return String(text || '')
            .replace(/([+-]?\d+(?:\.\d+)?)(%?)\s*\((?:초월\s*)?(?:단계당\s*)?([+-]\d+(?:\.\d+)?)(%?)(\s*,[^()]*)?\)/g,
                (_, base, unit, delta, deltaUnit, note) => scale(base, delta) + (unit || deltaUnit) + (note ? ' (' + note.replace(/^\s*,\s*/, '') + ')' : ''))
            .replace(/(^|[.!?]\s+)([^.!?%]*?)([+-]?\d+(?:\.\d+)?)%([^.!?%]*[.!?])\s*초월 단계마다 (?:피해 배율이 )?(\d+(?:\.\d+)?)%p (?:추가로 )?증가(?:합니다|한다)\.?/g,
                (_, before, lead, base, tail, delta) => before + lead + scale(base, delta) + '%' + tail);
    }

    function sentences(text) {
        const lines = [];
        let start = 0, depth = 0;
        for (let i = 0; i < text.length; i++) {
            if (text[i] === '(') depth++;
            if (text[i] === ')') depth = Math.max(0, depth - 1);
            if (depth === 0 && /[.!?\n]/.test(text[i]) && (i + 1 === text.length || /\s/.test(text[i + 1]))) {
                lines.push(text.slice(start, i + 1).trim()); start = i + 1;
            }
        }
        lines.push(text.slice(start).trim());
        return lines.filter(Boolean);
    }

    function describe(text, cooltime) {
        const blocks = [];
        const cooldownPattern = /^(?:쿨타임|재사용 대기시간)(?:은|이)?\s*(\d+(?:\.\d+)?)\s*(초|분)(?:입니다|이다)?[.!?]?$/;
        const addMeta = (block, label, value) => {
            if (!block.meta.some(row => row.label === label && row.value === value)) block.meta.push({ label, value });
        };
        for (let sentence of sentences(String(text || '').replace(/[·ㆍ]/g, '/'))) {
            const previous = blocks[blocks.length - 1];
            const trailingCooldown = sentence.match(/^\(((?:쿨타임|재사용 대기시간)[^()]*)\)\s*/);
            if (previous && trailingCooldown) {
                const match = trailingCooldown[1].match(cooldownPattern);
                if (match) {
                    addMeta(previous, '재사용', match[1] + match[2]);
                    sentence = sentence.slice(trailingCooldown[0].length).trim();
                    if (!sentence) continue;
                }
            }
            const standaloneCooldown = sentence.match(cooldownPattern);
            if (standaloneCooldown && previous) {
                addMeta(previous, '재사용', standaloneCooldown[1] + standaloneCooldown[2]); continue;
            }
            const block = { when: '', lines: [], meta: [] };
            // 괄호의 쿨타임은 해당 문장에만 붙인다. 효과로서의 '쿨타임 감소'는 떼지 않는다.
            sentence = sentence.replace(/\(([^()]*)\)/g, (full, inside) => {
                const parts = inside.split(/,\s*/);
                const remaining = parts.filter(part => {
                    const match = part.trim().match(cooldownPattern);
                    if (!match) return true;
                    addMeta(block, '재사용', match[1] + match[2]); return false;
                });
                return remaining.length === parts.length ? full : remaining.length ? '(' + remaining.join(', ') + ')' : '';
            }).replace(/\s+([.!?])/g, '$1').trim();
            // 조건절 뒤의 결과를 한 묶음으로 유지한다. 쉼표는 효과를 나누는 기준이 아니다.
            const condition = sentence.match(/^(.+?(?:\s시|때마다|마다|하면|않으면|이면|라면|내려가면|이하에서는|이상에서는|이하에서|이상에서|일 때|있는 동안|효과 지속 중|폭주 중))[,\s]+(.+)$/);
            if (condition) { block.when = condition[1]; sentence = condition[2]; }
            if (block.when) {
                const chance = sentence.match(/^(\d+(?:\.\d+)?%)\s*확률로\s*(.+)$/);
                if (chance) { addMeta(block, '발동 확률', chance[1]); sentence = chance[2]; }
                const duration = sentence.match(/^(\d+(?:\.\d+)?)(초|분)(?:간| 동안)\s+(.+)$/);
                if (duration) { addMeta(block, '지속', duration[1] + duration[2]); sentence = duration[3]; }
            }
            block.lines.push(sentence);
            if (!block.when && previous && /^(?:이후|그 후|이 효과|해당 효과|화상은|낙오 \d|범부 \d|중첩당)\s?/.test(sentence)) {
                previous.lines.push(...block.lines);
                block.meta.forEach(row => addMeta(previous, row.label, row.value));
            } else blocks.push(block);
        }
        const cooldownMs = Number(cooltime || 0);
        const shared = [];
        if (cooldownMs > 0) {
            const seconds = cooldownMs / 1000;
            const value = seconds % 60 === 0 ? seconds / 60 + '분' : seconds + '초';
            if (!blocks.some(block => block.meta.some(row => row.label === '재사용'
                && parseFloat(row.value) * (row.value.endsWith('분') ? 60 : 1) === seconds))) shared.push({ label: '재사용', value });
        }
        return { blocks, shared };
    }

    const api = { stageText, describe };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.DexPassives = api;
})(typeof window === 'undefined' ? globalThis : window);
