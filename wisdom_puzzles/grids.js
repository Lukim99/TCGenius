const { range, sum, pick, shuffle, permutations, placement, coord, bits, popcount, neighbors, components, touching, squareBlock, allMasks, latin4, lineCounts } = require('./core');

const latinRules = ['각 행과 각 열에 1~4가 정확히 한 번씩 들어가도록 모든 빈칸을 채우세요. 작은 구역별 숫자 제한은 없습니다.'];
const binary = '아래 답안 격자의 모든 칸에 0 또는 1을 입력하세요. 고정된 값은 바꿀 수 없습니다.';
const display = (cells, size = 4) => ({ size, cells });
function futoshiki(random) {
    const candidates = latin4(), secret = pick(candidates, random), pool = [];
    neighbors(4).forEach((adj, i) => adj.filter(j => i < j).forEach(j => {
        const less = secret[i] < secret[j];
        pool.push({ text: coord(i) + (less ? ' < ' : ' > ') + coord(j), matches: v => (v[i] < v[j]) === less });
    }));
    return placement(candidates, secret, pool, random, { size: 4, symbols: '1234', rules: [...latinRules, '부등호는 지정된 두 칸의 숫자 크기를 비교합니다.'] });
}
function kenken(random) {
    const secret = pick(latin4(), random), unused = new Set(range(16)), cages = [], adj = neighbors(4);
    for (const first of shuffle(range(16), random)) {
        if (!unused.has(first)) continue;
        const cells = [first]; unused.delete(first);
        const targetSize = 2 + Math.floor(random() * 2);
        while (cells.length < targetSize) {
            const options = [...new Set(cells.flatMap(i => adj[i]).filter(i => unused.has(i)))];
            if (!options.length) break;
            const next = pick(options, random); cells.push(next); unused.delete(next);
        }
        const values = cells.map(i => secret[i]), operators = cells.length === 1 ? ['='] : ['+', '×'];
        if (cells.length === 2) { operators.push('−'); if (Math.max(...values) % Math.min(...values) === 0) operators.push('÷'); }
        const op = pick(operators, random), compute = v => op === '=' ? v[0] : op === '+' ? sum(v) : op === '×' ? v.reduce((a, b) => a * b, 1) : op === '−' ? Math.abs(v[0] - v[1]) : Math.max(...v) / Math.min(...v);
        const total = compute(values);
        cages.push({ text: cells.map(i => coord(i)).join(' · ') + ' → ' + op + ' ' + total, matches: v => compute(cells.map(i => v[i])) === total });
    }
    const candidates = latin4().filter(v => cages.every(c => c.matches(v)));
    const view = placement(candidates, secret, [], random, { size: 4, symbols: '1234', rules: [...latinRules,
        '각 묶음에 적힌 연산을 그 묶음의 숫자들에 적용하면 목표값이 됩니다. −는 큰 수에서 작은 수를 빼며, ÷는 큰 수를 작은 수로 나눕니다.'] });
    view.clues = cages.map(c => c.text); return view;
}
function kakuro(random) {
    const digits = shuffle([1, 2, 3, 4, 5, 6], random), rows = shuffle(range(6), random).slice(0, 3), cols = shuffle(range(6), random).slice(0, 3);
    const secret = rows.flatMap(r => cols.map(c => digits[(r + c) % 6]));
    const rs = range(3).map(r => sum(secret.slice(r * 3, r * 3 + 3))), cs = range(3).map(c => sum(range(3).map(r => secret[r * 3 + c])));
    const patterns = permutations([1, 2, 3, 4, 5, 6], 3), candidates = [];
    function visit(board) {
        const r = board.length / 3;
        if (r === 3) { candidates.push(board); return; }
        for (const row of patterns.filter(v => sum(v) === rs[r])) if (row.every((n, c) => {
            if (range(r).some(j => board[j * 3 + c] === n)) return false;
            const total = n + sum(range(r).map(j => board[j * 3 + c])); return r === 2 ? total === cs[c] : total < cs[c];
        })) visit([...board, ...row]);
    }
    visit([]);
    const view = placement(candidates, secret, [], random, { size: 3, symbols: '123456', rules: ['1~6으로 빈칸을 채우세요. 같은 행 안에서, 같은 열 안에서 숫자가 중복되면 안 됩니다.',
        '각 가로줄·세로줄의 숫자 합이 주어진 합계와 일치해야 합니다.'] });
    view.clues = rs.map((s, i) => (i + 1) + '행 합계: ' + s).concat(cs.map((s, i) => (i + 1) + '열 합계: ' + s)); return view;
}
const runs = xs => xs.join('').split(/0+/).filter(Boolean).map(s => s.length).join(',') || '0';
function nonogram(random) {
    const secret = shuffle([...Array(12).fill('1'), ...Array(13).fill('0')], random), n = 5;
    const rowRuns = range(n).map(r => runs(secret.slice(r * n, r * n + n))), colRuns = range(n).map(c => runs(range(n).map(r => secret[r * n + c])));
    const patterns = range(32).map(m => [...bits(m, n)]), rowOptions = rowRuns.map(s => patterns.filter(v => runs(v) === s)), colOptions = colRuns.map(s => patterns.filter(v => runs(v) === s)), candidates = [];
    function visit(board) {
        const r = board.length / n;
        if (r === n) { candidates.push(board.join('')); return; }
        for (const row of rowOptions[r]) if (row.every((v, c) => colOptions[c].some(p => p[r] === v && range(r).every(j => p[j] === board[j * n + c])))) visit([...board, ...row]);
    }
    visit([]);
    const view = placement(candidates, secret.join(''), [], random, { size: n, symbols: '01', rules: ['1은 칠한 칸, 0은 빈칸입니다. 단서 숫자는 각 줄에서 연속으로 칠한 묶음의 길이를 순서대로 나타냅니다.',
        '묶음과 묶음 사이에는 0이 적어도 하나 있어야 합니다. 단서 0은 그 줄을 전부 비우라는 뜻입니다.', binary] });
    view.clues = rowRuns.map((s, i) => (i + 1) + '행: ' + s).concat(colRuns.map((s, i) => (i + 1) + '열: ' + s)); return view;
}
function mines(random) {
    const count = 4 + Math.floor(random() * 3), positions = shuffle(range(16), random).slice(0, count), mask = positions.reduce((m, i) => m | (1 << i), 0), secret = bits(mask, 16), adj = neighbors(4, true);
    const candidates = allMasks.filter(m => popcount(m) === count).map(m => bits(m, 16));
    const pool = range(16).filter(i => secret[i] === '0').map(i => {
        const n = sum(adj[i].map(j => Number(secret[j])));
        return { text: coord(i) + '은 안전하며 주변 8방향의 지뢰는 ' + n + '개입니다.', matches: v => v[i] === '0' && sum(adj[i].map(j => Number(v[j]))) === n };
    });
    return placement(candidates, secret, pool, random, { size: 4, symbols: '01', rules: ['지뢰 ' + count + '개의 위치를 찾으세요. 1은 지뢰, 0은 안전한 칸입니다.',
        '주변은 상하좌우와 대각선의 최대 8칸을 말합니다. 격자 밖은 세지 않습니다.', binary] });
}
let fleets;
function battleships(random) {
    if (!fleets) {
        const placements = length => range(16).flatMap(i => [1, 4].flatMap(step => {
            const cells = range(length).map(d => i + d * step);
            return cells.some(j => j >= 16 || (step === 1 && Math.floor(j / 4) !== Math.floor(i / 4))) ? [] : [cells.reduce((m, j) => m | (1 << j), 0)];
        }));
        const adj = neighbors(4, true), halo = m => range(16).filter(i => m & (1 << i)).flatMap(i => [i, ...adj[i]]).reduce((n, i) => n | (1 << i), 0), found = new Set();
        for (const a of placements(3)) for (const b of placements(2)) if (!(halo(a) & b)) for (const c of placements(1)) if (!(halo(a | b) & c)) found.add(a | b | c);
        fleets = [...found].map(m => bits(m, 16));
    }
    const secret = pick(fleets, random);
    return placement(fleets, secret, lineCounts(secret, 4, '배가 차지한 칸'), random, { size: 4, symbols: '01', rules: ['길이 3인 배 1척, 길이 2인 배 1척, 길이 1인 배 1척을 숨겨 놓았습니다.',
        '배는 가로나 세로의 일직선이며 서로 겹치거나 가로·세로·대각선으로 맞닿을 수 없습니다. 1은 배, 0은 바다입니다.', binary] });
}
let tentPlacements;
function tents(random) {
    if (!tentPlacements) {
        tentPlacements = [];
        function visit(cells, first) {
            if (cells.length === 4) { tentPlacements.push(cells); return; }
            for (let i = first; i < 25; i++) if (cells.every(j => Math.max(Math.abs(Math.floor(i / 5) - Math.floor(j / 5)), Math.abs(i % 5 - j % 5)) > 1)) visit([...cells, i], i + 1);
        }
        visit([], 0);
    }
    const tentCells = pick(tentPlacements, random), adj = neighbors(5);
    function matchTrees(at, trees) {
        if (at === 4) return trees;
        for (const tree of shuffle(adj[tentCells[at]], random)) if (!tentCells.includes(tree) && !trees.includes(tree)) { const found = matchTrees(at + 1, [...trees, tree]); if (found) return found; }
        return null;
    }
    const trees = matchTrees(0, []);
    const canMatch = cells => {
        function visit(at, used) {
            if (at === 4) return true;
            return trees.some((tree, i) => !(used & (1 << i)) && adj[tree].includes(cells[at]) && visit(at + 1, used | (1 << i)));
        }
        return visit(0, 0);
    };
    const candidates = tentPlacements.filter(c => !c.some(i => trees.includes(i)) && canMatch(c)).map(c => range(25).map(i => c.includes(i) ? '1' : '0').join(''));
    const secret = range(25).map(i => tentCells.includes(i) ? '1' : '0').join('');
    return placement(candidates, secret, lineCounts(secret, 5, '텐트'), random, { size: 5, symbols: '01', displayGrid: display(range(25).map(i => trees.includes(i) ? '나무' : '·'), 5), rules: ['나무 4그루 각각에 상하좌우로 붙은 텐트 하나를 짝지으세요. 나무와 텐트는 서로 하나씩만 짝을 가져야 합니다.',
        '나무 칸에는 텐트를 놓을 수 없으며 텐트끼리 상하좌우·대각선으로 닿으면 안 됩니다. 한 텐트가 여러 나무에 이웃해도 일대일로 짝지을 수 있으면 됩니다.', '1은 텐트, 0은 텐트가 없는 칸입니다. 나무 칸도 0으로 채우세요.', binary] });
}
let hitoriMasks;
function separatedMasks() {
    if (!hitoriMasks) hitoriMasks = allMasks.filter(m => !touching(m) && components(65535 ^ m).length === 1);
    return hitoriMasks;
}
function hitori(random) {
    const secretMask = pick(separatedMasks().filter(m => popcount(m) >= 4), random), numbers = pick(latin4(), random).slice();
    for (let i = 0; i < 16; i++) if (secretMask & (1 << i)) numbers[i] = pick([1, 2, 3, 4].filter(n => n !== numbers[i]), random);
    const candidates = separatedMasks().filter(mask => range(16).every(i => (mask & (1 << i)) || range(i).every(j => (mask & (1 << j)) || (i % 4 !== j % 4 && Math.floor(i / 4) !== Math.floor(j / 4)) || numbers[i] !== numbers[j]))).map(m => bits(m, 16));
    return placement(candidates, bits(secretMask, 16), [], random, { size: 4, symbols: '01', displayGrid: display(numbers), rules: ['일부 숫자를 지워, 남은 숫자가 각 행·각 열에서 중복되지 않게 하세요.',
        '지운 칸끼리는 상하좌우로 닿을 수 없습니다. 남은 모든 칸은 상하좌우를 통해 하나로 연결되어야 합니다.', '1은 지운 칸, 0은 남긴 칸입니다.', binary] });
}
let takuzuBoards;
function takuzu(random) {
    if (!takuzuBoards) {
        const patterns = range(64).map(m => bits(m, 6)).filter(s => [...s].filter(v => v === '1').length === 3 && !/000|111/.test(s)); takuzuBoards = [];
        function visit(rows) {
            if (rows.length === 6) {
                const cols = range(6).map(c => rows.map(r => r[c]).join(''));
                if (new Set(cols).size === 6) takuzuBoards.push(rows.join('')); return;
            }
            for (const row of patterns) if (!rows.includes(row) && range(6).every(c => {
                const col = rows.map(r => r[c]).join('') + row[c], ones = [...col].filter(v => v === '1').length;
                return ones <= 3 && col.length - ones <= 3 && !/000|111/.test(col);
            })) visit([...rows, row]);
        }
        visit([]);
    }
    return placement(takuzuBoards, pick(takuzuBoards, random), [], random, { size: 6, symbols: '01', rules: ['각 행과 각 열에 0과 1을 각각 3개씩 넣으세요.',
        '가로나 세로로 같은 숫자가 3개 연속 나오면 안 됩니다. 서로 완전히 같은 행이 없어야 하며, 서로 완전히 같은 열도 없어야 합니다.', binary] });
}
let islandBoards;
function nurikabe(random) {
    if (!islandBoards) islandBoards = allMasks.filter(m => !squareBlock(m) && components(m).length === 1).map(sea => ({ sea, islands: components(65535 ^ sea) }))
        .filter(b => b.islands.length >= 2 && b.islands.every(m => popcount(m) <= 5));
    const secret = pick(islandBoards, random), clues = secret.islands.map(mask => ({ index: pick(range(16).filter(i => mask & (1 << i)), random), size: popcount(mask) }));
    const candidates = islandBoards.filter(b => b.islands.length === clues.length && b.islands.every(mask => {
        const within = clues.filter(c => mask & (1 << c.index)); return within.length === 1 && within[0].size === popcount(mask);
    })).map(b => bits(b.sea, 16));
    return placement(candidates, bits(secret.sea, 16), [], random, { size: 4, symbols: '01', displayGrid: display(range(16).map(i => clues.find(c => c.index === i)?.size || '·')), rules: ['숫자 칸은 섬입니다. 각 섬은 상하좌우로 연결된 칸들의 집합이며 숫자 칸을 정확히 하나 포함하고 그 숫자만큼의 넓이를 가집니다.',
        '서로 다른 섬은 상하좌우로 닿지 않습니다. 바다는 상하좌우로 모두 연결되고, 바다로 꽉 찬 2×2 구역이 없어야 합니다.', '1은 바다, 0은 섬입니다. 숫자 칸도 0으로 채우세요.', binary] });
}
const roomMap = [0, 0, 1, 1, 0, 0, 1, 1, 2, 3, 4, 5, 2, 3, 4, 5];
let heyawakeBoards;
function heyawake(random) {
    if (!heyawakeBoards) heyawakeBoards = separatedMasks().filter(mask => range(8).every(line => {
        const cells = range(4).map(j => line < 4 ? line * 4 + j : j * 4 + line - 4); let rooms = new Set();
        for (const i of cells) { if (mask & (1 << i)) rooms = new Set(); else { rooms.add(roomMap[i]); if (rooms.size > 2) return false; } }
        return true;
    })).map(m => bits(m, 16));
    const secret = pick(heyawakeBoards.filter(s => [...s].filter(v => v === '1').length >= 3), random);
    const pool = range(6).map(room => {
        const cells = range(16).filter(i => roomMap[i] === room), total = sum(cells.map(i => Number(secret[i])));
        return { text: String.fromCharCode(65 + room) + '방의 검은 칸: ' + total + '개', matches: v => sum(cells.map(i => Number(v[i]))) === total };
    });
    return placement(heyawakeBoards, secret, pool, random, { size: 4, symbols: '01', displayGrid: display(roomMap.map(i => String.fromCharCode(65 + i))), rules: ['같은 문자로 표시된 직사각형은 같은 방입니다. 주어진 방별 검은 칸 수를 맞추세요.',
        '검은 칸끼리는 상하좌우로 닿지 않으며 흰 칸은 상하좌우로 모두 연결되어야 합니다.', '검은 칸으로 끊기지 않는 가로·세로의 흰 직선이 3개 이상의 방을 통과하면 안 됩니다.', '1은 검은 칸, 0은 흰 칸입니다.', binary] });
}
function akari(random) {
    const walls = shuffle(range(16), random).slice(0, 4), open = range(16).filter(i => !walls.includes(i)), adj = neighbors(4);
    const rays = range(16).map(i => {
        const out = [i];
        for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) for (let r = Math.floor(i / 4) + dr, c = i % 4 + dc; r >= 0 && c >= 0 && r < 4 && c < 4; r += dr, c += dc) {
            const j = r * 4 + c; if (walls.includes(j)) break; out.push(j);
        }
        return out;
    });
    const candidates = range(1 << open.length).map(m => open.filter((_, i) => m & (1 << i))).filter(bulbs => bulbs.every(i => rays[i].filter(j => bulbs.includes(j)).length === 1) && open.every(i => rays[i].some(j => bulbs.includes(j))))
        .map(bulbs => range(16).map(i => bulbs.includes(i) ? '1' : '0').join(''));
    const secret = pick(candidates, random), counts = walls.map(i => sum(adj[i].map(j => Number(secret[j]))));
    const eligible = candidates.filter(v => walls.every((i, k) => sum(adj[i].map(j => Number(v[j]))) === counts[k]));
    return placement(eligible, secret, [], random, { size: 4, symbols: '01', displayGrid: display(range(16).map(i => walls.includes(i) ? '벽' + counts[walls.indexOf(i)] : '·')), rules: ['벽이 아닌 칸에 전구를 놓아 모든 빈칸을 밝히세요. 빛은 상하좌우로 벽이나 격자 끝까지 직진합니다. 전구가 있는 칸도 밝습니다.',
        '전구끼리 서로 비추면 안 됩니다. 벽에 적힌 숫자는 그 벽에 상하좌우로 붙은 전구의 개수입니다.', '1은 전구, 0은 전구가 없는 칸입니다. 벽 칸도 0을 입력하세요.', binary] });
}
module.exports = [
    ['futoshiki', '부등호의 격자', futoshiki], ['kenken', '연산 구역의 격자', kenken], ['kakuro', '가로세로 합계', kakuro],
    ['nonogram', '숨겨진 흑백 그림', nonogram], ['mines', '지뢰의 위치', mines], ['battleships', '안개 속 함대', battleships],
    ['tents', '나무와 텐트', tents], ['hitori', '중복 숫자 지우기', hitori], ['takuzu', '이진 균형 격자', takuzu],
    ['nurikabe', '섬과 바다', nurikabe], ['heyawake', '여섯 방의 그림자', heyawake], ['akari', '빛을 나누는 전구', akari]
];
