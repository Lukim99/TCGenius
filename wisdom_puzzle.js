const crypto = require('crypto');

const QUEST_NAME = '[일일]지혜의 보석';
const OBJECTIVE_TYPE = 'wisdomPuzzle';
const KINDS = ['cipher', 'order', 'sudoku', 'towers'];
const RETRY_MS = 5000;

// v1의 날짜/계정별 문제는 재시작해도 동일하다. 규칙 변경 시 기존 버전을 보존한다.
function randomFor(key) {
    let state = crypto.createHash('sha256').update(key).digest().readUInt32LE(0);
    return () => {
        state += 0x6D2B79F5;
        let n = Math.imul(state ^ state >>> 15, 1 | state);
        n ^= n + Math.imul(n ^ n >>> 7, 61 | n);
        return ((n ^ n >>> 14) >>> 0) / 4294967296;
    };
}

function shuffle(values, random) {
    const result = values.slice();
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}

function permutations(values, length = values.length) {
    if (!length) return [[]];
    return values.flatMap((value, i) => permutations(values.filter((_, j) => i !== j), length - 1).map(tail => [value, ...tail]));
}

// 유한한 후보/단서 집합을 줄여 정답을 하나로 만들고, 불필요한 단서는 제거한다.
function uniqueClues(candidates, pool) {
    let remaining = candidates;
    const chosen = [];
    for (const clue of pool) {
        const next = remaining.filter(clue.matches);
        if (next.length && next.length < remaining.length) { chosen.push(clue); remaining = next; }
        if (remaining.length === 1) break;
    }
    if (remaining.length !== 1) throw new Error('지혜 퍼즐의 단서가 정답을 확정하지 못했습니다.');
    for (let i = chosen.length - 1; i >= 0; i--) {
        const others = chosen.filter((_, j) => j !== i);
        if (candidates.filter(answer => others.every(clue => clue.matches(answer))).length === 1) chosen.splice(i, 1);
    }
    return { chosen, solution: remaining[0] };
}

let cipherCandidates, orderCandidates, towerCandidates;
function cipherFeedback(answer, guess) {
    const exact = guess.filter((n, i) => n === answer[i]).length;
    return [exact, guess.filter(n => answer.includes(n)).length - exact];
}

function makeCipher(random) {
    if (!cipherCandidates) cipherCandidates = permutations([0, 1, 2, 3, 4, 5, 6, 7], 5);
    const secret = cipherCandidates[Math.floor(random() * cipherCandidates.length)];
    const pool = shuffle(cipherCandidates, random).map(guess => {
        const [exact, misplaced] = cipherFeedback(secret, guess);
        return { guess, exact, misplaced, text: guess.join(' ') + ' → 자리까지 일치 ' + exact + '개 / 숫자만 일치 ' + misplaced + '개',
            matches: answer => { const feedback = cipherFeedback(answer, guess); return feedback[0] === exact && feedback[1] === misplaced; } };
    }).filter(clue => clue.exact <= 2);
    const { chosen, solution } = uniqueClues(cipherCandidates, pool);
    return { title: '봉인된 현자의 암호', symbols: '01234567', length: 5, solution,
        rules: ['0~7 중 서로 다른 숫자 5개로 된 암호를 찾으세요. 첫 자리에도 0이 올 수 있습니다.',
            '모든 단서의 두 개수는 정확합니다. “숫자만 일치”는 암호에 있지만 자리가 다른 숫자의 개수이며, 자리까지 맞은 숫자는 제외합니다.'],
        clues: chosen.map(clue => clue.text) };
}

function makeOrder(random) {
    if (!orderCandidates) orderCandidates = permutations('ABCDEFG'.split(''));
    const secret = orderCandidates[Math.floor(random() * orderCandidates.length)];
    const pool = [];
    for (let i = 0; i < 7; i++) for (let j = i + 1; j < 7; j++) {
        const a = secret[i], b = secret[j], gap = j - i;
        pool.push({ text: a + '는 ' + b + '보다 왼쪽에 있습니다.', matches: v => v.indexOf(a) < v.indexOf(b) });
        pool.push({ text: a + '와 ' + b + ' 사이에는 정확히 ' + (gap - 1) + '개의 문양이 있습니다.', matches: v => Math.abs(v.indexOf(a) - v.indexOf(b)) === gap });
        if (gap > 1) pool.push({ text: a + '와 ' + b + '는 서로 이웃하지 않습니다.', matches: v => Math.abs(v.indexOf(a) - v.indexOf(b)) > 1 });
        for (let k = i + 1; k < j; k++) {
            const c = secret[k];
            pool.push({ text: c + '는 ' + a + '와 ' + b + ' 사이 어딘가에 있습니다.', matches: v => (v.indexOf(a) - v.indexOf(c)) * (v.indexOf(b) - v.indexOf(c)) < 0 });
        }
    }
    const { chosen, solution } = uniqueClues(orderCandidates, shuffle(pool, random));
    return { title: '일곱 문양의 회랑', symbols: 'ABCDEFG', length: 7, solution,
        rules: ['A~G 문양을 왼쪽부터 일렬로 하나씩 배치하세요. 모든 문양을 정확히 한 번 사용합니다.',
            '주어진 단서는 모두 참입니다. 단서에 명시되지 않은 방향은 직접 추론해야 합니다.'], clues: chosen.map(clue => clue.text) };
}

function solveSudoku(givens, limit = 2) {
    const board = givens.slice(), solutions = [];
    function visit() {
        let index = -1, options = [];
        for (let i = 0; i < 36; i++) {
            if (board[i]) continue;
            const row = Math.floor(i / 6), col = i % 6;
            const allowed = [1, 2, 3, 4, 5, 6].filter(n => !board.some((value, j) => value === n &&
                (Math.floor(j / 6) === row || j % 6 === col || (Math.floor(j / 12) === Math.floor(row / 2) && Math.floor(j % 6 / 3) === Math.floor(col / 3)))));
            if (!allowed.length) return;
            if (index < 0 || allowed.length < options.length) { index = i; options = allowed; }
        }
        if (index < 0) { solutions.push(board.slice()); return; }
        for (const n of options) {
            board[index] = n;
            visit();
            board[index] = 0;
            if (solutions.length >= limit) return;
        }
    }
    visit();
    return solutions;
}

function makeSudoku(random) {
    const rows = shuffle([0, 1, 2], random).flatMap(band => shuffle([0, 1], random).map(row => band * 2 + row));
    const cols = shuffle([0, 1], random).flatMap(stack => shuffle([0, 1, 2], random).map(col => stack * 3 + col));
    const digits = shuffle([1, 2, 3, 4, 5, 6], random);
    const solution = rows.flatMap(row => cols.map(col => digits[(row * 3 + Math.floor(row / 2) + col) % 6]));
    const cells = solution.slice();
    for (const i of shuffle(Array.from({ length: 36 }, (_, i) => i), random)) {
        cells[i] = 0;
        if (solveSudoku(cells).length !== 1) cells[i] = solution[i];
    }
    return { title: '현자의 숫자 격자', symbols: '123456', length: 36, solution,
        rules: ['빈칸에 1~6을 넣어 가로줄, 세로줄, 굵은 선으로 나뉜 2행×3열 구역마다 각 숫자가 한 번씩만 나오게 하세요.',
            '처음 주어진 숫자는 바꿀 수 없습니다.'], clues: [], grid: { size: 6, boxRows: 2, boxCols: 3, cells } };
}

function visibleTowers(line) {
    let tallest = 0, count = 0;
    for (const height of line) if (height > tallest) { tallest = height; count++; }
    return count;
}

function getTowerCandidates() {
    if (towerCandidates) return towerCandidates;
    towerCandidates = [];
    const rows = permutations([1, 2, 3, 4]);
    function visit(board) {
        if (board.length === 16) { towerCandidates.push(board); return; }
        for (const row of rows) if (row.every((n, col) => !board.some((value, i) => i % 4 === col && value === n))) visit([...board, ...row]);
    }
    visit([]);
    return towerCandidates;
}

function makeTowers(random) {
    const candidates = getTowerCandidates();
    const secret = candidates[Math.floor(random() * candidates.length)];
    const pool = [];
    for (let i = 0; i < 4; i++) for (const side of ['left', 'right', 'top', 'bottom']) {
        const indices = Array.from({ length: 4 }, (_, j) => side === 'left' ? i * 4 + j : side === 'right' ? i * 4 + 3 - j : side === 'top' ? j * 4 + i : (3 - j) * 4 + i);
        const count = visibleTowers(indices.map(index => secret[index]));
        const label = { left: '행을 왼쪽', right: '행을 오른쪽', top: '열을 위', bottom: '열을 아래' }[side];
        pool.push({ text: (i + 1) + label + '에서 보면 탑이 ' + count + '개 보입니다.', matches: v => visibleTowers(indices.map(index => v[index])) === count });
    }
    // 시야 단서만으로 부족한 경우에만 고정 숫자를 추가한다. 유한한 전체 칸이므로 항상 끝난다.
    const givens = shuffle(Array.from({ length: 16 }, (_, i) => i), random).map(index => ({ index, matches: v => v[index] === secret[index] }));
    const { chosen, solution } = uniqueClues(candidates, [...shuffle(pool, random), ...givens]);
    const cells = Array(16).fill(0);
    chosen.filter(clue => clue.index != null).forEach(clue => { cells[clue.index] = solution[clue.index]; });
    return { title: '통찰의 탑', symbols: '1234', length: 16, solution,
        rules: ['각 칸에 높이 1~4인 탑을 세우세요. 각 가로줄과 세로줄에는 1~4가 한 번씩 들어갑니다.',
            '낮은 탑은 앞의 높은 탑에 가려집니다. 예: 2, 1, 4, 3을 왼쪽에서 보면 2와 4만 보여 2개입니다.',
            '행은 위에서 아래로, 열은 왼쪽에서 오른쪽으로 셉니다. 굵은 구역별 숫자 제한은 없습니다.'],
        clues: chosen.filter(clue => clue.text).map(clue => clue.text), grid: { size: 4, cells } };
}

const generators = { cipher: makeCipher, order: makeOrder, sudoku: makeSudoku, towers: makeTowers };
const cache = new Map();
let cacheDate;
function getPuzzle(date, accountId, questId) {
    if (cacheDate !== date) { cache.clear(); cacheDate = date; }
    const key = JSON.stringify(['wisdom-v1', date, String(accountId), String(questId)]);
    if (cache.has(key)) return cache.get(key);
    const day = Math.floor(Date.parse(date + 'T00:00:00Z') / 86400000);
    const kind = KINDS[((day % KINDS.length) + KINDS.length) % KINDS.length];
    const { solution, ...view } = generators[kind](randomFor(key));
    const publicPuzzle = { ...view, date, kind };
    publicPuzzle.id = crypto.createHash('sha256').update(JSON.stringify(publicPuzzle)).digest('hex').slice(0, 24);
    const puzzle = { publicPuzzle, solution: solution.join('') };
    if (cache.size >= 256) cache.delete(cache.keys().next().value);
    cache.set(key, puzzle);
    return puzzle;
}

function checkAnswer(puzzle, raw) {
    if (typeof raw !== 'string' || raw.length > 256) return { error: '답안을 올바른 형식으로 입력해주세요.' };
    const answer = raw.normalize('NFKC').toUpperCase().replace(/[\s,]/g, '');
    const view = puzzle.publicPuzzle;
    if (answer.length !== view.length || [...answer].some(n => !view.symbols.includes(n))) return { error: view.length + '칸을 모두 채워주세요. 사용 가능: ' + view.symbols.split('').join(', ') };
    if (!view.grid && new Set(answer).size !== answer.length) return { error: '각 숫자 또는 문양은 한 번씩만 사용해주세요.' };
    return { correct: answer === puzzle.solution };
}

module.exports = { QUEST_NAME, OBJECTIVE_TYPE, KINDS, RETRY_MS, getPuzzle, checkAnswer, solveSudoku };
