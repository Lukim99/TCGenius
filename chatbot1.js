const node_kakao = require('node-kakao');
const fs = require('fs');
const AWS = require('aws-sdk');

AWS.config.update({
    region: 'ap-northeast-2',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_KEY_ID
});

const dynamoDB = new AWS.DynamoDB.DocumentClient();
const USER_TABLE_NAME = 'chatbot52_user';
const SAVE_DATA_TABLE_NAME = 'save_data';

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

async function getSaveData(id) {
    try {
        const params = {
            TableName: SAVE_DATA_TABLE_NAME,
            Key: { id: id }
        };
        const result = await dynamoDB.get(params).promise();
        return result.Item?.data || null;
    } catch (error) {
        console.error('Error getting save data:', error);
        return null;
    }
}

async function setSaveData(id, data) {
    try {
        const params = {
            TableName: SAVE_DATA_TABLE_NAME,
            Item: {
                id: id,
                data: data
            }
        };
        await dynamoDB.put(params).promise();
        return data;
    } catch (error) {
        console.error('Error setting save data:', error);
        throw error;
    }
}

async function getUserData(userId) {
    try {
        const params = {
            TableName: USER_TABLE_NAME,
            Key: { userId: userId.toString() }
        };
        const result = await dynamoDB.get(params).promise();
        return result.Item || null;
    } catch (error) {
        console.error('Error getting user data:', error);
        return null;
    }
}

async function saveUserData(userId, userData) {
    try {
        const params = {
            TableName: USER_TABLE_NAME,
            Item: {
                userId: userId.toString(),
                ...userData
            }
        };
        await dynamoDB.put(params).promise();
        return userData;
    } catch (error) {
        console.error('Error saving user data:', error);
        throw error;
    }
}

async function getAllUsers() {
    try {
        const params = {
            TableName: USER_TABLE_NAME
        };
        const result = await dynamoDB.scan(params).promise();
        return result.Items || [];
    } catch (error) {
        console.error('Error scanning users:', error);
        return [];
    }
}

function getUserByName(name) {

}

const view_all = ('\u200e'.repeat(500));

const TARGET_CHANNEL_ID = '18479279168270549';
 let attendanceQueue = Promise.resolve();

function isTargetChannel(channel) {
    return !!channel && channel.channelId + '' === TARGET_CHANNEL_ID;
}

 function enqueueAttendanceTask(task) {
     const run = attendanceQueue.then(() => task(), () => task());
     attendanceQueue = run.catch(() => {});
     return run;
 }

function read(path) {
    try {
        var data = fs.readFileSync(path, 'utf8');
    } catch (e) {
        var data = null;
    }
    return data;
}

function save(path, data) {
    fs.writeFileSync(path, data, 'utf8');
    return data;
}

Array.prototype.shuffle = function () {
    const source_array = this.concat();
    const arrayLength = source_array.length;
    for (let i = arrayLength - 1; i >= 0; i--) {
        const randomIndex = Math.floor(Math.random() * (i + 1));
        [source_array[i], source_array[randomIndex]] = [source_array[randomIndex], source_array[i]];
    }
    return source_array;
}

Array.prototype.remove = function (element) {
    if (this.indexOf(element) == -1)
        return this;
    else {
        this.splice(this.indexOf(element), 1);
        return this;
    }
}

function pad_han(kor, max_len) {
    if (kor.length >= max_len)
        return kor;
    return kor + (new Array(max_len - kor.length + 1).join("ㅤ"));
}

function pad_num(kor, max_len) {
    if (typeof kor != 'string') kor = kor.toString();
    max_len = max_len || 2;
    if (kor.length >= max_len)
        return kor;
    return (new Array(max_len - kor.length + 1).join("0")) + kor;
}

Date.prototype.toYYYYMMDD = function () {
    return this.getFullYear() + "-" + pad_num(this.getMonth() + 1) + "-" + pad_num(this.getDate());
}

Date.prototype.toYYMMDD = function () {
    return this.getFullYear().toString().slice(-2) + "." + pad_num(this.getMonth() + 1) + "." + pad_num(this.getDate());
}

Date.prototype.getKoreanTime = function () {
    const curr = new Date();
    const utc = curr.getTime() + (curr.getTimezoneOffset() * 60 * 1000);
    const korea = new Date(utc + (3600000 * 9));
    return korea;
}

function numberWithCommas(x) {
    return x.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

Number.prototype.toComma = function () {
    return this.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
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
        case 48:
        case 54:
        case 59:
        case 62:
            c += 5292;
            break;
        // 랴, 려, 례, 료, 류, 리
        case 107:
        case 111:
        case 112:
        case 117:
        case 122:
        case 125:
            c += 3528;
            break;
        // 라, 래, 로, 뢰, 루, 르
        case 105:
        case 106:
        case 113:
        case 116:
        case 118:
        case 123:
            c -= 1764;
            break;
    }
    return String.fromCharCode(c) + s.slice(1);
}

function dec_han(s) {
    if (s.match(/[^가-힣ㄱ-ㅎ]/gi) != null)
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
    if (s.match(/[^가-힣ㄱ-ㅎㅏ-ㅣ]/gi) != null)
        return s;
    let cho = CHOSEONG.indexOf(s[0]);
    let jung = JUNGSEONG.indexOf(s[1]);
    let jong = (s[2] == undefined ? 0 : JONGSEONG.indexOf(s[2]));

    return String.fromCharCode(0xAC00 + cho * 588 + jung * 28 + jong);
}

Date.prototype.toDateString = function (showYear = true, showTime = true) {
    let y = this.getFullYear();
    let m = this.getMonth() + 1;
    let d = this.getDate();
    let yo = "일월화수목금토"[this.getDay()];
    let h = this.getHours();
    let ampm = h >= 12 ? "오후" : "오전";
    if (h > 12) h -= 12;
    if (h == 0) h = 12;
    let minutes = this.getMinutes();
    let sec = this.getSeconds();
    return `${showYear ? `${y}년 ` : ""}${m}월 ${d}일(${yo})${showTime ? ` ${ampm} ${pad_num(h.toString(), 2)}:${pad_num(minutes.toString(), 2)}:${pad_num(sec.toString(), 2)}` : ""}`;
}

function getRequiredExp(level) {
    if (level >= 1 && level <= 5) return 200;
    if (level >= 6 && level <= 10) return 300;
    if (level >= 11 && level <= 15) return 400;
    if (level >= 16 && level <= 20) return 500;
    if (level >= 21 && level <= 25) return 600;
    if (level >= 26 && level <= 30) return 800;
    if (level >= 31 && level <= 35) return 1000;
    if (level >= 36 && level <= 40) return 1200;
    if (level >= 41 && level <= 45) return 1500;
    if (level >= 46 && level <= 50) return 1800;
    if (level >= 51 && level <= 99) return 1800;
    return 1800;
}

function getLevelEmoji(level) {
    if (level >= 1 && level <= 5) return '🖤';
    if (level >= 6 && level <= 10) return '🩶';
    if (level >= 11 && level <= 15) return '💜';
    if (level >= 16 && level <= 20) return '🩵';
    if (level >= 21 && level <= 25) return '💙';
    if (level >= 26 && level <= 30) return '💚';
    if (level >= 31 && level <= 35) return '💛';
    if (level >= 36 && level <= 40) return '🧡';
    if (level >= 41 && level <= 45) return '🩷';
    if (level >= 46 && level <= 50) return '❤️';
    if (level >= 51 && level <= 99) return '🌈';
    return '🌈';
}

async function isNameDuplicated(name, currentUserId) {
    const allUsers = await getAllUsers();
    for (const userData of allUsers) {
        if (userData.userId === currentUserId.toString()) continue;

        if (userData.info?.name === name) {
            return true;
        }
    }
    return false;
}

function checkLevelUp(user_data) {
    const requiredExp = getRequiredExp(user_data.level);
    let leveledUp = false;

    while (user_data.exp >= requiredExp && user_data.level < 99) {
        user_data.exp -= requiredExp;
        user_data.level++;
        leveledUp = true;
    }

    return leveledUp;
}

 function isAttendedOnDate(userData, dateText) {
     if (!userData) return false;
     if (userData.last_attend_date === dateText) return true;
     if (!userData.last_attend) return false;
     return new Date(userData.last_attend).toYYYYMMDD() == dateText;
 }

 function getAttendanceRankValue(userData, dateText) {
     if (userData?.last_attend_date === dateText && Number.isFinite(userData?.last_attend_rank)) {
         return userData.last_attend_rank;
     }
     return null;
 }

 function getAttendanceTimeValue(userData) {
     if (Number.isFinite(userData?.last_attend_ts)) {
         return userData.last_attend_ts;
     }
     if (!userData?.last_attend) {
         return Number.MAX_SAFE_INTEGER;
     }
     const parsed = new Date(userData.last_attend).getTime();
     return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
 }

function isHandledCommand(msg) {
    if (!msg) return false;
    return msg === "/출석"
        || msg === "/출석순위"
        || msg === "/레벨순위"
        || msg === "/내소개"
        || msg === "/레벨표"
        || msg === "/내레벨"
        || msg === "/외출"
        || msg === "/커플"
        || msg === "/성비"
        || msg.startsWith("/소개 ")
        || msg.startsWith("/잠수 ")
        || msg.startsWith("/삭제 ")
        || msg.startsWith("/정보수정 ")
        || msg.startsWith("/커플등록 ")
        || msg.startsWith("/커플해제 ")
        || msg.startsWith("/명상 ")
        || msg.startsWith("/경험치추가 ")
        || msg.startsWith("/내정보수정")
        || msg.startsWith("/닉변 ")
        || (/^\/\d{4}채팅 /.test(msg))
        || (/^\/\d{4}채팅수$/.test(msg))
        || (/^\/입방\d{4}$/.test(msg))
        || msg.startsWith("/지역 ")
        || (/^\/[a-zA-Z]{4}$/i.test(msg));
}

async function _handleChatMessage(data, channel, context = {}) {
    const client = context.client;
    try {
        const msg = (data.text || '').trim();
        const sender = data.getSenderInfo(channel) || data._chat?.sender;
        const bot = client ? channel.getUserInfo(client._clientUser) : null;
        const room = channel.getDisplayName();
        const roomid = channel.channelId;
        const roomtype = (channel._channel.info == undefined ? "OM" : channel._channel.info.type);
        const isReply = (data.originalType === node_kakao.KnownChatType.REPLY);

        if (true) {
            if (!sender) {
                if (data.text.startsWith("/")) {
                    channel.sendChat("알 수 없는 오류가 발생했습니다.");
                }
                return;
            }

            if (!bot) {
                if (data.text.startsWith("/")) {
                    channel.sendChat("알 수 없는 오류가 발생했습니다.");
                }
                return;
            }

            if (msg.startsWith(">test ")) {
                try {
                    let cmd = msg.substr(6);
                    let evalResult = await eval(cmd);
                    channel.sendChat(evalResult?.toString() || "결과 없음");
                } catch (e) {
                    channel.sendChat(`에러 발생: ${e}`);
                }
            }

            const currentYearMonth = new Date().getKoreanTime().getFullYear() + '-' + pad_num((new Date().getKoreanTime().getMonth() + 1).toString(), 2);
            let lastReset = await getSaveData('last_reset');
            if (!lastReset) {
                lastReset = { yearMonth: null };
            }

            if (lastReset.yearMonth !== currentYearMonth) {
                const allUsers = await getAllUsers();
                for (const userData of allUsers) {
                    userData.level = 1;
                    userData.exp = 0;
                    userData.total_chat = 0;
                    await saveUserData(userData.userId, userData);
                }

                lastReset.yearMonth = currentYearMonth;
                await setSaveData('last_reset', lastReset);
            }

            let user_data = await getUserData(sender.userId);
            if (!user_data) {
                const newName = sender.nickname.split(" ")[0];

                if (await isNameDuplicated(newName, sender.userId)) {
                    channel.sendChat(`${newName}친구! 그 이름은 이미 사용중이야. 다른 이름으로 바꿔줘!`);
                    return;
                }

                user_data = {
                    nickname: sender.nickname,
                    last_attend: null,
                    entry_log: [{
                        type: "입장",
                        date: new Date().getKoreanTime().toString(),
                        name: sender.nickname
                    }],
                    info: {
                        name: newName,
                        role: "친구",
                        date: new Date().getKoreanTime().toYYMMDD(),
                        mbti: null,
                        gender: sender.nickname.split(" ")[1]?.includes("남") ? "남자" : (sender.nickname.split(" ")[1]?.includes("여") ? "여자" : null),
                        address: null,
                        gimidol: null,
                        isExit: {
                            type: null
                        },
                        couple: {
                            type: null,
                            target: null,
                            emoji: null
                        },
                        titles: [
                            null,
                            null,
                            null,
                            null,
                            null
                        ]
                    },
                    level: 1,
                    exp: 0,
                    total_chat: 0,
                    last_chat: null,
                    profile_change_log: [],
                    daily_chat_log: {},
                    max_level: 1,
                    rainbow_stack: 0,
                    meditation: null
                };
            }

            const reply = str => {
                if (roomtype != "OM") {
                    channel.sendChat(
                        new node_kakao.ChatBuilder()
                        .append(new node_kakao.ReplyContent(data.chat))
                        .text(str)
                        .build(node_kakao.KnownChatType.REPLY)
                    );
                } else {
                    channel.sendChat(new node_kakao.ChatBuilder().text("⤷ ").append(new node_kakao.MentionContent(channel.getUserInfo(sender))).text(`님에게 답장\n\n${str}`).build(node_kakao.KnownChatType.TEXT));
                }
            }
            const sendChat = (str, mids) => {
                if (!mids)
                    channel.sendChat(str);
                else {
                    if (mids === true) {
                        var _mentions = [];
                        for (const channel_user of channel.getAllUserInfo()) {
                            _mentions.push({ "user_id": channel_user.userId, "at": [1], "len": 3 });
                        }
                        channel.sendChat(new node_kakao.ChatBuilder().text(str).attachment({ "mentions": _mentions }).build(node_kakao.KnownChatType.TEXT));
                    } else if (typeof mids == "object") {
                        var _mentions = [];
                        for (const ID of mids) {
                            _mentions.push({ "user_id": ID, "at": [1], "len": 3 });
                        }
                        channel.sendChat(new node_kakao.ChatBuilder().text(str).attachment({ "mentions": _mentions }).build(node_kakao.KnownChatType.TEXT));
                    }
                }
            }

            if (msg == "/출석") {
                const attendanceResult = await enqueueAttendanceTask(async () => {
                    const today = new Date().getKoreanTime().toYYYYMMDD();
                    const queuedUserData = await getUserData(sender.userId) || user_data;

                    if (isAttendedOnDate(queuedUserData, today)) {
                        return {
                            alreadyAttended: true,
                            attendTime: queuedUserData.last_attend ? new Date(queuedUserData.last_attend) : new Date().getKoreanTime(),
                            userData: queuedUserData
                        };
                    }

                    const allUsers = await getAllUsers();
                    const attendRank = allUsers.filter(user => isAttendedOnDate(user, today)).length + 1;
                    const attendTime = new Date().getKoreanTime();

                    queuedUserData.last_attend = attendTime.toString();
                    queuedUserData.last_attend_date = today;
                    queuedUserData.last_attend_rank = attendRank;
                    queuedUserData.last_attend_ts = Date.now();

                    await saveUserData(sender.userId, queuedUserData);

                    return {
                        alreadyAttended: false,
                        attendTime,
                        attendRank,
                        userData: queuedUserData
                    };
                });

                user_data = attendanceResult.userData;

                if (attendanceResult.alreadyAttended) {
                    channel.sendChat(`💞 출석체크 되어있어! 💞\n닉네임: ${sender.nickname}`);
                } else {
                    channel.sendChat(`💞 출석체크 완료 💞\n닉네임: ${sender.nickname}\n출석일: ${attendanceResult.attendTime.toDateString()}`);
                }
            }

            else if (msg == "/출석순위") {
                const attendanceRankMessage = await enqueueAttendanceTask(async () => {
                    const today = new Date().getKoreanTime().toYYYYMMDD();
                    const userList = (await getAllUsers())
                        .filter(user => user.entry_log && user.entry_log.length > 0 && user.entry_log[user.entry_log.length - 1].type === '입장');

                    let rank = [];
                    userList.forEach(user => {
                        if (isAttendedOnDate(user, today)) {
                            rank.push({
                                nickname: user.nickname || '알 수 없음',
                                rankValue: getAttendanceRankValue(user, today),
                                attendTimeValue: getAttendanceTimeValue(user)
                            });
                        }
                    });

                    rank.sort((a, b) => {
                        if (a.rankValue != null && b.rankValue != null) {
                            return a.rankValue - b.rankValue;
                        }
                        if (a.rankValue != null) return -1;
                        if (b.rankValue != null) return 1;
                        return a.attendTimeValue - b.attendTimeValue;
                    });

                    return `🎖️오늘 출석 순위🎖️\n${rank.map((r, index) => `${index + 1}위: ${r.nickname}`).join("\n")}`;
                });

                channel.sendChat(attendanceRankMessage);
            }

            else if (msg == "/레벨순위") {
                const userList = (await getAllUsers())
                    .filter(user => user.entry_log && user.entry_log.length > 0 && user.entry_log[user.entry_log.length - 1].type === '입장');

                const levelRank = userList
                    .map(user => ({
                        nickname: user.nickname || '알 수 없음',
                        level: user.level || 1,
                        exp: user.exp || 0
                    }))
                    .sort((a, b) => {
                        if (b.level !== a.level) {
                            return b.level - a.level;
                        }
                        return b.exp - a.exp;
                    });

                const rankList = levelRank.map((user, index) => {
                    const emoji = getLevelEmoji(user.level);
                    return `${index + 1}위: ${user.nickname} - Lv.${user.level} ${emoji}`;
                });

                channel.sendChat(`🏆 레벨 순위 TOP 50 🏆\n(1위 - 10위)\n${rankList.slice(0, 10).join("\n")}${rankList.length > 10 ? `\n${view_all}\n🔽 (11위 - 50위)\n${rankList.slice(10, 50).join("\n")}` : ""}`);
            }

            else if (msg == "/내소개") {
                let roleText = "";
                if (sender.perm == 4 || sender.perm == 1) {
                    roleText = sender.perm == 4 ? "\n우리방 부방장 ⭐" : "\n우리방 방장 ⭐";
                }

                const infoLines = [];
                const displayName = user_data.info.name || '(이름없음)';
                infoLines.push(`내 소개야 ✨ ${displayName}${roleText}`);
                infoLines.push(`[ ${user_data.info.date} ▪ MBTI: ${user_data.info.mbti?.toUpperCase() || '미등록'} ]`);

                const details = [
                    user_data.info.address,
                    user_data.info.gimidol,
                    user_data.info.gender ? `${user_data.info.gender}친구` : null
                ].filter(Boolean).join(' ');

                // 최고 레벨 기준 이모지 (무지개는 스택만큼 반복)
                const maxLevel = user_data.max_level || user_data.level;
                const rainbowStack = user_data.rainbow_stack || 0;
                let levelEmoji = getLevelEmoji(maxLevel);
                if (maxLevel >= 51 && rainbowStack > 0) {
                    levelEmoji = levelEmoji.repeat(rainbowStack);
                }

                if (details) {
                    infoLines.push(`${details} ${levelEmoji}`);
                } else {
                    infoLines.push("정보 입력해줘!")
                }

                const extraInfo = [
                    user_data.info.isExit?.type ? `${user_data.info.isExit.type}친구` : null,
                    user_data.info.couple?.type ? 
                        user_data.info.couple.type + '커플' + (user_data.info.couple.emoji ? ` ${user_data.info.couple.emoji}` : '') 
                        : null
                ].filter(Boolean).join(' ');

                if (extraInfo) {
                    //infoLines.push(extraInfo);
                }

                const titles = user_data.info.titles.filter(Boolean);
                if (titles.length > 0) {
                    infoLines.push(...titles);
                }

                channel.sendChat(infoLines.join('\n'));
            }

            else if (msg == "/레벨표") {
                const levelTable = [
                    "💎레벨 구간표💎",
                    `Lv.01~05 : ${getLevelEmoji(1)}`,
                    `Lv.06~10 : ${getLevelEmoji(6)}`,
                    `Lv.11~15 : ${getLevelEmoji(11)}`,
                    `Lv.16~20 : ${getLevelEmoji(16)}`,
                    `Lv.21~25 : ${getLevelEmoji(21)}`,
                    `Lv.26~30 : ${getLevelEmoji(26)}`,
                    `Lv.31~35 : ${getLevelEmoji(31)}`,
                    `Lv.36~40 : ${getLevelEmoji(36)}`,
                    `Lv.41~45 : ${getLevelEmoji(41)}`,
                    `Lv.46~50 : ${getLevelEmoji(46)}`,
                    `Lv.51~99 : ${getLevelEmoji(51)}`
                ].join('\n');

                channel.sendChat(levelTable);
            }

            else if (msg.startsWith("/소개 ")) {
                const targetName = msg.substring(4).trim();

                if (!targetName) {
                    channel.sendChat("❌ 이름을 입력해줘!");
                    return;
                }

                const allUsers = await getAllUsers();
                let targetUserData = null;
                let targetUserInfo = null;

                for (const userData of allUsers) {
                    if (userData.info?.name === targetName) {
                        targetUserData = userData;
                        for (const channelUser of channel.getAllUserInfo()) {
                            if (userData.userId === channelUser.userId.toString()) {
                                targetUserInfo = channelUser;
                                break;
                            }
                        }
                        break;
                    }
                }

                if (!targetUserData) {
                    channel.sendChat(`❌ "${targetName}" 이름을 가진 친구를 찾을 수 없어!`);
                    return;
                }

                let roleText = "";
                if (targetUserInfo && (targetUserInfo.perm == 4 || targetUserInfo.perm == 1)) {
                    roleText = targetUserInfo.perm == 4 ? "\n우리방 부방장 ⭐" : "\n우리방 방장 ⭐";
                }

                const infoLines = [];
                infoLines.push(`내 친구 ✨ ${targetUserData.info.name} 소개${roleText}`);
                infoLines.push(`[ ${targetUserData.info.date} ▪ MBTI: ${targetUserData.info.mbti?.toUpperCase() || '미등록'} ]`);

                const details = [
                    targetUserData.info.address,
                    targetUserData.info.gimidol,
                    targetUserData.info.gender ? `${targetUserData.info.gender}친구` : null
                ].filter(Boolean).join(' ');

                const maxLevel = targetUserData.max_level || targetUserData.level;
                const rainbowStack = targetUserData.rainbow_stack || 0;
                let levelEmoji = getLevelEmoji(maxLevel);
                if (maxLevel >= 51 && rainbowStack > 0) {
                    levelEmoji = levelEmoji.repeat(rainbowStack);
                }

                if (details) {
                    infoLines.push(`${details} ${levelEmoji}`);
                } else {
                    infoLines.push("정보 입력해줘!")
                }

                const extraInfo = [
                    targetUserData.info.isExit?.type ? `${targetUserData.info.isExit.type}친구` : null,
                    targetUserData.info.couple?.type ? 
                        targetUserData.info.couple.type + '커플' + (targetUserData.info.couple.emoji ? ` ${targetUserData.info.couple.emoji}` : '') 
                        : null
                ].filter(Boolean).join(' ');

                if (extraInfo) {
                    //infoLines.push(extraInfo);
                }

                const titles = targetUserData.info.titles.filter(Boolean);
                if (titles.length > 0) {
                    infoLines.push(...titles);
                }

                channel.sendChat(infoLines.join('\n'));
            }

            else if (msg == "/내레벨") {
                const levelEmoji = getLevelEmoji(user_data.level);
                const requiredExp = getRequiredExp(user_data.level);
                const remainingExp = requiredExp - user_data.exp;

                const levelInfo = [
                    `📘 ${sender.nickname} 레벨 정보`,
                    `레벨 : ${user_data.level} ${levelEmoji}`,
                    `총 채팅수 : ${user_data.total_chat.toComma()}개`,
                    `진행도 : ${user_data.exp.toComma()} / ${requiredExp.toComma()}`,
                    `다음 레벨까지 : ${remainingExp.toComma()}개`
                ].join('\n');

                channel.sendChat(levelInfo);
            }

            else if (msg == "/외출") {
                const userList = (await getAllUsers())
                    .filter(user => user.entry_log && user.entry_log.length > 0 && user.entry_log[user.entry_log.length - 1].type === '입장');

                const exitUsers = [];
                const inoutUsers = [];

                userList.forEach(user => {
                    const name = user.info?.name;
                    const exitInfo = user.info?.isExit;

                    if (!name || !exitInfo || !exitInfo.type) return;

                    if (exitInfo.type === "외출") {
                        exitUsers.push(name);
                    } else if (exitInfo.type === "출퇴") {
                        inoutUsers.push(name);
                    }
                });

                const result = [];

                if (exitUsers.length > 0) {
                    result.push(`📌 외출 (${exitUsers.length}명)`);
                    const exitLines = [];
                    for (let i = 0; i < exitUsers.length; i += 3) {
                        const line = exitUsers.slice(i, i + 3).map(n => `◼️ ${n}`).join(' ');
                        exitLines.push(`    ${line}`);
                    }
                    result.push(exitLines.join('\n'));
                }

                if (inoutUsers.length > 0) {
                    result.push(`📌 출퇴 (${inoutUsers.length}명)`);
                    const inoutLines = [];
                    for (let i = 0; i < inoutUsers.length; i += 3) {
                        const line = inoutUsers.slice(i, i + 3).map(n => `◼️ ${n}`).join(' ');
                        inoutLines.push(`    ${line}`);
                    }
                    result.push(inoutLines.join('\n'));
                }

                if (result.length > 0) {
                    channel.sendChat(result.join('\n\n'));
                } else {
                    channel.sendChat('현재 외출/출퇴 친구가 없어🥺');
                }
            }

            else if (msg == "/커플") {
                const userList = (await getAllUsers())
                    .filter(user => user.entry_log && user.entry_log.length > 0 && user.entry_log[user.entry_log.length - 1].type === '입장');

                const publicCouples = [];
                const privateCouples = [];
                const outsideCouples = [];
                const processed = new Set();

                userList.forEach(user => {
                    const name = user.info?.name;
                    const coupleInfo = user.info?.couple;

                    if (!name || !coupleInfo || !coupleInfo.type) return;

                    if (coupleInfo.type === "공개") {
                        const partner = coupleInfo.target;
                        if (partner) {
                            const coupleKey = [name, partner].sort().join('-');
                            if (!processed.has(coupleKey)) {
                                publicCouples.push(`    ◼️ ${name} ♥️ ${partner}`);
                                processed.add(coupleKey);
                            }
                        }
                    } else if (coupleInfo.type === "일방") {
                        const partner = coupleInfo.target;
                        const emoji = coupleInfo.emoji || '💕';
                        if (partner) {
                            const coupleKey = [name, partner].sort().join('-');
                            if (!processed.has(coupleKey)) {
                                privateCouples.push(`    ◼️ ${name} ${emoji} ${partner}`);
                                processed.add(coupleKey);
                            }
                        }
                    } else if (coupleInfo.type === "바깥") {
                        outsideCouples.push(name);
                    }
                });

                const result = [];

                if (publicCouples.length > 0) {
                    result.push(`🚩 공식커플 (${publicCouples.length})`);
                    result.push(publicCouples.join('\n'));
                }

                if (privateCouples.length > 0) {
                    result.push(`🚩 일방커플 (${privateCouples.length})`);
                    result.push(privateCouples.join('\n'));
                }

                if (outsideCouples.length > 0) {
                    result.push(`🚩 바깥커플 (${outsideCouples.length})`);
                    const outsideLines = [];
                    for (let i = 0; i < outsideCouples.length; i += 3) {
                        const line = outsideCouples.slice(i, i + 3).map(n => `◼️ ${n}`).join(' ');
                        outsideLines.push(`    ${line}`);
                    }
                    result.push(outsideLines.join('\n'));
                }

                if (result.length > 0) {
                    channel.sendChat(result.join('\n\n'));
                } else {
                    channel.sendChat('현재 등록된 커플이 없어🥺');
                }
            }

            else if (msg.startsWith("/잠수 ")) {
                const daysMatch = msg.match(/^\/잠수 (\d+)$/);
                if (daysMatch) {
                    const days = parseInt(daysMatch[1]);
                    const now = new Date();
                    const threshold = new Date(now.getTime() - (days * 24 * 60 * 60 * 1000));

                    const userList = (await getAllUsers())
                        .filter(user => user.entry_log && user.entry_log.length > 0 && user.entry_log[user.entry_log.length - 1].type === '입장');

                    const inactiveUsers = userList
                        .filter(user => {
                            if (!user.last_chat) return true;
                            const lastChatDate = new Date(user.last_chat);
                            return lastChatDate < threshold;
                        })
                        .map(user => ({
                            name: user.info?.name || user.nickname || '알 수 없음',
                            lastChat: user.last_chat
                        }))
                        .sort((a, b) => {
                            if (!a.lastChat && !b.lastChat) return 0;
                            if (!a.lastChat) return -1;
                            if (!b.lastChat) return 1;
                            return new Date(a.lastChat) - new Date(b.lastChat);
                        });

                    if (inactiveUsers.length > 0) {
                        const userLines = inactiveUsers.map(user => {
                            const lastChatStr = user.lastChat 
                                ? new Date(user.lastChat).toDateString(true, true)
                                : '기록 없음';
                            return `· ${user.name} ㅡ 마지막 대화: ${lastChatStr}`;
                        });

                        channel.sendChat(`⌛ 최근 ${days}일 잠수자 (${inactiveUsers.length}명)\n${view_all}\n\n${userLines.join('\n')}`);
                    } else {
                        channel.sendChat(`⌛ 최근 ${days}일 잠수자가 없어!`);
                    }
                }
            }

            else if (msg.startsWith("/삭제 ")) {
                if (!(sender.perm == 4 || sender.perm == 1)) {
                    channel.sendChat("❌ 관리자만 사용할 수 있는 명령어야.");
                } else {
                    const targetName = msg.substring(4).trim();

                    if (!targetName) {
                        channel.sendChat("❌ 이름을 입력해줘!");
                        return;
                    }

                    const allUsers = await getAllUsers();
                    let targetUserData = null;
                    let targetUserId = null;

                    for (const userData of allUsers) {
                        if (userData.info?.name === targetName) {
                            targetUserData = userData;
                            targetUserId = userData.userId;
                            break;
                        }
                    }

                    if (!targetUserData) {
                        channel.sendChat(`❌ "${targetName}" 이름을 가진 친구를 찾을 수 없어!`);
                        return;
                    }
                }
            }

            else if (msg.startsWith("/정보수정 ")) {
                if (!(sender.perm == 4 || sender.perm == 1)) {
                    channel.sendChat("❌ 관리자만 사용할 수 있는 명령어야.");
                } else {
                    const lines = msg.split('\n');
                    const firstLine = lines[0].trim();
                    const targetName = firstLine.substring(6).trim();

                    if (!targetName) {
                        channel.sendChat("❌ 이름을 입력해줘!");
                        return;
                    }

                    const allUsers = await getAllUsers();
                    let targetUserData = null;
                    let targetUserId = null;

                    for (const userData of allUsers) {
                        if (userData.info?.name === targetName) {
                            targetUserData = userData;
                            targetUserId = userData.userId;
                            break;
                        }
                    }

                    if (!targetUserData) {
                        channel.sendChat(`❌ "${targetName}" 이름을 가진 친구를 찾을 수 없어!`);
                        return;
                    }

                    const validMBTI = ['ISTJ', 'ISFJ', 'INFJ', 'INTJ', 'ISTP', 'ISFP', 'INFP', 'INTP', 
                                       'ESTP', 'ESFP', 'ENFP', 'ENTP', 'ESTJ', 'ESFJ', 'ENFJ', 'ENTJ'];
                    const validGimidol = ['기혼', '미혼', '돌싱'];
                    const validGender = ['남자', '여자'];
                    const validExit = ['외출', '출퇴'];

                    let errors = [];
                    let updates = [];

                    for (let i = 1; i < lines.length; i++) {
                        const line = lines[i].trim();
                        if (!line) continue;

                        const colonIndex = line.indexOf(':');
                        if (colonIndex === -1) continue;

                        const key = line.substring(0, colonIndex).trim();
                        const value = line.substring(colonIndex + 1).trim();

                        if (!value) continue;

                        if (key === '이름') {
                            if (value === 'X' || value === 'x') {
                                targetUserData.info.name = null;
                                updates.push(`이름 → 제거`);
                            } else {
                                if (await isNameDuplicated(value, targetUserId)) {
                                    errors.push(`"${value}" 이름은 이미 사용중이야!`);
                                } else {
                                    targetUserData.info.name = value;
                                    updates.push(`이름 → ${value}`);
                                }
                            }
                        } else if (key === '날짜') {
                            if (/^\d{2}\.\d{2}\.\d{2}$/.test(value)) {
                                targetUserData.info.date = value;
                                updates.push(`날짜 → ${value}`);
                            } else {
                                errors.push(`날짜 형식이 올바르지 않아! (YY.MM.DD)`);
                            }
                        } else if (key === 'MBTI') {
                            const mbtiUpper = value.toUpperCase();
                            if (value === 'x' || value === 'X') {
                                targetUserData.info.mbti = null;
                                updates.push(`MBTI → 제거`);
                            } else if (validMBTI.includes(mbtiUpper)) {
                                targetUserData.info.mbti = mbtiUpper;
                                updates.push(`MBTI → ${mbtiUpper}`);
                            } else {
                                errors.push(`MBTI를 제대로 입력해줘!`);
                            }
                        } else if (key === '사는곳') {
                            if (value === 'X' || value === 'x') {
                                targetUserData.info.address = null;
                                updates.push(`사는곳 → 제거`);
                            } else {
                                targetUserData.info.address = value;
                                updates.push(`사는곳 → ${value}`);
                            }
                        } else if (key === '기미돌') {
                            if (value === 'X' || value === 'x') {
                                targetUserData.info.gimidol = null;
                                updates.push(`기미돌 → 제거`);
                            } else if (validGimidol.includes(value)) {
                                targetUserData.info.gimidol = value;
                                updates.push(`기미돌 → ${value}`);
                            } else {
                                errors.push(`기미돌을 제대로 입력해줘! (기혼/미혼/돌싱)`);
                            }
                        } else if (key === '성별') {
                            if (validGender.includes(value)) {
                                targetUserData.info.gender = value;
                                updates.push(`성별 → ${value}`);
                            } else {
                                errors.push(`성별을 제대로 입력해줘! (남자/여자)`);
                            }
                        } else if (key === '외출상태') {
                            if (value === 'X' || value === 'x') {
                                targetUserData.info.isExit.type = null;
                                updates.push(`외출상태 → 초기화`);
                            } else if (validExit.includes(value)) {
                                targetUserData.info.isExit.type = value;
                                updates.push(`외출상태 → ${value}`);
                            } else {
                                errors.push(`외출상태를 제대로 입력해줘! (외출/출퇴)`);
                            }
                        } else if (key === '타이틀1') {
                            if (value === 'X' || value === 'x') {
                                targetUserData.info.titles[0] = null;
                                updates.push(`타이틀1 → 제거`);
                            } else {
                                targetUserData.info.titles[0] = value;
                                updates.push(`타이틀1 → ${value}`);
                            }
                        } else if (key === '타이틀2') {
                            if (value === 'X' || value === 'x') {
                                targetUserData.info.titles[1] = null;
                                updates.push(`타이틀2 → 제거`);
                            } else {
                                targetUserData.info.titles[1] = value;
                                updates.push(`타이틀2 → ${value}`);
                            }
                        } else if (key === '타이틀3') {
                            if (value === 'X' || value === 'x') {
                                targetUserData.info.titles[2] = null;
                                updates.push(`타이틀3 → 제거`);
                            } else {
                                targetUserData.info.titles[2] = value;
                                updates.push(`타이틀3 → ${value}`);
                            }
                        } else if (key === '타이틀4') {
                            if (value === 'X' || value === 'x') {
                                targetUserData.info.titles[3] = null;
                                updates.push(`타이틀4 → 제거`);
                            } else {
                                targetUserData.info.titles[3] = value;
                                updates.push(`타이틀4 → ${value}`);
                            }
                        } else if (key === '타이틀5') {
                            if (value === 'X' || value === 'x') {
                                targetUserData.info.titles[4] = null;
                                updates.push(`타이틀5 → 제거`);
                            } else {
                                targetUserData.info.titles[4] = value;
                                updates.push(`타이틀5 → ${value}`);
                            }
                        }
                    }

                    if (errors.length > 0) {
                        channel.sendChat(`❌ ${errors.join('\n')}`);
                    } else if (updates.length > 0) {
                        await saveUserData(targetUserId, targetUserData);
                        channel.sendChat(`✅ ${targetName} 친구의 정보가 수정되었어!\n${updates.join('\n')}`);
                    } else {
                        channel.sendChat(`❌ 수정할 정보가 없어..`);
                    }
                }
            }

            else if (msg.startsWith("/커플등록 ")) {
                if (!(sender.perm == 4 || sender.perm == 1)) {
                    channel.sendChat("❌ 관리자만 사용할 수 있는 명령어야.");
                } else {
                    const cmdParts = msg.trim().split(' ');

                    if (cmdParts.length < 2) {
                        channel.sendChat("❌ 명령어 형식이 올바르지 않아!");
                        return;
                    }

                    const typeAndArgs = cmdParts[1];

                    if (typeAndArgs.startsWith("공커:")) {
                        const names = typeAndArgs.substring(3).split(' ').concat(cmdParts.slice(2));
                        if (names.length < 2) {
                            channel.sendChat("❌ 공커는 두 사람의 이름이 필요해!\n예: /커플등록 공커:길동 영희");
                            return;
                        }

                        const name1 = names[0].trim();
                        const name2 = names[1].trim();

                        const allUsers = await getAllUsers();
                        let user1Data = null, user1Id = null;
                        let user2Data = null, user2Id = null;

                        for (const userData of allUsers) {
                            if (userData.info?.name === name1) {
                                user1Data = userData;
                                user1Id = userData.userId;
                            }
                            if (userData.info?.name === name2) {
                                user2Data = userData;
                                user2Id = userData.userId;
                            }
                        }

                        if (!user1Data) {
                            channel.sendChat(`❌ "${name1}" 이름을 가진 친구를 찾을 수 없어!`);
                            return;
                        }
                        if (!user2Data) {
                            channel.sendChat(`❌ "${name2}" 이름을 가진 친구를 찾을 수 없어!`);
                            return;
                        }

                        // 커플 등록
                        user1Data.info.couple = { type: "공개", target: name2, emoji: null };
                        user2Data.info.couple = { type: "공개", target: name1, emoji: null };

                        await saveUserData(user1Id, user1Data);
                        await saveUserData(user2Id, user2Data);

                        channel.sendChat(`💕 ${name1} 친구와 ${name2} 친구가 공개커플로 등록되었어!`);
                    }
                    else if (typeAndArgs.startsWith("일방:")) {
                        const args = typeAndArgs.substring(3).split(' ').concat(cmdParts.slice(2));
                        if (args.length < 3) {
                            channel.sendChat("❌ 일방은 사람1, 이모지, 사람2가 필요해! 예: /커플등록 일방:길동 💕 영희");
                            return;
                        }

                        const name1 = args[0].trim();
                        const emoji = args[1].trim();
                        const name2 = args[2].trim();

                        const allUsers = await getAllUsers();
                        let user1Data = null, user1Id = null;
                        let user2Data = null, user2Id = null;

                        for (const userData of allUsers) {
                            if (userData.info?.name === name1) {
                                user1Data = userData;
                                user1Id = userData.userId;
                            }
                            if (userData.info?.name === name2) {
                                user2Data = userData;
                                user2Id = userData.userId;
                            }
                        }

                        if (!user1Data) {
                            channel.sendChat(`❌ "${name1}" 이름을 가진 친구를 찾을 수 없어!`);
                            return;
                        }
                        if (!user2Data) {
                            channel.sendChat(`❌ "${name2}" 이름을 가진 친구를 찾을 수 없어!`);
                            return;
                        }

                        user1Data.info.couple = { type: "일방", target: name2, emoji: emoji };
                        user2Data.info.couple = { type: "일방", target: name1, emoji: emoji };

                        await saveUserData(user1Id, user1Data);
                        await saveUserData(user2Id, user2Data);

                        channel.sendChat(`${emoji} ${name1} 친구와 ${name2} 친구가 일방커플로 등록되었어! ${emoji}`);
                    }
                    else if (typeAndArgs.startsWith("바커:")) {
                        const name = typeAndArgs.substring(3).trim() || (cmdParts.length > 2 ? cmdParts[2].trim() : '');

                        if (!name) {
                            channel.sendChat("❌ 바커는 한 사람의 이름이 필요해! 예: /커플등록 바커:길동");
                            return;
                        }

                        // 사람 찾기
                        const allUsers = await getAllUsers();
                        let userData = null, userId = null;

                        for (const data of allUsers) {
                            if (data.info?.name === name) {
                                userData = data;
                                userId = data.userId;
                                break;
                            }
                        }

                        if (!userData) {
                            channel.sendChat(`❌ "${name}" 이름을 가진 친구를 찾을 수 없어!`);
                            return;
                        }

                        userData.info.couple = { type: "바깥", target: null, emoji: null };

                        await saveUserData(userId, userData);

                        channel.sendChat(`💑 ${name} 친구가 바깥커플로 등록되었어!`);
                    }
                    else {
                        channel.sendChat("❌ 올바른 형식을 사용해줘!\n• /커플등록 공커:이름1 이름2\n• /커플등록 일방:이름1 이모지 이름2\n• /커플등록 바커:이름");
                    }
                }
            }

            else if (msg.startsWith("/커플해제 ")) {
                if (!(sender.perm == 4 || sender.perm == 1)) {
                    channel.sendChat("❌ 관리자만 사용할 수 있는 명령어야.");
                } else {
                    const name = msg.substring(6).trim();

                    if (!name) {
                        channel.sendChat("❌ 이름을 입력해줘! 예: /커플해제 길동");
                        return;
                    }

                    const allUsers = await getAllUsers();
                    let userData = null, userId = null;

                    for (const data of allUsers) {
                        if (data.info?.name === name) {
                            userData = data;
                            userId = data.userId;
                            break;
                        }
                    }

                    if (!userData) {
                        channel.sendChat(`❌ "${name}" 이름을 가진 친구를 찾을 수 없어!`);
                        return;
                    }

                    const partnerName = userData.info.couple?.target;
                    let partnerData = null, partnerId = null;

                    if (partnerName) {
                        for (const data of allUsers) {
                            if (data.info?.name === partnerName) {
                                partnerData = data;
                                partnerId = data.userId;
                                break;
                            }
                        }
                    }

                    userData.info.couple = { type: null, target: null, emoji: null };
                    await saveUserData(userId, userData);

                    if (partnerData) {
                        partnerData.info.couple = { type: null, target: null, emoji: null };
                        await saveUserData(partnerId, partnerData);
                        channel.sendChat(`💔 ${name} 친구와 ${partnerName} 친구의 커플이 해제되었어!`);
                    } else {
                        channel.sendChat(`💔 ${name} 친구의 커플이 해제되었어!`);
                    }
                }
            }

            else if (msg.startsWith("/명상 ")) {
                if (!(sender.perm == 4 || sender.perm == 1)) {
                    channel.sendChat("❌ 관리자만 사용할 수 있는 명령어야.");
                } else {
                    const args = msg.substring(4).trim().split(' ');

                    if (args.length < 2) {
                        channel.sendChat("❌ 형식: /명상 [이름] (1주/2주)");
                        return;
                    }

                    const name = args[0];
                    const duration = args[1];

                    if (duration !== '1주' && duration !== '2주') {
                        channel.sendChat("❌ 기간은 1주 또는 2주만 가능해!");
                        return;
                    }

                    const allUsers = await getAllUsers();
                    let userData = null, userId = null;

                    for (const data of allUsers) {
                        if (data.info?.name === name) {
                            userData = data;
                            userId = data.userId;
                            break;
                        }
                    }

                    if (!userData) {
                        channel.sendChat(`❌ "${name}" 이름을 가진 친구를 찾을 수 없어!`);
                        return;
                    }

                    userData.meditation = {
                        startTime: new Date().getKoreanTime().toString(),
                        duration: duration
                    };

                    await saveUserData(userId, userData);
                    channel.sendChat(`🧘 ${name} 친구의 ${duration} 명상이 시작되었어!`);
                }
            }

            else if (msg.startsWith("/경험치추가 ")) {
                if (!(sender.perm == 4 || sender.perm == 1)) {
                    channel.sendChat("❌ 관리자만 사용할 수 있는 명령어야.");
                } else {
                    const args = msg.substring(7).trim().split(' ');

                    if (args.length < 2) {
                        channel.sendChat("❌ 형식: /경험치추가 [이름] [경험치]");
                        return;
                    }

                    const name = args[0];
                    const expToAdd = parseInt(args[1]);

                    if (isNaN(expToAdd) || expToAdd <= 0) {
                        channel.sendChat("❌ 경험치는 양수여야 해!");
                        return;
                    }

                    const allUsers = await getAllUsers();
                    let userData = null, userId = null;

                    for (const data of allUsers) {
                        if (data.info?.name === name) {
                            userData = data;
                            userId = data.userId;
                            break;
                        }
                    }

                    if (!userData) {
                        channel.sendChat(`❌ "${name}" 이름을 가진 친구를 찾을 수 없어!`);
                        return;
                    }

                    const startLevel = userData.level;
                    userData.exp += expToAdd;
                    userData.total_chat += expToAdd;

                    while (true) {
                        const requiredExp = getRequiredExp(userData.level);
                        if (userData.exp >= requiredExp) {
                            userData.level++;
                            userData.exp -= requiredExp;

                            if (!userData.max_level) userData.max_level = 1;
                            if (userData.level > userData.max_level) {
                                userData.max_level = userData.level;
                            }

                            if (userData.level == 51) {
                                if (!userData.rainbow_stack) userData.rainbow_stack = 0;
                                if (userData.rainbow_stack < 3) {
                                    userData.rainbow_stack++;
                                }
                            }
                        } else {
                            break;
                        }
                    }

                    await saveUserData(userId, userData);

                    const levelEmoji = getLevelEmoji(userData.level);
                    if (startLevel === userData.level) {
                        channel.sendChat(`✅ ${name} 친구에게 경험치를 ${expToAdd.toComma()}만큼 추가했어!\n현재 레벨: Lv.${userData.level} ${levelEmoji}\n현재 경험치: ${userData.exp.toComma()}/${getRequiredExp(userData.level).toComma()}`);
                    } else {
                        channel.sendChat(`✅ ${name} 친구에게 경험치를 ${expToAdd.toComma()}만큼 추가했어!\n레벨: Lv.${startLevel} → Lv.${userData.level} ${levelEmoji}\n현재 경험치: ${userData.exp.toComma()}/${getRequiredExp(userData.level).toComma()}`);
                    }
                }
            }

            else if (msg.startsWith("/내정보수정")) {
                const lines = msg.split('\n');
                const validMBTI = ['ISTJ', 'ISFJ', 'INFJ', 'INTJ', 'ISTP', 'ISFP', 'INFP', 'INTP', 
                                   'ESTP', 'ESFP', 'ENFP', 'ENTP', 'ESTJ', 'ESFJ', 'ENFJ', 'ENTJ'];
                const validGimidol = ['기혼', '미혼', '돌싱'];
                const validGender = ['남자', '여자'];
                const validExit = ['외출', '출퇴'];

                let errors = [];
                let updates = [];

                for (let i = 1; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (!line) continue;

                    const colonIndex = line.indexOf(':');
                    if (colonIndex === -1) continue;

                    const key = line.substring(0, colonIndex).trim();
                    const value = line.substring(colonIndex + 1).trim();

                    if (!value) continue;

                    if (key === 'MBTI') {
                        const mbtiUpper = value.toUpperCase();
                        if (validMBTI.includes(mbtiUpper)) {
                            user_data.info.mbti = mbtiUpper;
                            updates.push(`MBTI → ${mbtiUpper}`);
                        } else {
                            errors.push(`MBTI를 제대로 입력해줘!`);
                        }
                    } else if (key === '사는곳') {
                        user_data.info.address = value;
                        updates.push(`사는곳 → ${value}`);
                    } else if (key === '기미돌') {
                        if (validGimidol.includes(value)) {
                            user_data.info.gimidol = value;
                            updates.push(`기미돌 → ${value}`);
                        } else {
                            errors.push(`기미돌을 제대로 입력해줘! (기혼/미혼/돌싱)`);
                        }
                    } else if (key === '성별') {
                        if (validGender.includes(value)) {
                            user_data.info.gender = value;
                            updates.push(`성별 → ${value}`);
                        } else {
                            errors.push(`성별을 제대로 입력해줘! (남자/여자)`);
                        }
                    } else if (key === '외출상태') {
                        if (value === 'X' || value === 'x') {
                            user_data.info.isExit.type = null;
                            updates.push(`외출상태 → 초기화`);
                        } else if (validExit.includes(value)) {
                            user_data.info.isExit.type = value;
                            updates.push(`외출상태 → ${value}`);
                        } else {
                            errors.push(`외출상태를 제대로 입력해줘! (외출/출퇴/X)`);
                        }
                    } else if (key === '타이틀1') {
                        user_data.info.titles[0] = value;
                        updates.push(`타이틀1 → ${value}`);
                    } else if (key === '타이틀2') {
                        user_data.info.titles[1] = value;
                        updates.push(`타이틀2 → ${value}`);
                    } else if (key === '타이틀3') {
                        user_data.info.titles[2] = value;
                        updates.push(`타이틀3 → ${value}`);
                    } else if (key === '타이틀4') {
                        user_data.info.titles[3] = value;
                        updates.push(`타이틀4 → ${value}`);
                    } else if (key === '타이틀5') {
                        user_data.info.titles[4] = value;
                        updates.push(`타이틀5 → ${value}`);
                    }
                }

                if (errors.length > 0) {
                    channel.sendChat(`❌ ${errors.join('\n')}`);
                } else if (updates.length > 0) {
                    await saveUserData(sender.userId, user_data);
                    channel.sendChat(`✅ 정보가 수정되었어!\n${updates.join('\n')}`);
                } else {
                    channel.sendChat(`❌ 수정할 정보가 없어..`);
                }
            }

            else if (msg.startsWith("/닉변 ")) {
                const query = msg.substring(4).trim();

                if (!query) {
                    channel.sendChat("❌ 검색할 닉네임을 입력해줘!");
                    return;
                }

                const userList = (await getAllUsers())
                    .filter(user => user.entry_log && user.entry_log.length > 0 && user.entry_log[user.entry_log.length - 1].type === '입장');

                const matchedUsers = userList.filter(user => {
                    if (!user.profile_change_log || user.profile_change_log.length === 0) return false;
                    return user.profile_change_log.some(log => log.name && log.name.includes(query));
                });

                if (matchedUsers.length === 0) {
                    channel.sendChat(`🔎닉변 필터: "${query}"\n\n검색 결과가 없어🥺`);
                    return;
                }

                const result = [`🔎닉변 필터: "${query}"\n`];

                matchedUsers.forEach(user => {
                    const logs = user.profile_change_log || [];
                    if (logs.length === 0) return;

                    const lastLog = logs[logs.length - 1];
                    const lastDate = new Date(lastLog.date);
                    const recentDate = `${lastDate.getFullYear()}년 ${lastDate.getMonth() + 1}월 ${lastDate.getDate()}일`;

                    const currentNickname = user.nickname || '알 수 없음';

                    result.push(`\n👤 ${currentNickname} [최근 : ${recentDate}]`);

                    logs.forEach(log => {
                        const logDate = new Date(log.date);
                        result.push(`· ${logDate.toDateString()} · ${log.prev} → ${log.name}`);
                    });
                });

                channel.sendChat(result.join('\n'));
            }

            else if (msg == "/성비") {
                const userList = await getAllUsers();

                let maleCount = 0;
                let femaleCount = 0;

                userList.forEach(user => {
                    if (user.info?.gender === "남자") {
                        maleCount++;
                    } else if (user.info?.gender === "여자") {
                        femaleCount++;
                    }
                });

                channel.sendChat(`현재 등록된 친구 수:\n♂ 남자친구: ${maleCount}명\n♀ 여자친구: ${femaleCount}명`);
            }

            else if (msg.startsWith("/") && /^\/\d{4}채팅 /.test(msg)) {
                const parts = msg.split(' ');
                if (parts.length < 2) {
                    channel.sendChat("❌ 이름을 입력해줘!");
                    return;
                }

                const yearMonth = parts[0].substring(1, 5);
                const targetName = parts.slice(1).join(' ').trim();
                const year = yearMonth.substring(0, 2);
                const month = yearMonth.substring(2, 4);
                const searchPrefix = `20${year}-${month}`;

                const allUsers = await getAllUsers();
                let targetUserData = null;

                for (const userData of allUsers) {
                    if (userData.info?.name === targetName) {
                        targetUserData = userData;
                        break;
                    }
                }

                if (!targetUserData) {
                    channel.sendChat(`❌ "${targetName}" 이름을 가진 친구를 찾을 수 없어!`);
                    return;
                }

                const dailyChatLog = targetUserData.daily_chat_log || {};

                const monthData = {};
                Object.keys(dailyChatLog).forEach(date => {
                    if (date.startsWith(searchPrefix)) {
                        monthData[date] = dailyChatLog[date];
                    }
                });

                if (Object.keys(monthData).length === 0) {
                    channel.sendChat(`📅 ${targetName} 친구의 20${year}년 ${month}월 채팅수\n\n데이터가 없어🥺`);
                    return;
                }

                let total = 0;
                let maxCount = 0;
                let maxDate = '';

                Object.keys(monthData).forEach(date => {
                    const count = monthData[date];
                    total += count;
                    if (count > maxCount) {
                        maxCount = count;
                        maxDate = date;
                    }
                });

                const daysCount = Object.keys(monthData).length;
                const average = (total / daysCount).toFixed(1);

                const dateList = Object.keys(monthData).sort().map(date => {
                    return `▪ ${date} : ${monthData[date].toLocaleString()}개`;
                });

                const result = [
                    `📅 ${targetName} 친구의 20${year}년 ${month}월 채팅수`,
                    ``,
                    `총합: ${total.toLocaleString()}개`,
                    `일평균: ${parseFloat(average).toLocaleString()}개`,
                    `최다: ${maxDate} / ${maxCount.toLocaleString()}개`,
                    view_all,
                    ...dateList
                ].join('\n');

                channel.sendChat(result);
            }

            else if (msg.startsWith("/") && /^\/\d{4}채팅수$/.test(msg)) {
                const yearMonth = msg.substring(1, 5);
                const year = yearMonth.substring(0, 2);
                const month = yearMonth.substring(2, 4);
                const searchPrefix = `20${year}-${month}`;

                let chatLog = await getSaveData('chat_log');
                if (!chatLog) {
                    channel.sendChat(`📅 20${year}년 ${month}월 채팅수\n\n데이터가 없어🥺`);
                    return;
                }

                const monthData = {};
                Object.keys(chatLog).forEach(date => {
                    if (date.startsWith(searchPrefix)) {
                        monthData[date] = chatLog[date];
                    }
                });

                if (Object.keys(monthData).length === 0) {
                    channel.sendChat(`📅 20${year}년 ${month}월 채팅수\n\n데이터가 없어🥺`);
                    return;
                }

                let total = 0;
                let maxCount = 0;
                let maxDate = '';

                Object.keys(monthData).forEach(date => {
                    const count = monthData[date];
                    total += count;
                    if (count > maxCount) {
                        maxCount = count;
                        maxDate = date;
                    }
                });

                const daysCount = Object.keys(monthData).length;
                const average = (total / daysCount).toFixed(1);

                const dateList = Object.keys(monthData).sort().map(date => {
                    return `▪ ${date} : ${monthData[date].toLocaleString()}개`;
                });

                const result = [
                    `📅 20${year}년 ${month}월 채팅수`,
                    ``,
                    `총합: ${total.toLocaleString()}개`,
                    `일평균: ${parseFloat(average).toLocaleString()}개`,
                    `최다: ${maxDate} / ${maxCount.toLocaleString()}개`,
                    view_all,
                    ...dateList
                ].join('\n');

                channel.sendChat(result);
            }

            else if (msg.startsWith("/입방") && msg.length == 7 && /^\/입방\d{4}$/.test(msg)) {
                const yearMonth = msg.substring(3);
                const year = yearMonth.substring(0, 2);
                const month = yearMonth.substring(2, 4);
                const searchDate = `${year}.${month}`;

                const userList = await getAllUsers();

                const entryUsers = userList
                    .filter(user => user.info?.date?.startsWith(searchDate))
                    .map(user => user.info?.name || user.nickname || '알 수 없음');

                if (entryUsers.length > 0) {
                    channel.sendChat(`${year}년 ${month}월 입방 친구들 (${entryUsers.length}명):\n${entryUsers.join(', ')}`);
                } else {
                    channel.sendChat(`${year}년 ${month}월 입방한 친구가 없어🥺`);
                }
            }

            else if (msg.startsWith("/지역 ")) {
                const searchQuery = msg.substring(4).trim();

                if (!searchQuery) {
                    channel.sendChat("❌ 검색할 지역을 입력해줘!");
                    return;
                }

                const userList = await getAllUsers();

                const locationUsers = userList
                    .filter(user => user.info?.address && user.info.address.includes(searchQuery))
                    .map(user => user.info?.name || user.nickname || '알 수 없음');

                if (locationUsers.length > 0) {
                    channel.sendChat(`${searchQuery} 친구들 (${locationUsers.length}명):\n${locationUsers.join(', ')}`);
                } else {
                    channel.sendChat(`${searchQuery} 친구가 없어🥺`);
                }
            }

            else if (msg.startsWith("/") && msg.length == 5 && /^\/[a-zA-Z]{4}$/i.test(msg)) {
                const searchMBTI = msg.substring(1).toUpperCase();
                const validMBTI = ['ISTJ', 'ISFJ', 'INFJ', 'INTJ', 'ISTP', 'ISFP', 'INFP', 'INTP', 
                                   'ESTP', 'ESFP', 'ENFP', 'ENTP', 'ESTJ', 'ESFJ', 'ENFJ', 'ENTJ'];

                if (validMBTI.includes(searchMBTI)) {
                    const userList = await getAllUsers();

                    const mbtiUsers = userList
                        .filter(user => user.info?.mbti?.toUpperCase() === searchMBTI)
                        .map(user => user.info?.name || user.nickname || '알 수 없음');

                    if (mbtiUsers.length > 0) {
                        channel.sendChat(`${searchMBTI} 친구들 (${mbtiUsers.length}명):\n${mbtiUsers.join(', ')}`);
                    } else {
                        channel.sendChat(`${searchMBTI} 친구가 없어..`);
                    }
                }
            }

            user_data.last_chat = new Date().getKoreanTime().toString();
            user_data.exp++;
            user_data.total_chat++;

            // 날짜별 채팅 수 기록 (전체)
            const today = new Date().getKoreanTime().toYYYYMMDD();
            let chatLog = await getSaveData('chat_log');
            if (!chatLog) {
                chatLog = {};
            }
            chatLog[today] = (chatLog[today] || 0) + 1;
            await setSaveData('chat_log', chatLog);

            // 개인별 날짜별 채팅 수 기록
            if (!user_data.daily_chat_log) {
                user_data.daily_chat_log = {};
            }
            user_data.daily_chat_log[today] = (user_data.daily_chat_log[today] || 0) + 1;

            const requiredExp = getRequiredExp(user_data.level);
            if (user_data.exp >= requiredExp) {
                user_data.level++;
                user_data.exp -= requiredExp;

                if (!user_data.max_level) user_data.max_level = 1;
                if (user_data.level > user_data.max_level) {
                    user_data.max_level = user_data.level;
                }

                if (user_data.level == 51) {
                    if (!user_data.rainbow_stack) user_data.rainbow_stack = 0;
                    if (user_data.rainbow_stack < 3) {
                        user_data.rainbow_stack++;
                    }
                }

                const levelEmoji = getLevelEmoji(user_data.level);
                const nickname = sender.nickname || user_data.nickname;
                channel.sendChat(`🎉 ${nickname} 레벨 ${user_data.level} (${levelEmoji}) 레벨업!`);
            }

            // 입방 7일 이상 경과 시 삐약이 빼기 알림 (10분마다)
            if (user_data.info?.date && sender.nickname && sender.nickname.includes('🐣')) {
                // info.date 파싱 (YY.MM.DD 형식)
                const dateParts = user_data.info.date.split('.');
                if (dateParts.length === 3) {
                    const entryYear = 2000 + parseInt(dateParts[0]);
                    const entryMonth = parseInt(dateParts[1]) - 1; // 0-indexed
                    const entryDay = parseInt(dateParts[2]);
                    const entryDate = new Date(entryYear, entryMonth, entryDay);

                    // 현재 날짜
                    const now = new Date().getKoreanTime();
                    const diffTime = now - entryDate;
                    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

                    // 7일 이상 경과 확인
                    if (diffDays >= 7) {
                        // 마지막 알림으로부터 10분 이상 경과했는지 확인
                        const lastReminder = user_data.last_chick_reminder;
                        const tenMinutes = 10 * 60 * 1000; // 10분 = 600,000ms

                        if (!lastReminder || (now.getTime() - new Date(lastReminder).getTime() >= tenMinutes)) {
                            user_data.last_chick_reminder = now.toString();
                            channel.sendChat(`💐 축하해! 입방 ${diffDays}일차야!\n${sender.nickname} 삐약이 빼도 돼!`);
                        }
                    }
                }
            }

            // 명상 시간 체크
            if (user_data.meditation && user_data.meditation.startTime && user_data.meditation.duration) {
                const now = new Date().getKoreanTime();
                const startTime = new Date(user_data.meditation.startTime);
                const diffTime = now - startTime;
                const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

                const requiredDays = user_data.meditation.duration === '1주' ? 7 : 14;

                if (diffDays >= requiredDays) {
                    channel.sendChat(`${sender.nickname} 명상시간 수고많았어 ☀️`);
                    // 명상 정보 초기화
                    delete user_data.meditation;
                }
            }

            await saveUserData(sender.userId, user_data);
        }

    } catch (e) {
        console.log(e);
    }
}

async function onChat(data, channel, context = {}) {
    if (!isTargetChannel(channel)) return false;
    const msg = (data.text || '').trim();
    const handledCommand = isHandledCommand(msg);
    await _handleChatMessage(data, channel, context);
    return handledCommand;
}

async function onUserJoin(joinLog, channel, user, feed, context = {}) {
    if (!isTargetChannel(channel) || !user) return;
    let user_data = await getUserData(user.userId);
    if (!user_data) {
        let newName = user.nickname.split(" ")[0];

        if (await isNameDuplicated(newName, user.userId)) {
            channel.sendChat(`${newName}친구! 그 이름은 이미 사용중이야. 다른 이름으로 바꿔줘!`);
            newName = newName + "" + getRandomString(2);
        }

        user_data = {
            nickname: user.nickname,
            last_attend: null,
            entry_log: [],
            info: {
                name: newName,
                role: "친구",
                date: new Date().getKoreanTime().toYYMMDD(),
                mbti: null,
                gender: user.nickname.split(" ")[1]?.includes("남") ? "남자" : (user.nickname.split(" ")[1]?.includes("여") ? "여자" : null),
                address: null,
                gimidol: null,
                isExit: {
                    type: null
                },
                couple: {
                    type: null,
                    target: null,
                    emoji: null
                },
                titles: [
                    null,
                    null,
                    null,
                    null,
                    null
                ]
            },
            level: 1,
            exp: 0,
            total_chat: 0,
            last_chat: null,
            profile_change_log: [],
            daily_chat_log: {},
            max_level: 1,
            rainbow_stack: 0,
            meditation: null
        };
    }
    user_data.entry_log.push({
        type: "입장",
        date: new Date().getKoreanTime().toString(),
        name: user.nickname
    });
    if (user_data.entry_log.length > 1) {
        let entry_log = user_data.entry_log.map(log => `· ${new Date(log.date).toYYYYMMDD()} - ${log.name} ㅡ ${log.type}`);
        channel.sendChat(`📡🚨 특정 닉네임 입방!\n${view_all}\n\n현재 닉: ${user.nickname}\n${entry_log.join("\n")}`);
    } else {
        channel.sendChat(`어서와👋 친구야🤩
우리방에 온걸 진심으로 환영해🥳
✴️지금부터는 우리방 친구들이
친절하게 안내해줄꺼야!!
⭕️집중해서 입방절차 안내를 따라줘⭕️`);
        channel.sendChat(`🖐️기존 친구들은 잠시만!!🖐️
📵잠깐 키보드에서 손을 때고 
🚼새친구가 입방절차를 잘할수있게
기다려주자👀`);
    }
    await saveUserData(user.userId, user_data);
}

async function onUserLeft(leftLog, channel, user, feed, context = {}) {
    if (!isTargetChannel(channel) || !user) return;
    let user_data = await getUserData(user.userId);
    if (user_data) {
        const kicker = channel.getUserInfo(leftLog.sender);
        if (kicker) {
            user_data.entry_log.push({
                type: `강퇴 by ${kicker.nickname}`,
                date: new Date().getKoreanTime().toString(),
                name: user.nickname
            });
        } else {
            user_data.entry_log.push({
                type: "퇴장",
                date: new Date().getKoreanTime().toString(),
                name: user.nickname
            });
        }
        await saveUserData(user.userId, user_data);
    }
}

async function onProfileChanged(channel, lastInfo, user, context = {}) {
    if (!isTargetChannel(channel) || !user) return;
    let user_data = await getUserData(user.userId);
    if (user_data) {
        let newName = user.nickname.split(" ")[0];

        // 이름 중복 체크
        if (await isNameDuplicated(newName, user.userId)) {
            channel.sendChat(`${newName}친구! 그 이름은 이미 사용중이야. 다른 이름으로 바꿔줘!`);
            newName = newName + "" + getRandomString(2);
        }

        user_data.nickname = user.nickname;
        user_data.info.name = newName;
        user_data.info.gender = user.nickname.split(" ")[1]?.includes("남") ? "남자" : (user.nickname.split(" ")[1]?.includes("여") ? "여자" : null);
        user_data.profile_change_log.push({
            prev: lastInfo.nickname,
            name: user.nickname,
            date: new Date().getKoreanTime().toString()
        });
        await saveUserData(user.userId, user_data);

        const recentLogs = user_data.profile_change_log.slice(-3);
        const logMessages = recentLogs.map(log => {
            const logDate = new Date(log.date);
            return `· ${log.prev} → ${log.name}\n(${logDate.toDateString()})`;
        });

        channel.sendChat(`🔁 닉네임 변경 기록 (최근 ${recentLogs.length}개)\n\n${logMessages.join('\n\n')}`);
    }
}

module.exports = {
    TARGET_CHANNEL_ID,
    onChat,
    onUserJoin,
    onUserLeft,
    onProfileChanged,
    getSaveData,
    setSaveData,
    getUserData,
    saveUserData,
    getAllUsers
};