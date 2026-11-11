const crypto = require('crypto');
const rpg = () => require('./rpgenius');
const TOKEN = '천상의 증표';

// 운영 상품은 Paradise.shop에만 둔다. 누락된 상점을 import/서버 시작 시 생성하지 않는다.
function catalog() { return rpg().getDataCache('Paradise', {})?.shop || []; }
function catalogRevision() { return crypto.createHash('sha256').update(JSON.stringify(catalog())).digest('hex'); }
function view(user, getIcon = () => null, now = new Date()) {
    const items = rpg().getDataCache('Item', []), tokenId = items.findIndex(item => item?.name === TOKEN);
    const balances = { tokens: tokenId < 0 ? 0 : rpg().getInventoryItemCount(user, tokenId), gold: Number(user.gold || 0) };
    const week = rpg().getKoreanWeekKey(now), current = user.paradiseShop;
    const counts = current?.week === week ? current.counts || {} : {};
    return {
        revision: Number(current?.revision || 0), catalogRevision: catalogRevision(), balances,
        tokenIconUrl: getIcon(items[tokenId]), goldIconUrl: '/item-image?dir=' + encodeURIComponent('화폐') + '&file=' + encodeURIComponent('골드.png'),
        resetAt: require('./paradise').weeklyInfo(user, now).resetsAt,
        items: catalog().map(product => {
            const itemId = items.findIndex(item => item?.name === product.item), item = items[itemId];
            const available = !!item && ['tokens', 'gold'].includes(product.currency) && Number.isSafeInteger(product.price) && product.price > 0;
            const remaining = product.weeklyLimit ? Math.max(0, product.weeklyLimit - Number(counts[product.id] || 0)) : null;
            const maxQuantity = available ? Math.max(0, Math.min(remaining ?? Number.MAX_SAFE_INTEGER, Math.floor(balances[product.currency] / product.price))) : 0;
            return { id: product.id, name: product.name || product.item, description: item?.desc || '', iconUrl: getIcon(item),
                currency: product.currency, price: product.price, count: 1, owned: item ? rpg().getInventoryItemCount(user, itemId) : 0,
                weeklyLimit: product.weeklyLimit || null, remaining, maxQuantity, available };
        })
    };
}

function buy(user, input, now = new Date()) {
    if (!Number.isSafeInteger(input.quantity) || input.quantity < 1) return { error: '구매 수량은 1 이상의 정수여야 합니다.' };
    const current = view(user, undefined, now), product = current.items.find(item => item.id === input.product);
    if (!product || !product.available) return { error: '현재 구매할 수 없는 상품입니다.' };
    const total = product.price * input.quantity;
    if (!Number.isSafeInteger(total)) return { error: '구매 수량이 너무 많습니다.' };
    if (product.remaining != null && input.quantity > product.remaining) return { error: '이번 주 구매 한도를 초과합니다.' };
    if (input.quantity > product.maxQuantity) return { error: (product.currency === 'tokens' ? TOKEN : '골드') + '가 부족합니다.' };
    const items = rpg().getDataCache('Item', []), definition = catalog().find(item => item.id === product.id);
    const itemId = items.findIndex(item => item?.name === definition.item);
    const owned = rpg().getInventoryItemCount(user, itemId);
    if (!Number.isSafeInteger(owned + input.quantity)) return { error: '아이템 보유 한도를 초과합니다.' };
    if (product.currency === 'tokens') rpg().removeInventoryItem(user, items.findIndex(item => item?.name === TOKEN), total);
    else user.gold = Number(user.gold || 0) - total;
    rpg().addInventoryItem(user, itemId, input.quantity);
    const week = rpg().getKoreanWeekKey(now), counts = user.paradiseShop?.week === week ? { ...user.paradiseShop.counts } : {};
    if (product.weeklyLimit) counts[product.id] = Number(counts[product.id] || 0) + input.quantity;
    user.paradiseShop = { revision: current.revision + 1, week, counts };
    return { message: `${product.name} ${input.quantity.toLocaleString('ko-KR')}개를 구매했습니다.`,
        purchase: { requestId: input.requestId, id: product.id, name: product.name, itemId, count: input.quantity, currency: product.currency,
            total, remainingBalance: current.balances[product.currency] - total } };
}

module.exports = { view, buy, catalogRevision };
