/* RPGENIUS 퍼스널 뽑기 — 브라우저 또는 CommonJS에서 쓰는 규칙·게이지 모듈. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PersonalDraw = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  const rules = Object.freeze({
    baseCount: 5,
    bonusChance: 0.20,
    autoRate: 0.16,       // 초당 충전 비율, 1 = 100%
    tapGain: 0.08,
    boostPerTap: 0.08,    // 연타 직후 초당 충전 비율에 추가
    maxBoost: 0.32,
    boostDecaySec: 0.6,
    fullHoldMs: 180,
    refreshFadeInMs: 240,
    refreshWhiteHoldMs: 160,
    refreshFadeOutMs: 360,
    refreshClearHoldMs: 40,
    frameMs: 36,
    revealFrame: 7,
    frameCount: 24
  });

  function shuffle(list, random) {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }

  // 고정 배치는 스크린샷용으로만 사용한다. 기본값은 보상 재고 전체의 무작위 배치다.
  function dealBoard(stock, fixed = [], random = Math.random) {
    const left = {...stock};
    const counts = Object.values(left);
    if (counts.some(count => !Number.isSafeInteger(count) || count < 0)) {
      throw new RangeError('보상 재고에는 0 이상의 정수를 사용하세요.');
    }
    const n = counts.reduce((sum, count) => sum + count, 0);
    const board = Array(n).fill(null);
    for (const [index, type] of fixed) {
      if (!Number.isInteger(index) || index < 0 || index >= n || board[index] !== null || !(left[type] > 0)) {
        throw new RangeError('고정 배치와 보상 재고를 확인하세요.');
      }
      board[index] = type;
      left[type]--;
    }
    const bag = [];
    for (const [type, count] of Object.entries(left)) {
      for (let i = 0; i < count; i++) bag.push(type);
    }
    shuffle(bag, random);
    return board.map(type => type === null ? bag.pop() : type);
  }

  // 미개봉 칸 목록을 복사하므로 호출자가 보관한 판 상태를 바꾸지 않는다.
  // 기본 5칸 이후 성공할 때마다 다시 한 번 판정한다. 잔여 칸 수가 유일한 상한이다.
  function planShake(unopened, random = Math.random) {
    const pool = Array.from(new Set(unopened));
    const baseCount = Math.min(rules.baseCount, pool.length);
    let total = baseCount;
    while (total < pool.length && random() < rules.bonusChance) total++;
    const indices = [];
    for (let i = 0; i < total; i++) {
      const j = Math.floor(random() * pool.length);
      indices.push(pool[j]);
      pool[j] = pool[pool.length - 1];
      pool.pop();
    }
    return {baseCount, indices};
  }

  function startCharge(now) {
    return {start: now, last: now, progress: 0, boost: 0};
  }

  // 이벤트 사이의 시간을 적분해 30/60/120 Hz에서 같은 시각·입력은 같은 충전량이 된다.
  function advanceCharge(state, now, tap = false) {
    now = Math.max(state.last, now);
    const seconds = (now - state.last) / 1000;
    const decay = Math.exp(-seconds / rules.boostDecaySec);
    const boostGain = state.boost * rules.boostDecaySec * (1 - decay);
    state.progress = Math.min(1, state.progress + rules.autoRate * seconds + boostGain);
    state.boost *= decay;
    state.last = now;
    if (tap && state.progress < 1) {
      state.progress = Math.min(1, state.progress + rules.tapGain);
      state.boost = Math.min(rules.maxBoost, state.boost + rules.boostPerTap);
    }
    return state.progress;
  }

  function boardPose(state) {
    const t = (state.last - state.start) / 1000;
    const drive = 2.4 + 4.8 * state.progress + 11.8 * state.boost;
    const phase = t * 57;
    return {
      x: drive * (0.78 * Math.sin(phase) + 0.22 * Math.sin(phase * 1.63)),
      y: drive * (0.44 * Math.sin(phase * 0.77) + 0.17 * Math.sin(phase * 1.78)),
      degrees: 0.073 * drive * Math.sin(phase * 0.66)
    };
  }
  function refreshOpacity(elapsedMs) {
    const holdEnd = rules.refreshFadeInMs + rules.refreshWhiteHoldMs;
    const smooth = t => t * t * (3 - 2 * t);
    if (elapsedMs <= 0) return 0;
    if (elapsedMs < rules.refreshFadeInMs) return smooth(elapsedMs / rules.refreshFadeInMs);
    if (elapsedMs <= holdEnd) return 1;
    const t = Math.min(1, (elapsedMs - holdEnd) / rules.refreshFadeOutMs);
    return 1 - smooth(t);
  }
  return Object.freeze({rules, dealBoard, planShake, startCharge, advanceCharge, boardPose, refreshOpacity});
});
