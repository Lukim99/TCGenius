const { range, sum, pick, shuffle, permutations, scalar, deduce, letter, bits } = require('./core');

function counterfeit(random) {
    const candidates = range(24).map(i => ({ coin: i % 12, heavy: i >= 12 })), secret = pick(candidates, random);
    const result = (v, left, right) => (left.includes(v.coin) ? 1 : right.includes(v.coin) ? -1 : 0) * (v.heavy ? 1 : -1);
    const weighings = range(40).map(() => { const coins = shuffle(range(12), random); return [coins.slice(0, 4), coins.slice(4, 8)]; });
    for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) weighings.push([[i], [j]]);
    const pool = weighings.map(([left, right]) => {
        const value = result(secret, left, right);
        return { text: left.map(letter).join('') + ' / ' + right.map(letter).join('') + ': ' + (value === 0 ? '수평' : value > 0 ? '왼쪽이 무거움' : '오른쪽이 무거움'), matches: v => result(v, left, right) === value };
    });
    const { chosen, solution } = deduce(candidates, pool);
    return scalar(letter(solution.coin) + (solution.heavy ? 'H' : 'L'), ['A~L 동전 중 가짜가 정확히 하나 있습니다. 진짜 동전의 무게는 모두 같고, 가짜는 더 무겁거나 더 가볍습니다.',
        '동전 문자 뒤에 무거우면 H, 가벼우면 L을 붙여 입력하세요. 각 단서는 왼쪽 접시 / 오른쪽 접시입니다.'], chosen.map(c => c.text), { symbols: 'ABCDEFGHIJKL', inputLabel: '가짜 동전 + H(무거움)/L(가벼움)' });
}
const truthAssignments = range(64).map(i => bits(i, 6));
function circuit(random) {
    const secret = pick(truthAssignments, random), pool = [];
    for (const [a, b, c] of permutations(range(6), 3)) {
        const op = pick(['AND', 'OR', 'XOR'], random), outer = pick(['NAND', 'NOR', 'XOR'], random);
        const evaluate = v => {
            const x = Number(v[a]), y = Number(v[b]), z = Number(v[c]);
            const first = op === 'AND' ? x & y : op === 'OR' ? x | y : x ^ y;
            return outer === 'NAND' ? 1 - (first & z) : outer === 'NOR' ? 1 - (first | z) : first ^ z;
        };
        const value = evaluate(secret);
        pool.push({ text: '((' + letter(a) + ' ' + op + ' ' + letter(b) + ') ' + outer + ' ' + letter(c) + ') = ' + value, matches: v => evaluate(v) === value });
    }
    const pins = range(6).map(i => ({ text: letter(i) + ' = ' + secret[i], matches: v => v[i] === secret[i] }));
    const { chosen, solution } = deduce(truthAssignments, [...shuffle(pool, random), ...pins]);
    return scalar(solution, ['여섯 입력 A~F는 각각 0 또는 1입니다. 회로의 모든 관측값을 만족시키세요.',
        'AND는 둘 다 1일 때만 1, OR는 하나라도 1이면 1, XOR는 서로 다를 때만 1입니다. NAND/NOR는 AND/OR의 결과를 뒤집습니다.',
        'A~F 순서로 입력을 적으세요.'], chosen.map(c => c.text), { symbols: '01' });
}
function hamming(random) {
    const word = range(15).map(() => Math.floor(random() * 2));
    for (const parity of [1, 2, 4, 8]) word[parity - 1] = range(15).filter(i => i + 1 !== parity && ((i + 1) & parity)).reduce((n, i) => n ^ word[i], 0);
    const received = word.slice(); received[Math.floor(random() * 15)] ^= 1;
    return scalar(word.join(''), ['15자리 기록에서 정확히 한 비트가 뒤집혔습니다. 원래 기록을 복구하세요.',
        '각 검사 그룹에서 1의 개수는 짝수여야 합니다. 위치는 왼쪽 위부터 행 순서로 1~15입니다.',
        '수정한 전체 15자리를 입력하세요.'], [1, 2, 4, 8].map(p => '검사 그룹: ' + range(15).filter(i => (i + 1) & p).map(i => i + 1).join(', ')),
    { symbols: '01', displayGrid: { rows: 3, cols: 5, cells: received }, inputLabel: '복구한 15비트 기록' });
}
function solveDialogue(cards) {
    const count = (set, card, index) => set.filter(c => c[index] === card[index]).length;
    const first = cards.filter(card => count(cards, card, 0) > 1 && cards.filter(c => c[0] === card[0]).every(c => count(cards, c, 1) > 1));
    const second = first.filter(card => count(first, card, 1) === 1);
    return second.filter(card => count(second, card, 0) === 1);
}
function dialogue(random) {
    let cards, solutions;
    for (let attempt = 0; attempt < 40; attempt++) {
        cards = shuffle(range(24), random).slice(0, 10).map(i => [Math.floor(i / 6), i % 6]);
        solutions = solveDialogue(cards);
        if (solutions.length === 1) break;
    }
    if (solutions.length !== 1) cards = [[0, 1], [0, 2], [0, 5], [1, 3], [1, 4], [2, 0], [2, 2], [3, 0], [3, 1], [3, 3]];
    const rooms = shuffle(['A', 'B', 'C', 'D'], random), numbers = shuffle(range(9).map(i => i + 1), random).slice(0, 6);
    cards = cards.map(([r, n]) => [rooms[r], numbers[n]]).sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1]);
    const [solution] = solveDialogue(cards);
    return scalar(solution.join(''), ['아래 후보 중 한 곳에 책이 있습니다. 첫 현자는 방 문자만, 둘째 현자는 책 번호만 알고 있습니다. 두 현자는 모든 후보와 서로의 완벽한 추론 능력을 압니다.',
        '첫째: “나는 위치를 모른다. 네가 위치를 모른다는 것도 처음부터 알았다.”',
        '둘째: “처음에는 몰랐지만, 그 말을 듣고 이제 알았다.”', '첫째: “그러면 나도 이제 알았다.”',
        '방 문자와 책 번호를 붙여 입력하세요.'], rooms.map(room => room + '방 후보: ' + cards.filter(c => c[0] === room).map(c => c[1]).join(', ')), { symbols: 'ABCD123456789', inputLabel: '방 문자 + 책 번호' });
}
function knights(random) {
    const secret = pick(truthAssignments.slice(1, -1), random), pool = [];
    for (const [speaker, a, b] of permutations(range(6), 3)) {
        const mode = pick(['같은 부류', '둘 다 참말쟁이', '적어도 한 명은 참말쟁이'], random);
        const evaluate = v => mode === '같은 부류' ? v[a] === v[b] : mode === '둘 다 참말쟁이' ? v[a] === '1' && v[b] === '1' : v[a] === '1' || v[b] === '1';
        const negate = Number(evaluate(secret)) !== Number(secret[speaker]);
        pool.push({ text: letter(speaker) + ': “' + letter(a) + '와 ' + letter(b) + '는 ' + mode + (negate ? '라는 말은 거짓이다.' : '이다.') + '”',
            matches: v => (negate ? !evaluate(v) : evaluate(v)) === (v[speaker] === '1') });
    }
    // 자기 언급 단서는 앞의 증언만으로 부족할 때만 사용한다.
    const anchors = range(6).map(b => {
        const a = (b + 1) % 6, same = secret[b] === '1';
        return { text: letter(a) + ': “나와 ' + letter(b) + '는 ' + (same ? '같은' : '서로 다른') + ' 부류다.”', matches: v => (same ? v[a] === v[b] : v[a] !== v[b]) === (v[a] === '1') };
    });
    const { chosen, solution } = deduce(truthAssignments, [...shuffle(pool, random), ...anchors]);
    return scalar(solution, ['A~F는 항상 참말을 하거나 항상 거짓말을 합니다. 각 인물의 모든 증언은 그 부류에 일관됩니다.',
        'A~F 순서대로 참말쟁이는 1, 거짓말쟁이는 0을 입력하세요.'], chosen.map(c => c.text), { symbols: '01' });
}
function oneFalse(random) {
    const candidates = permutations(range(9).map(i => i + 1), 3), secret = pick(candidates, random);
    const coefficients = permutations([1, 2, 3]);
    const pool = coefficients.map(c => {
        const total = sum(c.map((n, i) => n * secret[i]));
        return { text: c.map((n, i) => n + '×' + letter(i)).join(' + ') + ' = ' + total, matches: v => sum(c.map((n, i) => n * v[i])) === total };
    });
    const wrong = sum(secret) + 1;
    pool.push({ text: 'A + B + C = ' + wrong, matches: v => sum(v) === wrong });
    let chosen = shuffle(pool, random);
    const solve = clues => candidates.filter(v => clues.filter(c => !c.matches(v)).length === 1);
    for (let i = chosen.length - 1; i >= 0; i--) {
        const next = chosen.filter((_, j) => j !== i), answers = solve(next);
        if (answers.length === 1 && answers[0].join('') === secret.join('')) chosen = next;
    }
    const answers = solve(chosen);
    if (answers.length !== 1) throw new Error('거짓 기록 검증 실패');
    return scalar(secret.join(''), ['서로 다른 A, B, C는 각각 1~9입니다. 기록 중 정확히 하나만 거짓이고 나머지는 모두 참입니다.',
        '거짓 기록까지 고려하여 A, B, C를 순서대로 입력하세요.'], chosen.map(c => c.text));
}
function wason(random) {
    const allowedLetters = shuffle(['A', 'B', 'C', 'D', 'E', 'F'], random).slice(0, 3);
    const allowedNumbers = shuffle(range(9).map(i => String(i + 1)), random).slice(0, 4);
    const otherLetters = ['A', 'B', 'C', 'D', 'E', 'F'].filter(x => !allowedLetters.includes(x));
    const otherNumbers = range(9).map(i => String(i + 1)).filter(x => !allowedNumbers.includes(x));
    const cards = shuffle([pick(allowedLetters, random), pick(otherLetters, random), pick(allowedNumbers, random), pick(otherNumbers, random),
        ...range(4).map(() => pick([...allowedLetters, ...otherLetters, ...allowedNumbers, ...otherNumbers], random))], random);
    const solution = cards.map(c => allowedLetters.includes(c) || otherNumbers.includes(c) ? '1' : '0').join('');
    return scalar(solution, ['각 카드의 한 면은 A~F 문자, 반대 면은 1~9 숫자입니다. 앞면만 보고 있습니다.',
        '검증할 주장: “문자가 ' + allowedLetters.join(', ') + ' 중 하나인 모든 카드는 반대 면 숫자가 ' + allowedNumbers.join(', ') + ' 중 하나다.”',
        '주장이 맞는지 반드시 확인하려면 최소한 어떤 카드를 뒤집어야 할까요? 카드 순서대로 뒤집음 1, 그대로 0을 입력하세요.'],
    cards.map((c, i) => (i + 1) + '번 카드 앞면: ' + c), { symbols: '01', inputLabel: '반드시 뒤집어야 하는 카드 8개 표시' });
}
function cube(random) {
    const names = shuffle(['A', 'B', 'C', 'D', 'E', 'F'], random);
    let [u, d, f, b, l, r] = names;
    const directions = [], opposite = { 오른쪽: '왼쪽', 왼쪽: '오른쪽', 앞으로: '뒤로', 뒤로: '앞으로' };
    for (let i = 0; i < 9; i++) {
        const dir = pick(Object.keys(opposite).filter(x => x !== opposite[directions.at(-1)]), random);
        directions.push(dir);
        if (dir === '오른쪽') [u, d, l, r] = [l, r, d, u];
        if (dir === '왼쪽') [u, d, l, r] = [r, l, u, d];
        if (dir === '앞으로') [u, d, f, b] = [b, f, u, d];
        if (dir === '뒤로') [u, d, f, b] = [f, b, d, u];
    }
    return scalar(u + f + r, ['전개도를 접어 주사위를 만듭니다. 처음에는 ' + names[0] + '가 위, ' + names[2] + '가 앞, ' + names[5] + '가 오른쪽입니다.',
        '앞은 관찰자 쪽입니다. 방향은 항상 처음의 바닥 좌표를 기준으로 하며, 매번 인접한 면으로 한 칸 굴립니다.',
        '마지막의 위·앞·오른쪽 면 문자를 순서대로 입력하세요.'], ['굴리는 순서: ' + directions.join(' → ')],
    { symbols: 'ABCDEF', allowRepeats: false, inputLabel: '위 / 앞 / 오른쪽 면', displayGrid: { rows: 4, cols: 3, cells: ['', names[0], '', names[4], names[2], names[5], '', names[1], '', '', names[3], ''] } });
}
module.exports = [
    ['counterfeit', '가짜 동전의 무게', counterfeit], ['circuit', '논리 회로의 입력', circuit], ['hamming', '손상된 비트 기록', hamming],
    ['dialogue', '두 현자의 대화', dialogue], ['knights', '기사와 거짓말쟁이', knights], ['one_false', '하나의 거짓 기록', oneFalse],
    ['wason', '뒤집어야 할 카드', wason], ['cube', '굴러가는 주사위', cube]
];
