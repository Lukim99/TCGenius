const { performance } = require('node:perf_hooks');

// Only fixed stage/action names and durations are exposed, never user data or request IDs.
function requestTiming(action) {
    const startedAt = performance.now(), durations = {};
    const end = (name, start) => { durations[name] = (durations[name] || 0) + Math.max(0, performance.now() - start); };
    return {
        start: () => performance.now(),
        end,
        measure(name, run) {
            const start = performance.now();
            try { return run(); } finally { end(name, start); }
        },
        async measureAsync(name, run) {
            const start = performance.now();
            try { return await run(); } finally { end(name, start); }
        },
        send(res, status, payload) {
            end('total', startedAt);
            res.setHeader('Server-Timing', Object.entries(durations).map(([name, duration]) => name + ';dur=' + duration.toFixed(1)).join(', '));
            if (durations.total >= 1000) console.warn('[paradise timing]', JSON.stringify({ action, status, durations: Object.fromEntries(Object.entries(durations).map(([name, duration]) => [name, Math.round(duration)])) }));
            return res.status(status).json(payload);
        }
    };
}
module.exports = { requestTiming };
