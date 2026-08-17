---
name: rpg-check
description: Project consistency & sanity check for the tcgenius/RPGenius codebase before finishing or committing. Validates JS syntax of every running-app file, all RPGenius JSON, stat-label-map sync across rpgenius/admin/server, guards against runtime Item.json usage, checks solo/party skill-handler parity (scoped), and runs the tests/ suite. Triggers - "정합성 검사", "검증해줘", "배포 전 점검", "rpg check", "sanity check".
---

# RPGenius consistency check

Run after editing RPGenius code/data. Report each section pass/fail with the actual command output; do not claim pass without running. Run from the repo root in bash.

## 1. JS syntax (chained — `node -c a.js b.js` checks ONLY the first file)
Running app graph: `new_engine.js` (Kakao bot entry) → `agent, wordchain, lol_chatbot, chatbot1, chatbot2, rpgenius (→ ragbot, transcend_equipment), hunter_colosseum, wollu, dc_write_utils, server (→ rpgenius, partyquest, webchat)`; browser bundles `public/{app,admin,party,hfield}.js`. (`old_engine.js`, `tcgenius.js`, `tcg_system.js`, `word_cli.js`, `tibo_x_bridge.js`, `backup-module.js` are not loaded.)
```bash
for f in new_engine.js server.js rpgenius.js partyquest.js transcend_equipment.js ragbot.js hunter_colosseum.js webchat.js wollu.js agent.js dc_write_utils.js wordchain.js chatbot1.js chatbot2.js lol_chatbot.js public/app.js public/admin.js public/party.js public/hfield.js; do node -c "$f" && echo "OK $f" || echo "FAIL $f"; done
```
Minimum for RPGenius-only edits: `rpgenius.js partyquest.js server.js transcend_equipment.js public/app.js public/admin.js public/party.js public/hfield.js`.

## 2. JSON validity
Every `DB/RPGenius/*.json` — a broken one silently 500s or, for disk-read files (CharacterCards/Skills/BaseStat/ExpTable/Dungeon/WorldBoss/ExtraSkills/EquipmentPassive/Potential/Orb/PetSet/titles/PartyQuest), breaks the game on the next read:
```bash
node -e 'const fs=require("fs");for(const f of fs.readdirSync("DB/RPGenius")){if(f.endsWith(".json")){try{JSON.parse(fs.readFileSync("DB/RPGenius/"+f,"utf8"));}catch(e){console.error("BAD JSON:",f,e.message);process.exit(1);}}}console.log("all RPGenius JSON valid")'
```
(Item/Equipment/Pack/Bundle/Shop/Recipe/Coupon/Pet/Fashion `.json` on disk are stale seeds — runtime uses DynamoDB `rpgenius_data`; see `edit-rpgenius-data`.)

## 3. Stat-label-map sync (silent display bug if drifted)
A stat key must appear in EVERY surface that applies or it won't render/assign somewhere:
- `rpgenius.js` `EQUIP_STAT_LABELS`/`EQUIP_PLUSSTAT_LABELS` (equipment/potential/soul/orb/fashion/title text, web modal, dex), `SUPPORT_STAT_LABELS`/`SUPPORT_PLUS_STAT_LABELS` (보조장비 + dex base lines), upgrade-preview local `statNames`/`plusStatNames`, `formatStatValue` percent list
- `public/admin.js` `FLAT_STAT_DEFS` / `PLUS_STAT_DEFS` — the single admin registry (`{key,label,kind}`)
- `server.js` `PROFILE_STAT_LABELS` **+ a `PROFILE_STAT_GROUPS` group** (+ classifier set) — web '정보' profile; `buildStatDiffs` local `STAT_LABELS`/`PLUS_LABELS` — web upgrade diff
Check **key presence per file** (set `KEYS` to the stat keys you touched; default = the 10 element keys):
```bash
KEYS="fireAtk waterAtk lightAtk darkAtk fireRes waterRes lightRes darkRes allElementAtk allElementRes"
for k in $KEYS; do printf "%-16s rpgenius=%s admin=%s server=%s\n" "$k" "$(grep -c "\\b$k\\b" rpgenius.js)" "$(grep -c "\\b$k\\b" public/admin.js)" "$(grep -c "\\b$k\\b" server.js)"; done
```
- `rpgenius` ≥3 and `admin` ≥1 for every key — a `0` is a hard gap (won't show / can't assign). Known pre-existing drift: ~18 flat + 4 percent keys are in rpgenius labels but not in admin (transcend-only stats) — don't "fix" unrelated ones silently; report.
- `server` ≥2 **if the stat should appear on the web 정보 profile** (label + group). `0` is acceptable only for a deliberately hidden/internal stat — confirm, don't assume. See [[element-system]], `add-rpg-stat`.

## 4. Item.json runtime guard (past incident)
Item data MUST come from `rpgenius_data` Key:`Item` via `getDataCache('Item')`, NOT `Item.json`:
```bash
grep -rnE "readJson\([^)]*Item\.json|require\([^)]*Item\.json|/Item\.json|ITEMS_PATH" rpgenius.js server.js partyquest.js || echo "no Item.json usage (good)"
```
Each hit is a candidate, NOT an automatic failure. **Expected/acceptable today**: `rpgenius.js` `const ITEMS_PATH = …` (dead constant, never read) and `server.js` `findItemIdByName` (`getDataCache('Item')`-first, disk only on cache miss). **Failure**: any code reading `Item.json` as the *primary* source. Report new primary-source usage; leave guarded fallbacks alone.

## 5. Skill handler parity (if skills changed)
Every main-card skill with special effects needs a handler in BOTH `executeMainCardSkillInField` (rpgenius.js) and `executeMainCardSkillEffect` (partyquest.js). Skill names also appear in OTHER functions (transcend hooks `preparePartyTranscendSkill`/`applyTranscendPreAttack`, quest/support skills `X`/`지오`/`SitoSoym`/`자폭`/`저지`), so scope the diff to the two handler bodies. `comm -3` prints names handled on only one side (left = solo-only, indented = party-only):
```bash
body() { awk -v fn="$2" 'index($0, "function " fn "(") == 1 || index($0, "async function " fn "(") == 1 {s=NR} s && /^}/ && NR>s {print s "," NR; exit}' "$1"; }
solo=$(body rpgenius.js executeMainCardSkillInField); party=$(body partyquest.js executeMainCardSkillEffect)
comm -3 <(sed -n "${solo}p" rpgenius.js | grep -oE "skillData\.skill\.name == '[^']+'" | sed "s/.*== '//;s/'//" | sort -u) \
        <(sed -n "${party}p" partyquest.js | grep -oE "skillName === '[^']+'" | sed "s/.*=== '//;s/'//" | sort -u)
```
Each printed name is a **candidate, not an automatic failure**. A skill you just added appearing on one side only is a real bug (wire the missing handler via `add-rpg-skill`). **Expected baseline output: `백억이요`** (solo-only by design — `extra.goldBonus`; party quests have no gold-per-kill). Anything else new = review. See [[job-classes]].

## 6. Tests (tests/*.test.js — plain assert scripts, one process each)
They read `.env.local` and load live DynamoDB `rpgenius_data` (no writes intended); ~30–90s total:
```bash
for f in tests/*.test.js; do timeout 120 node "$f" >/dev/null 2>&1 && echo "PASS $f" || echo "FAIL $f"; done
```
Known-failing at time of writing (2026-08-17, unrelated to RPGenius data): `hfield_web`, `transcend_integration`, `webchat` — compare against a clean baseline (`git stash` / another checkout) before blaming your change. Relevant to RPGenius edits: `combat_power` (CP + `supportedEquipmentStatKeys`), `skill_remake` (field skill behaviour), `transcend_*`, `admin_equipment_slots`, `equipment_*`, `daily_dungeon`, `stat_point_buy_cap`.

## Output
Summarize: ✅/❌ per section. On ❌, show the failing file/output and stop for fixes before declaring done. Mention that server.js changes need a bot/server restart to take effect (public/*.js don't).
