# macro-studio

**작업을 보여주면, 나만의 매크로가 됩니다.**

Record a workflow. Build your own browser macro with a coding agent.

[![Checks](https://github.com/hoonably/macro-studio/actions/workflows/check.yml/badge.svg)](https://github.com/hoonably/macro-studio/actions/workflows/check.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Macro Studio는 반복하는 웹 작업을 개인 매크로로 만드는 Chrome 확장 프로그램입니다.
평소에는 작은 아이콘으로 두고, 필요한 스크립트와 날짜 같은 값을 골라 실행합니다.
새 작업은 직접 수행하면서 기록한 뒤, **Codex 또는 Claude Code에 기록과 `AGENTS.md`를 전달해 구현**합니다.
만들어진 매크로는 실행할 때마다 AI를 호출하지 않습니다.

```mermaid
flowchart LR
  A[평소 작업 기록] --> B[고정값 · 변수 · 수동 단계 확인]
  B --> C[코딩 에이전트와 매크로 구현]
  C --> D[아이콘에서 반복 실행]
```

## 지금 가능한 것

- 드래그할 수 있는 작은 아이콘, 스크립트 목록, 입력값 선택, 진행 상태와 중복 실행 방지
- 일반 DOM 입력·선택·클릭 어댑터와 SAP Web Dynpro 어댑터
- 사이드패널의 클릭·입력·화면 이동 기록, 단계 삭제, 변수·수동 단계 지정
- 검토한 기록을 JSON 또는 에이전트용 프롬프트로 내보내기
- 개인 스크립트 생성 명령과 자동 빌드·등록
- 외부 서비스 없이 실행할 수 있는 폼 입력 예제
- 첫 사이트 프로필: **UNIST 포탈 → 일반행정 → 인사 → 국내출장 신청 → 신청 → 입력 → 저장 결재선 준비**

**현재 AI 연결 방식은 프롬프트 전달입니다.** 확장 안의 Codex·Claude 채팅, 로컬 companion 설치, 자동 코드 적용은 아직 구현하지 않았습니다. [확장 계획](docs/roadmap.md)을 참고하세요.

## 설치

Node.js 22 이상과 Chrome 116 이상이 필요합니다.

```bash
git clone https://github.com/hoonably/macro-studio.git
cd macro-studio
npm ci
npm run build
```

1. Chrome에서 `chrome://extensions`를 엽니다.
2. **개발자 모드 → 압축해제된 확장 프로그램을 로드**를 누릅니다.
3. 이 저장소의 **`dist` 폴더**를 선택합니다. 로드한 폴더는 계속 유지하세요.
4. 도구모음의 **Macro Studio** 아이콘을 누르면 사이드패널이 열립니다. ‘예제로 사용해 보기’에서 첫 매크로를 실행해 보세요.

기존 UNIST 도우미를 쓰고 있다면, 새 확장을 테스트할 때 기존 확장을 꺼서 아이콘과 작업이 중복되지 않게 하세요. 기존 폴더는 복구용으로 보관해도 됩니다.

## 나만의 매크로 만들기

1. 자동화할 사이트에 직접 로그인합니다.
2. 사이드패널에서 **이 사이트에서 사용하기 → 새 기록 시작**을 누릅니다.
3. 평소 하던 순서대로 작업한 뒤 **기록 끝내기**를 누릅니다.
4. 날짜 등 바뀔 입력은 ‘변수’, 직접 할 단계는 ‘수동’으로 바꿉니다.
5. 목적과 변경할 값을 적고 **에이전트용 프롬프트 복사**를 누릅니다.
6. Codex·Claude Code에서 이 저장소를 열어 프롬프트를 붙여 넣습니다. 에이전트는 [AGENTS.md](AGENTS.md)를 참고해 개인 스크립트를 만듭니다.
7. `npm run verify` 후 확장 프로그램과 해당 웹페이지를 새로고침합니다.

콘솔에서 먼저 읽기 전용으로 화면 구조를 조사하는 방법도 지원합니다. [스크립트 제작 안내](docs/create-script.md)

```bash
npm run new:script -- weekly-task --name "매주 하는 작업" --url https://example.com
```

개인 파일은 `local/scripts/weekly-task/`에 생성되고 Git에 포함되지 않습니다. 생성한 템플릿의 실행 부분을 실제 작업에 맞게 구현해야 합니다. 빌드가 폴더를 수집해 manifest와 로드 순서를 생성합니다.

## UNIST 출장 예제

공개 예제에는 출장 목적·기관·결재자 같은 개인값이 없습니다. 실제 사용 전에 설정 파일을 만드세요.

```bash
mkdir -p local/profiles
cp scripts/examples/unist-travel/config.example.json local/profiles/unist-travel.json
# 개인 설정을 수정한 다음
npm run build
```

이 예제는 **관내출장·기타/자비** 조합을 기준으로 합니다. 다른 출장 유형이나 재원은 실제 폼을 확인해 코드를 확장해야 합니다.
저장된 결재선을 선택하고 순서가 맞는지 확인한 뒤 멈춥니다. **최종 결재상신은 사용자가 직접 누릅니다.** [UNIST 설정·동작 범위](docs/unist.md)

## 프로젝트 구조

```text
extension/                 공통 실행 기능, 아이콘, 사이드패널, 기록기
  adapters/                일반 DOM / SAP
profiles/                  사이트별 로드 범위와 진입점
scripts/examples/          공개 예제
templates/script/          개인 스크립트 템플릿
tools/                     빌드, 생성, 읽기 전용 진단
local/                     개인 설정·스크립트·진단 자료 (Git 제외)
docs/                      설치, 제작, 문제 해결, 확장 계획
tests/                     오프라인 검증
dist/                      개인용 빌드 (Git 제외)
dist-public/               공유용 빌드 (Git 제외)
AGENTS.md                  코딩 에이전트용 제작 규칙
CLAUDE.md                  공통 규칙 참조
```

## 개발과 공유

```bash
npm run verify          # 문법·개인값 분리 검사, 테스트, 두 종류 빌드
npm run build           # 개인 설정과 개인 스크립트 포함
npm run build:public    # local/을 읽지 않는 공유용 빌드
```

작은 수정마다 버전을 올릴 필요는 없습니다. 다시 빌드한 뒤 `chrome://extensions`의 새로고침 버튼을 누르고, 작업 페이지도 새로고침하세요. 버전은 배포 단위로 관리합니다.

공유할 때는 **`dist-public`만** 사용하세요. `dist`에는 개인 입력값과 스크립트가 들어갈 수 있습니다.
기록은 브라우저 세션 동안 로컬에 보관하며, 비밀번호·인증번호 필드를 건너뜁니다. 일반 입력·페이지 제목에는 개인 정보가 남을 수 있으므로 내보낼 내용을 확인하세요. [데이터와 권한](docs/privacy.md)

테스트는 실제 포탈을 조작하거나 상신하지 않는 오프라인 검사입니다. 새로운 사이트·Chrome 환경에서는 사용자가 실제 화면에서 확인해야 합니다.

[설치·사용법](docs/getting-started.md) · [스크립트 제작](docs/create-script.md) · [구조](docs/architecture.md) · [문제 해결](docs/troubleshooting.md) · [기여](CONTRIBUTING.md)

MIT License
