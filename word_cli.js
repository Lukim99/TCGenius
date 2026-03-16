const fs = require('fs');
const path = require('path');

// 파라미터 구조: node word_cli.js <command> <db_type> <search_mode> <keyword> <length> <sort>
const [, , command, dbType, searchMode, keyword, lengthOpt, sortOpt] = process.argv;

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
    const words = content.split(dbInfo.delimiter).map(w => w.trim()).filter(w => w.length > 0);

    let results = [];

    // 1. 단어 존재 여부 단순 검증 (verify)
    if (command === 'verify') {
        if (!keyword || keyword === '""') {
            console.error('Error: verify 명령어는 keyword가 필요합니다.');
            process.exit(1);
        }
        const exists = words.includes(keyword.replace(/"/g, ''));
        console.log(exists ? "TRUE: 존재합니다." : "FALSE: 존재하지 않습니다.");
        process.exit(0);
    }

    // 2. 기본 검색 모드 적용
    const cleanKeyword = keyword ? keyword.replace(/"/g, '') : '';
    if (searchMode === 'start' && cleanKeyword) results = words.filter(w => w.startsWith(cleanKeyword));
    else if (searchMode === 'end' && cleanKeyword) results = words.filter(w => w.endsWith(cleanKeyword));
    else if (searchMode === 'include' && cleanKeyword) results = words.filter(w => w.includes(cleanKeyword));
    else if (searchMode === 'exact' && cleanKeyword) results = words.filter(w => w === cleanKeyword);
    else results = words;

    // 3. N글자 단어 필터링 적용
    const targetLength = parseInt(lengthOpt, 10);
    if (!isNaN(targetLength) && targetLength > 0) {
        results = results.filter(w => w.length === targetLength);
    }

    // 4. 정렬 옵션 적용 (가장 긴 단어 / 가장 짧은 단어)
    if (sortOpt === 'desc') {
        results.sort((a, b) => b.length - a.length);
    } else if (sortOpt === 'asc') {
        results.sort((a, b) => a.length - b.length);
    }

    // 5. 명령어에 따른 결과 출력
    const limit = 50;
    if (command === 'search') {
        const output = results.slice(0, limit).join(', ');
        const countText = results.length > limit ? ` (총 ${results.length}개 중 ${limit}개 표시)` : ` (총 ${results.length}개)`;
        console.log(output ? output + countText : "검색 결과가 없습니다.");
    } else if (command === 'random') {
        if (results.length === 0) {
            console.log("조건에 맞는 단어가 없어 무작위 추출에 실패했습니다.");
        } else {
            const randomIndex = Math.floor(Math.random() * results.length);
            console.log(results[randomIndex]);
        }
    } else if (command === 'count') {
        console.log(`총 ${results.length}개`);
    } else {
        console.error('Error: 알 수 없는 명령어입니다.');
        process.exit(1);
    }

} catch (error) {
    console.error(`Error: 처리 중 오류 발생 - ${error.message}`);
    process.exit(1);
}
