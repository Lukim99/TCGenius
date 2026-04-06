# RPG 시스템 TODO LIST — ✅ ALL COMPLETE

## 🔴 HIGH - 치명적 (게임 핵심 동작 불가)

- [x] **1. RPGBattle 메서드 구현** — playerAttack(), monsterTurn(), playerSkill(), playerUseItem(), playerEscape(), getBattleStatus()
- [x] **2. dungeons.json 교체** — RPG.txt 기획대로 25+개 던전 (페이즈 시스템 포함)
- [x] **3. monsters.json 교체** — RPG.txt 기획대로 (등급/무력게이지/특수기믹 포함)
- [x] **4. 강화 보너스 테이블 수정** — 최대 강화 16
- [x] **5. 골드/가넷 화폐 추가** — RPGUser/RPGOwner에 gold, garnet 필드
- [x] **6. 스킬 데이터 및 실행 로직** — skills.json + playerSkill() 데이터 기반 실행
- [x] **7. 강화/증폭 재료·골드 비용 공식**
- [x] **8. 증폭 시스템 완성** — 시도 로직, 차원 스탯, 증폭서/변환서
- [x] **9. 피로도 시스템** — 던전 입장 소모, 일일 리셋, 회복 아이템
- [x] **10. 무력화(스태거) 시스템** — 보스 무력게이지, 그로기 상태
- [x] **11. 상태이상 시스템** — burn, bleed, stun, 버프/디버프 지속시간

## 🟠 MEDIUM - 중요 (컨텐츠 시스템)

- [x] **12. 제작 시스템** — recipes.json + RPGCraftingManager
- [x] **13. 낚시 시스템** — fishing.json + RPGFishingManager
- [x] **14. 트로피 시스템** — trophies.json (40+종) + RPGTrophyManager
- [x] **15. 펫 시스템** — pets.json + RPGPetManager (알 열기, 숨결 제작)
- [x] **16. 상점 시스템** — shop.json + RPGShopManager (포인트/가넷/기간판매)
- [x] **17. 업적/칭호 시스템** — achievements.json + RPGAchievementManager
- [x] **18. 경매장/거래소/우편** — RPGTradeManager (골드 경매장, 가넷 거래소, 우편함)
- [x] **19. BM/시즌패스** — seasonpass.json + RPGSeasonPassManager (30레벨+반복 보상)
- [x] **20. 봉인된 자물쇠 가챠** — gacha.json (120+종 드랍) + RPGGachaManager
- [x] **21. 50제 레전더리 장비 데이터** — equipment_legendary50.json (무기6+방어구5+악세6)
- [x] **22. 에픽 장비 데이터** — equipment_epic.json (무기12종)
- [x] **23. 에픽 세트 효과 데이터** — equipment_epic_sets.json (방어구6세트+악세4세트)
- [x] **24. 스킬 상세 데이터 JSON** — skills.json (5직업 전체)
- [x] **27. 던전 보상 드랍 시스템** — endBattle에 슬롯/고정/보너스/글로벌 드랍 처리

## 🔵 LOW - 기타

- [x] **25. RPGUser 클래스 중복 제거** — RPGUser_refactored.js는 stale, new_engine.js가 정본
- [x] **26. 스탯 최댓값 개별 관리** — 트로피/장비에 statMax 필드 적용
- [x] **28. 장비 귀속 시스템** — boundTo, bindType, canTrade() 메서드 추가
