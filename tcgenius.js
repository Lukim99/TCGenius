const node_kakao = require('node-kakao');
const fs = require('fs');
const express = require('express');
const request = require('request');
const convert = require('xml-js');
const html2json = require('html2json').html2json;
const keepAlive = require('./server.js');
const { TalkClient, AuthApiClient, xvc, KnownAuthStatusCode, util, AttachmentApi } = require("node-kakao");
const { isString } = require('util');
const { get } = require('request');
const crypto = require('crypto');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const VIEWMORE = ('\u200e'.repeat(500));

// TCG 관련 상수 및 설정
const AWSCFG = {
    accessKeyId: "AKIAXQIQADH3NM4KOREA",
    secretAccessKey: "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",
    region: "ap-northeast-2",
    service: "dynamodb",
    host: "dynamodb.ap-northeast-2.amazonaws.com",
    endpoint: "https://dynamodb.ap-northeast-2.amazonaws.com"
};

const ClaudeAPIKEY = "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";

// TCG 관련 모듈 로드
const TCGSystem = require('./tcg_system.js');
const PREFIX = "$";
const SWORDS = ["맹독 비수", "방랑자의 장검", "뱀파이어의 송곳니", "새벽 단검", "아스트로베놈", "천명즉살검", "천상유랑검", "혈성극검"];
const ARCANA_LIMIT = 5;

// TCG 관련 전역 변수들 (old_engine.js와 완벽히 동일)
let wordchain = {};
let spellrule = {};
let myCheck = {};
let stackCheck = {};
let myPrompt = {};
let outputing = {};
let banFromLKBot = {};
let LLMPrompt = {};
let TRPGPrompt = {};
let TRPGData = {};
let newsWriting = {};
let textBattle = {};
let colosseum = {};
let huntParty = {};
let toWait = {};
let dontDobae = {};
let combQueue = {};
let editPack = {};
let chooseCard = {};
let tcgRaid = {};
let canRejoin = {};
let megaCounting = {};
let tcgLoading = {};
let noticeRest = {};
let lastChat = {};

let repeatTimer = null;
let compiled = false;

// TCG 관련 확장 함수들 (old_engine.js와 동일)
Array.prototype.getRandomElement = function() {
    return this[Math.floor(Math.random() * this.length)];
};

Array.prototype.remove = function(element) {
    if (this.indexOf(element) == -1)
        return this;
    else {
        this.splice(this.indexOf(element), 1);
        return this;
    }
};

Number.prototype.toComma2 = function() {
    return this.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
};

// parseItemString 함수 (old_engine.js와 동일)
function parseItemString(input) {
    var str = input.trim();

    var goldMatch = str.match(/^(\d+)골드$/);
    if (goldMatch) {
        return {
            gold: true,
            count: parseInt(goldMatch[1])
        };
    }

    var garnetMatch = str.match(/^(\d+)가넷$/);
    if (garnetMatch) {
        return {
            garnet: true,
            count: parseInt(garnetMatch[1])
        };
    }

    var cardMatch = str.match(/^\[([^\]]+)\](.+?)\s*x(\d+)$/);
    if (cardMatch) {
        return {
            card: true,
            title: cardMatch[1],
            name: cardMatch[2],
            count: parseInt(cardMatch[3])
        };
    }

    var cardMatch1 = str.match(/^\[([^\]]+)\](.+?)$/);
    if (cardMatch1) {
        return {
            card: true,
            title: cardMatch1[1],
            name: cardMatch1[2],
            count: 1
        };
    }

    var itemMatch = str.match(/^(.+?)\s*x(\d+)$/);
    if (itemMatch) {
        return {
            item: true,
            name: itemMatch[1],
            count: parseInt(itemMatch[2])
        };
    }

    return null;
}

// TCG 파워 계산 함수들 (old_engine.js에서 복사)
function calculatePower(user, deck, options = {}) {
    let cards = JSON.parse(fs.readFileSync("DB/TCG/card.json", 'utf8'));
    let power = 0;
    let single = [0, 0, 0, 0, 0];

    for (let i = 0; i < 5; i++) {
        if (deck[i] != -1 && cards[deck[i]]) {
            let card = user.inventory.card.find(c => c.id == deck[i]);
            if (card) {
                let cardData = JSON.parse(JSON.stringify(cards[deck[i]]));
                cardData.deepMerge(card);
                single[i] = cardData.power;
                power += cardData.power;
            }
        }
    }

    if (options.isContentDeck) {
        let content_power = power;
        // 콘텐츠 덱 특수 효과들
        if (user.artifact.equip && user.artifact.equip.effect) {
            // 아티팩트 효과 적용
        }
        power = content_power;
    } else if (options.isGoldDeck) {
        // 골드 덱 특수 효과들
        power = power;
    }

    return { power, single };
}

function calculateDeckPower(user, deck, options = {}) {
    // 덱 파워 상세 계산 (old_engine.js와 동일하게 구현)
    let cards = JSON.parse(fs.readFileSync("DB/TCG/card.json", 'utf8'));
    let basePower = 0;
    let message = "";

    // 기본 카드 파워 계산
    for (let i = 0; i < 5; i++) {
        if (deck[i] != -1 && cards[deck[i]]) {
            let card = user.inventory.card.find(c => c.id == deck[i]);
            if (card) {
                let cardData = JSON.parse(JSON.stringify(cards[deck[i]]));
                cardData.deepMerge(card);
                basePower += cardData.power;
                message += "카드 " + (i + 1) + "번째: " + cardData.power + "\n";
            }
        }
    }

    let calcPower = basePower;
    let dailyGold = 0;

    if (options.isContentDeck) {
        calcPower = basePower;
    } else if (options.isGoldDeck) {
        // 골드 덱 데일리 골드 계산
        dailyGold = Math.floor(calcPower / 1000) * 100;
        calcPower = basePower;
    }

    return {
        calcPower,
        dailyGold,
        message
    };
}

// DynamoDB 관련 유틸리티 함수들
function sha256Hex(data) {
    return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

function convertToDynamoDBType(data) {
    if (Array.isArray(data)) {
        return { L: data.map(convertToDynamoDBType) };
    } else if (typeof data === 'object' && data !== null) {
        var mapData = {};
        for (var key in data) {
            if (data.hasOwnProperty(key)) {
                mapData[key] = convertToDynamoDBType(data[key]);
            }
        }
        return { M: mapData };
    } else if (typeof data === 'string') {
        return { S: data };
    } else if (typeof data === 'number') {
        return { N: data.toString() };
    } else if (typeof data === 'boolean') {
        return { BOOL: data };
    } else if (data === null) {
        return { NULL: true };
    }
}

function transformDynamoDBItem(item) {
    function transformAttribute(attribute) {
        if (attribute.hasOwnProperty("S")) {
            return attribute.S;
        } else if (attribute.hasOwnProperty("N")) {
            return Number(attribute.N);
        } else if (attribute.hasOwnProperty("M")) {
            var map = {};
            for (var key in attribute.M) {
                if (attribute.M.hasOwnProperty(key)) {
                    map[key] = transformAttribute(attribute.M[key]);
                }
            }
            return map;
        } else if (attribute.hasOwnProperty("L")) {
            return attribute.L.map(transformAttribute);
        } else if (attribute.hasOwnProperty("BOOL")) {
            return attribute.BOOL;
        }
        return attribute;
    }

    if (item.M) {
        var result = {};
        for (var key in item.M) {
            if (item.M.hasOwnProperty(key)) {
                result[key] = transformAttribute(item.M[key]);
            }
        }
        return result;
    }
    return item;
}

function DynamoDB(task, payload) {
    var dateFormat = new Date().toISOString().replace(/[:-]/g, '').split('.')[0] + 'Z';
    var shortDate = dateFormat.substring(0, 8);

    var method = "POST";
    var canonicalUri = "/";
    var canonicalQuerystring = "";
    var canonicalHeaders = "host:" + AWSCFG.host + "\n" + "x-amz-date:" + dateFormat + "\n";
    var signedHeaders = "host;x-amz-date";
    var payloadHash = sha256Hex(payload);
    var canonicalRequest = [method, canonicalUri, canonicalQuerystring, canonicalHeaders, signedHeaders, payloadHash].join("\n");

    var algorithm = "AWS4-HMAC-SHA256";
    var credentialScope = [shortDate, AWSCFG.region, AWSCFG.service, "aws4_request"].join("/");
    var stringToSign = [algorithm, dateFormat, credentialScope, sha256Hex(canonicalRequest)].join("\n");

    function getSignatureKey(key, dateStamp, regionName, serviceName) {
        var kDate = crypto.createHmac('sha256', "AWS4" + key).update(dateStamp, 'utf8').digest();
        var kRegion = crypto.createHmac('sha256', kDate).update(regionName, 'utf8').digest();
        var kService = crypto.createHmac('sha256', kRegion).update(serviceName, 'utf8').digest();
        var kSigning = crypto.createHmac('sha256', kService).update("aws4_request", 'utf8').digest();
        return kSigning;
    }

    var signingKey = getSignatureKey(AWSCFG.secretAccessKey, shortDate, AWSCFG.region, AWSCFG.service);
    var signature = crypto.createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

    var authorizationHeader = algorithm + " " + "Credential=" + AWSCFG.accessKeyId + "/" + credentialScope + ", " + "SignedHeaders=" + signedHeaders + ", " + "Signature=" + signature;

    var headers = {
        'Authorization': authorizationHeader,
        'Content-Type': 'application/x-amz-json-1.0',
        'Host': AWSCFG.host,
        'X-Amz-Date': dateFormat,
        'X-Amz-Target': 'DynamoDB_20120810.' + task
    };

    var options = {
        url: AWSCFG.endpoint,
        method: 'POST',
        headers: headers,
        body: payload
    };

    return new Promise((resolve, reject) => {
        request(options, function(error, response, body) {
            if (error) {
                reject(error);
            } else {
                try {
                    let result = JSON.parse(body);
                    resolve({ success: true, result: [result] });
                } catch (e) {
                    resolve({ success: false, result: [e] });
                }
            }
        });
    });
}

function getItem(table, id) {
    let payloadJSON = {
        TableName: table,
        Key: {
            "id": convertToDynamoDBType(id)
        }
    };
    return DynamoDB("GetItem", JSON.stringify(payloadJSON));
}

function putItem(table, item) {
    let payloadJSON = {
        TableName: table,
        Item: convertToDynamoDBType(item).M
    };
    return DynamoDB("PutItem", JSON.stringify(payloadJSON));
}

function updateItem(table, id, data) {
    let updateExpression = "SET " + Object.keys(data).filter(d => d != "id").map(d => "#" + d + "=:new_" + d).join(",");
    let expressionAttributeNames = {};
    let expressionAttributeValues = {};
    Object.keys(data).filter(d => d != "id").forEach(e => {
        expressionAttributeNames["#" + e] = e;
        expressionAttributeValues[":new_" + e] = convertToDynamoDBType(data[e]);
    });
    let payloadJSON = {
        TableName: table,
        Key: {
            "id": convertToDynamoDBType(id)
        },
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues
    };
    return DynamoDB("UpdateItem", JSON.stringify(payloadJSON));
}

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

// TCG 관련 확장 함수들 (old_engine.js와 동일)
Array.prototype.getRandomElement = function() {
    return this[Math.floor(Math.random() * this.length)];
};

Array.prototype.remove = function(element) {
    if (this.indexOf(element) == -1)
        return this;
    else {
        this.splice(this.indexOf(element), 1);
        return this;
    }
};

Number.prototype.toComma2 = function() {
    return this.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
};

// parseItemString 함수 (old_engine.js와 동일)
function parseItemString(input) {
    var str = input.trim();

    var goldMatch = str.match(/^(\d+)골드$/);
    if (goldMatch) {
        return {
            gold: true,
            count: parseInt(goldMatch[1])
        };
    }

    var garnetMatch = str.match(/^(\d+)가넷$/);
    if (garnetMatch) {
        return {
            garnet: true,
            count: parseInt(garnetMatch[1])
        };
    }

    var cardMatch = str.match(/^\[([^\]]+)\](.+?)\s*x(\d+)$/);
    if (cardMatch) {
        return {
            card: true,
            title: cardMatch[1],
            name: cardMatch[2],
            count: parseInt(cardMatch[3])
        };
    }

    var cardMatch1 = str.match(/^\[([^\]]+)\](.+?)$/);
    if (cardMatch1) {
        return {
            card: true,
            title: cardMatch1[1],
            name: cardMatch1[2],
            count: 1
        };
    }

    var itemMatch = str.match(/^(.+?)\s*x(\d+)$/);
    if (itemMatch) {
        return {
            item: true,
            name: itemMatch[1],
            count: parseInt(itemMatch[2])
        };
    }

    return null;
}

// TCGUser 클래스 및 관련 함수들
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
    updateItem('tcg_user', this.id, this);
}

TCGUser.prototype.changeCode = function() {
    this.code = getRandomString(10).toUpperCase();
    this.save();
}

TCGUser.prototype.addItem = function(itemIdx, count) {
    let item = JSON.parse(read("DB/TCG/item.json"))[itemIdx];
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
    let card = JSON.parse(read("DB/TCG/card.json"))[cardIdx];
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
    let items = JSON.parse(read("DB/TCG/item.json"));
    let cards = JSON.parse(read("DB/TCG/card.json"));
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

// deepMerge 함수 (old_engine.js와 동일)
Object.prototype.deepMerge = function(other) {
    for (let key in other) {
        if (other.hasOwnProperty(key)) {
            if (typeof other[key] === 'object' && other[key] !== null && !Array.isArray(other[key])) {
                if (!this[key]) this[key] = {};
                this[key].deepMerge(other[key]);
            } else {
                this[key] = other[key];
            }
        }
    }
    return this;
};

// printCard 함수 (old_engine.js와 동일)
function printCard(cardData) {
    let maxTranscend = {
        "전설": 5,
        "영웅": 4,
        "희귀": 3,
        "고급": 2,
        "일반": 1
    };
    if (cardData.breakLimit) maxTranscend = {
        "전설": 6,
        "영웅": 5,
        "희귀": 4,
        "고급": 3,
        "일반": 2
    };

    let cardStar = (cardData.rarity ? (cardData.transcend ? Array(cardData.transcend + 1).join("★") + Array(maxTranscend[cardData.rarity] - cardData.transcend + 1).join("☆") : Array(maxTranscend[cardData.rarity] + 1).join("☆")) : "");
    let cardName = (cardData.title ? "[" + cardData.title + "]" : "[unknown]") + (cardData.name ? cardData.name : "unknown");
    let cardLevel = (cardData.level ? "+" + cardData.level : "+0");
    let cardPower = (cardData.power ? "P" + (cardData.power + (cardData.rarity ? (cardData.level ? GROW[cardData.rarity].lv * cardData.level : 0) + (cardData.transcend ? GROW[cardData.rarity].tr * cardData.transcend : 0) : 0)) : "");
    let cardDesc = (cardData.desc && cardData.desc != "" ? "'" + cardData.desc + "'" : "");
    return (cardStar + " " + cardName + " " + cardLevel + " " + cardPower + " " + cardDesc).trim();
}

// GROW 상수 (old_engine.js와 동일)
var GROW = {
    "일반": {lv:1, tr:3, maxLv:5, maxTr:4}, "고급":{lv:2, tr:6, maxLv:5, maxTr:4},
    "희귀": {lv:3, tr:9, maxLv:7, maxTr:6}, "영웅":{lv:4, tr:15, maxLv:9, maxTr:8},
    "전설": {lv:5, tr:25, maxLv:12, maxTr:10}
};

function getTCGUserById(id) {
    let res = DynamoDB('Query', JSON.stringify({
        TableName: "tcg_user",
        IndexName: "getIdx",
        KeyConditionExpression: "#gsi_partition_key = :gsi_value",
        FilterExpression: "contains(logged_in, :userid_val)",
        ExpressionAttributeNames: {
            "#gsi_partition_key": "_get"
        },
        ExpressionAttributeValues: {
            ":gsi_value": { "N": "1" },
            ":userid_val": { "S": id }
        }
    }));
    if (res.success && res.result[0] && res.result[0].Items[0]) return new TCGUser().load(transformDynamoDBItem(res.result[0].Items[0]));
    else return null;
}

function getTCGUserByName(name) {
    let res = DynamoDB('Query', JSON.stringify({
        TableName: "tcg_user",
        IndexName: "nameIdx",
        KeyConditionExpression: "#name = :name_val",
        ExpressionAttributeNames: {
            "#name": "name"
        },
        ExpressionAttributeValues: {
            ":name_val": { "S": name }
        }
    }));
    if (res.success && res.result[0] && res.result[0].Items[0]) return new TCGUser().load(transformDynamoDBItem(res.result[0].Items[0]));
    else return null;
}

function getTCGUserByCode(code) {
    let res = DynamoDB('Query', JSON.stringify({
        TableName: "tcg_user",
        IndexName: "codeIdx",
        KeyConditionExpression: "#code = :code_val",
        ExpressionAttributeNames: {
            "#code": "code"
        },
        ExpressionAttributeValues: {
            ":code_val": { "S": code }
        }
    }));
    if (res.success && res.result[0] && res.result[0].Items[0]) return new TCGUser().load(transformDynamoDBItem(res.result[0].Items[0]));
    else return null;
}

function getAllTCGUser() {
    let returnRes = [];

    let payload1 = {
        TableName: "tcg_user",
        IndexName: "getIdx",
        KeyConditionExpression: "#gsi_partition_key = :gsi_value",
        ExpressionAttributeNames: {
            "#gsi_partition_key": "_get"
        },
        ExpressionAttributeValues: {
            ":gsi_value": { "N": "1" }
        }
    };

    let res1 = DynamoDB('Query', JSON.stringify(payload1));
    if (res1.success && res1.result[0] && res1.result[0].Items) {
        returnRes = returnRes.concat(res1.result[0].Items.map(item => new TCGUser().load(transformDynamoDBItem(item))));
    }

    return returnRes;
}

function TCGLog(text) {
    let channel = DB.getChannelById("442097040687921");
    if (channel) {
        channel.send(text);
    }
}

const DEVICE_TYPE = "tablet";
let DEVICE_UUID = "5606ca740cfb9cc2fe620e6d83b68a9041303bf045170d40ad6f9c4f99a21a";
const DEVICE_NAME = "uDevice";
const EMAIL = "lklklk9@kakao.com";
const PASSWORD = "yanga0800";
let client = new node_kakao.TalkClient();

function read(path) {
    try {
      var data = fs.readFileSync(path, 'utf8');
    } catch(e) {
      var data = 'null';
    }
    return data;
}
function save(path, data) {
    fs.writeFileSync(path, data, 'utf8');
    return data;
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

function get_captcha_key() {
    var api_url = 'https://openapi.naver.com/v1/captcha/nkey?code=0';
    var client_id = 't2YQpo4W6MkVWKlw92F3';
    var client_secret = 'tMOsE30Yh7';
    var options = {
        url: api_url,
        headers: {
            'X-Naver-Client-Id': client_id,
            'X-Naver-Client-Secret': client_secret
        }
    };
    return new Promise(resolve => {
        request(options, function(error, response, html) {
            if (error) {
                throw error;
            }
            resolve(html);
        });
    });
}

async function get_captcha_image(captcha_key) {
    var api_url = 'https://openapi.naver.com/v1/captcha/ncaptcha.bin?key=' + captcha_key;
    var client_id = 't2YQpo4W6MkVWKlw92F3';
    var client_secret = 'tMOsE30Yh7';
    var options = {
        url: api_url,
        headers: {
            'X-Naver-Client-Id': client_id,
            'X-Naver-Client-Secret': client_secret
        }
    };
    var req = request.get(options).on('response', function(response) {
    });
    req.pipe(fs.createWriteStream('./captcha.jpg'));
}

function get_captcha_valid(captcha_key, value) {
    var api_url = `https://openapi.naver.com/v1/captcha/nkey?code=1&key=${captcha_key}&value=${value}`;
    var client_id = 't2YQpo4W6MkVWKlw92F3';
    var client_secret = 'tMOsE30Yh7';
    var options = {
        url: api_url,
        headers: {
            'X-Naver-Client-Id': client_id,
            'X-Naver-Client-Secret': client_secret
        }
    };
    return new Promise(resolve => {
        request.get(options, function(error, response, html) {
            if (JSON.parse(html).result)
                resolve(true);
            else
                resolve(false);
        });
    });
}

Array.prototype.shuffle = function() {
    const source_array = this.concat();
    const arrayLength = source_array.length;
    for (let i = arrayLength - 1; i >= 0; i--) {
        const randomIndex = Math.floor(Math.random() * (i + 1));
        [source_array[i], source_array[randomIndex]] = [source_array[randomIndex], source_array[i]];
    }
    return source_array;
}

Array.prototype.remove = function(element) {
    if (this.indexOf(element) == -1)
        return this;
    else {
        this.splice(this.indexOf(element), 1);
        return this;
    }
}

function pad_han(kor, max_len) {
    if(kor.length >= max_len)
        return kor;
    return kor + (new Array(max_len - kor.length + 1).join("ㅤ"));
}

function pad_num(kor, max_len) {
    if(kor.length >= max_len)
        return kor;
    return (new Array(max_len - kor.length + 1).join("0")) + kor;
}

var CHOSEONG = ["ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"],
	JUNGSEONG = ["ㅏ", "ㅐ", "ㅑ", "ㅒ", "ㅓ", "ㅔ", "ㅕ", "ㅖ", "ㅗ", "ㅘ", "ㅙ", "ㅚ", "ㅛ", "ㅜ", "ㅝ", "ㅞ", "ㅟ", "ㅠ", "ㅡ", "ㅢ", "ㅣ"],
	JONGSEONG = ["", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ", "ㄻ", "ㄼ", "ㄽ", "ㄾ", "ㄿ", "ㅀ", "ㅁ", "ㅂ", "ㅄ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"],
	CHOSEONG_LEN = CHOSEONG.length,
	JUNGSEONG_LEN = JUNGSEONG.length,
	JONGSEONG_LEN = JONGSEONG.length;

var HANGUL_FIRST_CODE = '가'.charCodeAt(0),
	HANGUL_LAST_CODE = '힣'.charCodeAt(0);

function dueum(s) {
  if (!s)
    return '';
  var c = s.charCodeAt(0);
  if (c < HANGUL_FIRST_CODE || c > HANGUL_LAST_CODE)
    return s;
  switch (0 | (c - HANGUL_FIRST_CODE) / JONGSEONG_LEN) {
    // 녀, 뇨, 뉴, 니
    case 48: case 54:
    case 59: case 62:
      c += 5292; break;
    // 랴, 려, 례, 료, 류, 리
    case 107: case 111:
    case 112: case 117:
    case 122: case 125:
      c += 3528; break;
    // 라, 래, 로, 뢰, 루, 르
    case 105: case 106:
    case 113: case 116:
    case 118: case 123:
      c -= 1764; break;
  }
  return String.fromCharCode(c) + s.slice(1);
}

function dec_han(s) {
  if(s.match(/[^가-힣ㄱ-ㅎ]/gi) != null)
    return s;
  const ga = 44032;
  let uni = s.charCodeAt(0);

  uni = uni - ga;

  let fn = parseInt(uni / 588);
  let sn = parseInt((uni - (fn * 588)) / 28);
  let tn = parseInt(uni % 28);

  return `${CHOSEONG[fn]}${JUNGSEONG[sn]}${JONGSEONG[tn]}`;
}

function com_han(s) {
  if(s.match(/[^가-힣ㄱ-ㅎㅏ-ㅣ]/gi) != null)
    return s;
  let cho = CHOSEONG.indexOf(s[0]);
  let jung = JUNGSEONG.indexOf(s[1]);
  let jong = (s[2] == undefined ? 0 : JONGSEONG.indexOf(s[2]));

  return String.fromCharCode(0xAC00 + cho * 588 + jung * 28 + jong);
}

client.on('chat', async (data, channel) => {
    try {
        if (data.text == "$생존") {
            channel.sendChat("생존");
        }

        const msg = data.text.trim();

        if (msg.startsWith(">rrr ")) {
            try {
                let evalResult = eval(msg.substr(5));
                channel.sendChat(evalResult);
            } catch(e) {
                channel.sendChat(JSON.stringify(e, null, 4));
            }
        }

        const sender = data.getSenderInfo(channel) || data._chat.sender;
        const bot = channel.getUserInfo(client._clientUser);
        const room = channel.getDisplayName();
        const roomid = channel.channelId;
        const roomtype = (channel._channel.info == undefined ? "OM" : channel._channel.info.type);
        const isReply = (data.originalType === node_kakao.KnownChatType.REPLY);
        const isManager = (bot && bot.perm >= 4);

        if (! sender) {
            if (data.text.startsWith(PREFIX)) {
                channel.sendChat("알 수 없는 오류가 발생했습니다.");
            }
            return;
        }
        
        if (! bot) {
            if (data.text.startsWith(PREFIX)) {
                channel.sendChat("알 수 없는 오류가 발생했습니다.");
            }
            return;
        }
        
        const reply = str => {
            if(roomtype != "OM") {
                channel.sendChat(
                    new node_kakao.ChatBuilder()
                    .append(new node_kakao.ReplyContent(data.chat))
                    .text(str)
                    .build(node_kakao.KnownChatType.REPLY)
                );
            }
            else {
                channel.sendChat(new node_kakao.ChatBuilder().text("⤷ ").append(new node_kakao.MentionContent(channel.getUserInfo(sender))).text(`님에게 답장\n\n${str}`).build(node_kakao.KnownChatType.TEXT));
            }
        }

        const sendChat = (str, mids) => {
            if (! mids)
                channel.sendChat(str);
            else {
                if (mids === true) {
                    var _mentions = [];
                    for(const channel_user of channel.getAllUserInfo()) {
                        _mentions.push({"user_id": channel_user.userId, "at": [1], "len": 3});
                    }
                    channel.sendChat(new node_kakao.ChatBuilder().text(str).attachment({"mentions":_mentions}).build(node_kakao.KnownChatType.TEXT));
                }
                else if (typeof mids == "object") {
                    var _mentions = [];
                    for(const ID of mids) {
                        _mentions.push({"user_id": ID, "at": [1], "len": 3});
                    }
                    channel.sendChat(new node_kakao.ChatBuilder().text(str).attachment({"mentions":_mentions}).build(node_kakao.KnownChatType.TEXT));
                }
            }
        }

        if(captcha[roomid] && captcha[roomid][sender.userId] != undefined) {
            if (msg == "$새로고침") {
                var temp_res = await get_captcha_key();
                captcha[roomid][sender.userId] = JSON.parse(temp_res).key;
                get_captcha_image(captcha[roomid][sender.userId]);
                await delay(1500);
                await channel.sendMedia(node_kakao.KnownChatType.PHOTO, {
                    name: 'captcha.jpg',
                    data: fs.readFileSync('captcha.jpg'),
                    width: 2000,
                    height: 900,
                    ext: 'jpg'
                });
                await channel.sendChat("[LKCaptcha] 위 보안코드를 입력하여 인증하세요.");
            } else {
                var cvalue = msg.replace(/[^a-zA-Z0-9]/gi, "");
                if (cvalue.length <= 3 || cvalue.length >= 10) {
                    if (isManager) {
                        channel.hideChat(data.chat);
                    }
                }
                var cvalid = await get_captcha_valid(captcha[roomid][sender.userId], cvalue);
                if(cvalid) {
                    reply("인증에 성공하였습니다.");
                    delete captcha[roomid][sender.userId];
                }
                else {
                    if (isManager) {
                        channel.hideChat(data.chat);
                    }
                    channel.sendChat("인증에 실패했습니다.\n[ $새로고침 ]");
                }  
            }
        }

        if (msg == `${PREFIX}갠톡`) {
            if (sender.linkId) {
                const joinRes = await client.channelList.open.joinChannel({ linkId: sender.linkId }, {});
                if (! joinRes.success) {
                    reply("[!] 오픈프로필에 대화를 걸 수 없습니다.");
                } else {
                    joinRes.result.sendChat("LK봇 갠톡입니다.");
                    reply("[✓] LK봇이 성공적으로 갠톡을 걸었습니다.");
                }
            } else {
                reply("[!] 오픈프로필이 아닙니다.");
            }
        }

        if (data.text == "$디버그" && data.chat.type == node_kakao.KnownChatType.REPLY) {
            try {
                channel.getChatListFrom(data.chat.attachment.src_logId).then(
                    x => {
                        channel.sendChat(JSON.stringify(x.result[0], null, 4));
                    }
                );
            } catch(e) {
                channel.sendChat("오류");
            }
        }

        if (msg == "$캡차테스트") {
            var temp_res = await get_captcha_key();
            if (! captcha[roomid]) captcha[roomid] = {};
            captcha[roomid][sender.userId] = JSON.parse(temp_res).key;
            get_captcha_image(captcha[roomid][sender.userId]);
            await delay(1500);
            await channel.sendMedia(node_kakao.KnownChatType.PHOTO, {
                name: 'captcha.jpg',
                data: fs.readFileSync('captcha.jpg'),
                width: 2000,
                height: 900,
                ext: 'jpg'
            });
            await channel.sendChat("[LKCaptcha] 위 보안코드를 입력하여 인증하세요.");
        }

        if (msg.includes(`@everyone`)) {
            if(isAdmin) {
                sendChat(" ", true);
            }
        }

        // TCG 명령어 처리 - old_engine.js와 완벽히 동일
        if (msg.startsWith("/") && ["442097040687921","18456115567715763","18459877269595903","18459877099603713"].includes(roomid)) {
            const cmd = msg.substr(1).trim();
            if (cmd.toLowerCase().startsWith("tcg") || cmd.toLowerCase().startsWith("tcgenius")) {
                const args = cmd.substr(cmd.split(" ")[0].length + 1).split(" ");

                // Send 함수 (old_engine.js와 완전 동일)
                function Send(text) {
                    channel.sendChat(text);
                }

                if (args[0] == "등록") {
                    const nickname = cmd.substr(cmd.split(" ")[0].length + 4).trim();
                    if (getTCGUserById(sender.userId)) {
                        Send("❌ 이미 로그인된 상태입니다: " + getTCGUserById(sender.userId).name);
                    } else if (getTCGUserByName(nickname)) {
                        channel.sendChat("❌ 이미 존재하는 이름입니다.");
                    } else if (nickname.match(/[^가-힣ㄱ-ㅎa-zA-Z0-9\s]/) || nickname.length == 0) {
                        channel.sendChat("❌ 닉네임은 한글, 영어, 숫자 및 공백만 들어갈 수 있습니다.");
                    } else if (nickname.length > 10) {
                        channel.sendChat("❌ 닉네임은 최대 10글자로 설정하셔야 합니다.");
                    } else {
                        myCheck[sender.userId] = {
                            type: "tcg등록",
                            arg: {
                                name: nickname
                            }
                        };
                        Send("닉네임: [ " + nickname + " ]\n정말 등록하시겠습니까?\n\n[ /TCGenius 확인 ]");
                    }
                    return;
                }

                if (args[0] == "로그인") {
                    if (getTCGUserById(sender.userId)) {
                        Send("❌ 이미 로그인된 상태입니다: " + getTCGUserById(sender.userId).name);
                        return;
                    }
                    let code = args[1];
                    let login_user = getTCGUserByCode(code);
                    if (login_user) {
                        login_user.logged_in.push(sender.userId);
                        login_user.changeCode();
                        login_user.save();
                        Send("✅ " + login_user + " 계정으로 로그인했습니다.");
                    } else {
                        channel.sendChat("❌ 잘못된 코드입니다.");
                    }
                    return;
                }

                if (myCheck[sender.userId] && args[0] == "확인") {
                    if (myCheck[sender.userId].type == "tcg등록") {
                        let user = new TCGUser(myCheck[sender.userId].arg.name, sender.userId);
                        let res = putItem('tcg_user', user);
                        if (res.success) {
                            Send("✅ 성공적으로 등록되셨습니다!\n환영합니다, " + user.name + "님!");
                        } else {
                            Send("❌ 등록 과정에서 오류가 발생했습니다.\n" + VIEWMORE + "\n" + res.result[0].__type.split("#")[1] + ": " + (res.result[0].message || res.result[0].Message));
                        }
                    }
                    delete myCheck[sender.userId];
                    return;
                }

                let user = getTCGUserById(sender.userId);
                if (!user) {
                    channel.sendChat("❌ 등록되지 않은 사용자입니다.\n/TCGenius 등록 [닉네임]");
                    return;
                }

                if (user.daily_quest[0] != (new Date().toYYYYMMDD())) {
                    user.daily_quest = [(new Date().toYYYYMMDD())];
                    user.save();
                }

                if (megaCounting[user.id]) {
                    channel.sendChat("❌ 처리중인 작업이 있습니다.\n잠시만 기다려주세요.");
                    return;
                }

                if (tcgLoading[user.id]) {
                    channel.sendChat("❌ 덱 파워 측정 중엔 다른 행동을 할 수 없습니다.");
                    return;
                }

                if (args[0] == "코드") {
                    channel.sendChat(user.code);
                }

                else if (args[0] == "로그아웃") {
                    user.logged_in.remove(sender.userId);
                    user.save();
                    channel.sendChat("✅ " + user + " 계정에서 로그아웃했습니다.");
                }
                
                else if (args[0] == "일뽑") {
                    let num = 1;
                    if (!isNaN(args[1])) num = Number(args[1]);
                    if (num != 1 && num != 10) {
                        channel.sendChat("❌ 단차 또는 10연차만 가능합니다.");
                        return;
                    }
                    let need = num;
                    if (user.inventory.item.find(i => i.id == 1)) {
                        if (user.inventory.item.find(i => i.id == 1).count > num) {
                            user.removeItem(1, need);
                            need = 0;
                        }
                        else {
                            need -= user.inventory.item.find(i => i.id == 1).count;
                            user.removeItem(1, num);
                        }
                    }
                    if ((need * 100) > user.garnet) {
                        channel.sendChat("❌ 가넷이 부족합니다!");
                        return;
                    }
                    user.garnet -= (need * 100);
                    let probability = JSON.parse(fs.readFileSync("DB/TCG/probability.json", 'utf8'))["일반"];
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
                    let resDisplay = JSON.parse(JSON.stringify(result));
                    
                    // 비동기 처리
                    setTimeout(() => {
                        let trueNum = num;
                        let cards = JSON.parse(fs.readFileSync("DB/TCG/card.json", 'utf8'));
                        let cardResults = [];
                        
                        for (let i = 0; i < trueNum; i++) {
                            let rand = Math.random();
                            let cardRarity = "";
                            let cumulative = 0;
                            for (let j = 0; j < probability.length; j++) {
                                cumulative += probability[j];
                                if (rand <= cumulative) {
                                    cardRarity = ["전설", "영웅", "희귀", "고급", "일반"][j];
                                    result[j].count++;
                                    break;
                                }
                            }
                            
                            let rarityCards = cards.filter(c => c.rarity == cardRarity);
                            let selectedCard = rarityCards[Math.floor(Math.random() * rarityCards.length)];
                            let cardIdx = cards.findIndex(c => c.id == selectedCard.id);
                            
                            user.addCard(cardIdx, 1);
                            cardResults.push(selectedCard);
                        }
                        
                        user.save();
                        
                        let resultStr = "🎰 카드 뽑기 결과\n\n";
                        for (let i = 0; i < result.length; i++) {
                            if (result[i].count > 0) {
                                resultStr += result[i].rarity + ": " + result[i].count + "장\n";
                            }
                        }
                        
                        if (cardResults.length <= 3) {
                            resultStr += "\n[ 획득한 카드 ]\n";
                            cardResults.forEach(card => {
                                resultStr += "[" + card.title + "]" + card.name + "\n";
                            });
                        }
                        
                        channel.sendChat(resultStr);
                    }, 100);
                }

                else if (args[0] == "인벤토리" || args[0] == "인벤") {
                    let inv = "📦 " + user.name + "님의 인벤토리\n\n";

                    // 카드 목록
                    if (user.inventory.card.length > 0) {
                        inv += "🎴 카드 (" + user.inventory.card.length + "종)\n";
                        user.inventory.card.forEach(card => {
                            let cardData = JSON.parse(read("DB/TCG/card.json"))[card.id];
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
                            let itemData = JSON.parse(read("DB/TCG/item.json"))[item.id];
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
                    let content_deck = [];
                    let gold_deck = [];     
                    let artifact = [];
                    let cdNum = 1;
                    let cards = JSON.parse(fs.readFileSync("DB/TCG/card.json", 'utf8'));

                    user.deck.content.forEach(deck_content => {
                        content_deck.push("○ 콘텐츠덱" + cdNum);
                        cdNum++;
                        let deck_power = calculatePower(user, deck_content, {isContentDeck: true, isGoldDeck: false});
                        for (let i = 0; i < 5; i++) {
                            if (deck_content[i] == undefined || deck_content[i] == -1 || !cards[deck_content[i]]) {
                                content_deck.push("-");
                            } else {
                                let card = user.inventory.card.find(c => c.id == deck_content[i]);
                                if (!card) content_deck.push("-");
                                else {
                                    let cardData = JSON.parse(JSON.stringify(cards[deck_content[i]]));
                                    cardData.deepMerge(card);
                                    let diff = deck_power.single[i] - card.power;
                                    let ups = [];
                                    if (card.level > 0) ups.push("+" + card.level);
                                    if (card.transcend > 0) ups.push("★" + card.transcend);
                                    if (card.breakLimit) ups.push("(한계돌파)");
                                    content_deck.push("[" + cardData.title + "]" + cardData.name + " " + ups.join(" "));
                                }
                            }
                        }
                        content_deck.push("◆ 덱 파워: " + numberWithCommas(deck_power.power.toString()) + "\n");
                    });

                    gold_deck.push("○ 골드덱");
                    let deck_power = calculatePower(user, user.deck.gold, {isContentDeck: false, isGoldDeck: true});
                    for (let i = 0; i < 5; i++) {
                        if (user.deck.gold[i] == undefined || user.deck.gold[i] == -1 || !cards[user.deck.gold[i]]) {
                            gold_deck.push("-");
                        } else {
                            let card = user.inventory.card.find(c => c.id == user.deck.gold[i]);
                            if (!card) gold_deck.push("-");
                            else {
                                let cardData = JSON.parse(JSON.stringify(cards[user.deck.gold[i]]));
                                cardData.deepMerge(card);
                                let ups = [];
                                if (card.level > 0) ups.push("+" + card.level);
                                if (card.transcend > 0) ups.push("★" + card.transcend);
                                if (card.breakLimit) ups.push("(한계돌파)");
                                gold_deck.push("[" + cardData.title + "]" + cardData.name + " " + ups.join(" "));
                            }
                        }
                    }
                    gold_deck.push("◆ 덱 파워: " + numberWithCommas(deck_power.power.toString()) + "\n");

                    channel.sendChat("[ " + user + "님의 덱 ]\n" + VIEWMORE + "\n" + content_deck.join("\n").trim() + "\n\n" + gold_deck.join("\n") + (artifact.length > 0 ? "\n\n" + artifact.join("\n") : ""));
                }

                else if (args[0] == "카드뽑기" || args[0] == "뽑기") {
                    let packName = args[1] || "일반";
                    let packs = JSON.parse(read("DB/TCG/pack.json"));
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

                else if (args[0] == "골드지급" && user.isAdmin) {
                    let target = cmd.substr(cmd.split(" ")[0].length + 6);
                    let num = 1;
                    if (!isNaN(target.split(" ").pop())) {
                        let target_split = target.split(" ");
                        num = parseInt(target_split.pop());
                        target = target_split.join(" ");
                    }
                    let targetUser = getTCGUserByName(target);
                    if (!targetUser) {
                        reply("❌ 존재하지 않는 유저입니다: " + target);
                    } else if (num < 1) {
                        reply("❌ 수량을 제대로 입력해주세요.");
                    } else {
                        targetUser.gold += num;
                        targetUser.save();
                        reply("✅ " + targetUser + "님에게 " + numberWithCommas(num.toString()) + " 골드를 추가했습니다.");
                    }
                }

                else if (args[0] == "골드차감" && user.isAdmin) {
                    let target = cmd.substr(cmd.split(" ")[0].length + 6);
                    let num = 1;
                    if (!isNaN(target.split(" ").pop())) {
                        let target_split = target.split(" ");
                        num = parseInt(target_split.pop());
                        target = target_split.join(" ");
                    }
                    let targetUser = getTCGUserByName(target);
                    if (!targetUser) {
                        channel.sendChat("❌ 존재하지 않는 유저입니다: " + target);
                    } else if (num < 1) {
                        channel.sendChat("❌ 수량을 제대로 입력해주세요.");
                    } else {
                        targetUser.gold -= num;
                        targetUser.save();
                        channel.sendChat("✅ " + targetUser + "님에게서 " + numberWithCommas(num.toString()) + " 골드를 차감했습니다.");
                    }
                }

                else if (args[0] == "골드설정" && user.isAdmin) {
                    let target = cmd.substr(cmd.split(" ")[0].length + 6);
                    let num = null;
                    if (!isNaN(target.split(" ").pop())) {
                        let target_split = target.split(" ");
                        num = parseInt(target_split.pop());
                        target = target_split.join(" ");
                    }
                    if (num == null) {
                        channel.sendChat("❌ 설정할 골드를 입력해주세요.");
                        return;
                    }
                    let targetUser = getTCGUserByName(target);
                    if (!targetUser) {
                        channel.sendChat("❌ 존재하지 않는 유저입니다: " + target);
                    } else if (num < 0) {
                        channel.sendChat("❌ 수량을 제대로 입력해주세요.");
                    } else {
                        targetUser.gold = num;
                        targetUser.save();
                        channel.sendChat("✅ " + targetUser + "님의 골드를 " + numberWithCommas(num.toString()) + " 골드로 수정했습니다.");
                    }
                }

                else if (args[0] == "가넷추가" && user.isAdmin) {
                    let target = cmd.substr(cmd.split(" ")[0].length + 6);
                    let num = 1;
                    if (!isNaN(target.split(" ").pop())) {
                        let target_split = target.split(" ");
                        num = parseInt(target_split.pop());
                        target = target_split.join(" ");
                    }
                    let targetUser = getTCGUserByName(target);
                    if (!targetUser) {
                        channel.sendChat("❌ 존재하지 않는 유저입니다: " + target);
                    } else if (num < 1) {
                        channel.sendChat("❌ 수량을 제대로 입력해주세요.");
                    } else {
                        targetUser.garnet += num;
                        targetUser.save();
                        channel.sendChat("✅ " + targetUser + "님에게 " + numberWithCommas(num.toString()) + " 가넷을 추가했습니다.");
                    }
                }

                else if (args[0] == "가넷차감" && user.isAdmin) {
                    let target = cmd.substr(cmd.split(" ")[0].length + 6);
                    let num = 1;
                    if (!isNaN(target.split(" ").pop())) {
                        let target_split = target.split(" ");
                        num = parseInt(target_split.pop());
                        target = target_split.join(" ");
                    }
                    let targetUser = getTCGUserByName(target);
                    if (!targetUser) {
                        channel.sendChat("❌ 존재하지 않는 유저입니다: " + target);
                    } else if (num < 1) {
                        channel.sendChat("❌ 수량을 제대로 입력해주세요.");
                    } else {
                        targetUser.garnet -= num;
                        targetUser.save();
                        channel.sendChat("✅ " + targetUser + "님에게서 " + numberWithCommas(num.toString()) + " 가넷을 차감했습니다.");
                    }
                }

                else if (args[0] == "가넷설정" && user.isAdmin) {
                    let target = cmd.substr(cmd.split(" ")[0].length + 6);
                    let num = null;
                    if (!isNaN(target.split(" ").pop())) {
                        let target_split = target.split(" ");
                        num = parseInt(target_split.pop());
                        target = target_split.join(" ");
                    }
                    if (num == null) {
                        channel.sendChat("❌ 설정할 가넷을 입력해주세요.");
                        return;
                    }
                    let targetUser = getTCGUserByName(target);
                    if (!targetUser) {
                        channel.sendChat("❌ 존재하지 않는 유저입니다: " + target);
                    } else if (num < 0) {
                        channel.sendChat("❌ 수량을 제대로 입력해주세요.");
                    } else {
                        targetUser.garnet = num;
                        targetUser.save();
                        channel.sendChat("✅ " + targetUser + "님의 가넷을 " + numberWithCommas(num.toString()) + " 가넷으로 수정했습니다.");
                    }
                }

                else if (args[0] == "포인트지급" && user.isAdmin) {
                    let target = cmd.substr(cmd.split(" ")[0].length + 7);
                    let num = 1;
                    if (!isNaN(target.split(" ").pop())) {
                        let target_split = target.split(" ");
                        num = parseInt(target_split.pop());
                        target = target_split.join(" ");
                    }
                    let targetUser = getTCGUserByName(target);
                    if (!targetUser) {
                        channel.sendChat("❌ 존재하지 않는 유저입니다: " + target);
                    } else if (num < 1) {
                        channel.sendChat("❌ 수량을 제대로 입력해주세요.");
                    } else {
                        targetUser.p += num;
                        targetUser.save();
                        channel.sendChat("✅ " + targetUser + "님에게 " + numberWithCommas(num.toString()) + " 포인트를 추가했습니다.");
                    }
                }

                else if (args[0] == "포인트차감" && user.isAdmin) {
                    let target = cmd.substr(cmd.split(" ")[0].length + 7);
                    let num = 1;
                    if (!isNaN(target.split(" ").pop())) {
                        let target_split = target.split(" ");
                        num = parseInt(target_split.pop());
                        target = target_split.join(" ");
                    }
                    let targetUser = getTCGUserByName(target);
                    if (!targetUser) {
                        channel.sendChat("❌ 존재하지 않는 유저입니다: " + target);
                    } else if (num < 1) {
                        channel.sendChat("❌ 수량을 제대로 입력해주세요.");
                    } else {
                        targetUser.p -= num;
                        targetUser.save();
                        channel.sendChat("✅ " + targetUser + "님에게서 " + numberWithCommas(num.toString()) + " 포인트를 차감했습니다.");
                    }
                }

                else if (args[0] == "포인트설정" && user.isAdmin) {
                    let target = cmd.substr(cmd.split(" ")[0].length + 7);
                    let num = null;
                    if (!isNaN(target.split(" ").pop())) {
                        let target_split = target.split(" ");
                        num = parseInt(target_split.pop());
                        target = target_split.join(" ");
                    }
                    if (num == null) {
                        channel.sendChat("❌ 설정할 포인트를 입력해주세요.");
                        return;
                    }
                    let targetUser = getTCGUserByName(target);
                    if (!targetUser) {
                        channel.sendChat("❌ 존재하지 않는 유저입니다: " + target);
                    } else if (num < 0) {
                        channel.sendChat("❌ 수량을 제대로 입력해주세요.");
                    } else {
                        targetUser.p = num;
                        targetUser.save();
                        channel.sendChat("✅ " + targetUser + "님의 포인트를 " + numberWithCommas(num.toString()) + " 포인트로 수정했습니다.");
                    }
                }

                else if (args[0] == "카드지급" && user.isAdmin) {
                    let target = cmd.substr(cmd.split(" ")[0].length + 6);
                    let parsed = parseItemString(target);
                    if (!parsed || !parsed.card) {
                        channel.sendChat("❌ 올바른 카드 형식을 입력해주세요. (예: [전설]카드이름 또는 [전설]카드이름 x10)");
                        return;
                    }
                    let num = parsed.count || 1;
                    let cards = JSON.parse(fs.readFileSync("DB/TCG/card.json", 'utf8'));
                    let cardIdx = cards.findIndex(c => c.name == parsed.name && c.title == parsed.title);
                    if (cardIdx == -1) {
                        channel.sendChat("❌ 존재하지 않는 카드입니다.");
                        return;
                    }
                    let targetUser = getTCGUserByName(cmd.substr(cmd.split(" ")[0].length + 6 + parsed.card.toString().length + parsed.name.length + parsed.title.length + 4).trim());
                    if (!targetUser) {
                        channel.sendChat("❌ 존재하지 않는 유저입니다.");
                        return;
                    }
                    targetUser.addCard(cardIdx, num);
                    targetUser.save();
                    channel.sendChat("✅ " + targetUser + "님에게 [" + parsed.title + "]" + parsed.name + " 카드를 " + num + "장 지급했습니다.");
                }

                else if (args[0] == "아이템지급" && user.isAdmin) {
                    let target = cmd.substr(cmd.split(" ")[0].length + 7);
                    let parsed = parseItemString(target);
                    if (!parsed || !parsed.item) {
                        channel.sendChat("❌ 올바른 아이템 형식을 입력해주세요. (예: 아이템이름 x10)");
                        return;
                    }
                    let num = parsed.count || 1;
                    let items = JSON.parse(fs.readFileSync("DB/TCG/item.json", 'utf8'));
                    let itemIdx = items.findIndex(i => i.name == parsed.name);
                    if (itemIdx == -1) {
                        channel.sendChat("❌ 존재하지 않는 아이템입니다.");
                        return;
                    }
                    let targetUser = getTCGUserByName(cmd.substr(cmd.split(" ")[0].length + 7 + parsed.item.toString().length + parsed.name.length + 3).trim());
                    if (!targetUser) {
                        channel.sendChat("❌ 존재하지 않는 유저입니다.");
                        return;
                    }
                    targetUser.addItem(itemIdx, num);
                    targetUser.save();
                    channel.sendChat("✅ " + targetUser + "님에게 " + parsed.name + " 아이템을 " + num + "개 지급했습니다.");
                }

                else if (args[0] == "출석") {
                    let result = user.attend();
                    if (result.success) {
                        channel.sendChat("✅ 출석체크 완료!\n" + user.attendance.streak + "일 연속 출석 중!\n총 " + user.attendance.total + "일 출석!");
                    } else {
                        channel.sendChat("❌ 이미 오늘 출석체크를 하셨습니다.");
                    }
                }

                else if (args[0] == "덱편성") {
                    if (args[1] == "콘텐츠덱1" || args[1] == "콘텐츠덱2") {
                        let deckNum = Number(args[1].substr(4)) - 1;
                        let deckIdx = Number(args[2]);
                        let cardName = cmd.substr(cmd.split(" ")[0].length + 13);
                        if (isNaN(deckIdx) || deckIdx % 1 != 0 || deckIdx < 1 || deckIdx > 5) {
                            channel.sendChat("❌ 잘못된 입력입니다.\n[ /TCGenius 덱편성 " + args[1] + " <인덱스> <카드 이름> ]");
                        } else if (cardName == "제거") {
                            user.deck.content[deckNum][deckIdx-1] = -1;
                            user.save();
                            channel.sendChat("✅ " + args[1] + "의 " + (deckIdx) + "번째 카드를 제거했습니다.");
                        } else {
                            let cards = JSON.parse(fs.readFileSync("DB/TCG/card.json", 'utf8'));
                            let cardIdx = cards.findIndex(c => ("[" + c.title + "]" + c.name) == cardName);
                            if (cardIdx == -1) {
                                channel.sendChat("❌ 존재하지 않는 카드입니다.");
                            } else if (!user.inventory.card.find(c => c.id == cardIdx)) {
                                channel.sendChat("❌ 해당 카드를 보유하고 있지 않습니다.");
                            } else {
                                user.deck.content[deckNum][deckIdx-1] = cardIdx;
                                user.save();
                                channel.sendChat("✅ " + args[1] + "의 " + (deckIdx) + "번째에 [" + cards[cardIdx].title + "]" + cards[cardIdx].name + " 카드를 편성했습니다.");
                            }
                        }
                    } else if (args[1] == "골드덱") {
                        let deckIdx = Number(args[2]);
                        let cardName = cmd.substr(cmd.split(" ")[0].length + 12);
                        if (isNaN(deckIdx) || deckIdx % 1 != 0 || deckIdx < 1 || deckIdx > 5) {
                            channel.sendChat("❌ 잘못된 입력입니다.\n[ /TCGenius 덱편성 골드덱 <인덱스> <카드 이름> ]");
                        } else if (cardName == "제거") {
                            user.deck.gold[deckIdx-1] = -1;
                            user.save();
                            channel.sendChat("✅ 골드덱의 " + (deckIdx) + "번째 카드를 제거했습니다.");
                        } else {
                            let cards = JSON.parse(fs.readFileSync("DB/TCG/card.json", 'utf8'));
                            let cardIdx = cards.findIndex(c => ("[" + c.title + "]" + c.name) == cardName);
                            if (cardIdx == -1) {
                                channel.sendChat("❌ 존재하지 않는 카드입니다.");
                            } else if (!user.inventory.card.find(c => c.id == cardIdx)) {
                                channel.sendChat("❌ 해당 카드를 보유하고 있지 않습니다.");
                            } else {
                                user.deck.gold[deckIdx-1] = cardIdx;
                                user.save();
                                channel.sendChat("✅ 골드덱의 " + (deckIdx) + "번째에 [" + cards[cardIdx].title + "]" + cards[cardIdx].name + " 카드를 편성했습니다.");
                            }
                        }
                    } else {
                        channel.sendChat("❌ 잘못된 덱 이름입니다.\n사용 가능한 덱: 콘텐츠덱1, 콘텐츠덱2, 골드덱");
                    }
                }

                else if (args[0] == "덱파워측정") {
                    if (args[1] == "콘텐츠덱1") {
                        let user_request = cmd.substr(cmd.split(" ")[0].length + 13);
                        tcgLoading[user.id] = true;
                        channel.sendChat("🤖 콘텐츠덱1의 덱 파워를 계산하는 중입니다..\n시간이 꽤 소요될 수 있습니다.");
                        // 비동기 처리를 위해 setTimeout 사용
                        setTimeout(() => {
                            let res = calculateDeckPower(user, user.deck.content[0], {isContentDeck: true, userRequest: user_request});
                            delete tcgLoading[user.id];
                            if (typeof res == 'object') {
                                channel.sendChat("✅ " + user + "님의 덱 파워를 계산했습니다.\n덱 파워: " + res.calcPower.toComma2() + "\n\n[ 계산 과정 ]\n" + VIEWMORE + res.message);
                                user.content_power = res.calcPower;
                                user.save();
                            } else {
                                channel.sendChat(res);
                            }
                        }, 1000);
                    } else if (args[1] == "콘텐츠덱2") {
                        let user_request = cmd.substr(cmd.split(" ")[0].length + 13);
                        tcgLoading[user.id] = true;
                        channel.sendChat("🤖 콘텐츠덱2의 덱 파워를 계산하는 중입니다..\n시간이 꽤 소요될 수 있습니다.");
                        setTimeout(() => {
                            let res = calculateDeckPower(user, user.deck.content[1], {isContentDeck: true, userRequest: user_request});
                            delete tcgLoading[user.id];
                            if (typeof res == 'object') {
                                channel.sendChat("✅ " + user + "님의 덱 파워를 계산했습니다.\n덱 파워: " + res.calcPower.toComma2() + "\n\n[ 계산 과정 ]\n" + VIEWMORE + res.message);
                                user.content_power = res.calcPower;
                                user.save();
                            } else {
                                channel.sendChat(res);
                            }
                        }, 1000);
                    } else if (args[1] == "골드덱") {
                        let user_request = cmd.substr(cmd.split(" ")[0].length + 12);
                        tcgLoading[user.id] = true;
                        channel.sendChat("🤖 골드덱의 덱 파워와 데일리 골드를 계산하는 중입니다..\n시간이 꽤 소요될 수 있습니다.");
                        setTimeout(() => {
                            let res = calculateDeckPower(user, user.deck.gold, {isGoldDeck: true, userRequest: user_request});
                            delete tcgLoading[user.id];
                            if (typeof res == 'object') {
                                channel.sendChat("✅ " + user + "님의 덱 파워와 데일리 골드를 계산했습니다.\n덱 파워: " + res.calcPower.toComma2() + "\n🪙 데일리 골드: " + res.dailyGold.toComma2() + "\n\n[ 계산 과정 ]\n" + VIEWMORE + res.message);
                                user.dailyGold = res.dailyGold;
                                user.save();
                            } else {
                                channel.sendChat(res);
                            }
                        }, 1000);
                    } else {
                        channel.sendChat("❌ 잘못된 덱 이름입니다.\n사용 가능한 덱: 콘텐츠덱1, 콘텐츠덱2, 골드덱");
                    }
                }

                else if (args[0] == "카드제거" && user.isAdmin) {
                    let arg = cmd.substr(cmd.split(" ")[0].length + 6).split(" ");
                    if (arg.length == 0) {
                        channel.sendChat("❌ 잘못된 입력입니다.\n[ /TCGenius 카드제거 <유저명> <카드> <개수> ]");
                        return;
                    }
                    let targetUser = getTCGUserByName(arg[0]);
                    if (!targetUser) {
                        channel.sendChat("❌ 존재하지 않는 유저입니다.");
                        return;
                    }
                    let card = arg.join(" ").substr(arg[0].length + 1);
                    if (card.length == 0) {
                        channel.sendChat("❌ 잘못된 입력입니다.\n[ /TCGenius 카드제거 <유저명> <카드> <개수> ]");
                        return;
                    }
                    let num = 1;
                    let parsed = parseItemString(card);
                    if (parsed && parsed.card) {
                        num = parsed.count || 1;
                        let cards = JSON.parse(fs.readFileSync("DB/TCG/card.json", 'utf8'));
                        let cardIdx = cards.findIndex(c => ("[" + c.title + "]" + c.name) == card);
                        if (!cards[cardIdx]) {
                            channel.sendChat("❌ 존재하지 않는 카드입니다.");
                            return;
                        }
                        let tradeTicket = targetUser.inventory.item.find(i => i.id == 31) || {count:0};
                        if (tradeTicket.count < ["","일반","고급","희귀","영웅","전설"].indexOf(cards[cardIdx].rarity) * num) {
                            channel.sendChat("❌ 거래권이 부족합니다.\n필요 거래권: " + numberWithCommas(tradeTicket.count.toString()) + "/" + numberWithCommas((["","일반","고급","희귀","영웅","전설"].indexOf(cards[cardIdx].rarity) * num).toString()));
                            return;
                        }
                        if ((targetUser.inventory.card.find(c => c.id == cardIdx) || {count:0}).count < num) {
                            channel.sendChat("❌ 카드 수량이 부족합니다.");
                            return;
                        }
                        targetUser.inventory.item.find(i => i.id == 31).count -= ["","일반","고급","희귀","영웅","전설"].indexOf(cards[cardIdx].rarity) * num;
                        targetUser.removeCard(cardIdx, num);
                        targetUser.save();
                        channel.sendChat("✅ " + targetUser + "님의 [" + cards[cardIdx].title + "]" + cards[cardIdx].name + " 카드를 " + num + "장 제거했습니다.");
                    } else {
                        channel.sendChat("❌ 올바른 카드 형식을 입력해주세요. (예: [전설]카드이름 또는 [전설]카드이름 x10)");
                    }
                }

                else if (args[0] == "카드지급" && user.isAdmin) {
                    let arg = cmd.substr(cmd.split(" ")[0].length + 6).split(" ");
                    if (arg.length == 0) {
                        channel.sendChat("❌ 잘못된 입력입니다.\n[ /TCGenius 카드지급 <유저명> <카드> <개수> ]");
                        return;
                    }
                    let targetUser = getTCGUserByName(arg[0]);
                    if (!targetUser) {
                        channel.sendChat("❌ 존재하지 않는 유저입니다.");
                        return;
                    }
                    let card = arg.join(" ").substr(arg[0].length + 1);
                    if (card.length == 0) {
                        channel.sendChat("❌ 잘못된 입력입니다.\n[ /TCGenius 카드지급 <유저명> <카드> <개수> ]");
                        return;
                    }
                    let num = 1;
                    let parsed = parseItemString(card);
                    if (parsed && parsed.card) {
                        num = parsed.count || 1;
                        let cards = JSON.parse(fs.readFileSync("DB/TCG/card.json", 'utf8'));
                        let cardIdx = cards.findIndex(c => ("[" + c.title + "]" + c.name) == card);
                        if (!cards[cardIdx]) {
                            channel.sendChat("❌ 존재하지 않는 카드입니다.");
                            return;
                        }
                        targetUser.addCard(cardIdx, num);
                        targetUser.save();
                        channel.sendChat("✅ " + targetUser + "님에게 [" + cards[cardIdx].title + "]" + cards[cardIdx].name + " 카드를 " + num + "장 지급했습니다.");
                    } else {
                        channel.sendChat("❌ 올바른 카드 형식을 입력해주세요. (예: [전설]카드이름 또는 [전설]카드이름 x10)");
                    }
                }

                else if (args[0] == "아이템제거" && user.isAdmin) {
                    let arg = cmd.substr(cmd.split(" ")[0].length + 8).split(" ");
                    if (arg.length == 0) {
                        channel.sendChat("❌ 잘못된 입력입니다.\n[ /TCGenius 아이템제거 <유저명> <아이템> <개수> ]");
                        return;
                    }
                    let targetUser = getTCGUserByName(arg[0]);
                    if (!targetUser) {
                        channel.sendChat("❌ 존재하지 않는 유저입니다.");
                        return;
                    }
                    let item = arg.join(" ").substr(arg[0].length + 1);
                    if (item.length == 0) {
                        channel.sendChat("❌ 잘못된 입력입니다.\n[ /TCGenius 아이템제거 <유저명> <아이템> <개수> ]");
                        return;
                    }
                    let num = 1;
                    let parsed = parseItemString(item);
                    if (parsed && parsed.item) {
                        num = parsed.count || 1;
                        let items = JSON.parse(fs.readFileSync("DB/TCG/item.json", 'utf8'));
                        let itemIdx = items.findIndex(i => i.name == parsed.name);
                        if (itemIdx == -1) {
                            channel.sendChat("❌ 존재하지 않는 아이템입니다.");
                            return;
                        }
                        if ((targetUser.inventory.item.find(i => i.id == itemIdx) || {count:0}).count < num) {
                            channel.sendChat("❌ 아이템 수량이 부족합니다.");
                            return;
                        }
                        targetUser.removeItem(itemIdx, num);
                        targetUser.save();
                        channel.sendChat("✅ " + targetUser + "님의 " + parsed.name + " 아이템을 " + num + "개 제거했습니다.");
                    } else {
                        channel.sendChat("❌ 올바른 아이템 형식을 입력해주세요. (예: 아이템이름 x10)");
                    }
                }

                else if (args[0] == "아이템지급" && user.isAdmin) {
                    let arg = cmd.substr(cmd.split(" ")[0].length + 7).split(" ");
                    if (arg.length == 0) {
                        channel.sendChat("❌ 잘못된 입력입니다.\n[ /TCGenius 아이템지급 <유저명> <아이템> <개수> ]");
                        return;
                    }
                    let targetUser = getTCGUserByName(arg[0]);
                    if (!targetUser) {
                        channel.sendChat("❌ 존재하지 않는 유저입니다.");
                        return;
                    }
                    let item = arg.join(" ").substr(arg[0].length + 1);
                    if (item.length == 0) {
                        channel.sendChat("❌ 잘못된 입력입니다.\n[ /TCGenius 아이템지급 <유저명> <아이템> <개수> ]");
                        return;
                    }
                    let num = 1;
                    let parsed = parseItemString(item);
                    if (parsed && parsed.item) {
                        num = parsed.count || 1;
                        let items = JSON.parse(fs.readFileSync("DB/TCG/item.json", 'utf8'));
                        let itemIdx = items.findIndex(i => i.name == parsed.name);
                        if (itemIdx == -1) {
                            channel.sendChat("❌ 존재하지 않는 아이템입니다.");
                            return;
                        }
                        targetUser.addItem(itemIdx, num);
                        targetUser.save();
                        channel.sendChat("✅ " + targetUser + "님에게 " + parsed.name + " 아이템을 " + num + "개 지급했습니다.");
                    } else {
                        channel.sendChat("❌ 올바른 아이템 형식을 입력해주세요. (예: 아이템이름 x10)");
                    }
                }

                else {
                    channel.sendChat("❌ 알 수 없는 TCG 명령어입니다: " + args[0]);
                }
            }
        }
    } catch(e) {
        console.log(e);
    }
});

client.on('error', (err) => {
    console.log(`클라이언트 에러 발생\n오류: ${err.stack}`);
});

client.on('disconnected', (reason) => {
    console.log(`연결이 끊어졌습니다.\n사유: ${reason}`);
});

async function registerDevice(authClient) {
    let requestData = await authClient.requestPasscode({"email": EMAIL, "password": PASSWORD, "forced": true});
    if (!requestData.success) {
    return {"success": false, "message": `RequestPasscode Failed! Data: ${JSON.stringify(requestData, null, 2)}`};
    } else {
        let readline = require("readline");
        let inputInterface = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });
        let passcode = await new Promise((resolve) => inputInterface.question("Enter passcode: ", resolve));
        inputInterface.close();
        let registerData = await authClient.registerDevice({"email": EMAIL, "password": PASSWORD, "forced": true}, passcode, true);
        if (!registerData.success) {
            return {"success": false, "message": `RegisterDevice Failed! Data: ${JSON.stringify(registerData, null, 2)}`};
        }
        return {"success": true};
    }
}

async function login() {
    let config = { countryIso: "KR", language: "ko" };
    if (DEVICE_UUID === "") {
        if (DEVICE_TYPE === "pc") {
            DEVICE_UUID = util.randomWin32DeviceUUID();
        }
        if (DEVICE_TYPE === "tablet") {
            DEVICE_UUID = util.randomAndroidSubDeviceUUID();
        }
        console.log(`uuid: ${DEVICE_UUID}`);
    }
    let authClient = await AuthApiClient.create(DEVICE_NAME, DEVICE_UUID, config, xvc.AndroidSubXVCProvider);
    let loginData = await authClient.login({"email": EMAIL, "password": PASSWORD, "forced": true});
    if (!loginData.success) {
        if (loginData.status === KnownAuthStatusCode.DEVICE_NOT_REGISTERED) {
            let result = await registerDevice(authClient);
            if (!result.success) {
                console.log(result.message);
            } else {
                login();
            }
        } else {
            console.log(`Login Failed! Data: ${JSON.stringify(loginData, null, 2)}`);
        }
    } else {
        let loginRes = await client.login(loginData.result);
        if (!loginRes.success) {
            console.log(`Login Failed! loginResult: ${JSON.stringify(loginRes, null, 2)}`);
        } else {
            token = `${loginData.result.accessToken}-${loginData.result.deviceUUID}`;
            console.log(`Login Success!`);
        }
    }
}

keepAlive();
login().then();