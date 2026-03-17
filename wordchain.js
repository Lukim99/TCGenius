const node_kakao = require('node-kakao');
const fs = require('fs');
const axios = require('axios');
const cheerio = require('cheerio');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);

// Supabase wrapper functions
async function getItem(table, id) { 
    try { 
        const { data, error } = await supabase.from(table).select('*').eq('id', id).single(); 
        if (error) return { success: false, result: [error] };
        return { success: true, result: [{ Item: data }] }; 
    } catch (e) { 
        return { success: false, result: [e] }; 
    } 
}

async function putItem(table, item) { 
    try { 
        const { data, error } = await supabase.from(table).upsert(item, { onConflict: 'id' }).select(); 
        if (error) return { success: false, result: [error] };
        return { success: true, result: [data] }; 
    } catch (e) { 
        return { success: false, result: [e] }; 
    } 
}

async function updateItem(table, id, data) { 
    try { 
        const updateData = Object.keys(data).reduce((acc, key) => {
            if (key !== 'id') acc[key] = data[key];
            return acc;
        }, {});
        const { data: result, error } = await supabase.from(table).update(updateData).eq('id', id).select(); 
        if (error) return { success: false, result: [error] };
        return { success: true, result: [result] }; 
    } catch (e) { 
        return { success: false, result: [e] }; 
    } 
}

async function queryItems(params) { 
    try {
        let query = supabase.from(params.TableName).select('*');
        
        // Handle KeyConditionExpression for common patterns
        if (params.KeyConditionExpression) {
            // Parse simple equality conditions like "p1=:v" or "#g=:v"
            const match = params.KeyConditionExpression.match(/([#\w]+)\s*=\s*:([\w]+)/);
            if (match) {
                const fieldName = params.ExpressionAttributeNames ? params.ExpressionAttributeNames[match[1]] || match[1].replace('#', '') : match[1].replace('#', '');
                const valueName = match[2];
                const value = params.ExpressionAttributeValues[':' + valueName];
                query = query.eq(fieldName, value);
            }
        }
        
        // Handle FilterExpression
        if (params.FilterExpression) {
            const filterMatch = params.FilterExpression.match(/([#\w.]+)\s*=\s*:([\w]+)/);
            if (filterMatch) {
                const fieldPath = filterMatch[1].split('.');
                const fieldName = fieldPath.map(f => params.ExpressionAttributeNames?.[f] || f.replace('#', '')).join('.');
                const valueName = filterMatch[2];
                const value = params.ExpressionAttributeValues[':' + valueName];
                
                // For nested fields like state.playing, we need to use contains or custom filter
                if (fieldPath.length > 1) {
                    query = query.eq(fieldPath[0].replace('#', ''), value);
                } else {
                    query = query.eq(fieldName, value);
                }
            }
        }
        
        const { data, error } = await query;
        if (error) return { success: false, result: [error] };
        return { success: true, result: [{ Items: data || [] }] }; 
    } catch (e) { 
        return { success: false, result: [e] }; 
    } 
}

async function deleteItem(table, id) { 
    try { 
        const { data, error } = await supabase.from(table).delete().eq('id', id).select(); 
        if (error) return { success: false, result: [error] };
        return { success: true, result: [data] }; 
    } catch (e) { 
        return { success: false, result: [e] }; 
    } 
}

function read(p) { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return 'null'; } }
function save(p, data) { fs.writeFileSync(p, data, 'utf8'); return data; }

const PREFIX = "$";
const PREFIXS = ["1","!","$"];
const VIEWMORE = '\u200e'.repeat(500);
const CHOSEONG = ["ㄱ","ㄲ","ㄴ","ㄷ","ㄸ","ㄹ","ㅁ","ㅂ","ㅃ","ㅅ","ㅆ","ㅇ","ㅈ","ㅉ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];
const JUNGSEONG = ["ㅏ","ㅐ","ㅑ","ㅒ","ㅓ","ㅔ","ㅕ","ㅖ","ㅗ","ㅘ","ㅙ","ㅚ","ㅛ","ㅜ","ㅝ","ㅞ","ㅟ","ㅠ","ㅡ","ㅢ","ㅣ"];
const JONGSEONG = ["","ㄱ","ㄲ","ㄳ","ㄴ","ㄵ","ㄶ","ㄷ","ㄹ","ㄺ","ㄻ","ㄼ","ㄽ","ㄾ","ㄿ","ㅀ","ㅁ","ㅂ","ㅄ","ㅅ","ㅆ","ㅇ","ㅈ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];
const JONGSEONG_LEN = JONGSEONG.length;
var HANGUL_FIRST_CODE = '가'.charCodeAt(0), HANGUL_LAST_CODE = '힣'.charCodeAt(0);

const allword = read("DB/allWords.txt").split("\n").map(w => w.trim());
const leadword = read("DB/leadWords.txt").split(",").map(w => w.trim());
const neoword = read("DB/neoWords.txt").split(",").map(w => w.trim());
const routeword = read("DB/routeWords.txt").split("\n").map(w => w.trim());
const leadsyl = leadword.map(w => w.substr(-1)).reduce((a, i) => { if (!a.includes(i)) a.push(i); return a; }, []);
const neosyl = neoword.map(w => w.substr(-1)).reduce((a, i) => { if (!a.includes(i)) a.push(i); return a; }, []);
const routesyl = read("DB/route.txt").split(", ").map(w => w.trim());
let badwords = []; try { badwords = read("DB/badwords.txt").split(","); } catch (e) {}

function dueum(s) { if (!s) return ''; var c = s.charCodeAt(0); if (c < HANGUL_FIRST_CODE || c > HANGUL_LAST_CODE) return s; switch (0 | (c - HANGUL_FIRST_CODE) / JONGSEONG_LEN) { case 48: case 54: case 59: case 62: c += 5292; break; case 107: case 111: case 112: case 117: case 122: case 125: c += 3528; break; case 105: case 106: case 113: case 116: case 118: case 123: c -= 1764; break; } return String.fromCharCode(c) + s.slice(1); }
function dec_han(s) { if(s.match(/[^가-힣ㄱ-ㅎ]/gi)!=null) return s; var uni=s.charCodeAt(0)-44032; return `${CHOSEONG[parseInt(uni/588)]}${JUNGSEONG[parseInt((uni-(parseInt(uni/588)*588))/28)]}${JONGSEONG[parseInt(uni%28)]}`; }
function com_han(s) { if(s.match(/[^가-힣ㄱ-ㅎㅏ-ㅣ]/gi)!=null) return s; let cho=CHOSEONG.indexOf(s[0]),jung=JUNGSEONG.indexOf(s[1]),jong=JONGSEONG.indexOf(s[2]||""); if(cho<0||jung<0) return s; return String.fromCharCode(44032+(cho*21+jung)*28+jong); }
function numberWithCommas(x) { return x.replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
function filterCurses(m) { for (let bw of badwords) { if (!bw) continue; let r = []; for (var i = 0; i < bw.length; i++) { if (i != 0) r.push('([^가-힣]*)'); r.push(bw[i]); } m = m.replace(RegExp(r.join(""), 'gi'), "X".repeat(bw.length)); } return m; }
function getRandomString(len) { const c='023456789ABCDEFGHJKLMNOPQRSTUVWXTZabcdefghikmnopqrstuvwxyz'; let r=''; for(let i=0;i<len;i++) r+=c[Math.floor(Math.random()*c.length)]; return r; }
function toTimeNotation(sec) { let y=0,mo=0,w=0,d=0,h=0,m=0; sec=Math.ceil(sec); while(sec>=604800){sec-=604800;w++;} while(sec>=86400){sec-=86400;d++;} while(sec>=3600){sec-=3600;h++;} while(sec>=60){sec-=60;m++;} let r=((w?w+"주일 ":"")+(d?d+"일 ":"")+(h?h+"시간 ":"")+(m?m+"분 ":"")+(sec?sec+"초":"")); return (r||"0초").trim(); }
function msToMinSec(ms) { let t=Math.floor(ms/1000),m=Math.floor(t/60),s=t%60; if(m<=0&&s<=0) return "0초"; if(m<=0) return s+"초"; if(s<=0) return m+"분"; return m+"분 "+s+"초"; }

// ====== User Class ======
function User(name, id) { 
    this._get = 1; 
    this.id = id; 
    this.name = name; 
    this.isAdmin = false; 
    this.code = getRandomString(10).toUpperCase(); 
    this.logged_in = [id]; 
    this.rate = null; 
    this.lp = 0; 
    this.playing = {}; 
    this.credit = 0; 
    this.title = null; 
    this.titles = []; 
}
User.prototype.load = function(d) { 
    Object.keys(d).forEach(k => { this[k] = d[k]; }); 
    if(this.rate) this.rate = Number(this.rate); 
    if(this.lp) this.lp = Number(this.lp); 
    if(!this.playing) this.playing = {}; 
    return this; 
}
User.prototype.toString = function() { return (this.title?"["+this.title+"] ":"")+this.name; }
User.prototype.save = async function() { await updateItem('user_data', this.id, this); }

async function getUserById(id) { try { let r = await queryItems({ TableName:"user_data", IndexName:"getIdx", KeyConditionExpression:"#g=:v", FilterExpression:"contains(logged_in,:u)", ExpressionAttributeNames:{"#g":"_get"}, ExpressionAttributeValues:{":v":1,":u":id} }); if(r.success&&r.result[0]&&r.result[0].Items&&r.result[0].Items[0]) return new User().load(r.result[0].Items[0]); } catch(e){} return null; }
async function getUserByName(name) { let r = await queryItems({ TableName:"user_data", IndexName:"nameIdx", KeyConditionExpression:"#n=:v", FilterExpression:"#g=:g", ExpressionAttributeNames:{"#n":"name","#g":"_get"}, ExpressionAttributeValues:{":v":name,":g":1} }); if(r.success&&r.result[0]&&r.result[0].Items&&r.result[0].Items[0]) return new User().load(r.result[0].Items[0]); return null; }
async function getUserByCode(code) { let r = await queryItems({ TableName:"user_data", IndexName:"codeIdx", KeyConditionExpression:"#c=:v", FilterExpression:"#g=:g", ExpressionAttributeNames:{"#c":"code","#g":"_get"}, ExpressionAttributeValues:{":v":code,":g":1} }); if(r.success&&r.result[0]&&r.result[0].Items&&r.result[0].Items[0]) return new User().load(r.result[0].Items[0]); return null; }

// ====== Game Timers ======
const gameTimers = {};
function getTimer(gid) { if(!gameTimers[gid]) gameTimers[gid]={turn:null,afk:null,afkUser:null}; return gameTimers[gid]; }
function clearAllTimers(gid) { let t=gameTimers[gid]; if(t){ if(t.turn){try{clearTimeout(t.turn);}catch(e){} t.turn=null;} if(t.afk){try{clearTimeout(t.afk);}catch(e){} t.afk=null; t.afkUser=null;} } }

// ====== Game Class ======
function Game(type, users, roomid) { this._get=1; this.id=0; this.room_id=roomid||''; this.date=new Date().toString(); this.p1=0; this.p2=0; this.type=type||''; this.player=users||[]; this.word=[]; this.state={playing:true,backsies:null,order:null,syl:null,syl2:null,last:new Date().toString(),afkKick:{user:null},timeLimit:null,steal:false,switch:null,banned:null}; this.result={}; }
Game.prototype.load = function(d) { Object.keys(d).forEach(k => { this[k] = d[k]; }); if(!this.state.afkKick) this.state.afkKick={user:null}; return this; }
Game.prototype.toString = function() { let r=[]; r.push("〈 끝말잇기 #"+this.id+" 정보 〉"); r.push("▶ "+this.player[0]+" vs "+this.player[1]+"\n"); r.push(":: 게임: "+(this.type=="끝말"?"구엜룰":this.type=="스펠"?"스펠룰":this.type)); r.push(":: 시작: "+(new Date(this.date).toDateString())); if(this.result.end) r.push(":: 종료: "+(new Date(this.result.end).toDateString())); if(this.result.state=="무효"){r.push(":: 상태: 무효"); return r.join("\n");} if(this.state.banned) r.push(":: 금지 단어: "+this.state.banned); if(this.state.order!=null) r.push(":: 차례: "+this.player[this.state.order]); r.push(":: 수:\n"+this.word.join(" ")); if(this.result.win) r.push("\n:: 승자: "+this.result.win.name); return r.join("\n"); }
Game.prototype.save = async function() { await updateItem('game_data', Number(this.id), this); }

Game.prototype.end = async function(winner, channel) {
    clearAllTimers(this.id);
    let loser = winner.playing.game ? await getUserByName(winner.playing.game.enemy) : null;
    let em = ["〈 끝말잇기 #"+this.id+" 결과 〉", this.player[0]+" vs "+this.player[1], "\n🏆 승자: "+winner.name+"님"];
    if(this.type=="레이팅"&&this.word.length>=3) {
        if(!winner.rate||isNaN(winner.rate)) winner.rate=1500; if(loser&&(!loser.rate||isNaN(loser.rate))) loser.rate=1500;
        let wt=getTier(winner.rate), lt=loser?getTier(loser.rate):"?";
        let wd=Math.max(getRate(winner,this.word.length),1), ld=loser?getRate(loser,this.word.length,"패"):0;
        winner.rate=Math.max(winner.rate+wd,0); if(loser) loser.rate=Math.max(loser.rate+ld,0);
        em.push("","「"+wt+"」 "+winner.name+" ▷ "+winner.rate+" (+"+wd+")"); if(loser) em.push("「"+lt+"」 "+loser.name+" ▷ "+loser.rate+" ("+ld+")");
        if(wt!=getTier(winner.rate)) em.push("","▲ "+winner.name+"님이 「"+getTier(winner.rate)+"」 티어로 승급하셨습니다!");
        if(loser&&lt!=getTier(loser.rate)) em.push("","▼ "+loser.name+"님이 「"+getTier(loser.rate)+"」 티어로 강등되셨습니다.");
    }
    if(this.type=="스펠"&&this.word.length>=3) { let us=this.state.spell?Object.keys(this.state.spell).filter(s=>this.state.spell[s].used).length:0; let lp=calculateAdvancedGamePoints(this.word.length,us); winner.lp+=lp; em.push("",winner.name+" ▷ LP +"+numberWithCommas(lp.toString())); }
    winner.playing={}; if(loser) loser.playing={}; this.state.playing=false;
    this.result={end:new Date().toString(),win:{id:winner.id,name:winner.name},lose:loser?{id:loser.id,name:loser.name}:{id:0,name:"<NULL>"}};
    await winner.save(); if(loser) await loser.save(); await this.save();
    channel.sendChat(filterCurses(em.join("\n")));
}

Game.prototype.nextTurn = async function(user, wrd) {
    let enemy = user ? await getUserByName(user.playing.game.enemy) : null;
    let result = {message:[], end:null};
    if(this.state.order==null) this.state.order=this.player.indexOf(user.name);
    this.state.order^=1; this.state.mustUseUsedWord=false; this.state.canUseAny=false; this.state.CANUSEKILL=true; this.state.CANUSELEAD=true;
    if(wrd){ this.word.push(wrd); this.state.syl=wrd.substr(-1); this.state.syl2=dueum(this.state.syl); }
    if(this.type=="끝말"||this.type=="밴룰") {
        this.state.last=new Date().toString(); await this.save();
        result.message.push("∴ "+(this.type=="끝말"?"구엜룰":this.type)+" | "+this.player[0]+" vs "+this.player[1]+(this.state.banned?"\n⛔ "+this.state.banned:"")+"\n\n"+this.word.join(" ")+"\n\n"+this.state.syl+(this.state.syl==this.state.syl2?"":"("+this.state.syl2+")")+" | "+this.player[this.state.order]+"님 차례");
        if(user&&this.word.length==1) result.message.push(enemy.name+"님, 선공을 뺏어올 수 있습니다.\n[ "+PREFIX+"뺏기 ]");
        if(wrd&&neoword.includes(wrd)){ result.message.push("◈ "+user.name+"님이 한방단어를 사용하여 승리하셨습니다!"); result.end=user; }
    }
    if(["순위전","레이팅"].includes(this.type)) {
        if(this.word.length>1){ let now=new Date(),recent=new Date(this.state.last); if(wrd) user.playing.game.timeLimit-=now-recent; }
        this.state.last=new Date().toString(); if(wrd&&this.word.length>1) user.playing.game.timeLimit+=5000;
        if(wrd&&user.playing.game.isOvertime) user.playing.game.timeLimit=60000;
        await this.save(); await user.save(); await enemy.save();
        result.message.push("⚜️ "+this.type+" | "+this.player[0]+" vs "+this.player[1]+"\n\n"+this.word.join(" ")+"\n\n"+this.state.syl+(this.state.syl==this.state.syl2?"":"("+this.state.syl2+")")+" | "+this.player[this.state.order]+"님 차례\n⏱️ "+msToMinSec(enemy.playing.game.timeLimit)+" 남음 | "+(enemy.playing.game.isOvertime?"초읽기 ("+enemy.playing.game.overtime+"회 남음)":"기본 시간"));
        if(this.word.length==1) result.message.push(enemy.name+"님, 선공을 뺏어올 수 있습니다.\n[ "+PREFIX+"뺏기 ]");
        if(wrd&&neoword.includes(wrd)){ result.message.push("◈ "+user.name+"님이 한방단어를 사용하여 승리하셨습니다!"); result.end=user; }
    }
    if(this.type=="스펠") { if(wrd&&this.state.mode=="쿵쿵따끝") this.state.mode="스펠"; this.state.last=new Date().toString(); await this.save(); result.message.push("🌟 스펠룰 | "+this.player[0]+" vs "+this.player[1]+"\n\n"+this.word.join(" ")+"\n\n"+this.state.syl+(this.state.syl==this.state.syl2?"":"("+this.state.syl2+")")+" | "+this.player[this.state.order]+"님 차례\n⏱️ 1분 안에 이어가세요!"); }
    return result;
}

Game.prototype.checkInput = function(user, wrd) {
    let r={success:false,reason:null};
    if(!!(wrd.match(/[^가-힣ㄱ-ㅎ]/gi))) r.reason="한글만 입력해주세요.";
    if(wrd.length<2&&!this.state.mustUseUsedWord) r.reason="2글자 이상 단어를 입력해주세요.";
    if(!this.state.canUseAny&&!allword.includes(wrd)&&(!this.state.canUseWords||!this.state.canUseWords.includes(wrd))&&!this.state.mustUseUsedWord) r.reason="존재하지 않거나 명사가 아닙니다.";
    if(this.word.includes(wrd)&&!this.state.mustUseUsedWord) r.reason="이미 사용한 단어입니다.";
    if(!this.state.syl&&(leadword.includes(wrd)||neoword.includes(wrd))) r.reason="시작단어로 유도단어 또는 한방단어를 사용할 수 없습니다.";
    if(this.state.syl&&wrd[0]!=this.state.syl&&wrd[0]!=this.state.syl2) r.reason="끝말이 맞지 않습니다.\n이을 음절: "+this.state.syl+(this.state.syl==this.state.syl2?"":"("+this.state.syl2+")");
    if(this.state.order!=null&&this.player[this.state.order]!=user.name) r.reason=user.playing.game.enemy+"님의 차례입니다.";
    if((this.state.mode=="쿵쿵따"||this.state.mode=="쿵쿵따끝"||this.type=="쿵따")&&wrd.length!=3) r.reason="3글자 단어만 사용해야 합니다.";
    if(this.state.CANUSELEAD===false&&leadsyl.includes(wrd.substr(-1))) r.reason="유도단어를 사용할 수 없습니다.";
    if(this.state.CANUSEKILL===false&&neosyl.includes(wrd.substr(-1))) r.reason="한방단어를 사용할 수 없습니다.";
    if(this.state.mustUseUsedWord&&!this.word.includes(wrd)) r.reason="이미 사용한 단어 중에서 사용해야 합니다.";
    if(this.state.canUseAny&&!routesyl.filter(s=>!leadsyl.includes(s)).includes(wrd.substr(-1))) r.reason="루트 음절로 끝나야 합니다.";
    if(this.state.canUseAny&&wrd.length>3) r.reason="최대 3글자까지 만들 수 있습니다.";
    if(this.state.banned==wrd) r.reason="금지된 단어입니다.";
    if(!r.reason) r.success=true; return r;
}

Game.prototype.clearTurnTimer = function() {
    let t = getTimer(this.id);
    if(t.turn) {
        try { clearTimeout(t.turn); } catch(ex) {}
        t.turn = null;
    }
}

Game.prototype.cancelAfkKick = function() {
    let t = getTimer(this.id);
    if(t.afk) {
        try { clearTimeout(t.afk); } catch(ex) {}
        t.afk = null;
        t.afkUser = null;
    }
    this.state.afkKick.user = null;
}

async function getGameById(id) { if(typeof id!='number') id=Number(id); let r=await getItem('game_data',id); if(r.success&&r.result[0]&&r.result[0].Item) return new Game().load(r.result[0].Item); return null; }
async function getGameByRoomId(rid) { 
    try {
        const { data, error } = await supabase.from('game_data').select('*').eq('room_id', rid).contains('state', {playing: true}).limit(1);
        if (error || !data || data.length === 0) return null;
        return new Game().load(data[0]);
    } catch(e) {
        return null;
    }
}
async function getGameByPlayerName(name) { let u=await getUserByName(name); if(u&&u.playing.game){ let g=await getGameById(u.playing.game.id); if(g&&g.state.playing) return g; } return null; }

async function getAllGame(id) {
    try {
        const { data: p1Games, error: p1Error } = await supabase.from('game_data').select('*').eq('p1', id);
        const { data: p2Games, error: p2Error } = await supabase.from('game_data').select('*').eq('p2', id);
        
        let returnRes = [];
        if (!p1Error && p1Games) returnRes = returnRes.concat(p1Games.map(r => new Game().load(r)));
        if (!p2Error && p2Games) returnRes = returnRes.concat(p2Games.map(r => new Game().load(r)));
        
        // Remove duplicates
        let uniqueRes = [];
        let ids = new Set();
        for (let game of returnRes) {
            if (!ids.has(game.id)) {
                uniqueRes.push(game);
                ids.add(game.id);
            }
        }
        return uniqueRes;
    } catch(e) {
        return [];
    }
}

function getWinStreak(games, id) {
    let cur = 0, max = 0;
    for(let g of games) {
        if(g.result.win && g.result.win.id == id) { cur++; if(cur > max) max = cur; }
        else cur = 0;
    }
    return { cur: cur, max: max };
}

function getRate(user, num, result) { result=result||"승"; let K=50; const exp=1/(1+Math.pow(10,(1500-user.rate)/400)); const act=result=="승"?1:0; return Math.round(K*(act-exp)); }
function getTier(r) { if(r<50) return "Unranked F"; if(r<100) return "Unranked E-"; if(r<200) return "Unranked E+"; if(r<300) return "Unranked D"; if(r<400) return "Unranked C-"; if(r<500) return "Unranked C+"; if(r<600) return "Unranked B"; if(r<700) return "Unranked A-"; if(r<800) return "Unranked A+"; if(r<900) return "Unranked S"; if(r<1000) return "Semiranked"; if(r<1100) return "아이언Ⅲ"; if(r<1200) return "아이언Ⅰ"; if(r<1300) return "브론즈Ⅲ"; if(r<1400) return "브론즈Ⅰ"; if(r<1500) return "실버Ⅲ"; if(r<1600) return "실버Ⅰ"; if(r<1700) return "골드Ⅲ"; if(r<1800) return "골드Ⅰ"; if(r<1900) return "플레티넘Ⅲ"; if(r<2000) return "플레티넘Ⅰ"; if(r<2100) return "에메랄드Ⅲ"; if(r<2200) return "에메랄드Ⅰ"; if(r<2300) return "다이아Ⅲ"; if(r<2400) return "다이아Ⅰ"; return "마스터"; }
function calculateAdvancedGamePoints(w,s) { const T=Object.keys(spellrule.spell).length; return Math.round(Math.pow(w,1.5)*7*(1+(s/T))); }

async function getMean(word) { try { let mp="DB/meaning.json",ms={}; try{ms=JSON.parse(read(mp));}catch(e){} if(word in ms) return ms[word]; let res=await axios.get('https://opendict.korean.go.kr/m/searchResult?currentPage=1&dicType=1&sense_no=&query='+encodeURIComponent(word)); let $=cheerio.load(res.data); let found=null; $('dd.searchSense').each(function(){if(found)return;let t=$(this).text();if(/「(명사|.+·명|명·.+)」/.test(t)){let eq=$(this).find('span.search_word_type3_15.mr5').text().replace(/\-/g,'').trim();if(eq!=word)return;found=$(this).find('span.word_dis.ml5').text().replace(/\. .+/,'.').trim();}}); if(found){ms[word]=found;try{save(mp,JSON.stringify(ms));}catch(e){}} return found; } catch(e){return null;} }

async function searchWord(query, type) {
    type=type||"모두"; let result={starts:{normal:[],route:[],lead:[],kill:[],Len:0},ends:{normal:[],route:[],lead:[],kill:[],Len:0},search:{normal:[],route:[],lead:[],kill:[],Len:0}};
    if(type=="루트"){result.starts.route=routeword.filter(w=>w.length>1&&w.startsWith(query));result.starts.Len=result.starts.route.length;result.ends.route=routeword.filter(w=>w.length>1&&w.endsWith(query));result.ends.Len=result.ends.route.length;}
    else if(type=="유도"){result.starts.lead=leadword.filter(w=>w.length>1&&w.startsWith(query));result.starts.Len=result.starts.lead.length;result.ends.lead=leadword.filter(w=>w.length>1&&w.endsWith(query));result.ends.Len=result.ends.lead.length;}
    else if(type=="한방"){result.starts.kill=neoword.filter(w=>w.length>1&&w.startsWith(query));result.starts.Len=result.starts.kill.length;result.ends.kill=neoword.filter(w=>w.length>1&&w.endsWith(query));result.ends.Len=result.ends.kill.length;}
    else if(type=="공단"){result.starts.lead=leadword.filter(w=>w.length>1&&w.startsWith(query));result.starts.kill=neoword.filter(w=>w.length>1&&w.startsWith(query));result.starts.Len=result.starts.kill.length+result.starts.lead.length;result.ends.lead=leadword.filter(w=>w.length>1&&w.endsWith(query));result.ends.kill=neoword.filter(w=>w.length>1&&w.endsWith(query));result.ends.Len=result.ends.kill.length+result.ends.lead.length;}
    else if(type=="모두"){let sr=await queryItems({TableName:"word",IndexName:"startIdx",KeyConditionExpression:"#s=:s",ExpressionAttributeNames:{"#s":"start"},ExpressionAttributeValues:{":s":query}});let er=await queryItems({TableName:"word",IndexName:"endIdx",KeyConditionExpression:"#e=:e",ExpressionAttributeNames:{"#e":"end"},ExpressionAttributeValues:{":e":query}});let ss=(sr.success&&sr.result[0]&&sr.result[0].Items)?sr.result[0].Items:[];let es=(er.success&&er.result[0]&&er.result[0].Items)?er.result[0].Items:[];result.starts.kill=ss.filter(w=>w.word&&w.word.length>1&&w.type=="kill").map(i=>i.word);result.starts.lead=ss.filter(w=>w.word&&w.word.length>1&&w.type=="induce").map(i=>i.word);result.starts.route=ss.filter(w=>w.word&&w.word.length>1&&w.type=="route").map(i=>i.word);result.starts.normal=ss.filter(w=>w.word&&w.word.length>1&&w.type=="normal").map(i=>i.word);result.starts.Len=ss.length;result.ends.kill=es.filter(w=>w.word&&w.word.length>1&&w.type=="kill").map(i=>i.word);result.ends.lead=es.filter(w=>w.word&&w.word.length>1&&w.type=="induce").map(i=>i.word);result.ends.route=es.filter(w=>w.word&&w.word.length>1&&w.type=="route").map(i=>i.word);result.ends.normal=es.filter(w=>w.word&&w.word.length>1&&w.type=="normal").map(i=>i.word);result.ends.Len=es.length;}
    else if(type=="검색"){let q2=query.replace(/\?/gi,".").replace(/\*/g,".*").replace(/R/gi,"["+routesyl.join("")+"]").replace(/K/gi,"["+neosyl.join("")+"]").replace(/I/gi,"["+leadsyl.join("")+"]");let sw=allword.filter(w=>w.length>1&&w.match(RegExp(q2))==w);result.search.kill=sw.filter(w=>neosyl.includes(w.substr(-1)));result.search.lead=sw.filter(w=>leadsyl.includes(w.substr(-1)));result.search.route=sw.filter(w=>routesyl.includes(w.substr(-1)));result.search.normal=sw.filter(w=>!neosyl.includes(w.substr(-1))&&!leadsyl.includes(w.substr(-1))&&!routesyl.includes(w.substr(-1)));result.search.Len=sw.length;}
    return result;
}

function pad_num(kor, max_len) {
    if (typeof kor != 'string') kor = kor.toString();
    max_len = max_len || 2;
    if(kor.length >= max_len)
        return kor;
    return (new Array(max_len - kor.length + 1).join("0")) + kor;
}

Date.prototype.toDateString = function() {
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
    return y + "/" + pad_num(m) + "/" + pad_num(d) + "(" + yo + ") " + ampm + " " + pad_num(h) + ":" + pad_num(minutes) + ":" + pad_num(sec);
}

// ====== Spell Rules ======
const spellrule = { spell: {} };
// Placeholder - will be set after module load
spellrule.spell = {
    "방어":{desc:["현재 차례에서 유도단어와 한방단어를 사용할 수 없게 합니다."],act:async function(g){if(routesyl.includes(g.state.syl)||routesyl.includes(g.state.syl2))return"이을 음절이 루트 음절입니다.";if(leadsyl.includes(g.state.syl)||leadsyl.includes(g.state.syl2))return"이을 음절이 유도 음절입니다.";if(neosyl.includes(g.state.syl)||neosyl.includes(g.state.syl2))return"이을 음절이 한방 음절입니다.";g.state.CANUSELEAD=false;g.state.CANUSEKILL=false;await g.save();return true;},used:false},
    "자르기":{desc:["현재 단어를 반으로 자릅니다.","예) 준민고택 -> 준민"],act:async function(g){let lw=g.word.pop();if(lw.length%2==1){g.word.push(lw);return lw.length+"글자는 자를 수 없습니다.";}let nw=lw.substr(0,Math.round(lw.length/2));g.word.push(nw);g.state.syl=nw.substr(-1);g.state.syl2=dueum(g.state.syl);await g.save();return true;},used:false},
    "스위치":{desc:["상대와 차례를 변경합니다."],act:async function(g,a,ch){await g.switchTurn(ch);await g.save();return true;},used:false},
    "조커":{desc:["현재 단어를 처음에 사용한 단어로 변경합니다."],act:async function(g){g.word.pop();g.word.push(g.word[0]);g.state.syl=g.word[0].substr(-1);g.state.syl2=dueum(g.state.syl);await g.save();return true;},used:false},
    "세공":{desc:["현재 단어의 맨 앞글자와 맨 뒷글자의 초성을 바꿉니다.","예) 준민고택 -> 툰민고잭"],act:async function(g){let lw=g.word.pop();if(lw.length<2){g.word.push(lw);return"1글자는 바꿀 수 없습니다.";}let f=dec_han(lw[0]).split(""),l=dec_han(lw.substr(-1)).split("");if(f[0]==l[0]){g.word.push(lw);return"맨 앞글자와 맨 뒷글자의 초성이 동일합니다.";}let t=f[0];f[0]=l[0];l[0]=t;let nw=lw.split("");nw.pop();nw[0]=com_han(f.join(""));nw.push(com_han(l.join("")));g.word.push(nw.join(""));g.state.syl=nw.join("").substr(-1);g.state.syl2=dueum(g.state.syl);await g.save();return true;},used:false},
    "중앙":{desc:["이을 음절을 현재 단어의 가운데 글자로 바꿉니다."],act:async function(g){let lw=g.word[g.word.length-1];if(lw.length%2==0)return"현재 단어의 글자수가 홀수여야 합니다.";g.state.syl=lw.substr(Math.floor(lw.length/2),1);g.state.syl2=dueum(g.state.syl);await g.save();return true;},used:false},
    "쿵쿵따":{desc:["2분동안 쿵쿵따 모드가 되어 3글자 단어만 사용해야 합니다."],act:async function(g,a,ch){g.state.mode="쿵쿵따";setTimeout(async()=>{let ng=await getGameById(g.id);if(ng&&ng.state.playing){ch.sendChat(filterCurses("쿵쿵따 모드가 끝났습니다.\n단, 현재 차례인 "+ng.player[ng.state.order]+"님은 3글자로 이어야 합니다."));ng.state.mode="쿵쿵따끝";await ng.save();}},120000);await g.save();return true;},used:false},
    "연구":{desc:["현재 차례에서 루트 음절로 끝나는 아무 단어나 사용 가능합니다. (최대 3글자)"],act:async function(g){g.state.canUseAny=true;await g.save();return true;},used:false},
    "중복":{desc:["현재 차례인 사람은 이미 사용한 단어를 다시 사용해야 합니다."],act:async function(g){if(g.word.filter(w=>w[0]==g.state.syl||w[0]==g.state.syl2).length==0)return"현재 이을 음절로 시작하는 단어가 사용된 적 없습니다.";g.state.mustUseUsedWord=true;await g.save();return true;},used:false},
    "하나":{desc:["현재 이을 음절이 1글자 단어로 존재할 경우 해당 단어를 사용하고 차례를 넘깁니다."],act:async function(g,a,ch){if(!(allword.includes(g.state.syl)||allword.includes(g.state.syl2)))return"한 글자 단어가 존재하지 않습니다.";if(allword.includes(g.state.syl))g.word.push(g.state.syl);else{g.word.push(g.state.syl2);g.state.syl=g.state.syl2;}await g.switchTurn(ch);await g.save();return true;},used:false},
    "무효":{desc:["이전 차례로 되돌립니다."],act:async function(g,a,ch){g.word.pop();g.state.syl=g.word[g.word.length-1].substr(-1);g.state.syl2=dueum(g.state.syl);await g.switchTurn(ch);await g.save();return true;}}
};

Game.prototype.switchTurn = async function(channel) {
    this.state.order^=1; this.state.last=new Date().toString();
    if(this.state.mode=="쿵쿵따끝") this.state.mode="스펠";
    this.state.mustUseUsedWord=false; this.state.canUseAny=false;
    let u=await getUserByName(this.player[this.state.order]);
    let e=await getUserByName(u.playing.game.enemy);
    this.state.CANUSEKILL=true; this.state.CANUSELEAD=true;
    const self=this;
    let t=getTimer(this.id);
    if(t.turn){try{clearTimeout(t.turn);}catch(ex){}}
    t.turn=setTimeout(async function(){if(u.playing.game){channel.sendChat(filterCurses("◈ "+u.name+"님이 제한시간 내에 입력하지 않아 패배하셨습니다."));await self.end(e,channel);}},60000);
    await this.save(); await u.save(); await e.save();
}

// ====== State ======
let wordchainQueue = {};
let loginRequest = {};
let myCheck = {};

// ====== Main Handler ======
async function onChat(data, channel) {
    try {
        const msg = data.text.trim();
        const sender = data.getSenderInfo(channel);
        const senderID = sender.userId + '';
        const roomid = channel.channelId + '';
        const roomName = channel.getDisplayName ? channel.getDisplayName() : '';
        const user = await getUserById(senderID);
        function Send(text) { channel.sendChat(filterCurses(text)); }

        // ====== PREFIX Commands ======
        if (PREFIXS.includes(msg.substr(0, 1))) {
            let cmd = msg.substr(PREFIX.length);
            let arg = cmd.indexOf(" ") > -1 ? cmd.substr(cmd.indexOf(" ") + 1) : null;

            // 등록
            if (cmd.startsWith("등록 ") || cmd.startsWith("ㄷㄹ ")) {
                if (user) { Send("❌ 이미 로그인이 되어있습니다: " + user.name); }
                else {
                    let name = arg.trim();
                    if (!name || name.length < 1 || name.length > 10) { Send("❌ 닉네임은 1~10글자여야 합니다."); }
                    else {
                        let ex = await getUserByName(name);
                        if (ex) { Send("❌ 이미 존재하는 닉네임입니다."); }
                        else {
                            let nu = new User(name, senderID);
                            let res = await putItem('user_data', nu);
                            if (res.success) Send("✅ 성공적으로 등록되셨습니다!\n환영합니다, " + name + "님!");
                            else Send("❌ 등록 과정에서 오류가 발생했습니다.");
                        }
                    }
                }
                return;
            }

            // 로그인승인 (로그인승인제)
            if (cmd.startsWith("로그인 ")) {
                let targetUserName = arg ? arg.trim() : null;
                if (!targetUserName) { Send("❌ 계정을 입력해주세요."); return; }
                let targetUser = await getUserByName(targetUserName);
                if (!targetUser) {
                    Send("❌ 계정을 찾을 수 없습니다.");
                } else if (user) {
                    Send("❌ 이미 로그인된 상태입니다: " + user.name);
                } else {
                    if (!loginRequest[targetUser.id]) loginRequest[targetUser.id] = [];
                    if (loginRequest[targetUser.id].find(lr => lr.id == senderID)) {
                        let existingCode = loginRequest[targetUser.id].find(lr => lr.id == senderID).code;
                        Send("❌ 이미 로그인 요청을 했습니다.\n" + targetUser.name + " 계정으로 로그인 된 방에서 아래 명령어를 입력하세요.\n\n[ $로그인승인 " + existingCode + " ]");
                        return;
                    }
                    let code = getRandomString(6).toUpperCase();
                    loginRequest[targetUser.id].push({
                        id: senderID,
                        code: code,
                        room: channel
                    });
                    Send("📑 로그인 요청이 완료되었습니다.\n" + targetUser.name + " 계정으로 로그인 된 방에서 아래 명령어를 입력하세요.\n\n[ $로그인승인 " + code + " ]");
                }
                return;
            }

            if (cmd.startsWith("로그인승인 ")) {
                if (!user) { Send("❌ 등록되지 않은 사용자입니다."); return; }
                if (!loginRequest[user.id] || loginRequest[user.id].length == 0) { Send("❌ 들어온 로그인 요청이 없습니다."); return; }
                let targetCode = arg ? arg.trim() : null;
                if (!targetCode) { Send("❌ 코드를 입력해주세요."); return; }
                
                let lrIndex = loginRequest[user.id].findIndex(lr => lr.code == targetCode);
                if (lrIndex == -1) {
                    Send("❌ 잘못된 코드입니다.");
                } else {
                    let lr = loginRequest[user.id][lrIndex];
                    if (!user.logged_in.includes(lr.id)) user.logged_in.push(lr.id);
                    await user.save();
                    lr.room.sendChat(`✅ ${user.name} 계정으로 로그인했습니다!`);
                    loginRequest[user.id].splice(lrIndex, 1);
                    Send("✅ 로그인 요청을 승인했습니다.");
                }
                return;
            }

            // 코드 (Deprecated with approval system, but kept for compatibility or admin)
            if (cmd == "코드") {
                if (!user) { Send("❌ 등록되지 않은 사용자입니다."); }
                else if (!channel._channel || !channel._channel.info || channel._channel.info.activeUserCount != 2) { Send("❌ 코드는 1:1 채팅방에서만 확인할 수 있습니다."); }
                else { Send("🔑 코드: " + user.code); }
                return;
            }

            // 레이팅순위
            if (cmd == "레이팅순위" || cmd == "ㄹㅇㅌㅅㅇ") {
                try {
                    const { data, error } = await supabase.from('user_data').select('*').eq('_get', 1).not('rate', 'is', null);
                    if (error) { Send("❌ 순위 조회 과정에서 오류가 발생했습니다."); }
                    else {
                        let users = (data || []).map(r => new User().load(r)).filter(u => u.rate != null && !isNaN(u.rate));
                        if (!users.length) { Send("❌ 레이팅에 참가한 유저가 존재하지 않아 순위를 측정할 수 없습니다."); }
                        else {
                            users.sort((a, b) => b.rate - a.rate);
                            let rateRank = users.map((u, i) => (i + 1) + "위 :: 「" + getTier(u.rate) + "」 " + u + "\n▣ " + u.rate);
                            Send("◆ 레이팅 순위 ◆\n" + VIEWMORE + "\n\n" + rateRank.join("\n\n"));
                        }
                    }
                } catch(e) {
                    Send("❌ 순위 조회 과정에서 오류가 발생했습니다.");
                }
                return;
            }

            // 레이팅조작
            if ((cmd.startsWith("레이팅조작 ") || cmd.startsWith("ㄹㅇㅌㅈㅈ ")) && user && user.isAdmin) {
                let args = cmd.split(" ");
                if (args.length < 3) return;
                let vUser = await getUserByName(args[1]);
                if (!vUser) {
                    Send("❌ 유저를 찾을 수 없습니다.");
                } else if (isNaN(args[2])) {
                    Send("❌ 레이팅은 숫자로 입력해주세요.");
                } else {
                    vUser.rate = Number(args[2]);
                    await vUser.save();
                    Send("✅ 레이팅 변경이 완료되었습니다.");
                }
                return;
            }

            // 완전삭제
            if (cmd.startsWith("완전삭제 ") && user && user.isAdmin) {
                let targetUserName = cmd.split(" ")[1];
                let targetUser = await getUserByName(targetUserName); // Or handle deleted user if you have getDeletedUserByName
                if (!targetUser) {
                    Send("❌ 유저를 찾을 수 없습니다.");
                } else {
                    myCheck[senderID] = {
                        type: "완전삭제",
                        arg: { user: targetUser }
                    };
                    Send("❗ 완전삭제 시 복구가 불가능합니다.\n정말 진행하시겠습니까?\n[ " + PREFIX + "확인 ]");
                }
                return;
            }

            // 확인 (완전삭제 및 등록용)
            if (myCheck[senderID] && cmd == "확인") {
                if (myCheck[senderID].type == "등록") {
                    let nu = new User(myCheck[senderID].arg.name, senderID);
                    let res = await putItem('user_data', nu);
                    if (res.success) {
                        Send("✅ 성공적으로 등록되셨습니다!\n환영합니다, " + nu.name + "님!");
                    } else {
                        Send("❌ 등록 과정에서 오류가 발생했습니다.");
                    }
                } else if (myCheck[senderID].type == "완전삭제") {
                    let res = await deleteItem("user_data", myCheck[senderID].arg.user.id);
                    
                    if (!res.success) {
                        Send("❌ 완전삭제에 실패했습니다.");
                    } else {
                        Send("✅ '" + myCheck[senderID].arg.user.name + "' 유저가 완전히 삭제되었습니다.\n[ 마지막 데이터 ]\n" + VIEWMORE + "\n" + JSON.stringify(myCheck[senderID].arg.user, null, 4));
                    }
                }
                delete myCheck[senderID];
                return;
            }

            // 게임무효
            if (["게임무효","ㄱㅇㅁㅎ","무효","ㅁㅎ"].includes(cmd.split(" ")[0]) && user && user.isAdmin) {
                let gameIdOrRoom = cmd.split(" ")[1];
                let game = null;
                if (!gameIdOrRoom) {
                    game = await getGameByRoomId(roomid);
                    if (!game) { Send("❌ 이 방에서 진행중인 게임이 없습니다."); return; }
                } else {
                    game = await getGameById(gameIdOrRoom);
                    if (!game) { Send("❌ 게임을 찾을 수 없습니다."); return; }
                }

                let gameP1 = await getUserByName(game.player[0]);
                let gameP2 = await getUserByName(game.player[1]);
                game.state.playing = false;
                if (gameP1) gameP1.playing = {};
                if (gameP2) gameP2.playing = {};
                game.result = { state: "무효" };
                clearAllTimers(game.id);
                await game.save();
                if (gameP1) await gameP1.save();
                if (gameP2) await gameP2.save();
                Send("✅ " + game.id + "번 게임이 무효 처리되었습니다.\n해당 게임은 승률이나 연승에 영향을 끼치지 않습니다.");
                return;
            }

            // 게임중단
            if (["게임중단","ㄱㅇㅈㄷ","중단","ㅈㄷ"].includes(cmd.split(" ")[0]) && user && user.isAdmin) {
                let gameIdOrRoom = cmd.split(" ")[1];
                let game = null;
                if (!gameIdOrRoom) {
                    game = await getGameByRoomId(roomid);
                    if (!game) { Send("❌ 이 방에서 진행중인 게임이 없습니다."); return; }
                } else {
                    game = await getGameById(gameIdOrRoom);
                    if (!game) { Send("❌ 게임을 찾을 수 없습니다."); return; }
                    if (!game.state.playing) { Send("❌ 진행중인 게임이 아니므로 중단할 수 없습니다."); return; }
                }

                let gameP1 = await getUserByName(game.player[0]);
                let gameP2 = await getUserByName(game.player[1]);
                game.state.playing = false;
                game.result = {
                    state: "중단",
                    player: [gameP1.id, gameP2.id],
                    room: gameP1.playing.game ? gameP1.playing.game.room : roomName
                };
                if (gameP1) gameP1.playing = {};
                if (gameP2) gameP2.playing = {};
                clearAllTimers(game.id);
                await game.save();
                if (gameP1) await gameP1.save();
                if (gameP2) await gameP2.save();
                Send("✅ " + game.id + "번 게임이 중단되었습니다.\n언제든지 재개할 수 있습니다.");
                return;
            }

            // 게임재개
            if (["게임재개","ㄱㅇㅈㄱ","재개","ㅈㄱ"].includes(cmd.split(" ")[0]) && user && user.isAdmin) {
                let rgame = await getGameByRoomId(roomid);
                if (rgame) { Send("❌ 이미 이 방에서 진행중인 게임이 있습니다."); return; }
                
                let gameId = cmd.split(" ")[1];
                if (!gameId) return;
                
                let game = await getGameById(gameId);
                if (!game) { Send("❌ 게임을 찾을 수 없습니다."); return; }
                if (game.result.state != "중단") { Send("❌ 중단된 게임이 아닙니다."); return; }

                let gameP1 = await getUserById(game.result.player[0]);
                let gameP2 = await getUserById(game.result.player[1]);
                
                if (gameP1 && gameP1.playing.game) {
                    let p1g = await getGameById(gameP1.playing.game.id);
                    if (p1g && p1g.state.playing) {
                        Send("❌ " + gameP1.name + "님이 게임을 진행중입니다.\n\n방: " + gameP1.playing.game.room + "\n게임: " + gameP1.playing.game.type + "\n상대: " + gameP1.playing.game.enemy + "님");
                        return;
                    }
                }
                if (gameP2 && gameP2.playing.game) {
                    let p2g = await getGameById(gameP2.playing.game.id);
                    if (p2g && p2g.state.playing) {
                        Send("❌ " + gameP2.name + "님이 게임을 진행중입니다.\n\n방: " + gameP2.playing.game.room + "\n게임: " + gameP2.playing.game.type + "\n상대: " + gameP2.playing.game.enemy + "님");
                        return;
                    }
                }

                game.state.playing = true;
                if (gameP1) gameP1.playing.game = { id: game.id, room: roomName, type: game.type, enemy: gameP2.name };
                if (gameP2) gameP2.playing.game = { id: game.id, room: roomName, type: game.type, enemy: gameP1.name };
                game.room_id = roomid;
                game.state.last = new Date().toString();
                game.result = {};
                await game.save();
                if (gameP1) await gameP1.save();
                if (gameP2) await gameP2.save();
                Send("✅ " + game.id + "번 게임이 재개되었습니다.\n" + gameP1.name + " vs " + gameP2.name + "\n[ " + PREFIX + "상태 ] 를 입력해주세요.");
                return;
            }

            // 커스텀
            if (cmd.startsWith("커스텀 ") || cmd.startsWith("ㅋㅅㅌ ")) {
                let rgame = await getGameByRoomId(roomid);
                if (rgame) { Send("❌ 이미 이 방에서 진행중인 게임이 있습니다."); return; }
                
                let args = cmd.split(" ");
                if (args.length < 5) { Send("❌ 제대로 입력되지 않았습니다.\n" + PREFIX + "커스텀 [P1] [P2] [차례] [수]"); return; }
                
                let player1 = await getUserByName(args[1]);
                if (!player1) { Send("❌ " + args[1] + " 유저가 존재하지 않습니다."); return; }
                if (player1.playing.game) {
                    let p1g = await getGameById(player1.playing.game.id);
                    if (p1g && p1g.state.playing) { Send("❌ " + player1.name + "님이 게임을 진행중입니다.\n\n방: " + player1.playing.game.room + "\n게임: " + player1.playing.game.type + "\n상대: " + player1.playing.game.enemy + "님"); return; }
                }
                
                let player2 = await getUserByName(args[2]);
                if (!player2) { Send("❌ " + args[2] + " 유저가 존재하지 않습니다."); return; }
                if (player2.playing.game) {
                    let p2g = await getGameById(player2.playing.game.id);
                    if (p2g && p2g.state.playing) { Send("❌ " + player2.name + "님이 게임을 진행중입니다.\n\n방: " + player2.playing.game.room + "\n게임: " + player2.playing.game.type + "\n상대: " + player2.playing.game.enemy + "님"); return; }
                }
                
                if (args[3] != player1.name && args[3] != player2.name) { Send("❌ 차례는 참가자 중에서 지정해야 합니다."); return; }
                
                let input_words = args.splice(4, 100);
                let words = [];
                let tempSyl = input_words[0].substr(0, 1);
                let tempSyl2 = dueum(tempSyl);
                
                for (let i = 0; i < input_words.length; i++) {
                    if (input_words[i].length <= 1) { Send("❌ 단어는 모두 2글자 이상으로 입력되어야 합니다."); return; }
                    if (input_words[i].substr(0, 1) != tempSyl && input_words[i].substr(0, 1) != tempSyl2) { Send("❌ 끝말이 맞지 않는 부분이 있습니다.\n>> " + input_words[i - 1] + " " + input_words[i]); return; }
                    if (!allword.includes(input_words[i])) { Send("❌ 존재하지 않는 단어가 있습니다.\n>> " + input_words[i]); return; }
                    if (words.includes(input_words[i])) { Send("❌ 중복되는 단어가 있습니다.\n>> " + input_words[i]); return; }
                    words.push(input_words[i]);
                    tempSyl = input_words[i].substr(-1);
                    tempSyl2 = dueum(tempSyl);
                }
                
                let game = new Game("끝말", [player1.name, player2.name], roomid);
                // Dynamically get highest id
                let countRes = 1;
                try {
                    const { data: allGames, error } = await supabase.from('game_data').select('id').eq('_get', 1).order('id', { ascending: false }).limit(1);
                    if (!error && allGames && allGames.length > 0) {
                        countRes = allGames[0].id + 1;
                    }
                } catch(e) {
                    // Fallback to 1 if query fails
                }
                game.id = countRes;
                game.word = input_words;
                game.state.syl = tempSyl;
                game.state.syl2 = tempSyl2;
                game.state.order = game.player.indexOf(args[3]);
                
                let res = await putItem('game_data', game);
                if (!res.success) {
                    Send("❌ 게임 생성 과정에서 오류가 발생했습니다.");
                } else {
                    player1.playing.game = { id: game.id, room: roomName, type: game.type, enemy: player2.name };
                    player2.playing.game = { id: game.id, room: roomName, type: game.type, enemy: player1.name };
                    await player1.save();
                    await player2.save();
                    Send("✅ 끝말잇기 " + game.id + "번 게임이 생성되었습니다.");
                    Send("∴ 구엜룰 | " + game.player[0] + " vs " + game.player[1] + "\n\n" + game.word.join(" ") + "\n\n" + game.state.syl + (game.state.syl == game.state.syl2 ? "" : "(" + game.state.syl2 + ")") + " | " + game.player[game.state.order] + "님 차례");
                }
                return;
            }
            if (cmd == "스펠순위" || cmd == "ㅅㅍㅅㅇ") {
                try {
                    const { data, error } = await supabase.from('user_data').select('*').eq('_get', 1).gt('lp', 0);
                    if (error) { Send("❌ 순위 조회 과정에서 오류가 발생했습니다."); }
                    else {
                        let users = (data || []).map(r => new User().load(r)).filter(u => u.lp > 0);
                        if (!users.length) { Send("❌ LP가 1 이상인 유저가 존재하지 않아 순위를 측정할 수 없습니다."); }
                        else {
                            users.sort((a, b) => b.lp - a.lp);
                            let rateRank = users.map((u, i) => (i + 1) + "위 :: " + u + "\n▣ " + numberWithCommas(u.lp.toString()));
                            Send("◆ 스펠룰 LP 순위 ◆\n" + VIEWMORE + "\n\n" + rateRank.join("\n\n"));
                        }
                    }
                } catch(e) {
                    Send("❌ 순위 조회 과정에서 오류가 발생했습니다.");
                }
                return;
            }

            // 유저정보
            if (cmd.startsWith("유저정보") || cmd.startsWith("ㅇㅈㅈㅂ") || cmd.startsWith("승률정보") || cmd.startsWith("ㅅㄹㅈㅂ")) {
                let targetUserName = arg ? arg.trim() : (user ? user.name : null);
                let targetUser = targetUserName ? await getUserByName(targetUserName) : null;
                if (!targetUser) {
                    Send("❌ 봇에 등록되지 않은 사용자입니다.");
                } else {
                    let userInfo = [];
                    let games = (await getAllGame(targetUser.id)).filter(g => g.word && g.word.length >= 3).sort((a, b) => a.id - b.id);
                    let gameTypes = ["끝말", "레이팅", "밴룰", "쿵따", "스펠"];
                    gameTypes.forEach(type => {
                        let thisGames = games.filter(g => g.type == type);
                        let winGames = thisGames.filter(g => g.result && g.result.win && g.result.win.id == targetUser.id);
                        let loseGames = thisGames.filter(g => g.result && g.result.lose && g.result.lose.id == targetUser.id);
                        let thisGame = {
                            win: winGames.length,
                            lose: loseGames.length
                        };
                        thisGame.num = thisGame.win + thisGame.lose;
                        thisGame.streak = getWinStreak(thisGames, targetUser.id).cur;

                        if (thisGame.num > 0)
                            userInfo.push("≪ " + (type == "끝말" ? "구엜룰" : type == "쿵따" ? "쿵쿵따" : type == "스펠" ? "스펠룰" : type) + " ≫\n:: " + thisGame.num + "전 " + thisGame.win + "승 " + thisGame.lose + "패 (승률 " + (thisGame.win / thisGame.num * 100).toFixed(2) + "%)" + (type == "레이팅" ? "\n:: 레이팅 점수: " + targetUser.rate + "\n:: 레이팅 티어: " + getTier(targetUser.rate) : type == "스펠" ? "\n:: LP: " + numberWithCommas(targetUser.lp.toString()) : "") + (thisGame.streak > 0 ? "\n:: 『 " + thisGame.streak + "연승 중! 』" : ""));
                    });
                    Send("[ " + targetUser.name + "님의 정보 ]\n\n" + (userInfo.length == 0 ? "승률 정보가 없습니다." : userInfo.join("\n\n")) + "\n\n※ 세 수 이상 진행되어야 인정됩니다.");
                }
                return;
            }

            // 게임목록
            if (cmd.startsWith("게임목록") || cmd.startsWith("ㄱㅇㅁㄹ")) {
                let targetUserName = arg ? arg.trim() : (user ? user.name : null);
                let targetUser = targetUserName ? await getUserByName(targetUserName) : null;
                if (!targetUser) {
                    Send("❌ 봇에 등록되지 않은 사용자입니다.");
                } else {
                    let userInfo = [];
                    let games = (await getAllGame(targetUser.id)).filter(g => g.word && g.word.length >= 3).sort((a, b) => a.id - b.id);
                    let gameTypes = ["끝말", "레이팅", "밴룰", "쿵따", "스펠"];
                    gameTypes.forEach(type => {
                        let thisGames = games.filter(g => g.type == type);
                        let thisGame = {
                            win: thisGames.filter(g => g.result && g.result.win && g.result.win.id == targetUser.id).map(g => g.id),
                            lose: thisGames.filter(g => g.result && g.result.lose && g.result.lose.id == targetUser.id).map(g => g.id)
                        };
                        thisGame.num = thisGame.win.length + thisGame.lose.length;
                        
                        if (thisGame.num > 0)
                            userInfo.push("≪ " + (type == "끝말" ? "구엜룰" : type == "쿵따" ? "쿵쿵따" : type == "스펠" ? "스펠룰" : type) + " ≫" + (thisGame.win.length > 0 ? "\n:: 승리한 게임 ::\n" + thisGame.win.join(", ") : "") + (thisGame.lose.length > 0 ? (thisGame.win.length > 0 ? "\n" : "") + "\n:: 패배한 게임 ::\n" + thisGame.lose.join(", ") : ""));
                    });
                    Send("[ " + targetUser.name + "님이 플레이한 게임 목록 ]" + (userInfo.length == 0 ? "" : "\n" + VIEWMORE) + "\n\n" + (userInfo.length == 0 ? "게임을 플레이하지 않았습니다." : userInfo.join("\n\n")) + "\n\n※ 세 수 이상 진행되어야 인정됩니다.");
                }
                return;
            }

            // 끝말잇기 매칭
            if (cmd.substr(-3) == "1ㄷ1" || ["끝말","ㄲㅁ","구엜","ㄱㅇ","끝말잇기","ㄲㅁㅇㄱ","끝잇","ㄲㅇ","순위전","ㅅㅇㅈ","레이팅","ㄹㅇㅌ","스펠","ㅅㅍ","스펠룰","구엜룰","밴룰","ㅂㄹ"].includes(cmd)) {
                if (["끝말","ㄲㅁ","구엜","ㄱㅇ","구엜룰","끝말잇기","ㄲㅁㅇㄱ","끝잇","ㄲㅇ"].includes(cmd)) cmd = "끝말1ㄷ1";
                if (["순위전","ㅅㅇㅈ"].includes(cmd)) cmd = "순위전1ㄷ1";
                if (["레이팅","ㄹㅇㅌ"].includes(cmd)) cmd = "레이팅1ㄷ1";
                if (["스펠","ㅅㅍ","스펠룰","구엜룰"].includes(cmd)) cmd = "스펠1ㄷ1";
                if (["밴룰","ㅂㄹ"].includes(cmd)) cmd = "밴룰1ㄷ1";

                if (["끝말","순위전","레이팅","스펠","밴룰"].includes(cmd.substr(0, cmd.length - 3))) {
                    let roomgame = await getGameByRoomId(roomid);
                    let gameType = cmd.substr(0, cmd.length - 3);
                    let enterType = (gameType == "끝말" ? "구엜룰" : gameType == "스펠" ? "스펠룰" : gameType);

                    if (!user) { Send("❌ 봇에 등록되지 않은 사용자입니다.\n>> " + PREFIX + "등록 [닉네임]"); }
                    else if (user.playing.game) {
                        let pg = await getGameById(user.playing.game.id);
                        if (pg && pg.state.playing) { Send("❌ 이미 게임을 진행중입니다.\n\n방: " + user.playing.game.room + "\n게임: " + user.playing.game.type + "\n상대: " + user.playing.game.enemy + "님"); return; }
                    }
                    if (roomgame && roomgame.state.playing) { Send("❌ 이미 이 방에서 게임을 진행하고 있습니다.\n\n게임: " + roomgame.type + "\n" + roomgame.player[0] + " vs " + roomgame.player[1]); }
                    else if (wordchainQueue[roomid] && wordchainQueue[roomid].find(r => r.wait == user.name)) { Send("❌ 이미 대기중입니다.\n취소하시려면 " + PREFIX + "취소"); }
                    else if (user) {
                        if (!wordchainQueue[roomid]) wordchainQueue[roomid] = [];
                        if (!wordchainQueue[roomid].find(r => r.type == gameType)) {
                            wordchainQueue[roomid].push({ type: gameType, wait: user.name, timeout: setTimeout(function () { if (wordchainQueue[roomid] && wordchainQueue[roomid].find(r => r.wait == user.name)) { wordchainQueue[roomid].splice(wordchainQueue[roomid].findIndex(r => r.wait == user.name), 1); Send("5분이 지나 " + user + "님의 " + enterType + " 요청이 취소되었습니다."); } }, 300000) });
                            Send("✅ " + user + "님이 " + enterType + " 게임을 요청합니다.");
                        } else {
                            let waitObj = wordchainQueue[roomid].find(r => r.type == gameType);
                            let waitUser = await getUserByName(waitObj.wait);
                            if (!waitUser) {
                                Send("❌ 대기 중인 유저 정보를 불러오지 못했습니다.");
                                delete wordchainQueue[roomid];
                                return;
                            }
                            if (waitUser.playing.game) {
                                let wg = await getGameById(waitUser.playing.game.id);
                                if (wg && wg.state.playing) {
                                    Send(waitUser + "님이 다른 방에서 게임을 시작하셨습니다. 요청이 취소됩니다.");
                                    wordchainQueue[roomid].splice(wordchainQueue[roomid].findIndex(r => r.wait == waitUser.name), 1);
                                    wordchainQueue[roomid].push({ type: gameType, wait: user.name, timeout: setTimeout(function () { if (wordchainQueue[roomid] && wordchainQueue[roomid].find(r => r.wait == user.name)) { wordchainQueue[roomid].splice(wordchainQueue[roomid].findIndex(r => r.wait == user.name), 1); Send("5분이 지나 " + user + "님의 " + enterType + " 요청이 취소되었습니다."); } }, 300000) });
                                    Send("✅ " + user.name + "님이 " + enterType + " 게임을 요청합니다.");
                                    return;
                                }
                            }
                            // 매칭 성사
                            let game = new Game(gameType, [waitObj.wait, user.name], roomid);
                            let countRes = 1;
                            try {
                                const { data: allGames, error } = await supabase.from('game_data').select('id').eq('_get', 1).order('id', { ascending: false }).limit(1);
                                if (!error && allGames && allGames.length > 0) {
                                    countRes = allGames[0].id + 1;
                                }
                            } catch(e) {
                                // Fallback to 1 if query fails
                            }
                            game.id = countRes;
                            game.p1 = waitUser.id; game.p2 = user.id;
                            waitUser.playing.game = { id: game.id, room: roomName, type: game.type, enemy: user.name };
                            user.playing.game = { id: game.id, room: roomName, type: game.type, enemy: waitUser.name };
                            if (game.type == "순위전" || game.type == "레이팅") { waitUser.playing.game.timeLimit = 420000; user.playing.game.timeLimit = 420000; waitUser.playing.game.overtime = 3; user.playing.game.overtime = 3; waitUser.playing.game.isOvertime = false; user.playing.game.isOvertime = false; }
                            if (game.type == "스펠") { waitUser.playing.game.cooldown = 0; user.playing.game.cooldown = 0; game.state.CANUSEKILL = true; game.state.CANUSELEAD = true; game.state.mode = "스펠"; game.state.canUseWords = []; game.state.mustUseUsedWord = false; game.state.spell = {}; Object.keys(spellrule.spell).forEach(k => { game.state.spell[k] = { desc: spellrule.spell[k].desc, used: false }; }); }
                            let res = await putItem('game_data', game);
                            if (!res.success) { Send("❌ 매칭 과정에서 오류가 발생했습니다.\n디버그: " + (res.result[0].message || res.result[0].Message || JSON.stringify(res.result))); }
                            else {
                                await waitUser.save(); await user.save(); clearTimeout(waitObj.timeout);
                                Send("〈 끝말잇기 #" + game.id + " 〉\n" + enterType + " 게임이 매칭되었습니다!\n>> " + game.player[0] + " vs " + game.player[1] + "\n\n[ ▼ 게임 설명 ▼ ]" + VIEWMORE + "\n◆ 0(단어)를 입력해 진행할 수 있습니다.\n" + read(game.type + ".txt"));
                                if (game.type == "레이팅" && waitUser.rate && user.rate && Math.abs(waitUser.rate - user.rate) >= 500) Send("❗ 주의: 레이팅 점수가 500점 이상 차이납니다.");
                            }
                            delete wordchainQueue[roomid];
                        }
                    }
                }
                return;
            }

            // 취소
            if (cmd == "취소" || cmd == "ㅊㅅ") {
                if (user && wordchainQueue[roomid] && wordchainQueue[roomid].find(r => r.wait == user.name)) {
                    let wq = wordchainQueue[roomid].find(r => r.wait == user.name);
                    channel.sendChat("✅ " + wq.type + "1ㄷ1 요청이 정상적으로 취소되었습니다.");
                    clearTimeout(wq.timeout);
                    wordchainQueue[roomid].splice(wordchainQueue[roomid].findIndex(r => r.wait == user.name), 1);
                }
                return;
            }

            // 잠수킥
            if (["잠수킥","ㅈㅅㅋ","ㅋ","킥"].includes(cmd)) {
                let roomgame = await getGameByRoomId(roomid);
                if (roomgame) {
                    let game = roomgame;
                    let now = new Date(), recent = new Date(game.state.last);
                    if (Math.abs((now - recent) / 1000) < 180) { channel.sendChat("❌ 마지막 입력으로부터 3분 뒤 잠수킥이 활성화됩니다.\n\n현재 마지막 입력으로부터 " + toTimeNotation(Math.round((now - recent) / 1000)) + " 경과했습니다."); }
                    else if (getTimer(game.id).afk) { channel.sendChat("❌ 이미 잠수킥이 진행중입니다."); }
                    else {
                        if (game.state.order == null) {
                            let gp1 = await getUserByName(game.player[0]), gp2 = await getUserByName(game.player[1]);
                            game.state.playing = false; game.result = { state: "무효" }; gp1.playing = {}; gp2.playing = {};
                            await game.save(); await gp1.save(); await gp2.save(); clearAllTimers(game.id);
                            channel.sendChat("✅ 단어가 입력되지 않아 게임이 무효 처리되었습니다.");
                        } else {
                            let AFKUser = await getUserByName(game.player[game.state.order]);
                            let t = getTimer(game.id);
                            t.afkUser = AFKUser.name;
                            t.afk = setTimeout(async function () {
                                Send("◈ " + AFKUser + "님이 입력하지 않아 잠수로 간주하고 게임을 종료합니다.");
                                let afkEnemy = await getUserByName(AFKUser.playing.game.enemy);
                                await game.end(afkEnemy, channel);
                            }, 15000);
                            game.state.afkKick.user = AFKUser.name; await game.save();
                            Send(AFKUser + "님, 15초 이내에 아무 채팅이나 입력하세요.");
                        }
                    }
                }
                return;
            }

            // 게임정보
            if (["게임정보","ㄱㅇㅈㅂ"].includes(cmd.split(" ")[0])) {
                if (cmd.split(" ")[1]) { let g = await getGameById(cmd.split(" ")[1]); if (!g) channel.sendChat("❌ 게임을 찾을 수 없습니다."); else Send(g.toString()); }
                return;
            }

            // 상태
            if (["상태","ㅅㅌ"].includes(cmd)) {
                if (user && user.playing.game && (await getGameByPlayerName(user.name))) {
                    let game = await getGameById(user.playing.game.id);
                    if (game.type == "끝말" || game.type == "밴룰") { Send("∴ " + (game.type == "끝말" ? "구엜룰" : game.type) + " | " + game.player[0] + " vs " + game.player[1] + (game.state.banned ? "\n⛔ " + game.state.banned : "") + "\n\n" + game.word.join(" ") + "\n\n" + game.state.syl + (game.state.syl == game.state.syl2 ? "" : "(" + game.state.syl2 + ")") + " | " + game.player[game.state.order] + "님 차례"); }
                    else if (game.type == "순위전" || game.type == "레이팅") { let now = new Date(), recent = new Date(game.state.last); let np = await getUserByName(game.player[game.state.order]), en = await getUserByName(np.playing.game.enemy); Send("⚜️ " + game.type + " | " + game.player[0] + " vs " + game.player[1] + "\n\n" + game.word.join(" ") + "\n\n" + game.state.syl + (game.state.syl == game.state.syl2 ? "" : "(" + game.state.syl2 + ")") + " | " + game.player[game.state.order] + "님 차례\n⏱️ " + msToMinSec(Math.round(np.playing.game.timeLimit - (now - recent))) + " 남음"); }
                    else if (game.type == "스펠") { let now = new Date(), recent = new Date(game.state.last); Send("🌟 스펠룰 | " + game.player[0] + " vs " + game.player[1] + "\n\n" + game.word.join(" ") + "\n\n" + game.state.syl + (game.state.syl == game.state.syl2 ? "" : "(" + game.state.syl2 + ")") + " | " + game.player[game.state.order] + "님 차례\n⏱️ " + msToMinSec(Math.round(60000 - (now - recent))) + " 안에 이어가세요!"); }
                }
                return;
            }

            // 바꾸기
            if (["바꾸기","ㅂㄲㄱ"].includes(cmd)) {
                if (user && user.playing.game && (await getGameByPlayerName(user.name))) {
                    let game = await getGameById(user.playing.game.id);
                    if (game.state.switch) { Send("❌ 이미 바꾸기 요청이 되어있습니다."); }
                    else if (game.state.order == null) { Send("❌ 차례가 정해지지 않은 상태에서 바꾸기를 할 수 없습니다."); }
                    else { game.state.backsies = null; game.state.switch = user.playing.game.enemy; await game.save(); Send(user.playing.game.enemy + "님, 차례 바꾸기에 동의하시겠습니까?\n\n[ " + PREFIX + "동의 ] [ " + PREFIX + "거절 ]"); }
                }
                return;
            }

            // 무르기
            if (cmd.startsWith("무르기 ") || cmd.startsWith("ㅁㄹㄱ ") || cmd.startsWith("ㅁㄺ ")) {
                if (user && user.playing.game && (await getGameByPlayerName(user.name))) {
                    let game = await getGameById(user.playing.game.id);
                    if (game.type == "끝말") {
                        let tw = cmd.split(" ")[1];
                        if (!game.word.includes(tw)) { Send("❌ 사용되지 않은 단어이므로 무르기가 불가능합니다."); }
                        else if (game.state.backsies) { Send("❌ 이미 무르기 요청이 되어있습니다.\n\n요청자: " + game.state.backsies.sender + "\n대상 단어: " + game.state.backsies.target); }
                        else { game.state.switch = null; game.state.backsies = { sender: user.name, target: tw }; await game.save(); Send(user.playing.game.enemy + "님, 무르기에 동의하시겠습니까?\n\n[ " + PREFIX + "동의 ] [ " + PREFIX + "거절 ]"); }
                    } else { Send("❌ 무르기는 기본 구엜룰에서만 가능합니다."); }
                }
                return;
            }

            // 동의
            if (cmd == "동의" || cmd == "ㄷㅇ") {
                if (user && user.playing.game && (await getGameByPlayerName(user.name))) {
                    let game = await getGameById(user.playing.game.id);
                    if (game.state.backsies && game.state.backsies.sender == user.playing.game.enemy) {
                        Send("✅ 무르기에 동의하셨습니다.");
                        while (true) { var lw = game.word.pop(); if (lw == game.state.backsies.target) { game.word.push(lw); break; } game.state.order ^= 1; game.state.syl = game.word[game.word.length - 1].substr(-1); game.state.syl2 = dueum(game.state.syl); }
                        game.state.backsies = null; game.state.last = new Date().toString(); await game.save();
                        Send("∴ 구엜룰 | " + game.player[0] + " vs " + game.player[1] + "\n\n" + game.word.join(" ") + "\n\n" + game.state.syl + (game.state.syl == game.state.syl2 ? "" : "(" + game.state.syl2 + ")") + " | " + game.player[game.state.order] + "님 차례");
                    } else if (game.state.switch && user.name == game.state.switch) {
                        Send("✅ 차례 바꾸기에 동의하셨습니다.");
                        game.state.switch = null;
                        let ntr = await game.nextTurn(user); ntr.message.forEach(m => Send(m)); if (ntr.end) await game.end(ntr.end, channel);
                    }
                }
                return;
            }

            // 거절
            if (cmd == "거절" || cmd == "ㄱㅈ") {
                if (user && user.playing.game && (await getGameByPlayerName(user.name))) {
                    let game = await getGameById(user.playing.game.id);
                    if (game.state.backsies && game.state.backsies.sender == user.playing.game.enemy) { Send("✅ 무르기를 거절하셨습니다."); game.state.backsies = null; await game.save(); }
                    else if (game.state.switch) { Send("✅ 차례 바꾸기를 거절하셨습니다."); game.state.switch = null; await game.save(); }
                }
                return;
            }

            // 뺏기
            if (cmd == "뺏기" || cmd == "ㅃㄱ") {
                if (user && user.playing.game) {
                    let game = await getGameByPlayerName(user.name);
                    if (game && !game.state.steal && game.word.length == 1 && game.state.order == game.player.indexOf(user.name)) {
                        let enemy = await getUserByName(user.playing.game.enemy);
                        game.state.steal = true;
                        if (["순위전","레이팅"].includes(game.type)) {
                            game.state.order ^= 1; game.state.last = new Date().toString();
                            let t = getTimer(game.id);
                            const recursiveTimeout = async function () {
                                let eu = await getUserByName(enemy.name);
                                if (!eu.playing.game) return;
                                if (!eu.playing.game.isOvertime) { eu.playing.game.isOvertime = true; eu.playing.game.overtime--; eu.playing.game.timeLimit = 60000; Send(eu.name + "님, 시간이 초과되었습니다.\n초읽기 모드로 진입합니다."); await eu.save(); t.turn = setTimeout(recursiveTimeout, eu.playing.game.timeLimit); }
                                else if (eu.playing.game.overtime > 0) { eu.playing.game.overtime--; if (eu.playing.game.overtime > 0) Send(eu.name + "님, 초읽기 기회가 " + eu.playing.game.overtime + "회 남았습니다."); else Send(eu.name + "님, 마지막 초읽기 기회입니다."); await eu.save(); t.turn = setTimeout(recursiveTimeout, eu.playing.game.timeLimit); }
                                else { Send("◈ " + eu.name + "님이 제한시간 내에 입력하지 않아 패배하셨습니다."); let wu = await getUserByName(eu.playing.game.enemy); await game.end(wu, channel); }
                            };
                            t.turn = setTimeout(recursiveTimeout, enemy.playing.game.timeLimit);
                            await game.save(); await user.save(); await enemy.save();
                            Send("⚜️ " + game.type + " | " + game.player[0] + " vs " + game.player[1] + "\n\n" + game.word.join(" ") + "\n\n" + game.state.syl + (game.state.syl == game.state.syl2 ? "" : "(" + game.state.syl2 + ")") + " | " + game.player[game.state.order] + "님 차례\n⏱️ " + msToMinSec(enemy.playing.game.timeLimit) + " 남음");
                        } else if (game.type == "끝말" || game.type == "밴룰") {
                            let ntr = await game.nextTurn(); Send(ntr.message[0]);
                        }
                    }
                }
                return;
            }

            // 스펠목록
            if (["스펠목록","ㅅㅍㅁㄹ"].includes(cmd)) { Send("[ 스펠 목록 ]\n" + VIEWMORE + "\n" + Object.keys(spellrule.spell).map(s => "[ " + s + " ]\n· " + spellrule.spell[s].desc.join("\n· ")).join("\n\n")); return; }

            // 남은스펠
            if (["남은스펠","ㄴㅇㅅㅍ","ㄴㅇ"].includes(cmd)) {
                if (user && user.playing.game) { let g = await getGameById(user.playing.game.id); if (g && g.type == "스펠") { let rs = Object.keys(g.state.spell).filter(s => !g.state.spell[s].used); if (rs.length > 0) Send(rs.sort().join(", ")); else Send("❌ 모든 스펠을 사용하였습니다."); } }
                return;
            }

            // 스펠설명
            if (cmd.startsWith("스펠설명 ") || cmd.startsWith("ㅅㅍㅅㅁ ")) { let cs = cmd.substr(5); if (!spellrule.spell[cs]) Send("❌ 존재하지 않는 스펠입니다."); else Send("[ " + cs + " ]\n· " + spellrule.spell[cs].desc.join("\n· ")); return; }

            // 단어/뜻 조회
            // if (["단어","뜻","ㄸ"].includes(cmd.split(" ")[0])) {
            //     if (arg) {
            //         let q = arg.trim();
            //         if (!allword.includes(q)) { Send("❌ 구엜룰 기준 존재하지 않는 단어입니다."); }
            //         else {
            //             let types = [];
            //             if (neosyl.includes(q.substr(-1))) types.push("한방");
            //             if (leadsyl.includes(q.substr(-1))) types.push("유도");
            //             if (routesyl.includes(q.substr(-1))) types.push("루트");
            //             if (!types.length) types.push("일반");
            //             let mean = await getMean(q);
            //             Send("✅ 구엜룰 기준 존재하는 단어입니다.\n\n유형: " + types.join(", ") + "\n끝말: " + q.substr(-1) + (q.substr(-1) == dueum(q.substr(-1)) ? "" : "(" + dueum(q.substr(-1)) + ")") + (mean ? "\n뜻: " + mean : ""));
            //         }
            //     }
            //     return;
            // }

            // 도움말
            if (["도움말","명령어","?","ㄷㅇㅁ","ㅁㄹㅇ"].includes(cmd)) {
                let helpText = fs.existsSync("DB/도움말.txt") ? read("DB/도움말.txt") : read("도움말.txt");
                if (helpText != 'null') Send(helpText.replace("--", VIEWMORE).replace(/\$/g, PREFIX));
                return;
            }

            // 레이팅티어
            if (cmd == "레이팅티어" || cmd == "ㄹㅇㅌㅌㅇ") {
                let tierText = fs.existsSync("DB/레이팅티어.txt") ? read("DB/레이팅티어.txt") : read("레이팅티어.txt");
                if (tierText != 'null') Send(tierText.replace("--", VIEWMORE));
                return;
            }

            // 검색 / 모든 / 루트 / 한방 / 유도 / 공단
            if (cmd.indexOf(" ") > 0 && ["모든","모두","ㅁㄷ","루트","ㄹㅌ","ㄾ","한방","ㅎㅂ","유도","ㅇㄷ","공단","ㄱㄷ","검색","ㄱㅅ"].includes(cmd.split(" ")[0])) {
                let sType = ["모든","모두","ㅁㄷ"].includes(cmd.split(" ")[0]) ? "모두" : ["루트","ㄹㅌ","ㄾ"].includes(cmd.split(" ")[0]) ? "루트" : ["한방","ㅎㅂ"].includes(cmd.split(" ")[0]) ? "한방" : ["유도","ㅇㄷ"].includes(cmd.split(" ")[0]) ? "유도" : ["공단","ㄱㄷ"].includes(cmd.split(" ")[0]) ? "공단" : "검색";
                let result = await searchWord(cmd.split(" ")[1], sType);
                if (sType == "검색") {
                    let sm = ["[ " + cmd.split(" ")[1] + " 검색 결과 (" + result.search.Len + "건) ]\n" + VIEWMORE];
                    if (result.search.kill.length > 0) sm.push("< 한방단어: " + result.search.kill.length + "개 >\n" + result.search.kill.join(", ") + "\n");
                    if (result.search.lead.length > 0) sm.push("< 유도단어: " + result.search.lead.length + "개 >\n" + result.search.lead.join(", ") + "\n");
                    if (result.search.route.length > 0) sm.push("< 루트단어: " + result.search.route.length + "개 >\n" + result.search.route.join(", ") + "\n");
                    if (result.search.normal.length > 0) sm.push("< 일반단어: " + result.search.normal.length + "개 >\n" + result.search.normal.join(", ") + "\n");
                    if (result.search.Len == 0) sm.push("검색 결과가 없습니다."); else Send(sm.join("\n"));
                } else {
                    let sm = ["[ " + cmd.split(" ")[1] + " " + sType + " 검색 결과 (" + (result.starts.Len + result.ends.Len) + "건) ]\n" + VIEWMORE];
                    if (result.starts.Len > 0) { sm.push("《 첫 음절 》");
                        if (result.starts.kill.length > 0) sm.push("한방: " + result.starts.kill.join(", "));
                        if (result.starts.lead.length > 0) sm.push("유도: " + result.starts.lead.join(", "));
                        if (result.starts.route.length > 0) sm.push("루트: " + result.starts.route.join(", "));
                        if (result.starts.normal.length > 0) sm.push("일반: " + result.starts.normal.join(", ")); sm.push(""); }
                    if (result.ends.Len > 0) { sm.push("《 끝 음절 》");
                        if (result.ends.kill.length > 0) sm.push("한방: " + result.ends.kill.join(", "));
                        if (result.ends.lead.length > 0) sm.push("유도: " + result.ends.lead.join(", "));
                        if (result.ends.route.length > 0) sm.push("루트: " + result.ends.route.join(", "));
                        if (result.ends.normal.length > 0) sm.push("일반: " + result.ends.normal.join(", ")); }
                    if (result.starts.Len == 0 && result.ends.Len == 0) sm.push("검색 결과가 없습니다."); else Send(sm.join("\n"));
                }
                return;
            }
        }

        // ====== Non-prefix: Spell usage (S...) ======
        if (user && user.playing.game && msg.toUpperCase().startsWith("S") && msg.length > 1) {
            let game = await getGameByPlayerName(user.name);
            if (game && game.type == "스펠") {
                let cmdSpell = msg.substr(1);
                if (!game.state.spell[cmdSpell]) {
                    Send("❌ 존재하지 않는 스펠입니다.");
                } else if (game.state.spell[cmdSpell].used) {
                    Send("❌ 이미 사용된 스펠입니다.");
                } else if (game.word.length < 2) {
                    Send("❌ 두 수 이상 진행된 후 사용 가능합니다.");
                } else if (user.playing.game.cooldown != 0 && (new Date()) - (new Date(user.playing.game.cooldown)) < 30000) {
                    let now = new Date();
                    let recent = new Date(user.playing.game.cooldown);
                    Send("❌ " + (30 - ((now - recent) / 1000)).toFixed(1) + "초 남았습니다.");
                } else {
                    let spellRes = await spellrule.spell[cmdSpell].act(game, user, channel);
                    if (spellRes === true) {
                        game.state.spell[cmdSpell].used = true;
                        user.playing.game.cooldown = new Date().toString();
                        await game.save(); await user.save();
                        let now = new Date();
                        let recent = new Date(game.state.last);
                        Send("[ " + cmdSpell + " ]\n" + game.state.spell[cmdSpell].desc[0]);
                        Send("🌟 스펠룰 | " + game.player[0] + " vs " + game.player[1] + "\n\n" + game.word.join(" ") + "\n\n" + game.state.syl + (game.state.syl == game.state.syl2 ? "" : "(" + game.state.syl2 + ")") + " | " + game.player[game.state.order] + "님 차례\n⏱️ " + msToMinSec(Math.round(60000 - (now - recent))) + " 안에 이어가세요!");
                    } else {
                        Send("❌ " + spellRes);
                    }
                }
            }
        }

        // ====== Non-prefix: AFK kick cancel ======
        if (user && user.playing.game) {
            let game = await getGameByPlayerName(user.name);
            if (game) {
                let t = getTimer(game.id);
                if (t.afk && t.afkUser == user.name) {
                    clearTimeout(t.afk); t.afk = null; t.afkUser = null;
                    game.state.afkKick.user = null; await game.save();
                    Send("✅ 잠수킥이 취소되었습니다.");
                }
            }
        }

        // ====== Non-prefix: Word play (0...) ======
        if (msg.startsWith("0") && msg.length > 1) {
            let wrd = msg.substr(1);
            if (user && user.playing.game) {
                let game = await getGameByPlayerName(user.name);
                if (game) {
                    let check = game.checkInput(user, wrd);
                    if (!check.success && !((game.type == "밴룰" && game.state.order == null) && check.reason == "시작단어로 유도단어 또는 한방단어를 사용할 수 없습니다.")) { Send("❌ " + check.reason); }
                    else if (game.type == "밴룰" && game.state.order == null) {
                        game.state.banned = wrd;
                        game.state.order = game.player.indexOf(user.name);
                        await game.save();
                        Send("✅ '" + wrd + "' 단어가 금지되었습니다.\n\n선공은 " + user + "님입니다.");
                    } else {
                        game.clearTurnTimer();
                        let ntr = await game.nextTurn(user, wrd);
                        ntr.message.forEach(m => Send(m));
                        if (ntr.end) { await game.end(ntr.end, channel); }
                        else if (["순위전","레이팅"].includes(game.type)) {
                            let enemy = await getUserByName(user.playing.game.enemy);
                            let t = getTimer(game.id);
                            const recursiveTimeout = async function () {
                                let eu = await getUserByName(enemy.name);
                                if (!eu || !eu.playing.game) return;
                                if (!eu.playing.game.isOvertime) { eu.playing.game.isOvertime = true; eu.playing.game.overtime--; eu.playing.game.timeLimit = 60000; Send(eu.name + "님, 시간이 초과되었습니다.\n초읽기 모드로 진입합니다."); await eu.save(); t.turn = setTimeout(recursiveTimeout, eu.playing.game.timeLimit); }
                                else if (eu.playing.game.overtime > 0) { eu.playing.game.overtime--; if (eu.playing.game.overtime > 0) Send(eu.name + "님, 초읽기 기회가 " + eu.playing.game.overtime + "회 남았습니다."); else Send(eu.name + "님, 마지막 초읽기 기회입니다."); await eu.save(); t.turn = setTimeout(recursiveTimeout, eu.playing.game.timeLimit); }
                                else { Send("◈ " + eu.name + "님이 제한시간 내에 입력하지 않아 패배하셨습니다."); let wu = await getUserByName(eu.playing.game.enemy); await game.end(wu, channel); }
                            };
                            t.turn = setTimeout(recursiveTimeout, enemy.playing.game.timeLimit);
                        } else if (game.type == "스펠") {
                            let enemy = await getUserByName(user.playing.game.enemy);
                            let t = getTimer(game.id);
                            if(t.turn){try{clearTimeout(t.turn);}catch(ex){}}
                            t.turn = setTimeout(async function () { let eu = await getUserByName(enemy.name); if (eu && eu.playing.game) { Send("◈ " + eu.name + "님이 제한시간 내에 입력하지 않아 패배하셨습니다."); let wu = await getUserByName(eu.playing.game.enemy); await game.end(wu, channel); } }, 60000);
                        }
                    }
                }
            }
        }

        // ====== Non-prefix: Forfeit (ㅈㅈ) ======
        if (msg == "ㅈㅈ") {
            if (user && wordchainQueue[roomid] && wordchainQueue[roomid].find(r => r.wait == user.name)) {
                let wq = wordchainQueue[roomid].find(r => r.wait == user.name);
                Send("✅ " + wq.type + "1ㄷ1 요청이 정상적으로 취소되었습니다.");
                clearTimeout(wq.timeout);
                wordchainQueue[roomid].splice(wordchainQueue[roomid].findIndex(r => r.wait == user.name), 1);
            } else if (user && user.playing.game && user.playing.game.room == roomName) {
                let game = await getGameByPlayerName(user.name);
                if (game) {
                    let enemy = await getUserByName(user.playing.game.enemy);
                    Send("◈ " + user + "님이 게임을 포기하셨습니다.");
                    await game.end(enemy, channel);
                }
            }
        }

    } catch (e) {
        console.error("[wordchain] onChat error:", e);
    }
}

module.exports = { onChat };
