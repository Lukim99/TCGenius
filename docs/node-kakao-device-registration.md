# node-kakao 신규 기기 등록 수정 근거

## 증상

이미 등록된 기기 UUID로 로그인하고 LOCO 세션을 여는 기능은 동작하지만, 새 UUID에서 `DEVICE_NOT_REGISTERED (-100)`을 받은 뒤 보안코드를 발급하고 기기를 등록하는 절차가 완료되지 않았다.

## 확정 원인

커밋된 `node_modules/node-kakao` Android 포크는 일반 로그인과 신규 기기 등록을 서로 다른 시대의 계약으로 혼합하고 있었다.

1. 기본 프로필은 KakaoTalk Android `11.0.0`을 보고하지만, 기기 등록은 과거의 `request_passcode.json` 및 `register_device.json` 엔드포인트에 URL-encoded 폼을 전송하고 사용자가 전달받은 코드를 다시 서버에 제출하는 구형 흐름을 사용했다.
2. 현재 확인된 Android 흐름은 `passcodeLogin/generate`에 중첩된 `device` JSON을 보내 서버가 반환한 코드를 공식 KakaoTalk 앱에서 승인하고, `passcodeLogin/registerDevice`를 상태 `0`이 될 때까지 폴링한다. 등록 요청에는 보안코드를 다시 보내지 않는다.
3. 런타임 JavaScript의 `AuthApiClient.create`는 광고 ID를 포함한 5개 인자를 기대했지만, 배포된 타입 선언과 TCGenius 호출부는 4개 인자를 사용했다. 그 결과 config 객체가 `Adid` 헤더 값으로 들어가고, 전달한 config/X-VC provider의 위치도 한 칸씩 어긋났다.
4. `fillAuthForm`은 호출자가 지정한 `forced` 값을 항상 `false`로 덮고, `device_name`도 실제 이름 대신 모델명으로 다시 덮었다.

`Lukim99/node-kakao-stable` v5의 2026-07-11 라이브 검증은 현대 Android 인증 계약과 요청 형태를 확인하는 근거로만 사용한다. v5는 별도의 현대 프로토콜 구현과 캡처 기반 요청 빌더를 사용하므로, 그 프로젝트의 `25.8.1` 프로필을 이 구형 포크의 전역 기본값으로 그대로 이식할 수는 없다.

## 프로필 경계

이 포크의 `DefaultConfiguration.version`은 인증 헤더뿐 아니라 LOCO `CHECKIN`과 `LOGINLIST`의 `appVer`에도 사용된다. 따라서 전역 값을 `25.8.1`로 바꾸면 신규 기기 등록 외의 정상 동작 경로까지 함께 변경된다.

이번 수정은 기존에 정상 동작하는 LOCO 경로의 기본 프로필을 `11.0.0`으로 유지한다. `25.8.1`이라는 문자열만 올리는 방식은 호환성 수정으로 간주하지 않는다. 신규 등록 엔드포인트가 `11.0.0` 인증 헤더를 거부하는지가 운영 검증에서 확인될 경우에만, 전역 LOCO 프로필과 분리된 등록 전용 인증 프로필을 별도 변경으로 도입한다.

## 변경 내용

- 기존 Android/LOCO 기본 프로필 `11.0.0`을 유지한다.
- `passcodeLogin/generate`, `passcodeLogin/registerDevice`, `passcodeLogin/cancel` JSON 계약을 구현한다.
- 등록 승인 대기 중 서버가 지정한 간격으로 폴링하고 만료 시 취소한다.
- 기존 TCGenius 호출부와의 호환성을 위해 `requestPasscode()`는 콜백이 없을 때 생성된 코드를 콘솔에 표시한다. 공식 앱에서 승인한 뒤 기존 stdin 프롬프트에서 Enter를 누르면 `registerDevice()`가 승인 상태를 폴링한다.
- 4인자/5인자 `AuthApiClient.create()`를 모두 지원하고 `Adid`를 항상 문자열 UUID로 보장한다.
- `forced`, `device_name`, `model_name` 필드를 올바르게 보존한다.
- Axios/fetch WebClient가 `application/json` 요청을 JSON으로 직렬화하도록 확장한다.

## 검증

`node --test test/node-kakao-auth.test.js`

테스트는 다음을 네트워크 없이 검증한다.

- 기존 4인자 `create()` 호출의 config/provider 및 광고 ID 정렬
- 로그인 폼의 `forced`, `device_name`, `model_name`
- 보안코드 생성 JSON 엔드포인트와 중첩 device payload
- 보안코드 콜백 전달
- 공식 앱 승인까지 등록 상태 폴링
- Axios JSON 직렬화
- 기본 LOCO 프로필이 `11.0.0`으로 유지됨

실계정 보안 승인은 테스트나 코드에서 자동화하지 않는다. 운영 검증은 새 UUID 한 개로 제한하고, 공식 KakaoTalk 앱에서 사용자가 직접 승인해야 한다. 반복 실패 시 계정 또는 기기 등록 제한을 유발할 수 있으므로 자동 재시도를 추가하지 않는다.
