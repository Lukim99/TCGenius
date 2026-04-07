// ==================== RPG 시스템 캡슐화 ====================
// 모든 RPG 관련 시스템 클래스들

const fs = require('fs');
const path = require('path');

// 직업 데이터 로더
class RPGJobManager {
    constructor() {
        this.jobs = {};
        this.loadJobs();
    }

    loadJobs() {
        try {
            const jobsPath = path.join(__dirname, 'DB', 'RPG', 'jobs.json');
            const jobsData = fs.readFileSync(jobsPath, 'utf8');
            this.jobs = JSON.parse(jobsData);
        } catch (error) {
            console.error('직업 데이터 로드 실패:', error);
            this.jobs = {};
        }
    }

    getJob(jobName) {
        return this.jobs[jobName];
    }

    getAllJobs() {
        return Object.keys(this.jobs);
    }

    isValidJob(jobName) {
        return this.jobs.hasOwnProperty(jobName);
    }

    getJobInitialStats(jobName) {
        const job = this.jobs[jobName];
        return job ? job.initialStats : null;
    }

    getJobInitialHp(jobName) {
        const job = this.jobs[jobName];
        return job ? job.initialHp : 1000;
    }

    getJobHpPerLevel(jobName) {
        const job = this.jobs[jobName];
        return job ? job.hpPerLevel : 1000;
    }

    getJobResources(jobName) {
        const job = this.jobs[jobName];
        return job ? job.resources : {};
    }

    getJobInitialSkills(jobName) {
        const job = this.jobs[jobName];
        return job ? job.initialSkills : { passive: [], active: [] };
    }

    getJobLevelUnlockSkills(jobName, level) {
        const job = this.jobs[jobName];
        if (!job || !job.levelUnlockSkills) return null;
        return job.levelUnlockSkills[level.toString()];
    }

    getJobAwakenSkills(jobName) {
        const job = this.jobs[jobName];
        return job ? job.awakenSkills : [];
    }

    getJobMainStat(jobName) {
        const job = this.jobs[jobName];
        return job ? job.mainStat : 'power';
    }

    getJobWeapon(jobName) {
        const job = this.jobs[jobName];
        return job ? job.weapon : '무기';
    }

    getJobDescription(jobName) {
        const job = this.jobs[jobName];
        return job ? job.description : '';
    }
}

// 전역 JobManager 인스턴스
const jobManager = new RPGJobManager();

// 장비 데이터 로더
class RPGEquipmentDataManager {
    constructor() {
        this.weapons = [];
        this.armors = [];
        this.accessories = [];
        this.sets = [];
        this.loadEquipments();
    }

    loadEquipments() {
        try {
            // 무기 로드
            const weaponsPath = path.join(__dirname, 'DB', 'RPG', 'weapons.json');
            const weaponsData = fs.readFileSync(weaponsPath, 'utf8');
            this.weapons = JSON.parse(weaponsData);

            // 방어구 로드
            const armorsPath = path.join(__dirname, 'DB', 'RPG', 'armors.json');
            const armorsData = fs.readFileSync(armorsPath, 'utf8');
            this.armors = JSON.parse(armorsData);

            // 악세서리 로드
            const accessoriesPath = path.join(__dirname, 'DB', 'RPG', 'accessories.json');
            const accessoriesData = fs.readFileSync(accessoriesPath, 'utf8');
            this.accessories = JSON.parse(accessoriesData);

            // 세트 아이템 로드
            const setsPath = path.join(__dirname, 'DB', 'RPG', 'equipment_sets.json');
            const setsData = fs.readFileSync(setsPath, 'utf8');
            this.sets = JSON.parse(setsData);
        } catch (error) {
            console.error('장비 데이터 로드 실패:', error);
        }
    }

    // 무기 가져오기 (인덱스로)
    getWeapon(index) {
        return this.weapons[index];
    }

    // 방어구 가져오기 (인덱스로)
    getArmor(index) {
        return this.armors[index];
    }

    // 악세서리 가져오기 (인덱스로)
    getAccessory(index) {
        return this.accessories[index];
    }

    // 이름으로 장비 찾기
    findEquipmentByName(name) {
        let equipment = this.weapons.find(w => w.name === name);
        if (equipment) return { ...equipment, category: 'weapon' };

        equipment = this.armors.find(a => a.name === name);
        if (equipment) return { ...equipment, category: 'armor' };

        equipment = this.accessories.find(a => a.name === name);
        if (equipment) return { ...equipment, category: 'accessory' };

        return null;
    }

    // 레벨과 직업으로 무기 필터링
    getWeaponsByLevelAndJob(level, jobName) {
        return this.weapons.filter(w => 
            w.level <= level && 
            (!w.jobRestriction || w.jobRestriction === jobName)
        );
    }

    // 레벨로 방어구 필터링
    getArmorsByLevel(level, type = null) {
        let filtered = this.armors.filter(a => a.level <= level);
        if (type) {
            filtered = filtered.filter(a => a.type === type);
        }
        return filtered;
    }

    // 레벨로 악세서리 필터링
    getAccessoriesByLevel(level, type = null) {
        let filtered = this.accessories.filter(a => a.level <= level);
        if (type) {
            filtered = filtered.filter(a => a.type === type);
        }
        return filtered;
    }

    // 등급+레벨로 랜덤 장비 1개 반환 (던전 드랍용)
    getRandomEquipmentByRarityAndLevel(rarity, level) {
        const pool = [
            ...this.weapons.filter(w => w.rarity === rarity && w.level === level),
            ...this.armors.filter(a => a.rarity === rarity && a.level === level),
            ...this.accessories.filter(a => a.rarity === rarity && a.level === level)
        ];
        if (pool.length === 0) return null;
        const picked = pool[Math.floor(Math.random() * pool.length)];
        const category = picked.type === 'weapon' ? 'weapon' : (picked.type === 'necklace' || picked.type === 'ring' || picked.type === 'bracelet') ? 'accessory' : 'armor';
        return { ...picked, category };
    }

    // 등급으로 필터링
    filterByRarity(equipments, rarity) {
        return equipments.filter(e => e.rarity === rarity);
    }

    // 랜덤 스탯 생성 (방어구/악세서리용)
    generateRandomStat(equipment) {
        if (!equipment.randomStat) return {};

        const statNames = ['power', 'speed', 'int', 'luck'];
        const randomStatName = statNames[Math.floor(Math.random() * statNames.length)];

        let statValue;
        if (typeof equipment.randomStat === 'number') {
            statValue = equipment.randomStat;
        } else if (equipment.randomStat.min && equipment.randomStat.max) {
            statValue = Math.floor(
                Math.random() * (equipment.randomStat.max - equipment.randomStat.min + 1)
            ) + equipment.randomStat.min;
        } else {
            statValue = 1;
        }

        return { [randomStatName]: statValue };
    }

    // 장비 인스턴스 생성 (랜덤 스탯 포함)
    createEquipmentInstance(index, category) {
        let baseEquipment;
        
        if (category === 'weapon') {
            baseEquipment = this.weapons[index];
        } else if (category === 'armor') {
            baseEquipment = this.armors[index];
        } else if (category === 'accessory') {
            baseEquipment = this.accessories[index];
        }

        if (!baseEquipment) return null;

        const equipment = JSON.parse(JSON.stringify(baseEquipment)); // 깊은 복사
        equipment.index = index;
        equipment.category = category;

        // 랜덤 스탯 생성
        if (equipment.randomStat) {
            const randomStats = this.generateRandomStat(equipment);
            equipment.stats = { ...equipment.stats, ...randomStats };
            equipment.generatedStats = randomStats; // 생성된 랜덤 스탯 기록
        }

        return equipment;
    }

    // 세트 효과 계산
    calculateSetEffects(equippedItems) {
        const setCount = {};
        const activeSetEffects = [];

        // 장착된 아이템의 세트 카운트
        equippedItems.forEach(item => {
            if (item && item.setName) {
                setCount[item.setName] = (setCount[item.setName] || 0) + 1;
            }
        });

        // 세트 효과 활성화 체크
        Object.entries(setCount).forEach(([setName, count]) => {
            const set = this.sets.find(s => s.name === setName);
            if (set && set.setEffects) {
                Object.entries(set.setEffects).forEach(([requiredCount, effectData]) => {
                    if (count >= parseInt(requiredCount)) {
                        activeSetEffects.push({
                            setName: setName,
                            requiredCount: parseInt(requiredCount),
                            description: effectData.description,
                            effects: effectData.effects
                        });
                    }
                });
            }
        });

        return activeSetEffects;
    }

    // 모든 무기 개수
    getWeaponCount() {
        return this.weapons.length;
    }

    // 모든 방어구 개수
    getArmorCount() {
        return this.armors.length;
    }

    // 모든 악세서리 개수
    getAccessoryCount() {
        return this.accessories.length;
    }

    // 특정 레벨의 추천 장비 (초보자용)
    getRecommendedEquipments(level, jobName) {
        const weapons = this.getWeaponsByLevelAndJob(level, jobName)
            .filter(w => w.rarity === '일반')
            .sort((a, b) => b.level - a.level);

        const armors = this.getArmorsByLevel(level)
            .filter(a => a.rarity === '일반')
            .sort((a, b) => b.level - a.level);

        const accessories = this.getAccessoriesByLevel(level)
            .filter(a => a.rarity === '일반')
            .sort((a, b) => b.level - a.level);

        return {
            weapon: weapons[0],
            helmet: armors.find(a => a.type === 'helmet'),
            chest: armors.find(a => a.type === 'chest'),
            legs: armors.find(a => a.type === 'legs'),
            gloves: armors.find(a => a.type === 'gloves'),
            boots: armors.find(a => a.type === 'boots'),
            necklace: accessories.find(a => a.type === 'necklace'),
            ring: accessories.find(a => a.type === 'ring'),
            bracelet: accessories.find(a => a.type === 'bracelet')
        };
    }

    // 장비 되팔기 가격 계산
    // 기본 판매 가격 = (장비 레벨 * 5) * 등급 배수
    // 일반 *1, 레어 *3, 레전더리 *12, 에픽 *15
    calculateSellPrice(equipment) {
        if (!equipment) return 0;

        const rarityMultiplier = {
            '일반': 1,
            '레어': 3,
            '레전더리': 12,
            '에픽': 15
        };

        const level = equipment.level || 1;
        const multiplier = rarityMultiplier[equipment.rarity] || 1;
        
        return level * 5 * multiplier;
    }

    // 장비 분해 시 획득 아이템
    disassembleEquipment(equipment) {
        if (!equipment) return null;

        const level = equipment.level || 1;
        const rarity = equipment.rarity;
        
        let result = {
            enhancementStone: 0,
            legendaryEssence: 0,
            epicSoul: 0
        };

        // 강화석 계산
        if (rarity === '일반') {
            if (level === 1) {
                result.enhancementStone = Math.floor(Math.random() * 41) + 80; // 80~120
            } else if (level === 10 || level === 20) {
                result.enhancementStone = Math.floor(Math.random() * 41) + 180; // 180~220
            } else if (level === 30 || level === 40) {
                result.enhancementStone = Math.floor(Math.random() * 61) + 270; // 270~330
            } else if (level === 50) {
                result.enhancementStone = Math.floor(Math.random() * 61) + 370; // 370~430
            }
        } else if (rarity === '레어') {
            if (level === 1) {
                result.enhancementStone = Math.floor(Math.random() * 41) + 180; // 180~220
            } else if (level === 10 || level === 20) {
                result.enhancementStone = Math.floor(Math.random() * 61) + 270; // 270~330
            } else if (level === 30 || level === 40) {
                result.enhancementStone = Math.floor(Math.random() * 61) + 370; // 370~430
            } else if (level === 50) {
                result.enhancementStone = Math.floor(Math.random() * 81) + 470; // 470~550
            }
        } else if (rarity === '레전더리') {
            if (level === 20) {
                result.enhancementStone = Math.floor(Math.random() * 81) + 450; // 450~530
                result.legendaryEssence = 1;
            } else if (level === 40) {
                result.enhancementStone = Math.floor(Math.random() * 81) + 560; // 560~640
                result.legendaryEssence = 2;
            } else if (level === 50) {
                result.enhancementStone = Math.floor(Math.random() * 41) + 770; // 770~810
                result.legendaryEssence = 3;
            }
        } else if (rarity === '에픽') {
            if (level === 30) {
                result.enhancementStone = Math.floor(Math.random() * 221) + 980; // 980~1200
                result.epicSoul = Math.floor(Math.random() * 3) + 3; // 3~5
            }
        }

        return result;
    }

    // 장비 강화 시도
    // enhancement: 현재 강화 수치 (0~15)
    // 반환: { success: true/false, result: 'great'/'success'/'downgrade'/'reset', newEnhancement: number }
    attemptEnhancement(currentEnhancement) {
        if (currentEnhancement < 0 || currentEnhancement >= 16) {
            return { success: false, result: 'max', newEnhancement: currentEnhancement };
        }

        // 강화 확률표
        const enhancementTable = {
            0: { great: 10, success: 90, downgrade: 0, reset: 0 },
            1: { great: 8, success: 91, downgrade: 1, reset: 0 },
            2: { great: 6, success: 91, downgrade: 3, reset: 0 },
            3: { great: 5, success: 85, downgrade: 10, reset: 0 },
            4: { great: 4, success: 80, downgrade: 16, reset: 0 },
            5: { great: 3, success: 75, downgrade: 22, reset: 0 },
            6: { great: 2, success: 70, downgrade: 28, reset: 0 },
            7: { great: 1.5, success: 60, downgrade: 38.5, reset: 0 },
            8: { great: 1.2, success: 50, downgrade: 38.8, reset: 10 },
            9: { great: 1, success: 30, downgrade: 54, reset: 15 },
            10: { great: 0.5, success: 15, downgrade: 54.5, reset: 30 },
            11: { great: 0, success: 10, downgrade: 50, reset: 40 },
            12: { great: 0, success: 3, downgrade: 47, reset: 50 },
            13: { great: 0, success: 1.5, downgrade: 33.5, reset: 65 },
            14: { great: 0, success: 0.7, downgrade: 19.3, reset: 80 },
            15: { great: 0, success: 0.3, downgrade: 9.7, reset: 90 }
        };

        const rates = enhancementTable[currentEnhancement];
        const roll = Math.random() * 100;

        let newEnhancement = currentEnhancement;
        let result = 'fail';

        if (roll < rates.great) {
            // 대성공: +2강
            result = 'great';
            newEnhancement = Math.min(currentEnhancement + 2, 16);
        } else if (roll < rates.great + rates.success) {
            // 성공: +1강
            result = 'success';
            newEnhancement = currentEnhancement + 1;
        } else if (roll < rates.great + rates.success + rates.downgrade) {
            // 하락: -1강
            result = 'downgrade';
            newEnhancement = Math.max(currentEnhancement - 1, 0);
        } else {
            // 초기화: 0강으로 리셋
            result = 'reset';
            newEnhancement = 0;
        }

        return {
            success: result === 'great' || result === 'success',
            result: result,
            newEnhancement: newEnhancement
        };
    }

    // 강화에 따른 무기 공격력 증가 계산 (%) - RPG.txt 테이블
    getWeaponEnhancementBonus(enhancement) {
        const table = {
            0: 0, 1: 2, 2: 4, 3: 6, 4: 10, 5: 13, 6: 16, 7: 19, 8: 22,
            9: 25, 10: 30, 11: 35, 12: 45, 13: 60, 14: 80, 15: 100, 16: 125
        };
        return table[enhancement] || 0;
    }

    // 강화에 따른 방어구 체력 증가 계산 (%) - RPG.txt 테이블
    getArmorEnhancementBonus(enhancement, baseHp) {
        const table = {
            0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 7, 7: 9, 8: 11,
            9: 13, 10: 15, 11: 18, 12: 22, 13: 26, 14: 33, 15: 40, 16: 52
        };
        const percent = table[enhancement] || 0;
        return Math.floor(baseHp * percent / 100);
    }

    // 강화에 필요한 강화석 수량 계산
    getEnhancementStoneCost(targetEnhancement, equipLevel, rarity, isArmor = false) {
        const rarityCoeff = { '일반': 0.7, '레어': 0.9, '레전더리': 1.1, '에픽': 1.4 };
        const multiplierTable = {
            1: 1.0, 2: 1.4, 3: 1.9, 4: 2.5, 5: 3.2, 6: 4.0, 7: 5.0, 8: 6.2,
            9: 7.6, 10: 10.3, 11: 13.9, 12: 18.7, 13: 25.2, 14: 34.1, 15: 46.0, 16: 62.1
        };
        const base = (equipLevel + 10) * 3 * (rarityCoeff[rarity] || 1.0);
        const M = multiplierTable[targetEnhancement] || 1.0;
        const cost = Math.floor(base * M);
        return isArmor ? Math.floor(cost * 0.85) : cost;
    }

    // 강화에 필요한 골드 비용 계산
    getEnhancementGoldCost(targetEnhancement, equipLevel, rarity) {
        const rarityMul = { '일반': 1.0, '레어': 1.5, '레전더리': 2.1, '에픽': 2.8 };
        return Math.floor((equipLevel * 200) * (rarityMul[rarity] || 1.0) * (Math.pow(targetEnhancement, 4) / 500 + 1));
    }

    // 증폭 시도 (강화와 동일한 확률표 사용)
    attemptAmplification(currentAmplification) {
        // 강화와 동일한 확률표 사용
        return this.attemptEnhancement(currentAmplification);
    }

    // 장비 증폭서 사용: 강화 → 증폭 변환 (강화 초기화, 랜덤 차원 스탯 부여)
    convertToAmplification(equipment) {
        if (equipment.isAmplified) {
            return { success: false, message: '이미 증폭된 장비입니다.' };
        }
        equipment.enhancement = 0;
        equipment.amplification = 0;
        equipment.isAmplified = true;
        const dimensionalStats = ['power', 'speed', 'int', 'luck'];
        equipment.ampStat = dimensionalStats[Math.floor(Math.random() * dimensionalStats.length)];
        return { success: true, message: `증폭 변환 완료! 차원의 ${this._getStatName(equipment.ampStat)} 활성화`, ampStat: equipment.ampStat };
    }

    // 증폭 변환서 사용: 차원 스탯 재설정 (중복 가능)
    changeAmplificationStat(equipment) {
        if (!equipment.isAmplified) {
            return { success: false, message: '증폭 상태가 아닌 장비입니다.' };
        }
        const dimensionalStats = ['power', 'speed', 'int', 'luck'];
        equipment.ampStat = dimensionalStats[Math.floor(Math.random() * dimensionalStats.length)];
        return { success: true, message: `차원의 ${this._getStatName(equipment.ampStat)}(으)로 변경됨`, ampStat: equipment.ampStat };
    }

    // 스탯 이름 한글 변환
    _getStatName(stat) {
        const names = { power: '힘', speed: '속도', int: '지능', luck: '행운' };
        return names[stat] || stat;
    }

    // 증폭에 필요한 골드 (강화와 동일)
    getAmplificationGoldCost(targetAmplification, equipLevel, rarity) {
        return this.getEnhancementGoldCost(targetAmplification, equipLevel, rarity);
    }

    // 증폭에 필요한 순수한 결정체 수량
    getAmplificationCrystalCost(targetAmplification) {
        const table = {
            1: 1, 2: 1, 3: 2, 4: 2, 5: 3, 6: 3, 7: 4, 8: 4,
            9: 5, 10: 7, 11: 10, 12: 12, 13: 15, 14: 17, 15: 20, 16: 35
        };
        return table[targetAmplification] || 1;
    }

    // 증폭에 따른 주스탯 증가 (9증폭부터)
    getAmplificationStatBonus(amplification) {
        if (amplification < 9) return 0;
        return amplification - 8; // 9증폭 = +1, 10증폭 = +2, ...
    }
}

// 전역 EquipmentDataManager 인스턴스
const equipmentManager = new RPGEquipmentDataManager();

// 아이템 데이터 로더
class RPGItemDataManager {
    constructor() {
        this.items = [];
        this.loadItems();
    }

    loadItems() {
        try {
            const itemsPath = path.join(__dirname, 'DB', 'RPG', 'item.json');
            const itemsData = fs.readFileSync(itemsPath, 'utf8');
            this.items = JSON.parse(itemsData);
        } catch (error) {
            console.error('아이템 데이터 로드 실패:', error);
            this.items = [];
        }
    }

    getItem(index) {
        return this.items[index];
    }

    findItemByName(name) {
        return this.items.find(item => item.name === name);
    }

    getItemsByType(type) {
        return this.items.filter(item => item.type === type);
    }

    getItemsByRarity(rarity) {
        return this.items.filter(item => item.rarity === rarity);
    }

    getTradeableItems() {
        return this.items.filter(item => item.tradeable === true);
    }

    getAllItems() {
        return this.items;
    }

    getItemCount() {
        return this.items.length;
    }
}

// 전역 ItemDataManager 인스턴스
const itemManager = new RPGItemDataManager();

// 제작 시스템
class RPGCraftingManager {
    constructor() {
        this.recipes = {};
        this.loadRecipes();
    }

    loadRecipes() {
        try {
            const recipesPath = path.join(__dirname, 'DB', 'RPG', 'recipes.json');
            const data = fs.readFileSync(recipesPath, 'utf8');
            this.recipes = JSON.parse(data);
        } catch (error) {
            console.error('제작 레시피 로드 실패:', error);
            this.recipes = {};
        }
    }

    getRecipe(name) {
        return this.recipes[name] || null;
    }

    getAllRecipes() {
        return Object.values(this.recipes);
    }

    getRecipeNames() {
        return Object.keys(this.recipes);
    }

    // 제작 가능 여부 확인 (인벤토리, 골드 체크)
    canCraft(recipeName, inventory, gold = 0) {
        const recipe = this.recipes[recipeName];
        if (!recipe) return { success: false, message: '존재하지 않는 레시피입니다.' };

        for (const mat of recipe.materials) {
            if (mat.name === '골드') {
                if (gold < mat.count) {
                    return { success: false, message: `골드가 부족합니다. (필요: ${mat.count.toLocaleString()}, 보유: ${gold.toLocaleString()})` };
                }
            } else {
                if (!inventory.hasConsumable(mat.name, mat.count)) {
                    return { success: false, message: `${mat.name}이(가) 부족합니다. (필요: ${mat.count.toLocaleString()}개)` };
                }
            }
        }
        return { success: true };
    }

    // 제작 실행 (재료 소모 + 결과물 지급)
    craft(recipeName, inventory, character) {
        const check = this.canCraft(recipeName, inventory, character ? character.gold : 0);
        if (!check.success) return check;

        const recipe = this.recipes[recipeName];

        // 재료 소모
        for (const mat of recipe.materials) {
            if (mat.name === '골드') {
                character.gold -= mat.count;
            } else {
                inventory.consumeItem(mat.name, mat.count);
            }
        }

        // 결과물 지급
        const result = recipe.result;
        inventory.addConsumable(result.name, '아이템', result.count);

        return { success: true, message: `${result.name} x${result.count.toLocaleString()} 제작 완료!`, item: result };
    }
}

const craftingManager = new RPGCraftingManager();

// 낚시 시스템
class RPGFishingManager {
    constructor() {
        this.data = {};
        this.loadData();
    }

    loadData() {
        try {
            const fishingPath = path.join(__dirname, 'DB', 'RPG', 'fishing.json');
            const data = fs.readFileSync(fishingPath, 'utf8');
            this.data = JSON.parse(data);
        } catch (error) {
            console.error('낚시 데이터 로드 실패:', error);
            this.data = { rods: {}, baits: {} };
        }
    }

    getRod(name) { return this.data.rods[name] || null; }
    getBait(name) { return this.data.baits[name] || null; }
    getAllRods() { return Object.values(this.data.rods); }
    getAllBaits() { return Object.values(this.data.baits); }

    // 낚시 시간 계산 (초)
    getFishingTime(rodName) {
        const rod = this.getRod(rodName);
        if (!rod) return 60;
        return rod.minTime + Math.floor(Math.random() * (rod.maxTime - rod.minTime + 1));
    }

    // 낚시 결과 롤
    rollCatch(baitName) {
        const bait = this.getBait(baitName);
        if (!bait) return null;

        const roll = Math.random() * 100;
        let cumulative = 0;
        for (const drop of bait.drops) {
            cumulative += drop.chance;
            if (roll < cumulative) {
                return { ...drop };
            }
        }
        // 폴백: 첫 번째 드랍
        return { ...bait.drops[0] };
    }
}

const fishingManager = new RPGFishingManager();

// 트로피 시스템
class RPGTrophyManager {
    constructor() {
        this.trophies = {};
        this.loadTrophies();
    }

    loadTrophies() {
        try {
            const trophiesPath = path.join(__dirname, 'DB', 'RPG', 'trophies.json');
            const data = fs.readFileSync(trophiesPath, 'utf8');
            this.trophies = JSON.parse(data);
        } catch (error) {
            console.error('트로피 데이터 로드 실패:', error);
            this.trophies = {};
        }
    }

    getTrophy(name) { return this.trophies[name] || null; }
    getAllTrophies() { return Object.values(this.trophies); }
    getTrophyNames() { return Object.keys(this.trophies); }

    getTrophiesByRarity(rarity) {
        return Object.values(this.trophies).filter(t => t.rarity === rarity);
    }

    // 트로피 효과로부터 전투 보너스 스탯 계산
    calculateTrophyBonuses(trophyName) {
        const trophy = this.getTrophy(trophyName);
        if (!trophy) return {};
        return trophy.effects || {};
    }
}

const trophyManager = new RPGTrophyManager();

// 상점 시스템
class RPGShopManager {
    constructor() {
        this.shopData = {};
        this.loadShop();
    }

    loadShop() {
        try {
            const shopPath = path.join(__dirname, 'DB', 'RPG', 'shop.json');
            const data = fs.readFileSync(shopPath, 'utf8');
            this.shopData = JSON.parse(data);
        } catch (error) {
            console.error('상점 데이터 로드 실패:', error);
            this.shopData = { point: {}, seasonal: {} };
        }
    }

    getPointShopItems() { return this.shopData.point || {}; }
    getSeasonalItems() { return this.shopData.seasonal || {}; }

    getItem(category, itemKey) {
        return this.shopData[category] ? this.shopData[category][itemKey] : null;
    }

    // 구매 처리
    purchase(category, itemKey, character, owner, inventory) {
        const item = this.getItem(category, itemKey);
        if (!item) return { success: false, message: '존재하지 않는 상품입니다.' };

        const priceType = item.priceType || 'point';
        const price = item.price;

        // 가격 확인 (포인트 / 가넷 / 골드)
        if (priceType === 'garnet') {
            if (character.garnet < price) return { success: false, message: `가넷이 부족합니다. (필요: ${price.toLocaleString()}, 보유: ${character.garnet.toLocaleString()})` };
            character.garnet -= price;
        } else if (priceType === 'gold') {
            if (character.gold < price) return { success: false, message: `골드가 부족합니다. (필요: ${price.toLocaleString()}, 보유: ${character.gold.toLocaleString()})` };
            character.gold -= price;
        } else {
            // 포인트
            if (owner.point < price) return { success: false, message: `포인트가 부족합니다. (필요: ${price.toLocaleString()}, 보유: ${owner.point.toLocaleString()})` };
            owner.point -= price;
        }

        // 아이템 지급
        if (item.type === 'currency' && item.name === '가넷') {
            character.garnet += item.count;
        } else if (item.type === 'currency' && item.name === '골드') {
            character.gold += item.count;
        } else if (item.type === 'passExp') {
            owner.passExp = (owner.passExp || 0) + (item.count || 1);
        } else {
            inventory.addConsumable(item.name, item.itemType || '아이템', item.count || 1);
        }

        // 보너스 아이템
        if (item.bonus) {
            for (const bon of item.bonus) {
                inventory.addConsumable(bon.name, bon.itemType || '아이템', bon.count || 1);
            }
        }

        return { success: true, message: `${itemKey} 구매 완료!` };
    }
}

const shopManager = new RPGShopManager();

// 업적/칭호 시스템
class RPGAchievementManager {
    constructor() {
        this.achievements = {};
        this.loadAchievements();
    }

    loadAchievements() {
        try {
            const achPath = path.join(__dirname, 'DB', 'RPG', 'achievements.json');
            const data = fs.readFileSync(achPath, 'utf8');
            this.achievements = JSON.parse(data);
        } catch (error) {
            console.error('업적 데이터 로드 실패:', error);
            this.achievements = {};
        }
    }

    getAchievement(name) { return this.achievements[name] || null; }
    getAllAchievements() { return Object.values(this.achievements); }

    // 조건 충족 확인
    checkCondition(achievementName, playerData) {
        const ach = this.achievements[achievementName];
        if (!ach || !ach.condition) return false;
        const cond = ach.condition;

        switch (cond.type) {
            case 'skillUse':
                return (playerData.skillUseCounts && playerData.skillUseCounts[cond.skill] >= cond.count);
            case 'awakening':
                return playerData.isAwakened === true;
            case 'obtainTrophy':
                return playerData.trophies && playerData.trophies.some(t => t.rarity === cond.rarity);
            case 'craftCount':
                return (playerData.craftCount || 0) >= cond.count;
            case 'enhanceCount':
                return (playerData.enhanceCount || 0) >= cond.count;
            default:
                return false;
        }
    }

    // 칭호 효과 가져오기
    getTitleEffects(titleName) {
        const ach = this.achievements[titleName];
        if (!ach) return {};
        return ach.effects || {};
    }
}

const achievementManager = new RPGAchievementManager();

// 펫 시스템
class RPGPetManager {
    constructor() {
        this.data = {};
        this.loadData();
    }

    loadData() {
        try {
            const petPath = path.join(__dirname, 'DB', 'RPG', 'pets.json');
            const data = fs.readFileSync(petPath, 'utf8');
            this.data = JSON.parse(data);
        } catch (error) {
            console.error('펫 데이터 로드 실패:', error);
            this.data = { eggs: {}, pets: {}, petEquipment: {}, passPets: {}, breathCrafts: {}, partSalvage: {} };
        }
    }

    getPet(name) { return this.data.pets[name] || this.data.passPets[name] || null; }
    getAllPets() { return { ...this.data.pets, ...this.data.passPets }; }
    getPetEquipment(name) { return this.data.petEquipment[name] || null; }

    // 펫 알 열기
    openEgg(eggName) {
        const egg = this.data.eggs[eggName];
        if (!egg) return null;

        const roll = Math.random() * 100;
        let cumulative = 0;
        for (const drop of egg.drops) {
            cumulative += drop.chance;
            if (roll < cumulative) {
                return { name: drop.name, count: drop.count || 1, success: true };
            }
        }
        return { name: egg.drops[0].name, count: egg.drops[0].count || 1, success: true };
    }

    // 펫 효과 계산
    calculatePetBonuses(petName) {
        const pet = this.getPet(petName);
        if (!pet) return {};
        return pet.effects || {};
    }

    // 숨결 제작 가능 여부
    getBreathCraft(itemName) { return this.data.breathCrafts[itemName] || null; }
    getPartSalvage(partName) { return this.data.partSalvage[partName] || null; }
}

const petManager = new RPGPetManager();

// 가챠 시스템 (봉인된 자물쇠)
class RPGGachaManager {
    constructor() {
        this.data = {};
        this.loadData();
    }

    loadData() {
        try {
            const gachaPath = path.join(__dirname, 'DB', 'RPG', 'gacha.json');
            const data = fs.readFileSync(gachaPath, 'utf8');
            this.data = JSON.parse(data);
        } catch (error) {
            console.error('가챠 데이터 로드 실패:', error);
            this.data = {};
        }
    }

    getGacha(name) { return this.data[name] || null; }

    // 가챠 실행 (봉인된 자물쇠 열기 - 2회 롤)
    open(gachaName) {
        const gacha = this.data[gachaName];
        if (!gacha) return null;

        const results = [];
        for (let i = 0; i < (gacha.rollCount || 1); i++) {
            const roll = Math.random() * 100;
            let cumulative = 0;
            let found = false;
            for (const drop of gacha.drops) {
                cumulative += drop.chance;
                if (roll < cumulative) {
                    results.push({ name: drop.name, count: drop.count || 1 });
                    found = true;
                    break;
                }
            }
            if (!found) {
                results.push({ name: gacha.drops[0].name, count: gacha.drops[0].count || 1 });
            }
        }
        return { keyRequired: gacha.keyRequired, results };
    }
}

const gachaManager = new RPGGachaManager();

// 경매장/거래소/우편 시스템
class RPGTradeManager {
    constructor() {
        // 경매장 (골드 거래) - 모든 거래가능 아이템
        this.auctionListings = []; // { id, sellerId, sellerName, itemName, count, price, currency:'gold', timestamp }
        // 거래소 (가넷 거래) - 골드 상자만 거래 가능
        this.exchangeListings = []; // { id, sellerId, sellerName, itemName, count, price, currency:'garnet', timestamp }
        // 우편함
        this.mailbox = {}; // userId → [{ id, fromId, fromName, type:'item'|'garnet', itemName, count, garnet, message, timestamp, claimed }]
        this.nextListingId = 1;
        this.nextMailId = 1;
    }

    // ===== 경매장 (골드) =====
    auctionRegister(sellerId, sellerName, itemName, count, price) {
        const listing = {
            id: this.nextListingId++, sellerId, sellerName, itemName, count,
            price, currency: 'gold', timestamp: Date.now()
        };
        this.auctionListings.push(listing);
        return { success: true, message: `경매장에 ${itemName} x${count.toLocaleString()} 등록 완료! (${price.toLocaleString()} 골드)`, listing };
    }

    auctionBuy(buyerId, listingId, buyerCharacter) {
        const idx = this.auctionListings.findIndex(l => l.id === listingId);
        if (idx === -1) return { success: false, message: '존재하지 않는 매물입니다.' };
        const listing = this.auctionListings[idx];
        if (listing.sellerId === buyerId) return { success: false, message: '자신의 매물은 구매할 수 없습니다.' };
        if (buyerCharacter.gold < listing.price) return { success: false, message: `골드가 부족합니다. (필요: ${listing.price.toLocaleString()})` };

        buyerCharacter.gold -= listing.price;
        this.auctionListings.splice(idx, 1);

        // 판매자에게 골드 우편 발송
        this._sendMail(listing.sellerId, 'system', '경매장', 'gold', null, 0, Math.floor(listing.price * 0.95), `${listing.itemName} 판매 대금 (수수료 5%)`);

        return { success: true, message: `${listing.itemName} x${listing.count.toLocaleString()} 구매 완료!`, item: { name: listing.itemName, count: listing.count } };
    }

    auctionCancel(sellerId, listingId) {
        const idx = this.auctionListings.findIndex(l => l.id === listingId && l.sellerId === sellerId);
        if (idx === -1) return { success: false, message: '해당 매물을 찾을 수 없습니다.' };
        const listing = this.auctionListings.splice(idx, 1)[0];
        return { success: true, message: `${listing.itemName} 등록 취소 완료!`, item: { name: listing.itemName, count: listing.count } };
    }

    getAuctionListings(page = 1, perPage = 10) {
        const start = (page - 1) * perPage;
        return {
            listings: this.auctionListings.slice(start, start + perPage),
            total: this.auctionListings.length,
            page, totalPages: Math.ceil(this.auctionListings.length / perPage)
        };
    }

    searchAuction(keyword) {
        return this.auctionListings.filter(l => l.itemName.includes(keyword));
    }

    // ===== 거래소 (가넷, 골드 상자만) =====
    exchangeRegister(sellerId, sellerName, itemName, count, price) {
        if (itemName !== '골드 상자') return { success: false, message: '거래소에서는 골드 상자만 거래 가능합니다.' };
        const listing = {
            id: this.nextListingId++, sellerId, sellerName, itemName, count,
            price, currency: 'garnet', timestamp: Date.now()
        };
        this.exchangeListings.push(listing);
        return { success: true, message: `거래소에 ${itemName} x${count.toLocaleString()} 등록 완료! (${price.toLocaleString()} 가넷)`, listing };
    }

    exchangeBuy(buyerId, listingId, buyerCharacter) {
        const idx = this.exchangeListings.findIndex(l => l.id === listingId);
        if (idx === -1) return { success: false, message: '존재하지 않는 매물입니다.' };
        const listing = this.exchangeListings[idx];
        if (listing.sellerId === buyerId) return { success: false, message: '자신의 매물은 구매할 수 없습니다.' };
        if (buyerCharacter.garnet < listing.price) return { success: false, message: `가넷이 부족합니다. (필요: ${listing.price.toLocaleString()})` };

        buyerCharacter.garnet -= listing.price;
        this.exchangeListings.splice(idx, 1);

        this._sendMail(listing.sellerId, 'system', '거래소', 'garnet', null, 0, Math.floor(listing.price * 0.95), `${listing.itemName} 판매 대금 (수수료 5%)`);

        return { success: true, message: `${listing.itemName} x${listing.count.toLocaleString()} 구매 완료!`, item: { name: listing.itemName, count: listing.count } };
    }

    getExchangeListings(page = 1, perPage = 10) {
        const start = (page - 1) * perPage;
        return {
            listings: this.exchangeListings.slice(start, start + perPage),
            total: this.exchangeListings.length,
            page, totalPages: Math.ceil(this.exchangeListings.length / perPage)
        };
    }

    // ===== 우편 =====
    sendItemMail(fromId, fromName, toId, itemName, count, message = '') {
        return this._sendMail(toId, fromId, fromName, 'item', itemName, count, 0, message);
    }

    sendGarnetMail(fromId, fromName, toId, garnetAmount, message = '') {
        return this._sendMail(toId, fromId, fromName, 'garnet', null, 0, garnetAmount, message);
    }

    _sendMail(toId, fromId, fromName, type, itemName, count, garnet, message) {
        if (!this.mailbox[toId]) this.mailbox[toId] = [];
        const mail = {
            id: this.nextMailId++, fromId, fromName, type,
            itemName, count, garnet, message, timestamp: Date.now(), claimed: false
        };
        this.mailbox[toId].push(mail);
        return { success: true, message: '우편 발송 완료!', mail };
    }

    getMail(userId) {
        return (this.mailbox[userId] || []).filter(m => !m.claimed);
    }

    claimMail(userId, mailId) {
        const mails = this.mailbox[userId];
        if (!mails) return { success: false, message: '우편함이 비어있습니다.' };
        const mail = mails.find(m => m.id === mailId && !m.claimed);
        if (!mail) return { success: false, message: '해당 우편을 찾을 수 없습니다.' };
        mail.claimed = true;
        return { success: true, mail };
    }

    claimAllMail(userId) {
        const mails = this.getMail(userId);
        if (mails.length === 0) return { success: false, message: '수령할 우편이 없습니다.' };
        const claimed = [];
        for (const mail of mails) {
            mail.claimed = true;
            claimed.push(mail);
        }
        return { success: true, claimed };
    }

    // 직렬화/역직렬화
    toJSON() {
        return {
            auctionListings: this.auctionListings,
            exchangeListings: this.exchangeListings,
            mailbox: this.mailbox,
            nextListingId: this.nextListingId,
            nextMailId: this.nextMailId
        };
    }

    load(data) {
        if (!data) return;
        this.auctionListings = data.auctionListings || [];
        this.exchangeListings = data.exchangeListings || [];
        this.mailbox = data.mailbox || {};
        this.nextListingId = data.nextListingId || 1;
        this.nextMailId = data.nextMailId || 1;
    }
}

const tradeManager = new RPGTradeManager();

// 시즌패스 시스템
class RPGSeasonPassManager {
    constructor() {
        this.data = {};
        this.loadData();
    }

    loadData() {
        try {
            const passPath = path.join(__dirname, 'DB', 'RPG', 'seasonpass.json');
            const data = fs.readFileSync(passPath, 'utf8');
            this.data = JSON.parse(data);
        } catch (error) {
            console.error('시즌패스 데이터 로드 실패:', error);
            this.data = {};
        }
    }

    getSeason(seasonId) { return this.data[seasonId] || null; }
    getCurrentSeason() { return this.data['season1'] || null; }

    // 패스 경험치 → 레벨 계산
    getPassLevel(passExp) {
        const season = this.getCurrentSeason();
        if (!season) return 1;
        return Math.floor(passExp / season.expPerLevel) + 1;
    }

    // 특정 레벨의 보상 가져오기
    getReward(level, hasPlus = false) {
        const season = this.getCurrentSeason();
        if (!season) return null;

        const reward = season.rewards.find(r => r.level === level);
        if (reward) {
            return hasPlus ? { free: reward.free, plus: reward.plus } : { free: reward.free };
        }

        // 30레벨 이후 반복 보상
        if (level > 30 && season.repeatReward) {
            return hasPlus ? { free: season.repeatReward.free, plus: season.repeatReward.plus } : { free: season.repeatReward.free };
        }
        return null;
    }

    // 경험치 획득량 조회
    getExpAmount(source) {
        const season = this.getCurrentSeason();
        if (!season || !season.expSources) return 0;
        return season.expSources[source] || 0;
    }

    // 미수령 보상 목록 계산
    getUnclaimedRewards(passExp, claimedLevels = [], hasPlus = false) {
        const currentLevel = this.getPassLevel(passExp);
        const unclaimed = [];
        for (let lv = 1; lv <= currentLevel; lv++) {
            if (!claimedLevels.includes(lv)) {
                const reward = this.getReward(lv, hasPlus);
                if (reward) unclaimed.push({ level: lv, ...reward });
            }
        }
        return unclaimed;
    }
}

const seasonPassManager = new RPGSeasonPassManager();

// 던전 데이터 로더
class RPGDungeonManager {
    constructor() {
        this.dungeons = {};
        this.loadDungeons();
    }

    loadDungeons() {
        try {
            const dungeonsPath = path.join(__dirname, 'DB', 'RPG', 'dungeons.json');
            const dungeonsData = fs.readFileSync(dungeonsPath, 'utf8');
            this.dungeons = JSON.parse(dungeonsData);
        } catch (error) {
            console.error('던전 데이터 로드 실패:', error);
            this.dungeons = {};
        }
    }

    getDungeon(dungeonName) {
        return this.dungeons[dungeonName];
    }

    getAllDungeons() {
        return Object.keys(this.dungeons);
    }

    getDungeonsByLevel(level) {
        return Object.values(this.dungeons).filter(d => d.requiredLevel <= level);
    }
}

const dungeonManager = new RPGDungeonManager();

// 몬스터 데이터 로더
class RPGMonsterManager {
    constructor() {
        this.monsters = {};
        this.loadMonsters();
    }

    loadMonsters() {
        try {
            const monstersPath = path.join(__dirname, 'DB', 'RPG', 'monsters.json');
            const monstersData = fs.readFileSync(monstersPath, 'utf8');
            this.monsters = JSON.parse(monstersData);
        } catch (error) {
            console.error('몬스터 데이터 로드 실패:', error);
            this.monsters = {};
        }
    }

    getMonster(monsterId) {
        return this.monsters[monsterId];
    }

    createMonsterInstance(monsterId) {
        const monsterData = this.monsters[monsterId];
        if (!monsterData) return null;

        const monster = new RPGMonster(monsterData.id, monsterData.name, monsterData.level);
        
        // stats 로드
        if (monsterData.stats) {
            monster.stats.power = monsterData.stats.power || 0;
            monster.stats.speed = monsterData.stats.speed || 0;
            monster.stats.int = monsterData.stats.int || 0;
            monster.stats.luck = monsterData.stats.luck || 0;
            
            // HP 설정
            monster.hp.max = monsterData.stats.hp || 100;
            monster.hp.current = monster.hp.max;
        }
        
        // 등급 (시드/네임드/보스)
        monster.grade = monsterData.grade || '시드';
        
        // 무력게이지
        if (monsterData.staggerGauge) {
            monster.staggerGauge = { max: monsterData.staggerGauge, current: monsterData.staggerGauge };
        }
        
        // 특수 기믹
        if (monsterData.specialMechanic) {
            monster.specialMechanic = monsterData.specialMechanic;
        }
        
        // 스킬 및 보상
        monster.skills = [...monsterData.skills];
        monster.rewards = { ...monsterData.rewards };
        
        return monster;
    }
}

const monsterManager = new RPGMonsterManager();

// 1. 스탯 시스템
class RPGStats {
    constructor(power = 0, speed = 0, int = 0, luck = 0) {
        this.power = power;   // 힘
        this.speed = speed;   // 속도
        this.int = int;       // 지능
        this.luck = luck;     // 행운
        this.maxStat = 50;
    }

    load(data) {
        Object.assign(this, data);
        return this;
    }

    increase(statName, amount) {
        if (!this.hasOwnProperty(statName)) {
            return { success: false, message: '유효하지 않은 스탯입니다.' };
        }
        if (this[statName] >= this.maxStat) {
            return { success: false, message: `${statName}은(는) 이미 최대치(${this.maxStat})입니다.` };
        }
        
        this[statName] = Math.min(this[statName] + amount, this.maxStat);
        return { success: true, message: `${statName} +${amount}` };
    }

    getTotalStats() {
        return this.power + this.speed + this.int + this.luck;
    }

    toJSON() {
        return {
            power: this.power,
            speed: this.speed,
            int: this.int,
            luck: this.luck,
            maxStat: this.maxStat
        };
    }
}

// 2. 리소스 시스템 (GP, MP, 건력 등)
class RPGResource {
    constructor(type, current = 0, max = 0) {
        this.type = type;       // 'gp', 'mp', 'gunpower'
        this.current = current;
        this.max = max;
    }

    load(data) {
        Object.assign(this, data);
        return this;
    }

    add(amount) {
        this.current = Math.min(this.current + amount, this.max);
        return { success: true, current: this.current, max: this.max };
    }

    consume(amount) {
        if (this.current < amount) {
            return { success: false, message: `${this.type}이(가) 부족합니다. (${this.current}/${amount})` };
        }
        this.current -= amount;
        return { success: true, current: this.current, max: this.max };
    }

    setMax(max) {
        this.max = max;
        this.current = Math.min(this.current, max);
    }

    isFull() {
        return this.current >= this.max;
    }

    isEmpty() {
        return this.current <= 0;
    }

    getPercent() {
        return this.max > 0 ? (this.current / this.max) * 100 : 0;
    }

    toJSON() {
        return {
            type: this.type,
            current: this.current,
            max: this.max
        };
    }
}

// 3. 레벨 시스템
class RPGLevel {
    constructor(level = 1, exp = 0, maxLevel = 50) {
        this.level = level;
        this.exp = exp;
        this.maxLevel = maxLevel;
        this.expTable = this.generateExpTable();
    }

    load(data) {
        Object.assign(this, data);
        if (!this.expTable) this.expTable = this.generateExpTable();
        return this;
    }

    generateExpTable() {
        return {
            1: 50, 2: 80, 3: 120, 4: 180, 5: 260, 6: 360, 7: 480, 8: 650, 9: 850,
            10: 1150, 11: 1500, 12: 1900, 13: 2350, 14: 2850, 15: 3400, 16: 4000,
            17: 4650, 18: 5350, 19: 6100, 20: 6900, 21: 7750, 22: 8650, 23: 9600,
            24: 10600, 25: 11650, 26: 12750, 27: 13900, 28: 15100, 29: 16350,
            30: 17168, 31: 18112, 32: 19108, 33: 20159, 34: 21268, 35: 22437,
            36: 23671, 37: 24973, 38: 26347, 39: 27796, 40: 29325, 41: 30937,
            42: 32639, 43: 34434, 44: 36328, 45: 38326, 46: 40434, 47: 42658,
            48: 45004, 49: 50090
        };
    }

    getRequiredExp() {
        return this.expTable[this.level] || 50090;
    }

    addExp(amount) {
        this.exp += amount;
        let leveledUp = false;
        let levels = [];

        while (this.exp >= this.getRequiredExp() && this.level < this.maxLevel) {
            this.exp -= this.getRequiredExp();
            this.level++;
            leveledUp = true;
            levels.push(this.level);
        }

        return { 
            success: true, 
            leveledUp, 
            levels,
            currentLevel: this.level,
            currentExp: this.exp,
            requiredExp: this.getRequiredExp()
        };
    }

    canLevelUp() {
        return this.exp >= this.getRequiredExp() && this.level < this.maxLevel;
    }

    isMaxLevel() {
        return this.level >= this.maxLevel;
    }

    toString() {
        return String(this.level);
    }

    valueOf() {
        return this.level;
    }

    toJSON() {
        return {
            level: this.level,
            exp: this.exp,
            maxLevel: this.maxLevel
        };
    }
}

// 4. 스킬 시스템
class RPGSkill {
    constructor(name, type, level = 1) {
        this.name = name;           // 스킬 이름
        this.type = type;           // 'passive', 'active', 'awakening'
        this.level = level;         // 스킬 레벨
        this.maxLevel = 10;
        this.cooldown = 0;          // 현재 쿨타임
        this.maxCooldown = 0;       // 최대 쿨타임
    }

    load(data) {
        Object.assign(this, data);
        return this;
    }

    levelUp() {
        if (this.level >= this.maxLevel) {
            return { success: false, message: `${this.name}은(는) 이미 최대 레벨입니다.` };
        }
        this.level++;
        return { success: true, level: this.level };
    }

    resetCooldown() {
        this.cooldown = this.maxCooldown;
    }

    reduceCooldown(amount = 1) {
        this.cooldown = Math.max(0, this.cooldown - amount);
    }

    isReady() {
        return this.cooldown <= 0;
    }

    toJSON() {
        return {
            name: this.name,
            type: this.type,
            level: this.level,
            maxLevel: this.maxLevel,
            cooldown: this.cooldown,
            maxCooldown: this.maxCooldown
        };
    }
}

// 5. 스킬 매니저
class RPGSkillManager {
    constructor(jobType) {
        this.jobType = jobType;
        this.skills = new Map();    // Map<skillName, RPGSkill>
        this.initializeJobSkills();
    }

    load(data) {
        this.jobType = data.jobType;
        this.skills = new Map();
        if (data.skills) {
            for (let [name, skillData] of Object.entries(data.skills)) {
                this.skills.set(name, new RPGSkill(skillData.name, skillData.type, skillData.level).load(skillData));
            }
        }
        return this;
    }

    initializeJobSkills() {
        // jobs.json에서 초기 스킬 로드
        const initialSkills = jobManager.getJobInitialSkills(this.jobType);
        
        // 패시브 스킬 추가
        if (initialSkills.passive) {
            initialSkills.passive.forEach(skillName => {
                this.skills.set(skillName, new RPGSkill(skillName, 'passive', 1));
            });
        }
        
        // 액티브 스킬 추가
        if (initialSkills.active) {
            initialSkills.active.forEach(skillName => {
                this.skills.set(skillName, new RPGSkill(skillName, 'active', 1));
            });
        }
    }

    unlockSkill(name, type, level = 1) {
        if (this.skills.has(name)) {
            return { success: false, message: `${name}은(는) 이미 보유한 스킬입니다.` };
        }
        this.skills.set(name, new RPGSkill(name, type, level));
        return { success: true, message: `${name} 스킬을 획득했습니다!` };
    }

    getSkill(name) {
        return this.skills.get(name);
    }

    hasSkill(name) {
        return this.skills.has(name);
    }

    getSkillsByType(type) {
        return Array.from(this.skills.values()).filter(skill => skill.type === type);
    }

    levelUpSkill(name) {
        const skill = this.skills.get(name);
        if (!skill) {
            return { success: false, message: `${name} 스킬을 찾을 수 없습니다.` };
        }
        return skill.levelUp();
    }

    toJSON() {
        const skillsObj = {};
        for (let [name, skill] of this.skills) {
            skillsObj[name] = skill.toJSON();
        }
        return {
            jobType: this.jobType,
            skills: skillsObj
        };
    }
}

// 5-1. 스킬 데이터 매니저 (skills.json 로드)
class RPGSkillDataManager {
    constructor() {
        this.skillData = {};
        this.loadSkills();
    }

    loadSkills() {
        try {
            const skillsPath = path.join(__dirname, 'DB', 'RPG', 'skills.json');
            const data = fs.readFileSync(skillsPath, 'utf8');
            this.skillData = JSON.parse(data);
        } catch (error) {
            console.error('스킬 데이터 로드 실패:', error);
            this.skillData = {};
        }
    }

    getJobSkills(jobType) {
        return this.skillData[jobType] || null;
    }

    getSkillDetail(jobType, skillName) {
        const jobData = this.skillData[jobType];
        if (!jobData) return null;
        for (const category of ['passive', 'active', 'awakeningPassive', 'awakeningActive']) {
            if (jobData[category] && jobData[category][skillName]) {
                return jobData[category][skillName];
            }
        }
        return null;
    }

    getSkillsForLevel(jobType, level, isAwakened = false) {
        const jobData = this.skillData[jobType];
        if (!jobData) return [];
        const available = [];
        for (const category of ['passive', 'active']) {
            if (jobData[category]) {
                for (const [name, skill] of Object.entries(jobData[category])) {
                    if (skill.unlockLevel <= level) {
                        available.push({ ...skill, category });
                    }
                }
            }
        }
        if (isAwakened) {
            for (const category of ['awakeningPassive', 'awakeningActive']) {
                if (jobData[category]) {
                    for (const [name, skill] of Object.entries(jobData[category])) {
                        available.push({ ...skill, category });
                    }
                }
            }
        }
        return available;
    }

    calculateSkillDamage(skillDetail, skillLevel, attackPower, stats = {}) {
        if (!skillDetail || !skillDetail.damage) return 0;
        const dmg = skillDetail.damage;
        const percent = dmg.base + (dmg.perLevel || 0) * (skillLevel - 1);
        const baseDamage = attackPower * (percent / 100);
        return Math.floor(baseDamage);
    }

    getSkillCooldown(skillDetail, skillLevel) {
        if (!skillDetail) return 0;
        if (typeof skillDetail.cooldown === 'object') {
            return Math.max(0, skillDetail.cooldown.base + (skillDetail.cooldown.perLevel || 0) * (skillLevel - 1));
        }
        return skillDetail.cooldown || 0;
    }

    getSkillCost(skillDetail, skillLevel) {
        if (!skillDetail || !skillDetail.cost) return null;
        const cost = skillDetail.cost;
        let amount;
        if (cost.amount !== undefined) {
            amount = cost.amount;
        } else {
            amount = cost.base + (cost.perLevel || 0) * (skillLevel - 1);
        }
        return { type: cost.type, amount };
    }
}

const skillDataManager = new RPGSkillDataManager();

// 6. 장비 아이템
class RPGEquipment {
    constructor(id, name, type, rarity, level, stats = {}) {
        this.id = id;               // 장비 고유 ID
        this.name = name;           // 장비 이름
        this.type = type;           // 'weapon', 'helmet', 'chest', 'legs', 'boots', 'gloves', 'necklace', 'ring', 'bracelet'
        this.rarity = rarity;       // '일반', '레어', '레전더리', '에픽'
        this.level = level;         // 장비 레벨
        this.stats = stats;         // { power: 1, hp: 100, ... }
        this.tradeable = rarity !== '에픽';
        this.enhancement = 0;       // 강화 수치 (0~16)
        this.amplification = 0;     // 증폭 수치 (0~16)
        this.isAmplified = false;   // 증폭 여부 (증폭서 사용 시 true)
        this.ampStat = null;        // 증폭 차원 스탯 (power/speed/int/luck)
        this.boundTo = null;        // 귀속된 캐릭터 ID (null = 미귀속)
        this.bindType = 'none';     // 'none', 'equip' (장착 시 귀속), 'pickup' (획득 시 귀속)
    }

    load(data) {
        Object.assign(this, data);
        return this;
    }

    // 강화 적용 (무기용)
    applyEnhancement(enhancement) {
        this.enhancement = Math.max(0, Math.min(enhancement, 16));
    }

    // 증폭 적용 (방어구용)
    applyAmplification(amplification) {
        this.amplification = Math.max(0, Math.min(amplification, 16));
        this.isAmplified = true;
    }

    // 귀속 처리
    bindToCharacter(characterId) {
        this.boundTo = characterId;
        return { success: true, message: `${this.name}이(가) 귀속되었습니다.` };
    }

    unbind() {
        if (this.rarity === '에픽') return { success: false, message: '에픽 장비는 귀속 해제가 불가능합니다.' };
        this.boundTo = null;
        return { success: true, message: `${this.name}의 귀속이 해제되었습니다.` };
    }

    isBound() { return this.boundTo !== null; }

    canTrade(characterId) {
        if (!this.tradeable) return false;
        if (this.boundTo && this.boundTo !== characterId) return false;
        if (this.boundTo) return false; // 귀속된 장비는 거래 불가
        return true;
    }

    // 현재 강화/증폭 수치 반환
    getEnhancementLevel() {
        return this.isAmplified ? this.amplification : this.enhancement;
    }

    // 강화/증폭 표시 문자열
    getEnhancementDisplay() {
        if (this.isAmplified && this.amplification > 0) {
            return `+${this.amplification}증폭`;
        } else if (this.enhancement > 0) {
            return `+${this.enhancement}`;
        }
        return '';
    }

    toJSON() {
        return {
            id: this.id,
            name: this.name,
            type: this.type,
            rarity: this.rarity,
            level: this.level,
            stats: this.stats,
            tradeable: this.tradeable,
            enhancement: this.enhancement,
            amplification: this.amplification,
            isAmplified: this.isAmplified,
            boundTo: this.boundTo,
            bindType: this.bindType
        };
    }
}

// 7. 장비 매니저
class RPGEquipmentManager {
    constructor() {
        this.equipped = new Map();  // Map<슬롯, RPGEquipment>
        this.slots = ['weapon', 'helmet', 'chest', 'legs', 'boots', 'gloves', 'necklace', 'ring', 'bracelet'];
    }

    load(data) {
        this.equipped = new Map();
        if (data.equipped) {
            for (let [slot, equipData] of Object.entries(data.equipped)) {
                if (equipData && equipData.id) {
                    this.equipped.set(slot, new RPGEquipment(
                        equipData.id, equipData.name, equipData.type, 
                        equipData.rarity, equipData.level, equipData.stats
                    ).load(equipData));
                }
            }
        }
        return this;
    }

    equip(slot, equipment) {
        if (!this.slots.includes(slot)) {
            return { success: false, message: '유효하지 않은 장비 슬롯입니다.' };
        }
        if (equipment.type !== slot) {
            return { success: false, message: `${slot} 슬롯에 ${equipment.type}을(를) 장착할 수 없습니다.` };
        }

        const oldEquip = this.equipped.get(slot);
        this.equipped.set(slot, equipment);
        
        return { 
            success: true, 
            equipped: equipment,
            unequipped: oldEquip,
            message: `${equipment.name}을(를) 장착했습니다.` 
        };
    }

    unequip(slot) {
        if (!this.slots.includes(slot)) {
            return { success: false, message: '유효하지 않은 장비 슬롯입니다.' };
        }
        
        const equipment = this.equipped.get(slot);
        if (!equipment) {
            return { success: false, message: '장착된 장비가 없습니다.' };
        }

        this.equipped.delete(slot);
        return { success: true, equipment, message: `${equipment.name}을(를) 해제했습니다.` };
    }

    getEquipped(slot) {
        return this.equipped.get(slot);
    }

    getTotalStats() {
        const totalStats = {};
        for (let equipment of this.equipped.values()) {
            for (let [stat, value] of Object.entries(equipment.stats)) {
                totalStats[stat] = (totalStats[stat] || 0) + value;
            }
        }
        return totalStats;
    }

    toJSON() {
        const equippedObj = {};
        for (let [slot, equipment] of this.equipped) {
            equippedObj[slot] = equipment.toJSON();
        }
        return {
            equipped: equippedObj,
            slots: this.slots
        };
    }
}

// 8. 소모품 아이템 클래스
class RPGConsumableItem {
    constructor(name, type, count = 1) {
        this.name = name;
        this.type = type;
        this.count = count;
        this.stackable = true;
    }

    load(data) {
        Object.assign(this, data);
        return this;
    }

    add(amount) {
        this.count += amount;
        return { success: true, count: this.count };
    }

    consume(amount) {
        if (this.count < amount) {
            return { success: false, message: '아이템이 부족합니다.' };
        }
        this.count -= amount;
        return { success: true, remaining: this.count };
    }

    toJSON() {
        return {
            name: this.name,
            type: this.type,
            count: this.count,
            stackable: this.stackable
        };
    }
}

// 9. 인벤토리 시스템 (장비 + 소모품)
class RPGInventory {
    constructor(maxSize = 100) {
        this.equipments = [];      // 장비 아이템 (RPGEquipment)
        this.consumables = new Map(); // 소모품 아이템 (Map<itemName, RPGConsumableItem>)
        this.maxSize = maxSize;
    }

    load(data) {
        this.equipments = [];
        if (data.equipments && Array.isArray(data.equipments)) {
            for (const eqData of data.equipments) {
                if (eqData && eqData.id) {
                    this.equipments.push(
                        new RPGEquipment(eqData.id, eqData.name, eqData.type, eqData.rarity, eqData.level, eqData.stats).load(eqData)
                    );
                }
            }
        }
        this.maxSize = data.maxSize || 100;
        
        this.consumables = new Map();
        if (data.consumables) {
            for (let [name, itemData] of Object.entries(data.consumables)) {
                this.consumables.set(name, new RPGConsumableItem(itemData.name, itemData.type, itemData.count).load(itemData));
            }
        }
        return this;
    }

    // 장비 추가
    addEquipment(equipment) {
        if (this.getTotalItemCount() >= this.maxSize) {
            return { success: false, message: '인벤토리가 가득 찼습니다.' };
        }
        this.equipments.push(equipment);
        return { success: true, message: `${equipment.name}을(를) 획득했습니다.` };
    }

    // 소모품 추가 (스택 가능)
    addConsumable(itemName, itemType, count = 1) {
        if (this.consumables.has(itemName)) {
            const item = this.consumables.get(itemName);
            item.add(count);
            return { success: true, message: `${itemName} +${count} (총 ${item.count}개)` };
        } else {
            if (this.getTotalItemCount() >= this.maxSize) {
                return { success: false, message: '인벤토리가 가득 찼습니다.' };
            }
            this.consumables.set(itemName, new RPGConsumableItem(itemName, itemType, count));
            return { success: true, message: `${itemName} ${count}개를 획득했습니다.` };
        }
    }

    // 장비 제거
    removeEquipment(equipmentId) {
        const index = this.equipments.findIndex(item => item.id === equipmentId);
        if (index === -1) {
            return { success: false, message: '장비를 찾을 수 없습니다.' };
        }
        const item = this.equipments.splice(index, 1)[0];
        return { success: true, item, message: `${item.name}을(를) 제거했습니다.` };
    }

    // 소모품 소비
    consumeItem(itemName, count = 1) {
        const item = this.consumables.get(itemName);
        if (!item) {
            return { success: false, message: '아이템을 찾을 수 없습니다.' };
        }
        
        const result = item.consume(count);
        if (result.success && item.count <= 0) {
            this.consumables.delete(itemName);
        }
        return result;
    }

    // 장비 찾기
    findEquipment(equipmentId) {
        return this.equipments.find(item => item.id === equipmentId);
    }

    // 소모품 찾기
    findConsumable(itemName) {
        return this.consumables.get(itemName);
    }

    // 소모품 개수 확인
    getConsumableCount(itemName) {
        const item = this.consumables.get(itemName);
        return item ? item.count : 0;
    }

    // 소모품 보유 확인
    hasConsumable(itemName, count = 1) {
        const item = this.consumables.get(itemName);
        return item && item.count >= count;
    }

    getTotalItemCount() {
        return this.equipments.length + this.consumables.size;
    }

    isFull() {
        return this.getTotalItemCount() >= this.maxSize;
    }

    toJSON() {
        const consumablesObj = {};
        for (let [name, item] of this.consumables) {
            consumablesObj[name] = item.toJSON();
        }
        return {
            equipments: this.equipments.map(eq => (typeof eq.toJSON === 'function') ? eq.toJSON() : eq),
            consumables: consumablesObj,
            maxSize: this.maxSize
        };
    }
}

// 10. 각성 시스템
class RPGAwakening {
    constructor() {
        this.isAwakened = false;
        this.level = 0;
        this.exp = 0;
        this.maxLevel = 500;
        this.ap = 0;    // Awakening Point
        this.bonuses = {
            boss: 0,        // 보스 피해 (1당 +0.4%)
            named: 0,       // 네임드 피해 (1당 +0.8%)
            seed: 0,        // 시드 피해 (1당 +1.2%)
            all: 0,         // 모든 피해 (1당 +0.2%)
            skill: 0,       // 스킬 데미지 (1당 +0.4%)
            crit: 0,        // 치명타 확률 (1당 +0.1%)
            critMul: 0,     // 치명타 피해량 (1당 +0.4%)
            def: 0,         // 받는 피해 감소 (1당 +0.2%)
            hp: 0,          // HP 증가 (1당 +1%)
            exp: 0,         // 각성 경험치 증가 (1당 +1%)
            neutralize: 0   // 무력화 효율 (1당 +1%)
        };
        this.maxBonus = 100;
    }

    load(data) {
        Object.assign(this, data);
        return this;
    }

    awaken() {
        if (this.isAwakened) {
            return { success: false, message: '이미 각성한 상태입니다.' };
        }
        this.isAwakened = true;
        this.level = 1;
        return { success: true, message: '각성에 성공했습니다!' };
    }

    addExp(amount) {
        if (!this.isAwakened) {
            return { success: false, message: '각성하지 않은 상태입니다.' };
        }

        this.exp += amount;
        let leveledUp = false;
        let levels = [];

        while (this.exp >= this.getRequiredExp() && this.level < this.maxLevel) {
            this.exp -= this.getRequiredExp();
            this.level++;
            this.ap++;  // 레벨업 시 AP 1 획득
            leveledUp = true;
            levels.push(this.level);
        }

        return { success: true, leveledUp, levels, ap: this.ap };
    }

    getRequiredExp() {
        const level = this.level;
        if (level < 5) return 360 * Math.pow(level + 1, 2);
        if (level < 10) return 36000;
        if (level < 20) return 144000;
        if (level < 30) return 324000;
        if (level < 40) return 576000;
        if (level < 50) return 900000;
        if (level < 60) return 1296000;
        if (level < 80) return 2592000;
        if (level < 100) return 4000000;
        return 4000000 + (level - 100) * 100000;
    }

    investAP(bonusType, amount) {
        if (!this.bonuses.hasOwnProperty(bonusType)) {
            return { success: false, message: '유효하지 않은 보너스 타입입니다.' };
        }
        if (this.ap < amount) {
            return { success: false, message: 'AP가 부족합니다.' };
        }
        if (this.bonuses[bonusType] + amount > this.maxBonus) {
            return { success: false, message: `${bonusType}은(는) 최대치(${this.maxBonus})입니다.` };
        }

        this.bonuses[bonusType] += amount;
        this.ap -= amount;
        return { success: true, bonusType, value: this.bonuses[bonusType], remainingAP: this.ap };
    }

    toJSON() {
        return {
            isAwakened: this.isAwakened,
            level: this.level,
            exp: this.exp,
            maxLevel: this.maxLevel,
            ap: this.ap,
            bonuses: {...this.bonuses},
            maxBonus: this.maxBonus
        };
    }
}

// 11. 전투 스탯 계산기
class RPGCombatCalculator {
    static calculateAttackPower(mainStat) {
        return mainStat * 100;
    }

    static calculateCritChance(luck, awakenBonus = 0) {
        return luck * 0.8 + awakenBonus * 0.1;
    }

    static calculateCritDamage(baseMultiplier = 150, awakenBonus = 0) {
        return baseMultiplier + awakenBonus * 0.4;
    }

    static calculateEvasion(speed) {
        return speed * 0.5;
    }

    static calculateNormalAttackDamage(power) {
        return power * 0.5; // 힘 1당 평타 데미지 0.5% 증가
    }

    static calculateSkillDamage(int) {
        return int * 0.3; // 지능 1당 스킬 데미지 0.3% 증가
    }
}

// 12. 몬스터 시스템 (플레이어 구조와 동일하게 재설계)
class RPGMonster {
    constructor(id, name, level) {
        this.id = id;           // 몬스터 고유 ID
        this.name = name;
        this.level = level;
        
        // 플레이어와 동일한 구조
        this.stats = new RPGStats();  // 스탯 (power, speed, int, luck)
        this.hp = new RPGResource('HP', 0, 0);
        
        // 몬스터 고유 데이터
        this.skills = [];       // 스킬 목록
        this.rewards = {};      // 보상
    }

    load(data) {
        if (data.stats) {
            this.stats.load(data.stats);
        }
        if (data.hp) {
            this.hp.max = data.hp;
            this.hp.current = data.hp;
        }
        if (data.skills) {
            this.skills = [...data.skills];
        }
        if (data.rewards) {
            this.rewards = { ...data.rewards };
        }
        return this;
    }

    isDead() {
        return this.hp.current <= 0;
    }

    toJSON() {
        return {
            id: this.id,
            name: this.name,
            level: this.level,
            stats: this.stats.toJSON(),
            hp: this.hp.toJSON(),
            skills: [...this.skills],
            rewards: { ...this.rewards }
        };
    }
}

// 13. 배틀 시스템 (processHunt 스타일 - actor/victim 기반)
class RPGBattle {
    constructor(character, monster, dungeon = null) {
        // 원본 참조 유지
        this.character = character;
        this.monster = monster;
        this.dungeon = dungeon; // 던전 보상 처리용
        
        // tempObj 구조 생성 (old_engine.js의 processHunt 방식)
        this.tempObj = {
            name: {
                player: character.name,
                monster: monster.name
            },
            stat: {
                player: {
                    hp: character.hp.current,
                    maxHp: character.hp.max,
                    power: character.stats.power,
                    speed: character.stats.speed,
                    int: character.stats.int,
                    luck: character.stats.luck,
                    gp: character.resources && character.resources.gp ? character.resources.gp.current : 0,
                    maxGp: character.resources && character.resources.gp ? character.resources.gp.max : 0,
                    mp: character.resources && character.resources.mp ? character.resources.mp.current : 0,
                    maxMp: character.resources && character.resources.mp ? character.resources.mp.max : 0,
                    gunpower: character.resources && character.resources.gunpower ? character.resources.gunpower.current : 0,
                    maxGunpower: character.resources && character.resources.gunpower ? character.resources.gunpower.max : 3
                },
                monster: {
                    hp: monster.hp.current,
                    maxHp: monster.hp.max,
                    power: monster.stats.power,
                    speed: monster.stats.speed,
                    int: monster.stats.int,
                    luck: monster.stats.luck
                }
            },
            effects: {
                player: {},  // 버프/디버프 (atkBuff, evasionBuff, stunned 등)
                monster: {}  // 상태이상 (stunned, bleed 등)
            },
            stack: {
                player: {},  // 스택 관리 (배신스택, 혈중첩 등)
                monster: {}
            },
            logs: []  // 전투 로그
        };
        
        this.turn = 0;
        this.isActive = true;
        this.escaped = false;
        this.turnLogs = [];
        this.currentTurnLog = [];
        
        // 선공 판정
        const playerSpeed = this.tempObj.stat.player.speed;
        const monsterSpeed = this.tempObj.stat.monster.speed;
        this.isPlayerTurn = playerSpeed >= monsterSpeed;
        
        // 전투 시작 로그
        this.tempObj.logs.push(`⚔️ 전투 시작!`);
        this.tempObj.logs.push(`${this.tempObj.name.player} VS ${this.tempObj.name.monster} (Lv.${monster.level})`);
        this.tempObj.logs.push(``);
        
        if (this.isPlayerTurn) {
            this.tempObj.logs.push(`✨ ${this.tempObj.name.player}의 선공!`);
        } else {
            this.tempObj.logs.push(`💥 ${this.tempObj.name.monster}의 선공!`);
        }
    }

    // ==================== 데미지 계산 헬퍼 ====================

    // 일반 공격 데미지 계산 (actor → victim)
    _calculateAttackDamage(actor) {
        const stat = this.tempObj.stat[actor];
        const eff = this.tempObj.effects[actor];
        // 주 스탯 기반 데미지 (power 기반 + 약간의 랜덤)
        const mainStat = Math.max(stat.power, stat.speed, stat.int, stat.luck);
        let baseDamage = mainStat * 15 + Math.floor(Math.random() * (mainStat * 5 + 50));
        
        // 힘 1당 평타 데미지 0.5% 증가
        let normalAttackBonus = 1 + (stat.power * 0.005);

        // 패시브 효과 (평타 데미지 증가) 적용
        if (actor === 'player' && this.character.skillManager) {
            const jobType = this.character.job || this.character.jobType;
            const passives = this.character.skillManager.getSkillsByType('passive');
            for (const skill of passives) {
                const detail = skillDataManager.getSkillDetail(jobType, skill.name);
                if (detail && detail.effects && detail.effects.normalAttackDamageBonus) {
                    const bonus = typeof detail.effects.normalAttackDamageBonus === 'object' ?
                                  detail.effects.normalAttackDamageBonus.base + (detail.effects.normalAttackDamageBonus.perLevel || 0) * (skill.level - 1) :
                                  detail.effects.normalAttackDamageBonus;
                    normalAttackBonus += (bonus / 100);
                }
            }
        }

        baseDamage = Math.floor(baseDamage * normalAttackBonus);
        
        // 공격력 버프 적용
        if (eff.atkBuff) {
            baseDamage = Math.floor(baseDamage * (1 + eff.atkBuff.percent / 100));
        }
        // 확정 크리티컬 공격력 보너스
        if (eff.guaranteeCrit && eff.guaranteeCrit.atkBonus) {
            baseDamage = Math.floor(baseDamage * (1 + eff.guaranteeCrit.atkBonus / 100));
        }
        
        return baseDamage;
    }

    // 크리티컬 판정
    _rollCritical(actor) {
        const stat = this.tempObj.stat[actor];
        const eff = this.tempObj.effects[actor];
        const baseCritChance = 5;
        // 행운 1당 치명타 확률 0.8%
        let critChance = baseCritChance + (stat.luck * 0.8);
        let critDmgBonus = 0;
        
        // 크리티컬 버프 적용
        if (eff.critBuff) {
            critChance += eff.critBuff.critChance || 0;
            critDmgBonus += eff.critBuff.critDamage || 0;
        }
        // 확정 크리티컬
        if (eff.guaranteeCrit) {
            critChance = 100;
        }
        
        critChance = Math.min(critChance, 80);
        if (eff.guaranteeCrit) critChance = 100; // 확정은 캡 무시
        
        const isCrit = Math.random() * 100 < critChance;
        // 기본 치명타 피해량 150% + 추가 보너스
        const critMultiplier = 1.5 + (critDmgBonus / 100);
        return { isCrit, critMultiplier };
    }

    // 피해 적용 (보호막, 받는 피해 증가 처리)
    _applyDamage(victim, damage) {
        const stat = this.tempObj.stat[victim];
        const eff = this.tempObj.effects[victim];
        
        // 받는 피해 증가 디버프
        if (eff.damageTakenUp) {
            damage = Math.floor(damage * (1 + eff.damageTakenUp.percent / 100));
        }
        
        // 보호막 먼저 소진
        if (eff.shield && eff.shield.amount > 0) {
            if (eff.shield.amount >= damage) {
                eff.shield.amount -= damage;
                return stat.hp; // 보호막이 모든 데미지 흡수
            } else {
                damage -= eff.shield.amount;
                eff.shield.amount = 0;
                delete eff.shield;
            }
        }
        
        stat.hp = Math.max(0, stat.hp - damage);
        return stat.hp;
    }

    // 회피 판정
    _rollEvasion(defender) {
        const stat = this.tempObj.stat[defender];
        const eff = this.tempObj.effects[defender];
        // 속도 1당 회피율 0.5%
        let evasionChance = stat.speed * 0.5;
        
        // 회피 버프
        if (eff.evasionBuff) {
            evasionChance += eff.evasionBuff.percent || 0;
        }
        
        evasionChance = Math.min(evasionChance, 60);
        return Math.random() * 100 < evasionChance;
    }
    
    // 턴 시작 시 패시브 효과 처리
    _applyPassiveEffects(actor, turnLog) {
        if (actor !== 'player') return;
        const jobType = this.character.job || this.character.jobType;
        const skillManager = this.character.skillManager;
        if (!skillManager) return;

        const passives = skillManager.getSkillsByType('passive').concat(skillManager.getSkillsByType('awakeningPassive'));
        for (const skill of passives) {
            const detail = skillDataManager.getSkillDetail(jobType, skill.name);
            if (detail && detail.effects) {
                const effects = detail.effects;
                // MP 회복
                if (effects.mpRegenPerTurn !== undefined && this.tempObj.stat.player.mp !== undefined) {
                    const regen = typeof effects.mpRegenPerTurn === 'object' ? effects.mpRegenPerTurn.base + (effects.mpRegenPerTurn.perLevel || 0) * (skill.level - 1) : effects.mpRegenPerTurn;
                    const prevMp = this.tempObj.stat.player.mp;
                    this.tempObj.stat.player.mp = Math.min(this.tempObj.stat.player.maxMp, prevMp + regen);
                    if (this.tempObj.stat.player.mp > prevMp) {
                        turnLog.push(`[패시브: ${skill.name}] MP +${regen} 회복 (${this.tempObj.stat.player.mp}/${this.tempObj.stat.player.maxMp})`);
                    }
                }
                // GP 회복
                if (effects.gpRegenPerTurn !== undefined && this.tempObj.stat.player.gp !== undefined) {
                    const regen = typeof effects.gpRegenPerTurn === 'object' ? effects.gpRegenPerTurn.base + (effects.gpRegenPerTurn.perLevel || 0) * (skill.level - 1) : effects.gpRegenPerTurn;
                    const prevGp = this.tempObj.stat.player.gp;
                    this.tempObj.stat.player.gp = Math.min(this.tempObj.stat.player.maxGp, prevGp + regen);
                    if (this.tempObj.stat.player.gp > prevGp) {
                        turnLog.push(`[패시브: ${skill.name}] GP +${regen} 회복 (${this.tempObj.stat.player.gp}/${this.tempObj.stat.player.maxGp})`);
                    }
                }
            }
        }
    }

    // 턴 시작 시 상태이상 처리 (출혈, 화상 등 DoT)
    _processStatusEffects(target) {
        const eff = this.tempObj.effects[target];
        const stat = this.tempObj.stat[target];
        const name = this.tempObj.name[target];
        const dotLog = [];
        
        // 출혈 처리
        if (eff.bleed) {
            const bleedDmg = Math.floor(stat.maxHp * eff.bleed.damagePercent / 100);
            stat.hp = Math.max(0, stat.hp - bleedDmg);
            dotLog.push(`🩸 ${name} 출혈! -${bleedDmg.toLocaleString()} HP`);
            eff.bleed.duration--;
            if (eff.bleed.duration <= 0) {
                delete eff.bleed;
                dotLog.push(`   출혈 해제됨`);
            }
        }
        
        // 화상 처리
        if (eff.burn) {
            const burnDmg = Math.floor(stat.maxHp * eff.burn.damagePercent / 100);
            stat.hp = Math.max(0, stat.hp - burnDmg);
            dotLog.push(`🔥 ${name} 화상! -${burnDmg.toLocaleString()} HP`);
            eff.burn.duration--;
            if (eff.burn.duration <= 0) {
                delete eff.burn;
                dotLog.push(`   화상 해제됨`);
            }
        }
        
        return dotLog;
    }

    // ==================== 플레이어 행동 ====================

    // 플레이어 일반 공격
    playerAttack() {
        if (!this.isActive) {
            return { success: false, message: '전투가 이미 종료되었습니다.' };
        }

        this.turn++;
        const turnLog = [];
        turnLog.push(``);
        turnLog.push(`━ 턴 ${this.turn} ━`);

        // 플레이어 DoT 처리 (출혈 등)
        // 패시브 효과 (MP, GP 리젠 등) 처리
        this._applyPassiveEffects('player', turnLog);

        const playerDot = this._processStatusEffects('player');
        if (playerDot.length > 0) {
            turnLog.push(...playerDot);
            if (this.tempObj.stat.player.hp <= 0) {
                this.addTurnLog(turnLog);
                this.finalizeTurn();
                return this.endBattle(false);
            }
        }

        // 회피 판정
        if (this._rollEvasion('monster')) {
            turnLog.push(`${this.tempObj.name.monster}이(가) 공격을 회피했습니다!`);
            this.addTurnLog(turnLog);
            this.finalizeTurn();
            return { success: true, log: this.getRecentLog() };
        }

        // 데미지 계산
        let baseDamage = this._calculateAttackDamage('player');
        const { isCrit, critMultiplier } = this._rollCritical('player');
        
        let finalDamage = baseDamage;
        if (isCrit) {
            finalDamage = Math.floor(baseDamage * critMultiplier);
            turnLog.push(`💥 치명타!`);
        }

        // 피해 적용
        this._applyDamage('monster', finalDamage);

        turnLog.push(`⚔️ [${this.tempObj.name.player}의 공격] ${finalDamage.toLocaleString()} 피해!`);
        turnLog.push(`   ${this.tempObj.name.monster} HP: ${this.tempObj.stat.monster.hp.toLocaleString()}/${this.tempObj.stat.monster.maxHp.toLocaleString()}`);

        // 도망 기믹 체크
        if (this.monster.specialMechanic && this.monster.specialMechanic.type === 'escapeAtHp') {
            if (this.tempObj.stat.monster.hp <= this.monster.specialMechanic.threshold && this.tempObj.stat.monster.hp > 0) {
                turnLog.push(`💨 ${this.tempObj.name.monster}: "${this.monster.specialMechanic.message || '도망친다!'}"`);
                turnLog.push(`${this.tempObj.name.monster}이(가) 도망쳤습니다!`);
                this.addTurnLog(turnLog);
                this.finalizeTurn();
                // 도망쳤으므로 승리로 간주하고 보상 지급
                return this.endBattle(true, true);
            }
        }

        this.addTurnLog(turnLog);
        this.finalizeTurn();

        // 승패 판정
        if (this.tempObj.stat.monster.hp <= 0) {
            return this.endBattle(true);
        }

        return { success: true, log: this.getRecentLog() };
    }

    // 몬스터 턴
    monsterTurn() {
        if (!this.isActive) {
            return { success: false, message: '전투가 이미 종료되었습니다.' };
        }

        const turnLog = [];

        // 몬스터 DoT 처리 (출혈 등)
        const monsterDot = this._processStatusEffects('monster');
        if (monsterDot.length > 0) {
            turnLog.push(...monsterDot);
            if (this.tempObj.stat.monster.hp <= 0) {
                this.addTurnLog(turnLog);
                this.finalizeTurn();
                return this.endBattle(true);
            }
        }

        // 몬스터 스턴 체크
        if (this.tempObj.effects.monster.stunned) {
            turnLog.push(`💫 ${this.tempObj.name.monster}은(는) 행동불능 상태!`);
            this.addTurnLog(turnLog);
            this.finalizeTurn();
            return { success: true, log: this.getRecentLog() };
        }

        // 플레이어 회피 판정
        if (this._rollEvasion('player')) {
            turnLog.push(`${this.tempObj.name.player}이(가) 공격을 회피했습니다!`);
            this.addTurnLog(turnLog);
            this.finalizeTurn();
            return { success: true, log: this.getRecentLog() };
        }

        // 몬스터 데미지 계산
        let baseDamage = this._calculateAttackDamage('monster');
        const { isCrit, critMultiplier } = this._rollCritical('monster');

        let finalDamage = baseDamage;
        if (isCrit) {
            finalDamage = Math.floor(baseDamage * critMultiplier);
            turnLog.push(`💥 치명타!`);
        }

        // 피해 적용
        this._applyDamage('player', finalDamage);

        turnLog.push(`🔥 [${this.tempObj.name.monster}의 공격] ${finalDamage.toLocaleString()} 피해!`);
        turnLog.push(`   ${this.tempObj.name.player} HP: ${this.tempObj.stat.player.hp.toLocaleString()}/${this.tempObj.stat.player.maxHp.toLocaleString()}`);

        this.addTurnLog(turnLog);
        this.finalizeTurn();

        // 승패 판정
        if (this.tempObj.stat.player.hp <= 0) {
            return this.endBattle(false);
        }

        return { success: true, log: this.getRecentLog() };
    }

    // 플레이어 스킬 사용
    playerSkill(skillName) {
        if (!this.isActive) {
            return { success: false, message: '전투가 이미 종료되었습니다.' };
        }

        // 캐릭터의 스킬 매니저에서 스킬 확인
        if (!this.character.skillManager) {
            return { success: false, message: '스킬을 사용할 수 없습니다.' };
        }

        const skill = this.character.skillManager.getSkill(skillName);
        if (!skill) {
            return { success: false, message: `${skillName} 스킬을 보유하고 있지 않습니다.` };
        }

        if (skill.type === 'passive' || skill.type === 'awakeningPassive') {
            return { success: false, message: '패시브 스킬은 직접 사용할 수 없습니다.' };
        }

        if (!skill.isReady()) {
            return { success: false, message: `${skillName} 스킬이 쿨타임 중입니다. (${skill.cooldown}턴 남음)` };
        }

        // skills.json에서 스킬 상세 데이터 로드
        const jobType = this.character.job || this.character.jobType;
        const skillDetail = skillDataManager.getSkillDetail(jobType, skillName);

        // 자원 비용 확인 (GP/MP/HP)
        if (skillDetail && skillDetail.cost) {
            const costInfo = skillDataManager.getSkillCost(skillDetail, skill.level);
            if (costInfo) {
                const playerStat = this.tempObj.stat.player;
                if (costInfo.type === 'GP') {
                    const currentGp = playerStat.gp !== undefined ? playerStat.gp : 0;
                    if (currentGp < costInfo.amount) {
                        return { success: false, message: `GP가 부족합니다. (필요: ${costInfo.amount.toLocaleString()}, 보유: ${currentGp.toLocaleString()})` };
                    }
                    playerStat.gp = currentGp - costInfo.amount;
                } else if (costInfo.type === 'MP') {
                    const currentMp = playerStat.mp !== undefined ? playerStat.mp : 0;
                    if (currentMp < costInfo.amount) {
                        return { success: false, message: `MP가 부족합니다. (필요: ${costInfo.amount.toLocaleString()}, 보유: ${currentMp.toLocaleString()})` };
                    }
                    playerStat.mp = currentMp - costInfo.amount;
                } else if (costInfo.type === 'HP') {
                    const hpCost = Math.floor(playerStat.maxHp * costInfo.amount / 100);
                    if (playerStat.hp <= hpCost) {
                        return { success: false, message: `HP가 부족합니다. (필요: ${hpCost.toLocaleString()})` };
                    }
                    playerStat.hp -= hpCost;
                }
            }
        }

        this.turn++;
        const turnLog = [];
        turnLog.push(``);
        turnLog.push(`━ 턴 ${this.turn} ━`);

        const playerStat = this.tempObj.stat.player;

        // 스킬 데미지 계산
        if (skillDetail && skillDetail.damage) {
            const dmg = skillDetail.damage;
            const scaleStat = dmg.stat || 'power';
            const statValue = playerStat[scaleStat] || 0;
            // 공격력 = 스탯 * 100 (jobs.json 기준)
            const attackPower = statValue * 100;
            const percent = dmg.base + (dmg.perLevel || 0) * (skill.level - 1);
            const hits = dmg.hits || 1;

            // 지능 1당 스킬 데미지 0.3% 증가
            let intBonus = 1 + (playerStat.int * 0.003);
            if (this.character.skillManager) {
                const jobType = this.character.job || this.character.jobType;
                const passives = this.character.skillManager.getSkillsByType('passive').concat(this.character.skillManager.getSkillsByType('awakeningPassive'));
                for (const pSkill of passives) {
                    const pDetail = skillDataManager.getSkillDetail(jobType, pSkill.name);
                    if (pDetail && pDetail.effects && pDetail.effects.skillDamageBonus) {
                        const bonus = typeof pDetail.effects.skillDamageBonus === 'object' ? pDetail.effects.skillDamageBonus.base + (pDetail.effects.skillDamageBonus.perLevel || 0) * (pSkill.level - 1) : pDetail.effects.skillDamageBonus;
                        intBonus += (bonus / 100);
                    }
                }
            }

            let totalDamage = 0;
            let hitLog = [];

            for (let i = 0; i < hits; i++) {
                let hitDamage = Math.floor(attackPower * (percent / 100) * intBonus);
                // 약간의 랜덤성 (±5%)
                hitDamage = Math.floor(hitDamage * (0.95 + Math.random() * 0.1));

                // 크리티컬 판정
                const { isCrit, critMultiplier } = this._rollCritical('player');
                if (isCrit) {
                    hitDamage = Math.floor(hitDamage * critMultiplier);
                    hitLog.push(`💥 치명타!`);
                }

                // 회피 판정
                if (this._rollEvasion('monster')) {
                    hitLog.push(`${this.tempObj.name.monster}이(가) 회피!`);
                } else {
                    this._applyDamage('monster', hitDamage);
                    totalDamage += hitDamage;
                    if (hits > 1) {
                        hitLog.push(`   ${i + 1}타: ${hitDamage.toLocaleString()} 피해`);
                    }
                }
            }

            turnLog.push(`✨ [${this.tempObj.name.player}] ${skillName} 사용!`);
            turnLog.push(...hitLog);
            if (hits > 1) {
                turnLog.push(`   총 ${totalDamage.toLocaleString()} 피해!`);
            } else if (totalDamage > 0) {
                turnLog.push(`   ${totalDamage.toLocaleString()} 피해!`);
            }
            turnLog.push(`   ${this.tempObj.name.monster} HP: ${this.tempObj.stat.monster.hp.toLocaleString()}/${this.tempObj.stat.monster.maxHp.toLocaleString()}`);

            // 도망 기믹 체크
            if (this.monster.specialMechanic && this.monster.specialMechanic.type === 'escapeAtHp') {
                if (this.tempObj.stat.monster.hp <= this.monster.specialMechanic.threshold && this.tempObj.stat.monster.hp > 0) {
                    turnLog.push(`💨 ${this.tempObj.name.monster}: "${this.monster.specialMechanic.message || '도망친다!'}"`);
                    turnLog.push(`${this.tempObj.name.monster}이(가) 도망쳤습니다!`);
                    this.addTurnLog(turnLog);
                    this.finalizeTurn();
                    return this.endBattle(true, true);
                }
            }

            // 무력화 게이지 적용
            if (skillDetail.stagger && this.monster.staggerGauge) {
                this.monster.staggerGauge.current = Math.max(0, this.monster.staggerGauge.current - skillDetail.stagger);
                turnLog.push(`   무력화: -${skillDetail.stagger.toLocaleString()} (${this.monster.staggerGauge.current.toLocaleString()}/${this.monster.staggerGauge.max.toLocaleString()})`);
                if (this.monster.staggerGauge.current <= 0) {
                    turnLog.push(`   🔓 ${this.tempObj.name.monster} 무력화!`);
                    this.tempObj.effects.monster.stunned = 1;
                    this.monster.staggerGauge.current = this.monster.staggerGauge.max;
                }
            }
        } else if (skillDetail && skillDetail.buff) {
            // 버프 스킬 처리
            turnLog.push(`✨ [${this.tempObj.name.player}] ${skillName} 사용!`);
            const buff = skillDetail.buff;
            if (buff.type === 'atkUp') {
                const bonus = buff.atkBonus.base + (buff.atkBonus.perLevel || 0) * (skill.level - 1);
                const duration = typeof buff.duration === 'object' ? buff.duration.base + (buff.duration.perLevel || 0) * (skill.level - 1) : (buff.duration || 2);
                this.tempObj.effects.player.atkBuff = { percent: bonus, turns: duration };
                turnLog.push(`   공격력 +${bonus.toLocaleString()}% (${duration}턴)`);
            } else if (buff.type === 'evasionUp') {
                const bonus = buff.evasionBonus.base + (buff.evasionBonus.perLevel || 0) * (skill.level - 1);
                this.tempObj.effects.player.evasionBuff = { percent: bonus, turns: buff.duration || 2 };
                turnLog.push(`   회피율 +${bonus.toLocaleString()}% (${buff.duration || 2}턴)`);
            } else if (buff.type === 'skillDmgUp') {
                const bonus = buff.skillDmgBonus.base + (buff.skillDmgBonus.perLevel || 0) * (skill.level - 1);
                const duration = typeof buff.duration === 'object' ? buff.duration.base + (buff.duration.perLevel || 0) * (skill.level - 1) : (buff.duration || 2);
                this.tempObj.effects.player.skillDmgBuff = { percent: bonus, turns: duration };
                turnLog.push(`   스킬 데미지 +${bonus.toLocaleString()}% (${duration}턴)`);
            } else if (buff.type === 'critBuff') {
                const critChance = buff.critChance.base + (buff.critChance.perLevel || 0) * (skill.level - 1);
                const critDmg = buff.critDamage.base + (buff.critDamage.perLevel || 0) * (skill.level - 1);
                this.tempObj.effects.player.critBuff = { critChance, critDamage: critDmg, turns: buff.duration || 3 };
                turnLog.push(`   치명타 확률 +${critChance.toLocaleString()}%, 치명타 피해 +${critDmg.toLocaleString()}% (${buff.duration || 3}턴)`);
            } else if (buff.type === 'guaranteeCrit') {
                const bonus = buff.atkBonus ? buff.atkBonus.base + (buff.atkBonus.perLevel || 0) * (skill.level - 1) : 0;
                this.tempObj.effects.player.guaranteeCrit = { turns: buff.duration || 1, atkBonus: bonus };
                turnLog.push(`   다음 턴 치명타 확정! 공격력 +${bonus.toLocaleString()}%`);
            }
        } else if (skillDetail && skillDetail.cc) {
            // CC 스킬 처리
            turnLog.push(`✨ [${this.tempObj.name.player}] ${skillName} 사용!`);
            this.tempObj.effects.monster.stunned = skillDetail.cc.duration || 1;
            turnLog.push(`   ${this.tempObj.name.monster} ${skillDetail.cc.duration || 1}턴 행동불능!`);
        } else if (skillDetail && skillDetail.effects && skillDetail.effects.gainGunpower !== undefined) {
            // 건력 획득 스킬 (건마 마사지, 건마의 나침반 등)
            turnLog.push(`✨ [${this.tempObj.name.player}] ${skillName} 사용!`);
            const gain = skillDetail.effects.gainGunpower;
            playerStat.gunpower = Math.min((playerStat.gunpower || 0) + gain, playerStat.maxGunpower || 3);
            turnLog.push(`   건력 +${gain} (현재: ${playerStat.gunpower}/${playerStat.maxGunpower || 3})`);
            if (skillDetail.buff) {
                const buff = skillDetail.buff;
                const bonus = buff.atkBonus.base + (buff.atkBonus.perLevel || 0) * (skill.level - 1);
                this.tempObj.effects.player.atkBuff = { percent: bonus, turns: buff.duration || 3 };
                turnLog.push(`   공격력 +${bonus.toLocaleString()}% (${buff.duration || 3}턴)`);
            }
        } else {
            // 스킬 데이터가 없는 경우 기존 폴백 로직
            const mainStat = Math.max(playerStat.power, playerStat.speed, playerStat.int, playerStat.luck);
            const skillLevelMultiplier = 1 + (skill.level - 1) * 0.15;
            let baseDamage = Math.floor(mainStat * 20 * skillLevelMultiplier + Math.floor(Math.random() * (mainStat * 8)));
            let skillDamageBonus = 1 + (playerStat.int * 0.003);
            if (this.character.skillManager) {
                const jobType = this.character.job || this.character.jobType;
                const passives = this.character.skillManager.getSkillsByType('passive').concat(this.character.skillManager.getSkillsByType('awakeningPassive'));
                for (const pSkill of passives) {
                    const pDetail = skillDataManager.getSkillDetail(jobType, pSkill.name);
                    if (pDetail && pDetail.effects && pDetail.effects.skillDamageBonus) {
                        const bonus = typeof pDetail.effects.skillDamageBonus === 'object' ? pDetail.effects.skillDamageBonus.base + (pDetail.effects.skillDamageBonus.perLevel || 0) * (pSkill.level - 1) : pDetail.effects.skillDamageBonus;
                        skillDamageBonus += (bonus / 100);
                    }
                }
            }
            baseDamage = Math.floor(baseDamage * skillDamageBonus);

            const { isCrit, critMultiplier } = this._rollCritical('player');
            let finalDamage = baseDamage;
            if (isCrit) {
                finalDamage = Math.floor(baseDamage * critMultiplier);
                turnLog.push(`💥 치명타!`);
            }

            if (this._rollEvasion('monster')) {
                turnLog.push(`✨ [${this.tempObj.name.player}] ${skillName} 사용!`);
                turnLog.push(`${this.tempObj.name.monster}이(가) 회피했습니다!`);
            } else {
                this._applyDamage('monster', finalDamage);
                turnLog.push(`✨ [${this.tempObj.name.player}] ${skillName} 사용! ${finalDamage.toLocaleString()} 피해!`);
                turnLog.push(`   ${this.tempObj.name.monster} HP: ${this.tempObj.stat.monster.hp.toLocaleString()}/${this.tempObj.stat.monster.maxHp.toLocaleString()}`);

                // 도망 기믹 체크
                if (this.monster.specialMechanic && this.monster.specialMechanic.type === 'escapeAtHp') {
                    if (this.tempObj.stat.monster.hp <= this.monster.specialMechanic.threshold && this.tempObj.stat.monster.hp > 0) {
                        turnLog.push(`💨 ${this.tempObj.name.monster}: "${this.monster.specialMechanic.message || '도망친다!'}"`);
                        turnLog.push(`${this.tempObj.name.monster}이(가) 도망쳤습니다!`);

                        // 스킬 쿨타임 설정
                        const cooldown = skillDetail ? skillDataManager.getSkillCooldown(skillDetail, skill.level) : (skill.maxCooldown || 0);
                        if (cooldown > 0) {
                            skill.maxCooldown = cooldown;
                            skill.resetCooldown();
                        }

                        this.addTurnLog(turnLog);
                        this.finalizeTurn();
                        return this.endBattle(true, true);
                    }
                }
            }
        }

        // 스킬 쿨타임 설정
        const cooldown = skillDetail ? skillDataManager.getSkillCooldown(skillDetail, skill.level) : (skill.maxCooldown || 0);
        if (cooldown > 0) {
            skill.maxCooldown = cooldown;
            skill.resetCooldown();
        }

        this.addTurnLog(turnLog);
        this.finalizeTurn();

        // 승패 판정
        if (this.tempObj.stat.monster.hp <= 0) {
            return this.endBattle(true);
        }

        return { success: true, log: this.getRecentLog() };
    }

    // 플레이어 아이템 사용
    playerUseItem(itemName) {
        if (!this.isActive) {
            return { success: false, message: '전투가 이미 종료되었습니다.' };
        }

        // 인벤토리에서 아이템 확인
        if (!this.character.inventory || !this.character.inventory.hasConsumable(itemName)) {
            return { success: false, message: `${itemName}을(를) 보유하고 있지 않습니다.` };
        }

        // 아이템 데이터 확인
        const itemData = itemManager.findItemByName(itemName);
        if (!itemData) {
            return { success: false, message: `${itemName}은(는) 존재하지 않는 아이템입니다.` };
        }

        const turnLog = [];
        turnLog.push(``);

        const effects = itemData.effects || {};

        // 체력 회복 물약
        if (effects.hpRecover) {
            const prevHp = this.tempObj.stat.player.hp;
            this.tempObj.stat.player.hp = Math.min(
                this.tempObj.stat.player.hp + effects.hpRecover,
                this.tempObj.stat.player.maxHp
            );
            const healed = this.tempObj.stat.player.hp - prevHp;
            turnLog.push(`💊 ${itemName} 사용! HP +${healed.toLocaleString()} 회복`);
            turnLog.push(`   ${this.tempObj.name.player} HP: ${this.tempObj.stat.player.hp.toLocaleString()}/${this.tempObj.stat.player.maxHp.toLocaleString()}`);
        } else if (effects.hpRecoverPercent) {
            const prevHp = this.tempObj.stat.player.hp;
            const healAmount = Math.floor(this.tempObj.stat.player.maxHp * effects.hpRecoverPercent / 100);
            this.tempObj.stat.player.hp = Math.min(
                this.tempObj.stat.player.hp + healAmount,
                this.tempObj.stat.player.maxHp
            );
            const healed = this.tempObj.stat.player.hp - prevHp;
            turnLog.push(`💊 ${itemName} 사용! HP +${healed.toLocaleString()} 회복`);
            turnLog.push(`   ${this.tempObj.name.player} HP: ${this.tempObj.stat.player.hp.toLocaleString()}/${this.tempObj.stat.player.maxHp.toLocaleString()}`);
        } else if (effects.stunGauge) {
            // 회오리폭탄 등 무력화 아이템
            turnLog.push(`💣 ${itemName} 사용! 무력화 게이지 ${effects.stunGauge.toLocaleString()} 적용!`);
        } else if (effects.breakLevel) {
            // 파괴폭탄
            turnLog.push(`💣 ${itemName} 사용! 파괴 레벨 ${effects.breakLevel} 적용!`);
        } else {
            turnLog.push(`📦 ${itemName}을(를) 사용했습니다.`);
        }

        // 인벤토리에서 소모
        this.character.inventory.consumeItem(itemName, 1);

        this.addTurnLog(turnLog);
        this.finalizeTurn();

        return { success: true, log: this.getRecentLog() };
    }

    // 플레이어 도망
    playerEscape() {
        if (!this.isActive) {
            return { success: false, message: '전투가 이미 종료되었습니다.' };
        }

        const turnLog = [];
        turnLog.push(``);

        // 도망 확률: 기본 40% + (플레이어속도 - 몬스터속도) * 5%
        const speedDiff = this.tempObj.stat.player.speed - this.tempObj.stat.monster.speed;
        const escapeChance = Math.min(Math.max(40 + speedDiff * 5, 10), 90);
        const escaped = Math.random() * 100 < escapeChance;

        if (escaped) {
            turnLog.push(`🏃 도망에 성공했습니다!`);
            this.isActive = false;
            this.escaped = true;

            // tempObj 상태를 원본 객체에 동기화
            this.character.hp.current = this.tempObj.stat.player.hp;
            this.monster.hp.current = this.tempObj.stat.monster.hp;

            this.addTurnLog(turnLog);
            this.finalizeTurn();

            return { success: true, escaped: true, log: this.getRecentLog() };
        } else {
            turnLog.push(`🏃 도망에 실패했습니다!`);
            this.addTurnLog(turnLog);
            this.finalizeTurn();

            return { success: true, escaped: false, log: this.getRecentLog() };
        }
    }

    // ==================== 유틸리티 ====================

    // 최근 3턴 로그만 반환
    getRecentLog() {
        const initLog = this.tempObj.logs.slice(0, 5); // 전투 시작 메시지
        const recentTurns = this.turnLogs.slice(-3); // 최근 3턴
        const flatRecent = recentTurns.flat();
        return [...initLog, ...flatRecent];
    }
    
    // 턴 로그 기록
    addTurnLog(messages) {
        this.currentTurnLog.push(...messages);
    }
    
    // 턴 종료 시 호출
    finalizeTurn() {
        if (this.currentTurnLog.length > 0) {
            this.turnLogs.push([...this.currentTurnLog]);
            this.currentTurnLog = [];
        }

        // 버프/디버프 지속시간 감소
        for (const side of ['player', 'monster']) {
            const eff = this.tempObj.effects[side];
            for (const key of Object.keys(eff)) {
                if (key === 'stunned') {
                    eff.stunned = Math.max(0, (eff.stunned || 0) - 1);
                    if (eff.stunned <= 0) delete eff.stunned;
                } else if (eff[key] && typeof eff[key] === 'object' && eff[key].turns !== undefined) {
                    eff[key].turns--;
                    if (eff[key].turns <= 0) delete eff[key];
                }
            }
        }

        // 모든 액티브 스킬 쿨타임 감소
        if (this.character.skillManager) {
            for (let skill of this.character.skillManager.skills.values()) {
                if (skill.cooldown > 0) {
                    skill.reduceCooldown(1);
                }
            }
        }
    }

    // 전투 종료
    endBattle(playerWon, isMonsterEscaped = false) {
        this.isActive = false;
        const endLog = [];
        endLog.push(``);
        
        if (playerWon) {
            if (isMonsterEscaped) {
                endLog.push(`✅ 승리!`);
                endLog.push(`${this.tempObj.name.monster}이(가) 도망가서 전투가 종료되었습니다.`);
            } else {
                endLog.push(`✅ 승리!`);
                endLog.push(`${this.tempObj.name.monster}을(를) 처치했습니다!`);
            }
            
            // 보상 계산
            const collectedRewards = { exp: 0, gold: 0, items: [] };
            const dungeonRewards = this.dungeon ? this.dungeon.rewards : null;
            const monsterRewards = this.monster.rewards;
            
            endLog.push(``);
            endLog.push(`[ 보상 ]`);
            
            // 경험치 (던전 > 몬스터)
            const exp = (dungeonRewards && dungeonRewards.exp) || monsterRewards.exp || 0;
            if (exp > 0) {
                collectedRewards.exp = exp;
                endLog.push(`• 경험치: +${exp.toLocaleString()}`);
            }
            
            // 골드 (던전: min~max 범위 / 몬스터: 고정)
            let gold = 0;
            if (dungeonRewards && dungeonRewards.gold) {
                const g = dungeonRewards.gold;
                gold = typeof g === 'object' ? g.min + Math.floor(Math.random() * (g.max - g.min + 1)) : g;
            } else if (monsterRewards.gold) {
                gold = monsterRewards.gold;
            }
            if (gold > 0) {
                collectedRewards.gold = gold;
                endLog.push(`• 골드: +${gold.toLocaleString()}`);
            }
            
            // 장비 슬롯 드랍 (dungeons.json의 slots)
            if (dungeonRewards && dungeonRewards.slots) {
                for (const slot of dungeonRewards.slots) {
                    if (Math.random() * 100 < slot.chance) {
                        // 가중치 랜덤 픽
                        const roll = Math.random() * 100;
                        let cumulative = 0;
                        let pickedItem = null;
                        for (const item of slot.items) {
                            cumulative += item.chance;
                            if (roll < cumulative) { pickedItem = item; break; }
                        }
                        if (!pickedItem) pickedItem = slot.items[slot.items.length - 1];
                        
                        if (pickedItem) {
                            // name이 있으면 특정 장비, 없으면 등급+레벨 풀에서 랜덤
                            let equipName = pickedItem.name;
                            if (!equipName) {
                                const randomEquip = equipmentManager.getRandomEquipmentByRarityAndLevel(pickedItem.rarity, pickedItem.level);
                                equipName = randomEquip ? randomEquip.name : `[${pickedItem.rarity}] Lv.${pickedItem.level} 장비`;
                            }
                            collectedRewards.items.push({ name: equipName, type: 'equipment', rarity: pickedItem.rarity, level: pickedItem.level, isEquipment: true });
                            endLog.push(`• 장비: [${pickedItem.rarity}] ${equipName} 획득!`);
                        }
                    }
                }
            }
            
            // 고정 드랍 (fixed)
            if (dungeonRewards && dungeonRewards.fixed) {
                for (const fix of dungeonRewards.fixed) {
                    const count = fix.min + Math.floor(Math.random() * (fix.max - fix.min + 1));
                    if (count > 0) {
                        collectedRewards.items.push({ name: fix.name, count });
                        endLog.push(`• ${fix.name} x${count.toLocaleString()}`);
                    }
                }
            }
            
            // 보너스 드랍 (bonus)
            if (dungeonRewards && dungeonRewards.bonus) {
                for (const bon of dungeonRewards.bonus) {
                    if (Math.random() * 100 < bon.chance) {
                        collectedRewards.items.push({ name: bon.name, count: bon.count });
                        endLog.push(`• 🔷 ${bon.name} x${bon.count.toLocaleString()}`);
                    }
                }
            }
            
            // 글로벌 독립 드랍 (봉인된 자물쇠 8%, 피로 회복의 정수 4%, etc.)
            const globalDrops = [
                { name: '봉인된 자물쇠', chance: 8, count: 1 },
                { name: '피로 회복의 정수', chance: 4, count: 1 },
                { name: '희석된 경화제', chance: 5, count: 1 }
            ];
            for (const gd of globalDrops) {
                if (Math.random() * 100 < gd.chance) {
                    collectedRewards.items.push({ name: gd.name, count: gd.count });
                    endLog.push(`• 🌟 ${gd.name} x${gd.count.toLocaleString()}`);
                }
            }
            
            this.addTurnLog(endLog);
            this.finalizeTurn();
            
            // tempObj 상태를 원본 객체에 동기화
            this.character.hp.current = this.tempObj.stat.player.hp;
            this.monster.hp.current = this.tempObj.stat.monster.hp;
            
            return {
                success: true,
                victory: true,
                rewards: collectedRewards,
                log: this.getRecentLog()
            };
        } else {
            if (isMonsterEscaped) {
                endLog.push(`전투가 종료되었습니다.`);
            } else {
                endLog.push(`💀 패배...`);
                endLog.push(`${this.tempObj.name.player}이(가) 쓰러졌습니다.`);
            }
            
            this.addTurnLog(endLog);
            this.finalizeTurn();
            
            // tempObj 상태를 원본 객체에 동기화
            this.character.hp.current = this.tempObj.stat.player.hp;
            this.monster.hp.current = this.tempObj.stat.monster.hp;
            
            return {
                success: true,
                victory: false,
                escaped: isMonsterEscaped,
                log: this.getRecentLog()
            };
        }
    }

    // 전투 상태 반환 (new_engine.js에서 사용하는 형식)
    getBattleStatus() {
        return {
            turn: this.turn,
            isActive: this.isActive,
            isPlayerTurn: this.isPlayerTurn,
            character: {
                name: this.tempObj.name.player,
                hp: this.tempObj.stat.player.hp,
                maxHp: this.tempObj.stat.player.maxHp
            },
            monster: {
                name: this.tempObj.name.monster,
                hp: this.tempObj.stat.monster.hp,
                maxHp: this.tempObj.stat.monster.maxHp
            },
            tempObj: this.tempObj,
            log: this.getRecentLog()
        };
    }
}

// ==================== 내보내기 ====================
module.exports = {
    RPGJobManager,
    jobManager,
    RPGEquipmentDataManager,
    equipmentManager,
    RPGItemDataManager,
    itemManager,
    RPGCraftingManager,
    craftingManager,
    RPGFishingManager,
    fishingManager,
    RPGTrophyManager,
    trophyManager,
    RPGShopManager,
    shopManager,
    RPGAchievementManager,
    achievementManager,
    RPGPetManager,
    petManager,
    RPGGachaManager,
    gachaManager,
    RPGTradeManager,
    tradeManager,
    RPGSeasonPassManager,
    seasonPassManager,
    RPGDungeonManager,
    dungeonManager,
    RPGMonsterManager,
    monsterManager,
    RPGStats,
    RPGResource,
    RPGLevel,
    RPGSkill,
    RPGSkillManager,
    RPGSkillDataManager,
    skillDataManager,
    RPGEquipment,
    RPGEquipmentManager,
    RPGConsumableItem,
    RPGInventory,
    RPGAwakening,
    RPGCombatCalculator,
    RPGMonster,
    RPGBattle
};
