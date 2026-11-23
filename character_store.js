'use strict';

const crypto = require('node:crypto');
const accounts = require('./character_accounts');
const { GetCommand, UpdateCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const clone = value => value === undefined ? undefined : structuredClone(value);
const same = require('node:util').isDeepStrictEqual;

function createStore(deps) {
    const { table, client, entries, putEntry, flush, items, usage, deliver } = deps;
    const queues = new Map();
    function serial(ids, task) {
        const owners = [...new Set(ids)].sort();
        const previous = owners.map(id => queues.get(id)).filter(Boolean);
        const job = Promise.allSettled(previous).then(task);
        owners.forEach(id => queues.set(id, job));
        return job.finally(() => { for (const id of owners) if (queues.get(id) === job) queues.delete(id); });
    }
    const accountFor = user => user?.accountId ? entries.get(user.accountId)?.raw : null;
    const members = user => {
        const account = accountFor(user);
        return (account?.characterIds || [user.id]).map(id => entries.get(id)?.raw).filter(Boolean);
    };
    const hydrate = raw => accounts.hydrate(raw, accountFor(raw));

    async function readReceipt(accountId, requestId) {
        const response = await client.send(new GetCommand({ TableName: 'rpgenius_sid',
            Key: { senderId: 'character-action:' + accountId + ':' + requestId }, ConsistentRead: true }));
        return response.Item;
    }

    function receiptOperation(accountId, requestId, fingerprint, result) {
        return { Put: { TableName: 'rpgenius_sid', Item: {
            senderId: 'character-action:' + accountId + ':' + requestId, fingerprint, result
        }, ConditionExpression: 'attribute_not_exists(senderId)' } };
    }

    function remember(raw) { putEntry(raw); }

    async function transact(plans, extras = []) {
        const changed = plans.filter(plan => Object.keys(plan.changes).length);
        if (!changed.length && !extras.length) return;
        const operations = changed.map(plan => ({ Update: accounts.updateInput(table, plan.id, plan.changes, plan.before) }));
        try {
            // A conditional single-row update has the same guarantee at half the transactional write cost.
            if (operations.length === 1 && !extras.length) await client.send(new UpdateCommand(operations[0].Update));
            else await client.send(new TransactWriteCommand({ ClientRequestToken: crypto.randomUUID(), TransactItems: [...operations, ...extras] }));
        } catch (error) {
            const fresh = await Promise.all(changed.map(async plan => (await client.send(new GetCommand({
                TableName: table, Key: { id: plan.id }, ConsistentRead: true
            }))).Item));
            // A lost response can follow a successful atomic write. Reconcile before reporting failure.
            let committed = changed.length && changed.every((plan, index) => fresh[index]
                && Object.entries(plan.changes).every(([key, value]) => same(fresh[index][key], value)));
            if (committed && extras.length) {
                for (const operation of extras) {
                    if (!operation.Put) { committed = false; break; }
                    const { TableName, Item } = operation.Put;
                    const key = ['id', 'senderId', 'key'].find(key => Object.hasOwn(Item, key));
                    if (!key) { committed = false; break; }
                    const saved = await client.send(new GetCommand({ TableName, Key: { [key]: Item[key] }, ConsistentRead: true }));
                    if (!same(saved.Item, Item)) { committed = false; break; }
                }
            }
            if (!committed) {
                if (error.name === 'ConditionalCheckFailedException' || error.CancellationReasons?.some(reason => reason.Code === 'ConditionalCheckFailed')) {
                    fresh.filter(Boolean).forEach(putEntry);
                    error.status = 409;
                }
                throw error;
            }
            fresh.filter(Boolean).forEach(putEntry);
            return;
        }
        for (const plan of changed) {
            const raw = clone(entries.get(plan.id)?.raw || { id: plan.id });
            for (const [key, value] of Object.entries(plan.changes)) {
                if (value === undefined) delete raw[key];
                else raw[key] = clone(value);
            }
            putEntry(raw);
        }
    }

    async function migrate(user) {
        if (user.accountId) return accountFor(user);
        const existing = entries.get('account:' + user.id)?.raw;
        if (existing) return existing;
        const result = await flush(user.id);
        if (!result.success) throw result.result[0];
        if (entries.get(user.id)?.usageDelivery) await entries.get(user.id).usageDelivery;
        const prior = clone(entries.get(user.id).raw);
        const { account, character } = accounts.migrate(prior, items(), deps.shops?.());
        const changes = Object.fromEntries([...new Set([...Object.keys(prior), ...Object.keys(character)])]
            .filter(key => key !== 'id' && !same(prior[key], character[key])).map(key => [key, character[key]]));
        await transact([{ id: user.id, changes, before: prior }], [{ Put: {
            TableName: table, Item: account, ConditionExpression: 'attribute_not_exists(id)'
        } }]);
        putEntry(account);
        return account;
    }

    async function flushPending(ownerId) {
        const account = entries.get(ownerId)?.raw;
        const ids = account?.recordType === 'account' ? [ownerId, ...account.characterIds] : [ownerId];
        const plans = [];
        for (const id of ids) {
            const entry = entries.get(id);
            if (entry?.usageDelivery) await entry.usageDelivery;
            if (!entry?.dirty) continue;
            const changes = {}, before = {};
            for (const key of new Set([...Object.keys(entry.raw), ...Object.keys(entry.dbSnap)])) {
                if (key === 'id' || JSON.stringify(entry.raw[key]) === entry.dbSnap[key]) continue;
                changes[key] = clone(entry.raw[key]);
                before[key] = entry.dbSnap[key] === undefined ? undefined : JSON.parse(entry.dbSnap[key]);
            }
            plans.push({ id, changes, before });
        }
        await transact(plans);
        for (const plan of plans) {
            const entry = entries.get(plan.id);
            entry.dirty = false;
            if (entry.timer) { clearTimeout(entry.timer); entry.timer = null; }
            deliver(entry);
        }
    }

    function flushGroup(ownerId) {
        return serial([ownerId], async () => {
            try { await flushPending(ownerId); return { success: true, result: ['updated'] }; }
            catch (error) { return { success: false, result: [error] }; }
        });
    }

    function commit(users, options = {}) {
        return serial(users.map(user => user.accountId || user.id), () => commitNow(users, options));
    }

    async function commitNow(users, options) {
        const plans = new Map();
        const add = plan => {
            if (!plan.id) return;
            const existing = plans.get(plan.id) || { id: plan.id, changes: {}, before: {} };
            for (const [key, value] of Object.entries(plan.changes)) {
                if (Object.hasOwn(existing.changes, key) && !same(existing.changes[key], value)) {
                    throw new Error('같은 계정의 공유 정보를 동시에 변경할 수 없습니다.');
                }
                existing.changes[key] = value;
                existing.before[key] = plan.before[key];
            }
            plans.set(plan.id, existing);
        };
        for (const user of users) {
            const keys = options.keys || [...new Set([...Object.keys(user), ...Object.keys(user.__loaded || {})])];
            const ownerId = user.accountId || user.id;
            if (!options.defer) {
                if (user.accountId) await flushPending(ownerId);
                const flushed = user.accountId ? { success: true } : await flush(user.id);
                if (!flushed.success) throw flushed.result[0];
                if (entries.get(ownerId)?.usageDelivery) await entries.get(ownerId).usageDelivery;
            }
            if (keys.includes('point')) {
                const events = usage.pending(user, JSON.parse(user.__loaded?.point || '0'));
                if (events.length) {
                    const entry = entries.get(ownerId);
                    if (entry?.usageDelivery) await entry.usageDelivery;
                    const previous = entries.get(ownerId)?.raw[usage.OUTBOX];
                    add({ id: ownerId, changes: { [usage.OUTBOX]: usage.append(previous, events) }, before: { [usage.OUTBOX]: previous } });
                }
            }
            const effectiveKeys = keys.filter(key => key !== usage.OUTBOX);
            if (user.accountId) accounts.splitChanges(user, effectiveKeys, items()).forEach(add);
            else {
                const changes = {}, before = {};
                for (const key of effectiveKeys) {
                    if (key === 'id' || user.__loaded?.[key] === JSON.stringify(user[key])) continue;
                    changes[key] = clone(user[key]);
                    before[key] = user.__loaded?.[key] === undefined ? undefined : JSON.parse(user.__loaded[key]);
                }
                add({ id: user.id, changes, before });
            }
        }
        if (options.accountChange) add(options.accountChange);
        const canDefer = options.defer && !options.extras?.length && ![...plans.values()].some(plan => Object.hasOwn(plan.changes, 'point'));
        if (canDefer) {
            // Keep the existing hunting/fishing write-combining window, including the shared wallet.
            for (const plan of plans.values()) {
                const raw = entries.get(plan.id)?.raw;
                if (Object.entries(plan.before).some(([key, value]) => !same(raw?.[key], value))) {
                    throw new Error('캐릭터 정보가 변경되었습니다. 다시 시도해주세요.');
                }
            }
            for (const plan of plans.values()) {
                if (!Object.keys(plan.changes).length) continue;
                const entry = entries.get(plan.id);
                for (const [key, value] of Object.entries(plan.changes)) {
                    if (value === undefined) delete entry.raw[key]; else entry.raw[key] = clone(value);
                }
                entry.dirty = true;
                deps.schedule(entry);
            }
        } else {
            if (options.defer) for (const user of users) await flushPending(user.accountId || user.id);
            await transact([...plans.values()], options.extras);
        }
        for (const user of users) {
            const fresh = hydrate(entries.get(user.id).raw);
            const keys = options.keys || [...new Set([...Object.keys(user), ...Object.keys(user.__loaded || {})])];
            for (const key of keys) {
                if (key === usage.OUTBOX) continue;
                if (fresh[key] === undefined) { delete user[key]; delete user.__loaded[key]; }
                else { user[key] = clone(fresh[key]); user.__loaded[key] = JSON.stringify(fresh[key]); }
            }
            usage.clear(user);
            deliver(entries.get(user.accountId || user.id));
        }
    }

    return { accountFor, members, hydrate, migrate, transact, commit, flushGroup, readReceipt, receiptOperation, remember };
}

module.exports = { createStore };
