'use strict';

// RPGENIUS 계정 화면(로그인, 캐릭터 선택): 거울 호수.
// 두 함수 모두 완결된 HTML 문서를 돌려준다. 세션 값이나 서버 문자열은 문서에 넣지 않고,
// 화면에 필요한 값은 public/account-stage.js가 API에서 받아 textContent로만 그린다.
// 장면(하늘, 문, 호수, 캐릭터)은 WebGL 캔버스가 그리고, 여기 있는 단추와 글자는 그 위에 얹는 게임 HUD다.

const VERSION = '20261123m13';
const CSS = '/static/account-stage.css?v=' + VERSION;
const JS = '/static/account-stage.js?v=' + VERSION;
const ART = '/static/assets/account-stage/';

const ICON_SOUND = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M4 9.5v5h3.6L12 18.6V5.4L7.6 9.5H4z" fill="currentColor"/><path class="as-ico-wave" d="M15.2 8.6a4.8 4.8 0 0 1 0 6.8M17.6 6a8.4 8.4 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path class="as-ico-cut" d="M15.5 9.5l5 5m0-5l-5 5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';

function head(title, fonts, transfer = false) {
    return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<title>${title}</title>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#060a1c">
${fonts.map(href => `<link rel="preload" href="${href}" as="font" type="font/woff2" crossorigin>`).join('')}
<link rel="stylesheet" href="${CSS}">
<link rel="stylesheet" href="/static/game-font.css?v=20261123">
${transfer ? '<link rel="stylesheet" href="/static/account-transfer.css?v=' + VERSION + '">' : ''}
</head>`;
}

function soundButton() {
    return `<button type="button" class="as-tool" id="asMute" aria-pressed="false" aria-label="소리 끄기" title="소리">${ICON_SOUND}</button>`;
}

const NOSCRIPT = '<noscript><p class="as-noscript">이 화면은 자바스크립트를 켜야 열립니다.</p></noscript>';

function renderLogin() {
    return `${head('RPGENIUS', [ART + 'as-serif.woff2'])}
<body class="as" data-screen="login" data-phase="title">
<canvas id="asStage" class="as-stage" aria-hidden="true"></canvas>
<div class="as-tools">${soundButton()}</div>
<main class="as-login" id="asLogin">
  <header class="as-brand" id="asBrand">
    <img class="as-brand-crest" src="${ART}crest.webp" alt="" width="520" height="518">
    <h1 class="as-wordmark">RPGENIUS</h1>
    <img class="as-rule" src="${ART}ui-divider.webp" alt="" width="900" height="62">
  </header>

  <button type="button" class="as-wake" id="asWake">화면을 눌러 시작</button>

  <div class="as-plate" id="asPlate" hidden>
    <p class="as-plate-label" id="asPlateLabel" aria-hidden="true">닉네임</p>
    <input class="as-input" id="asName" form="asNameForm" name="name" type="text" aria-label="닉네임" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="20" enterkeyhint="go" required aria-describedby="asHint asError">
    <input class="as-input as-input-key" id="asCode" form="asKeyForm" name="code" type="text" aria-label="로그인 코드" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" maxlength="32" enterkeyhint="go" aria-describedby="asKeyHint asError" hidden>
    <input class="as-input as-input-key" id="asOtp" form="asKeyForm" name="otp" type="text" aria-label="OTP 코드" autocomplete="one-time-code" inputmode="numeric" pattern="[0-9]*" maxlength="6" enterkeyhint="go" aria-describedby="asKeyHint asError" hidden>
  </div>

  <section class="as-gate" id="asGate" aria-label="로그인" hidden>
    <div class="as-modes" role="group" aria-label="입장 방법">
      <button type="button" class="as-mode" id="asModeLogin" aria-pressed="true">이어서 하기</button>
      <button type="button" class="as-mode" id="asModeRegister" aria-pressed="false">처음 시작</button>
    </div>
    <form class="as-form" id="asNameForm" novalidate>
      <p class="as-hint" id="asHint" hidden></p>
      <button type="submit" class="as-plaque" id="asNameSubmit"><span class="as-btn-label">로그인</span></button>
    </form>
    <form class="as-form" id="asKeyForm" novalidate hidden>
      <p class="as-hint" id="asKeyHint">처음 보는 기기입니다. 로그인 코드를 입력하세요.</p>
      <button type="submit" class="as-plaque" id="asKeySubmit"><span class="as-btn-label">로그인</span></button>
      <p class="as-alt"><button type="button" class="as-link" id="asOtpToggle" hidden>OTP 코드로 로그인</button><button type="button" class="as-link" id="asBack">닉네임 다시 입력</button></p>
    </form>
    <p class="as-error" id="asError" role="alert"></p>
  </section>
</main>
<div class="as-veil" id="asVeil" aria-hidden="true"></div>
${NOSCRIPT}
<script src="${JS}" defer></script>
</body></html>`;
}

function renderCharacterSelection() {
    return `${head('RPGENIUS 캐릭터 선택', [ART + 'as-serif.woff2'], true)}
<body class="as" data-screen="characters" data-phase="loading">
<canvas id="asStage" class="as-stage" aria-hidden="true"></canvas>
<div class="as-camp" id="asCamp">
  <header class="as-top">
    <div class="as-title">
      <img class="as-title-crest" src="${ART}crest.webp" alt="" width="520" height="518">
      <div class="as-title-text">
        <h1 class="as-top-h">캐릭터 선택</h1>
        <p class="as-top-sub"><span id="asAccount"></span><span id="asCount"></span></p>
      </div>
    </div>
    <div class="as-purse">
      <div class="as-ledger" id="asWallet" role="group" aria-label="보유 재화"></div>
      <button type="button" class="as-cap" id="asCap" hidden></button>
    </div>
    <div class="as-top-tools">${soundButton()}</div>
  </header>

  <main class="as-field" id="asField">
    <p class="as-status" id="asStatus" role="status">캐릭터를 불러오는 중입니다.</p>
    <ul class="as-roster" id="asRoster" aria-label="캐릭터 목록"></ul>
  </main>

  <footer class="as-dock" id="asDock">
    <div class="as-dock-actions">
      <button type="button" class="as-btn" id="asRename" disabled>이름 변경</button>
      <button type="button" class="as-btn" id="asTransfer" disabled>물품 이전</button>
      <button type="button" class="as-btn" id="asLinks" disabled>슬롯 연결</button>
    </div>
    <button type="button" class="as-plaque as-start" id="asStart" disabled><span class="as-btn-label">게임 시작</span></button>
    <div class="as-dock-side">
      <button type="button" class="as-btn" id="asLogout">나가기</button>
    </div>
  </footer>
</div>

<div class="as-modal" id="asModal" hidden>
  <div class="as-modal-shade" data-close="1"></div>
  <div class="as-modal-panel" id="asModalPanel" role="dialog" aria-modal="true" aria-labelledby="asModalTitle" tabindex="-1">
    <header class="as-modal-head">
      <h2 class="as-modal-title" id="asModalTitle"></h2>
      <button type="button" class="as-tool" id="asModalClose" aria-label="닫기"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
    </header>
    <img class="as-rule" src="${ART}ui-divider.webp" alt="" width="900" height="62">
    <div class="as-modal-body" id="asModalBody"></div>
  </div>
</div>
<div class="as-toast" id="asToast" role="status" aria-live="polite"></div>
<div class="as-veil as-veil-on" id="asVeil" aria-hidden="true"></div>
${NOSCRIPT}
<script src="/static/account-transfer.js?v=${VERSION}" defer></script>
<script src="${JS}" defer></script>
</body></html>`;
}

module.exports = { renderLogin, renderCharacterSelection };
