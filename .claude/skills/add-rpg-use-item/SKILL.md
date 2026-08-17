---
name: add-rpg-use-item
description: Add a new RPGenius usable/consumable item - a stat-buff/heal 소모품 (use_func), a special-action 사용 item (item.use dispatch, one-shot or two-step selector), or a 가챠 box. Covers BOTH the Kakao path and the web inventory use flow (WEB_ITEM_USE_KEYS + pending resolvers). Triggers - "사용 아이템 추가", "소모품 추가", "물약 추가", "선택권 추가", "new use item", "add use item".
---

# Add an RPGenius usable item

Item data lives in **`rpgenius_data` Key:Item** (admin "Item" editor or `edit-rpgenius-data`), **NOT `Item.json`** at runtime (`getDataCache('Item')`). Usage is driven by `item.type` + effect fields, dispatched in `useItem(user, itemName, countArg)` (rpgenius.js, grep `async function useItem`). Allowed types: `['소모품','가챠','번들','사용','미끼']` (grep `'소모품', '가챠'`). The same `useItem` serves **Kakao** (`/RPGenius 사용 [아이템명] [개수]`) **and the web** (`POST /api/inventory/items/:id/use`, server.js). Pick the path:

## Path A — 소모품 (data-driven effect) — heals/buffs
Item: `{ "type": "소모품", "use_func": [ { "type": "<effect>", "amount": N, "duration": ms } ] }`.
- Dispatched in `applyUseFunc(user, func, useCount, lines)` (grep `function applyUseFunc`). Existing `func.type`: `체력회복`, `마나회복`, `체력회복%`, `마나회복%`, `경험치획득`, `경험치비약`, `골드비약`.
- **New effect** = add an `if (func.type == '<effect>') { ...; lines.push('- ...'); return; }` block there. Multiple `use_func` entries stack.
- Timed buffs: mirror `경험치비약`/`골드비약` → `applyPotionBuff(user, '<userField>', amount, duration, '<label>', lines)`; add the "higher buff already active" guard in `useItem`'s `소모품` validation (grep `이미 더 높은 효과`) and the count==1 rule there.
- No whitelist needed anywhere — `소모품` is already usable on Kakao + web (`isUsableInventoryItem` in server.js allows 소모품/가챠/번들/미끼 wholesale).

## Path B — 사용 (special action) — transforms/tickets/selectors
Item: `{ "type": "사용", "use": "<action>", ...fields }` (e.g. `장신구선택권`→`rarity`, `영혼석`→`soul{}`, `장비강화권`→`ug{level,roll}`, `아이템선택`→`choices[{id,count}]`, `보주`→orb name).
Existing actions (all in the `if (item.type == '사용')` blocks of `useItem`): 변환·캐릭터변환·만능캐릭터변환·전직캐릭터변환·전직프레스티지·패션적용·고급패션적용·패션제거·스탯초기화·장신구선택권·보조장비리롤·잠재능력부여·장비강화권·영혼석·보주·보주선택·가위·생명수·초월업그레이드·초월선택·아이템선택 (+ id/name special cases `EQUIPMENT_UPGRADER_ITEM_ID`, `프레스티지 증표`).

**Before writing code, check if an existing data-driven action already fits**: `아이템선택` (choose 1 of N items — `choices:[{id,count}]`, zero code), `장신구선택권` (`rarity`), `장비강화권` (`ug`), `영혼석` (`soul`), `아이템선택`-style boxes. Only invent a new `use` when none fits.

For a NEW `<action>`, in `useItem`:
1. **Count guard** (single-use): `if (item.use == '<action>' && useCount != 1) return '❌ 한 번에 1개만 사용할 수 있습니다.';` next to the others.
2. **Whitelist** (critical): add `&& item.use != '<action>'` to the big `if (item.use != '변환' && ... ) return '❌ 사용할 수 없는 아이템입니다.';` guard (grep `item.use != '변환'`) — omit and the item is always rejected.
3. **Field validation** up front (mirror `장비강화권`/`영혼석`/`아이템선택` checks).
4. **Execution block**: `if (item.use == '<action>') { ...; lines.push('- ...'); }` beside the existing blocks (grep `if (item.use == '아이템선택')`). Consumption (`removeInventoryItem` + `require` materials) already ran above; `await user.save()` happens once at the end — don't double-consume/save.
5. **Web whitelist** (critical for the web): add `'<action>'` to `WEB_ITEM_USE_KEYS` in server.js (grep `WEB_ITEM_USE_KEYS`) — `isUsableInventoryItem` rejects unknown `use` values, so the web "사용" button won't work otherwise. Kakao doesn't check this set.

### Two-step / selector items (대상 선택이 필요한 경우)
Items that need a target (mirror `보주선택`, `생명수`, `초월업그레이드`, `장신구선택권`) DON'T finish in `useItem`. If there is no valid target, **refund** first with `addInventoryItem(user, itemId, useCount)` + push a ❌ line (the consume already ran). Otherwise set
`user.pendingAction = { type: '<PendingType>', consumedItemId: itemId, consumedItemCount: useCount, ...ctx }` and push the prompt lines `/RPGenius 선택 [번호]` / `/RPGenius 사용취소` + a numbered list. Then wire **three** resolvers (all dispatch on `pendingAction.type`; the type string may differ from `use` — `영혼석`→`영혼부여`, `보주`→`보주부여`, `가위`→`귀속해제`, `변환`→`지정캐릭터변환`):
- **Resolver fn** `select<X>(user, numberArg)` (mirror `selectItemChoice`/`selectOrbChoice`): validate number, apply, `user.pendingAction = null`, return ✅/❌ text. On "nothing to pick" refund via `refundPendingActionItem(user, pending)`.
- **Kakao 2nd step** — in `handleRPGCommand` (rpgenius.js) add a `if (user.pendingAction && user.pendingAction.type == '<PendingType>') { 사용취소 → refundPendingActionItem + null + save; args[0] != '선택' → prompt; else result = select<X>(user, args[1]); await user.save(); reply(result); return true; }` block next to the `보주선택` block (grep `pendingAction.type == '보주선택'`).
- **Web 2nd step** — rpgenius.js `getWebItemUsePending(user)`: add an `else if (pending.type == '<PendingType>')` branch returning `{title, description, options}` (options via `webItemCardOption` / `webItemEquipmentOption` / `webItemPetOption`, or `{ value, kind:'item', name, meta, itemId }` — option `kind` must be one of card/fashion/equipment/pet/item for `decorateWebItemUsePending` (server.js) to attach icons; use `confirmOnly:true` + `confirmLabel` for yes/no steps). Unknown types return `null` → the web modal dead-ends. And `resolveWebItemUsePending(user, choice, confirmed)`: `if (pending.type == '<PendingType>') return select<X>(user, choice);`. Cancel is generic (`cancelWebItemUsePending` → `refundPendingActionItem`). The web UI (`public/app.js` `renderItemUsePending`) renders these generically — no client change.
- **DynamoDB gotcha**: `docClient` has no `removeUndefinedValues`, so `user.save()` throws if `pendingAction` contains an `undefined` field (e.g. `{ can: item.can }` when absent) → the pending never persists. Attach optional context conditionally.

## Path C — 가챠 (box) — data-driven, no code
`{ "type": "가챠", ... }` with either `pack: <Pack index>` (+ optional `num` rolls per use, `require:[{id,count}]` materials), or `pack: { type: '캐릭터 카드팩'|'전직 캐릭터 카드팩'|'장비 상자'|'보조 장비 상자'|'펫', rarity? }`, or a special `use: '초월상자'|'보주상자'` (random 초월 1단계 equipment / random 보주; `tradeUsed:true` makes granted gear non-tradable). `번들` = `pack: <Bundle index>`. Grants go through `grantPackReward`/`grantCharacterCardPack`/`grantEquipmentBox`/`grantSupportEquipmentBox`/`grantRandomPetByRarity`. New pack TYPES need code in that `가챠` block.

## Triggering & web
- Kakao: `/RPGenius 사용 [아이템명] [개수]` → `useItem`; selector 2nd step `/RPGenius 선택 [번호]` / `사용취소`.
- Web: `POST /api/inventory/items/:id/use` (server.js, grep `items/:id/use`) → `rpgenius.useItem`; two-step via `POST /api/inventory/item-use/resolve` `{choice, confirm}` / `/api/inventory/item-use/cancel` (server marks `user.pendingAction.webItemUse = true`; a Kakao-started pending blocks web use with 409). Bulk use only for 소모품/가챠/번들 (`isBulkUsableInventoryItem`). `봉인된 자물쇠` is the one item with its own page (`/api/inventory/use-lockbox`).

## Verify
- `node -c rpgenius.js server.js`.
- Path B: confirm `<action>` is in BOTH whitelists (rpgenius `useItem` guard + server `WEB_ITEM_USE_KEYS`), and for selectors that all three resolvers (`select<X>`, Kakao block, `getWebItemUsePending` + `resolveWebItemUsePending`) exist.
- Test in-bot AND on the web inventory: effect applied, inventory decremented, cancel refunds, and (selectors) the option list renders.
- If the item is new data too, remember the live server caches Item at boot — restart or admin `GET /api/data/Item` (see `edit-rpgenius-data`).

Gotcha: never read `Item.json` at runtime for ids/data — use `getDataCache('Item')` / `items.findIndex(i => i.name == name)`. See `rpg-check` §4.
