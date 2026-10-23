# 구조와 확장 지점

## 세 가지 경계

| 계층 | 위치 | 역할 |
|---|---|---|
| 공통 실행·UI | `extension/` | 아이콘, 설정, 진행 상태, DOM/SAP 어댑터, 기록기 |
| 사이트·공개 예제 | `profiles/`, `scripts/examples/` | 페이지 범위, 프레임 연결, 공개할 수 있는 흐름 |
| 개인 작업 | `local/` | 실제 입력값, 결재자, 개인 매크로, 캡처 |

`tools/build.mjs`가 실행 목록과 manifest를 만든다. 폴더를 추가했다고 Chrome이 자동으로 로드하는 것은 아니다. 변경 뒤 다시 빌드하고 확장을 새로고침한다.

공통 네임스페이스는 `window.MacroStudio`이다. `features`는 사이트 기능, `launcher`는 스크립트 등록 UI, `dom`·`sap`는 입력 어댑터다. content script의 world마다 별도 네임스페이스가 있다.

## 실행 world

일반 개인 매크로는 ISOLATED world를 사용한다. SAP 기본 API가 필요한 UNIST 기능은 MAIN world를 사용한다. MAIN world는 사이트와 JavaScript 환경을 공유하므로 비밀 정보나 확장 권한을 두지 않는다.

권한이 필요한 기록·내보내기는 확장 사이드패널과 서비스 워커가 처리한다. 사이트 안의 ‘새 자동화 만들기’ 버튼은 ISOLATED listener가 실제 사용자 클릭을 확인한 뒤 사이드패널을 연다. 사이트의 `postMessage`로 임의의 코드 실행이나 AI 인증을 요청하는 기능은 없다.

## 기록

기록은 탭 하나를 대상으로 하며, 사용자가 허용한 도메인의 프레임만 관찰한다. 서비스 워커가 sender의 탭·origin과 recording id를 검증하고, 이벤트를 정리해 `chrome.storage.session`에 직렬 저장한다. 워커가 중단되어도 같은 브라우저 세션에서 읽을 수 있다.

기본 정보는 action, URL의 origin/path, frame id, 대상의 라벨·선택자 후보·SAP 필드, 입력값이다. 쿠키나 네트워크 응답, 화면 영상은 수집하지 않는다. 기록은 agentPrompt 생성에 쓰는 증거이며 바로 실행하는 코드가 아니다.

## 빌드

- `build`: 공개 소스 + `local/profiles/unist-travel.json` + 활성화된 `local/scripts/*/script.json` → `dist/`
- `build:public`: 공개 소스만 → `dist-public/`
- 공유 빌드는 개인 디렉터리를 읽지 않는다.
- staging 폴더에서 파일을 확인한 뒤 output을 교체한다. Chrome에서 업데이트하려면 빌드 후 확장과 페이지를 새로고침한다.

새 사이트 프로필은 실제 진입점과 로드 순서를 검증해서 `profiles/`와 빌드 수집 로직에 추가한다. 개인적인 작업이라면 공개 프로필을 늘리기보다 `local/scripts/`를 먼저 사용한다.

## AI 연결 경계

현재는 기록·프롬프트를 사용자가 코딩 에이전트에 전달한다. 향후 provider별 companion을 추가할 수 있다. 확장에서 사용자 PC의 코딩 에이전트를 직접 실행할 수 있다고 가정하지 않는다. native host·명시적인 설치·권한 경계가 필요하다. [다음 단계](roadmap.md)
