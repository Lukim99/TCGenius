const { range, sum, pick, shuffle, permutations, product, fraction, calc, fractionText, scalar, deduce, letter } = require('./core');

function operations(random) {
    const ops = [...new Set(permutations(['+', '-', '*', '/', '*']).map(v => v.join('')))];
    let numbers, unique;
    for (const sequence of [range(6).map(() => 2 + Math.floor(random() * 8)), [2, 3, 5, 7, 4, 6]]) {
        numbers = sequence;
        const groups = new Map();
        for (const op of ops) {
            const value = numbers.slice(1).reduce((n, x, i) => calc(n, op[i], [x, 1]), [numbers[0], 1]);
            const key = fractionText(value);
            groups.set(key, [...(groups.get(key) || []), op]);
        }
        unique = [...groups].filter(([, xs]) => xs.length === 1);
        if (unique.length) break;
    }
    if (!unique.length) throw new Error('연산 배열 검증 실패');
    const [target, [solution]] = pick(unique, random);
    return scalar(solution, ['숫자 사이에 +, -, *, /를 넣으세요. *는 두 번, 나머지는 한 번씩 사용합니다.',
        '일반 연산 우선순위를 사용하지 않고 왼쪽부터 차례로 계산합니다. 나눗셈은 정확한 분수로 계산합니다.',
        '답은 연산자 5개를 순서대로 입력하세요.'], ['숫자: ' + numbers.join(' □ '), '목표 값: ' + target], { symbols: '+-*/', inputLabel: '연산자 5개' });
}
let cryptCandidates;
function cryptarithm(random) {
    if (!cryptCandidates) {
        cryptCandidates = [];
        for (const digits of permutations(range(10), 4)) {
            const [a, b, c, d] = digits, result = (10 * a + b + 10 * c + d).toString();
            if (!a || !c || result.length !== 3) continue;
            const answer = [...digits, ...[...result].map(Number)];
            if (new Set(answer).size === 7) cryptCandidates.push(answer);
        }
    }
    const secret = pick(cryptCandidates, random), pool = [];
    for (let i = 0; i < 7; i++) for (let j = i + 1; j < 7; j++) {
        const total = secret[i] + secret[j];
        pool.push({ text: letter(i) + ' + ' + letter(j) + ' = ' + total, matches: v => v[i] + v[j] === total });
    }
    const { chosen, solution } = deduce(cryptCandidates, shuffle(pool, random));
    return scalar(solution.join(''), ['서로 다른 A~G는 서로 다른 0~9 숫자입니다. AB, CD, EFG는 각각 두 자리, 두 자리, 세 자리 정수입니다.',
        'AB + CD = EFG를 만족시키세요. 답은 A~G에 해당하는 숫자 7개입니다.'], chosen.map(c => c.text));
}
function clocks(random) {
    const value = Math.floor(random() * 1000), moduli = shuffle([7, 11, 13], random), offsets = moduli.map(m => Math.floor(random() * m));
    const matches = range(1000).filter(n => moduli.every((m, i) => (n + offsets[i]) % m === (value + offsets[i]) % m));
    if (matches.length !== 1) throw new Error('시계 퍼즐 검증 실패');
    return scalar(String(value).padStart(3, '0'), ['세 시계는 각자의 주기를 채우면 0으로 돌아갑니다. 같은 시간 동안 한 칸씩 움직였습니다.',
        '지난 시간은 0~999입니다. 답은 앞에 0을 붙여 3자리로 입력하세요.'], moduli.map((m, i) => '시계 ' + letter(i) + ': 주기 ' + m + ', 시작 ' + offsets[i] + ', 현재 ' + (value + offsets[i]) % m));
}
const amounts = product(range(9).map(i => i + 1), 3);
function barter(random) {
    const secret = pick(amounts, random);
    const coefficients = shuffle([[2, 3, 5], [1, 4, 2], [3, 1, 4], [4, 2, 1], [1, 1, 1]], random);
    const pool = coefficients.map(c => ({ text: c.map((n, i) => n + '×' + letter(i)).join(' + ') + ' = ' + sum(c.map((n, i) => n * secret[i])), matches: v => sum(c.map((n, i) => n * v[i])) === sum(c.map((n, i) => n * secret[i])) }));
    const { chosen, solution } = deduce(amounts, pool);
    return scalar(solution.join(''), ['A, B, C 물품의 개수는 각각 1~9입니다. 모든 교환 장부를 동시에 만족시키는 개수를 찾으세요.', 'A, B, C 순으로 3자리 답안을 입력하세요.'], chosen.map(c => c.text));
}
function knapsack(random) {
    const weights = range(8).map(() => 2 + Math.floor(random() * 10)), values = range(8).map(() => 5 + Math.floor(random() * 30));
    const capacity = Math.floor(sum(weights) * 0.45);
    const choices = range(256).map(mask => {
        const answer = range(8).map(i => (mask >>> i) & 1);
        return { answer: answer.join(''), value: sum(answer.map((n, i) => n * values[i])), weight: sum(answer.map((n, i) => n * weights[i])) };
    }).filter(c => c.weight <= capacity).sort((a, b) => b.value - a.value || a.weight - b.weight || a.answer.localeCompare(b.answer));
    return scalar(choices[0].answer, ['배낭 용량은 ' + capacity + '입니다. 물품은 각각 최대 한 개씩 선택합니다.',
        '총 가치가 최대인 구성을 찾으세요. 동률이면 총 무게가 작은 구성, 그래도 같으면 0이 1보다 앞서는 사전순 답을 선택합니다.',
        'A~H 순서로 선택은 1, 제외는 0을 입력하세요.'], weights.map((w, i) => letter(i) + ': 무게 ' + w + ', 가치 ' + values[i]), { symbols: '01' });
}
function polynomial(random) {
    const coefficients = [20 + Math.floor(random() * 60), 1 + Math.floor(random() * 8), Math.floor(random() * 7) - 3, 1 + Math.floor(random() * 3)];
    const f = n => sum(coefficients.map((c, i) => c * n ** i));
    const values = range(7).map(i => f(i + 1)), bad = Math.floor(random() * 7);
    values[bad] += 1 + Math.floor(random() * 19);
    return scalar(f(8), ['표의 수는 차수가 3 이하인 하나의 다항식 f(n)으로 계산했습니다. 기록 한 개만 잘못되었습니다.',
        '잘못된 기록을 찾아 원래 규칙을 복원하고 f(8)을 구하세요.'], values.map((v, i) => 'f(' + (i + 1) + ') = ' + v));
}
function recurrence(random) {
    const a = 1 + Math.floor(random() * 9), b = 1 + Math.floor(random() * 9);
    const values = [1 + Math.floor(random() * 96), 1 + Math.floor(random() * 96)];
    while (values.length < 7) values.push((a * values.at(-1) + b * values.at(-2)) % 97);
    const answers = new Set();
    for (let x = 1; x <= 9; x++) for (let y = 1; y <= 9; y++) if (range(4).every(i => (x * values[i + 1] + y * values[i]) % 97 === values[i + 2])) answers.add((x * values[5] + y * values[4]) % 97);
    if (answers.size !== 1) throw new Error('수열 검증 실패');
    return scalar(String(values[6]).padStart(2, '0'), ['세 번째 항부터 “직전 항 × a + 그 앞 항 × b”를 97로 나눈 나머지입니다. a와 b는 각각 1~9의 정수입니다.',
        '일곱 번째 항을 구하세요. 0~9이면 앞에 0을 붙여 두 자리로 입력합니다.'], ['처음 여섯 항: ' + values.slice(0, 6).join(', ')]);
}
function mixing(random) {
    const volume = [8 + Math.floor(random() * 5), 8 + Math.floor(random() * 5)], initial = volume.slice();
    const ratios = [1 + Math.floor(random() * 4), 5 + Math.floor(random() * 4)];
    const pigment = volume.map((v, i) => fraction(v * ratios[i], 10));
    const clues = initial.map((v, i) => letter(i) + ' 통: ' + v + 'L, 붉은 물감 비율 ' + ratios[i] + '/10');
    for (let step = 0; step < 3; step++) {
        const from = step % 2, to = 1 - from, moved = 1 + Math.floor(random() * 4);
        const transfer = calc(pigment[from], '*', fraction(moved, volume[from]));
        pigment[from] = calc(pigment[from], '-', transfer); pigment[to] = calc(pigment[to], '+', transfer);
        volume[from] -= moved; volume[to] += moved;
        clues.push((step + 1) + '단계: ' + letter(from) + '를 완전히 섞고 ' + moved + 'L를 ' + letter(to) + '로 옮깁니다.');
    }
    const answer = fractionText(calc(pigment[1], '/', [volume[1], 1]));
    return scalar(answer, ['두 통 안에는 물과 붉은 물감이 섞여 있습니다. 매번 완전히 섞은 뒤 옮기며 손실은 없습니다.',
        '마지막 B 통의 붉은 물감 비율을 기약분수 분자/분모로 입력하세요.'], clues, { symbols: '0123456789/', inputLabel: 'B 통의 최종 비율 (분자/분모)' });
}
function balance(random) {
    const weights = [1, 3, 9, 27, 81, 243], target = 30 + Math.floor(random() * 300);
    const solutions = product([-1, 0, 1], 6).filter(v => sum(v.map((x, i) => x * weights[i])) === target);
    if (solutions.length !== 1) throw new Error('분동 검증 실패');
    return scalar(solutions[0].map(n => n === -1 ? 'L' : n === 1 ? 'R' : 'N').join(''), ['왼쪽 접시에 무게 ' + target + '인 물체가 있습니다. 각 분동은 한 번씩만 사용할 수 있습니다.',
        '분동을 물체와 같은 왼쪽에 놓으면 L, 오른쪽에 놓으면 R, 사용하지 않으면 N입니다. 양쪽 무게를 같게 만드세요.',
        '분동이 작은 순서대로 6글자를 입력하세요.'], ['분동: ' + weights.join(', ')], { symbols: 'LRN', inputLabel: '각 분동의 위치 L/R/N' });
}
function gears(random) {
    const teeth = range(6).map(() => pick([12, 15, 18, 20, 24, 30], random)), modes = range(3).map(() => pick(['맞물림', '열린 벨트', '교차 벨트'], random));
    const turns = 3 + Math.floor(random() * 7);
    let value = [turns, 1], clockwise = true;
    const clues = ['A 기어를 시계 방향으로 ' + turns + '바퀴 돌립니다.'];
    for (let i = 0; i < 3; i++) {
        const a = letter(i * 2), b = letter(i * 2 + 1);
        value = calc(value, '*', fraction(teeth[i * 2], teeth[i * 2 + 1]));
        if (modes[i] !== '열린 벨트') clockwise = !clockwise;
        clues.push(a + '(' + teeth[i * 2] + '개 이)와 ' + b + '(' + teeth[i * 2 + 1] + '개 이): ' + modes[i]);
        if (i < 2) clues.push(b + '와 ' + letter(i * 2 + 2) + '는 같은 축에 고정되어 같은 방향·같은 회전수로 움직입니다.');
    }
    return scalar((clockwise ? 'R' : 'L') + fractionText(value), ['맞물린 기어와 교차 벨트는 반대 방향, 열린 벨트는 같은 방향으로 회전합니다. 회전수 비는 이의 개수에 반비례합니다.',
        'F의 회전을 구하세요. 시계 방향 R, 반시계 방향 L 뒤에 기약분수 회전수를 붙입니다. 정수도 분모 1을 씁니다.'], clues, { symbols: 'RL0123456789/', inputLabel: 'F의 방향과 회전수 (R 또는 L, 분자/분모)' });
}
function grammar(random) {
    const rules = { A: pick(['AB', 'BC', 'CA'], random), B: pick(['AA', 'CB', 'AC'], random), C: pick(['BA', 'BB', 'AB'], random) };
    const start = shuffle(['A', 'B', 'C'], random).join(''), steps = 6 + Math.floor(random() * 3);
    let word = start;
    for (let i = 0; i < steps; i++) word = [...word].map(n => rules[n]).join('');
    const counts = new Map();
    for (let i = 0; i < word.length - 1; i++) { const pair = word.slice(i, i + 2); counts.set(pair, (counts.get(pair) || 0) + 1); }
    const [target, count] = pick([...counts].filter(([, n]) => n > 5), random);
    return scalar(count, ['매 단계에서 모든 글자를 동시에 치환합니다. 새로 생긴 글자는 다음 단계에서 치환합니다.',
        steps + '단계 후 이웃한 두 글자가 ' + target + '인 곳은 몇 곳일까요? 겹치는 위치도 각각 셉니다.'], ['시작: ' + start, ...Object.entries(rules).map(([a, b]) => a + ' → ' + b)]);
}
module.exports = [
    ['operations', '사칙연산 복원', operations], ['cryptarithm', '문자 덧셈식', cryptarithm], ['clocks', '세 시계의 시간', clocks],
    ['barter', '현자의 교환 장부', barter], ['knapsack', '탐험가의 배낭', knapsack], ['polynomial', '오염된 다항식 기록', polynomial],
    ['recurrence', '나머지 수열', recurrence], ['mixing', '물감의 교환', mixing], ['balance', '양팔저울의 분동', balance],
    ['gears', '연결된 기어', gears], ['grammar', '자라나는 문양', grammar]
];
