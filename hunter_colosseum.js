/**
 * hunter_colosseum.js
 *
 * old_engine.js의 '헌터 콜로세움' 게임을 new_engine.js에 이식한 모듈.
 *
 * 이식 방식("구조만 이식"):
 *  - User/HuntGame 의 DynamoDB 스키마(user_data / hunt 테이블)와 필드 구조는 그대로 보존.
 *  - 데이터 파일은 DB/hunter/ 아래의 JSON/txt 를 fs 동기 read/save 로 그대로 사용.
 *  - 런타임만 new_engine 컨벤션에 맞춤:
 *      · 동기 DynamoDB 래퍼 → async docClient(@aws-sdk/lib-dynamodb)
 *      · room.send(...)      → channel.sendChat(...) (await)
 *      · room.id             → channel.channelId
 *      · java.lang.Runnable  제거(인라인 async)
 *      · module.exports + onChat(data, channel) 패턴 (rpgenius.js 와 동일)
 *
 * new_engine.js 에서:
 *      const hunterColosseum = require('./hunter_colosseum.js');
 *      // client.on('chat', ...) 안에서
 *      if (hunterColosseum.TARGET_CHANNEL_IDS.includes(channel.channelId + '') &&
 *          await hunterColosseum.onChat(data, channel)) return;
 */

const fs = require('fs');
const axios = require('axios');
const path = require('path');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, QueryCommand, UpdateCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');

// ───────────────────────────────────────────────────────────── 설정
// 헌터 콜로세움 게임이 지원되는 방 목록 (old_engine 의 possibleRooms).
// new_engine 의 channelId 체계로 채워 넣어야 한다. (임시: old_engine 값 유지)
const TARGET_CHANNEL_IDS = [
    "442097040687921", "18446472286956749", "18447887254284126", "433076049769561",
    "384981318100178", "18448796257459256", "18451173486559958", "439083102695072",
    "18454451074557977", "18456913814672594"
];

const USER_TABLE = "user_data";
const HUNT_TABLE = "hunt";
const VIEWMORE = '‎'.repeat(500);
const DB_ROOT = path.join(__dirname, 'DB', 'hunter');
const HUNTER_DATA_TABLE = 'hunter_data';

// 런타임에 읽고/쓰는 동적 데이터는 파일 대신 DynamoDB(hunter_data) 로 관리한다.
// 정적 설정(weapons/armors/monster.json 등)은 그대로 DB/hunter/ 파일을 사용한다.
//  - 접두사형(유저/엔터티별): harvested_soul/{name}, tamed/{id}, userQuest/{id}, npcData/{...}
//  - 단일 상태 파일: guild.json, hunterTrade.json, hunterShop.json, hunterShopId.txt,
//                    initHunterRate.txt, locations.json
const DYNAMIC_PREFIXES = ['harvested_soul/', 'tamed/', 'userQuest/', 'npcData/'];
const DYNAMIC_FILES = ['guild.json', 'hunterTrade.json', 'hunterShop.json', 'hunterShopId.txt', 'initHunterRate.txt'];
// locations.json 은 운영자가 직접 관리하는 설정 파일이므로 파일로 유지한다(동적 분류 제외).

const dynamoClient = new DynamoDBClient({
    region: process.env.AWS_REGION || "ap-northeast-2",
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_KEY_ID
    }
});
const docClient = DynamoDBDocumentClient.from(dynamoClient, {
    marshallOptions: { removeUndefinedValues: true }
});

// ───────────────────────────────────────────────────────────── 모듈 상태
// old_engine 의 전역 가변 상태 (방 단위). 키는 channelId.
const colosseum = {};   // PvP 결투 진행 상태
const huntParty = {};   // 사냥 파티 모집 상태
const toWait = {};      // 소모품 사용 잠금 (userId)
const myCheck = {};     // $확인 대기중인 액션 (senderId)

// ───────────────────────────────────────────────────────────── 데이터 IO
// 엔진/핸들러는 read("DB/xxx")/save("DB/xxx", str) 형태로 호출한다.
// 정적 경로 → DB/hunter/ 파일, 동적 경로 → hunter_data(메모리 캐시 + DynamoDB) 로 라우팅한다.
// old_engine 의 read() 는 파일이 없으면 (문자열이 아닌) null 을 반환하므로 그 계약을 그대로 따른다.
function relDataPath(p) {
    let rel = String(p);
    if (rel.startsWith('DB/hunter/')) rel = rel.slice('DB/hunter/'.length);
    else if (rel.startsWith('DB/')) rel = rel.slice('DB/'.length);
    return rel;
}
function resolveDataPath(p) {
    return path.join(DB_ROOT, relDataPath(p));
}
// 동적 데이터면 hunter_data 키(상대경로)를, 아니면 null 을 반환.
function dynamicKey(p) {
    const rel = relDataPath(p);
    if (DYNAMIC_FILES.includes(rel)) return rel;
    if (DYNAMIC_PREFIXES.some(pre => rel.startsWith(pre))) return rel;
    return null;
}

// hunter_data 메모리 캐시 (key → 문자열 값). 모듈 시작 시 initHunterData() 로 적재.
const hunterDataCache = {};
let hunterDataLoaded = false;

async function initHunterData() {
    const { ScanCommand } = require('@aws-sdk/lib-dynamodb');
    let ExclusiveStartKey;
    try {
        do {
            const res = await docClient.send(new ScanCommand({ TableName: HUNTER_DATA_TABLE, ExclusiveStartKey }));
            (res.Items || []).forEach(it => { if (it && it.key != null && it.data !== undefined) hunterDataCache[it.key] = it.data; });
            ExclusiveStartKey = res.LastEvaluatedKey;
        } while (ExclusiveStartKey);
        hunterDataLoaded = true;
    } catch (e) {
        console.error('[hunter initHunterData]', e.message);
    }
    return hunterDataCache;
}
async function ensureHunterDataLoaded() {
    if (!hunterDataLoaded) await initHunterData();
}
// 캐시 갱신 후 DynamoDB 에 비동기 영속화(fire-and-forget). 동기 save() 계약 유지를 위함.
function persistHunterData(key, value) {
    docClient.send(new (require('@aws-sdk/lib-dynamodb').PutCommand)({
        TableName: HUNTER_DATA_TABLE,
        Item: { key: key, data: value }
    })).catch(e => console.error('[hunter persistHunterData]', key, e.message));
}

function read(p) {
    const key = dynamicKey(p);
    if (key) {
        const v = hunterDataCache[key];
        // 호출부는 문자열(보통 JSON 텍스트)을 기대하므로, hunter_data 에 Map/List 로 저장된 경우 직렬화한다.
        if (v !== undefined && v !== null) return (typeof v === 'string') ? v : JSON.stringify(v);
        // 캐시에 없으면 DB/hunter/ 의 시드 파일을 기본값으로 사용(최초 save 시 hunter_data 로 이관됨).
        try { return fs.readFileSync(resolveDataPath(p), 'utf8'); } catch (e) { return null; }
    }
    try {
        return fs.readFileSync(resolveDataPath(p), 'utf8');
    } catch (e) {
        return null;
    }
}
function save(p, data) {
    const key = dynamicKey(p);
    if (key) {
        hunterDataCache[key] = data;
        persistHunterData(key, data);
        return data;
    }
    const full = resolveDataPath(p);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, data, 'utf8');
    return data;
}
function fileExists(p) {
    const key = dynamicKey(p);
    if (key) return (key in hunterDataCache);
    try { return fs.existsSync(resolveDataPath(p)); } catch (e) { return false; }
}

// ───────────────────────────────────────────────────────────── 프로토타입 헬퍼
// new_engine 이 일부(Number.toComma/fix, Array.shuffle/remove/unique/getRandomElement/multiplyKey)를
// 이미 전역 정의하므로, 중복 정의를 피하기 위해 미정의된 것만 가드 후 정의한다.
function numberWithCommas(x) {
    return x.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
if (!Number.prototype.fix) {
    Number.prototype.fix = function (num) {
        if (!num) num = 2;
        return Math.round(this * Math.pow(10, num)) / Math.pow(10, num);
    };
}
if (!Number.prototype.toComma) {
    Number.prototype.toComma = function () {
        var abs = Math.abs(this), formatted, suffix;
        if (abs >= 1e52) { formatted = ""; suffix = "측정 불가"; }
        else if (abs >= 1e48) { formatted = (this / 1e48).fix(); suffix = "극"; }
        else if (abs >= 1e44) { formatted = (this / 1e44).fix(); suffix = "재"; }
        else if (abs >= 1e40) { formatted = (this / 1e40).fix(); suffix = "정"; }
        else if (abs >= 1e36) { formatted = (this / 1e36).fix(); suffix = "간"; }
        else if (abs >= 1e32) { formatted = (this / 1e32).fix(); suffix = "구"; }
        else if (abs >= 1e28) { formatted = (this / 1e28).fix(); suffix = "양"; }
        else if (abs >= 1e24) { formatted = (this / 1e24).fix(); suffix = "자"; }
        else if (abs >= 1e20) { formatted = (this / 1e20).fix(); suffix = "해"; }
        else if (abs >= 1e16) { formatted = (this / 1e16).fix(); suffix = "경"; }
        else if (abs >= 1e12) { formatted = (this / 1e12).fix(); suffix = "조"; }
        else if (abs >= 1e8) { formatted = (this / 1e8).fix(); suffix = "억"; }
        else if (abs >= 1e4) { formatted = (this / 1e4).fix(); suffix = "만"; }
        else { return numberWithCommas(this.toString()); }
        return numberWithCommas(formatted.toString()) + suffix;
    };
}
if (!Number.prototype.toComma2) {
    Number.prototype.toComma2 = function () { return numberWithCommas(this.toString()); };
}
if (!Number.prototype.toRoman) {
    Number.prototype.toRoman = function () {
        var digits = String(+this).split("");
        var key = ["", "C", "CC", "CCC", "CD", "D", "DC", "DCC", "DCCC", "CM",
            "", "X", "XX", "XXX", "XL", "L", "LX", "LXX", "LXXX", "XC",
            "", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX"];
        var roman = "";
        var i = 3;
        while (i--) { roman = (key[+digits.pop() + (i * 10)] || "") + roman; }
        return Array(+digits.join("") + 1).join("M") + roman;
    };
}
if (!String.prototype.replaceNumber) {
    String.prototype.replaceNumber = function () {
        var units = { '만': 1e4, '억': 1e8, '조': 1e12, '경': 1e16, '해': 1e20 };
        return this.replace(/([0-9]+\.?[0-9]*)([만억조경해])/g, function (match, num, unit) {
            return String(parseFloat(num, 10) * units[unit]);
        });
    };
}
if (!String.prototype.toComma) {
    String.prototype.toComma = function () {
        var num = parseFloat(this);
        if (isNaN(num)) return numberWithCommas(this);
        var abs = Math.abs(num), formatted, suffix;
        if (abs >= 1e12) { formatted = (num / 1e12).toFixed(1); suffix = "조"; }
        else if (abs >= 1e8) { formatted = (num / 1e8).toFixed(1); suffix = "억"; }
        else if (abs >= 1e4) { formatted = (num / 1e4).toFixed(1); suffix = "만"; }
        else { return numberWithCommas(this); }
        return numberWithCommas(formatted.toString()) + suffix;
    };
}
if (!Array.prototype.shuffle) {
    Array.prototype.shuffle = function (num) {
        if (!num || isNaN(num) || num < 1 || num % 1 != 0) num = 1;
        const source_array = this.concat();
        const arrayLength = source_array.length;
        for (let k = 0; k < num; k++) {
            for (let i = 0; i < arrayLength; i++) {
                const randomIndex = Math.floor(Math.random() * arrayLength);
                if (randomIndex != i) [source_array[i], source_array[randomIndex]] = [source_array[randomIndex], source_array[i]];
            }
        }
        return source_array;
    };
}
if (!Array.prototype.getRandomElement) {
    Array.prototype.getRandomElement = function () { return this[Math.floor(Math.random() * this.length)]; };
}
if (!Array.prototype.remove) {
    Array.prototype.remove = function (element) {
        if (this.indexOf(element) == -1) return this;
        this.splice(this.indexOf(element), 1);
        return this;
    };
}
if (!Array.prototype.unique) {
    Array.prototype.unique = function () {
        var seen = {}, unique = [];
        for (var i = 0; i < this.length; i++) {
            if (!seen[this[i]]) { seen[this[i]] = true; unique.push(this[i]); }
        }
        return unique;
    };
}

// ───────────────────────────────────────────────────────────── 한글 유틸
const CHOSEONG = ["ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
const JUNGSEONG = ["ㅏ", "ㅐ", "ㅑ", "ㅒ", "ㅓ", "ㅔ", "ㅕ", "ㅖ", "ㅗ", "ㅘ", "ㅙ", "ㅚ", "ㅛ", "ㅜ", "ㅝ", "ㅞ", "ㅟ", "ㅠ", "ㅡ", "ㅢ", "ㅣ"];
const JONGSEONG = ["", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ", "ㄻ", "ㄼ", "ㄽ", "ㄾ", "ㄿ", "ㅀ", "ㅁ", "ㅂ", "ㅄ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];

function dec_han(s) {
    if (s.match(/[^가-힣ㄱ-ㅎ]/gi) != null) return s;
    const ga = 44032;
    let uni = s.charCodeAt(0) - ga;
    let fn = parseInt(uni / 588);
    let sn = parseInt((uni - (fn * 588)) / 28);
    let tn = parseInt(uni % 28);
    return CHOSEONG[fn] + JUNGSEONG[sn] + JONGSEONG[tn];
}
function com_han(s) {
    if (s.match(/[^가-힣ㄱ-ㅎㅏ-ㅣ]/gi) != null) return s;
    let cho = CHOSEONG.indexOf(s[0]);
    let jung = JUNGSEONG.indexOf(s[1]);
    let jong = (s[2] == undefined ? 0 : JONGSEONG.indexOf(s[2]));
    return String.fromCharCode(0xAC00 + cho * 588 + jung * 28 + jong);
}
function pad_han(kor, max_len) {
    if (kor.length >= max_len) return kor;
    return kor + (new Array(max_len - kor.length + 1).join("ㅤ"));
}
function pad_num(kor, max_len) {
    if (typeof kor != 'string') kor = kor.toString();
    max_len = max_len || 2;
    if (kor.length >= max_len) return kor;
    return (new Array(max_len - kor.length + 1).join("0")) + kor;
}
function getRandomString(len) {
    const chars = '023456789ABCDEFGHJKLMNOPQRSTUVWXTZabcdefghikmnopqrstuvwxyz';
    let randomstring = '';
    for (let i = 0; i < len; i++) {
        randomstring += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return randomstring;
}

// ───────────────────────────────────────────────────────────── 헌터 레이팅
function getActivated(stats) {
    let results = [];
    for (let stat in stats) {
        if (Math.random() < stats[stat]) results.push(stat);
    }
    return results;
}
function getHunterRate(winner, loser) {
    const K_FACTOR = 15;
    const expectedScore = 1 / (1 + Math.pow(10, (loser.hunterRate - winner.hunterRate) / 400));
    return Math.ceil((1 - expectedScore) * K_FACTOR);
}
function getTier(rating) {
    if (rating < 50) return "Unranked F";
    else if (rating < 100) return "Unranked E-";
    else if (rating < 150) return "Unranked E";
    else if (rating < 200) return "Unranked E+";
    else if (rating < 250) return "Unranked D-";
    else if (rating < 300) return "Unranked D";
    else if (rating < 350) return "Unranked D+";
    else if (rating < 400) return "Unranked C-";
    else if (rating < 450) return "Unranked C";
    else if (rating < 500) return "Unranked C+";
    else if (rating < 550) return "Unranked B-";
    else if (rating < 600) return "Unranked B";
    else if (rating < 650) return "Unranked B+";
    else if (rating < 700) return "Unranked A-";
    else if (rating < 750) return "Unranked A";
    else if (rating < 800) return "Unranked A+";
    else if (rating < 850) return "Unranked S-";
    else if (rating < 900) return "Unranked S";
    else if (rating < 950) return "Unranked S+";
    else if (rating < 1000) return "Semiranked";
    else if (rating < 1050) return "아이언Ⅳ";
    else if (rating < 1100) return "아이언Ⅲ";
    else if (rating < 1150) return "아이언Ⅱ";
    else if (rating < 1200) return "아이언Ⅰ";
    else if (rating < 1250) return "브론즈Ⅳ";
    else if (rating < 1300) return "브론즈Ⅲ";
    else if (rating < 1350) return "브론즈Ⅱ";
    else if (rating < 1400) return "브론즈Ⅰ";
    else if (rating < 1450) return "실버Ⅳ";
    else if (rating < 1500) return "실버Ⅲ";
    else if (rating < 1550) return "실버Ⅱ";
    else if (rating < 1600) return "실버Ⅰ";
    else if (rating < 1650) return "골드Ⅳ";
    else if (rating < 1700) return "골드Ⅲ";
    else if (rating < 1750) return "골드Ⅱ";
    else if (rating < 1800) return "골드Ⅰ";
    else if (rating < 1850) return "플레티넘Ⅳ";
    else if (rating < 1900) return "플레티넘Ⅲ";
    else if (rating < 1950) return "플레티넘Ⅱ";
    else if (rating < 2000) return "플레티넘Ⅰ";
    else if (rating < 2050) return "에메랄드Ⅳ";
    else if (rating < 2100) return "에메랄드Ⅲ";
    else if (rating < 2150) return "에메랄드Ⅱ";
    else if (rating < 2200) return "에메랄드Ⅰ";
    else if (rating < 2250) return "다이아Ⅳ";
    else if (rating < 2300) return "다이아Ⅲ";
    else if (rating < 2350) return "다이아Ⅱ";
    else if (rating < 2400) return "다이아Ⅰ";
    else return "마스터";
}

// ───────────────────────────────────────────────────────────── User (DynamoDB: user_data)
function User(name, id) {
    this._get = 1;
    this.id = id;
    this.name = name;
    this.isAdmin = false;
    this.isRPG = false;
    this.code = getRandomString(10).toUpperCase();
    this.logged_in = [id];
    this.rank = -1;
    this.rate = null;
    this.lp = 0;
    this.playing = {};
    this.money = 10000;
    this.stocks = [];
    this.stockInit = false;
    this.arbeit = null;
    this.inventory = [];
    this.equips = { weapon: { name: "맨손", tier: "-" }, armor: { name: "평상복", tier: "-" }, artifact: [] };
    this.cash = 0;
    this.title = null;
    this.character_setting = null;
    this.entered_coupon = [];
    this.hunterRate = 1500;
    this.initHunterRate = "F";
    this.lastHunterRate = null;
    this.remainArcana = 100;
    this.guild = null;
    this.pet = { name: null, level: 0, damage: 0 };
    this.equipSet = [null, null, null];
    this.gem = 0;
    this.init = { artifact: false };
    this.artifactMaxSlot = 3;
    this.stat = { str: 0, def: 0, int: 0 };
    this.titles = [];
    this.tbTicket = 0;
    this.tbCoupon = [];
    this.credit = 0;
    this.restricted = {};
    this.notified = 0;
}
User.prototype.load = function (data) {
    this.name = data.name;
    this.id = data.id;
    this.isAdmin = data.isAdmin;
    this.isRPG = data.isRPG || false;
    this.code = data.code;
    this.logged_in = data.logged_in;
    this.rank = data.rank;
    this.rate = data.rate ? Number(data.rate) : null;
    this.lp = Number(data.lp);
    this.playing = data.playing;
    this.money = Number(data.money) || (data.money == 0 ? 0 : 10000);
    this.stocks = data.stocks || [];
    this.stockInit = data.stockInit || false;
    this.arbeit = data.arbeit || null;
    this.inventory = data.inventory || [];
    this.equips = data.equips || { weapon: { name: "맨손", tier: "-" }, armor: { name: "평상복", tier: "-" }, artifact: [] };
    this.cash = data.cash || 0;
    this.title = data.title || null;
    this.character_setting = data.character_setting || null;
    this.entered_coupon = data.entered_coupon || [];
    this.hunterRate = data.hunterRate || 1500;
    this.initHunterRate = data.initHunterRate || "F";
    this.challenged = data.challenged || 0;
    this.lastHunterRate = data.lastHunterRate || null;
    this.remainArcana = data.remainArcana || (data.remainArcana == 0 ? 0 : 100);
    this.guild = data.guild || null;
    this.pet = data.pet || { name: null, level: 0, damage: 0 };
    this.equipSet = data.equipSet || [null, null, null];
    this.gem = data.gem || 0;
    this.location = data.location || null;
    this.state = data.state || null;
    this.init = data.init || { artifact: false };
    this.artifactMaxSlot = data.artifactMaxSlot || 3;
    this.stat = data.stat || { str: 0, def: 0, int: 0 };
    this.titles = data.titles || [];
    this.tbTicket = data.tbTicket || 0;
    this.tbCoupon = data.tbCoupon || [];
    this.credit = data.credit || 0;
    this.restricted = data.restricted || {};
    this.notified = data.notified || 0;
    return this;
};
User.prototype.toString = function () {
    return (this.title ? "[" + this.title + "] " : "") + this.name;
};
User.prototype.save = function () {
    return saveUser(this);
};
User.prototype.giveItem = function (item) {
    if (!item.tier) {
        if (this.inventory.find(i => i.name == item.name)) {
            this.inventory.find(i => i.name == item.name).count += item.count;
        } else {
            this.inventory.push(item);
        }
    } else {
        if (this.inventory.find(i => i.name == item.name)) {
            this.inventory.find(i => i.name == item.name + "의 조각").count += (item.count * 100);
        } else {
            this.inventory.push(item);
        }
    }
};
User.prototype.hasItem = function (item) {
    return (this.inventory.find(i => i.name == item) && this.inventory.find(i => i.name == item).count > 0);
};
User.prototype.getStat = function () {
    return {
        str: this.stat.str,
        int: this.stat.int + (this.equips.artifact.includes("증폭의 구슬") && this.stat.int >= 10 ? Math.round(this.stat.int * 0.5) : 0),
        def: this.stat.def + (this.equips.artifact.includes("탐욕의 구슬") && this.stat.def >= 10 ? Math.round(this.stat.def * 0.5) : 0)
    };
};

async function getUserById(id) {
    let payload = {
        TableName: USER_TABLE,
        IndexName: "getIdx",
        KeyConditionExpression: "#gsi_partition_key = :gsi_value",
        FilterExpression: "contains(logged_in, :userid_val)",
        ExpressionAttributeNames: { "#gsi_partition_key": "_get" },
        ExpressionAttributeValues: { ":gsi_value": 1, ":userid_val": id }
    };
    while (true) {
        try {
            const res = await docClient.send(new QueryCommand(payload));
            if (res.Items && res.Items[0]) return new User().load(res.Items[0]);
            if (!res.LastEvaluatedKey) break;
            payload.ExclusiveStartKey = res.LastEvaluatedKey;
        } catch (e) {
            console.error('[hunter getUserById]', e.message);
            break;
        }
    }
    return null;
}
async function getUserByName(name) {
    try {
        const res = await docClient.send(new QueryCommand({
            TableName: USER_TABLE,
            IndexName: "nameIdx",
            KeyConditionExpression: "#name = :name_val",
            FilterExpression: "#get = :get",
            ExpressionAttributeNames: { "#name": "name", "#get": "_get" },
            ExpressionAttributeValues: { ":name_val": name, ":get": 1 }
        }));
        if (res.Items && res.Items[0]) return new User().load(res.Items[0]);
    } catch (e) { console.error('[hunter getUserByName]', e.message); }
    return null;
}
async function getUserByCode(code) {
    try {
        const res = await docClient.send(new QueryCommand({
            TableName: USER_TABLE,
            IndexName: "codeIdx",
            KeyConditionExpression: "#code = :code_val",
            FilterExpression: "#get = :get",
            ExpressionAttributeNames: { "#code": "code", "#get": "_get" },
            ExpressionAttributeValues: { ":code_val": code, ":get": 1 }
        }));
        if (res.Items && res.Items[0]) return new User().load(res.Items[0]);
    } catch (e) { console.error('[hunter getUserByCode]', e.message); }
    return null;
}
// old_engine updateItem('user_data', id, user): id 를 제외한 모든 필드를 SET.
async function saveUser(user) {
    const data = {};
    for (const k of Object.keys(user)) {
        if (k === 'id' || typeof user[k] === 'function') continue;
        data[k] = user[k];
    }
    const names = {};
    const values = {};
    const sets = Object.keys(data).map(k => {
        names["#" + k] = k;
        values[":new_" + k] = data[k];
        return "#" + k + "=:new_" + k;
    });
    try {
        await docClient.send(new UpdateCommand({
            TableName: USER_TABLE,
            Key: { id: user.id },
            UpdateExpression: "SET " + sets.join(","),
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values
        }));
    } catch (e) { console.error('[hunter saveUser]', e.message); }
    return user;
}

// old_engine putItem(table, item): 단순 PutCommand. (메서드는 프로토타입에 있어 직렬화 제외됨)
async function putItem(table, item) {
    const { PutCommand } = require('@aws-sdk/lib-dynamodb');
    try {
        await docClient.send(new PutCommand({ TableName: table, Item: item }));
        return { success: true };
    } catch (e) {
        console.error('[hunter putItem]', table, e.message);
        return { success: false };
    }
}

// ───────────────────────────────────────────────────────────── HuntGame (DynamoDB: hunt)
function HuntGame(hostId, player, tempObj, dungeon) {
    this.hostId = hostId;
    this.player = player;
    this.tempObj = tempObj;
    this.dungeon = dungeon;
}
HuntGame.prototype.load = function (data) {
    this.hostId = data.hostId;
    this.player = data.player;
    this.tempObj = data.tempObj;
    this.dungeon = data.dungeon;
    return this;
};
HuntGame.prototype.save = function () {
    const data = {};
    for (const k of Object.keys(this)) {
        if (k === 'hostId' || typeof this[k] === 'function') continue;
        data[k] = this[k];
    }
    const names = {};
    const values = {};
    const sets = Object.keys(data).map(k => {
        names["#" + k] = k;
        values[":new_" + k] = data[k];
        return "#" + k + "=:new_" + k;
    });
    return docClient.send(new UpdateCommand({
        TableName: HUNT_TABLE,
        Key: { hostId: this.hostId },
        UpdateExpression: "SET " + sets.join(","),
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values
    })).catch(e => console.error('[hunter HuntGame.save]', e.message));
};
HuntGame.prototype.remove = function () {
    return docClient.send(new DeleteCommand({
        TableName: HUNT_TABLE,
        Key: { hostId: this.hostId }
    })).then(() => true).catch(e => { console.error('[hunter HuntGame.remove]', e.message); return false; });
};
HuntGame.prototype.end = async function () {
    let user = await getUserById(this.hostId);
    let rewards = [];
    user.playing.hunt.reward.forEach(r => {
        if (r.type == "코인") {
            user.cash += r.count;
            rewards.push("- 🪙 " + r.count.toComma());
        } else {
            let count = r.count;
            if (user.inventory.find(item => item.name == r.name)) {
                if (!user.inventory.find(item => item.name == r.name).tier) {
                    user.inventory.find(item => item.name == r.name).count += count;
                    rewards.push("- " + r.name + " x" + count.toComma());
                } else {
                    if (user.inventory.find(item => item.name == r.name + "의 조각")) {
                        user.inventory.find(item => item.name == r.name + "의 조각").count += 100;
                    } else {
                        user.inventory.push({ name: r.name + "의 조각", type: "재료", count: 100 });
                    }
                    rewards.push("- " + r.name + "의 조각 x100");
                }
            } else {
                let newItem = { name: r.name, type: r.type, count: count };
                if (r.tier) newItem.tier = r.tier;
                user.inventory.push(newItem);
                rewards.push("- " + (r.tier ? "[" + r.tier + "] " : "") + r.name + (r.tier ? "" : " x" + count.toComma()));
            }
        }
    });
    delete user.playing.hunt;
    await user.save();
    await this.remove();
    return rewards;
};
async function getHuntById(hostId) {
    try {
        const res = await docClient.send(new GetCommand({ TableName: HUNT_TABLE, Key: { hostId: hostId } }));
        if (res.Item) return new HuntGame().load(res.Item);
    } catch (e) { console.error('[hunter getHuntById]', e.message); }
    return null;
}

async function getDeletedUserByName(name) {
    try {
        const res = await docClient.send(new QueryCommand({
            TableName: USER_TABLE,
            IndexName: "nameIdx",
            KeyConditionExpression: "#name = :name_val",
            ExpressionAttributeNames: { "#name": "name" },
            ExpressionAttributeValues: { ":name_val": name }
        }));
        if (res.Items && res.Items[0]) {
            let findUser = new User().load(res.Items[0]);
            return findUser._get == 1 ? null : findUser;
        }
    } catch (e) { console.error('[hunter getDeletedUserByName]', e.message); }
    return null;
}
// old_engine: DynamoDB Query on ihrIdx (initHunterRate index). 헌터 랭킹/시즌 집계용.
async function getHuntersByInitRate(val) {
    let users = [];
    let payload = {
        TableName: USER_TABLE,
        IndexName: "ihrIdx",
        KeyConditionExpression: "#gsi_partition_key = :gsi_value",
        ExpressionAttributeNames: { "#gsi_partition_key": "initHunterRate" },
        ExpressionAttributeValues: { ":gsi_value": val }
    };
    try {
        while (true) {
            const res = await docClient.send(new QueryCommand(payload));
            if (res.Items) users = users.concat(res.Items.map(r => new User().load(r)));
            if (!res.LastEvaluatedKey) break;
            payload.ExclusiveStartKey = res.LastEvaluatedKey;
        }
    } catch (e) { console.error('[hunter getHuntersByInitRate]', e.message); }
    return users;
}

// 전투 종료 후, processHunt 가 동기 처리하지 못한 부작용(풍선 선물 등) 일괄 지급.
async function applyCombatSideEffects(tempObj) {
    if (!tempObj || !tempObj.giveItems || !tempObj.giveItems.length) return;
    const items = tempObj.giveItems;
    tempObj.giveItems = [];
    for (const g of items) {
        const u = await getUserByName(g.name);
        if (!u) continue;
        u.giveItem(g.item);
        await u.save();
    }
}

function toTimeNotation(sec, time) {
    sec = Math.max(0, Math.floor(sec));
    let h = Math.floor(sec / 3600);
    let m = Math.floor((sec % 3600) / 60);
    let s = sec % 60;
    let parts = [];
    if (h) parts.push(h + "시간");
    if (m) parts.push(m + "분");
    if (s || parts.length == 0) parts.push(s + "초");
    return parts.join(" ");
}

// java.lang.Runnable / Thread 셰임: old_engine 의 백그라운드 스레드 패턴을 그대로 사용하기 위함.
// run 함수는 이식 과정에서 async 로 바뀌며, start() 는 fire-and-forget(원본 스레드와 동일 의미).
const java = {
    lang: {
        Runnable: function (obj) { this.run = obj.run; },
        Thread: function (runnable) {
            this.start = () => {
                Promise.resolve().then(() => runnable.run()).catch(e => console.error('[hunter thread]', e && (e.stack || e)));
            };
        }
    }
};

// ───────────────────────────────────────────────────────────── NPC / 검열 (Claude API)
const ClaudeAPIKEY = process.env.CLAUDE_API_KEY;
async function ClaudeSonnet(data) {
    try {
        const res = await axios.post('https://api.anthropic.com/v1/messages', data, {
            headers: {
                'Content-Type': 'application/json',
                'anthropic-version': '2023-06-01',
                'x-api-key': ClaudeAPIKEY
            }
        });
        return res.data;
    } catch (e) {
        return e.response ? e.response.data : { message: e.message };
    }
}
async function Claude(prompts, model, system) {
    return ClaudeSonnet({ model: model, messages: prompts, max_tokens: 4096, system: system });
}
// old_engine 의 NPC 대사 파서. content 가 locNpcs 중 하나로 시작하면 [npc, 메시지] 반환.
function parseNpc(content, locNpcs) {
    let target = null, message = null;
    for (let i = 0; i < locNpcs.length; i++) {
        const npc = locNpcs[i];
        if (content.startsWith(npc)) { target = npc; message = content.substring(npc.length).trim(); break; }
    }
    return [target, message];
}
async function checkBadWord(message) {
    let res;
    try {
        res = await ClaudeSonnet({
            model: "claude-3-5-haiku-20241022",
            max_tokens: 2048,
            system: "당신의 역할은 특정 문장을 입력받으면 해당 문장에 부적절한 단어가 포함되어 있는지를 확인하고 json 형태로 응답하는 것입니다.\n부적절한 단어 확인: (문장)\n위와 같은 형태로 입력받으면 아래 json 형태 양식대로 답변하면 됩니다.\n\njson 형태의 양식은 아래와 같습니다.\n\n{\"ban\": (부적절한 단어가 포함되어 있을 경우 true, 아닐 경우 false), \"censored\": \"(부적절한 단어를 검열한 문장)\", \"reason\": \"(ban이 true일 경우, 해당 문장이 부적절한 단어인 이유)\", \"list\": [(감지된 욕설 목록)] }\n\n부적절한 단어를 검열할 땐 글자수만큼 x를 사용합니다.\n예: 씨발 -> xx, 개1새끼 -> xxx\n\n부적절한 단어는 '국내 기준' 음란성을 띄거나 욕설, 비속어인 경우입니다.\n사람 이름 등 일상적으로 비속어로 사용하지 않는 단어는 제외합니다.\n\njson 형태와 다른 양식으로 대답할 경우 오류가 발생하므로, 무조건 json 형태의 양식으로만 답변하세요.",
            messages: [
                { role: "user", content: "부적절한 단어 확인: 안녕 병1신 개새끼야 씨@발" },
                { role: "assistant", content: "{\"ban\": true, \"censored\": \"안녕 xx xxx야 xx\", \"reason\": \"욕설이 3개 포함되어 있습니다.\", \"list\": [\"병신\", \"개새끼\", \"씨발\"]}" },
                { role: "user", content: "부적절한 단어 확인: 븅신아 쎆스나 해" },
                { role: "assistant", content: "{\"ban\": true, \"censored\": \"xx아 xx나 해\", \"reason\": \"욕설과 선정적인 표현이 포함되어 있습니다.\", \"list\": [\"븅신\", \"쎆스\"]}" },
                { role: "user", content: "부적절한 단어 확인: " + message }
            ]
        });
    } catch (e) {
        return { ban: true, result: null, error: e };
    }
    if (res.content && res.content[0] && res.content[0].text) {
        try { return JSON.parse(res.content[0].text); }
        catch (e) { return { ban: true, result: null, error: e }; }
    }
    return { ban: true, result: null, error: null };
}

// ───────────────────────────────────────────────────────────── 전투 엔진 / 명령 핸들러
// (combat engine processHunt, 명령 핸들러는 아래 섹션에 이어서 이식된다.)

// 동기 함수로 유지(이식 핵심): 내부의 DB 부작용 2건(풍선 선물 지급 / 솔로몬의 반지 펫 소환)을
// 비동기 호출 없이 처리한다. 풍선 보상은 tempObj.giveItems 큐에 적재 후 전투 종료 시
// applyCombatSideEffects() 로 지급하고, 솔로몬은 tempObj.id[actor] 로 유저 id 를 직접 참조한다.
function processHunt(tempObj, actor, victim) {
    let heal = function(target, num) {
        let healMul = 1;
        if (tempObj.effect[target].burn) healMul = 0.5;
        if (tempObj.effect[target].speared) healMul = 0.3;
        if (tempObj.effect[target].goblin) healMul = 0.25;
        if (tempObj.weapon[target].name == "뱀파이어의 송곳니" && tempObj.artifact[target].includes("아르카나 뱀파이어의 송곳니")) {
            let r = Math.random();
            if (r < 0.75) {
                logs.push("🟪 " + tempObj.name[target] + "의 피의 연회!");
                healMul = 1.2;
            }
        }
        if (tempObj.weapon[target].name == "혈성극검" && tempObj.weapon[target].tier >= 2) {
            let r = Math.random();
            if (r < 0.8) {
                logs.push("🟪 " + tempObj.name[target] + "의 피의 연회!");
                healMul = 1.35;
            }
            if (tempObj.weapon[target].tier >= 3) {
                if (!tempObj.stack[target].bloodstar) tempObj.stack[target].bloodstar = 0;
                let maxBS = 10;
                if (tempObj.weapon[target].tier >= 4) maxBS = 50;
                tempObj.stack[target].bloodstar = Math.min(maxBS, tempObj.stack[target].bloodstar + 1);
            }
        }
        if (tempObj.stack[target].redmoon_blood) {
            delete tempObj.stack[target].redmoon_blood;
            if (Math.round(num * healMul) > (tempObj.stat[target].maxHp - tempObj.stat[target].hp)) {
                let overheal = Math.round(num * healMul) - (tempObj.stat[target].maxHp - tempObj.stat[target].hp);
                if (! tempObj.stat[target].shield) tempObj.stat[target].shield = 0;
                tempObj.stat[target].shield += overheal;
                tempObj.logs.push(tempObj.name[target] + "의 보호막: " + tempObj.stat[target].shield + " (+" + overheal + ")");
            }
        }
        tempObj.stat[target].hp = Math.min(tempObj.stat[target].maxHp, tempObj.stat[target].hp + Math.round(num * healMul));
        tempObj.logs.push(tempObj.name[target] + "의 HP: " + tempObj.stat[target].hp.toComma() + "/" + tempObj.stat[target].maxHp.toComma() + " (+" + Math.round(num * healMul).toComma() + ")");
        if (tempObj.stack[target].redflower) {
            let v = tempObj.stack[target].redflower;
            delete tempObj.stack[target].redflower;
            dealt(target, v, {p:0,m:0,t:Math.round(num * healMul)});
        }
    }
    let dealt = function(a, v, dmg, isNormalAttack, other) {
        if (other && other.isCounter && tempObj.weapon[v].name == "천상유랑검" && tempObj.weapon[v].tier >= 2) {
            let r = Math.random();
            let percent = 0.25;
            if (tempObj.weapon[v].tier >= 3) percent = 0.35;
            if (r < percent) {
                logs.push("❇️ " + tempObj.name[v] + "의 반격 차단!");
                return;
            }
        }
        if (a == "true") {
            if (tempObj.armor[v].option && tempObj.armor[v].option.find(o => o.name == "모든 피해 감소")) {
                let num = tempObj.armor[v].option.filter(o => o.name == "모든 피해 감소").reduce((sum, o) => sum + o.num, 0);
                dmg.p = Math.max(0, dmg.p - Math.round(dmg.p * num));
                dmg.m = Math.max(0, dmg.m - Math.round(dmg.m * num));
                dmg.t = Math.max(0, dmg.t - Math.round(dmg.t * num));
            }
            if (tempObj.armor[v].option && tempObj.armor[v].option.find(o => o.name == "도트 피해 감소")) {
                let num = tempObj.armor[v].option.filter(o => o.name == "도트 피해 감소").reduce((sum, o) => sum + o.num, 0);
                dmg.p = Math.max(0, dmg.p - Math.round(dmg.p * num));
                dmg.m = Math.max(0, dmg.m - Math.round(dmg.m * num));
                dmg.t = Math.max(0, dmg.t - Math.round(dmg.t * num));
            }
            let finalDamage = Math.max(0, dmg.p + dmg.m + dmg.t);
            if (tempObj.armor[v].name == "여명의 갑주" && tempObj.armor[v].tier >= 7) {
                if (!tempObj.stack[v].dawn) tempObj.stack[v].dawn = 0;
                tempObj.stack[v].dawn += Math.round((dmg.p + dmg.m + dmg.t) * 0.45);
            }
            if (tempObj.armor[v].name == "방랑자의 천갑옷" && tempObj.artifact[v].includes("아르카나 방랑자의 천갑옷") && finalDamage >= tempObj.stat[v].hp) {
                let r = Math.random();
                let percent = (tempObj.stack[v].determined ? 0.4 : 1);
                if (r < percent) {
                    tempObj.stack[v].determined = 1;
                    tempObj.logs.push("🟪 " + tempObj.name[v] + "의 방랑자의 결의!");
                    finalDamage = tempObj.stat[v].hp - 1;
                    tempObj.effect[v].determ = {
                        turn: 5
                    };
                }
            }
            if (tempObj.stat[v].shield) {
                if (tempObj.armor[v].name == "석상 돌갑옷" && tempObj.artifact[v].includes("아르카나 석상 돌갑옷") && tempObj.stat[v].shield < finalDamage) {
                    tempObj.logs.push("🟪 " + tempObj.name[v] + "의 불멸의 석상!");
                    finalDamage = 0;
                    tempObj.stat[v].shield = 0;
                } else if (tempObj.stat[v].shield > finalDamage) {
                    tempObj.stat[v].shield -= finalDamage;
                    finalDamage = 0;
                } else {
                    finalDamage -= tempObj.stat[v].shield;
                    tempObj.stat[v].shield = 0;
                }
                let shieldDamage = Math.max(0, dmg.p + dmg.m + dmg.t) - finalDamage;
                tempObj.logs.push(tempObj.name[v] + "의 보호막: " + tempObj.stat[v].shield.toComma() + " (-" + shieldDamage.toComma() + ")");
            }
            tempObj.stat[v].hp = Math.max(0, tempObj.stat[v].hp - finalDamage);
            tempObj.logs.push(tempObj.name[v] + "의 HP: " + tempObj.stat[v].hp.toComma() + "/" + tempObj.stat[v].maxHp.toComma() + " (-" + finalDamage.toComma() + ")");
            if (tempObj.stat[v].hp > 0) {
                if (tempObj.armor[v].name == "핏빛 로브") {
                    if (!tempObj.stack[v].blood) tempObj.stack[v].blood = 0;
                    let plusStack = Math.round(finalDamage * 0.25);
                    if (tempObj.armor[v].tier >= 6) {
                        let r = Math.random();
                        if (r < 0.1) {
                            plusStack += Math.round(finalDamage * 0.75);
                        } else if (tempObj.armor[v].tier >= 4) {
                            plusStack += Math.round(dmg.p * 0.15);
                        }
                    } else if (tempObj.armor[v].tier >= 4) {
                        plusStack += Math.round(dmg.p * 0.15);
                    }
                    if (tempObj.artifact[v].includes("아르카나 핏빛 로브")) {
                        let lostHPratio = (tempObj.stat[v].maxHp - tempObj.stat[v].hp) / tempObj.stat[v].maxHp;
                        plusStack = Math.round(plusStack * (lostHPratio * 2));
                    }
                    tempObj.stack[v].blood += plusStack;
                    //logs.push(tempObj.name[v] + "의 공혈 중첩: " + tempObj.stack[v].blood.toComma() + " (+" + (tempObj.stack[v].blood - prevStack) + ")");
                    if (tempObj.stack[v].blood >= 200) {
                        let prevStack = tempObj.stack[v].blood;
                        tempObj.stack[v].blood = 0;
                        logs.push("❇️ " + tempObj.name[v] + "의 공혈!");
                        heal(v, prevStack);
                        if (tempObj.armor[v].tier >= 7) {
                            logs.push("❇️ " + tempObj.name[v] + "의 핏빛 저주!");
                            return dealt(v, other.a, {p:0,m:0,t:Math.round(prevStack * 0.5)});
                        }
                    }
                }
            } else {
                if (tempObj.weapon[v].name == "광살혈도" && tempObj.weapon[v].tier >= 7 && !tempObj.stack[v].frenzy) {
                    tempObj.stack[v].frenzy = true;
                    tempObj.stat[v].hp = tempObj.stat[v].maxHp;
                    tempObj.stat[v].shield = 0;
                    if (!tempObj.weapon[v].option) tempObj.weapon[v].option = [];
                    tempObj.weapon[v].option.push({
                        name: "모든 피해 증가",
                        num: 1
                    });
                    logs.push("❇️ " + tempObj.name[v] + "의 최후의 저항!");
                    tempObj.logs.push(tempObj.name[v] + "의 HP: " + tempObj.stat[v].hp.toComma() + "/" + tempObj.stat[v].maxHp.toComma() + " (+" + tempObj.stat[v].maxHp.toComma() + ")");
                }
            }
            if (tempObj.stat[v].hp <= 0) return true;
            else return false;
        }
        if (! tempObj.name[v]) {
            logs.push("❗ 오류 디버그: " + v);
            return;
        }
        if (tempObj.weapon[a].name == "소울 하베스터" && tempObj.weapon[a].tier >= 7 && (tempObj.stat[v].hp <= (tempObj.stat[v].maxHp * 0.14) || tempObj.stat[a].hp <= (tempObj.stat[a].maxHp * 0.04))) {
            logs.push("❇️ " + tempObj.name[a] + "의 밤의 처형자!");
            if (instantExecute(a, v)) return;
        }
        if (tempObj.effect[a].bleed && (dmg.p + dmg.m) > 0 && isNormalAttack) {
            dmg.p = dmg.p + Math.round(dmg.p * -Math.min(0.5, 0.1 * tempObj.effect[a].bleed.stack));
            dmg.m = dmg.m + Math.round(dmg.m * -Math.min(0.5, 0.1 * tempObj.effect[a].bleed.stack));
            logs.push("🩸 " + tempObj.name[a] + "(이)가 출혈로 인해 약해집니다!");
        }
        if (tempObj.stack[a].wizardSoul && dmg.m > 0) {
            logs.push("🟪 " + tempObj.name[a] + "의 마도의 영혼!");
            dmg.m += tempObj.stack[a].wizardSoul;
        }
        if (isNormalAttack && tempObj.weapon[a].enchant && tempObj.weapon[a].enchant.find(e => e.name == "필멸")) {
            logs.push("🪯 " + tempObj.name[a] + "의 필멸!");
            dmg.t += 15 * tempObj.weapon[a].enchant.find(e => e.name == "필멸").level;
        }
        if (tempObj.stat[a].str) dmg.p = Math.round(dmg.p * (1 + (tempObj.stat[a].str * 0.015)));
        if (tempObj.stat[a].int) dmg.m = Math.round(dmg.m * (1 + (tempObj.stat[a].int * 0.015)));
        if (tempObj.weapon[a].name == "천명즉살검" && tempObj.weapon[a].tier >= 7 && dmg.t > 0) {
            logs.push("❇️ " + tempObj.name[a] + "의 새벽 달빛의 관통!");
            dmg.t += Math.round(dmg.t * 0.35);
        }
        let originalDmg = dmg;
        let artifactResults = [];
        for(let i = 0; i < tempObj.artifact[a].length; i++) {
            if (dmg.p > 0 && tempObj.artifact[a][i] == "힘의 팔찌") {
                if (artifactResults.find(r => r.skill == "힘 증폭")) artifactResults.find(r => r.skill == "힘 증폭").count++;
                else artifactResults.push({skill:"힘 증폭",count:1,actor:a});
                dmg.p += Math.round(originalDmg.p * 0.1);
            } else if (dmg.m > 0 && tempObj.artifact[a][i] == "마력 팔찌") {
                if (artifactResults.find(r => r.skill == "마력 증폭")) artifactResults.find(r => r.skill == "마력 증폭").count++;
                else artifactResults.push({skill:"마력 증폭",count:1,actor:a});
                dmg.m += Math.round(originalDmg.m * 0.1);
            } else if (dmg.m > 0 && tempObj.artifact[a][i] == "고대의 눈알") {
                if (artifactResults.find(r => r.skill == "고대의 힘")) artifactResults.find(r => r.skill == "고대의 힘").count++;
                else artifactResults.push({skill:"고대의 힘",count:1,actor:a});
                dmg.m += Math.round(originalDmg.m * 0.15);
            } else if (tempObj.artifact[a][i] == "황금 팔찌" && (dmg.p + dmg.m + dmg.t) > 0) {
                if (artifactResults.find(r => r.skill == "황금빛 축복")) artifactResults.find(r => r.skill == "황금빛 축복").count++;
                else artifactResults.push({skill:"황금빛 축복",count:1,actor:a});
                dmg.p += Math.round(originalDmg.p * 0.2);
                dmg.m += Math.round(originalDmg.m * 0.2);
                dmg.t += Math.round(originalDmg.t * 0.2);
            } else if (tempObj.artifact[a][i] == "루나리 왕실 브로치" && JSON.parse(read("DB/evolution.json")).find(e => e.name == tempObj.weapon[a].name) && (dmg.p + dmg.m + dmg.t) > 0) {
                if (artifactResults.find(r => r.skill == "감싸는 달빛의 축복")) artifactResults.find(r => r.skill == "감싸는 달빛의 축복").count++;
                else artifactResults.push({skill:"감싸는 달빛의 축복",count:1,actor:a});
                dmg.p += Math.round(originalDmg.p * 0.25);
                dmg.m += Math.round(originalDmg.m * 0.25);
                dmg.t += Math.round(originalDmg.t * 0.25);
            } else if (tempObj.artifact[a][i] == "홍월의 루나리 왕실 브로치" && JSON.parse(read("DB/evolution.json")).find(e => e.name == tempObj.weapon[a].name) && (dmg.p + dmg.m + dmg.t) > 0) {
                if (artifactResults.find(r => r.skill == "붉은 달빛의 축복")) artifactResults.find(r => r.skill == "붉은 달빛의 축복").count++;
                else artifactResults.push({skill:"붉은 달빛의 축복",count:1,actor:a});
                dmg.p += Math.round(originalDmg.p * 0.35);
                dmg.m += Math.round(originalDmg.m * 0.35);
                dmg.t += Math.round(originalDmg.t * 0.35);
            } else if (isNormalAttack && tempObj.artifact[a][i] == "늑대 이빨 목걸이") {
                let r = Math.random();
                if (r < 0.75) {
                    logs.push("❇️ " + tempObj.name[a] + "의 늑대의 영혼!");
                    if (dealt(a, v, {p:40,m:0,t:0})) return;
                }
            } else if (isNormalAttack && tempObj.artifact[a][i] == "라이칸 팔찌") {
                if (artifactResults.find(r => r.skill == "늑대의 포효")) artifactResults.find(r => r.skill == "늑대의 포효").count++;
                else artifactResults.push({skill:"늑대의 포효",count:1,actor:a});
                dmg.p += 135;
                let r = Math.random();
                if (r < 0.15) {
                    instantFear(a, v);
                }
            } else if (isNormalAttack && tempObj.artifact[a][i] == "홍월의 라이칸 팔찌") {
                if (artifactResults.find(r => r.skill == "붉은 늑대의 포효")) artifactResults.find(r => r.skill == "붉은 늑대의 포효").count++;
                else artifactResults.push({skill:"붉은 늑대의 포효",count:1,actor:a});
                dmg.p += 250;
                let r = Math.random();
                if (r < 0.25) {
                    instantFear(a, v);
                }
            } else if (isNormalAttack && tempObj.artifact[a][i] == "사파이어 목걸이") {
                if (artifactResults.find(r => r.skill == "푸른 마법")) artifactResults.find(r => r.skill == "푸른 마법").count++;
                else artifactResults.push({skill:"푸른 마법",count:1,actor:a});
                dmg.m += Math.round(tempObj.stat[a].maxHp * 0.05);
            } else if (isNormalAttack && tempObj.artifact[a][i] == "홍월의 사파이어 목걸이") {
                if (artifactResults.find(r => r.skill == "붉은 마법")) artifactResults.find(r => r.skill == "붉은 마법").count++;
                else artifactResults.push({skill:"붉은 마법",count:1,actor:a});
                dmg.m += Math.round(tempObj.stat[a].maxHp * 0.1);
            } else if (dmg.p > 0 && tempObj.artifact[a][i] == "혈사조") {
                if (artifactResults.find(r => r.skill == "갈퀴")) artifactResults.find(r => r.skill == "갈퀴").count++;
                else artifactResults.push({skill:"갈퀴",count:1,actor:a});
                dmg.p += Math.round(originalDmg.p * 0.25);
            } else if (dmg.p > 0 && tempObj.artifact[a][i] == "홍월의 혈사조") {
                if (artifactResults.find(r => r.skill == "갈퀴")) artifactResults.find(r => r.skill == "갈퀴").count++;
                else artifactResults.push({skill:"갈퀴",count:1,actor:a});
                dmg.p += Math.round(originalDmg.p * 0.35);
            } else if (tempObj.artifact[a][i] == "디스트로이어" && (dmg.p + dmg.m + dmg.t) > 0) {
                if (artifactResults.find(r => r.skill == "운명의 종결자")) artifactResults.find(r => r.skill == "운명의 종결자").count++;
                else artifactResults.push({skill:"운명의 종결자",count:1,actor:a});
                dmg.p += Math.round(originalDmg.p * 0.75);
                dmg.m += Math.round(originalDmg.m * 0.75);
                dmg.t += Math.round(originalDmg.t * 0.75);
            }
        }
        artifactResults.forEach(r => {
            logs.push("❇️ " + tempObj.name[r.actor] + "의 " + r.skill + (r.count > 1 ? " x" + r.count : "") + "!");
        });
        if (tempObj.artifact[a].includes("홍월의 네크로노미콘") && dmg.m > 0) {
            logs.push("❇️ " + tempObj.name[a] + "의 사자(死者)의 저주!");
            dmg.t += getPercentMaxHP(v, 0.015);
        }
        if (tempObj.armor[v].name == "마법사의 로브" && tempObj.artifact[v].includes("아르카나 마법사의 로브") && dmg.m > 0) {
            if (!tempObj.stack[v].wizardSoul) tempObj.stack[v].wizardSoul = 0;
            tempObj.stack[v].wizardSoul += 5 * tempObj.artifact[v].filter(a => a == "아르카나 마법사의 로브").length;
        }
        if (tempObj.armor[a].name == "마법사의 로브" && tempObj.artifact[a].includes("아르카나 마법사의 로브") && dmg.m > 0) {
            if (!tempObj.stack[a].wizardSoul) tempObj.stack[a].wizardSoul = 0;
            tempObj.stack[a].wizardSoul += 5 * tempObj.artifact[a].filter(a => a == "아르카나 마법사의 로브").length;
        }
        if (tempObj.armor[a].name == "방랑자의 천갑옷" && tempObj.armor[a].tier >= 4 && tempObj.effect[a].revenge) {
            logs.push("❇️ " + tempObj.name[a] + "의 복수!");
            dmg.p = dmg.p + Math.round(originalDmg.p * 0.5);
            dmg.m = dmg.m + Math.round(originalDmg.m * 0.5);
            dmg.t = dmg.t + Math.round(originalDmg.t * 0.5);
            delete tempObj.effect[a].revenge;
        }
        if (tempObj.weapon[a].name == "별빛 지팡이" && tempObj.artifact[a].includes("아르카나 별빛 지팡이") && tempObj.stat[a].shield) {
            dmg.m = dmg.m + Math.round(originalDmg.m * 0.5);
        }
        if (tempObj.weapon[a].name == "셀레스티아" && tempObj.weapon[a].tier >= 3 && tempObj.stat[a].shield) {
            dmg.m = dmg.m + Math.round(originalDmg.m * 1);
        }
        if (tempObj.effect[a].magicpower) {
            dmg.m = dmg.m + Math.round(originalDmg.m * 0.12);
        }
        if (tempObj.stack[a].magicCurse) {
            dmg.m = dmg.m + Math.round(originalDmg.m * (0.05 * tempObj.stack[a].magicCurse));
        }
        
        if (isNormalAttack) {
            if (tempObj.weapon[a].enchant && tempObj.weapon[a].enchant.find(e => e.name == "보호막 파괴") && tempObj.stat[v].shield) {
                let shieldDamage = Math.round(tempObj.stat[v].shield * (0.1 * tempObj.weapon[a].enchant.find(e => e.name == "보호막 파괴").level));
                tempObj.stat[v].shield -= shieldDamage;
                logs.push("🪯 " + tempObj.name[a] + "의 보호막 파괴!");
                logs.push(tempObj.name[v] + "의 보호막: " + tempObj.stat[v].shield.toComma() + " (-" + shieldDamage.toComma() + ")");
            }
            if (tempObj.weapon[a].option && tempObj.weapon[a].option.find(o => o.name == "기본 공격 피해 증가")) {
                let num = tempObj.weapon[a].option.filter(o => o.name == "기본 공격 피해 증가").reduce((sum, o) => sum + o.num, 0);
                dmg.p = dmg.p + Math.round(originalDmg.p * num);
                dmg.m = dmg.m + Math.round(originalDmg.m * num);
                dmg.t = dmg.t + Math.round(originalDmg.t * num);
            }
            if (tempObj.armor[v].option && tempObj.armor[v].option.find(o => o.name == "기본 공격 피해 감소")) {
                let num = tempObj.armor[v].option.filter(o => o.name == "기본 공격 피해 감소").reduce((sum, o) => sum + o.num, 0);
                dmg.p = Math.max(0, dmg.p - Math.round(originalDmg.p * num));
                dmg.m = Math.max(0, dmg.m - Math.round(originalDmg.m * num));
            }
            if (tempObj.effect[a].combo) {
                if (tempObj.weapon[a].option && tempObj.weapon[a].option.find(o => o.name == "연격 피해 증가")) {
                    let num = tempObj.weapon[a].option.filter(o => o.name == "연격 피해 증가").reduce((sum, o) => sum + o.num, 0);
                    dmg.p = dmg.p + Math.round(originalDmg.p * num);
                    dmg.m = dmg.m + Math.round(originalDmg.m * num);
                    dmg.t = dmg.t + Math.round(originalDmg.t * num);
                }
                if (tempObj.armor[v].option && tempObj.armor[v].option.find(o => o.name == "연격 피해 감소")) {
                    let num = tempObj.armor[v].option.filter(o => o.name == "연격 피해 감소").reduce((sum, o) => sum + o.num, 0);
                    dmg.p = Math.max(0, dmg.p - Math.round(originalDmg.p * num));
                    dmg.m = Math.max(0, dmg.m - Math.round(originalDmg.m * num));
                }
            }
            if (tempObj.artifact[a].includes("무기 달인의 왕관")) {
                logs.push("❇️ " + tempObj.name[a] + "의 무기의 달인!");
                dmg.p = dmg.p + Math.round(originalDmg.p * 0.35);
                dmg.m = dmg.m + Math.round(originalDmg.m * 0.35);
                dmg.t = dmg.t + Math.round(originalDmg.t * 0.35);
            }
            if (tempObj.activated[a] && tempObj.activated[a].includes("pnt")) {
                let ignorePnt = false;
                if (tempObj.armor[v].enchant && tempObj.armor[v].enchant.find(e => e.name == "관통 불가")) {
                    let r = Math.random();
                    if (r < (0.1 * tempObj.armor[v].enchant.find(e => e.name == "관통 불가").level)) {
                        logs.push("🪯 " + tempObj.name[v] + "의 관통 불가!");
                        ignorePnt = true;
                    }
                }
                if (! ignorePnt) {
                    logs.push("🗡️ " + tempObj.name[a] + "의 관통 공격!");
                    dmg.t += dmg.p + dmg.m;
                    dmg.p = 0;
                    dmg.m = 0;
                    if (tempObj.weapon[v].name == "성월의 레이피어" && tempObj.weapon[v].tier >= 2) {
                        dmg.t = Math.round(dmg.t * 1.2);
                    }
                }
            }
        } else {
            if (tempObj.weapon[a].option && tempObj.weapon[a].option.find(o => o.name == "스킬 피해 증가")) {
                let num = tempObj.weapon[a].option.filter(o => o.name == "스킬 피해 증가").reduce((sum, o) => sum + o.num, 0);
                dmg.p = dmg.p + Math.round(originalDmg.p * num);
                dmg.m = dmg.m + Math.round(originalDmg.m * num);
                dmg.t = dmg.t + Math.round(originalDmg.t * num);
            }
            if (tempObj.armor[v].option && tempObj.armor[v].option.find(o => o.name == "스킬 피해 감소")) {
                let num = tempObj.armor[v].option.filter(o => o.name == "스킬 피해 감소").reduce((sum, o) => sum + o.num, 0);
                dmg.p = Math.max(0, dmg.p - Math.round(originalDmg.p * num));
                dmg.m = Math.max(0, dmg.m - Math.round(originalDmg.m * num));
            }
        }

        if (other && other.isCounter) {
            if (tempObj.weapon[a].name == "성월의 레이피어" && tempObj.weapon[a].tier >= 3 && tempObj.cntAct[a].includes("pnt")) {
                let ignorePnt = false;
                if (tempObj.armor[v].enchant && tempObj.armor[v].enchant.find(e => e.name == "관통 불가")) {
                    let r = Math.random();
                    if (r < (0.1 * tempObj.armor[v].enchant.find(e => e.name == "관통 불가").level)) {
                        logs.push("🪯 " + tempObj.name[v] + "의 관통 불가!");
                        ignorePnt = true;
                    }
                }
                if (! ignorePnt) {
                    logs.push("🗡️ " + tempObj.name[a] + "의 관통 반격!");
                    dmg.t += Math.round((dmg.p + dmg.m) * 1.2);
                    dmg.p = 0;
                    dmg.m = 0;
                }
            }
        }

        if (other && other.isSwordAura) {
            if (tempObj.weapon[v].name == "천상유랑검" && tempObj.weapon[v].tier >= 8 && tempObj.cntAct[a].includes("pnt")) {
                let ignorePnt = false;
                if (tempObj.armor[v].enchant && tempObj.armor[v].enchant.find(e => e.name == "관통 불가")) {
                    let r = Math.random();
                    if (r < (0.1 * tempObj.armor[v].enchant.find(e => e.name == "관통 불가").level)) {
                        logs.push("🪯 " + tempObj.name[v] + "의 관통 불가!");
                        ignorePnt = true;
                    }
                }
                if (! ignorePnt) {
                    logs.push("🗡️ " + tempObj.name[a] + "의 관통 검기!");
                    dmg.t += (dmg.p + dmg.m);
                    dmg.p = 0;
                    dmg.m = 0;
                }
            }
        }

        if (other && other.isPet) {
            if (tempObj.weapon[a].option && tempObj.weapon[a].option.find(o => o.name == "펫 피해 증가")) {
                let num = tempObj.weapon[a].option.filter(o => o.name == "펫 피해 증가").reduce((sum, o) => sum + o.num, 0);
                dmg.p = dmg.p + Math.round(originalDmg.p * num);
                dmg.m = dmg.m + Math.round(originalDmg.m * num);
                dmg.t = dmg.t + Math.round(originalDmg.t * num);
            }
            if (tempObj.armor[v].option && tempObj.armor[v].option.find(o => o.name == "펫 피해 감소")) {
                let num = tempObj.armor[v].option.filter(o => o.name == "펫 피해 감소").reduce((sum, o) => sum + o.num, 0);
                dmg.p = Math.max(0, dmg.p - Math.round(originalDmg.p * num));
                dmg.m = Math.max(0, dmg.m - Math.round(originalDmg.m * num));
            }
        }

        if (tempObj.weapon[a].option && tempObj.weapon[a].option.find(o => o.name == "모든 피해 증가")) {
            let num = tempObj.weapon[a].option.filter(o => o.name == "모든 피해 증가").reduce((sum, o) => sum + o.num, 0);
            dmg.p = dmg.p + Math.round(originalDmg.p * num);
            dmg.m = dmg.m + Math.round(originalDmg.m * num);
            dmg.t = dmg.t + Math.round(originalDmg.t * num);
        }
        if (tempObj.armor[v].option && tempObj.armor[v].option.find(o => o.name == "모든 피해 감소")) {
            let num = tempObj.armor[v].option.filter(o => o.name == "모든 피해 감소").reduce((sum, o) => sum + o.num, 0);
            dmg.p = Math.max(0, dmg.p - Math.round(originalDmg.p * num));
            dmg.m = Math.max(0, dmg.m - Math.round(originalDmg.m * num));
            dmg.t = Math.max(0, dmg.t - Math.round(originalDmg.t * num));
        }
        if (tempObj.artifact[v].includes("철가루 슬라임")) {
            if (! tempObj.stack[v].shockAbsorp) tempObj.stack[v].shockAbsorp = 0;
            dmg.p = Math.max(0, dmg.p - Math.round(originalDmg.p * 0.1));
            dmg.m = Math.max(0, dmg.m - Math.round(originalDmg.m * 0.1));
            tempObj.stack[v].shockAbsorp += Math.round(originalDmg.p * 0.1) + Math.round(originalDmg.m * 0.1);
            logs.push("❇️ " + tempObj.name[v] + "의 충격 흡수!");
        }
        if (tempObj.weapon[a].option) {
            if (tempObj.weapon[a].option.find(o => o.name == "물리 피해 증가")) {
                let num = tempObj.weapon[a].option.filter(o => o.name == "물리 피해 증가").reduce((sum, o) => sum + o.num, 0);
                dmg.p = dmg.p + Math.round(originalDmg.p * num);
            }
            if (tempObj.weapon[a].option.find(o => o.name == "마법 피해 증가")) {
                let num = tempObj.weapon[a].option.filter(o => o.name == "마법 피해 증가").reduce((sum, o) => sum + o.num, 0);
                dmg.m = dmg.m + Math.round(originalDmg.m * num);
            }
            if (tempObj.weapon[a].option.find(o => o.name == "고정 피해 증가")) {
                let num = tempObj.weapon[a].option.filter(o => o.name == "고정 피해 증가").reduce((sum, o) => sum + o.num, 0);
                dmg.t = dmg.t + Math.round(originalDmg.t * num);
            }
        }
        if (tempObj.armor[v].option) {
            if (tempObj.armor[v].option.find(o => o.name == "물리 피해 감소")) {
                let num = tempObj.armor[v].option.filter(o => o.name == "물리 피해 감소").reduce((sum, o) => sum + o.num, 0);
                dmg.p = Math.max(0, dmg.p - Math.round(originalDmg.p * num));
            }
            
            if (tempObj.armor[v].option.find(o => o.name == "마법 피해 감소")) {
                let num = tempObj.armor[v].option.filter(o => o.name == "마법 피해 감소").reduce((sum, o) => sum + o.num, 0);
                dmg.m = Math.max(0, dmg.m - Math.round(originalDmg.m * num));
            }
            
            if (tempObj.armor[v].option.find(o => o.name == "고정 피해 감소")) {
                let num = tempObj.armor[v].option.filter(o => o.name == "고정 피해 감소").reduce((sum, o) => sum + o.num, 0);
                dmg.t = Math.max(0, dmg.t - Math.round(originalDmg.t * num));
            }
        }
        if (tempObj.effect[v].shadowhug) {
            dmg.p = Math.round(dmg.p * 0.25);
            dmg.m = Math.round(dmg.m * 0.25);
        }

        if (tempObj.effect[v].aurora) {
            if (tempObj.effect[v].aurora.luna && (dmg.p + dmg.m + dmg.t) > 0) {
                logs.push("🌕 달빛 표식이 추가 피해를 입힙니다!");
                dmg.t += Math.round((dmg.p + dmg.m + dmg.t) * tempObj.effect[v].aurora.percent);
            } else if (dmg.m > 0) {
                logs.push("🌌 오로라빛 표식이 추가 피해를 입힙니다!");
                dmg.t += Math.round(dmg.m * tempObj.effect[v].aurora.percent);
            }
        }

        if (isNormalAttack && tempObj.weapon[a].enchant && tempObj.weapon[a].enchant.find(e => e.name == "강타") && tempObj.activated[a].includes("crt")) {
            logs.push("🪯 " + tempObj.name[a] + "의 강타!");
            dmg.t += Math.round((dmg.p + dmg.m + dmg.t) * (tempObj.weapon[a].enchant.find(e => e.name == "강타").level * 0.05));
        }

        let victimDef = tempObj.stat[v].def;
        let victimRes = tempObj.stat[v].res;
        if (tempObj.stack[v].adapDef) tempObj.stat[v].def += tempObj.stack[v].adapDef / 100;
        if (tempObj.stack[v].adapRes) tempObj.stat[v].res += tempObj.stack[v].adapRes / 100;
        if (tempObj.armor[v].option && tempObj.armor[v].option.find(o => o.name == "방어")) victimDef += tempObj.armor[v].option.filter(o => o.name == "방어").reduce((sum, o) => sum + o.num, 0);
        if (tempObj.armor[v].option && tempObj.armor[v].option.find(o => o.name == "저항")) victimRes += tempObj.armor[v].option.filter(o => o.name == "저항").reduce((sum, o) => sum + o.num, 0);
        if (tempObj.weapon[a].name == "천명즉살검" && tempObj.weapon[a].tier >= 7) {
            victimDef -= victimDef * 0.5;
        }
        if (tempObj.weapon[a].option && tempObj.weapon[a].option.find(o => o.name == "방어 무시")) victimDef -= tempObj.weapon[a].option.filter(o => o.name == "방어 무시").reduce((sum, o) => sum + o.num, 0);
        if (tempObj.weapon[a].option && tempObj.weapon[a].option.find(o => o.name == "저항 무시")) victimRes -= tempObj.weapon[a].option.filter(o => o.name == "저항 무시").reduce((sum, o) => sum + o.num, 0);
        if (tempObj.weapon[a].name == "광살혈도" && tempObj.weapon[a].tier >= 4) {
            victimDef = Math.max(0, victimDef - 0.15);
        }
        victimDef = Math.max(0, victimDef - (0.15 * tempObj.artifact[a].filter(a => a == "황금 팔찌").length));
        victimDef = Math.max(0, victimDef - (0.15 * tempObj.artifact[a].filter(a => a == "혈사조").length));
        victimDef = Math.max(0, victimDef - (0.15 * tempObj.artifact[a].filter(a => a == "홍월의 혈사조").length));
        victimDef = Math.max(0, victimDef - (0.1 * tempObj.artifact[a].filter(a => a == "예리한 봉첨").length));
        victimDef = Math.max(0, victimDef - (0.2 * tempObj.artifact[a].filter(a => a == "프리가라흐").length));
        victimDef = Math.max(0, victimDef - (0.25 * tempObj.artifact[a].filter(a => a == "홍월의 프리가라흐").length));
        victimRes = Math.max(0, victimRes - (0.1 * tempObj.artifact[a].filter(a => a == "마법의 고서").length));
        victimRes = Math.max(0, victimRes - (0.15 * tempObj.artifact[a].filter(a => a == "네크로노미콘").length));
        victimRes = Math.max(0, victimRes - (0.15 * tempObj.artifact[a].filter(a => a == "홍월의 네크로노미콘").length));
        victimRes = Math.max(0, victimRes - (-0.15 * tempObj.artifact[a].filter(a => a == "프리가라흐").length));
        victimRes = Math.max(0, victimRes - (-0.1 * tempObj.artifact[a].filter(a => a == "홍월의 프리가라흐").length));
        if (tempObj.effect[v].decreaseDef) victimDef = Math.max(0, victimDef - (0.01 * tempObj.effect[v].decreaseDef.stack));
        if (tempObj.stack[a].magicCurse) {
            victimRes = Math.max(0, victimRes - (0.01 * tempObj.stack[a].magicCurse));
        }
        
        dmg.p = Math.max(0, Math.round(dmg.p * (1 - victimDef)));
        dmg.m = Math.max(0, Math.round(dmg.m * (1 - victimRes)));
        if (tempObj.artifact[v].includes("네메아의 사자 가죽")) {
            dmg.p = Math.round(dmg.p * 0.85);
        }
        if (tempObj.pet[v].name && tempObj.pet[v].name == "네메아의 사자" && dmg.p > 0) {
            let r = Math.random();
            let percent = 0.05;
            if (tempObj.pet[v].level >= 10) percent = 0.1;
            if (tempObj.pet[v].level >= 20) percent = 0.15;
            if (tempObj.pet[v].level >= 30) percent = 0.2;
            if (tempObj.pet[v].level >= 40) percent = 0.25;
            if (r < percent) {
                logs.push("🟨 네메아의 사자가 물리 피해를 막아줍니다!");
                dmg.p = 0;
                logs.push("✳️ " + tempObj.name[v] + "의 네메아의 사자가 공격합니다!");
                let petActivated = getActivated({hit: 0.9, avd: tempObj.tempStat[a].avd});
                if (!tempObj.effect[a].stun && !tempObj.effect[a].freeze && !petActivated.includes("hit")) {
                    logs.push("❌ 빗나갔습니다!");
                } else if (!tempObj.effect[a].stun && !tempObj.effect[a].freeze && petActivated.includes("avd")) {
                    logs.push("💨 회피했습니다!");
                } else {
                    if (dealt(v, a, {p:tempObj.pet[v].damage,m:0,t:0}, null, {isPet: true})) return;
                    if (tempObj.stat[a].hp <= getPercentMaxHP(a, (tempObj.pet[v].level >= 50 ? 0.1 : 0.05))) {
                        if (instantExecute(v, a)) return;
                    }
                }
            }
        }
        let finalDamage = Math.max(0, dmg.p + dmg.m + dmg.t);
        let originDamage = finalDamage;
        let tempActivated = getActivated(tempObj.tempStat[v]);
        if (isNormalAttack && tempObj.weapon[a].name == "광살혈도" && tempObj.weapon[a].tier >= 6 && finalDamage >= tempObj.stat[v].maxHp) {
            logs.push("❇️ " + tempObj.name[a] + "의 학살!");
            if (instantExecute(a, v)) return;
        }
        if (tempObj.weapon[v].name == "성월의 레이피어" && tempActivated.includes("cnt") && finalDamage > 0 && (isNormalAttack || tempObj.weapon[v].tier >= 8)) {
            let r = Math.random();
            if (r < 0.85) {
                logs.push("❇️ " + tempObj.name[v] + "의 성월!");
                dmg.p = Math.round(dmg.p * 0.2);
                dmg.m = Math.round(dmg.m * 0.2);
            }
        }
        let sheen = 0;
        let isLight = false;
        const isSettingMoon = (tempObj.weapon[v].name == "천명즉살검" && tempObj.weapon[v].tier >= 4 && (!tempObj.stack[a].setting_moon || tempObj.effect[a].setting_moon));
        const isEmpyreanArc = (tempObj.weapon[v].name == "엠파이리언 아크" && tempObj.weapon[v].tier >= 2 && tempObj.effect[v].conversion);
        const isReification = (tempObj.weapon[v].name == "서리 아귀" && !tempObj.effect[v].reification)
        if (isSettingMoon || isEmpyreanArc || isReification) {
            let avoid = true;
            if (isSettingMoon && !tempObj.stack[a].setting_moon) {
                tempObj.stack[a].setting_moon = 1;
                tempObj.effect[a].setting_moon = {
                    turn: 1
                };
                tempObj.effect[v].setting_moon_buff = {
                    turn: 1
                };
                logs.push("❇️ " + tempObj.name[v] + "의 저무는 달빛!");
            }

            if (avoid && tempObj.artifact[a].includes("신의 눈")) {
                avoid = false;
            }
            if (avoid && (other && other.isEmpyreanShot)) {
                avoid = false;
            }
            if (avoid && tempObj.artifact[a].includes("고대의 눈알")) {
                let r = Math.random();
                if (r < 0.5) {
                    logs.push("❇️ " + tempObj.name[a] + "의 절대자의 눈!");
                    avoid = false;
                }
            }
            if (avoid && tempObj.weapon[a].name == "천명즉살검" && tempObj.weapon[a].tier >= 6 && tempObj.effect[v].bleed) {
                logs.push("❇️ " + tempObj.name[a] + "의 암살자의 눈!");
                avoid = false;
            }
            if (avoid && tempObj.artifact[a].includes("프리가라흐") && isNormalAttack && SWORDS.includes(tempObj.weapon[a].name)) {
                let r = Math.random();
                if (r < 0.65) {
                    logs.push("❇️ " + tempObj.name[a] + "의 빗나가지 않는 검!");
                    avoid = false;
                }
            }
            if (avoid && tempObj.artifact[a].includes("홍월의 프리가라흐") && isNormalAttack && SWORDS.includes(tempObj.weapon[a].name)) {
                let r = Math.random();
                if (r < 0.75) {
                    logs.push("❇️ " + tempObj.name[a] + "의 빗나가지 않는 검!");
                    avoid = false;
                }
            }

            if (avoid || isReification) {
                logs.push("💨 회피했습니다!");
                if (tempObj.armor[v] == "그림자 망토" && tempObj.artifact[v].includes("아르카나 그림자 망토")) {
                    logs.push("🟪 " + tempObj.name[v] + "의 암흑의 흡수!");
                    tempObj.stack[v].darkAbsorp = 1;
                    if (dealt(v, a, {p:0,m:0,t:getPercentMaxHP(v, 0.05)})) return;
                }
                return false;
            }
        }
        if (finalDamage > 0) {
            if (tempObj.effect[a].setting_moon_buff) {
                finalDamage += Math.round(finalDamage * 1);
            }
            if (tempObj.armor[v].enchant && tempObj.armor[v].enchant.find(e => e.name == "견고")) {
                logs.push("🪯 " + tempObj.name[v] + "의 견고!");
                if ((10 * tempObj.armor[v].enchant.find(e => e.name == "견고").level) <= dmg.p) {
                    dmg.p -= (10 * tempObj.armor[v].enchant.find(e => e.name == "견고").level);
                } else if ((10 * tempObj.armor[v].enchant.find(e => e.name == "견고").level) <= dmg.m) {
                    dmg.m -= (10 * tempObj.armor[v].enchant.find(e => e.name == "견고").level);
                } else if ((10 * tempObj.armor[v].enchant.find(e => e.name == "견고").level) <= (dmg.p + dmg.m)) {
                    dmg.p -= (10 * tempObj.armor[v].enchant.find(e => e.name == "견고").level);
                } else {
                    dmg.p = 0;
                    dmg.m = 0;
                }
            }
            if (tempObj.effect[v].aegis) {
                logs.push("❇️ " + tempObj.name[v] + "의 신성한 가호! (받는 피해량 -" + (tempObj.effect[v].aegis.stack * 7) + "%)");
                dmg.p = Math.max(0, Math.round(dmg.p * (1 - (tempObj.effect[v].aegis.stack * 0.07))));
                dmg.m = Math.max(0, Math.round(dmg.m * (1 - (tempObj.effect[v].aegis.stack * 0.07))));
            }
            if (tempObj.armor[v].name == "석상 돌갑옷" && tempObj.armor[v].tier >= 7 && !(other && other.isSheen) && finalDamage > 0 && tempObj.stat[v].shield) {
                sheen = Math.round(finalDamage * 0.1);
                dmg.p = Math.round(dmg.p * 0.9);
                dmg.m = Math.round(dmg.m * 0.9);
            }
            
            if (tempObj.armor[v].name == "화염 드래곤의 비늘" && tempObj.armor[v].tier >= 7 && finalDamage > 0 && tempObj.effect[a].burn) {
                dmg.p = Math.round(dmg.p * (1 - Math.min(0.3, (0.1 * tempObj.effect[a].burn.stack))));
                dmg.m = Math.round(dmg.m * (1 - Math.min(0.3, (0.1 * tempObj.effect[a].burn.stack))));
                logs.push("❇️ " + tempObj.name[v] + "의 약화의 화염!");
            }
            if (tempObj.armor[v].name == "여명의 갑주" && tempObj.armor[v].tier >= 6 && finalDamage > Math.round(tempObj.stat[v].maxHp * 0.1)) {
                let r = Math.random();
                if (r < 0.7) {
                    logs.push("❇️ " + tempObj.name[v] + "의 저항하는 갑주!");
                    let prevDamage = Math.max(0, dmg.p + dmg.m + dmg.t);
                    dmg.p = Math.round(dmg.p * 0.65);
                    dmg.m = Math.round(dmg.m * 0.65);
                    if (tempObj.artifact[v].includes("아르카나 여명의 갑주")) {
                        isLight = (prevDamage - Math.max(0, dmg.p + dmg.m + dmg.t));
                    }
                }
            }
            finalDamage = Math.max(0, dmg.p + dmg.m + dmg.t);
            if (tempObj.effect[v].resistance) finalDamage = Math.round(finalDamage * 0.5);
            if (tempObj.pet[v].name) {
                if (tempObj.pet[v].name == "조약돌 골렘" && tempObj.pet[v].level >= 50 && !(tempObj.stack[v].stead && tempObj.stack[v].stead >= 1000)) {
                    let r = Math.random();
                    if (r < 0.2) {
                        logs.push("🟨 조약돌 골렘이 피해를 대신 받습니다!");
                        if (!tempObj.stack[v].stead) tempObj.stack[v].stead = 0;
                        tempObj.stack[v].stead += finalDamage;
                        logs.push("조약돌 골렘의 HP: " + Math.max(0, 1000 - tempObj.stack[v].stead) + "/1,000 (-" + finalDamage.toComma() + ")");
                        finalDamage = 0;
                    }
                }
            }
            if (tempObj.stat[v].shield) {
                let originalDamage = finalDamage;
                if (tempObj.armor[v].name == "석상 돌갑옷" && tempObj.artifact[v].includes("아르카나 석상 돌갑옷") && tempObj.stat[v].shield < finalDamage) {
                    tempObj.logs.push("🟪 " + tempObj.name[v] + "의 불멸의 석상!");
                    finalDamage = 0;
                    tempObj.stat[v].shield = 0;
                } else if (tempObj.stat[v].shield > finalDamage) {
                    tempObj.stat[v].shield -= finalDamage;
                    finalDamage = 0;
                } else {
                    finalDamage -= tempObj.stat[v].shield;
                    tempObj.stat[v].shield = 0;
                }
                let shieldDamage = originalDamage - finalDamage;
                tempObj.logs.push(tempObj.name[v] + "의 보호막: " + tempObj.stat[v].shield.toComma() + " (-" + shieldDamage.toComma() + ")");
            }
            if (tempObj.armor[v].name == "방랑자의 천갑옷" && tempObj.artifact[v].includes("아르카나 방랑자의 천갑옷") && finalDamage >= tempObj.stat[v].hp) {
                let r = Math.random();
                let percent = (tempObj.stack[v].determined ? 0.4 : 1);
                if (r < percent) {
                    tempObj.stack[v].determined = 1;
                    tempObj.logs.push("🟪 " + tempObj.name[v] + "의 방랑자의 결의!");
                    finalDamage = tempObj.stat[v].hp - 1;
                    tempObj.effect[v].determ = {
                        turn: 5
                    };
                }
            }
            if (tempObj.name[v] == "[사신] 네메시스" && finalDamage > 444) {
                logs.push("❇️ [사신] 네메시스의 허황된 악몽!");
                finalDamage = 444;
            }
        }
        tempObj.stat[v].hp = Math.max(0, tempObj.stat[v].hp - finalDamage);
        tempObj.logs.push(tempObj.name[v] + "의 HP: " + tempObj.stat[v].hp.toComma() + "/" + tempObj.stat[v].maxHp.toComma() + " (-" + finalDamage.toComma() + ")");
        if (isNormalAttack) {
            if (tempObj.weapon[a].name == "뱀파이어의 송곳니") {
                let r = Math.random();
                let percent = 0.1 + (0.1 * tempObj.weapon[a].tier);
                if (r < percent) {
                    heal(a, Math.min(Math.round(finalDamage / 2), Math.round(tempObj.stat[a].maxHp * 0.1)));
                }
            } else if (tempObj.weapon[a].name == "광살혈도" && tempObj.weapon[a].tier >= 2) {
                heal(a, Math.floor((tempObj.stat[a].maxHp - tempObj.stat[a].hp) * 0.15));
            }
        }
        if (tempObj.weapon[a].name == "뱀파이어의 송곳니" && tempObj.weapon[a].tier >= 7 && tempObj.stack[a].vampire_mark) {
            delete tempObj.stack[a].vampire_mark;
            heal(a, Math.min(Math.round(tempObj.stat[a].maxHp * 0.5), Math.round(finalDamage * 0.5)));
        }
        if (tempObj.weapon[a].name == "광살혈도" && tempObj.weapon[a].tier >= 4) {
            tempObj.stat[v].def = Math.max(0, tempObj.stat[v].def - (tempObj.weapon[a].tier >= 5 ? 0.015 : 0.01));
            logs.push("❇️ " + tempObj.weapon[a].name + "의 깎아내기! (대상 🛡️ " + (tempObj.stat[v].def * 100).fix() + "%)");
            if (tempObj.weapon[a].tier >= 5) {
                if (tempObj.armor[v].option.find(o => o.name == "모든 피해 감소")) tempObj.armor[v].option.find(o => o.name == "모든 피해 감소").num -= 0.015;
                else {
                    if (!tempObj.armor[v].option) {
                        tempObj.armor[v].option = [];
                    }
                    tempObj.armor[v].option.push({
                        name: "모든 피해 감소",
                        num: -0.015
                    });
                }
            }
        }
        if (tempObj.artifact[a].includes("홍월의 루나리 왕실 브로치") && Math.round(finalDamage * (0.05 * tempObj.artifact[a].filter(a => a.startsWith("홍월")).length)) > 0) {
            logs.push("❇️ " + tempObj.name[a] + "의 붉은 달빛의 축복!");
            heal(a, Math.round(finalDamage * (0.05 * tempObj.artifact[a].filter(a => a.startsWith("홍월")).length)));
        }
        if (tempObj.artifact[a].includes("혈사조") && !(other && other.isPet) && dmg.p > 0) {
            logs.push("❇️ " + tempObj.name[a] + "의 살육본능!");
            heal(a, Math.round(dmg.p * 0.2));
        }
        if (tempObj.artifact[a].includes("홍월의 혈사조") && !(other && other.isPet) && dmg.p > 0) {
            logs.push("❇️ " + tempObj.name[a] + "의 살육본능!");
            tempObj.stack[a].redmoon_blood = 1;
            heal(a, Math.round(dmg.p * 0.2));
        }
        if (tempObj.stack[a].darkAbsorp) {
            delete tempObj.stack[a].darkAbsorp;
            heal(a, finalDamage);
        }
        if (tempObj.stack[a].moonCnt) {
            delete tempObj.stack[a].moonCnt;
            heal(a, Math.ceil((tempObj.stat[a].maxHp - tempObj.stat[a].hp) * 0.14));
        }
        if (tempObj.stack[a].blackCat) {
            delete tempObj.stack[a].blackCat;
            let r = Math.random();
            if (r < 0.75 && !tempObj.effect[a].gorged) {
                tempObj.effect[a].gorged = {
                    turn: 1
                };
                tempObj.stat[a].hp += Math.round(finalDamage * 0.35);
                tempObj.stat[a].maxHp += Math.round(finalDamage * 0.35);
                logs.push("🟨 검은 고양이의 검은 포식자!");
                logs.push(tempObj.name[a] + "의 HP: " + tempObj.stat[a].hp.toComma() + "/" + tempObj.stat[a].maxHp.toComma() + " (+" + Math.round(finalDamage * 0.35).toComma() + ")");
            }
        }
        if (tempObj.weapon[a].name == "서리 아귀" && dmg.t > 0) {
            tempObj.stat[a].hp += dmg.t;
            tempObj.stat[a].maxHp += dmg.t;
            logs.push(tempObj.name[a] + "의 HP: " + tempObj.stat[a].hp.toComma() + "/" + tempObj.stat[a].maxHp.toComma() + " (+" + Math.round(dmg.t).toComma() + ")");
        }
        if (!tempObj.stat[v].hp <= 0) {
            if (tempObj.artifact[a].includes("네크로노미콘") && dmg.m > 0 && tempObj.stat[v].hp <= getPercentMaxHP(v, 0.1)) {
                logs.push("❇️ " + tempObj.name[a] + "의 죽음의 마법!");
                if (instantExecute(a, v)) return true;
            }
            if (tempObj.artifact[a].includes("홍월의 네크로노미콘") && dmg.m > 0 && tempObj.stat[v].hp <= getPercentMaxHP(v, 0.15)) {
                logs.push("❇️ " + tempObj.name[a] + "의 죽음의 마법!");
                if (instantExecute(a, v)) return true;
            }
            if (isNormalAttack) {
                if (tempObj.armor[v].enchant && tempObj.armor[v].enchant.find(e => e.name == "가시")) {
                    logs.push("🪯 " + tempObj.name[v] + "의 가시!");
                    if (dealt(v, a, {p:25 * tempObj.armor[v].enchant.find(e => e.name == "가시").level,m:0,t:0})) return true;
                }
            }
            if (tempObj.armor[v].enchant && tempObj.armor[v].enchant.find(e => e.name == "파동") && !(other && other.isWave) && Math.round(finalDamage * (tempObj.armor[v].enchant.find(e => e.name == "파동").level * 0.05)) > 0) {
                logs.push("🪯 " + tempObj.name[v] + "의 파동!");
                if (dealt(v, a, {p:0,m:Math.round(finalDamage * (tempObj.armor[v].enchant.find(e => e.name == "파동").level * 0.05)),t:0}, null, {isWave:true})) return true;
            }
            if (tempObj.armor[v].name == "석상 돌갑옷" && tempObj.armor[v].tier >= 7 && !(other && other.isSheen) && sheen > 0) {
                logs.push("❇️ " + tempObj.name[v] + "의 광휘!");
                if (dealt(v, a, {p:0,m:0,t:sheen}, null, {isSheen:true})) return true;
            }
            if (isLight) {
                tempObj.logs.push("🟪 " + tempObj.name[v] + "의 빛의 순환!");
                if (dealt(v, a, {p:0,m:isLight,t:0})) return true;
                heal(v, Math.round(isLight * 0.35));
            }
            if (tempObj.armor[v].enchant && tempObj.armor[v].enchant.find(e => e.name == "카르마")) {
                if (! tempObj.effect[v].karma) {
                    tempObj.effect[v].karma = {
                        turn: 1,
                        stack: 0
                    };
                }
                tempObj.effect[v].karma.stack += Math.round(finalDamage * (0.1 * tempObj.armor[v].enchant.find(e => e.name == "카르마").level));
            }
            if (tempObj.armor[v].name == "여명의 갑주" && tempObj.armor[v].tier >= 7) {
                if (!tempObj.stack[v].dawn) tempObj.stack[v].dawn = 0;
                tempObj.stack[v].dawn += Math.round(finalDamage * 0.45);
            }
            if (tempObj.armor[v].name == "마법사의 로브") {
                if (tempObj.armor[v].tier >= 6) {
                    if (!tempObj.stack[v].magicDealt) tempObj.stack[v].magicDealt = 0;
                    tempObj.stack[v].magicDealt += Math.round(dmg.m * 0.7);
                }
                if (tempObj.armor[v].tier >= 7) {
                    let r = Math.random();
                    if (r < 0.3) {
                        if (!tempObj.stack[v].magicCurse) tempObj.stack[v].magicCurse = 0;
                        tempObj.stack[v].magicCurse += 1;
                        logs.push("❇️ " + tempObj.name[v] + "의 저주! (저주 " + tempObj.stack[v].magicCurse + "중첩)");
                    }
                }
            }
            if (tempObj.artifact[v].includes("아이기스의 방패") && finalDamage > 0) {
                if (!tempObj.effect[v].aegis) {
                    tempObj.effect[v].aegis = {
                        turn: 1,
                        stack: 1
                    };
                } else {
                    tempObj.effect[v].aegis.stack = Math.min(10, tempObj.effect[v].aegis.stack + 1);
                }
            }
            if (tempObj.armor[v].name == "핏빛 로브") {
                if (!tempObj.stack[v].blood) tempObj.stack[v].blood = 0;
                let plusStack = Math.round(finalDamage * 0.25);
                if (tempObj.armor[v].tier >= 6) {
                    let r = Math.random();
                    if (r < 0.1) {
                        plusStack += Math.round(finalDamage * 0.75);
                    } else if (tempObj.armor[v].tier >= 4) {
                        plusStack += Math.round(dmg.p * 0.15);
                    }
                } else if (tempObj.armor[v].tier >= 4) {
                    plusStack += Math.round(dmg.p * 0.15);
                }
                if (tempObj.artifact[v].includes("아르카나 핏빛 로브")) {
                    let lostHPratio = (tempObj.stat[v].maxHp - tempObj.stat[v].hp) / tempObj.stat[v].maxHp;
                    plusStack = Math.round(plusStack * (lostHPratio * 2));
                }
                tempObj.stack[v].blood += plusStack;
                //logs.push(tempObj.name[v] + "의 공혈 중첩: " + tempObj.stack[v].blood.toComma() + " (+" + (tempObj.stack[v].blood - prevStack) + ")");
                if (tempObj.stack[v].blood >= 200) {
                    let prevStack = tempObj.stack[v].blood;
                    tempObj.stack[v].blood = 0;
                    logs.push("❇️ " + tempObj.name[v] + "의 공혈!");
                    heal(v, prevStack);
                    if (tempObj.armor[v].tier >= 7) {
                        logs.push("❇️ " + tempObj.name[v] + "의 핏빛 저주!");
                        if (dealt(v, a, {p:0,m:0,t:Math.round(prevStack * 0.5)})) return true;
                    }
                }
            }
            if (tempObj.armor[v].name == "방랑자의 천갑옷" && tempObj.armor[v].tier >= 7 && (dmg.p > 0 || dmg.m > 0)) {
                if (!tempObj.stack[v].adapDef) tempObj.stack[v].adapDef = 0;
                if (!tempObj.stack[v].adapRes) tempObj.stack[v].adapRes = 0;
                if (dmg.p > 0) {
                    tempObj.stack[v].adapDef = Math.min(30, tempObj.stack[v].adapDef + 1);
                }
                if (dmg.m > 0) {
                    tempObj.stack[v].adapRes = Math.min(30, tempObj.stack[v].adapRes + 1);
                }
                logs.push("❇️ " + tempObj.name[v] + "의 적응! " + (tempObj.stack[v].adapDef > 0 ? "(🛡️ +" + tempObj.stack[v].adapDef + "%)" : "") + (tempObj.stack[v].adapRes > 0 ? "(🔰 +" + tempObj.stack[v].adapRes + "%)" : ""));
            }
            if (tempObj.armor[v].name == "그림자 망토" && tempObj.armor[v].tier >= 7) {
                if (!tempObj.stack[v].shadowhug && tempObj.stat[v].hp <= (tempObj.stat[v].maxHp * 0.4)) {
                    tempObj.stack[v].shadowhug = 1;
                    tempObj.effect[v].shadowhug = {
                        turn: 3
                    };
                    logs.push("❇️ " + tempObj.name[v] + "의 그림자의 포옹!");
                }
            }
            if (tempObj.weapon[v].name == "성월의 레이피어" && tempObj.weapon[v].tier >= 8 && !isNormalAttack && !(other && other.isCounter)) {
                let tempActivated = getActivated(tempObj.tempStat[v]);
                if (tempActivated.includes("cnt")) {
                    if (instantCounter(v, a, originDamage)) return true;
                }
            }
            if (tempObj.weapon[a].name == "아스트로베놈" && tempObj.weapon[a].tier >= 5 && !isNormalAttack) {
                let tempActivated = getActivated(tempObj.tempStat[a]);
                if (tempActivated.includes("poi")) {
                    instantPoison(a, v);
                }
            }
        } else {
            if (tempObj.weapon[v].name == "광살혈도" && tempObj.weapon[v].tier >= 7 && !tempObj.stack[v].frenzy) {
                tempObj.stack[v].frenzy = true;
                tempObj.stat[v].hp = tempObj.stat[v].maxHp;
                tempObj.stat[v].shield = 0;
                if (!tempObj.weapon[v].option) tempObj.weapon[v].option = [];
                tempObj.weapon[v].option.push({
                    name: "모든 피해 증가",
                    num: 1
                });
                logs.push("❇️ " + tempObj.name[v] + "의 최후의 저항!");
                tempObj.logs.push(tempObj.name[v] + "의 HP: " + tempObj.stat[v].hp.toComma() + "/" + tempObj.stat[v].maxHp.toComma() + " (+" + tempObj.stat[v].maxHp.toComma() + ")");
            }
        }
        if (tempObj.stat[v].hp <= 0) return true;
        else return false;
    }
    let instantDeath = function(a, v) {
        logs.push("☠️ " + tempObj.name[v] + " 즉사!");
        let soul_cutter = false;
        if (tempObj.stack[a].soul_cutter) {
            delete tempObj.stack[a].soul_cutter;
            let r = Math.random();
            let percent = 0.14;
            if (tempObj.weapon[a].tier >= 8) percent = 0.44;
            if (r < percent) {
                soul_cutter = true;
            }
        }
        if (tempObj.artifact[v].includes("엘케이봇") && (! tempObj.stack[v].ignoreDeath || tempObj.stack[v].ignoreDeath < tempObj.artifact[v].filter(a => a == "엘케이봇").length)) {
            if (soul_cutter) {
                logs.push("❇️ " + tempObj.name[v] + "의 LK봇의 가호!");
                logs.push("❇️ " + tempObj.name[a] + "의 소울 커터!");
            } else {
                if (!tempObj.stack[v].ignoreDeath) tempObj.stack[v].ignoreDeath = 0;
                tempObj.stack[v].ignoreDeath++;
                logs.push("❇️ " + tempObj.name[v] + "의 LK봇의 가호!");
                return false;
            }
        } else if (tempObj.artifact[v].includes("즉사 면역")) {
            if (soul_cutter) {
                logs.push("❇️ " + tempObj.name[v] + "의 즉사 면역!");
                logs.push("❇️ " + tempObj.name[a] + "의 소울 커터!");
            } else {
                logs.push("❇️ " + tempObj.name[v] + "의 즉사 면역!");
                return false;
            }
        } else if (tempObj.effect[v].resistance) {
            if (soul_cutter) {
                logs.push("❇️ " + tempObj.name[v] + "의 저항!");
                logs.push("❇️ " + tempObj.name[a] + "의 소울 커터!");
            } else {
                logs.push("❇️ " + tempObj.name[v] + "의 저항!");
                return false;
            }
        }
        let deathDamage = tempObj.stat[v].hp;
        // if (tempObj.pet[v].name) {
        //     if (tempObj.pet[v].name == "조약돌 골렘" && tempObj.pet[v].level >= 50 && !(tempObj.stack[v].stead && tempObj.stack[v].stead >= 1000)) {
        //         let r = Math.random();
        //         if (r < 0.2) {
        //             if (soul_cutter) {
        //                 logs.push("🟨 조약돌 골렘이 피해를 대신 받습니다!");
        //                 logs.push("❇️ " + tempObj.name[a] + "의 소울 커터!");
        //             } else {
        //                 logs.push("🟨 조약돌 골렘이 피해를 대신 받습니다!");
        //                 if (!tempObj.stack[v].stead) tempObj.stack[v].stead = 0;
        //                 tempObj.stack[v].stead += 9999;
        //                 logs.push("조약돌 골렘의 HP: " + Math.max(0, 1000 - tempObj.stack[v].stead) + "/1,000 (-1,000)");
        //                 return false;
        //             }
        //         }
        //     }
        // }
        // if (tempObj.armor[v].name == "방랑자의 천갑옷" && tempObj.artifact[v].includes("아르카나 방랑자의 천갑옷")) {
        //     let r = Math.random();
        //     let percent = (tempObj.stack[v].determined ? 0.4 : 1);
        //     if (r < percent) {
        //         if (soul_cutter) {
        //             logs.push("🟪 " + tempObj.name[v] + "의 방랑자의 결의!");
        //             logs.push("❇️ " + tempObj.name[a] + "의 소울 커터!");
        //         } else {
        //             tempObj.stack[v].determined = 1;
        //             tempObj.logs.push("🟪 " + tempObj.name[v] + "의 방랑자의 결의!");
        //             deathDamage--;
        //             tempObj.effect[v].determ = {
        //                 turn: 5
        //             };
        //         }
        //     }
        // }
        // if (tempObj.stat[v].shield) {
        //     if (tempObj.armor[v].name == "석상 돌갑옷" && tempObj.artifact[v].includes("아르카나 석상 돌갑옷")) {
        //         if (soul_cutter) {
        //             logs.push("🟪 " + tempObj.name[v] + "의 불멸의 석상!");
        //             logs.push("❇️ " + tempObj.name[a] + "의 소울 커터!");
        //         } else {
        //             tempObj.logs.push("🟪 " + tempObj.name[v] + "의 불멸의 석상!");
        //             deathDamage = 0;
        //         }
        //     }
        //     tempObj.logs.push(tempObj.name[v] + "의 보호막: 0 (-" + tempObj.stat[v].shield.toComma() + ")");
        //     tempObj.stat[v].shield = 0;
        // }
        tempObj.stat[v].hp -= deathDamage;
        tempObj.logs.push(tempObj.name[v] + "의 HP: " + tempObj.stat[v].hp.toComma() + "/" + tempObj.stat[v].maxHp.toComma() + " (-" + deathDamage.toComma() + ")");
        if (tempObj.stat[v].hp <= 0) {
            if (tempObj.weapon[v].name == "광살혈도" && tempObj.weapon[v].tier >= 7 && !tempObj.stack[v].frenzy) {
                tempObj.stack[v].frenzy = true;
                tempObj.stat[v].hp = tempObj.stat[v].maxHp;
                tempObj.stat[v].shield = 0;
                if (!tempObj.weapon[v].option) tempObj.weapon[v].option = [];
                tempObj.weapon[v].option.push({
                    name: "모든 피해 증가",
                    num: 1
                });
                logs.push("❇️ " + tempObj.name[v] + "의 최후의 저항!");
                tempObj.logs.push(tempObj.name[v] + "의 HP: " + tempObj.stat[v].hp.toComma() + "/" + tempObj.stat[v].maxHp.toComma() + " (+" + tempObj.stat[v].maxHp.toComma() + ")");
            }
        }
        if (tempObj.stat[v].hp <= 0) return true;
        else return false;
    }
    let instantExecute = function(a, v) {
        logs.push("🚫 " + tempObj.name[v] + " 처형!");
        if (tempObj.stat[v].shield) {
            tempObj.logs.push(tempObj.name[v] + "의 보호막: 0 (-" + tempObj.stat[v].shield.toComma() + ")");
            tempObj.stat[v].shield = 0;
        }
        let deathDamage = tempObj.stat[v].hp;
        tempObj.stat[v].hp -= deathDamage;
        tempObj.logs.push(tempObj.name[v] + "의 HP: " + tempObj.stat[v].hp.toComma() + "/" + tempObj.stat[v].maxHp.toComma() + " (-" + deathDamage.toComma() + ")");
        if (tempObj.stat[v].hp <= 0) {
            if (tempObj.weapon[v].name == "광살혈도" && tempObj.weapon[v].tier >= 7 && !tempObj.stack[v].frenzy) {
                tempObj.stack[v].frenzy = true;
                tempObj.stat[v].hp = tempObj.stat[v].maxHp;
                tempObj.stat[v].shield = 0;
                if (!tempObj.weapon[v].option) tempObj.weapon[v].option = [];
                tempObj.weapon[v].option.push({
                    name: "모든 피해 증가",
                    num: 1
                });
                logs.push("❇️ " + tempObj.name[v] + "의 최후의 저항!");
                tempObj.logs.push(tempObj.name[v] + "의 HP: " + tempObj.stat[v].hp.toComma() + "/" + tempObj.stat[v].maxHp.toComma() + " (+" + tempObj.stat[v].maxHp.toComma() + ")");
            }
        }
        if (tempObj.stat[v].hp <= 0) return true;
        else return false;
    }
    let instantBurn = function(a, v) {
        logs.push("🔥 " + tempObj.name[v] + " 화상!");
        if (tempObj.effect[v].burn) {
            let maxStack = 1;
            if (tempObj.weapon[a].name == "염화의 지팡이" && tempObj.weapon[a].tier >= 7) maxStack++;
            if (tempObj.armor[a].name == "화염 드래곤의 비늘" && tempObj.armor[a].tier >= 7) maxStack++;
            if (tempObj.weapon[a].enchant && tempObj.weapon[a].enchant.find(e => e.name == "화염 낙인")) maxStack += tempObj.weapon[a].enchant.find(e => e.name == "화염 낙인").level;
            if (tempObj.weapon[a].name == "스텔라 인페르노") maxStack += (tempObj.weapon[a].tier >= 5 ? 6 : (tempObj.weapon[a].tier >= 2 ? 3 : 1));
            tempObj.effect[v].burn.max = Math.max(maxStack, tempObj.effect[v].burn.max);
            tempObj.effect[v].burn.stack = Math.min(maxStack, tempObj.effect[v].burn.stack + 1);
        } else {
            tempObj.effect[v].burn = {
                turn: 2,
                stack: 1,
                max: 1
            };
        }
        if (tempObj.weapon[a].name == "스텔라 인페르노" && tempObj.weapon[a].tier >= 4) {
            logs.push("❇️ " + tempObj.name[a] + "의 업화의 낙인!");
            tempObj.effect[v].burn.stigma = a;
        }
        if (tempObj.weapon[a].name == "스텔라 인페르노" && tempObj.weapon[a].tier >= 6) {
            tempObj.effect[v].burn.inferno = a;
        }
    }
    let instantPoison = function(a, v) {
        logs.push("💔 " + tempObj.name[v] + " 중독!");
        if (tempObj.effect[v].poison) {
            tempObj.effect[v].poison.stack++;
            tempObj.effect[v].poison.turn = 3;
        } else {
            tempObj.effect[v].poison = {
                stack: 1,
                turn: 3
            };
        }
        if (tempObj.weapon[a].name == "맹독 비수" && tempObj.weapon[a].tier >= 7) {
            logs.push("❇️ " + tempObj.name[a] + "의 극독!");
            tempObj.effect[v].poison.stack++;
        }
        if (tempObj.weapon[a].name == "아스트로베놈") {
            let r = Math.random();
            if (tempObj.weapon[a].tier >= 1 && r <= 0.45) {
                logs.push("❇️ " + tempObj.name[a] + "의 극독 x2!");
                tempObj.effect[v].poison.stack += 2;
            } else {
                logs.push("❇️ " + tempObj.name[a] + "의 극독!");
                tempObj.effect[v].poison.stack++;
            }
            tempObj.effect[v].astroVenom = {
                turn: 3,
                tier: tempObj.weapon[a].tier
            };
        }
    }
    let instantBleed = function(a, v) {
        logs.push("🩸 " + tempObj.name[v] + " 출혈!");
        if (tempObj.artifact[v].includes("블러드리스")) {
            logs.push("❇️ " + tempObj.name[v] + "의 출혈 면역!");
        } else {
            if (tempObj.effect[v].bleed) {
                let maxStack = 1;
                if (tempObj.artifact[a].includes("암살자의 칼날")) maxStack += tempObj.artifact[a].filter(a => a == "암살자의 칼날").length * 3;
                if (tempObj.weapon[a].name == "천명즉살검" && tempObj.weapon[a].tier >= 5) maxStack += 1;
                tempObj.effect[v].bleed.max = Math.max(maxStack, tempObj.effect[v].bleed.max);
                tempObj.effect[v].bleed.stack = Math.min(tempObj.effect[v].bleed.max, tempObj.effect[v].bleed.stack + 1);
            } else {
                tempObj.effect[v].bleed = {
                    turn: 2,
                    stack: 1,
                    max: 1
                };
            }
            if (tempObj.weapon[a].name == "천명즉살검" && tempObj.weapon[a].tier >= 5) {
                tempObj.effect[v].bleed.enhanced = true;
            }
            if (tempObj.weapon[a].name == "뱀파이어의 송곳니" && tempObj.weapon[a].tier >= 7 && tempObj.effect[victim].vampire) {
                tempObj.stack[a].vampire_mark = 1;
                logs.push("❇️ " + tempObj.name[a] + "의 표식 회수!");
                let skillDamage = Math.min(getPercentMaxHP(v, 0.2), (20 + tempObj.stack[a].vampire) * 20);
                if (dealt(a, v, {p:0,m:skillDamage,t:0})) return;
                delete tempObj.effect[v].vampire;
            }
            if (tempObj.weapon[a].name == "혈성극검" && tempObj.effect[victim].crimsonMark) {
                tempObj.stack[a].vampire_mark = 1;
                logs.push("❇️ " + tempObj.name[a] + "의 표식 회수!");
                let skillDamage = getPercentMaxHP(v, 0.2);
                if (dealt(a, v, {p:0,m:skillDamage,t:0})) return;
                delete tempObj.effect[v].vampire;
            }
        }
    }
    let instantStun = function(a, v) {
        logs.push("🌀 " + tempObj.name[v] + " 기절!");
        if (tempObj.armor[v].option && tempObj.armor[v].option.find(o => o.name == "제어 면역")) {
            let num = tempObj.armor[v].option.filter(o => o.name == "제어 면역").reduce((sum, o) => sum + o.num, 0);
            let r = Math.random();
            if (r < num) {
                logs.push("🔯 " + tempObj.name[v] + "의 제어 면역!");
                return;
            }
        }
        tempObj.effect[v].stun = {
            turn: 1
        };
    }
    let instantFreeze = function(a, v) {
        logs.push("❄️ " + tempObj.name[v] + " 빙결!");
        if (tempObj.armor[v].option && tempObj.armor[v].option.find(o => o.name == "제어 면역")) {
            let num = tempObj.armor[v].option.filter(o => o.name == "제어 면역").reduce((sum, o) => sum + o.num, 0);
            let r = Math.random();
            if (r < num) {
                logs.push("🔯 " + tempObj.name[v] + "의 제어 면역!");
                return;
            }
        }
        tempObj.effect[v].freeze = {
            turn: 1
        };
    }
    let instantSlow = function(a, v) {
        logs.push("🔽 " + tempObj.name[v] + " 둔화!");
        if (tempObj.armor[v].option && tempObj.armor[v].option.find(o => o.name == "제어 면역")) {
            let num = tempObj.armor[v].option.filter(o => o.name == "제어 면역").reduce((sum, o) => sum + o.num, 0);
            let r = Math.random();
            if (r < num) {
                logs.push("🔯 " + tempObj.name[v] + "의 제어 면역!");
                return;
            }
        }
        tempObj.effect[v].slow = {
            turn: 1
        };
    }
    let instantFear = function(a, v) {
        logs.push("😨 " + tempObj.name[v] + " 공포!");
        if (tempObj.armor[v].option && tempObj.armor[v].option.find(o => o.name == "제어 면역")) {
            let num = tempObj.armor[v].option.filter(o => o.name == "제어 면역").reduce((sum, o) => sum + o.num, 0);
            let r = Math.random();
            if (r < num) {
                logs.push("🔯 " + tempObj.name[v] + "의 제어 면역!");
                return;
            }
        }
        tempObj.effect[v].fear = {
            turn: (tempObj.stack[a].icefear ? 2 : 1)
        };
    }
    let instantCounter = function(a, v, originDamage) {
        logs.push("⚔️ " + tempObj.name[a] + "의 반격!");
        let actorActivated = getActivated(tempObj.tempStat[a]);
        let victimActivated = getActivated(tempObj.tempStat[v]);
        if (tempObj.stack[a].counterCmb) {
            delete tempObj.stack[a].counterCmb;
            actorActivated.push("pnt");
        }
        if (!tempObj.cntAct) {
            tempObj.cntAct = {};
        }
        tempObj.cntAct[a] = actorActivated;
        tempObj.cntAct[v] = victimActivated;
        if (victimActivated.includes("avd") && actorActivated.includes("hit") && tempObj.artifact[a].includes("고대의 눈알")) {
            let r = Math.random();
            if (r < 0.5) {
                logs.push("❇️ " + tempObj.name[a] + "의 절대자의 눈!");
                victimActivated.remove("avd");
            }
        }
        if (victimActivated.includes("avd") && actorActivated.includes("hit") && tempObj.weapon[a].name == "천명즉살검" && tempObj.weapon[a].tier >= 6 && tempObj.effect[v].bleed) {
            logs.push("❇️ " + tempObj.name[a] + "의 암살자의 눈!");
            victimActivated.remove("avd");
        }
        if (! tempObj.effect[v].stun && !tempObj.effect[v].freeze && !actorActivated.includes("hit")) {
            logs.push("❌ 빗나갔습니다!");
        } else if (! tempObj.effect[v].stun && !tempObj.effect[v].freeze && victimActivated.includes("avd")) {
            logs.push("💨 회피했습니다!");
            if (tempObj.armor[v] == "그림자 망토" && tempObj.artifact[v].includes("아르카나 그림자 망토")) {
                logs.push("🟪 " + tempObj.name[v] + "의 암흑의 흡수!");
                tempObj.stack[v].darkAbsorp = 1;
                if (dealt(v, a, {p:0,m:0,t:getPercentMaxHP(v, 0.05)})) return;
            }
        } else {
            let counterDamage = {
                p: 50,
                m: 0,
                t: 0
            };
            if (tempObj.weapon[a].name == "슬라임") {
                logs.push("❇️ " + tempObj.name[a] + "의 피해 흡수!")
                counterDamage.t = Math.round(originDamage / 2);
            } else if (tempObj.weapon[a].name == "격조의 창") {
                if (! tempObj.stack[a].spear) tempObj.stack[a].spear = 0;
                tempObj.stack[a].spear++;
                if (tempObj.weapon[a].tier >= 7 && tempObj.stack[a].spear % 3 == 0) {
                    logs.push("❇️ " + tempObj.name[a] + "의 격조!");
                    counterDamage.p += 180;
                    instantBleed(a, v);
                    tempObj.effect[v].speared = {
                        turn: 1
                    };
                }
                if (tempObj.weapon[a].tier >= 4) {
                    counterDamage.p = 80;
                    let r = Math.random();
                    if (r < 0.1) {
                        logs.push("❇️ " + tempObj.name[a] + "의 참뢰!");
                        instantStun(a, v);
                    }
                }
                if (tempObj.artifact[a].includes("아르카나 격조의 창")) {
                    logs.push("🟪 " + tempObj.name[a] + "의 월영반류!");
                    counterDamage.p += Math.round(originDamage * 0.75);
                    tempObj.stack[a].moonCnt = 1;
                }
            } else if (tempObj.weapon[a].name == "성월의 레이피어") {
                counterDamage.p += Math.round(originDamage * 0.9);
                let r = Math.random();
                if (r < 0.3) {
                    counterDamage.p += 80;
                    logs.push("❇️ " + tempObj.name[a] + "의 참뢰!");
                    instantStun(a, v);
                }
                if (! tempObj.stack[a].spear) tempObj.stack[a].spear = 0;
                tempObj.stack[a].spear++;
                if (tempObj.stack[a].spear % 3 == 0) {
                    logs.push("❇️ " + tempObj.name[a] + "의 격조!");
                    counterDamage.p += 250 + (tempObj.weapon[a].tier < 6 ? 0 : getPercentMaxHP(victim, 0.15));;
                    instantBleed(a, v);
                    tempObj.effect[v].speared = {
                        turn: 1
                    };
                    if (tempObj.weapon[a].tier >= 1) {
                        heal(a, getPercentMaxHP(a, 0.05));
                    }
                }
            }
            if (tempObj.armor[a].name == "여명의 갑주" && tempObj.armor[a].tier >= 7 && tempObj.stack[a].dawn > 0) {
                logs.push("❇️ " + tempObj.name[a] + "의 은빛 여명!");
                counterDamage.m += tempObj.stack[a].dawn;
                tempObj.stack[a].dawn = 0;
            }
            if (tempObj.artifact[a].includes("철가루 슬라임") && tempObj.stack[a].shockAbsorp) {
                logs.push("❇️ " + tempObj.name[a] + "의 흩날리는 철가루!");
                counterDamage.p += tempObj.stack[a].shockAbsorp;
                tempObj.stack[a].shockAbsorp = 0;
            }
            if (tempObj.weapon[a].name == "성월의 레이피어" && tempObj.weapon[a].tier >= 8 && actorActivated.includes("crt")) {
                logs.push("💥 " + tempObj.name[a] + "의 일격!");
                let mul = 2;
                if (tempObj.weapon[actor].option && tempObj.weapon[actor].option.find(o => o.name == "일격 피해 증가")) {
                    let num = tempObj.weapon[actor].option.filter(o => o.name == "일격 피해 증가").reduce((sum, o) => sum + o.num, 0);
                    mul += num;
                }
                if (tempObj.armor[victim].option && tempObj.armor[victim].option.find(o => o.name == "일격 피해 감소")) {
                    let num = tempObj.armor[victim].option.filter(o => o.name == "일격 피해 감소").reduce((sum, o) => sum + o.num, 0);
                    mul = Math.max(1, mul - num);
                }
                counterDamage.p = Math.round(counterDamage.p * mul);
                counterDamage.m = Math.round(counterDamage.m * mul);
                counterDamage.t = Math.round(counterDamage.t * mul);
            }
            let orgDmg = JSON.parse(JSON.stringify(counterDamage));
            if (tempObj.weapon[a].option && tempObj.weapon[a].option.find(o => o.name == "반격 피해 증가")) {
                let num = tempObj.weapon[a].option.filter(o => o.name == "반격 피해 증가").reduce((sum, o) => sum + o.num, 0);
                counterDamage.p = counterDamage.p + Math.round(orgDmg.p * num);
                counterDamage.m = counterDamage.m + Math.round(orgDmg.m * num);
                counterDamage.t = counterDamage.t + Math.round(orgDmg.t * num);
            }
            if (tempObj.armor[v].option && tempObj.armor[v].option.find(o => o.name == "반격 피해 감소")) {
                let num = tempObj.armor[v].option.filter(o => o.name == "반격 피해 감소").reduce((sum, o) => sum + o.num, 0);
                counterDamage.p = Math.max(0, counterDamage.p - Math.round(orgDmg.p * num));
                counterDamage.m = Math.max(0, counterDamage.m - Math.round(orgDmg.m * num));
            }
            if (dealt(a, v, counterDamage, null, {isCounter: true})) return true;
            if (tempObj.weapon[a].name == "슬라임") {
                heal(a, counterDamage.t);
            }
            if (tempObj.weapon[a] == "성월의 레이피어" && tempObj.weapon[a].tier >= 1 && tempObj.stack[a].spear % 3 == 0) {
                heal(a, getPercentMaxHP(a, 0.05));
            }
            return false;
        }
    }
    let getPercentMaxHP = function(v, p) {
        if (tempObj.artifact[v].includes("질긴 가죽")) p *= 0.1;
        return Math.round(tempObj.stat[v].maxHp * p);
    }
    let getPercentHP = function(v, p) {
        if (tempObj.artifact[v].includes("질긴 가죽")) p *= 0.1;
        return Math.round(tempObj.stat[v].hp * p);
    }
    let getPercentlostHP = function(v, p) {
        if (tempObj.artifact[v].includes("질긴 가죽")) p *= 0.1;
        return Math.round((tempObj.stat[v].maxHp - tempObj.stat[v].hp) * p);
    }
    let logs = tempObj.logs;
    let tempActorStat = JSON.parse(JSON.stringify(tempObj.stat[actor]));
    let tempVictimStat = JSON.parse(JSON.stringify(tempObj.stat[victim]));
    if (tempObj.weapon[actor].name == "새벽 단검" && tempObj.weapon[actor].tier >= 6 && tempObj.effect[victim].bleed) {
        tempActorStat.cmb += 0.5;
    } else if (tempObj.weapon[actor].name == "맹독 비수" && tempObj.weapon[actor].tier >= 2 && tempObj.effect[victim].poison) {
        tempActorStat.pnt += 0.15;
    } else if (tempObj.weapon[actor].name == "아스트로베놈" && tempObj.weapon[actor].tier >= 2 && tempObj.effect[victim].poison) {
        tempActorStat.pnt += 0.25;
        if (tempObj.weapon[actor].tier >= 6 && tempObj.effect[victim].poison.stack >= 10) {
            tempActorStat.dth += 0.15;
        }
    }
    if (tempObj.weapon[actor].name == "하늘의 장궁" && tempObj.weapon[actor].tier >= 4 && tempObj.stack[actor].missed >= 2 && !tempObj.effect[actor].combo) {
        tempActorStat.hit += 1;
        tempActorStat.crt += 1;
        tempVictimStat.avd -= 99;
    }
    if (tempObj.weapon[victim].name == "하늘의 장궁" && tempObj.weapon[victim].tier >= 4 && tempObj.stack[victim].missed >= 2 && !tempObj.effect[victim].combo) {
        tempVictimStat.hit += 1;
        tempVictimStat.crt += 1;
        tempActorStat.avd -= 99;
    }
    if (tempObj.effect[actor].conversion) {
        tempActorStat.hit += 1;
        tempVictimStat.avd -= 99;
    }
    if (tempObj.effect[victim].conversion) {
        tempVictimStat.hit += 1;
        tempActorStat.avd -= 99;
    }
    if (tempObj.effect[actor].determ) {
        tempActorStat.hit += 1;
        tempActorStat.crt += 1;
    }
    if (tempObj.effect[victim].determ) {
        tempVictimStat.hit += 1;
        tempVictimStat.crt += 1;
    }
    if (tempObj.effect[actor].slow) {
        tempActorStat.hit -= 0.2;
        tempActorStat.cmb -= 0.2;
        tempActorStat.cnt -= 0.2;
        tempActorStat.avd -= 0.2;
    }
    if (tempObj.effect[victim].slow) {
        tempVictimStat.hit -= 0.2;
        tempVictimStat.cmb -= 0.2;
        tempVictimStat.cnt -= 0.2;
        tempVictimStat.avd -= 0.2;
    }
    if (tempObj.effect[actor].stealth) {
        tempActorStat.avd += 1;
    }
    if (tempObj.effect[victim].stealth) {
        tempVictimStat.avd += 1;
    }
    if (tempObj.weapon[actor].name == "엠파이리언 아크" && tempObj.weapon[actor].tier >= 7 && !tempObj.stack[actor].empyreanShot) {
        tempActorStat.avd += 0.35;
    }
    if (tempObj.weapon[victim].name == "엠파이리언 아크" && tempObj.weapon[victim].tier >= 7 && !tempObj.stack[actor].empyreanShot) {
        tempVictimStat.avd += 0.35;
    }
    if (tempObj.weapon[actor].name == "서리 아귀" && tempObj.effect[victim].reification) {
        tempActorStat.avd -= 1;
    }
    if (tempObj.weapon[victim].name == "서리 아귀" && tempObj.effect[victim].reification) {
        tempVictimStat.avd -= 1;
    }
    if (tempObj.effect[actor].illusion) tempActorStat.hit -= 0.2;
    if (tempObj.effect[victim].illusion) tempActorStat.avd -= 0.2;
    if (tempObj.weapon[actor].option && tempObj.weapon[actor].option.find(o => o.name == "즉사")) tempActorStat.dth += tempObj.weapon[actor].option.filter(o => o.name == "즉사").reduce((sum, o) => sum + o.num, 0);
    if (tempObj.weapon[actor].name == "혈성극검" && tempObj.weapon[actor].tier >= 6 && tempObj.stack[actor].bloodstar && tempObj.stack[actor].bloodstar >= 10) {
        tempActorStat.crt += 1;
        tempActorStat.cmb += 1;
    }
    if (tempObj.weapon[actor].enchant && tempObj.weapon[actor].enchant.find(e => e.name == "둔화")) tempActorStat.slw = 0.25 * tempObj.weapon[actor].enchant.find(e => e.name == "둔화").level;
    if (!tempObj.tempStat) tempObj.tempStat = {};
    tempObj.tempStat[actor] = tempActorStat;
    tempObj.tempStat[victim] = tempVictimStat;
    let actorActivated = getActivated(tempActorStat);
    let victimActivated = getActivated(tempVictimStat);
    let actorWeapon = tempObj.weapon[actor].name;
    let actorTier = tempObj.weapon[actor].tier;
    let actorArmor = tempObj.armor[actor].name;
    let actorArmorTier = tempObj.armor[actor].tier;
    let victimArmor = tempObj.armor[victim].name;
    let victimArmorTier = tempObj.armor[victim].tier;
    let damage = {
        p: 0,
        m: 0,
        t: 0
    };
    if (tempObj.effect[actor].empyreanShot) {
        delete tempObj.effect[actor].empyreanShot;
        logs.push("⬇️ 창천의 화살이 " + tempObj.name[victim] + "에게 낙하합니다!");
        if (dealt(actor, victim, {p:0,m:0,t:900+getPercentMaxHP(victim,0.375)}, false, {isEmpyreanShot:true})) return;
    }
    let determination = true;
    if (!tempObj.effect[actor].combo && actor != "shade") logs.push("\n[ " + tempObj.name[actor] + "의 공격 ]");
    if (tempObj.artifact[victim].includes("프리가라흐")) {
        let r = Math.random();
        if (r < 0.15) {
            logs.push("❇️ " + tempObj.name[victim] + "의 의지 박탈!");
            if (tempObj.armor[victim].option && tempObj.armor[victim].option.find(o => o.name == "제어 면역")) {
                let num = tempObj.armor[victim].option.filter(o => o.name == "제어 면역").reduce((sum, o) => sum + o.num, 0);
                let r2 = Math.random();
                if (r2 < num) {
                    logs.push("🔯 " + tempObj.name[victim] + "의 제어 면역!");
                } else {
                    determination = false;
                }
            } else {
                determination = false;
            }
        }
    }
    if (tempObj.artifact[victim].includes("홍월의 프리가라흐")) {
        let r = Math.random();
        if (r < 0.25) {
            logs.push("❇️ " + tempObj.name[victim] + "의 의지 박탈!");
            if (tempObj.armor[victim].option && tempObj.armor[victim].option.find(o => o.name == "제어 면역")) {
                let num = tempObj.armor[victim].option.filter(o => o.name == "제어 면역").reduce((sum, o) => sum + o.num, 0);
                let r2 = Math.random();
                if (r2 < num) {
                    logs.push("🔯 " + tempObj.name[victim] + "의 제어 면역!");
                } else {
                    determination = false;
                }
            } else {
                determination = false;
            }
        }
    }
    if (determination) {
        if (actorWeapon == "하늘의 장궁" && actorTier >= 4 && tempObj.stack[actor].missed >= 2 && !tempObj.effect[actor].combo) {
            logs.push("❇️ " + tempObj.name[actor] + "의 운명의 일격!");
        }
        if (actorWeapon == "엠파이리언 아크" && tempObj.stack[actor].missed >= (actorTier >= 3 ? 1 : 2) && !tempObj.effect[actor].combo) {
            logs.push("❇️ " + tempObj.name[actor] + "의 운명의 일격!");
        }
        if (actorWeapon == "혈성극검" && actorTier >= 6 && tempObj.stack[actor].bloodstar && tempObj.stack[actor].bloodstar >= 10) {
            logs.push("❇️ " + tempObj.name[actor] + "의 혈성의 극!");
        }
        if (tempObj.weapon[victim].name == "서리 아귀" && !tempObj.effect[victim].reification) {
            victimActivated.remove("avd");
        }
        if (tempObj.artifact[actor].includes("신의 눈")) {
            actorActivated.push("hit");
            victimActivated.remove("avd");
        }
        if (victimActivated.includes("avd") && actorActivated.includes("hit") && tempObj.artifact[actor].includes("고대의 눈알")) {
            let r = Math.random();
            if (r < 0.5) {
                logs.push("❇️ " + tempObj.name[actor] + "의 절대자의 눈!");
                victimActivated.remove("avd");
            }
        }
        if (victimActivated.includes("avd") && actorActivated.includes("hit") && tempObj.weapon[actor].name == "천명즉살검" && tempObj.weapon[actor].tier >= 6 && tempObj.effect[victim].bleed) {
            logs.push("❇️ " + tempObj.name[actor] + "의 암살자의 눈!");
            victimActivated.remove("avd");
        }
        if (!actorActivated.includes("hit") && tempObj.artifact[actor].includes("프리가라흐") && SWORDS.includes(actorWeapon)) {
            logs.push("❇️ " + tempObj.name[actor] + "의 빗나가지 않는 검!");
            actorActivated.push("hit");
        }
        if (victimActivated.includes("avd") && actorActivated.includes("hit") && tempObj.artifact[actor].includes("프리가라흐") && SWORDS.includes(actorWeapon)) {
            let r = Math.random();
            if (r < 0.65) {
                logs.push("❇️ " + tempObj.name[actor] + "의 빗나가지 않는 검!");
                victimActivated.remove("avd");
            }
        }
        if (!actorActivated.includes("hit") && tempObj.artifact[actor].includes("홍월의 프리가라흐") && SWORDS.includes(actorWeapon)) {
            logs.push("❇️ " + tempObj.name[actor] + "의 빗나가지 않는 검!");
            actorActivated.push("hit");
        }
        if (victimActivated.includes("avd") && actorActivated.includes("hit") && tempObj.artifact[actor].includes("홍월의 프리가라흐") && SWORDS.includes(actorWeapon)) {
            let r = Math.random();
            if (r < 0.75) {
                logs.push("❇️ " + tempObj.name[actor] + "의 빗나가지 않는 검!");
                victimActivated.remove("avd");
            }
        }
        if (actorArmor == "방랑자의 천갑옷" && actorArmorTier >= 6 && tempObj.effect[actor].speedCounter && !tempObj.effect[actor].combo) {
            actorActivated.push("hit");
            logs.push("❇️ " + tempObj.name[actor] + "의 재빠른 반격!");
        }
        if (tempObj.weapon[victim].name == "서리 아귀" && !tempObj.effect[victim].reification) {
            victimActivated.push("avd");
        }
    }
    if (tempObj.effect[actor].stun) {
        logs.push("🌀 " + tempObj.name[actor] + "(이)가 기절하여 공격할 수 없습니다!");
        actorActivated.remove("cmb");
    } else if (tempObj.effect[actor].freeze) {
        logs.push("❄️ " + tempObj.name[actor] + "(이)가 얼어붙어 공격할 수 없습니다!");
        actorActivated.remove("cmb");
    } else if (tempObj.effect[actor].fear) {
        logs.push("😨 " + tempObj.name[actor] + "(이)가 공포로 인해 공격하지 못합니다!");
        actorActivated.remove("cmb");
    } else if (!determination) {
        logs.push("😨 " + tempObj.name[actor] + "(이)가 공격 의지를 잃었습니다!");
        actorActivated.remove("cmb");
    } else if (!tempObj.effect[victim].stun && !tempObj.effect[victim].freeze && actorWeapon != "사신의 낫" && actorWeapon != "소울 하베스터" && !actorActivated.includes("hit")) {
        logs.push("❌ 빗나갔습니다!");
        if (actorWeapon == "하늘의 장궁" && actorTier >= 4) {
            tempObj.stack[actor].missed++;
        } else if (actorWeapon == "엠파이리언 아크") {
            tempObj.stack[actor].missed++;
        } else if (actorWeapon == "아이스 베어") {
            logs.push("❇️ 공격의 여파로 피해를 입힙니다!");
            if (dealt(actor, victim, {p:110,m:0,t:0})) return;
            instantSlow(actor, victim);
        }
    } else if (!tempObj.effect[victim].stun && !tempObj.effect[victim].freeze && actorWeapon != "사신의 낫" && actorWeapon != "소울 하베스터" && victimActivated.includes("avd")) {
        logs.push("💨 회피했습니다!");
        if (actorWeapon == "하늘의 장궁" && actorTier >= 4) {
            tempObj.stack[actor].missed++;
        } else if (actorWeapon == "엠파이리언 아크") {
            tempObj.stack[actor].missed++;
        } else if (actorWeapon == "아이스 베어") {
            logs.push("❇️ 공격의 여파로 피해를 입힙니다!");
            if (dealt(actor, victim, {p:110,m:0,t:0})) return;
            instantSlow(actor, victim);
        }
        if (tempObj.weapon[victim].name == "서리 아귀") {
            let r = Math.random();
            if (r < 0.35) {
                logs.push("❇️ " + tempObj.name[victim] + "의 서리 산맥의 공포!");
                tempObj.stack[victim].icefear = true;
                instantFear(victim, actor);
            }
        }
        if (victimArmor == "방랑자의 천갑옷" && victimArmorTier >= 6) {
            tempObj.effect[victim].speedCounter = {
                turn: 1
            };
        }
        if (victimArmor == "그림자 망토" && tempObj.artifact[victim].includes("아르카나 그림자 망토")) {
            logs.push("🟪 " + tempObj.name[victim] + "의 암흑의 흡수!");
            tempObj.stack[victim].darkAbsorp = 1;
            if (dealt(victim, actor, {p:0,m:0,t:getPercentMaxHP(victim, 0.05)})) return;
        }
        if (tempObj.artifact[victim].includes("이카리스의 날개")) {
            logs.push("❇️ " + tempObj.name[victim] + "의 천공낙하!");
            if (dealt(victim, actor, {p:0,m:0,t:230})) return;
        }
    } else {
        if (tempObj.stack[victim].balloon) {
            delete tempObj.stack[victim].balloon;
            let r = Math.random();
            if (r < 0.35) {
                logs.push("🎇 풍선을 터뜨렸습니다!");
                // 비동기 지급은 전투 종료 후 applyCombatSideEffects() 에서 처리(동기 유지)
                (tempObj.giveItems = tempObj.giveItems || []).push({
                    name: (tempObj.name[actor].includes("[") ? tempObj.name[actor].split("] ")[1] : tempObj.name[actor]),
                    item: { name: "어린이날 선물 상자", type: "소모품", count: 1 }
                });
            } else {
                logs.push("😢 풍선을 터뜨리지 못했습니다..");
            }
        }
        if (actorWeapon == "방랑자의 장검") {
            damage.p += 50;
            if (! tempObj.stack[actor].sword) tempObj.stack[actor].sword = 0;
            damage.p += tempObj.stack[actor].sword;
            if (actorTier >= 4) {
                let r = Math.random();
                let percent = 0.1;
                if (actorTier >= 7 && tempObj.effect[actor].combo) percent = 0.8;
                if (r < percent) {
                    logs.push("❇️ " + tempObj.name[actor] + "의 검기 발산!");
                    let skillDamage = 50;
                    if (actorTier >= 6) {
                        skillDamage += getPercentMaxHP(victim, 0.05);
                    }
                    if (tempObj.artifact[actor].includes("아르카나 방랑자의 장검")) {
                        skillDamage += tempObj.stack[actor].sword * tempObj.artifact[actor].filter(a => a == "아르카나 방랑자의 장검").length;
                    }
                    if (dealt(actor, victim, {p:0,m:skillDamage,t:0})) return;
                }
            }
        } else if (actorWeapon == "늑대 발톱") {
            damage.p += 40;
        } else if (actorWeapon == "연약한 늑대 발톱") {
            damage.p += 20;
        } else if (actorWeapon == "새벽 단검") {
            damage.p += 95;
            if (actorTier >= 4 && tempObj.effect[victim].bleed) {
                let r = Math.random();
                if (r < 0.65) {
                    logs.push("❇️ " + tempObj.name[actor] + "의 붉은 새벽녘!");
                    damage.p += getPercentHP(victim, 0.15);
                }
            }
            if (tempObj.artifact[actor].includes("아르카나 새벽 단검")) {
                if (! tempObj.stack[actor].daybreak) tempObj.stack[actor].daybreak = 0;
                tempObj.stack[actor].daybreak++;
                if (! tempObj.stack[victim].daybreaked && tempObj.stat[victim].hp <= Math.round(tempObj.stat[victim].maxHp * 0.5)) {
                    tempObj.stack[victim].daybreaked = 1;
                    logs.push("🟪 " + tempObj.name[actor] + "의 고요의 새벽!");
                    if (dealt(actor, victim, {p:getPercentlostHP(victim, 0.1) * tempObj.stack[actor].daybreak,m:0,t:0}));
                    tempObj.stack[actor].daybreak = 0;
                }
            }
        } else if (actorWeapon == "별빛 지팡이") {
            damage.m += 80;
            if (tempObj.artifact[actor].includes("아르카나 별빛 지팡이") && !tempObj.effect[actor].combo) {
                if (!tempObj.stack[actor].starShield) tempObj.stack[actor].starShield = 0;
                if (tempObj.stack[actor].starShield % 4 == 0) {
                    logs.push("🟪 " + tempObj.name[actor] + "의 별의 가호!");
                    if (! tempObj.stat[actor].shield) tempObj.stat[actor].shield = 0;
                    tempObj.stat[actor].shield += getPercentMaxHP(actor, 0.12);
                }
                tempObj.stack[actor].starShield++;
            }
            if (actorTier >= 6) {
                let r = Math.random();
                if (r < 0.65) {
                    logs.push("❇️ " + tempObj.name[actor] + "의 번개 강화!");
                    damage.m += getPercentHP(victim, 0.07);
                }
            }
            if (tempObj.effect[actor].thunder) {
                tempObj.effect[actor].thunder.stack++;
            } else {
                tempObj.effect[actor].thunder = {
                    turn: 1,
                    stack: 1
                };
            }
            if (actorTier >= 4) {
                let r = Math.random();
                if (r < 0.35) {
                    logs.push("❇️ " + tempObj.name[actor] + "의 연쇄 뇌격!");
                    tempObj.effect[actor].thunder.stack++;
                    damage.m += 80;
                    if (actorTier >= 6) {
                        let r = Math.random();
                        if (r < 0.65) {
                            logs.push("❇️ " + tempObj.name[actor] + "의 번개 강화!");
                            damage.m += getPercentHP(victim, 0.07);
                        }
                    }
                }
            }
        } else if (actorWeapon == "뱀파이어의 송곳니") {
            damage.m += 20;
            damage.p += 20;
            if (! tempObj.stack[actor].vampire) tempObj.stack[actor].vampire = 0;
            if (actorTier >= 4 && tempObj.effect[victim].bleed) {
                logs.push("❇️ " + tempObj.name[actor] + "의 핏빛 갈망!");
                tempObj.stack[actor].vampire += 3;
                heal(actor, 20);
            }
            damage.m += tempObj.stack[actor].vampire;
            damage.p += tempObj.stack[actor].vampire;
            if (actorTier >= 7) {
                let r = Math.random();
                if (r < 0.25) {
                    logs.push("❇️ " + tempObj.name[actor] + "의 뱀파이어의 표식!");
                    tempObj.effect[victim].vampire = {
                        turn: 2
                    };
                }
            }
        } else if (actorWeapon == "하늘의 장궁") {
            damage.p += 75;
            tempObj.stack[actor].missed = 0;
            if (tempObj.effect[actor].conversion) {
                delete tempObj.effect[actor].conversion;
                actorActivated.push("crt");
                logs.push("🟪 " + tempObj.name[actor] + "의 회심의 일격!");
                damage.p += 150;
            }
            if (tempObj.artifact[actor].includes("아르카나 하늘의 장궁") && !actorActivated.includes("crt") && !actorActivated.includes("pnt") && !tempObj.effect[actor].conversion) {
                actorActivated = [];
                damage.p = 0;
                tempObj.effect[actor].conversion = {
                    turn: 2
                };
                logs.push("🟪 " + tempObj.name[actor] + "(이)가 활을 신중히 당깁니다.");
            }
        } else if (actorWeapon == "맹독 비수") {
            damage.p += 45;
            if (actorTier >= 4 && tempObj.effect[victim].poison) {
                logs.push("❇️ " + tempObj.name[actor] + "의 맹독 난무!");
                damage.p += tempObj.effect[victim].poison.stack * 15;
            }
            if (actorTier >= 6 && tempObj.effect[victim].poison && tempObj.effect[victim].poison.stack >= 3) {
                let r = Math.random();
                if (r < 0.35) {
                    logs.push("❇️ " + tempObj.name[actor] + "의 독소 폭발!");
                    if (dealt(actor, victim, {p:0,m:0,t:Math.round(tempObj.effect[victim].poison.stack * getPercentMaxHP(victim, 0.02))})) return;
                }
            }
            if (tempObj.artifact[actor].includes("아르카나 맹독 비수")) {
                let r = Math.random();
                if (r < 0.65) {
                    logs.push("🟪 " + tempObj.name[actor] + "의 환영독!");
                    instantPoison(actor, victim);
                    tempObj.effect[victim].illusion = {
                        turn: 3
                    };
                }
            }
        } else if (actorWeapon == "맨손") {
            damage.p += 25;
        } else if (actorWeapon == "슬라임") {
            damage.m += 35;
        } else if (actorWeapon == "흉포한 도끼") {
            damage.p += (actorTier >= 2 ? 70 : 60);
            if (! tempObj.stack[actor].axe) tempObj.stack[actor].axe = 0;
            damage.p += tempObj.stack[actor].axe;
            tempObj.stack[actor].axe += (actorTier >= 1 ? (actorTier >= 6 ? 10 : 3) : 0);
            if (actorTier >= 7 && tempObj.effect[victim].bleed) {
                tempObj.stack[actor].axe += Math.max(10, getPercentMaxHP(victim, 0.03));
            }
            if (tempObj.artifact[actor].includes("아르카나 흉포한 도끼") && ! tempObj.stack[actor].arcanaAxe) {
                tempObj.stack[actor].arcanaAxe = 1;
                logs.push("🟪 " + tempObj.name[actor] + "의 울부짖는 도끼!");
                tempObj.stat[victim].def -= 0.1;
                tempObj.stack[actor].axe += 100;
                damage.p += 100;
            }
        } else if (actorWeapon == "염화의 지팡이") {
            damage.m += 70;
            if (actorTier >= 4) {
                let r = Math.random();
                let percent = 0.35;
                if (tempObj.artifact[actor].includes("아르카나 염화의 지팡이")) {
                    percent = 0.65;
                }
                if (r < percent) {
                    logs.push("❇️ " + tempObj.name[actor] + "의 화염 폭발!");
                    damage.m += 135;
                    if (actorTier >= 6) damage.m += getPercentMaxHP(victim, 0.15);
                    if (actorTier >= 7 && tempObj.effect[victim].burn) damage.t += (getPercentMaxHP(victim, 0.04) * tempObj.effect[victim].burn.stack);
                    if (tempObj.artifact[actor].includes("아르카나 화염의 지팡이") && tempObj.effect[victim].burn) damage.m += (175 * tempObj.effect[victim].burn.stack);
                }
            }
        } else if (actorWeapon == "격조의 창") {
            damage.p += Math.floor(Math.random() * 21) + 55;
            if (! tempObj.stack[actor].spear) tempObj.stack[actor].spear = 0;
            tempObj.stack[actor].spear++;
            if (actorTier >= 7 && tempObj.stack[actor].spear % 3 == 0) {
                logs.push("❇️ " + tempObj.name[actor] + "의 격조!");
                damage.p += 180;
                actorActivated.push("bld");
                tempObj.effect[victim].speared = {
                    turn: 1
                };
            }
        } else if (actorWeapon == "황금 고블린의 검") {
            damage.t += getPercentMaxHP(victim, 0.1);
            tempObj.effect[victim].goblin = {
                turn: 1
            };
        } else if (actorWeapon == "보물 고블린의 검") {
            damage.t += getPercentMaxHP(victim, 0.2);
            tempObj.effect[victim].goblin = {
                turn: 1
            };
        } else if (actorWeapon == "사신의 낫") {
            if (tempObj.weapon[actor].tier >= 7) {
                let r = Math.random();
                if (r < 0.04) {
                    logs.push("❇️ " + tempObj.name[actor] + "의 죽음의 시선!");
                    if(instantDeath(actor, victim)) return;
                }
            }
            if (! tempObj.stack[actor].death) tempObj.stack[actor].death = 0;
            tempObj.stack[actor].death++;
            let coolTurn = 6;
            if (tempObj.weapon[actor].tier >= 2) coolTurn = 5;
            if (tempObj.weapon[actor].tier >= 3) coolTurn = 4;
            if (tempObj.stack[actor].death % coolTurn == 0) {
                let r = Math.random();
                let percent = 0;
                if (tempObj.name[actor] == "[사신] 네메시스") percent = 0.5;
                if (tempObj.weapon[actor].tier >= 7) percent = 0.1444;
                if (r < percent) {
                    logs.push("❇️ " + tempObj.name[actor] + "의 죽음의 손길!");
                    if(instantDeath(actor, victim)) return;
                } else {
                    logs.push("❇️ " + tempObj.name[actor] + "의 심판의 낫!");
                    if (! tempObj.stack[actor].scythe) tempObj.stack[actor].scythe = 0;
                    tempObj.stack[actor].scythe++;
                    let skillDamage = Math.max(444, getPercentMaxHP(victim, 0.44));
                    if (tempObj.weapon[actor].tier >= 5) skillDamage *= tempObj.stack[actor].scythe;
                    if (tempObj.weapon[actor].tier >= 4) damage.t = skillDamage;
                    else damage.p = skillDamage;
                    if(dealt(actor, victim, damage)) return;
                }
            } else {
                if (tempObj.weapon[actor].tier >= 1) {
                    logs.push("❇️ " + tempObj.name[actor] + "의 사신의 시선!");
                    if (tempObj.artifact[actor].includes("아르카나 사신의 낫") && tempObj.stat[victim].hp <= getPercentMaxHP(victim, 0.44)) {
                        let r = Math.random();
                        if (r < 0.44) {
                            logs.push("🟪 " + tempObj.name[actor] + "의 절멸!");
                            if (instantDeath(actor, victim)) return;
                        }
                    }
                    if (dealt(actor, victim, {p:0,m:0,t:Math.max(44, getPercentMaxHP(victim, 0.04))})) return;
                }
            }
            damage = {p:0,m:0,t:0};
            actorActivated.remove("cmb");
            actorActivated.remove("crt");
            actorActivated.remove("bld");
            actorActivated.remove("pnt");
            actorActivated.remove("stn");
            actorActivated.remove("poi");
            actorActivated.remove("brn");
            actorActivated.remove("pnt");
            if (tempObj.name[actor] == "[사신] 네메시스") actorActivated.remove("hit");
        } else if (actorWeapon == "소울 하베스터") {
            if (! tempObj.stack[actor].death) tempObj.stack[actor].death = 0;
            tempObj.stack[actor].death++;
            damage.t = Math.max(getPercentMaxHP(victim, 0.04), 44);
            if (actorTier >= 4 && tempObj.stack[actor].harvested_soul) {
                let harvested_soul = JSON.parse(read("DB/harvested_soul/" + tempObj.name[actor] + ".json"));
                if (harvested_soul.length >= 10) {
                    logs.push("❇️ " + tempObj.name[actor] + "의 망령의 저주!");
                    for (let v in tempObj.name) {
                        if (v == actor || v == 'shade' || (!v.startsWith('h') && v.startsWith(actor.substr(0, 1)))) continue;
                        if (tempObj.stat[v].hp <= 1) continue;
                        tempObj.stat[v].hp = Math.max(1, tempObj.stat[v].hp - 444);
                        logs.push(tempObj.name[v] + "의 HP: " + tempObj.stat[v].hp.toComma() + "/" + tempObj.stat[v].maxHp.toComma() + " (-444)");
                    }
                }
            }
            if (tempObj.stack[actor].death % 4 == 0) {
                let r = Math.random();
                if (r < 0.1444) {
                    logs.push("❇️ " + tempObj.name[actor] + "의 죽음의 손길!");
                    if(instantDeath(actor, victim)) return;
                } else {
                    if (! tempObj.stack[actor].scythe) tempObj.stack[actor].scythe = 0;
                    let skillDamage = Math.max(444, getPercentMaxHP(victim, 0.44));
                    skillDamage = Math.round(skillDamage * (1 + (tempObj.stack[actor].scythe * 0.44)));
                    logs.push("❇️ " + tempObj.name[actor] + "의 수확자의 낫!");
                    if(dealt(actor, victim, {p:0,m:0,t:skillDamage})) return;
                    tempObj.stack[actor].scythe++;
                }
            }
            if (tempObj.weapon[actor].tier >= 1 && tempObj.stat[victim].hp <= getPercentMaxHP(victim, 0.44)) {
                let r = Math.random();
                if (r < 0.44) {
                    logs.push("❇️ " + tempObj.name[actor] + "의 절멸!");
                    if (actorTier >= 5) tempObj.stack[actor].soul_cutter = true;
                    if (instantDeath(actor, victim)) return;
                }
            }
        } else if (actorWeapon == "성월의 레이피어") {
            let minDmg = (actorTier >= 5 ? 225 : 115);
            let maxDmg = (actorTier >= 5 ? 300 : 150);
            damage.p += Math.floor(Math.random() * (maxDmg - minDmg + 1)) + minDmg;
            if (! tempObj.stack[actor].spear) tempObj.stack[actor].spear = 0;
            tempObj.stack[actor].spear++;
            if (tempObj.stack[actor].spear % 3 == 0) {
                logs.push("❇️ " + tempObj.name[actor] + "의 격조!");
                damage.p += 250 + (actorTier < 6 ? 0 : getPercentMaxHP(victim, 0.15));
                actorActivated.push("bld");
                tempObj.effect[victim].speared = {
                    turn: 1
                };
                if (tempObj.weapon[actor].tier >= 1) {
                    heal(actor, getPercentMaxHP(actor, 0.05));
                }
            }
        } else if (actorWeapon == "아스트로베놈") {
            damage.p += 105;
            if (actorTier >= 4 && tempObj.effect[victim].poison) {
                logs.push("❇️ " + tempObj.name[actor] + "의 베놈!");
                damage.m += tempObj.effect[victim].poison.stack * Math.max(15, getPercentMaxHP(victim, 0.015));
            }
            let r = Math.random();
            if (r < 0.75) {
                logs.push("❇️ " + tempObj.name[actor] + "의 환영독!");
                instantPoison(actor, victim);
                tempObj.effect[victim].illusion = {
                    turn: 3
                };
            }
        } else if (actorWeapon == "천상유랑검") {
            if (! tempObj.stack[actor].sword) tempObj.stack[actor].sword = 0;
            damage.p += 110 + tempObj.stack[actor].sword;
            if (actorTier >= 4) {
                let r = Math.random();
                let percent = 0.45;
                if (actorTier >= 1 && tempObj.effect[actor].combo) percent = 0.9;
                if (r < percent) {
                    logs.push("❇️ " + tempObj.name[actor] + "의 검기 발산!");
                    let skillDamage = 130 + getPercentMaxHP(victim, 0.05) + tempObj.stack[actor].sword;
                    if (dealt(actor, victim, {p:0,m:skillDamage,t:0}, null, {isSwordAura: true})) return;
                    if (!tempObj.stack[actor].swordAura) tempObj.stack[actor].swordAura = 0;
                    tempObj.stack[actor].swordAura++;
                    if (actorTier >= 8 && tempObj.stack[actor].swordAura % 4 == 0) {
                        logs.push("❇️ " + tempObj.name[actor] + "의 천상의 검기!");
                        if (dealt(actor, victim, {p:0,m:skillDamage * 3,t:0}, null, {isSwordAura: true})) return;
                    }
                }
            }
        } else if (actorWeapon == "혈성극검") {
            damage.m += 45;
            damage.p += 45;
            if (! tempObj.stack[actor].vampire) tempObj.stack[actor].vampire = 0;
            if (tempObj.effect[victim].bleed) {
                logs.push("❇️ " + tempObj.name[actor] + "의 핏빛 갈망!");
                tempObj.stack[actor].vampire += 4;
                heal(actor, 35);
            }
            damage.m += tempObj.stack[actor].vampire;
            damage.p += tempObj.stack[actor].vampire;
            let r = Math.random();
            if (r < 0.35) {
                logs.push("❇️ " + tempObj.name[actor] + "의 붉은 표식!");
                tempObj.effect[victim].crimsonMark = {
                    turn: 2
                };
            }
            if (actorTier >= 4 && tempObj.effect[actor].combo && tempObj.stack[actor].bloodstar) {
                logs.push("❇️ " + tempObj.name[actor] + "의 혈쇄!");
                let baseDamage = 15;
                if (actorTier >= 5) baseDamage = 25;
                damage.t += tempObj.stack[actor].bloodstar * baseDamage;
                if (actorTier >= 8) {
                    if (!tempObj.stat[actor].shield) tempObj.stat[actor].shield = 0;
                    tempObj.stat[actor].shield += tempObj.stack[actor].bloodstar * 50;
                    logs.push("❇️ " + tempObj.name[actor] + "의 블러드 이클립스!");
                }
                if (actorTier >= 5) tempObj.stack[actor].bloodstar = Math.round(tempObj.stack[actor].bloodstar * 0.5);
                else tempObj.stack[actor].bloodstar = 0;
            }
            if (actorTier >= 8 && tempObj.stat[actor].shield) {
                damage.p += Math.round(tempObj.stat[actor].shield * 0.2);
            }
        } else if (actorWeapon == "셀레스티아") {
            damage.m += 175;
            if (actorTier >= 1) {
                logs.push("🌩️ 천둥이 내리칩니다!");
                for (let v in tempObj.name) {
                    if (v == actor || v == 'shade' || (!v.startsWith('h') && v.startsWith(actor.substr(0, 1)))) continue;
                    if (tempObj.stat[v].hp <= 1) continue;
                    dealt(actor, v, {p:0,m:getPercentHP(v, 0.08),t:0});
                }
            }
            let r = Math.random();
            if (r < 0.65) {
                logs.push("❇️ " + tempObj.name[actor] + "의 번개 강화!");
                damage.m += getPercentMaxHP(victim, 0.08);
            }
            if (tempObj.effect[actor].thunder) {
                tempObj.effect[actor].thunder.stack++;
            } else {
                tempObj.effect[actor].thunder = {
                    turn: 1,
                    stack: 1
                };
            }
            let rr = Math.random();
            if (rr < 0.5) {
                logs.push("❇️ " + tempObj.name[actor] + "의 연쇄 뇌격!");
                tempObj.effect[actor].thunder.stack++;
                damage.m += 175;
                let r = Math.random();
                if (r < 0.65) {
                    logs.push("❇️ " + tempObj.name[actor] + "의 번개 강화!");
                    damage.m += getPercentMaxHP(victim, 0.08);
                }
            }
            if (actorTier >= 2 && tempObj.effect[actor].thunder.stack >= 3) {
                let r = Math.random();
                if (r < 0.35) {
                    tempObj.effect[actor].thunder.stack = -99;
                    logs.push("❇️ " + tempObj.name[actor] + "의 천벌!");
                    if (tempObj.stat[victim].hp <= getPercentMaxHP(victim, 0.35)) {
                        if (instantDeath(actor, victim)) return;
                    }
                    if (dealt(actor, victim, {p:0,m:getPercentMaxHP(victim, 0.35),t:0})) return;
                }
            }
            if (actorTier >= 4) {
                if (!tempObj.stack[actor].aurora) tempObj.stack[actor].aurora = 0;
                tempObj.stack[actor].aurora += Math.floor(Math.random() * 16) + 10;
                if (tempObj.stack[actor].aurora >= 100) {
                    logs.push("❇️ " + tempObj.name[actor] + "의 오로라 마법!");
                    const isLuna = (actorTier >= 8 && (new Date().getHours() < 5 || new Date().getHours() > 20));
                    if (isLuna) {
                        logs.push("❇️ " + tempObj.name[actor] + "의 셀레스티얼 루나!");
                    }
                    let auroraEffect = {
                        turn: 2,
                        percent: (actorTier >= 6 ? 0.45 : 0.25),
                        luna: isLuna
                    }
                    for (let v in tempObj.name) {
                        if (v == actor || (!v.startsWith('h') && v.startsWith(actor.substr(0, 1)))) continue;
                        if (tempObj.stat[v].hp <= 0) continue;
                        tempObj.effect[v].aurora = auroraEffect;
                    }
                }
            }
        } else if (actorWeapon == "천명즉살검") {
            damage.p += 195;
            if (tempObj.effect[victim].bleed) {
                let r = Math.random();
                let percent = 0.75;
                if (actorTier >= 2) percent = 1;
                if (r < percent) {
                    logs.push("❇️ " + tempObj.name[actor] + "의 붉은 달!");
                    let redmoonDamage = getPercentHP(victim, 0.15);
                    if (actorTier >= 3 && tempObj.stack[actor].heaven && tempObj.stack[actor].heaven >= 5) redmoonDamage = getPercentMaxHP(victim, 0.12);
                    damage.p += redmoonDamage;
                }
            }
            if (actorTier >= 1) {
                if (! tempObj.stack[actor].heaven) tempObj.stack[actor].heaven = 0;
                tempObj.stack[actor].heaven++;
                if (! tempObj.stack[victim].heavened && tempObj.stat[victim].hp <= Math.round(tempObj.stat[victim].maxHp * 0.5)) {
                    tempObj.stack[victim].heavened = 1;
                    logs.push("❇️ " + tempObj.name[actor] + "의 천명!");
                    if (dealt(actor, victim, {p:getPercentlostHP(victim, 0.12) * tempObj.stack[actor].heaven,m:0,t:0}));
                    tempObj.stack[actor].heaven = 0;
                }
            }
        } else if (actorWeapon == "스텔라 인페르노") {
            damage.m += 170;
            let r = Math.random();
            let percent = 0.35;
            if (actorTier >= 1) percent = 0.65;
            if (r < percent) {
                logs.push("❇️ " + tempObj.name[actor] + "의 화염 폭발!");
                damage.m += 230;
                damage.m += getPercentMaxHP(victim, 0.15);
                if (tempObj.effect[victim].burn) damage.t += (getPercentMaxHP(victim, 0.05) * tempObj.effect[victim].burn.stack);
                if (actorTier >= 1 && tempObj.effect[victim].burn) damage.m += (245 * tempObj.effect[victim].burn.stack);
                if (actorTier >= 3) {
                    for (let v in tempObj.name) {
                        if (v == actor || v == 'shade' || (!v.startsWith('h') && v.startsWith(actor.substr(0, 1)))) continue;
                        if (tempObj.stat[v].hp <= 1) continue;
                        dealt(actor, v, {p:0,m:getPercentHP(v, 0.1),t:0});
                    }
                }
            }
        } else if (actorWeapon == "엠파이리언 아크") {
            damage.p += 175;
            tempObj.stack[actor].missed = 0;
            if (tempObj.effect[actor].conversion) {
                delete tempObj.effect[actor].conversion;
                actorActivated.push("crt");
                logs.push("❇️ " + tempObj.name[actor] + "의 회심의 일격!");
                damage.p += 340;
            }
            if (actorTier >= 1 && !actorActivated.includes("crt") && !actorActivated.includes("pnt") && !tempObj.effect[actor].conversion) {
                actorActivated = [];
                damage.p = 0;
                tempObj.effect[actor].conversion = {
                    turn: 2
                };
                logs.push("❇️ " + tempObj.name[actor] + "의 일격 준비!");
            }
        } else if (actorWeapon == "아이스 베어") {
            damage.p += 450;
        } else if (actorWeapon == "서리 아귀") {
            damage.m += 245;
            damage.t += getPercentMaxHP(victim, 0.15);
        } else if (actorWeapon == "광살혈도") {
            damage.p += 180;
            if (! tempObj.stack[actor].axe) tempObj.stack[actor].axe = 0;
            damage.p += tempObj.stack[actor].axe;
            tempObj.stack[actor].axe += (actorTier >= 3 ? getPercentMaxHP(victim, 0.05) + 75 : getPercentMaxHP(victim, 0.035) + 35);
            if (actorTier >= 1 && ! tempObj.stack[victim].howlAxe) {
                tempObj.stack[victim].howlAxe = 1;
                logs.push("❇️ " + tempObj.name[actor] + "의 울부짖는 도끼!");
                tempObj.stat[victim].def -= 0.1;
                tempObj.stack[actor].axe += 125;
                damage.p += 125;
            }
        }

        if (tempObj.artifact[actor].includes("홍월의 프리가라흐")) {
            logs.push("❇️ " + tempObj.name[actor] + "의 붉은 검의 의지!");
            damage.p += 135;
        }

        if (actorActivated.includes("hit")) {
            if (actorActivated.includes("dth")) {
                if (instantDeath(actor, victim)) return;
            }
            if (actorWeapon == "하늘의 장궁" && actorTier >= 6) {
                if (!tempObj.stack[actor].focusAtk) tempObj.stack[actor].focusAtk = 0;
                tempObj.stack[actor].focusAtk++;
                if (tempObj.stack[actor].focusAtk % 3 == 0) {
                    logs.push("❇️ " + tempObj.name[actor] + "의 집중 공격!");
                    damage.t += 120;
                    actorActivated.push("pnt");
                    tempObj.effect[victim].decreaseDef = {
                        turn: 2,
                        stack: 10
                    }
                }
            }
            if (actorWeapon == "엠파이리언 아크") {
                if (!tempObj.stack[actor].focusAtk) tempObj.stack[actor].focusAtk = 0;
                tempObj.stack[actor].focusAtk++;
                if (tempObj.stack[actor].focusAtk % 3 == 0) {
                    logs.push("❇️ " + tempObj.name[actor] + "의 집중 공격!");
                    damage.t += 245;
                    actorActivated.push("pnt");
                    tempObj.effect[victim].decreaseDef = {
                        turn: 2,
                        stack: 10
                    }
                }
            }
            if (tempObj.weapon[actor].enchant && tempObj.weapon[actor].enchant.find(e => e.name == "집전")) {
                logs.push("🪯 " + tempObj.name[actor] + "의 집전!");
                if (dealt(actor, victim, {p:0,m:40 * tempObj.weapon[actor].enchant.find(e => e.name == "집전").level,t:0})) return;
                if (tempObj.effect[actor].thunder) {
                    tempObj.effect[actor].thunder.stack++;
                } else {
                    tempObj.effect[actor].thunder = {
                        turn: 1,
                        stack: 1
                    };
                }
                let r = Math.random();
                if (r < 0.15) {
                    actorActivated.push("stn");
                }
            }
            if (actorArmor == "석상 돌갑옷" && actorArmorTier >= 4) {
                let r = Math.random();
                let percent = 0.15;
                if (actorActivated.includes("crt") && tempObj.name[actor] == "[고대의 수호자] 칼테온") percent = 1;
                if (r < percent) {
                    logs.push("❇️ " + tempObj.name[actor] + "의 묵직한 강타!");
                    damage.m += 90;
                    actorActivated.push("stn");
                }
            }
            if (actorArmor == "화염 드래곤의 비늘" && tempObj.artifact[actor].includes("아르카나 화염 드래곤의 비늘") && tempObj.effect[victim].burn) {
                if (! tempObj.stack[actor].dragonSoul) tempObj.stack[actor].dragonSoul = 0;
                tempObj.stack[actor].dragonSoul++;
            }
            if (!actorActivated.includes("stn") && tempObj.artifact[actor].includes("과부하 기계")) {
                let r = Math.random();
                if (r < 0.05) {
                    logs.push("❇️ " + tempObj.name[actor] + "의 과충전!");
                    actorActivated.push("stn");
                }
            }
            if (tempObj.artifact[actor].includes("아이스 하트")) {
                let r = Math.random();
                if (r < 0.15) {
                    instantFreeze(actor, victim);
                }
            }
            if (tempObj.artifact[actor].includes("과부하 팔찌") && tempObj.effect[actor].combo) {
                logs.push("❇️ " + tempObj.name[actor] + "의 과부하된 힘!");
                let pd = Math.floor(150 * (1 + (tempObj.stack[actor].charge ? tempObj.stack[actor].charge * 0.05 : 0)));
                if (dealt(actor, victim, {p:pd,m:0,t:0})) return;
            }
            if (actorActivated.includes("crt")) {
                logs.push("💥 " + tempObj.name[actor] + "의 일격!");
                if (actorWeapon == "방랑자의 장검" && actorTier >= 6) {
                    logs.push("❇️ " + tempObj.name[actor] + "의 검기 발산!");
                    let skillDamage = 50;
                    if (actorTier >= 6) {
                        skillDamage += getPercentMaxHP(victim, 0.05);
                    }
                    if (tempObj.artifact[actor].includes("아르카나 방랑자의 장검")) {
                        skillDamage += tempObj.stack[actor].sword * tempObj.artifact[actor].filter(a => a == "아르카나 방랑자의 장검").length;
                    }
                    if (dealt(actor, victim, {p:0,m:skillDamage,t:0})) return;
                } else if (actorWeapon == "천상유랑검") {
                    logs.push("❇️ " + tempObj.name[actor] + "의 검기 발산!");
                    let skillDamage = 130 + getPercentMaxHP(victim, 0.05) + tempObj.stack[actor].sword;
                    if (dealt(actor, victim, {p:0,m:skillDamage,t:0}, null, {isSwordAura: true})) return;
                    if (!tempObj.stack[actor].swordAura) tempObj.stack[actor].swordAura = 0;
                    tempObj.stack[actor].swordAura++;
                    if (actorTier >= 8 && tempObj.stack[actor].swordAura % 4 == 0) {
                        logs.push("❇️ " + tempObj.name[actor] + "의 천상의 검기!");
                        if (dealt(actor, victim, {p:0,m:skillDamage * 3,t:0}, null, {isSwordAura: true})) return;
                    }
                }
                let mul = 2;
                if (actorWeapon == "하늘의 장궁") mul += 0.5;
                if (actorWeapon == "엠파이리언 아크") mul += (actorTier >= 6 ? 2 : 1);
                if (actorWeapon == "흉포한 도끼" && actorTier >= 3) mul += 0.35;
                if (tempObj.weapon[actor].option && tempObj.weapon[actor].option.find(o => o.name == "일격 피해 증가")) {
                    let num = tempObj.weapon[actor].option.filter(o => o.name == "일격 피해 증가").reduce((sum, o) => sum + o.num, 0);
                    mul += num;
                }
                if (tempObj.armor[victim].option && tempObj.armor[victim].option.find(o => o.name == "일격 피해 감소")) {
                    let num = tempObj.armor[victim].option.filter(o => o.name == "일격 피해 감소").reduce((sum, o) => sum + o.num, 0);
                    mul = Math.max(1, mul - num);
                }
                damage.p = Math.round(damage.p * mul);
                damage.m = Math.round(damage.m * mul);
                damage.t = Math.round(damage.t * mul);
                if (actorWeapon == "새벽 단검" && actorTier >= 7 && tempObj.stat[victim].hp < getPercentMaxHP(victim, 0.3)) {
                    logs.push("❇️ " + tempObj.name[actor] + "의 피의 마무리!");
                    if (instantDeath(actor, victim)) return;
                } else if (actorWeapon == "천명즉살검" && tempObj.stat[victim].hp < getPercentMaxHP(victim, 0.3)) {
                    logs.push("❇️ " + tempObj.name[actor] + "의 즉살!");
                    if (instantDeath(actor, victim)) return;
                } else if (actorWeapon == "뱀파이어의 송곳니" && actorTier >= 6) {
                    logs.push("❇️ " + tempObj.name[actor] + "의 생명 포식자!");
                    let skillDamage = 100;
                    if (dealt(actor, victim, {p:0,m:0,t:skillDamage})) return;
                    heal(actor, 100);
                } else if (actorWeapon == "혈성극검" && actorTier >= 1) {
                    logs.push("❇️ " + tempObj.name[actor] + "의 생명 포식자!");
                    let skillDamage = 275;
                    if (dealt(actor, victim, {p:0,m:0,t:skillDamage})) return;
                    heal(actor, 300);
                } else if (actorWeapon == "하늘의 장궁" && actorTier >= 7) {
                    let r = Math.random();
                    if (r < 0.25) {
                        logs.push("❇️ " + tempObj.name[actor] + "의 신성한 화살!");
                        if (dealt(actor, victim, {p:0,m:0,t:Math.max(getPercentHP(victim, 0.25), 300)})) return;
                        actorActivated.push("stn");
                    }
                } else if (actorWeapon == "엠파이리언 아크") {
                    let r = Math.random();
                    if (r < 0.3) {
                        logs.push("❇️ " + tempObj.name[actor] + "의 신성한 화살!");
                        if (dealt(actor, victim, {p:0,m:0,t:Math.max(getPercentHP(victim, 0.25), 450)})) return;
                        actorActivated.push("stn");
                    }
                }
                if (actorArmor == "화염 드래곤의 비늘" && tempObj.artifact[actor].includes("아르카나 화염 드래곤의 비늘") && tempObj.stack[actor].dragonSoul) {
                    logs.push("🟪 " + tempObj.name[actor] + "의 염룡의 영혼!");
                    if(dealt(actor, victim, {p:0,m:Math.round(getPercentMaxHP(victim, 0.08) * tempObj.stack[actor].dragonSoul),t:0})) return;
                    tempObj.stack[actor].dragonSoul = 0;
                    tempObj.effect[victim].dragonFire = {
                        turn: 3
                    };
                }
                if (tempObj.artifact[actor].includes("과부하 팔찌") && !tempObj.effect[actor].combo) {
                    logs.push("❇️ " + tempObj.name[actor] + "의 과부하된 힘!");
                    let pd = Math.floor(150 * (1 + (tempObj.stack[actor].charge ? tempObj.stack[actor].charge * 0.05 : 0)));
                    if (dealt(actor, victim, {p:pd,m:0,t:0})) return;
                }
                if (tempObj.artifact[victim].includes("과부하 팔찌")) {
                    let r = Math.random();
                    if (r < 0.2) {
                        logs.push("❇️ " + tempObj.name[victim] + "의 충격파!");
                        let md = Math.floor(100 * (1 + (tempObj.stack[victim].charge ? tempObj.stack[victim].charge * 0.05 : 0)));
                        if (dealt(victim, actor, {p:0,m:md,t:0})) return;
                        instantStun(victim, actor);
                    }
                }
            }
            if (actorActivated.includes("pnt")) {
            }
            if (victimArmor == "화염 드래곤의 비늘" && victimArmorTier >= 4) {
                let r = Math.random();
                let percent = 0.35;
                if (victimArmorTier >= 6) percent += 0.5;
                if (r < percent) {
                    logs.push("❇️ " + tempObj.name[victim] + "의 불타는 비늘!");
                    instantBurn(victim, actor);
                }
            }
            if (victimArmor == "석상 돌갑옷" && victimArmorTier >= 6) {
                if (! tempObj.stack[victim].stone) tempObj.stack[victim].stone = 0;
                tempObj.stack[victim].stone++;
                if (tempObj.stack[victim].stone % 3 == 0) {
                    logs.push("❇️ " + tempObj.name[victim] + "의 보호의 방패!");
                    if (! tempObj.stat[victim].shield) tempObj.stat[victim].shield = 0;
                    tempObj.stat[victim].shield += getPercentMaxHP(victim, 0.1);
                }
            }
            if (actorActivated.includes("bld") && victimArmor == "여명의 갑주" && victimArmorTier >= 4) {
                let r = Math.random();
                if (r < 0.3) {
                    logs.push("❇️ " + tempObj.name[victim] + "의 견고한 피부!");
                    actorActivated.remove("bld");
                }
            }
            if (actorActivated.includes("bld")) {
                instantBleed(actor, victim);
            }
            if (actorActivated.includes("brn")) {
                instantBurn(actor, victim);
            }
            if (tempObj.weapon[actor].enchant && tempObj.weapon[actor].enchant.find(e => e.name == "화염 낙인")) {
                let r = Math.random();
                if (r < 0.35) {
                    logs.push("🪯 " + tempObj.name[actor] + "의 화염 낙인!");
                    instantBurn(actor, victim);
                }
            }
            if (actorActivated.includes("stn")) {
                instantStun(actor, victim);
            }
            if (actorActivated.includes("poi")) {
                instantPoison(actor, victim);
            }
            if (actorActivated.includes("slw")) {
                instantSlow(actor, victim);
            }
            if (actorWeapon == "별빛 지팡이" && actorTier >= 7 && tempObj.effect[actor].thunder && tempObj.effect[actor].thunder.stack >= 2) {
                let r = Math.random();
                if (r < 0.35) {
                    tempObj.effect[actor].thunder.stack = -99;
                    logs.push("❇️ " + tempObj.name[actor] + "의 붉은 번개!");
                    if (dealt(actor, victim, {p:0,m:getPercentMaxHP(victim, 0.2),t:0})) return;
                }
            }
            let finalDamage = Math.round(damage.t + Math.max(0, damage.p * (1 - tempObj.stat[victim].def)) + Math.max(0, damage.m * (1 - tempObj.stat[victim].res)));
            let originDamage = finalDamage;
            if (tempObj.weapon[victim].name == "격조의 창" && tempObj.weapon[victim].tier >= 6 && victimActivated.includes("cnt")) {
                let r = Math.random();
                if (r < 0.75) {
                    damage.p = Math.round(damage.p * 0.2);
                    damage.m = Math.round(damage.m * 0.2);
                    logs.push("❇️ " + tempObj.name[victim] + "의 현월!");
                }
            }
            if (finalDamage > 0) {
                if (tempObj.weapon[actor].enchant && tempObj.weapon[actor].enchant.find(e => e.name == "집중")) {
                    if (! tempObj.stack[actor].focus) tempObj.stack[actor].focus = 0;
                    tempObj.stack[actor].focus++;
                    if (tempObj.stack[actor].focus % 3 == 0) {
                        logs.push("🪯 " + tempObj.name[actor] + "의 집중!");
                        damage.p *= 2;
                        damage.m *= 2;
                        damage.t *= 2;
                    }
                }
                if (! tempObj.effect[victim].stun && !tempObj.effect[victim].freeze && tempObj.weapon[victim].name == "스텔라 인페르노" && tempObj.weapon[victim].tier >= 7 && tempObj.effect[actor].burn) {
                    let r = Math.random();
                    if (r < 0.35) {
                        damage.p = Math.round(damage.p * 0.4);
                        damage.m = Math.round(damage.m * 0.4);
                        tempObj.effect[victim].stella = { turn: 1 };
                    }
                }
                tempObj.activated = {};
                tempObj.activated[actor] = actorActivated;
                tempObj.activated[victim] = victimActivated;
                if (dealt(actor, victim, damage, true)) return;
            }
            if (actorWeapon == "엠파이리언 아크" && actorTier >= 7) {
                if (!tempObj.stack[actor].empyrean) tempObj.stack[actor].empyrean = 0;
                tempObj.stack[actor].empyrean++;
                if (tempObj.stack[actor].empyrean >= 7 && !tempObj.stack[actor].empyreanShot) {
                    logs.push("❇️ " + tempObj.name[actor] + "의 엠파이리언 샷!");
                    tempObj.effect[actor].empyreanShot = {turn:2};
                    tempObj.stack[actor].empyreanShot = 1;
                }
            }
            if (actorWeapon == "천상유랑검" && actorTier >= 4) {
                logs.push("❇️ " + tempObj.name[actor] + "의 검의 날개!");
                let swcount = 1;
                if (actorTier >= 5) swcount = 2;
                for(let i = 0; i < swcount; i++) {
                    if (dealt(actor, victim, {p:Math.round((110 + tempObj.stack[actor].sword) * 0.4),m:0,t:0}));
                    tempObj.stack[actor].sword += 15;
                    let r = Math.random();
                    if (r < 0.5) {
                        logs.push("❇️ " + tempObj.name[actor] + "의 검기 발산!");
                        let skillDamage = 130 + getPercentMaxHP(victim, 0.05) + tempObj.stack[actor].sword;
                        if (dealt(actor, victim, {p:0,m:skillDamage,t:0}, null, {isSwordAura: true})) return;
                        if (!tempObj.stack[actor].swordAura) tempObj.stack[actor].swordAura = 0;
                        tempObj.stack[actor].swordAura++;
                        if (actorTier >= 8 && tempObj.stack[actor].swordAura % 4 == 0) {
                            logs.push("❇️ " + tempObj.name[actor] + "의 천상의 검기!");
                            if (dealt(actor, victim, {p:0,m:skillDamage * 3,t:0}, null, {isSwordAura: true})) return;
                        }
                    }
                }
            }
            if (tempObj.pet[actor].name) {
                if (tempObj.pet[actor].name == "아기 늑대") {
                    logs.push("✳️ " + tempObj.name[actor] + "의 아기 늑대가 공격합니다!");
                    let petActivated = getActivated({hit: 0.9, avd: tempVictimStat.avd});
                    if (!tempObj.effect[victim].stun && !tempObj.effect[victim].freeze && !petActivated.includes("hit")) {
                        logs.push("❌ 빗나갔습니다!");
                    } else if (!tempObj.effect[victim].stun && !tempObj.effect[victim].freeze && petActivated.includes("avd")) {
                        logs.push("💨 회피했습니다!");
                    } else {
                        let petDamage = {p:0,m:0,t:0};
                        if (!tempObj.stack[actor].growWolf) tempObj.stack[actor].growWolf = 0;
                        petDamage.p = Math.round(tempObj.pet[actor].damage * (1 + (0.1 * tempObj.stack[actor].growWolf)));
                        if (tempObj.pet[actor].level >= 10) {
                            let r = Math.random();
                            let percent = 0.1;
                            if (tempObj.pet[actor].level >= 20) percent += 0.15;
                            if (tempObj.pet[actor].level >= 30) percent += 0.15;
                            if (tempObj.pet[actor].level >= 40) percent += 0.2;
                            if (r < percent) {
                                petDamage.t = Math.round(petDamage.p * 1.5);
                                petDamage.p = 0;
                            }
                        }
                        if (dealt(actor, victim, petDamage, null, {isPet: true})) return;
                        if (tempObj.pet[actor].level >= 50) {
                            tempObj.stack[actor].growWolf += 1;
                            logs.push("🟨 아기 늑대의 성장! (피해량 +" + (tempObj.stack[actor].growWolf * 10) + "%)");
                        }
                    }
                }
                if (tempObj.pet[actor].name == "루나") {
                    logs.push("✳️ " + tempObj.name[actor] + "의 루나가 공격합니다!");
                    let petActivated = getActivated({hit: 0.9, avd: tempVictimStat.avd});
                    if (!tempObj.effect[victim].stun && !tempObj.effect[victim].freeze && !petActivated.includes("hit")) {
                        logs.push("❌ 빗나갔습니다!");
                    } else if (!tempObj.effect[victim].stun && !tempObj.effect[victim].freeze && petActivated.includes("avd")) {
                        logs.push("💨 회피했습니다!");
                    } else {
                        let petDamage = {p:tempObj.pet[actor].damage,m:0,t:0};
                        if (dealt(actor, victim, petDamage, null, {isPet: true})) return;
                    }
                }
            }
            if (tempObj.pet[victim].name) {
                if (tempObj.pet[victim].name == "검은 고양이") {
                    let r = Math.random();
                    let percent = 0.65;
                    if (tempObj.pet[victim].level >= 10) percent += 0.05;
                    if (tempObj.pet[victim].level >= 20) percent += 0.05;
                    if (tempObj.pet[victim].level >= 30) percent += 0.05;
                    if (tempObj.pet[victim].level >= 40) percent += 0.1;
                    if (r < percent) {
                        logs.push("✳️ " + tempObj.name[victim] + "의 검은 고양이가 할큅니다!");
                        let petActivated = getActivated({hit: 0.9, avd: tempActorStat.avd});
                        if (!tempObj.effect[actor].stun && !tempObj.effect[actor].freeze && !petActivated.includes("hit")) {
                            logs.push("❌ 빗나갔습니다!");
                        } else if (!tempObj.effect[actor].stun && !tempObj.effect[actor].freeze && petActivated.includes("avd")) {
                            logs.push("💨 회피했습니다!");
                        } else {
                            if (tempObj.pet[victim].level >= 50) tempObj.stack[victim].blackCat = 1;
                            if (dealt(victim, actor, {p:tempObj.pet[victim].damage,m:0,t:0}, null, {isPet: true})) return;
                        }
                    }
                }
            }
            if (tempObj.weapon[actor].enchant && tempObj.weapon[actor].enchant.find(e => e.name == "폭풍")) {
                let r = Math.random();
                if (r < (0.1 * tempObj.weapon[actor].enchant.find(e => e.name == "폭풍").level)) {
                    logs.push("🪯 " + tempObj.name[actor] + "의 폭풍!");
                    let stormDamage = 50 + (tempObj.stack[actor].storm ? tempObj.stack[actor].storm : 0);
                    if (dealt(actor, victim, {p:0,m:stormDamage,t:0})) return;
                    actorActivated.push("cmb");
                    if (tempObj.effect[actor].combo) {
                        tempObj.effect[actor].combo.max++;
                    } else {
                        tempObj.effect[actor].combo = {
                            max: 2,
                            stack: 0,
                            turn: 1
                        }
                        if (actorWeapon == "방랑자의 장검" && actorTier >= 7) tempObj.effect[actor].combo.max += 2;
                        if (tempObj.artifact[actor].includes("환영무쌍의 장갑")) tempObj.effect[actor].combo.max += tempObj.artifact[actor].filter(a => a == "환영무쌍의 장갑").length;
                        if (actorWeapon == "천상유랑검") tempObj.effect[actor].combo.max += 2;
                        if (actorWeapon == "천상유랑검" && actorTier >= 1) tempObj.effect[actor].combo.max += 1;
                        if (tempObj.weapon[actor].enchant && tempObj.weapon[actor].enchant.find(e => e.name == "날렵함")) tempObj.effect[actor].combo.max += tempObj.weapon[actor].enchant.find(e => e.name == "날렵함").level;
                        if (tempObj.effect[actor].slow) tempObj.effect[actor].combo.max -= 2;
                    }
                }
            }
            if (tempObj.effect[actor].karma) {
                logs.push("🪯 " + tempObj.name[actor] + "의 카르마!");
                if (dealt(actor, victim, {p:0,m:0,t:tempObj.effect[actor].karma.stack})) return;
                delete tempObj.effect[actor].karma;
            }
            if (tempObj.weapon[actor].enchant && tempObj.weapon[actor].enchant.find(e => e.name == "치유")) {
                logs.push("🪯 " + tempObj.name[actor] + "의 치유!");
                for (let a in tempObj.name) {
                    if (a == victim || (!a.startsWith('h') && a.startsWith(victim.substr(0, 1)))) continue;
                    heal(a, 10 * tempObj.weapon[actor].enchant.find(e => e.name == "치유").level);
                }
            }
            if (victimArmor == "방랑자의 천갑옷" && victimArmorTier >= 4) {
                let r = Math.random();
                if (r < 0.45) {
                    tempObj.effect[victim].revenge = {
                        turn: 1
                    };
                }
            }
            if (victimArmor == "그림자 망토" && victimArmorTier >= 6) {
                let prevHit = tempObj.stat[actor].hit;
                tempObj.stat[actor].hit = Math.max((prevHit < 0.1 ? prevHit : 0.1), tempObj.stat[actor].hit - 0.02);
                logs.push("❇️ " + tempObj.name[victim] + "의 혼란스러운 어둠! (상대 🎯명중 " + (tempObj.stat[actor].hit * 100).fix(2) + "%)");
            }
            if (victimArmor == "그림자 망토" && victimArmorTier >= 4) {
                let r = Math.random();
                if (r < 0.35) {
                    tempObj.effect[victim].stealth = {
                        turn: 1
                    };
                    logs.push("❇️ " + tempObj.name[victim] + "의 은신!");
                }
            }
            if (tempObj.effect[victim].stella) {
                delete tempObj.effect[victim].stella;
                logs.push("❇️ " + tempObj.name[victim] + "의 스텔라 인페르노!");
                if (dealt(victim, actor, {p:0,m:getPercentMaxHP(actor, 0.125) + 420,t:0})) return;
            }
            if (! tempObj.effect[victim].stun && !tempObj.effect[victim].freeze && victimActivated.includes("cnt")) {
                if (instantCounter(victim, actor, originDamage)) return;
                if (tempObj.weapon[victim].name == "성월의 레이피어" && tempObj.weapon[victim].tier >= 4) {
                    let r = Math.random();
                    if (r < 0.75 && tempObj.cntAct[victim].includes("hit")) {
                        logs.push("❇️ " + tempObj.name[victim] + "의 카운터 콤보!");
                        tempObj.stack[victim].counterCmb = true;
                        if (instantCounter(victim, actor, originDamage)) return;
                    }
                }
            }
        }
    }

    if (actorActivated.includes("cmb") && !(tempObj.effect[actor].combo && tempObj.effect[actor].combo.max <= tempObj.effect[actor].combo.stack)) {
        if (tempObj.effect[actor].combo) {
            tempObj.effect[actor].combo.stack++;
        } else {
            tempObj.effect[actor].combo = {
                max: 1,
                stack: 1,
                turn: 1
            }
            if (actorWeapon == "방랑자의 장검" && actorTier >= 7) tempObj.effect[actor].combo.max += 2;
            if (tempObj.artifact[actor].includes("환영무쌍의 장갑")) tempObj.effect[actor].combo.max += tempObj.artifact[actor].filter(a => a == "환영무쌍의 장갑").length;
            if (actorWeapon == "천상유랑검") tempObj.effect[actor].combo.max += 2;
            if (actorWeapon == "천상유랑검" && actorTier >= 1) tempObj.effect[actor].combo.max += 1;
            if (tempObj.weapon[actor].enchant && tempObj.weapon[actor].enchant.find(e => e.name == "날렵함")) tempObj.effect[actor].combo.max += tempObj.weapon[actor].enchant.find(e => e.name == "날렵함").level;
            if (tempObj.effect[actor].slow) tempObj.effect[actor].combo.max -= 2;
        }
        if (!(tempObj.effect[actor].combo.max <= (tempObj.effect[actor].combo.stack - 1))) {
            //if (actorWeapon == "하늘의 장궁" && actorTier >= 6 && actorActivated.includes("pnt")) logs.push("❇️ " + tempObj.name[actor] + "의 천공의 연격!");
            logs.push("✨ " + tempObj.name[actor] + "의 연격!");
            if (actorWeapon == "방랑자의 장검") tempObj.stack[actor].sword += 5;
            if (actorWeapon == "방랑자의 장검" && tempObj.artifact[actor].includes("아르카나 방랑자의 장검")) tempObj.stack[actor].sword += 7 * tempObj.artifact[actor].filter(a => a == "아르카나 방랑자의 장검").length;
            if (actorWeapon == "천상유랑검") tempObj.stack[actor].sword += 15;
            processHunt(tempObj, actor, victim);
            return;
        }
    } else {
        if (actorWeapon == "천상유랑검" && actorTier >= 6 && tempObj.effect[actor].combo && tempObj.effect[actor].combo.stack >= 3) {
            logs.push("❇️ " + tempObj.name[actor] + "의 여정의 끝!");
            if (dealt(actor, victim, {p:0,m:0,t:getPercentMaxHP(victim, 0.15)})) return;
        }
    }

    if (actorArmor == "마법사의 로브" && actorArmorTier >= 4) {
        if (!tempObj.stack[actor].magicpower) tempObj.stack[actor].magicpower = 0;
        if (tempObj.stack[actor].magicpower % 3 == 0) {
            logs.push("❇️ " + tempObj.name[actor] + "의 마력 방출!");
            let skillDamage = 70;
            if (tempObj.stack[actor].magicDealt) skillDamage += tempObj.stack[actor].magicDealt;
            if (dealt(actor, victim, {p:0,m:skillDamage,t:0})) return;
            tempObj.effect[actor].magicpower = {
                turn: 3
            };
        }
        tempObj.stack[actor].magicpower++;
    }

    if (actorWeapon == "셀레스티아" && actorTier >= 3) {
        if (!tempObj.stack[actor].starShield) tempObj.stack[actor].starShield = 0;
        if (tempObj.stack[actor].starShield % 3 == 0) {
            logs.push("❇️ " + tempObj.name[actor] + "의 성운의 가호!");
            if (! tempObj.stat[actor].shield) tempObj.stat[actor].shield = 0;
            let percent = (actorTier >= 5 ? 0.2 : 0.15);
            tempObj.stat[actor].shield += getPercentMaxHP(actor, percent);
        }
        tempObj.stack[actor].starShield++;
    }

    if (!tempObj.effect[actor].stun && !tempObj.effect[actor].freeze && determination && actorWeapon == "엠파이리언 아크" && actorTier >= 4) {
        if (!tempObj.effect[actor].conversion) {
            if (!tempObj.stack[actor].arrowRain) tempObj.stack[actor].arrowRain = 0;
            if (tempObj.stack[actor].arrowRain % 3 == 0) {
                logs.push("❇️ " + tempObj.name[actor] + "의 애로우 레인!");
                let success = 0;
                let crit = 0;
                let num = 7;
                let sumDamage = 0;
                let baseDamage = 75 + Math.round(getPercentMaxHP(victim, 0.02));
                let mul = 2;
                if (actorWeapon == "하늘의 장궁") mul += 0.5;
                if (actorWeapon == "엠파이리언 아크") mul += (actorTier >= 6 ? 2 : 1);
                if (actorWeapon == "흉포한 도끼" && actorTier >= 3) mul += 0.35;
                if (tempObj.weapon[actor].option && tempObj.weapon[actor].option.find(o => o.name == "일격 피해 증가")) {
                    let num = tempObj.weapon[actor].option.filter(o => o.name == "일격 피해 증가").reduce((sum, o) => sum + o.num, 0);
                    mul += num;
                }
                if (tempObj.armor[victim].option && tempObj.armor[victim].option.find(o => o.name == "일격 피해 감소")) {
                    let num = tempObj.armor[victim].option.filter(o => o.name == "일격 피해 감소").reduce((sum, o) => sum + o.num, 0);
                    mul = Math.max(1, mul - num);
                }
                if (actorTier >= 5) num = 10;
                for (let i = 0; i < num; i++) {
                    let r = Math.random();
                    if (r < 0.75) {
                        let vA = getActivated({avd: tempObj.tempStat[victim].avd});
                        const isSettingMoon = (tempObj.weapon[victim].name == "천명즉살검" && tempObj.weapon[victim].tier >= 4 && (!tempObj.stack[actor].setting_moon || tempObj.effect[actor].setting_moon));
                        const isEmpyreanArc = (tempObj.weapon[victim].name == "엠파이리언 아크" && tempObj.weapon[victim].tier >= 2 && tempObj.effect[victim].conversion);
                        if (!vA.includes("avd") || isSettingMoon || isEmpyreanArc) {
                            success++;
                            let r2 = Math.random();
                            if (r2 < tempObj.stat[actor].crt) {
                                crit++;
                                sumDamage += Math.round(baseDamage * mul);
                            } else {
                                sumDamage += baseDamage;
                            }
                        }
                    }
                }
                if (success > 0) {
                    logs.push("🎯 " + success + "발 명중!" + (crit > 0 ? " 💥 x" + crit : ""));
                    if (dealt(actor, victim, {p:sumDamage,m:0,t:0})) return;
                } else {
                    logs.push("❌ 모두 빗나갔습니다!")
                }
            }
            tempObj.stack[actor].arrowRain++;
        }
    }

    if (tempObj.artifact[actor].includes("과부하 팔찌")) {
        if (!tempObj.stack[actor].overload_bracelet) tempObj.stack[actor].overload_bracelet = 0;
        if (tempObj.stack[actor].overload_bracelet % 3 == 0) {
            logs.push("❇️ " + tempObj.name[actor] + "의 충전!");
            if (! tempObj.stat[actor].charge) tempObj.stat[actor].charge = 0;
            let num = Math.floor(Math.random() + 30) + 1;
            logs.push("⚡ 충전 횟수: " + num + " (누적 충전 횟수: " + numberWithCommas(tempObj.stat[actor].charge) + ")");
        }
        tempObj.stack[actor].overload_bracelet++;
    }

    if (actorWeapon == "서리 아귀") {
        if (!tempObj.stack[actor].reification) tempObj.stack[actor].reification = 0;
        tempObj.stack[actor].reification++;
        if (tempObj.stack[actor].reification % 3 == 0) {
            tempObj.effect[actor].reification = {
                turn: 2
            };
            logs.push("❇️ " + tempObj.name[actor] + "의 실체화!");
            for (let v in tempObj.name) {
                if (v == actor || v == 'shade' || (!v.startsWith('h') && v.startsWith(actor.substr(0, 1)))) continue;
                if (tempObj.stat[v].hp <= 1) continue;
                dealt(actor, v, {p:0,m:getPercentHP(v, 0.45),t:0});
                instantSlow(actor, v);
            }
        }
    }

    if (tempObj.artifact[actor].includes("카네이션 펜던트")) {
        logs.push("❇️ " + tempObj.name[actor] + "의 건강 기원!");
        heal(actor, getPercentMaxHP(actor, 0.02) * tempObj.artifact[actor].filter(a => a == "카네이션 펜던트").length);
    }

    if (tempObj.artifact[actor].includes("홍월의 카네이션 펜던트")) {
        logs.push("❇️ " + tempObj.name[actor] + "의 붉은 꽃잎의 기도!");
        tempObj.stack[actor].redflower = victim;
        heal(actor, getPercentMaxHP(actor, 0.04) * tempObj.artifact[actor].filter(a => a == "홍월의 카네이션 펜던트").length);
    }

    if (tempObj.artifact[actor].includes("리나 에셀의 목걸이")) {
        logs.push("❇️ " + tempObj.name[actor] + "의 따뜻한 휴식!");
        heal(actor, getPercentMaxHP(actor, 0.04) * tempObj.artifact[actor].filter(a => a == "리나 에셀의 목걸이").length);
    }

    if (tempObj.pet[actor].name) {
        if (tempObj.pet[actor].name == "작은 마법사") {
            if (!tempObj.stack[actor].miniWizard) tempObj.stack[actor].miniWizard = 0;
            tempObj.stack[actor].miniWizard++;
            if (tempObj.stack[actor].miniWizard % 2 == 0) {
                logs.push("✳️ " + tempObj.name[actor] + "의 작은 마법사가 빙결 마법을 사용합니다!");
                let petActivated = getActivated({hit: 0.9, avd: tempVictimStat.avd});
                if (!tempObj.effect[victim].stun && !tempObj.effect[victim].freeze && !petActivated.includes("hit")) {
                    logs.push("❌ 빗나갔습니다!");
                } else if (!tempObj.effect[victim].stun && !tempObj.effect[victim].freeze && petActivated.includes("avd")) {
                    logs.push("💨 회피했습니다!");
                } else {
                    let petDamage = tempObj.pet[actor].damage;
                    if (tempObj.pet[actor].level >= 50 && actorActivated.includes("hit") && actorActivated.includes("crt")) {
                        logs.push("🟨 작은 마법사의 마나 감응!");
                        logs.push("💥 작은 마법사의 일격!");
                        let mul = 2.5;
                        if (tempObj.weapon[actor].option && tempObj.weapon[actor].option.find(o => o.name == "일격 피해 증가")) {
                            let num = tempObj.weapon[actor].option.filter(o => o.name == "일격 피해 증가").reduce((sum, o) => sum + o.num, 0);
                            mul += num;
                        }
                        if (tempObj.armor[victim].option && tempObj.armor[victim].option.find(o => o.name == "일격 피해 감소")) {
                            let num = tempObj.armor[victim].option.filter(o => o.name == "일격 피해 감소").reduce((sum, o) => sum + o.num, 0);
                            mul = Math.max(1, mul - num);
                        }
                        petDamage *= mul;
                    }
                    if (dealt(actor, victim, {p:0,m:petDamage,t:0}, null, {isPet: true})) return;
                    let r = Math.random();
                    let percent = 0.15;
                    if (tempObj.pet[actor].level >= 10) percent += 0.05;
                    if (tempObj.pet[actor].level >= 20) percent += 0.05;
                    if (tempObj.pet[actor].level >= 30) percent += 0.05;
                    if (tempObj.pet[actor].level >= 40) percent += 0.1;
                    if (tempObj.pet[actor].level >= 50 && actorActivated.includes("hit") && actorActivated.includes("crt")) percent = 0.7;
                    if (r < percent) {
                        instantFreeze(actor, victim);
                    }
                }
            }
        }
        if (tempObj.pet[actor].name == "조약돌 골렘") {
            if (!tempObj.stack[actor].cobblestone) tempObj.stack[actor].cobblestone = 0;
            tempObj.stack[actor].cobblestone++;
            if (tempObj.stack[actor].cobblestone % 2 == 0) {
                if (!(tempObj.stack[actor].stead && tempObj.stack[actor].stead >= 1000)) {
                    if (! tempObj.stat[actor].shield) tempObj.stat[actor].shield = 0;
                    logs.push("✳️ " + tempObj.name[actor] + "의 조약돌 골렘이 보호막을 부여합니다!");
                    tempObj.stat[actor].shield += tempObj.pet[actor].damage;
                    logs.push(tempObj.name[actor] + "의 보호막: " + tempObj.stat[actor].shield.toComma() + " (+" + tempObj.pet[actor].damage.toComma() + ")");
                    let num = 0.01;
                    if (tempObj.pet[actor].level >= 10) num = 0.015;
                    if (tempObj.pet[actor].level >= 20) num = 0.02;
                    if (tempObj.pet[actor].level >= 30) num = 0.0275;
                    if (tempObj.pet[actor].level >= 40) num = 0.04;
                    tempObj.stat[victim].cmb = Math.max(0, tempObj.stat[victim].cmb - num);
                    tempObj.stat[victim].crt = Math.max(0, tempObj.stat[victim].crt - num);
                    tempObj.stat[victim].cnt = Math.max(0, tempObj.stat[victim].cnt - num);
                }
            }
        }
        if (tempObj.pet[actor].name == "루나") {
            logs.push("✳️ " + tempObj.name[actor] + "의 루나가 달빛의 힘으로 치유합니다!");
            heal(actor, 40);
        }
    }

    if (tempObj.weapon[actor].enchant && tempObj.weapon[actor].enchant.find(e => e.name == "폭풍")) {
        if (! tempObj.stack[actor].storm) tempObj.stack[actor].storm = 0;
        tempObj.stack[actor].storm += 10;
    }

    for (let effect in tempObj.effect[actor]) {
        if (effect == "bleed") {
            logs.push("🩸 " + tempObj.name[actor] + "(이)가 피를 흘립니다!" + (tempObj.effect[actor][effect].stack > 1 ? " (현재 " + tempObj.effect[actor][effect].stack + "중첩)" : ""));
            let bleedDamage = 50;
            if (tempObj.effect[actor][effect].enhanced) bleedDamage += getPercentMaxHP(actor, 0.03);
            bleedDamage *= tempObj.effect[actor][effect].stack;
            if (dealt("true", actor, {p:0,m:0,t:bleedDamage}, null, {a: victim})) return;
        } else if (effect == "burn") {
            logs.push("🔥 " + tempObj.name[actor] + "(이)가 불탑니다!" + (tempObj.effect[actor][effect].stack > 1 ? " (현재 " + tempObj.effect[actor][effect].stack + "중첩)" : ""));
            let burnDamage = 75;
            if (tempObj.effect[actor][effect].inferno) burnDamage += getPercentMaxHP(actor, 0.05);
            burnDamage *= tempObj.effect[actor][effect].stack;
            if (actorArmor == "화염 드래곤의 비늘" && actorArmorTier >= 6) {
                logs.push("❇️ " + tempObj.name[actor] + "의 화염 내성!");
                burnDamage = Math.round(burnDamage * 0.1);
            }
            if (dealt("true", actor, {p:0,m:0,t:burnDamage}, null, {a: victim})) return;
            if (tempObj.effect[actor][effect].stigma && tempObj.stat[actor].hp <= getPercentMaxHP(actor, 0.1)) {
                logs.push("🛑 " + tempObj.name[actor] + "에게 부여된 업화의 낙인이 발동합니다!");
                if (instantDeath(tempObj.effect[actor][effect].stigma, actor)) return;
            }
        } else if (effect == "dragonFire") {
            logs.push("🐦‍🔥 " + tempObj.name[actor] + "(이)가 용염에 타오릅니다!");
            let burnDamage = getPercentMaxHP(actor, 0.06);
            if (dealt("true", actor, {p:0,m:0,t:burnDamage}, null, {a: victim})) return;
        } else if (effect == "poison") {
            logs.push("💔 " + tempObj.name[actor] + "(이)가 중독된 상태입니다! (현재 " + tempObj.effect[actor][effect].stack + "중첩)");
            let poisonDamage = (tempObj.effect[actor][effect].stack * 20);
            if (tempObj.effect[actor].illusion) poisonDamage = Math.round(poisonDamage * 1.5);
            if (tempObj.effect[actor].astroVenom && tempObj.effect[actor].astroVenom.tier >= 3) poisonDamage += Math.round(5 * getPercentMaxHP(actor, 0.01));
            if (tempObj.effect[actor].astroVenom && tempObj.effect[actor].astroVenom.tier >= 8) {
                let r = Math.random();
                if (r <= 0.35) {
                    poisonDamage += Math.round(poisonDamage * 2);
                }
            }
            if (dealt("true", actor, {p:0,m:0,t:poisonDamage}, null, {a: victim})) return;
        }
        tempObj.effect[actor][effect].turn--;
        if (tempObj.effect[actor][effect].turn <= 0) {
            delete tempObj.effect[actor][effect];
        }
    }

    if (actorWeapon == "소울 하베스터" && actorTier >= 6 && tempObj.stack[actor].harvested_soul) {
        let r = Math.random();
        let percent = 0.65;
        if (actorTier >= 8) percent = 1;
        if (r < percent) {
            logs.push("❇️ " + tempObj.name[actor] + "의 망령 소환!");
            let harvested_soul = JSON.parse(read("DB/harvested_soul/" + tempObj.name[actor] + ".json"));
            let shade = harvested_soul[Math.floor(Math.random() * harvested_soul.length)];
            tempObj.name['shade'] = "<망령> " + shade.name;
            tempObj.stat['shade'] = shade.stat;
            tempObj.weapon['shade'] = shade.weapon;
            if (!tempObj.weapon['shade'].option) tempObj.weapon['shade'].option = [];
            tempObj.weapon['shade'].option.push({
                name: "모든 피해 증가",
                num: 1
            })
            tempObj.armor['shade'] = shade.armor;
            tempObj.artifact['shade'] = shade.artifact || [];
            tempObj.stack['shade'] = shade.stack;
            tempObj.effect['shade'] = shade.effect;
            delete tempObj.effect['shade'].bleed;
            delete tempObj.effect['shade'].stun;
            delete tempObj.effect['shade'].burn;
            delete tempObj.effect['shade'].poison;
            delete tempObj.effect['shade'].slow;
            delete tempObj.effect['shade'].freeze;
            delete tempObj.effect['shade'].dragonFire;
            tempObj.pet['shade'] = {};
            logs.push("👻 " + tempObj.name['shade'] + "의 공격!");
            processHunt(tempObj, 'shade', victim);
        }
    }

    let actorUserId = (tempObj.id && tempObj.id[actor]) ? tempObj.id[actor] : null;
    if (tempObj.artifact[actor].includes("솔로몬의 반지") && actorUserId && read("DB/tamed/" + actorUserId + ".json")) {
        let r = Math.random();
        if (r < 0.5) {
            logs.push("❇️ " + tempObj.name[actor] + "의 명령!");
            let num = Math.floor(Math.random() * 2) + 1;
            let tamed = JSON.parse(read("DB/tamed/" + actorUserId + ".json")).filter(t => !t.name.includes("["));
            if (tamed.length < num) num = tamed.length;
            for(let i = 0; i < num; i++) {
                let shade = tamed[Math.floor(Math.random() * tamed.length)];
                tempObj.name['shade'] = "<복종> " + shade.name;
                tempObj.stat['shade'] = shade.stat;
                tempObj.stat['shade'].maxHp = shade.stat.hp;
                tempObj.weapon['shade'] = shade.weapon;
                tempObj.armor['shade'] = shade.armor;
                tempObj.artifact['shade'] = shade.artifact || [];
                tempObj.stack['shade'] = {};
                tempObj.effect['shade'] = {};
                tempObj.pet['shade'] = {};
                logs.push("🫳 " + tempObj.name['shade'] + "의 공격!");
                processHunt(tempObj, 'shade', victim);
            }
            if (num == 0) logs.push("❌ 길들인 몬스터가 없습니다!");
        }
    }
    if (tempObj.artifact[actor].includes("홍월의 솔로몬의 반지") && actorUserId && read("DB/tamed/" + actorUserId + ".json")) {
        let r = Math.random();
        if (r < 0.75) {
            logs.push("❇️ " + tempObj.name[actor] + "의 명령!");
            let num = Math.floor(Math.random() * 3) + 1;
            let tamed = JSON.parse(read("DB/tamed/" + actorUserId + ".json"));
            if (tamed.length < num) num = tamed.length;
            for(let i = 0; i < num; i++) {
                let shade = tamed[Math.floor(Math.random() * tamed.length)];
                tempObj.name['shade'] = "<복종> " + shade.name;
                tempObj.stat['shade'] = shade.stat;
                tempObj.stat['shade'].maxHp = shade.stat.hp;
                tempObj.weapon['shade'] = shade.weapon;
                tempObj.armor['shade'] = shade.armor;
                tempObj.artifact['shade'] = shade.artifact || [];
                tempObj.stack['shade'] = {};
                tempObj.effect['shade'] = {};
                tempObj.pet['shade'] = {};
                logs.push("🫳 " + tempObj.name['shade'] + "의 공격!");
                processHunt(tempObj, 'shade', victim);
            }
        }
    }

    if (tempObj.stack[actor].frenzy) {
        logs.push("🩸 " + tempObj.name[actor] + "의 생명력이 감소합니다!");
        if (tempObj.stat[actor].shield) {
            logs.push(tempObj.name[actor] + "의 보호막: 0 (-" + tempObj.stat[actor].shield.toComma() + ")");
            tempObj.stat[actor].shield = 0;
        }
        let frenzyDamage = Math.floor(tempObj.stat[actor].maxHp * 0.25);
        tempObj.stat[actor].hp = Math.max(0, tempObj.stat[actor].hp - frenzyDamage);
        logs.push(tempObj.name[actor] + "의 HP: " + tempObj.stat[actor].hp.toComma() + "/" + tempObj.stat[actor].maxHp.toComma() + " (-" + frenzyDamage.toComma() + ")");
        if (tempObj.stat[actor].hp <= 0) return;
    }

    if (tempObj.name[actor] == "훈련용 인형") {
        if (! tempObj.stack[actor].training) tempObj.stack[actor].training = 0;
        tempObj.stack[actor].training++;
        if (tempObj.stack[actor].training >= 20) {
            logs.push("🟥 20턴이 지나 훈련이 끝납니다.");
            tempObj.stat[victim].hp = 0;
            return;
        }
    } else if (!tempObj.stack[actor].balloon && !(actor.startsWith("h") || actor.startsWith("u") || actor.startsWith("p"))) {
        // let r = Math.random();
        // if (r < 0.15) {
        //     tempObj.stack[actor].balloon = 1;
        //     logs.push("🎈 " + tempObj.name[actor] + "에게 풍선이 날라왔습니다!");
        // }
    }

    if (actor.startsWith("m")) {
        if (! tempObj.stack[actor].mobTurn) tempObj.stack[actor].mobTurn = 0;
        tempObj.stack[actor].mobTurn++;
        if (tempObj.stack[actor].mobTurn >= 30) {
            logs.push("🟥 " + tempObj.name[actor] + "의 분노의 일격!");
            tempObj.stat[victim].hp = 0;
            return;
        }
    }
}


// ───────────────────────────────────────────────────────────── $헌터 <명령> 핸들러
// old_engine.js 5299-8442 `if (cmd.startsWith("헌터"))` 블록 이식.
async function handleHunter(user, channel, senderID, cmd) {
    const room = { id: channel.channelId + "", send: (m) => channel.sendChat(m) };
            // 미등록 유저 가드(원본은 toWait[user.id] 뒤에 있었으나 null 접근을 막기 위해 선행).
            if (! user) {
                room.send("❌ 봇에 등록되지 않은 유저입니다.\n>> $도움말");
                return;
            }
            let possibleRooms = ["442097040687921","18446472286956749","18447887254284126","433076049769561","384981318100178","18448796257459256","18451173486559958","439083102695072","18454451074557977","18456913814672594"];
            if (! possibleRooms.includes(room.id)) {
                room.send("❌ 헌터 콜로세움 게임이 지원되는 방이 아닙니다.");
                return;
            }
            if (toWait[user.id]) {
                room.send("❌ 소모품을 사용하는 중입니다. 잠시만 기다려주세요.");
                return;
            }
            let send = function(message) {
                room.send("🏹 헌터 콜로세움 ⚔️\n" + message);
            }
            if (! user) {
                room.send("❌ 봇에 등록되지 않은 유저입니다.\n>> $도움말");
                return;
            }
            if (user.playing.hunt && user.playing.hunt.hostId) {
                let hunt = await getHuntById(user.playing.hunt.hostId);
                if (! hunt) {
                    delete user.playing.hunt;
                    user.save();
                } else {
                    room.send("❌ 사냥 참여중엔 다른 행동이 불가능합니다.\n\n현재 " + hunt.player[0].name + "님의 파티에서 " + hunt.dungeon + " 탐험중입니다.");
                    return;
                }
            }

            cmd = cmd.replaceNumber();
            let args = cmd.split(" ").splice(1);
            let username = (user.title ? "[" + user.title + "] " : "") + user.name;
            if (args[0] == "장비") {
                try {
                    let weapon = JSON.parse(read("DB/weapons/" + user.equips.weapon.name + ".json"));
                    let armor = JSON.parse(read("DB/armors/" + user.equips.armor.name + ".json"));
                    let artifactPS = JSON.parse(read("DB/artifactPlusStat.json"));
                    for(let i = 0; i < user.equips.artifact.length; i++) {
                        artifactPS.forEach(artifact => {
                            if (user.equips.artifact[i] == artifact.name) {
                                for(let ps in artifact.plusStat) {
                                    if (ps == 'hp' || ps == 'def' || ps == 'res' || ps == 'avd') armor[user.equips.armor.tier].plusStat[ps] += artifact.plusStat[ps];
                                    else if (ps in weapon[user.equips.weapon.tier].plusStat) weapon[user.equips.weapon.tier].plusStat[ps] += artifact.plusStat[ps];
                                }
                            }
                        });
                    }
                    let weapon_desc = [
                        "🎯 명중 " + ((weapon[user.equips.weapon.tier].plusStat.hit + 0.7) * 100).fix(2) + "%",
                        "⚔️ 반격 " + ((weapon[user.equips.weapon.tier].plusStat.cnt + 0.05) * 100).fix(2) + "%",
                        "✨ 연격 " + ((weapon[user.equips.weapon.tier].plusStat.cmb + 0.05) * 100).fix(2) + "%",
                        "💥 일격 " + ((weapon[user.equips.weapon.tier].plusStat.crt + 0.05) * 100).fix(2) + "%",
                        "🗡️ 관통 " + ((weapon[user.equips.weapon.tier].plusStat.pnt + 0.05) * 100).fix(2) + "%",
                        "🩸 출혈 " + ((weapon[user.equips.weapon.tier].plusStat.bld + 0.1) * 100).fix(2) + "%",
                        "🔥 화상 " + ((weapon[user.equips.weapon.tier].plusStat.brn + 0.0) * 100).fix(2) + "%",
                        "🌀 기절 " + ((weapon[user.equips.weapon.tier].plusStat.stn + 0.0) * 100).fix(2) + "%",
                        "💔 중독 " + ((weapon[user.equips.weapon.tier].plusStat.poi + 0.0) * 100).fix(2) + "%",
                        "☠️ 즉사 " + ((weapon[user.equips.weapon.tier].plusStat.dth + 0.001) * 100).fix(2) + "%"
                    ];
                    if (user.equips.weapon.option) {
                        weapon_desc.push("[ 추가 옵션 ]");
                        let opt = user.equips.weapon.option.map(o => "- " + o.name + " +" + (o.num * 100).fix() + "%");
                        weapon_desc = weapon_desc.concat(opt);
                    }
                    if (user.equips.weapon.enchant) {
                        weapon_desc.push("🪯 마법 부여 🪯");
                        let ect = user.equips.weapon.enchant.map(e => "💠 " + e.name + " " + e.level.toRoman() + "\n" + JSON.parse(read("DB/enchantments/" + e.name + ".json")).desc.map(d => "- " + d.replace(/%D\((\d+)\)/g, (m, n) => { return parseInt(n) * e.level })).join("\n"));
                        weapon_desc = weapon_desc.concat(ect);
                    }
                    let armor_desc = [
                        "💚 체력 " + Math.round((armor[user.equips.armor.tier].plusStat.hp + 1000) * (1 + (user.getStat().def * 0.015))).toComma(),
                        "🛡️ 방어 " + ((armor[user.equips.armor.tier].plusStat.def + 0.1) * 100).fix(2) + "%",
                        "🔰 저항 " + ((armor[user.equips.armor.tier].plusStat.res + 0.1) * 100).fix(2) + "%",
                        "💨 회피 " + ((armor[user.equips.armor.tier].plusStat.avd + 0.05) * 100).fix(2) + "%"
                    ];
                    if (user.equips.armor.option) {
                        armor_desc.push("[ 추가 옵션 ]");
                        let opt = user.equips.armor.option.map(o => "- " + o.name + " +" + (o.num * 100).fix() + "%");
                        armor_desc = armor_desc.concat(opt);
                    }
                    if (user.equips.armor.enchant) {
                        armor_desc.push("🪯 마법 부여 🪯");
                        let ect = user.equips.armor.enchant.map(e => "💠 " + e.name + " " + e.level.toRoman() + "\n" + JSON.parse(read("DB/enchantments/" + e.name + ".json")).desc.map(d => "- " + d.replace(/%D\((\d+)\)/g, (m, n) => { return parseInt(n) * e.level })).join("\n"));
                        armor_desc = armor_desc.concat(ect);
                    }
                    let artifact_desc = [];
                    let count = 1;
                    user.equips.artifact.forEach(a => {
                        if (read("DB/artifacts/" + a + ".json")) {
                            let artifact = JSON.parse(read("DB/artifacts/" + a + ".json"));
                            artifact_desc.push("[" + count + "] 「" + a + "」\n- " + artifact.desc.join("\n- "));
                            count++;
                        }
                    });
                    send("[ " + username + "님의 장비 ]" + VIEWMORE + "\n\n[무기] [" + user.equips.weapon.tier + "] " + user.equips.weapon.name + "\n" + weapon_desc.join("\n") + "\n\n[갑옷] [" + user.equips.armor.tier + "] " + user.equips.armor.name + "\n" + armor_desc.join("\n") + (artifact_desc.length > 0 ? "\n\n[아티팩트]\n" + artifact_desc.join("\n") : ""));
                } catch(e) {
                    room.send("❗ 예기치 못한 오류가 발생했습니다." + VIEWMORE + "\n\n" + e);
                }
            }

            else if (args[0] == "설명") {
                let materials = {
                    "LK봇의 부품": "특별한 아티팩트를 제작하는 데 사용됩니다.",
                    "힘의 두루마리": "물리 피해와 관련된 아티팩트를 제작하는 데 사용됩니다.",
                    "마법의 두루마리": "마법과 관련된 아티팩트를 제작하는 데 사용됩니다.",
                    "늑대 이빨": "아티팩트를 제작하는 데 사용됩니다.",
                    "마나가 담긴 종이": "아티팩트 또는 두루마리를 제작하는 데 사용됩니다.",
                    "행운의 아르카나 증표": "원하는 아르카나 아티팩트로 교환할 수 있습니다.",
                    "보호의 두루마리": "방어와 관련된 아티팩트를 제작하는 데 사용됩니다.",
                    "펫 먹이": "펫 레벨업 또는 펫 훈련에 필요한 재료입니다.",
                    "별의 증표": "장비에 별의 축복을 부여하거나 희귀한 아티팩트를 제작하는 데 사용됩니다.",
                    "별의 파편": "100개를 모아 별의 증표 1개로 제작할 수 있습니다.",
                    "달의 파편": "100개를 모아 달의 증표 1개로 제작할 수 있습니다.",
                    "강함의 증명": "장비를 진화하는 데 사용됩니다.",
                    "달의 증표": "진화된 장비에 루나의 힘을 부여하는 데 사용됩니다.",
                    "시련의 회당 티켓": "시련의 회당 맵 입장에 사용됩니다.",
                    "루나리 왕국의 문장": "루나리 왕국 퀘스트에 사용됩니다.",
                    "무기 마법 부여 스크롤": "무기에 마법을 부여하는 데 사용됩니다.",
                    "갑옷 마법 부여 스크롤": "갑옷에 마법을 부여하는 데 사용됩니다.",
                    "고급 마법 부여 스크롤": "확정적으로 장비에 4가지의 마법을 최대로 부여하는 '고급 마법부여'에 사용됩니다.",
                    "루나리 왕국 입장권": "루나리 왕국에 입장하는 데 사용됩니다.\n입장 시 NPC와 대화가 가능하며 상황에 따라 퀘스트를 수행할 수 있습니다.",
                    "분해 도구": "제작 가능 아이템을 분해하는 데 사용됩니다.",
                    "슬롯 확장 스크롤": "아티팩트 최대 장착 슬롯을 확장하는 데 사용됩니다.",
                    "힘의 정수": "힘의 두루마리를 제작하는 데 사용됩니다.",
                    "마법의 정수": "마법의 두루마리를 제작하는 데 사용됩니다.",
                    "보호의 정수": "보호의 두루마리를 제작하는 데 사용됩니다.",
                    "근력 강화 스크롤": "힘의 두루마리가 부족해도 근력 스탯을 강화시킬 수 있습니다.",
                    "마력 강화 스크롤": "마법의 두루마리가 부족해도 마력 스탯을 강화시킬 수 있습니다.",
                    "체력 강화 스크롤": "보호의 두루마리가 부족해도 체력 스탯을 강화시킬 수 있습니다.",
                    "홍월의 샤드": "홍월의 아티팩트를 제작하는 데 사용됩니다.",
                    "영광의 별": "영광의 아티팩트를 제작하는 데 사용됩니다.",
                    "강함의 조각": "2개를 모아 강함의 증명 1개로 제작할 수 있습니다.",
                    "청월의 샤드": "청월의 아티팩트를 제작하는 데 사용됩니다.",
                    "서리 파편": "100개를 모아 서리 결정 1개로 제작할 수 있습니다.",
                    "서리 결정": "'아이스 하트' 아티팩트를 제작하는 데 사용됩니다.",
                    "아이스 베어의 가죽": "아이스 베어의 가죽입니다.",
                    "훈연 숯": "무언가를 굽는 데 사용됩니다.",
                    "유리병": "물약을 만드는 데 사용됩니다."
                };
                let item = cmd.substr(6);
                let itemInfo = [];
                if (read("DB/weapons/" + item + ".json")) {
                    let weapon = JSON.parse(read("DB/weapons/" + item + ".json"));
                    itemInfo.push("« " + item + " »\n[무기]" + VIEWMORE);
                    for(let tier in weapon) {
                        let plusStats = [];
                        let stats = {hit:"🎯명중",cnt:"⚔️반격",cmb:"✨연격",crt:"💥일격",pnt:"🗡️관통",bld:"🩸출혈",brn:"🔥화상",stn:"🌀기절",poi:"💔중독",dth:"☠️즉사"}
                        for(let stat in weapon[tier].plusStat) {
                            if (weapon[tier].plusStat[stat] != 0) {
                                plusStats.push(stats[stat] + " " + (weapon[tier].plusStat[stat] > 0 ? "+" : "") + (weapon[tier].plusStat[stat] * 100).fix(2) + "%");
                            }
                        }
                        if (tier == '-') {
                            itemInfo.push("\n[티어 없음]" + (plusStats.length > 0 ? "\n- " + plusStats.join(", ") : "") + (weapon[tier].tierDesc != "" ? "\n- " + weapon[tier].tierDesc : ""));
                        } else {
                            itemInfo.push("\n[티어 " + tier + " 효과] " + (plusStats.length > 0 ? "\n- " + plusStats.join(", ") : "") + (weapon[tier].tierDesc != "" ? "\n- " + weapon[tier].tierDesc : ""));
                        }
                    }
                    send(itemInfo.join("\n"));
                } else if (read("DB/armors/" + item + ".json")) {
                    let armor = JSON.parse(read("DB/armors/" + item + ".json"));
                    itemInfo.push("« " + item + " »\n[갑옷]" + VIEWMORE);
                    for(let tier in armor) {
                        let plusStats = [];
                        let stats = {hp:"💚체력",def:"🛡️방어",res:"🔰저항",avd:"💨회피"};
                        for(let stat in armor[tier].plusStat) {
                            if (armor[tier].plusStat[stat] != 0) {
                                plusStats.push(stats[stat] + " " + (armor[tier].plusStat[stat] > 0 ? "+" : "") + (stat == 'hp' ? armor[tier].plusStat[stat] : (armor[tier].plusStat[stat] * 100).fix(2) + "%"));
                            }
                        }
                        if (tier == '-') {
                            itemInfo.push("\n[티어 없음]" + (plusStats.length > 0 ? "\n- " + plusStats.join(", ") : "") + (armor[tier].tierDesc != "" ? "\n- " + armor[tier].tierDesc : ""));
                        } else {
                            itemInfo.push("\n[티어 " + tier + " 효과] " + (plusStats.length > 0 ? "\n- " + plusStats.join(", ") : "") + (armor[tier].tierDesc != "" ? "\n- " + armor[tier].tierDesc : ""));
                        }
                    }
                    send(itemInfo.join("\n"));
                } else if (read("DB/artifacts/" + item + ".json")) {
                    let artifact = JSON.parse(read("DB/artifacts/" + item + ".json"));
                    send("« " + item + " »\n[아티팩트]\n\n[ 장착 효과 ]\n- " + artifact.desc.join("\n- "));
                } else if (JSON.parse(read("DB/consumable.json")).find(c => c.name == item)) {
                    let consumable = JSON.parse(read("DB/consumable.json")).find(c => c.name == item);
                    if (consumable.name == "펫 알" && user.hasItem("네메아의 사자")) {
                        consumable.reward = [
                            {
                                "name": "검은 고양이",
                                "type": "펫",
                                "minCount": 1,
                                "maxCount": 10,
                                "percent": 0.2
                            },
                            {
                                "name": "아기 늑대",
                                "type": "펫",
                                "minCount": 1,
                                "maxCount": 10,
                                "percent": 0.2
                            },
                            {
                                "name": "작은 마법사",
                                "type": "펫",
                                "minCount": 1,
                                "maxCount": 10,
                                "percent": 0.2
                            },
                            {
                                "name": "조약돌 골렘",
                                "type": "펫",
                                "minCount": 1,
                                "maxCount": 10,
                                "percent": 0.2
                            },
                            {
                                "name": "펫 먹이",
                                "type": "재료",
                                "minCount": 2,
                                "maxCount": 15,
                                "percent": 0.19
                            },
                            {
                                "name": "★ 네메아의 사자",
                                "type": "펫",
                                "minCount": 1,
                                "maxCount": 5,
                                "percent": 0.01
                            }
                        ]
                    }
                    send("« " + item + " »\n[소모품]\n\n사용 시 아래 품목 중 랜덤한 아이템을 획득합니다.\n[ 포함된 품목 ]\n" + VIEWMORE + consumable.reward.map(r => "- " + (r.type ? ("[" + r.type + "] ") : "") + (r.name == "코인" ? "🪙" : r.name) + " x" + r.minCount.toComma() + (r.minCount != r.maxCount ? " ~ " + r.maxCount.toComma() : "") + " (" + (r.percent * 100).fix() + "%)").join("\n"));
                } else if (JSON.parse(read("DB/food.json")).find(f => f.name == item)) {
                    let food = JSON.parse(read("DB/food.json")).find(f => f.name == item);
                    send("« " + item + " »\n[음식]\n\n" + food.desc);
                } else if (read("DB/weapons/" + item.replace("의 조각", "") + ".json") || read("DB/armors/" + item.replace("의 조각", "") + ".json")) {
                    send("« " + item + " »\n[재료]\n\n" + item.replace("의 조각", "") + " 강화에 사용되는 조각입니다.");
                } else if (item == "강화석") {
                    send("« 강화석 »\n[재료]\n\n장비 강화에 필요한 재료입니다.");
                } else if (materials[item]) {
                    send("« " + item + " »\n[재료]\n\n" + materials[item]);
                } else {
                    room.send("❌ 존재하지 않는 아이템입니다.");
                }
            }

            else if (args[0] == "정보") {
                let monsters = JSON.parse(read("DB/monster.json"));
                let monster = monsters.find(m => m.name == cmd.substr(6));
                if (!monster) {
                    room.send("❌ 존재하지 않는 몬스터입니다.");
                } else {
                    let monster_stat = [
                        "💚 체력 " + monster.stat.hp.toComma(),
                        "🎯 명중 " + (monster.stat.hit * 100).fix(2) + "%",
                        "⚔️ 반격 " + (monster.stat.cnt * 100).fix(2) + "%",
                        "✨ 연격 " + (monster.stat.cmb * 100).fix(2) + "%",
                        "💥 일격 " + (monster.stat.crt * 100).fix(2) + "%",
                        "🗡️ 관통 " + (monster.stat.pnt * 100).fix(2) + "%",
                        "🩸 출혈 " + (monster.stat.bld * 100).fix(2) + "%",
                        "🔥 화상 " + (monster.stat.brn * 100).fix(2) + "%",
                        "🌀 기절 " + (monster.stat.stn * 100).fix(2) + "%",
                        "💔 중독 " + (monster.stat.poi * 100).fix(2) + "%",
                        "☠️ 즉사 " + (monster.stat.dth * 100).fix(2) + "%",
                        "🛡️ 방어 " + (monster.stat.def * 100).fix(2) + "%",
                        "🔰 저항 " + (monster.stat.res * 100).fix(2) + "%",
                        "💨 회피 " + (monster.stat.avd * 100).fix(2) + "%"
                    ];
                    let monster_rewards = ["- 🪙 " + monster.reward.minCoin.toComma() + " ~ " + monster.reward.maxCoin.toComma()];
                    monster.reward.others.forEach(reward => {
                        monster_rewards.push("- " + reward.name + " x" + reward.minCount.toComma() + (reward.minCount == reward.maxCount ? "" : " ~ " + reward.maxCount.toComma()) + " (" + (reward.percent * 100).fix(3) + "%)")
                    });
                    send("《 " + (monster.title ? "[" + monster.title + "] ":"") + monster.name + " 》\n" + VIEWMORE + "\n" + monster_stat.join("\n") + "\n\n- " + monster.special.join("\n- ") + "\n\n< 보상 >\n" + monster_rewards.join("\n"));
                }
            }

            else if (args[0] == "사용") {
                let runnable = new java.lang.Runnable({
                    run: async function() {
                        let matched;
                        if ((matched = cmd.match(/헌터 사용 (.+?) \d+$/)) == null) {
                            room.send("❌ 잘못된 입력입니다.\n[ $헌터 사용 [소모품] [수량] ]");
                            return;
                        }
                        let consumable = JSON.parse(read("DB/consumable.json")).find(c => c.name == matched[1]);
                        let useCount = Math.round(Number(cmd.substr(7 + matched[1].length)));
                        if (isNaN(useCount)) useCount = 1;
                        if (! consumable) {
                            room.send("❌ 존재하지 않는 소모품입니다.");
                        } else if (useCount < 1) {
                            room.send("❌ 사용 갯수는 최소 1개 이상이어야 합니다.");
                        } else if (useCount > 1000000) {
                            room.send("❌ 한 번에 1,000,000개까지만 사용할 수 있습니다.");
                        } else {
                            let item = user.inventory.find(i => i.name == matched[1]);
                            if (! item) {
                                room.send("❌ 해당 소모품을 보유하고 있지 않습니다.");
                            } else if (item.count < useCount) {
                                room.send("❌ 보유 수량이 부족합니다.\n보유 수량: " + item.count.toComma() + "개");
                            } else {
                                if (consumable.name == "펫 알" && user.hasItem("네메아의 사자")) {
                                    consumable.reward = [
                                        {
                                            "name": "검은 고양이",
                                            "type": "펫",
                                            "minCount": 1,
                                            "maxCount": 10,
                                            "percent": 0.2
                                        },
                                        {
                                            "name": "아기 늑대",
                                            "type": "펫",
                                            "minCount": 1,
                                            "maxCount": 10,
                                            "percent": 0.2
                                        },
                                        {
                                            "name": "작은 마법사",
                                            "type": "펫",
                                            "minCount": 1,
                                            "maxCount": 10,
                                            "percent": 0.2
                                        },
                                        {
                                            "name": "조약돌 골렘",
                                            "type": "펫",
                                            "minCount": 1,
                                            "maxCount": 10,
                                            "percent": 0.2
                                        },
                                        {
                                            "name": "펫 먹이",
                                            "type": "재료",
                                            "minCount": 2,
                                            "maxCount": 15,
                                            "percent": 0.19
                                        },
                                        {
                                            "name": "네메아의 사자",
                                            "type": "펫",
                                            "minCount": 1,
                                            "maxCount": 5,
                                            "percent": 0.01
                                        }
                                    ]
                                }
                                if (useCount > 1000) {
                                    room.send("🤖 잠시만 기다려주세요...\n※ 대기 중 다른 명령어 입력 시 오류가 발생할 수 있습니다.");
                                    toWait[user.id] = true;
                                }
                                item.count -= useCount;
                                let result = [];
                                for(let i = 0; i < useCount; i++) {
                                    let percent = 0;
                                    let gotReward = false;
                                    let r = Math.random();
                                    consumable.reward.forEach(reward => {
                                        if (gotReward) return;
                                        percent += reward.percent;
                                        if (r < percent) {
                                            let count = Math.floor(Math.random() * (reward.maxCount - reward.minCount + 1)) + reward.minCount;
                                            if (reward.name == "코인") {
                                                user.cash += count;
                                                if (result.find(r => r.name == "코인")) result.find(r => r.name == "코인").count += count;
                                                else result.push({name:"코인",count:count});
                                            } else {
                                                if (user.inventory.find(item => item.name == reward.name)) {
                                                    if (! user.inventory.find(item => item.name == reward.name).tier) {
                                                        user.inventory.find(item => item.name == reward.name).count += count;
                                                        if (result.find(r => r.name == reward.name)) result.find(r => r.name == reward.name).count += count;
                                                        else result.push({name:reward.name,count:count});
                                                    } else {
                                                        if (user.inventory.find(item => item.name == reward.name + "의 조각")) {
                                                            user.inventory.find(item => item.name == reward.name + "의 조각").count += 100;
                                                        } else {
                                                            let newItem = {
                                                                name: reward.name + "의 조각",
                                                                type: "재료",
                                                                count: 100
                                                            };
                                                            user.inventory.push(newItem);
                                                        }
                                                        if (result.find(r => r.name == reward.name + "의 조각")) result.find(r => r.name == reward.name + "의 조각").count += 100;
                                                        else result.push({name:reward.name+"의 조각",count:100});
                                                    }
                                                } else {
                                                    let newItem = {
                                                        name: reward.name,
                                                        type: reward.type,
                                                        count: count
                                                    };
                                                    if (reward.tier) newItem.tier = reward.tier;
                                                    user.inventory.push(newItem);
                                                    if (result.find(r => r.name == reward.name)) result.find(r => r.name == reward.name).count += count;
                                                    else result.push({name:reward.name,count:count});
                                                }
                                            }
                                            gotReward = reward.name;
                                        }
                                    });
                                    if(matched[1] == "아르카나 상자" && !gotReward.includes("아르카나")) {
                                        if (user.inventory.find(i => i.name == "아르카나")) user.inventory.find(i => i.name == "아르카나").count++;
                                        else user.inventory.push({name:"아르카나",type:"행운치",count:1});
                                        if (user.inventory.find(i => i.name == "아르카나").count >= 200) {
                                            user.inventory.splice(user.inventory.findIndex(i => i.name == "아르카나"), 1);
                                            if (user.inventory.find(item => item.name == "아르카나 무기 상자")) user.inventory.find(item => item.name == "아르카나 무기 상자").count += 1;
                                            else user.inventory.push({name:"아르카나 무기 상자",count:1,type:"소모품"});
                                            if (result.find(r => r.name == "아르카나 무기 상자")) result.find(r => r.name == "아르카나 무기 상자").count += 1;
                                            else result.push({name:"아르카나 무기 상자",count:1});
                                        }
                                    } else if (matched[1] == "아르카나 상자") {
                                        if (user.inventory.find(i => i.name == "아르카나")) {
                                            user.inventory.find(i => i.name == "아르카나").count = 0;
                                        }
                                    }
                                }
                                user.save();
                                if (toWait[user.id]) delete toWait[user.id];
                                send("[ " + matched[1] + " x" + useCount.toComma() + " 사용 결과 ]\n" + (result.length > 0 ? result.map(r => "- " + (r.name == "코인" ? "🪙" : r.name) + " x" + r.count.toComma()).join("\n") : "❌ 아무것도 얻지 못했습니다."));
                            }
                        }
                    }
                });
                var thread = new java.lang.Thread(runnable);
                thread.start();
            }

            else if (args[0] == "인벤토리") {
                if (cmd.substr(8) != "") {
                    let newUser = await getUserByName(cmd.substr(8));
                    if (newUser) {
                        user = newUser;
                        username = (newUser.title ? "[" + newUser.title + "] " : "") + newUser.name;
                    }
                }
                let results = [];
                let typeList = ["무기","갑옷","아티팩트","펫","음식","소모품","재료"];
                let edited = false;
                if (! user.inventory.find(i => i.name == "💎")) {
                    user.inventory.push({name:"💎",count:0,type:"재화"});
                    edited = true;
                }
                if (user.inventory.find(i => i.name == "🪷")) {
                    user.giveItem({name:"코인 주머니",type:"소모품",count:user.inventory.find(i => i.name == "🪷").count});
                    user.inventory.splice(user.inventory.findIndex(i => i.name == "🪷"), 1);
                    edited = true;
                }
                typeList.forEach(type => {
                    let typeItems = user.inventory.filter(item => item.type == type);
                    if (typeItems.length > 0) {
                        results.push("\n<< " + type + " >>");
                        typeItems.sort((a, b) => a.name.localeCompare(b.name)).forEach(item => {
                            if (item.count > 0) {
                                if (item.type == "펫" && !item.level) {
                                    edited = true;
                                    item.level = 1;
                                    let pet = JSON.parse(read("DB/pets/" + item.name + ".json"));
                                    if (pet) item.damage = pet.damage;
                                }
                                results.push("- " + (item.tier ? "[" + item.tier + "] " : "") + item.name + (!item.tier ? " x" + item.count.toComma() : "") + (user.equips.weapon.name == item.name || user.equips.armor.name == item.name || user.pet.name == item.name ? "  ✅":"") + (user.equips.artifact.includes(item.name) ? "  " + Array(user.equips.artifact.filter(a => a == item.name).length + 1).join("✅") : ""));
                            } else if (!(item.tier || item.name == "강함의 증명" || item.type == "재화")) {
                                edited = true;
                                user.inventory.splice(user.inventory.findIndex(i => i.name == item.name), 1);
                            }
                        });
                    }
                    
                });

                if (edited) user.save();
                
                let goods = ["🪙 " + user.cash.toComma()];
                let invGoods = user.inventory.filter(i => i.type == "재화");
                invGoods.forEach(g => {
                    goods.push(g.name + " " + g.count.toComma());
                })
                send("[ " + username + "님의 인벤토리 ]\n" + goods.join(" | ") + (results.length == 0 ? "\n\n인벤토리가 비어있습니다." : "\n" + VIEWMORE + results.join("\n")));
            }

            else if (args[0] == "길드") {
                if (args[1] == "생성") {
                    if (user.guild) {
                        room.send("❌ 이미 길드에 가입한 상태입니다.");
                    } else if (user.cash < 200000000) {
                        room.send("❌ 길드 생성 비용이 부족합니다.\n보유 코인: 🪙" + user.cash.toComma() + "/2억");
                    } else {
                        let guildName = args[2].replace(/[^가-힣A-Za-z0-9]/gi, "");
                        if (!guildName) {
                            room.send("❌ 길드 이름을 지어주세요!");
                        } else if (JSON.parse(read("DB/guild.json")).find(g => g.name == guildName)) {
                            room.send("❌ 이미 존재하는 길드명입니다.");
                        } else if (guildName.length < 2 || guildName.length > 10) {
                            room.send("❌ 길드명은 2 ~ 10글자로 지어야 합니다.");
                        } else {
                            if (myCheck[senderID] && myCheck[senderID].type == "확인") return;
                            room.send("🔍 길드명 확인중입니다...");
                            myCheck[senderID] = {
                                type: "확인"
                            };
                            let checkBadRes = await checkBadWord(guildName);
                            if (checkBadRes.ban) {
                                delete myCheck[senderID];
                                if (checkBadRes.error) {
                                    room.send("❌ 오류가 발생했습니다. 다시 시도해주세요.");
                                    return;
                                }
                                room.send("❌ 부적절한 단어가 포함되어 있습니다.\n사유: " + checkBadRes.reason);
                            } else {
                                myCheck[senderID] = {
                                    type: "길드생성",
                                    arg: {
                                        name: guildName
                                    }
                                };
                                send("길드명: [ " + guildName + " ]\n정말 생성하시겠습니까?\n\n[ " + PREFIX + "확인 ]");
                            }
                        }
                    }
                } else if (args[1] == "가입신청") {
                    if (user.guild) {
                        room.send("❌ 이미 길드에 가입한 상태입니다.");
                    } else if (!JSON.parse(read("DB/guild.json")).find(g => g.name == args[2])) {
                        room.send("❌ 해당 길드는 존재하지 않습니다.");
                    } else if (JSON.parse(read("DB/guild.json")).find(g => g.name == args[2]).request.find(u => u.id == user.id)) {
                        room.send("❌ 이미 해당 길드에 가입 신청을 했습니다.");
                    } else {
                        let guilds = JSON.parse(read("DB/guild.json"));
                        let guild = guilds.find(g => g.name == args[2]);
                        guild.request.push({
                            name: user.name,
                            id: user.id
                        });
                        save("DB/guild.json", JSON.stringify(guilds, null, 4));
                        room.send("✅ " + args[2] + " 길드에 가입 신청을 완료했습니다.");
                    }
                } else if (args[1] == "가입수락") {
                    if (user.guild && user.guild.host) {
                        if (! JSON.parse(read("DB/guild.json")).find(g => g.name == user.guild.name).request.find(u => u.name == args[2])) {
                            room.send("❌ 해당 유저는 가입 신청을 하지 않았습니다.");
                        } else {
                            let guilds = JSON.parse(read("DB/guild.json"));
                            let guild = guilds.find(g => g.name == user.guild.name);
                            if (guild.members.length >= 5) {
                                room.send("❌ 길드 수용 가능 인원이 가득 찼습니다. (5/5)");
                                return;
                            }
                            let joinUser = await getUserById(guild.request.find(u => u.name == args[2]).id);
                            if (! joinUser) {
                                room.send("❌ 해당 유저의 계정이 삭제되었습니다.");
                                guild.request.splice(guild.request.findIndex(u => u.name == args[2]), 1);
                                save("DB/guild.json", JSON.stringify(guilds, null, 4));
                            } else if (joinUser.guild) {
                                room.send("❌ 해당 유저는 이미 다른 길드에 가입했습니다.");
                                guild.request.splice(guild.request.findIndex(u => u.name == args[2]), 1);
                                save("DB/guild.json", JSON.stringify(guilds, null, 4));
                            } else {
                                joinUser.guild = {
                                    name: user.guild.name,
                                    host: false
                                };
                                joinUser.save();
                                guild.request.splice(guild.request.findIndex(u => u.name == args[2]), 1);
                                guild.members.push({
                                    name: (joinUser.title ? "[" + joinUser.title + "] " : "") + joinUser.name,
                                    id: joinUser.id
                                });
                                save("DB/guild.json", JSON.stringify(guilds, null, 4));
                                room.send("✅ " + (joinUser.title ? "[" + joinUser.title + "] " : "") + joinUser.name + "님의 가입 신청을 수락했습니다.");
                            }
                        }
                    }
                } else if (args[1] == "신청목록") {
                    if (user.guild && user.guild.host) {
                        let guilds = JSON.parse(read("DB/guild.json"));
                        let guild = guilds.find(g => g.name == user.guild.name);
                        let requests = guild.request.map(r => r.name);
                        send("[ 길드 가입 신청 목록 ]\n" + (requests.length > 0 ? "- " + requests.join("\n- ") : "가입 신청자가 없습니다."));
                    }
                } else if (args[1] == "목록") {
                    let guilds = JSON.parse(read("DB/guild.json"));
                    send("[ 길드 목록 ]\n" + (guilds.length <= 0 ? "생성된 길드가 없습니다." : VIEWMORE + "\n" + guilds.map(g => "< " + g.name + " > (" + g.members.length + "/5)\n[ 길드장 ] " + g.host.name).join("\n\n")));
                } else if (args[1] == "추방") {
                    if (user.guild && user.guild.host) {
                        let guilds = JSON.parse(read("DB/guild.json"));
                        let guild = guilds.find(g => g.name == user.guild.name);
                        if (guild.members.find(m => m.name == args[2])) {
                            let quit = await getUserById(guild.members.find(m => m.name == args[2]).id);
                            if (quit) {
                                quit.guild = null;
                                quit.save();
                            }
                            guild.members.splice(guild.members.findIndex(m => m.name == args[2]), 1);
                            save("DB/guild.json", JSON.stringify(guilds, null, 4));
                            room.send("✅ " + args[2] + "님을 길드에서 추방시켰습니다.");
                        } else {
                            room.send("❌ 해당 길드원이 존재하지 않습니다.");
                        }
                    }
                } else if (args[1] == "탈퇴") {
                    if (user.guild) {
                        if (user.guild.host) {
                            room.send("❌ 길드장은 탈퇴할 수 없습니다.");
                        } else {
                            let guilds = JSON.parse(read("DB/guild.json"));
                            let guild = guilds.find(g => g.name == user.guild.name);
                            guild.members.splice(guild.members.findIndex(m => m.id == user.id), 1);
                            save("DB/guild.json", JSON.stringify(guilds, null, 4));
                            user.guild = null;
                            user.save();
                            room.send("✅ 길드에서 탈퇴했습니다.");
                        }
                    }
                } else {
                    if (user.guild) {
                        let guilds = JSON.parse(read("DB/guild.json"));
                        let guild = guilds.find(g => g.name == user.guild.name);
                        send("[ " + guild.name + " 길드 정보 ]\n\n《 길드장 》 " + guild.host.name + "\n\n《 길드원 》 (" + guild.members.length + "/5)\n" + (guild.members.length > 0 ? "- " + guild.members.map(m => m.name).join("\n- ") : "길드원이 없습니다."));
                    } else {
                        room.send("아래 명령어를 통해 길드를 생성하거나 길드에 가입하세요.\n\n>> $헌터 길드 생성 [길드명]\n>> $헌터 길드 가입신청 [길드명]\n>> $헌터 길드 목록")
                    }
                }
            }

            else if (args[0] == "거래소") {
                if (args[1] == "판매") {
                    if (!(user.guild && user.guild.host)) {
                        room.send("❌ 판매 등록은 길드장만 가능합니다.");
                    } else {
                        let matched;
                        if ((matched = cmd.match(/헌터 거래소 판매 (.+?) \d+ \d+$/)) == null) {
                            room.send("❌ 잘못된 입력입니다.\n[ $헌터 거래소 판매 [품목] [가격] [수량] ]");
                        } else {
                            let item = user.inventory.find(i => i.name.toUpperCase().replace(/\s/gi, "") == matched[1].toUpperCase().replace(/\s/gi, ""));
                            if (! item || item.count < 1) {
                                room.send("❌ 아이템을 보유하고 있지 않습니다.");
                            } else if (item.tier) {
                                room.send("❌ 장비는 판매할 수 없습니다.");
                            } else if (["별빛 각인"].includes(item.name)) {
                                room.send("❌ 판매할 수 없는 아이템입니다.");
                            } else {
                                let price = Math.round(Number(cmd.substr(("헌터 거래소 판매 " + matched[1] + " ").length).split(" ")[0]));
                                let num = Math.round(Number(cmd.substr(("헌터 거래소 판매 " + matched[1] + " ").length).split(" ")[1]));
                                let trades = JSON.parse(read("DB/hunterTrade.json"));
                                if (item.count < num) {
                                    room.send("❌ 보유 품목이 부족합니다.");
                                } else {
                                    if (trades.find(trade => trade.item.name == item.name && trade.price == price && trade.seller.id == user.id)) {
                                        trades.find(trade => trade.item.name == item.name && trade.price == price && trade.seller.id == user.id).item.count += num;
                                    } else {
                                        trades.push({
                                            id: Number(read("DB/hunterShopId.txt")),
                                            item: {
                                                name: item.name,
                                                type: item.type,
                                                count: num
                                            },
                                            price: price,
                                            seller: {
                                                name: user.name,
                                                id: user.id
                                            }
                                        });
                                        save("DB/hunterShopId.txt", (Number(read("DB/hunterShopId.txt"))+1).toString());
                                    }
                                    save("DB/hunterTrade.json", JSON.stringify(trades));
                                    item.count -= num;
                                    user.save();
                                    send("✅ " + item.name + " x" + num.toComma() + " 판매 등록이 완료되었습니다.");
                                }
                            }
                        }
                    }
                } else if (args[1] == "구매") {
                    let productNum = args[2];
                    let buyNum = args[3];
                    if (! productNum || isNaN(productNum)) {
                        room.send("❌ 잘못된 입력입니다.\n[ $헌터 거래소 구매 [상품번호] [수량] ]");
                    } else {
                        if (!buyNum) buyNum = 1;
                        if (isNaN(buyNum)) {
                            room.send("❌ 잘못된 입력입니다.\n[ $헌터 거래소 구매 [상품번호] [수량] ]");
                            return;
                        }
                        let trades = JSON.parse(read("DB/hunterTrade.json"));
                        productNum = Math.round(Number(productNum));
                        if (productNum < 0) {
                            room.send("❌ 상품 번호가 잘못되었습니다.");
                            return;
                        }
                        buyNum = Math.round(Number(buyNum));
                        let product = trades.find(t => t.id == productNum);
                        if (!product) {
                            room.send("❌ 해당 상품은 존재하지 않습니다.");
                        } else if (buyNum < 1) {
                            room.send("❌ 구매 수량은 최소 1 이상이어야 합니다.");
                        } else if (product.item.count < buyNum) {
                            room.send("❌ 물량이 부족합니다.\n남은 물량: " + product.item.count.toComma() + "개");
                        } else if (!(user.id == product.seller.id) && (user.cash < product.price * buyNum)) {
                            room.send("❌ 코인이 부족합니다.\n보유 코인: 🪙" + user.cash.toComma() + "\n필요 코인: 🪙" + (product.price * buyNum).toComma());
                        } else if (product.item.name == "네메아의 사자" && !user.hasItem("네메아의 사자")) {
                            room.send("❌ 네메아의 사자를 보유해야 구매할 수 있습니다.");
                        } else if (toWait[product.seller.id]) {
                            room.send("❌ 현재 해당 판매자의 거래소 물품을 구매할 수 없습니다.\n잠시 후 다시 시도해주세요.");
                        } else {
                            user.cash -= product.price * buyNum;
                            if (user.inventory.find(i => i.name == product.item.name)) {
                                user.inventory.find(i => i.name == product.item.name).count += buyNum;
                            } else {
                                user.inventory.push({
                                    name: product.item.name,
                                    type: product.item.type,
                                    count: buyNum
                                });
                            }
                            user.save();
                            let seller = await getUserById(product.seller.id);
                            if (seller) {
                                seller.cash += product.price * buyNum;
                                seller.save();
                            }
                            if (user.id == product.seller.id) {
                                send("✅ " + product.item.name + " x" + buyNum.toComma() + " 아이템을 회수했습니다!");
                            } else {
                                send("✅ " + product.item.name + " x" + buyNum.toComma() + " 구매에 성공했습니다!");
                            }
                            
                            product.item.count -= buyNum;
                            if (product.item.count <= 0) {
                                trades.splice(trades.findIndex(t => t.id == productNum), 1);
                            }
                            save("DB/hunterTrade.json", JSON.stringify(trades));
                        }
                    }
                } else {
                    let trades = JSON.parse(read("DB/hunterTrade.json"));
                    let tradeList = trades.map((trade, num) => "[" + trade.id + "] « " + trade.item.name + " »\n>> 판매자: " + trade.seller.name + "\n>> 남은 물량: " + numberWithCommas(trade.item.count.toString()) + "개\n>> 가격: 🪙 " + numberWithCommas(trade.price.toString()));
                    send("[ 헌터 거래소 ]\n" + (tradeList.length > 0 ? VIEWMORE + "\n" + tradeList.join("\n\n") : "아직 등록된 물품이 없습니다.") + "\n\n※ 헌터 거래소 판매 등록은 길드장만 가능합니다.");
                }
            }

            else if (args[0] == "상점") {
                let shopInfo = JSON.parse(read("DB/hunterShop.json"));
                if (shopInfo.lastDate != (new Date().getHours())) {
                    shopInfo.lastDate = new Date().getHours();
                    let items = {
                        "무기": ["맹독 비수", "방랑자의 장검", "뱀파이어의 송곳니", "별빛 지팡이", "새벽 단검", "하늘의 장궁", "흉포한 도끼", "염화의 지팡이", "격조의 창"],
                        "갑옷": ["그림자 망토", "방랑자의 천갑옷", "여명의 갑주", "화염 드래곤의 비늘", "핏빛 로브"],
                        "재료": ["힘의 두루마리", "마법의 두루마리", "보호의 두루마리"],
                        "잡템": ["늑대 이빨", "마나가 담긴 종이"]
                    };
                    shopInfo.selling = [
                        {
                            count: 10,
                            name: "아티팩트 상자",
                            type: "소모품",
                            price: {
                                goods: "💎",
                                count: 10
                            }
                        },
                        {
                            count: 1000,
                            name: "두루마리 상자",
                            type: "소모품",
                            price: {
                                goods: "💎",
                                count: 2
                            }
                        },
                        {
                            count: 1,
                            name: "분해 도구",
                            type: "재료",
                            price: {
                                goods: "💎",
                                count: 25
                            }
                        },
                        {
                            count: 1000000,
                            name: "펫 알",
                            type: "소모품",
                            price: {
                                goods: "🪙",
                                count: 5000
                            }
                        },
                        {
                            count: 200,
                            name: "강화석 주머니",
                            type: "소모품",
                            price: {
                                goods: "🪙",
                                count: 100000
                            }
                        },
                        {
                            count: 10000,
                            name: "강화석 상자",
                            type: "소모품",
                            price: {
                                goods: "💎",
                                count: 1
                            }
                        },
                        {
                            count: 1000000,
                            name: "무기 상자",
                            type: "소모품",
                            price: {
                                goods: "🪙",
                                count: 100000
                            }
                        },
                        {
                            count: 1000000,
                            name: "갑옷 상자",
                            type: "소모품",
                            price: {
                                goods: "🪙",
                                count: 100000
                            }
                        },
                        {
                            count: Math.floor(Math.random() * 51) + 50,
                            name: "보물상자",
                            type: "소모품",
                            price: {
                                goods: "🪙",
                                count: 15000000
                            }
                        },
                        {
                            count: Math.floor(Math.random() * 6) + 5,
                            name: "희귀 상자",
                            type: "소모품",
                            price: {
                                goods: "💎",
                                count: Math.floor(Math.random() * 3) + 3
                            }
                        },
                        {
                            count: Math.floor(Math.random() * 4) + 2,
                            name: "별빛 상자",
                            type: "소모품",
                            price: {
                                goods: "💎",
                                count: Math.floor(Math.random() * 6) + 5
                            }
                        }
                    ];
                    for (let i = 0; i < 1; i++) {
                        let type = ["잡템"][i];
                        let item = items[type][Math.floor(Math.random() * items[type].length)];
                        items[type].remove(item);
                        shopInfo.selling.push({
                            count: 5000,
                            name: item + (type != "잡템" ? "의 조각": ""),
                            type: "재료",
                            price: {
                                goods: "🪙",
                                count: Math.floor(Math.random() * 40001) + (item == "핏빛 로브" || item == "흉포한 도끼" ? 10000 : 1000)
                            }
                        });
                    }
                    shopInfo.selling.push({
                        count: Math.floor(Math.random() * 11) + 10,
                        name: "LK봇의 부품",
                        type: "재료",
                        price: {
                            goods: "🪙",
                            count: Math.floor(Math.random() * 9000001) + 1000000
                        }
                    });
                    let r = Math.random();
                    if (r < 0.02) {
                        shopInfo.selling.push({
                            count: Math.floor(Math.random() * 2) + 1,
                            name: "별의 증표",
                            type: "재료",
                            price: {
                                goods: "🪙",
                                count: Math.floor(Math.random() * 1500000001) + 500000000
                            }
                        });
                    } else {
                        shopInfo.selling.push({
                            count: 1,
                            name: "별의 증표",
                            type: "재료",
                            price: {
                                goods: "💎",
                                count: Math.floor(Math.random() * 201) + 300
                            }
                        });
                    }

                    shopInfo.selling.push({
                        count: 1,
                        name: "고급 마법 부여 스크롤",
                        type: "재료",
                        price: {
                            goods: "💎",
                            count: 500
                        }
                    }, {
                        count: 1,
                        name: "홍월의 샤드",
                        type: "재료",
                        price: {
                            goods: "💎",
                            count: 2000
                        }
                    }, {
                        count: 100,
                        name: "격조의 창",
                        type: "무기",
                        tier: "E",
                        price: {
                            goods: "🪙",
                            count: 50000000
                        }
                    }, {
                        count: 100,
                        name: "맹독 비수",
                        type: "무기",
                        tier: "E",
                        price: {
                            goods: "🪙",
                            count: 50000000
                        }
                    }, {
                        count: 100,
                        name: "방랑자의 장검",
                        type: "무기",
                        tier: "E",
                        price: {
                            goods: "🪙",
                            count: 50000000
                        }
                    }, {
                        count: 100,
                        name: "뱀파이어의 송곳니",
                        type: "무기",
                        tier: "E",
                        price: {
                            goods: "🪙",
                            count: 50000000
                        }
                    }, {
                        count: 100,
                        name: "별빛 지팡이",
                        type: "무기",
                        tier: "E",
                        price: {
                            goods: "🪙",
                            count: 50000000
                        }
                    }, {
                        count: 100,
                        name: "새벽 단검",
                        type: "무기",
                        tier: "E",
                        price: {
                            goods: "🪙",
                            count: 50000000
                        }
                    }, {
                        count: 100,
                        name: "염화의 지팡이",
                        type: "무기",
                        tier: "E",
                        price: {
                            goods: "🪙",
                            count: 50000000
                        }
                    }, {
                        count: 100,
                        name: "하늘의 장궁",
                        type: "무기",
                        tier: "E",
                        price: {
                            goods: "🪙",
                            count: 50000000
                        }
                    }, {
                        count: 100,
                        name: "사신의 낫",
                        type: "무기",
                        tier: "E",
                        price: {
                            goods: "💎",
                            count: 100
                        }
                    }, {
                        count: 100,
                        name: "흉포한 도끼",
                        type: "무기",
                        tier: "E",
                        price: {
                            goods: "💎",
                            count: 100
                        }
                    }, {
                        count: 100,
                        name: "그림자 망토",
                        type: "갑옷",
                        tier: "E",
                        price: {
                            goods: "🪙",
                            count: 50000000
                        }
                    }, {
                        count: 100,
                        name: "마법사의 로브",
                        type: "갑옷",
                        tier: "E",
                        price: {
                            goods: "🪙",
                            count: 50000000
                        }
                    }, {
                        count: 100,
                        name: "방랑자의 천갑옷",
                        type: "갑옷",
                        tier: "E",
                        price: {
                            goods: "🪙",
                            count: 50000000
                        }
                    }, {
                        count: 100,
                        name: "여명의 갑주",
                        type: "갑옷",
                        tier: "E",
                        price: {
                            goods: "🪙",
                            count: 50000000
                        }
                    }, {
                        count: 100,
                        name: "석상 돌갑옷",
                        type: "갑옷",
                        tier: "E",
                        price: {
                            goods: "💎",
                            count: 100
                        }
                    }, {
                        count: 100,
                        name: "핏빛 로브",
                        type: "갑옷",
                        tier: "E",
                        price: {
                            goods: "💎",
                            count: 100
                        }
                    });
                    save("DB/hunterShop.json", JSON.stringify(shopInfo, null, 4));
                }
                let sellingList = [];
                shopInfo.selling.forEach(sell => {
                    sellingList.push("[" + sell.type + "] « " + (sell.tier ? "[" + sell.tier + "] " : "") + sell.name + " »\n>> 남은 물량: " + numberWithCommas(sell.count.toString()) + "개\n>> 가격: " + sell.price.goods + " " + numberWithCommas(sell.price.count.toString()));
                });
                send("[ 헌터 상점 ]\n" + VIEWMORE + "\n" + sellingList.join("\n\n") + "\n\n※ 헌터 상점은 1시간마다 초기화됩니다.");
            }

            else if (args[0] == "구매") {
                let matched;
                if ((matched = cmd.match(/헌터 구매 (.+?) \d+$/)) == null) {
                    room.send("❌ 잘못된 입력입니다.\n[ $헌터 구매 [품목] [수량] ]");
                } else {
                    let shopInfo = JSON.parse(read("DB/hunterShop.json"));
                    if (shopInfo.lastDate != (new Date().getHours())) {
                        room.send("❌ 일간 상점이 갱신되지 않았습니다.\n상점을 먼저 확인해주세요.\n\n>> $헌터 상점");
                        return;
                    }
                    let buying = shopInfo.selling.find(s => s.name.toUpperCase().replace(/\s/gi, "") == matched[1].toUpperCase().replace(/\s/gi, ""));
                    if (! buying) {
                        room.send("❌ 판매하지 않는 품목입니다.");
                    } else if (buying.count <= 0) {
                        room.send("❌ 품절된 상품입니다.");
                    } else {
                        let num = Math.round(Number(cmd.substr(("헌터 구매 " + matched[1] + " ").length).split(" ")[0]));
                        let goods = buying.price.goods == "🪙" ? user.cash : (user.inventory.find(i => i.name == buying.price.goods) || {count: 0}).count;
                        if (isNaN(num) || num < 1) {
                            room.send("❌ 숫자를 올바르게 입력해주세요.");
                        } else if ((buying.price.count * num) > goods) {
                            room.send("❌ 재화가 부족합니다.\n보유 " + buying.price.goods + ": " + goods.toComma() + "\n필요 " + buying.price.goods + ": " + (buying.price.count * num).toComma());
                        } else if (buying.count < num) {
                            room.send("❌ 물량이 부족합니다.\n남은 물량: " + buying.count.toComma() + "개");
                        } else if (user.inventory.find(item => item.name == buying.name) && (buying.tier)) {
                            room.send("❌ 이미 보유한 장비입니다.");
                        } else if ((buying.tier) && num > 2) {
                            room.send("❌ 장비는 2개 이상 구매할 수 없습니다.");
                        } else {
                            buying.count -= num;
                            save("DB/hunterShop.json", JSON.stringify(shopInfo, null, 4));
                            if (buying.price.goods == "🪙") {
                                user.cash -= (buying.price.count * num);
                            } else {
                                if (user.inventory.find(item => item.name == buying.price.goods)) {
                                    user.inventory.find(item => item.name == buying.price.goods).count -= (buying.price.count * num);
                                }
                            }
                            if (user.inventory.find(item => item.name == buying.name)) {
                                user.inventory.find(item => item.name == buying.name).count += num;
                            } else {
                                let newItem = {
                                    name: buying.name,
                                    count: num,
                                    type: buying.type
                                };
                                if (buying.tier) {
                                    newItem.tier = buying.tier;
                                }
                                user.inventory.push(newItem);
                            }
                            user.save();
                            send("✅ " + buying.name + " x" + num.toComma() + " 구매에 성공하였습니다!");
                        }
                    }
                }
            }

            // else if (args[0] == "아르카나") {
            //     let num = Math.round(Number(args[1]));
            //     if (isNaN(num)) num = 1;
            //     if (num > user.remainArcana) {
            //         room.send("❌ 최대 구매 한도에 도달했습니다.\n구매 한도: (" + (100 - user.remainArcana) + "/100)");
            //     } else if (num < 1) {
            //         room.send("❌ 최소 1 이상 입력해주세요.");
            //     } else if ((num * 12000000) > user.cash) {
            //         room.send("❌ 코인이 부족합니다.\n보유 코인: 🪙" + user.cash.toComma() + "\n필요 코인: 🪙" + (num * 12000000).toComma());
            //     } else {
            //         user.cash -= (num * 12000000);
            //         user.remainArcana -= num;
            //         if (user.inventory.find(i => i.name == "아르카나 상자")) user.inventory.find(i => i.name == "아르카나 상자").count += num;
            //         else user.inventory.push({name:"아르카나 상자",type:"소모품",count:num});
            //         user.save();
            //         send("✅ 아르카나 상자 x" + num + " 구매가 완료되었습니다!");
            //     }
            // }

            else if (args[0] == "행운치") {
                let lucky = user.inventory.find(i => i.type == "행운치") || {count: 0};
                send("🍀 " + username + "님의 행운치: " + lucky.count + "/200");
            }

            else if (args[0] == "선물") {
                let matched;
                let target = args[1];
                if ((matched = cmd.match(/헌터 선물 (.+?) \d+$/)) == null) {
                    room.send("❌ 잘못된 입력입니다.\n[ $헌터 선물 [유저] [아이템] [수량] ]");
                } else {
                    let targetUser = await getUserByName(target);
                    if (!targetUser) {
                        room.send("❌ 존재하지 않는 유저입니다.");
                        return;
                    } else if (targetUser.id == user.id) {
                        room.send("❌ 자기 자신에게 선물할 수 없습니다.");
                        return;
                    } else if (toWait[targetUser.id]) {
                        room.send("❌ 현재 해당 유저에게 선물할 수 없습니다.\n잠시 후 다시 시도해주세요.");
                        return;
                    }
                    let name = matched[1].substr(target.length + 1);
                    let gift = user.inventory.find(s => s.name.toUpperCase().replace(/\s/gi, "") == name.toUpperCase().replace(/\s/gi, ""));
                    let num = Math.round(Number(cmd.substr(("헌터 선물 " + matched[1] + " ").length).split(" ")[0]));
                    if (isNaN(num) || num < 1) {
                        room.send("❌ 수량을 제대로 입력해주세요.");
                        return;
                    }
                    if (name == "네메아의 사자" && !targetUser.hasItem("네메아의 사자")) {
                        room.send("❌ 네메아의 사자를 보유하지 않은 유저에게 선물할 수 없습니다.");
                        return;
                    }
                    if (name == "코인") {
                        if (num > user.cash) {
                            room.send("❌ 선물할 코인이 보유한 코인보다 많습니다.\n보유 코인: 🪙" + numberWithCommas(user.cash.toString()));
                        } else {
                            user.cash -= num;
                            user.save();
                            targetUser.cash += num;
                            targetUser.save();
                            send("✅ " + target + "님에게 성공적으로 선물했습니다.\n[ 🪙 x" + num.toComma() + " ]");
                        }
                        return;
                    }
                    if (name == "보석") {
                        let gem = user.inventory.find(i => i.name == "💎") || { count: 0 };
                        if (num > gem.count) {
                            room.send("❌ 선물할 보석이 보유한 보석보다 많습니다.\n보유 보석: 💎" + numberWithCommas(gem.count.toString()));
                        } else {
                            gem.count -= num;
                            user.save();
                            targetUser.giveItem({name:"💎",type:"재화",count:num});
                            targetUser.save();
                            send("✅ " + target + "님에게 성공적으로 선물했습니다.\n[ 💎 x" + num.toComma() + " ]");
                        }
                        return;
                    }
                    if (!gift || gift.type == "행운치") {
                        room.send("❌ 해당 아이템을 보유하고 있지 않습니다.");
                    } else if (gift.tier) {
                        room.send("❌ 장비는 선물할 수 없습니다.");
                    } else if (["별빛 각인"].includes(gift.name)) {
                        room.send("❌ 선물할 수 없습니다.");
                    } else if (gift.count < num) {
                        room.send("❌ 선물 수량이 부족합니다!\n보유 수량: " + gift.count.toComma() + "개");
                    } else if (gift.type == "아티팩트" && (gift.count - user.equips.artifact.filter(a => a == gift.name).length) < num) {
                        room.send("❌ 선물 수량이 부족합니다!\n선물 가능 수량: " + (gift.count - user.equips.artifact.filter(a => a == gift.name).length).toComma() + "개");
                    } else {
                        gift.count -= num;
                        if (targetUser.inventory.find(item => item.name == gift.name)) {
                            targetUser.inventory.find(item => item.name == gift.name).count += num;
                        } else {
                            targetUser.inventory.push({
                                name: gift.name,
                                count: num,
                                type: gift.type
                            });
                        }
                        user.save();
                        targetUser.save();
                        send("✅ " + target + "님에게 성공적으로 선물했습니다.\n[ " + gift.name + " x" + num.toComma() + " ]")
                    }
                }
            }

            else if (args[0] == "쿠폰") {
                if (args[1] == "되돌려받기") {
                    if (user.entered_coupon.includes("되돌려받기")) {
                        room.send("❌ 이미 입력한 쿠폰입니다.");
                    } else {
                        user.entered_coupon.push("되돌려받기");
                        let reset_reward = {
                            "D": [0, 0, 20000],
                            "C": [200, 50, 45000],
                            "B": [700, 350, 135000],
                            "A": [2700, 1850, 485000],
                            "S": [10200, 6850, 485000],
                            "S+": [35200, 23350, 485000],
                            "★": [85200, 48350, 485000]
                        };
                        let piece_result = [];
                        let total = [0, 0]
                        user.inventory.filter(item => item.tier && item.tier != "-" && item.tier != "E").forEach(equip => {
                            total[0] += reset_reward[equip.tier][0];
                            total[1] += reset_reward[equip.tier][2];
                            if (reset_reward[equip.tier][1] > 0) {
                                let piece = user.inventory.find(i => i.name == equip.name + "의 조각");
                                if (! piece) {
                                    user.inventory.push({
                                        name: equip.name + "의 조각",
                                        type: "재료",
                                        count: reset_reward[equip.tier][1]
                                    });
                                } else {
                                    piece.count += reset_reward[equip.tier][1];
                                }
                                piece_result.push("- " + equip.name + "의 조각 x" + reset_reward[equip.tier][1].toComma());
                            }
                        });
                        user.cash += total[1];
                        let upstone = user.inventory.find(i => i.name == "강화석");
                        if (! upstone) {
                            user.inventory.push({
                                name: "강화석",
                                type: "재료",
                                count: total[0]
                            });
                        } else {
                            upstone.count += total[0];
                        }
                        user.save();
                        send("🎉 쿠폰 입력 보상을 받았습니다!\n\n[ 보상 목록 ]\n- 🪙 x" + total[1].toComma() + "\n" + (total[0] > 0 ? "- 강화석 x" + total[0].toComma() + "\n" : "") + (piece_result.length > 0 ? piece_result.join("\n") : ""));
                    }
                    return;
                }
                let coupons = JSON.parse(read("DB/coupon.json"));
                let coupon = coupons.find(c => c.code == args[1]);
                if (!coupon) {
                    room.send("❌ 존재하지 않는 쿠폰입니다.");
                } else if (user.entered_coupon.includes(args[1])) {
                    room.send("❌ 이미 입력한 쿠폰입니다.");
                } else {
                    user.entered_coupon.push(args[1]);
                    let result = [];
                    coupon.reward.forEach(r => {
                        if (r.type == "코인") {
                            user.cash += r.count;
                            result.push("- 🪙 x" + r.count.toComma());
                        } else {
                            if (r.tier) {
                                let myItem = user.inventory.find(item => item.name == r.name);
                                if (myItem) {
                                    let tiers = ["E","D","C","B","A","S","S+","★"];
                                    if (tiers.indexOf(r.tier) > tiers.indexOf(myItem.tier)) {
                                        result.push("- " + r.name + " [" + myItem.tier + "] ▶ [" + r.tier + "]");
                                        myItem.tier = r.tier;
                                    } else {
                                        result.push("- " + r.name + "의 조각 x100");
                                        if (user.inventory.find(item => item.name == r.name + "의 조각")) {
                                            user.inventory.find(item => item.name == r.name + "의 조각").count += 100;
                                        } else {
                                            user.inventory.push({
                                                name: r.name + "의 조각",
                                                count: 100,
                                                type: "재료"
                                            });
                                        }
                                    }
                                } else {
                                    result.push("- [" + r.tier + "] " + r.name);
                                    user.inventory.push({
                                        name: r.name,
                                        count: 1,
                                        tier: r.tier,
                                        type: r.type
                                    });
                                }
                            } else {
                                result.push("- " + r.name + " x" + r.count.toComma());
                                if (user.inventory.find(item => item.name == r.name)) {
                                    user.inventory.find(item => item.name == r.name).count += r.count;
                                } else {
                                    user.inventory.push({
                                        name: r.name,
                                        count: r.count,
                                        type: r.type
                                    });
                                }
                            }
                        }
                    });
                    user.save();
                    send("🎉 쿠폰 입력 보상을 받았습니다!\n\n[ 보상 목록 ]\n" + result.join("\n"));
                }
            }

            else if (args[0] == "제작") {
                let target = cmd.substr(6);
                let num = 1;
                if (!isNaN(target.split(" ").pop())) {
                    let target_split = target.split(" ");
                    num = Number(target_split.pop());
                    target = target_split.join(" ");
                }
                let artifact = read("DB/artifacts/" + target + ".json") || JSON.parse(read("DB/craft.json")).find(c => c.craft.name == target);
                if (! artifact) {
                    room.send("❌ 제작 불가 아이템입니다.");
                } else {
                    if (typeof artifact == 'string') artifact = JSON.parse(artifact);
                    if (!artifact.material) {
                        room.send("❌ 제작 불가 아이템입니다.");
                        return;
                    }
                    let materials = [];
                    let canCraft = true;
                    artifact.material.forEach(m => {
                        let needCount = m.count * num;
                        let item = user.inventory.find(i => i.name == m.name) || { count: 0 };
                        let isEnough = true;
                        if (m.name == "코인") {
                            if (user.cash < needCount) {
                                isEnough = false;
                                canCraft = false;
                            }
                        } else if (item.count < needCount) {
                            isEnough = false;
                            canCraft = false;
                        }
                        materials.push((!isEnough ? "❌" : "✅") + " " + (m.name == "코인" ? "🪙" : m.name) + " " + (m.name == "코인" ? user.cash : item.count).toComma() + "/" + needCount.toComma());
                    });
                    if (canCraft) {
                        myCheck[senderID] = {
                            type: "제작",
                            arg: {
                                name: target,
                                material: artifact.material,
                                item: artifact.craft || {name:target,type:"아티팩트",count:1},
                                num: num
                            }
                        };
                        send(target + " x" + (myCheck[senderID].arg.item.count * num).toComma() + " 제작 재료:\n" + materials.join("\n") + "\n\n정말 제작하시겠습니까?\n[ $확인 ]");
                    } else {
                        send("❌ 제작 재료가 부족합니다!\n\n" + target + " x" + ((artifact.craft || {name:target,type:"아티팩트",count:1}).count * num).toComma() + " 제작 재료:\n" + materials.join("\n"));
                    }
                }
            }

            else if (args[0] == "분해") {
                let target = cmd.substr(6);
                let num = 1;
                let needTool = true;
                if (!isNaN(target.split(" ").pop())) {
                    let target_split = target.split(" ");
                    num = Number(target_split.pop());
                    target = target_split.join(" ");
                }
                if (target.endsWith("의 조각")) {
                    needTool = false;
                }
                if (needTool && (user.inventory.find(i => i.name == "분해 도구") || {count:0}).count < num) {
                    room.send("❌ 분해 도구가 부족합니다. (" + (user.inventory.find(i => i.name == "분해 도구") || {count:0}).count.toComma() + "/" + num.toComma() + ")");
                    return;
                }
                let artifact = read("DB/artifacts/" + target + ".json") || JSON.parse(read("DB/craft.json")).find(c => c.craft.name == target);
                if (! artifact) {
                    room.send("❌ 존재하지 않는 아이템입니다.");
                } else {
                    if (typeof artifact == 'string') artifact = JSON.parse(artifact);
                    if (!artifact.material) {
                        room.send("❌ 분해 불가 아이템입니다.");
                        return;
                    }
                    if (target == "별빛 각인") {
                        artifact.material = [
                            {
                                "name": "힘의 두루마리",
                                "count": 25
                            },
                            {
                                "name": "마법의 두루마리",
                                "count": 25
                            },
                            {
                                "name": "별의 파편",
                                "count": 250
                            },
                            {
                                "name": "강함의 조각",
                                "count": 1
                            },
                            {
                                "name": "코인",
                                "count": 5000000000
                            }
                        ];
                    }
                    if (target == "홍월의 샤드") {
                        artifact.material = [
                            {
                                "name": "달의 파편",
                                "type": "재료",
                                "count": 5
                            },
                            {
                                "name": "강함의 조각",
                                "type": "재료",
                                "count": 3
                            }
                        ]
                    }
                    if (target == "달의 파편") {
                        artifact.material = [
                            {
                                "name": "별의 파편",
                                "type": "재료",
                                "count": 50
                            }
                        ]
                    }

                    artifact.material.multiplyKey('count', num);
                    if (artifact.craft) artifact.craft.count *= num;

                    let item = user.inventory.find(i => i.name == target) || { count: 0 };
                    if (item.count < (artifact.craft || {name:target,type:"아티팩트",count:num}).count) {
                        room.send("❌ 분해할 아이템이 부족합니다.");
                        return;
                    }
                    if (user.equips.artifact.filter(a => a == item.name).length >= item.count) {
                        room.send("❌ 분해할 아이템이 부족합니다.");
                        return;
                    }
                    
                    let materials = [];
                    artifact.material.forEach(m => {
                        materials.push("- " + (m.name == "코인" ? "🪙" : m.name) + " x" + (m.count).toComma());
                    });
                    myCheck[senderID] = {
                        type: "분해",
                        arg: {
                            name: target,
                            material: artifact.material,
                            item: artifact.craft || {name:target,type:"아티팩트",count:num},
                            needTool: needTool,
                            num: num
                        }
                    };
                    send("반환될 재료:\n" + materials.join("\n") + "\n\n정말 분해하시겠습니까?\n[ $확인 ]");
                }
            }

            else if (args[0] == "재조합") {
                let target = cmd.substr(7);
                let artifacts = target.split(".");
                if (artifacts.length != 3) {
                    room.send("❌ 잘못된 입력입니다.\n[ $헌터 재조합 [아티팩트1].[아티팩트2].[아티팩트3] ]");
                } else {
                    let success = true;
                    let reArti = [];
                    for (let artifact of artifacts) {
                        if (!user.inventory.find(i => i.name == artifact && i.type == "아티팩트") || (user.inventory.find(i => i.name == artifact && i.type == "아티팩트").count - user.equips.artifact.filter(a => a == artifact).length) < 1) {
                            room.send("❌ 해당 아티팩트가 존재하지 않거나 보유하고 있지 않습니다: " + artifact);
                            success = false;
                            break;
                        }
                        if (reArti.find(a => a.name == artifact)) {
                            if ((user.inventory.find(i => i.name == artifact).count - user.equips.artifact.filter(a => a == artifact).length) <= reArti.find(a => a.name == artifact).count) {
                                room.send("❌ 아티팩트가 부족합니다: " + artifact);
                                success = false;
                                break;
                            }
                            reArti.find(a => a.name == artifact).count++;
                        } else {
                            reArti.push({
                                name: artifact,
                                count: 1
                            });
                        }
                    }
                    if (! success) return;
                    let artifactRarity = JSON.parse(read("DB/artifactRarity.json"));
                    let rarityPoint = 0;
                    let getArtifact = {
                        rarity: null,
                        name: null
                    };
                    for(let arti of reArti) {
                        if (artifactRarity.up.includes(arti.name)) rarityPoint += (50 * arti.count);
                        if (artifactRarity.special.includes(arti.name)) rarityPoint += (12 * arti.count);
                        if (artifactRarity.epic.includes(arti.name)) rarityPoint += (35 * arti.count);
                        if (artifactRarity.rare.includes(arti.name)) rarityPoint += (10 * arti.count);
                        if (artifactRarity.uncommon.includes(arti.name)) rarityPoint += (4 * arti.count);
                        user.inventory.find(i => i.name == arti.name).count -= arti.count;
                    }
                    let r = Math.random();
                    let probability = {};
                    let pb_total = 1;
                    probability.epic = Math.min(pb_total, (0.0005 + (0.001 * rarityPoint)));
                    pb_total -= probability.epic;

                    probability.rare = Math.min(pb_total, (0.0025 + (0.005 * rarityPoint)));
                    pb_total -= probability.rare;
                    probability.rare += probability.epic;

                    probability.uncommon = Math.min(pb_total, (0.05 + (0.025 * rarityPoint)));
                    pb_total -= probability.uncommon;
                    probability.uncommon += probability.rare;

                    probability.common = pb_total;

                    if (r < probability.epic) {
                        getArtifact.rarity = "🟪에픽";
                        getArtifact.name = artifactRarity.epic[Math.floor(Math.random() * artifactRarity.epic.length)];
                    } else if (r < probability.rare) {
                        getArtifact.rarity = "🟨레어";
                        getArtifact.name = artifactRarity.rare[Math.floor(Math.random() * artifactRarity.rare.length)];
                    } else if (r < probability.uncommon) {
                        getArtifact.rarity = "🟦희귀";
                        getArtifact.name = artifactRarity.uncommon[Math.floor(Math.random() * artifactRarity.uncommon.length)];
                    } else {
                        getArtifact.rarity = "⬜일반";
                        getArtifact.name = artifactRarity.common[Math.floor(Math.random() * artifactRarity.common.length)];
                    }
                    user.giveItem({
                        name: getArtifact.name,
                        type: "아티팩트",
                        count: 1
                    });

                    let bonus = [
                        {
                            name: "🪙",
                            type: "코인",
                            minCount: 10000000,
                            maxCount: 100000000
                        },
                        {
                            name: "별의 파편",
                            type: "재료",
                            minCount: 1,
                            maxCount: 5
                        },
                        {
                            name: "💎",
                            type: "재화",
                            minCount: 2,
                            maxCount: 10
                        },
                        {
                            name: "아티팩트 상자",
                            type: "소모품",
                            minCount: 1,
                            maxCount: 2
                        }
                    ]
                    let bonusItem = {
                        name: null,
                        count: null
                    };
                    let bonusR = Math.random();
                    if (bonusR < (0.02 + (0.02 * rarityPoint))) {
                        let myBonus = bonus[Math.floor(Math.random() * bonus.length)];
                        bonusItem.name = myBonus.name;
                        bonusItem.count = Math.floor(Math.random() * (myBonus.maxCount - myBonus.minCount + 1)) + myBonus.minCount;
                        if (myBonus.type == "코인") {
                            user.cash += bonusItem.count;
                        } else {
                            user.giveItem({
                                name: myBonus.name,
                                type: myBonus.type,
                                count: bonusItem.count
                            });
                        }
                    }
                    user.save();
                    send("✅ 아티팩트를 재조합했습니다!\n\n[ 획득한 아티팩트 ]\n[ " + getArtifact.rarity + " ] " + getArtifact.name + (bonusItem.name ? "\n🌟 보너스! " + bonusItem.name + " x" + bonusItem.count.toComma() : "") + "\n\n[ 적용된 확률 ]\n- 에픽 아티팩트 " + (Math.max(0, probability.epic) * 100).fix() + "%\n- 레어 아티팩트 " + (Math.max(0, (probability.rare - probability.epic)) * 100).fix() + "%\n- 희귀 아티팩트 " + (Math.max(0, (probability.uncommon - probability.rare)) * 100).fix() + "%\n- 일반 아티팩트 " + (Math.max(0, probability.common) * 100).fix() + "%\n\n- 보너스 확률: " + Math.min(100, (0.02 + (0.02 * rarityPoint)) * 100).fix() + "%");
                }
            }

            else if (args[0] == "강화") {
                let target = cmd.substr(6);
                let item;
                if (! (item = user.inventory.find(item => item.name == target))) {
                    room.send("❌ 해당 장비를 보유하고 있지 않습니다.");
                } else if (! item.tier) {
                    room.send("❌ 강화할 수 없는 아이템입니다.");
                } else {
                    if (item.tier == "★" || item.tier == "🌙") {
                        let upstone = user.inventory.find(item => item.name == "강화석") || { count: 0 };
                        if (upstone.count < 10000) {
                            room.send("❌ 강화석이 부족합니다. (" + upstone.count.toComma() + "/1만)");
                        } else {
                            myCheck[senderID] = {
                                type: "옵션",
                                arg: {
                                    item: item
                                }
                            }
                            if (! item.option) {
                                send("[ 장비 옵션 부여 ]\n\n강화석을 소모하여 장비에 랜덤 옵션을 2개 부여하시겠습니까?\n(" + upstone.count.toComma() + "/1만)\n\n[ $확인 ]");
                            } else {
                                send("[ 장비 옵션 부여 ]\n\n강화석을 소모하여 옵션을 변경하시겠습니까?\n(" + upstone.count.toComma() + "/1만)\n\n[ $확인 ]");
                            }
                        }
                        return;
                    }
                    
                    let needs = {
                        "E": [100, 100, 30000, 0],
                        "D": [300, 200, 75000, 0],
                        "C": [1000, 700, 160000, 0],
                        "B": [5500, 3500, 650000, 0],
                        "A": [17500, 15000, 10000000, 0],
                        "S": [125000, 83500, 100000000, 0],
                        "S+": [250000, 175000, 0, 1]
                    }

                    let ticket = "별의 증표"
                    if (item.evolution) {
                        for (var need in needs) {
                            needs[need][0] *= 100;
                            needs[need][2] *= 100;
                        }
                        ticket = "달의 증표";
                    }

                    let tiers = ["E","D","C","B","A","S","S+","★","🌙"];
                    let upstone = user.inventory.find(item => item.name == "강화석") || { count: 0 };
                    let piece = user.inventory.find(item => item.name == target + "의 조각") || { count: 0 };
                    let starTicket = user.inventory.find(item => item.name == ticket) || { count: 0 };
                    if (upstone.count < needs[item.tier][0] || piece.count < needs[item.tier][1] || user.cash < needs[item.tier][2] || starTicket.count < needs[item.tier][3]) {
                        send("❌ 강화 재료가 부족합니다!\n\n강화 재료:\n" + (upstone.count < needs[item.tier][0] ? "❌":"✅") + " 강화석 " + upstone.count.toComma() + "/" + needs[item.tier][0].toComma() + "\n" + (piece.count < needs[item.tier][1] ? "❌":"✅") + " " + target + "의 조각 " + piece.count.toComma() + "/" + needs[item.tier][1].toComma() + (needs[item.tier][3] ? "\n" + (starTicket.count < needs[item.tier][3] ? "❌":"✅") + " " + ticket + " " + starTicket.count.toComma() + "/" + needs[item.tier][3].toComma() : "") + (needs[item.tier][2] ? "\n" + (user.cash < needs[item.tier][2] ? "❌":"✅") + " 🪙 " + user.cash.toComma() + "/" + needs[item.tier][2].toComma() : ""));
                        return;
                    }
                    myCheck[senderID] = {
                        type: "강화",
                        arg: {
                            needs: needs,
                            tiers: tiers,
                            item: item,
                            ticket: ticket
                        }
                    }
                    send("강화 재료:\n✅ 강화석 " + upstone.count.toComma() + "/" + needs[item.tier][0].toComma() + "\n✅ " + target + "의 조각 " + piece.count.toComma() + "/" + needs[item.tier][1].toComma() + (needs[item.tier][3] ? "\n✅ " + ticket + " " + starTicket.count.toComma() + "/" + needs[item.tier][3].toComma() : "") + (needs[item.tier][2] ? "\n✅ 🪙 " + user.cash.toComma() + "/" + needs[item.tier][2].toComma() : "") + "\n\n정말 강화하시겠습니까?\n[ $확인 ]");
                }
            }

            else if (args[0] == "스탯") {
                if (args[1] == "강화") {
                    if (args[2] == "근력") {
                        let material = user.inventory.find(i => i.name == "힘의 두루마리") || { count: 0 };
                        if (material.count < Math.round(Math.pow(1.5, user.stat.str)) && user.inventory.find(i => i.name == "근력 강화 스크롤")) {
                            user.inventory.find(i => i.name == "근력 강화 스크롤").count--;
                            user.stat.str++;
                            user.save();
                            send("✅ 근력 강화 스크롤을 이용해 근력 스탯을 +1 강화했습니다!\n현재 근력 수치: " + user.stat.str);
                        } else if (material.count < Math.round(Math.pow(1.5, user.stat.str))) {
                            room.send("❌ 힘의 두루마리가 부족합니다.\n힘의 두루마리: " + material.count.toComma() + "/" + Math.round(Math.pow(1.5, user.stat.str)).toComma());
                        } else {
                            material.count -= Math.round(Math.pow(1.5, user.stat.str));
                            user.stat.str++;
                            user.save();
                            send("✅ 근력 스탯을 +1 강화했습니다!\n현재 근력 수치: " + user.stat.str);
                        }
                    } else if (args[2] == "마력") {
                        let material = user.inventory.find(i => i.name == "마법의 두루마리") || { count: 0 };
                        if (material.count < Math.round(Math.pow(1.5, user.stat.str)) && user.inventory.find(i => i.name == "마력 강화 스크롤")) {
                            user.inventory.find(i => i.name == "마력 강화 스크롤").count--;
                            user.stat.int++;
                            user.save();
                            send("✅ 마력 강화 스크롤을 이용해 마력 스탯을 +1 강화했습니다!\n현재 근력 수치: " + user.stat.int);
                        } else if (material.count < Math.round(Math.pow(1.5, user.stat.int))) {
                            room.send("❌ 마법의 두루마리가 부족합니다.\n마법의 두루마리: " + material.count.toComma() + "/" + Math.round(Math.pow(1.5, user.stat.int)).toComma());
                        } else {
                            material.count -= Math.round(Math.pow(1.5, user.stat.int));
                            user.stat.int++;
                            user.save();
                            send("✅ 마력 스탯을 +1 강화했습니다!\n현재 마력 수치: " + user.stat.int);
                        }
                    } else if (args[2] == "체력") {
                        let material = user.inventory.find(i => i.name == "보호의 두루마리") || { count: 0 };
                        if (material.count < Math.round(Math.pow(1.5, user.stat.str)) && user.inventory.find(i => i.name == "체력 강화 스크롤")) {
                            user.inventory.find(i => i.name == "체력 강화 스크롤").count--;
                            user.stat.def++;
                            user.save();
                            send("✅ 체력 강화 스크롤을 이용해 보호 스탯을 +1 강화했습니다!\n현재 체력 수치: " + user.stat.def);
                        } else if (material.count < Math.round(Math.pow(1.5, user.stat.def))) {
                            room.send("❌ 보호의 두루마리가 부족합니다.\n보호의 두루마리: " + material.count.toComma() + "/" + Math.round(Math.pow(1.5, user.stat.def)).toComma());
                        } else {
                            material.count -= Math.round(Math.pow(1.5, user.stat.def));
                            user.stat.def++;
                            user.save();
                            send("✅ 체력 스탯을 +1 강화했습니다!\n현재 체력 수치: " + user.stat.def);
                        }
                    }
                } else {
                    let res = [];
                    let userInt = user.stat.int;
                    let userDef = user.stat.def;
                    if (user.equips.artifact.includes("증폭의 구슬") && user.stat.int >= 10) userInt = Math.round(userInt * 1.5);
                    if (user.equips.artifact.includes("탐욕의 구슬") && user.stat.def >= 10) userDef = Math.round(userDef * 1.5);
                    res.push("- 근력: " + user.stat.str + " (물리 피해 +" + (1.5 * user.stat.str).fix() + "%)");
                    res.push("- 마력: " + user.stat.int + (user.equips.artifact.includes("증폭의 구슬") && user.stat.int >= 10 ? "(+" + Math.round(user.stat.int * 0.5) + ")" : "") + " (마법 피해 +" + (1.5 * userInt).fix() + "%)");
                    res.push("- 체력: " + user.stat.def + (user.equips.artifact.includes("탐욕의 구슬") && user.stat.def >= 10 ? "(+" + Math.round(user.stat.def * 0.5) + ")" : "") + " (최대 체력 +" + (1.5 * userDef).fix() + "%)");
                    send("[ " + username + "님의 스탯 수치 ]\n\n" + res.join("\n"));
                }
            }
            
            else if (args[0] == "고급") {
                if (args[1] == "마법부여") {
                let target = cmd.substr(11);
                let item;
                if (! (item = user.inventory.find(item => item.name == target))) {
                    room.send("❌ 해당 장비를 보유하고 있지 않습니다.");
                } else if (! item.tier) {
                    room.send("❌ 마법을 부여할 수 없는 아이템입니다.");
                } else {
                    let enchantScroll = user.inventory.find(i => i.name == "고급 마법 부여 스크롤") || {count:0};
                    if (enchantScroll.count < 1) {
                        send("❌ 고급 마법 부여 스크롤이 필요합니다!");
                    } else {
                        enchantScroll.count--;
                        let enchantments = [];
                        if (item.type == "갑옷") enchantments = ["견고", "가시", "파동", "관통 불가"];
                        else enchantments = ["강타", "날렵함", "둔화", "집전", "집중", "치유", "카르마", "폭풍", "필멸", "화염 낙인", "보호막 파괴"];
                        item.enchant = [];
                        let n = 4;
                        for(let i = 0; i < n; i++) {
                            let enchant = {
                                name: enchantments[Math.floor(Math.random() * enchantments.length)]
                            };
                            enchant.level = JSON.parse(read("DB/enchantments/" + enchant.name + ".json")).maxLv;
                            enchantments.remove(enchant.name);
                            item.enchant.push(enchant);
                        }
                        if (user.equips.weapon.name == item.name) {
                            user.equips.weapon.enchant = item.enchant;
                        } else if (user.equips.armor.name == item.name) {
                            user.equips.armor.enchant = item.enchant;
                        }
                        user.save();
                        send("┌── 🪯 마법 부여 🪯 ──┐\n   ⍟ " + item.name + "\n" + item.enchant.map(e => "   💠 " + e.name + " " + e.level.toRoman()).join("\n"));
                    }
                }
            }
            }

            else if (args[0] == "마법부여") {
                let target = cmd.substr(8);
                let item;
                if (! (item = user.inventory.find(item => item.name == target))) {
                    room.send("❌ 해당 장비를 보유하고 있지 않습니다.");
                } else if (! item.tier) {
                    room.send("❌ 마법을 부여할 수 없는 아이템입니다.");
                } else {
                    let enchantScroll = user.inventory.find(i => i.name == item.type + " 마법 부여 스크롤") || {count:0};
                    if (enchantScroll.count < 1) {
                        send("❌ " + item.type + " 마법 부여 스크롤이 필요합니다!");
                    } else {
                        enchantScroll.count--;
                        let enchantments = [];
                        if (item.type == "갑옷") enchantments = ["견고", "가시", "파동", "관통 불가"];
                        else enchantments = ["강타", "날렵함", "둔화", "집전", "집중", "치유", "카르마", "폭풍", "필멸", "화염 낙인", "보호막 파괴"];
                        item.enchant = [];
                        let n = Math.floor(Math.random() * 3) + 1;
                        for(let i = 0; i < n; i++) {
                            let enchant = {
                                name: enchantments[Math.floor(Math.random() * enchantments.length)]
                            };
                            enchant.level = Math.floor(Math.random() * JSON.parse(read("DB/enchantments/" + enchant.name + ".json")).maxLv) + 1;
                            enchantments.remove(enchant.name);
                            item.enchant.push(enchant);
                        }
                        if (user.equips.weapon.name == item.name) {
                            user.equips.weapon.enchant = item.enchant;
                        } else if (user.equips.armor.name == item.name) {
                            user.equips.armor.enchant = item.enchant;
                        }
                        user.save();
                        send("┌── 🪯 마법 부여 🪯 ──┐\n   ⍟ " + item.name + "\n" + item.enchant.map(e => "   💠 " + e.name + " " + e.level.toRoman()).join("\n"));
                    }
                }
            }

            else if (args[0] == "초기화") {
                let target = cmd.substr(7);
                if ((user.inventory.find(item => item.tier && item.name == target) || {count:0}).count < 1) {
                    room.send("❌ 해당 장비가 존재하지 않거나 보유하고 있지 않습니다.");
                } else {
                    let item = user.inventory.find(item => item.name == target);
                    let reset_reward = {
                        "-": [0, 0, 0, 0],
                        "E": [0, 0, 0, 0],
                        "D": [100, 100, 30000, 0],
                        "C": [400, 300, 105000, 0],
                        "B": [1400, 1000, 265000, 0],
                        "A": [6900, 4500, 915000, 0],
                        "S": [24400, 19500, 10915000, 0],
                        "S+": [149400, 103000, 110915000, 0],
                        "★": [399400, 278000, 110915000, 1],
                        "🌙": [399400, 278000, 110915000, 1]
                    };
                    if (item.evolution) {
                        for (var need in reset_reward) {
                            reset_reward[need][0] *= 100;
                            reset_reward[need][2] *= 100;
                        }
                    }
                    let upstone = reset_reward[item.tier][0];
                    let piece = reset_reward[item.tier][1];
                    let coin = reset_reward[item.tier][2];
                    let starTicket = reset_reward[item.tier][3];
                    let ticket = "별의 증표";
                    if (item.tier == "🌙") {
                        ticket = "달의 증표";
                    }
                    if (upstone == 0) {
                        send("❌ 이 장비는 강화되지 않아 초기화할 수 없습니다.");
                    } else {
                        myCheck[senderID] = {
                            type: "초기화",
                            arg: {
                                item: item.name,
                                upstone: upstone,
                                piece: piece,
                                coin: coin,
                                star: starTicket,
                                ticket: ticket
                            }
                        }
                        send("반환될 재료:\n- 강화석 x" + upstone.toComma() + "\n- " + item.name + "의 조각 x" + piece.toComma() + (starTicket == 1 ? "\n- " + ticket + " x" + starTicket : "") + "\n- 🪙 " + coin.toComma() + "\n\n정말 초기화하시겠습니까?\n[ $확인 ]");
                    }
                }
            }

            else if (args[0] == "장착") {
                let target = cmd.substr(6);
                if (! user.inventory.find(item => item.name == target)) {
                    room.send("❌ 해당 장비를 보유하고 있지 않습니다.");
                } else {
                    let item = user.inventory.find(item => item.name == target);
                    if (item.count == 0) {
                        room.send("❌ 해당 장비를 보유하고 있지 않습니다.");
                        return;
                    }
                    if (item.type == "무기") {
                        user.equips.weapon = item;
                    } else if (item.type == "갑옷") {
                        user.equips.armor = item;
                    } else if (item.type == "아티팩트") {
                        let MAX_ARTIFACT = Math.min(2 + user.artifactMaxSlot, (user.equips.artifact.filter(a => a.includes("아르카나")).length) + (target.includes("아르카나") ? 1 : 0) + user.artifactMaxSlot);
                        if (user.equips.artifact.length >= MAX_ARTIFACT) {
                            room.send("❌ 더 이상 아티팩트를 장착할 수 없습니다!\n>> $헌터 장착해제 [장비]");
                            return;
                        } else if (user.equips.artifact.filter(a => a == item.name).length >= item.count) {
                            room.send("❌ 아티팩트가 부족합니다!");
                            return;
                        } else if (user.equips.artifact.includes(target)) {
                            room.send("❌ 이미 장착한 아티팩트입니다!");
                            return;
                        } else if (JSON.parse(read("DB/rareArtifacts.json")).find(ra => ra.cannot.includes(target)) && user.equips.artifact.find(a => JSON.parse(read("DB/rareArtifacts.json")).find(ra => ra.cannot.includes(target)).cannot.includes(a))) {
                            room.send("❌ 같은 종류의 아티팩트를 장착할 수 없습니다!");
                            return;
                        } else {
                            user.equips.artifact.push(target);
                        }
                    } else {
                        room.send("❌ 장착할 수 없는 아이템입니다!");
                        return;
                    }
                    user.save();
                    send("❇️ " + (item.tier ? "[" + item.tier + "] " : "") + target + (dec_han(target.substr(-1)).length == 3 ? "을" : "를") + " 장착했습니다.");
                }
            }

            else if (args[0] == "장착해제") {
                let target = cmd.substr(8);
                let tier = null;
                if (user.equips.weapon.name == target) {
                    tier = user.equips.weapon.tier;
                    user.equips.weapon.name = "맨손";
                    user.equips.weapon.tier = "-";
                } else if (user.equips.armor.name == target) {
                    tier = user.equips.armor.tier;
                    user.equips.armor.name = "평상복";
                    user.equips.armor.tier = "-";
                } else if (user.equips.artifact.includes(target)) {
                    user.equips.artifact.remove(target);
                } else {
                    room.send("❌ 해당 장비를 장착하고 있지 않습니다.");
                    return;
                }
                user.save();
                send("❇️ " + (tier ? "[" + tier + "] " : "") + target + (dec_han(target.substr(-1)).length == 3 ? "을" : "를") + " 장착 해제했습니다.");
            }

            else if (args[0] == "취소") {
                let cancelParty = huntParty[room.id][cmd.substr(6)];
                if (cancelParty) {
                    if (cancelParty.host.id == user.id) {
                        delete huntParty[room.id][cmd.substr(6)];
                        room.send("✅ 파티 모집이 취소되었습니다.");
                    }
                }
            }

            else if (args[0] == "사냥") {
                if (user.state && user.state.hp != user.state.maxHp) {
                    user.state.hp = Math.min((new Date() - new Date(user.state.last)) / 10000, user.state.maxHp);
                    user.state.last = new Date().toString();
                    user.save();
                }
                if (user.state && user.state.hp < user.state.maxHp) {
                    room.send("❌ 체력이 모두 충전되어야 합니다.\n현재 체력: " + user.state.hp.fix(1) + "/100");
                    return;
                }
                if (!huntParty[room.id]) huntParty[room.id] = {};
                if (huntParty[room.id][cmd.substr(6)]) {
                    if (huntParty[room.id][cmd.substr(6)].host.id == user.id) {
                        myCheck[senderID] = {
                            type: "사냥",
                            arg: huntParty[room.id][cmd.substr(6)]
                        };
                        
                        send("파티원 (" + huntParty[room.id][cmd.substr(6)].player.length + "/" + (huntParty[room.id][cmd.substr(6)].dungeon == "시련의 회당" ? 1 : 3) + ")\n- " + huntParty[room.id][cmd.substr(6)].player.map(p => p.name).join("\n- ") + "\n\n목표지: " + huntParty[room.id][cmd.substr(6)].dungeon + "\n\n이대로 출정하시겠습니까?\n[ $확인 ]");
                    } else {
                        if (huntParty[room.id][cmd.substr(6)].player.find(p => p.id == user.id)) {
                            huntParty[room.id][cmd.substr(6)].player.splice(huntParty[room.id][cmd.substr(6)].player.findIndex(p => p.id == user.id), 1);
                            room.send("✅ 파티에서 퇴장했습니다.");
                        } else if (huntParty[room.id][cmd.substr(6)].player.length >= (huntParty[room.id][cmd.substr(6)].dungeon == "시련의 회당" ? 1 : 3)) {
                            room.send("❌ 현재 사냥 파티가 가득 찼습니다.");
                        } else {
                            huntParty[room.id][cmd.substr(6)].player.push({
                                name: username,
                                id: user.id,
                                alive: true
                            });
                            send("✅ " + username + "님이 " + huntParty[room.id][cmd.substr(6)].host.name + "님의 사냥 파티에 가입했습니다.\n\n목표지: " + huntParty[room.id][cmd.substr(6)].dungeon);
                        }
                    }
                } else {
                    let dungeon = cmd.substr(6);
                    let maps = JSON.parse(read("DB/maps.json"));
                    maps.splice(maps.findIndex(m => m.name == "훈련장"), 1);
                    if (! dungeon) {
                        room.send("❌ 탐험할 던전을 입력해주세요.\n\n[ 탐험 가능 던전 ]\n- " + maps.map(m => m.name).join("\n- "));
                        return;
                    }
                    if (!maps.find(m => m.name == dungeon)) {
                        room.send("❌ 해당 던전은 존재하지 않습니다.\n\n[ 탐험 가능 던전 ]\n- " + maps.map(m => m.name).join("\n- "));
                    } else if (dungeon == "시련의 회당" && (user.inventory.find(i => i.name == "시련의 회당 티켓") || {count:0}).count < 1) {
                        room.send("❌ 시련의 회당 티켓을 보유해야 합니다.");
                    } else if (dungeon == "루나리 왕성 남쪽" && !(read("DB/userQuest/" + user.id + ".json") && JSON.parse(read("DB/userQuest/" + user.id + ".json")).find(q => q.name == "루나리 왕국 쿠데타 저지하기"))) {
                        room.send("❌ 퀘스트 지역입니다.");
                    } else if (dungeon == "루나리 왕성 남쪽" && user.inventory.find(i => i.name == "루나리 왕국의 문장") && user.inventory.find(i => i.name == "루나리 왕국의 문장").count > 0) {
                        room.send("❌ 이미 기사단장을 쓰러뜨렸습니다.");
                    } else {
                        huntParty[room.id][cmd.substr(6)] = {
                            host: {
                                id: user.id,
                                name: username
                            },
                            player: [
                                {
                                    name: username,
                                    id: user.id,
                                    alive: true
                                }
                            ],
                            dungeon: dungeon
                        };
                        send("✅ " + username + "님이 " + dungeon + (dec_han(dungeon.substr(-1)).length == 3 && !dec_han(dungeon.substr(-1))[2] != "ㄹ" ? "으로" : "로") + " 탐험을 떠날 사냥 파티를 모집합니다.\n\n>> 출정하려면 명령어를 다시 입력하세요.");
                    }
                }
            }

            else if (args[0] == "솔플") {
                if (user.playing.hunt) {
                    room.send((user.playing.hunt.choose ? "❌ 이미 몬스터와 조우했습니다." : "❌ 몬스터를 사냥하러 탐험중입니다."));
                    return;
                }
                if (user.state && user.state.hp != user.state.maxHp) {
                    user.state.hp = Math.min((new Date() - new Date(user.state.last)) / 10000, user.state.maxHp);
                    user.state.last = new Date().toString();
                    user.save();
                }
                if (user.state && user.state.hp < user.state.maxHp) {
                    room.send("❌ 체력이 모두 충전되어야 합니다.\n현재 체력: " + user.state.hp.fix(1) + "/100");
                    return;
                }
                let dungeon = cmd.substr(6);
                let maps = JSON.parse(read("DB/maps.json"));
                maps.splice(maps.findIndex(m => m.name == "루나리 왕성 남쪽"), 1);
                if (! dungeon) {
                    room.send("❌ 탐험할 던전을 입력해주세요.\n\n[ 탐험 가능 던전 ]\n- " + maps.map(m => m.name).join("\n- "));
                    return;
                }
                if (!maps.find(m => m.name == dungeon)) {
                    room.send("❌ 해당 던전은 존재하지 않습니다.\n\n[ 탐험 가능 던전 ]\n- " + maps.map(m => m.name).join("\n- "));
                    return;
                }
                if (dungeon == "시련의 회당") {
                    room.send("❌ 시련의 회당은 솔플로 진행할 수 없습니다.");
                    return;
                }
                if (dungeon == "훈련장") {
                    send("✅ 강함을 테스트하기 위해 훈련장으로 이동합니다.");
                } else {
                    send("🗺️ 몬스터를 사냥하러 탐험을 떠납니다.");
                }
                dungeon = maps.find(m => m.name == dungeon);
                let monsters = JSON.parse(read("DB/monster.json"));
                monsters = monsters.filter(m => dungeon.monsters.includes(m.name) || dungeon.boss.includes(m.name));
                let selectMob = cmd.substr(6);
                let mob = null;
                if (selectMob && monsters.find(m => m.name == selectMob)) {
                    mob = monsters.find(m => m.name == selectMob);
                } else {
                    mob = monsters[Math.floor(Math.random() * monsters.length)];
                }
                if (mob.name == "훈련용 인형" && user.inventory.find(i => i.name == "강함의 증명")) {
                    mob.reward.others = [];
                }
                user.playing.hunt = {
                    monster: mob,
                    map: dungeon.name
                }
                user.playing.hunt.monster.name = (mob.title ? "[" + mob.title + "] " : "") + mob.name;
                user.save();
                let time = Math.floor(Math.random() * 20001) + 5000;
                if (cmd.substr(6) == "훈련장") time = 1000;
                setTimeout(async function() {
                    let newUser = await getUserById(senderID);
                    let monster = newUser.playing.hunt.monster;
                    let monster_stat = [
                        "💚 체력 " + monster.stat.hp.toComma(),
                        "🎯 명중 " + (monster.stat.hit * 100).fix(2) + "%",
                        "⚔️ 반격 " + (monster.stat.cnt * 100).fix(2) + "%",
                        "✨ 연격 " + (monster.stat.cmb * 100).fix(2) + "%",
                        "💥 일격 " + (monster.stat.crt * 100).fix(2) + "%",
                        "🗡️ 관통 " + (monster.stat.pnt * 100).fix(2) + "%",
                        "🩸 출혈 " + (monster.stat.bld * 100).fix(2) + "%",
                        "🔥 화상 " + (monster.stat.brn * 100).fix(2) + "%",
                        "🌀 기절 " + (monster.stat.stn * 100).fix(2) + "%",
                        "💔 중독 " + (monster.stat.poi * 100).fix(2) + "%",
                        "☠️ 즉사 " + (monster.stat.dth * 100).fix(2) + "%",
                        "🛡️ 방어 " + (monster.stat.def * 100).fix(2) + "%",
                        "🔰 저항 " + (monster.stat.res * 100).fix(2) + "%",
                        "💨 회피 " + (monster.stat.avd * 100).fix(2) + "%"
                    ];
                    let monster_rewards = ["- 🪙 " + monster.reward.minCoin.toComma() + " ~ " + monster.reward.maxCoin.toComma()];
                    monster.reward.others.forEach(reward => {
                        monster_rewards.push("- " + reward.name + " x" + reward.minCount.toComma() + (reward.minCount == reward.maxCount ? "" : " ~ " + reward.maxCount.toComma()) + " (" + (reward.percent * 100).fix(3) + "%)")
                    });
                    newUser.playing.hunt.choose = true;
                    newUser.save();
                    send("❗ " + username + "님이 몬스터와 조우했습니다!\n[ $사냥 ] [ $도망 ]\n\n《 " + user.playing.hunt.monster.name + " 》" + VIEWMORE + "\n\n" + monster_stat.join("\n") + "\n\n- " + monster.special.join("\n- ") + "\n\n< 보상 >\n" + monster_rewards.join("\n"));
                }, time);
            }

            else if (args[0] == "결투") {
                if (read("DB/initHunterRate.txt") == "false") {
                    room.send("❌ 현재 결투가 불가능합니다.");
                    return;
                } else if (user.name == "오픈채팅봇") {
                    room.send("❌ 일시적으로 결투가 금지된 유저입니다.\n나중에 다시 시도해주세요.");
                    return;
                }
                if (colosseum[room.id]) {
                    if (colosseum[room.id].start) {
                        send("❌ 이미 콜로세움에서 헌터들의 결투가 진행되고 있습니다.\n\n" + colosseum[room.id].h1.name + " VS " + colosseum[room.id].h2.name);
                    } else if (colosseum[room.id].h1.id == senderID) {
                        send("❌ 이미 콜로세움에 입장한 상태입니다.");
                    } else {
                        colosseum[room.id].start = true;
                        colosseum[room.id].turn = 0;
                        colosseum[room.id].h2 = {
                            id: senderID,
                            name: username,
                            weapon: user.equips.weapon,
                            armor: user.equips.armor,
                            artifact: user.equips.artifact,
                            pet: user.pet,
                            stat: user.getStat()
                        };
                        let weapon_h1 = JSON.parse(read("DB/weapons/" + colosseum[room.id].h1.weapon.name + ".json"));
                        let armor_h1 = JSON.parse(read("DB/armors/" + colosseum[room.id].h1.armor.name + ".json"));
                        let weapon_h2 = JSON.parse(read("DB/weapons/" + user.equips.weapon.name + ".json"));
                        let armor_h2 = JSON.parse(read("DB/armors/" + user.equips.armor.name + ".json"));
                        colosseum[room.id].tempObj = {
                            name: {
                                h1: colosseum[room.id].h1.name,
                                h2: username
                            },
                            id: {
                                h1: colosseum[room.id].h1.id,
                                h2: colosseum[room.id].h2.id
                            },
                            stat: {
                                h1: {
                                    hit: 0.7 + weapon_h1[colosseum[room.id].h1.weapon.tier].plusStat.hit,
                                    cnt: 0.05 + weapon_h1[colosseum[room.id].h1.weapon.tier].plusStat.cnt,
                                    cmb: 0.05 + weapon_h1[colosseum[room.id].h1.weapon.tier].plusStat.cmb,
                                    crt: 0.05 + weapon_h1[colosseum[room.id].h1.weapon.tier].plusStat.crt,
                                    pnt: 0.05 + weapon_h1[colosseum[room.id].h1.weapon.tier].plusStat.pnt,
                                    bld: 0.1 + weapon_h1[colosseum[room.id].h1.weapon.tier].plusStat.bld,
                                    brn: 0 + weapon_h1[colosseum[room.id].h1.weapon.tier].plusStat.brn,
                                    stn: 0 + weapon_h1[colosseum[room.id].h1.weapon.tier].plusStat.stn,
                                    poi: 0 + weapon_h1[colosseum[room.id].h1.weapon.tier].plusStat.poi,
                                    dth: 0.001 + weapon_h1[colosseum[room.id].h1.weapon.tier].plusStat.dth,
                                    hp: Math.round((1000 + armor_h1[colosseum[room.id].h1.armor.tier].plusStat.hp) * (1 + (0.015 * colosseum[room.id].h1.stat.def))),
                                    maxHp: Math.round((1000 + armor_h1[colosseum[room.id].h1.armor.tier].plusStat.hp) * (1 + (0.015 * colosseum[room.id].h1.stat.def))),
                                    shield: 0,
                                    def: 0.1 + armor_h1[colosseum[room.id].h1.armor.tier].plusStat.def,
                                    res: 0.1 + armor_h1[colosseum[room.id].h1.armor.tier].plusStat.res,
                                    avd: 0.05 + armor_h1[colosseum[room.id].h1.armor.tier].plusStat.avd,
                                    str: colosseum[room.id].h1.stat.str,
                                    int: colosseum[room.id].h1.stat.int,
                                    de2: colosseum[room.id].h1.stat.def
                                },
                                h2: {
                                    hit: 0.7 + weapon_h2[colosseum[room.id].h2.weapon.tier].plusStat.hit,
                                    cnt: 0.05 + weapon_h2[colosseum[room.id].h2.weapon.tier].plusStat.cnt,
                                    cmb: 0.05 + weapon_h2[colosseum[room.id].h2.weapon.tier].plusStat.cmb,
                                    crt: 0.05 + weapon_h2[colosseum[room.id].h2.weapon.tier].plusStat.crt,
                                    pnt: 0.05 + weapon_h2[colosseum[room.id].h2.weapon.tier].plusStat.pnt,
                                    bld: 0.1 + weapon_h2[colosseum[room.id].h2.weapon.tier].plusStat.bld,
                                    brn: 0 + weapon_h2[colosseum[room.id].h2.weapon.tier].plusStat.brn,
                                    stn: 0 + weapon_h2[colosseum[room.id].h2.weapon.tier].plusStat.stn,
                                    poi: 0 + weapon_h2[colosseum[room.id].h2.weapon.tier].plusStat.poi,
                                    dth: 0.001 + weapon_h2[colosseum[room.id].h2.weapon.tier].plusStat.dth,
                                    hp: Math.round((1000 + armor_h2[colosseum[room.id].h2.armor.tier].plusStat.hp) * (1 + (0.015 * colosseum[room.id].h2.stat.def))),
                                    maxHp: Math.round((1000 + armor_h2[colosseum[room.id].h2.armor.tier].plusStat.hp) * (1 + (0.015 * colosseum[room.id].h2.stat.def))),
                                    shield: 0,
                                    def: 0.1 + armor_h2[colosseum[room.id].h2.armor.tier].plusStat.def,
                                    res: 0.1 + armor_h2[colosseum[room.id].h2.armor.tier].plusStat.res,
                                    avd: 0.05 + armor_h2[colosseum[room.id].h2.armor.tier].plusStat.avd,
                                    str: colosseum[room.id].h2.stat.str,
                                    int: colosseum[room.id].h2.stat.int,
                                    de2: colosseum[room.id].h2.stat.def
                                },
                            },
                            effect: {
                                h1: {},
                                h2: {}
                            },
                            stack: {
                                h1: {},
                                h2: {}
                            },
                            weapon: {
                                h1: {
                                    name: colosseum[room.id].h1.weapon.name,
                                    tier: ['E','D','C','B','A','S','S+','★','🌙'].indexOf(colosseum[room.id].h1.weapon.tier),
                                    option: colosseum[room.id].h1.weapon.option || []
                                },
                                h2: {
                                    name: colosseum[room.id].h2.weapon.name,
                                    tier: ['E','D','C','B','A','S','S+','★','🌙'].indexOf(colosseum[room.id].h2.weapon.tier),
                                    option: colosseum[room.id].h2.weapon.option || []
                                },
                            },
                            armor: {
                                h1: {
                                    name: colosseum[room.id].h1.armor.name,
                                    tier: ['E','D','C','B','A','S','S+','★','🌙'].indexOf(colosseum[room.id].h1.armor.tier),
                                    option: colosseum[room.id].h1.armor.option || []
                                },
                                h2: {
                                    name: colosseum[room.id].h2.armor.name,
                                    tier: ['E','D','C','B','A','S','S+','★','🌙'].indexOf(colosseum[room.id].h2.armor.tier),
                                    option: colosseum[room.id].h2.armor.option || []
                                },
                            },
                            artifact: {
                                h1: colosseum[room.id].h1.artifact,
                                h2: colosseum[room.id].h2.artifact
                            },
                            pet: {
                                h1: {
                                    name: colosseum[room.id].h1.pet.name,
                                    level: colosseum[room.id].h1.pet.level,
                                    damage: colosseum[room.id].h1.pet.damage
                                },
                                h2: {
                                    name: colosseum[room.id].h2.pet.name,
                                    level: colosseum[room.id].h2.pet.level,
                                    damage: colosseum[room.id].h2.pet.damage
                                }
                            },
                            logs: []
                        }
                        let artifactPS = JSON.parse(read("DB/artifactPlusStat.json"));
                        colosseum[room.id].tempObj.artifact.h1.forEach(arti => {
                            let artifact = artifactPS.find(a => a.name == arti);
                            if (artifact) {
                                for(let ps in artifact.plusStat) {
                                    if (ps == 'hp' || ps == 'maxHp' || ps == 'shield') colosseum[room.id].tempObj.stat.h1[ps] += artifact.plusStat[ps];
                                    else colosseum[room.id].tempObj.stat.h1[ps] = Math.min(1, colosseum[room.id].tempObj.stat.h1[ps] + artifact.plusStat[ps]);
                                }
                            }
                        });
                        colosseum[room.id].tempObj.artifact.h2.forEach(arti => {
                            let artifact = artifactPS.find(a => a.name == arti);
                            if (artifact) {
                                for(let ps in artifact.plusStat) {
                                    if (ps == 'hp' || ps == 'maxHp' || ps == 'shield') colosseum[room.id].tempObj.stat.h2[ps] += artifact.plusStat[ps];
                                    else colosseum[room.id].tempObj.stat.h2[ps] = Math.min(1, colosseum[room.id].tempObj.stat.h2[ps] + artifact.plusStat[ps]);
                                }
                            }
                        });
                        send("⚔️ " + username + "님이 " + colosseum[room.id].h1.name + "님에게 결투를 신청했습니다!\n콜로세움에서 헌터들의 결투가 시작됩니다.\n\n[ $결투 진행 ]");
                    }
                } else {
                    colosseum[room.id] = {};
                    colosseum[room.id].h1 = {
                        id: senderID,
                        name: username,
                        weapon: user.equips.weapon,
                        armor: user.equips.armor,
                        artifact: user.equips.artifact,
                        pet: user.pet,
                        stat: user.getStat()
                    };
                    send("✅ " + username + "님이 콜로세움에 입장하여 결투 상대를 기다리고 있습니다.\n\n[ " + username + "님의 무기 ]\n[" + user.equips.weapon.tier + "] " + user.equips.weapon.name + "\n[ " + username + "님의 갑옷 ]\n[" + user.equips.armor.tier + "] " + user.equips.armor.name + "\n\n>> 콜로세움에서 퇴장하기: [ $결투 퇴장 ]");
                }
            }

            else if (args[0] == "도전") {
                if (read("DB/initHunterRate.txt") == "false") {
                    room.send("❌ 현재 결투가 불가능합니다.");
                    return;
                }
                if (! args[1]) {
                    room.send("❌ 결투 상대를 입력해주세요.");
                    return;
                }
                let target = await getUserByName(args[1]);
                if (! target) {
                    room.send("❌ 유저를 찾을 수 없습니다.");
                } else if (!target.inventory || !target.hunterRate || !target.equips || target.entered_coupon.length == 0) {
                    room.send("❌ 헌터에게만 도전할 수 있습니다.");
                } else if (target.id == user.id) {
                    room.send("❌ 자기 자신에게는 도전할 수 없습니다.");
                } else if ((user.hunterRate - target.hunterRate) > 100) {
                    room.send("❌ 점수가 너무 낮은 대상에게 도전할 수 없습니다.");
                } else if (user.lastHunterRate && ((new Date()) - (new Date(user.lastHunterRate))) < 60000) {
                    room.send("❌ 도전은 1분마다 가능합니다.\n도전 가능까지 " + toTimeNotation(60 - Math.round(((new Date()) - (new Date(user.lastHunterRate))) / 1000)) + " 남았습니다.");
                } else if (target.name == "루킴") {
                    room.send("❌ 도전할 수 없는 대상입니다.");
                } else if (target.name == "오픈채팅봇" || user.name == "오픈채팅봇") {
                    room.send("❌ 일시적으로 결투가 금지된 유저입니다.\n나중에 다시 시도해주세요.");
                } else if (toWait[target.id]) {
                    room.send("❌ 현재 해당 유저에게 도전 신청이 불가능합니다.\n잠시 후 다시 시도해주세요.");
                } else {
                    let runnable = new java.lang.Runnable({
                        run: async function() {
                            try {
                                user.lastHunterRate = new Date().toString();
                                let weapon_h1 = JSON.parse(read("DB/weapons/" + user.equips.weapon.name + ".json"));
                                let armor_h1 = JSON.parse(read("DB/armors/" + user.equips.armor.name + ".json"));
                                let weapon_h2 = JSON.parse(read("DB/weapons/" + target.equips.weapon.name + ".json"));
                                let armor_h2 = JSON.parse(read("DB/armors/" + target.equips.armor.name + ".json"));
                                let tempObj = {
                                    name: {
                                        h1: username,
                                        h2: (target.title ? "[" + target.title + "] ":"") + target.name
                                    },
                                    id: {
                                        h1: user.id,
                                        h2: target.id
                                    },
                                    stat: {
                                        h1: {
                                            hit: 0.7 + weapon_h1[user.equips.weapon.tier].plusStat.hit,
                                            cnt: 0.05 + weapon_h1[user.equips.weapon.tier].plusStat.cnt,
                                            cmb: 0.05 + weapon_h1[user.equips.weapon.tier].plusStat.cmb,
                                            crt: 0.05 + weapon_h1[user.equips.weapon.tier].plusStat.crt,
                                            pnt: 0.05 + weapon_h1[user.equips.weapon.tier].plusStat.pnt,
                                            bld: 0.1 + weapon_h1[user.equips.weapon.tier].plusStat.bld,
                                            brn: 0 + weapon_h1[user.equips.weapon.tier].plusStat.brn,
                                            stn: 0 + weapon_h1[user.equips.weapon.tier].plusStat.stn,
                                            poi: 0 + weapon_h1[user.equips.weapon.tier].plusStat.poi,
                                            dth: 0.001 + weapon_h1[user.equips.weapon.tier].plusStat.dth,
                                            hp: Math.round((1000 + armor_h1[user.equips.armor.tier].plusStat.hp) * (1 + (0.015 * user.getStat().def))),
                                            maxHp: Math.round((1000 + armor_h1[user.equips.armor.tier].plusStat.hp) * (1 + (0.015 * user.getStat().def))),
                                            shield: 0,
                                            def: 0.1 + armor_h1[user.equips.armor.tier].plusStat.def,
                                            res: 0.1 + armor_h1[user.equips.armor.tier].plusStat.res,
                                            avd: 0.05 + armor_h1[user.equips.armor.tier].plusStat.avd,
                                            str: user.getStat().str,
                                            int: user.getStat().int,
                                            de2: user.getStat().def
                                        },
                                        h2: {
                                            hit: 0.7 + weapon_h2[target.equips.weapon.tier].plusStat.hit,
                                            cnt: 0.05 + weapon_h2[target.equips.weapon.tier].plusStat.cnt,
                                            cmb: 0.05 + weapon_h2[target.equips.weapon.tier].plusStat.cmb,
                                            crt: 0.05 + weapon_h2[target.equips.weapon.tier].plusStat.crt,
                                            pnt: 0.05 + weapon_h2[target.equips.weapon.tier].plusStat.pnt,
                                            bld: 0.1 + weapon_h2[target.equips.weapon.tier].plusStat.bld,
                                            brn: 0 + weapon_h2[target.equips.weapon.tier].plusStat.brn,
                                            stn: 0 + weapon_h2[target.equips.weapon.tier].plusStat.stn,
                                            poi: 0 + weapon_h2[target.equips.weapon.tier].plusStat.poi,
                                            dth: 0.001 + weapon_h2[target.equips.weapon.tier].plusStat.dth,
                                            hp: Math.round((1000 + armor_h2[target.equips.armor.tier].plusStat.hp) * (1 + (0.015 * target.getStat().def))),
                                            maxHp: Math.round((1000 + armor_h2[target.equips.armor.tier].plusStat.hp) * (1 + (0.015 * target.getStat().def))),
                                            shield: 0,
                                            def: 0.1 + armor_h2[target.equips.armor.tier].plusStat.def,
                                            res: 0.1 + armor_h2[target.equips.armor.tier].plusStat.res,
                                            avd: 0.05 + armor_h2[target.equips.armor.tier].plusStat.avd,
                                            str: target.getStat().str,
                                            int: target.getStat().int,
                                            de2: target.getStat().def
                                        },
                                    },
                                    effect: {
                                        h1: {},
                                        h2: {}
                                    },
                                    stack: {
                                        h1: {},
                                        h2: {}
                                    },
                                    weapon: {
                                        h1: {
                                            name: user.equips.weapon.name,
                                            tier: ['E','D','C','B','A','S','S+','★','🌙'].indexOf(user.equips.weapon.tier),
                                            option: user.equips.weapon.option || [],
                                            enchant: user.equips.weapon.enchant || []
                                        },
                                        h2: {
                                            name: target.equips.weapon.name,
                                            tier: ['E','D','C','B','A','S','S+','★','🌙'].indexOf(target.equips.weapon.tier),
                                            option: target.equips.weapon.option || [],
                                            enchant: target.equips.weapon.enchant || []
                                        },
                                    },
                                    armor: {
                                        h1: {
                                            name: user.equips.armor.name,
                                            tier: ['E','D','C','B','A','S','S+','★','🌙'].indexOf(user.equips.armor.tier),
                                            option: user.equips.armor.option || [],
                                            enchant: user.equips.armor.enchant || []
                                        },
                                        h2: {
                                            name: target.equips.armor.name,
                                            tier: ['E','D','C','B','A','S','S+','★','🌙'].indexOf(target.equips.armor.tier),
                                            option: target.equips.armor.option || [],
                                            enchant: target.equips.armor.enchant || []
                                        },
                                    },
                                    artifact: {
                                        h1: user.equips.artifact,
                                        h2: target.equips.artifact
                                    },
                                    pet: {
                                        h1: {
                                            name: user.pet.name,
                                            level: user.pet.level,
                                            damage: user.pet.damage
                                        },
                                        h2: {
                                            name: target.pet.name,
                                            level: target.pet.level,
                                            damage: target.pet.damage
                                        }
                                    },
                                    logs: []
                                }
                                let artifactPS = JSON.parse(read("DB/artifactPlusStat.json"));
                                tempObj.artifact.h1.forEach(arti => {
                                    let artifact = artifactPS.find(a => a.name == arti);
                                    if (artifact) {
                                        for(let ps in artifact.plusStat) {
                                            if (ps == 'hp' || ps == 'maxHp' || ps == 'shield') tempObj.stat.h1[ps] += artifact.plusStat[ps];
                                            else tempObj.stat.h1[ps] = Math.min(1, tempObj.stat.h1[ps] + artifact.plusStat[ps]);
                                        }
                                    }
                                });
                                tempObj.artifact.h2.forEach(arti => {
                                    let artifact = artifactPS.find(a => a.name == arti);
                                    if (artifact) {
                                        for(let ps in artifact.plusStat) {
                                            if (ps == 'hp' || ps == 'maxHp' || ps == 'shield') tempObj.stat.h2[ps] += artifact.plusStat[ps];
                                            else tempObj.stat.h2[ps] = Math.min(1, tempObj.stat.h2[ps] + artifact.plusStat[ps]);
                                        }
                                    }
                                });
                                while(true) {
                                    processHunt(tempObj, 'h1', 'h2');
                                    if (tempObj.stat.h1.hp <= 0) {
                                        tempObj.logs.push("☠️ " + tempObj.name.h1 + "님이 패배했습니다.");
                                        tempObj.lose = true;
                                        break;
                                    } else if (tempObj.stat.h2.hp <= 0) {
                                        tempObj.logs.push("☠️ " + tempObj.name.h2 + "님이 패배했습니다!");
                                        tempObj.win = true;
                                        break;
                                    }
                                    processHunt(tempObj, 'h2', 'h1');
                                    if (tempObj.stat.h1.hp <= 0) {
                                        tempObj.logs.push("☠️ " + tempObj.name.h1 + "님이 패배했습니다.");
                                        tempObj.lose = true;
                                        break;
                                    } else if (tempObj.stat.h2.hp <= 0) {
                                        tempObj.logs.push("☠️ " + tempObj.name.h2 + "님이 패배했습니다!");
                                        tempObj.win = true;
                                        break;
                                    }
                                }
                                let results = [];
                                user.initHunterRate = "T";
                                target.initHunterRate = "T";
                                if (tempObj.win) {
                                    let rate = getHunterRate(user, target);
                                    user.hunterRate += rate;
                                    target.hunterRate -= rate;
                                    results.push(user.name + " ▶ ⚜️ " + user.hunterRate.toComma() + " (+" + rate + ")");
                                    results.push(target.name + " ▶ ⚜️ " + target.hunterRate.toComma() + " (-" + rate + ")");
                                } else {
                                    let rate = getHunterRate(target, user);
                                    target.hunterRate += rate;
                                    user.hunterRate -= rate;
                                    results.push(user.name + " ▶ ⚜️ " + user.hunterRate.toComma() + " (-" + rate + ")");
                                    results.push(target.name + " ▶ ⚜️ " + target.hunterRate.toComma() + " (+" + rate + ")");
                                }
                                target.save();
                                user.save();
                                room.send("🏹 헌터 콜로세움 ⚔️\n[ " + tempObj.name.h1 + " vs " + tempObj.name.h2 + " ]" + VIEWMORE + "\n" + tempObj.logs.join("\n") + "\n\n< 결과 >\n" + results.join("\n"));
                            } catch(e) {
                                room.send("❌ 오류 발생: " + e + "\n" + VIEWMORE + "\n" + JSON.stringify(e, null, 4));
                            }
                            
                        }
                    });
                    var thread = new java.lang.Thread(runnable);
                    thread.start();
                }
            }

            else if (args[0] == "랭킹") {
                {
                    {
                            let users = await getHuntersByInitRate("T");
                            let rateRank = [];
                            if (users.length) {
                                users = users.map(u => {
                                    return {
                                        name: u.name,
                                        rate: u.hunterRate
                                    };
                                }).sort((a, b) => b.rate - a.rate);
                                for(let i = 0; i < users.length; i++) {
                                    if (i < 3) {
                                        rateRank.push("  " + (["🥇","🥈","🥉"][i]) + " 『 " + users[i].name + " 』 :: ⚜️ " + users[i].rate.toComma() + "\n");
                                    } else {
                                        rateRank.push((i + 1) + "위 " + users[i].name + " :: ⚜️ " + users[i].rate.toComma());
                                    }
                                }
                            }
                            send("⚜️ 헌터 콜로세움 랭킹 ⚜️\n" + (rateRank.length > 0 ? VIEWMORE + "\n" + rateRank.join("\n") : (read("DB/initHunterRate.txt") == "false" ? "\n현재 시즌이 종료되었습니다." : "\n아직 참가자가 없습니다.")));
                    }
                }
            }

            else if (args[0] == "시즌") {
                if (args[1] == "초기화") {
                    if (user.id == "401929996") {
                        let result = [];
                        let users = await getHuntersByInitRate("T");
                        users = users.sort((a, b) => b.hunterRate - a.hunterRate);
                        for (let i = 0; i < users.length; i++) {
                            let u = users[i];
                            let uRank = (i + 1);
                            let rewards = [{
                                name: "보물상자",
                                type: "소모품",
                                count: 10
                            },
                            {
                                name: "별빛 상자",
                                type: "소모품",
                                count: 0
                            },
                            {
                                name: "달빛 상자",
                                type: "소모품",
                                count: 0
                            },
                            {
                                name: "코인",
                                type: "코인",
                                count: 200000000
                            }];
                            if (uRank == 1) {
                                rewards[0].count = 100;
                                rewards[1].count = 15;
                                rewards[2].count = 5;
                                rewards[3].count = 2500000000;
                            } else if (uRank == 2) {
                                rewards[0].count = 50;
                                rewards[1].count = 10;
                                rewards[2].count = 3;
                                rewards[3].count = 1500000000;
                            } else if (uRank == 3) {
                                rewards[0].count = 30;
                                rewards[1].count = 5;
                                rewards[2].count = 2;
                                rewards[3].count = 1000000000;
                            } else if (uRank <= 10) {
                                rewards[0].count = 15;
                                rewards[3].count = 500000000;
                            }
                            result.push((uRank <= 3 ? ((["🥇","🥈","🥉"][i]) + " 『 " + u.name + " 』") : (uRank + "위 " + u.name)) + " :: ⚜️ " + u.hunterRate.toComma() + "\n< 랭킹 보상 >");
                            rewards.forEach(r => {
                                if (r.count > 0) {
                                    if (r.name == "코인") {
                                        u.cash += r.count;
                                    } else {
                                        if (u.inventory.find(i => i.name == r.name)) {
                                            u.inventory.find(i => i.name == r.name).count += r.count;
                                        } else {
                                            u.inventory.push(r);
                                        }
                                    }
                                    result.push("- " + (r.name == "코인" ? "🪙" : r.name) + " x" + (r.count.toComma()));
                                }
                            });
                            result.push("\n");

                            u.initHunterRate = "F";
                            u.hunterRate = 1500;
                            u.save();
                        }
                        save("DB/initHunterRate.txt", "false");
                        room.send("⚜️ 헌터 결투 시즌 초기화 ⚜️\n정산 결과는 다음과 같습니다.\n" + VIEWMORE + "\n" + result.join("\n"));
                    }
                }
            }

            else if (args[0] == "패치") {
                send(read("DB/patchnote.txt").replace("--", VIEWMORE));
            }

            else if (args[0] == "지급" && user.id == "401929996") {
                let pack = JSON.parse(read("DB/pack.json"));
                let targetUser = await getUserByName(args[1]);
                let package = pack.find(p => p.name == cmd.substr(7 + args[1].length));
                if (targetUser && package) {
                    let rewards = [];
                    package.item.forEach(reward => {
                        let count = reward.count;
                        if (reward.name == "코인") {
                            targetUser.cash += count;
                            rewards.push("- 🪙 x" + count.toComma());
                            return;
                        }
                        if (targetUser.inventory.find(item => item.name == reward.name)) {
                            if (! targetUser.inventory.find(item => item.name == reward.name).tier) {
                                targetUser.inventory.find(item => item.name == reward.name).count += count;
                                rewards.push("- " + reward.name + " x" + count.toComma());
                            } else {
                                if (targetUser.inventory.find(item => item.name == reward.name + "의 조각")) {
                                    targetUser.inventory.find(item => item.name == reward.name + "의 조각").count += 100;
                                } else {
                                    let newItem = {
                                        name: reward.name + "의 조각",
                                        type: "재료",
                                        count: 100
                                    };
                                    targetUser.inventory.push(newItem);
                                }
                                rewards.push("- " + reward.name + "의 조각 x100");
                            }
                        } else {
                            let newItem = {
                                name: reward.name,
                                type: reward.type,
                                count: count
                            };
                            if (reward.tier) newItem.tier = reward.tier;
                            targetUser.inventory.push(newItem);
                            rewards.push("- " + reward.name + (reward.tier ? "" : " x" + count.toComma()));
                        }
                    });
                    targetUser.save();
                    room.send("✅ " + args[1] + "님에게 " + cmd.substr(7 + args[1].length) + " 지급을 완료했습니다.\n\n[ 지급 아이템 ]\n" + rewards.join("\n"));
                }
            }

            else if (args[0] == "펫") {
                if (args[1] == "설명") {
                    let input = cmd.substr(8);
                    let pet = read("DB/pets/" + input + ".json");
                    if (!pet) {
                        room.send("❌ 존재하는 펫이 아닙니다.");
                    } else {
                        pet = JSON.parse(pet);
                        send("« " + input + " »\n\n[ 피해량 ] " + pet.damage + "(+" + pet.plusDamage + ")\n[ 출전 효과 ]\n- " + pet.desc.map(d => d.replace("%D", "[피해량]")).join("\n- "));
                    }
                } else if (args[1] == "출전") {
                    let pet = user.inventory.find(i => i.type == "펫" && i.name == cmd.substr(8));
                    if (! pet || pet.count < 1) {
                        room.send("❌ 해당 펫이 없거나 보유하고 있지 않습니다.");
                    } else {
                        if (!pet.level) {
                            pet.level = 1;
                            let petInfo = JSON.parse(read("DB/pets/" + pet.name + ".json"));
                            pet.damage = petInfo.damage;
                        }
                        user.pet = {
                            name: pet.name,
                            damage: pet.damage,
                            level: pet.level
                        };
                        user.save();
                        send("✅ Lv." + (pet.level == 100 ? "MAX" : pet.level) + " " + pet.name + (dec_han(pet.name.substr(-1)).length == 3 ? "과" : "와") + " 동행합니다!");
                    }
                } else if (args[1] == "레벨업") {
                    let pet = user.inventory.find(i => i.type == "펫" && i.name == cmd.substr(9));
                    if (! pet) {
                        room.send("❌ 해당 펫이 없거나 보유하고 있지 않습니다.");
                    } else if (pet.level >= 100) {
                        room.send("❌ " + pet.name + (dec_han(pet.name.substr(-1)).length == 3 ? "은" : "는") + " 이미 최대 레벨입니다.");
                    } else {
                        if (!pet.level) {
                            pet.level = 1;
                            let petInfo = JSON.parse(read("DB/pets/" + pet.name + ".json"));
                            pet.damage = petInfo.damage;
                            user.save();
                        }
                        let needs = {
                            pet: (5 * Math.pow(2, pet.level % 10)) + (3000 * Math.floor(pet.level / 10)),
                            feed: Math.round(((5 * Math.pow(2, pet.level % 10)) + (3000 * Math.floor(pet.level / 10))) * 1.5),
                            starTicket: (pet.level == 49 ? 1 : 0)
                        };
                        let feed = user.inventory.find(i => i.name == "펫 먹이") || {count: 0};
                        let starTicket = user.inventory.find(i => i.name == "별의 증표") || {count: 0};
                        if ((pet.count - 1) < needs.pet || feed.count < needs.feed || starTicket.count < needs.starTicket) {
                            send("❌ 레벨업 재료가 부족합니다!\n\n강화 재료:\n" + ((pet.count - 1) < needs.pet ? "❌":"✅") + " " + pet.name + " " + (pet.count - 1).toComma() + "/" + needs.pet.toComma() + "\n" + (feed.count < needs.feed ? "❌":"✅") + " 펫 먹이 " + feed.count.toComma() + "/" + needs.feed.toComma() + (needs.starTicket ? "\n" + (starTicket.count < needs.starTicket ? "❌":"✅") + " 별의 증표 " + starTicket.count.toComma() + "/" + needs.starTicket.toComma() : ""));
                            return;
                        }
                        myCheck[senderID] = {
                            type: "레벨업",
                            arg: {
                                needs: needs,
                                name: pet.name
                            }
                        }
                        send("레벨업 재료:\n✅ " + pet.name + " " + pet.count.toComma() + "/" + needs.pet.toComma() + "\n✅ 펫 먹이 " + feed.count.toComma() + "/" + needs.feed.toComma() + (needs.starTicket ? "\n✅ 별의 증표 " + starTicket.count.toComma() + "/" + needs.starTicket.toComma() : "") + "\n\n정말 레벨업하시겠습니까?\n펫 레벨업은 초기화할 수 없습니다.\n[ $확인 ]");
                    }
                } else if (args[1] == "훈련") {
                    room.send("🤖 펫 훈련 기능은 구현중입니다.");
                } else if (args[1] == "정보") {
                    if (!user.pet.name) {
                        room.send("❌ 현재 출전중인 펫이 없습니다.");
                    } else {
                        let pet = read("DB/pets/" + user.pet.name + ".json");
                        if (!pet) {
                            room.send("❌ 현재 출전중이 펫이 없거나 삭제되었습니다.");
                        } else {
                            pet = JSON.parse(pet);
                            let petDesc = pet.desc.map(d => {
                                let desc = d.replace("%D", user.pet.damage);
                                let matched = d.replace("MAX", "100").match(/Lv.\d+: /gi);
                                if (matched) {
                                    let levelLimit = Number(matched[0].match(/\d+/gi)[0]);
                                    if (levelLimit > user.pet.level) {
                                        desc = null
                                    }
                                }

                                return desc;
                            });
                            send("« Lv." + (user.pet.level == 100 ? "MAX" : user.pet.level) + " " + user.pet.name + " »\n\n[ 출전 효과 ]\n- " + petDesc.filter(d => d != null).join("\n- "));
                            d.replace("%D", pet.damage)
                        }
                    }
                }
            }

            else if (args[0] == "세트") {
                if (args[1] == "저장") {
                    let num = args[2];
                    if (isNaN(num) || Math.round(Number(num)) < 1 || Math.round(Number(num)) > 3) {
                        room.send("❌ 잘못된 입력입니다.\n>> $헌터 세트 저장 [1~3]");
                    } else {
                        num = Math.round(Number(num)) - 1;
                        user.equipSet[num] = {
                            weapon: user.equips.weapon.name,
                            armor: user.equips.armor.name,
                            artifact: user.equips.artifact,
                            pet: user.pet.name
                        }
                        user.save();
                        send((num + 1) + "번 세트에 현재 장비가 저장되었습니다.\n\n[ 무기 ] " + user.equipSet[num].weapon + "\n[ 갑옷 ] " + user.equipSet[num].armor + "\n[ 아티팩트 ] " + (user.equipSet[num].artifact.length ? user.equipSet[num].artifact.join(", ") : "없음") + "\n[ 펫 ] " + (user.equipSet[num].pet ? user.equipSet[num].pet : "없음"));
                    }
                } else if (args[1] == "로드") {
                    let num = args[2];
                    if (isNaN(num) || Math.round(Number(num)) < 1 || Math.round(Number(num)) > 3) {
                        room.send("❌ 잘못된 입력입니다.\n>> $헌터 세트 로드 [1~3]");
                    } else {
                        num = Math.round(Number(num)) - 1;
                        if (! user.equipSet[num]) {
                            room.send("❌ 해당 세트에 저장된 장비셋이 없습니다.");
                        } else {
                            let weapon = user.inventory.find(i => i.name == user.equipSet[num].weapon) || {name:"맨손",type:"무기",tier:"-"};
                            let armor = user.inventory.find(i => i.name == user.equipSet[num].armor) || {name:"평상복",type:"갑옷",tier:"-"};
                            let artifact = [];
                            user.equipSet[num].artifact.forEach(arti => {
                                let artifactItem = user.inventory.find(i => i.name == arti) || { count: 0 };
                                if (artifact.filter(a => a == arti).length < artifactItem.count && ! artifact.includes(arti)) {
                                    artifact.push(arti);
                                }
                            });
                            let pet = {name:null,damage:0,level:0};
                            if (user.equipSet[num].pet) {
                                pet = user.inventory.find(i => i.name == user.equipSet[num].pet) || {name:null,damage:0,level:0};
                            }
                            user.equips.weapon = weapon;
                            user.equips.armor = armor;
                            user.equips.artifact = artifact;
                            user.pet = {
                                name: pet.name,
                                damage: pet.damage,
                                level: pet.level
                            };
                            user.save();
                            send((num + 1) + "번 세트 장비셋을 로드했습니다.\n\n[ 무기 ] [" + weapon.tier + "] " + weapon.name + "\n[ 갑옷 ] [" + armor.tier + "] " + armor.name + "\n[ 아티팩트 ] " + (artifact.length ? artifact.join(", ") : "없음") + "\n[ 펫 ] " + (pet.name ? "Lv." + (pet.level == 100 ? "MAX" : pet.level) + " " + pet.name : "없음") + "\n\n※ 장비셋은 현재 보유중인 장비 정보에 따라 로드됩니다.");
                        }
                    }
                }
            }

            else if (args[0] == "진화") {
                let equip = user.inventory.find(i => i.name.replace(/\s/gi, "") == cmd.substr(6).replace(/\s/gi, ""));
                if (! equip || equip.count <= 0) {
                    room.send("❌ 해당 장비가 없거나 보유하고 있지 않습니다.");
                } else if (equip.tier != "★") {
                    room.send("❌ [★] " + equip.name + " 장비가 필요합니다.");
                } else {
                    let arcana = user.inventory.find(i => i.name == "아르카나 " + equip.name) || { count: 0 };
                    let star = user.inventory.find(i => i.name == "별빛 각인") || { count: 0 };
                    let strong = user.inventory.find(i => i.name == "강함의 증명") || { count: 0 };
                    if (star.count < 1) {
                        room.send("❌ 별빛 각인을 보유해야 합니다.");
                    } else if (arcana.count < 1) {
                        room.send("❌ 아르카나 " + equip.name + " 아티팩트를 보유해야 합니다.");
                    } else if (strong.count < 1) {
                        room.send("❌ 강함의 증명을 보유해야 합니다.");
                    } else {
                        let evolution = JSON.parse(read("DB/evolution.json"));
                        let evolEquip = evolution.find(i => i.prev == equip.name);
                        if (! evolEquip) {
                            room.send("❌ 진화할 수 없는 장비입니다.");
                            return;
                        }
                        myCheck[senderID] = {
                            type: "진화",
                            arg: {
                                evol: evolEquip
                            }
                        };
                        send("⬜ " + equip.name + (dec_han(equip.name.substr(-1)).length == 3 ? "을" : "를") + " " + evolEquip.name + (dec_han(evolEquip.name.substr(-1)).length == 3 ? "으로" : "로") + " 진화합니다.\n\n[ $확인 ]");
                    }
                }
            }

            else if (args[0] == "입장" || args[0] == "이동") {
                if (user.playing.hunt) {
                    room.send("❌ 사냥중엔 이동할 수 없습니다.");
                    return;
                }
                let target = cmd.substr(6);
                let locations = JSON.parse(read("DB/locations.json"));
                if (!user.location) user.location = "헌터 로비";
                if (! locations.find(l => l.name == target)) {
                    room.send("❌ 존재하지 않는 장소입니다.");
                } else if (user.location == target) {
                    room.send("❌ 이미 " + target + "에 있습니다.");
                } else if (locations.find(l => l.name == target).banned.includes(user.id)) {
                    room.send("🚫 " + user.name + "님은 현재 " + target + "에서 추방당했습니다.");
                } else if (!locations.find(l => l.name == user.location).can_entry.includes(target)) {
                    room.send("❌ " + user.location + "에서는 " + target + (dec_han(target.substr(-1)).length == 3 ? "으로" : "로") + " 이동할 수 없습니다.");
                } else {
                    let entryTicket = user.inventory.find(i => i.name == target + " 입장권");
                    if (locations.find(l => l.name == target).need_ticket && ! entryTicket) {
                        room.send("❌ " + target + " 입장권이 필요합니다.");
                    } else {
                        user.location = target;
                        user.save();
                        send("✅ " + target + (dec_han(target.substr(-1)).length == 3 ? "으로" : "로") + " 이동했습니다.");
                    }
                }
            }

            else if (args[0] == "위치") {
                if (user.playing.hunt && user.playing.hunt.map) {
                    send("🗺️ 현위치: " + user.playing.hunt.map + "\n\n[ 사냥 중 ]")
                } else {
                    let locations = JSON.parse(read("DB/locations.json"));
                    if (! locations.find(l => l.name == user.location)) user.location = "헌터 로비";
                    let now_loc = locations.find(l => l.name == user.location);
                    let npcs = (now_loc.npcs.length == 0 ? "(없음)" : now_loc.npcs.map(npc => "- " + npc).join("\n"));
                    let locs = (now_loc.can_entry.length == 0 ? "(없음)" : now_loc.can_entry.map(npc => "- " + npc).join("\n"));
                    let isHotel = (now_loc.hotel ? "\n\n[ 휴식 가능 ]" : "");
                    send("🗺️ 현위치: " + user.location + "\n\n[ 대화 가능 NPC ]\n" + npcs + "\n\n[ 이동 가능 위치 ]\n" + locs + isHotel);
                }
            }

            else if (args[0] == "대화") {
                if (user.playing.hunt) {
                    room.send("❌ 사냥중엔 대화할 수 없습니다.");
                    return;
                }
                room.send("🤖 NPC 대화 기능은 폐쇄되었습니다.\n추후 새롭게 업데이트 예정입니다.");
                return;
                let locations = JSON.parse(read("DB/locations.json"));
                let loc = locations.find(l => l.name == user.location);
                if (! loc) {
                    room.send("❌ 대화 가능한 NPC가 없습니다.");
                } else {
                    let npc = parseNpc(cmd.substr(6), loc.npcs);
                    if (! npc[0]) {
                        room.send("❌ " + user.location + "에는 해당 NPC가 존재하지 않습니다.");
                        return;
                    }
                    if (outputing[user.id]) {
                        room.send("❌ 이미 " + outputing[user.id] + (dec_han(outputing[user.id].substr(-1)).length == 3 ? "과" : "와") + " 대화중입니다.");
                        return;
                    }
                    outputing[user.id] = npc[0];
                    send("💭 " + npc[0] + (dec_han(npc[0].substr(-1)).length == 3 ? "이" : "가") + " 할 말을 생각중이에요..");
                    let runnable = new java.lang.Runnable({
                    run: async function() {
                        try {
                            let finalMessage = [];
                            let systemPrompt = (read("DB/npcs/" + npc[0] + ".txt") ? read("DB/npcs/" + npc[0] + ".txt") : read("DB/npcs/기본.txt"));
                            if (read("DB/npcData/" + user.id + ".json") && JSON.parse(read("DB/npcData/" + user.id + ".json")).find(d => d.name == npc[0])) {
                                let npcData = JSON.parse(read("DB/npcData/" + user.id + ".json")).find(d => d.name == npc[0]);
                                systemPrompt += "\n\n---\n\n# [NPC 데이터]\n" + npcData.data + "\n\n마지막 대화로부터 " + toTimeNotation(Math.round((new Date() - new Date(npcData.last)) / 1000)) + " 경과";
                            }
                            systemPrompt += "\n현재시각: " + (new Date().toDateString());
                            let userQuest = read("DB/userQuest/" + user.id + ".json");
                            if (userQuest) userQuest = JSON.parse(userQuest).find(q => q.provider == npc[0]);
                            if (userQuest) {
                                let questClear = true;
                                userQuest.condition.item.forEach(item => {
                                    if ((user.inventory.find(i => i.name == item.name) || {count:0}).count < item.count) questClear = false;
                                });
                                if (questClear) {
                                    systemPrompt += "\n✅ 퀘스트를 클리어했습니다!\n보상 목록:\n" + userQuest.reward.item.map(i => "- " + i.name + " x" + i.count.toComma()).join("\n");
                                    userQuest.reward.item.forEach(item => {
                                        user.giveItem(item);
                                    });
                                    userQuest.condition.item.forEach(item => {
                                        user.inventory.find(i => i.name == item.name).count -= item.count;
                                    });
                                    user.save();
                                    let userQ = JSON.parse(read("DB/userQuest/" + user.id + ".json"));
                                    userQ.splice(userQ.findIndex(q => q.provider == npc[0]), 1);
                                    save("DB/userQuest/" + user.id + ".json", JSON.stringify(userQ, null, 4));
                                    finalMessage.push("✅ 퀘스트를 클리어했습니다!");
                                }
                                else systemPrompt += "\n퀘스트 진행 중 (아직 클리어하지 않았습니다.)";
                            }
                            let res = await Claude([{role:"user",content:user.name + ": " + npc[1]}], "claude-3-7-sonnet-latest", systemPrompt);
                            if (res.content) {
                                let usage = ((res.usage.input_tokens * 0.000003) + (res.usage.output_tokens * 0.000015)).fix(7);
                                let message = res.content[0].text;
                                let reply = message.split("\n핵심 상태 데이터:")[0];
                                let npcData = "핵심 상태 데이터:" + message.split("\n핵심 상태 데이터:")[1];
                                let action = (message.split("\n[")[1] ? message.split("\n[")[1].split("]")[0] : null);
                                if (action && read("DB/npcAction/" + action + ".json")) {
                                    reply = reply.split("\n[")[0];
                                    npcData = npcData.split("\n[")[0];
                                    let act = JSON.parse(read("DB/npcAction/" + action + ".json"));
                                    let npcAct = act.find(a => a.name == npc[0]);
                                    if (npcAct) {
                                        if (npcAct.quest) {
                                            let quests = JSON.parse(read("DB/quests.json"));
                                            let userQ;
                                            if (! read("DB/userQuest/" + user.id + ".json")) userQ = [];
                                            else userQ = JSON.parse(read("DB/userQuest/" + user.id + ".json"));
                                            userQ.push(quests.find(q => q.provider == npc[0]));
                                            save("DB/userQuest/" + user.id + ".json", JSON.stringify(userQ, null, 4));
                                            finalMessage.push("✅ 퀘스트를 받았습니다. [ $헌터 퀘스트 ]");
                                        }
                                        if (npcAct.exit) {
                                            let locs = JSON.parse(read("DB/locations.json"));
                                            locs.find(l => l.name == user.location).banned.push(user.id);
                                            save("DB/locations.json", JSON.stringify(locs, null, 4));
                                            finalMessage.push("❌ " + user.location + "에서 추방당했습니다.");
                                            user.location = null;
                                            user.save();
                                        }
                                        if (npcAct.sell) {
                                            let price;
                                            let item;
                                            if (action.startsWith("달빛 상자")) {
                                                price = 500000000;
                                                item = "달빛 상자";
                                            } else if (action.startsWith("별빛 상자")) {
                                                price = 100000000;
                                                item = "별빛 상자";
                                            } else if (action.startsWith("아르카나 상자")) {
                                                price = 12000000;
                                                item = "아르카나 상자";
                                            } else {
                                                price = 12000000;
                                                item = "아르카나 상자";
                                            }
                                            if (user.cash < price) {
                                                finalMessage.push("❌ 보유 코인이 부족합니다.");
                                                npcData += "\n\n- 코인이 부족해 물건 구매해 실패함.";
                                            } else {
                                                user.giveItem({name:item,type:"소모품",count:1});
                                                user.cash -= price;
                                                user.save();
                                                finalMessage.push("✅ " + item + (dec_han(item.substr(-1)).length == 3 ? "을" : "를") + " 구매했습니다.");
                                                npcData += "\n\n- 코인으로 성공적으로 물건을 구매함.";
                                            }
                                        }
                                        if (npcAct.gift) {
                                            npcAct.gift.forEach(item => {
                                                user.giveItem(item);
                                            });
                                            user.save();
                                            finalMessage.push("✅ 선물을 받았습니다!");
                                        }
                                    }
                                }
                                let user_npcData = {
                                    name: npc[0],
                                    data: npcData,
                                    last: new Date().toString()
                                };
                                let npcDataFile;
                                if (read("DB/npcData/" + user.id + ".json")) npcDataFile = JSON.parse(read("DB/npcData/" + user.id + ".json"));
                                else npcDataFile = [];
                                if (npcDataFile.find(d => d.name == npc[0])) {
                                    let npcDF = npcDataFile.find(d => d.name == npc[0]);
                                    npcDF.data = user_npcData.data;
                                    npcDF.last = user_npcData.last;
                                }
                                else npcDataFile.push(user_npcData);
                                save("DB/npcData/" + user.id + ".json", JSON.stringify(npcDataFile, null, 4));
                                finalMessage.push("(" + usage + ") " + npc[0] + "의 말:\n\n" + reply);
                                
                                send(finalMessage.join("\n").trim());
                            } else {
                                room.send("❌ NPC와 대화 도중 오류가 발생했습니다. 루킴님에게 이 사실을 전해주세요.\n" + VIEWMORE + "\n" + JSON.stringify(res, null, 4));
                            }
                            delete outputing[user.id];
                        } catch(e) {
                            delete outputing[user.id];
                            room.send("❌ NPC와 대화 도중 오류가 발생했습니다. 루킴님에게 이 사실을 전해주세요.\n\n오류 내용: " + e + "\n" + VIEWMORE + "\n" + JSON.stringify(e, null, 4));
                        }
                    }
                    });
                    var thread = new java.lang.Thread(runnable);
                    thread.start();
                }
            }

            else if (args[0] == "휴식") {
                if (! JSON.parse(read("DB/hotels.json")).find(h => h.location == user.location)) {
                    room.send("❌ 근처에 휴식할 수 있는 여관이 없습니다.");
                } else if (! user.state || user.state.hp == user.state.maxHp) {
                    room.send("❌ 휴식할 필요가 없습니다.");
                } else {
                    let hotel = JSON.parse(read("DB/hotels.json")).find(h => h.location == user.location);
                    let goods = (hotel.price.goods == "🪙" ? user.cash : user.inventory.find(i => i.name == hotel.price.goods) || { count: 0});
                    if (goods < hotel.price.count) {
                        room.send("❌ 휴식에 필요한 금액이 부족합니다!");
                    } else {
                        goods -= hotel.price.count;
                        user.state.hp = user.state.maxHp;
                        user.save();
                        send("✅ 휴식을 통해 체력을 완전히 회복했습니다!");
                    }
                }
            }

            else if (args[0] == "퀘스트") {
                if (! read("DB/userQuest/" + user.id + ".json") || JSON.parse(read("DB/userQuest/" + user.id + ".json")).length == 0) {
                    room.send("❌ 퀘스트가 없습니다.");
                } else {
                    let quests = JSON.parse(read("DB/userQuest/" + user.id + ".json")).map(q => "『 " + q.name + " 』\n- 의뢰자: " + q.provider + "\n- 퀘스트 설명:\n" + q.desc + "\n\n- 퀘스트 진행도:\n" + q.condition.item.map(i => ((user.inventory.find(it => it.name == i.name) || {count:0}).count >= i.count ? "✅" : "❌") + " " + i.name + " x" + i.count.toComma()).join("\n") + "\n\n- 퀘스트 보상:\n" + q.reward.item.map(i => "- " + i.name + " x" + i.count.toComma()).join("\n"));
                    send("[ 퀘스트 목록 ]\n\n" + quests.join("\n\n──────────\n\n"));
                }
            }

            else if (args[0] == "슬롯") {
                if (args[1] == "확장") {
                    let scroll = user.inventory.find(i => i.name == "슬롯 확장 스크롤") || { count: 0 };
                    if (scroll.count <= 0) {
                        room.send("❌ 슬롯 확장 스크롤이 필요합니다.");
                    } else {
                        scroll.count--;
                        user.artifactMaxSlot++;
                        user.save();
                        send("✅ 아티팩트 슬롯이 확장되었습니다!\n아티팩트 최대 슬롯: " + user.artifactMaxSlot + "개 (아르카나 포함 " + (user.artifactMaxSlot + 2) + "개)");
                    }
                }
            }

            else if (args[0] == "칭호") {
                if (args[1] == "목록") {
                    send("[ " + username + "님의 칭호 목록 ]\n\n" + (user.titles.length ? user.titles.map(t => "- " + t).join("\n") : "칭호가 없습니다."));
                } else if (args[1] == "변경") {
                    let target = cmd.substr(9);
                    if (! user.titles.includes(target)) {
                        room.send("❌ 해당 칭호를 보유하고 있지 않습니다.");
                    } else {
                        user.title = target;
                        user.save();
                        send("✅ 성공적으로 칭호가 변경되었습니다!");
                    }
                } else if (args[1] == "설명") {
                    let target = cmd.substr(9);
                    let titles = JSON.parse(read("DB/titles.json"));
                    if (titles.find(t => t.title == target)) {
                        send("« " + target + " »\n\n" + titles.find(t => t.title == target).desc);
                    } else {
                        room.send("❌ 존재하지 않는 칭호입니다.");
                    }
                } else {
                    if (user.title) {
                        send(user.name + "님의 현재 칭호는 '" + user.title + "' 입니다.\n\n>> $헌터 칭호 목록\n>> $헌터 칭호 변경 [칭호]\n>> $헌터 칭호 설명 [칭호]");
                    } else {
                        send(user.name + "님은 칭호가 없습니다.\n\n>> $헌터 칭호 목록\n>> $헌터 칭호 변경 [칭호]\n>> $헌터 칭호 설명 [칭호]");
                    }
                }
            }

            else if (args[0] == "길들인" && args[1] == "몬스터") {
                if (args[2] == "해방") {
                    if (!read("DB/tamed/" + user.id + ".json")) {
                        room.send("❌ 길들인 몬스터가 없습니다.");
                    } else {
                        let target = cmd.substr(14);
                        let tamed = JSON.parse(read("DB/tamed/" + user.id + ".json"));
                        if (tamed.find(t => t.name == target)) {
                            tamed.splice(tamed.findIndex(t => t.name == target), 1);
                            send("✅ " + target + (dec_han(target.substr(-1)).length == 3 ? "을" : "를") + " 해방시켰습니다!");
                            save("DB/tamed/" + user.id + ".json", JSON.stringify(tamed, null, 4));
                        } else {
                            room.send("❌ 길들인 몬스터 목록에 존재하지 않습니다.");
                        }
                    }
                } else {
                    if (!read("DB/tamed/" + user.id + ".json")) {
                        room.send("❌ 길들인 몬스터가 없습니다.");
                    } else {
                        let tamed = JSON.parse(read("DB/tamed/" + user.id + ".json"));
                        if (tamed.length == 0) {
                            room.send("❌ 길들인 몬스터가 없습니다.");
                            return;
                        }
                        tamed = tamed.map(t => "- " + t.name);
                        send("[ 길들인 몬스터 목록 ]\n\n" + tamed.join("\n"));
                    }
                }
            }

            else {
                room.send("[ 헌터 콜로세움 도움말 ]" + VIEWMORE + "\n\n" + read("DB/헌터도움말.txt"));
            }

            if (! user.init.artifact) {
                user.equips.artifact = user.equips.artifact.unique();
                user.init.artifact = true;
                user.save();
            }
}

// ───────────────────────────────────────────────────────────── 헌터 플레이 핸들러
// old_engine.js 8444-9207: 길들이기/사냥/도망 · 탐험/공격/이동/사용 · 결투 진행/퇴장.
async function handlePlay(user, channel, senderID, cmd) {
    const room = { id: channel.channelId + "", send: (m) => channel.sendChat(m) };
        if (user && user.playing && user.playing.hunt && user.playing.hunt.choose) {
            if (cmd == "길들이기") {
                let percent = 0;
                // if (user.playing.hunt.monster.name == "연약한 늑대") {
                //     percent = 0.5;
                // }
                if (user.equips.artifact.includes("솔로몬의 반지") && !user.playing.hunt.monster.title) percent = 0.1;
                if (user.equips.artifact.includes("홍월의 솔로몬의 반지")) percent = 0.35;
                let r = Math.random();
                if (r < percent) {
                    // user.giveItem({name: user.playing.hunt.monster.name, type:"펫", count:1});
                    // await user.save();
                    let tamed = read("DB/tamed/" + user.id + ".json");
                    if (!tamed) tamed = [];
                    else tamed = JSON.parse(tamed);
                    tamed.push({
                        name: user.playing.hunt.monster.name,
                        stat: user.playing.hunt.monster.stat,
                        weapon: user.playing.hunt.monster.weapon,
                        armor: user.playing.hunt.monster.armor,
                        artifact: user.playing.hunt.monster.artifact || []
                    });
                    save("DB/tamed/" + user.id + ".json", JSON.stringify(tamed, null, 4));
                    room.send("✅ 성공적으로 " + user.playing.hunt.monster.name + (dec_han(user.playing.hunt.monster.name.substr(-1)).length == 3 ? "을" : "를") + " 길들였습니다!");
                    delete user.playing.hunt;
                    await user.save();
                } else {
                    room.send("❌ 길들이기에 실패했습니다.");
                    cmd = "사냥";
                }
            }
            if (cmd == "사냥" || cmd == "헌터 사냥") {
                let runnable = new java.lang.Runnable({
                    run: async function() {
                        try {
                            let tempObj = {};
                            tempObj.name = {
                                user: (user.title ? "[" + user.title + "] " : "") + user.name,
                                mob: user.playing.hunt.monster.name
                            };
                            tempObj.id = {
                                user: user.id
                            };
                            let weapon = JSON.parse(read("DB/weapons/" + user.equips.weapon.name + ".json"));
                            let armor = JSON.parse(read("DB/armors/" + user.equips.armor.name + ".json"));
                            tempObj.stat = {
                                user: {
                                    hit: 0.7 + weapon[user.equips.weapon.tier].plusStat.hit,
                                    cnt: 0.05 + weapon[user.equips.weapon.tier].plusStat.cnt,
                                    cmb: 0.05 + weapon[user.equips.weapon.tier].plusStat.cmb,
                                    crt: 0.05 + weapon[user.equips.weapon.tier].plusStat.crt,
                                    pnt: 0.05 + weapon[user.equips.weapon.tier].plusStat.pnt,
                                    bld: 0.1 + weapon[user.equips.weapon.tier].plusStat.bld,
                                    brn: 0 + weapon[user.equips.weapon.tier].plusStat.brn,
                                    stn: 0 + weapon[user.equips.weapon.tier].plusStat.stn,
                                    poi: 0 + weapon[user.equips.weapon.tier].plusStat.poi,
                                    dth: 0.001 + weapon[user.equips.weapon.tier].plusStat.dth,
                                    hp: Math.round((1000 + armor[user.equips.armor.tier].plusStat.hp) * (1 + (0.015 * user.getStat().def))),
                                    maxHp: Math.round((1000 + armor[user.equips.armor.tier].plusStat.hp) * (1 + (0.015 * user.getStat().def))),
                                    shield: 0,
                                    def: 0.1 + armor[user.equips.armor.tier].plusStat.def,
                                    res: 0.1 + armor[user.equips.armor.tier].plusStat.res,
                                    avd: 0.05 + armor[user.equips.armor.tier].plusStat.avd,
                                    str: user.getStat().str,
                                    int: user.getStat().int
                                },
                                mob: user.playing.hunt.monster.stat
                            };
                            tempObj.stat.mob.maxHp = tempObj.stat.mob.hp;
                            tempObj.effect = {
                                user: {},
                                mob: {}
                            };
                            tempObj.stack = {
                                user: {},
                                mob: {}
                            }
                            let userWeapon = user.equips.weapon.name;
                            let userTier = ['E','D','C','B','A','S','S+','★','🌙'].indexOf(user.equips.weapon.tier);
                            let userArmor = user.equips.armor.name;
                            let userTier_a = ['E','D','C','B','A','S','S+','★','🌙'].indexOf(user.equips.armor.tier);
                            tempObj.weapon = {
                                user: {
                                    name: userWeapon,
                                    tier: userTier,
                                    option: user.equips.weapon.option || [],
                                    enchant: user.equips.weapon.enchant || []
                                },
                                mob: user.playing.hunt.monster.weapon
                            }
                            tempObj.armor = {
                                user: {
                                    name: userArmor,
                                    tier: userTier_a,
                                    option: user.equips.armor.option || [],
                                    enchant: user.equips.armor.enchant || []
                                },
                                mob: user.playing.hunt.monster.armor
                            }
                            tempObj.artifact = {
                                user: user.equips.artifact,
                                mob: user.playing.hunt.monster.artifact || []
                            }
                            tempObj.pet = {
                                user: {
                                    name: user.pet.name,
                                    level: user.pet.level,
                                    damage: user.pet.damage
                                },
                                mob: {}
                            }
                            tempObj.logs = [];
                            let artifactPS = JSON.parse(read("DB/artifactPlusStat.json"));
                            for(let i = 0; i < user.equips.artifact.length; i++) {
                                artifactPS.forEach(artifact => {
                                    if (tempObj.artifact.user[i] == artifact.name) {
                                        for(let ps in artifact.plusStat) {
                                            if (ps == 'hp' || ps == 'maxHp' || ps == 'shield') tempObj.stat.user[ps] += artifact.plusStat[ps];
                                            else tempObj.stat.user[ps] = Math.min(1, tempObj.stat.user[ps] + artifact.plusStat[ps]);
                                        }
                                    }
                                });
                            }
                            while(true) {
                                processHunt(tempObj, 'user', 'mob');
                                if (tempObj.stat.user.hp <= 0) {
                                    tempObj.logs.push("☠️ " + tempObj.name.user + "님이 사망했습니다..");
                                    tempObj.lose = true;
                                    break;
                                } else if (tempObj.stat.mob.hp <= 0) {
                                    tempObj.logs.push("☠️ " + tempObj.name.mob + "(이)가 사망했습니다!");
                                    tempObj.win = true;
                                    break;
                                }
                                processHunt(tempObj, 'mob', 'user');
                                if (tempObj.stat.user.hp <= 0) {
                                    tempObj.logs.push("☠️ " + tempObj.name.user + "님이 사망했습니다..");
                                    tempObj.lose = true;
                                    break;
                                } else if (tempObj.stat.mob.hp <= 0) {
                                    tempObj.logs.push("☠️ " + tempObj.name.mob + "(이)가 사망했습니다!");
                                    tempObj.win = true;
                                    break;
                                }
                            }
                            let rewards = [];
                            if (tempObj.win) {
                                user = await getUserById(senderID);
                                let coin = Math.floor(Math.random() * (user.playing.hunt.monster.reward.maxCoin - user.playing.hunt.monster.reward.minCoin)) + user.playing.hunt.monster.reward.minCoin;
                                user.cash += coin;
                                rewards = ["- 🪙 " + coin.toComma()];
                                user.playing.hunt.monster.reward.others.forEach(reward => {
                                    let r = Math.random();
                                    if (r < reward.percent) {
                                        let count = Math.floor(Math.random() * (reward.maxCount - reward.minCount)) + reward.minCount;
                                        if (user.inventory.find(item => item.name == reward.name)) {
                                            if (! user.inventory.find(item => item.name == reward.name).tier) {
                                                user.inventory.find(item => item.name == reward.name).count += count;
                                                rewards.push("- " + reward.name + " x" + count.toComma());
                                            } else {
                                                if (user.inventory.find(item => item.name == reward.name + "의 조각")) {
                                                    user.inventory.find(item => item.name == reward.name + "의 조각").count += 100;
                                                } else {
                                                    let newItem = {
                                                        name: reward.name + "의 조각",
                                                        type: "재료",
                                                        count: 100
                                                    };
                                                    user.inventory.push(newItem);
                                                }
                                                rewards.push("- " + reward.name + "의 조각 x100");
                                            }
                                        } else {
                                            let newItem = {
                                                name: reward.name,
                                                type: reward.type,
                                                count: count
                                            };
                                            if (reward.tier) newItem.tier = reward.tier;
                                            user.inventory.push(newItem);
                                            rewards.push("- " + reward.name + (reward.tier ? "" : " x" + count.toComma()));
                                        }
                                    }
                                });
                            } else {
                                user.state = {
                                    hp: 1,
                                    maxHp: 100,
                                    last: new Date().toString()
                                };
                            }
                            room.send("🏹 헌터 콜로세움 ⚔️\n[ " + tempObj.name.user + "님의 사냥 결과 ]" + VIEWMORE + "\n" + tempObj.logs.join("\n") + (rewards.length > 0 ? "\n\n< 보상 >\n" + rewards.join("\n") : ""));
                            delete user.playing.hunt;
                            await user.save();
                        } catch(e) {
                            room.send("❌ 오류 발생: " + e + "\n" + VIEWMORE + "\n" + JSON.stringify(e, null, 4));
                        }
                        
                    }
                });
                var thread = new java.lang.Thread(runnable);
                thread.start();
            } else if (cmd == "도망") {
                delete user.playing.hunt;
                await user.save();
                room.send("🏹 헌터 콜로세움 ⚔️\n💨 성공적으로 도망쳤습니다.");
            }
        }

        if (user && user.playing && user.playing.hunt) {
            let hunt = await getHuntById(user.playing.hunt.hostId);
            if (hunt) {
                let hostUser = null;
                if (user.playing.hunt.hostId == user.id) hostUser = user;
                else hostUser = await getUserById(user.playing.hunt.hostId);
                if (cmd == "탐험") {
                    if (hunt.hostId != user.id) {
                        room.send("❌ 탐험 명령어는 파티장만 입력할 수 있습니다.");
                    } else {
                        if (user.playing.hunt.mobs.length == 0) {
                            if (hunt.dungeon == "시련의 회당" && user.playing.hunt.wave >= 4) {
                                user.giveItem({name:"시련의 회당 클리어",type:"횟수",count:1});
                                await user.save();
                                let rewards = await hunt.end();
                                room.send("🏹 헌터 콜로세움 ⚔️\n시련의 회당 도전에 성공했습니다.\n\n[ 획득한 보상 ]\n" + (rewards.length ? rewards.join("\n") : "보상을 획득하지 못했습니다."));
                                return;
                            }
                            if (hunt.dungeon == "루나리 왕성 남쪽" && user.playing.hunt.wave >= 11) {
                                let rewards = await hunt.end();
                                room.send("🏹 헌터 콜로세움 ⚔️\n루나리 왕국 쿠데타 저지에 성공했습니다.\n\n[ 획득한 보상 ]\n" + (rewards.length ? rewards.join("\n") : "보상을 획득하지 못했습니다."));
                                return;
                            }
                            user.playing.hunt.wave++;
                            let maps = JSON.parse(read("DB/maps.json"));
                            let monster = JSON.parse(read("DB/monster.json"));
                            let waveBoss = 4;
                            if (hunt.dungeon == "루나리 왕성 남쪽") waveBoss = 11;
                            if (user.playing.hunt.wave % waveBoss == 0) {
                                let map = maps.find(d => d.name == hunt.dungeon);
                                let mob = monster.find(m => m.name == map.boss[Math.floor(Math.random() * map.boss.length)]);
                                if (!mob) {
                                    room.send("❌ 탐험 도중 문제가 발생했습니다.");
                                    return;
                                }
                                user.playing.hunt.mobs.push({
                                    name: (mob.title?"["+mob.title+"] ":"")+mob.name,
                                    alive: true,
                                    number: 1,
                                    reward: mob.reward
                                });
                                mob.stat.hp = Math.round(mob.stat.hp * (1 + (0.15 * (Math.floor(Math.max(0, user.playing.hunt.wave - 1) / 4)))));
                                mob.stat.maxHp = mob.stat.hp;
                                let i = 0;
                                hunt.tempObj.name["m" + (i + 1)] = (mob.title?"["+mob.title+"] ":"")+mob.name;
                                hunt.tempObj.stat["m" + (i + 1)] = mob.stat;
                                hunt.tempObj.weapon["m" + (i + 1)] = mob.weapon;
                                hunt.tempObj.armor["m" + (i + 1)] = mob.armor;
                                hunt.tempObj.artifact["m" + (i + 1)] = mob.artifact || [];
                                hunt.tempObj.pet["m" + (i + 1)] = {name:null,level:0,damage:0};
                                hunt.tempObj.effect["m" + (i + 1)] = {};
                                hunt.tempObj.stack["m" + (i + 1)] = {};
                                if (user.playing.hunt.wave > 4) {
                                    if (!hunt.tempObj.weapon["m" + (i + 1)].option) hunt.tempObj.weapon["m" + (i + 1)].option = [];
                                    if (!hunt.tempObj.armor["m" + (i + 1)].option) hunt.tempObj.armor["m" + (i + 1)].option = [];
                                    hunt.tempObj.weapon["m" + (i + 1)].option.push({
                                        name: "모든 피해 증가",
                                        num: (0.2 * (Math.floor(Math.max(0, user.playing.hunt.wave - 1) / 4)))
                                    });
                                    hunt.tempObj.armor["m" + (i + 1)].option.push({
                                        name: "모든 피해 감소",
                                        num: (0.1 * (Math.floor(Math.max(0, user.playing.hunt.wave - 1) / 4)))
                                    });
                                }
                                if (hunt.dungeon == "시련의 회당" && user.inventory.find(i => i.name == "시련의 회당 클리어")) {
                                    if (!hunt.tempObj.weapon["m" + (i + 1)].option) hunt.tempObj.weapon["m" + (i + 1)].option = [];
                                    hunt.tempObj.weapon["m" + (i + 1)].option.push({
                                        name: "모든 피해 증가",
                                        num: (user.inventory.find(i => i.name == "시련의 회당 클리어").count * 0.15)
                                    });
                                    mob.stat.hp = Math.round(mob.stat.hp * (1 + (user.inventory.find(i => i.name == "시련의 회당 클리어").count * 0.15)));
                                    mob.stat.maxHp = mob.stat.hp;
                                }
                            } else {
                                let n = Math.floor(Math.random() * 3) + 1;
                                if (hunt.dungeon == "시련의 회당" || hunt.dungeon == "루나리 왕성 남쪽") n = 3;
                                let map = maps.find(d => d.name == hunt.dungeon);
                                for(let i = 0; i < n; i++) {
                                    let chooseMob = map.monsters[Math.floor(Math.random() * map.monsters.length)];
                                    if (hunt.dungeon == "시련의 회당") {
                                        let trialMob = [
                                            [],
                                            ["샤덴", "아리아카스", "블러드"],
                                            ["델리시", "엔텔", "칼테온"],
                                            ["해골 자객", "네메시스", "해골 기사"]
                                        ]
                                        chooseMob = trialMob[user.playing.hunt.wave][i];
                                    }
                                    if ((read("DB/userQuest/" + user.id + ".json") && JSON.parse(read("DB/userQuest/" + user.id + ".json")).find(q => q.name == "날개 재료 구하기")) && hunt.dungeon == "울창한 숲" && !user.playing.hunt.mobs.find(m => m.name == "부리새")) {
                                        chooseMob = "부리새"
                                    }
                                    let mob = JSON.parse(JSON.stringify(monster.find(m => m.name == chooseMob)));
                                    user.playing.hunt.mobs.push({
                                        name: (mob.title?"["+mob.title+"] ":"")+mob.name,
                                        alive: true,
                                        number: i + 1,
                                        reward: mob.reward
                                    });
                                    let waveper = 4;
                                    mob.stat.hp = Math.round(mob.stat.hp * (1 + (0.15 * Math.floor(Math.max(0, user.playing.hunt.wave - 1) / waveper))));
                                    mob.stat.maxHp = mob.stat.hp;
                                    hunt.tempObj.name["m" + (i + 1)] = (mob.title?"["+mob.title+"] ":"")+mob.name;
                                    hunt.tempObj.stat["m" + (i + 1)] = mob.stat;
                                    hunt.tempObj.weapon["m" + (i + 1)] = mob.weapon;
                                    hunt.tempObj.armor["m" + (i + 1)] = mob.armor;
                                    hunt.tempObj.artifact["m" + (i + 1)] = mob.artifact || [];
                                    hunt.tempObj.pet["m" + (i + 1)] = {name:null,level:0,damage:0};
                                    hunt.tempObj.effect["m" + (i + 1)] = {};
                                    hunt.tempObj.stack["m" + (i + 1)] = {};
                                    if (user.playing.hunt.wave > waveper) {
                                        if (!hunt.tempObj.weapon["m" + (i + 1)].option) hunt.tempObj.weapon["m" + (i + 1)].option = [];
                                        if (!hunt.tempObj.armor["m" + (i + 1)].option) hunt.tempObj.armor["m" + (i + 1)].option = [];
                                        hunt.tempObj.weapon["m" + (i + 1)].option.push({
                                            name: "모든 피해 증가",
                                            num: (0.2 * (Math.floor(Math.max(0, user.playing.hunt.wave - 1) / waveper)))
                                        });
                                        hunt.tempObj.armor["m" + (i + 1)].option.push({
                                            name: "모든 피해 감소",
                                            num: (0.1 * (Math.floor(Math.max(0, user.playing.hunt.wave - 1) / waveper)))
                                        });
                                    }
                                    if (hunt.dungeon == "시련의 회당" && user.inventory.find(i => i.name == "시련의 회당 클리어")) {
                                        if (!hunt.tempObj.weapon["m" + (i + 1)].option) hunt.tempObj.weapon["m" + (i + 1)].option = [];
                                        if (!hunt.tempObj.armor["m" + (i + 1)].option) hunt.tempObj.armor["m" + (i + 1)].option = [];
                                        hunt.tempObj.weapon["m" + (i + 1)].option.push({
                                            name: "모든 피해 증가",
                                            num: (user.inventory.find(i => i.name == "시련의 회당 클리어").count * 0.2)
                                        });
                                        hunt.tempObj.armor["m" + (i + 1)].option.push({
                                            name: "모든 피해 감소",
                                            num: (user.inventory.find(i => i.name == "시련의 회당 클리어").count * 0.1)
                                        });
                                        mob.stat.hp = Math.round(mob.stat.hp * (1 + (user.inventory.find(i => i.name == "시련의 회당 클리어").count * 0.25)));
                                        mob.stat.maxHp = mob.stat.hp;
                                    }
                                }
                            }
                            await user.save();
                            await hunt.save();
                            let meetMobs = [];
                            for(let i = 0; i < user.playing.hunt.mobs.length; i++) {
                                meetMobs.push("[" + (i+1) + "] " + user.playing.hunt.mobs[i].name);
                            }
                            room.send("🏹 헌터 콜로세움 ⚔️\n❗ 몬스터와 조우했습니다!\n\n- " + meetMobs.join("\n- ") + "\n\n>> $공격 [번호]\n>> $이동 [앞/뒤]\n>> $사용 [음식]");
                        }
                    }
                }
                if (cmd == "파티 현황") {
                    let result = [];
                    result.push("《 파티장: " + hunt.player[0].name + " 》\n《 맵: " + hunt.dungeon + " 》");
                    let partys = [];
                    hunt.player.forEach(p => {
                        let pn = "p" + (hunt.player.findIndex(pl => pl.id == p.id) + 1);
                        partys.push("- " + p.name + "의 HP: " + hunt.tempObj.stat[pn].hp.toComma() + "/" + hunt.tempObj.stat[pn].maxHp.toComma() + (p.alive ? "" : " [사망]"));
                    });
                    result.push("《 파티원 》\n" + partys.join("\n"));
                    result.push("《 " + hostUser.playing.hunt.wave + "웨이브 》");
                    result.push("《 전열 》 " + hostUser.playing.hunt.frontPlayers.filter(p => p.alive).map(p => p.name).join(" | ") + "\n《 후열 》 " + hostUser.playing.hunt.backPlayers.filter(p => p.alive).map(p => p.name).join(" | "));
                    if (hostUser.playing.hunt.reward.length) {
                        let rewards = [];
                        hostUser.playing.hunt.reward.forEach(r => {
                            if (r.type == "코인") {
                                rewards.push("- 🪙 " + r.count.toComma());
                            } else if (r.tier) {
                                rewards.push("- [" + r.tier + "] " + r.name);
                            } else {
                                rewards.push("- " + r.name + " x" + r.count.toComma());
                            }
                        });
                        result.push("《 보상 》\n" + rewards.join("\n"));
                    }
                    room.send("[ 파티 현황 ]\n" + VIEWMORE + "\n" + result.join("\n\n"));
                }

                if (cmd.startsWith("이동 ")) {
                    if (! hunt.player.find(p => p.id == user.id).alive) {
                        room.send("❌ 당신은 죽었습니다. 아무런 행동도 할 수 없습니다.");
                        return;
                    }
                    if (cmd.substr(3) == "앞") {
                        if (! hostUser.playing.hunt.backPlayers.find(p => p.id == user.id)) {
                            room.send("❌ 이미 전열에 위치해있습니다.");
                        } else {
                            hostUser.playing.hunt.frontPlayers.push(hostUser.playing.hunt.backPlayers.find(p => p.id == user.id));
                            hostUser.playing.hunt.backPlayers.splice(hostUser.playing.hunt.backPlayers.findIndex(p => p.id == user.id), 1);
                            await hostUser.save();
                            room.send("✅ 전열로 이동했습니다.");
                        }
                    } else if (cmd.substr(3) == "뒤") {
                        if (! hostUser.playing.hunt.frontPlayers.find(p => p.id == user.id)) {
                            room.send("❌ 이미 후열에 위치해있습니다.");
                        } else {
                            hostUser.playing.hunt.backPlayers.push(hostUser.playing.hunt.frontPlayers.find(p => p.id == user.id));
                            hostUser.playing.hunt.frontPlayers.splice(hostUser.playing.hunt.frontPlayers.findIndex(p => p.id == user.id), 1);
                            await hostUser.save();
                            room.send("✅ 후열로 이동했습니다.");
                        }
                    }
                }

                if (cmd.startsWith("공격 ")) {
                    if (!hunt.tempObj.last_attack) hunt.tempObj.last_attack = [];
                    if (hostUser.playing.hunt.mobs.length == 0) {
                        room.send("❌ 공격할 대상이 없습니다.\n[ $탐험 ] [ $파티 현황 ] [ $탐험 포기 ]");
                        return;
                    }
                    let num = cmd.substr(3);
                    let target = hostUser.playing.hunt.mobs.find(m => m.number == num);
                    if (hunt.tempObj.attacked_player.includes(user.id)) {
                        if (hunt.tempObj.attacked_player.length >= hunt.player.filter(p => p.alive).length) {
                            hunt.tempObj.attacked_player = [];
                            await hunt.save();
                            room.send("❗ 다시 입력해주세요.");
                            return;
                        }
                        room.send("❌ 이미 공격했습니다.");
                    } else if (!num) {
                        room.send("❌ 번호를 입력해주세요.");
                    } else if (!["1","2","3"].includes(num)) {
                        room.send("❌ 번호는 1 ~ 3 중에서 입력해주세요.");
                    } else if (! target) {
                        room.send("❌ 해당 번호의 몬스터는 존재하지 않습니다.");
                    } else if (! hunt.player.find(p => p.id == user.id).alive) {
                        room.send("❌ 당신은 죽었습니다. 아무런 행동도 할 수 없습니다.");
                    } else {
                        let runnable = new java.lang.Runnable({
                            run: async function() {
                                try {
                                    if (! hunt.tempObj.last_attack.find(p => p.id == user.id)) hunt.tempObj.last_attack.push({id:user.id,last:new Date().toString()});
                                    else hunt.tempObj.last_attack.find(p => p.id == user.id).last = new Date().toString();
                                    hunt.tempObj.attacked_player.push(user.id);
                                    processHunt(hunt.tempObj, user.playing.hunt.number, "m" + num);
                                    if (user.id == hostUser.id) hostUser = await getUserById(hostUser.id);
                                    if (hunt.tempObj.stat["m" + num].hp <= 0) {
                                            hunt.tempObj.logs.push("☠️ " + hunt.tempObj.name["m" + num] + "(이)가 사망했습니다.");
                                            if (hunt.tempObj.weapon[user.playing.hunt.number].name == "소울 하베스터" && hunt.tempObj.weapon[user.playing.hunt.number].tier >= 2) {
                                                if (!hunt.tempObj.stack[user.playing.hunt.number].harvested_soul) {
                                                    hunt.tempObj.stack[user.playing.hunt.number].harvested_soul = true;
                                                    save("DB/harvested_soul/" + hunt.tempObj.name[user.playing.hunt.number] + ".json", "[]");
                                                }
                                                let harvested_soul = JSON.parse(read("DB/harvested_soul/" + hunt.tempObj.name[user.playing.hunt.number] + ".json"));
                                                hunt.tempObj.stat["m" + num].hp = 1;
                                                hunt.tempObj.armor["m" + num].option = [
                                                    {
                                                        name: "모든 피해 감소",
                                                        num: 4
                                                    }
                                                ]
                                                harvested_soul.push({
                                                    name: hunt.tempObj.name["m" + num],
                                                    stat: hunt.tempObj.stat["m" + num],
                                                    weapon: hunt.tempObj.weapon["m" + num],
                                                    armor: hunt.tempObj.armor["m" + num],
                                                    artifact: hunt.tempObj.artifact["m" + num],
                                                    stack: hunt.tempObj.stack["m" + num],
                                                    effect: hunt.tempObj.effect["m" + num]
                                                });
                                                save("DB/harvested_soul/" + hunt.tempObj.name[user.playing.hunt.number] + ".json", JSON.stringify(harvested_soul, null, 4));
                                                hunt.tempObj.logs.push("🤍 " + hunt.tempObj.name[user.playing.hunt.number] + "님이 영혼을 수확했습니다. (영혼 " + harvested_soul.length.toComma() + "개 수확)");
                                                let healnum = Math.round(hunt.tempObj.stat[user.playing.hunt.number].maxHp * 0.05);
                                                hunt.tempObj.stat[user.playing.hunt.number].hp = Math.min(hunt.tempObj.stat[user.playing.hunt.number].hp + healnum, hunt.tempObj.stat[user.playing.hunt.number].maxHp);
                                                hunt.tempObj.logs.push(hunt.tempObj.name[user.playing.hunt.number] + "님의 HP: " + hunt.tempObj.stat[user.playing.hunt.number].hp.toComma() + "/" + hunt.tempObj.stat[user.playing.hunt.number].maxHp.toComma() + " (+" + healnum.toComma() + ")");
                                            }
                                            room.send("🏹 헌터 콜로세움 ⚔️\n" + hunt.tempObj.name[user.playing.hunt.number] + "님이 공격합니다!\n" + VIEWMORE + "\n" + hunt.tempObj.logs.join("\n"));
                                            hostUser.playing.hunt.mobs.splice(hostUser.playing.hunt.mobs.findIndex(m => m.number == num), 1);
                                            let coin = Math.floor(Math.random() * (target.reward.maxCoin - target.reward.minCoin)) + target.reward.minCoin;
                                            let rewardCoin = hostUser.playing.hunt.reward.find(r => r.type == "코인");
                                            if (!rewardCoin) {
                                                hostUser.playing.hunt.reward.push({
                                                    type: "코인",
                                                    count: 0
                                                });
                                                rewardCoin = hostUser.playing.hunt.reward.find(r => r.type == "코인");
                                            }
                                            rewardCoin.count += coin;

                                            target.reward.others.forEach(reward => {
                                                let r = Math.random();
                                                if (r < reward.percent) {
                                                    let count = Math.floor(Math.random() * (reward.maxCount - reward.minCount)) + reward.minCount;
                                                    if (hostUser.playing.hunt.reward.find(item => item.name == reward.name)) {
                                                        if (! hostUser.playing.hunt.reward.find(item => item.name == reward.name).tier) {
                                                            hostUser.playing.hunt.reward.find(item => item.name == reward.name).count += count;
                                                        } else {
                                                            if (hostUser.playing.hunt.reward.find(item => item.name == reward.name + "의 조각")) {
                                                                hostUser.playing.hunt.reward.find(item => item.name == reward.name + "의 조각").count += 100;
                                                            } else {
                                                                let newItem = {
                                                                    name: reward.name + "의 조각",
                                                                    type: "재료",
                                                                    count: 100
                                                                };
                                                                hostUser.playing.hunt.reward.push(newItem);
                                                            }
                                                        }
                                                    } else {
                                                        let newItem = {
                                                            name: reward.name,
                                                            type: reward.type,
                                                            count: count
                                                        };
                                                        if (reward.tier) newItem.tier = reward.tier;
                                                        hostUser.playing.hunt.reward.push(newItem);
                                                    }
                                                }
                                            });
                                    } else if (hunt.tempObj.stat[user.playing.hunt.number].hp <= 0) {
                                            hunt.tempObj.logs.push("☠️ " + hunt.tempObj.name[user.playing.hunt.number] + "(이)가 사망했습니다.");
                                            hunt.player.find(p => p.id == user.id).alive = false;
                                            if (hostUser.playing.hunt.frontPlayers.find(p => p.id == user.id)) {
                                                hostUser.playing.hunt.frontPlayers.splice(hostUser.playing.hunt.frontPlayers.findIndex(p => p.id == user.id), 1);
                                            } else {
                                                hostUser.playing.hunt.backPlayers.splice(hostUser.playing.hunt.backPlayers.findIndex(p => p.id == user.id), 1);
                                            }
                                            if (hunt.player.filter(p => p.alive).length == 0) {
                                                room.send("🏹 헌터 콜로세움 ⚔️\n" + hunt.tempObj.name[user.playing.hunt.number] + "님이 공격합니다!\n" + VIEWMORE + "\n" + hunt.tempObj.logs.join("\n") + "\n\n모든 파티원이 사망하였습니다.");
                                                let rewards = await hunt.end();
                                                room.send("🏹 헌터 콜로세움 ⚔️\n탐험이 종료되었습니다.\n\n[ 획득한 보상 ]\n" + rewards.join("\n"));
                                                return;
                                            } else {
                                                room.send("🏹 헌터 콜로세움 ⚔️\n" + hunt.tempObj.name[user.playing.hunt.number] + "님이 공격합니다!\n" + VIEWMORE + "\n" + hunt.tempObj.logs.join("\n"));
                                            }
                                    } else {
                                        room.send("🏹 헌터 콜로세움 ⚔️\n" + hunt.tempObj.name[user.playing.hunt.number] + "님이 공격합니다!\n" + VIEWMORE + "\n" + hunt.tempObj.logs.join("\n"));
                                    }
                                    if (hostUser.playing.hunt.mobs.length == 0) {
                                        hunt.tempObj.attacked_player = [];
                                        room.send("🏹 헌터 콜로세움 ⚔️\n✅ 모든 적을 마무리했습니다!\n\n[ $탐험 ]");
                                    } else if (hunt.tempObj.attacked_player.length >= hunt.player.filter(p => p.alive).length) {
                                        hunt.tempObj.logs = [];
                                        let isEnd = false;
                                        for (const m of hostUser.playing.hunt.mobs.slice()) {
                                            if (isEnd) break;
                                            if (!(hostUser.playing.hunt.frontPlayers.length || hostUser.playing.hunt.backPlayers.length)) continue;
                                            let targetUser = hostUser.playing.hunt.frontPlayers.length > 0 ? hostUser.playing.hunt.frontPlayers[Math.floor(Math.random() * hostUser.playing.hunt.frontPlayers.length)] : hostUser.playing.hunt.backPlayers[Math.floor(Math.random() * hostUser.playing.hunt.backPlayers.length)];
                                            let targetNum = "p" + (hunt.player.findIndex(p => p.id == targetUser.id) + 1);
                                            processHunt(hunt.tempObj, "m" + m.number, targetNum);
                                            if (hunt.tempObj.stat["m" + m.number].hp <= 0) {
                                                hunt.tempObj.logs.push("☠️ " + hunt.tempObj.name["m" + m.number] + "(이)가 사망했습니다.");
                                                if (hunt.tempObj.weapon[targetNum].name == "소울 하베스터" && hunt.tempObj.weapon[targetNum].tier >= 2) {
                                                    if (!hunt.tempObj.stack[targetNum].harvested_soul) {
                                                        hunt.tempObj.stack[targetNum].harvested_soul = true;
                                                        save("DB/harvested_soul/" + hunt.tempObj.name[targetNum] + ".json", "[]");
                                                    }
                                                    let harvested_soul = JSON.parse(read("DB/harvested_soul/" + hunt.tempObj.name[targetNum] + ".json"));
                                                    hunt.tempObj.stat["m" + m.number].hp = 1;
                                                    hunt.tempObj.armor["m" + m.number].option = [
                                                        {
                                                            name: "모든 피해 감소",
                                                            num: 4
                                                        }
                                                    ]
                                                    harvested_soul.push({
                                                        name: hunt.tempObj.name["m" + m.number],
                                                        stat: hunt.tempObj.stat["m" + m.number],
                                                        weapon: hunt.tempObj.weapon["m" + m.number],
                                                        armor: hunt.tempObj.armor["m" + m.number],
                                                        artifact: hunt.tempObj.artifact["m" + m.number],
                                                        stack: hunt.tempObj.stack["m" + m.number],
                                                        effect: hunt.tempObj.effect["m" + m.number]
                                                    });
                                                    save("DB/harvested_soul/" + hunt.tempObj.name[targetNum] + ".json", JSON.stringify(harvested_soul, null, 4));
                                                    hunt.tempObj.logs.push("🤍 " + hunt.tempObj.name[targetNum] + "님이 영혼을 수확했습니다. (영혼 " + harvested_soul.length.toComma() + "개 수확)");
                                                    let healnum = Math.round(hunt.tempObj.stat[targetNum].maxHp * 0.05);
                                                    hunt.tempObj.stat[targetNum].hp = Math.min(hunt.tempObj.stat[targetNum].hp + healnum, hunt.tempObj.stat[targetNum].maxHp);
                                                    hunt.tempObj.logs.push(hunt.tempObj.name[targetNum] + "님의 HP: " + hunt.tempObj.stat[targetNum].hp.toComma() + "/" + hunt.tempObj.stat[targetNum].maxHp.toComma() + " (+" + healnum.toComma() + ")");
                                                }
                                                let targetMob = hostUser.playing.hunt.mobs.find(mob => mob.number == m.number);
                                                hostUser.playing.hunt.mobs.splice(hostUser.playing.hunt.mobs.findIndex(mob => mob.number == m.number), 1);
                                                let coin = Math.floor(Math.random() * (targetMob.reward.maxCoin - targetMob.reward.minCoin)) + targetMob.reward.minCoin;
                                                let rewardCoin = hostUser.playing.hunt.reward.find(r => r.type == "코인");
                                                if (!rewardCoin) {
                                                    hostUser.playing.hunt.reward.push({
                                                        type: "코인",
                                                        count: 0
                                                    });
                                                    rewardCoin = hostUser.playing.hunt.reward.find(r => r.type == "코인");
                                                }
                                                rewardCoin.count += coin;
                    
                                                targetMob.reward.others.forEach(reward => {
                                                    let r = Math.random();
                                                    if (r < reward.percent) {
                                                        let count = Math.floor(Math.random() * (reward.maxCount - reward.minCount)) + reward.minCount;
                                                        if (hostUser.playing.hunt.reward.find(item => item.name == reward.name)) {
                                                            if (! hostUser.playing.hunt.reward.find(item => item.name == reward.name).tier) {
                                                                hostUser.playing.hunt.reward.find(item => item.name == reward.name).count += count;
                                                            } else {
                                                                if (hostUser.playing.hunt.reward.find(item => item.name == reward.name + "의 조각")) {
                                                                    hostUser.playing.hunt.reward.find(item => item.name == reward.name + "의 조각").count += 100;
                                                                } else {
                                                                    let newItem = {
                                                                        name: reward.name + "의 조각",
                                                                        type: "재료",
                                                                        count: 100
                                                                    };
                                                                    hostUser.playing.hunt.reward.push(newItem);
                                                                }
                                                            }
                                                        } else {
                                                            let newItem = {
                                                                name: reward.name,
                                                                type: reward.type,
                                                                count: count
                                                            };
                                                            if (reward.tier) newItem.tier = reward.tier;
                                                            hostUser.playing.hunt.reward.push(newItem);
                                                        }
                                                    }
                                                });
                                            } else if (hunt.tempObj.stat[targetNum].hp <= 0) {
                                                hunt.tempObj.logs.push("☠️ " + hunt.tempObj.name[targetNum] + "(이)가 사망했습니다.");
                                                hunt.player.find(p => p.id == targetUser.id).alive = false;
                                                if (hostUser.playing.hunt.frontPlayers.find(p => p.id == targetUser.id)) {
                                                    hostUser.playing.hunt.frontPlayers.splice(hostUser.playing.hunt.frontPlayers.findIndex(p => p.id == targetUser.id), 1);
                                                } else {
                                                    hostUser.playing.hunt.backPlayers.splice(hostUser.playing.hunt.backPlayers.findIndex(p => p.id == targetUser.id), 1);
                                                }
                                                if (hunt.player.filter(p => p.alive).length == 0) {
                                                    isEnd = true;
                                                    let rewards = await hunt.end();
                                                    room.send("🏹 헌터 콜로세움 ⚔️\n탐험이 종료되었습니다.\n\n[ 획득한 보상 ]\n" + (rewards.length ? rewards.join("\n") : "보상을 획득하지 못했습니다.") + "\n\n[ 몬스터의 마지막 공격 ]\n" + VIEWMORE + hunt.tempObj.logs.join("\n"));
                                                }
                                        }
                                        }
                                        if (isEnd) return;
                                        hunt.tempObj.attacked_player = [];
                                        if (hostUser.playing.hunt.mobs.length == 0) {
                                            room.send("🏹 헌터 콜로세움 ⚔️\n✅ 모든 적을 마무리했습니다\n\n[ $탐험 ]\n\n[ 몬스터의 마지막 공격 ]\n" + VIEWMORE + hunt.tempObj.logs.join("\n"));
                                        } else {
                                            room.send("🏹 헌터 콜로세움 ⚔️\n몬스터가 공격합니다!\n\n[ 몬스터 공격 결과 ]\n" + VIEWMORE + hunt.tempObj.logs.join("\n"));
                                        }
                                    }
                                    await hostUser.save();
                                    hunt.tempObj.logs = [];
                                    await hunt.save();
                                } catch(e) {
                                    room.send("❌ 오류: " + e + "\n" + VIEWMORE + "\n" + JSON.stringify(e, null, 4));
                                }
                            }
                        });
                        var thread = new java.lang.Thread(runnable);
                        thread.start();
                    }
                }

                if (cmd.startsWith("사용 ")) {
                    if (! hunt.player.find(p => p.id == user.id).alive) {
                        room.send("❌ 당신은 죽었습니다. 아무런 행동도 할 수 없습니다.");
                    } else if ((user.inventory.find(i => i.name == cmd.substr(3)) || {count:0}).count < 1) {
                        room.send("❌ 보유하고 있지 않습니다.");
                    } else if (! JSON.parse(read("DB/food.json")).find(f => f.name == cmd.substr(3))) {
                        room.send("❌ 음식이 아닙니다.");
                    } else if (!read("DB/foods/" + cmd.substr(3) + ".js")) {
                        room.send("❌ 사용 효과가 존재하지 않습니다.\n일시적인 오류이거나 구현되지 않은 음식일 수 있습니다.");
                    } else {
                        user.inventory.find(i => i.name == cmd.substr(3)).count--;
                        await user.save();
                        let eatMessage = ["✅ " + user.name + "님이 " + cmd.substr(3) + (dec_han(cmd.substr(3, 1)).length == 3 ? "을" : "를") + " 사용했습니다!"];
                        eval(read("DB/foods/" + cmd.substr(3) + ".js"));
                        room.send(eatMessage.join("\n"));
                    }
                }

                if (cmd == "탐험 포기") {
                    if (hunt.hostId != user.id) {
                        room.send("❌ 탐험 포기 명령어는 파티장만 입력할 수 있습니다.");
                    } else {
                        let rewards = await hunt.end();
                        room.send("🏹 헌터 콜로세움 ⚔️\n탐험이 종료되었습니다.\n\n[ 획득한 보상 ]\n" + (rewards.length ? rewards.join("\n") : "보상을 획득하지 못했습니다."));
                    }
                }

                if (cmd == "파티 탈퇴") {
                    if (hunt.hostId == user.id) {
                        let rewards = await hunt.end();
                        room.send("🏹 헌터 콜로세움 ⚔️\n탐험이 종료되었습니다.\n\n[ 획득한 보상 ]\n" + (rewards.length ? rewards.join("\n") : "보상을 획득하지 못했습니다."));
                        return;
                    }
                    if (hostUser.playing.hunt.backPlayers.find(p => p.id == user.id)) {
                        hostUser.playing.hunt.backPlayers.splice(hostUser.playing.hunt.backPlayers.findIndex(p => p.id == user.id), 1);
                    } else if (hostUser.playing.hunt.frontPlayers.find(p => p.id == user.id)) {
                        hostUser.playing.hunt.frontPlayers.splice(hostUser.playing.hunt.frontPlayers.findIndex(p => p.id == user.id), 1);
                    }
                    hunt.player.splice(hunt.player.findIndex(p => p.id == user.id), 1);
                    hostUser.playing.hunt.mobs = [];
                    hostUser.playing.hunt.wave--;
                    await hunt.save();
                    await hostUser.save();
                    delete user.playing.hunt;
                    await user.save();
                    room.send("🏹 헌터 콜로세움 ⚔️\n" + user.name + "님이 현재 탐험에서 도망쳤습니다.\n현재 진행하던 전투는 취소되었습니다.\n\n[ $탐험 ]");
                }
            }
        }

        if (colosseum[room.id] && cmd.startsWith("결투")) {
            if (cmd == "결투 퇴장" && colosseum[room.id].h1.id == senderID) {
                if (colosseum[room.id].start) {
                    room.send("❌ 결투중엔 퇴장할 수 없습니다.");
                } else {
                    delete colosseum[room.id];
                    delete user.playing.hunt;
                    await user.save();
                    room.send("✅ 콜로세움에서 나갔습니다.");
                }
            } else if (cmd == "결투 진행" && colosseum[room.id].start && (colosseum[room.id].h1.id == senderID || colosseum[room.id].h2.id == senderID)) {
                let now = new Date();
                if (!colosseum[room.id].last || (now - colosseum[room.id].last) >= 1000) {
                    colosseum[room.id].last = now;
                    let first = colosseum[room.id].h1.id == senderID ? "h1" : "h2";
                    let last = first == "h1" ? "h2" : "h1";
                    processHunt(colosseum[room.id].tempObj, first, last);
                    if (colosseum[room.id].tempObj.stat.h1.hp <= 0) {
                        colosseum[room.id].tempObj.logs.push("☠️ " + colosseum[room.id].h1.name + "님이 패배했습니다.");
                        colosseum[room.id].loser = "h1";
                        colosseum[room.id].winner = "h2";
                    } else if (colosseum[room.id].tempObj.stat.h2.hp <= 0) {
                        colosseum[room.id].tempObj.logs.push("☠️ " + colosseum[room.id].h2.name + "님이 패배했습니다.");
                        colosseum[room.id].loser = "h2";
                        colosseum[room.id].winner = "h1";
                    } else {
                        processHunt(colosseum[room.id].tempObj, last, first);
                        if (colosseum[room.id].tempObj.stat.h1.hp <= 0) {
                            colosseum[room.id].tempObj.logs.push("☠️ " + colosseum[room.id].h1.name + "님이 패배했습니다.");
                            colosseum[room.id].loser = "h1";
                            colosseum[room.id].winner = "h2";
                        } else if (colosseum[room.id].tempObj.stat.h2.hp <= 0) {
                            colosseum[room.id].tempObj.logs.push("☠️ " + colosseum[room.id].h2.name + "님이 패배했습니다.");
                            colosseum[room.id].loser = "h2";
                            colosseum[room.id].winner = "h1";
                        }
                    }
                    colosseum[room.id].turn++;
                    let hps = [
                        colosseum[room.id].tempObj.name.h1 + "님의 HP: " + colosseum[room.id].tempObj.stat.h1.hp.toComma() + "/" + colosseum[room.id].tempObj.stat.h1.maxHp.toComma(),
                        colosseum[room.id].tempObj.name.h2 + "님의 HP: " + colosseum[room.id].tempObj.stat.h2.hp.toComma() + "/" + colosseum[room.id].tempObj.stat.h2.maxHp.toComma()
                    ]
                    room.send("🏹 헌터 콜로세움 ⚔️\n" + colosseum[room.id][first].name + "님이 먼저 공격합니다!\n\n[ 제" + colosseum[room.id].turn + "합 ]\n\n" + hps.join("\n") + "\n" + VIEWMORE + colosseum[room.id].tempObj.logs.join("\n"));
                    await applyCombatSideEffects(colosseum[room.id].tempObj);
                    colosseum[room.id].tempObj.logs = [];
                    if (colosseum[room.id].winner) {
                        let winner = await getUserById(colosseum[room.id][colosseum[room.id].winner].id);
                        let loser = await getUserById(colosseum[room.id][colosseum[room.id].loser].id);
                        let rate = getHunterRate(winner, loser);
                        winner.hunterRate += rate;
                        loser.hunterRate -= rate;
                        winner.initHunterRate = "T";
                        loser.initHunterRate = "T";
                        delete winner.playing.hunt;
                        delete loser.playing.hunt;
                        await winner.save();
                        await loser.save();
                        room.send("🏹 헌터 콜로세움 ⚔️\n승부가 결정되었습니다.\n>> 승자: " + winner.name + "\n\n" + winner.name + " ▶ ⚜️ " + winner.hunterRate.toComma() + " (+" + rate + ")\n" + loser.name + " ▶ ⚜️ " + loser.hunterRate.toComma() + " (-" + rate + ")");
                        delete colosseum[room.id];
                    }
                }
            }
        }
}

// ───────────────────────────────────────────────────────────── $확인 (myCheck 확정) 핸들러
// old_engine.js 9615-10020 의 헌터 관련 분기(강화/초기화/제작/사냥/길드생성/레벨업/옵션/진화/분해).
const HUNTER_CONFIRM_TYPES = ["강화", "초기화", "제작", "사냥", "길드생성", "레벨업", "옵션", "진화", "분해"];
async function handleConfirm(user, channel, senderID, cmd) {
    const room = { id: channel.channelId + "", send: (m) => channel.sendChat(m) };
    if (!(myCheck[senderID] && cmd == "확인")) return false;
    // 헌터 관련 확인 타입이 아니면 건드리지 않는다(다른 시스템의 myCheck 보존).
    if (!HUNTER_CONFIRM_TYPES.includes(myCheck[senderID].type)) return false;
    if (!user) return false;
    if (myCheck[senderID].type == "강화") {
                let item = user.inventory.find(item => item.name == myCheck[senderID].arg.item.name);
                let target = item.name;
                let needs = myCheck[senderID].arg.needs;
                let tiers = myCheck[senderID].arg.tiers;
                let upstone = user.inventory.find(item => item.name == "강화석");
                let piece = user.inventory.find(item => item.name == target + "의 조각");
                let starTicket = user.inventory.find(item => item.name == myCheck[senderID].arg.ticket) || { count: 0 };
                if (upstone.count < needs[item.tier][0] || piece.count < needs[item.tier][1] || user.cash < needs[item.tier][2] || starTicket.count < needs[item.tier][3]) {
                    room.send("❌ 강화 재료가 부족합니다.");
                } else {
                    upstone.count -= needs[item.tier][0];
                    piece.count -= needs[item.tier][1];
                    starTicket.count -= needs[item.tier][3];
                    user.cash -= needs[item.tier][2];
                    let prevTier = item.tier;
                    item.tier = tiers[tiers.indexOf(item.tier) + 1];
                    if (item.evolution && item.tier == "★") {
                        item.tier = "🌙";
                    }
                    if (user.equips.weapon.name == target) {
                        user.equips.weapon.tier = item.tier;
                    } else if (user.equips.armor.name == target) {
                        user.equips.armor.tier = item.tier;
                    }
                    await user.save();
                    if (item.tier.includes("★")) {
                        room.send("🌟 장비가 별의 축복을 받았습니다!\n[" + prevTier + "] " + target + " ▶ [" + item.tier + "] " + target);
                    } else if (item.tier == "🌙") {
                        room.send("🌙 장비에 루나의 힘을 부여했습니다!\n[" + prevTier + "] " + target + " ▶ [" + item.tier + "] " + target);
                    } else {
                        room.send("❇️ 장비를 성공적으로 강화했습니다!\n[" + prevTier + "] " + target + " ▶ [" + item.tier + "] " + target);
                    }
                }
            } else if (myCheck[senderID].type == "초기화") {
                let target = user.inventory.find(item => item.name == myCheck[senderID].arg.item);
                let upstone = myCheck[senderID].arg.upstone;
                let piece = myCheck[senderID].arg.piece;
                let coin = myCheck[senderID].arg.coin;
                let star = myCheck[senderID].arg.star;
                let prevTier = target.tier;
                target.tier = "E";
                if (user.equips.weapon.name == target.name) {
                    user.equips.weapon.tier = "E";
                } else if (user.equips.armor.name == target.name) {
                    user.equips.armor.tier = "E";
                }
                let upstoneItem = user.inventory.find(item => item.name == "강화석");
                if (! upstoneItem) {
                    user.inventory.push({
                        name: "강화석",
                        type: "재료",
                        count: 0
                    });
                    upstoneItem = user.inventory.find(item => item.name == "강화석");
                }
                let pieceItem = user.inventory.find(item => item.name == target.name + "의 조각");
                if (! pieceItem) {
                    user.inventory.push({
                        name: target.name + "의 조각",
                        type: "재료",
                        count: 0
                    });
                    pieceItem = user.inventory.find(item => item.name == target.name + "의 조각");
                }
                let starItem = user.inventory.find(item => item.name == myCheck[senderID].arg.ticket);
                if (!starItem) {
                    user.inventory.push({
                        name: myCheck[senderID].arg.ticket,
                        type: "재료",
                        count: 0
                    });
                    starItem = user.inventory.find(item => item.name == myCheck[senderID].arg.ticket);
                }
                upstoneItem.count += upstone;
                pieceItem.count += piece;
                starItem.count += star;
                user.cash += coin;
                await user.save();
                room.send("❇️ 장비를 성공적으로 초기화했습니다!\n[" + prevTier + "] " + target.name + " ▶ [E] " + target.name);
            } else if (myCheck[senderID].type == "제작") {
                let enough = true;
                myCheck[senderID].arg.material.forEach(m => {
                    let needCount = m.count * myCheck[senderID].arg.num;
                    if (m.name == "코인") {
                        if (user.cash < needCount) {
                            room.send("❌ 재료가 부족합니다.");
                            delete myCheck[senderID];
                            enough = false;
                            return;
                        }
                        user.cash -= needCount;
                    } else {
                        let item = user.inventory.find(i => i.name == m.name);
                        if (! item || item.count < needCount) {
                            room.send("❌ 재료가 부족합니다.");
                            delete myCheck[senderID];
                            enough = false;
                            return;
                        }
                        item.count -= needCount;
                    }
                });
                if (! enough) return;
                myCheck[senderID].arg.item.count *= myCheck[senderID].arg.num;
                let artifact = user.inventory.find(i => i.name == myCheck[senderID].arg.name);
                if (! artifact) {
                    user.inventory.push(myCheck[senderID].arg.item);
                } else {
                    artifact.count += myCheck[senderID].arg.item.count;
                }
                await user.save();
                room.send("✅ " + myCheck[senderID].arg.name + " x" + myCheck[senderID].arg.item.count.toComma() + " 제작에 성공하였습니다!");
            } else if (myCheck[senderID].type == "사냥") {
                if (myCheck[senderID].arg.dungeon == "시련의 회당") {
                    user.inventory.find(i => i.name == "시련의 회당 티켓").count--;
                    await user.save();
                }
                delete huntParty[room.id];
                let tempObj = {
                    name: {},
                    id: {},
                    stat: {},
                    effect: {},
                    stack: {},
                    weapon: {},
                    armor: {},
                    artifact: {},
                    pet: {},
                    logs: [],
                    attacked_player: [],
                    last_attack: []
                }
                let number = 1;
                for (const p of myCheck[senderID].arg.player) {
                    let player = await getUserById(p.id);
                    if (number == 1) {
                        player.playing.hunt = {
                            hostId: user.id,
                            number: "p1",
                            wave: 0,
                            mobs: [],
                            frontPlayers: [],
                            backPlayers: [],
                            reward: []
                        }
                        let i = 0;
                        myCheck[senderID].arg.player.forEach(p => {
                            player.playing.hunt.frontPlayers.push({
                                id: myCheck[senderID].arg.player[i].id,
                                name: myCheck[senderID].arg.player[i].name,
                                alive: true
                            });
                            i++;
                        })
                    } else {
                        player.playing.hunt = {
                            hostId: myCheck[senderID].arg.host.id,
                            number: "p" + number
                        };
                    }
                    await player.save();
                    let myWeapon = JSON.parse(read("DB/weapons/" + player.equips.weapon.name + ".json"));
                    let myArmor = JSON.parse(read("DB/armors/" + player.equips.armor.name + ".json"));
                    tempObj.name["p" + number] = (player.title ? "[" + player.title + "] ":"") + player.name;
                    tempObj.id["p" + number] = player.id;
                    tempObj.stat["p" + number] = {
                        hit: 0.7 + myWeapon[player.equips.weapon.tier].plusStat.hit,
                        cnt: 0.05 + myWeapon[player.equips.weapon.tier].plusStat.cnt,
                        cmb: 0.05 + myWeapon[player.equips.weapon.tier].plusStat.cmb,
                        crt: 0.05 + myWeapon[player.equips.weapon.tier].plusStat.crt,
                        pnt: 0.05 + myWeapon[player.equips.weapon.tier].plusStat.pnt,
                        bld: 0.1 + myWeapon[player.equips.weapon.tier].plusStat.bld,
                        brn: 0 + myWeapon[player.equips.weapon.tier].plusStat.brn,
                        stn: 0 + myWeapon[player.equips.weapon.tier].plusStat.stn,
                        poi: 0 + myWeapon[player.equips.weapon.tier].plusStat.poi,
                        dth: 0.001 + myWeapon[player.equips.weapon.tier].plusStat.dth,
                        hp: Math.round((1000 + myArmor[player.equips.armor.tier].plusStat.hp) * (1 + (0.015 * player.getStat().def))),
                        maxHp: Math.round((1000 + myArmor[player.equips.armor.tier].plusStat.hp) * (1 + (0.015 * player.getStat().def))),
                        shield: 0,
                        def: 0.1 + myArmor[player.equips.armor.tier].plusStat.def,
                        res: 0.1 + myArmor[player.equips.armor.tier].plusStat.res,
                        avd: 0.05 + myArmor[player.equips.armor.tier].plusStat.avd,
                        str: player.getStat().str,
                        int: player.getStat().int,
                        de2: player.getStat().def
                    }
                    tempObj.weapon["p" + number] = {
                        name: player.equips.weapon.name,
                        tier: ['E','D','C','B','A','S','S+','★','🌙'].indexOf(player.equips.weapon.tier),
                        option: player.equips.weapon.option || [],
                        enchant: player.equips.weapon.enchant || []
                    }
                    tempObj.armor["p" + number] = {
                        name: player.equips.armor.name,
                        tier: ['E','D','C','B','A','S','S+','★','🌙'].indexOf(player.equips.armor.tier),
                        option: player.equips.armor.option || [],
                        enchant: player.equips.armor.enchant || []
                    }
                    tempObj.artifact["p" + number] = player.equips.artifact;
                    tempObj.pet["p" + number] = player.pet;
                    tempObj.effect["p" + number] = {};
                    tempObj.stack["p" + number] = {};

                    let artifactPS = JSON.parse(read("DB/artifactPlusStat.json"));
                    tempObj.artifact["p" + number].forEach(arti => {
                        let artifact = artifactPS.find(a => a.name == arti);
                        if (artifact) {
                            for(let ps in artifact.plusStat) {
                                if (ps == 'hp' || ps == 'maxHp' || ps == 'shield') tempObj.stat["p" + number][ps] += artifact.plusStat[ps];
                                else tempObj.stat["p" + number][ps] = Math.min(1, tempObj.stat["p" + number][ps] + artifact.plusStat[ps]);
                            }
                        }
                    });

                    number++;
                }
                let huntGame = new HuntGame(myCheck[senderID].arg.host.id, myCheck[senderID].arg.player, tempObj, myCheck[senderID].arg.dungeon);
                let res = await putItem('hunt', huntGame);
                if (res.success) {
                    room.send("✅ " + myCheck[senderID].arg.player.map(p => p.name).join(", ") + " " + (["한","두","세"][myCheck[senderID].arg.player.length - 1]) + " 명으로 사냥 출정에 나섰습니다.\n사냥 보상은 파티장인 " + myCheck[senderID].arg.host.name + "님에게 지급됩니다.\n\n[ $탐험 ] [ $파티 현황 ]");
                } else {
                    room.send("❌ 사냥 출정에 실패했습니다. 잠시 후 다시 시도해주세요.");
                }
            } else if (myCheck[senderID].type == "길드생성") {
                user.guild = {
                    name: myCheck[senderID].arg.name,
                    host: true
                };
                user.cash -= 200000000;
                await user.save();
                let guilds = JSON.parse(read("DB/guild.json"));
                guilds.push({
                    name: myCheck[senderID].arg.name,
                    host: {
                        name: user.name,
                        id: user.id
                    },
                    members: [],
                    request: []
                });
                save("DB/guild.json", JSON.stringify(guilds, null, 4));
                room.send("✅ 성공적으로 " + myCheck[senderID].arg.name + " 길드를 생성했습니다!");
            } else if (myCheck[senderID].type == "레벨업") {
                let needs = myCheck[senderID].arg.needs;
                let pet = user.inventory.find(i => i.name == myCheck[senderID].arg.name);
                let feed = user.inventory.find(i => i.name == "펫 먹이") || {count:0};
                let starTicket = user.inventory.find(i => i.name == "별의 증표") || {count:0};
                if (!pet || (pet.count - 1) < needs.pet || feed.count < needs.feed || starTicket.count < needs.starTicket) {
                    room.send("❌ 강화 재료가 부족합니다.");
                } else {
                    pet.count -= needs.pet;
                    feed.count -= needs.feed;
                    starTicket.count -= needs.starTicket;
                    pet.level++;
                    let petPlusDamage = JSON.parse(read("DB/pets/" + pet.name + ".json")).plusDamage;
                    pet.damage += petPlusDamage;
                    if (user.pet.name == pet.name) {
                        user.pet = {
                            name: pet.name,
                            damage: pet.damage,
                            level: pet.level
                        }
                    }
                    await user.save();
                    room.send("✅ " + pet.name + (dec_han(pet.name.substr(-1)).length == 3 ? "을" : "를") + " 성공적으로 레벨업시켰습니다!\nLv." + (pet.level - 1) + " " + pet.name + " ▶ " + (pet.level == 100 ? "Lv.MAX" : "Lv." + pet.level) + " " + pet.name);
                }
            } else if (myCheck[senderID].type == "옵션") {
                let upstone = user.inventory.find(item => item.name == "강화석") || { count: 0 };
                if (upstone < 10000) {
                    room.send("❌ 강화석이 부족합니다. (" + upstone.count.toComma() + "/1만)");
                } else {
                    upstone.count -= 10000;
                    let item = user.inventory.find(item => item.name == myCheck[senderID].arg.item.name);
                    let options = ["기본 공격", "연격", "반격", "일격", "스킬", "펫", "물리", "마법", "고정", "도트"];
                    let specialOpt = {
                        "무기": ["방어 무시", "저항 무시", "모든 피해 증가", "즉사"],
                        "갑옷": ["방어", "저항", "모든 피해 감소", "제어 면역"]
                    }
                    let option = [];
                    for(let i = 0; i < 2; i++) {
                        let r = Math.random();
                        let num = 0;
                        if (r < 0.4) {
                            num = (Math.random() * 0.04) + 0.01;
                        } else if (r < 0.75) {
                            num = (Math.random() * 0.03) + 0.05;
                        } else if (r < 0.9) {
                            num = (Math.random() * 0.07) + 0.08;
                        } else if (r < 0.98) {
                            num = (Math.random() * 0.15) + 0.15;
                        } else {
                            num = (Math.random() * 0.2) + 0.3;
                        }
                        let rr = Math.random();
                        let opt = null;
                        if (rr < 0.03) {
                            opt = specialOpt[item.type][Math.floor(Math.random() * specialOpt[item.type].length)];
                            option.push({
                                name: opt,
                                num: num * (opt.startsWith("모든") ? 0.75 : opt == "즉사" ? 0.05 : 0.4)
                            });
                        } else {
                            opt = options[Math.floor(Math.random() * options.length)];
                            if (item.type == "무기" && opt == "도트") opt = "스킬";
                            option.push({
                                name: opt + " 피해 " + (item.type == "무기" ? "증가" : "감소"),
                                num: num * (["연격","반격","일격","펫"].includes(opt) ? 1.5 : opt == "고정" ? 0.5 : 1)
                            });
                        }
                    }
                    item.option = option;
                    if (user.equips.weapon.name == item.name) {
                        user.equips.weapon.option = item.option;
                    } else if (user.equips.armor.name == item.name) {
                        user.equips.armor.option = item.option;
                    }
                    await user.save();
                    room.send("🔯 장비에 옵션을 부여했습니다.\n\n- " + option.map(o => o.name + " +" + (o.num * 100).fix() + "%").join("\n- "));
                }
            } else if (myCheck[senderID].type == "진화") {
                let arcana = user.inventory.find(i => i.name == "아르카나 " + myCheck[senderID].arg.evol.prev) || { count: 0 };
                let star = user.inventory.find(i => i.name == "별빛 각인") || { count: 0 };
                let strong = user.inventory.find(i => i.name == "강함의 증명") || { count: 0 };
                let prevWeapon = user.inventory.find(i => i.name == myCheck[senderID].arg.evol.prev) || { count: 0 };
                if (arcana.count < 1 || star.count < 1 || strong.count < 1 || prevWeapon.count < 1) {
                    room.send("❌ 진화에 필요한 재료를 제대로 보유하고 있어야 합니다.");
                } else if (user.inventory.find(i => i.name == myCheck[senderID].arg.evol.name)) {
                    room.send("❌ 이미 진화 장비를 보유하고 있습니다.");
                } else {
                    arcana.count--;
                    strong.count--;
                    prevWeapon.count = 0;
                    user.inventory.push({
                        name: myCheck[senderID].arg.evol.name,
                        type: prevWeapon.type,
                        count: 1,
                        tier: "E",
                        evolution: {
                            level: 1,
                            prev: myCheck[senderID].arg.evol.prev
                        },
                        option: user.inventory.find(i => i.name == myCheck[senderID].arg.evol.prev).option || []
                    });
                    if (user.equips.weapon.name == myCheck[senderID].arg.evol.prev) {
                        user.equips.weapon = user.inventory.find(i => i.name == myCheck[senderID].arg.evol.name);
                    } else if (user.equips.armor.name == myCheck[senderID].arg.evol.prev) {
                        user.equips.armor = user.inventory.find(i => i.name == myCheck[senderID].arg.evol.name);
                    }
                    await user.save();
                    room.send("⬜ 장비 진화 ⬜\n" + user.name + "님이 별빛 각인의 힘으로 장비를 진화시켰습니다.\n\n[★] " + myCheck[senderID].arg.evol.prev + " ▶ [E] " + myCheck[senderID].arg.evol.name);
                }
            } else if (myCheck[senderID].type == "분해") {
                if (myCheck[senderID].arg.needTool && (user.inventory.find(i => i.name == "분해 도구") || {count:0}).count < myCheck[senderID].arg.num) {
                    room.send("❌ 분해 도구가 필요합니다.");
                } else {
                    let item = user.inventory.find(i => i.name == myCheck[senderID].arg.name) || { count: 0 };
                    if (item.count < myCheck[senderID].arg.item.count) {
                        room.send("❌ 분해할 아이템이 없습니다.");
                    } else {
                        user.inventory.find(i => i.name == myCheck[senderID].arg.name).count -= myCheck[senderID].arg.item.count;
                        if (myCheck[senderID].arg.needTool) user.inventory.find(i => i.name == "분해 도구").count -= myCheck[senderID].arg.num;
                        myCheck[senderID].arg.material.forEach(m => {
                            if (m.name == "코인") {
                                user.cash += m.count;
                            } else {
                                user.giveItem(m);
                            }
                        });
                        await user.save();
                        room.send("✅ " + myCheck[senderID].arg.name + " x" + myCheck[senderID].arg.item.count.toComma() + " 아이템을 성공적으로 분해했습니다!");
                    }
                }
                
            }
            delete myCheck[senderID];
    return true;
}

module.exports = {
    TARGET_CHANNEL_IDS,
    onChat,
    initHunterData,
    getUserById,
    getUserByName,
    getHuntById,
    getHuntersByInitRate
};

// ───────────────────────────────────────────────────────────── 명령 디스패치
const PREFIXS = ["$", "1", "2", "!"];

// 헌터 콜로세움 관련 명령인지 판별 (true 면 onChat 이 handled 로 처리).
function isHunterCommand(cmd) {
    if (cmd.startsWith("헌터")) return true;
    if (["길들이기", "사냥", "도망", "탐험", "탐험 포기"].includes(cmd)) return true;
    if (cmd.startsWith("이동 ") || cmd.startsWith("공격 ") || cmd.startsWith("사용 ") || cmd.startsWith("결투")) return true;
    return false;
}

async function onChat(data, channel) {
    if (!channel || !TARGET_CHANNEL_IDS.includes(channel.channelId + '')) return false;
    const msg = (data.text || '').trim();
    if (!msg || !PREFIXS.includes(msg[0])) return false;
    const cmd = msg.substr(1).trim();
    const isConfirm = (cmd === "확인");
    if (!isConfirm && !isHunterCommand(cmd)) return false;

    const sender = (typeof data.getSenderInfo === 'function' ? data.getSenderInfo(channel) : null) || (data._chat && data._chat.sender);
    if (!sender || !sender.userId) return isConfirm ? false : true;
    const senderId = sender.userId + '';

    await ensureHunterDataLoaded();
    const user = await getUserById(senderId);

    try {
        // $확인: 헌터 관련 myCheck 만 처리하고, 아니면 false 를 반환해 다른 모듈로 넘긴다.
        if (isConfirm) return await handleConfirm(user, channel, senderId, cmd);
        // old_engine 은 매 메시지마다 헌터 블록과 플레이 블록을 순차 실행했다(각 블록은 내부에서 자체 가드).
        if (cmd.startsWith("헌터")) await handleHunter(user, channel, senderId, cmd);
        await handlePlay(user, channel, senderId, cmd);
    } catch (e) {
        console.error('[hunter onChat]', e && (e.stack || e));
    }
    return true;
}
