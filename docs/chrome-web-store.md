# Chrome Web Store 배포

공개 설치: [Macro Studio](https://chromewebstore.google.com/detail/oobgpakpaoknojmgkolgmmkjemjmimld)

확장 ID: `oobgpakpaoknojmgkolgmmkjemjmimld`

## 빌드와 업로드 파일

```bash
npm ci
npm run verify
```

검증에는 개인용·공유용·웹 스토어용 빌드와 웹 스토어 ZIP 생성이 포함된다. ZIP만 다시 만들 때는 `npm run package:store`를 실행한다.

- `dist/`: Git으로 설치한 로컬 개발용. 개인 스크립트가 들어갈 수 있다.
- `dist-public/`: 개인 스크립트 없는 압축 해제 설치용. 로컬 빌드 감지를 지원한다.
- `dist-store/`: Chrome 138 이상 웹 스토어 전용. 개인 스크립트와 기본 사이트 권한이 없고 로컬 빌드 자동 재시작을 끈다. 확장 업데이트는 Chrome 웹 스토어가 관리한다.
- `artifacts/macro-studio-<version>-chrome-store.zip`: 업로드 파일. manifest.json이 ZIP 최상위에 있다. 저장소 전체나 개인용 dist를 업로드하지 않는다.

의미 있는 배포 때 package.json, package-lock.json, extension/manifest.base.json의 버전을 함께 올린다. 웹 스토어의 후속 ZIP은 기존 업로드보다 높은 버전이어야 한다.

## 웹 스토어 설치 사용자의 흐름

Git·Node·npm 설치가 필요하지 않다. 도구모음 팝업에서 현재 사이트를 ON으로 켜고, 페이지의 파란 버튼 → 새 자동화 만들기를 연다. 폴더 연결 없이 기록을 시작할 수 있다.

기록을 끝내고 단계를 검토한 뒤 목적과 바뀌는 값을 적어 코딩 에이전트용 프롬프트를 복사한다. 웹 스토어판 프롬프트에는 저장소 없이 구현할 수 있도록 script.json과 등록 API의 규칙을 포함한다.

에이전트가 작업 폴더의 `scripts/<id>/`에 파일을 만들면 확장에서 `scripts` 폴더를 연결한다. Chrome의 사용자 스크립트 허용과 실제 사용할 사이트 권한을 선택해 켠다. 이후 파일 저장은 자동 동기화되며 매크로 실행은 사용자가 직접 시작한다.

## 등록 항목

스토어 언어 한국어, 이름 Macro Studio, 카테고리 생산성, 일반 사용자용 무료 확장으로 준비한다. 설명에는 코딩 에이전트가 별도로 필요하며 실행 코드를 기록만으로 자동 생성하는 기능은 없다는 점을 명시한다. 최초 목록은 비어 있다.

스크린샷은 실제 UI를 렌더링한 비개인 예시로 만들고 예시 화면임을 표시한다. 1280×800 PNG, 128×128 아이콘을 준비한다. 작은 프로모션 이미지가 필요한 경우 440×280 PNG를 사용한다.

현재 공개 개인정보 안내: https://github.com/hoonably/macro-studio/blob/main/docs/privacy.md

제품 내부의 자세한 안내는 `ui/privacy.html`이며 저장소의 `docs/privacy.md`와 함께 유지한다. 공개 문서도 배포 코드와 맞춰 유지한다. 기록은 로컬에만 처리해도 데이터 처리 사실과 용도를 공개해야 한다.

호스트 선택 권한은 임의의 사용자 사이트를 지원하기 위해 선언하지만 실제 권한 요청은 개별 origin으로 제한한다. userScripts는 사용자가 직접 선택한 로컬 파일을 실행한다. 개발자 서버에서 실행 코드를 내려받지 않고 eval·Function을 사용하지 않는다. 심사 설명에 이 경계를 명시한다.

심사 테스트에는 계정·UNIST 접근이 필요하지 않다. 일반적인 자체 테스트 페이지에서 입력·기록·내보내기와 개인 코드 실행을 확인할 수 있다. 테스트 스크립트를 제품의 기본 카탈로그에 넣지 않는다.

## 등록 상태 확인

ZIP 생성은 업로드·심사 제출·승인·게시 완료를 뜻하지 않는다. 대시보드에서 실제 표시되는 상태와 확장 ID·스토어 URL을 확인해야 등록을 완료했다고 보고한다. 도구가 웹 스토어 조작을 차단하면 우회하지 않고 파일과 입력 자료를 전달한다.
