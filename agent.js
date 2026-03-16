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

// 최신 Gemini 3 Flash 모델 적용
// 구글 AI Studio 또는 Google Cloud 환경에 따라 'gemini-3-flash' 또는 'gemini-3-flash-preview' 등을 사용합니다.
const model = genAI.getGenerativeModel({
    model: "gemini-3-flash-preview", 
    systemInstruction: systemInstruction,
    tools: tools
});

async function processAgentQuery(channel, userMessage) {
    let chat = chatSessions.get(sessionId);
    if (!chat) {
        chat = model.startChat();
        chatSessions.set(sessionId, chat);
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
    return result.response.text();
}

module.exports = { processAgentQuery };
