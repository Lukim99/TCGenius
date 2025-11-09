const node_kakao = require('node-kakao');
const fs = require('fs');
const express = require('express');
const request = require('request');
const keepAlive = require('./server.js');
const { TalkClient, AuthApiClient, xvc, KnownAuthStatusCode, util, AttachmentApi } = require("node-kakao");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const VIEWMORE = ('\u200e'.repeat(500));

// AWS DynamoDB 설정
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, QueryCommand, DeleteCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");

const AWSCFG = {
    accessKeyId: "AKIAXQIQADH3NM4KOREA",
    secretAccessKey: "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",
    region: "ap-northeast-2"
};

const dynamoClient = new DynamoDBClient({
    region: AWSCFG.region,
    credentials: {
        accessKeyId: AWSCFG.accessKeyId,
        secretAccessKey: AWSCFG.secretAccessKey
    }
});

const docClient = DynamoDBDocumentClient.from(dynamoClient);

// LLM API Keys
const ClaudeAPIKEY = "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";
const DeepSeekAPIKEY = "sk-f69fae2f328345d7a2d4fd0ffe5dc7db";

const DEVICE_TYPE = "tablet";
let DEVICE_UUID = "5606ca740cfb9cc2fe620e6d83b68a9041303bf045170d40ad6f9c4f99a21a";
const DEVICE_NAME = "uDevice";
const EMAIL = "lukim9_sub@kakao.com";
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
    // var captcha_key = JSON.parse(await get_captcha_key()).key;
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

var CHOSEONG = ["ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"],
	JUNGSEONG = ["ㅏ", "ㅐ", "ㅑ", "ㅒ", "ㅓ", "ㅔ", "ㅕ", "ㅖ", "ㅗ", "ㅘ", "ㅙ", "ㅚ", "ㅛ", "ㅜ", "ㅝ", "ㅞ", "ㅟ", "ㅠ", "ㅡ", "ㅢ", "ㅣ"],
	JONGSEONG = ["", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ", "ㄻ", "ㄼ", "ㄽ", "ㄾ", "ㄿ", "ㅀ", "ㅁ", "ㅂ", "ㅄ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"],
	CHOSEONG_LEN = CHOSEONG.length,
	JUNGSEONG_LEN = JUNGSEONG.length,
	JONGSEONG_LEN = JONGSEONG.length;

var HANGUL_FIRST_CODE = '가'.charCodeAt(0),
	HANGUL_LAST_CODE = '힣'.charCodeAt(0);

// TCGenius 전역 변수
let myCheck = {};
let megaCounting = {};
let tcgLoading = {};
let combQueue = {};
let chooseCard = {};
let tcgRaid = {};
let editPack = {};
let raidParties = {}; // 레이드 파티 관리 {partyId: {members: [], difficulty: "", phase: 1, ...}}

// 유틸리티 함수
function numberWithCommas(x) {
    return x.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function pad_num(kor, max_len) {
    if (typeof kor != 'string') kor = kor.toString();
    max_len = max_len || 2;
    if(kor.length >= max_len)
        return kor;
    return (new Array(max_len - kor.length + 1).join("0")) + kor;
}

function pad_han(kor, max_len) {
    if(kor.length >= max_len)
        return kor;
    return kor + (new Array(max_len - kor.length + 1).join("ㅤ"));
}

// Prototype 확장
Number.prototype.toComma = function() {
    var abs = Math.abs(this),
        formatted,
        suffix;

    if (abs >= 1e52) {
        formatted = (this / 1e52).fix();
        suffix = "극";
    } else if (abs >= 1e48) {
        formatted = (this / 1e48).fix();
        suffix = "항하사";
    } else if (abs >= 1e44) {
        formatted = (this / 1e44).fix();
        suffix = "불가사의";
    } else if (abs >= 1e40) {
        formatted = (this / 1e40).fix();
        suffix = "아승기";
    } else if (abs >= 1e36) {
        formatted = (this / 1e36).fix();
        suffix = "나유타";
    } else if (abs >= 1e32) {
        formatted = (this / 1e32).fix();
        suffix = "간";
    } else if (abs >= 1e28) {
        formatted = (this / 1e28).fix();
        suffix = "양";
    } else if (abs >= 1e24) {
        formatted = (this / 1e24).fix();
        suffix = "자";
    } else if (abs >= 1e20) {
        formatted = (this / 1e20).fix();
        suffix = "해";
    } else if (abs >= 1e16) {
        formatted = (this / 1e16).fix();
        suffix = "경";
    } else if (abs >= 1e12) {
        formatted = (this / 1e12).fix();
        suffix = "조";
    } else if (abs >= 1e8) {
        formatted = (this / 1e8).fix();
        suffix = "억";
    } else if (abs >= 1e4) {
        formatted = (this / 1e4).fix();
        suffix = "만";
    } else {
        formatted = this;
        suffix = "";
    }

    return numberWithCommas(formatted.toString()) + suffix;
}

Number.prototype.toComma2 = function() {
    return numberWithCommas(this.toString());
}

Number.prototype.fix = function(num) {
    if (!num) num = 2;
    return Math.round(this * Math.pow(10, num)) / Math.pow(10, num);
}

Array.prototype.getRandomElement = function() {
    return this[Math.floor(Math.random() * this.length)];
}

Array.prototype.unique = function() {
    var seen = {};
    var unique = [];
    for (var i = 0; i < this.length; i++) {
        if (!seen[this[i]]) {
            seen[this[i]] = true;
            unique.push(this[i]);
        }
    }
    return unique;
}

Array.prototype.multiplyKey = function(key, n) {
    for (var i = 0; i < this.length; i++) {
        if (this[i].hasOwnProperty(key) && typeof this[i][key] === "number") {
            this[i][key] = this[i][key] * n;
        }
    }
    return this;
}

Object.defineProperty(Object.prototype, 'deepMerge', {
    value: function(source) {
        if (typeof source !== 'object') {
            return source;
        }
    
        for (var key in source) {
            if (source.hasOwnProperty(key)) {
                if (typeof source[key] === 'object' && !Array.isArray(source[key])) {
                    if (!this[key] || typeof this[key] !== 'object') {
                        this[key] = {};
                    }
                    this[key].deepMerge(source[key]);
                } else {
                    this[key] = source[key];
                }
                if (source[key] == null) {
                    delete this[key];
                }
            }
        }
    },
    enumerable: false
});

Object.defineProperty(Object.prototype, 'concat', {
    value: function() {
        return JSON.parse(JSON.stringify(this));
    },
    enumerable: false
});

Date.prototype.toYYYYMMDD = function() {
    return this.getFullYear() + "-" + pad_num(this.getMonth() + 1) + "-" + pad_num(this.getDate());
}

// DynamoDB 헬퍼 함수들 (Node.js async/await 방식)
async function getItem(table, id) {
    try {
        const command = new GetCommand({
            TableName: table,
            Key: { id: id }
        });
        const response = await docClient.send(command);
        return { success: true, result: [response] };
    } catch (error) {
        return { success: false, error: error };
    }
}

async function putItem(table, item) {
    try {
        const command = new PutCommand({
            TableName: table,
            Item: item
        });
        const response = await docClient.send(command);
        return { success: true, result: [response] };
    } catch (error) {
        return { success: false, result: [error] };
    }
}

async function updateItem(table, id, data) {
    try {
        let updateExpression = "SET " + Object.keys(data).filter(d => d != "id").map(d => "#" + d + "=:new_" + d).join(",");
        let expressionAttributeNames = {};
        let expressionAttributeValues = {};
        Object.keys(data).filter(d => d != "id").forEach(e => {
            expressionAttributeNames["#" + e] = e;
            expressionAttributeValues[":new_" + e] = data[e];
        });
        
        const command = new UpdateCommand({
            TableName: table,
            Key: { id: id },
            UpdateExpression: updateExpression,
            ExpressionAttributeNames: expressionAttributeNames,
            ExpressionAttributeValues: expressionAttributeValues
        });
        const response = await docClient.send(command);
        return { success: true, result: [response] };
    } catch (error) {
        return { success: false, error: error };
    }
}

async function queryItems(params) {
    try {
        const command = new QueryCommand(params);
        const response = await docClient.send(command);
        return { success: true, result: [response] };
    } catch (error) {
        return { success: false, error: error };
    }
}

// TCG 관련 헬퍼 함수들
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

function printCard(cardData) {
    var GROW = {
        "일반": {lv:1, tr:3, maxLv:5, maxTr:4}, "고급":{lv:2, tr:6, maxLv:5, maxTr:4},
        "희귀": {lv:3, tr:9, maxLv:7, maxTr:6}, "영웅":{lv:4, tr:15, maxLv:9, maxTr:8},
        "전설": {lv:5, tr:25, maxLv:12, maxTr:10}
    };
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
    }

    let cardStar = (cardData.rarity ? (cardData.transcend ? Array(cardData.transcend + 1).join("★") + Array(maxTranscend[cardData.rarity] - cardData.transcend + 1).join("☆") : Array(maxTranscend[cardData.rarity] + 1).join("☆")) : "");
    let cardName = (cardData.title ? "[" + cardData.title + "]" : "[unknown]") + (cardData.name ? cardData.name : "unknown");
    let cardLevel = (cardData.level ? "+" + cardData.level : "+0");
    let cardPower = (cardData.power ? "P" + (cardData.power + (cardData.rarity ? (cardData.level ? GROW[cardData.rarity].lv * cardData.level : 0) + (cardData.transcend ? GROW[cardData.rarity].tr * cardData.transcend : 0) : 0)) : "");
    let cardDesc = (cardData.desc && cardData.desc != "" ? "'" + cardData.desc + "'" : "");
    return (cardStar + " " + cardName + " " + cardLevel + " " + cardPower + " " + cardDesc).trim();
}

async function checkCardLevelUp(card, invCard, channel) {
    let needExp = {
        "일반": 1000,
        "고급": 10000,
        "희귀": 50000,
        "영웅": 160000,
        "전설": 400000
    };
    let maxLevels = {
        "일반": 1,
        "고급": 2,
        "희귀": 3,
        "영웅": 4,
        "전설": 5
    };
    let isGrowth = (card.title == "성장형");
    while(true) {
        if (needExp[card.rarity] > invCard.exp) break;
        if ((maxLevels[card.rarity] + (card.breakLimit ? 1 : 0)) <= invCard.level) break;
        invCard.exp -= needExp[card.rarity];
        invCard.level += 1;
        if (card.title == "성장형" && invCard.rarity != "전설" && maxLevels[invCard.rarity] == invCard.level && invCard.transcend == invCard.level) {
            invCard.rarity = ["일반","고급","희귀","영웅","전설"][["일반","고급","희귀","영웅"].indexOf(card.rarity) + 1];
            card.rarity = invCard.rarity;
        }
        if (!isGrowth && (maxLevels[card.rarity] + (invCard.breakLimit ? 1 : 0)) <= invCard.level) {
            invCard.overExp = invCard.exp;
            invCard.exp = 0;
        }
        await channel.sendChat("⬆️ [" + card.title + "]" + card.name + " 카드가 레벨업했습니다!\nLv." + (invCard.level - 1) + " ▶ Lv." + invCard.level + "\n(" + numberWithCommas(invCard.exp.toString()) + "/" + numberWithCommas(needExp[card.rarity].toString()) + ")");
    }
}

function printPack(pack, type, front) {
    let rarityMark = {
        "일반": "⚪ ",
        "레어": "🟡 ",
        "유니크": "🟣 "
    }
    type = type || '\n';
    front = front || "";
    let res = [];
    pack.forEach(reward => {
        let count = reward.count;
        if (typeof count == 'object') {
            count = count.min.toComma2() + " ~ " + count.max.toComma2();
        } else {
            count = count.toComma2();
        }
        if (reward.gold) {
            res.push(front + (reward.rarity ? rarityMark[reward.rarity] : "") + count + "골드");
            return;
        }
        if (reward.garnet) {
            res.push(front + (reward.rarity ? rarityMark[reward.rarity] : "") + count + "가넷");
            return;
        }
        if (reward.item) {
            res.push(front + (reward.rarity ? rarityMark[reward.rarity] : "") + reward.name + (reward.count > 1 ? " x" + count : ""));
            return;
        }
        if (reward.card) {
            res.push(front + (reward.rarity ? rarityMark[reward.rarity] : "") + "[" + reward.title + "]" + reward.name + (reward.count > 1 ? " x" + count : ""));
            return;
        }
    });
    return res.join(type);   
}

// TCGUser 클래스 (ES6 Class)
class TCGUser {
    constructor(name, id) {
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
        };
        this.deck = {
            content: [[-1,-1,-1,-1,-1],[-1,-1,-1,-1,-1]],
            gold: [-1,-1,-1,-1,-1]
        };
        this.inventory = {
            item: [],
            card: []
        };
        this.pickupStack = {};
        this.title = null;
        this.titles = [];
        this.dailyGold = 0;
        this.shopLimit = {
            daily: [],
            weekly: [],
            weeklyResetAt: null,
            lifetime: []
        };
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
        // 새로운 덱 파워 시스템
        this.deck_power_5man = 0;    // 5인공격대 파워
        this.deck_power_duo = 0;     // 듀오공격대 파워
        this.deck_power_pure = 0;    // 보정공격대 파워 (순수)
        // 해방 시스템
        this.liberation = {
            content1: {
                liberated: false,
                rank: 0, // 0: 브론즈, 1: 실버, 2: 골드, 3: 플래티넘
                dice_count: {
                    dim: 0,
                    bright: 0,
                    brilliant: 0,
                    fate: 0,
                    judgment: 0
                },
                bonuses: [],
                pendingChoice: null
            },
            content2: {
                liberated: false,
                rank: 0,
                dice_count: {
                    dim: 0,
                    bright: 0,
                    brilliant: 0,
                    fate: 0,
                    judgment: 0
                },
                bonuses: [],
                pendingChoice: null
            },
            gold: {
                liberated: false,
                rank: 0,
                dice_count: {
                    dim: 0,
                    bright: 0,
                    brilliant: 0,
                    fate: 0,
                    judgment: 0
                },
                bonuses: [],
                pendingChoice: null
            }
        };
    }

    load(data) {
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
            weekly: [],
            weeklyResetAt: null,
            lifetime: []
        };
        // 호환성: 과거 데이터에 weekly 필드가 없을 수 있음
        if (!this.shopLimit.weekly) this.shopLimit.weekly = [];
        if (typeof this.shopLimit.weeklyResetAt === 'undefined') this.shopLimit.weeklyResetAt = null;
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
        // 새로운 덱 파워 시스템
        this.deck_power_5man = data.deck_power_5man || 0;
        this.deck_power_duo = data.deck_power_duo || 0;
        this.deck_power_pure = data.deck_power_pure || 0;
        // 해방 시스템
        if (data.liberation && data.liberation.content1) {
            this.liberation = data.liberation;
        } else {
            this.liberation = {
                content1: {
                    liberated: false,
                    rank: 0,
                    dice_count: {
                        dim: 0,
                        bright: 0,
                        brilliant: 0,
                        fate: 0,
                        judgment: 0
                    },
                    bonuses: [],
                    pendingChoice: null
                },
                content2: {
                    liberated: false,
                    rank: 0,
                    dice_count: {
                        dim: 0,
                        bright: 0,
                        brilliant: 0,
                        fate: 0,
                        judgment: 0
                    },
                    bonuses: [],
                    pendingChoice: null
                },
                gold: {
                    liberated: false,
                    rank: 0,
                    dice_count: {
                        dim: 0,
                        bright: 0,
                        brilliant: 0,
                        fate: 0,
                        judgment: 0
                    },
                    bonuses: [],
                    pendingChoice: null
                }
            };
        }

        return this;
    }

    toString() {
        return (this.title ? "[" + this.title + "] " : "") + this.name;
    }

    async save() {
        await updateItem('tcg_user', this.id, this);
    }

    async changeCode() {
        this.code = getRandomString(10).toUpperCase();
        await this.save();
    }

    addItem(itemIdx, count) {
        let item = JSON.parse(read("DB/TCG/item.json"))[itemIdx];
        if (!item) return false;
        
        const existingItem = this.inventory.item.find(i => i.id == itemIdx);
        if (existingItem) {
            existingItem.count += count;
        } else {
            this.inventory.item.push({
                id: itemIdx,
                count: count
            });
        }
        return true;
    }

    removeItem(itemIdx, count) {
        const existingItem = this.inventory.item.find(i => i.id == itemIdx);
        if (!existingItem) {
            return false;
        }
        
        existingItem.count -= count;
        if (existingItem.count <= 0) {
            this.inventory.item.splice(this.inventory.item.findIndex(i => i.id == itemIdx), 1);
        }
        return true;
    }

    addCard(cardIdx, count) {
        let card = JSON.parse(read("DB/TCG/card.json"))[cardIdx];
        if (!card) return false;
        
        const existingCard = this.inventory.card.find(i => i.id == cardIdx);
        if (existingCard) {
            existingCard.count += count;
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

    removeCard(cardIdx, count) {
        const existingCard = this.inventory.card.find(i => i.id == cardIdx);
        if (!existingCard) {
            return false;
        }
        
        existingCard.count -= count;
        if (existingCard.count <= 0) {
            this.inventory.card.splice(this.inventory.card.findIndex(i => i.id == cardIdx), 1);
            if (this.deck.content[0].includes(cardIdx)) {
                this.deck.content[0][this.deck.content[0].indexOf(cardIdx)] = -1;
            }
            if (this.deck.content[1].includes(cardIdx)) {
                this.deck.content[1][this.deck.content[1].indexOf(cardIdx)] = -1;
            }
            if (this.deck.gold.includes(cardIdx)) {
                this.deck.gold[this.deck.gold.indexOf(cardIdx)] = -1;
            }
        }
        return true;
    }

    attend() {
        let now = new Date();
        let res = {
            success: false
        };
        
        if (this.attendance.last && now.toYYYYMMDD() == this.attendance.last) {
            return res;
        }
        
        if ((!this.attendance.last) || 
            ((new Date(now.toYYYYMMDD()).getTime() - new Date(this.attendance.last).getTime()) / 86400000) == 1) {
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

        if (this.deck.gold.includes(517)) {
            res.isG = true;
        }

        if (this.deck.gold.includes(528)) {
            res.isG2 = true;
        }
        
        this.shopLimit.daily = [];
        // 일요일이면 주간 제한 초기화
        if (now.getDay() == 0) {
            this.shopLimit.weekly = [];
            this.shopLimit.weeklyResetAt = now.toYYYYMMDD();
        }
        this.save();
        res.success = true;
        return res;
    }

    givePack(pack) {
        let rewards = [];
        let items = JSON.parse(read("DB/TCG/item.json"));
        let cards = JSON.parse(read("DB/TCG/card.json"));
        
        pack.forEach(reward => {
            if (reward.roll) {
                let all_rolls = reward.rolls.reduce((cur, acc) => cur + acc.weight, 0);
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
                    if (count < 0) {
                        this.removeItem(itemIdx, Math.abs(count));
                    } else {
                        this.addItem(itemIdx, count);
                    }
                    rewards.push("- " + reward.name + " x" + count);
                }
                return;
            }
            
            if (reward.card) {
                let cardIdx = cards.findIndex(c => c.name == reward.name && c.title == reward.title);
                if (cardIdx != -1) {
                    if (count < 0) {
                        this.removeCard(cardIdx, Math.abs(count));
                    } else {
                        this.addCard(cardIdx, count);
                    }
                    rewards.push("- [" + reward.title + "]" + reward.name + " x" + count);
                }
                return;
            }
        });
        
        this.save();
        return rewards;
    }

    async checkQuest(quest, channel) {
        if (!this.daily_quest.includes(quest)) {
            let daily_quests = JSON.parse(read("DB/TCG/daily_quest.json"));
            this.daily_quest.push(quest);
            let pack = daily_quests.find(q => q.name == quest).reward;
            
            if (this.daily_quest.length == 5) {
                pack.push({garnet: true, count: 100});
            }
            if (this.daily_quest.length == 6) {
                pack.push({gold: true, count: 30000});
            }
            
            let rewards = this.givePack(pack);
            await channel.sendChat("✅ 일일 과제 달성!\n< " + quest + " >\n\n[ 보상 ]\n" + rewards.join("\n"));
            return true;
        }
        return false;
    }
}

// getTCGUser 함수들
async function getTCGUserById(id) {
    try {
        let res = await queryItems({
            TableName: "tcg_user",
            IndexName: "getIdx",
            KeyConditionExpression: "#gsi_partition_key = :gsi_value",
            FilterExpression: "contains(logged_in, :userid_val)",
            ExpressionAttributeNames: {
                "#gsi_partition_key": "_get"
            },
            ExpressionAttributeValues: {
                ":gsi_value": 1,
                ":userid_val": id
            }
        });
        if (res.success && res.result[0] && res.result[0].Items && res.result[0].Items[0]) 
            return new TCGUser().load(res.result[0].Items[0]);
        else 
            return null;
    } catch (e) {
        console.log("getTCGUserById error:", e);
        return null;
    }
}

async function getTCGUserByName(name) {
    try {
        let res = await queryItems({
            TableName: "tcg_user",
            IndexName: "nameIdx",
            KeyConditionExpression: "#name = :name_val",
            ExpressionAttributeNames: {
                "#name": "name"
            },
            ExpressionAttributeValues: {
                ":name_val": name
            }
        });
        if (res.success && res.result[0] && res.result[0].Items && res.result[0].Items[0]) 
            return new TCGUser().load(res.result[0].Items[0]);
        else 
            return null;
    } catch (e) {
        console.log("getTCGUserByName error:", e);
        return null;
    }
}

async function getTCGUserByCode(code) {
    try {
        let res = await queryItems({
            TableName: "tcg_user",
            IndexName: "codeIdx",
            KeyConditionExpression: "#code = :code_val",
            ExpressionAttributeNames: {
                "#code": "code"
            },
            ExpressionAttributeValues: {
                ":code_val": code
            }
        });
        if (res.success && res.result[0] && res.result[0].Items && res.result[0].Items[0]) 
            return new TCGUser().load(res.result[0].Items[0]);
        else 
            return null;
    } catch (e) {
        console.log("getTCGUserByCode error:", e);
        return null;
    }
}

// TCG 유틸: 아티팩트 능력 표시
function invDisplayAbilityArtifact(artifact) {
    let calc = function(n) {
        if (n >= 9) return 4;
        if (n >= 7) return 3;
        if (n >= 4) return 2;
        if (n >= 1) return 1;
        return 0;
    }
    let plus = {
        "전체 덱 파워 증가": [10, 25, 50, 100],
        "전체 덱 파워 증가%": [2, 4, 6, 8],
        "콘텐츠 덱 파워 증가": [10, 25, 50, 100],
        "콘텐츠 덱 파워 증가%": [5, 10, 20, 40],
        "골드 덱 파워 증가": [10, 25, 50, 100],
        "골드 덱 파워 증가%": [5, 10, 20, 40],
        "데일리 골드 증가": [1000, 3000, 5000, 10000],
        "데일리 골드 증가%": [10, 25, 50, 100],
        "전체 덱 파워 감소": [15, 30, 45, 60],
        "전체 덱 파워 감소%": [2, 4, 6, 8],
        "콘텐츠 덱 파워 감소": [15, 30, 45, 60],
        "콘텐츠 덱 파워 감소%": [2, 4, 6, 8],
        "골드 덱 파워 감소": [15, 30, 45, 60],
        "골드 덱 파워 감소%": [2, 4, 6, 8],
        "데일리 골드 감소": [500, 1500, 3000, 5000]
    };
    let results = [];
    artifact.abilities.forEach((a, idx) => {
        results.push("* " + a.type + " (" + calc(a.display.filter(d => d == 1).length) + "단계) " + (a.display.filter(d => d == 1).length >= 6 ? "+" + numberWithCommas(plus[a.type][calc(a.display.filter(d => d == 1).length) - 1].toString()) : "0"));
    });
    return results.join("\n").trim();
}

// TCG 유틸: 로그 출력 (Node 환경용)
function TCGLog(text) {
    try {
        // 기본 로그 채널 ID (old_engine.js 기준)
        const logChannelId = "442097040687921";
        const ch = client.channelList.get(logChannelId);
        if (ch && typeof ch.sendChat === 'function') {
            ch.sendChat(text);
            return;
        }
    } catch(e) {
        // fallthrough
    }
    console.log(text);
}

// 보상 병합 함수
function mergeRewards(rewards) {
    var rewardMap = {};
    var result = [];
    var i, reward, parts, name, count;
    
    for (i = 0; i < rewards.length; i++) {
        reward = rewards[i];
        
        parts = reward.split(' x');
        if (parts.length < 2) continue;
        name = parts[0];
        count = parseInt(parts[1].replace(/,/gi, ""), 10);
        
        if (rewardMap[name]) {
            rewardMap[name] += count;
        } else {
            rewardMap[name] = count;
        }
    }
    
    for (name in rewardMap) {
        if (rewardMap.hasOwnProperty(name)) {
            result.push(name + ' x' + rewardMap[name]);
        }
    }
    
    return result;
}

// 카드 레벨업 체크 함수
async function checkCardLevelUp(card, invCard, channel) {
    let needExp = {
        "일반": 1000,
        "고급": 10000,
        "희귀": 50000,
        "영웅": 160000,
        "전설": 400000
    };
    let maxLevels = {
        "일반": 1,
        "고급": 2,
        "희귀": 3,
        "영웅": 4,
        "전설": 5
    };
    let isGrowth = (card.title == "성장형");
    while(true) {
        if (needExp[card.rarity] > invCard.exp) break;
        if ((maxLevels[card.rarity] + (card.breakLimit ? 1 : 0)) <= invCard.level) break;
        invCard.exp -= needExp[card.rarity];
        invCard.level += 1;
        if (card.title == "성장형" && invCard.rarity != "전설" && maxLevels[invCard.rarity] == invCard.level && invCard.transcend == invCard.level) {
            invCard.rarity = ["일반","고급","희귀","영웅","전설"][["일반","고급","희귀","영웅"].indexOf(card.rarity) + 1];
            card.rarity = invCard.rarity;
        }
        if (!isGrowth && (maxLevels[card.rarity] + (invCard.breakLimit ? 1 : 0)) <= invCard.level) {
            invCard.overExp = invCard.exp;
            invCard.exp = 0;
        }
        channel.sendChat("⬆️ [" + card.title + "]" + card.name + " 카드가 레벨업했습니다!\nLv." + (invCard.level - 1) + " ▶ Lv." + invCard.level + "\n(" + numberWithCommas(invCard.exp.toString()) + "/" + numberWithCommas(needExp[card.rarity].toString()) + ")");
    }
}

// 아이템 문자열 파싱 함수
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

// 카드 정보 파싱 함수 (카드추가용)
function parseCardInfo(input) {
    // rarity 매핑
    var rarityMap = {
        1: "일반",
        2: "고급",
        3: "희귀",
        4: "영웅",
        5: "전설"
    };

    // 1. rarity: ☆ 갯수 세기
    var starMatch = input.match(/^([☆]+)/);
    var starCount = starMatch ? starMatch[1].length : 0;
    var rarity = rarityMap[starCount] || "미확인";

    // 2. title: 대괄호 안 내용
    var titleMatch = input.match(/\[([^\]]+)\]/);
    var title = titleMatch ? titleMatch[1] : "";

    // 3. name: 대괄호 뒤 ~ '+' 전까지
    var nameMatch = input.match(/\]([^\+]+)/);
    var name = "";
    if (nameMatch) {
        name = nameMatch[1].replace(/\s+$/, ""); // 뒤 공백 제거
    }

    // 4. power: 'P' 뒤 숫자
    var powerMatch = input.match(/P(\d+)/);
    var power = powerMatch ? parseInt(powerMatch[1], 10) : 0;

    // 5. desc: 작은따옴표 안 텍스트
    var descMatch = input.match(/'(.*?)'/);
    var desc = descMatch ? descMatch[1] : "";

    // 결과 반환
    return {
        title: title,
        name: name,
        rarity: rarity,
        power: power,
        desc: desc
    };
}

// 랜덤 문자열 생성 함수
function getRandomString(len) {
    const chars = '023456789ABCDEFGHJKLMNOPQRSTUVWXTZabcdefghikmnopqrstuvwxyz';
    const stringLength = len;
    let randomstring = '';
    for (let i = 0; i < stringLength; i++) {
        let rnum = Math.floor(Math.random() * chars.length);
        randomstring += chars.substring(rnum, rnum + 1);
    }
    return randomstring;
}

// 아티팩트 어빌리티 표시 함수
function displayAbilityArtifact(artifact) {
    const calc = n => [0,0,0,0,0,0,1,2,2,3,4][n] || 0;
    let results = [];
    artifact.abilities.forEach((a,idx) => {
        results.push("* " + a.type + " (" + calc(a.display.filter(d => d == 1).length) + "단계)");
        results.push(a.display.map(d => (d == -1 ? "⚪" : (d == 0 ? "⚫" : (idx == 2 ? "🔴" : "🔵")))).join(""));
    });
    return results.join("\n").trim();
}

// 패키지 출력 함수
function printPack(pack, type, front) {
    let rarityMark = {
        "일반": "⚪ ",
        "레어": "🟡 ",
        "유니크": "🟣 "
    };
    type = type || '\n';
    front = front || "";
    let res = [];
    pack.forEach(reward => {
        let count = reward.count;
        if (typeof count == 'object') {
            count = count.min.toComma2() + " ~ " + count.max.toComma2();
        } else {
            count = count.toComma2();
        }
        if (reward.gold) {
            res.push(front + (reward.rarity ? rarityMark[reward.rarity] : "") + count + "골드");
            return;
        }
        if (reward.garnet) {
            res.push(front + (reward.rarity ? rarityMark[reward.rarity] : "") + count + "가넷");
            return;
        }
        if (reward.item) {
            res.push(front + (reward.rarity ? rarityMark[reward.rarity] : "") + reward.name + (reward.count > 1 ? " x" + count : ""));
            return;
        }
        if (reward.card) {
            res.push(front + (reward.rarity ? rarityMark[reward.rarity] : "") + "[" + reward.title + "]" + reward.name + (reward.count > 1 ? " x" + count : ""));
            return;
        }
    });
    return res.join(type);
}

// 거래 가격 계산 함수
function calculatePrice(trades, n) {
    var total = 0;
    for (var i = 0; i < trades.length && n > 0; i++) {
        var buy = Math.min(trades[i].count, n);
        total += trades[i].price * buy;
        n -= buy;
    }
    return total;
}

// ===== 해방 시스템 함수들 =====

// 주사위 사용 가능 여부 체크
function canUseDice(diceType, currentRank) {
    switch(diceType) {
        case "희미한":
            return currentRank <= 1;
        case "빛나는":
            return currentRank <= 2;
        case "찬란한":
        case "운명":
        case "심판":
            return true;
        default:
            return false;
    }
}

// 주사위 굴림 결과 처리
function processDiceRoll(diceType, currentRank, diceCount) {
    let result = { rankUp: false, newRank: currentRank };
    let upgradeChance = 0;
    let guaranteedUpgrade = false;
    
    switch(diceType) {
        case "희미한":
            if (currentRank == 0) {
                upgradeChance = 0.003;
                if (diceCount.dim >= 334) guaranteedUpgrade = true;
            }
            break;
        case "빛나는":
            if (currentRank == 0) {
                upgradeChance = 0.03;
            } else if (currentRank == 1) {
                upgradeChance = 0.004;
                if (diceCount.bright >= 250) guaranteedUpgrade = true;
            }
            break;
        case "찬란한":
            if (currentRank == 0) {
                upgradeChance = 0.07;
            } else if (currentRank == 1) {
                upgradeChance = 0.01;
            } else if (currentRank == 2) {
                upgradeChance = 0.001;
                if (diceCount.brilliant >= 1000) guaranteedUpgrade = true;
            }
            break;
        case "운명":
            if (currentRank == 0) {
                upgradeChance = 0.04;
                if (diceCount.fate >= 30) guaranteedUpgrade = true;
            } else if (currentRank == 1) {
                upgradeChance = 0.01;
                if (diceCount.fate >= 100) guaranteedUpgrade = true;
            } else if (currentRank == 2) {
                upgradeChance = 0.003;
                if (diceCount.fate >= 500) guaranteedUpgrade = true;
            }
            break;
        case "심판":
            if (currentRank == 0) {
                upgradeChance = 0.15;
                if (diceCount.judgment >= 10) guaranteedUpgrade = true;
            } else if (currentRank == 1) {
                upgradeChance = 0.03;
                if (diceCount.judgment >= 50) guaranteedUpgrade = true;
            } else if (currentRank == 2) {
                upgradeChance = 0.013;
                if (diceCount.judgment >= 150) guaranteedUpgrade = true;
            }
            break;
    }
    
    if (guaranteedUpgrade || Math.random() < upgradeChance) {
        result.rankUp = true;
        result.newRank = currentRank + 1;
    }
    
    return result;
}

// 해방 보너스 생성
function generateLiberationBonuses(deckType, diceType, currentRank) {
    let bonuses = [];
    let originDeckType = deckType;
    if (deckType == "content1" || deckType == "content2") deckType = "content";
    
    let bonusPools = {
        content: {
            normal: [
                "1번째 자리 단일 파워 +6", "2번째 자리 단일 파워 +6", "3번째 자리 단일 파워 +6",
                "4번째 자리 단일 파워 +6", "5번째 자리 단일 파워 +6",
                "1번째 자리 단일 파워 +2%", "2번째 자리 단일 파워 +2%", "3번째 자리 단일 파워 +2%",
                "4번째 자리 단일 파워 +2%", "5번째 자리 단일 파워 +2%",
                "모든 카드 단일 파워 +2", "1초월당 덱 파워 +1", "1강화당 덱 파워 +1", "덱 파워 +3%",
                "덱이 똑같은 등급으로만 이루어져 있을 시 최종 전투력 +2%",
                "덱이 모두 다른 등급으로만 이루어져 있을 시 최종 전투력 +5%",
                "덱이 똑같은 테마로만 이루어져 있을 시 최종 전투력 +2%",
                "덱 전투력 측정 시 최종 전투력 +2%"
            ],
            rare: [
                "1번째 자리 단일 파워 +12", "2번째 자리 단일 파워 +12", "3번째 자리 단일 파워 +12",
                "4번째 자리 단일 파워 +12", "5번째 자리 단일 파워 +12",
                "1번째 자리 단일 파워 +5%", "2번째 자리 단일 파워 +5%", "3번째 자리 단일 파워 +5%",
                "4번째 자리 단일 파워 +5%", "5번째 자리 단일 파워 +5%",
                "모든 카드 단일 파워 +3", "1초월당 덱 파워 +2", "1강화당 덱 파워 +2", "덱 파워 +6%",
                "덱이 똑같은 등급으로만 이루어져 있을 시 최종 전투력 +4%",
                "덱이 모두 다른 등급으로만 이루어져 있을 시 최종 전투력 +10%",
                "덱이 똑같은 테마로만 이루어져 있을 시 최종 전투력 +4%",
                "덱 전투력 측정 시 최종 전투력 +4%"
            ],
            unique: [
                "1번째 자리 단일 파워 +18", "2번째 자리 단일 파워 +18", "3번째 자리 단일 파워 +18",
                "4번째 자리 단일 파워 +18", "5번째 자리 단일 파워 +18",
                "1번째 자리 단일 파워 +8%", "2번째 자리 단일 파워 +8%", "3번째 자리 단일 파워 +8%",
                "4번째 자리 단일 파워 +8%", "5번째 자리 단일 파워 +8%",
                "모든 카드 단일 파워 +6", "1초월당 덱 파워 +4", "1강화당 덱 파워 +4", "덱 파워 +12%",
                "덱이 똑같은 등급으로만 이루어져 있을 시 최종 전투력 +8%",
                "덱이 모두 다른 등급으로만 이루어져 있을 시 최종 전투력 +15%",
                "덱이 똑같은 테마로만 이루어져 있을 시 최종 전투력 +8%",
                "덱 전투력 측정 시 최종 전투력 +8%"
            ],
            legendary: [
                "1번째 자리 단일 파워 +30", "2번째 자리 단일 파워 +30", "3번째 자리 단일 파워 +30",
                "4번째 자리 단일 파워 +30", "5번째 자리 단일 파워 +30",
                "1번째 자리 단일 파워 +12%", "2번째 자리 단일 파워 +12%", "3번째 자리 단일 파워 +12%",
                "4번째 자리 단일 파워 +12%", "5번째 자리 단일 파워 +12%",
                "모든 카드 단일 파워 +15", "1초월당 덱 파워 +5", "1강화당 덱 파워 +5", "덱 파워 +20%",
                "덱이 똑같은 등급으로만 이루어져 있을 시 최종 전투력 +15%",
                "덱이 모두 다른 등급으로만 이루어져 있을 시 최종 전투력 +30%",
                "덱이 똑같은 테마로만 이루어져 있을 시 최종 전투력 +15%",
                "덱 전투력 측정 시 최종 전투력 +15%",
                "2,4번째 자리 단일 파워 +50"
            ]
        },
        gold: {
            normal: [
                "1번째 자리 단일 파워 +6", "2번째 자리 단일 파워 +6", "3번째 자리 단일 파워 +6",
                "4번째 자리 단일 파워 +6", "5번째 자리 단일 파워 +6",
                "1번째 자리 단일 파워 +2%", "2번째 자리 단일 파워 +2%", "3번째 자리 단일 파워 +2%",
                "4번째 자리 단일 파워 +2%", "5번째 자리 단일 파워 +2%",
                "모든 카드 단일 파워 +2", "1초월당 덱 파워 +1", "1강화당 덱 파워 +1", "덱 파워 +3%",
                "데일리골드 증가 +10,000", "데일리골드량 +5%"
            ],
            rare: [
                "1번째 자리 단일 파워 +12", "2번째 자리 단일 파워 +12", "3번째 자리 단일 파워 +12",
                "4번째 자리 단일 파워 +12", "5번째 자리 단일 파워 +12",
                "1번째 자리 단일 파워 +5%", "2번째 자리 단일 파워 +5%", "3번째 자리 단일 파워 +5%",
                "4번째 자리 단일 파워 +5%", "5번째 자리 단일 파워 +5%",
                "모든 카드 단일 파워 +3", "1초월당 덱 파워 +2", "1강화당 덱 파워 +2", "덱 파워 +6%",
                "데일리골드 증가 +25,000", "데일리골드량 +10%"
            ],
            unique: [
                "1번째 자리 단일 파워 +18", "2번째 자리 단일 파워 +18", "3번째 자리 단일 파워 +18",
                "4번째 자리 단일 파워 +18", "5번째 자리 단일 파워 +18",
                "1번째 자리 단일 파워 +8%", "2번째 자리 단일 파워 +8%", "3번째 자리 단일 파워 +8%",
                "4번째 자리 단일 파워 +8%", "5번째 자리 단일 파워 +8%",
                "모든 카드 단일 파워 +6", "1초월당 덱 파워 +4", "1강화당 덱 파워 +4", "덱 파워 +12%",
                "데일리골드 증가 +50,000", "데일리골드량 +20%"
            ],
            legendary: [
                "1번째 자리 단일 파워 +30", "2번째 자리 단일 파워 +30", "3번째 자리 단일 파워 +30",
                "4번째 자리 단일 파워 +30", "5번째 자리 단일 파워 +30",
                "1번째 자리 단일 파워 +12%", "2번째 자리 단일 파워 +12%", "3번째 자리 단일 파워 +12%",
                "4번째 자리 단일 파워 +12%", "5번째 자리 단일 파워 +12%",
                "모든 카드 단일 파워 +15", "1초월당 덱 파워 +5", "1강화당 덱 파워 +5", "덱 파워 +20%",
                "데일리골드 증가 +50,000", "데일리골드량 +30%",
                "데일리골드 (정수값) 증가량 2배",
                "덱이 똑같은 테마로만 이루어져 있을 시 데일리골드량 +100%",
                "덱이 똑같은 테마로만 이루어져 있을 시 데일리골드 증가 +100,000",
                "가장 이득이 되는 카드의 효과 2번 발동"
            ]
        }
    };
    
    for (let slot = 0; slot < 3; slot++) {
        let bonusRarity = getBonusRarity(diceType, currentRank, slot);
        let pool = bonusPools[deckType][bonusRarity];
        let randomBonus = pool[Math.floor(Math.random() * pool.length)];
        bonuses.push({
            slot: slot + 1,
            rarity: bonusRarity,
            effect: randomBonus
        });
    }
    
    return bonuses;
}

// 보너스 등급 결정
function getBonusRarity(diceType, currentRank, slot) {
    let random = Math.random() * 100;
    
    if (slot === 0) {
        switch(diceType) {
            case "희미한":
            case "빛나는":
            case "찬란한":
                if (currentRank <= 1) return "rare";
                else if (currentRank === 2) return "unique";
                else return "legendary";
            case "운명":
            case "심판":
                if (currentRank === 0) return "rare";
                else if (currentRank === 1) return "rare";
                else if (currentRank === 2) return "unique";
                else return "legendary";
        }
    }
    
    switch(diceType) {
        case "희미한":
            if (currentRank === 0) return random < 99 ? "normal" : "rare";
            else return random < 92 ? "normal" : "rare";
        case "빛나는":
            if (currentRank === 0) return random < 95 ? "normal" : "rare";
            else if (currentRank === 1) return random < 83 ? "normal" : "rare";
            else return random < 99 ? "rare" : "unique";
        case "찬란한":
            if (currentRank === 0) return random < 95 ? "normal" : "rare";
            else if (currentRank === 1) return random < 83 ? "normal" : "rare";
            else if (currentRank === 2) return random < 98.5 ? "rare" : "unique";
            else return random < 99.8 ? "unique" : "legendary";
        case "운명":
            if (currentRank === 0) {
                if (slot === 1) return random < 90 ? "normal" : "rare";
                else return random < 99 ? "normal" : "rare";
            } else if (currentRank === 1) {
                if (slot === 1) return random < 80 ? "normal" : "rare";
                else return random < 99 ? "normal" : "rare";
            } else if (currentRank === 2) {
                if (slot === 1) return random < 90 ? "rare" : "unique";
                else return random < 99 ? "rare" : "unique";
            } else {
                if (slot === 1) return random < 90 ? "unique" : "legendary";
                else return random < 99 ? "unique" : "legendary";
            }
        case "심판":
            if (currentRank === 0) {
                if (slot === 1) return random < 80 ? "normal" : "rare";
                else return random < 95 ? "normal" : "rare";
            } else if (currentRank === 1) {
                if (slot === 1) return random < 80 ? "normal" : "rare";
                else return random < 90 ? "normal" : "rare";
            } else if (currentRank === 2) {
                if (slot === 1) return random < 80 ? "rare" : "unique";
                else return random < 95 ? "rare" : "unique";
            } else {
                if (slot === 1) return random < 80 ? "unique" : "legendary";
                else return random < 95 ? "unique" : "legendary";
            }
    }
    
    return "normal";
}

// 랜덤 주사위 타입 결정
function getRandomDiceType() {
    let random = Math.random() * 100;
    
    if (random < 23) {
        return "희미한";
    } else if (random < 44) {
        return "빛나는";
    } else if (random < 64) {
        return "찬란한";
    } else if (random < 83) {
        return "운명";
    } else {
        return "심판";
    }
}

function calculatePrice(trades, n) {
    var total = 0;
    for (var i = 0; i < trades.length && n > 0; i++) {
        var buy = Math.min(trades[i].count, n);
        total += trades[i].price * buy;
        n -= buy;
    }
    return total;
}

// 카드 출력 함수
function printCard(cardData) {
    var GROW = {
        "일반": {lv:1, tr:3, maxLv:5, maxTr:4}, 
        "고급": {lv:2, tr:6, maxLv:5, maxTr:4},
        "희귀": {lv:3, tr:9, maxLv:7, maxTr:6}, 
        "영웅": {lv:4, tr:15, maxLv:9, maxTr:8},
        "전설": {lv:5, tr:25, maxLv:12, maxTr:10}
    };
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

// ===== LLM API 함수들 (Node.js 환경) =====

// Claude Sonnet API 호출
function ClaudeSonnet(data) {
    return new Promise((resolve, reject) => {
        const options = {
            url: 'https://api.anthropic.com/v1/messages',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'anthropic-version': '2023-06-01',
                'x-api-key': ClaudeAPIKEY
            },
            body: JSON.stringify(data),
            timeout: 120000
        };

        request(options, (error, response, body) => {
            if (error) {
                resolve({message: error.message});
                return;
            }
            try {
                const result = JSON.parse(body);
                resolve(result);
            } catch(e) {
                resolve({message: e.message});
            }
        });
    });
}

// Claude API 호출 (prompts, model, system 형식)
function Claude(prompts, model, system) {
    return new Promise((resolve, reject) => {
        const data = {
            model: model,
            messages: prompts,
            max_tokens: 4096,
            system: system
        };

        const options = {
            url: 'https://api.anthropic.com/v1/messages',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'anthropic-version': '2023-06-01',
                'x-api-key': ClaudeAPIKEY
            },
            body: JSON.stringify(data),
            timeout: 120000
        };

        request(options, (error, response, body) => {
            if (error) {
                resolve({message: error.message});
                return;
            }
            try {
                const result = JSON.parse(body);
                resolve(result);
            } catch(e) {
                resolve({message: e.message});
            }
        });
    });
}

// DeepSeek API 호출
function DeepSeek(prompts, model) {
    model = model || "deepseek-chat";
    
    return new Promise((resolve, reject) => {
        const data = {
            model: model,
            messages: prompts,
            stream: false
        };

        const options = {
            url: 'https://api.deepseek.com/chat/completions',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + DeepSeekAPIKEY
            },
            body: JSON.stringify(data),
            timeout: 120000
        };

        request(options, (error, response, body) => {
            if (error) {
                resolve({message: error.message});
                return;
            }
            try {
                const result = JSON.parse(body);
                resolve(result);
            } catch(e) {
                resolve({message: e.message});
            }
        });
    });
}

// 순수 파워 계산 함수 (특수능력 제외, 강화/초월만 적용)
function calculatePurePower(user, deck) {
    const cardList = JSON.parse(read("DB/TCG/card.json"));
    const GROW = {
        "일반": {lv:1, tr:3}, "고급":{lv:2, tr:6},
        "희귀": {lv:3, tr:9}, "영웅":{lv:4, tr:15},
        "전설": {lv:5, tr:25}
    };

    let totalPower = 0;
    for (let i = 0; i < deck.length; i++) {
        const idx = deck[i];
        if (idx < 0 || !cardList[idx]) continue;
        
        const card = cardList[idx];
        const inv = (user.inventory.card || []).find(o => o.id === idx) || {level: 0, transcend: 0};
        const g = GROW[card.rarity] || {lv:0, tr:0};
        
        const levelBonus = /노스타코인/.test(card.desc) ? 0 : g.lv * inv.level;
        const transcendBonus = /노스타코인/.test(card.desc) ? g.tr * inv.transcend * 2 : g.tr * inv.transcend;
        
        totalPower += card.power + levelBonus + transcendBonus;
    }
    
    return totalPower;
}

// 듀오 공격대 파워 계산 (최고 파워 카드 + 그 다음 카드)
function calculateDuoPower(user, deck) {
    const cardList = JSON.parse(read("DB/TCG/card.json"));
    const GROW = {
        "일반": {lv:1, tr:3}, "고급":{lv:2, tr:6},
        "희귀": {lv:3, tr:9}, "영웅":{lv:4, tr:15},
        "전설": {lv:5, tr:25}
    };

    let cardPowers = [];
    for (let i = 0; i < deck.length; i++) {
        const idx = deck[i];
        if (idx < 0 || !cardList[idx]) continue;
        
        const card = cardList[idx];
        const inv = (user.inventory.card || []).find(o => o.id === idx) || {level: 0, transcend: 0};
        const g = GROW[card.rarity] || {lv:0, tr:0};
        
        const levelBonus = /노스타코인/.test(card.desc) ? 0 : g.lv * inv.level;
        const transcendBonus = /노스타코인/.test(card.desc) ? g.tr * inv.transcend * 2 : g.tr * inv.transcend;
        
        cardPowers.push({
            idx: i,
            power: card.power + levelBonus + transcendBonus
        });
    }
    
    // 파워 순으로 정렬
    cardPowers.sort((a, b) => b.power - a.power);
    
    // 상위 2개만 합산
    let totalPower = 0;
    for (let i = 0; i < Math.min(2, cardPowers.length); i++) {
        totalPower += cardPowers[i].power;
    }
    
    return totalPower;
}

// 5인 공격대 파워 계산 (LLM 기반, DeepSeek/Claude 연동 필요)
async function calculateDeckPower(user, deck, opts) {
    const cards = JSON.parse(read("DB/TCG/card.json"));
    opts = opts || {};
    const CONTENT = !!opts.isContentDeck,
          GOLD = !!opts.isGoldDeck;

    let userCards = deck.map(d => user.inventory.card.find(c => c.id == d) || {none:true}).map(c => c.none ? "(비어있음)" : c.concat());
    userCards.forEach(c => {
        if (typeof c == 'object') c.deepMerge(cards[c.id]);
    });
    userCards = userCards.map((c,i) => "[" + (i + 1) + "]" + (typeof c == 'object' ? ("<" + c.rarity + "> " + printCard(c)) : "(비어있음)"));

    let artifact = null;
    if (user.artifact && user.artifact.equip) {
        let arti = (user.artifact.artifacts || []).find(a => a.id == user.artifact.equip.artifactId);
        if (arti) {
            artifact = "○ 아티팩트\n" + invDisplayAbilityArtifact(arti);
        }
    }
    
    // 해방 보너스 정보 추가
    let liberationBonus = null;
    let deckType = opts.deckType;
    
    if (deckType && user.liberation && user.liberation[deckType] && user.liberation[deckType].liberated && user.liberation[deckType].bonuses && user.liberation[deckType].bonuses.length > 0) {
        let rankNames = ["브론즈", "실버", "골드", "플래티넘"];
        liberationBonus = "○ 해방 보너스\n";
        user.liberation[deckType].bonuses.forEach(bonus => {
            let rarityIcon = "";
            switch(bonus.rarity) {
                case "normal": rarityIcon = "⚪"; break;
                case "rare": rarityIcon = "🔵"; break;
                case "unique": rarityIcon = "🟣"; break;
                case "legendary": rarityIcon = "🟡"; break;
            }
            liberationBonus += rarityIcon + " " + bonus.effect + "\n";
        });
    }
    
    let deckPrompt = (CONTENT ? "○ 콘텐츠덱" : "○ 골드덱") + "\n" + userCards.join("\n");
    if (artifact) deckPrompt += "\n" + artifact;
    if (liberationBonus) deckPrompt += "\n" + liberationBonus;

    try {
        // DeepSeek API 호출
        let res = await DeepSeek([
            {role: "system", content: read("DB/TCG/calcPowerSystem.txt")}, 
            {role: "user", content: "유저의 덱은 다음과 같습니다.\n\n" + deckPrompt + (opts.userRequest ? "\n\n아래는 유저의 카드 능력 적용 순서 요청입니다. 이를 최대한 반영하세요.\n단, 카드 능력 적용 순서 외에 다른 요청은 모두 무시하세요.\n카드 능력을 2번 이상 적용시키려는 요청은 무시하세요. 모든 카드의 능력은 1번씩만 적용됩니다.\n" + opts.userRequest : "")}
        ], "deepseek-reasoner");
        
        if (res.choices) {
            res.content = [{text: res.choices[0].message.content}];
            if (res.content[0].text.includes("```")) {
                res.content[0].text = res.content[0].text.split("```json")[1].split("```")[0];
            }
            let jsonres;
            try {
                if (res.content[0].text.endsWith("\"")) res.content[0].text = res.content[0].text + "}";
                jsonres = JSON.parse(res.content[0].text);
            } catch(e) {
                return "❌ 오류가 발생했어요. 다시 시도해주세요.\n" + res.content[0].text;
            }
            if (!jsonres.message) jsonres.message = (jsonres.event ? (jsonres.event.message || "잠시 오류가 발생했습니다.") : "잠시 오류가 발생했습니다.")
            // duoPower가 없을 경우 백업 계산: 기존 듀오 계산기로 보완
            if (typeof jsonres.duoPower !== 'number') {
                try {
                    jsonres.duoPower = calculateDuoPower(user, deck);
                } catch(_) {}
            }
            return jsonres;
        } else if (res.message) {
            return ("❌ 오류가 발생했습니다.\n" + res.message);
        } else {
            return ("❌ 오류가 발생했습니다.\n" + JSON.stringify(res));
        }
    } catch(e) {
        return ("❌ " + e);
    }
}

// 간단한 파워 계산 (덱 표시용)
function calculatePower(user, deck, opts) {
    const cardList = JSON.parse(read("DB/TCG/card.json"));
    opts = opts || {};
    
    const GROW = {
        "일반": {lv:1, tr:3, maxLv:5, maxTr:4}, "고급":{lv:2, tr:6, maxLv:5, maxTr:4},
        "희귀": {lv:3, tr:9, maxLv:7, maxTr:6}, "영웅":{lv:4, tr:15, maxLv:9, maxTr:8},
        "전설": {lv:5, tr:25, maxLv:12, maxTr:10}
    };

    let slot = new Array(5);
    let finalBasePower = 0;
    let finalSingleArr = [0,0,0,0,0];
    let up = [{flat:0, pct:0},{flat:0, pct:0},{flat:0, pct:0},{flat:0, pct:0},{flat:0, pct:0}];

    for (let i = 0; i < 5; i++) {
        const idx = deck[i];
        if (idx < 0 || !cardList[idx]) { 
            slot[i] = null; 
            continue; 
        }
        const c = cardList[idx];
        const inv = (user.inventory.card || []).find(o => o.id === idx) || {level: 0, transcend: 0};
        const g = GROW[c.rarity] || {lv:0, tr:0, maxLv:0, maxTr:0};
        
        const levelBonus = /노스타코인/.test(c.desc) ? 0 : g.lv * inv.level;
        const transcendBonus = /노스타코인/.test(c.desc) ? g.tr * inv.transcend * 2 : g.tr * inv.transcend;
        
        const single = c.power + levelBonus + transcendBonus;
        
        slot[i] = {
            idx: idx, name: c.name, title: c.title, rarity: c.rarity, desc: (c.desc || ""),
            single: single, pos: i, level: inv.level, transcend: inv.transcend, maxLv: g.maxLv, maxTr: g.maxTr
        };
        
        finalBasePower += single;
        finalSingleArr[i] = single;
    }

    return {
        power: Math.round(finalBasePower * 1000) / 1000,
        single: finalSingleArr,
        up: up
    };
}

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

async function joinOpenChat(channel, link, reply) {
    //reply("LK봇 초대 문의\nhttps://open.kakao.com/me/developer_lukim9");
    const data = await client.channelList.open.getJoinInfo(link);
    if (! data.success) {
        reply('[!] 오픈채팅방 정보를 불러올 수 없습니다.\nLK봇이 이용자 보호조치에 걸렸거나 방 링크가 유효하지 않을 수 있습니다.');
        return false;
    } else if (data.result.openLink.type != node_kakao.OpenLinkType.CHANNEL) {
        reply(`[!] 해당 채팅방은 그룹 채팅방이 아닙니다.`);
        return false;
    }
    let result = [];
    Array.from(client.channelList.all()).map(room => result.push(room.linkId + ""));
    if(result.includes(data.result.openLink.linkId + "")) {
        reply(`[!] 이미 해당 채팅방에 LK봇이 존재합니다.`);
        return false;
    }
    const joinRes = await client.channelList.open.joinChannel({linkId:data.result.openLink.linkId}, {});
    if(! joinRes.success) {
        reply(`[!] 해당 채팅방에 입장할 수 없습니다.`);
        return false;
    }
    reply("[✓] LK봇을 성공적으로 초대했습니다.");
    joinRes.result.sendChat(`✅ LK봇이 초대되었습니다!\n모두들 반갑습니다!`, false);
    client.channelList.get("384981318100178").sendChat(`[ LK봇 초대 안내 ]\n방 이름: ${joinRes.result.getDisplayName()}\n방 링크: ${data.result.openLink.linkURL}`);
    return true;
}

//chat on
client.on('chat', async (data, channel) => {
    try {
        const msg = data.text.trim();
        const sender = data.getSenderInfo(channel) || data._chat.sender;
        const bot = channel.getUserInfo(client._clientUser);
        const room = channel.getDisplayName();
        const roomid = channel.channelId;
        const roomtype = (channel._channel.info == undefined ? "OM" : channel._channel.info.type);
        const isReply = (data.originalType === node_kakao.KnownChatType.REPLY);
        const isManager = (bot && bot.perm >= 4);

        
        
        if (! sender) return;
        
        if (! bot) return;
        
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

        const senderID = sender.userId + "";

        // editPack 처리 (패키지/쿠폰/핫타임 편집)
        if (editPack[senderID]) {
            if (msg == "완료") {
                let pack = JSON.parse(read("DB/TCG/pack.json"));
                let coupon = JSON.parse(read("DB/TCG/coupon.json"));
                if (editPack[senderID].type == "추가") {
                    pack.push({
                        name: editPack[senderID].name,
                        reward: editPack[senderID].reward
                    });
                    save("DB/TCG/pack.json", JSON.stringify(pack, null, 4));
                    channel.sendChat("✅ '" + editPack[senderID].name + "' 패키지가 성공적으로 추가되었습니다.");
                }
                if (editPack[senderID].type == "수정") {
                    pack.find(p => p.name == editPack[senderID].name).reward = editPack[senderID].reward;
                    save("DB/TCG/pack.json", JSON.stringify(pack, null, 4));
                    channel.sendChat("✅ '" + editPack[senderID].name + "' 패키지가 성공적으로 수정되었습니다.");
                }
                if (editPack[senderID].type == "추가쿠폰") {
                    let new_coupon = {
                        coupon: editPack[senderID].name,
                        reward: editPack[senderID].reward
                    };
                    if (editPack[senderID].onetime) new_coupon.onetime = true;
                    coupon.push(new_coupon);
                    save("DB/TCG/coupon.json", JSON.stringify(coupon, null, 4));
                    channel.sendChat("✅ '" + editPack[senderID].name + "' 쿠폰이 성공적으로 추가되었습니다.");
                }
                if (editPack[senderID].type == "수정쿠폰") {
                    coupon.find(p => p.coupon == editPack[senderID].name).reward = editPack[senderID].reward;
                    save("DB/TCG/coupon.json", JSON.stringify(coupon, null, 4));
                    channel.sendChat("✅ '" + editPack[senderID].name + "' 쿠폰이 성공적으로 수정되었습니다.");
                }
                if (editPack[senderID].type == "핫타임") {
                    let hotTime = {
                        reward: editPack[senderID].reward
                    };
                    save("DB/TCG/hotTime.json", JSON.stringify(hotTime, null, 4));
                    channel.sendChat("✅ 핫타임 보상이 수정되었습니다.");
                }
                
                delete editPack[senderID];
                return;
            }
            let items = JSON.parse(read("DB/TCG/item.json"));
            let cards = JSON.parse(read("DB/TCG/card.json"));
            let parsed = parseItemString(msg);
            if (!parsed) {
                channel.sendChat("❌ 양식에 맞게 입력해주세요.");
            } else if ((parsed.item || parsed.card) && ((!items.find(i => i.name == parsed.name) && !items.find(i => ("[" + parsed.title + "]" + parsed.name) == i.name)) && (!cards.find(i => i.name == parsed.name) && !items.find(i => ("[" + parsed.title + "]" + parsed.name) == i.name)))) {
                channel.sendChat("❌ 존재하지 않는 아이템입니다.");
            } else {
                if (items.find(i => "[" + parsed.title + "]" + parsed.name == i.name)) {
                    parsed = {
                        item: true,
                        name: "[" + parsed.title + "]" + parsed.name,
                        count: parsed.count
                    };
                }
                editPack[senderID].reward.push(parsed);
                channel.sendChat("✅ 추가되었습니다.");
            }
            return;
        }

        // chooseCard 처리 (선택팩, 경험치물약)
        if (chooseCard[senderID]) {
            // 주사위 선택 처리
            if (chooseCard[senderID].type == "주사위선택") {
                const validDice = ["희미한 주사위","빛나는 주사위","찬란한 주사위","운명 주사위","심판 주사위"];
                if (!validDice.includes(msg)) {
                    channel.sendChat("❌ 올바른 주사위를 입력해주세요.\n선택 가능: " + validDice.join(", "));
                    return;
                }
                let user = await getTCGUserById(senderID);
                let items = JSON.parse(read("DB/TCG/item.json"));
                if (msg == "희미한 주사위") {
                    let idx = items.findIndex(i => i.name == "희미한 주사위");
                    if (idx >= 0) user.addItem(idx, chooseCard[senderID].num * 100);
                } else if (msg == "빛나는 주사위") {
                    let idx = items.findIndex(i => i.name == "빛나는 주사위");
                    if (idx >= 0) user.addItem(idx, chooseCard[senderID].num * 65);
                } else if (msg == "찬란한 주사위") {
                    let idx = items.findIndex(i => i.name == "찬란한 주사위");
                    if (idx >= 0) user.addItem(idx, chooseCard[senderID].num * 35);
                } else if (msg == "운명 주사위") {
                    let idx = items.findIndex(i => i.name == "운명 주사위");
                    if (idx >= 0) user.addItem(idx, chooseCard[senderID].num * 15);
                } else if (msg == "심판 주사위") {
                    let idx = items.findIndex(i => i.name == "심판 주사위");
                    if (idx >= 0) user.addItem(idx, chooseCard[senderID].num * 5);
                }
                await user.save();
                channel.sendChat("✅ '" + msg + "'를 선택했습니다.\n선택한 주사위가 지급되었습니다.");
                delete chooseCard[senderID];
                return;
            }

            let cards = JSON.parse(read("DB/TCG/card.json"));
            let parsed = parseItemString(msg);
            if (!parsed || !parsed.card) {
                channel.sendChat("❌ 카드 양식을 맞춰서 입력해주세요.\n카드 양식: [테마]카드명");
            } else if (!cards.find(i => i.name == parsed.name && i.title == parsed.title) && parsed.title != "성장형") {
                channel.sendChat("❌ 존재하지 않는 카드입니다.");
            } else {
                if (chooseCard[senderID].canChoose) {
                    if (!chooseCard[senderID].canChoose.find(i => i.name == parsed.name && i.title == parsed.title)) {
                        channel.sendChat("❌ 선택할 수 없는 카드입니다.\n\n[ 선택 가능 카드 목록 ]\n" + VIEWMORE + chooseCard[senderID].canChoose.map(c => "- [" + c.title + "]" + c.name).join("\n"));
                    } else {
                        let user = await getTCGUserById(senderID);
                        chooseCard[senderID].num--;
                        let cardIdx = cards.findIndex(i => i.name == parsed.name && i.title == parsed.title);
                        user.addCard(cardIdx, 1);
                        await user.save();
                        channel.sendChat("✅ 카드를 " + (chooseCard[senderID].num <= 0 ? "모두 " : "") + "선택했습니다." + (chooseCard[senderID].num > 0 ? "\n" + chooseCard[senderID].num + "장의 카드를 더 골라주세요." : "\n모든 카드가 성공적으로 지급되었습니다."));
                        if (chooseCard[senderID].num <= 0) delete chooseCard[senderID];
                    }
                } else if (chooseCard[senderID].type == "경험치물약") {
                    let user = await getTCGUserById(senderID);
                    let cardIdx = cards.findIndex(c => c.title == parsed.title && c.name == parsed.name);
                    let card = user.inventory.card.find(c => c.id == cardIdx);
                    let maxLevels = {
                        "일반": 1,
                        "고급": 2,
                        "희귀": 3,
                        "영웅": 4,
                        "전설": 5
                    };
                    let needExp = {
                        "일반": 1000,
                        "고급": 10000,
                        "희귀": 50000,
                        "영웅": 160000,
                        "전설": 400000
                    };
                    if (!card) card = user.growthCard.find(c => c.name == parsed.name && c.title == parsed.title);
                    let mainCard = (cardIdx == -1 ? {} : cards[cardIdx]);
                    mainCard.deepMerge((card || {}));
                    if (!card) {
                        channel.sendChat("❌ 보유하고 있는 카드가 아닙니다.");
                    } else if (card.level >= maxLevels[mainCard.rarity] + (card.breakLimit ? 1:0)) {
                        channel.sendChat("❌ 이미 최대 레벨인 카드입니다." + (card.breakLimit ? "" : "\n카드를 한계 돌파하여 1회 더 강화할 수 있습니다."));
                    } else if (mainCard.desc && mainCard.desc.startsWith("노스타코인")) {
                        channel.sendChat("❌ 강화 불가 카드입니다.");
                    } else {
                        if (!card.exp) card.exp = 0;
                        card.exp += chooseCard[senderID].num;
                        channel.sendChat("✅ " + msg + " 카드의 경험치가 +" + chooseCard[senderID].num.toComma2() + " 증가했습니다. (" + card.exp.toComma2() + "/" + needExp[mainCard.rarity].toComma2() + ")");
                        await checkCardLevelUp(mainCard, card, channel);
                        await user.save();
                        delete chooseCard[senderID];
                    }
                }
            }
            return;
        }

        if (msg.startsWith(">eval ")) {
            try {
                let evalResult = eval(msg.substring(6));
                channel.sendChat(evalResult);
            } catch(e) {
                let fuck = e;
                console.log(fuck);
                channel.sendChat("오류 발생!\n" + fuck.message);
            }
        }
        // tcgenius: 등록/로그인
        if (msg.startsWith("/") && ["442097040687921","18456115567715763","18459877269595903","18459877099603713"].includes(roomid+"")) {
            const cmd = msg.substr(1).trim();
            if (cmd.toLowerCase().startsWith("tcg") || cmd.toLowerCase().startsWith("tcgenius")) {
                const args = cmd.substr(cmd.split(" ")[0].length + 1).split(" ");

                // 등록
                if (args[0] == "등록") {
                    const nickname = cmd.substr(cmd.split(" ")[0].length + 4).trim();
                    const existingById = await getTCGUserById(sender.userId+"");
                    if (existingById) {
                        reply("❌ 이미 로그인된 상태입니다: " + existingById.name);
                    } else {
                        const existsByName = await getTCGUserByName(nickname);
                        if (existsByName) {
                            channel.sendChat("❌ 이미 존재하는 이름입니다.");
                        } else if (nickname.match(/[^가-힣ㄱ-ㅎa-zA-Z0-9\s]/) || nickname.length == 0) {
                            channel.sendChat("❌ 닉네임은 한글, 영어, 숫자 및 공백만 들어갈 수 있습니다.");
                        } else if (nickname.length > 10) {
                            channel.sendChat("❌ 닉네임은 최대 10글자로 설정하셔야 합니다.");
                        } else {
                            myCheck[sender.userId+""] = {
                                type: "tcg등록",
                                arg: { name: nickname }
                            };
                            reply("닉네임: [ " + nickname + " ]\n정말 등록하시겠습니까?\n\n[ /TCGenius 확인 ]");
                        }
                    }
                    return;
                }

                // 로그인
                if (args[0] == "로그인") {
                    const existingById = await getTCGUserById(sender.userId+"");
                    if (existingById) {
                        reply("❌ 이미 로그인된 상태입니다: " + existingById.name);
                        return;
                    }
                    const code = args[1];
                    const login_user = await getTCGUserByCode(code);
                    if (login_user) {
                        if (!Array.isArray(login_user.logged_in)) login_user.logged_in = [];
                        if (!login_user.logged_in.includes(sender.userId+"")) login_user.logged_in.push(sender.userId+"");
                        await login_user.changeCode();
                        await login_user.save();
                        reply("✅ " + login_user + " 계정으로 로그인했습니다.");
                    } else {
                        channel.sendChat("❌ 잘못된 코드입니다.");
                    }
                    return;
                }

                // 확인 (등록 확정)
                if (myCheck[sender.userId+""] && args[0] == "확인") {
                    if (myCheck[sender.userId+""].type == "tcg등록") {
                        const user = new TCGUser(myCheck[sender.userId+""].arg.name, sender.userId+"");
                        const res = await putItem('tcg_user', user);
                        if (res.success) {
                            reply("✅ 성공적으로 등록되셨습니다!\n환영합니다, " + user.name + "님!");
                        } else {
                            reply("❌ 등록 과정에서 오류가 발생했습니다.\n" + VIEWMORE + "\n" + (res.result && res.result[0] && (res.result[0].message || res.result[0].Message) || "Unknown Error"));
                        }
                    }
                    delete myCheck[sender.userId+""];
                    return;
                }

                const user = await getTCGUserById(sender.userId+"");
                if (!user) {
                    channel.sendChat("❌ 등록되지 않은 사용자입니다.\n/TCGenius 등록 [닉네임]");
                    return;
                }

                if (user.daily_quest[0] != (new Date().toYYYYMMDD())) {
                    user.daily_quest = [(new Date().toYYYYMMDD())];
                    await user.save();
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
                    return;
                }

                if (args[0] == "로그아웃") {
                    if (Array.isArray(user.logged_in)) {
                        user.logged_in = user.logged_in.filter(id => id !== sender.userId+"");
                    }
                    await user.save();
                    channel.sendChat("✅ " + user + " 계정에서 로그아웃했습니다.");
                    return;
                }

                // 일뽑
                if (args[0] == "일뽑") {
                    let num = 1;
                    if (!isNaN(args[1])) num = Number(args[1]);
                    if (num != 1 && num != 10) {
                        channel.sendChat("❌ 단차 또는 10연차만 가능합니다.");
                        return;
                    }
                    let need = num;
                    const normalTicket = user.inventory.item.find(i => i.id == 1);
                    if (normalTicket) {
                        if (normalTicket.count >= num) {
                            user.removeItem(1, need);
                            need = 0;
                        } else {
                            need -= normalTicket.count;
                            user.removeItem(1, normalTicket.count);
                        }
                    }
                    if ((need * 100) > user.garnet) {
                        channel.sendChat("❌ 가넷이 부족합니다!");
                        return;
                    }
                    user.garnet -= (need * 100);
                    let probability = JSON.parse(read("DB/TCG/probability.json"))["일반"];
                    if (user.deck.content[0].includes(508) || user.deck.content[1].includes(508) || user.deck.gold.includes(508)) {
                        probability[4] += 0.01;
                        probability[3] -= 0.01;
                    }
                    let result = [
                        {rarity: "전설", count: 0},
                        {rarity: "영웅", count: 0},
                        {rarity: "희귀", count: 0},
                        {rarity: "고급", count: 0},
                        {rarity: "일반", count: 0}
                    ];
                    let resDisplay = JSON.parse(JSON.stringify(result));

                    // 가챠 처리 (Node.js는 동기 처리)
                    let trueNum = num;
                    let cards = JSON.parse(read("DB/TCG/card.json"));
                    let cardResults = [];
                    
                    if (user.deck.next) {
                        let nCount = 0;
                        user.deck.next.forEach(next => {
                            if (num < 1) return;
                            let cardIdx = cards.findIndex(c => c.title == next.title && c.name == next.name);
                            if (cardIdx != -1) {
                                num--;
                                resDisplay.find(r => r.rarity == cards[cardIdx].rarity).count++;
                                user.addCard(cardIdx, 1);
                                const existingResult = cardResults.find(c => c.id == cardIdx);
                                if (existingResult) {
                                    existingResult.count++;
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
                    
                    for (let i = 0; i < num; i++) {
                        let r = Math.random();
                        let total_pb = 0;
                        for (let j = 0; j < probability.length; j++) {
                            total_pb += probability[j];
                            if (r < total_pb) {
                                result[j].count++;
                                resDisplay[j].count++;
                                break;
                            }
                        }
                    }
                    
                    for (let rs of result) {
                        for (let i = 0; i < rs.count; i++) {
                            let card = cards.filter(c => c.rarity == rs.rarity).getRandomElement();
                            let cardIdx = cards.findIndex(c => c.title == card.title && c.name == card.name);
                            user.addCard(cardIdx, 1);
                            const existingResult = cardResults.find(c => c.name == "[" + card.title + "]" + card.name);
                            if (existingResult) {
                                existingResult.count++;
                            } else {
                                cardResults.push({
                                    rarity: card.rarity,
                                    name: "[" + card.title + "]" + card.name,
                                    count: 1
                                });
                            }
                        }
                    }
                    
                    await user.save();
                    resDisplay = resDisplay.map(rs => rs.count <= 0 ? null : "- " + rs.rarity + " x" + rs.count).filter(rs => rs != null);
                    await user.checkQuest("[소환] 오늘은 뜬다 전설", channel);
                    channel.sendChat("[ 일뽑 x" + numberWithCommas(trueNum.toString()) + " 결과 ]\n" + resDisplay.join("\n") + "\n\n[ 획득한 카드 ]\n" + VIEWMORE + cardResults.map(cr => "<" + cr.rarity + "> " + cr.name + (cr.count > 1 ? " x" + cr.count : "")).join("\n"));
                    return;
                }

                // 픽뽑1, 픽뽑2
                if (args[0] == "픽뽑1" || args[0] == "픽뽑2") {
                    let picknum = Number(args[0].substr(2)) - 1;
                    let num = 1;
                    if (!isNaN(args[1])) num = Number(args[1]);
                    if (num != 1 && num != 10) {
                        channel.sendChat("❌ 단차 또는 10연차만 가능합니다.");
                        return;
                    }
                    let need = num;
                    const pickupTicket = user.inventory.item.find(i => i.id == 2);
                    if (pickupTicket) {
                        if (pickupTicket.count >= num) {
                            user.removeItem(2, need);
                            need = 0;
                        } else {
                            need -= pickupTicket.count;
                            user.removeItem(2, pickupTicket.count);
                        }
                    }
                    if ((need * 100) > user.garnet) {
                        channel.sendChat("❌ 가넷이 부족합니다!");
                        return;
                    }
                    user.garnet -= (need * 100);
                    let probability = JSON.parse(read("DB/TCG/probability.json"))["픽업"];
                    let result = [
                        {rarity: "픽업전설", count: 0},
                        {rarity: "픽업영웅", count: 0},
                        {rarity: "픽업희귀", count: 0},
                        {rarity: "픽업고급", count: 0},
                        {rarity: "픽업일반", count: 0},
                        {rarity: "전설", count: 0},
                        {rarity: "영웅", count: 0},
                        {rarity: "희귀", count: 0},
                        {rarity: "고급", count: 0},
                        {rarity: "일반", count: 0}
                    ];

                    // 가챠 처리
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
                    let cards = JSON.parse(read("DB/TCG/card.json"));
                    let items = JSON.parse(read("DB/TCG/item.json"));
                    let theme = JSON.parse(read("DB/TCG/pickupRotation.json")).currentTheme[picknum];
                    
                    for (let rs of result) {
                        for (let i = 0; i < rs.count; i++) {
                            let card;
                            if (rs.rarity.includes("픽업")) {
                                card = cards.filter(c => c.title == theme && c.rarity == rs.rarity.replace("픽업",""));
                                if (card.length > 0) card = card.getRandomElement();
                                else card = cards.filter(c => c.rarity == rs.rarity.replace("픽업","")).getRandomElement();
                            } else {
                                card = cards.filter(c => c.rarity == rs.rarity).getRandomElement();
                            }
                            let cardIdx = cards.findIndex(c => c.title == card.title && c.name == card.name);
                            user.addCard(cardIdx, 1);
                            const existingResult = cardResults.find(c => c.name == "[" + card.title + "]" + card.name);
                            if (existingResult) {
                                existingResult.count++;
                            } else {
                                cardResults.push({
                                    rarity: card.rarity,
                                    name: "[" + card.title + "]" + card.name,
                                    count: 1
                                });
                            }
                        }
                    }
                    
                    await user.checkQuest("[소환] 오늘은 뜬다 전설", channel);
                    
                    let prevPickupStack = user.pickupStack[picknum] || 0;
                    if (user.pickupStack[picknum] == undefined) {
                        user.pickupStack[picknum] = 0;
                    }
                    user.pickupStack[picknum] += num;
                    
                    // 픽업 스택 보상
                    if (prevPickupStack < 40 && user.pickupStack[picknum] >= 40) {
                        if (picknum == 0) {
                            user.gold += 100000;
                            channel.sendChat("[ 픽업1 40회 소환 보상 ]\n- 100,000 골드 획득");
                        } else if (picknum == 1) {
                            user.gold += 50000;
                            channel.sendChat("[ 픽업2 40회 소환 보상 ]\n- 50,000 골드 획득");
                        }
                    }
                    if (prevPickupStack < 80 && user.pickupStack[picknum] >= 80) {
                        if (picknum == 0) {
                            user.addItem(6, 1);
                            channel.sendChat("[ 픽업1 80회 소환 보상 ]\n- 강화자물쇠 x1 획득");
                        } else if (picknum == 1) {
                            user.addItem(5, 1);
                            channel.sendChat("[ 픽업2 80회 소환 보상 ]\n- 보호자물쇠 x1 획득");
                        }
                    }
                    if (prevPickupStack < 120 && user.pickupStack[picknum] >= 120) {
                        if (picknum == 0) {
                            user.addItem(2, 10);
                            channel.sendChat("[ 픽업1 120회 소환 보상 ]\n- 픽업 소환권 x10 획득");
                        } else if (picknum == 1) {
                            user.addItem(2, 10);
                            channel.sendChat("[ 픽업2 120회 소환 보상 ]\n- 픽업 소환권 x10 획득");
                        }
                    }
                    if (prevPickupStack < 160 && user.pickupStack[picknum] >= 160) {
                        if (picknum == 0) {
                            user.addItem(30, 1);
                            channel.sendChat("[ 픽업1 160회 소환 보상 ]\n- 100% +1 강화권 x1 획득");
                        } else if (picknum == 1) {
                            user.addItem(16, 1);
                            channel.sendChat("[ 픽업2 160회 소환 보상 ]\n- 영웅초월권 x1 획득");
                        }
                    }
                    if (prevPickupStack < 200 && user.pickupStack[picknum] >= 200) {
                        if (picknum == 0) {
                            let itemIdx = items.findIndex(item => item.name == "[" + theme + "]테마 카드 선택팩");
                            user.addItem(itemIdx, 1);
                            channel.sendChat("[ 픽업1 200회 소환 보상 ]\n- [" + theme + "]테마 카드 선택팩 x1 획득");
                        } else if (picknum == 1) {
                            let itemIdx = items.findIndex(item => item.name == "[" + theme + "]테마 카드 선택팩");
                            user.addItem(itemIdx, 1);
                            channel.sendChat("[ 픽업2 200회 소환 보상 ]\n- [" + theme + "]테마 카드 선택팩 x1 획득");
                        }
                        user.pickupStack[picknum] -= 200;
                    }
                    
                    await user.save();
                    result = result.map(rs => rs.count <= 0 ? null : "- " + (rs.rarity.includes("픽업") ? "★픽업 " : "") + rs.rarity.replace("픽업","") + " x" + rs.count).filter(rs => rs != null);
                    channel.sendChat("[ 픽뽑" + (picknum + 1) + " x" + numberWithCommas(num.toString()) + " 결과 ]\n" + result.join("\n") + "\n\n[ 획득한 카드 ]\n" + VIEWMORE + cardResults.map(cr => "<" + cr.rarity + "> " + cr.name + (cr.count > 1 ? " x" + cr.count : "")).join("\n"));
                    return;
                }

                // 인벤토리
                if (args[0] == "인벤토리" || args[0].toLowerCase() == "i" || args[0].toLowerCase() == "inv" || args[0].toLowerCase() == "inventory") {
                    let results = [];
                    let goods = [];
                    goods.push("🪙 골드 " + numberWithCommas(user.gold.toString()));
                    goods.push("💠 가넷 " + numberWithCommas(user.garnet.toString()));
                    goods.push("💰 포인트 " + numberWithCommas(user.p.toString()) + "p");

                    if (user.inventory.item.length > 0) {
                        results.push("○ 아이템");
                        let items = JSON.parse(read("DB/TCG/item.json"));
                        user.inventory.item.sort((a, b) => {
                            if (items[a.id].type != items[b.id].type) {
                                return items[a.id].type.localeCompare(items[b.id].type);
                            }
                            return a.id - b.id;
                        }).forEach(invItem => {
                            let item = items[invItem.id];
                            results.push("<" + item.type + "> " + item.name + " x" + invItem.count.toComma());
                        });
                    }

                    // 카드 개수 표시 (별도 명령어 안내)
                    let totalCards = user.inventory.card.reduce((sum, c) => sum + c.count, 0);
                    if (user.growthCard.length > 0) totalCards += user.growthCard.length;
                    if (totalCards > 0) {
                        results.push("");
                        results.push("○ 카드: " + totalCards.toComma2() + "장");
                        results.push("  » 카드 확인: /TCGenius 카드 [페이지]");
                    }

                    channel.sendChat("[ " + user + "님의 인벤토리 ]\n" + goods.join("\n") + (results.length == 0 ? "\n\n인벤토리가 비어있습니다." : "\n" + VIEWMORE + "\n" + results.join("\n")));
                    return;
                }

                // 인벤토리 카드 (페이지별)
                if (args[0] == "카드" || args[0] == "인벤토리카드") {
                    let page = 1;
                    if (args[1] && !isNaN(parseInt(args[1]))) {
                        page = parseInt(args[1]);
                    }
                    if (page < 1) page = 1;

                    let allCards = [];
                    
                    // 성장 카드 추가
                    if (user.growthCard.length > 0) {
                        user.growthCard.forEach(card => {
                            allCards.push({
                                display: printCard(card) + " 🔒",
                                rarity: card.rarity,
                                id: -1
                            });
                        });
                    }

                    // 일반 카드 추가
                    if (user.inventory.card.length > 0) {
                        let cards = JSON.parse(read("DB/TCG/card.json"));
                        var gradeOrder = {
                            '일반': 1,
                            '고급': 2,
                            '희귀': 3,
                            '영웅': 4,
                            '전설': 5
                        };
                        
                        let sortedCards = user.inventory.card.sort(function(a, b) {
                            var gradeA = gradeOrder[cards[a.id].rarity] || 0;
                            var gradeB = gradeOrder[cards[b.id].rarity] || 0;
                            
                            if (gradeA !== gradeB) {
                                return gradeB - gradeA;
                            }
                            
                            return a.id - b.id;
                        });

                        sortedCards.forEach(invCard => {
                            let card = cards[invCard.id];
                            card.level = invCard.level;
                            card.transcend = invCard.transcend;
                            card.breakLimit = invCard.breakLimit;
                            allCards.push({
                                display: printCard(card) + (invCard.count > 1 ? " x" + invCard.count.toComma2() : "") + (invCard.lock ? " 🔒":""),
                                rarity: card.rarity,
                                id: invCard.id
                            });
                        });
                    }

                    if (allCards.length == 0) {
                        channel.sendChat("❌ 보유한 카드가 없습니다.");
                        return;
                    }

                    // 페이지 당 30개씩
                    let itemsPerPage = 30;
                    let totalPages = Math.ceil(allCards.length / itemsPerPage);
                    
                    if (page > totalPages) page = totalPages;

                    let startIdx = (page - 1) * itemsPerPage;
                    let endIdx = Math.min(startIdx + itemsPerPage, allCards.length);
                    let pageCards = allCards.slice(startIdx, endIdx);

                    let message = "[ " + user + "님의 카드 (" + page + "/" + totalPages + " 페이지) ]\n";
                    message += "총 " + allCards.length.toComma2() + "장\n";
                    message += VIEWMORE + "\n";
                    message += pageCards.map(c => c.display).join("\n");

                    if (totalPages > 1) {
                        message += "\n\n";
                        if (page > 1) {
                            message += "« 이전: /TCGenius 카드 " + (page - 1);
                        }
                        if (page < totalPages) {
                            if (page > 1) message += " | ";
                            message += "다음: /TCGenius 카드 " + (page + 1) + " »";
                        }
                    }

                    channel.sendChat(message);
                    return;
                }

                // 카드검색 (내 카드에서 검색)
                if (args[0] == "카드검색") {
                    if (!args[1]) {
                        channel.sendChat("❌ 잘못된 입력입니다.\n[ /TCGenius 카드검색 [테마|이름|등급] [키워드] ]");
                        return;
                    }
                    let mode = args[1];
                    let keyword = cmd.substr(cmd.split(" ")[0].length + 1 + args[0].length + 1 + mode.length + 1).trim();
                    if (!keyword) {
                        channel.sendChat("❌ 키워드를 입력해주세요.\n[ /TCGenius 카드검색 " + mode + " [키워드] ]");
                        return;
                    }
                    let cards = JSON.parse(read("DB/TCG/card.json"));
                    // 내 카드 풀 구성: 인벤토리 카드 병합 후 필터
                    let myCards = [];
                    user.inventory.card.forEach(invCard => {
                        let base = cards[invCard.id] ? cards[invCard.id].concat() : null;
                        if (!base) return;
                        let merged = base;
                        merged.deepMerge(invCard);
                        myCards.push({ card: merged, count: invCard.count || 1, lock: !!invCard.lock, id: invCard.id, rarity: merged.rarity });
                    });
                    let results = [];
                    if (mode == "테마") {
                        results = myCards.filter(c => ((c.card.title || "").toLowerCase().includes(keyword.toLowerCase())));
                    } else if (mode == "이름") {
                        let kw = keyword.replace(/\s/gi, "");
                        results = myCards.filter(c => (((c.card.name || "").replace(/\s/gi, "")).toLowerCase().includes(kw.toLowerCase())));
                    } else if (mode == "등급") {
                        results = myCards.filter(c => ((c.card.rarity || "") == keyword));
                    } else {
                        channel.sendChat("❌ 검색 종류가 올바르지 않습니다.\n[ 테마 | 이름 | 등급 ] 중에서 선택해주세요.");
                        return;
                    }
                    if (!results.length) {
                        channel.sendChat("[ 카드 " + mode + " '" + keyword + "' 검색 결과 ]\n\n검색 결과가 없습니다.");
                        return;
                    }
                    // 정렬: 등급 내림차순 -> ID 오름차순 (인벤토리 카드 정렬 방식 준용)
                    var gradeOrder = { '일반':1, '고급':2, '희귀':3, '영웅':4, '전설':5 };
                    results.sort(function(a, b){
                        var gradeA = gradeOrder[a.rarity] || 0;
                        var gradeB = gradeOrder[b.rarity] || 0;
                        if (gradeA !== gradeB) return gradeB - gradeA;
                        return (a.id||0) - (b.id||0);
                    });
                    // 출력 구성
                    let list = results.map(e => printCard(e.card) + (e.count > 1 ? " x" + e.count.toComma2() : "") + (e.lock ? " 🔒" : ""));
                    if (list.length > 60) list = list.slice(0, 60);
                    channel.sendChat("[ 카드 " + mode + " '" + keyword + "' 검색 결과 ]\n" + VIEWMORE + "\n" + (results.length > 60 ? VIEWMORE + "\n" : "") + list.join("\n"));
                    return;
                }

                // 골드추가
                if (args[0] == "골드추가" && user.isAdmin) {
                    let target = cmd.substr(cmd.split(" ")[0].length + 6);
                    let num = 1;
                    if (!isNaN(target.split(" ").pop())) {
                        let target_split = target.split(" ");
                        num = parseInt(target_split.pop());
                        target = target_split.join(" ");
                    }
                    let targetUser = await getTCGUserByName(target);
                    if (!targetUser) {
                        channel.sendChat("❌ 존재하지 않는 유저입니다: " + target);
                    } else if (num < 1) {
                        channel.sendChat("❌ 수량을 제대로 입력해주세요.");
                    } else {
                        targetUser.gold += num;
                        await targetUser.save();
                        channel.sendChat("✅ " + targetUser + "님에게 " + numberWithCommas(num.toString()) + " 골드를 추가했습니다.");
                    }
                    return;
                }

                // 골드차감
                if (args[0] == "골드차감" && user.isAdmin) {
                    let target = cmd.substr(cmd.split(" ")[0].length + 6);
                    let num = 1;
                    if (!isNaN(target.split(" ").pop())) {
                        let target_split = target.split(" ");
                        num = parseInt(target_split.pop());
                        target = target_split.join(" ");
                    }
                    let targetUser = await getTCGUserByName(target);
                    if (!targetUser) {
                        channel.sendChat("❌ 존재하지 않는 유저입니다: " + target);
                    } else if (num < 1) {
                        channel.sendChat("❌ 수량을 제대로 입력해주세요.");
                    } else {
                        targetUser.gold -= num;
                        await targetUser.save();
                        channel.sendChat("✅ " + targetUser + "님에게서 " + numberWithCommas(num.toString()) + " 골드를 차감했습니다.");
                    }
                    return;
                }

                // 골드설정
                if (args[0] == "골드설정" && user.isAdmin) {
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
                    let targetUser = await getTCGUserByName(target);
                    if (!targetUser) {
                        channel.sendChat("❌ 존재하지 않는 유저입니다: " + target);
                    } else if (num < 0) {
                        channel.sendChat("❌ 수량을 제대로 입력해주세요.");
                    } else {
                        targetUser.gold = num;
                        await targetUser.save();
                        channel.sendChat("✅ " + targetUser + "님의 골드를 " + numberWithCommas(num.toString()) + " 골드로 수정했습니다.");
                    }
                    return;
                }

                // 가넷추가
                if (args[0] == "가넷추가" && user.isAdmin) {
                    let target = cmd.substr(cmd.split(" ")[0].length + 6);
                    let num = 1;
                    if (!isNaN(target.split(" ").pop())) {
                        let target_split = target.split(" ");
                        num = parseInt(target_split.pop());
                        target = target_split.join(" ");
                    }
                    let targetUser = await getTCGUserByName(target);
                    if (!targetUser) {
                        channel.sendChat("❌ 존재하지 않는 유저입니다: " + target);
                    } else if (num < 1) {
                        channel.sendChat("❌ 수량을 제대로 입력해주세요.");
                    } else {
                        targetUser.garnet += num;
                        await targetUser.save();
                        channel.sendChat("✅ " + targetUser + "님에게 " + numberWithCommas(num.toString()) + " 가넷을 추가했습니다.");
                    }
                    return;
                }

                // 가넷차감
                if (args[0] == "가넷차감" && user.isAdmin) {
                    let target = cmd.substr(cmd.split(" ")[0].length + 6);
                    let num = 1;
                    if (!isNaN(target.split(" ").pop())) {
                        let target_split = target.split(" ");
                        num = parseInt(target_split.pop());
                        target = target_split.join(" ");
                    }
                    let targetUser = await getTCGUserByName(target);
                    if (!targetUser) {
                        channel.sendChat("❌ 존재하지 않는 유저입니다: " + target);
                    } else if (num < 1) {
                        channel.sendChat("❌ 수량을 제대로 입력해주세요.");
                    } else {
                        targetUser.garnet -= num;
                        await targetUser.save();
                        channel.sendChat("✅ " + targetUser + "님에게서 " + numberWithCommas(num.toString()) + " 가넷을 차감했습니다.");
                    }
                    return;
                }

                // 가넷설정
                if (args[0] == "가넷설정" && user.isAdmin) {
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
                    let targetUser = await getTCGUserByName(target);
                    if (!targetUser) {
                        channel.sendChat("❌ 존재하지 않는 유저입니다: " + target);
                    } else if (num < 0) {
                        channel.sendChat("❌ 수량을 제대로 입력해주세요.");
                    } else {
                        targetUser.garnet = num;
                        await targetUser.save();
                        channel.sendChat("✅ " + targetUser + "님의 가넷을 " + numberWithCommas(num.toString()) + " 가넷으로 수정했습니다.");
                    }
                    return;
                }

                // 포인트추가
                if (args[0] == "포인트추가" && user.isAdmin) {
                    let target = cmd.substr(cmd.split(" ")[0].length + 7);
                    let num = 1;
                    if (!isNaN(target.split(" ").pop())) {
                        let target_split = target.split(" ");
                        num = parseInt(target_split.pop());
                        target = target_split.join(" ");
                    }
                    let targetUser = await getTCGUserByName(target);
                    if (!targetUser) {
                        channel.sendChat("❌ 존재하지 않는 유저입니다: " + target);
                    } else if (num < 1) {
                        channel.sendChat("❌ 수량을 제대로 입력해주세요.");
                    } else {
                        let vipPlus = [0,0,0,0,0,0,0.01,0.02,0.03,0.04,0.05,0.1];
                        num = num + Math.round(num * vipPlus[targetUser.vip]);
                        let vipMsg = null;
                        targetUser.p += num;
                        targetUser.total_point += num;
                        let total_pack = [];
                        let vip_pack = JSON.parse(read("DB/TCG/vip_pack.json"));
                        let vip_need = [0,1000,5000,10000,30000,50000,100000,150000,200000,300000,500000,1000000];
                        for (let i = 1; i < vip_need.length; i++) {
                            if (targetUser.vip < i && targetUser.total_point >= vip_need[i]) {
                                targetUser.vip = i;
                                targetUser.title = "VIP" + i;
                                total_pack = total_pack.concat(vip_pack[i]);
                                vipMsg = "✨ VIP" + i + " 달성!";
                            }
                        }
                        let result = null;
                        if (total_pack.length > 0) {
                            result = targetUser.givePack(total_pack);
                        }
                        await targetUser.save();
                        channel.sendChat("✅ " + targetUser + "님에게 " + numberWithCommas(num.toString()) + " 포인트를 추가했습니다." + (vipPlus[targetUser.vip] > 0 ? " (+" + (vipPlus[targetUser.vip] * 100).fix() + "% 보너스!)" : "") + (vipMsg ? "\n\n" + vipMsg + "\n[ 지급 보상 ]\n" + result.join("\n") : ""));
                    }
                    return;
                }

                // 포인트차감
                if (args[0] == "포인트차감" && user.isAdmin) {
                    let target = cmd.substr(cmd.split(" ")[0].length + 7);
                    let num = 1;
                    if (!isNaN(target.split(" ").pop())) {
                        let target_split = target.split(" ");
                        num = parseInt(target_split.pop());
                        target = target_split.join(" ");
                    }
                    let targetUser = await getTCGUserByName(target);
                    if (!targetUser) {
                        channel.sendChat("❌ 존재하지 않는 유저입니다: " + target);
                    } else if (num < 1) {
                        channel.sendChat("❌ 수량을 제대로 입력해주세요.");
                    } else {
                        targetUser.p -= num;
                        await targetUser.save();
                        channel.sendChat("✅ " + targetUser + "님에게서 " + numberWithCommas(num.toString()) + " 포인트를 차감했습니다.");
                    }
                    return;
                }

                // 포인트회수
                if (args[0] == "포인트회수" && user.isAdmin) {
                    let target = cmd.substr(cmd.split(" ")[0].length + 7);
                    let num = 1;
                    if (!isNaN(target.split(" ").pop())) {
                        let target_split = target.split(" ");
                        num = parseInt(target_split.pop());
                        target = target_split.join(" ");
                    }
                    let targetUser = await getTCGUserByName(target);
                    if (!targetUser) {
                        channel.sendChat("❌ 존재하지 않는 유저입니다: " + target);
                    } else if (num < 1) {
                        channel.sendChat("❌ 수량을 제대로 입력해주세요.");
                    } else {
                        targetUser.total_point -= num;
                        await targetUser.save();
                        channel.sendChat("✅ " + targetUser + "님에게서 " + numberWithCommas(num.toString()) + " 포인트(VIP 누적 포인트)를 회수했습니다.");
                    }
                    return;
                }

                // 포인트설정
                if (args[0] == "포인트설정" && user.isAdmin) {
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
                    let targetUser = await getTCGUserByName(target);
                    if (!targetUser) {
                        channel.sendChat("❌ 존재하지 않는 유저입니다: " + target);
                    } else if (num < 0) {
                        channel.sendChat("❌ 수량을 제대로 입력해주세요.");
                    } else {
                        targetUser.p = num;
                        await targetUser.save();
                        channel.sendChat("✅ " + targetUser + "님의 포인트를 " + numberWithCommas(num.toString()) + " 포인트로 수정했습니다.");
                    }
                    return;
                }

                // 카드지급
                if (args[0] == "카드지급" && user.isAdmin) {
                    let arg = cmd.substr(cmd.split(" ")[0].length + 6).split(" ");
                    if (arg.length == 0) {
                        channel.sendChat("❌ 잘못된 입력입니다.\n[ /TCGenius 카드지급 <유저명> <카드> <개수> ]");
                        return;
                    }
                    let num = 1;
                    if (arg.length != 2) num = Number(arg.pop());
                    if (isNaN(num) || num % 1 != 0 || num < 1) {
                        num = 1;
                    }
                    let target = await getTCGUserByName(arg[0]);
                    if (!target) {
                        channel.sendChat("❌ 존재하지 않는 유저입니다: " + arg[0]);
                        return;
                    }
                    let card = arg.join(" ").substr(arg[0].length + 1);
                    if (card.length == 0) {
                        channel.sendChat("❌ 잘못된 입력입니다.\n[ /TCGenius 카드지급 <유저명> <카드> <개수> ]");
                        return;
                    }
                    let cards = JSON.parse(read("DB/TCG/card.json"));
                    if (!isNaN(card) && cards[Number(card)]) card = Number(card);
                    else card = cards.findIndex(c => ("[" + c.title + "]" + c.name) == card);
                    if (!cards[card]) {
                        channel.sendChat("❌ 존재하지 않는 카드입니다.");
                        return;
                    }
                    target.addCard(card, num);
                    await target.save();
                    channel.sendChat("✅ " + target + "님에게 [" + (cards[card].title) + "]" + cards[card].name + " 카드 " + num + "장을 지급했습니다.");
                    return;
                }

                // 카드제거
                if (args[0] == "카드제거" && user.isAdmin) {
                    let arg = cmd.substr(cmd.split(" ")[0].length + 6).split(" ");
                    if (arg.length == 0) {
                        channel.sendChat("❌ 잘못된 입력입니다.\n[ /TCGenius 카드제거 <유저명> <카드> <개수> ]");
                        return;
                    }
                    let num = Number(arg.pop());
                    let target = await getTCGUserByName(arg[0]);
                    if (!target) {
                        channel.sendChat("❌ 존재하지 않는 유저입니다: " + arg[0]);
                        return;
                    }
                    let card = arg.join(" ").substr(arg[0].length + 1);
                    if (card.length == 0) {
                        channel.sendChat("❌ 잘못된 입력입니다.\n[ /TCGenius 카드제거 <유저명> <카드> <개수> ]");
                        return;
                    }
                    let cards = JSON.parse(read("DB/TCG/card.json"));
                    let cardIdx = -1;
                    if (!isNaN(card) && cards[Number(card)]) card = Number(card);
                    else cardIdx = cards.findIndex(c => ("[" + c.title + "]" + c.name) == card);
                    if (!card.toString().startsWith("[성장형]") && cardIdx == -1) {
                        channel.sendChat("❌ 존재하지 않는 카드입니다.");
                        return;
                    }
                    if (!target.inventory.card.find(c => c.id == card) && !target.growthCard.find(c => "[" + c.title + "]" + c.name == card)) {
                        channel.sendChat("❌ 유저가 해당 카드를 보유하고 있지 않습니다.");
                        return;
                    }
                    if (isNaN(num) || num % 1 != 0 || num < 1) {
                        if (target.inventory.card.find(c => c.id == card)) num = target.inventory.card.find(c => c.id == card).count;
                    }
                    if (!target.inventory.card.find(c => c.id == card)) num = 1;
                    if (target.inventory.card.find(c => c.id == card)) target.removeCard(card, num);
                    else target.growthCard.splice(target.growthCard.findIndex(c => "[" + c.title + "]" + c.name == card), 1);
                    await target.save();
                    channel.sendChat("✅ " + target + "님에게서 " + card + " 카드 " + num + "장을 제거했습니다.");
                    return;
                }

                // 아이템지급
                if (args[0] == "아이템지급" && user.isAdmin) {
                    let arg = cmd.substr(cmd.split(" ")[0].length + 7).split(" ");
                    if (arg.length == 0) {
                        channel.sendChat("❌ 잘못된 입력입니다.\n[ /TCGenius 아이템지급 <유저명> <아이템> <개수> ]");
                        return;
                    }
                    let num = Number(arg.pop());
                    if (isNaN(num) || num % 1 != 0 || num < 1) {
                        num = 1;
                    }
                    let target = await getTCGUserByName(arg[0]);
                    if (!target) {
                        channel.sendChat("❌ 존재하지 않는 유저입니다: " + arg[0]);
                        return;
                    }
                    let item = arg.join(" ").substr(arg[0].length + 1);
                    if (item.length == 0) {
                        channel.sendChat("❌ 잘못된 입력입니다.\n[ /TCGenius 아이템지급 <유저명> <아이템> <개수> ]");
                        return;
                    }
                    let items = JSON.parse(read("DB/TCG/item.json"));
                    if (!isNaN(item) && items[Number(item)]) item = Number(item);
                    else item = items.findIndex(i => i.name == item);
                    if (item == -1) {
                        channel.sendChat("❌ 존재하지 않는 아이템입니다.");
                        return;
                    }
                    target.addItem(item, num);
                    await target.save();
                    channel.sendChat("✅ " + target + "님에게 " + items[item].name + " " + num + "개를 지급했습니다.");
                    return;
                }

                // 아이템제거
                if (args[0] == "아이템제거" && user.isAdmin) {
                    let arg = cmd.substr(cmd.split(" ")[0].length + 7).split(" ");
                    if (arg.length == 0) {
                        channel.sendChat("❌ 잘못된 입력입니다.\n[ /TCGenius 아이템제거 <유저명> <아이템> <개수> ]");
                        return;
                    }
                    let num = Number(arg.pop());
                    let target = await getTCGUserByName(arg[0]);
                    if (!target) {
                        channel.sendChat("❌ 존재하지 않는 유저입니다: " + arg[0]);
                        return;
                    }
                    let item = arg.join(" ").substr(arg[0].length + 1);
                    if (item.length == 0) {
                        channel.sendChat("❌ 잘못된 입력입니다.\n[ /TCGenius 아이템제거 <유저명> <아이템> <개수> ]");
                        return;
                    }
                    let items = JSON.parse(read("DB/TCG/item.json"));
                    if (!isNaN(item) && items[Number(item)]) item = Number(item);
                    else item = items.findIndex(i => i.name == item);
                    if (!item) {
                        channel.sendChat("❌ 존재하지 않는 아이템입니다.");
                        return;
                    }
                    if (!target.inventory.item.find(i => i.id == item)) {
                        channel.sendChat("❌ 유저가 해당 아이템을 보유하고 있지 않습니다.");
                        return;
                    }
                    if (isNaN(num) || num % 1 != 0 || num < 1) {
                        num = target.inventory.item.find(i => i.id == item).count;
                    }
                    target.removeItem(item, num);
                    await target.save();
                    channel.sendChat("✅ " + target + "님에게서 " + items[item].name + " " + num + "개를 제거했습니다.");
                    return;
                }

                // 덱 조회
                if (args[0] == "덱" || args[0].toLowerCase() == "d" || args[0].toLowerCase() == "deck") {
                    let content_deck = [];
                    let gold_deck = [];
                    let artifact = [];
                    let cdNum = 1;
                    let cards = JSON.parse(read("DB/TCG/card.json"));
                    
                    user.deck.content.forEach((deck, deckIndex) => {
                        let deckNumForDisplay = deckIndex + 1;
                        content_deck.push("○ 콘텐츠덱" + deckNumForDisplay);
                        let deck_power = calculatePower(user, deck, {isContentDeck: true, isGoldDeck: false});
                        for (let i = 0; i < 5; i++) {
                            if (deck[i] == undefined || deck[i] == -1 || !cards[deck[i]]) {
                                content_deck.push("-");
                            } else {
                                let card = user.inventory.card.find(c => c.id == deck[i]);
                                if (!card) {
                                    content_deck.push("-");
                                } else {
                                    card = card.concat();
                                    card.deepMerge(cards[deck[i]]);
                                    content_deck.push(printCard(card));
                                }
                            }
                        }
                        content_deck.push("◆ 덱 파워: " + numberWithCommas(deck_power.power.toString()));
                        
                        // 해당 덱의 해방 상태 추가
                        let deckType = "content" + deckNumForDisplay;
                        if (user.liberation && user.liberation[deckType] && user.liberation[deckType].liberated) {
                            let rankNames = ["브론즈", "실버", "골드", "플래티넘"];
                            content_deck.push("◇ 해방등급: " + rankNames[user.liberation[deckType].rank]);
                            if (user.liberation[deckType].bonuses && user.liberation[deckType].bonuses.length > 0) {
                                content_deck.push("◇ 적용된 보너스:");
                                user.liberation[deckType].bonuses.forEach(bonus => {
                                    let rarityIcon = "";
                                    switch(bonus.rarity) {
                                        case "normal": rarityIcon = "⚪"; break;
                                        case "rare": rarityIcon = "🔵"; break;
                                        case "unique": rarityIcon = "🟣"; break;
                                        case "legendary": rarityIcon = "🟡"; break;
                                    }
                                    content_deck.push(rarityIcon + " " + bonus.effect);
                                });
                            }
                        }
                        
                        content_deck.push("");
                    });
                    
                    gold_deck.push("○ 골드덱");
                    let deck_power = calculatePower(user, user.deck.gold, {isContentDeck: false, isGoldDeck: true});
                    for (let i = 0; i < 5; i++) {
                        if (user.deck.gold[i] == undefined || user.deck.gold[i] == -1 || !cards[user.deck.gold[i]]) {
                            gold_deck.push("-");
                        } else {
                            let card = user.inventory.card.find(c => c.id == user.deck.gold[i]);
                            if (!card) {
                                gold_deck.push("-");
                            } else {
                                card = card.concat();
                                card.deepMerge(cards[user.deck.gold[i]]);
                                gold_deck.push(printCard(card));
                            }
                        }
                    }
                    
                    if (user.artifact && user.artifact.equip) {
                        let arti = (user.artifact.artifacts || []).find(a => a.id == user.artifact.equip.artifactId);
                        if (arti) {
                            artifact.push("○ 아티팩트");
                            artifact.push(invDisplayAbilityArtifact(arti));
                        }
                    }
                    
                    gold_deck.push("◆ 덱 파워: " + numberWithCommas(deck_power.power.toString()));
                    
                    // 골드덱의 해방 상태 추가
                    if (user.liberation && user.liberation.gold && user.liberation.gold.liberated) {
                        let rankNames = ["브론즈", "실버", "골드", "플래티넘"];
                        gold_deck.push("◇ 해방등급: " + rankNames[user.liberation.gold.rank]);
                        if (user.liberation.gold.bonuses && user.liberation.gold.bonuses.length > 0) {
                            gold_deck.push("◇ 적용된 보너스:");
                            user.liberation.gold.bonuses.forEach(bonus => {
                                let rarityIcon = "";
                                switch(bonus.rarity) {
                                    case "normal": rarityIcon = "⚪"; break;
                                    case "rare": rarityIcon = "🔵"; break;
                                    case "unique": rarityIcon = "🟣"; break;
                                    case "legendary": rarityIcon = "🟡"; break;
                                }
                                gold_deck.push(rarityIcon + " " + bonus.effect);
                            });
                        }
                    }
                    
                    let message = "[ " + user + "님의 덱 ]\n" + VIEWMORE + "\n" + content_deck.join("\n").trim() + "\n\n" + gold_deck.join("\n");
                    if (artifact.length > 0) {
                        message += "\n\n" + artifact.join("\n");
                    }
                    channel.sendChat(message.trim());
                    return;
                }

                // 덱편성
                if (args[0] == "덱편성") {
                    if (args[1] == "콘텐츠덱1" || args[1] == "콘텐츠덱2") {
                        let deckNum = Number(args[1].substr(4)) - 1;
                        let deckIdx = Number(args[2]);
                        let cardName = cmd.substr(cmd.split(" ")[0].length + 13);
                        
                        if (isNaN(deckIdx) || deckIdx % 1 != 0 || deckIdx < 1 || deckIdx > 5) {
                            channel.sendChat("❌ 잘못된 입력입니다.\n[ /TCGenius 덱편성 " + args[1] + " <인덱스> <카드 이름> ]");
                        } else if (cardName == "제거") {
                            user.deck.content[deckNum][deckIdx-1] = -1;
                            await user.save();
                            channel.sendChat("✅ " + args[1] + "의 " + (deckIdx) + "번째 카드를 제거했습니다.");
                        } else {
                            let cards = JSON.parse(read("DB/TCG/card.json"));
                            deckIdx--;
                            if (cardName.startsWith("[성장형]")) {
                                channel.sendChat("❌ 성장형 카드는 덱에 편성할 수 없습니다.");
                                return;
                            }
                            let cardIdx = cards.findIndex(c => ("[" + c.title + "]" + c.name) == cardName || ("[" + c.title + "] " + c.name) == cardName);
                            if (cardIdx == -1) {
                                channel.sendChat("❌ 존재하지 않는 카드입니다.\n카드 이름은 다음과 같이 입력해야 합니다: [테마]카드명");
                            } else {
                                let card = user.inventory.card.find(c => c.id == cardIdx);
                                if (!card) {
                                    channel.sendChat("❌ 보유한 카드가 아닙니다.");
                                    return;
                                }
                                card = card.concat();
                                if (user.deck.content[deckNum].includes(cardIdx)) {
                                    channel.sendChat("❌ 이미 덱에 존재하는 카드입니다.");
                                    return;
                                }
                                card.deepMerge(cards[cardIdx]);
                                user.deck.content[deckNum][deckIdx] = cardIdx;
                                await user.save();
                                channel.sendChat("✅ " + args[1] + "의 " + (deckIdx + 1) + "번째 카드를 아래 카드로 설정했습니다.\n" + printCard(card));
                            }
                        }
                    } else if (args[1] == "골드덱") {
                        let deckIdx = Number(args[2]);
                        let cardName = cmd.substr(cmd.split(" ")[0].length + 11);
                        
                        if (isNaN(deckIdx) || deckIdx % 1 != 0 || deckIdx < 1 || deckIdx > 5) {
                            channel.sendChat("❌ 잘못된 입력입니다.\n[ /TCGenius 덱편성 " + args[1] + " <인덱스> <카드 이름> ]");
                        } else if (cardName == "제거") {
                            user.deck.gold[deckIdx-1] = -1;
                            await user.save();
                            channel.sendChat("✅ " + args[1] + "의 " + (deckIdx) + "번째 카드를 제거했습니다.");
                        } else {
                            let cards = JSON.parse(read("DB/TCG/card.json"));
                            deckIdx--;
                            if (cardName.startsWith("[성장형]")) {
                                channel.sendChat("❌ 성장형 카드는 덱에 편성할 수 없습니다.");
                                return;
                            }
                            let cardIdx = cards.findIndex(c => ("[" + c.title + "]" + c.name) == cardName || ("[" + c.title + "] " + c.name) == cardName);
                            if (cardIdx == -1) {
                                channel.sendChat("❌ 존재하지 않는 카드입니다.\n카드 이름은 다음과 같이 입력해야 합니다: [테마]카드명");
                            } else {
                                let card = user.inventory.card.find(c => c.id == cardIdx);
                                if (!card) {
                                    channel.sendChat("❌ 보유한 카드가 아닙니다.");
                                    return;
                                }
                                card = card.concat();
                                if (user.deck.gold.includes(cardIdx)) {
                                    channel.sendChat("❌ 이미 덱에 존재하는 카드입니다.");
                                    return;
                                }
                                card.deepMerge(cards[cardIdx]);
                                user.deck.gold[deckIdx] = cardIdx;
                                await user.save();
                                channel.sendChat("✅ " + args[1] + "의 " + (deckIdx + 1) + "번째 카드를 아래 카드로 설정했습니다.\n" + printCard(card));
                            }
                        }
                    }
                    return;
                }

                // 덱파워측정
                if (args[0] == "덱파워측정") {
                    if (args[1] == "콘텐츠덱1") {
                        let user_request = cmd.substr(cmd.split(" ")[0].length + 13);
                        tcgLoading[user.id] = true;
                        channel.sendChat("🤖 콘텐츠덱1의 덱 파워를 계산하는 중입니다..\n시간이 꽤 소요될 수 있습니다.");
                        
                        // 비동기 처리
                        (async () => {
                            try {
                                // 5인/듀오 파워 (LLM 기반, 한 번의 호출)
                                let res5man = await calculateDeckPower(user, user.deck.content[0], {isContentDeck: true, deckType: "content1", userRequest: user_request});
                                
                                // 보정공격대 파워 (순수)
                                let resPure = calculatePurePower(user, user.deck.content[0]);
                                
                                delete tcgLoading[user.id];
                                
                                if (typeof res5man == 'object' && res5man.calcPower) {
                                    user.deck_power_5man = res5man.calcPower;
                                    user.deck_power_duo = (typeof res5man.duoPower == 'number' ? res5man.duoPower : calculateDuoPower(user, user.deck.content[0]));
                                    user.deck_power_pure = resPure;
                                    await user.save();
                                    
                                    channel.sendChat("✅ " + user + "님의 덱 파워를 계산했습니다.\n\n" +
                                        "🔥 5인공격대 파워: " + res5man.calcPower.toComma2() + "\n" +
                                        "👥 듀오공격대 파워: " + user.deck_power_duo.toComma2() + "\n" +
                                        "⚖️ 보정공격대 파워: " + resPure.toComma2() + "\n\n" +
                                        "[ 계산 과정 ]\n" + VIEWMORE + res5man.message);
                                } else {
                                    channel.sendChat(res5man);
                                }
    } catch(e) {
                                delete tcgLoading[user.id];
                                channel.sendChat("❌ 오류가 발생했습니다: " + e);
                            }
                        })();
                    } else if (args[1] == "콘텐츠덱2") {
                        let user_request = cmd.substr(cmd.split(" ")[0].length + 13);
                        tcgLoading[user.id] = true;
                        channel.sendChat("🤖 콘텐츠덱2의 덱 파워를 계산하는 중입니다..\n시간이 꽤 소요될 수 있습니다.");
                        
                        (async () => {
                            try {
                                let res5man = await calculateDeckPower(user, user.deck.content[1], {isContentDeck: true, deckType: "content2", userRequest: user_request});
                                let resDuo = calculateDuoPower(user, user.deck.content[1]);
                                let resPure = calculatePurePower(user, user.deck.content[1]);
                                
                                delete tcgLoading[user.id];
                                
                                if (typeof res5man == 'object' && res5man.calcPower) {
                                    user.deck_power_5man = res5man.calcPower;
                                    user.deck_power_duo = resDuo;
                                    user.deck_power_pure = resPure;
                                    await user.save();
                                    
                                    channel.sendChat("✅ " + user + "님의 덱 파워를 계산했습니다.\n\n" +
                                        "🔥 5인공격대 파워: " + res5man.calcPower.toComma2() + "\n" +
                                        "👥 듀오공격대 파워: " + resDuo.toComma2() + "\n" +
                                        "⚖️ 보정공격대 파워: " + resPure.toComma2() + "\n\n" +
                                        "[ 5인공격대 계산 과정 ]\n" + VIEWMORE + res5man.message);
                                } else {
                                    channel.sendChat(res5man);
                                }
                            } catch(e) {
                                delete tcgLoading[user.id];
                                channel.sendChat("❌ 오류가 발생했습니다: " + e);
                            }
                        })();
                    } else if (args[1] == "골드덱") {
                        let user_request = cmd.substr(cmd.split(" ")[0].length + 12);
                        tcgLoading[user.id] = true;
                        channel.sendChat("🤖 골드덱의 덱 파워와 데일리 골드를 계산하는 중입니다..\n시간이 꽤 소요될 수 있습니다.");
                        
                        (async () => {
                            try {
                                let res5man = await calculateDeckPower(user, user.deck.gold, {isGoldDeck: true, deckType: "gold", userRequest: user_request});
                                let resDuo = calculateDuoPower(user, user.deck.gold);
                                let resPure = calculatePurePower(user, user.deck.gold);
                                
                                delete tcgLoading[user.id];
                                
                                if (typeof res5man == 'object' && res5man.calcPower && res5man.dailyGold) {
                                    user.dailyGold = res5man.dailyGold;
                                    user.deck_power_5man = res5man.calcPower;
                                    user.deck_power_duo = resDuo;
                                    user.deck_power_pure = resPure;
                                    await user.save();
                                    
                                    channel.sendChat("✅ " + user + "님의 덱 파워와 데일리 골드를 계산했습니다.\n\n" +
                                        "🔥 5인공격대 파워: " + res5man.calcPower.toComma2() + "\n" +
                                        "👥 듀오공격대 파워: " + resDuo.toComma2() + "\n" +
                                        "⚖️ 보정공격대 파워: " + resPure.toComma2() + "\n" +
                                        "🪙 데일리 골드: " + res5man.dailyGold.toComma2() + "\n\n" +
                                        "[ 5인공격대 계산 과정 ]\n" + VIEWMORE + res5man.message);
                                } else {
                                    channel.sendChat(res5man);
                                }
                            } catch(e) {
                                delete tcgLoading[user.id];
                                channel.sendChat("❌ 오류가 발생했습니다: " + e);
                            }
                        })();
                    }
                    return;
                }

                if (args[0] == "카드유지전송") {
                    let arg = cmd.substr(cmd.split(" ")[0].length + 8).split(" ");
                    if (arg.length == 0) {
                        channel.sendChat("❌ 잘못된 입력입니다.\n[ /TCGenius 카드유지전송 <유저명> <카드> ]");
                        return;
                    }
                    let num = 1;
                    if (arg.length != 2) num = 1;
                    if (isNaN(num) || num % 1 != 0 || num < 1) {
                        num = 1;
                    }
                    let target = await getTCGUserByName(arg[0]);
                    if (!target) {
                        channel.sendChat("❌ 존재하지 않는 유저입니다: " + arg[0]);
                        return;
                    }
                    if (target.id == user.id) {
                        channel.sendChat("❌ 자기 자신에게 전송할 수 없습니다.");
                        return;
                    }
                    let card = arg.join(" ").substr(arg[0].length + 1);
                    if (card.length == 0) {
                        channel.sendChat("❌ 잘못된 입력입니다.\n[ /TCGenius 카드유지전송 <유저명> <카드> ]");
                        return;
                    }
                    let cards = JSON.parse(read("DB/TCG/card.json"));
                    if (!isNaN(card) && cards[Number(card)]) card = Number(card);
                    else card = cards.findIndex(c => ("[" + c.title + "]" + c.name) == card);
                    if (!cards[card]) {
                        channel.sendChat("❌ 존재하지 않는 카드입니다.");
                        return;
                    }
                    let tradeTicket = user.inventory.item.find(i => i.id == 31) || {count:0};
                    if (tradeTicket.count < ["","일반","고급","희귀","영웅","전설"].indexOf(cards[card].rarity) * num) {
                        channel.sendChat("❌ 거래권이 부족합니다.\n필요 거래권: " + numberWithCommas(tradeTicket.count.toString()) + "/" + numberWithCommas((["","일반","고급","희귀","영웅","전설"].indexOf(cards[card].rarity) * num).toString()));
                        return;
                    }
                    if ((user.inventory.card.find(c => c.id == card) || {count:0}).count < num) {
                        channel.sendChat("❌ 카드 수량이 부족합니다.");
                        return;
                    }
                    target.addCard(card, num);
                    let targetInvCard = target.inventory.card.find(c => c.id == card).concat();
                    targetInvCard.deepMerge(cards[card]);
                    TCGLog("📜 카드 유지 전송 로그 📜\n\n>> 전송자: " + user + "\n>> 받는자: " + target + "\n\n[ 받는 사람의 현재 카드 데이터 ]\n" + printCard(targetInvCard) + " (경험치: " + (targetInvCard.exp ? targetInvCard.exp.toComma2() : 0) + ")");
                    
                    const userCard = user.inventory.card.find(c => c.id == card);
                    const targetCard = target.inventory.card.find(c => c.id == card);
                    
                    // 강화 상태 병합 (최대값 적용)
                    targetCard.breakLimit = (userCard.breakLimit ? true : targetCard.breakLimit);
                    targetCard.level = Math.max(userCard.level, targetCard.level);
                    targetCard.transcend = Math.max(userCard.transcend, targetCard.transcend);
                    targetCard.exp = 0;
                    targetCard.overExp = 0;
                    if (userCard.exp) targetCard.exp += userCard.exp;
                    if (userCard.overExp) targetCard.overExp += userCard.overExp;
                    
                    // 전송한 카드는 초기화
                    userCard.breakLimit = false;
                    userCard.level = 0;
                    userCard.transcend = 0;
                    userCard.exp = 0;
                    userCard.overExp = 0;
                    
                    user.removeItem(31, ["","일반","고급","희귀","영웅","전설"].indexOf(cards[card].rarity) * num);
                    user.removeCard(card, num);
                    await user.save();
                    await target.save();
                    cards[card].deepMerge(targetCard);
                    channel.sendChat("✅ " + target + "님에게 카드를 선물했습니다.\n" + printCard(cards[card]));
                    return;
                }

                if (args[0] == "카드일반전송") {
                    let arg = cmd.substr(cmd.split(" ")[0].length + 8).split(" ");
                    if (arg.length == 0) {
                        channel.sendChat("❌ 잘못된 입력입니다.\n[ /TCGenius 카드일반전송 <유저명> <카드> ]");
                        return;
                    }
                    let num = 1;
                    if (arg.length != 2) num = 1;
                    if (isNaN(num) || num % 1 != 0 || num < 1) {
                        num = 1;
                    }
                    let target = await getTCGUserByName(arg[0]);
                    if (!target) {
                        channel.sendChat("❌ 존재하지 않는 유저입니다: " + arg[0]);
                        return;
                    }
                    if (target.id == user.id) {
                        channel.sendChat("❌ 자기 자신에게 전송할 수 없습니다.");
                        return;
                    }
                    let card = arg.join(" ").substr(arg[0].length + 1);
                    if (card.length == 0) {
                        channel.sendChat("❌ 잘못된 입력입니다.\n[ /TCGenius 카드일반전송 <유저명> <카드> ]");
                        return;
                    }
                    let cards = JSON.parse(read("DB/TCG/card.json"));
                    if (!isNaN(card) && cards[Number(card)]) card = Number(card);
                    else card = cards.findIndex(c => ("[" + c.title + "]" + c.name) == card);
                    if (!cards[card]) {
                        channel.sendChat("❌ 존재하지 않는 카드입니다.");
                        return;
                    }
                    let tradeTicket = user.inventory.item.find(i => i.id == 31) || {count:0};
                    if (tradeTicket.count < ["","일반","고급","희귀","영웅","전설"].indexOf(cards[card].rarity) * num) {
                        channel.sendChat("❌ 거래권이 부족합니다.\n필요 거래권: " + numberWithCommas(tradeTicket.count.toString()) + "/" + numberWithCommas((["","일반","고급","희귀","영웅","전설"].indexOf(cards[card].rarity) * num).toString()));
                        return;
                    }
                    if ((user.inventory.card.find(c => c.id == card) || {count:0}).count < num) {
                        channel.sendChat("❌ 카드 수량이 부족합니다.");
                        return;
                    }
                    // 기본 상태로 전송 (강화 상태 무시)
                    target.addCard(card, num);
                    user.removeItem(31, ["","일반","고급","희귀","영웅","전설"].indexOf(cards[card].rarity) * num);
                    user.removeCard(card, num);
                    await user.save();
                    await target.save();
                    cards[card].deepMerge(target.inventory.card.find(c => c.id == card));
                    channel.sendChat("✅ " + target + "님에게 카드를 선물했습니다.\n" + printCard(cards[card]));
                    return;
                }

                if (args[0] == "강화") {
                    let cardArgs = cmd.substr(cmd.split(" ")[0].length + 4).split(" ");
                    if (cardArgs.length < 2) {
                        channel.sendChat("❌ 강화에 사용할 카드를 입력해주세요.");
                    } else {
                        let cards = JSON.parse(read("DB/TCG/card.json"));
                        if (!cards.find(c => ("[" + c.title + "]" + c.name).replace(/\s/gi,"") == cardArgs[0].replace(/\s/gi,"")) && !cardArgs[0].startsWith("[성장형]")) {
                            channel.sendChat("❌ 강화하려는 카드가 존재하지 않는 카드입니다.");
                            return;
                        }
                        let notExists = [];
                        for(let i = 1; i < cardArgs.length; i++) {
                            if (!cards.find(c => ("[" + c.title + "]" + c.name).replace(/\s/gi,"") == cardArgs[i].replace(/\s/gi,""))) {
                                notExists.push(cardArgs[i]);
                            }
                        }
                        if (notExists.length > 0) {
                            let hasGrowth = false;
                            for (let i = 0; i < notExists.length; i++) {
                                if (notExists[i].includes("[성장형]")) {
                                    hasGrowth = true;
                                    break;
                                }
                            }
                            if (hasGrowth) {
                                channel.sendChat("❌ 성장형 카드는 강화 재료로 사용할 수 없습니다.");
                            } else {
                                channel.sendChat("❌ 존재하지 않는 카드가 존재합니다.\n- " + notExists.join("\n- "));
                            }
                        } else {
                            cardArgs = cardArgs.map(c => cards.findIndex(cc => ("[" + cc.title + "]" + cc.name).replace(/\s/gi,"") == c.replace(/\s/gi,"")));
                            let notHas = [];
                            for (let i = 0; i < cardArgs.length; i++) {
                                if (cardArgs[i] == -1) continue;
                                if (!user.inventory.card.find(c => c.id == cardArgs[i])) {
                                    notHas.push("[" + cards[cardArgs[i]].title + "]" + cards[cardArgs[i]].name);
                                }
                            }
                            if (notHas.length > 0) {
                                channel.sendChat("❌ 보유하고 있지 않는 카드가 존재합니다.\n- " + notHas.join("\n- "));
                            } else {
                                let mainCard = user.inventory.card.find(c => c.id == cardArgs[0]);
                                if (!mainCard) mainCard = user.growthCard.find(c => c.name == cmd.substr(cmd.split(" ")[0].length + 4).split(" ")[0].split("]")[1]);
                                if (!mainCard) {
                                    channel.sendChat("❌ 강화하려는 카드가 보유하지 않은 카드입니다.");
                                    return;
                                }
                                let invCard = mainCard;
                                mainCard = mainCard.concat();
                                if (mainCard.title != "성장형") mainCard.deepMerge(cards[cardArgs[0]]);
                                if (!invCard.exp) invCard.exp = 0;
                                let plusExp = {
                                    "일반": 200,
                                    "고급": 2000,
                                    "희귀": 5000,
                                    "영웅": 20000,
                                    "전설": 50000
                                };
                                let needExp = {
                                    "일반": 1000,
                                    "고급": 10000,
                                    "희귀": 50000,
                                    "영웅": 160000,
                                    "전설": 400000
                                };
                                let maxLevels = {
                                    "일반": 1,
                                    "고급": 2,
                                    "희귀": 3,
                                    "영웅": 4,
                                    "전설": 5
                                };
                                if (mainCard.desc && mainCard.desc.startsWith("노스타코인")) {
                                    channel.sendChat("❌ 강화 불가 카드입니다.");
                                    return;
                                }
                                if (mainCard.level >= (maxLevels[mainCard.rarity] + (mainCard.breakLimit ? 1 : 0))) {
                                    channel.sendChat("❌ 이미 최대 레벨인 카드입니다." + (mainCard.breakLimit ? "" : "\n카드를 한계 돌파하여 1회 더 강화할 수 있습니다."));
                                    return;
                                }
                                let plusExpTotal = 0;
                                let tempUser = new TCGUser().load(JSON.parse(JSON.stringify(user)));
                                for (let i = 1; i < cardArgs.length; i++) {
                                    if (tempUser.inventory.card.find(c => c.id == cardArgs[i])) {
                                        plusExpTotal += plusExp[cards[cardArgs[i]].rarity];
                                        tempUser.removeCard(cardArgs[i], 1);
                                    }
                                }
                                if (Math.round(plusExpTotal / 2) > user.gold && !(mainCard.desc && mainCard.desc.startsWith("슴니즌"))) {
                                    channel.sendChat("❌ 골드가 부족합니다!\n필요 골드: " + numberWithCommas(user.gold.toString()) + "/" + numberWithCommas(Math.round(plusExpTotal / 2).toString()));
                                    return;
                                }
                                invCard.exp += plusExpTotal;
                                if (!(mainCard.desc && mainCard.desc.startsWith("슴니즌"))) user.gold -= Math.round(plusExpTotal / 2);
                                for (let i = 1; i < cardArgs.length; i++) {
                                    if (user.inventory.card.find(c => c.id == cardArgs[i])) {
                                        user.removeCard(cardArgs[i], 1);
                                    }
                                }
                                await user.checkQuest("[강화] 강화의 달인", channel);
                                channel.sendChat("✅ " + args[1] + " 카드의 경험치가 +" + numberWithCommas(plusExpTotal.toString()) + " 증가했습니다. (" + numberWithCommas(invCard.exp.toString()) + "/" + numberWithCommas(needExp[mainCard.rarity].toString()) + ")");
                                await checkCardLevelUp(mainCard, invCard, channel);
                                await user.save();
                            }
                        }
                    }
                    return;
                }

                if (args[0] == "초월") {
                    let targetCard = args[1];
                    let cards = JSON.parse(read("DB/TCG/card.json"));
                    let cardIdx = cards.findIndex(c => "[" + c.title + "]" + c.name.replace(/\s/gi,"") == targetCard);
                    let isGrowth = (targetCard.startsWith("[성장형]") && user.growthCard.find(c => "[" + c.title + "]" + c.name == targetCard));
                    if (!isGrowth && cardIdx == -1) {
                        channel.sendChat("❌ 존재하지 않는 카드입니다.\n카드명은 다음과 같이 입력해야 합니다: [테마]카드명");
                        return;
                    }
                    if (!isGrowth && !user.inventory.card.find(c => c.id == cardIdx)) {
                        channel.sendChat("❌ 보유하고 있는 카드가 아닙니다.");
                        return;
                    }
                    let card = user.inventory.card.find(c => c.id == cardIdx);
                    if (!card) card = user.growthCard.find(c => "[" + c.title + "]" + c.name == targetCard);
                    if (!card) {
                        channel.sendChat("❌ 초월하려는 카드가 보유하고 있는 카드가 아닙니다.");
                        return;
                    }
                    let invCard = card;
                    card = card.concat();
                    if (card.title != "성장형") card.deepMerge(cards[cardIdx]);
                    let maxLevels = {
                        "일반": 1,
                        "고급": 2,
                        "희귀": 3,
                        "영웅": 4,
                        "전설": 5
                    };
                    if (card.transcend >= maxLevels[card.rarity] + (card.breakLimit ? 1:0)) {
                        channel.sendChat("❌ 이미 최대 횟수로 초월시킨 카드입니다." + (!card.breakLimit && !isGrowth ? "\n카드를 한계 돌파하여 1회 더 초월할 수 있습니다." : ""));
                        return;
                    }
                    let items = JSON.parse(read("DB/TCG/item.json"));
                    let itemName = (isGrowth ? "성장카드 초월서" : card.rarity + "초월권");
                    let itemIdx = items.findIndex(item => item.name == itemName);
                    let targetItem = user.inventory.item.find(item => item.id == itemIdx);
                    let needMaterials = false;
                    let useTicket = false;
                    if (!targetItem || targetItem.count < 1) {
                        needMaterials = true;
                    }
                    if (!isGrowth && card.count < 2) {
                        if (!needMaterials) {
                            useTicket = true;
                        } else {
                            channel.sendChat("❌ 같은 종류의 카드가 1장 더 필요합니다.");
                            return;
                        }
                    }
                    if (isGrowth && !user.inventory.card.find(c => c.id == cards.findIndex(c => "[" + c.title + "]" + c.name == args[2]))) {
                        if (!needMaterials) {
                            useTicket = true;
                        } else {
                            channel.sendChat("❌ 같은 등급의 카드를 1장 입력해야 합니다.");
                            return;
                        }
                    }
                    if (user.gold < (maxLevels[card.rarity] * 50000)) {
                        if (!needMaterials) {
                            useTicket = true;
                        } else {
                            channel.sendChat("❌ 골드가 부족합니다!\n필요 골드: " + numberWithCommas(user.gold.toString()) + "/" + numberWithCommas((maxLevels[card.rarity] * 50000).toString()));
                            return;
                        }
                    }
                    let prev = (Array(card.transcend + 1).join("★") + Array((maxLevels[card.rarity] + (card.breakLimit ? 1:0)) - card.transcend + 1).join("☆"));
                    invCard.transcend++;
                    if (needMaterials || !useTicket) {
                        user.gold -= (maxLevels[card.rarity] * 50000);
                        if (!isGrowth) user.removeCard(card.id, 1);
                        else user.removeCard(cards.findIndex(c => "[" + c.title + "]" + c.name == args[2]), 1);
                    } else {
                        user.removeItem(itemIdx, 1);
                    }
                    if (isGrowth && card.rarity != "전설" && maxLevels[card.rarity] == invCard.transcend && invCard.transcend == invCard.level) {
                        invCard.rarity = ["일반","고급","희귀","영웅","전설"][["일반","고급","희귀","영웅"].indexOf(card.rarity) + 1];
                        card.rarity = invCard.rarity;
                    }
                    let now = (Array(invCard.transcend + 1).join("★") + Array((maxLevels[card.rarity] + (invCard.breakLimit ? 1:0)) - invCard.transcend + 1).join("☆"));
                    await user.save();
                    channel.sendChat("✅ " + ((needMaterials || !useTicket) ? "" : itemName + (dec_han(itemName.substr(-1)).length == 3 ? "을" : "를") + " 사용하여 ") + targetCard + " 카드를 초월시켰습니다!\n" + prev + " ▶ " + now);
                    return;
                }

                if (args[0] == "한계돌파") {
                    let targetCard = args[1];
                    if (targetCard.startsWith("[성장형]")) {
                        channel.sendChat("❌ 성장형 카드는 한계돌파를 할 수 없습니다.");
                        return;
                    }
                    let cards = JSON.parse(read("DB/TCG/card.json"));
                    let cardIdx = cards.findIndex(c => "[" + c.title + "]" + c.name == targetCard);
                    if (cardIdx == -1) {
                        channel.sendChat("❌ 존재하지 않는 카드입니다.\n카드명은 다음과 같이 입력해야 합니다: [테마]카드명");
                        return;
                    }
                    if (!user.inventory.card.find(c => c.id == cardIdx)) {
                        channel.sendChat("❌ 보유하고 있는 카드가 아닙니다.");
                        return;
                    }
                    let card = user.inventory.card.find(c => c.id == cardIdx);
                    if (card.breakLimit) {
                        channel.sendChat("❌ 이미 한계 돌파한 카드입니다.");
                        return;
                    }
                    let items = JSON.parse(read("DB/TCG/item.json"));
                    let itemIdx = items.findIndex(item => item.name == "한계돌파석");
                    let breakLimitStone = user.inventory.item.find(item => item.id == itemIdx);
                    if (!breakLimitStone || breakLimitStone.count < 1) {
                        channel.sendChat("❌ 한계돌파석이 필요합니다!");
                        return;
                    }
                    user.removeItem(itemIdx, 1);
                    card.breakLimit = true;
                    let card_leveled_up = 0;
                    let needExp = {
                        "일반": 1000,
                        "고급": 10000,
                        "희귀": 50000,
                        "영웅": 160000,
                        "전설": 400000
                    };
                    if (card.overExp) {
                        if (card.overExp >= needExp[cards[cardIdx].rarity]) {
                            card.level++;
                            card.overExp = 0;
                            card_leveled_up = 1;
                        } else if (card.overExp > 0) {
                            card.exp = card.overExp;
                            card.overExp = 0;
                            card_leveled_up = 2;
                        }
                    }
                    await user.save();
                    channel.sendChat("✅ " + targetCard + " 카드를 한계 돌파시켰습니다.\n최대 강화 횟수 및 최대 초월 횟수가 +1 증가했습니다." + (card_leveled_up == 1 ? "\n초과된 경험치로 인해 카드가 레벨업했습니다!" : (card_leveled_up == 2 ? "\n초과된 경험치가 다시 저장되었습니다. (" + numberWithCommas(card.exp.toString()) + "/" + numberWithCommas(needExp[cards[cardIdx].rarity].toString()) + ")" : "")));
                    return;
                }

                if (args[0] == "무료강화") {
                    let targetCard = args[1];
                    let cards = JSON.parse(read("DB/TCG/card.json"));
                    let cardIdx = cards.findIndex(c => "[" + c.title + "]" + c.name == targetCard);
                    let isGrowth = (targetCard.startsWith("[성장형]") && user.growthCard.find(c => "[" + c.title + "]" + c.name == targetCard));
                    if (!isGrowth && cardIdx == -1) {
                        channel.sendChat("❌ 존재하지 않는 카드입니다.\n카드명은 다음과 같이 입력해야 합니다: [테마]카드명");
                        return;
                    }
                    if (!isGrowth && !user.inventory.card.find(c => c.id == cardIdx)) {
                        channel.sendChat("❌ 보유하고 있는 카드가 아닙니다.");
                        return;
                    }
                    let card = user.inventory.card.find(c => c.id == cardIdx);
                    if (!card) card = user.growthCard.find(c => "[" + c.title + "]" + c.name == targetCard);
                    if (!card) {
                        channel.sendChat("❌ 강화하려는 카드가 보유하고 있는 카드가 아닙니다.");
                        return;
                    }
                    let invCard = card;
                    card = card.concat();
                    if (card.title != "성장형") card.deepMerge(cards[cardIdx]);
                    let maxLevels = {
                        "일반": 1,
                        "고급": 2,
                        "희귀": 3,
                        "영웅": 4,
                        "전설": 5
                    };
                    if (card.level >= maxLevels[card.rarity] + (card.breakLimit ? 1:0)) {
                        channel.sendChat("❌ 이미 최대 레벨인 카드입니다." + (card.breakLimit ? "" : "\n카드를 한계 돌파하여 1회 더 강화할 수 있습니다."));
                        return;
                    }
                    let items = JSON.parse(read("DB/TCG/item.json"));
                    let itemIdx = items.findIndex(item => item.name == "100% +1 강화권");
                    let itemName = "100% +1 강화권";
                    let plus1 = user.inventory.item.find(item => item.id == itemIdx);
                    itemName = (isGrowth ? "성장카드 강화기" : "무료강화권");
                    itemIdx = items.findIndex(item => item.name == itemName);
                    let freeLevelup = user.inventory.item.find(item => item.id == itemIdx);
                    if (!freeLevelup || freeLevelup.count < 1) {
                        if (plus1) {
                            itemName = "100% +1 강화권";
                            itemIdx = plus1.id;
                        } else {
                            channel.sendChat("❌ " + itemName + (dec_han(itemName.substr(-1)).length == 3 ? "이" : "가") + " 필요합니다!");
                            return;
                        }
                    }
                    user.removeItem(itemIdx, 1);
                    let needExp = {
                        "일반": 1000,
                        "고급": 10000,
                        "희귀": 50000,
                        "영웅": 160000,
                        "전설": 400000
                    };
                    let plusExpRatio = Math.floor(Math.random() * 41) + 10;
                    if (itemName == "100% +1 강화권") plusExpRatio = 100;
                    let plusExp = Math.round(needExp[card.rarity] * (plusExpRatio / 100));
                    if (!invCard.exp) invCard.exp = 0;
                    invCard.exp += plusExp;
                    channel.sendChat("✅ " + itemName + (dec_han(itemName.substr(-1)).length == 3 ? "을" : "를") + " 사용하여 " + targetCard + " 카드에 필요 경험치의 " + plusExpRatio + "%(" + numberWithCommas(plusExp.toString()) + ")의 경험치를 부여했습니다!");
                    await checkCardLevelUp(card, invCard, channel);
                    await user.save();
                    return;
                }

                if (args[0] == "경험치확인") {
                    let targetCard = args[1];
                    let cards = JSON.parse(read("DB/TCG/card.json"));
                    let cardIdx = cards.findIndex(c => "[" + c.title + "]" + c.name == targetCard);
                    let isGrowth = (targetCard.startsWith("[성장형]") && user.growthCard.find(c => "[" + c.title + "]" + c.name == targetCard));
                    if (!isGrowth && cardIdx == -1) {
                        channel.sendChat("❌ 존재하지 않는 카드입니다.\n카드명은 다음과 같이 입력해야 합니다: [테마]카드명");
                        return;
                    }
                    if (!isGrowth && !user.inventory.card.find(c => c.id == cardIdx)) {
                        channel.sendChat("❌ 보유하고 있는 카드가 아닙니다.");
                        return;
                    }
                    let card = user.inventory.card.find(c => c.id == cardIdx);
                    if (!card) card = user.growthCard.find(c => "[" + c.title + "]" + c.name == targetCard);
                    card = card.concat();
                    if (card.title != "성장형") card.deepMerge(cards[cardIdx]);
                    let needExp = {
                        "일반": 1000,
                        "고급": 10000,
                        "희귀": 50000,
                        "영웅": 160000,
                        "전설": 400000
                    };
                    if (!card.exp) card.exp = 0;
                    channel.sendChat(targetCard + " 카드 경험치:\n" + numberWithCommas(card.exp.toString()) + "/" + numberWithCommas(needExp[card.rarity].toString()));
                    return;
                }

                if (args[0] == "조합") {
                    let cardArgs = cmd.substr(cmd.split(" ")[0].length + 4).split(" ");
                    if (cardArgs.length != 3) {
                        channel.sendChat("❌ 정확히 3장의 카드를 입력해주세요.\n주의: 띄어쓰기가 포함된 카드는 띄어쓰기 없이 입력해주세요.");
                        return;
                    }
                    let cards = JSON.parse(read("DB/TCG/card.json"));
                    let notExists = [];
                    for(let i = 0; i < cardArgs.length; i++) {
                        if (!cards.find(c => ("[" + c.title + "]" + c.name).replace(/\s/gi,"") == cardArgs[i].replace(/\s/gi,""))) {
                            notExists.push(cardArgs[i]);
                        }
                    }
                    if (notExists.length > 0) {
                        channel.sendChat("❌ 존재하지 않는 카드가 존재합니다.\n- " + notExists.join("\n- "));
                        return;
                    }
                    cardArgs = cardArgs.map(c => cards.findIndex(cc => ("[" + cc.title + "]" + cc.name).replace(/\s/gi,"") == c.replace(/\s/gi,"")));
                    let notHas = [];
                    for (let i = 0; i < cardArgs.length; i++) {
                        if (!user.inventory.card.find(c => c.id == cardArgs[i])) {
                            notHas.push("[" + cards[cardArgs[i]].title + "]" + cards[cardArgs[i]].name);
                        }
                    }
                    if (notHas.length > 0) {
                        channel.sendChat("❌ 보유하지 않은 카드가 존재합니다.\n- " + notHas.join("\n- "));
                        return;
                    }
                    if (cardArgs.unique().length != 3) {
                        channel.sendChat("❌ 중복된 카드는 조합할 수 없습니다.");
                        return;
                    }
                    let correctRarity = true;
                    let nowRarity = null;
                    let hasLegend = false;
                    for (let i = 0; i < cardArgs.length; i++) {
                        if (!nowRarity) nowRarity = cards[cardArgs[i]].rarity;
                        if (cards[cardArgs[i]].rarity != nowRarity) {
                            correctRarity = false;
                            break;
                        }
                        if (cards[cardArgs[i]].rarity == "전설") {
                            hasLegend = true;
                            break;
                        }
                    }
                    if (!correctRarity) {
                        channel.sendChat("❌ 3장의 카드 등급이 모두 동일해야 합니다.");
                        return;
                    }
                    if (hasLegend) {
                        channel.sendChat("❌ 전설 카드는 조합할 수 없습니다.");
                        return;
                    }
                    combQueue[user.id] = {
                        cards: cardArgs,
                        useLocks: {
                            protect: null,
                            enforce: null,
                            blessing: null
                        }
                    };
                    channel.sendChat("✅ 3장의 카드를 조합하시겠습니까?\n\n자물쇠 사용: [ /TCGenius 자물쇠사용 <자물쇠> ]\n조합 확정: [ /TCGenius 조합확정 ]");
                    return;
                }

                if (args[0] == "자물쇠사용" && combQueue[user.id]) {
                    if (args[1] == "보호자물쇠") {
                        let items = JSON.parse(read("DB/TCG/item.json"));
                        let itemIdx = items.findIndex(item => item.name == "보호자물쇠");
                        let lock = user.inventory.item.find(item => item.id == itemIdx);
                        if (!lock || lock.count < 1) {
                            channel.sendChat("❌ 보호자물쇠가 필요합니다!");
                            return;
                        }
                        let targetCard = args[2];
                        if (!targetCard) {
                            channel.sendChat("❌ 보호할 카드를 입력해주세요.\n[ /TCGenius 자물쇠사용 보호자물쇠 <카드명> ]");
                            return;
                        }
                        let cards = JSON.parse(read("DB/TCG/card.json"));
                        let cardIdx = cards.findIndex(c => "[" + c.title + "]" + c.name == targetCard);
                        if (cardIdx == -1) {
                            channel.sendChat("❌ 존재하지 않는 카드입니다.\n카드명은 다음과 같이 입력해야 합니다: [테마]카드명");
                            return;
                        }
                        if (!user.inventory.card.find(c => c.id == cardIdx)) {
                            channel.sendChat("❌ 보유하고 있는 카드가 아닙니다.");
                            return;
                        }
                        if (!combQueue[user.id].cards.includes(cardIdx)) {
                            channel.sendChat("❌ 조합에 사용될 카드가 아닙니다.");
                            return;
                        }
                        combQueue[user.id].useLocks.protect = cardIdx;
                        combQueue[user.id].useLocks.enforce = null;
                        combQueue[user.id].useLocks.blessing = null;
                        channel.sendChat("✅ 이번 카드 조합에 '보호자물쇠'를 사용합니다.");
                    } else if (args[1] == "강화자물쇠") {
                        let items = JSON.parse(read("DB/TCG/item.json"));
                        let itemIdx = items.findIndex(item => item.name == "강화자물쇠");
                        let lock = user.inventory.item.find(item => item.id == itemIdx);
                        if (!lock || lock.count < 1) {
                            channel.sendChat("❌ 강화자물쇠가 필요합니다!");
                            return;
                        }
                        combQueue[user.id].useLocks.protect = null;
                        combQueue[user.id].useLocks.enforce = true;
                        combQueue[user.id].useLocks.blessing = null;
                        channel.sendChat("✅ 이번 카드 조합에 '강화자물쇠'를 사용합니다.");
                    } else if (args[1] == "슈퍼강화자물쇠") {
                        let items = JSON.parse(read("DB/TCG/item.json"));
                        let itemIdx = items.findIndex(item => item.name == "슈퍼강화자물쇠");
                        let lock = user.inventory.item.find(item => item.id == itemIdx);
                        if (!lock || lock.count < 1) {
                            channel.sendChat("❌ 슈퍼강화자물쇠가 필요합니다!");
                            return;
                        }
                        combQueue[user.id].useLocks.protect = null;
                        combQueue[user.id].useLocks.enforce = 'super';
                        combQueue[user.id].useLocks.blessing = null;
                        channel.sendChat("✅ 이번 카드 조합에 '슈퍼강화자물쇠'를 사용합니다.");
                    } else if (args[1] == "축복자물쇠") {
                        let items = JSON.parse(read("DB/TCG/item.json"));
                        let itemIdx = items.findIndex(item => item.name == "축복자물쇠");
                        let lock = user.inventory.item.find(item => item.id == itemIdx);
                        if (!lock || lock.count < 1) {
                            channel.sendChat("❌ 축복자물쇠가 필요합니다!");
                            return;
                        }
                        combQueue[user.id].useLocks.protect = null;
                        combQueue[user.id].useLocks.enforce = null;
                        combQueue[user.id].useLocks.blessing = true;
                        channel.sendChat("✅ 이번 카드 조합에 '축복자물쇠'를 사용합니다.");
                    }
                    return;
                }

                if (args[0] == "조합확정" && combQueue[user.id]) {
                    let check = true;
                    for(let i = 0; i < combQueue[user.id].cards.length; i++) {
                        if (!user.inventory.card.find(c => c.id == combQueue[user.id].cards[i]) || user.inventory.card.find(c => c.id == combQueue[user.id].cards[i]).count < combQueue[user.id].cards.filter(c => c == combQueue[user.id].cards[i]).length) {
                            check = false;
                            break;
                        }
                    }
                    if (!check) {
                        channel.sendChat("❌ 조합 예정된 카드가 부족하여 조합에 실패했습니다.");
                        delete combQueue[user.id];
                        return;
                    }
                    let probs = {
                        "일반": 0.4,
                        "고급": 0.3,
                        "희귀": 0.15,
                        "영웅": 0.05
                    };
                    let rarities = ["일반", "고급", "희귀", "영웅", "전설", "전설"];
                    let cards = JSON.parse(read("DB/TCG/card.json"));
                    if (combQueue[user.id].useLocks.protect || combQueue[user.id].useLocks.enforce || combQueue[user.id].useLocks.blessing) {
                        let items = JSON.parse(read("DB/TCG/item.json"));
                        let itemIdx = items.findIndex(item => item.name == (combQueue[user.id].useLocks.protect ? "보호자물쇠" : (combQueue[user.id].useLocks.enforce ? (combQueue[user.id].useLocks.enforce == 'super' ? "슈퍼강화자물쇠" : "강화자물쇠") : "축복자물쇠")));
                        let lock = user.inventory.item.find(item => item.id == itemIdx);
                        if (!lock || lock.count < 1) {
                            channel.sendChat("❌ 사용 예정된 자물쇠가 부족하여 조합에 실패했습니다.");
                            return;
                        }
                        user.removeItem(itemIdx, 1);
                        if (combQueue[user.id].useLocks.enforce) {
                            if (combQueue[user.id].useLocks.enforce != 'super') {
                                probs = {
                                    "일반": 0.45,
                                    "고급": 0.35,
                                    "희귀": 0.2,
                                    "영웅": 0.1
                                };
                            } else {
                                probs = {
                                    "일반": 0.7,
                                    "고급": 0.6,
                                    "희귀": 0.45,
                                    "영웅": 0.35
                                };
                            }
                        }
                    }
                    let rarity = cards[combQueue[user.id].cards[0]].rarity;
                    let r = Math.random();
                    let card = null;
                    let notDeleteCards = [];
                    for (let i = 0; i < combQueue[user.id].cards.length; i++) {
                        if (cards[combQueue[user.id].cards[i]].desc && cards[combQueue[user.id].cards[i]].desc.startsWith("불징")) {
                            let r = Math.random();
                            if (r < 0.4) {
                                notDeleteCards.push(combQueue[user.id].cards[i]);
                            }
                        }
                    }
                    await user.checkQuest("[조합] 제발 좀 떠라", channel);
                    if (r < probs[rarity]) {
                        card = cards.filter(c => c.rarity == rarities[rarities.indexOf(rarity) + 1]).getRandomElement();
                        let cardIdx = cards.findIndex(c => c.title == card.title && c.name == card.name);
                        user.addCard(cardIdx, 1);
                        channel.sendChat("❇️ 카드를 조합하여 높은 등급의 카드를 획득했습니다!\n\n[ 획득한 카드 ]\n" + printCard(card) + (notDeleteCards.length > 0 ? "\n\n[ 보존된 카드 ]\n- " + notDeleteCards.map(c => "[" + cards[c].title + "]" + cards[c].name).join("\n- ") : ""));
                    } else {
                        let num = 1;
                        if (combQueue[user.id].useLocks.blessing) num = 2;
                        let gotCards = [];
                        if (combQueue[user.id].useLocks.protect) notDeleteCards.push(combQueue[user.id].useLocks.protect);
                        for (let i = 0; i < combQueue[user.id].cards.length; i++) {
                            if (cards[combQueue[user.id].cards[i]].desc && cards[combQueue[user.id].cards[i]].desc.startsWith("무한부활")) {
                                notDeleteCards.push(combQueue[user.id].cards[i]);
                            }
                        }
                        for (let i = 0; i < num; i++) {
                            card = cards.filter(c => c.rarity == rarity).getRandomElement();
                            let cardIdx = cards.findIndex(c => c.title == card.title && c.name == card.name);
                            user.addCard(cardIdx, 1);
                            gotCards.push(printCard(card));
                        }
                        channel.sendChat("✅ 카드를 조합했습니다.\n\n[ 획득한 카드 ]\n" + gotCards.join("\n") + (notDeleteCards.length > 0 ? "\n\n[ 보존된 카드 ]\n- " + notDeleteCards.map(c => "[" + cards[c].title + "]" + cards[c].name).join("\n- ") : ""));
                    }
                    for (let i = 0; i < combQueue[user.id].cards.length; i++) {
                        if (!notDeleteCards.includes(combQueue[user.id].cards[i])) {
                            user.removeCard(combQueue[user.id].cards[i], 1);
                        }
                    }
                    await user.save();
                    delete combQueue[user.id];
                    return;
                }

                if (args[0] == "데일리골드" && args[1] == "설정" && user.isAdmin) {
                    let arg = cmd.substr(cmd.split(" ")[0].length + 10).split(" ");
                    if (arg.length == 0) {
                        channel.sendChat("❌ 잘못된 입력입니다.\n[ /TCGenius 데일리골드 설정 <유저명> <골드> ]");
                        return;
                    }
                    let target = await getTCGUserByName(arg[0]);
                    let num = Number(arg[1]);
                    if (isNaN(num) || num % 1 != 0) {
                        channel.sendChat("❌ 설정할 골드가 제대로 입력되지 않았습니다.");
                        return;
                    }
                    if (!target) {
                        channel.sendChat("❌ 존재하지 않는 유저입니다: " + arg[0]);
                        return;
                    }
                    target.dailyGold = num;
                    await target.save();
                    channel.sendChat("✅ " + target + "님의 데일리골드를 " + numberWithCommas(num.toString()) + " 골드로 설정했습니다.");
                    return;
                }

                if (args[0] == "데일리골드") {
                    channel.sendChat("🪙 데일리 골드: " + user.dailyGold.toComma2());
                    return;
                }

                if (args[0] == "출석") {
                    await user.checkQuest("[출석] 오늘도 나 등장", channel);
                    let attendRes = user.attend();
                    if (attendRes.success) {
                        let pack = JSON.parse(read("DB/TCG/pack.json"));
                        let attend_reward = [];
                        let rewards = null;
                        let vipPack = JSON.parse(read("DB/TCG/vip_attend.json"));
                        let vipPlus = [0,0.01,0.02,0.03,0.05,0.07,0.1,0.12,0.15,0.18,0.21,0.3];
                        let gotGold = user.dailyGold + Math.round(user.dailyGold * vipPlus[user.vip]);
                        if (attendRes.isRoulette) {
                            gotGold = 0;
                            let r = Math.random();
                            if (r < 0.07) {
                                attend_reward.push({
                                    item: true,
                                    type: "소모품",
                                    name: "골드바",
                                    count: 1
                                });
                                channel.sendChat("✅ [스쿼드배틀]유치원생 카드 효과로 데일리 골드 대신 골드바를 획득합니다!");
                            } else {
                                channel.sendChat("❌ [스쿼드배틀]유치원생 카드 효과로 데일리 골드 대신 7% 확률로 골드바를 얻을 수 있는 룰렛을 돌렸으나 실패했습니다.");
                            }
                        }
                        if (attendRes.isG) {
                            attend_reward.push({item:true,type:"소모품",name:"순금0.1g",count:1});
                        }
                        if (attendRes.isG2) {
                            attend_reward.push({garnet:true,count:8});
                        }
                        if (pack.find(p => p.name == "출석" + user.attendance.total)) {
                            attend_reward = attend_reward.concat(pack.find(p => p.name == "출석" + user.attendance.total).reward);
                        }
                        if (user.deck.gold.includes(509)) attend_reward.push({garnet:true,count:10});
                        attend_reward = attend_reward.concat(vipPack[user.vip]);
                        rewards = user.givePack(attend_reward);
                        channel.sendChat("✅ 출석을 완료했습니다!\n- 연속 출석일수: " + user.attendance.streak + "일\n- 누적 출석일수: " + user.attendance.total + "일\n\n[ 출석 보상 ]\n- 데일리 골드 " + numberWithCommas(gotGold.toString()) + "골드" + (vipPlus[user.vip] > 0 ? " (+" + (vipPlus[user.vip] * 100).fix() + "% 보너스!)" : "") + (rewards.length ? "\n" + rewards.join("\n") : ""));
                    } else {
                        channel.sendChat("❌ 이미 오늘 출석체크를 완료했습니다.");
                    }
                    return;
                }

                if (args[0] == "출석취소" && user.isAdmin) {
                    let target = await getTCGUserByName(cmd.substr(cmd.split(" ")[0].length + 6));
                    if (!target) {
                        channel.sendChat("❌ 존재하지 않는 유저입니다.");
                    } else {
                        target.attendance.last = null;
                        target.attendance.streak--;
                        target.attendance.total--;
                        await target.save();
                        channel.sendChat("✅ " + target + "님의 오늘 출석체크를 취소시켰습니다.");
                    }
                    return;
                }

                // 되팔기
                if (args[0] == "되팔기") {
                    let targetCard = args[1];
                    if (targetCard && targetCard.startsWith("[성장형]")) {
                        channel.sendChat("❌ 성장형 카드는 되팔기가 불가능합니다.");
                        return;
                    }
                    let cards = JSON.parse(read("DB/TCG/card.json"));
                    let cardIdx = cards.findIndex(c => "[" + c.title + "]" + c.name == targetCard);
                    if (cardIdx == -1) {
                        channel.sendChat("❌ 존재하지 않는 카드입니다.\n카드명은 다음과 같이 입력해야 합니다: [테마]카드명");
                        return;
                    }
                    if (!user.inventory.card.find(c => c.id == cardIdx)) {
                        channel.sendChat("❌ 보유하고 있는 카드가 아닙니다.");
                        return;
                    }
                    let plusGold = {
                        "일반": 100,
                        "고급": 500,
                        "희귀": 2000,
                        "영웅": 10000,
                        "전설": 50000
                    };
                    let getGold = plusGold[cards[cardIdx].rarity];
                    if (cards[cardIdx].desc && cards[cardIdx].desc.startsWith("이타치")) getGold = 1000;
                    user.gold += getGold;
                    user.removeCard(cardIdx, 1);
                    await user.save();
                    channel.sendChat("✅ " + targetCard + " 카드를 되팔아 " + numberWithCommas(getGold.toString()) + " 골드를 획득했습니다.");
                    return;
                }

                // 분해
                if (args[0] == "분해") {
                    let targetCard = args[1];
                    if (targetCard && targetCard.startsWith("[성장형]")) {
                        channel.sendChat("❌ 성장형 카드는 분해가 불가능합니다.");
                        return;
                    }
                    let cards = JSON.parse(read("DB/TCG/card.json"));
                    let cardIdx = cards.findIndex(c => "[" + c.title + "]" + c.name.replace(/\s/gi, "") == targetCard);
                    if (cardIdx == -1) {
                        channel.sendChat("❌ 존재하지 않는 카드입니다.\n카드명은 다음과 같이 입력해야 합니다: [테마]카드명");
                        return;
                    }
                    if (!user.inventory.card.find(c => c.id == cardIdx)) {
                        channel.sendChat("❌ 보유하고 있는 카드가 아닙니다.");
                        return;
                    }
                    let plusPack = {
                        "일반": [{item: true, name: "깔끔한 기운", count: {min: 5, max: 10}}],
                        "고급": [{item: true, name: "깔끔한 기운", count: {min: 15, max: 25}}],
                        "희귀": [{item: true, name: "깔끔한 기운", count: {min: 30, max: 40}}],
                        "영웅": [{item: true, name: "영롱한 기운", count: {min: 8, max: 14}}],
                        "전설": [{item: true, name: "강렬한 기운", count: {min: 3, max: 5}}]
                    };
                    let getPack = plusPack[cards[cardIdx].rarity];
                    let rewards = user.givePack(getPack);
                    user.removeCard(cardIdx, 1);
                    await user.save();
                    channel.sendChat("✅ " + targetCard + " 카드를 분해했습니다.\n[ 획득한 기운 ]\n" + rewards.join("\n"));
                    return;
                }

                // 상점
                if (args[0] == "상점") {
                    let shopInfo = JSON.parse(read("DB/TCG/shop.json")).filter(s => s.normal);
                    let sellingList = [];
                    shopInfo.forEach(sell => {
                        let limitText = "\n";
                        if (sell.limit) {
                            if (sell.limit.daily) limitText = "  *하루 " + sell.limit.daily + "회 구매 가능\n";
                            if (sell.limit.weekly) limitText = "  *주간 " + sell.limit.weekly + "회 구매 가능\n";
                            if (!sell.limit.daily && !sell.limit.weekly && sell.limit.lifetime) limitText = "  *최대 " + sell.limit.lifetime + "회 구매 가능\n";
                        }
                        let itemLines = "";
                        if (sell.name || sell.item.length > 1) {
                            itemLines = sell.item.map(s => {
                                if (s.roll) {
                                    let inner = s.rolls.map(r => " - " + (r.gold ? numberWithCommas(r.count.toString()) + "골드" : (r.garnet ? numberWithCommas(r.count.toString()) + "가넷" : r.name + " x" + numberWithCommas(r.count.toString())))).join("\n");
                                    return "- 다음 중 하나 랜덤 획득\n" + inner;
                                }
                                return "- " + (s.gold ? numberWithCommas(s.count.toString()) + "골드" : (s.garnet ? numberWithCommas(s.count.toString()) + "가넷" : s.name + " x" + numberWithCommas(s.count.toString())));
                            }).join("\n") + "\n";
                        }
                        sellingList.push("« " + (sell.name ? sell.name : (sell.item[0].gold ? numberWithCommas(sell.item[0].count.toString()) + "골드" : (sell.item[0].garnet ? numberWithCommas(sell.item[0].count.toString()) + "가넷" : sell.item[0].name))) + " »" + limitText + itemLines + ">> " + numberWithCommas(sell.price.toString()) + sell.goods);
                    });
                    channel.sendChat("[ 상점 ]\n" + VIEWMORE + "\n" + sellingList.join("\n\n"));
                    return;
                }

                // 콘텐츠상점
                if (args[0] == "콘텐츠상점") {
                    let shopInfo = JSON.parse(read("DB/TCG/shop.json")).filter(s => s.content);
                    let sellingList = [];
                    shopInfo.forEach(sell => {
                        let limitText = "\n";
                        if (sell.limit) {
                            if (sell.limit.daily) limitText = "  *하루 " + sell.limit.daily + "회 구매 가능\n";
                            if (sell.limit.weekly) limitText = "  *주간 " + sell.limit.weekly + "회 구매 가능\n";
                            if (!sell.limit.daily && !sell.limit.weekly && sell.limit.lifetime) limitText = "  *최대 " + sell.limit.lifetime + "회 구매 가능\n";
                        }
                        let itemLines = "";
                        if (sell.name || sell.item.length > 1) {
                            itemLines = sell.item.map(s => {
                                if (s.roll) {
                                    let inner = s.rolls.map(r => " - " + (r.gold ? numberWithCommas(r.count.toString()) + "골드" : (r.garnet ? numberWithCommas(r.count.toString()) + "가넷" : r.name + " x" + numberWithCommas(r.count.toString())))).join("\n");
                                    return "- 다음 중 하나 랜덤 획득\n" + inner;
                                }
                                return "- " + (s.gold ? numberWithCommas(s.count.toString()) + "골드" : (s.garnet ? numberWithCommas(s.count.toString()) + "가넷" : s.name + " x" + numberWithCommas(s.count.toString())));
                            }).join("\n") + "\n";
                        }
                        sellingList.push("« " + (sell.name ? sell.name : (sell.item[0].gold ? numberWithCommas(sell.item[0].count.toString()) + "골드" : (sell.item[0].garnet ? numberWithCommas(sell.item[0].count.toString()) + "가넷" : sell.item[0].name))) + " »" + limitText + itemLines + ">> " + numberWithCommas(sell.price.toString()) + sell.goods);
                    });
                    channel.sendChat("[ 콘텐츠 상점 ]\n" + VIEWMORE + "\n" + sellingList.join("\n\n"));
                    return;
                }

                // 이벤트상점
                if (args[0] == "이벤트상점") {
                    let shopInfo = JSON.parse(read("DB/TCG/shop.json")).filter(s => s.event);
                    let sellingList = [];
                    shopInfo.forEach(sell => {
                        let limitText = "\n";
                        if (sell.limit) {
                            if (sell.limit.daily) limitText = "  *하루 " + sell.limit.daily + "회 구매 가능\n";
                            if (sell.limit.weekly) limitText = "  *주간 " + sell.limit.weekly + "회 구매 가능\n";
                            if (!sell.limit.daily && !sell.limit.weekly && sell.limit.lifetime) limitText = "  *최대 " + sell.limit.lifetime + "회 구매 가능\n";
                        }
                        let itemLines = "";
                        if (sell.name || sell.item.length > 1) {
                            itemLines = sell.item.map(s => {
                                if (s.roll) {
                                    let inner = s.rolls.map(r => " - " + (r.gold ? numberWithCommas(r.count.toString()) + "골드" : (r.garnet ? numberWithCommas(r.count.toString()) + "가넷" : r.name + " x" + numberWithCommas(r.count.toString())))).join("\n");
                                    return "- 다음 중 하나 랜덤 획득\n" + inner;
                                }
                                return "- " + (s.gold ? numberWithCommas(s.count.toString()) + "골드" : (s.garnet ? numberWithCommas(s.count.toString()) + "가넷" : s.name + " x" + numberWithCommas(s.count.toString())));
                            }).join("\n") + "\n";
                        }
                        sellingList.push("« " + (sell.name ? sell.name : (sell.item[0].gold ? numberWithCommas(sell.item[0].count.toString()) + "골드" : (sell.item[0].garnet ? numberWithCommas(sell.item[0].count.toString()) + "가넷" : sell.item[0].name))) + " »" + limitText + itemLines + ">> " + numberWithCommas(sell.price.toString()) + sell.goods);
                    });
                    channel.sendChat("[ 이벤트 상점 ]\n" + VIEWMORE + "\n" + sellingList.join("\n\n"));
                    return;
                }

                // 패키지상점
                if (args[0] == "패키지상점") {
                    let shopInfo = JSON.parse(read("DB/TCG/shop.json")).filter(s => s.package);
                    let sellingList = [];
                    shopInfo.forEach(sell => {
                        sellingList.push("« " + (sell.name ? sell.name : (sell.item[0].gold ? numberWithCommas(sell.item[0].count.toString()) + "골드" : (sell.item[0].garnet ? numberWithCommas(sell.item[0].count.toString()) + "가넷" : sell.item[0].name))) + " »" + (sell.limit ? (sell.limit.daily ? "  *하루 " + sell.limit.daily + "회 구매 가능\n" : (sell.limit.lifetime ? "  *최대 " + sell.limit.lifetime + "회 구매 가능\n" : "\n")) : "\n") + (sell.name || sell.item.length > 1 ? sell.item.map(s => "- " + (s.gold ? numberWithCommas(s.count.toString()) + "골드" : (s.garnet ? numberWithCommas(s.count.toString()) + "가넷" : s.name + " x" + numberWithCommas(s.count.toString())))).join("\n") + "\n" : "") + ">> " + numberWithCommas(sell.price.toString()) + sell.goods);
                    });
                    channel.sendChat("[ 패키지 상점 ]\n" + VIEWMORE + "\n" + sellingList.join("\n\n"));
                    return;
                }

                // 지급 (관리자)
                if (args[0] == "지급" && user.isAdmin) {
                    let pack = JSON.parse(read("DB/TCG/pack.json"));
                    let targetUser = await getTCGUserByName(args[1]);
                    let package = pack.find(p => p.name == cmd.substr(cmd.split(" ")[0].length + args[1].length + 5));
                    
                    if (targetUser && package) {
                        let rewards = [];
                        rewards = targetUser.givePack(package.reward);
                        await targetUser.save();
                        channel.sendChat("✅ " + targetUser + "님에게 " + package.name + " 지급을 완료했습니다.\n\n[ 지급 목록 ]\n" + rewards.join("\n"));
                    } else {
                        channel.sendChat("❌ 존재하지 않는 패키지입니다.");
                    }
                    return;
                }

                // 픽업테마설정 (관리자)
                if (args[0] == "픽업테마설정" && user.isAdmin) {
                    if (args[1] && args[2]) {
                        let pickup = {
                            currentTheme: [args[1], args[2]]
                        };
                        save("DB/TCG/pickupRotation.json", JSON.stringify(pickup, null, 4));
                        channel.sendChat("✅ 픽업 테마를 설정했습니다.\n픽업1 테마: " + args[1] + "\n픽업2 테마: " + args[2]);
                    }
                    return;
                }

                // 패키지추가 (관리자)
                if (args[0] == "패키지추가" && user.isAdmin) {
                    let pack = JSON.parse(read("DB/TCG/pack.json"));
                    let name = cmd.substr(cmd.split(" ")[0].length + 7);
                    
                    if (pack.find(p => p.name == name)) {
                        channel.sendChat("❌ 해당 패키지명이 이미 존재합니다.");
                        return;
                    }
                    editPack[senderID] = {
                        type: "추가",
                        name: name,
                        reward: []
                    };
                    channel.sendChat("패키지에 넣을 상품을 입력해주세요.\n모든 입력이 끝났다면 '완료' 입력");
                    return;
                }

                // 패키지수정 (관리자)
                if (args[0] == "패키지수정" && user.isAdmin) {
                    let name = cmd.substr(cmd.split(" ")[0].length + 7);
                    let pack = JSON.parse(read("DB/TCG/pack.json"));
                    if (!pack.find(p => p.name == name)) {
                        channel.sendChat("❌ 해당 패키지를 찾을 수 없습니다.");
                        return;
                    }
                    editPack[senderID] = {
                        type: "수정",
                        name: name,
                        reward: []
                    };
                    channel.sendChat("패키지에 넣을 상품을 처음부터 입력해주세요.\n모든 입력이 끝났다면 '완료' 입력");
                    return;
                }

                // 패키지삭제 (관리자)
                if (args[0] == "패키지삭제" && user.isAdmin) {
                    let pack = JSON.parse(read("DB/TCG/pack.json"));
                    let name = cmd.substr(cmd.split(" ")[0].length + 7);
                    
                    if (!pack.find(p => p.name == name)) {
                        channel.sendChat("❌ 해당 패키지를 찾을 수 없습니다.");
                        return;
                    }
                    pack.splice(pack.findIndex(p => p.name == name), 1);
                    save("DB/TCG/pack.json", JSON.stringify(pack, null, 4));
                    channel.sendChat("✅ '" + name + "' 패키지를 삭제했습니다.");
                    return;
                }

                // 쿠폰
                if (args[0] == "쿠폰") {
                    let coupon = cmd.substr(cmd.split(" ")[0].length + 4);
                    let coupons = JSON.parse(read("DB/TCG/coupon.json"));
                    if (coupons.find(c => c.coupon == coupon)) {
                        if (user.entered_coupon.includes(coupon)) {
                            channel.sendChat("❌ 이미 입력한 쿠폰입니다.");
                            return;
                        }
                        let rewards = user.givePack(coupons.find(c => c.coupon == coupon).reward);
                        user.entered_coupon.push(coupon);
                        await user.save();
                        channel.sendChat("🎉 쿠폰 입력 보상을 받았습니다!\n\n[ 보상 목록 ]\n" + rewards.join("\n"));
                        if (coupons.find(c => c.coupon == coupon).onetime) {
                            coupons.splice(coupons.findIndex(c => c.coupon == coupon), 1);
                            save("DB/TCG/coupon.json", JSON.stringify(coupons, null, 4));
                        }
                    } else {
                        channel.sendChat("❌ 존재하지 않는 쿠폰입니다.");
                    }
                    return;
                }

                // 쿠폰추가 (관리자)
                if (args[0] == "쿠폰추가" && user.isAdmin) {
                    let coupon = JSON.parse(read("DB/TCG/coupon.json"));
                    let name = cmd.substr(cmd.split(" ")[0].length + 6);
                    
                    if (coupon.find(p => p.coupon == name)) {
                        channel.sendChat("❌ 해당 쿠폰이 이미 존재합니다.");
                        return;
                    }
                    editPack[senderID] = {
                        type: "추가쿠폰",
                        name: name,
                        reward: []
                    };
                    channel.sendChat("쿠폰 입력 상품을 입력해주세요.\n모든 입력이 끝났다면 '완료' 입력");
                    return;
                }

                // 1회용쿠폰추가 (관리자)
                if (args[0] == "1회용쿠폰추가" && user.isAdmin) {
                    let coupon = JSON.parse(read("DB/TCG/coupon.json"));
                    let name = cmd.substr(cmd.split(" ")[0].length + 9);
                    
                    if (coupon.find(p => p.coupon == name)) {
                        channel.sendChat("❌ 해당 쿠폰이 이미 존재합니다.");
                        return;
                    }
                    editPack[senderID] = {
                        onetime: true,
                        type: "추가쿠폰",
                        name: name,
                        reward: []
                    };
                    channel.sendChat("쿠폰 입력 상품을 입력해주세요.\n모든 입력이 끝났다면 '완료' 입력");
                    return;
                }

                // 쿠폰수정 (관리자)
                if (args[0] == "쿠폰수정" && user.isAdmin) {
                    let name = cmd.substr(cmd.split(" ")[0].length + 6);
                    let coupon = JSON.parse(read("DB/TCG/coupon.json"));
                    if (!coupon.find(p => p.coupon == name)) {
                        channel.sendChat("❌ 해당 쿠폰을 찾을 수 없습니다.");
                        return;
                    }
                    editPack[senderID] = {
                        type: "수정쿠폰",
                        name: name,
                        reward: []
                    };
                    channel.sendChat("쿠폰 입력 상품을 처음부터 입력해주세요.\n모든 입력이 끝났다면 '완료' 입력");
                    return;
                }

                // 쿠폰삭제 (관리자)
                if (args[0] == "쿠폰삭제" && user.isAdmin) {
                    let coupon = JSON.parse(read("DB/TCG/coupon.json"));
                    let name = cmd.substr(cmd.split(" ")[0].length + 6);
                    
                    if (!coupon.find(p => p.coupon == name)) {
                        channel.sendChat("❌ 해당 쿠폰을 찾을 수 없습니다.");
                        return;
                    }
                    coupon.splice(coupon.findIndex(p => p.coupon == name), 1);
                    save("DB/TCG/coupon.json", JSON.stringify(coupon, null, 4));
                    channel.sendChat("✅ '" + name + "' 쿠폰을 삭제했습니다.");
                    return;
                }

                // 핫타임
                if (args[0] == "핫타임") {
                    if (new Date().getHours() >= 18 && new Date().getHours() <= 21) {
                        let now = new Date();
                        if (now.toYYYYMMDD() == user.hotTime) {
                            channel.sendChat("❌ 이미 오늘의 핫타임 보상을 받았습니다.");
                            return;
                        } else {
                            await user.checkQuest("[핫타임] 핫타임 출첵 완료", channel);
                            user.hotTime = now.toYYYYMMDD();
                            let hotTime = JSON.parse(read("DB/TCG/hotTime.json"));
                            let rewards = user.givePack(hotTime.reward);
                            channel.sendChat("🔥 오늘의 핫타임 보상을 받았습니다!\n\n[ 보상 목록 ]\n" + rewards.join("\n"));
                        }
                    } else {
                        channel.sendChat("❌ 핫타임 시간이 아닙니다.");
                    }
                    return;
                }

                // 핫타임구성 (관리자)
                if (args[0] == "핫타임구성" && user.isAdmin) {
                    editPack[senderID] = {
                        type: "핫타임",
                        reward: []
                    };
                    channel.sendChat("핫타임 상품을 입력해주세요.\n모든 입력이 끝났다면 '완료' 입력");
                    return;
                }

                // 카드추가 (관리자)
                if (args[0] == "카드추가" && user.isAdmin) {
                    let cardArgs = msg.split("\n");
                    cardArgs.splice(0, 1);
                    if (cardArgs.length == 0) {
                        channel.sendChat("❌ 추가할 카드를 입력해주세요.");
                    } else {
                        let cards = JSON.parse(read("DB/TCG/card.json"));
                        let correctAdded = [];
                        let incorrectAdded = [];
                        cardArgs.forEach(card => {
                            let parsedCard = parseCardInfo(card);
                            if (parsedCard.title == "" || parsedCard.name == "" || parsedCard.power == 0 || parsedCard.rarity == "미확인") {
                                incorrectAdded.push(card);
                                return;
                            }
                            if (cards.find(c => c.title == parsedCard.title && c.name == parsedCard.name)) {
                                incorrectAdded.push(card);
                                return;
                            }
                            correctAdded.push(card);
                            cards.push(parsedCard);
                        });
                        save("DB/TCG/card.json", JSON.stringify(cards, null, 4));
                        channel.sendChat("✅ 카드 추가를 완료했습니다.\n\n[ 추가 성공 ]\n" + (correctAdded.length > 0 ? correctAdded.join("\n") : "(없음)") + "\n\n[ 추가 실패 ]\n" + (incorrectAdded.length > 0 ? incorrectAdded.join("\n") : "(없음)"));
                    }
                    return;
                }

                // 아티팩트
                if (args[0] == "아티팩트") {
                    if (args[1] == "깎기") {
                        let idx1 = Number(args[2]) - 1;
                        let idx2 = Number(args[3]) - 1;
                        if (isNaN(idx1) || isNaN(idx2) || idx1 % 1 != 0 || idx2 % 1 != 0 || idx1 < 0 || idx2 < 0 || !user.artifact.artifacts[idx1] || idx2 > 2) {
                            channel.sendChat("❌ 잘못된 입력입니다.\n[ /TCGenius 아티팩트 깎기 <아티팩트 번호> [1-3] ]");
                            return;
                        }
                        if (user.artifact.artifacts[idx1].abilities[idx2].level >= 10) {
                            channel.sendChat("❌ 더 이상 깎기를 할 수 없는 어빌리티입니다.");
                            return;
                        }
                        let price = 246;
                        let vip_sale = [0,0.01,0.03,0.05,0.1,0.15,0.2,0.25,0.3,0.4,0.5,0.6];
                        price = price - Math.round(price * vip_sale[user.vip]);
                        if (user.gold < price) {
                            channel.sendChat("❌ 골드가 부족합니다!\n필요 골드: " + user.gold + "/" + price);
                            return;
                        }
                        user.gold -= price;
                        let ability = user.artifact.artifacts[idx1].abilities[idx2];
                        let r = Math.random();
                        let isSuccess = false;
                        if (user.artifact.artifacts[idx1].real) r = 0;
                        if (user.artifact.artifacts[idx1].fail) r = 1;
                        if (user.artifact.artifacts[idx1].prob_beauty) r -= (0.25 * (idx2 == 2 ? -1 : 1));
                        if (user.artifact.artifacts[idx1].prob_ugly) r += (0.5 * (idx2 == 2 ? -1 : 1));
                        if (r < user.artifact.artifacts[idx1].success_prob) {
                            user.artifact.artifacts[idx1].success_prob = Math.max(0.25, user.artifact.artifacts[idx1].success_prob - 0.1);
                            ability.display[ability.level] = 1;
                            ability.level++;
                            isSuccess = true;
                        } else {
                            user.artifact.artifacts[idx1].success_prob = Math.min(0.75, user.artifact.artifacts[idx1].success_prob + 0.1);
                            ability.display[ability.level] = 0;
                            ability.level++;
                            isSuccess = false;
                        }
                        await user.save();
                        if (isSuccess) {
                            channel.sendChat("✅ " + price + "골드를 사용해 어빌리티 아티팩트 깎기에 성공했습니다! (" + (user.artifact.artifacts[idx1].success_prob * 100).fix() + "%)\n\n" + displayAbilityArtifact(user.artifact.artifacts[idx1]));
                        } else {
                            channel.sendChat("❌ " + price + "골드를 사용해 어빌리티 아티팩트 깎기에 실패했습니다. (" + (user.artifact.artifacts[idx1].success_prob * 100).fix() + "%)\n\n" + displayAbilityArtifact(user.artifact.artifacts[idx1]));
                        }
                    } else if (args[1] == "장착") {
                        let idx = Number(args[2]) - 1;
                        if (isNaN(idx) || idx % 1 != 0 || idx < 0 || !user.artifact.artifacts[idx]) {
                            channel.sendChat("❌ 잘못된 입력입니다.\n[ /TCGenius 아티팩트 장착 <아티팩트 번호> ]");
                        } else if ((user.artifact.artifacts[idx].abilities[0].level + user.artifact.artifacts[idx].abilities[1].level + user.artifact.artifacts[idx].abilities[2].level) < 30) {
                            channel.sendChat("❌ 완성된 어빌리티 아티팩트만 장착할 수 있습니다.");
                        } else {
                            user.artifact.equip = {
                                artifactId: user.artifact.artifacts[idx].id
                            };
                            await user.save();
                            channel.sendChat("✅ 어빌리티 아티팩트를 장착했습니다.\n\n" + displayAbilityArtifact(user.artifact.artifacts[idx]));
                        }
                    } else if (args[1] == "분해") {
                        let idx = Number(args[2]) - 1;
                        if (isNaN(idx) || idx % 1 != 0 || idx < 0 || !user.artifact.artifacts[idx]) {
                            channel.sendChat("❌ 잘못된 입력입니다.\n[ /TCGenius 아티팩트 분해 <아티팩트 번호> ]");
                        } else {
                            user.artifact.artifacts.splice(idx, 1);
                            let rewards = user.givePack([{item:true,name:"아티팩트 파편",count:{min:10,max:55}},{gold:true,count:{min:500,max:1000}}]);
                            await user.save();
                            channel.sendChat("✅ 아티팩트를 분해했습니다.\n\n[ 분해 결과 ]\n" + rewards.join("\n"));
                        }
                    } else if (args[1] == "거래") {
                        let target = await getTCGUserByName(args[2]);
                        if (!target) {
                            channel.sendChat("❌ 존재하지 않는 유저입니다.");
                            return;
                        } else if (target.id == user.id) {
                            channel.sendChat("❌ 자기 자신에게 선물할 수 없습니다.");
                            return;
                        }
                        let idx = Number(args[3]) - 1;
                        if (isNaN(idx) || idx % 1 != 0 || idx < 0 || !user.artifact.artifacts[idx]) {
                            channel.sendChat("❌ 잘못된 입력입니다.\n[ /TCGenius 아티팩트 거래 <닉네임> <아티팩트 번호> ]");
                        } else {
                            if ((user.artifact.artifacts[idx].abilities[0].level + user.artifact.artifacts[idx].abilities[1].level + user.artifact.artifacts[idx].abilities[2].level) > 0) {
                                channel.sendChat("❌ 한 번이라도 깎은 아티팩트는 거래할 수 없습니다.");
                                return;
                            }
                            let tradeTicket = user.inventory.item.find(i => i.id == 31) || {count:0};
                            if (tradeTicket.count < 1) {
                                channel.sendChat("❌ 거래권이 부족합니다!");
                                return;
                            }
                            target.artifact.artifacts.push(user.artifact.artifacts[idx]);
                            await target.save();
                            user.artifact.artifacts.splice(idx, 1);
                            user.removeItem(31, 1);
                            await user.save();
                            channel.sendChat("✅ " + target + "님에게 아티팩트를 전송했습니다.");
                        }
                    } else if (args[1] == "목록") {
                        channel.sendChat("[ 어빌리티 아티팩트 ]\n" + (user.artifact.artifacts.length == 0 ? "\n보유한 어빌리티 아티팩트가 없습니다." : VIEWMORE + "\n" + user.artifact.artifacts.map((a,i) => "[ 아티팩트 번호: " + (i + 1) + " ]\n" + displayAbilityArtifact(a)).join("\n\n")));
                    }
                    return;
                }

                // 제작
                if (args[0] == "제작") {
                    let target = cmd.substr(cmd.split(" ")[0].length + 4);
                    let num = 1;
                    if (!isNaN(target.split(" ").pop())) {
                        let target_split = target.split(" ");
                        num = parseInt(target_split.pop());
                        target = target_split.join(" ");
                    }
                    if (num < 1 || num % 1 != 0 || isNaN(num)) {
                        channel.sendChat("❌ 수량을 제대로 입력해주세요.");
                        return;
                    }
                    
                    // 랜덤주사위 제작 처리
                    if (target == "랜덤주사위") {
                        let items = JSON.parse(read("DB/TCG/item.json"));
                        let materials = [];
                        let enough = true;
                        
                        // 필요한 재료 확인
                        let needDim = 2 * num;
                        let needBright = 8 * num;
                        let needClean = 50 * num;
                        
                        // 강렬한 기운 확인
                        let dimItemIdx = items.findIndex(i => i.name == "강렬한 기운");
                        let userDimItem = user.inventory.item.find(i => i.id == dimItemIdx) || {count: 0};
                        if (userDimItem.count < needDim) {
                            enough = false;
                            materials.push("❌ 강렬한 기운 " + userDimItem.count + "/" + needDim);
                        } else {
                            materials.push("✅ 강렬한 기운 " + userDimItem.count + "/" + needDim);
                        }
                        
                        // 영롱한 기운 확인
                        let brightItemIdx = items.findIndex(i => i.name == "영롱한 기운");
                        let userBrightItem = user.inventory.item.find(i => i.id == brightItemIdx) || {count: 0};
                        if (userBrightItem.count < needBright) {
                            enough = false;
                            materials.push("❌ 영롱한 기운 " + userBrightItem.count + "/" + needBright);
                        } else {
                            materials.push("✅ 영롱한 기운 " + userBrightItem.count + "/" + needBright);
                        }
                        
                        // 깔끔한 기운 확인
                        let cleanItemIdx = items.findIndex(i => i.name == "깔끔한 기운");
                        let userCleanItem = user.inventory.item.find(i => i.id == cleanItemIdx) || {count: 0};
                        if (userCleanItem.count < needClean) {
                            enough = false;
                            materials.push("❌ 깔끔한 기운 " + userCleanItem.count + "/" + needClean);
                        } else {
                            materials.push("✅ 깔끔한 기운 " + userCleanItem.count + "/" + needClean);
                        }
                        
                        if (!enough) {
                            channel.sendChat("❌ 제작 재료가 부족합니다!\n\n랜덤주사위 x" + num + " 제작 재료:\n" + materials.join("\n"));
                            return;
                        }
                        
                        // 재료 차감
                        user.removeItem(dimItemIdx, needDim);
                        user.removeItem(brightItemIdx, needBright);
                        user.removeItem(cleanItemIdx, needClean);
                        
                        // 랜덤주사위 지급
                        let results = [];
                        for (let i = 0; i < num; i++) {
                            let diceType = getRandomDiceType();
                            let diceItemIdx = items.findIndex(item => item.name == diceType + " 주사위");
                            if (diceItemIdx !== -1) {
                                user.addItem(diceItemIdx, 1);
                                results.push(diceType + " 주사위");
                            }
                        }
                        
                        await user.save();
                        
                        let resultText = results.reduce((acc, curr) => {
                            acc[curr] = (acc[curr] || 0) + 1;
                            return acc;
                        }, {});
                        
                        let resultMessage = "✅ 랜덤주사위 x" + num + "개를 제작했습니다!\n\n[ 획득한 주사위 ]\n";
                        for (let dice in resultText) {
                            resultMessage += "- " + dice + " x" + resultText[dice] + "\n";
                        }
                        
                        channel.sendChat(resultMessage.trim());
                        return;
                    }
                    
                    let trade = JSON.parse(read("DB/TCG/trade.json")).find(t => t.name == target);
                    if (!trade) {
                        channel.sendChat("❌ 제작 물품이 존재하지 않습니다.");
                    } else {
                        let materials = [];
                        let enough = true;
                        let items = JSON.parse(read("DB/TCG/item.json"));
                        let cards = JSON.parse(read("DB/TCG/card.json"));
                        trade.material.forEach(m => {
                            if (m.gold) {
                                if (user.gold < (m.count * num)) {
                                    enough = false;
                                    materials.push("❌ 골드 " + numberWithCommas(user.gold.toString()) + "/" + numberWithCommas((m.count * num).toString()));
                                } else {
                                    materials.push("✅ 골드 " + numberWithCommas(user.gold.toString()) + "/" + numberWithCommas((m.count * num).toString()));
                                }
                            } else if (m.garnet) {
                                if (user.garnet < (m.count * num)) {
                                    enough = false;
                                    materials.push("❌ 가넷 " + numberWithCommas(user.garnet.toString()) + "/" + numberWithCommas((m.count * num).toString()));
                                } else {
                                    materials.push("✅ 가넷 " + numberWithCommas(user.garnet.toString()) + "/" + numberWithCommas((m.count * num).toString()));
                                }
                            } else if (m.item) {
                                let itemIdx = items.findIndex(i => i.name == m.name);
                                let userItem = user.inventory.item.find(i => i.id == itemIdx) || {count: 0};
                                if (userItem.count < (m.count * num)) {
                                    enough = false;
                                    materials.push("❌ " + m.name + " " + numberWithCommas(userItem.count.toString()) + "/" + numberWithCommas((m.count * num).toString()));
                                } else {
                                    materials.push("✅ " + m.name + " " + numberWithCommas(userItem.count.toString()) + "/" + numberWithCommas((m.count * num).toString()));
                                }
                            } else if (m.card) {
                                let cardIdx = cards.findIndex(c => c.name == m.name && c.title == m.title);
                                let userCard = user.inventory.card.find(c => c.id == cardIdx) || {count: 0};
                                if (userCard.count < (m.count * num)) {
                                    enough = false;
                                    materials.push("❌ [" + m.title + "]" + m.name + " " + numberWithCommas(userCard.count.toString()) + "/" + numberWithCommas((m.count * num).toString()));
                                } else {
                                    materials.push("✅ [" + m.title + "]" + m.name + " " + numberWithCommas(userCard.count.toString()) + "/" + numberWithCommas((m.count * num).toString()));
                                }
                            }
                        });
                        if (!enough) {
                            channel.sendChat("❌ 제작 재료가 부족합니다.\n\n" + target + " x" + num.toComma() + " 제작 재료:\n" + materials.join("\n"));
                        } else {
                            trade.material.multiplyKey('count', -num);
                            user.givePack(trade.material);
                            trade.reward.multiplyKey('count', num);
                            let rewards = user.givePack(trade.reward);
                            await user.save();
                            channel.sendChat("✅ 성공적으로 제작했습니다!\n\n" + rewards.join("\n"));
                        }
                    }
                    return;
                }

                // 일일과제
                if (args[0] == "일일과제") {
                    let daily_quests = JSON.parse(read("DB/TCG/daily_quest.json"));
                    channel.sendChat("[ 일일 과제 ]\n\n" + daily_quests.map(q => (user.daily_quest.includes(q.name) ? "✅" : "❌") + " < " + q.name + " >\n달성 조건: " + q.desc).join("\n\n"));
                    return;
                }

                // 잠금
                if (args[0] == "잠금") {
                    let targetCard = args[1];
                    if (targetCard && targetCard.startsWith("[성장형]")) {
                        channel.sendChat("❌ 성장형 카드는 고정적으로 잠금되어있으며, 해제가 불가능합니다.");
                        return;
                    }
                    let cards = JSON.parse(read("DB/TCG/card.json"));
                    let cardIdx = cards.findIndex(c => "[" + c.title + "]" + c.name.replace(/\s/gi, "") == targetCard);
                    if (cardIdx == -1) {
                        channel.sendChat("❌ 존재하지 않는 카드입니다.");
                        return;
                    }
                    if (!user.inventory.card.find(c => c.id == cardIdx)) {
                        channel.sendChat("❌ 보유한 카드가 아닙니다.");
                        return;
                    }
                    if (user.inventory.card.find(c => c.id == cardIdx).lock) {
                        user.inventory.card.find(c => c.id == cardIdx).lock = false;
                        await user.save();
                        channel.sendChat("✅ " + targetCard + " 카드의 잠금을 해제했습니다.");
                    } else {
                        user.inventory.card.find(c => c.id == cardIdx).lock = true;
                        await user.save();
                        channel.sendChat("✅ " + targetCard + " 카드를 잠금했습니다.");
                    }
                    return;
                }

                // 일괄강화
                if (args[0] == "일괄강화") {
                    let targetCard = args[1];
                    let targetRarity = args[2];
                    if (!["일반","희귀","고급","영웅","전설"].includes(targetRarity)) {
                        channel.sendChat("❌ 잘못된 입력입니다.\n[ /TCGenius 일괄강화 <카드명> <등급> ]");
                        return;
                    }
                    let cards = JSON.parse(read("DB/TCG/card.json"));
                    let cardIdx = cards.findIndex(c => "[" + c.title + "]" + c.name.replace(/\s/gi, "") == targetCard);
                    let isGrowth = (targetCard && targetCard.startsWith("[성장형]") && user.growthCard.find(c => "[" + c.title + "]" + c.name == targetCard));
                    if (!isGrowth && cardIdx == -1) {
                        channel.sendChat("❌ 존재하지 않는 카드입니다.\n카드명은 다음과 같이 입력해야 합니다: [테마]카드명");
                        return;
                    }
                    if (!isGrowth && !user.inventory.card.find(c => c.id == cardIdx)) {
                        channel.sendChat("❌ 보유하고 있는 카드가 아닙니다.");
                        return;
                    }
                    let card = user.inventory.card.find(c => c.id == cardIdx);
                    if (!card) card = user.growthCard.find(c => "[" + c.title + "]" + c.name == targetCard);
                    if (!card) {
                        channel.sendChat("❌ 보유하고 있는 카드가 아닙니다.");
                        return;
                    }
                    let invCard = card;
                    card = card.concat();
                    if (card.title != "성장형") card.deepMerge(cards[cardIdx]);
                    if (card.desc && card.desc.startsWith("노스타코인")) {
                        channel.sendChat("❌ 강화가 불가능한 카드입니다.");
                        return;
                    }
                    let maxLevels = {
                        "일반": 1,
                        "고급": 2,
                        "희귀": 3,
                        "영웅": 4,
                        "전설": 5
                    };
                    let plusExp = {
                        "일반": 200,
                        "고급": 2000,
                        "희귀": 5000,
                        "영웅": 20000,
                        "전설": 50000
                    };
                    let needExp = {
                        "일반": 1000,
                        "고급": 10000,
                        "희귀": 50000,
                        "영웅": 160000,
                        "전설": 400000
                    };
                    if (card.level >= maxLevels[card.rarity] + (card.breakLimit ? 1:0)) {
                        channel.sendChat("❌ 이미 최대 레벨까지 강화된 카드입니다." + (!card.breakLimit && !isGrowth ? "\n카드를 한계 돌파하여 1회 더 강화할 수 있습니다." : ""));
                        return;
                    }
                    let getExp = 0;
                    let needs = needExp[card.rarity] - (card.exp || 0);
                    let needCount = Math.ceil(needs / plusExp[targetRarity]);
                    let useCards = [];
                    let useCardsForDisplay = [];
                    let userCards = user.inventory.card.concat().filter(c => !c.lock && cards[c.id].rarity == targetRarity && c.id != cardIdx).sort(function(a, b) {return a.id - b.id;});
                    for(let i = 0; i < needCount; i++) {
                        if (userCards.length == 0) break;
                        let useCard = userCards[0];
                        userCards[0].count--;
                        if (userCards[0].count <= 0) userCards.splice(0, 1);
                        useCard.deepMerge(cards[useCard.id]);
                        useCards.push(useCard.id);
                        if (useCardsForDisplay.find(c => c.id == useCard.id)) {
                            useCardsForDisplay.find(c => c.id == useCard.id).count++;
                        } else {
                            useCardsForDisplay.push({
                                id: useCard.id,
                                name: printCard(useCard),
                                count: 1
                            });
                        }
                        getExp += plusExp[useCard.rarity];
                    }
                    if (getExp == 0) {
                        channel.sendChat("❌ 일괄 강화에 사용할 수 있는 카드가 없습니다.");
                        return;
                    }
                    if (user.gold < Math.round(getExp / 2) && (!card.desc || !card.desc.startsWith("슴니즌"))) {
                        channel.sendChat("❌ 골드가 부족합니다!\n필요 골드: " + numberWithCommas(user.gold.toString()) + "/" + numberWithCommas(Math.round(getExp / 2).toString()));
                        return;
                    }
                    if (!card.desc || !card.desc.startsWith("슴니즌")) user.gold -= Math.round(getExp / 2);
                    useCards.forEach(cardId => {
                        user.removeCard(cardId, 1);
                    });
                    if (!invCard.exp) invCard.exp = 0;
                    invCard.exp += getExp;
                    await user.checkQuest("[강화] 강화의 달인", channel);
                    channel.sendChat("✅ " + targetRarity + " 등급의 카드들을 일괄 사용하여 경험치가 +" + getExp.toComma2() + " 증가했습니다.\n(" + invCard.exp.toComma2() + "/" + needExp[card.rarity].toComma2() + ")\n\n[ 사용된 카드 ]\n" + VIEWMORE + useCardsForDisplay.map(c => c.name + (c.count > 1 ? " x" + c.count.toComma2() : "")).join("\n"));
                    await checkCardLevelUp(card, invCard, channel);
                    await user.save();
                    return;
                }

                // 카드능력 일괄수정 (관리자)
                if (args[0] == "카드능력" && args[1] && args[1].startsWith("일괄수정") && user.isAdmin) {
                    let cardArgs = msg.split("\n");
                    cardArgs.splice(0, 1);
                    let cards = JSON.parse(read("DB/TCG/card.json"));
                    let res = [];
                    cardArgs.forEach(inputCard => {
                        let match = inputCard.match(/^\[([^\]]+)\]([^P']+?)(?:P(\d+))?\s*\[([^\]]+)\]$/);
                        if (match) {
                            let theme = match[1].trim();
                            let name = match[2].trim();
                            let power = match[3] ? match[3].trim() : "";
                            let desc = match[4].trim();
                            let card = cards.find(c => c.title == theme && c.name == name);
                            if (card) {
                                if (power && !isNaN(power)) {
                                    power = Math.round(Number(power));
                                    card.power = power;
                                    res.push("✅ [" + theme + "]" + name + " 카드의 파워가 변경되었습니다.");
                                }
                                if (desc != "유지") {
                                    if (desc == "제거") card.desc = "";
                                    else card.desc = desc;
                                    res.push("✅ [" + theme + "]" + name + " 카드의 능력이 수정되었습니다.");
                                }
                            } else {
                                res.push("❌ [" + theme + "]" + name + " 카드가 존재하지 않습니다.");
                            }
                        } else {
                            res.push("❌ " + inputCard + " 형식이 올바르지 않습니다.");
                        }
                    });
                    save("DB/TCG/card.json", JSON.stringify(cards, null, 4));
                    channel.sendChat("✅ 카드 능력 일괄수정을 수행했습니다.\n\n[ 결과 ]\n" + VIEWMORE + res.join("\n"));
                    return;
                }

                // 메가카운트
                if (args[0] == "메가카운트") {
                    let mc = JSON.parse(read("DB/TCG/megaCount.json"));
                    if (!args[1]) {
                        let displayMC = mc.map(megaCount => {
                            return "[" + megaCount.type + "] 「" + printPack(megaCount.reward, " + ") + "」\n>> 남은 횟수 " + megaCount.count + "/" + megaCount.maxCount;
                        });
                        let totalCount = mc.reduce((acc,cur) => acc + cur.count, 0);
                        let totalMaxCount = mc.reduce((acc,cur) => acc + cur.maxCount, 0);
                        channel.sendChat("[ 메가카운트 ]\n남은 카운트: " + totalCount.toComma2() + " / " + totalMaxCount.toComma2() + "\n" + VIEWMORE + "\n\n" + displayMC.join("\n\n"));
                    } else if (!isNaN(args[1])) {
                        let num = Number(args[1]);
                        if (num != 1 && num != 10 && num != 50) {
                            channel.sendChat("❌ 1회, 10회, 50회 뽑기만 가능합니다.");
                            return;
                        }
                        if ((user.inventory.item.find(i => i.id == 85) || {count:0}).count < num) {
                            channel.sendChat("❌ 메가카운트 이용권이 부족합니다.\n보유 메가카운트 이용권: " + (user.inventory.item.find(i => i.id == 85) || {count:0}).count + "/" + num);
                            return;
                        }
                        if (Object.keys(megaCounting).length) {
                            channel.sendChat("❌ 누군가 메가카운트를 이용중입니다.");
                            return;
                        }
                        user.removeItem(85, num);
                        user.save();
                        let gotItems = [];
                        let gotUnique = false;
                        megaCounting[user.id] = true;
                        if (num > 1) channel.sendChat("✅ 메가카운트 " + num + "회를 진행합니다. (" + mc.reduce((acc,cur) => acc + cur.count, 0).toComma2() + "/" + mc.reduce((acc,cur) => acc + cur.maxCount, 0).toComma2() + ")");
                        
                        // Node.js 비동기 처리
                        setTimeout(async () => {
                            try {
                                for(let i = 0; i < num; i++) {
                                    let n = 0;
                                    let r = Math.floor(Math.random() * mc.reduce((acc,cur) => acc + cur.count, 0)) + 1;
                                    for (let mega of mc) {
                                        n += mega.count;
                                        if (r <= n) {
                                            //user.givePack(mega.reward);
                                            mega.reward.forEach(rw => {
                                                rw = rw.concat();
                                                rw.rarity = mega.type;
                                                let myReward;
                                                if (myReward = gotItems.find(g => g.gold == rw.gold && g.garnet == rw.garnet && g.item == rw.item && g.card == rw.card && g.name == rw.name)) {
                                                    myReward.count += rw.count;
                                                } else {
                                                    gotItems.push(rw.concat());
                                                }
                                            });
                                            mega.count--;
                                            if (mega.type == "유니크") {
                                                gotUnique = mc.reduce((acc,cur) => acc + cur.count, 0).toComma2();
                                                mc.forEach(m => {
                                                    m.count = m.maxCount
                                                });
                                            }
                                            break;
                                        }
                                    }
                                    if (gotUnique) {
                                        num = i + 1;
                                        TCGLog("📜 메가카운트 유니크 보상 로그 📜\n\n>> 획득한 유저: " + user + "\n>> 메가카운트 번호: " + gotUnique);
                                        channel.sendChat("🎉");
                                        channel.sendChat("🎉 메가 쇼타임! 🎉\n" + user + "님이 메가카운트 " + gotUnique + "번에서 유니크 보상을 획득하셨습니다 !!\n\n[ 획득 보상 ] 「" + printPack(mc.find(m => m.type == "유니크").reward, " + ") + "」\n\n✅ 메가카운트 판이 초기화됩니다.");
                                        break;
                                    }
                                }
                                user.givePack(gotItems);
                                save("DB/TCG/megaCount.json", JSON.stringify(mc, null, 4));
                                await user.save();
                                channel.sendChat("[ 메가카운트 " + num + "회 결과 ]\n" + VIEWMORE + printPack(gotItems, "\n", "- "));
                                delete megaCounting[user.id];
                            } catch(e) {
                                delete megaCounting[user.id];
                                channel.sendChat("❌ 메가카운트 처리 중 오류가 발생했습니다.");
        console.log(e);
                            }
                        }, 100);
                    }
                    return;
                }

                // 해방
                if (args[0] == "해방") {
                    if (args.length < 2) {
                        channel.sendChat("❌ 잘못된 입력입니다.\n[ /TCGenius 해방 [덱이름] ]\n덱이름: 콘텐츠덱1, 콘텐츠덱2, 골드덱");
                        return;
                    }
                    
                    let deckName = args[1];
                    let deckType = null;
                    
                    if (deckName == "콘텐츠덱1") {
                        deckType = "content1";
                    } else if (deckName == "콘텐츠덱2") {
                        deckType = "content2";
                    } else if (deckName == "골드덱") {
                        deckType = "gold";
                    } else {
                        channel.sendChat("❌ 잘못된 덱 이름입니다. 콘텐츠덱1, 콘텐츠덱2, 골드덱 중에서 선택해주세요.");
                        return;
                    }

                    if (user.liberation[deckType].liberated) {
                        channel.sendChat("❌ 이미 해방된 덱입니다.");
                        return;
                    }
                    
                    let keyItem = JSON.parse(read("DB/TCG/item.json")).find(item => item.name == "해방의 열쇠");
                    if (!keyItem) {
                        channel.sendChat("❌ 해방의 열쇠 아이템을 찾을 수 없습니다.");
                        return;
                    }
                    
                    let keyItemIdx = JSON.parse(read("DB/TCG/item.json")).findIndex(item => item.name == "해방의 열쇠");
                    let userKeyItem = user.inventory.item.find(item => item.id == keyItemIdx);
                    
                    if (!userKeyItem || userKeyItem.count < 1) {
                        channel.sendChat("❌ 해방의 열쇠가 필요합니다.");
                        return;
                    }
                    
                    if (user.gold < 1000000) {
                        channel.sendChat("❌ 골드가 부족합니다.\n보유 골드: " + user.gold.toComma2() + "/1,000,000");
                        return;
                    }
                    
                    user.removeItem(keyItemIdx, 1);
                    user.gold -= 1000000;
                    
                    user.liberation[deckType].liberated = true;
                    user.liberation[deckType].dice_count.dim = 1;
                    user.liberation[deckType].bonuses = generateLiberationBonuses(deckType, "희미한", 0);
                    
                    await user.save();
                    
                    let rankNames = ["브론즈", "실버", "골드", "플래티넘"];
                    let message = "✅ " + deckName + "을 해방시켰습니다!\n" +
                                 "현재 해방등급: " + rankNames[user.liberation[deckType].rank] + "\n\n";
                    
                    message += "[ 적용된 보너스 ]\n";
                    user.liberation[deckType].bonuses.forEach(bonus => {
                        let rarityIcon = "";
                        switch(bonus.rarity) {
                            case "normal": rarityIcon = "⚪"; break;
                            case "rare": rarityIcon = "🔵"; break;
                            case "unique": rarityIcon = "🟣"; break;
                            case "legendary": rarityIcon = "🟡"; break;
                        }
                        message += rarityIcon + " " + bonus.effect + "\n";
                    });

                    channel.sendChat(message.trim());
                    return;
                }
                
                // 주사위
                if (args[0] == "주사위") {
                    if (args.length < 3) {
                        channel.sendChat("사용법: /TCGenius 주사위 [덱이름] [주사위종류]\n" +
                                     "덱이름: 콘텐츠덱1, 콘텐츠덱2, 골드덱\n" +
                                     "주사위종류: 희미한, 빛나는, 찬란한, 운명, 심판");
                        return;
                    }
                    
                    let deckName = args[1];
                    let diceType = args[2];
                    let deckType = null;
                    
                    if (deckName == "콘텐츠덱1") {
                        deckType = "content1";
                    } else if (deckName == "콘텐츠덱2") {
                        deckType = "content2";
                    } else if (deckName == "골드덱") {
                        deckType = "gold";
                    } else {
                        channel.sendChat("❌ 잘못된 덱 이름입니다.");
                        return;
                    }
                    
                    if (!user.liberation[deckType].liberated) {
                        channel.sendChat("❌ 해당 덱이 해방되지 않았습니다.\n[ /TCGenius 해방 [덱이름] ]");
                        return;
                    }
                    
                    let diceTypeMap = {
                        "희미한": "dim",
                        "빛나는": "bright", 
                        "찬란한": "brilliant",
                        "운명": "fate",
                        "심판": "judgment"
                    };
                    
                    if (!diceTypeMap[diceType]) {
                        channel.sendChat("❌ 잘못된 주사위 종류입니다. 희미한, 빛나는, 찬란한, 운명, 심판 중에서 선택해주세요.");
                        return;
                    }
                    
                    let diceKey = diceTypeMap[diceType];
                    let currentRank = user.liberation[deckType].rank;
                    
                    if (!canUseDice(diceType, currentRank)) {
                        channel.sendChat("❌ 현재 해방등급에서는 " + diceType + " 주사위를 사용할 수 없습니다.");
                        return;
                    }
                    
                    let diceItem = JSON.parse(read("DB/TCG/item.json")).find(item => item.name == diceType + " 주사위");
                    if (!diceItem) {
                        channel.sendChat("❌ " + diceType + " 주사위 아이템을 찾을 수 없습니다.");
                        return;
                    }
                    
                    let diceItemIdx = JSON.parse(read("DB/TCG/item.json")).findIndex(item => item.name == diceType + " 주사위");
                    let userDiceItem = user.inventory.item.find(item => item.id == diceItemIdx);
                    
                    if (!userDiceItem || userDiceItem.count < 1) {
                        channel.sendChat("❌ " + diceType + " 주사위가 필요합니다.");
                        return;
                    }
                    
                    if (user.gold < 3632) {
                        channel.sendChat("❌ 골드가 부족합니다.\n보유 골드: " + user.gold.toComma2() + "/3,632");
                        return;
                    }
                    
                    user.removeItem(diceItemIdx, 1);
                    user.gold -= 3632;
                    user.liberation[deckType].dice_count[diceKey]++;
                    
                    let result = processDiceRoll(diceType, currentRank, user.liberation[deckType].dice_count);
                    
                    if (result.rankUp) {
                        user.liberation[deckType].rank = result.newRank;
                    }
                    
                    // 심판 주사위인 경우 Before/After 선택 시스템
                    if (diceType === "심판") {
                        if (user.liberation[deckType].pendingChoice) {
                            channel.sendChat("❌ 이전 BEFORE / AFTER 보너스를 선택해야합니다.");
                            return;
                        }
                        let beforeBonuses = user.liberation[deckType].bonuses || [];
                        let afterRank = result.rankUp ? result.newRank : currentRank;
                        let afterBonuses = generateLiberationBonuses(deckType, diceType, afterRank);
                        
                        user.liberation[deckType].pendingChoice = {
                            before: beforeBonuses,
                            after: afterBonuses,
                            rankUp: result.rankUp
                        };
                        
                        await user.save();
                        
                        let rankNames = ["브론즈", "실버", "골드", "플래티넘"];
                        let message = "🎲 심판 주사위를 굴렸습니다!\n" +
                                     "현재 해방등급: " + rankNames[user.liberation[deckType].rank] + "\n\n";
                        
                        if (result.rankUp) {
                            message += "🎉 축하합니다! 해방등급이 " + rankNames[result.newRank] + "로 승급했습니다!\n\n";
                        }
                        
                        message += "⚖️ 보너스를 선택해주세요:\n\n";
                        
                        message += "[ BEFORE ]\n";
                        beforeBonuses.forEach(bonus => {
                            let rarityIcon = "";
                            switch(bonus.rarity) {
                                case "normal": rarityIcon = "⚪"; break;
                                case "rare": rarityIcon = "🔵"; break;
                                case "unique": rarityIcon = "🟣"; break;
                                case "legendary": rarityIcon = "🟡"; break;
                            }
                            message += rarityIcon + " " + bonus.effect + "\n";
                        });
                        
                        message += "\n[ AFTER ]\n";
                        afterBonuses.forEach(bonus => {
                            let rarityIcon = "";
                            switch(bonus.rarity) {
                                case "normal": rarityIcon = "⚪"; break;
                                case "rare": rarityIcon = "🔵"; break;
                                case "unique": rarityIcon = "🟣"; break;
                                case "legendary": rarityIcon = "🟡"; break;
                            }
                            message += rarityIcon + " " + bonus.effect + "\n";
                        });
                        
                        message += "\n[ /TCGenius 선택 [BEFORE/AFTER] ]";
                        
                        channel.sendChat(message.trim());
                        return;
                    }
                    
                    // 일반 주사위의 경우
                    let newBonuses = generateLiberationBonuses(deckType, diceType, user.liberation[deckType].rank);
                    user.liberation[deckType].bonuses = newBonuses;
                    
                    await user.save();
                    
                    let rankNames = ["브론즈", "실버", "골드", "플래티넘"];
                    let message = "🎲 " + diceType + " 주사위를 굴렸습니다!\n" +
                                 "현재 해방등급: " + rankNames[user.liberation[deckType].rank] + "\n\n";
                    
                    if (result.rankUp) {
                        message += "🎉 축하합니다! 해방등급이 " + rankNames[result.newRank] + "로 승급했습니다!\n\n";
                    }
                    
                    message += "✨ 새로운 보너스:\n";
                    newBonuses.forEach(bonus => {
                        let rarityIcon = "";
                        switch(bonus.rarity) {
                            case "normal": rarityIcon = "⚪"; break;
                            case "rare": rarityIcon = "🔵"; break;
                            case "unique": rarityIcon = "🟣"; break;
                            case "legendary": rarityIcon = "🟡"; break;
                        }
                        message += rarityIcon + " " + bonus.effect + "\n";
                    });
                    
                    channel.sendChat(message.trim());
                    return;
                }
                
                // 해방상태
                if (args[0] == "해방상태") {
                    if (args.length < 2) {
                        channel.sendChat("❌ 사용법: /tcg 해방상태 [덱이름]");
                        return;
                    }
                    
                    let deckName = args[1];
                    let deckType = null;
                    
                    if (deckName == "콘텐츠덱1") {
                        deckType = "content1";
                    } else if (deckName == "콘텐츠덱2") {
                        deckType = "content2";
                    } else if (deckName == "골드덱") {
                        deckType = "gold";
                    } else {
                        channel.sendChat("❌ 잘못된 덱 이름입니다.");
                        return;
                    }
                    
                    let rankNames = ["브론즈", "실버", "골드", "플래티넘"];
                    let liberation = user.liberation[deckType];
                    
                    if (liberation.liberated == false) {
                        channel.sendChat("❌ " + deckName + "이 해방되지 않았습니다.");
                        return;
                    }
                    
                    let message = "[ " + user + "님의 " + deckName + " 해방 상태 ]\n\n" +
                                 "현재 해방등급: " + rankNames[liberation.rank] + "\n" +
                                 "주사위 사용 횟수:\n";
                    
                    if (liberation.dice_count.dim > 0) message += "- 희미한 주사위: " + liberation.dice_count.dim + "회\n";
                    if (liberation.dice_count.bright > 0) message += "- 빛나는 주사위: " + liberation.dice_count.bright + "회\n";
                    if (liberation.dice_count.brilliant > 0) message += "- 찬란한 주사위: " + liberation.dice_count.brilliant + "회\n";
                    if (liberation.dice_count.fate > 0) message += "- 운명 주사위: " + liberation.dice_count.fate + "회\n";
                    if (liberation.dice_count.judgment > 0) message += "- 심판 주사위: " + liberation.dice_count.judgment + "회\n";
                    
                    if (liberation.bonuses && liberation.bonuses.length > 0) {
                        message += "\n✨ 적용된 보너스:\n";
                        liberation.bonuses.forEach(bonus => {
                            let rarityIcon = "";
                            switch(bonus.rarity) {
                                case "normal": rarityIcon = "⚪"; break;
                                case "rare": rarityIcon = "🔵"; break;
                                case "unique": rarityIcon = "🟣"; break;
                                case "legendary": rarityIcon = "🟡"; break;
                            }
                            message += rarityIcon + " " + bonus.effect + "\n";
                        });
                    }
                    
                    channel.sendChat(message.trim());
                    return;
                }
                
                // 선택 (심판 주사위 BEFORE/AFTER)
                if (args[0] == "선택") {
                    if (args.length < 2) {
                        channel.sendChat("❌ 사용법: /tcg 선택 [before/after]");
                        return;
                    }
                    
                    let choice = args[1].toLowerCase();
                    if (choice !== "before" && choice !== "after") {
                        channel.sendChat("❌ 잘못된 선택입니다. 'before' 또는 'after'를 입력해주세요.");
                        return;
                    }
                    
                    let hasPendingChoice = false;
                    let targetDeckType = null;
                    
                    for (let deckType in user.liberation) {
                        if (user.liberation[deckType].pendingChoice) {
                            hasPendingChoice = true;
                            targetDeckType = deckType;
                            break;
                        }
                    }
                    
                    if (!hasPendingChoice) {
                        channel.sendChat("❌ 선택할 보너스가 없습니다. 먼저 심판 주사위를 사용해주세요.");
                        return;
                    }
                    
                    let pendingChoice = user.liberation[targetDeckType].pendingChoice;
                    
                    if (choice === "before") {
                        user.liberation[targetDeckType].bonuses = pendingChoice.before;
                    } else {
                        user.liberation[targetDeckType].bonuses = pendingChoice.after;
                    }
                    
                    delete user.liberation[targetDeckType].pendingChoice;
                    
                    await user.save();
                    
                    let deckNames = {
                        "content1": "콘텐츠덱1",
                        "content2": "콘텐츠덱2", 
                        "gold": "골드덱"
                    };
                    
                    let selectedBonuses = choice === "before" ? pendingChoice.before : pendingChoice.after;
                    
                    let message = "✅ " + deckNames[targetDeckType] + "에 " + (choice === "before" ? "BEFORE" : "AFTER") + " 보너스를 적용했습니다!\n\n";
                    message += "✨ 적용된 보너스:\n";
                    
                    selectedBonuses.forEach(bonus => {
                        let rarityIcon = "";
                        switch(bonus.rarity) {
                            case "normal": rarityIcon = "⚪"; break;
                            case "rare": rarityIcon = "🔵"; break;
                            case "unique": rarityIcon = "🟣"; break;
                            case "legendary": rarityIcon = "🟡"; break;
                        }
                        message += rarityIcon + " " + bonus.effect + "\n";
                    });
                    
                    channel.sendChat(message.trim());
                    return;
                }

                // 콘텐츠
                if (args[0] == "콘텐츠") {
                    // 콘텐츠 입장
                    if (args[1] == "입장") {
                        if (!args[2] || !["노말", "하드", "익스트림"].includes(args[2])) {
                            channel.sendChat("❌ 잘못된 입력입니다.\n[ /TCGenius 콘텐츠 입장 [난이도] ]\n난이도: 노말, 하드, 익스트림");
                            return;
                        }
                        
                        let difficulty = args[2];
                        
                        // 이미 파티에 속해있는지 확인
                        for (let partyId in raidParties) {
                            if (raidParties[partyId].members.find(m => m.userId == user.id)) {
                                channel.sendChat("❌ 이미 파티에 참여 중입니다.");
                                return;
                            }
                        }
                        
                        // 덱 파워가 측정되어 있는지 확인
                        if (!user.deck_power_5man || !user.deck_power_duo || !user.deck_power_pure) {
                            channel.sendChat("❌ 먼저 덱 파워를 측정해주세요.\n[ /TCGenius 덱파워측정 콘텐츠덱1 ]");
                            return;
                        }
                        
                        // 콘텐츠 입장권 확인
                        let items = JSON.parse(read("DB/TCG/item.json"));
                        let weeklyTicketIdx = items.findIndex(i => i.name == "주간 콘텐츠 입장권");
                        let repeatTicketIdx = items.findIndex(i => i.name == "반복 콘텐츠 입장권");
                        
                        let hasWeekly = (user.inventory.item.find(i => i.id == weeklyTicketIdx) || {count: 0}).count > 0;
                        let hasRepeat = (user.inventory.item.find(i => i.id == repeatTicketIdx) || {count: 0}).count > 0;
                        
                        if (!hasWeekly && !hasRepeat) {
                            channel.sendChat("❌ 콘텐츠 입장권이 필요합니다.\n- 주간 콘텐츠 입장권\n- 반복 콘텐츠 입장권");
                            return;
                        }
                        
                        // 동일 난이도의 대기 중인 파티 찾기
                        let availableParty = null;
                        for (let partyId in raidParties) {
                            let party = raidParties[partyId];
                            if (party.difficulty == difficulty && party.members.length < 3 && party.phase == 0) {
                                availableParty = party;
                                break;
                            }
                        }
                        
                        // 파티 입장 또는 생성
                        if (availableParty) {
                            // 기존 파티에 입장
                            availableParty.members.push({
                                userId: user.id,
                                name: user.name,
                                power_5man: user.deck_power_5man,
                                power_duo: user.deck_power_duo,
                                power_pure: user.deck_power_pure,
                                isWeekly: hasWeekly,
                                buffs: {
                                    power_100: 10,
                                    power_200: 5,
                                    power_10pct: 3,
                                    power_20pct: 2,
                                    power_50pct: 1
                                },
                                current_power: user.deck_power_5man
                            });
                            
                            // 입장권 소모
                            if (hasWeekly) user.removeItem(weeklyTicketIdx, 1);
                            else user.removeItem(repeatTicketIdx, 1);
                            await user.save();
                            
                            channel.sendChat("✅ " + difficulty + " 난이도 파티에 입장했습니다!\n현재 파티 인원: " + availableParty.members.length + "/3\n\n[ 파티원 ]\n" + availableParty.members.map(m => "- " + m.name + " (5인: " + m.power_5man.toComma2() + " / 듀오: " + m.power_duo.toComma2() + " / 보정: " + m.power_pure.toComma2() + ")").join("\n"));
                            
                            // 파티가 3명이면 자동 시작
                            if (availableParty.members.length == 3) {
                                availableParty.phase = 1;
                                availableParty.startTime = Date.now();
                                availableParty.timeLimit = 10 * 60 * 1000; // 10분
                                availableParty.leader = availableParty.members[0].userId; // 첫 번째 멤버가 공대장
                                availableParty.duoHelperPower = 0; // 듀오공격대 도움전투력
                                availableParty.hiddenUnlockCount = 0; // 히든풀기 가능 횟수
                                availableParty.hiddenFailCount = 0; // 히든풀기 실패 횟수
                                availableParty.leaderSkillCount = 0; // 공대장 스킬 사용 가능 횟수
                                availableParty.gameCleared = false; // 게임동 클리어 여부
                                availableParty.livingCleared = false; // 생활동 클리어 여부
                                availableParty.resetCooldown = null; // 초기화 쿨타임
                                availableParty.memberLocations = {}; // 멤버 위치
                                availableParty.memberPowers = {}; // 멤버 전투력 상태
                                
                                // 각 멤버에게 버프카드 지급 및 초기 상태 설정
                                for (let member of availableParty.members) {
                                    let memberUser = await getTCGUserById(member.userId);
                                    if (memberUser) {
                                        // 기존 버프카드 제거
                                        memberUser.removeItem(35, 999);
                                        memberUser.removeItem(36, 999);
                                        memberUser.removeItem(37, 999);
                                        memberUser.removeItem(38, 999);
                                        memberUser.removeItem(39, 999);
                                        
                                        // 버프카드 지급
                                        memberUser.addItem(35, 10); // 전투력 상승 100
                                        memberUser.addItem(36, 5);  // 전투력 상승 200
                                        memberUser.addItem(37, 3);  // 전투력 상승 10%
                                        memberUser.addItem(38, 2);  // 전투력 상승 20%
                                        memberUser.addItem(39, 1);  // 전투력 상승 50%
                                        await memberUser.save();
                                    }
                                    
                                    // 위치 초기화 (밖)
                                    availableParty.memberLocations[member.userId] = "밖";
                                    
                                    // 전투력 상태 초기화
                                    availableParty.memberPowers[member.userId] = {
                                        original_5man: member.power_5man,
                                        current_5man: member.power_5man,
                                        original_duo: member.power_duo,
                                        current_duo: member.power_duo,
                                        original_pure: member.power_pure,
                                        current_pure: member.power_pure,
                                        buffCardUses: 0
                                    };
                                }
                                
                                channel.sendChat("✅ 파티가 결성되었습니다. 밍닝스플랜 레이드를 시작합니다.\n\n" +
                                    "[ 파티원 ]\n" + availableParty.members.map(m => "- " + m.name + (m.userId == availableParty.leader ? " 👑" : "")).join("\n") + "\n\n" +
                                    "⏳ 제한시간: 10분\n\n" +
                                    "버프카드가 지급되었습니다! 인벤토리를 확인하세요.\n\n" +
                                    "[ 이동 가능 장소 ]\n" +
                                    "- 게임동: /TCGenius 콘텐츠 게임동 입장\n" +
                                    "- 생활동: /TCGenius 콘텐츠 12번방 입장 | /TCGenius 콘텐츠 5번방 입장\n" +
                                    "- 감옥: /TCGenius 콘텐츠 비밀의방 입장 (공대장 전용, 모든 파티원이 밖에 있을 때)");
                            }
                        } else {
                            // 새 파티 생성
                            let partyId = getRandomString(20);
                            raidParties[partyId] = {
                                partyId: partyId,
                                difficulty: difficulty,
                                phase: 0, // 0: 대기중, 1: 진행중
                                members: [{
                                    userId: user.id,
                                    name: user.name,
                                    power_5man: user.deck_power_5man,
                                    power_duo: user.deck_power_duo,
                                    power_pure: user.deck_power_pure,
                                    isWeekly: hasWeekly,
                                    buffs: {
                                        power_100: 10,
                                        power_200: 5,
                                        power_10pct: 3,
                                        power_20pct: 2,
                                        power_50pct: 1
                                    },
                                    current_power: user.deck_power_5man
                                }],
                                createdAt: Date.now()
                            };
                            
                            // 입장권 소모
                            if (hasWeekly) user.removeItem(weeklyTicketIdx, 1);
                            else user.removeItem(repeatTicketIdx, 1);
                            await user.save();
                            
                            channel.sendChat("✅ 새로운 " + difficulty + " 난이도 파티를 생성했습니다!\n현재 파티 인원: 1/3\n\n다른 유저가 입장할 때까지 대기합니다...");
                        }
                        return;
                    }
                    
                    // 콘텐츠 포기
                    if (args[1] == "포기") {
                        let userParty = null;
                        let partyId = null;
                        
                        for (let pid in raidParties) {
                            if (raidParties[pid].members.find(m => m.userId == user.id)) {
                                userParty = raidParties[pid];
                                partyId = pid;
                                break;
                            }
                        }
                        
                        if (!userParty) {
                            channel.sendChat("❌ 참여 중인 파티가 없습니다.");
                            return;
                        }
                        
                        // 파티원 제거
                        let memberName = userParty.members.find(m => m.userId == user.id).name;
                        userParty.members = userParty.members.filter(m => m.userId != user.id);
                        
                        if (userParty.members.length == 0) {
                            // 파티원이 모두 나가면 파티 삭제
                            delete raidParties[partyId];
                            channel.sendChat("✅ 콘텐츠를 포기했습니다. 파티가 해체되었습니다.");
                        } else {
                            // 남은 파티원에게 알림
                            channel.sendChat("⚠️ " + memberName + "님이 파티를 나갔습니다.\n남은 파티원: " + userParty.members.map(m => m.name).join(", "));
                        }
                        return;
                    }
                    
                    // 콘텐츠 상태 확인
                    if (args[1] == "상태") {
                        let userParty = null;
                        
                        for (let pid in raidParties) {
                            if (raidParties[pid].members.find(m => m.userId == user.id)) {
                                userParty = raidParties[pid];
                                break;
                            }
                        }
                        
                        if (!userParty) {
                            channel.sendChat("❌ 참여 중인 파티가 없습니다.");
                            return;
                        }
                        
                        let phaseNames = ["대기 중", "1페이즈", "2페이즈"];
                        let message = "[ 밍닝스플랜 레이드 상태 ]\n\n" +
                                     "난이도: " + userParty.difficulty + "\n" +
                                     "페이즈: " + phaseNames[userParty.phase] + "\n" +
                                     "파티원: " + userParty.members.length + "/3\n\n";
                        
                        message += "[ 파티원 위치 ]\n";
                        userParty.members.forEach(m => {
                            let location = userParty.memberLocations[m.userId] || "밖";
                            message += "- " + m.name + (m.userId == userParty.leader ? " 👑" : "") + ": " + location + "\n";
                        });
                        
                        if (userParty.phase == 1) {
                            message += "\n[ 진행 상황 ]\n";
                            message += "게임동: " + (userParty.gameCleared ? "✅ 클리어" : "⭕ 도전 가능") + "\n";
                            message += "생활동: " + (userParty.livingCleared ? "✅ 클리어" : "⭕ 도전 가능") + "\n";
                            message += "히든풀기 가능 횟수: " + userParty.hiddenUnlockCount + "회\n";
                            message += "듀오공격대 도움전투력: +" + userParty.duoHelperPower.toComma2();
                        }
                        
                        if (userParty.phase >= 1 && userParty.startTime) {
                            let elapsed = Math.floor((Date.now() - userParty.startTime) / 1000);
                            let remaining = Math.max(0, Math.floor(userParty.timeLimit / 1000) - elapsed);
                            message += "\n\n⏰ 남은 시간: " + Math.floor(remaining / 60) + "분 " + (remaining % 60) + "초";
                        }
                        
                        channel.sendChat(message.trim());
                        return;
                    }
                    
                    // 게임동 입장
                    if (args[1] == "게임동" && args[2] == "입장") {
                        let userParty = null;
                        let partyId = null;
                        
                        for (let pid in raidParties) {
                            if (raidParties[pid].members.find(m => m.userId == user.id)) {
                                userParty = raidParties[pid];
                                partyId = pid;
                                break;
                            }
                        }
                        
                        if (!userParty) {
                            channel.sendChat("❌ 참여 중인 파티가 없습니다.");
                            return;
                        }
                        
                        if (userParty.phase != 1) {
                            channel.sendChat("❌ 1페이즈에서만 입장 가능합니다.");
                            return;
                        }
                        
                        if (userParty.gameCleared) {
                            channel.sendChat("❌ 게임동은 이미 클리어되었습니다.");
                            return;
                        }
                        
                        if (userParty.memberLocations[user.id] != "밖") {
                            channel.sendChat("❌ 이미 다른 장소에 있습니다. 먼저 나가주세요.");
                            return;
                        }
                        
                        // 게임동에 이미 다른 파티원이 있는지 확인
                        let gameRoomOccupied = false;
                        for (let memberId in userParty.memberLocations) {
                            if (userParty.memberLocations[memberId] == "게임동") {
                                gameRoomOccupied = true;
                                break;
                            }
                        }
                        
                        if (gameRoomOccupied) {
                            channel.sendChat("❌ 게임동에 이미 다른 파티원이 입장해 있습니다. 해당 파티원이 나갈 때까지 대기해주세요.");
                            return;
                        }
                        
                        userParty.memberLocations[user.id] = "게임동";
                        
                        let games = {
                            "노말": [
                                {name: "바이러스게임", power: 1100, reward: 100},
                                {name: "중간달리기", power: 1200, reward: 1000},
                                {name: "동물원", power: 1300, reward: 3000},
                                {name: "시크릿넘버", power: 1550, reward: 5500},
                                {name: "땅따먹기", power: 1850, reward: 14000},
                                {name: "수식하이로우", power: 2100, reward: 32000}
                            ],
                            "하드": [
                                {name: "바이러스게임", power: 1600, reward: 100},
                                {name: "중간달리기", power: 1800, reward: 1000},
                                {name: "동물원", power: 2050, reward: 3000},
                                {name: "시크릿넘버", power: 2400, reward: 5500},
                                {name: "땅따먹기", power: 2750, reward: 14000},
                                {name: "수식하이로우", power: 3250, reward: 32000}
                            ]
                        };
                        
                        let availableGames = games[userParty.difficulty];
                        let message = "✅ 게임동에 입장했습니다!\n\n";
                        message += "[ 도전 가능한 게임 ]\n";
                        availableGames.forEach(g => {
                            message += "- " + g.name + " (필요: " + g.power.toComma2() + " 5인공격대 파워)\n";
                            message += "  » /TCGenius 콘텐츠 " + g.name + "\n";
                        });
                        message += "\n퇴장: /TCGenius 콘텐츠 나가기";
                        
                        channel.sendChat(message);
                        return;
                    }
                    
                    // 게임동 게임 도전
                    let gameNames = ["바이러스게임", "중간달리기", "동물원", "시크릿넘버", "땅따먹기", "수식하이로우"];
                    if (gameNames.includes(args[1])) {
                        let userParty = null;
                        let partyId = null;
                        
                        for (let pid in raidParties) {
                            if (raidParties[pid].members.find(m => m.userId == user.id)) {
                                userParty = raidParties[pid];
                                partyId = pid;
                                break;
                            }
                        }
                        
                        if (!userParty) {
                            channel.sendChat("❌ 참여 중인 파티가 없습니다.");
                            return;
                        }
                        
                        if (userParty.memberLocations[user.id] != "게임동") {
                            channel.sendChat("❌ 게임동에 입장해야 합니다.");
                            return;
                        }
                        
                        let games = {
                            "노말": {
                                "바이러스게임": {power: 1100, reward: 100},
                                "중간달리기": {power: 1200, reward: 1000},
                                "동물원": {power: 1300, reward: 3000},
                                "시크릿넘버": {power: 1550, reward: 5500},
                                "땅따먹기": {power: 1850, reward: 14000},
                                "수식하이로우": {power: 2100, reward: 32000}
                            },
                            "하드": {
                                "바이러스게임": {power: 1600, reward: 100},
                                "중간달리기": {power: 1800, reward: 1000},
                                "동물원": {power: 2050, reward: 3000},
                                "시크릿넘버": {power: 2400, reward: 5500},
                                "땅따먹기": {power: 2750, reward: 14000},
                                "수식하이로우": {power: 3250, reward: 32000}
                            }
                        };
                        
                        let game = games[userParty.difficulty][args[1]];
                        let memberPower = userParty.memberPowers[user.id];
                        
                        if (memberPower.current_5man >= game.power) {
                            // 성공
                            userParty.gameCleared = true;
                            userParty.duoHelperPower += game.reward;
                            
                            // 게임동에 있는 모든 파티원 강제 퇴장 및 전투력 초기화
                            for (let memberId in userParty.memberLocations) {
                                if (userParty.memberLocations[memberId] == "게임동") {
                                    userParty.memberLocations[memberId] = "밖";
                                    userParty.memberPowers[memberId].current_5man = userParty.memberPowers[memberId].original_5man;
                                    userParty.memberPowers[memberId].current_duo = userParty.memberPowers[memberId].original_duo;
                                    userParty.memberPowers[memberId].current_pure = userParty.memberPowers[memberId].original_pure;
                                    userParty.memberPowers[memberId].buffCardUses = 0;
                                }
                            }
                            
                            channel.sendChat("✅ " + args[1] + " 게임을 클리어했습니다!\n\n" +
                                "듀오공격대 도움전투력 +" + game.reward.toComma2() + "\n" +
                                "현재 듀오공격대 도움전투력: " + userParty.duoHelperPower.toComma2());
                        } else {
                            channel.sendChat("❌ 도전 실패!\n\n" +
                                "필요 전투력: " + game.power.toComma2() + "\n" +
                                "현재 전투력: " + memberPower.current_5man.toComma2() + "\n" +
                                "부족: " + (game.power - memberPower.current_5man).toComma2());
                        }
                        return;
                    }
                    
                    // 생활동 입장 (12번방)
                    if (args[1] == "12번방" && args[2] == "입장") {
                        let userParty = null;
                        
                        for (let pid in raidParties) {
                            if (raidParties[pid].members.find(m => m.userId == user.id)) {
                                userParty = raidParties[pid];
                                break;
                            }
                        }
                        
                        if (!userParty) {
                            channel.sendChat("❌ 참여 중인 파티가 없습니다.");
                            return;
                        }
                        
                        if (userParty.phase != 1) {
                            channel.sendChat("❌ 1페이즈에서만 입장 가능합니다.");
                            return;
                        }
                        
                        if (userParty.livingCleared) {
                            channel.sendChat("❌ 생활동은 이미 클리어되었습니다.");
                            return;
                        }
                        
                        if (userParty.memberLocations[user.id] != "밖") {
                            channel.sendChat("❌ 이미 다른 장소에 있습니다. 먼저 나가주세요.");
                            return;
                        }
                        
                        // 생활동에 이미 다른 파티원이 있는지 확인
                        let livingRoomOccupied = false;
                        for (let memberId in userParty.memberLocations) {
                            if (userParty.memberLocations[memberId].startsWith("생활동")) {
                                livingRoomOccupied = true;
                                break;
                            }
                        }
                        
                        if (livingRoomOccupied) {
                            channel.sendChat("❌ 생활동에 이미 다른 파티원이 입장해 있습니다. 해당 파티원이 나갈 때까지 대기해주세요.");
                            return;
                        }
                        
                        userParty.memberLocations[user.id] = "생활동_12번방";
                        
                        let bossHp = userParty.difficulty == "노말" ? 750 : 1300;
                        let memberPower = userParty.memberPowers[user.id];
                        
                        channel.sendChat("✅ 12번방에 입장했습니다.\n\n" +
                            "[ 보스 ] 넛츠\n" +
                            "체력: " + bossHp.toComma2() + "\n" +
                            "현재 보정공격대 파워: " + memberPower.current_pure.toComma2() + "\n\n" +
                            "⚠️ 버프카드를 1회 이상 사용해야 공격이 가능합니다.\n" +
                            "버프카드 사용 횟수: " + memberPower.buffCardUses + "회\n\n" +
                            "[ /TCGenius 콘텐츠 공격 넛츠 ]");
                        return;
                    }
                    
                    // 생활동 입장 (5번방)
                    if (args[1] == "5번방" && args[2] == "입장") {
                        let userParty = null;
                        
                        for (let pid in raidParties) {
                            if (raidParties[pid].members.find(m => m.userId == user.id)) {
                                userParty = raidParties[pid];
                                break;
                            }
                        }
                        
                        if (!userParty) {
                            channel.sendChat("❌ 참여 중인 파티가 없습니다.");
                            return;
                        }
                        
                        if (userParty.phase != 1) {
                            channel.sendChat("❌ 1페이즈에서만 입장 가능합니다.");
                            return;
                        }
                        
                        if (userParty.livingCleared) {
                            channel.sendChat("❌ 생활동은 이미 클리어되었습니다.");
                            return;
                        }
                        
                        if (userParty.memberLocations[user.id] != "밖") {
                            channel.sendChat("❌ 이미 다른 장소에 있습니다. 먼저 나가주세요.");
                            return;
                        }
                        
                        // 생활동에 이미 다른 파티원이 있는지 확인
                        let livingRoomOccupied = false;
                        for (let memberId in userParty.memberLocations) {
                            if (userParty.memberLocations[memberId].startsWith("생활동")) {
                                livingRoomOccupied = true;
                                break;
                            }
                        }
                        
                        if (livingRoomOccupied) {
                            channel.sendChat("❌ 생활동에 이미 다른 파티원이 입장해 있습니다. 해당 파티원이 나갈 때까지 대기해주세요.");
                            return;
                        }
                        
                        userParty.memberLocations[user.id] = "생활동_5번방";
                        
                        let bossHp = userParty.difficulty == "노말" ? 650 : 1230;
                        let memberPower = userParty.memberPowers[user.id];
                        
                        channel.sendChat("✅ 5번방에 입장했습니다.\n\n" +
                            "[ 보스 ] 월야환담\n" +
                            "체력: " + bossHp.toComma2() + "\n" +
                            "현재 보정공격대 파워: " + memberPower.current_pure.toComma2() + "\n\n" +
                            "⚠️ 버프카드를 2회 이상 사용해야 공격이 가능합니다.\n" +
                            "버프카드 사용 횟수: " + memberPower.buffCardUses + "회\n\n" +
                            "[ /TCGenius 콘텐츠 공격 월야환담 ]");
                        return;
                    }
                    
                    // 생활동 보스 공격
                    if (args[1] == "공격" && (args[2] == "넛츠" || args[2] == "월야환담")) {
                        let userParty = null;
                        
                        for (let pid in raidParties) {
                            if (raidParties[pid].members.find(m => m.userId == user.id)) {
                                userParty = raidParties[pid];
                                break;
                            }
                        }
                        
                        if (!userParty) {
                            channel.sendChat("❌ 참여 중인 파티가 없습니다.");
                            return;
                        }
                        
                        let bossName = args[2];
                        let requiredLocation = bossName == "넛츠" ? "생활동_12번방" : "생활동_5번방";
                        let requiredBuffUses = bossName == "넛츠" ? 1 : 2;
                        
                        if (userParty.memberLocations[user.id] != requiredLocation) {
                            channel.sendChat("❌ 해당 방에 입장해야 합니다.");
                            return;
                        }
                        
                        let memberPower = userParty.memberPowers[user.id];
                        
                        if (memberPower.buffCardUses < requiredBuffUses) {
                            channel.sendChat("❌ 버프카드를 " + requiredBuffUses + "회 이상 사용해야 공격이 가능합니다.\n" +
                                "현재 사용 횟수: " + memberPower.buffCardUses + "회");
                            return;
                        }
                        
                        let bossHp = bossName == "넛츠" ? 
                            (userParty.difficulty == "노말" ? 750 : 1300) :
                            (userParty.difficulty == "노말" ? 650 : 1230);
                        
                        if (memberPower.current_pure >= bossHp) {
                            // 성공
                            userParty.livingCleared = true;
                            userParty.hiddenUnlockCount++;
                            
                            // 생활동에 있는 모든 파티원 강제 퇴장 및 전투력 초기화
                            for (let memberId in userParty.memberLocations) {
                                if (userParty.memberLocations[memberId].startsWith("생활동")) {
                                    userParty.memberLocations[memberId] = "밖";
                                    userParty.memberPowers[memberId].current_5man = userParty.memberPowers[memberId].original_5man;
                                    userParty.memberPowers[memberId].current_duo = userParty.memberPowers[memberId].original_duo;
                                    userParty.memberPowers[memberId].current_pure = userParty.memberPowers[memberId].original_pure;
                                    userParty.memberPowers[memberId].buffCardUses = 0;
                                }
                            }
                            
                            channel.sendChat("✅ " + bossName + " 토벌에 성공했습니다!\n\n" +
                                "히든풀기 가능 횟수 +1회\n" +
                                "현재 히든풀기 가능 횟수: " + userParty.hiddenUnlockCount + "회");
                        } else {
                            channel.sendChat("❌ 공격 실패!\n\n" +
                                "필요 전투력: " + bossHp.toComma2() + "\n" +
                                "현재 전투력: " + memberPower.current_pure.toComma2() + "\n" +
                                "부족: " + (bossHp - memberPower.current_pure).toComma2());
                        }
                        return;
                    }
                    
                    // 나가기
                    if (args[1] == "나가기") {
                        let userParty = null;
                        
                        for (let pid in raidParties) {
                            if (raidParties[pid].members.find(m => m.userId == user.id)) {
                                userParty = raidParties[pid];
                                break;
                            }
                        }
                        
                        if (!userParty) {
                            channel.sendChat("❌ 참여 중인 파티가 없습니다.");
                            return;
                        }
                        
                        if (userParty.memberLocations[user.id] == "밖") {
                            channel.sendChat("❌ 이미 밖에 있습니다.");
                            return;
                        }
                        
                        // 전투력 초기화
                        userParty.memberPowers[user.id].current_5man = userParty.memberPowers[user.id].original_5man;
                        userParty.memberPowers[user.id].current_duo = userParty.memberPowers[user.id].original_duo;
                        userParty.memberPowers[user.id].current_pure = userParty.memberPowers[user.id].original_pure;
                        userParty.memberPowers[user.id].buffCardUses = 0;
                        
                        // 2페이즈 비밀의방내부에서는 퇴장 불가
                        if (userParty.phase == 2 && userParty.memberLocations[user.id] == "비밀의방내부") {
                            channel.sendChat("❌ 비밀의방내부에서는 퇴장할 수 없습니다.");
                            return;
                        }
                        let prevLocation = userParty.memberLocations[user.id];
                        userParty.memberLocations[user.id] = "밖";
                        
                        channel.sendChat("✅ " + prevLocation + "에서 나왔습니다.\n전투력이 초기화되었습니다.");
                        return;
                    }
                    
                    // 감옥 (비밀의방) 입장
                    if (args[1] == "비밀의방" && args[2] == "입장") {
                        let userParty = null;
                        
                        for (let pid in raidParties) {
                            if (raidParties[pid].members.find(m => m.userId == user.id)) {
                                userParty = raidParties[pid];
                                break;
                            }
                        }
                        
                        if (!userParty) {
                            channel.sendChat("❌ 참여 중인 파티가 없습니다.");
                            return;
                        }
                        
                        if (userParty.phase != 1) {
                            channel.sendChat("❌ 1페이즈에서만 입장 가능합니다.");
                            return;
                        }
                        
                        // 공대장 확인
                        if (user.id != userParty.leader) {
                            channel.sendChat("❌ 비밀의방은 공대장만 입장할 수 있습니다.");
                            return;
                        }
                        
                        // 모든 파티원이 밖에 있는지 확인
                        let allOutside = true;
                        for (let memberId in userParty.memberLocations) {
                            if (userParty.memberLocations[memberId] != "밖") {
                                allOutside = false;
                                break;
                            }
                        }
                        
                        if (!allOutside) {
                            channel.sendChat("❌ 모든 파티원이 밖에 있을 때만 입장할 수 있습니다.");
                            return;
                        }
                        
                        // 히든풀기 가능 횟수 확인
                        if (userParty.hiddenUnlockCount <= 0) {
                            channel.sendChat("❌ 히든풀기 가능 횟수가 없습니다.\n생활동을 클리어하여 히든풀기 가능 횟수를 얻으세요.");
                            return;
                        }
                        
                        userParty.memberLocations[user.id] = "감옥_비밀의방";
                        
                        let memberPower = userParty.memberPowers[user.id];
                        let totalDuoPower = memberPower.current_duo + userParty.duoHelperPower;
                        let successDenominator = userParty.difficulty == "노말" ? 40000 : (userParty.difficulty == "하드" ? 100000 : 200000);
                        let successRate = (totalDuoPower / successDenominator * 100).toFixed(2);
                        
                        channel.sendChat("✅ 비밀의방에 입장했습니다!\n\n" +
                            "[ 히든풀기 ]\n" +
                            "듀오공격대 전투력: " + memberPower.current_duo.toComma2() + "\n" +
                            "듀오공격대 도움전투력: +" + userParty.duoHelperPower.toComma2() + "\n" +
                            "총 전투력: " + totalDuoPower.toComma2() + "\n\n" +
                            "성공 확률: " + successRate + "%\n" +
                            "남은 히든풀기 가능 횟수: " + userParty.hiddenUnlockCount + "회\n\n" +
                            "히든풀기 시도: /TCGenius 콘텐츠 히든풀기\n" +
                            "퇴장: /TCGenius 콘텐츠 나가기");
                        return;
                    }
                    
                    // 히든풀기
                    if (args[1] == "히든풀기") {
                        let userParty = null;
                        
                        for (let pid in raidParties) {
                            if (raidParties[pid].members.find(m => m.userId == user.id)) {
                                userParty = raidParties[pid];
                                break;
                            }
                        }
                        
                        if (!userParty) {
                            channel.sendChat("❌ 참여 중인 파티가 없습니다.");
                            return;
                        }
                        
                        if (userParty.memberLocations[user.id] != "감옥_비밀의방") {
                            channel.sendChat("❌ 비밀의방에 입장해야 합니다.");
                            return;
                        }
                        
                        if (userParty.hiddenUnlockCount <= 0) {
                            channel.sendChat("❌ 히든풀기 가능 횟수가 없습니다.");
                            return;
                        }
                        
                        let memberPower = userParty.memberPowers[user.id];
                        let totalDuoPower = memberPower.current_duo + userParty.duoHelperPower;
                        let successDenominator = userParty.difficulty == "노말" ? 40000 : (userParty.difficulty == "하드" ? 100000 : 200000);
                        let successRate = totalDuoPower / successDenominator;
                        
                        userParty.hiddenUnlockCount--;
                        
                        let r = Math.random();
                        if (r < successRate) {
                            // 성공 - 2페이즈 진입
                            userParty.phase = 2;
                            userParty.startTime = Date.now();
                            userParty.timeLimit = 10 * 60 * 1000; // 10분
                            // 2페이즈 상태 초기화
                            userParty.phase2 = userParty.phase2 || {};
                            // 데빌밍닝 체력/방어력/공대장 고정 전투력/공대장스킬 사용 횟수/체력 경고 플래그
                            let devilMaxHp = userParty.difficulty == "노말" ? 30000 : (userParty.difficulty == "하드" ? 80000 : 110000);
                            let devilDef = userParty.difficulty == "노말" ? 70 : (userParty.difficulty == "하드" ? 100 : 110);
                            userParty.phase2.devilHp = devilMaxHp;
                            userParty.phase2.devilMaxHp = devilMaxHp;
                            userParty.phase2.devilDef = devilDef;
                            userParty.phase2.leaderFixed5man = null;
                            userParty.phase2.leaderSkillUses = 0;
                            userParty.phase2.warn80 = false;
                            userParty.phase2.warn40 = false;
                            // 포커방/흐음 방 체력 (진입 난이도별 초기값)
                            let pokerBase = userParty.difficulty == "노말" ? 300 : 600;
                            let hheumBase = userParty.difficulty == "노말" ? 500 : 750;
                            userParty.phase2.pokerHp = pokerBase;
                            userParty.phase2.hheumHp = hheumBase;
                            
                            // 모든 파티원 위치 초기화 및 전투력 초기화
                            for (let memberId in userParty.memberLocations) {
                                userParty.memberLocations[memberId] = "밖";
                                userParty.memberPowers[memberId].current_5man = userParty.memberPowers[memberId].original_5man;
                                userParty.memberPowers[memberId].current_duo = userParty.memberPowers[memberId].original_duo;
                                userParty.memberPowers[memberId].current_pure = userParty.memberPowers[memberId].original_pure;
                                userParty.memberPowers[memberId].buffCardUses = 0;
                            }
                            
                            // 버프카드 리필
                            for (let member of userParty.members) {
                                let memberUser = await getTCGUserById(member.userId);
                                if (memberUser) {
                                    memberUser.removeItem(35, 999);
                                    memberUser.removeItem(36, 999);
                                    memberUser.removeItem(37, 999);
                                    memberUser.removeItem(38, 999);
                                    memberUser.removeItem(39, 999);
                                    
                                    memberUser.addItem(35, 10);
                                    memberUser.addItem(36, 5);
                                    memberUser.addItem(37, 3);
                                    memberUser.addItem(38, 2);
                                    memberUser.addItem(39, 1);
                                    await memberUser.save();
                                }
                            }
                            
                            channel.sendChat("✅ 히든풀기에 성공했습니다!\n\n" +
                                "2페이즈에 진입합니다.\n\n" +
                                "제한시간: 10분\n" +
                                "버프카드가 리필되었습니다!\n\n" +
                                "[ 이동 가능 장소 ]\n" +
                                "- 비밀의방내부: /TCGenius 콘텐츠 비밀의방내부 입장 (공대장 전용)\n" +
                                "- 포커방: /TCGenius 콘텐츠 포커방 입장 (듀오공격대)\n" +
                                "- 비밀의방문앞: /TCGenius 콘텐츠 흐음 입장 (보정공격대)");
                        } else {
                            // 실패
                            userParty.hiddenFailCount++;
                            
                            if (userParty.hiddenFailCount >= 3) {
                                // 3회 실패 - 게임동 재활성화
                                userParty.gameCleared = false;
                                channel.sendChat("❌ 히든풀기 실패! (실패 " + userParty.hiddenFailCount + "회)\n\n" +
                                    "히든풀기에 3회 실패하여 게임동이 재활성화되었습니다!");
                            } else {
                                // 생활동 재활성화
                                userParty.livingCleared = false;
                                channel.sendChat("❌ 히든풀기 실패! (실패 " + userParty.hiddenFailCount + "회)\n\n" +
                                    "생활동이 재활성화되었습니다!\n" +
                                    "남은 히든풀기 가능 횟수: " + userParty.hiddenUnlockCount + "회");
                            }
                            
                            // 전투력 초기화 및 퇴장
                            userParty.memberPowers[user.id].current_5man = userParty.memberPowers[user.id].original_5man;
                            userParty.memberPowers[user.id].current_duo = userParty.memberPowers[user.id].original_duo;
                            userParty.memberPowers[user.id].current_pure = userParty.memberPowers[user.id].original_pure;
                            userParty.memberPowers[user.id].buffCardUses = 0;
                            userParty.memberLocations[user.id] = "밖";
                        }
                        return;
                    }
                    
                    // 2페이즈: 비밀의방내부 입장 (공대장 전용, 전투력 고정)
                    if (args[1] == "비밀의방내부" && args[2] == "입장") {
                        let userParty = null;
                        for (let pid in raidParties) {
                            if (raidParties[pid].members.find(m => m.userId == user.id)) {
                                userParty = raidParties[pid];
                                break;
                            }
                        }
                        if (!userParty) { channel.sendChat("❌ 참여 중인 파티가 없습니다."); return; }
                        if (userParty.phase != 2) { channel.sendChat("❌ 2페이즈에서만 입장 가능합니다."); return; }
                        if (user.id != userParty.leader) { channel.sendChat("❌ 비밀의방내부는 공대장만 입장할 수 있습니다."); return; }
                        if (userParty.memberLocations[user.id] != "밖") { channel.sendChat("❌ 이미 다른 장소에 있습니다. 먼저 나가주세요."); return; }
                        // 이미 누가 안에 있는지 확인 (공대장 1명만)
                        for (let memberId in userParty.memberLocations) {
                            if (userParty.memberLocations[memberId] == "비밀의방내부") {
                                channel.sendChat("❌ 비밀의방내부에 이미 공대장이 입장해 있습니다.");
                                return;
                            }
                        }
                        userParty.memberLocations[user.id] = "비밀의방내부";
                        // 입장 시 공대장 전투력 고정 (5인 공격대 현재 전투력)
                        if (!userParty.phase2) userParty.phase2 = {};
                        let leaderPower = userParty.memberPowers[user.id].current_5man;
                        userParty.phase2.leaderFixed5man = leaderPower;
                        channel.sendChat("✅ 비밀의방내부에 입장했습니다.\n공대장 전투력이 고정되었습니다: " + leaderPower.toComma2());
                        return;
                    }
                    
                    // 2페이즈: 포커방 (듀오공격대)
                    if (args[1] == "포커방") {
                        let userParty = null;
                        for (let pid in raidParties) {
                            if (raidParties[pid].members.find(m => m.userId == user.id)) { userParty = raidParties[pid]; break; }
                        }
                        if (!userParty) { channel.sendChat("❌ 참여 중인 파티가 없습니다."); return; }
                        if (userParty.phase != 2) { channel.sendChat("❌ 2페이즈에서만 이용 가능합니다."); return; }
                        if (!userParty.phase2) { channel.sendChat("❌ 아직 준비되지 않았습니다."); return; }
                        let pokerBase = userParty.difficulty == "노말" ? 300 : 600;
                        // 입장
                        if (args[2] == "입장") {
                            if (userParty.memberLocations[user.id] != "밖") { channel.sendChat("❌ 이미 다른 장소에 있습니다. 먼저 나가주세요."); return; }
                            // 한 명만 입장 가능
                            for (let memberId in userParty.memberLocations) {
                                if (userParty.memberLocations[memberId] == "포커방") { channel.sendChat("❌ 포커방에 이미 다른 파티원이 입장해 있습니다."); return; }
                            }
                            userParty.memberLocations[user.id] = "포커방";
                            channel.sendChat("✅ 포커방에 입장했습니다.\n안성재 체력: " + userParty.phase2.pokerHp.toComma2() + " (기본: " + pokerBase.toComma2() + ")\n\n공격: /TCGenius 콘텐츠 포커방 공격\n퇴장: /TCGenius 콘텐츠 나가기");
                            return;
                        }
                        // 공격
                        if (args[2] == "공격") {
                            if (userParty.memberLocations[user.id] != "포커방") { channel.sendChat("❌ 포커방에 입장한 상태에서만 공격할 수 있습니다."); return; }
                            // 공격 판정: 듀오 현재 전투력으로 방 체력 감소
                            let duo = userParty.memberPowers[user.id].current_duo;
                            if (duo <= 0) { channel.sendChat("❌ 전투력이 부족합니다."); return; }
                            userParty.phase2.pokerHp -= Math.ceil(duo);
                            if (userParty.phase2.pokerHp > 0) {
                                channel.sendChat("🗡️ 공격! 안성재 남은 체력: " + userParty.phase2.pokerHp.toComma2());
                            } else {
                                // 클리어: 공대장 전투력의 2배로 데빌밍닝 공격, 포커방 체력 증가
                                userParty.phase2.pokerHp = pokerBase + (userParty.difficulty == "노말" ? 50 : 100);
                                // 데빌 피해 계산 (방어력 적용): 2배 공대장 고정전투력
                                let leaderAtk = (userParty.phase2.leaderFixed5man || 0) * 2;
                                let defRate = Math.max(0, userParty.phase2.devilDef) / 100;
                                let damage = Math.max(0, Math.floor(leaderAtk * (1 - defRate)));
                                userParty.phase2.devilHp = Math.max(0, userParty.phase2.devilHp - damage);
                                // 체력 경고 체크(80%, 40%)
                                let hpRate = userParty.phase2.devilHp / userParty.phase2.devilMaxHp;
                                let messages = [];
                                messages.push("✅ 안성재를 클리어했습니다! 데빌밍닝에게 " + damage.toComma2() + " 피해를 주었습니다.");
                                if (!userParty.phase2.warn80 && hpRate <= 0.8) { userParty.phase2.warn80 = true; userParty.phase2.leaderSkillUses++; messages.push("⚠️ 데빌밍닝 체력 80% 돌파! 공대장스킬 +1"); }
                                if (!userParty.phase2.warn40 && hpRate <= 0.4) { userParty.phase2.warn40 = true; userParty.phase2.leaderSkillUses++; messages.push("⚠️ 데빌밍닝 체력 40% 돌파! 공대장스킬 +1"); }
                                // 보스 사망 체크
                                if (userParty.phase2.devilHp <= 0) {
                                    messages.push("🎉 데빌밍닝 처치! 레이드 클리어!");
                                    // 종료 처리 (간단히 파티 삭제)
                                    delete raidParties[userParty.id];
                                } else {
                                    messages.push("데빌밍닝 남은 체력: " + userParty.phase2.devilHp.toComma2());
                                }
                                channel.sendChat(messages.join("\n"));
                                // 공격자 퇴장 및 초기화
                                userParty.memberLocations[user.id] = "밖";
                                userParty.memberPowers[user.id].current_duo = userParty.memberPowers[user.id].original_duo;
                                userParty.memberPowers[user.id].buffCardUses = 0;
                            }
                            return;
                        }
                    }
                    
                    // 2페이즈: 비밀의방문앞(흐음) (보정공격대)
                    if (args[1] == "흐음") {
                        let userParty = null;
                        for (let pid in raidParties) {
                            if (raidParties[pid].members.find(m => m.userId == user.id)) { userParty = raidParties[pid]; break; }
                        }
                        if (!userParty) { channel.sendChat("❌ 참여 중인 파티가 없습니다."); return; }
                        if (userParty.phase != 2) { channel.sendChat("❌ 2페이즈에서만 이용 가능합니다."); return; }
                        if (!userParty.phase2) { channel.sendChat("❌ 아직 준비되지 않았습니다."); return; }
                        let hheumBase = userParty.difficulty == "노말" ? 500 : 750;
                        // 입장
                        if (args[2] == "입장") {
                            if (userParty.memberLocations[user.id] != "밖") { channel.sendChat("❌ 이미 다른 장소에 있습니다. 먼저 나가주세요."); return; }
                            // 한 명만 입장 가능
                            for (let memberId in userParty.memberLocations) {
                                if (userParty.memberLocations[memberId] == "흐음") { channel.sendChat("❌ 비밀의방문앞에 이미 다른 파티원이 입장해 있습니다."); return; }
                            }
                            userParty.memberLocations[user.id] = "흐음";
                            channel.sendChat("✅ 비밀의방문앞(흐음)에 입장했습니다.\n흐음 체력: " + userParty.phase2.hheumHp.toComma2() + " (기본: " + hheumBase.toComma2() + ")\n\n공격: /TCGenius 콘텐츠 흐음 공격\n퇴장: /TCGenius 콘텐츠 나가기");
                            return;
                        }
                        // 공격
                        if (args[2] == "공격") {
                            if (userParty.memberLocations[user.id] != "흐음") { channel.sendChat("❌ 비밀의방문앞에 입장한 상태에서만 공격할 수 있습니다."); return; }
                            let pure = userParty.memberPowers[user.id].current_pure;
                            if (pure <= 0) { channel.sendChat("❌ 전투력이 부족합니다."); return; }
                            userParty.phase2.hheumHp -= Math.ceil(pure);
                            if (userParty.phase2.hheumHp > 0) {
                                channel.sendChat("🗡️ 공격! 흐음 남은 체력: " + userParty.phase2.hheumHp.toComma2());
                            } else {
                                // 클리어: 방어력 10 감소 후 공대장 전투력으로 공격
                                userParty.phase2.hheumHp = hheumBase + (userParty.difficulty == "노말" ? 50 : 100);
                                userParty.phase2.devilDef = Math.max(0, userParty.phase2.devilDef - 10);
                                let leaderAtk = (userParty.phase2.leaderFixed5man || 0);
                                let defRate = Math.max(0, userParty.phase2.devilDef) / 100;
                                let damage = Math.max(0, Math.floor(leaderAtk * (1 - defRate)));
                                userParty.phase2.devilHp = Math.max(0, userParty.phase2.devilHp - damage);
                                // 체력 경고 체크(80%, 40%)
                                let hpRate = userParty.phase2.devilHp / userParty.phase2.devilMaxHp;
                                let messages = [];
                                messages.push("✅ 흐음을 클리어했습니다! 데빌밍닝에게 " + damage.toComma2() + " 피해를 주었습니다. (현재 방어력: " + userParty.phase2.devilDef + ")");
                                if (!userParty.phase2.warn80 && hpRate <= 0.8) { userParty.phase2.warn80 = true; userParty.phase2.leaderSkillUses++; messages.push("⚠️ 데빌밍닝 체력 80% 돌파! 공대장스킬 +1"); }
                                if (!userParty.phase2.warn40 && hpRate <= 0.4) { userParty.phase2.warn40 = true; userParty.phase2.leaderSkillUses++; messages.push("⚠️ 데빌밍닝 체력 40% 돌파! 공대장스킬 +1"); }
                                if (userParty.phase2.devilHp <= 0) {
                                    messages.push("🎉 데빌밍닝 처치! 레이드 클리어!");
                                    delete raidParties[userParty.id];
                                } else {
                                    messages.push("데빌밍닝 남은 체력: " + userParty.phase2.devilHp.toComma2());
                                }
                                channel.sendChat(messages.join("\n"));
                                // 공격자 퇴장 및 초기화
                                userParty.memberLocations[user.id] = "밖";
                                userParty.memberPowers[user.id].current_pure = userParty.memberPowers[user.id].original_pure;
                                userParty.memberPowers[user.id].buffCardUses = 0;
                            }
                            return;
                        }
                    }
                    
                    // 2페이즈: 공대장스킬 (비밀의방내부에서 사용)
                    if (args[1] == "공대장스킬") {
                        let userParty = null;
                        for (let pid in raidParties) {
                            if (raidParties[pid].members.find(m => m.userId == user.id)) { userParty = raidParties[pid]; break; }
                        }
                        if (!userParty) { channel.sendChat("❌ 참여 중인 파티가 없습니다."); return; }
                        if (userParty.phase != 2) { channel.sendChat("❌ 2페이즈에서만 사용 가능합니다."); return; }
                        if (user.id != userParty.leader) { channel.sendChat("❌ 공대장만 사용할 수 있습니다."); return; }
                        if (userParty.memberLocations[user.id] != "비밀의방내부") { channel.sendChat("❌ 비밀의방내부에서만 사용할 수 있습니다."); return; }
                        if (!userParty.phase2 || userParty.phase2.leaderSkillUses <= 0) { channel.sendChat("❌ 사용 가능한 공대장스킬이 없습니다."); return; }
                        userParty.phase2.leaderSkillUses--;
                        // 버프카드 리필 + 포커/흐음 체력 초기화
                        let pokerBase = userParty.difficulty == "노말" ? 300 : 600;
                        let hheumBase = userParty.difficulty == "노말" ? 500 : 750;
                        userParty.phase2.pokerHp = pokerBase;
                        userParty.phase2.hheumHp = hheumBase;
                        for (let member of userParty.members) {
                            let memberUser = await getTCGUserById(member.userId);
                            if (memberUser) {
                                memberUser.removeItem(35, 999);
                                memberUser.removeItem(36, 999);
                                memberUser.removeItem(37, 999);
                                memberUser.removeItem(38, 999);
                                memberUser.removeItem(39, 999);
                                memberUser.addItem(35, 10);
                                memberUser.addItem(36, 5);
                                memberUser.addItem(37, 3);
                                memberUser.addItem(38, 2);
                                memberUser.addItem(39, 1);
                                await memberUser.save();
                            }
                        }
                        channel.sendChat("✨ 공대장스킬 발동!\n- 버프카드가 리필되었습니다.\n- 안성재/흐음 체력이 초기화되었습니다.\n남은 사용 가능 횟수: " + userParty.phase2.leaderSkillUses);
                        return;
                    }
                }

                // 거래소
                if (args[0] == "거래소") {
                    if (args[1] == "아이템") {
                        let itemTrade = JSON.parse(read("DB/TCG/trading.json")).filter(t => t.type == "아이템");
                        let res = [];
                        itemTrade.forEach(trade => {
                            if (res.find(r => r.name == trade.name)) {
                                res.find(r => r.name == trade.name).trades.push(trade);
                            } else {
                                res.push({
                                    name: trade.name,
                                    trades: [trade]
                                });
                            }
                        });
                        if (res.length) {
                            res = res.map(r => {
                                let lowest_price = r.trades.sort((a,b) => {return a.price - b.price})[0].price;
                                let all_count = r.trades.reduce((cur, acc) => cur + acc.count, 0);
                                return "« " + r.name + " »\n>> 남은 물량: " + all_count.toComma2() + "개\n>> 최저가: " + lowest_price.toComma2() + "가넷";
                            });
                            channel.sendChat("[ 아이템 거래소 ]\n" + VIEWMORE + "\n" + res.join("\n\n"));
                        } else {
                            channel.sendChat("[ 아이템 거래소 ]\n\n거래중인 물품이 없습니다.");
                        }
                    } else if (args[1] == "카드") {
                        let cardTrade = JSON.parse(read("DB/TCG/trading.json")).filter(t => t.type == "카드").sort((a,b) => { return a.id - b.id });
                        let res = [];
                        let cards = JSON.parse(read("DB/TCG/card.json"));
                        cardTrade.forEach((trade, i) => {
                            trade.deepMerge(cards[trade.id]);
                            res.push("[" + (trade.isKeep ? "유지(번호:" + (i + 1) + ")" : "명함") + "] " + printCard(trade) + (!trade.isKeep && trade.count > 1 ? " x" + trade.count.toComma2() : "") + "\n>> " + trade.price.toComma2() + "가넷");
                        });
                        channel.sendChat("[ 카드 거래소 ]\n" + (res.length ? VIEWMORE + "\n" + res.join("\n\n") : "\n거래중인 물품이 없습니다."));
                    } else if (args[1] == "아티팩트") {
                        let artifactTrade = JSON.parse(read("DB/TCG/trading.json")).filter(t => t.type == "아티팩트");
                        let res = [];
                        artifactTrade.forEach(trade => {
                            if (res.find(r => r.name == "아티팩트(" + trade.abilities.slice(0,2).join("/") + ")")) {
                                res.find(r => r.name == "아티팩트(" + trade.abilities.slice(0,2).join("/") + ")").trades.push(trade);
                            } else {
                                res.push({
                                    name: "아티팩트(" + trade.abilities.slice(0,2).join("/") + ")",
                                    trades: [trade]
                                });
                            }
                        });
                        if (res.length) {
                            res = res.map(r => {
                                let lowest_price = r.trades.sort((a,b) => {return a.price - b.price})[0].price;
                                let all_count = r.trades.reduce((cur, acc) => cur + acc.count, 0);
                                return "« " + r.name + " »\n>> 남은 물량: " + all_count.toComma2() + "개\n>> 최저가: " + lowest_price.toComma2() + "가넷";
                            });
                            channel.sendChat("[ 아티팩트 거래소 ]\n" + VIEWMORE + "\n" + res.join("\n\n"));
                        } else {
                            channel.sendChat("[ 아티팩트 거래소 ]\n\n거래중인 물품이 없습니다.");
                        }
                    } else if (args[1] == "시세") {
                        let trading = JSON.parse(read("DB/TCG/trading.json"));
                        let cards = JSON.parse(read("DB/TCG/card.json"));
                        let target = cmd.substr(cmd.split(" ")[0].length + 8);
                        let itemTrade = trading.filter(t => t.type == "아이템" && t.name == target).sort((a,b)=>{return a.price-b.price});
                        let cardTrade = trading.filter(t => t.type == "카드" && !t.isKeep && (cards[t.id] && "[" + cards[t.id].title + "]" + cards[t.id].name == target)).sort((a,b)=>{return a.price-b.price});
                        let artiTrade = trading.filter(t => t.type == "아티팩트" && target == "아티팩트(" + t.abilities.slice(0,2).join("/") + ")").sort((a,b)=>{return a.price-b.price});
                        if (itemTrade.length) {
                            let all_count = itemTrade.reduce((cur,acc) => cur + acc.count, 0);
                            channel.sendChat("« " + target + " »\n➭ 남은 물량 : " + all_count.toComma2() + "개\n" + itemTrade.map(t => "› " + t.price.toComma2() + "가넷 x" + t.count.toComma2()).join("\n"));
                        } else if (cardTrade.length) {
                            let all_count = cardTrade.reduce((cur,acc) => cur + acc.count, 0);
                            channel.sendChat("« " + target + " »\n➭ 남은 물량 : " + all_count.toComma2() + "개\n" + cardTrade.map(t => "› " + t.price.toComma2() + "가넷 x" + t.count.toComma2()).join("\n"));
                        } else if (artiTrade.length) {
                            let all_count = artiTrade.reduce((cur,acc) => cur + acc.count, 0);
                            channel.sendChat("« " + target + " »\n➭ 남은 물량 : " + all_count.toComma2() + "개\n" + artiTrade.map(t => "› " + t.price.toComma2() + "가넷 x" + t.count.toComma2()).join("\n"));
                        } else {
                            channel.sendChat("❌ 등록되지 않은 물품입니다.");
                        }
                    } else if (args[1] == "판매목록") {
                        let myTrade = JSON.parse(read("DB/TCG/trading.json")).filter(t => t.sellerId == user.id);
                        let cards = JSON.parse(read("DB/TCG/card.json"));
                        myTrade = myTrade.map((t, i) => {
                            if (t.type == "아이템") return "[" + (i + 1) + "] « " + t.name + " »\n>> 수량: " + t.count.toComma2() + "개\n>> 가격: " + t.price.toComma2() + "가넷";
                            else if (t.type == "카드") {
                                t.deepMerge(cards[t.id]);
                                return "[" + (i + 1) + "] [" + (t.isKeep ? "유지" : "명함") + "] " + printCard(t) + "\n>> 수량: " + t.count.toComma2() + "개\n>> 가격: " + t.price.toComma2() + "가넷";
                            } else if (t.type == "아티팩트") return "[" + (i + 1) + "] « 아티팩트(" + t.abilities.slice(0, 2).join("/") + ") »\n>> 수량: " + t.count.toComma2() + "개\n>> 가격: " + t.price.toComma2() + "가넷";
                        });
                        channel.sendChat("[ 내 거래소 판매 목록 ]\n" + (myTrade.length ? VIEWMORE + "\n" + myTrade.join("\n\n") : "\n판매중인 물품이 없습니다."));
                    } else if (args[1] == "등록") {
                        let trading = JSON.parse(read("DB/TCG/trading.json"));
                        let matched;
                        let fullCmd = cmd.substr(cmd.split(" ")[0].length + 1);
                        if (args[2] == "아이템") {
                            if ((matched = fullCmd.match(/거래소 등록 아이템 (.+?) (\d+) (\d+)$/)) == null) {
                                channel.sendChat("❌ 잘못된 입력입니다.\n[ /TCGenius 거래소 등록 아이템 [품목] [가격] [수량] ]");
                            } else {
                                let canTrades = ["한계돌파석","보호자물쇠","강화자물쇠","축복자물쇠","경험치300물약","강렬한 기운","영롱한 기운","깔끔한 기운","희미한 주사위","빛나는 주사위","찬란한 주사위","운명 주사위","심판 주사위"];
                                if (!canTrades.includes(matched[1])) {
                                    channel.sendChat("❌ 거래 가능 아이템이 아닙니다.\n\n[ 거래 가능 아이템]\n" + canTrades.map(c => "› " + c).join("\n"));
                                    return;
                                }
                                let items = JSON.parse(read("DB/TCG/item.json"));
                                let itemIdx = items.findIndex(i => i.name == matched[1]);
                                if (itemIdx == -1) {
                                    channel.sendChat("❌ 존재하지 않는 아이템입니다.");
                                    return;
                                }
                                let userItem = user.inventory.item.find(i => i.id == itemIdx) || {count: 0};
                                let price = Number(matched[2]);
                                let num = Number(matched[3]);
                                let vip_sale = [0, 0, 0, 0.0025, 0.005, 0.01, 0.01, 0.015, 0.015, 0.02, 0.02, 0.025];
                                let fee = 0.05 - vip_sale[user.vip];
                                if (isNaN(price) || price % 1 != 0 || price < 1) {
                                    channel.sendChat("❌ 가격을 제대로 입력해주세요.");
                                    return;
                                }
                                if (isNaN(num) || num % 1 != 0 || num < 1) {
                                    channel.sendChat("❌ 수량을 제대로 입력해주세요.");
                                    return;
                                }
                                if (userItem.count < num) {
                                    channel.sendChat("❌ 보유 수량이 부족합니다.\n보유 수량: " + userItem.count.toComma2() + "개");
                                    return;
                                }
                                if (user.garnet < Math.round(price * num * fee)) {
                                    channel.sendChat("❌ 수수료로 지불할 가넷이 부족합니다.\n필요 가넷: " + user.garnet.toComma2() + "/" + Math.round((price * num * fee)).toComma2());
                                    return;
                                }
                                trading.push({
                                    type: "아이템",
                                    name: matched[1],
                                    sellerId: user.id,
                                    count: num,
                                    price: price
                                });
                                user.removeItem(itemIdx, num);
                                user.garnet -= Math.round(price * num * fee);
                                await user.save();
                                save("DB/TCG/trading.json", JSON.stringify(trading, null, 4));
                                channel.sendChat("✅ 거래소에 '" + matched[1] + "' 아이템을 " + price.toComma2() + "가넷에 " + num.toComma2() + "개 등록했습니다.\n💸 수수료: " + Math.round(price * num * fee).toComma2() + "가넷 (" + (fee * 100) + "%)");
                            }
                        } else if (args[2] == "카드명함") {
                            if ((matched = fullCmd.match(/거래소 등록 카드명함 \[(.+?)\](.+?) (\d+) (\d+)$/)) == null) {
                                channel.sendChat("❌ 잘못된 입력입니다.\n[ /TCGenius 거래소 등록 카드명함 [카드] [가격] [수량] ]");
                            } else {
                                let cards = JSON.parse(read("DB/TCG/card.json"));
                                let cardIdx = cards.findIndex(c => c.title == matched[1] && c.name == matched[2]);
                                if (cardIdx == -1) {
                                    channel.sendChat("❌ 존재하지 않는 카드입니다.");
                                    return;
                                }
                                let userCard = user.inventory.card.find(c => c.id == cardIdx) || {count: 0};
                                let price = Number(matched[3]);
                                let num = Number(matched[4]);
                                if (isNaN(price) || price % 1 != 0 || price < 1) {
                                    channel.sendChat("❌ 가격을 제대로 입력해주세요.");
                                    return;
                                }
                                if (isNaN(num) || num % 1 != 0 || num < 1) {
                                    channel.sendChat("❌ 수량을 제대로 입력해주세요.");
                                    return;
                                }
                                if (userCard.count < num) {
                                    channel.sendChat("❌ 보유 수량이 부족합니다.\n보유 수량: " + userCard.count.toComma2() + "개");
                                    return;
                                }
                                if (user.garnet < Math.round(price * num * 0.05)) {
                                    channel.sendChat("❌ 수수료로 지불할 가넷이 부족합니다.\n필요 가넷: " + user.garnet.toComma2() + "/" + Math.round((price * num * 0.05)).toComma2());
                                    return;
                                }
                                trading.push({
                                    type: "카드",
                                    id: cardIdx,
                                    sellerId: user.id,
                                    isKeep: false,
                                    count: num,
                                    price: price
                                });
                                user.removeCard(cardIdx, num);
                                user.garnet -= Math.round(price * num * 0.05);
                                await user.save();
                                save("DB/TCG/trading.json", JSON.stringify(trading, null, 4));
                                channel.sendChat("✅ 거래소에 [" + matched[1] + "]" + matched[2] + " 카드를 " + price.toComma2() + "가넷에 " + num.toComma2() + "개 등록했습니다.\n💸 수수료: " + Math.round(price * num * 0.05).toComma2() + "가넷");
                            }
                        } else if (args[2] == "카드유지") {
                            if ((matched = fullCmd.match(/거래소 등록 카드유지 \[(.+?)\](.+?) (\d+)$/)) == null) {
                                channel.sendChat("❌ 잘못된 입력입니다.\n[ /TCGenius 거래소 등록 카드유지 [카드] [가격] ]");
                            } else {
                                let cards = JSON.parse(read("DB/TCG/card.json"));
                                let cardIdx = cards.findIndex(c => c.title == matched[1] && c.name == matched[2]);
                                if (cardIdx == -1) {
                                    channel.sendChat("❌ 존재하지 않는 카드입니다.");
                                    return;
                                }
                                let userCard = user.inventory.card.find(c => c.id == cardIdx) || {count: 0};
                                let price = Number(matched[3]);
                                if (isNaN(price) || price % 1 != 0 || price < 1) {
                                    channel.sendChat("❌ 가격을 제대로 입력해주세요.");
                                    return;
                                }
                                if (userCard.count < 1) {
                                    channel.sendChat("❌ 보유하지 않은 카드입니다.");
                                    return;
                                }
                                if (user.garnet < Math.round(price * 0.05)) {
                                    channel.sendChat("❌ 수수료로 지불할 가넷이 부족합니다.\n필요 가넷: " + user.garnet.toComma2() + "/" + Math.round((price * 0.05)).toComma2());
                                    return;
                                }
                                let new_trading = {
                                    type: "카드",
                                    id: cardIdx,
                                    sellerId: user.id,
                                    isKeep: true,
                                    level: userCard.level,
                                    transcend: userCard.transcend,
                                    breakLimit: userCard.breakLimit,
                                    exp: userCard.exp || 0,
                                    overExp: userCard.overExp || 0,
                                    count: 1,
                                    price: price
                                };
                                trading.push(new_trading);
                                new_trading = new_trading.concat();
                                new_trading.deepMerge(cards[cardIdx]);
                                user.removeCard(cardIdx, 1);
                                user.garnet -= Math.round(price * 0.05);
                                await user.save();
                                save("DB/TCG/trading.json", JSON.stringify(trading, null, 4));
                                channel.sendChat("✅ 거래소에 아래 카드를 " + price.toComma2() + "가넷에 등록했습니다.\n" + printCard(new_trading) + "\n💸 수수료: " + Math.round(price * 0.05).toComma2() + "가넷");
                            }
                        } else if (args[2] == "아티팩트") {
                            if ((matched = fullCmd.match(/거래소 등록 아티팩트 (\d+) (\d+)$/)) == null) {
                                channel.sendChat("❌ 잘못된 입력입니다.\n[ /TCGenius 거래소 등록 아티팩트 [아티팩트 번호] [가격] ]");
                            } else {
                                let artiIdx = Number(matched[1]);
                                let price = Number(matched[2]);
                                if (isNaN(artiIdx) || artiIdx % 1 != 0 || artiIdx < 1) {
                                    channel.sendChat("❌ 아티팩트 번호를 제대로 입력해주세요.");
                                    return;
                                }
                                artiIdx--;
                                if (isNaN(price) || price % 1 != 0 || price < 1) {
                                    channel.sendChat("❌ 가격을 제대로 입력해주세요.");
                                    return;
                                }
                                let artifact = user.artifact.artifacts[artiIdx];
                                if (!artifact) {
                                    channel.sendChat("❌ 해당 아티팩트 번호에 대응하는 아티팩트가 존재하지 않습니다.");
                                    return;
                                }
                                if (artifact.abilities.reduce((cur,acc) => cur + acc.level, 0) > 0) {
                                    channel.sendChat("❌ 한 번이라도 깎은 아티팩트는 거래소에 등록할 수 없습니다.");
                                    return;
                                }
                                if (user.garnet < Math.round(price * 0.05)) {
                                    channel.sendChat("❌ 수수료로 지불할 가넷이 부족합니다.\n필요 가넷: " + user.garnet.toComma2() + "/" + Math.round((price * 0.05)).toComma2());
                                    return;
                                }
                                let new_trading = {
                                    type: "아티팩트",
                                    sellerId: user.id,
                                    abilities: artifact.abilities.map(a => a.type),
                                    count: 1,
                                    price: price
                                };
                                trading.push(new_trading);
                                user.artifact.artifacts.splice(artiIdx, 1);
                                user.garnet -= Math.round(price * 0.05);
                                await user.save();
                                save("DB/TCG/trading.json", JSON.stringify(trading, null, 4));
                                channel.sendChat("✅ 거래소에 아티팩트(" + new_trading.abilities.slice(0, 2).join("/") + ")를 " + price.toComma2() + "가넷에 등록했습니다.\n💸 수수료: " + Math.round(price * 0.05).toComma2() + "가넷");
                            }
                        }
                    } else if (args[1] == "구매") {
                        let trading = JSON.parse(read("DB/TCG/trading.json"));
                        let fullCmd = cmd.substr(cmd.split(" ")[0].length + 1);
                        if (args[2] == "아이템") {
                            let items = JSON.parse(read("DB/TCG/item.json"));
                            let target = cmd.substr(cmd.split(" ")[0].length + 12);
                            let num = 1;
                            if (!isNaN(target.split(" ").pop())) {
                                let target_split = target.split(" ");
                                num = parseInt(target_split.pop());
                                target = target_split.join(" ");
                            }
                            if (num < 1 || num % 1 != 0 || isNaN(num)) {
                                channel.sendChat("❌ 수량을 제대로 입력해주세요.");
                                return;
                            }
                            let trade = trading.filter(t => t.type == "아이템" && t.name == target);
                            if (trade.length == 0) {
                                channel.sendChat("❌ 등록되지 않은 물품입니다.");
                                return;
                            }
                            let all_count = trade.reduce((cur,acc) => cur + acc.count, 0);
                            if (all_count < num) {
                                channel.sendChat("❌ 물량이 부족합니다.\n남은 물량: " + all_count.toComma2() + "개");
                                return;
                            }
                            trade = trade.sort((a,b) => {return a.price - b.price});
                            let price = calculatePrice(trade, num);
                            if (price > user.garnet) {
                                channel.sendChat("❌ 가넷이 부족합니다!\n필요 가넷: " + user.garnet.toComma2() + "/" + price.toComma2());
                                return;
                            }
                            let n = num;
                            let itemId = items.findIndex(i => i.name == target);
                            trade.forEach(async t => {
                                if (n <= 0) return;
                                let buy = Math.min(t.count, n);
                                n -= buy;
                                t.count -= buy;
                                user.addItem(itemId, buy);
                                let seller = await getTCGUserById(t.sellerId);
                                if (seller.id == user.id) seller = user;
                                seller.garnet += t.price * buy;
                                await seller.save();
                            });
                            user.garnet -= price;
                            await user.save();
                            save("DB/TCG/trading.json", JSON.stringify(trading.filter(t => t.count > 0), null, 4));
                            channel.sendChat("✅ " + target + " x" + num.toComma2() + " 구매가 완료되었습니다.\n💸 지불 금액: " + price.toComma2() + "가넷");
                        } else if (args[2] == "카드") {
                            let cardTrades = trading.filter(t => t.type == "카드");
                            let cards = JSON.parse(read("DB/TCG/card.json"));
                            let matched = fullCmd.match(/거래소 구매 카드 (\d+)(?: (\d+))?$/) || fullCmd.match(/거래소 구매 카드 (.+?)(?: (\d+))?$/);
                            if (matched == null) {
                                channel.sendChat("❌ 잘못된 입력입니다.\n[ /TCGenius 거래소 구매 카드 [번호 or [테마]카드명] <수량> ]\n\n유지 카드를 구매하시려면 번호를, 카드 명함을 구매하시려면 [테마]카드명을 입력해주세요.");
                                return;
                            }
                            let cardTrade;
                            let isKeep;
                            if (!isNaN(matched[1])) {
                                cardTrade = Number(matched[1]) - 1;
                                if (cardTrade < 0 || cardTrade % 1 != 0 || isNaN(cardTrade)) {
                                    channel.sendChat("❌ 번호를 제대로 입력해주세요.");
                                    return;
                                }
                                if (!cardTrades[cardTrade] || !cardTrades[cardTrade].isKeep) {
                                    channel.sendChat("❌ 해당 번호의 유지 카드 물품은 존재하지 않습니다.");
                                    return;
                                }
                                isKeep = true;
                            } else {
                                cardTrade = cards.findIndex(c => "[" + c.title + "]" + c.name == matched[1]);
                                if (cardTrade == -1) {
                                    channel.sendChat("❌ 존재하지 않는 카드입니다.");
                                    return;
                                }
                                if (!cardTrades.filter(t => t.id == cardTrade && !t.isKeep).length) {
                                    channel.sendChat("❌ 해당 카드 명함은 물량이 없습니다.");
                                    return;
                                }
                                isKeep = false;
                            }
                            
                            let num = matched[2] ? Number(matched[2]) : 1;
                            if (num < 1 || num % 1 != 0 || isNaN(num)) {
                                channel.sendChat("❌ 수량을 제대로 입력해주세요.");
                                return;
                            }
                            let trade = cardTrades.filter((t, i) => isKeep ? i == cardTrade : t.id == cardTrade && !t.isKeep);
                            let all_count = trade.reduce((cur,acc) => cur + acc.count, 0);
                            if (all_count < num) {
                                channel.sendChat("❌ 물량이 부족합니다.\n남은 물량: " + all_count.toComma2() + "개");
                                return;
                            }
                            trade = trade.sort((a,b) => {return a.price - b.price});
                            let price = calculatePrice(trade, num);
                            if (price > user.garnet) {
                                channel.sendChat("❌ 가넷이 부족합니다!\n필요 가넷: " + user.garnet.toComma2() + "/" + price.toComma2());
                                return;
                            }
                            let tradeTicket = user.inventory.item.find(i => i.id == 31) || {count:0};
                            let tradeTicketPrice = ["","일반","고급","희귀","영웅","전설"].indexOf(cards[trade[0].id].rarity);
                            if (tradeTicket.count < tradeTicketPrice) {
                                channel.sendChat("❌ 거래권이 부족합니다!");
                                return;
                            }
                            user.removeItem(31, tradeTicketPrice);
                            let n = num;
                            let cardId = trade[0].id;
                            let keeping_card = trade[0].concat();
                            if (isKeep) keeping_card.deepMerge(cards[cardId]);
                            for (let t of trade) {
                                if (n <= 0) break;
                                let buy = Math.min(t.count, n);
                                n -= buy;
                                t.count -= buy;
                                user.addCard(cardId, buy);
                                if (isKeep) {
                                    user.inventory.card.find(c => c.id == cardId).breakLimit = (t.breakLimit ? true : user.inventory.card.find(c => c.id == cardId).breakLimit);
                                    user.inventory.card.find(c => c.id == cardId).level = Math.max(t.level, user.inventory.card.find(c => c.id == cardId).level);
                                    user.inventory.card.find(c => c.id == cardId).transcend = Math.max(t.transcend, user.inventory.card.find(c => c.id == cardId).transcend);
                                    user.inventory.card.find(c => c.id == cardId).exp = t.exp;
                                    user.inventory.card.find(c => c.id == cardId).overExp = t.overExp;
                                }
                                let seller = await getTCGUserById(t.sellerId);
                                if (seller.id == user.id) seller = user;
                                seller.garnet += t.price * buy;
                                await seller.save();
                            }
                            user.garnet -= price;
                            await user.save();
                            save("DB/TCG/trading.json", JSON.stringify(trading.filter(t => t.count > 0), null, 4));
                            if (isKeep) channel.sendChat("✅ 아래 카드 구매가 완료되었습니다.\n" + printCard(keeping_card) + "\n💸 지불 금액: " + price.toComma2() + "가넷");
                            else channel.sendChat("✅ " + matched[1] + " x" + num.toComma2() + " 구매가 완료되었습니다.\n💸 지불 금액: " + price.toComma2() + "가넷");
                        } else if (args[2] == "아티팩트") {
                            let artifacts = trading.filter(t => t.type == "아티팩트");
                            let target = cmd.substr(cmd.split(" ")[0].length + 13);
                            let num = 1;
                            if (!isNaN(target.split(" ").pop())) {
                                let target_split = target.split(" ");
                                num = parseInt(target_split.pop());
                                target = target_split.join(" ");
                            }
                            if (num < 1 || num % 1 != 0 || isNaN(num)) {
                                channel.sendChat("❌ 수량을 제대로 입력해주세요.");
                                return;
                            }
                            let trade = artifacts.filter(t => target == "아티팩트(" + t.abilities.slice(0,2).join("/") + ")");
                            if (trade.length == 0) {
                                channel.sendChat("❌ 등록되지 않은 물품입니다.");
                                return;
                            }
                            let all_count = trade.reduce((cur,acc) => cur + acc.count, 0);
                            if (all_count < num) {
                                channel.sendChat("❌ 물량이 부족합니다.\n남은 물량: " + all_count.toComma2() + "개");
                                return;
                            }
                            trade = trade.sort((a,b) => {return a.price - b.price});
                            let price = calculatePrice(trade, num);
                            if (price > user.garnet) {
                                channel.sendChat("❌ 가넷이 부족합니다!\n필요 가넷: " + user.garnet.toComma2() + "/" + price.toComma2());
                                return;
                            }
                            let tradeTicket = user.inventory.item.find(i => i.id == 31) || {count:0};
                            if (tradeTicket.count < num) {
                                channel.sendChat("❌ 거래권이 부족합니다!");
                                return;
                            }
                            user.removeItem(31, num);
                            let n = num;
                            let abilities = trade[0].abilities.slice(0, 2);
                            let negative = [
                                "전체 덱 파워 감소", "전체 덱 파워 감소%",
                                "콘텐츠 덱 파워 감소", "콘텐츠 덱 파워 감소%",
                                "골드 덱 파워 감소", "골드 덱 파워 감소%",
                                "데일리 골드 감소", "데일리 골드 감소%"
                            ];
                            for (let t of trade) {
                                if (n <= 0) break;
                                let buy = Math.min(t.count, n);
                                n -= buy;
                                t.count -= buy;
                                for(let i = 0; i < buy; i++) {
                                    let new_artifact = {
                                        id: getRandomString(20),
                                        success_prob: 0.75,
                                        abilities: [{
                                            level: 0,
                                            display: [-1,-1,-1,-1,-1,-1,-1,-1,-1,-1],
                                            type: abilities[0]
                                        },{
                                            level: 0,
                                            display: [-1,-1,-1,-1,-1,-1,-1,-1,-1,-1],
                                            type: abilities[1]
                                        }]
                                    };
                                    new_artifact.abilities.push({
                                        level: 0,
                                        display: [-1,-1,-1,-1,-1,-1,-1,-1,-1,-1],
                                        type: negative[Math.floor(Math.random() * negative.length)]
                                    });
                                    user.artifact.artifacts.push(new_artifact);
                                }
                                let seller = await getTCGUserById(t.sellerId);
                                if (seller.id == user.id) seller = user;
                                seller.garnet += t.price * buy;
                                await seller.save();
                            }
                            user.garnet -= price;
                            await user.save();
                            save("DB/TCG/trading.json", JSON.stringify(trading.filter(t => t.count > 0), null, 4));
                            channel.sendChat("✅ " + target + " x" + num.toComma2() + " 구매가 완료되었습니다.\n💸 지불 금액: " + price.toComma2() + "가넷");
                        }
                    } else if (args[1] == "회수") {
                        let fullCmd = cmd.substr(cmd.split(" ")[0].length + 1);
                        let matched = fullCmd.match(/거래소 회수 (\d+)(?: (\d+))?$/);
                        if (matched == null) {
                            channel.sendChat("❌ 잘못된 입력입니다.\n[ /TCGenius 거래소 회수 [번호] <수량> ]");
                            return;
                        }
                        let sellIdx = Number(matched[1]) - 1;
                        if (sellIdx < 0 || sellIdx % 1 != 0 || isNaN(sellIdx)) {
                            channel.sendChat("❌ 번호를 제대로 입력해주세요.");
                            return;
                        }
                        let trading = JSON.parse(read("DB/TCG/trading.json"));
                        let myTrade = trading.filter(t => t.sellerId == user.id);
                        if (!myTrade[sellIdx]) {
                            channel.sendChat("❌ 해당 번호의 판매 품목이 없습니다.");
                            return;
                        }
                        let num = matched[2] ? Number(matched[2]) : myTrade[sellIdx].count;
                        if (num < 0 || num % 1 != 0 || isNaN(num)) {
                            channel.sendChat("❌ 번호를 제대로 입력해주세요.");
                            return;
                        }
                        if (myTrade[sellIdx].count < num) {
                            channel.sendChat("❌ 갯수가 부족합니다.\n판매중인 갯수: " + myTrade[sellIdx].count.toComma2() + "개");
                            return;
                        }
                        let trade = myTrade[sellIdx];
                        if (trade.type == "아이템") {
                            let items = JSON.parse(read("DB/TCG/item.json"));
                            let itemIdx = items.findIndex(i => i.name == trade.name);
                            user.addItem(itemIdx, num);
                        } else if (trade.type == "카드") {
                            user.addCard(trade.id, num);
                            if (trade.isKeep) {
                                let userCard = user.inventory.card.find(c => c.id == trade.id);
                                userCard.level = trade.level;
                                userCard.transcend = trade.transcend;
                                userCard.breakLimit = trade.breakLimit;
                                userCard.exp = trade.exp;
                                userCard.overExp = trade.overExp;
                            }
                        } else if (trade.type == "아티팩트") {
                            let abilities = trade.abilities;
                            for(let i = 0; i < num; i++) {
                                let new_artifact = {
                                    id: getRandomString(20),
                                    success_prob: 0.75,
                                    abilities: [{
                                        level: 0,
                                        display: [-1,-1,-1,-1,-1,-1,-1,-1,-1,-1],
                                        type: abilities[0]
                                    },{
                                        level: 0,
                                        display: [-1,-1,-1,-1,-1,-1,-1,-1,-1,-1],
                                        type: abilities[1]
                                    },{
                                        level: 0,
                                        display: [-1,-1,-1,-1,-1,-1,-1,-1,-1,-1],
                                        type: abilities[2]
                                    }]
                                };
                                user.artifact.artifacts.push(new_artifact);
                            }
                        }
                        trade.count -= num;
                        user.garnet += Math.round(trade.price * num * 0.02);
                        await user.save();
                        save("DB/TCG/trading.json", JSON.stringify(trading.filter(t => t.count > 0), null, 4));
                        channel.sendChat("✅ 거래소에 판매중인 품목을 회수했습니다.\n💠 돌려받은 금액: " + Math.round(trade.price * num * 0.02).toComma2() + "가넷");
                    }
                    return;
                }

                // 구매
                if (args[0] == "구매") {
                    let shopInfo = JSON.parse(read("DB/TCG/shop.json"));
                    let target = cmd.substr(cmd.split(" ")[0].length + 4);
                    let num = 1;
                    if (!isNaN(target.split(" ").pop())) {
                        let target_split = target.split(" ");
                        num = parseInt(target_split.pop());
                        target = target_split.join(" ");
                    }
                    if (num < 1 || num % 1 != 0 || isNaN(num)) {
                        channel.sendChat("❌ 수량을 제대로 입력해주세요.");
                        return;
                    }
                    let targetPack = shopInfo.find(sell => sell.name == target || (!sell.name && target == (sell.item[0].gold ? numberWithCommas(sell.item[0].count.toString()) + "골드" : (sell.item[0].garnet ? numberWithCommas(sell.item[0].count.toString()) + "가넷" : sell.item[0].name))));
                    if (!targetPack) {
                        channel.sendChat("❌ 판매중인 물품이 아닙니다.");
                    } else {
                        if (targetPack.limit) {
                            // 주간 제한 리셋: 일요일이고 아직 리셋하지 않았다면
                            let now = new Date();
                            if (now.getDay() == 0 && user.shopLimit.weeklyResetAt != now.toYYYYMMDD()) {
                                user.shopLimit.weekly = [];
                                user.shopLimit.weeklyResetAt = now.toYYYYMMDD();
                            }
                            if (targetPack.limit.daily && user.shopLimit.daily.find(d => d.name == target) && user.shopLimit.daily.find(d => d.name == target).count >= targetPack.limit.daily) {
                                channel.sendChat("❌ 해당 상품의 일일 구매 횟수를 초과했습니다.\n내일 출석 후 다시 구매 가능합니다.");
                                return;
                            }
                            if (targetPack.limit.daily && (user.shopLimit.daily.find(d => d.name == target) || {count:0}).count + num > targetPack.limit.daily) {
                                channel.sendChat("❌ 해당 상품의 일일 구매 횟수를 초과합니다.\n오늘 " + (targetPack.limit.daily - (user.shopLimit.daily.find(d => d.name == target) || {count:0}).count) + "회 더 구매 가능합니다.");
                                return;
                            }
                            if (targetPack.limit.weekly && user.shopLimit.weekly.find(d => d.name == target) && user.shopLimit.weekly.find(d => d.name == target).count >= targetPack.limit.weekly) {
                                channel.sendChat("❌ 해당 상품의 주간 구매 횟수를 초과했습니다.\n매 주 일요일에 초기화됩니다.");
                                return;
                            }
                            if (targetPack.limit.weekly && (user.shopLimit.weekly.find(d => d.name == target) || {count:0}).count + num > targetPack.limit.weekly) {
                                channel.sendChat("❌ 해당 상품의 주간 구매 횟수를 초과합니다.\n이번 주에 " + (targetPack.limit.weekly - (user.shopLimit.weekly.find(d => d.name == target) || {count:0}).count) + "회 더 구매 가능합니다.");
                                return;
                            }
                            if (targetPack.limit.lifetime && user.shopLimit.lifetime.find(d => d.name == target) && user.shopLimit.lifetime.find(d => d.name == target).count >= targetPack.limit.lifetime) {
                                channel.sendChat("❌ 해당 상품의 최대 구매 횟수를 초과했습니다.\n더 이상 구매할 수 없습니다.");
                                return;
                            }
                            if (targetPack.limit.lifetime && (user.shopLimit.lifetime.find(d => d.name == target) || {count:0}).count + num > targetPack.limit.lifetime) {
                                channel.sendChat("❌ 해당 상품의 최대 구매 횟수를 초과합니다.\n" + (targetPack.limit.lifetime - (user.shopLimit.lifetime.find(d => d.name == target) || {count:0}).count) + "회 더 구매 가능합니다.");
                                return;
                            }
                        }
                        let items = JSON.parse(read("DB/TCG/item.json"));
                        let goods = targetPack.goods;
                        if (targetPack.goods == "가넷") goods = 'garnet';
                        if (targetPack.goods == "골드") goods = 'gold';
                        if (goods == 'garnet' || goods == 'gold' || goods == 'p') {
                            if (user[goods] < targetPack.price * num) {
                                channel.sendChat("❌ " + targetPack.goods + (dec_han(targetPack.goods.substr(-1)).length == 3 ? "이" : "가") + " 부족합니다!\n필요 " + targetPack.goods + ": " + numberWithCommas(user[goods].toString()) + "/" + numberWithCommas((targetPack.price * num).toString()));
                                return;
                            } else {
                                user[goods] -= targetPack.price * num;
                            }
                        } else {
                            let itemIdx = items.findIndex(item => item.name == goods);
                            let userItem = user.inventory.item.find(i => i.id == itemIdx) || {count: 0};
                            if (userItem.count < targetPack.price * num) {
                                channel.sendChat("❌ " + targetPack.goods + (dec_han(targetPack.goods.substr(-1)).length == 3 ? "이" : "가") + " 부족합니다!\n필요 " + targetPack.goods + ": " + numberWithCommas(userItem.count.toString()) + "/" + numberWithCommas((targetPack.price * num).toString()));
                                return;
                            } else {
                                user.removeItem(itemIdx, targetPack.price * num);
                            }
                        }
                        // roll 보상은 num번 독립적으로 굴리고, 일반 보상은 count에 num을 곱해 지급한다.
                        let packToGive = [];
                        for (let reward of targetPack.item) {
                            if (reward.roll) {
                                for (let i = 0; i < num; i++) {
                                    // roll 객체를 그대로 전달하면 givePack이 1회 롤 처리
                                    packToGive.push(reward);
                                }
                            } else {
                                let r = Object.assign({}, reward);
                                if (typeof r.count === 'number') r.count = r.count * num;
                                packToGive.push(r);
                            }
                        }
                        let res = user.givePack(packToGive);
                        if (targetPack.limit) {
                            if (targetPack.limit.daily) {
                                if (!user.shopLimit.daily.find(d => d.name == target)) user.shopLimit.daily.push({name: target, count: 0});
                                user.shopLimit.daily.find(d => d.name == target).count += num;
                            }
                            if (targetPack.limit.weekly) {
                                if (!user.shopLimit.weekly.find(d => d.name == target)) user.shopLimit.weekly.push({name: target, count: 0});
                                user.shopLimit.weekly.find(d => d.name == target).count += num;
                            }
                            if (targetPack.limit.lifetime) {
                                if (!user.shopLimit.lifetime.find(d => d.name == target)) user.shopLimit.lifetime.push({name: target, count: 0});
                                user.shopLimit.lifetime.find(d => d.name == target).count += num;
                            }
                        }
                        await user.save();
                        //TCGLog("📜 상점 구매 로그 📜\n\n>> 구매자: " + user + "\n>> 구매 아이템: " + target + " x" + num.toComma2());
                        channel.sendChat("✅ " + target + " x" + numberWithCommas(num.toString()) + " 구매가 완료되었습니다.\n\n[ 획득 물품 ]\n" + res.join("\n"));
                    }
                    return;
                }

                // 사용
                if (args[0] == "사용") {
                    let items = JSON.parse(read("DB/TCG/item.json"));
                    let target = cmd.substr(cmd.split(" ")[0].length + 4);
                    let num = 1;
                    if (!items.find(i => i.name == target) && !isNaN(target.split(" ").pop())) {
                        let target_split = target.split(" ");
                        num = parseInt(target_split.pop());
                        target = target_split.join(" ");
                    }
                    if (num < 1 || num % 1 != 0 || isNaN(num)) {
                        channel.sendChat("❌ 수량을 제대로 입력해주세요.");
                        return;
                    }
                    
                    let itemIdx = items.findIndex(item => item.name == target);
                    if (itemIdx == -1) {
                        channel.sendChat("❌ 존재하지 않는 아이템입니다.");
                        return;
                    }
                    if (!["카드팩","소모품","선택팩","버프카드","물약"].includes(items[itemIdx].type)) {
                        channel.sendChat("❌ 사용할 수 없는 아이템입니다.");
                        return;
                    }
                     if (items[itemIdx].type == "버프카드") {
                        let isRaid = false;
                        for (let pid in raidParties) {
                            let party = raidParties[pid];
                            if (party.members.find(m => m.userId == user.id) && party.phase >= 1) {
                                isRaid = true;
                                break;
                            }
                        }
                        if (!isRaid) {
                            channel.sendChat("❌ 콘텐츠 진행중이 아닙니다.\n모든 버프카드가 제거됩니다.");
                            user.removeItem(35, 999);
                            user.removeItem(36, 999);
                            user.removeItem(37, 999);
                            user.removeItem(38, 999);
                            user.removeItem(39, 999);
                            await user.save();
                            return;
                        }
                    }
                    if (items[itemIdx].type == "소모품" && num > 10) {
                        channel.sendChat("❌ 소모품은 한 번에 10개까지 사용이 가능합니다.");
                        return;
                    }
                    if (items[itemIdx].type == "카드팩" && num > 10) {
                        channel.sendChat("❌ 카드팩은 한 번에 10개까지 사용이 가능합니다.");
                        return;
                    }
                    if (items[itemIdx].name == "윷" && num > 1) {
                        channel.sendChat("❌ 윷은 한 번에 1개만 던질 수 있습니다.");
                        return;
                    }
                    if (items.find(i => i.name == target).type == "버프카드") num = 1;
                    let targetItem = user.inventory.item.find(item => item.id == itemIdx);
                    if (!targetItem || targetItem.count < num) {
                        channel.sendChat("❌ 수량이 부족합니다.\n보유 수량: " + numberWithCommas((targetItem || {count:0}).count.toString()) + "개");
                        return;
                    }
                    user.removeItem(itemIdx, num);
                    let sendMsg = [];
                    sendMsg.push("✅ " + items[itemIdx].name + " 아이템을 사용했습니다.");
                    
                    // 카드팩 처리
                    if (items[itemIdx].type == "카드팩") {
                        if (["일반","고급","희귀","영웅","전설"].includes(items[itemIdx].name.split(" ")[0])) {
                            let cards = JSON.parse(read("DB/TCG/card.json"));
                            let shuffleCards = cards.filter(c => c.rarity == items[itemIdx].name.split(" ")[0]).shuffle();
                            let res = [];
                            for (let i = 0; i < num; i++) {
                                let card = shuffleCards.getRandomElement();
                                user.addCard(cards.findIndex(c => c.title == card.title && c.name == card.name), 1);
                                res.push(printCard(card));
                            }
                            sendMsg.push("\n[ 획득한 카드 ]\n" + res.join("\n"));
                        } else if (items[itemIdx].name.startsWith("[")) {
                            let theme = items[itemIdx].name.substr(1).split("]")[0];
                            let origin_cards = JSON.parse(read("DB/TCG/card.json"));
                            let cards = JSON.parse(read("DB/TCG/card.json")).filter(c => c.title == theme);
                            let probability = JSON.parse(read("DB/TCG/probability.json"))["일반"];
                            let result = [
                                {rarity: "전설", count: 0},
                                {rarity: "영웅", count: 0},
                                {rarity: "희귀", count: 0},
                                {rarity: "고급", count: 0},
                                {rarity: "일반", count: 0}
                            ];
                            let cardResults = [];
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
                            for (let rs of result) {
                                for (let i = 0; i < rs.count; i++) {
                                    let card = cards.filter(c => c.rarity == rs.rarity).getRandomElement();
                                    let cardIdx = origin_cards.findIndex(c => c.title == card.title && c.name == card.name);
                                    user.addCard(cardIdx, 1);
                                    const existingResult = cardResults.find(c => c.name == "[" + card.title + "]" + card.name);
                                    if (existingResult) {
                                        existingResult.count++;
                                    } else {
                                        cardResults.push({
                                            rarity: card.rarity,
                                            name: "[" + card.title + "]" + card.name,
                                            count: 1
                                        });
                                    }
                                }
                            }
                            let resDisplay = result.map(rs => rs.count <= 0 ? null : "- " + rs.rarity + " x" + rs.count).filter(rs => rs != null);
                            sendMsg.push("\n[ 획득한 카드 등급 ]\n" + resDisplay.join("\n") + "\n\n[ 획득한 카드 ]\n" + VIEWMORE + cardResults.map(cr => "<" + cr.rarity + "> " + cr.name + (cr.count > 1 ? " x" + cr.count : "")).join("\n"));
                        }
                    }
                    // 선택팩 처리
                    else if (items[itemIdx].type == "선택팩") {
                        let canChoose = [];
                        let cards = JSON.parse(read("DB/TCG/card.json"));
                        if (["일반","고급","희귀","영웅","전설"].includes(items[itemIdx].name.split(" ")[0])) {
                            canChoose = cards.filter(c => c.rarity == items[itemIdx].name.split(" ")[0]);
                        } else if (items[itemIdx].name == "초심자의 전설 카드 선택팩") {
                            canChoose.push(cards[13]);
                            canChoose.push(cards[15]);
                            canChoose.push(cards[40]);
                            canChoose.push(cards[20]);
                            canChoose.push(cards[32]);
                        } else if (items[itemIdx].name.startsWith("[")) {
                            canChoose = cards.filter(c => c.title == items[itemIdx].name.substr(1).split("]")[0]);
                        } else if (items[itemIdx].name == "픽업카드선택권") {
                            let pickup = JSON.parse(read("DB/TCG/pickupRotation.json")).currentTheme;
                            canChoose = cards.filter(c => pickup.includes(c.title));
                        } else {
                            canChoose = cards;
                        }
                        if (canChoose.length == 0) {
                            sendMsg.push("❌ 이 선택팩은 선택 가능한 카드가 없습니다.");
                        } else {
                            chooseCard[sender.userId+""] = {
                                num: num,
                                canChoose: canChoose
                            };
                            sendMsg.push("얻고 싶은 카드를 아래 양식에 맞춰 입력해주세요.\n카드 양식: [테마]카드명");
                        }
                    }
                    // 아티팩트 생성
                    else if (items[itemIdx].name == "아티팩트") {
                        for(let i = 0; i < num; i++) {
                            let abilities = {
                                positive: [
                                    "전체 덱 파워 증가", "전체 덱 파워 증가%",
                                    "콘텐츠 덱 파워 증가", "콘텐츠 덱 파워 증가%",
                                    "골드 덱 파워 증가", "골드 덱 파워 증가%",
                                    "데일리 골드 증가", "데일리 골드 증가%"
                                ],
                                negative: [
                                    "전체 덱 파워 감소", "전체 덱 파워 감소%",
                                    "콘텐츠 덱 파워 감소", "콘텐츠 덱 파워 감소%",
                                    "골드 덱 파워 감소", "골드 덱 파워 감소%",
                                    "데일리 골드 감소", "데일리 골드 감소%"
                                ]
                            };
                            let new_artifact = {
                                id: getRandomString(20),
                                success_prob: 0.75,
                                abilities: []
                            };
                            abilities.positive = abilities.positive.shuffle().shuffle().shuffle().shuffle().shuffle();
                            new_artifact.abilities.push({
                                level: 0,
                                display: [-1,-1,-1,-1,-1,-1,-1,-1,-1,-1],
                                type: abilities.positive.pop()
                            });
                            new_artifact.abilities.push({
                                level: 0,
                                display: [-1,-1,-1,-1,-1,-1,-1,-1,-1,-1],
                                type: abilities.positive.pop()
                            });
                            new_artifact.abilities.push({
                                level: 0,
                                display: [-1,-1,-1,-1,-1,-1,-1,-1,-1,-1],
                                type: abilities.negative[Math.floor(Math.random() * abilities.negative.length)]
                            });
                            user.artifact.artifacts.push(new_artifact);
                        }
                        sendMsg.push("새로운 어빌리티 아티팩트 " + num + "개가 활성화되었습니다.");
                    }
                    // 전덱%+데골% 아티팩트
                    else if (items[itemIdx].name == "전덱%+데골% 아티팩트") {
                        for(let i = 0; i < num; i++) {
                            let abilities = {
                                negative: [
                                    "전체 덱 파워 감소", "전체 덱 파워 감소%",
                                    "콘텐츠 덱 파워 감소", "콘텐츠 덱 파워 감소%",
                                    "골드 덱 파워 감소", "골드 덱 파워 감소%",
                                    "데일리 골드 감소", "데일리 골드 감소%"
                                ]
                            };
                            let new_artifact = {
                                id: getRandomString(20),
                                success_prob: 0.75,
                                abilities: [{
                                    level: 0,
                                    display: [-1,-1,-1,-1,-1,-1,-1,-1,-1,-1],
                                    type: "전체 덱 파워 증가%"
                                },{
                                    level: 0,
                                    display: [-1,-1,-1,-1,-1,-1,-1,-1,-1,-1],
                                    type: "데일리 골드 증가%"
                                }]
                            };
                            new_artifact.abilities.push({
                                level: 0,
                                display: [-1,-1,-1,-1,-1,-1,-1,-1,-1,-1],
                                type: abilities.negative[Math.floor(Math.random() * abilities.negative.length)]
                            });
                            user.artifact.artifacts.push(new_artifact);
                        }
                        sendMsg.push("새로운 어빌리티 아티팩트 " + num + "개가 활성화되었습니다.");
                    }
                    // 경험치물약
                    else if (items[itemIdx].name == "경험치300물약") {
                        chooseCard[sender.userId+""] = {
                            type: "경험치물약",
                            num: num * 300
                        };
                        sendMsg.push("경험치 " + (num * 300).toComma2() + "만큼을 부여할 카드를 입력해주세요.");
                    }
                    // 윷
                    else if (items[itemIdx].name == "윷") {
                        let yut_pack = JSON.parse(read("DB/TCG/yut_pack.json"));
                        let yut = ["도","개","걸","윷","모","걸","개","도","도"].getRandomElement();
                        let pack = yut_pack[yut].getRandomElement();
                        let rewards = user.givePack(pack);
                        sendMsg.push("✨ 결과: " + yut + "\n\n[ 획득한 보상 ]\n" + rewards.join("\n"));
                    }
                    // 주사위 선택권
                    else if (items[itemIdx].name == "주사위 선택권") {
                        chooseCard[sender.userId+""] = {
                            type: "주사위선택",
                            num: num
                        };
                        sendMsg.push("주사위를 선택해주세요.\n\n- 희미한 주사위: x" + (num * 100).toComma2() + "\n- 빛나는 주사위: x" + (num * 65).toComma2() + "\n- 찬란한 주사위: x" + (num * 35).toComma2() + "\n- 운명 주사위: x" + (num * 15).toComma2() + "\n- 심판 주사위: x" + (num * 5).toComma2());
                    }
                    // 소모품
                    else if (items[itemIdx].type == "소모품") {
                        let consumable = JSON.parse(read("DB/TCG/consumable.json")).find(c => c.name == items[itemIdx].name);
                        if (consumable) {
                            let rewards = [];
                            for (let i = 0; i < num; i++) {
                                rewards = rewards.concat(user.givePack(consumable.rewards));
                            }
                            if (!consumable.rewards.find(r => r.gold || r.garnet)) rewards = mergeRewards(rewards);
                            sendMsg.push("\n[ 획득한 보상 ]\n" + rewards.join("\n"));
                        }
                    }
                    // 버프카드 (콘텐츠용)
                    else if (items[itemIdx].name.startsWith("전투력 상승 ")) {
                        // 파티 확인
                        let userParty = null;
                        for (let pid in raidParties) {
                            if (raidParties[pid].members.find(m => m.userId == user.id)) {
                                userParty = raidParties[pid];
                                break;
                            }
                        }
                        
                        if (!userParty) {
                            sendMsg.push("❌ 콘텐츠에 참여중이 아닙니다.");
                        } else {
                            let location = userParty.memberLocations[user.id];
                            if (location == "밖") {
                                sendMsg.push("❌ 게임동, 생활동, 감옥에 입장한 상태에서만 버프카드를 사용할 수 있습니다.");
                            } else {
                                let buffNum = items[itemIdx].name.substr(7);
                                let success_prob = {
                                    "노말": 0.8,
                                    "하드": 0.65,
                                    "익스트림": 0.55
                                };
                                
                                let memberPower = userParty.memberPowers[user.id];
                                let powerType = "";
                                let originalPower = 0;
                                
                                // 현재 위치에 따라 적용되는 파워 타입 결정
                                if (location == "게임동") {
                                    powerType = "5인공격대";
                                    originalPower = memberPower.current_5man;
                                } else if (location.startsWith("생활동")) {
                                    powerType = "보정공격대";
                                    originalPower = memberPower.current_pure;
                                } else if (location.startsWith("감옥") || location.startsWith("비밀의방")) {
                                    powerType = "듀오공격대";
                                    originalPower = memberPower.current_duo;
                                }
                                
                                let buffValue = 0;
                                if (buffNum.includes("%")) {
                                    buffValue = Math.round(originalPower * (Number(buffNum.replace("%","")) / 100));
                                } else {
                                    buffValue = Number(buffNum);
                                }
                                
                                let r = Math.random();
                                if (r < success_prob[userParty.difficulty]) {
                                    // 성공
                                    if (location == "게임동") {
                                        memberPower.current_5man += buffValue;
                                    } else if (location.startsWith("생활동")) {
                                        memberPower.current_pure += buffValue;
                                    } else if (location.startsWith("감옥") || location.startsWith("비밀의방")) {
                                        memberPower.current_duo += buffValue;
                                    }
                                    
                                    memberPower.buffCardUses++;
                                    
                                    sendMsg.push("✅ " + powerType + " 파워가 " + buffNum + " 상승했습니다!\n" +
                                        "현재 " + powerType + " 파워: " + (originalPower + buffValue).toComma2() + " (+" + buffValue.toComma2() + ")\n" +
                                        "버프카드 사용 횟수: " + memberPower.buffCardUses + "회");
                                } else {
                                    // 실패
                                    if (location == "게임동") {
                                        memberPower.current_5man -= buffValue;
                                    } else if (location.startsWith("생활동")) {
                                        memberPower.current_pure -= buffValue;
                                    } else if (location.startsWith("감옥") || location.startsWith("비밀의방")) {
                                        memberPower.current_duo -= buffValue;
                                    }
                                    
                                    memberPower.buffCardUses++;
                                    
                                    sendMsg.push("❌ " + powerType + " 파워가 " + buffNum + " 하락했습니다!\n" +
                                        "현재 " + powerType + " 파워: " + (originalPower - buffValue).toComma2() + " (-" + buffValue.toComma2() + ")\n" +
                                        "버프카드 사용 횟수: " + memberPower.buffCardUses + "회");
                                }
                            }
                        }
                    }
                    
                    await user.save();
                    channel.sendChat(sendMsg.join("\n"));
                    return;
                }
            }
        }

    } catch(e) {
        let fuck = e;
        console.log(fuck);
        channel.sendChat(JSON.stringify(fuck, null, 4));
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
