// 천상 실험실. 실제 server.js와 낙원 화면(public/paradise.js, hfield.js, 연출 엔진)을 메모리 DB로 돌린다(sandbox.js).
// 운영 DynamoDB와 S3에 닿지 않는다. 이미지 자산은 git에 없어 비어 보일 수 있다.
// 실행: node scripts/paradise-lab/server.js  →  http://localhost:4175/lab?scenario=boon
//   scenario: lobby | combat | augment | boon | stat | reward | all(증강 30종을 가진 전투)
//   augments=fruition,conqueror,...  전투 장면에 줄 증강 id(쉼표)   wave=2  둘째 적부터
// 증강 연출을 하나씩 보려면 scripts/augment-lab/server.js(증강 연출 실험실)를 쓴다.
const http = require('http');
const sandbox = require('./sandbox');
const PORT = Number(process.env.PORT || 4175);

(async () => {
    const target = await sandbox.start();
    http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname === '/lab') {
            try { await sandbox.queue(() => sandbox.scenario(url.searchParams.get('scenario') || 'lobby', url.searchParams)); }
            catch (error) { res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(String(error.stack || error)); return; }
            res.writeHead(302, { 'Set-Cookie': sandbox.cookie() + '; Path=/; HttpOnly', Location: '/paradise' }); res.end(); return;
        }
        sandbox.proxy(req, res, target);
    }).listen(PORT, () => console.log('천상 실험실: http://localhost:' + PORT + '/lab?scenario=boon'));
})();
