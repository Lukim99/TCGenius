# AGENTS.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 운영 데이터 보존 (필수)

- 꾸러미 구성, 보상 수량, 아이템 스탯·설명, 제작식 등 운영 중 변경 가능한 데이터는 운영 DB/관리자 설정을 기준으로 한다. 코드나 로컬 JSON의 기본값과 다르다는 이유로 덮어쓰거나 다른 기본 구성으로 재연결하지 않는다.
- 서버 시작, 모듈 import, 배포, 테스트에서 이러한 운영 데이터를 자동으로 보정·초기화·마이그레이션하지 않는다. 테스트는 운영 DB 쓰기 없이 격리해서 실행한다.
- 초기 데이터 생성은 명시적으로 요청된 작업에서 누락된 항목에 한해 수행한다. 기존 항목, 번들 인덱스, 수량, 스탯, 제작식 및 운영자가 비워 둔 구성은 보존한다.
- 기존 운영 데이터의 수정·삭제·중복 정리·연결 변경은 사용자가 해당 변경을 명시적으로 요청한 경우에만 한다. 코드 수정 요청을 운영 데이터 변경 허가로 간주하지 않는다.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
