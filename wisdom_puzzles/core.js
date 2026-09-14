// 60종 출제기가 공유하는 유한 탐색과 격자 연산. 운영 데이터/외부 API에 접근하지 않는다.
const range = n => Array.from({ length: n }, (_, i) => i);
const sum = xs => xs.reduce((a, b) => a + b, 0);
const pick = (xs, random) => xs[Math.floor(random() * xs.length)];
function shuffle(xs, random) {
    const out = xs.slice();
    for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
    return out;
}
function permutations(xs, length = xs.length) {
    if (!length) return [[]];
    return xs.flatMap((x, i) => permutations(xs.filter((_, j) => i !== j), length - 1).map(tail => [x, ...tail]));
}
function product(xs, length) {
    if (!length) return [[]];
    return product(xs, length - 1).flatMap(prefix => xs.map(x => [...prefix, x]));
}
function gcd(a, b) { while (b) [a, b] = [b, a % b]; return Math.abs(a); }
function fraction(a, b = 1) { const d = gcd(a, b); return [a / d * Math.sign(b), Math.abs(b) / d]; }
function calc(a, op, b) {
    if (op === '+') return fraction(a[0] * b[1] + b[0] * a[1], a[1] * b[1]);
    if (op === '-') return fraction(a[0] * b[1] - b[0] * a[1], a[1] * b[1]);
    if (op === '*') return fraction(a[0] * b[0], a[1] * b[1]);
    return fraction(a[0] * b[1], a[1] * b[0]);
}
const fractionText = n => n[0] + '/' + n[1];
function scalar(solution, rules, clues = [], extra = {}) {
    const answer = String(solution);
    return { solution: answer, length: answer.length, symbols: '0123456789', allowRepeats: true,
        inputLabel: '답안 (' + answer.length + '자리)', rules, clues, ...extra };
}

// 모든 후보를 검토하므로 우연히 풀리지 않는 문제가 발행되지 않는다.
function deduce(candidates, pool) {
    let remaining = candidates;
    const chosen = [];
    for (const clue of pool) {
        const next = remaining.filter(clue.matches);
        if (next.length && next.length < remaining.length) { chosen.push(clue); remaining = next; }
        if (remaining.length === 1) break;
    }
    if (remaining.length !== 1) throw new Error('지혜 퍼즐: 정답 유일성 검증 실패');
    for (let i = chosen.length - 1; i >= 0; i--) {
        const others = chosen.filter((_, j) => j !== i);
        let count = 0;
        for (const candidate of candidates) {
            if (others.every(c => c.matches(candidate)) && ++count === 2) break;
        }
        if (count === 1) chosen.splice(i, 1);
    }
    return { chosen, solution: remaining[0] };
}
function placement(candidates, secret, pool, random, options) {
    const givens = shuffle(range(secret.length), random).map(i => ({ index: i, matches: v => v[i] === secret[i] }));
    const { chosen, solution } = deduce(candidates, [...shuffle(pool, random), ...givens]);
    const cells = Array(secret.length).fill('');
    chosen.filter(c => c.index != null).forEach(c => { cells[c.index] = String(solution[c.index]); });
    return { ...options, solution: Array.isArray(solution) ? solution.join('') : solution,
        length: secret.length, allowRepeats: true, clues: chosen.filter(c => c.text).map(c => c.text), grid: { size: options.size, cells } };
}
const coord = (i, n = 4) => (Math.floor(i / n) + 1) + '행 ' + (i % n + 1) + '열';
const letter = i => String.fromCharCode(65 + i);
const bits = (mask, n) => range(n).map(i => (mask >>> i) & 1).join('');
function popcount(n) { n -= (n >>> 1) & 0x55555555; n = (n & 0x33333333) + ((n >>> 2) & 0x33333333); return (((n + (n >>> 4)) & 0x0F0F0F0F) * 0x01010101) >>> 24; }
const adjacencyCache = new Map();
function neighbors(size, diagonal = false) {
    const key = size + ':' + diagonal;
    if (!adjacencyCache.has(key)) adjacencyCache.set(key, range(size * size).map(i => range(size * size).filter(j => {
        const dr = Math.abs(Math.floor(i / size) - Math.floor(j / size)), dc = Math.abs(i % size - j % size);
        return diagonal ? Math.max(dr, dc) === 1 : dr + dc === 1;
    })));
    return adjacencyCache.get(key);
}
function components(mask, size = 4) {
    const out = [], adj = neighbors(size);
    let unseen = mask;
    while (unseen) {
        const first = 31 - Math.clz32(unseen & -unseen), stack = [first];
        let part = 0; unseen &= ~(1 << first);
        while (stack.length) {
            const i = stack.pop(); part |= 1 << i;
            for (const j of adj[i]) if (unseen & (1 << j)) { unseen &= ~(1 << j); stack.push(j); }
        }
        out.push(part);
    }
    return out;
}
function touching(mask, size = 4, diagonal = false) {
    return neighbors(size, diagonal).some((adj, i) => (mask & (1 << i)) && adj.some(j => mask & (1 << j)));
}
function squareBlock(mask, size = 4) {
    for (let r = 0; r < size - 1; r++) for (let c = 0; c < size - 1; c++) {
        const box = (1 << (r * size + c)) | (1 << (r * size + c + 1)) | (1 << ((r + 1) * size + c)) | (1 << ((r + 1) * size + c + 1));
        if ((mask & box) === box) return true;
    }
    return false;
}
const allMasks = range(65536);
let latinBoards;
function latin4() {
    if (latinBoards) return latinBoards;
    latinBoards = [];
    const rows = permutations([1, 2, 3, 4]);
    function visit(board) {
        if (board.length === 16) { latinBoards.push(board); return; }
        for (const row of rows) if (row.every((n, col) => !board.some((v, i) => i % 4 === col && v === n))) visit([...board, ...row]);
    }
    visit([]); return latinBoards;
}
function lineCounts(secret, size, label = '표시된 칸') {
    return range(size * 2).map(line => {
        const indices = range(size).map(j => line < size ? line * size + j : j * size + line - size);
        const count = sum(indices.map(i => Number(secret[i])));
        return { text: (line % size + 1) + (line < size ? '행' : '열') + '의 ' + label + ': ' + count + '개', matches: v => sum(indices.map(i => Number(v[i]))) === count };
    });
}
module.exports = { range, sum, pick, shuffle, permutations, product, fraction, calc, fractionText, scalar, deduce, placement,
    coord, letter, bits, popcount, neighbors, components, touching, squareBlock, allMasks, latin4, lineCounts };
