const { GoogleGenerativeAI } = require("@google/generative-ai");
const { execSync } = require("child_process");
const fs = require('fs');
const path = require('path');
const node_kakao = require('node-kakao');

const targetPath = path.join(__dirname, "agent_system.txt");
const systemInstruction = fs.readFileSync(targetPath, 'utf-8');

const tools = [{
    functionDeclarations: [{
        name: "execute_word_cli",
        description: "끝말잇기 DB를 다양한 모드와 조건으로 조회하는 CLI 명령을 실행하여 결과를 반환합니다.",
        parameters: {
            type: "OBJECT",
            properties: {
                command: {
                    type: "STRING",
                    description: "실행할 기능 (search, verify, random, count 중 하나)"
                },
                db_name: {
                    type: "STRING",
                    description: "조회할 DB 이름 (all, route, lead, neo, route_syllable)"
                },
                search_mode: {
                    type: "STRING",
                    description: "검색 방식 (start, end, include, exact, none)"
                },
                keyword: {
                    type: "STRING",
                    description: "검색 또는 검증할 키워드 (음절 또는 전체 단어)"
                },
                word_length: {
                    type: "INTEGER",
                    description: "필터링할 정확한 글자 수. 글자 수 제한이 없으면 0 입력."
                },
                sort_order: {
                    type: "STRING",
                    description: "정렬 방식. 긴 단어 순은 'desc', 짧은 단어 순은 'asc', 기본은 'none'"
                }
            },
            required: ["command", "db_name"]
        }
    }]
}];

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
    model: "gemini-3-flash-preview", 
    systemInstruction: systemInstruction,
    tools: tools
});

const chatSessions = new Map();

const MAX_HISTORY_LENGTH = 20;
const TTL_DURATION_MS = 5 * 60 * 1000;

async function processAgentQuery(sessionId, channel, userMessage) {
    let session = chatSessions.get(sessionId);
    let chat;

    if (session) {
        // 기존 세션이 있으면 기존 타이머 제거
        clearTimeout(session.timer);
        chat = session.chat;
    } else {
        // 새 세션 생성
        chat = model.startChat();
        session = { chat: chat, timer: null };
    }
    
    let result = await chat.sendMessage(userMessage);
    let calls = result.response.functionCalls();

    while (calls && calls.length > 0) {
        
        const functionResponses = [];
        const sendCalls = [];
        for (const call of calls) {
            if (call.name === "execute_word_cli") {
                const { 
                    command, 
                    db_name, 
                    search_mode = "none", 
                    keyword = "", 
                    word_length = 0, 
                    sort_order = "none" 
                } = call.args;
                
                let cliOutput = "";

                try {
                    const safeKeyword = keyword ? `"${keyword}"` : `""`;
                    const cliCommand = `node word_cli.js ${command} ${db_name} ${search_mode} ${safeKeyword} ${word_length} ${sort_order}`;
                    const fake_cliCommand = `word_cli${command ? ` -c ${command}` : ""}${db_name ? ` -d ${db_name}` : ""}${search_mode != 'none' ? ` -m ${search_mode}` : ""}${safeKeyword != `""` ? ` -k ${safeKeyword}` : ""}${word_length ? ` -l ${word_length}` : ""}${sort_order != 'none' ? ` -s ${sort_order}` : ""}`;
                    console.log(`[Agent Tool Call] : ${cliCommand}`);
                    sendCalls.push(`> ${fake_cliCommand}`);
                    
                    cliOutput = execSync(cliCommand, { encoding: 'utf-8' }).trim();
                } catch (error) {
                    cliOutput = error.stdout ? error.stdout.trim() : error.message;
                }

                functionResponses.push({
                    functionResponse: {
                        name: call.name,
                        response: {
                            result: cliOutput
                        }
                    }
                });
            }
        }
        channel.sendChat(`[ Agent Tool Calls ]\n${sendCalls.join("\n")}`);
        result = await chat.sendMessage(functionResponses);
        calls = result.response.functionCalls();
    }

    let history = await chat.getHistory();
    if (history.length > MAX_HISTORY_LENGTH) {
        let slicedHistory = history.slice(history.length - MAX_HISTORY_LENGTH);
        if (slicedHistory.length > 0 && slicedHistory[0].role !== 'user') {
            slicedHistory.shift(); 
        }
        
        session.chat = model.startChat({ history: slicedHistory });
    }

    session.timer = setTimeout(() => {
        chatSessions.delete(sessionId);
        console.log(`[Agent] Session ${sessionId} expired and cleared (5m TTL).`);
        channel.sendChat(`[ LK Agent ] 마지막 채팅으로부터 5분이 지나 채팅 기록이 삭제되었습니다.`);
    }, TTL_DURATION_MS);

    chatSessions.set(sessionId, session);
    return result.response.text();
}

function clearAgentHistory(sessionId) {
    chatSessions.delete(sessionId);
}

module.exports = { processAgentQuery, clearAgentHistory };
