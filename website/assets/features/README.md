# 기능 화면 출처

Macro Studio 1.4.0의 실제 `dist-store` UI를 격리된 Chrome에서 렌더링했다. 확장 API만 메모리 fixture로 대체했으며, 모든 캡처에 예시 데이터임을 표시했다. 개인 매크로·계정·업무 입력값은 사용하지 않았다.

| 파일 | 크기 | 화면 |
| --- | --- | --- |
| `recording.jpg` | 2560×2000 | 같은 오른쪽 패널에서 작업 기록 |
| `agent.jpg` | 2560×2000 | 작업 설명과 지시문 복사 완료 |
| `launcher.jpg` | 2560×2000 | 입력 잠금·숨김과 제목의 이름 수정 아이콘 |

원본 UI를 1280×1000, 픽셀 밀도 2로 다시 렌더링해 JPEG 품질 95로 저장했다. 이전 이미지를 확대하지 않았다. 스토어용 1280×800 PNG 4장은 `docs/store-assets/`에 별도로 보관한다.

재생성: `npm run build:store` → `npm run screenshots`. 소스는 [캡처 도구](../../../tools/render-store-assets.mjs), 규격·빌드 식별자는 [캡처 기록](../../../docs/store-assets/capture-manifest.json)에서 확인한다. 임시 서버와 Chrome 프로필은 도구가 정리한다.
