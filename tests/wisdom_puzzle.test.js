const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getPuzzle, checkAnswer, solveSudoku } = require('../wisdom_puzzle');
const { makeDefinition } = require('../scripts/init_wisdom_quest');

function permutations(symbols, length) {
    if (!length) return [''];
    return [...symbols].flatMap(symbol => permutations(symbols.replace(symbol, ''), length - 1).map(tail => symbol + tail));
}
const codes = permutations('01234567', 5), orders = permutations('ABCDEFG', 7);
const towerRows = permutations('1234', 4), towers = [];
function towerBoards(rows) {
    if (rows.length === 4) { towers.push(rows.join('')); return; }
    for (const row of towerRows) if ([...row].every((n, col) => rows.every(previous => previous[col] !== n))) towerBoards([...rows, row]);
}
towerBoards([]);

// 실제 표시되는 한국어 단서를 해석해 후보 전체를 검사한다. 단서 텍스트 오류도 검출한다.
function matchesClue(answer, text, kind) {
    if (kind === 'cipher') {
        const [a, b, c, d, e, exact, misplaced] = text.match(/\d+/g).map(Number);
        const guess = [a, b, c, d, e].join('');
        const positional = [...guess].filter((n, i) => n === answer[i]).length;
        return positional === exact && [...guess].filter(n => answer.includes(n)).length === exact + misplaced;
    }
    if (kind === 'order') {
        const [a, b, c] = text.match(/[A-G]/g).map(n => answer.indexOf(n));
        if (text.includes('보다 왼쪽')) return a < b;
        if (text.includes('사이 어딘가')) return Math.min(b, c) < a && a < Math.max(b, c);
        if (text.includes('정확히')) return Math.abs(a - b) === Number(text.match(/\d+/)[0]) + 1;
        assert.ok(text.includes('이웃하지'));
        return Math.abs(a - b) !== 1;
    }
    const [, at, axis, direction, target] = text.match(/(\d)(행|열)을 (왼쪽|오른쪽|위|아래)에서 보면 탑이 (\d)개/);
    let line = axis === '행' ? answer.slice((at - 1) * 4, at * 4).split('') : [0, 1, 2, 3].map(i => answer[i * 4 + Number(at) - 1]);
    if (direction === '오른쪽' || direction === '아래') line.reverse();
    const seen = line.filter((n, i) => line.slice(0, i).every(earlier => earlier < n)).length;
    return seen === Number(target);
}

test('1년 × 2계정: 네 유형의 표시 단서가 실제로 유일한 정답을 결정한다', () => {
    const kinds = new Set();
    for (let day = 0; day < 365; day++) for (const account of ['wisdom-a', 'wisdom-b']) {
        const date = new Date(Date.UTC(2025, 0, 1 + day)).toISOString().slice(0, 10);
        const puzzle = getPuzzle(date, account, 74), view = puzzle.publicPuzzle;
        kinds.add(view.kind);
        assert.equal(checkAnswer(puzzle, puzzle.solution).correct, true);
        assert.equal(view.solution, undefined);
        assert.equal(view.seed, undefined);
        let candidates;
        if (view.kind === 'sudoku') {
            candidates = solveSudoku(view.grid.cells).map(board => board.join(''));
            const values = [...puzzle.solution];
            for (let i = 0; i < 6; i++) {
                assert.equal(new Set(values.slice(i * 6, i * 6 + 6)).size, 6);
                assert.equal(new Set(values.filter((_, j) => j % 6 === i)).size, 6);
                const cells = values.filter((_, j) => Math.floor(j / 12) * 2 + Math.floor(j % 6 / 3) === i);
                assert.equal(new Set(cells).size, 6);
            }
            assert.ok(view.grid.cells.filter(Boolean).length < 16, '직접 교차 추론할 빈칸이 충분해야 한다.');
        } else {
            candidates = (view.kind === 'cipher' ? codes : view.kind === 'order' ? orders : towers)
                .filter(answer => view.clues.every(clue => matchesClue(answer, clue, view.kind)))
                .filter(answer => !view.grid || view.grid.cells.every((n, i) => !n || String(n) === answer[i]));
        }
        assert.deepEqual(candidates, [puzzle.solution], date + '/' + account + '/' + view.kind);
    }
    assert.deepEqual([...kinds].sort(), ['cipher', 'order', 'sudoku', 'towers']);
});

test('재시작/캐시 교체에도 같은 날짜·계정·퀘스트의 문제는 고정되고 다음 날 유형은 바뀐다', () => {
    const first = getPuzzle('2026-09-16', 'stable', 74);
    const tomorrow = getPuzzle('2026-09-17', 'stable', 74);
    assert.notEqual(first.publicPuzzle.kind, tomorrow.publicPuzzle.kind);
    assert.deepEqual(getPuzzle('2026-09-16', 'stable', 74), first);
    delete require.cache[require.resolve('../wisdom_puzzle')];
    assert.deepEqual(require('../wisdom_puzzle').getPuzzle('2026-09-16', 'stable', 74), first);
    assert.notEqual(getPuzzle('2026-09-16', 'someone-else', 74).publicPuzzle.id, first.publicPuzzle.id);
});

test('공백·쉼표·전각 숫자·소문자 허용, 배열/과도한 길이/중복/누락 답안 거부', () => {
    const cipher = getPuzzle('2026-09-12', 'formats', 74);
    const order = getPuzzle('2026-09-13', 'formats', 74);
    assert.equal(checkAnswer(cipher, [...cipher.solution].join(', ')).correct, true);
    assert.equal(checkAnswer(cipher, [...cipher.solution].map(n => String.fromCharCode(n.charCodeAt(0) + 0xFEE0)).join('')).correct, true);
    assert.equal(checkAnswer(order, order.solution.toLowerCase()).correct, true);
    for (const bad of [null, 12345, [], {}, '', '00000', '99999', '1'.repeat(257)]) assert.ok(checkAnswer(cipher, bad).error);
});

test('60종 확장 전에 발행한 네 유형의 문제 ID와 정답을 그대로 보존한다', () => {
    const snapshots = [
        ['2026-09-11', '6cd53f3708b82868e943a68b', '2413132432414132'],
        ['2026-09-12', '9b2054a19e7768bdda4b233c', '32670'],
        ['2026-09-13', 'f1af39a8074e0e1ce54d8adf', 'CFADEBG'],
        ['2026-09-14', 'e9a9aa834e596208eb389884', '236451415263521634643512354126162345']
    ];
    for (const [date, id, solution] of snapshots) {
        const puzzle = getPuzzle(date, 'stable', 74);
        assert.equal(puzzle.publicPuzzle.id, id);
        assert.equal(puzzle.solution, solution);
    }
});

test('신규 등록은 운영 아이템 인덱스를 사용하며, 기존 비활성 퀘스트/빈 보상을 보존한다', () => {
    const quests = [{ id: 90, name: '기존 퀘스트', rewards: [] }];
    const items = [{ name: '다른 아이템' }, { name: '지혜의 보석', desc: '운영자 설명' }];
    const before = structuredClone({ quests, items });
    const next = makeDefinition(quests, items);
    assert.equal(next.id, 91);
    assert.equal(next.rewards[0].item_id, 1);
    assert.deepEqual(next.rewards[0].count, { min: 1, max: 1 });
    assert.equal(makeDefinition([...quests, { ...next, enabled: false, rewards: [] }], items), null);
    assert.deepEqual({ quests, items }, before);
});
