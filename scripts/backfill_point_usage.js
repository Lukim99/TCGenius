'use strict';

// Manual, evidence-only recovery. Never changes wallets or imports the game server.
const fs = require('node:fs');
const crypto = require('node:crypto');
const FROM = '2026-04-30T15:00:00.000Z';
const BEFORE = '2026-11-09T04:03:37.816Z'; // First ledger-enabled production container start.
const BATCH = 'point-usage-20261109-v1';
const names = { single: '퍼스널뽑기 · 한 칸', shake: '퍼스널뽑기 · 흔들기', refresh: '퍼스널뽑기 · 새로고침' };
function uuid(key) {
    const bytes = crypto.createHash('sha1').update(Buffer.from('31a07d685bd54d7f8521bdf262551ac7', 'hex')).update(key).digest().subarray(0, 16);
    bytes[6] = (bytes[6] & 15) | 80; bytes[8] = (bytes[8] & 63) | 128;
    return bytes.toString('hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
}
function sourceKey(event) {
    if (event.category === 'personal_draw' && event.details?.requestId) return 'draw:' + event.user_id + ':' + event.details.requestId;
    return event.id;
}
function buildRecovery(evidence, existing = []) {
    if (evidence.from !== FROM || evidence.before !== BEFORE) throw new Error('복구 기간이 확인된 기록 도입 시각과 다릅니다.');
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify(evidence)).digest('hex');
    const seen = new Set([...existing, ...evidence.users.flatMap(u => Object.values(u.pointUsageOutbox || {}))].flatMap(e => [e.id, sourceKey(e)]));
    const rows = [], skipped = {};
    const skip = reason => { skipped[reason] = (skipped[reason] || 0) + 1; };
    function add(user, at, key, info) {
        if (user.isAdmin) return skip('admin');
        if (!Number.isSafeInteger(at)) throw new Error('원본 거래 시각을 확인할 수 없습니다.');
        const occurred_at = new Date(at).toISOString();
        if (occurred_at < FROM || occurred_at >= BEFORE) return skip('outsideWindow');
        if (!Number.isSafeInteger(info.amount) || info.amount < 0) throw new Error('원본 차감액이 올바르지 않습니다.');
        const id = uuid(key);
        if (seen.has(key) || seen.has(id)) return skip('duplicate');
        seen.add(key); seen.add(id);
        rows.push({ id, occurred_at, user_id: String(user.id), nickname: user.name, is_admin: false,
            kind: info.kind, category: info.category, action: info.action, product_id: info.productId, product_name: info.productName,
            quantity: 1, amount: info.amount, balance_before: null, balance_after: null, source: 'backfill',
            details: { ...info.details, recovery: { batch: BATCH, sourceKey: key, capturedAt: evidence.capturedAt,
                evidenceSha256: fingerprint, balanceKnown: false } } });
    }
    for (const user of evidence.users) {
        const a = user.personalDraw?.lastAction;
        if (!a) continue;
        if (!Object.hasOwn(names, a.action) || !a.requestId || !Array.isArray(a.results)) throw new Error('퍼스널뽑기 원본 증빙이 불완전합니다.');
        add(user, a.at, 'draw:' + user.id + ':' + a.requestId, {
            kind: 'consumption', category: 'personal_draw', action: a.action, productId: a.action, productName: names[a.action], amount: a.cost,
            details: { sourceTable: 'rpgenius_user', sourceField: 'personalDraw.lastAction', requestId: a.requestId,
                revision: user.personalDraw.revision, selectedIndex: a.action === 'single' ? a.index : null,
                openedCount: a.results.length, baseCount: a.baseCount, bonusCount: a.results.length - a.baseCount,
                rewards: a.results.map(({ type, id, name, count, bonus }) => ({ type, id, name, count, bonus })) }
        });
    }
    return { rows, skipped };
}
function summarize(result) {
    return { batch: BATCH, count: result.rows.length, consumption: result.rows.filter(r => r.kind === 'consumption').reduce((s, r) => ({ count: s.count + 1, paidCount: s.paidCount + Number(r.amount > 0), amount: s.amount + r.amount }), { count: 0, paidCount: 0, amount: 0 }),
        skipped: result.skipped };
}
async function main() {
    const file = process.argv[2], apply = process.argv.slice(3).includes('--apply');
    if (!file) throw new Error('Usage: node --env-file=.env.local scripts/backfill_point_usage.js <evidence.local> [--apply]');
    const evidence = JSON.parse(fs.readFileSync(file, 'utf8'));
    const { createClient } = require('@supabase/supabase-js');
    const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const existing = [];
    for (let offset = 0; ; offset += 1000) {
        const { data, error } = await db.from('rpgenius_point_usage').select('id,user_id,category,details').order('id').range(offset, offset + 999);
        if (error) throw new Error('기존 기록 확인 실패 (' + error.code + ')');
        existing.push(...data); if (data.length < 1000) break;
    }
    const result = buildRecovery(evidence, existing);
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', ...summarize(result) }, null, 2));
    if (apply && result.rows.length) {
        await require('../point_usage').publish(result.rows);
        const { data, error } = await db.from('rpgenius_point_usage').select('id,amount,kind,source').in('id', result.rows.map(r => r.id));
        if (error || data.length !== result.rows.length || data.some(row => { const expected = result.rows.find(r => r.id === row.id); return row.amount !== expected.amount || row.kind !== expected.kind || row.source !== 'backfill'; })) throw new Error('소급 기록 검증에 실패했습니다.');
        console.log(JSON.stringify({ verified: data.length }));
    }
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { buildRecovery, summarize, FROM, BEFORE };
