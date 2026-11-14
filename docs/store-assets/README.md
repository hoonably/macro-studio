# Chrome 웹 스토어 제출 자료 · 1.4.0

- `01-recording.png` ~ `04-library.png`: 1280×800 PNG 스크린샷 4장. 기존 캡처를 이 순서로 교체한다.
- `icon-128.png`: 128×128 스토어 아이콘. 기존과 같은 제품 아이콘이다.
- [상세 설명](description-ko.txt): Store listing의 한국어 상세 설명.
- [변경 사항](release-notes-ko.txt): 이번 업데이트 설명.
- [검토 안내](reviewer-notes-ko.txt): 심사 담당자용 테스트·권한 설명.
- [캡처 기록](capture-manifest.json): 버전·빌드 식별자·파일 규격.

확장 ZIP은 `npm run verify` 후 `artifacts/macro-studio-1.4.0-chrome-store.zip`으로 생성된다. 이 폴더 자체를 확장 ZIP 대신 업로드하지 않는다. 최종 전달 때는 ZIP과 이 자료를 Downloads의 제출 폴더에 모아 둔다.

캡처는 실제 `dist-store`의 UI·스타일·런처를 격리된 Chrome에서 렌더링한 것이다. 확장 API만 예시 메모리 데이터로 대체했으며 화면에 예시임을 표시했다. 개인 매크로·계정·브라우저 프로필·실제 업무 데이터는 사용하지 않았다. 홈페이지용 JPEG 3장과 README 미리보기도 같은 도구로 갱신한다.

```bash
npm run build:store
npm run screenshots
```

Node.js 22 이상과 Chrome, ImageMagick의 `magick`이 필요하다. macOS 기본 Chrome 위치를 사용하며 다른 환경은 `CHROME_BINARY`를 지정한다. 생성 도구가 자체 미리보기 서버와 임시 Chrome 프로필을 종료·삭제한다.

제출 절차는 [업데이트 안내](../chrome-web-store.md)를 참고한다. 1.4.0의 심사·게시는 아직 수행하지 않았다.
