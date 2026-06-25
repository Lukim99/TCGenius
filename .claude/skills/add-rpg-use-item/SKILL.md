---
name: add-rpg-use-item
description: Add a new RPGenius usable/consumable item - a stat-buff/heal 소모품 (use_func) or a special-action 사용 item (item.use dispatch). Use when adding an item the player consumes for an effect. Triggers - "사용 아이템 추가", "소모품 추가", "물약 추가", "new use item", "add use item".
---

# Add an RPGenius usable item

Item data lives in **`rpgenius_data` Key:Item** (admin "Item" editor), **NOT `Item.json`** at runtime (`getDataCache('Item')`). Usage is driven by the item's `type` + effect fields, dispatched in `useItem` (rpgenius.js, grep `async function useItem`). Pick the right path:

## Path A — 소모품 (data-driven effect) — preferred for heals/buffs
Item: `{ "type": "소모품", "use_func": [ { "type": "<effect>", "amount": N, "duration": ms } ] }`.
- Effects are dispatched in `applyUseFunc(user, func, useCount, lines)` (rpgenius.js, grep `function applyUseFunc`). Existing `func.type`: `체력회복`, `마나회복`, `체력회복%`, `마나회복%`, `경험치획득`, `경험치비약`, `골드비약`.
- **New effect** = add an `if (func.type == '<effect>') { ...; resultLines.push('- ...'); return; }` block in `applyUseFunc`. Multiple `use_func` entries stack on one item.
- Buff-style (timed) effects: mirror `경험치비약`/`골드비약` → `applyPotionBuff(user, '<field>', amount, duration, '<label>', lines)`; also add a "higher buff already active" guard near the `소모품` validation in `useItem` (grep `이미 더 높은 효과`).
- No whitelist edit needed — `소모품` is already allowed.

## Path B — 사용 (special one-shot action) — for transforms/tickets/selectors
Item: `{ "type": "사용", "use": "<action>", ...action-specific fields }` (e.g. `장신구선택권` has `rarity`, `영혼석` has `soul`, `장비강화권` has `ug`).
In `useItem` (the `if (item.type == '사용')` block):
1. **Count guard** (if single-use): add `if (item.use == '<action>' && useCount != 1) return '❌ 한 번에 1개만 사용할 수 있습니다.';` near the other count checks.
2. **Whitelist** (critical): add `<action>` to the big `if (item.use != '변환' && ... ) return '❌ 사용할 수 없는 아이템입니다.';` guard — omit this and the item is rejected.
3. **Execution block**: add `if (item.use == '<action>') { ...effect...; lines.push('- ...'); }` alongside the existing `if (item.use == '변환') {...}` blocks (grep `if (item.use == '변환')`).
4. Validate any required fields up front (mirror `장비강화권`/`영혼석` field checks).

### Two-step / selector items (대상 선택이 필요한 경우)
Items that need the player to pick a target (mirror `장신구선택권`, `캐릭터변환`, `생명수`) DON'T finish in `useItem`. They set `user.pendingAction = { type: '<action>', consumedItemId: itemId, consumedItemCount: useCount }` and prompt `/RPGenius 선택 [번호]`; the second step is resolved elsewhere (grep `pendingAction.type` / `사용취소`). If the item can't proceed, **refund** with `addInventoryItem(user, itemId, useCount)` and return a message (the consume at the top already ran). Wire the matching resolver for your new `<action>`.

## Triggering & web
- Kakao: `/RPGenius 사용 [아이템명] [개수]` → `useItem`. `item.type` must be in the allowed set `['소모품','가챠','번들','사용','미끼']` (grep `'소모품', '가챠'`).
- **Web has no generic "use item" endpoint** (only specific ones like `use-lockbox`, potential, upgrade). If the item must be usable on the web, add a dedicated `server.post('/api/...')` that calls the specific logic and `await user.save()` (mirror `/api/inventory/use-lockbox`). Otherwise it's Kakao-only.

## Verify
- `node -c rpgenius.js`.
- Path B: confirm `<action>` is in the whitelist guard (else always rejected). Consumption (`removeInventoryItem`) and `await user.save()` happen in `useItem` already — don't double-consume.
- Test: use the item in-bot, confirm effect + inventory decremented.

Gotcha: never read `Item.json` at runtime for ids/data — use `getDataCache('Item')` / `findItemIdByName`. See `rpg-check` §4.
