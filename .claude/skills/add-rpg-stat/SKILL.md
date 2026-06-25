---
name: add-rpg-stat
description: Add a new RPGenius character/equipment stat key (flat stat or percent plusStat) so it aggregates, displays, formats, and affects combat power everywhere. Use when introducing a new stat. Triggers - "스탯 추가", "능력치 추가", "new stat", "add rpg stat".
---

# Add an RPGenius stat key

A stat is a key in `stats` (flat, e.g. `atk`/`def`/`fireAtk`) or in `plusStats` (percent, e.g. `finalDamage`/`afterBasic`). Aggregation is generic (`addStats`) but **display + formatting + combat-power live in separate hardcoded maps** — miss one and the stat silently won't show or won't count. Decide flat vs percent first.

## 1. Aggregation (rpgenius.js `calculateUserStats`)
- **Flat `stat`** (sums automatically via `addStats`): NO change needed for the value to land in `stats[key]`.
- **Percent `plusStat`**: add the key to the additive fold list — the `['gold','potion','afterBasic', ... ].forEach(key => { stats[key] = ... + plusStats[key] })` array (grep `"'eliteDmg', 'mpReduce'"`). If it's a *multiplicative final-%* on a base stat (like atk%), it instead belongs in the `['atk','def','hp','mp'].forEach` multiply block above it.

## 2. Display surfaces — add to EVERY one that applies
These are **independent hardcoded maps that drift** — the #1 footgun. (Real example: `finalDamage`/`bossDmg` existed in rpgenius.js labels but were MISSING from the admin dropdown AND the web profile.) Don't assume a surface has it; check each.

**a. Equipment desc / dex / web equip modal (rpgenius.js)** — text in item descriptions & 도감:
- Flat → `EQUIP_STAT_LABELS` + `SUPPORT_STAT_LABELS` + upgrade-preview local `statNames`
- Percent → `EQUIP_PLUSSTAT_LABELS` + `SUPPORT_PLUS_STAT_LABELS` + upgrade-preview local `plusStatNames`
- grep `"finalDamage:"` (percent maps) / `"atkPerMillionGold:"` (flat maps)

**b. Admin dropdown (public/admin.js)** — to assign the stat on equipment in the admin panel:
- Flat → `FLAT_STAT_DEFS` (`{key,label,kind:'int'|'percent'|'cooldown'}`)
- Percent → `PLUS_STAT_DEFS` (`{key,label,kind:'percent'}`)
- (static file → browser refresh to pick up)

**c. Web '정보' tab profile (server.js)** — the per-stat list on the web profile:
- Add the key to a group in `PROFILE_STAT_GROUPS` (existing group, or a new `{ title, keys }`).
- Add a label in `PROFILE_STAT_LABELS`.
- **Classify it** (controls format + color tone):
  - flat int → add to `PROFILE_STAT_NUMERIC` (comma, neutral tone)
  - base stat shown as `수치 N · +x%` → `PROFILE_STAT_MULT` (atk/def/hp/mp style)
  - direct ratio like crit → `PROFILE_STAT_DIRECT`
  - "lower is better" (감소형, e.g. mpReduce) → `PROFILE_STAT_INVERSE`
  - plain percent → no Set needed (default formats as `key+'%'`)
  - if a **card-slot effect** also feeds this stat, map it in `SLOT_EFFECT_TO_STAT` (+ sign in `SLOT_EFFECT_SIGN`)
- grep `PROFILE_STAT_GROUPS` / `PROFILE_STAT_LABELS` in server.js. **Server restart required** (server-side code, not static).

**d. Kakao text profile (rpgenius.js, OPTIONAL)** — `/RPGenius 정보` shows only a curated subset (공격력/방어력/치명타/…/〈속성〉). Add a `lines.push(...)` in the profile builder (grep `'최대 공격 횟수: '`) ONLY if you want it in the Kakao text too.

## 3. Value formatting (rpgenius.js `formatStatValue`)
Percent keys render as `%` only if listed. Add `'<key>%'` to the `[...].includes(key)` array in `formatStatValue` (grep `"'finalDamage%'"`). `formatPlusStatValue` calls `formatStatValue(key + '%')`. Flat keys fall through to `comma(number)` — fine, no change. Special units (ms/초) get their own `if` (see `skillCooldown`).

## 4. Combat effect + 전투력
- **Effect**: wire the stat where it acts — solo `calculateAttackHitResult` / damage funnels, party `calculateOutgoingDamage` / `computeMonsterDamage`. See the `rpg-damage-map` skill.
- **CP**: if it affects power, add it to `CP_WEIGHTS` + `computeCombatPowerFromStats` (rpgenius.js) or 전투력 under-counts the stat.
- **Party**: stat flows via `member.baseSnapshot.stats` automatically. If MONSTERS may carry it, add the key to the `mergeMonsterStats` whitelist (partyquest.js).

## 5. Verify
- `node -c rpgenius.js server.js public/admin.js`.
- Run the `rpg-check` skill (label-map sync §3 with `KEYS="<yourkey>"`).
- Confirm the stat appears in: equipment desc/dex, **admin dropdown**, and the **web 정보 탭 profile** (after server restart). If it affects power, confirm 전투력 changes.
- Quick presence sweep across all surfaces: `grep -rn "<yourkey>" rpgenius.js server.js public/admin.js` — expect hits in each surface you wired.

Related: [[element-system]] (element stats are flat stats added this way), `add-rpg-element`, `rpg-check`.
