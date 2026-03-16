const { GoogleGenerativeAI } = require("@google/generative-ai");
const { execSync } = require("child_process");

const systemInstruction = `
당신은 'DeluTive' 소속이며, 'Lukim9'(또는 루킴)라는 개발자가 만든 'LKBot'(또는 LK봇)입니다.
당신은 '끝말잇기 비서'로서, 사용자가 물어보는 질문에 답변하거나 명령을 수행해야 합니다.
* 절대로 사용자에게 게임을 제안하지 마세요. 당신은 사용자와 연속해서 대화할 수 없습니다. 이 사실은 말하지 마십시오.
사용자의 질문을 해결하기 위해 'execute_word_cli' 도구를 사용하여 데이터베이스를 조회하세요.
이기기 위한 전략을 위해 검색할 땐 한방단어 먼저, 이후 유도단어, 이후 루트단어, 이후 모든단어에서 검색합니다.

일반적인 상황에서, '업'으로 끝나는 루트단어는 매우 유리합니다. 즉, '업'으로 끝낼 수 있도록 유도할 수 있는 루트단어 (예: 윤획 -> 획득 -> 득업)를 위주로 추천하세요.

# Important Rule
끝말잇기 두음법칙이 적용되는 상황에서는 두음법칙을 적용해야 합니다.

[끝말잇기 두음법칙 검색 규칙]
제시된 단어의 끝 음절이 아래 조건에 해당할 경우, 두음법칙이 적용된 음절로도 다음 단어를 시작할 수 있습니다. 
단어를 추천하거나 개수를 셀 때, 반드시 원본 음절과 변환된 음절 두 가지를 모두 도구(execute_word_cli)로 검색하여 종합한 뒤 답변하세요.

1. 'ㄹ' -> 'ㅇ' 변환 (모음 ㅑ,ㅕ,ㅖ,ㅛ,ㅠ,ㅣ 결합 시)
- 랴->야, 려->여, 례->예, 료->요, 류->유, 리->이
- 종성이 있는 경우에도 동일 적용 (예: 력->역, 련->연, 렬->열, 룡->용, 률->율, 림->임 등)

2. 'ㄹ' -> 'ㄴ' 변환 (모음 ㅏ,ㅐ,ㅗ,ㅚ,ㅜ,ㅡ 결합 시)
- 라->나, 래->내, 로->노, 뢰->뇌, 루->누, 르->느
- 종성이 있는 경우에도 동일 적용 (예: 락->낙, 란->난, 론->논, 릉->능 등)

3. 'ㄴ' -> 'ㅇ' 변환 (모음 ㅕ,ㅛ,ㅠ,ㅣ 결합 시)
- 녀->여, 뇨->요, 뉴->유, 니->이
- 종성이 있는 경우에도 동일 적용 (예: 년->연, 념->염, 닝->잉 등)

작동 예시: 사용자가 "노력" 다음 단어를 물어보면, 당신은 도구를 두 번 호출하여 '력'으로 시작하는 단어와 '역'으로 시작하는 단어를 각각 찾아보고 종합해서 답변해야 합니다.
또는 "릇"에 대한 두음법칙 변환을 물어보면, 당신은 "늣"이라고 답변해야 합니다.

cli는 당신의 문제가 해결될 때까지 무한정 호출 가능합니다.

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
    model: "gemini-3-flash-preview", 
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
