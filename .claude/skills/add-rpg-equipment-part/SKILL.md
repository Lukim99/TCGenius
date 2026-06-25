---
name: add-rpg-equipment-part
description: Add a new RPGenius equipment slot/part type beyond weapon/armor/accessory/support (e.g. 문장/emblem). This is a cross-cutting architectural change - the four types are hardcoded in many places. Triggers - "장비 부위 추가", "새 장비 슬롯", "new equipment slot", "add equipment part".
---

# Add an RPGenius equipment part (slot type)

⚠️ **Cross-cutting.** `weapon`/`armor`/`accessory`/`support` are hardcoded across rpgenius.js, server.js, public/app.js, public/admin.js. Missing one site = a silent gap (stat not counted, not shown, can't equip). Decide first: **single-slot** (like weapon — `user.equipments.<type>` is one object) or **multi-slot** (like accessory — `user.equipments.accessory` is an id→object map). Then sweep every site below.

## Data model
- Equipment data: `getDataCache('Equipment')` = `{ weapon:[], armor:[], accessory:[], support:[], <new>:[] }`. Add the `<new>` array (via admin/`rpgenius_data` Key:Equipment, NOT a JSON file). `getEquipmentData(type,id)` is generic — no change.
- Potential support: `equipmentTypeSupportsPotential(type)` = `!!getPotentialData()[type]`. Add `Potential.json["<new>"]` only if it should roll potential.

## rpgenius.js sites
- `calculateUserStats` (grep `[['weapon', user.equipments`): add the new slot to stat aggregation — mirror weapon/armor (base + upgrade + potential + soul) or support (also rolled + dynamic bonus). Multi-slot → mirror the `accessories` loop.
- Equip/unequip: `equipItemByNumber`, `unequipEquipmentByNumber` — handle the new `user.equipments.<new>` storage shape.
- Display: `formatEquippedEquipment` lists in the profile (grep `formatEquippedEquipment('무기'`) and the detail view (grep `formatEquippedEquipmentDetail('무기'`).
- Equipment refs (potential/soul/upgrade targets): grep `refs.push({ type: 'weapon'` and add the new slot.
- **Element priority**: `getEquipmentElementChain` / `getAttackElement` — insert the new slot at the intended priority (무기 > 스킬 > 보조 > 갑옷 > 장신구). See [[element-system]].
- `getEquipItemElement(user, type, equip)` is generic — works for the new type.

## Web sites
- `public/app.js`: `SLOT_ICONS` + `EQUIP_TYPE_ORDER` (grep `SLOT_ICONS =`), the inline SVG icon map (grep `weapon:    \`<svg`), dex tab default, buy-order `equipType`.
- Dex: add a tab button in server.js page HTML (`data-tab="<new>"`) and include the type in `buildEquipmentDex` (grep `buildEquipmentDex`).
- `public/admin.js`: the several `{ '무기':'weapon', '갑옷':'armor', ... }` / `{weapon:'무기',...}` slot maps + `*_id` key lists (grep `accessory_id` to find them all) — add `<new>`/`<new>_id`.

## Combat power
Ensure the new slot's stats reach `computeCombatPowerFromStats` (they do if step 1 folds them into `stats`). No separate CP change unless it adds a brand-new stat (then use `add-rpg-stat`).

## Sweep & verify
1. **Sweep with multiple anchors** — grepping only `accessory` misses sites that enumerate just weapon/armor/support (e.g. the `calculateUserStats` weapon+armor pair). Walk all of:
   `grep -rnE "weapon|armor|accessory|support" rpgenius.js server.js public/app.js public/admin.js` — at every place the existing types are listed together, add the new one.
2. `node -c rpgenius.js server.js public/app.js public/admin.js`.
3. Manually: equip an item of the new type → stat appears in profile + 전투력 changes + dex tab renders + admin can assign it + (if enabled) potential works.

## Safety — all-or-nothing
A **partially** added type is worse than none: stats may not aggregate (weaker than intended), equip/unequip may corrupt `user.equipments`, or display may crash on an unknown slot. Treat the touch-point list as a checklist and complete every item before shipping; if unsure a site is covered, prefer the accessory-slot-extension route. Do NOT leave the feature half-wired in a saved user state.

If the new part is conceptually just "another accessory slot," strongly prefer extending the existing multi-slot accessory mechanism over a new type — far less surface area. Raise that option with the user.
