const { GoogleGenerativeAI } = require("@google/generative-ai");
const { execSync } = require("child_process");

const systemInstruction = `
당신은 'DeluTive'라는 개발사 소속, 'Lukim9'(또는 루킴)라는 개발자가 만든 'LKBot'(또는 LK봇)입니다.
당신은 '끝말잇기 비서'입니다.
사용자의 질문을 해결하기 위해 'execute_word_cli' 도구를 사용하여 데이터베이스를 조회하세요.
이기기 위한 전략을 위해 검색할 땐 한방단어 먼저, 이후 유도단어, 이후 루트단어, 이후 모든단어에서 검색합니다.

마크다운이 지원되지 않는 환경에 출력하므로, 마크다운 없이 담백하게 답변합니다.

[DB 종류]
- all : 모든 단어 (일반적인 단어 존재 여부 확인)
- route : 끝말잇기를 안정적으로 이어갈 수 있는 '루트단어' 목록
- lead : 상대방을 한방단어로 유도하는 '유도단어' 목록
- neo : 상대를 즉시 패배시키는 '한방단어' 목록
- route_syllable : 루트단어의 핵심 음절 목록

[사용 가능한 명령어(command)]
- search: 특정 음절로 시작, 끝, 포함하는 단어를 여러 개 검색합니다.
- verify: 특정 단어가 해당 DB에 유효하게 존재하는지 검증합니다.
- random: 조건에 맞는 단어 중 무작위로 1개를 추천합니다.
- count: 조건에 맞는 단어의 개수를 파악하여 전략적 유리함을 계산합니다.
`;

const tools = [{
    functionDeclarations: [{
        name: "execute_word_cli",
        description: "끝말잇기 DB를 다양한 모드로 조회하는 CLI 명령을 실행하여 결과를 반환합니다.",
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
                    description: "검색 방식 (start, end, include, exact). command가 verify일 때는 exact, random/count일 때는 start/end/none 사용 가능."
                },
                keyword: {
                    type: "STRING",
                    description: "검색 또는 검증할 키워드 (음절 또는 전체 단어)"
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
    model: "gemini-3.1-flash-lite-preview", 
    systemInstruction: systemInstruction,
    tools: tools
});

async function processAgentQuery(userMessage) {
    const chat = model.startChat();
    let result = await chat.sendMessage(userMessage);

    let calls = result.response.functionCalls();

    while (calls && calls.length > 0) {
        
        const functionResponses = [];

        for (const call of calls) {
            if (call.name === "execute_word_cli") {
                const { command, db_name, search_mode = "none", keyword = "" } = call.args;
                let cliOutput = "";

                try {
                    const safeKeyword = keyword ? `"${keyword}"` : `""`;
                    const cliCommand = `node word_cli.js ${command} ${db_name} ${search_mode} ${safeKeyword}`;
                    console.log(`[Agent Tool Call] : ${cliCommand}`);
                    
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
        result = await chat.sendMessage(functionResponses);

        calls = result.response.functionCalls();
    }
    return result.response.text();
}

module.exports = { processAgentQuery };
