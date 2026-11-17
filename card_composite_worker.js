const { parentPort } = require('node:worker_threads');
const { composeCardImage } = require('./card_composite');

parentPort.on('message', ({ id, card }) => {
    try {
        const buffer = composeCardImage(card);
        // 캐시의 Buffer를 transfer하면 원본이 분리되므로 복제해서 반환한다.
        parentPort.postMessage({ id, buffer });
    } catch (error) {
        parentPort.postMessage({ id, error: String(error?.message || error || 'Card image composition failed') });
    }
});
