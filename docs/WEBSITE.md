# 소개 사이트

`website/`의 정적 파일을 Cloudflare Pages에 배포합니다. 프로덕션 브랜치는 `main`입니다.

- 빌드 명령: `exit 0`
- 출력 폴더: `website`
- 프로젝트 이름: `macro-studio` (`wrangler.jsonc`)
- 연결 주소: `https://macro-studio.pages.dev/`
- 일반 사용자 설치는 출시된 [Chrome 웹 스토어 확장](https://chromewebstore.google.com/detail/oobgpakpaoknojmgkolgmmkjemjmimld)으로 안내합니다. 사이트는 Pages에서 제공하고, 로컬 빌드는 개발 문서에서 별도로 설명합니다.

디자인·문구·다른 프로젝트 목록 원본은 같은 상위 폴더의 `jeonghoonpark.com/shared/project-directory/`와 `scripts/build-project-sites.py`입니다. 생성된 이 폴더는 독립 배포할 수 있어 다른 저장소를 함께 빌드할 필요가 없습니다.

미리보기는 `jeonghoonpark.com/scripts/preview-project-sites.py`를 실행한 뒤 `http://127.0.0.1:4176/`에서 엽니다. 검토 허브는 `http://127.0.0.1:4170/`이며, 각 제품 사이트는 실제 Pages 배포와 같은 독립 포트의 루트(`/`)를 사용합니다. 이 저장소만 따로 열 때는 `python3 -m http.server 4176 --bind 127.0.0.1 --directory website`를 실행합니다.

공통 ‘다른 프로젝트’ 메뉴는 카탈로그의 실제 Pages 주소로 연결됩니다. cosMOSS는 `https://cosmoss-app.pages.dev/`, Pickly는 `https://pickly-app.pages.dev/`이며 나머지는 저장소 이름을 사용합니다. 로컬 주소는 검토 허브에서만 사용합니다.
