# 개발 안내

## 로컬 환경

Node.js 22 이상, Chrome 135 이상을 사용합니다. Chrome 웹 스토어용 빌드는 Chrome 138 이상을 대상으로 합니다.

```bash
npm ci
npm run verify
```

`verify`는 JavaScript 문법·문서 링크·개인값 분리 검사, 오프라인 테스트, 개인용·공유용·스토어용 빌드와 스토어 ZIP 생성을 실행합니다. 테스트는 실제 사이트를 조작하거나 최종 제출하지 않습니다. 새 사이트와 Chrome 환경에서의 동작은 별도로 확인해야 합니다.

## 압축 해제 방식으로 개발하기

일반 사용자 설치는 Chrome 웹 스토어를 이용한다. 확장 소스를 수정할 때는 다음 순서로 로컬 빌드를 연결한다.

```bash
git clone https://github.com/hoonably/macro-studio.git
cd macro-studio
npm ci
npm run build
```

1. `chrome://extensions`에서 개발자 모드를 켠다.
2. **압축해제된 확장 프로그램을 로드**로 저장소의 `dist`를 선택한다.
3. 개인 스크립트 연결에서는 `macro-studio` 폴더를 선택하면 내부의 `local/scripts`를 찾는다.

Chrome이 계속 읽으므로 저장소와 `dist`를 임시 위치로 옮기거나 지우지 않는다. 코드 수정 뒤에는 `npm run verify`를 실행한다. 완료된 빌드는 감지해 반영하며, 기록·실행 중에는 적용을 미룬다.

## 코드 위치

| 위치 | 역할 |
| --- | --- |
| `extension/ui/` | 팝업, 작업실, 보관함, 연결·업데이트 화면 |
| `extension/core/` | 사이트 설정, 보관함, 빌드 갱신과 업데이트 알림 |
| `extension/recorder/` | 기록과 내부 프레임 탐지 |
| `extension/scripts/` | 사용자가 연결한 폴더와 개인 코드 등록 |
| `extension/adapters/` | 일반 DOM·SAP 어댑터 |
| `local/scripts/` | 개인 매크로·설정, Git 제외 |
| `scripts/examples/`, `profiles/` | 개발용 참고 소스, 기본 빌드 제외 |
| `tests/`, `tools/` | 오프라인 검증과 빌드 도구 |

생성된 `dist`, `dist-public`, `dist-store` 파일을 소스처럼 직접 수정하지 않습니다. 개인 파일·기록·캡처·인증 정보를 공개 소스나 빌드에 포함하지 않습니다.

## 개인 스크립트

```bash
npm run new:script -- weekly-task --name "매주 하는 작업" --url https://example.com
```

`local/scripts/weekly-task/`의 템플릿을 실제 작업에 맞게 구현합니다. 연결된 폴더에서는 `script.json`과 명시된 실행 파일만 읽습니다. 새로운 사이트는 사용자가 선택해 허용하며 저장·등록 자체로 작업을 실행하지 않습니다.

UNIST 출장 흐름은 `scripts/examples/unist-travel/`과 [UNIST 안내](unist.md)를 참고합니다. 자동 설치되지 않으며, 실제 개인값과 필요한 파일 순서는 개인 스크립트에 명시합니다. 예제는 관내출장·기타/자비 조합을 기준으로 하고 최종 결재상신 직전에 멈춥니다.

## 화면과 알림

공통 화면은 밝은 중성 배경, 얇은 경계선, 명확한 제목·설명 위계를 사용합니다. 실행 동작은 기존 파란색을 유지하고 준비 완료 상태는 녹색으로 구분합니다. 사이드패널에서는 권한 상태를 접어두어 기록 흐름을 방해하지 않습니다.

`ui/update.js`는 현재 버전과 배포 경로에 맞는 안내를 표시합니다. 알림 체크는 `macroStudioUpdatePreferences`에 저장됩니다. 웹 스토어판은 Chrome의 `onUpdateAvailable` 이벤트를 받아 알리고, 사용자가 확인 버튼을 누를 때만 `requestUpdateCheck()`를 호출합니다. 자동 반복 네트워크 확인이나 강제 재시작은 하지 않습니다. 로컬 빌드는 기존 안전한 빌드 감지 경로를 유지합니다.

[전체 구조](architecture.md) · [배포 안내](RELEASING.md) · [제작 규칙](../AGENTS.md)
