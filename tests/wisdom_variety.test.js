const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getPuzzle, checkAnswer, KINDS, EXPANDED_FROM } = require('../wisdom_puzzle');
const range = n => Array.from({ length: n }, (_, i) => i);
const sum = xs => xs.reduce((a, b) => a + b, 0);
const dateAt = n => new Date(Date.parse(EXPANDED_FROM + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const sample = (kind, n = 0) => getPuzzle(dateAt(KINDS.indexOf(kind)), 'variety-' + n, 74);
function permutations(xs) { return xs.length ? xs.flatMap((x, i) => permutations(xs.filter((_, j) => i !== j)).map(v => [x, ...v])) : [[]]; }
function groups(values, adjacent) {
    const remaining = new Set(values), result = [];
    while (remaining.size) {
        const queue = [remaining.values().next().value]; remaining.delete(queue[0]);
        for (let h = 0; h < queue.length; h++) for (const i of remaining) if (adjacent(queue[h], i)) { queue.push(i); remaining.delete(i); }
        result.push(queue);
    }
    return result;
}
const adjacent = (a, b, n = 4) => Math.abs(Math.floor(a / n) - Math.floor(b / n)) + Math.abs(a % n - b % n) === 1;
const diagonal = (a, b, n = 4) => a !== b && Math.max(Math.abs(Math.floor(a / n) - Math.floor(b / n)), Math.abs(a % n - b % n)) === 1;
const positions = (v, symbol) => [...v].flatMap((x, i) => x === symbol ? [i] : []);

test('60종 × 두 순환 × 10계정: 생성 종료, 답안 형식, 정답 채점, 고정 단서 및 60일 순환', t => {
    assert.equal(KINDS.length, 60);
    assert.equal(new Set(KINDS).size, 60);
    const samples = new Map(), timings = new Map(), titles = new Set();
    for (let day = 0; day < 120; day++) for (let user = 0; user < 10; user++) {
        const date = dateAt(day), start = performance.now(), puzzle = getPuzzle(date, 'variety-' + user, 74), view = puzzle.publicPuzzle;
        timings.set(view.kind, Math.max(timings.get(view.kind) || 0, performance.now() - start));
        assert.equal(view.kind, KINDS[day % 60]);
        assert.equal(view.typeCount, 60);
        assert.equal(typeof puzzle.solution, 'string');
        assert.equal(checkAnswer(puzzle, puzzle.solution).correct, true, date + '/' + user + '/' + view.kind);
        assert.equal(checkAnswer(puzzle, [...puzzle.solution.toLowerCase()].join(', ')).correct, true, view.kind);
        assert.ok(view.rules.length && view.rules.every(s => typeof s === 'string' && s.length > 0));
        assert.ok(Array.isArray(view.clues));
        assert.ok(view.length > 0 && view.length <= 128);
        assert.ok(!('solution' in view) && !('seed' in view));
        assert.ok(!JSON.stringify(view).includes('undefined'));
        const wrong = view.symbols.split('').find(c => c !== puzzle.solution[0]) + puzzle.solution.slice(1);
        assert.notEqual(checkAnswer(puzzle, wrong).correct, true, view.kind);
        if (view.grid) {
            assert.equal(view.grid.cells.length, view.grid.size ** 2);
            assert.ok(view.grid.cells.some(n => !n), view.kind + '에는 풀어야 할 빈칸이 필요하다.');
            view.grid.cells.forEach((n, i) => { if (n) assert.equal(String(n), puzzle.solution[i], view.kind); });
        }
        if (view.displayGrid) assert.equal(view.displayGrid.cells.length, (view.displayGrid.rows || view.displayGrid.size) * (view.displayGrid.cols || view.displayGrid.size));
        if (day < 60 && user === 0) { samples.set(view.kind, structuredClone(puzzle)); titles.add(view.title); }
    }
    assert.equal(titles.size, 60);
    for (const [kind, puzzle] of samples) assert.deepEqual(sample(kind), puzzle, kind + '는 캐시 교체 후에도 동일해야 한다.');
    t.diagnostic('1200개 생성 완료. 유형별 최대 생성 시간 상위: ' + [...timings].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, ms]) => k + ' ' + Math.ceil(ms) + 'ms').join(', '));
});

test('문자 격자, 반복 비트·분수·연산자·닫힌 경로를 채점하고 고정 0을 보존한다', () => {
    for (const kind of ['operations', 'mixing', 'gears', 'hamming', 'masyu', 'hidato', 'dominosa', 'takuzu']) {
        const puzzle = sample(kind);
        assert.equal(checkAnswer(puzzle, puzzle.solution).correct, true, kind);
        for (const invalid of [null, [], {}, '', ' '.repeat(257)]) assert.ok(checkAnswer(puzzle, invalid).error, kind);
    }
    const puzzle = sample('takuzu');
    assert.ok(puzzle.publicPuzzle.grid.cells.includes('0'), '빈칸과 구분되는 고정 0');
    assert.ok(checkAnswer(sample('hidato'), 'A'.repeat(16)).error);
    assert.equal(sample('hamming').publicPuzzle.displayGrid.cells.length, 15);
});

test('새 숫자 격자·연산 구역의 공개 단서가 실제 정답과 일치한다', () => {
    for (let n = 0; n < 10; n++) for (const kind of ['futoshiki', 'kenken', 'kakuro']) {
        const { publicPuzzle: p, solution } = sample(kind, n), v = [...solution].map(Number), size = p.grid.size;
        for (let i = 0; i < size; i++) {
            assert.equal(new Set(v.slice(i * size, (i + 1) * size)).size, size);
            assert.equal(new Set(range(size).map(r => v[r * size + i])).size, size);
        }
        for (const clue of p.clues) {
            if (kind === 'futoshiki') {
                const [r, c, rr, cc] = clue.match(/\d+/g).map(Number), a = v[(r - 1) * size + c - 1], b = v[(rr - 1) * size + cc - 1];
                assert.ok(clue.includes('<') ? a < b : a > b);
            } else if (kind === 'kenken') {
                const [left, right] = clue.split(' → '), cells = [...left.matchAll(/(\d)행 (\d)열/g)].map(m => v[(Number(m[1]) - 1) * size + Number(m[2]) - 1]);
                const op = right[0], target = Number(right.slice(2));
                const actual = op === '=' ? cells[0] : op === '+' ? sum(cells) : op === '×' ? cells.reduce((a, b) => a * b, 1) : op === '−' ? Math.max(...cells) - Math.min(...cells) : Math.max(...cells) / Math.min(...cells);
                assert.equal(actual, target, clue);
            } else {
                const [i, total] = clue.match(/\d+/g).map(Number);
                assert.equal(sum(clue.includes('행') ? v.slice((i - 1) * size, i * size) : range(size).map(r => v[r * size + i - 1])), total);
            }
        }
    }
});

test('흑백 그림·이진 균형·숫자 지우기·영역·문자 연결의 공개 규칙을 만족한다', () => {
    const run = xs => xs.join('').split(/0+/).filter(Boolean).map(s => s.length).join(',') || '0';
    for (let n = 0; n < 10; n++) for (const kind of ['nonogram', 'takuzu', 'hitori', 'fillomino', 'hidato', 'nurikabe', 'battleships']) {
        const { publicPuzzle: p, solution } = sample(kind, n), v = [...solution], size = p.grid.size;
        if (kind === 'nonogram') for (const clue of p.clues) {
            const [left, target] = clue.split(': '), i = Number(left[0]) - 1;
            assert.equal(run(left.includes('행') ? v.slice(i * size, (i + 1) * size) : range(size).map(r => v[r * size + i])), target);
        }
        if (kind === 'takuzu') {
            const rows = range(6).map(i => solution.slice(i * 6, (i + 1) * 6)), cols = range(6).map(c => range(6).map(r => v[r * 6 + c]).join(''));
            for (const line of [...rows, ...cols]) { assert.equal(positions(line, '1').length, 3); assert.doesNotMatch(line, /000|111/); }
            assert.equal(new Set(rows).size, 6); assert.equal(new Set(cols).size, 6);
        }
        if (kind === 'hitori' || kind === 'nurikabe') {
            const black = positions(solution, '1'), white = positions(solution, '0');
            if (kind === 'hitori') {
                assert.ok(black.every(i => black.every(j => !adjacent(i, j))));
                assert.equal(groups(white, adjacent).length, 1);
                const numbers = p.displayGrid.cells;
                assert.ok(white.every(i => white.every(j => i === j || numbers[i] !== numbers[j] || (i % 4 !== j % 4 && Math.floor(i / 4) !== Math.floor(j / 4)))));
            } else {
                assert.equal(groups(black, adjacent).length, 1);
                for (const island of groups(white, adjacent)) {
                    const numbered = island.filter(i => typeof p.displayGrid.cells[i] === 'number');
                    assert.equal(numbered.length, 1); assert.equal(island.length, p.displayGrid.cells[numbered[0]]);
                }
                for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) assert.ok([r * 4 + c, r * 4 + c + 1, (r + 1) * 4 + c, (r + 1) * 4 + c + 1].some(i => v[i] === '0'));
            }
        }
        if (kind === 'fillomino') for (const group of groups(range(16), (a, b) => adjacent(a, b) && v[a] === v[b])) assert.equal(group.length, Number(v[group[0]]));
        if (kind === 'hidato') for (let i = 0; i < 15; i++) assert.ok(diagonal(solution.indexOf(String.fromCharCode(65 + i)), solution.indexOf(String.fromCharCode(66 + i))));
        if (kind === 'battleships') {
            const ships = groups(positions(solution, '1'), adjacent);
            assert.deepEqual(ships.map(s => s.length).sort(), [1, 2, 3]);
            for (const s of ships) {
                assert.ok(s.every(i => i % 4 === s[0] % 4) || s.every(i => Math.floor(i / 4) === Math.floor(s[0] / 4)));
                assert.ok(ships.filter(other => other !== s).every(other => s.every(i => other.every(j => !diagonal(i, j)))));
            }
        }
    }
});

test('최단 경로·순회·작업 순서·유량의 답을 표시된 수치로 다시 계산한다', () => {
    for (let n = 0; n < 10; n++) {
        for (const kind of ['shortest_path', 'salesman']) {
            const { publicPuzzle: p, solution } = sample(kind, n), size = kind === 'shortest_path' ? 7 : 6;
            const distances = range(size).map((_, i) => range(size).map(j => i === j ? 0 : Infinity));
            p.clues.forEach(c => { const [, a, b, w] = c.match(/([A-G])↔([A-G]): (\d+)/); distances[a.charCodeAt(0) - 65][b.charCodeAt(0) - 65] = distances[b.charCodeAt(0) - 65][a.charCodeAt(0) - 65] = Number(w); });
            if (kind === 'shortest_path') {
                for (let k = 0; k < size; k++) for (let i = 0; i < size; i++) for (let j = 0; j < size; j++) distances[i][j] = Math.min(distances[i][j], distances[i][k] + distances[k][j]);
                assert.equal(Number(solution), distances[0][6]);
            } else {
                const choices = permutations([1, 2, 3, 4, 5]).map(v => [0, ...v, 0]).map(route => ({ route: route.map(i => String.fromCharCode(65 + i)).join(''), cost: sum(route.slice(1).map((v, i) => distances[route[i]][v])) }));
                choices.sort((a, b) => a.cost - b.cost || a.route.localeCompare(b.route)); assert.equal(solution, choices[0].route);
            }
        }
        const schedule = sample('deadlines', n), jobs = schedule.publicPuzzle.clues.map(c => c.match(/\d+/g).map(Number));
        const orders = permutations(range(6)).map(order => { let time = 0, cost = 0; for (const i of order) { time += jobs[i][0]; cost += Math.max(0, time - jobs[i][1]); } return { order: order.map(i => String.fromCharCode(65 + i)).join(''), cost }; });
        orders.sort((a, b) => a.cost - b.cost || a.order.localeCompare(b.order)); assert.equal(schedule.solution, orders[0].order);
        const flow = sample('flow', n), edges = flow.publicPuzzle.clues.map(c => { const [, a, b, w] = c.match(/([A-F])→([A-F]): 용량 (\d+)/); return [a.charCodeAt(0) - 65, b.charCodeAt(0) - 65, Number(w)]; });
        const cuts = range(16).map(mask => sum(edges.filter(([a, b]) => (a === 0 || (a < 5 && (mask & (1 << (a - 1))))) && !(b === 0 || (b < 5 && (mask & (1 << (b - 1)))))).map(e => e[2])));
        assert.equal(Number(flow.solution), Math.min(...cuts), '최대 유량은 최소 절단 용량과 일치');
    }
});

test('손상 비트·대화·수열·분동은 공개 단서만으로 정답을 확정한다', () => {
    for (let n = 0; n < 20; n++) {
        const h = sample('hamming', n), received = h.publicPuzzle.displayGrid.cells;
        const repaired = range(15).map(i => received.map((v, j) => i === j ? 1 - v : v)).filter(v => h.publicPuzzle.clues.every(c => sum(c.match(/\d+/g).map(i => v[Number(i) - 1])) % 2 === 0));
        assert.deepEqual(repaired.map(v => v.join('')), [h.solution]);
        const d = sample('dialogue', n), cards = d.publicPuzzle.clues.flatMap(c => [...c.matchAll(/\d/g)].map(m => c[0] + m[0]));
        const possibleRooms = [...new Set(cards.map(c => c[0]))].filter(room => {
            const local = cards.filter(c => c[0] === room); return local.length > 1 && local.every(c => cards.filter(v => v[1] === c[1]).length > 1);
        });
        const afterFirst = cards.filter(c => possibleRooms.includes(c[0])), afterSecond = afterFirst.filter(c => afterFirst.filter(v => v[1] === c[1]).length === 1);
        assert.deepEqual(afterSecond.filter(c => afterSecond.filter(v => v[0] === c[0]).length === 1), [d.solution]);
        const r = sample('recurrence', n), values = r.publicPuzzle.clues[0].match(/\d+/g).map(Number), next = new Set();
        for (let a = 1; a <= 9; a++) for (let b = 1; b <= 9; b++) if (values.slice(2).every((v, i) => (a * values[i + 1] + b * values[i]) % 97 === v)) next.add(String((a * values[5] + b * values[4]) % 97).padStart(2, '0'));
        assert.deepEqual([...next], [r.solution]);
        const balance = sample('balance', n), weights = balance.publicPuzzle.clues[0].match(/\d+/g).map(Number), target = Number(balance.publicPuzzle.rules[0].match(/\d+/)[0]);
        assert.equal(sum([...balance.solution].map((v, i) => (v === 'L' ? -1 : v === 'R' ? 1 : 0) * weights[i])), target);
    }
});

test('미로·고리·진주의 정답 경로가 표시된 도표 규칙을 만족한다', () => {
    for (let n = 0; n < 10; n++) {
        const m = sample('maze', n), map = m.publicPuzzle.displayGrid.cells;
        assert.match(m.publicPuzzle.rules[1], /2·4·6·8행과 2·4·6·8열/);
        for (const i of range(81).filter(i => (Math.floor(i / 9) + 1) % 2 === 0 && (i % 9 + 1) % 2 === 0)) assert.notEqual(map[i], '■');
        let at = map.indexOf('S'); const visited = new Set([at]);
        for (const dir of m.solution) {
            const step = { U: -9, D: 9, L: -1, R: 1 }[dir];
            assert.equal(map[at + step], '·'); at += step * 2;
            assert.ok(map[at] === '·' || map[at] === 'G'); assert.ok(!visited.has(at)); visited.add(at);
        }
        assert.equal(map[at], 'G');
        for (const kind of ['slitherlink', 'masyu']) {
            const { publicPuzzle: p, solution } = sample(kind, n), route = [...solution.slice(0, -1)].map(c => c.charCodeAt(0) - 65);
            assert.equal(solution[0], solution.at(-1)); assert.equal(new Set(route).size, route.length);
            assert.equal(route[0], Math.min(...route)); assert.ok(route[1] < route.at(-1));
            route.forEach((v, i) => assert.ok(adjacent(v, route[(i + 1) % route.length])));
            const edge = (a, b) => route.some((v, i) => v === a && (route[(i + 1) % route.length] === b || route[(i + route.length - 1) % route.length] === b));
            for (const c of p.clues) { const [a, b] = c.match(/[A-P]/g).map(x => x.charCodeAt(0) - 65); assert.ok(edge(a, b)); }
            if (kind === 'slitherlink') p.displayGrid.cells.forEach((n, i) => {
                if (n === '·') return; const a = Math.floor(i / 3) * 4 + i % 3;
                assert.equal([[a, a + 1], [a, a + 4], [a + 1, a + 5], [a + 4, a + 5]].filter(([x, y]) => edge(x, y)).length, n);
            });
            else {
                const straight = i => { const a = route[(i + route.length - 1) % route.length], b = route[(i + 1) % route.length]; return a % 4 === b % 4 || Math.floor(a / 4) === Math.floor(b / 4); };
                p.displayGrid.cells.forEach((value, at) => {
                    if (value.length === 1) return; const i = route.indexOf(at); assert.ok(i >= 0);
                    const before = straight((i + route.length - 1) % route.length), after = straight((i + 1) % route.length);
                    assert.ok(value[1] === '○' ? straight(i) && (!before || !after) : !straight(i) && before && after);
                });
            }
        }
    }
});

test('교환 농도·기어·다항식·치환 문양의 공개 수치를 재계산한다', () => {
    const gcd = (a, b) => b ? gcd(b, a % b) : Math.abs(a);
    for (let n = 0; n < 10; n++) {
        const mixed = sample('mixing', n), clues = mixed.publicPuzzle.clues;
        const initial = clues.slice(0, 2).map(c => c.match(/\d+/g).map(Number)), volume = initial.map(v => v[0]), pigment = initial.map(v => v[0] * v[1] / v[2]);
        for (const clue of clues.slice(2)) {
            const [, from, liters, to] = clue.match(/단계: ([AB])를 완전히 섞고 (\d+)L를 ([AB])/), a = from === 'A' ? 0 : 1, b = to === 'A' ? 0 : 1;
            const moved = pigment[a] / volume[a] * Number(liters); volume[a] -= Number(liters); volume[b] += Number(liters); pigment[a] -= moved; pigment[b] += moved;
        }
        const [num, den] = mixed.solution.split('/').map(Number); assert.equal(gcd(num, den), 1); assert.ok(Math.abs(num / den - pigment[1] / volume[1]) < 1e-10);
        const gears = sample('gears', n), start = Number(gears.publicPuzzle.clues[0].match(/\d+/)[0]); let turns = start, reversed = false;
        for (const clue of gears.publicPuzzle.clues.filter(c => c.includes('개 이)'))) {
            const [a, b] = clue.match(/\d+/g).map(Number); turns *= a / b; if (!clue.includes('열린 벨트')) reversed = !reversed;
        }
        assert.equal(gears.solution[0], reversed ? 'L' : 'R'); const [gn, gd] = gears.solution.slice(1).split('/').map(Number);
        assert.equal(gcd(gn, gd), 1); assert.ok(Math.abs(gn / gd - turns) < 1e-10);
        const poly = sample('polynomial', n), values = poly.publicPuzzle.clues.map(c => Number(c.split(' = ')[1]));
        const nextValues = new Set();
        for (let a = 0; a < 4; a++) for (let b = a + 1; b < 5; b++) for (let c = b + 1; c < 6; c++) for (let d = c + 1; d < 7; d++) {
            const points = [a, b, c, d], at = x => sum(points.map(i => values[i] * points.filter(j => i !== j).reduce((v, j) => v * (x - j - 1) / (i - j), 1)));
            if (values.filter((v, i) => Math.abs(v - at(i + 1)) < 1e-7).length === 6) nextValues.add(Math.round(at(8)));
        }
        assert.deepEqual([...nextValues], [Number(poly.solution)]);
        const grammar = sample('grammar', n), rules = Object.fromEntries(grammar.publicPuzzle.clues.slice(1).map(c => c.split(' → ')));
        let word = grammar.publicPuzzle.clues[0].slice('시작: '.length);
        const [, steps, pair] = grammar.publicPuzzle.rules[1].match(/(\d+)단계 후 이웃한 두 글자가 ([ABC]{2})/);
        for (let i = 0; i < Number(steps); i++) word = [...word].map(c => rules[c]).join('');
        assert.equal(range(word.length - 1).filter(i => word.slice(i, i + 2) === pair).length, Number(grammar.solution));
        assert.doesNotMatch(sample('hanoi', n).publicPuzzle.clues[3], /: C$/, '가장 큰 원판도 옮겨야 하므로 한 번 이동으로 끝나는 문제를 피한다.');
    }
});
