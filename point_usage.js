'use strict';

const crypto = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const { createClient } = require('@supabase/supabase-js');
const context = new AsyncLocalStorage();
const staged = new WeakMap();
const OUTBOX = 'pointUsageOutbox';
let client;

function getClient() {
    const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_KEY || '';
    let role;
    if (key.startsWith('eyJ')) { try { role = JSON.parse(Buffer.from(key.split('.')[1], 'base64url')).role; } catch (_) {} }
    if (key.startsWith('sb_publishable_') || role === 'anon') throw new Error('SUPABASE_SECRET_KEY에 서버용 secret/service_role 키를 설정해주세요. 공개용 키로는 포인트 기록에 접근할 수 없습니다.');
    if (!client && process.env.SUPABASE_URL && key) client = createClient(process.env.SUPABASE_URL, key, {
        auth: { persistSession: false, autoRefreshToken: false }
    });
    return client;
}

// Called after a debit, before saving. These events are not published until the wallet write succeeds.
function record(user, info) {
    const amount = Number(info.amount);
    const after = Number(info.balanceAfter ?? user.point ?? 0);
    const before = Number(info.balanceBefore ?? after + amount);
    if (![amount, before, after].every(Number.isSafeInteger) || before - after !== amount) throw new Error('포인트 기록 금액이 올바르지 않습니다.');
    const event = {
        id: crypto.randomUUID(), occurred_at: new Date().toISOString(), user_id: String(user.id), nickname: String(user.name || ''),
        is_admin: !!user.isAdmin, kind: info.kind || 'consumption', category: info.category, action: info.action,
        product_id: String(info.productId || info.action), product_name: info.productName,
        quantity: info.quantity ?? 1, amount, balance_before: before, balance_after: after,
        source: context.getStore()?.source || info.source || 'game', details: info.details || {}
    };
    if (!event.category || !event.action || !event.product_name || !Number.isSafeInteger(event.quantity) || event.quantity < 1) throw new Error('포인트 사용처 정보가 올바르지 않습니다.');
    const events = staged.get(user) || [];
    events.push(event); staged.set(user, events);
    return event.id;
}

function pending(user, previousPoint) {
    let events = staged.get(user) || [];
    const amount = Number(previousPoint || 0) - Number(user.point || 0);
    if (!events.length && amount > 0) {
        record(user, { amount, category: 'unclassified', action: 'balance_decrease', productName: '미분류 포인트 차감', details: { needsReview: true } });
        events = staged.get(user);
    }
    return events;
}

function append(outbox, events) {
    const next = { ...(outbox || {}), ...Object.fromEntries(events.map(event => [event.id, event])) };
    // A prolonged delivery outage must not grow the DynamoDB wallet beyond its item limit.
    if (Buffer.byteLength(JSON.stringify(next)) > 128 * 1024) throw new Error('포인트 사용 기록을 전송 중입니다. 잠시 후 다시 시도해주세요.');
    return next;
}

async function publish(events) {
    const db = getClient();
    if (!db) throw new Error('SUPABASE_URL / SUPABASE_SECRET_KEY(또는 서버용 SUPABASE_KEY)가 설정되지 않았습니다.');
    const { error } = await db.from('rpgenius_point_usage').upsert(events, { onConflict: 'id', ignoreDuplicates: true }).abortSignal(AbortSignal.timeout(10000));
    if (error) throw new Error('포인트 기록 전송 실패 (' + (error.code || 'network') + ')');
}

function filters(query) {
    const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
    const from = query.from || today.slice(0, 7) + '-01', to = query.to || today;
    for (const date of [from, to]) {
        if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error('날짜를 YYYY-MM-DD 형식으로 입력해주세요.');
    }
    if (from > to) throw new Error('시작일은 종료일보다 늦을 수 없습니다.');
    const kinds = ['consumption', 'transfer', 'adjustment', 'reversal', 'all'];
    const kind = query.kind || 'consumption';
    const category = query.category || '', search = query.search || '';
    if (!kinds.includes(kind) || typeof category !== 'string' || category.length > 80 || typeof search !== 'string' || search.length > 100) throw new Error('조회 조건이 올바르지 않습니다.');
    const page = Number(query.page || 0);
    if (!Number.isSafeInteger(page) || page < 0 || page > 1000000) throw new Error('페이지가 올바르지 않습니다.');
    return { p_from: new Date(from + 'T00:00:00+09:00').toISOString(),
        p_to: new Date(Date.parse(to + 'T00:00:00+09:00') + 86400000).toISOString(),
        p_kind: kind === 'all' ? null : kind, p_category: category || null, p_search: search || null,
        p_offset: page * 50 };
}

async function report(params) {
    const db = getClient();
    if (!db) throw new Error('포인트 통계용 Supabase 연결이 설정되지 않았습니다.');
    const { data, error } = await db.rpc('rpgenius_point_usage_report', params).abortSignal(AbortSignal.timeout(15000));
    if (error) throw new Error('포인트 통계를 불러오지 못했습니다. (' + (error.code || 'network') + ')');
    return data;
}

module.exports = { OUTBOX, record, pending, append, clear: user => staged.delete(user), publish, filters, report,
    withSource: (source, task) => context.run({ source }, task) };
