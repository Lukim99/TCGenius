---
name: rpg-check
description: Project consistency & sanity check for the tcgenius/RPGenius codebase before finishing or committing. Validates JS syntax, all RPGenius JSON, stat-label-map sync, and guards against runtime Item.json usage. Triggers - "정합성 검사", "검증해줘", "배포 전 점검", "rpg check", "sanity check".
---

# RPGenius consistency check

Run after editing RPGenius code/data. Report each section pass/fail with the actual command output; do not claim pass without running.

## 1. JS syntax
```bash
node -c rpgenius.js && node -c partyquest.js && node -c server.js && node -c hunter_colosseum.js && node -c ragbot.js
```
Also browser bundles (node -c parses syntax fine): `node -c public/app.js && node -c public/admin.js && node -c public/party.js`.

## 2. JSON validity
Validate every data file; a broken JSON silently 500s at runtime:
```bash
node -e 'const fs=require("fs");for(const f of fs.readdirSync("DB/RPGenius")){if(f.endsWith(".json")){try{JSON.parse(fs.readFileSync("DB/RPGenius/"+f,"utf8"));}catch(e){console.error("BAD JSON:",f,e.message);process.exit(1);}}}console.log("all RPGenius JSON valid")'
```

## 3. Stat-label-map sync (silent display bug if drifted)
A stat key must appear in EVERY surface that applies or it won't render somewhere:
- `rpgenius.js` `EQUIP_STAT_LABELS`/`EQUIP_PLUSSTAT_LABELS` (weapon/armor/accessory desc, web modal, dex)
- `rpgenius.js` `SUPPORT_STAT_LABELS`/`SUPPORT_PLUS_STAT_LABELS` (보조장비)
- `rpgenius.js` upgrade-preview local `statNames`/`plusStatNames` (~enhance preview)
- `public/admin.js` `FLAT_STAT_DEFS` (flat) / `PLUS_STAT_DEFS` (percent) — admin Equipment dropdown (shape `{key,label,kind}`)
- `server.js` `PROFILE_STAT_LABELS` (+`PROFILE_STAT_GROUPS` and a classifier set) — the web '정보' tab profile
The maps have different shapes, so check **key presence per file** (set `KEYS` to whatever stat keys you added; default = the 8 element keys):
```bash
KEYS="fireAtk waterAtk lightAtk darkAtk fireRes waterRes lightRes darkRes"
for k in $KEYS; do printf "%-9s rpgenius=%s admin=%s server=%s\n" "$k" "$(grep -c "\\b$k\\b" rpgenius.js)" "$(grep -c "\\b$k\\b" public/admin.js)" "$(grep -c "\\b$k\\b" server.js)"; done
```
- `rpgenius` ≥3 (the desc/support/upgrade maps) and `admin` ≥1 for every key — a `0` there means a hard gap (won't show / can't assign).
- `server` ≥1 **if the stat should appear on the web 정보 profile** (it must be in `PROFILE_STAT_LABELS` + a `PROFILE_STAT_GROUPS` group). `0` is acceptable only for an internal/hidden stat you deliberately don't surface on the web profile — confirm that's intended, don't assume. See [[element-system]], `add-rpg-stat`.

## 4. Item.json runtime guard (past incident)
Item data MUST come from `rpgenius_data` Key:`Item` via `getDataCache('Item', ...)`, NOT `Item.json`. Surface candidates for review:
```bash
grep -rnE "readJson\([^)]*Item\.json|require\([^)]*Item\.json|/Item\.json" rpgenius.js server.js partyquest.js || echo "no Item.json usage (good)"
```
Each hit is a candidate, NOT an automatic failure — inspect context. **Acceptable**: a `getDataCache('Item')`-first lookup that only falls back to `Item.json` when the cache misses (e.g. `findItemIdByName` in server.js). **Failure**: code that reads `Item.json` as the *primary* source for item data/ids. Report any primary-source usage; leave guarded fallbacks alone.

## 5. Skill handler parity (if skills changed)
Every main-card skill with special effects needs a handler in BOTH `executeMainCardSkillInField` (rpgenius.js) and `executeMainCardSkillEffect` (partyquest.js). Diff the two handler name-sets automatically — `comm -3` prints names handled on only one side (left = solo-only, indented = party-only):
```bash
comm -3 \
  <(grep -oE "skillData\\.skill\\.name == '[^']+'" rpgenius.js | sed "s/.*== '//;s/'//" | sort -u) \
  <(grep -oE "skillName === '[^']+'" partyquest.js   | sed "s/.*=== '//;s/'//" | sort -u)
```
Each printed name is a **candidate, not an automatic failure** — review it (like §4). A new skill you just added appearing on one side only is a real bug (wire the missing handler via `add-rpg-skill`). But some asymmetry is **by design**: solo-hunt-only mechanics (golds/exp/kill-count) have no party equivalent — e.g. `백억이요` (`extra.goldBonus` on kill) is solo-only on purpose because party quests have no gold-per-kill. Empty output = fully symmetric. See [[job-classes]].

## Output
Summarize: ✅/❌ per section. On ❌, show the failing file/output and stop for fixes before declaring done.
