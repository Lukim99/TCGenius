// TCG 시스템 모듈
const fs = require('fs');
const crypto = require('crypto');

// TCG 관련 유틸리티 함수들
function numberWithCommas(x) {
    return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function getRandomString(len) {
    const chars = '023456789ABCDEFGHJKLMNOPQRSTUVWXTZabcdefghikmnopqrstuvwxyz';
    const stringLength = len;
    let randomstring = '';
    for (let i = 0; i < stringLength; i++) {
        const rnum = Math.floor(Math.random() * chars.length);
        randomstring += chars.substring(rnum, rnum + 1);
    }
    return randomstring;
}

Date.prototype.toYYYYMMDD = function() {
    return this.getFullYear() + (this.getMonth() + 1).toString().padStart(2, '0') + this.getDay().toString().padStart(2, '0');
};

// TCGUser 클래스
function TCGUser(name, id) {
    this._get = 1;
    this.id = id;
    this.name = name;
    this.isAdmin = false;
    this.code = getRandomString(10).toUpperCase();
    this.logged_in = [id];
    this.gold = 0;
    this.garnet = 0;
    this.p = 0;
    this.attendance = {
        last: null,
        streak: 0,
        total: 0
    }
    this.deck = {
        content: [[-1,-1,-1,-1,-1],[-1,-1,-1,-1,-1]],
        gold: [-1,-1,-1,-1,-1]
    }
    this.inventory = {
        item: [],
        card: []
    }
    this.pickupStack = {};
    this.title = null;
    this.titles = [];
    this.dailyGold = 0;
    this.shopLimit = {
        daily: [],
        lifetime: []
    }
    this.growthCard = [];
    this.entered_coupon = [];
    this.hotTime = null;
    this.artifact = {
        equip: null,
        artifacts: []
    };
    this.content_power = 0;
    this.content_clear = {};
    this.daily_quest = [];
    this.total_point = 0;
    this.vip = 0;
}

TCGUser.prototype.load = function(data) {
    this._get = data._get;
    this.id = data.id;
    this.name = data.name;
    this.isAdmin = data.isAdmin;
    this.code = data.code;
    this.logged_in = data.logged_in;
    this.gold = data.gold > 0 ? data.gold : 0;
    this.garnet = data.garnet > 0 ? data.garnet : 0;
    this.p = data.p > 0 ? data.p : 0;
    this.attendance = data.attendance;
    this.deck = data.deck;
    this.inventory = data.inventory;
    this.pickupStack = data.pickupStack;
    this.title = data.title;
    this.titles = data.titles;
    this.dailyGold = data.dailyGold || 0;
    this.shopLimit = data.shopLimit || {
        daily: [],
        lifetime: []
    };
    this.growthCard = data.growthCard || [];
    this.entered_coupon = data.entered_coupon || [];
    this.hotTime = data.hotTime || null;
    this.artifact = data.artifact || {
        equip: null,
        artifacts: []
    };
    this.content_power = data.content_power || 0;
    this.content_clear = data.content_clear || {};
    this.daily_quest = data.daily_quest || [];
    this.total_point = data.total_point || 0;
    this.vip = data.vip || 0;

    return this;
}

TCGUser.prototype.toString = function() {
    return (this.title ? "[" + this.title + "] " : "") + this.name;
}

TCGUser.prototype.save = function() {
    // updateItem 함수는 메인 파일에서 가져와야 함
    if (typeof updateItem === 'function') {
        updateItem('tcg_user', this.id, this);
    }
}

TCGUser.prototype.changeCode = function() {
    this.code = getRandomString(10).toUpperCase();
    this.save();
}

TCGUser.prototype.addItem = function(itemIdx, count) {
    let item = JSON.parse(fs.readFileSync("DB/TCG/item.json", 'utf8'))[itemIdx];
    if (! item) return false;
    if (this.inventory.item.find(i => i.id == itemIdx)) {
        this.inventory.item.find(i => i.id == itemIdx).count += count;
    } else {
        this.inventory.item.push({
            id: itemIdx,
            count: count
        });
    }
    return true;
}

TCGUser.prototype.removeItem = function(itemIdx, count) {
    if (! this.inventory.item.find(i => i.id == itemIdx)) {
        return false;
    } else {
        this.inventory.item.find(i => i.id == itemIdx).count -= count;
        if (this.inventory.item.find(i => i.id == itemIdx).count <= 0) {
            this.inventory.item.splice(this.inventory.item.findIndex(i => i.id == itemIdx), 1);
        }
    }
    return true;
}

TCGUser.prototype.addCard = function(cardIdx, count) {
    let card = JSON.parse(fs.readFileSync("DB/TCG/card.json", 'utf8'))[cardIdx];
    if (! card) return false;
    if (this.inventory.card.find(i => i.id == cardIdx)) {
        this.inventory.card.find(i => i.id == cardIdx).count += count;
    } else {
        this.inventory.card.push({
            breakLimit: false,
            transcend: 0,
            level: 0,
            id: cardIdx,
            count: count
        });
    }
    return true;
}

TCGUser.prototype.removeCard = function(cardIdx, count) {
    if (! this.inventory.card.find(i => i.id == cardIdx)) {
        return false;
    } else {
        this.inventory.card.find(i => i.id == cardIdx).count -= count;
        if (this.inventory.card.find(i => i.id == cardIdx).count <= 0) {
            this.inventory.card.splice(this.inventory.card.findIndex(i => i.id == cardIdx), 1);
            if (this.deck.content[0].includes(cardIdx)) this.deck.content[0][this.deck.content[0].indexOf(cardIdx)] = -1;
            if (this.deck.content[1].includes(cardIdx)) this.deck.content[1][this.deck.content[1].indexOf(cardIdx)] = -1;
            if (this.deck.gold.includes(cardIdx)) this.deck.gold[this.deck.gold.indexOf(cardIdx)] = -1;
        }
    }
    return true;
}

TCGUser.prototype.attend = function() {
    let now = new Date();
    let res = {
        success: false
    };
    if (this.attendance.last && now.toYYYYMMDD() == this.attendance.last) {
        return res;
    } else {
        if ((!this.attendance.last) || ((new Date(now.toYYYYMMDD()).getTime() - new Date(this.attendance.last).getTime()) / 86400000) == 1) {
            this.attendance.streak++;
        } else {
            this.attendance.streak = 0;
        }
        this.attendance.last = now.toYYYYMMDD();
        this.attendance.total++;
        if (this.deck.gold.includes(209)) {
            res.isRoulette = true;
        } else {
            this.gold += this.dailyGold;
        }
        this.shopLimit.daily = [];
        this.save();
        res.success = true;
        return res;
    }
}

TCGUser.prototype.givePack = function(pack) {
    let rewards = [];
    let items = JSON.parse(fs.readFileSync("DB/TCG/item.json", 'utf8'));
    let cards = JSON.parse(fs.readFileSync("DB/TCG/card.json", 'utf8'));
    pack.forEach(reward => {
        if (reward.roll) {
            let all_rolls = reward.rolls.reduce((cur,acc) => cur + acc.weight, 0);
            let r = Math.floor(Math.random() * all_rolls);
            let sum_weight = 0;
            let i = 0;
            for (; i < reward.rolls.length; i++) {
                sum_weight += reward.rolls[i].weight;
                if (r < sum_weight) break;
            }
            reward = reward.rolls[i];
        }
        if (reward.prob) {
            let r = Math.random();
            if (r >= reward.prob) {
                return;
            }
        }
        let count = reward.count;
        if (typeof count == 'object') {
            count = Math.floor(Math.random() * (count.max - count.min + 1)) + count.min;
        }
        if (reward.gold) {
            this.gold += count;
            rewards.push("- " + numberWithCommas(count.toString()) + "골드");
            return;
        }
        if (reward.garnet) {
            this.garnet += count;
            rewards.push("- " + numberWithCommas(count.toString()) + "가넷");
            return;
        }
        if (reward.item) {
            let itemIdx = items.findIndex(i => i.name == reward.name);
            if (itemIdx != -1) {
                if (count < 0) this.removeItem(itemIdx, Math.abs(count));
                else this.addItem(itemIdx, count);
                rewards.push("- " + reward.name + " x" + count);
            }
            return;
        }
        if (reward.card) {
            let cardIdx = cards.findIndex(c => c.name == reward.name && c.title == reward.title);
            if (cardIdx != -1) {
                if (count < 0) this.removeCard(cardIdx, Math.abs(count));
                else this.addCard(cardIdx, count);
                rewards.push("- [" + reward.title + "]" + reward.name + " x" + count);
            }
            return;
        }
    });
    this.save();
    return rewards;
}

TCGUser.prototype.checkQuest = function(quest, room) {
    if (! this.daily_quest.includes(quest)) {
        let daily_quests = JSON.parse(fs.readFileSync("DB/TCG/daily_quest.json", 'utf8'));
        this.daily_quest.push(quest);
        let pack = daily_quests.find(q => q.name == quest).reward;
        if (this.daily_quest.length == 5) pack.push({garnet:true,count:100});
        if (this.daily_quest.length == 6) pack.push({gold:true,count:30000});
        let rewards = this.givePack(pack);
        if (room && room.send) {
            room.send("✅ 일일 과제 달성!\n< " + quest + " >\n\n[ 보상 ]\n" + rewards.join("\n"));
        }
        return true;
    } else {
        return false;
    }
}

// TCG 시스템 함수들
function processTCGCommand(cmd, args, user, sender, channel) {
    const reply = (msg) => {
        if (channel) {
            if (channel._channel.info && channel._channel.info.type != "OM") {
                channel.sendChat(msg);
            } else {
                channel.sendChat(msg);
            }
        }
    };

    if (args[0] == "정보") {
        let info = user.name + "님의 정보\n\n";
        info += "💰 골드: " + numberWithCommas(user.gold.toString()) + "\n";
        info += "💎 가넷: " + numberWithCommas(user.garnet.toString()) + "\n";
        info += "📊 포인트: " + numberWithCommas(user.p.toString()) + "\n";
        info += "👑 VIP 레벨: " + user.vip + "\n";
        info += "📅 출석일수: " + user.attendance.total + "일\n";
        info += "🔥 출석연속: " + user.attendance.streak + "일\n";
        info += "🎯 총 포인트: " + numberWithCommas(user.total_point.toString()) + "\n";
        info += "⚔️ 콘텐츠 파워: " + numberWithCommas(user.content_power.toString());
        reply(info);
    }

    else if (args[0] == "출석") {
        let result = user.attend();
        if (result.success) {
            reply("✅ 출석체크 완료!\n" + user.attendance.streak + "일 연속 출석 중!\n총 " + user.attendance.total + "일 출석!");
        } else {
            reply("❌ 이미 오늘 출석체크를 하셨습니다.");
        }
    }

    else if (args[0] == "인벤토리" || args[0] == "인벤") {
        let inv = "📦 " + user.name + "님의 인벤토리\n\n";

        // 카드 목록
        if (user.inventory.card.length > 0) {
            inv += "🎴 카드 (" + user.inventory.card.length + "종)\n";
            user.inventory.card.forEach(card => {
                let cardData = JSON.parse(fs.readFileSync("DB/TCG/card.json", 'utf8'))[card.id];
                if (cardData) {
                    inv += "• [" + cardData.title + "]" + cardData.name + " x" + card.count + "\n";
                }
            });
        } else {
            inv += "🎴 카드: 없음\n";
        }

        // 아이템 목록
        if (user.inventory.item.length > 0) {
            inv += "\n🎒 아이템 (" + user.inventory.item.length + "종)\n";
            user.inventory.item.forEach(item => {
                let itemData = JSON.parse(fs.readFileSync("DB/TCG/item.json", 'utf8'))[item.id];
                if (itemData) {
                    inv += "• " + itemData.name + " x" + item.count + "\n";
                }
            });
        } else {
            inv += "\n🎒 아이템: 없음";
        }

        reply(inv);
    }

    else if (args[0] == "덱") {
        let deck = user.deck;
        let deckInfo = "⚔️ " + user.name + "님의 덱\n\n";

        deckInfo += "📋 일반 덱:\n";
        deck.content[0].forEach((cardId, index) => {
            if (cardId != -1) {
                let card = JSON.parse(fs.readFileSync("DB/TCG/card.json", 'utf8'))[cardId];
                if (card) {
                    deckInfo += (index + 1) + "번째: [" + card.title + "]" + card.name + "\n";
                }
            }
        });

        deckInfo += "\n📋 골드 덱:\n";
        deck.gold.forEach((cardId, index) => {
            if (cardId != -1) {
                let card = JSON.parse(fs.readFileSync("DB/TCG/card.json", 'utf8'))[cardId];
                if (card) {
                    deckInfo += (index + 1) + "번째: [" + card.title + "]" + card.name + "\n";
                }
            }
        });

        reply(deckInfo);
    }

    else if (args[0] == "카드뽑기" || args[0] == "뽑기") {
        let packName = args[1] || "일반";
        let packs = JSON.parse(fs.readFileSync("DB/TCG/pack.json", 'utf8'));
        let pack = packs.find(p => p.name == packName);

        if (!pack) {
            reply("❌ 존재하지 않는 패키지입니다.");
            return;
        }

        let cost = pack.cost || 0;
        if (cost > 0 && user.gold < cost) {
            reply("❌ 골드가 부족합니다. (필요: " + numberWithCommas(cost.toString()) + "골드)");
            return;
        }

        if (cost > 0) {
            user.gold -= cost;
        }

        let rewards = user.givePack(pack.reward);
        let result = "🎁 " + packName + " 패키지 결과\n\n";

        if (rewards.length > 0) {
            result += "[ 획득 아이템 ]\n" + rewards.join("\n");
        } else {
            result += "아무것도 얻지 못했습니다.";
        }

        if (cost > 0) {
            result += "\n\n💰 소모 골드: " + numberWithCommas(cost.toString()) + "골드";
        }

        reply(result);
    }

    else if (args[0] == "일뽑") {
        let num = 1;
        if (!isNaN(args[1])) num = Number(args[1]);
        if (num != 1 && num != 10) {
            reply("❌ 단차 또는 10연차만 가능합니다.");
            return;
        }

        let need = num;
        // 소환권 확인
        if (user.inventory.item.find(i => i.id == 1)) {
            if (user.inventory.item.find(i => i.id == 1).count > num) {
                user.removeItem(1, need);
                need = 0;
            } else {
                need -= user.inventory.item.find(i => i.id == 1).count;
                user.removeItem(1, num);
            }
        }

        // 가넷 확인
        if ((need * 100) > user.garnet) {
            reply("❌ 가넷이 부족합니다! (필요: " + (need * 100) + "가넷)");
            return;
        }
        user.garnet -= (need * 100);

        // 확률 정보 로드
        let probability = JSON.parse(fs.readFileSync("DB/TCG/probability.json", 'utf8'))["일반"];

        // 특수 효과 확인
        if (user.deck.content[0].includes(508) || user.deck.content[1].includes(508) || user.deck.gold.includes(508)) {
            probability[4] += 0.01;
            probability[3] -= 0.01;
        }

        let result = [{
            rarity: "전설",
            count: 0
        },{
            rarity: "영웅",
            count: 0
        },{
            rarity: "희귀",
            count: 0
        },{
            rarity: "고급",
            count: 0
        },{
            rarity: "일반",
            count: 0
        }];

        // 뽑기 처리
        let cards = JSON.parse(fs.readFileSync("DB/TCG/card.json", 'utf8'));
        let cardResults = [];

        // 다음 카드 처리
        if (user.deck.next) {
            let nCount = 0;
            user.deck.next.forEach(next => {
                if (num < 1) return;
                let cardIdx = cards.findIndex(c => c.title == next.title && c.name == next.name);
                if (cardIdx != -1) {
                    num--;
                    result.find(r => r.rarity == cards[cardIdx].rarity).count++;
                    user.addCard(cardIdx, 1);
                    if (cardResults.find(c => c.id == cardIdx)) {
                        cardResults.find(c => c.id == cardIdx).count++;
                    } else {
                        cardResults.push({
                            id: cardIdx,
                            rarity: cards[cardIdx].rarity,
                            name: "[" + cards[cardIdx].title + "]" + cards[cardIdx].name,
                            count: 1
                        });
                    }
                }
                nCount++;
            });
            user.deck.next.splice(0, nCount);
            if (user.deck.next.length == 0) delete user.deck.next;
        }

        // 랜덤 뽑기
        for (let i = 0; i < num; i++) {
            let r = Math.random();
            let total_pb = 0;
            for (let j = 0; j < probability.length; j++) {
                total_pb += probability[j];
                if (r < total_pb) {
                    result[j].count++;
                    break;
                }
            }
        }

        // 카드 지급
        for (let rs of result) {
            for (let i = 0; i < rs.count; i++) {
                let card = cards.filter(c => c.rarity == rs.rarity)[Math.floor(Math.random() * cards.filter(c => c.rarity == rs.rarity).length)];
                let cardIdx = cards.findIndex(c => c.title == card.title && c.name == card.name);
                user.addCard(cardIdx, 1);
                if (cardResults.find(c => c.name == "[" + card.title + "]" + card.name)) {
                    cardResults.find(c => c.name == "[" + card.title + "]" + card.name).count++;
                } else {
                    cardResults.push({
                        rarity: card.rarity,
                        name: "[" + card.title + "]" + card.name,
                        count: 1
                    });
                }
            }
        }

        user.save();

        let resDisplay = result.map(rs => rs.count <= 0 ? null : "- " + rs.rarity + " x" + rs.count).filter(rs => rs != null);
        let resultMsg = "[ 일뽑 x" + numberWithCommas(num.toString()) + " 결과 ]\n" + resDisplay.join("\n") + "\n\n[ 획득한 카드 ]\n" + cardResults.map(cr => "<" + cr.rarity + "> " + cr.name + (cr.count > 1 ? " x" + cr.count : "")).join("\n");

        reply(resultMsg);
    }

    else if (args[0] == "픽뽑1" || args[0] == "픽뽑2") {
        let picknum = Number(args[0].substr(2)) - 1;
        let num = 1;
        if (!isNaN(args[1])) num = Number(args[1]);
        if (num != 1 && num != 10) {
            reply("❌ 단차 또는 10연차만 가능합니다.");
            return;
        }

        let need = num;
        // 픽업 소환권 확인
        if (user.inventory.item.find(i => i.id == 2)) {
            if (user.inventory.item.find(i => i.id == 2).count > num) {
                user.removeItem(2, need);
                need = 0;
            } else {
                need -= user.inventory.item.find(i => i.id == 2).count;
                user.removeItem(2, num);
            }
        }

        if ((need * 100) > user.garnet) {
            reply("❌ 가넷이 부족합니다! (필요: " + (need * 100) + "가넷)");
            return;
        }
        user.garnet -= (need * 100);

        let probability = JSON.parse(fs.readFileSync("DB/TCG/probability.json", 'utf8'))["픽업"];
        let result = [{
            rarity: "픽업전설",
            count: 0
        },{
            rarity: "픽업영웅",
            count: 0
        },{
            rarity: "픽업희귀",
            count: 0
        },{
            rarity: "픽업고급",
            count: 0
        },{
            rarity: "픽업일반",
            count: 0
        },{
            rarity: "전설",
            count: 0
        },{
            rarity: "영웅",
            count: 0
        },{
            rarity: "희귀",
            count: 0
        },{
            rarity: "고급",
            count: 0
        },{
            rarity: "일반",
            count: 0
        }];

        // 뽑기 처리
        for (let i = 0; i < num; i++) {
            let r = Math.random();
            let total_pb = 0;
            for (let j = 0; j < probability.length; j++) {
                total_pb += probability[j];
                if (r < total_pb) {
                    result[j].count++;
                    break;
                }
            }
        }

        let cardResults = [];
        let cards = JSON.parse(fs.readFileSync("DB/TCG/card.json", 'utf8'));
        let theme = JSON.parse(fs.readFileSync("DB/TCG/pickupRotation.json", 'utf8')).currentTheme[picknum];

        // 카드 지급
        for (let rs of result) {
            for (let i = 0; i < rs.count; i++) {
                let card;
                if (rs.rarity.includes("픽업")) {
                    card = cards.filter(c => c.title == theme && c.rarity == rs.rarity.replace("픽업",""));
                    if (card.length > 0) card = card[Math.floor(Math.random() * card.length)];
                    else card = cards.filter(c => c.rarity == rs.rarity.replace("픽업",""))[Math.floor(Math.random() * cards.filter(c => c.rarity == rs.rarity.replace("픽업","")).length)];
                } else {
                    card = cards.filter(c => c.rarity == rs.rarity)[Math.floor(Math.random() * cards.filter(c => c.rarity == rs.rarity).length)];
                }
                let cardIdx = cards.findIndex(c => c.title == card.title && c.name == card.name);
                user.addCard(cardIdx, 1);
                if (cardResults.find(c => c.name == "[" + card.title + "]" + card.name)) {
                    cardResults.find(c => c.name == "[" + card.title + "]" + card.name).count++;
                } else {
                    cardResults.push({
                        rarity: card.rarity,
                        name: "[" + card.title + "]" + card.name,
                        count: 1
                    });
                }
            }
        }

        user.save();

        let resultDisplay = result.map(rs => rs.count <= 0 ? null : "- " + (rs.rarity.includes("픽업") ? "★픽업 " : "") + rs.rarity.replace("픽업","") + " x" + rs.count).filter(rs => rs != null);
        let resultMsg = "[ 픽뽑" + (picknum + 1) + " x" + numberWithCommas(num.toString()) + " 결과 ]\n" + resultDisplay.join("\n") + "\n\n[ 획득한 카드 ]\n" + cardResults.map(cr => "<" + cr.rarity + "> " + cr.name + (cr.count > 1 ? " x" + cr.count : "")).join("\n");

        reply(resultMsg);
    }

    else {
        reply("❌ 알 수 없는 TCG 명령어입니다: " + args[0]);
    }
}

module.exports = {
    TCGUser,
    processTCGCommand,
    numberWithCommas,
    getRandomString
};

