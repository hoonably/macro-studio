# 개인 작업 공간

이 파일을 제외한 내용은 Git에서 제외됩니다.

- `profiles/unist-travel.json`: 개인 출장 입력값과 결재선
- `scripts/<id>/`: 개인 매크로 (`npm run new:script`로 생성)
- `recordings/`, `captures/`: 필요할 때 기록과 진단 자료를 저장

`npm run build`는 개인 설정과 스크립트를 포함해 `dist/`를 만듭니다.
`npm run build:public`은 이 폴더를 읽지 않고 `dist-public/`을 만듭니다.
개인용 `dist/`는 공유하지 마세요.
