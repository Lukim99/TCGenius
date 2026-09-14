const { range, sum, pick, shuffle, permutations, product, scalar, deduce, letter, bits, popcount, neighbors } = require('./core');

// 양의 비용을 갖는 유한 상태 공간에서 최솟값을 계산한다.
function shortest(start, next, goal) {
    const key = state => JSON.stringify(state), distances = new Map([[key(start), 0]]), heap = [[0, start]];
    function push(entry) {
        let i = heap.length; heap.push(entry);
        while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= entry[0]) break; heap[i] = heap[p]; i = p; }
        heap[i] = entry;
    }
    function pop() {
        const first = heap[0], last = heap.pop();
        if (heap.length) {
            let i = 0;
            while (i * 2 + 1 < heap.length) {
                let c = i * 2 + 1; if (c + 1 < heap.length && heap[c + 1][0] < heap[c][0]) c++;
                if (heap[c][0] >= last[0]) break;
                heap[i] = heap[c]; i = c;
            }
            heap[i] = last;
        }
        return first;
    }
    while (heap.length) {
        const [cost, state] = pop();
        if (distances.get(key(state)) !== cost) continue;
        if (goal(state)) return cost;
        for (const [target, weight] of next(state)) {
            const k = key(target), d = cost + weight;
            if (d < (distances.get(k) ?? Infinity)) { distances.set(k, d); push([d, target]); }
        }
    }
    return Infinity;
}
function graph(random, n, probability = 0.4) {
    const edges = [];
    for (let b = 1; b < n; b++) edges.push([Math.floor(random() * b), b]);
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
        if (!edges.some(e => e[0] === a && e[1] === b) && random() < probability) edges.push([a, b]);
    }
    return edges;
}
const edgeText = e => letter(e[0]) + '↔' + letter(e[1]);
function shortestPath(random) {
    const edges = graph(random, 7).map(e => [...e, 2 + Math.floor(random() * 18)]);
    const distance = shortest(0, v => edges.flatMap(([a, b, w]) => a === v ? [[b, w]] : b === v ? [[a, w]] : []), v => v === 6);
    return scalar(distance, ['A에서 G까지 이동하는 최소 비용을 구하세요. 길은 양방향이며 비용은 이동할 때마다 더합니다.'], edges.map(e => edgeText(e) + ': ' + e[2]));
}
function salesman(random) {
    const costs = range(6).map(() => Array(6).fill(0)), clues = [];
    for (let a = 0; a < 6; a++) for (let b = a + 1; b < 6; b++) {
        costs[a][b] = costs[b][a] = 2 + Math.floor(random() * 18); clues.push(edgeText([a, b]) + ': ' + costs[a][b]);
    }
    let best, bestCost = Infinity;
    for (const order of permutations([1, 2, 3, 4, 5])) {
        const route = [0, ...order, 0], cost = sum(route.slice(1).map((b, i) => costs[route[i]][b]));
        if (cost < bestCost) { bestCost = cost; best = route.map(letter).join(''); }
    }
    return scalar(best, ['A에서 출발하여 B~F를 각각 한 번 방문하고 A로 돌아오는 최소 비용 경로를 찾으세요. 길은 양방향입니다.',
        '최소 비용 경로가 여럿이면 A<B<C<D<E<F 순서로 사전순에서 가장 앞선 것을 고릅니다. 출발·도착 A를 포함한 7글자를 입력하세요.'], clues, { symbols: 'ABCDEF' });
}
function deadlines(random) {
    const jobs = range(6).map(() => [1 + Math.floor(random() * 7), 4 + Math.floor(random() * 21)]);
    let best, score = Infinity;
    for (const order of permutations(range(6))) {
        let time = 0, late = 0;
        for (const i of order) { time += jobs[i][0]; late += Math.max(0, time - jobs[i][1]); }
        if (late < score) { score = late; best = order.map(letter).join(''); }
    }
    return scalar(best, ['시각 0부터 A~F 작업을 한 번에 하나씩, 중단이나 휴식 없이 모두 수행하세요.',
        '각 작업의 지각 시간은 max(0, 완료 시각 − 마감 시각)입니다. 지각 시간 합계가 최소인 작업 순서를 입력하세요.',
        '동점이면 A<B<C<D<E<F 순서로 사전순에서 가장 앞선 순서를 고릅니다.'], jobs.map(([d, t], i) => letter(i) + ': 소요 ' + d + ', 마감 ' + t), { symbols: 'ABCDEF', allowRepeats: false });
}
let riverCases;
function river(random) {
    if (!riverCases) {
        riverCases = [];
        for (let n = 3; n <= 8; n++) for (let capacity = 2; capacity <= 4; capacity++) {
            const moves = product(range(capacity + 1), 2).filter(([m, c]) => m + c >= 1 && m + c <= capacity);
            const steps = shortest([n, n, 0], ([m, c, side]) => moves.flatMap(([dm, dc]) => {
                const a = m + (side ? dm : -dm), b = c + (side ? dc : -dc);
                if (a < 0 || b < 0 || a > n || b > n || (a && a < b) || (n - a && n - a < n - b)) return [];
                return [[[a, b, 1 - side], 1]];
            }), ([m, c]) => !m && !c);
            if (Number.isFinite(steps) && steps >= 7) riverCases.push({ n, capacity, steps });
        }
    }
    const { n, capacity, steps } = pick(riverCases, random);
    return scalar(steps, ['현자와 도적을 모두 왼쪽 강변에서 오른쪽으로 옮기는 최소 도항 횟수를 구하세요.',
        '양쪽 강변에서 현자가 한 명이라도 있으면 도적 수가 현자 수를 넘으면 안 됩니다. 배 안에는 이 제한이 없습니다.',
        '배는 왼쪽에서 시작하며, 매번 1명 이상 정원 이하로 탑승해야 합니다. 누구나 배를 운전하며, 돌아오는 이동도 1회입니다.'], ['현자 ' + n + '명, 도적 ' + n + '명 / 배 정원 ' + capacity + '명']);
}
function jugs(random) {
    const capacity = shuffle(range(9).map(n => n + 3), random).slice(0, 3).sort((a, b) => a - b);
    const next = state => {
        const out = [];
        for (let i = 0; i < 3; i++) {
            if (state[i] < capacity[i]) { const v = state.slice(); v[i] = capacity[i]; out.push([v, 1]); }
            if (state[i]) { const v = state.slice(); v[i] = 0; out.push([v, 1]); }
            for (let j = 0; j < 3; j++) if (i !== j && state[i] && state[j] < capacity[j]) {
                const v = state.slice(), d = Math.min(v[i], capacity[j] - v[j]); v[i] -= d; v[j] += d; out.push([v, 1]);
            }
        }
        return out;
    };
    const choices = range(capacity[2] - 1).map(n => n + 1).map(target => ({ target, steps: shortest([0, 0, 0], next, v => v[2] === target) })).filter(c => Number.isFinite(c.steps));
    const hardest = Math.max(...choices.map(c => c.steps));
    const { target, steps } = pick(choices.filter(c => c.steps === hardest), random);
    return scalar(steps, ['세 물통이 모두 비어 있습니다. C에 목표량의 물을 만드는 최소 조작 횟수를 구하세요. A·B의 최종 물의 양은 상관없습니다.',
        '한 번의 조작: 수도로 한 통을 가득 채우기 / 한 통을 전부 비우기 / 한 통에서 다른 통으로, 붓는 통이 비거나 받는 통이 찰 때까지 붓기.',
        '눈금은 없으며 중간에 붓기를 멈출 수 없습니다.'], capacity.map((c, i) => letter(i) + ': ' + c + 'L').concat('C의 목표량: ' + target + 'L'));
}
function bridge(random) {
    const times = shuffle(range(24).map(n => n + 1), random).slice(0, 5).sort((a, b) => a - b);
    const full = 31;
    const cost = shortest([0, 0], ([mask, side]) => {
        const here = range(5).filter(i => ((mask >> i) & 1) === side), groups = here.map(i => [i]);
        for (let a = 0; a < here.length; a++) for (let b = a + 1; b < here.length; b++) groups.push([here[a], here[b]]);
        return groups.map(group => [[mask ^ group.reduce((m, i) => m | (1 << i), 0), 1 - side], Math.max(...group.map(i => times[i]))]);
    }, ([mask]) => mask === full);
    return scalar(cost, ['5명과 횃불이 왼쪽에 있습니다. 모두 오른쪽으로 건너는 최소 총 시간을 구하세요.',
        '다리는 횃불을 든 1명 또는 2명이 함께 건널 수 있습니다. 걸리는 시간은 함께 건너는 사람 중 느린 사람의 시간입니다.',
        '오른쪽에서 돌아올 때도 횃불이 필요하고 똑같은 규칙을 따릅니다. 횃불을 던질 수 없습니다.'], times.map((t, i) => letter(i) + ': ' + t + '분'));
}
function hanoi(random) {
    const costs = range(3).map((_, a) => range(3).map(b => a === b ? 0 : 1 + Math.floor(random() * 8)));
    const start = range(3).map(() => Math.floor(random() * 3)).concat(Math.floor(random() * 2));
    const result = shortest(start, state => {
        const top = range(3).map(p => state.findIndex(x => x === p)), out = [];
        for (let a = 0; a < 3; a++) if (top[a] >= 0) for (let b = 0; b < 3; b++) {
            if (a === b || (top[b] >= 0 && top[b] < top[a])) continue;
            const v = state.slice(); v[top[a]] = b; out.push([v, costs[a][b]]);
        }
        return out;
    }, v => v.every(p => p === 2));
    return scalar(result, ['크기가 1<2<3<4인 원판을 모두 C 기둥으로 옮기는 최소 비용을 구하세요.',
        '한 번에 맨 위 원판 하나만 옮기며, 작은 원판 위에 큰 원판을 놓을 수 없습니다. 각 기둥은 처음부터 큰 원판이 아래에 있습니다.',
        '비용은 방향에 따라 다르고 원판 크기와는 무관합니다.'], start.map((p, i) => '원판 ' + (i + 1) + ': ' + letter(p)).concat(costs.flatMap((row, a) => row.flatMap((w, b) => a === b ? [] : [letter(a) + '→' + letter(b) + ': ' + w]))));
}
let slidingCases;
function sliding(random) {
    if (!slidingCases) {
        const queue = ['123456780'], distances = new Map([[queue[0], 0]]), adj = neighbors(3); slidingCases = [];
        for (let head = 0; head < queue.length; head++) {
            const state = queue[head], d = distances.get(state), blank = state.indexOf('0');
            if (d >= 18) slidingCases.push([state, d]);
            if (d === 23) continue;
            for (const j of adj[blank]) {
                const xs = [...state]; [xs[j], xs[blank]] = [xs[blank], xs[j]]; const next = xs.join('');
                if (!distances.has(next)) { distances.set(next, d + 1); queue.push(next); }
            }
        }
    }
    const [board, steps] = pick(slidingCases, random);
    return scalar(steps, ['0은 빈칸입니다. 빈칸과 상하좌우로 붙은 숫자 하나를 빈칸으로 미는 것이 1회 이동입니다.',
        '목표 배치 1 2 3 / 4 5 6 / 7 8 0 으로 바꾸는 최소 이동 횟수를 구하세요.'], [], { displayGrid: { size: 3, cells: [...board] } });
}
let lightsCases;
function lightsOut(random) {
    if (!lightsCases) {
        const adj = neighbors(4), toggles = range(16).map(i => [i, ...adj[i]].reduce((m, j) => m | (1 << j), 0)), best = new Map();
        for (let press = 0; press < 65536; press++) {
            let state = 0; for (let i = 0; i < 16; i++) if (press & (1 << i)) state ^= toggles[i];
            const n = popcount(press); if (n < (best.get(state) ?? Infinity)) best.set(state, n);
        }
        lightsCases = [...best].filter(([, n]) => n >= 5);
    }
    const [mask, count] = pick(lightsCases, random);
    return scalar(count, ['1은 켜진 등불, 0은 꺼진 등불입니다. 한 칸을 누르면 그 칸과 상하좌우 이웃의 등불 상태가 모두 반전됩니다.',
        '격자 밖으로 이어지지 않습니다. 모든 등불을 끄는 최소 누름 횟수를 구하세요.'], [], { displayGrid: { size: 4, cells: [...bits(mask, 16)] } });
}
function maze(random) {
    const adj = neighbors(4), corridors = range(16).map(() => []), seen = new Set([0]);
    function carve(i) {
        for (const j of shuffle(adj[i], random)) if (!seen.has(j)) { seen.add(j); corridors[i].push(j); corridors[j].push(i); carve(j); }
    }
    carve(0);
    const paths = Array(16); paths[0] = ''; const queue = [0];
    for (let head = 0; head < queue.length; head++) for (const j of corridors[queue[head]]) if (paths[j] == null) {
        const i = queue[head]; paths[j] = paths[i] + (j === i - 4 ? 'U' : j === i + 4 ? 'D' : j === i - 1 ? 'L' : 'R'); queue.push(j);
    }
    const longest = Math.max(...paths.map(p => p.length)), target = pick(range(16).filter(i => paths[i].length === longest), random), cells = Array(81).fill('■');
    for (let i = 0; i < 16; i++) {
        const r = Math.floor(i / 4) * 2 + 1, c = i % 4 * 2 + 1; cells[r * 9 + c] = i === 0 ? 'S' : i === target ? 'G' : '·';
        for (const j of corridors[i]) { const rr = Math.floor(j / 4) * 2 + 1, cc = j % 4 * 2 + 1; cells[(r + rr) / 2 * 9 + (c + cc) / 2] = '·'; }
    }
    return scalar(paths[target], ['S에서 G까지 같은 방을 두 번 방문하지 않는 경로를 입력하세요. ■는 벽입니다.',
        '방은 2·4·6·8행과 2·4·6·8열의 교차점에 있고, 그 사이의 ·는 통로입니다. 통로로 이웃 방까지 이동하는 것이 한 글자입니다.',
        '위 U / 아래 D / 왼쪽 L / 오른쪽 R. 예: 오른쪽 방으로 간 뒤 아래 방으로 가면 RD입니다.'], [], { symbols: 'UDLR', displayGrid: { size: 9, cells } });
}
function hamilton(random) {
    const secret = shuffle(range(8), random), pathEdges = secret.slice(1).map((b, i) => [Math.min(secret[i], b), Math.max(secret[i], b)]);
    const all = permutations(secret.slice(1, -1)).map(mid => [secret[0], ...mid, secret[7]]);
    let edges = [...pathEdges, ...graph(random, 8, 0.3)].filter((e, i, xs) => xs.findIndex(v => v[0] === e[0] && v[1] === e[1]) === i);
    const fits = route => route.slice(1).every((b, i) => edges.some(([x, y]) => (route[i] === x && b === y) || (route[i] === y && b === x)));
    for (const edge of shuffle(edges.filter(e => !pathEdges.some(p => p[0] === e[0] && p[1] === e[1])), random)) {
        if (all.filter(fits).length === 1) break;
        edges = edges.filter(e => e !== edge);
    }
    return scalar(secret.map(letter).join(''), ['각 지점 A~H를 정확히 한 번 방문하는 경로를 찾으세요. 길은 양방향입니다.',
        letter(secret[0]) + '에서 시작해 ' + letter(secret[7]) + '에서 끝납니다. 출발·도착을 포함한 8글자를 입력하세요.'], edges.map(edgeText), { symbols: 'ABCDEFGH', allowRepeats: false });
}
function euler(random) {
    const ring = shuffle(range(6), random), edges = ring.map((a, i) => [a, ring[(i + 1) % 6]]);
    const hub = pick(range(6), random), others = shuffle(range(6).filter(i => i !== hub && !edges.some(e => e.includes(i) && e.includes(hub))), random);
    // 원형 길에 왕복 전용 평행 간선을 추가해도 각 길은 별개의 길로 구분된다.
    const destination = others[0]; edges.push([hub, destination], [hub, destination]);
    function visit(v, used, route) {
        if (used === (1 << edges.length) - 1) return route;
        for (const [j, i] of edges.flatMap(([a, b], i) => used & (1 << i) ? [] : a === v ? [[b, i]] : b === v ? [[a, i]] : []).sort((a, b) => a[0] - b[0])) {
            const found = visit(j, used | (1 << i), route + letter(j)); if (found) return found;
        }
        return null;
    }
    return scalar(visit(0, 0, 'A'), ['A에서 출발하여 모든 길을 정확히 한 번씩 지나는 경로를 찾으세요. 지점은 여러 번 방문할 수 있습니다.',
        '같은 두 지점 사이에 적힌 길이 두 개면 서로 다른 길입니다. 모든 길은 양방향입니다.',
        '가능한 경로 중 A<B<C<D<E<F 순서로 사전순에서 가장 앞선 것을 고르세요. 방문한 지점을 출발부터 이어 적습니다.'], edges.map((e, i) => '길 ' + (i + 1) + ': ' + edgeText(e)), { symbols: 'ABCDEF' });
}
function coloring(random) {
    const secret = shuffle([1, 2, 3], random).concat(range(4).map(() => 1 + Math.floor(random() * 3))), edges = [[0, 1], [0, 2], [1, 2]];
    for (let a = 0; a < 7; a++) for (let b = Math.max(3, a + 1); b < 7; b++) if (secret[a] !== secret[b] && random() < 0.7) edges.push([a, b]);
    const candidates = product([1, 2, 3], 7).filter(v => edges.every(([a, b]) => v[a] !== v[b]));
    const pool = shuffle(range(7), random).map(i => ({ text: letter(i) + '의 색은 ' + secret[i] + '입니다.', matches: v => v[i] === secret[i] }));
    const { chosen } = deduce(candidates, pool);
    return scalar(secret.join(''), ['A~G에 색 1, 2, 3 중 하나씩 배정하세요. 길로 직접 연결된 지점끼리는 반드시 색이 달라야 합니다.',
        'A부터 G까지 색 번호 7자리를 입력하세요.'], edges.map(edgeText).concat(chosen.map(c => c.text)), { symbols: '123' });
}
function independentSet(random) {
    const edges = graph(random, 9, 0.3);
    const candidates = range(512).filter(m => edges.every(([a, b]) => !(m & (1 << a)) || !(m & (1 << b))));
    candidates.sort((a, b) => popcount(b) - popcount(a) || bits(a, 9).localeCompare(bits(b, 9)));
    return scalar(bits(candidates[0], 9), ['A~I 지점 중 서로 길로 직접 연결되지 않은 지점들을 최대한 많이 고르세요.',
        '선택은 1, 제외는 0으로 A~I 순서의 9자리를 입력합니다. 최대 개수의 답이 여럿이면 0<1 기준 사전순에서 가장 앞선 답을 고릅니다.'], edges.map(edgeText), { symbols: '01' });
}
function spanningTree(random) {
    const edges = graph(random, 7, 0.4).map((e, i) => [...e, i]), weights = shuffle(range(edges.length).map(n => n + 1), random), parent = range(7), selected = [];
    const root = i => parent[i] === i ? i : (parent[i] = root(parent[i]));
    for (const [a, b, id] of edges.slice().sort((a, b) => weights[a[2]] - weights[b[2]])) if (root(a) !== root(b)) { parent[root(a)] = root(b); selected.push(id); }
    return scalar(selected.sort((a, b) => a - b).map(letter).join(''), ['지점 1~7 전체를 서로 오갈 수 있게 연결하는 최소 총 비용의 길 집합을 찾으세요.',
        '길은 양방향입니다. 선택한 길의 이름을 알파벳순으로 입력하세요.'], edges.map(([a, b, i]) => '길 ' + letter(i) + ': ' + (a + 1) + '↔' + (b + 1) + ', 비용 ' + weights[i]), { symbols: range(edges.length).map(letter).join(''), allowRepeats: false });
}
function flow(random) {
    const edges = [[0, 1], [0, 2], [1, 2], [1, 3], [1, 4], [2, 3], [2, 4], [3, 4], [3, 5], [4, 5]].map(e => [...e, 3 + Math.floor(random() * 14)]);
    const residual = range(6).map(() => Array(6).fill(0)); edges.forEach(([a, b, c]) => { residual[a][b] = c; });
    let total = 0;
    for (;;) {
        const previous = Array(6).fill(-1), queue = [0]; previous[0] = 0;
        for (let h = 0; h < queue.length; h++) for (let b = 0; b < 6; b++) if (previous[b] < 0 && residual[queue[h]][b]) { previous[b] = queue[h]; queue.push(b); }
        if (previous[5] < 0) break;
        let amount = Infinity; for (let v = 5; v; v = previous[v]) amount = Math.min(amount, residual[previous[v]][v]);
        for (let v = 5; v; v = previous[v]) { residual[previous[v]][v] -= amount; residual[v][previous[v]] += amount; }
        total += amount;
    }
    return scalar(total, ['A에서 F로 보낼 수 있는 최대 유량을 구하세요. 화살표 방향으로만 보낼 수 있고, 각 관의 수치를 초과할 수 없습니다.',
        '중간 지점 B~E에서는 들어온 총량과 나간 총량이 같아야 합니다. 여러 관으로 나누어 흘려도 됩니다.'], edges.map(([a, b, c]) => letter(a) + '→' + letter(b) + ': 용량 ' + c));
}
function criticalPath(random) {
    const durations = range(8).map(() => 2 + Math.floor(random() * 9)), dependencies = range(8).map((_, i) => i ? range(i).filter(j => j === i - 1 ? random() < 0.35 : random() < 0.5) : []);
    const finish = [], routes = [];
    for (let i = 0; i < 8; i++) {
        const choices = dependencies[i].map(j => ({ time: finish[j], route: routes[j] })).sort((a, b) => b.time - a.time || a.route.localeCompare(b.route));
        finish[i] = durations[i] + (choices[0]?.time || 0); routes[i] = (choices[0]?.route || '') + letter(i);
    }
    const best = range(8).sort((a, b) => finish[b] - finish[a] || routes[a].localeCompare(routes[b]))[0];
    return scalar(routes[best], ['작업은 모든 선행 작업이 끝나야 시작할 수 있으며 동시에 여러 작업을 할 수 있습니다.',
        '선행 관계를 따라 이어진 작업 사슬 중 소요 시간 합계가 가장 큰 사슬을 찾으세요. 첫 작업부터 알파벳을 이어 적습니다.',
        '동점이면 A<B<…<H 기준 사전순에서 가장 앞선 사슬을 고릅니다.'], durations.map((d, i) => letter(i) + ': 소요 ' + d + ', 선행 ' + (dependencies[i].map(letter).join(', ') || '없음')), { symbols: 'ABCDEFGH', allowRepeats: false });
}
module.exports = [
    ['shortest_path', '최소 비용의 여정', shortestPath], ['salesman', '여섯 도시의 순례', salesman], ['deadlines', '마감이 있는 공방', deadlines],
    ['river', '현자와 도적의 도강', river], ['jugs', '눈금 없는 물통', jugs], ['bridge', '횃불과 다리', bridge], ['hanoi', '비용이 다른 하노이 탑', hanoi],
    ['sliding', '여덟 조각의 이동', sliding], ['lights_out', '등불을 끄는 순서', lightsOut], ['maze', '되돌아갈 수 없는 미로', maze],
    ['hamilton', '모든 지점을 한 번씩', hamilton], ['euler', '모든 길을 한 번씩', euler], ['coloring', '세 가지 색의 지도', coloring],
    ['independent_set', '서로 떨어진 파수대', independentSet], ['spanning_tree', '가장 저렴한 연결망', spanningTree], ['flow', '수로의 최대 유량', flow],
    ['critical_path', '완공을 늦추는 작업 사슬', criticalPath]
];
