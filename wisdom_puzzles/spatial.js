const { range, sum, pick, shuffle, product, scalar, deduce, placement, coord, letter, neighbors, components, allMasks, popcount } = require('./core');

let cycles;
function gridCycles() {
    if (cycles) return cycles;
    cycles = []; const adj = neighbors(4);
    function visit(path, used) {
        const at = path.at(-1), first = path[0];
        for (const j of adj[at]) {
            if (j === first && path.length >= 4 && path[1] < at) cycles.push(path.slice());
            else if (j > first && !(used & (1 << j))) visit([...path, j], used | (1 << j));
        }
    }
    range(16).forEach(i => visit([i], 1 << i)); return cycles;
}
const hasEdge = (path, a, b) => path.some((v, i) => v === a && (path[(i + 1) % path.length] === b || path[(i + path.length - 1) % path.length] === b));
function edgeClues(secret, random) {
    return shuffle(secret.map((a, i) => {
        const b = secret[(i + 1) % secret.length];
        return { text: letter(a) + '와 ' + letter(b) + ' 사이에는 선이 있습니다.', matches: path => hasEdge(path, a, b) };
    }), random);
}
const loopRules = ['점 A~P는 4×4 격자에 A B C D / E F G H / I J K L / M N O P 순서로 놓여 있습니다.',
    '상하좌우로 이웃한 점 사이에 선을 그어, 가지·교차·끊김이 없는 하나의 닫힌 고리를 만드세요. 모든 점을 지날 필요는 없습니다.',
    '고리에서 알파벳이 가장 앞선 점부터 출발하세요. 두 이웃 중 알파벳이 앞선 쪽으로 돌며 마지막에 출발점을 한 번 더 적습니다.'];
function slitherlink(random) {
    const candidates = gridCycles(), secret = pick(candidates.filter(p => p.length >= 10), random);
    const counts = path => range(9).map(i => {
        const a = Math.floor(i / 3) * 4 + i % 3;
        return [[a, a + 1], [a + 1, a + 5], [a + 5, a + 4], [a + 4, a]].filter(([x, y]) => hasEdge(path, x, y)).length;
    });
    const target = counts(secret), values = new Map(candidates.map(p => [p, counts(p)]));
    const pool = shuffle(range(9), random).map(i => ({ cell: i, matches: p => values.get(p)[i] === target[i] }));
    const { chosen } = deduce(candidates, [...pool, ...edgeClues(secret, random)]);
    return scalar([...secret, secret[0]].map(letter).join(''), [...loopRules, '아래 3×3 칸의 숫자는 그 칸을 둘러싼 네 변 중 선이 있는 변의 개수입니다. ·는 단서가 없는 칸입니다.'], chosen.filter(c => c.text).map(c => c.text),
        { symbols: 'ABCDEFGHIJKLMNOP', displayGrid: { size: 3, cells: range(9).map(i => chosen.some(c => c.cell === i) ? target[i] : '·') }, inputLabel: '출발점과 마지막 출발점을 포함한 고리' });
}
function pearlKind(path, vertex) {
    const i = path.indexOf(vertex); if (i < 0) return '';
    const turn = j => {
        const a = path[(j + path.length - 1) % path.length], b = path[j], c = path[(j + 1) % path.length];
        return (Math.floor(a / 4) === Math.floor(b / 4)) !== (Math.floor(b / 4) === Math.floor(c / 4));
    };
    const before = turn((i + path.length - 1) % path.length), after = turn((i + 1) % path.length);
    return turn(i) ? (!before && !after ? '●' : '') : (before || after ? '○' : '');
}
function masyu(random) {
    const candidates = gridCycles(), eligible = candidates.filter(p => p.some(i => pearlKind(p, i) === '●') && p.some(i => pearlKind(p, i) === '○'));
    const secret = pick(eligible, random), pearls = secret.map(i => ({ vertex: i, kind: pearlKind(secret, i) })).filter(c => c.kind);
    const pool = shuffle(pearls, random).map(c => ({ ...c, matches: p => pearlKind(p, c.vertex) === c.kind }));
    const { chosen } = deduce(candidates, [...pool, ...edgeClues(secret, random)]);
    return scalar([...secret, secret[0]].map(letter).join(''), [...loopRules, '표시된 진주는 모두 지나야 합니다. ○에서는 직진하고, 바로 전·후 점 중 적어도 하나에서 꺾으세요.',
        '●에서는 꺾고, 바로 전·후 점에서는 둘 다 직진해야 합니다. 진주가 없는 점에서는 자유롭게 꺾거나 직진합니다.'], chosen.filter(c => c.text).map(c => c.text),
    { symbols: 'ABCDEFGHIJKLMNOP', displayGrid: { size: 4, cells: range(16).map(i => letter(i) + (chosen.find(c => c.vertex === i)?.kind || '')) }, inputLabel: '출발점과 마지막 출발점을 포함한 고리' });
}
const islands = [[0, 0], [0, 2], [0, 4], [2, 0], [2, 4], [4, 0], [4, 2], [4, 4]];
let bridgeEdges, bridgeBoards;
function hashi(random) {
    if (!bridgeBoards) {
        bridgeEdges = [];
        for (let a = 0; a < islands.length; a++) for (let b = a + 1; b < islands.length; b++) {
            const [r, c] = islands[a], [rr, cc] = islands[b];
            if (r !== rr && c !== cc) continue;
            if (islands.some(([x, y], i) => i !== a && i !== b && ((r === rr && x === r && y > Math.min(c, cc) && y < Math.max(c, cc)) || (c === cc && y === c && x > Math.min(r, rr) && x < Math.max(r, rr))))) continue;
            bridgeEdges.push([a, b]);
        }
        const crossing = [];
        bridgeEdges.forEach(([a, b], i) => bridgeEdges.slice(i + 1).forEach(([c, d], j) => {
            const [ar, ac] = islands[a], [br, bc] = islands[b], [cr, cc] = islands[c], [dr, dc] = islands[d];
            if ((ar === br && cc === dc && ar > Math.min(cr, dr) && ar < Math.max(cr, dr) && cc > Math.min(ac, bc) && cc < Math.max(ac, bc)) ||
                (ac === bc && cr === dr && cr > Math.min(ar, br) && cr < Math.max(ar, br) && ac > Math.min(cc, dc) && ac < Math.max(cc, dc))) crossing.push([i, i + j + 1]);
        }));
        bridgeBoards = product([0, 1, 2], bridgeEdges.length).filter(v => {
            if (crossing.some(([a, b]) => v[a] && v[b])) return false;
            const seen = new Set([0]), stack = [0];
            while (stack.length) {
                const at = stack.pop(); bridgeEdges.forEach(([a, b], i) => { const next = a === at ? b : b === at ? a : -1; if (v[i] && next >= 0 && !seen.has(next)) { seen.add(next); stack.push(next); } });
            }
            return seen.size === islands.length;
        });
    }
    const secret = pick(bridgeBoards, random), degrees = range(8).map(v => sum(bridgeEdges.map(([a, b], i) => a === v || b === v ? secret[i] : 0)));
    const candidates = bridgeBoards.filter(v => degrees.every((n, at) => sum(bridgeEdges.map(([a, b], i) => a === at || b === at ? v[i] : 0)) === n));
    const { chosen } = deduce(candidates, shuffle(range(bridgeEdges.length), random).map(i => ({ text: '다리 ' + letter(i) + '는 ' + secret[i] + '줄입니다.', matches: v => v[i] === secret[i] })));
    const cells = Array(25).fill('·'); islands.forEach(([r, c], i) => { cells[r * 5 + c] = (i + 1) + ':' + degrees[i]; });
    return scalar(secret.join(''), ['섬 표시 “번호:수”에서 수는 그 섬에 연결되는 다리 줄 수의 합입니다.',
        '같은 행·열에서 사이에 다른 섬이 없는 두 섬만 0, 1, 2줄로 연결할 수 있습니다. 다리는 교차할 수 없고, 모든 섬은 다리를 통해 서로 연결되어야 합니다.',
        '아래 다리 목록의 알파벳순으로 줄 수를 입력하세요.'], bridgeEdges.map(([a, b], i) => '다리 ' + letter(i) + ': 섬 ' + (a + 1) + '↔' + (b + 1)).concat(chosen.map(c => c.text)),
    { symbols: '012', displayGrid: { size: 5, cells } });
}
function solveHidato(givens, limit = 2) {
    const fixed = range(16).map(n => givens.indexOf(letter(n))), adj = neighbors(4, true), solutions = [], board = Array(16).fill('');
    function visit(n, at, used) {
        if (n === 16) { solutions.push(board.join('')); return; }
        const options = fixed[n] >= 0 ? [fixed[n]] : n ? adj[at] : range(16);
        for (const next of options) {
            if ((used & (1 << next)) || (n && !adj[at].includes(next)) || (givens[next] && givens[next] !== letter(n))) continue;
            if (fixed.some((j, k) => k > n && j >= 0 && Math.max(Math.abs(Math.floor(next / 4) - Math.floor(j / 4)), Math.abs(next % 4 - j % 4)) > k - n)) continue;
            board[next] = letter(n); visit(n + 1, next, used | (1 << next)); board[next] = '';
            if (solutions.length >= limit) return;
        }
    }
    visit(0, -1, 0); return solutions;
}
function hidato(random) {
    const adj = neighbors(4, true);
    function path(at, used, order) {
        if (order.length === 16) return order;
        const choices = shuffle(adj[at].filter(i => !(used & (1 << i))), random).sort((a, b) => adj[a].filter(i => !(used & (1 << i))).length - adj[b].filter(i => !(used & (1 << i))).length);
        for (const next of choices) { const found = path(next, used | (1 << next), [...order, next]); if (found) return found; }
        return null;
    }
    const first = Math.floor(random() * 16), order = path(first, 1 << first, [first]), solution = Array(16);
    order.forEach((i, n) => { solution[i] = letter(n); }); const cells = solution.slice();
    for (const i of shuffle(range(16), random)) { cells[i] = ''; if (solveHidato(cells).length !== 1) cells[i] = solution[i]; }
    return { solution: solution.join(''), length: 16, symbols: 'ABCDEFGHIJKLMNOP', allowRepeats: false, grid: { size: 4, cells }, clues: [],
        rules: ['A~P를 각각 한 번씩 채워 A→B→…→P가 끊기지 않게 이어지도록 하세요.', '연속한 두 문자는 상하좌우 또는 대각선으로 붙어 있어야 합니다. 처음 주어진 문자는 바꿀 수 없습니다.'] };
}
let regionsByCell;
function solveFillomino(givens, limit = 2, random) {
    const adj = neighbors(4);
    if (!regionsByCell) {
        const shapes = allMasks.filter(m => popcount(m) >= 1 && popcount(m) <= 4 && components(m).length === 1).map(mask => ({ mask, cells: range(16).filter(i => mask & (1 << i)) }));
        regionsByCell = range(16).map(i => shapes.filter(s => s.mask & (1 << i)));
    }
    const board = Array(16).fill(0), solutions = [];
    function visit(used) {
        const at = board.indexOf(0);
        if (at < 0) { solutions.push(board.slice()); return; }
        const shapes = random ? shuffle(regionsByCell[at], random) : regionsByCell[at];
        for (const { mask, cells } of shapes) {
            const n = cells.length;
            if ((used & mask) || cells.some(i => givens[i] && givens[i] !== n)) continue;
            if (cells.some(i => adj[i].some(j => !(mask & (1 << j)) && (board[j] === n || givens[j] === n)))) continue;
            cells.forEach(i => { board[i] = n; }); visit(used | mask); cells.forEach(i => { board[i] = 0; });
            if (solutions.length >= limit) return;
        }
    }
    visit(0); return solutions;
}
function fillomino(random) {
    const solution = solveFillomino(Array(16).fill(0), 1, random)[0], cells = solution.slice();
    for (const i of shuffle(range(16), random)) { cells[i] = 0; if (solveFillomino(cells).length !== 1) cells[i] = solution[i]; }
    return { solution: solution.join(''), length: 16, symbols: '1234', allowRepeats: true, grid: { size: 4, cells }, clues: [],
        rules: ['모든 칸을 1~4로 채우세요. 같은 숫자가 상하좌우로 연결된 덩어리의 칸 수는 그 숫자와 정확히 같아야 합니다.',
            '예: 3의 덩어리는 정확히 3칸이어야 합니다. 같은 크기의 두 덩어리가 상하좌우로 닿으면 하나로 합쳐지므로 허용되지 않습니다.'] };
}
const pieceShapes = { I: [[0, 0], [1, 0], [2, 0], [3, 0]], L: [[0, 0], [1, 0], [2, 0], [2, 1]], T: [[0, 0], [0, 1], [0, 2], [1, 1]], S: [[0, 1], [0, 2], [1, 0], [1, 1]] };
function piecePlacements(shape) {
    const found = new Set(); let rotated = shape;
    for (let turn = 0; turn < 4; turn++) {
        const minR = Math.min(...rotated.map(p => p[0])), minC = Math.min(...rotated.map(p => p[1]));
        const normalized = rotated.map(([r, c]) => [r - minR, c - minC]);
        for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) if (normalized.every(([dr, dc]) => r + dr < 4 && c + dc < 4)) found.add(normalized.reduce((m, [dr, dc]) => m | (1 << ((r + dr) * 4 + c + dc)), 0));
        rotated = rotated.map(([r, c]) => [c, -r]);
    }
    return [...found];
}
let tetrominoSets;
function tetromino(random) {
    if (!tetrominoSets) tetrominoSets = ['LLLL', 'TTLL', 'TTTT', 'IILL', 'SSLL'].map(types => {
        const choices = [...types].map(t => piecePlacements(pieceShapes[t])), candidates = [], board = Array(16).fill('');
        function visit(used, pieces) {
            if (pieces === 15) { candidates.push(board.join('')); return; }
            const at = board.indexOf('');
            for (let p = 0; p < 4; p++) if (!(pieces & (1 << p))) for (const shape of choices[p]) if (!(shape & used) && (shape & (1 << at))) {
                const cells = range(16).filter(i => shape & (1 << i)); cells.forEach(i => { board[i] = letter(p); });
                visit(used | shape, pieces | (1 << p)); cells.forEach(i => { board[i] = ''; });
            }
        }
        visit(0, 0); return { types, candidates };
    }).filter(s => s.candidates.length);
    const { types, candidates } = pick(tetrominoSets, random), secret = pick(candidates, random);
    const view = placement(candidates, secret, [], random, { size: 4, symbols: 'ABCD', rules: ['4칸짜리 조각 A~D를 각각 한 번 사용하여 격자를 빈틈이나 겹침 없이 채우세요.',
        '조각을 회전하거나 평행 이동할 수 있지만 뒤집을 수는 없습니다. 아래 좌표는 각 조각 자체의 모양입니다.', '각 칸에 그 칸을 덮는 조각의 문자를 입력하세요.'] });
    view.clues = [...types].map((t, i) => '조각 ' + letter(i) + ' (' + t + '형): ' + pieceShapes[t].map(([r, c]) => coord(r * 4 + c)).join(' · ')); return view;
}
let dominoTilings;
function dominosa(random) {
    if (!dominoTilings) {
        dominoTilings = []; const adj = neighbors(4);
        function visit(used, pairs) {
            if (used === 65535) { dominoTilings.push(pairs); return; }
            const at = range(16).find(i => !(used & (1 << i)));
            for (const j of adj[at]) if (!(used & (1 << j))) visit(used | (1 << at) | (1 << j), [...pairs, [at, j]]);
        }
        visit(0, []);
    }
    const pairs = shuffle(range(6).flatMap(a => range(6 - a).map(d => [a + 1, a + d + 1])), random).slice(0, 8), tiling = pick(dominoTilings, random), board = Array(16), secret = Array(16);
    tiling.forEach(([a, b], i) => { const values = shuffle(pairs[i], random); board[a] = values[0]; board[b] = values[1]; secret[a] = secret[b] = letter(i); });
    const candidates = dominoTilings.flatMap(tiles => {
        const ids = tiles.map(([a, b]) => pairs.findIndex(([x, y]) => Math.min(board[a], board[b]) === x && Math.max(board[a], board[b]) === y));
        if (ids.includes(-1) || new Set(ids).size !== 8) return [];
        const v = Array(16); tiles.forEach(([a, b], i) => { v[a] = v[b] = letter(ids[i]); }); return [v.join('')];
    });
    const view = placement(candidates, secret.join(''), [], random, { size: 4, symbols: 'ABCDEFGH', displayGrid: { size: 4, cells: board }, rules: ['숫자 격자를 상하 또는 좌우로 붙은 2칸짜리 도미노들로 나누세요.',
        '목록의 도미노 A~H를 각각 한 번 사용해야 하며 숫자의 순서는 바꿔도 됩니다. 각 칸에 그 칸을 차지한 도미노의 문자를 입력하세요.'] });
    view.clues = pairs.map((p, i) => '도미노 ' + letter(i) + ': ' + p.join('–')); return view;
}
function mirrors(random) {
    const cells = shuffle(range(16), random).slice(0, 8).sort((a, b) => a - b), candidates = product([1, 2], 8), secret = pick(candidates, random);
    function trace(v, port) {
        let r, c, dr, dc;
        if (port < 4) [r, c, dr, dc] = [-1, port, 1, 0];
        else if (port < 8) [r, c, dr, dc] = [port - 4, 4, 0, -1];
        else if (port < 12) [r, c, dr, dc] = [4, 11 - port, -1, 0];
        else [r, c, dr, dc] = [15 - port, -1, 0, 1];
        const seen = new Set();
        for (;;) {
            r += dr; c += dc;
            if (r < 0) return c + 1; if (c > 3) return r + 5; if (r > 3) return 12 - c; if (c < 0) return 16 - r;
            const key = [r, c, dr, dc].join(','); if (seen.has(key)) return 0; seen.add(key);
            const i = cells.indexOf(r * 4 + c);
            if (i >= 0) [dr, dc] = v[i] === 1 ? [-dc, -dr] : [dc, dr];
        }
    }
    const pool = shuffle(range(16), random).map(p => {
        const exit = trace(secret, p);
        return { text: (p + 1) + '번 입구로 비추면 ' + (exit ? exit + '번 입구로 나옵니다.' : '안에서 순환합니다.'), matches: v => trace(v, p) === exit };
    });
    const pins = shuffle(range(8), random).map(i => ({ text: '거울 ' + letter(i) + '의 방향: ' + (secret[i] === 1 ? '/' : '\\'), matches: v => v[i] === secret[i] }));
    const { chosen } = deduce(candidates, [...pool, ...pins]);
    return scalar(secret.join(''), ['A~H 칸에는 양면 거울이 하나씩 있고 · 칸은 비어 있습니다. 거울 방향은 / 또는 \\ 입니다.',
        '빛은 입구에서 격자 안쪽으로 직진하며 거울을 만나면 90도로 반사됩니다. 거울 / 는 아래로 오는 빛을 왼쪽으로, 거울 \\ 는 오른쪽으로 꺾습니다.',
        '입구는 위쪽 왼쪽→오른쪽 1~4, 오른쪽 위→아래 5~8, 아래쪽 오른쪽→왼쪽 9~12, 왼쪽 아래→위 13~16입니다.',
        'A~H 순서대로 / 는 1, \\ 는 2로 입력하세요.'], chosen.map(c => c.text), { symbols: '12', displayGrid: { size: 4, cells: range(16).map(i => cells.includes(i) ? letter(cells.indexOf(i)) : '·') } });
}
module.exports = [
    ['slitherlink', '숫자를 두르는 고리', slitherlink], ['masyu', '흑백 진주의 고리', masyu], ['hashi', '섬을 잇는 다리', hashi],
    ['hidato', '문자를 잇는 발걸음', hidato], ['fillomino', '크기를 채우는 영역', fillomino], ['tetromino', '네 조각의 빈틈', tetromino],
    ['dominosa', '사라진 도미노 경계', dominosa], ['mirrors', '거울 속 빛의 경로', mirrors]
];
