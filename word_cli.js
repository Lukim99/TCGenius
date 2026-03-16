const fs = require('fs');
const path = require('path');

// 파라미터 구조: node word_cli.js <command> <db_type> [search_mode] [keyword]
const [, , command, dbType, searchMode, keyword] = process.argv;

const dbMap = {
    'all': { file: 'DB/allWords.txt', delimiter: '\n' },
    'route': { file: 'DB/routeWords.txt', delimiter: '\n' },
    'lead': { file: 'DB/leadWords.txt', delimiter: ',' },
    'neo': { file: 'DB/neoWords.txt', delimiter: ',' },
    'route_syllable': { file: 'DB/route.txt', delimiter: ', ' }
};

const dbInfo = dbMap[dbType];

if (!dbInfo) {
    console.error(`Error: 알 수 없는 DB 타입입니다. (${dbType})`);
    process.exit(1);
}

const targetPath = path.join(__dirname, dbInfo.file);
if (!fs.existsSync(targetPath)) {
    console.error(`Error: DB 파일을 찾을 수 없습니다. (${targetPath})`);
    process.exit(1);
}

try {
    const content = fs.readFileSync(targetPath, 'utf-8');
    // 지정된 구분자로 분리 후 공백 제거 및 빈 문자열 필터링
    const words = content.split(dbInfo.delimiter).map(w => w.trim()).filter(w => w.length > 0);

    let results = [];
    const limit = 50;

    switch (command) {
        case 'search':
            if (!searchMode || !keyword) {
                console.error('Error: search 명령어는 search_mode와 keyword가 필요합니다.');
                process.exit(1);
            }
            if (searchMode === 'start') results = words.filter(w => w.startsWith(keyword));
            else if (searchMode === 'end') results = words.filter(w => w.endsWith(keyword));
            else if (searchMode === 'include') results = words.filter(w => w.includes(keyword));
            else if (searchMode === 'exact') results = words.filter(w => w === keyword);
            else {
                console.error('Error: 지원하지 않는 검색 모드입니다.');
                process.exit(1);
            }

            const output = results.slice(0, limit).join(', ');
            const countText = results.length > limit ? ` (총 ${results.length}개 중 ${limit}개 표시)` : ` (총 ${results.length}개)`;
            console.log(output ? output + countText : "검색 결과가 없습니다.");
            break;

        case 'verify':
            // 특정 단어가 해당 DB에 존재하는지 정확히 확인 (true/false)
            if (!keyword) {
                console.error('Error: verify 명령어는 keyword가 필요합니다.');
                process.exit(1);
            }
            const exists = words.includes(keyword);
            console.log(exists ? "TRUE: 존재합니다." : "FALSE: 존재하지 않습니다.");
            break;

        case 'random':
            // 조건에 맞는 단어 중 무작위 1개 추출 (AI가 단어를 제시할 때 사용)
            if (searchMode === 'start' && keyword) {
                results = words.filter(w => w.startsWith(keyword));
            } else if (searchMode === 'end' && keyword) {
                results = words.filter(w => w.endsWith(keyword));
            } else {
                results = words; // 조건이 없으면 전체에서 무작위
            }

            if (results.length === 0) {
                console.log("조건에 맞는 단어가 없어 무작위 추출에 실패했습니다.");
            } else {
                const randomIndex = Math.floor(Math.random() * results.length);
                console.log(results[randomIndex]);
            }
            break;

        case 'count':
            // 조건에 맞는 단어의 총 개수만 반환
            if (searchMode === 'start' && keyword) {
                results = words.filter(w => w.startsWith(keyword));
            } else if (searchMode === 'end' && keyword) {
                results = words.filter(w => w.endsWith(keyword));
            } else {
                results = words;
            }
            console.log(`총 ${results.length}개`);
            break;

        default:
            console.error('Error: 알 수 없는 명령어입니다. (search, verify, random, count 중 택 1)');
            process.exit(1);
    }

} catch (error) {
    console.error(`Error: 처리 중 오류 발생 - ${error.message}`);
    process.exit(1);
}