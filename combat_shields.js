'use strict';

// 전투마다 사용하는 보호막 저장소. 출처와 시전자가 같은 효과만 갱신한다.
function layers(state, legacy) {
    if (!Array.isArray(state.shieldLayers)) {
        state.shieldLayers = [];
        if (Number(legacy && legacy.amount || 0) > 0) state.shieldLayers.push({
            source: 'legacy', caster: '', ...legacy,
            amount: Number(legacy.amount), expiresAt: Number(legacy.expiresAt || 0)
        });
    }
    return state.shieldLayers;
}

function active(state, now) {
    return layers(state).filter(layer => layer.amount > 0 && (!layer.expiresAt || layer.expiresAt > now));
}

function summary(state, now) {
    const current = active(state, now);
    return {
        amount: current.reduce((sum, layer) => sum + layer.amount, 0),
        expiresAt: current.some(layer => !layer.expiresAt) ? 0 : Math.max(0, ...current.map(layer => layer.expiresAt))
    };
}

function grant(state, layer) {
    const current = layers(state);
    const index = current.findIndex(entry => entry.source === layer.source && entry.caster === layer.caster);
    const entry = { ...layer, amount: Math.max(0, Number(layer.amount || 0)), expiresAt: Number(layer.expiresAt || 0) };
    if (index >= 0) current.splice(index, 1);
    if (entry.amount > 0) current.push(entry);
    return entry;
}

function expire(state, now) {
    const current = layers(state), expired = [];
    for (let i = current.length - 1; i >= 0; i--) {
        if (current[i].expiresAt && current[i].expiresAt <= now) expired.unshift(...current.splice(i, 1));
    }
    return expired;
}

// 만료 처리는 호출부가 먼저 수행해 출처별 소멸 효과를 처리한다.
function absorb(state, damage) {
    const current = layers(state), broken = [];
    let remaining = Math.max(0, Number(damage || 0));
    const ordered = current.slice().sort((a, b) => (a.expiresAt || Infinity) - (b.expiresAt || Infinity));
    for (const layer of ordered) {
        if (remaining <= 0) break;
        const amount = Math.min(layer.amount, remaining);
        layer.amount -= amount;
        remaining -= amount;
        const hasHits = Number(layer.hits || 0) > 0;
        if (hasHits) layer.hits--;
        if (layer.amount <= 0 || hasHits && layer.hits <= 0) {
            current.splice(current.indexOf(layer), 1);
            broken.push(layer);
        }
    }
    return { absorbed: Math.max(0, Number(damage || 0)) - remaining, damage: remaining, broken };
}

module.exports = { layers, active, summary, grant, expire, absorb };
