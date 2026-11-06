'use strict';

const TYPES = { hp: ['체력회복', '체력회복%'], mp: ['마나회복', '마나회복%'] };
function supports(item, resource) {
    return item?.type === '소모품' && Array.isArray(item.use_func) && item.use_func.length > 0
        && item.use_func.every(func => [...TYPES.hp, ...TYPES.mp].includes(func?.type) && Number(func.amount) > 0)
        && item.use_func.some(func => TYPES[resource].includes(func.type));
}
function settings(value) {
    return Object.fromEntries(['hp', 'mp'].map(key => [key, value?.[key] || { enabled: false, threshold: 50, itemId: null }]));
}
function validate(value, items) {
    if (!value || typeof value !== 'object') return '자동 물약 설정을 확인해주세요.';
    for (const key of ['hp', 'mp']) {
        const option = value[key];
        if (!option || typeof option.enabled !== 'boolean' || !Number.isInteger(option.threshold) || option.threshold < 1 || option.threshold > 99) return '기준 비율은 1~99% 정수로 입력해주세요.';
        if (option.enabled && (!Number.isInteger(option.itemId) || !supports(items[option.itemId], key))) return '사용할 회복 물약을 선택해주세요.';
    }
    return null;
}
// HP 우선, 한 번에 물약 1개. 레이드와 사냥은 각자 기존 재고/회복/쿨타임 처리를 사용한다.
function select(config, vitals, items, available, { hp = true, mp = true } = {}) {
    if (!(vitals.hp > 0)) return null;
    for (const key of ['hp', 'mp']) {
        const option = config?.[key], item = items[option?.itemId];
        if (!(key === 'hp' ? hp : mp) || !option?.enabled || !supports(item, key)) continue;
        if (!hp && item.use_func.some(func => TYPES.hp.includes(func.type))) continue;
        if (!mp && item.use_func.some(func => TYPES.mp.includes(func.type))) continue;
        if (vitals[key + 'Max'] > 0 && vitals[key] / vitals[key + 'Max'] <= option.threshold / 100 && available(option.itemId, item)) return { id: option.itemId, item };
    }
    return null;
}
module.exports = { supports, settings, validate, select };
