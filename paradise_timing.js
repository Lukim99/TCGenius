const { performance } = require('node:perf_hooks');
const { AsyncLocalStorage } = require('node:async_hooks');
const { randomBytes } = require('node:crypto');
const diagnostics = require('node:diagnostics_channel');
const context = new AsyncLocalStorage();
const pendingWork = new WeakMap();
const activeWork = new Map();
const id = () => randomBytes(6).toString('hex');
const rounded = values => Object.fromEntries(Object.entries(values).map(([key, value]) => [key, Math.round(value)]));
const sample = () => ({ at: performance.now(), cpu: process.cpuUsage(), loop: performance.eventLoopUtilization() });
function elapsed(start) {
    const cpu = process.cpuUsage(start.cpu), loop = performance.eventLoopUtilization(start.loop);
    return rounded({ ms: performance.now() - start.at, cpuMs: (cpu.user + cpu.system) / 1000, loopActiveMs: loop.active, loopIdleMs: loop.idle });
}
const errorName = error => /^[A-Za-z0-9_]+$/.test(error?.name) ? error.name : 'Error';
const errorCode = error => typeof error?.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(error.code) ? error.code : undefined;

// Track existing persistence work, including jobs that began before a request joined them.
// Opaque trace/work IDs have no relationship to an account, run or request ID.
function measureWork(name, run, waitingFor) {
    const inherited = context.getStore(), timing = inherited?.timing?.closed ? null : inherited?.timing;
    const work = { id: id(), name, ...(inherited?.operation?.active ? { parent: inherited.operation.id } : {}), ...(waitingFor ? { waitingFor } : {}) };
    const start = sample();
    work.active = true;
    activeWork.set(work.id, work);
    timing?.active.set(work.id, work);
    const promise = context.run({ timing, stage: inherited?.stage, operation: work }, async () => {
        try { return await run(work); }
        catch (error) { work.error = errorName(error); work.errorCode = errorCode(error); throw error; }
        finally {
            delete work.active;
            activeWork.delete(work.id);
            Object.assign(work, elapsed(start));
            timing?.active.delete(work.id);
            if (timing && !timing.closed) {
                if (timing.operations.length < 32) timing.operations.push({ ...work, stage: inherited?.stage });
                else timing.omitted++;
            }
            if (work.ms >= 1000 || work.error) console.warn('[persistence timing]', JSON.stringify({ trace: timing?.trace || null, ...work }));
        }
    });
    pendingWork.set(promise, work.id);
    return promise;
}
function waitFor(name, promise) {
    return promise ? measureWork(name, () => promise, pendingWork.get(promise)) : Promise.resolve();
}
function pendingOperations(timing) {
    const linked = new Map(timing.active);
    let previous;
    do {
        previous = linked.size;
        for (const work of linked.values()) if (activeWork.has(work.waitingFor)) linked.set(work.waitingFor, activeWork.get(work.waitingFor));
        for (const work of activeWork.values()) if (linked.has(work.parent)) linked.set(work.id, work);
    } while (linked.size !== previous);
    return [...linked.values()];
}

let observingHttp = false;
function instrumentDynamo(client) {
    if (!observingHttp) {
        observingHttp = true;
        diagnostics.channel('http.client.request.start').subscribe(({ request }) => {
            const store = context.getStore(), attempt = store?.attempt;
            if (!attempt) return;
            const started = performance.now(), network = { reused: !!request.reusedSocket, dispatchMs: Math.round(performance.now() - store.attemptStartedAt) };
            attempt.network = network;
            const mark = name => { network[name + 'Ms'] = Math.round(performance.now() - started); };
            const socket = request.socket, listeners = [];
            if (socket?.connecting) for (const [event, phase] of [['lookup', 'dns'], ['connect', 'tcp'], ['secureConnect', 'tls']]) {
                const listener = () => mark(phase);
                socket.once(event, listener); listeners.push([event, listener]);
            }
            request.once('finish', () => mark('sent'));
            request.once('response', response => {
                mark('headers');
                response.once('end', () => mark('body'));
            });
            request.once('error', error => { network.error = errorName(error); network.errorCode = errorCode(error); });
            request.once('close', () => {
                mark('closed');
                for (const [event, listener] of listeners) socket.removeListener(event, listener);
            });
        });
    }
    client.middlewareStack.add((next, sdk) => args => measureWork('dynamodb', async work => {
        work.command = sdk.commandName;
        work.tries = [];
        try {
            const result = await next(args);
            work.attempts = result.output?.$metadata?.attempts;
            work.retryDelayMs = result.output?.$metadata?.totalRetryDelay;
            work.awsRequestId = result.output?.$metadata?.requestId;
            return result;
        } catch (error) {
            work.attempts = error.$metadata?.attempts;
            work.retryDelayMs = error.$metadata?.totalRetryDelay;
            throw error;
        }
    }), { step: 'initialize', name: 'paradisePersistenceTiming' });
    client.middlewareStack.addRelativeTo(next => async args => {
        const work = context.getStore()?.operation, start = sample();
        const attempt = {};
        if (work?.tries) work.tries.push(attempt);
        try { const result = await context.run({ ...context.getStore(), attempt, attemptStartedAt: start.at }, () => next(args)); attempt.status = result.response?.statusCode; return result; }
        catch (error) { attempt.error = errorName(error); attempt.errorCode = errorCode(error); attempt.status = error.$metadata?.httpStatusCode; throw error; }
        finally { Object.assign(attempt, elapsed(start)); }
    }, { relation: 'after', toMiddleware: 'retryMiddleware', name: 'paradiseAttemptTiming' });
}

// Only stage/action names, opaque IDs and timings are exposed, never game data or credentials.
function requestTiming(action, response) {
    const started = sample(), startedAt = started.at, durations = {};
    const end = (name, start) => { durations[name] = (durations[name] || 0) + Math.max(0, performance.now() - start); };
    const timing = {
        trace: id(), closed: false, active: new Map(), operations: [], omitted: 0,
        run: run => context.run({ timing }, run),
        start: () => performance.now(),
        end,
        measure(name, run) {
            const start = performance.now();
            try { return context.run({ timing, stage: name }, run); } finally { end(name, start); }
        },
        async measureAsync(name, run) {
            const start = performance.now();
            try { return await context.run({ timing, stage: name }, run); } finally { end(name, start); }
        },
        send(res, status, payload) {
            durations.total = Math.max(0, performance.now() - startedAt);
            clearInterval(watchdog);
            timing.closed = true;
            res.setHeader('X-Paradise-Trace', timing.trace);
            res.setHeader('Server-Timing', Object.entries(durations).map(([name, duration]) => name + ';dur=' + duration.toFixed(1)).join(', '));
            if (durations.total >= 1000 || status >= 500) console.warn('[paradise timing]', JSON.stringify({ trace: timing.trace, action, status, durations: rounded(durations), runtime: elapsed(started), operations: timing.operations, omitted: timing.omitted }));
            return res.status(status).json(payload);
        }
    };
    let pendingLogs = 0;
    const watchdog = setInterval(() => {
        console.warn('[paradise pending]', JSON.stringify({ trace: timing.trace, action, durations: rounded(durations), runtime: elapsed(started), active: pendingOperations(timing) }));
        if (++pendingLogs === 6) clearInterval(watchdog);
    }, 10000);
    watchdog.unref();
    let finished = false;
    response?.once?.('finish', () => {
        finished = true;
        if (performance.now() - startedAt >= 1000) console.warn('[paradise transport]', JSON.stringify({ trace: timing.trace, action, event: 'finish', status: response.statusCode, ...elapsed(started) }));
    });
    response?.once?.('close', () => {
        if (!finished) console.warn('[paradise transport]', JSON.stringify({ trace: timing.trace, action, event: 'disconnect', ...elapsed(started) }));
    });
    return timing;
}
module.exports = { requestTiming, measureWork, waitFor, instrumentDynamo };
