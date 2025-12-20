// ==================== 캡슐화된 RPGUser 클래스 ====================
// 기존 RPGUser 클래스를 교체하여 사용하세요.

// RPG 시스템 모듈 불러오기
const { jobManager, equipmentManager } = require('./rpg_system.js');

class RPGUser {
    constructor(name, id, owner) {
        this._get = 0;
        this.redacted = false;
        this.id = id;
        this.ownerId = owner;
        this.name = name;
        this.isAdmin = false;
        this.job = null;
        
        // 캡슐화된 시스템들
        this.stats = new RPGStats();                    // 스탯 시스템
        this.level = new RPGLevel();                    // 레벨 시스템
        this.skillManager = null;                       // 스킬 매니저 (직업 설정 후 초기화)
        this.equipmentManager = new RPGEquipmentManager(); // 장비 매니저
        this.inventory = new RPGInventory();            // 인벤토리
        this.awakening = new RPGAwakening();            // 각성 시스템
        
        // HP 시스템
        this.hp = new RPGResource('hp', 0, 0);
        
        // 직업별 리소스
        this.gpResource = new RPGResource('gp', 0, 0);        // 성준호
        this.mpResource = new RPGResource('mp', 0, 0);        // 빵귤
        this.gunpowerResource = new RPGResource('gunpower', 0, 0); // 건마
        
        // 기타
        this.sp = 0; // 스킬 포인트
    }

    // 데이터 로드
    load(data) {
        this._get = data._get || 0;
        this.redacted = data.redacted || false;
        this.id = data.id;
        this.ownerId = data.ownerId;
        this.name = data.name;
        this.isAdmin = data.isAdmin || false;
        this.job = data.job;
        this.sp = data.sp || 0;
        
        // 시스템 로드
        if (data.stats) this.stats.load(data.stats);
        if (data.level) this.level.load(data.level);
        if (data.skillManager) {
            this.skillManager = new RPGSkillManager(this.job);
            this.skillManager.load(data.skillManager);
        }
        if (data.equipmentManager) this.equipmentManager.load(data.equipmentManager);
        if (data.inventory) this.inventory.load(data.inventory);
        if (data.awakening) this.awakening.load(data.awakening);
        if (data.hp) this.hp.load(data.hp);
        if (data.gpResource) this.gpResource.load(data.gpResource);
        if (data.mpResource) this.mpResource.load(data.mpResource);
        if (data.gunpowerResource) this.gunpowerResource.load(data.gunpowerResource);
        
        return this;
    }

    // JSON 변환
    toJSON() {
        return {
            _get: this._get,
            redacted: this.redacted,
            id: this.id,
            ownerId: this.ownerId,
            name: this.name,
            isAdmin: this.isAdmin,
            job: this.job,
            sp: this.sp,
            stats: this.stats.toJSON(),
            level: this.level.toJSON(),
            skillManager: this.skillManager ? this.skillManager.toJSON() : null,
            equipmentManager: this.equipmentManager.toJSON(),
            inventory: this.inventory.toJSON(),
            awakening: this.awakening.toJSON(),
            hp: this.hp.toJSON(),
            gpResource: this.gpResource.toJSON(),
            mpResource: this.mpResource.toJSON(),
            gunpowerResource: this.gunpowerResource.toJSON()
        };
    }

    toString() {
        return `[RPGUser ${this.name} Lv.${this.level.level} ${this.job}]`;
    }

    async save() {
        await updateItem('rpg_user', this.id, this.toJSON());
    }

    // ==================== 직업 설정 ====================
    setJob(jobType) {
        // 직업 유효성 검사
        if (!jobManager.isValidJob(jobType)) {
            const validJobs = jobManager.getAllJobs().join(', ');
            throw new Error(`유효하지 않은 직업: ${jobType} (가능한 직업: ${validJobs})`);
        }
        
        this.job = jobType;
        
        // jobs.json에서 직업 정보 로드
        const initialStats = jobManager.getJobInitialStats(jobType);
        const initialHp = jobManager.getJobInitialHp(jobType);
        const resources = jobManager.getJobResources(jobType);
        
        // 스탯 설정
        this.stats = new RPGStats(
            initialStats.power,
            initialStats.speed,
            initialStats.int,
            initialStats.luck
        );
        
        // HP 설정
        this.hp.setMax(initialHp);
        this.hp.add(initialHp); // HP 풀로 채우기
        
        // 리소스 설정
        if (resources.gp) {
            this.gpResource.setMax(resources.gp);
            this.gpResource.add(resources.gp);
        }
        if (resources.mp !== undefined) {
            this.mpResource.setMax(resources.mp);
            this.mpResource.add(resources.mp);
        }
        if (resources.gunpower) {
            this.gunpowerResource.setMax(resources.gunpower);
            this.gunpowerResource.add(resources.gunpower);
        }
        
        // 스킬 매니저 초기화 (jobs.json의 initialSkills 사용)
        this.skillManager = new RPGSkillManager(jobType);
    }

    // ==================== 레벨업 시스템 ====================
    gainExp(amount) {
        const result = this.level.addExp(amount);
        
        if (result.leveledUp) {
            // 레벨업 시 처리
            result.levels.forEach(newLevel => {
                this.sp++; // 스킬 포인트 획득
                this.increaseHpByLevel();
                this.unlockSkillsByLevel(newLevel);
            });
            
            // 레벨 50 달성 시 각성 가능
            if (this.level.level >= 50 && !this.awakening.isAwakened) {
                result.canAwaken = true;
            }
        }
        
        return result;
    }

    increaseHpByLevel() {
        // jobs.json에서 레벨당 HP 증가량 로드
        const hpGain = jobManager.getJobHpPerLevel(this.job);
        this.hp.setMax(this.hp.max + hpGain);
        this.hp.add(hpGain); // 레벨업 시 HP 전체 회복
    }

    unlockSkillsByLevel(level) {
        // jobs.json에서 해당 레벨의 해금 스킬 로드
        const unlockSkill = jobManager.getJobLevelUnlockSkills(this.job, level);
        
        if (unlockSkill) {
            this.skillManager.unlockSkill(unlockSkill.name, unlockSkill.type);
        }
    }

    // ==================== 각성 시스템 ====================
    awaken() {
        if (this.level.level < 50) {
            return { success: false, message: '레벨 50을 달성해야 각성할 수 있습니다.' };
        }
        
        const result = this.awakening.awaken();
        if (result.success) {
            this.unlockAwakenSkills();
        }
        return result;
    }

    unlockAwakenSkills() {
        // jobs.json에서 각성 스킬 로드
        const awakenSkills = jobManager.getJobAwakenSkills(this.job);
        
        awakenSkills.forEach(skill => {
            this.skillManager.unlockSkill(skill.name, skill.type);
        });
    }

    gainAwakenExp(amount) {
        return this.awakening.addExp(amount);
    }

    investAP(bonusType, amount) {
        return this.awakening.investAP(bonusType, amount);
    }

    // ==================== 스탯 시스템 ====================
    increaseStat(statName, amount) {
        return this.stats.increase(statName, amount);
    }

    // ==================== 스킬 시스템 ====================
    learnSkill(skillName, skillType) {
        return this.skillManager.unlockSkill(skillName, skillType);
    }

    levelUpSkill(skillName) {
        if (this.sp <= 0) {
            return { success: false, message: 'SP가 부족합니다.' };
        }
        
        const result = this.skillManager.levelUpSkill(skillName);
        if (result.success) {
            this.sp--;
        }
        return result;
    }

    getSkill(skillName) {
        return this.skillManager.getSkill(skillName);
    }

    // ==================== 장비 시스템 ====================
    equipItem(slot, equipment) {
        return this.equipmentManager.equip(slot, equipment);
    }

    unequipItem(slot) {
        return this.equipmentManager.unequip(slot);
    }

    getEquippedItem(slot) {
        return this.equipmentManager.getEquipped(slot);
    }

    // ==================== 인벤토리 시스템 ====================
    addItemToInventory(item) {
        return this.inventory.addItem(item);
    }

    removeItemFromInventory(itemId) {
        return this.inventory.removeItem(itemId);
    }

    findItemInInventory(itemId) {
        return this.inventory.findItem(itemId);
    }

    // ==================== 리소스 관리 ====================
    addGP(amount) {
        if (this.job !== '성준호') {
            return { success: false, message: 'GP는 성준호 전용 리소스입니다.' };
        }
        return this.gpResource.add(amount);
    }

    consumeGP(amount) {
        if (this.job !== '성준호') {
            return { success: false, message: 'GP는 성준호 전용 리소스입니다.' };
        }
        return this.gpResource.consume(amount);
    }

    addMP(amount) {
        if (this.job !== '빵귤') {
            return { success: false, message: 'MP는 빵귤 전용 리소스입니다.' };
        }
        return this.mpResource.add(amount);
    }

    consumeMP(amount) {
        if (this.job !== '빵귤') {
            return { success: false, message: 'MP는 빵귤 전용 리소스입니다.' };
        }
        return this.mpResource.consume(amount);
    }

    addGunpower(amount) {
        if (this.job !== '건마') {
            return { success: false, message: '건력은 건마 전용 리소스입니다.' };
        }
        return this.gunpowerResource.add(amount);
    }

    consumeGunpower(amount) {
        if (this.job !== '건마') {
            return { success: false, message: '건력은 건마 전용 리소스입니다.' };
        }
        return this.gunpowerResource.consume(amount);
    }

    // HP 관리
    takeDamage(amount) {
        return this.hp.consume(amount);
    }

    heal(amount) {
        return this.hp.add(amount);
    }

    // ==================== 전투 스탯 계산 ====================
    getMainStat() {
        // jobs.json에서 주 스탯 가져오기
        const mainStatName = jobManager.getJobMainStat(this.job);
        return this.stats[mainStatName] || 0;
    }

    getAttackPower() {
        const mainStat = this.getMainStat();
        const equipStats = this.equipmentManager.getTotalStats();
        const baseAttack = RPGCombatCalculator.calculateAttackPower(mainStat);
        const equipBonus = equipStats.attackPower || 0;
        return baseAttack + equipBonus;
    }

    getCritChance() {
        const awakenBonus = this.awakening.isAwakened ? this.awakening.bonuses.crit : 0;
        const equipStats = this.equipmentManager.getTotalStats();
        const equipBonus = equipStats.critChance || 0;
        return RPGCombatCalculator.calculateCritChance(this.stats.luck, awakenBonus) + equipBonus;
    }

    getCritDamage() {
        const awakenBonus = this.awakening.isAwakened ? this.awakening.bonuses.critMul : 0;
        const equipStats = this.equipmentManager.getTotalStats();
        const equipBonus = equipStats.critDamage || 0;
        return RPGCombatCalculator.calculateCritDamage(150, awakenBonus) + equipBonus;
    }

    getEvasion() {
        const equipStats = this.equipmentManager.getTotalStats();
        const equipBonus = equipStats.evasion || 0;
        return RPGCombatCalculator.calculateEvasion(this.stats.speed) + equipBonus;
    }

    // ==================== 캐릭터 정보 ====================
    getCharacterInfo() {
        const info = [];
        info.push(`━━━━━━━━━━━━━━━`);
        info.push(`👤 ${this.name} [${this.job}]`);
        info.push(`📊 Lv.${this.level.level} (${this.level.exp}/${this.level.getRequiredExp()})`);
        info.push(`❤️ HP: ${this.hp.current}/${this.hp.max}`);
        info.push(``);
        info.push(`⚔️ 스탯`);
        info.push(`  힘: ${this.stats.power} / 속도: ${this.stats.speed}`);
        info.push(`  지능: ${this.stats.int} / 행운: ${this.stats.luck}`);
        info.push(``);
        info.push(`💪 공격력: ${this.getAttackPower()}`);
        info.push(`🎯 치명타: ${this.getCritChance().toFixed(1)}% (${this.getCritDamage().toFixed(0)}%)`);
        info.push(`🏃 회피율: ${this.getEvasion().toFixed(1)}%`);
        
        // 리소스 표시
        if (this.job === '성준호') {
            info.push(`⚡ GP: ${this.gpResource.current}/${this.gpResource.max}`);
        } else if (this.job === '빵귤') {
            info.push(`✨ MP: ${this.mpResource.current}`);
        } else if (this.job === '건마') {
            info.push(`🔫 건력: ${this.gunpowerResource.current}/${this.gunpowerResource.max}`);
        }
        
        if (this.awakening.isAwakened) {
            info.push(``);
            info.push(`🌟 각성 Lv.${this.awakening.level} (AP: ${this.awakening.ap})`);
        }
        
        info.push(`━━━━━━━━━━━━━━━`);
        
        return info.join('\n');
    }

    getSkillInfo() {
        if (!this.skillManager) {
            return '스킬 정보가 없습니다.';
        }
        
        const info = [];
        info.push(`━━━━ 스킬 목록 ━━━━`);
        
        const passiveSkills = this.skillManager.getSkillsByType('passive');
        if (passiveSkills.length > 0) {
            info.push(`\n[패시브]`);
            passiveSkills.forEach(skill => {
                info.push(`• ${skill.name} (Lv.${skill.level})`);
            });
        }
        
        const activeSkills = this.skillManager.getSkillsByType('active');
        if (activeSkills.length > 0) {
            info.push(`\n[액티브]`);
            activeSkills.forEach(skill => {
                const cooldownInfo = skill.isReady() ? '사용가능' : `쿨타임 ${skill.cooldown}턴`;
                info.push(`• ${skill.name} (Lv.${skill.level}) - ${cooldownInfo}`);
            });
        }
        
        const awakenSkills = this.skillManager.getSkillsByType('awakening');
        if (awakenSkills.length > 0) {
            info.push(`\n[각성 스킬]`);
            awakenSkills.forEach(skill => {
                const cooldownInfo = skill.isReady() ? '사용가능' : `쿨타임 ${skill.cooldown}턴`;
                info.push(`• ${skill.name} (Lv.${skill.level}) - ${cooldownInfo}`);
            });
        }
        
        info.push(`\n━━━━━━━━━━━━━━━`);
        info.push(`SP: ${this.sp}`);
        
        return info.join('\n');
    }
}

// ==================== 사용 예시 ====================
/*
// 캐릭터 생성
const character = new RPGUser("홍길동", "char_001", "owner_001");
character.setJob('먼마');

// 경험치 획득
const expResult = character.gainExp(1000);
if (expResult.leveledUp) {
    console.log(`레벨업! 현재 레벨: ${expResult.currentLevel}`);
}

// 스탯 증가
character.increaseStat('power', 5);

// 스킬 레벨업
character.levelUpSkill('주먹강화');

// 장비 장착
const weapon = new RPGEquipment('weapon_001', '무쇠의 건틀릿', 'weapon', '레전더리', 20, {
    power: 8,
    attackPower: 100,
    critDamage: 15
});
character.equipItem('weapon', weapon);

// 각성
if (character.level.level >= 50) {
    character.awaken();
}

// 캐릭터 정보 출력
console.log(character.getCharacterInfo());
console.log(character.getSkillInfo());

// 저장
await character.save();
*/
