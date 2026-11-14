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

Git·Node·npm 설치가 필요하지 않다. 도구모음 팝업에서 현재 사이트를 ON으로 켜고, 페이지의 파란 버튼 → 새 자동화 만들기를 연다. 사용 폴더 읽기·쓰기·전체 경로·Chrome 실행 허용·사이트 접근을 먼저 확인한 뒤 기록·생성을 시작한다.

기록을 끝내고 단계를 검토한 뒤 작업 설명을 적어 코딩 에이전트용 프롬프트를 복사한다. 웹 스토어판 프롬프트에는 저장소 없이 구현할 수 있도록 script.json과 등록 API의 규칙을 포함한다.

에이전트는 프롬프트에 포함된 연결 폴더의 절대경로 아래 `<id>/script.json`과 실행 파일을 만든다. 추가 사이트 권한이 나타나면 실제 사용할 주소만 선택해 허용한다. 이후 파일 저장은 자동 동기화되며 매크로 실행은 사용자가 직접 시작한다.

## 등록 항목

스토어 언어 한국어, 이름 Macro Studio, 카테고리 생산성, 일반 사용자용 무료 확장으로 준비한다. 설명에는 코딩 에이전트가 별도로 필요하며 실행 코드를 기록만으로 자동 생성하는 기능은 없다는 점을 명시한다. 최초 목록은 비어 있다.

스크린샷은 실제 UI를 렌더링한 비개인 예시로 만들고 예시 화면임을 표시한다. 1280×800 PNG, 128×128 아이콘을 준비한다. 작은 프로모션 이미지가 필요한 경우 440×280 PNG를 사용한다.

### 스토어에 표시할 문구

**한 줄 설명**

Chrome에서 클릭과 입력을 기록하고, 코딩 에이전트와 만든 매크로를 쓰던 사이트에서 실행하세요.

**상세 설명**

현재 제출 문구는 [상세 설명 원문](store-assets/description-ko.txt)을 복사한다. 조절 가능한 입력의 잠금·숨김, 이름 수정, 사이드패널, 폴더 읽기·쓰기와 로컬 저장을 포함한다.

[제품 홈페이지](https://macro-studio.pages.dev/) · [지원 페이지](https://github.com/hoonably/macro-studio/issues)

현재 공개 개인정보 안내: https://github.com/hoonably/macro-studio/blob/main/docs/privacy.md

제품 내부의 자세한 안내는 `ui/privacy.html`이며 저장소의 `docs/privacy.md`와 함께 유지한다. 공개 문서도 배포 코드와 맞춰 유지한다. 기록은 로컬에만 처리해도 데이터 처리 사실과 용도를 공개해야 한다.

호스트 선택 권한은 임의의 사용자 사이트를 지원하기 위해 선언하지만 실제 권한 요청은 개별 origin으로 제한한다. userScripts는 사용자가 직접 선택한 로컬 파일을 실행한다. 개발자 서버에서 실행 코드를 내려받지 않고 eval·Function을 사용하지 않는다. 심사 설명에 이 경계를 명시한다.

심사 테스트에는 특정 기관의 계정·사이트 접근이 필요하지 않다. 일반적인 자체 테스트 페이지에서 입력·기록·내보내기와 개인 코드 실행을 확인할 수 있다. 테스트 스크립트를 제품의 기본 카탈로그에 넣지 않는다.

## 등록 상태 확인

ZIP 생성은 업로드·심사 제출·승인·게시 완료를 뜻하지 않는다. 대시보드에서 실제 표시되는 상태와 확장 ID·스토어 URL을 확인해야 등록을 완료했다고 보고한다. 도구가 웹 스토어 조작을 차단하면 우회하지 않고 파일과 입력 자료를 전달한다.

## 1.4.0 업데이트 제출 순서

이번 작업은 ZIP·이미지·문구를 준비한 상태다. Git 커밋·푸시나 홈페이지 배포는 Chrome 웹 스토어 심사 제출을 대신하지 않는다.

1. [개발자 대시보드](https://chrome.google.com/webstore/devconsole)에서 **기존 Macro Studio** 항목(ID `oobgpakpaoknojmgkolgmmkjemjmimld`)을 연다. 새 항목을 만들지 않는다.
2. **Package → Upload New Package**에서 `macro-studio-1.4.0-chrome-store.zip`을 올리고 버전 1.4.0을 확인한다.
3. **Store listing**의 기존 캡처를 [제출 자료](store-assets/README.md)의 PNG 4장으로 교체한다. 한국어 상세 설명에는 `description-ko.txt`를 사용한다. 홈페이지·지원·개인정보처리방침 URL은 유지한다.
4. **Privacy practices**와 권한 설명을 현재 기능에 맞춘다. 웹페이지 클릭·입력·선택자·페이지 정보와 명시적으로 잠금·숨김한 값은 로컬에서 처리한다. 외부 수집 서버가 없다는 사실과 데이터 처리가 없다는 선언을 혼동하지 않는다. 폴더 쓰기는 사용자가 이름을 저장할 때 `script.json`의 이름만 바꾸는 용도다. [현재 개인정보 안내](privacy.md)와 `reviewer-notes-ko.txt`를 함께 참고한다.
5. 필요한 검토 안내에 `reviewer-notes-ko.txt`를 넣고 **Submit for Review**를 누른다. 승인 뒤 바로 배포하려면 자동 게시를 선택한다. 자동 게시를 끄면 승인 후 직접 Publish해야 한다.
6. 대시보드에 게시 완료가 표시되고 공개 스토어 버전도 1.4.0으로 바뀌면 완료다. 기존 사용자는 Chrome 업데이트 경로로 받는다. 기존 읽기 전용 연결에는 폴더 읽기·쓰기 허용 안내가 나올 수 있다. 이미 열어둔 작업 페이지는 새로고침해야 새 실행 UI가 반영된다.

승인·게시 후에는 홈페이지 생성 원본 `jeonghoonpark.com/scripts/build-project-sites.py`에서 Macro Studio의 `storeVersion`을 `1.4.0`으로 바꾸고 `previewNotice`를 제거한 뒤 `--project macro-studio`로 재생성한다. 제출 준비 단계에서는 현재 공개 버전 1.3.1 표시를 유지한다. 게시 후 README의 제출 준비 안내 문장도 제거한다.

공식 안내: [기존 항목 업데이트](https://developer.chrome.com/docs/webstore/update), [스토어 이미지·설명](https://developer.chrome.com/docs/webstore/cws-dashboard-listing), [로컬 데이터 처리 공개](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq).
