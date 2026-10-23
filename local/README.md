# 개인 작업 공간

이 파일을 제외한 내용은 Git에서 제외됩니다.

- `scripts/<id>/`: 개인 매크로와 실행에 필요한 설정 (`npm run new:script`로 생성)
- `recordings/`, `captures/`: 필요할 때 기록과 진단 자료를 저장

`npm run build`는 `scripts/`의 활성 개인 스크립트를 포함해 `dist/`를 만듭니다. 개인 스크립트가 없으면 실행 목록도 비어 있습니다. `profiles/`의 설정 파일은 자동으로 읽거나 포함하지 않습니다.
`npm run build:public`은 이 폴더를 읽지 않고 `dist-public/`을 만듭니다.
개인용 `dist/`는 공유하지 마세요.
