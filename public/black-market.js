/* 암시장 입찰 상태와 계약. 화면은 공통 상점 WebGL 렌더러가 그린다. */
(() => {
    'use strict';
    function create(options) {
        const state = { data: null, selected: 'card-garnet', drafts: {}, mode: 'browse', dialog: null,
            message: '', error: false, busy: false, fetching: false, uncertain: false,
            closed: true, countdown: '--:--:--', clockNote: '한국 시간', status: '불러오는 중', resultPage: 0, resultPages: 1 };
        let disposed = false, offset = 0, boundary, fetching;
        const abort = new AbortController();
        const change = () => { if (!disposed) options.onChange?.(state); };
        const lotFor = sector => state.data?.lots.find(lot => lot.sector === sector);
        const isClosed = () => !state.data || state.data.status !== 'open' || Date.now() + offset >= state.data.closesAt;
        function notice(message, error = false) { state.message = message; state.error = error; options.onNotice?.(message); change(); }
        function sameContract(contract) {
            const lot = lotFor(contract.sector);
            return state.data?.periodId === contract.periodId && lot?.lotId === contract.lotId &&
                (lot.myBid?.version || null) === contract.bidVersion && !isClosed();
        }
        function tick() {
            if (!state.data || disposed) return;
            state.closed = isClosed();
            const seconds = Math.max(0, Math.ceil(((state.closed ? state.data.nextOpensAt : state.data.closesAt) - Date.now() - offset) / 1000));
            state.countdown = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(n => String(n).padStart(2, '0')).join(':');
            state.status = state.closed ? '정산 중' : '비공개 입찰';
            state.clockNote = state.closed ? '다음 개장까지' : new Date(state.data.closesAt).toLocaleTimeString('ko-KR', {
                timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
            }) + ' 마감 (한국 시간)';
            const next = state.data.periodId + (seconds === 0 ? ':next' : state.closed ? ':closed' : ':open');
            const changed = boundary && boundary !== next; boundary = next;
            if (state.dialog && !state.busy && !sameContract(state.dialog.contract)) {
                state.dialog = null; notice('입찰 내역이 변경되었거나 마감되었습니다. 다시 확인해주세요.', true);
            }
            change();
            if (changed && !state.busy) refresh();
        }
        function apply(data) {
            if (disposed) return;
            const previous = state.data;
            for (const lot of data.lots) {
                const old = previous?.lots.find(entry => entry.sector === lot.sector);
                if (previous?.periodId !== data.periodId || old?.lotId !== lot.lotId || (old?.myBid?.version || null) !== (lot.myBid?.version || null)) {
                    state.drafts[lot.sector] = lot.myBid ? String(lot.myBid.amount) : '';
                }
            }
            state.data = data; offset = data.serverNow - Date.now(); state.uncertain = false;
            options.onBalances?.(data.balances);
            if (state.dialog && !sameContract(state.dialog.contract)) {
                state.dialog = null; notice('매물 또는 내 입찰이 변경되었습니다. 현재 내역을 확인해주세요.');
            }
            tick();
        }
        async function refresh(force = false) {
            if (disposed || state.busy && !force) return;
            if (fetching) return fetching;
            state.fetching = true; change();
            fetching = (async () => {
                try { apply(await options.request('/api/black-market')); return true; }
                catch (error) { if (!disposed) notice(error.message + ' 새로고침으로 다시 확인해주세요.', true); return false; }
                finally { fetching = null; if (!disposed) { state.fetching = false; change(); } }
            })();
            return fetching;
        }
        function preview(sector, cancel) {
            if (isClosed() || state.busy || state.uncertain || state.dialog) return;
            const lot = lotFor(sector); if (!lot) return;
            const current = lot.myBid?.amount || 0, raw = (state.drafts[sector] || '').trim(), amount = cancel ? 0 : Number(raw);
            if (!cancel && (!/^\d+$/.test(raw) || !Number.isSafeInteger(amount) || amount < 1 || amount > state.data.balances[lot.currency] + current)) {
                notice('보유 재화와 현재 보관금 이내의 양의 정수를 입력해주세요.', true); return;
            }
            if (amount === current) { notice('현재 보관금과 같은 금액입니다. 입찰 순서는 유지됩니다.'); return; }
            state.dialog = { lot, current, amount, delta: amount - current, after: state.data.balances[lot.currency] - (amount - current),
                contract: { date: state.data.date, periodId: state.data.periodId, sector, lotId: lot.lotId, amount, bidVersion: lot.myBid?.version || null } };
            state.message = ''; change();
        }
        async function confirm() {
            if (state.busy || !state.dialog || state.uncertain) return;
            const { contract, amount } = state.dialog;
            state.busy = true; change();
            if (fetching) await fetching;
            if (disposed) return;
            if (!sameContract(contract)) {
                state.busy = false; state.dialog = null; notice('입찰 내역이 변경되었거나 마감되었습니다. 다시 확인해주세요.', true); return;
            }
            try {
                const data = await options.request('/api/black-market/bid', contract);
                if (disposed) return;
                state.dialog = null; apply(data);
                notice(amount ? '입찰했습니다.' : '입찰을 취소하고 보관금을 돌려받았습니다.');
                options.onComplete?.(contract.sector, amount);
            } catch (error) {
                if (disposed) return;
                state.dialog = null; state.uncertain = true;
                await refresh(true);
                notice(error.message + (state.uncertain ? ' 새로고침 후 현재 보관금을 확인해주세요.' : ' 현재 보관금을 다시 확인했습니다.'), true);
            } finally { state.busy = false; change(); }
        }
        function act(action, sector) {
            if (disposed || state.busy) return;
            switch (action) {
                case 'market-select': state.selected = sector; state.mode = 'detail'; break;
                case 'market-bid': preview(sector, false); return;
                case 'market-cancel': preview(sector, true); return;
                case 'market-confirm': confirm(); return;
                case 'market-refresh': refresh(); return;
                case 'market-mail': options.onMail?.(); return;
                case 'market-results': state.mode = 'results'; state.resultPage = 0; break;
                case 'market-result-next': state.resultPage = Math.min(state.resultPages - 1, state.resultPage + 1); break;
                case 'market-result-previous': state.resultPage = Math.max(0, state.resultPage - 1); break;
                case 'market-rules': state.mode = 'rules'; break;
                case 'market-back':
                    if (state.message) state.message = '';
                    else if (state.dialog) state.dialog = null;
                    else state.mode = 'browse';
                    break;
            }
            change();
        }
        document.addEventListener('visibilitychange', () => { if (!document.hidden) { tick(); refresh(); } }, { signal: abort.signal });
        const timer = setInterval(tick, 1000), poll = setInterval(() => { if (!document.hidden) refresh(); }, 30000);
        return { state, act, refresh,
            setDraft(sector, value) { if (!isClosed() && !state.busy && !state.uncertain) { state.drafts[sector] = value; change(); } },
            dispose() { disposed = true; abort.abort(); clearInterval(timer); clearInterval(poll); }
        };
    }
    window.BlackMarketUI = { create };
})();
