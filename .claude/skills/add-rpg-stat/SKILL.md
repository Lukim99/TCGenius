---
name: add-rpg-stat
description: Add a new RPGenius character/equipment stat key (flat stat or percent plusStat) so it aggregates, displays, formats, is assignable in admin, shows on the web profile/upgrade diff, and affects combat power everywhere. Use when introducing a new stat. Triggers - "스탯 추가", "능력치 추가", "new stat", "add rpg stat".
---

# Add an RPGenius stat key

A stat is a key in `stats` (flat, e.g. `atk`/`def`/`fireAtk`) or in `plusStats` (percent, e.g. `finalDamage`/`afterBasic`). Aggregation is generic (`addStats`, potential/soul/orb/pet/title all fold generically) but **the percent fold, display, formatting, admin, web profile and combat power live in ~18 separate hardcoded maps** — miss one and the stat silently won't show / won't count / can't be assigned. Decide flat vs percent first. (Real drift today: 18 flat keys and 4 percent keys exist in rpgenius labels but NOT in the admin dropdown.)

## 1. Aggregation (rpgenius.js `calculateUserStats`)
- **Flat `stat`**: sums automatically via `addStats` — NO change for the value to land in `stats[key]`.
- **Percent `plusStat`**: add the key to the additive fold list `['gold','potion','afterBasic','avd','afterSkill','000','exp','eliteDmg','mpReduce', … 'nonElementDamage'].forEach(key => stats[key] += plusStats[key])` (grep `'eliteDmg', 'mpReduce'`). Multiplicative final-% on a base stat (like atk%) belongs in the `['atk','def','hp','mp'].forEach` multiply block instead; `plusStats.pnt` → `stats.pntPercent`.
- Party monsters have their OWN fold list in `mergeMonsterStats` (partyquest.js) — add there if monsters may carry it. Player stats reach party via `member.baseSnapshot.stats` automatically.
- Derived-atk stats (`cardStarAtk`, `level9Atk`, `atkPerMillionGold`) are special-cased in `applyPotentialDerivedStats` — mirror only if you're adding another "atk from X" stat.

## 2. Display surfaces — add to EVERY one that applies (they drift; check each)
**a. Equipment desc / dex / web modal / potential / soul / orb / fashion / title text (rpgenius.js)** — six independent literal maps:
- Flat → `EQUIP_STAT_LABELS` + `SUPPORT_STAT_LABELS` + upgrade-preview local `statNames`
- Percent → `EQUIP_PLUSSTAT_LABELS` + `SUPPORT_PLUS_STAT_LABELS` + upgrade-preview local `plusStatNames`
- grep `atkPerMillionGold:` (flat maps; NB not in `statNames`) / `finalDamage:` (percent maps) / `plusStatNames = {`. The web reads server-rendered strings, so these cover dex + modals.

**b. Admin dropdown (public/admin.js)** — the single registry for all 8 stat editors (equipment/upgrade/dynamic/pet/fashion/soul):
- Flat → `FLAT_STAT_DEFS` (`{key,label,kind:'int'|'percent'|'cooldown'}`); Percent → `PLUS_STAT_DEFS` (`{key,label,kind:'percent'}`). Static file → browser refresh.

**c. Web '정보' tab profile (server.js, grep `PROFILE_STAT_GROUPS`)** — needs BOTH a label AND a group or it never renders:
- Add to a group in `PROFILE_STAT_GROUPS` (기본/치명타/연격/피해/속성/생존·유틸/획득) + a label in `PROFILE_STAT_LABELS`.
- Classify: flat int → `PROFILE_STAT_NUMERIC`; base stat shown `수치 · +x%` → `PROFILE_STAT_MULT`; direct ratio → `PROFILE_STAT_DIRECT`; lower-is-better → `PROFILE_STAT_INVERSE`; plain percent → none (default `key+'%'`). Card-slot effect feeding it → `SLOT_EFFECT_TO_STAT` (+`SLOT_EFFECT_SIGN`).
- **Server restart required** (server.js is loaded by the bot process; `public/*.js` are read per request).

**d. Web upgrade diff (server.js `buildStatDiffs` local `STAT_LABELS` / `PLUS_LABELS`)** — enhance preview + applied-diff toast; grep `function buildStatDiffs`.

**e. Kakao text profile (rpgenius.js `formatMyInfo`, OPTIONAL)** — hand-written `lines.push` under 〈스탯〉 (grep `'최대 공격 횟수: '`); 〈속성〉 block is element-generic. Add only if wanted in Kakao text.

## 3. Value formatting (rpgenius.js `formatStatValue`)
Percent keys render `%` only if listed: add `'<key>%'` (plusStat) or bare `'<key>'` (a flat stat that is a ratio) to the `[...].includes(key)` array (grep `'finalDamage%'`). Special units get their own branch (`skillCooldown`/`ultimateCooldownFlat` ms→초, `equipmentEffectDurationFlat`/`burnDurationFlat` 초, boolean `comboLastCrit`). `formatPlusStatValue` passes `skillCooldown/maxCmb/skillTrueDmg` through raw, else calls `formatStatValue(key+'%')`. Flat keys fall through to `comma()`.

## 4. Combat effect + 전투력
- **Effect**: wire where it acts — solo `calculateAttackHitResult` / `applyFieldDamageAction` / `applyTranscendPreAttack`; party `calculateOutgoingDamage` / `computeMonsterDamage`. See `rpg-damage-map`. (`ultimateDamage`/`lightFinalDamage` are cautionary tales: registered everywhere but never applied in combat.)
- **CP**: `computeCombatPowerFromStats(stats, slot, equipmentModifiers)` reads keys explicitly + `CP_WEIGHTS` — add or 전투력 under-counts. `tests/combat_power.test.js` asserts `supportedEquipmentStatKeys` covers every key used by transcend definitions — add the key there if 초월 gear uses it, and update `COMBAT_POWER.md` (user-facing) if it should be documented.

## 5. Verify
- `node -c rpgenius.js && node -c server.js && node -c public/admin.js`; `node tests/combat_power.test.js`.
- `rpg-check` §3 with `KEYS="<yourkey>"` (expect rpgenius ≥3, admin ≥1, server ≥2 if on the web profile).
- Confirm the stat appears in: equipment desc/dex, **admin dropdown**, **web 정보 profile** (after restart), upgrade diff; and 전투력 changes if it affects power.

Related: [[element-system]] (element stats are flat stats added this way; `allElementAtk`/`allElementRes` too), `add-rpg-element`, `rpg-check`.
