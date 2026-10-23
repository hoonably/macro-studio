# 확장 계획

## 이 버전에 구현한 범위

- 공통 아이콘과 실행 UI, DOM/SAP 어댑터
- UNIST 사이트 프로필과 개인 설정 분리
- 개인 스크립트 생성·빌드·등록
- 공식 userScripts API와 연결한 로컬 폴더의 스크립트 자동 동기화
- 구조화된 작업 기록과 단계 검토, 프롬프트·JSON 내보내기
- AGENTS.md와 Claude 공통 참조

## 다음: 작업실 안에서 에이전트와 만들기

아직 구현하지 않은 항목이다. UI 버튼만 만들어 연결됐다고 표시하지 않는다.

1. 명시적으로 설치하는 로컬 companion을 둔다.
2. 확장의 서비스 워커와 companion을 Chrome Native Messaging으로 연결한다.
3. 첫 provider로 Codex App Server를 연결하고, 인증·진행 상황·변경 파일·필요한 승인 UI를 사이드패널에서 표시한다.
4. 검토한 기록만 전달하고 `local/scripts/`에 초안을 만든다. 파일 수정·검증 결과를 사용자가 확인한 뒤 매크로 목록에 등록한다.
5. Claude provider를 별도 어댑터로 추가한다. API/SDK와 구독 인증의 사용 가능 범위는 구현 시 공식 문서로 확인한다.

확장이 PC의 CLI를 직접 실행하거나 인증 파일을 읽는 구조로 만들지 않는다. 인증과 프로젝트 파일 권한은 companion이 명시적으로 관리한다. 페이지 MAIN world에는 모델 인증이나 로컬 실행 권한을 주지 않는다.

## 이후

- 사이트별 선택 권한과 녹화 누락 프레임 안내 개선
- 단계 전후 화면 증거와 변수 편집 개선
- 매크로 수정·테스트·되돌리기 UI
- 추가 사이트 어댑터와 공개 예제

실행할 때마다 화면을 LLM에 보내는 방식은 기본 실행 경로로 사용하지 않는다. AI는 작성·수정에 사용하고, 반복 실행은 검증된 코드로 진행한다.

구현 시 확인할 공식 자료: [Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging), [Codex App Server](https://learn.chatgpt.com/docs/app-server), [Chrome userScripts](https://developer.chrome.com/docs/extensions/reference/api/userScripts).
