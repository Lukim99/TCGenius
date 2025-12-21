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
        if (currentEnhancement < 0 || currentEnhancement >= 15) {
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
            14: { great: 0, success: 0.7, downgrade: 19.3, reset: 80 }
        };

        const rates = enhancementTable[currentEnhancement];
        const roll = Math.random() * 100;

        let newEnhancement = currentEnhancement;
        let result = 'fail';

        if (roll < rates.great) {
            // 대성공: +2강
            result = 'great';
            newEnhancement = Math.min(currentEnhancement + 2, 15);
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

    // 강화에 따른 무기 공격력 증가 계산 (%)
    getWeaponEnhancementBonus(enhancement) {
        // 강화마다 공격력 증가 (예: 1강당 3%)
        return enhancement * 3;
    }

    // 강화에 따른 방어구 체력 증가 계산 (상수값)
    getArmorEnhancementBonus(enhancement, baseHp) {
        // 강화마다 체력 증가 (예: 기본 HP의 5%씩)
        return Math.floor(baseHp * 0.05 * enhancement);
    }

    // 증폭에 따른 주스탯 증가 (10증폭부터)
    getAmplificationStatBonus(amplification) {
        if (amplification < 10) return 0;
        return amplification - 9; // 10증폭 = +1, 11증폭 = +2, 12증폭 = +3
    }
}

// 전역 EquipmentDataManager 인스턴스
const equipmentManager = new RPGEquipmentDataManager();

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
        this.enhancement = 0;       // 강화 수치 (0~15)
        this.amplification = 0;     // 증폭 수치 (0~12, 방어구용)
        this.isAmplified = false;   // 증폭 여부 (증폭서 사용 시 true)
    }

    load(data) {
        Object.assign(this, data);
        return this;
    }

    // 강화 적용 (무기용)
    applyEnhancement(enhancement) {
        this.enhancement = Math.max(0, Math.min(enhancement, 15));
    }

    // 증폭 적용 (방어구용)
    applyAmplification(amplification) {
        this.amplification = Math.max(0, Math.min(amplification, 12));
        this.isAmplified = true;
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
            isAmplified: this.isAmplified
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

// 8. 인벤토리 시스템
class RPGInventory {
    constructor(maxSize = 100) {
        this.items = [];
        this.maxSize = maxSize;
    }

    load(data) {
        this.items = data.items || [];
        this.maxSize = data.maxSize || 100;
        return this;
    }

    addItem(item) {
        if (this.items.length >= this.maxSize) {
            return { success: false, message: '인벤토리가 가득 찼습니다.' };
        }
        this.items.push(item);
        return { success: true, message: `${item.name}을(를) 획득했습니다.` };
    }

    removeItem(itemId) {
        const index = this.items.findIndex(item => item.id === itemId);
        if (index === -1) {
            return { success: false, message: '아이템을 찾을 수 없습니다.' };
        }
        const item = this.items.splice(index, 1)[0];
        return { success: true, item, message: `${item.name}을(를) 제거했습니다.` };
    }

    findItem(itemId) {
        return this.items.find(item => item.id === itemId);
    }

    getItemCount() {
        return this.items.length;
    }

    isFull() {
        return this.items.length >= this.maxSize;
    }

    toJSON() {
        return {
            items: this.items,
            maxSize: this.maxSize
        };
    }
}

// 9. 각성 시스템
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

// 10. 전투 스탯 계산기
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

// 11. 몬스터 시스템
class RPGMonster {
    constructor(name, level, type = 'seed') {
        this.name = name;
        this.level = level;
        this.type = type;       // 'seed', 'named', 'boss'
        this.hp = 0;
        this.maxHp = 0;
        this.attackPower = 0;
        this.defense = 0;
        this.exp = 0;
        this.neutralizeGauge = 0;   // 무력화 게이지
        this.maxNeutralizeGauge = 0;
        this.isNeutralized = false; // 무력화 상태
        this.drops = [];            // 드랍 아이템
    }

    load(data) {
        Object.assign(this, data);
        return this;
    }

    takeDamage(damage) {
        this.hp = Math.max(0, this.hp - damage);
        return {
            success: true,
            damage,
            remainingHp: this.hp,
            isDead: this.hp <= 0
        };
    }

    addNeutralize(amount) {
        this.neutralizeGauge = Math.min(this.neutralizeGauge + amount, this.maxNeutralizeGauge);
        if (this.neutralizeGauge >= this.maxNeutralizeGauge) {
            this.isNeutralized = true;
            return { success: true, neutralized: true };
        }
        return { success: true, neutralized: false, gauge: this.neutralizeGauge };
    }

    resetNeutralize() {
        this.neutralizeGauge = 0;
        this.isNeutralized = false;
    }

    isDead() {
        return this.hp <= 0;
    }

    toJSON() {
        return {
            name: this.name,
            level: this.level,
            type: this.type,
            hp: this.hp,
            maxHp: this.maxHp,
            attackPower: this.attackPower,
            defense: this.defense,
            exp: this.exp,
            neutralizeGauge: this.neutralizeGauge,
            maxNeutralizeGauge: this.maxNeutralizeGauge,
            isNeutralized: this.isNeutralized,
            drops: this.drops
        };
    }
}

// ==================== 내보내기 ====================
module.exports = {
    RPGJobManager,
    jobManager,
    RPGEquipmentDataManager,
    equipmentManager,
    RPGStats,
    RPGResource,
    RPGLevel,
    RPGSkill,
    RPGSkillManager,
    RPGEquipment,
    RPGEquipmentManager,
    RPGInventory,
    RPGAwakening,
    RPGCombatCalculator,
    RPGMonster
};
