# 공통 SAP 어댑터

SAP Web Dynpro의 `UCF_Automation` API를 사용하는 개인 매크로를 지원한다. 특정 기관의 앱·입력값·승인 경로는 포함하지 않는다. 개인 매크로가 실제 화면과 업무 흐름을 확인해 구현한다.

## 등록과 프레임

`script.json`의 대상 entry에 실제 호스트의 `matches`, `"world": "MAIN"`, `"adapters": ["dom", "sap"]`를 지정한다. 내부 프레임에서 실행해야 하면 `"allFrames": true`로 하고, 관계없는 페이지에서는 작업을 시작하지 않도록 범위를 제한한다.

`sap.connect(marker)`는 현재 창과 접근 가능한 같은 출처 프레임에서 업무 필드를 찾는다. 다른 출처 프레임의 DOM에는 접근하지 않는다. 포탈과 업무 앱의 출처가 다르면 각각에 코드를 등록하고, 메시지의 origin·source·실행 id·문서 instance를 검증해야 한다. 불러오기 중 임시 문서에는 업무 앱의 origin으로 메시지를 보내지 않는다.

## API

```js
const studio = window.MacroStudio;
const session = studio.sap.connect("date"); // 실제 화면에서 확인한 main.date 필드
await session.runExclusive("입력 준비", async () => {
  await session.ready();
  await session.set("date", values.date);
  if (session.read("date") !== values.date) throw new Error("입력값을 확인하세요.");
});
```

- `sap.locate(document, name)`: `data-cust-sid…` 속성의 업무 필드명으로 찾는다. `date`는 `main.date`로 해석한다. 전체 이름도 지정할 수 있다. 첫 항목을 반환하므로 매크로에서 대상의 유일성·화면 표시·업무 의미를 따로 확인한다.
- `sap.connect(marker)`: 해당 필드가 있는 창의 세션을 만든다. 화면이나 SAP 기본 API가 준비되지 않았으면 오류를 표시한다.
- `sap.connectButton(element)`: 버튼이 속한 창의 세션을 만든다.
- `session.ready()`: SAP가 준비 상태를 유지하는지 확인한다. 응답이 없으면 30초 후 중단한다.
- `session.read(name)`: 일반 입력·선택 값 또는 체크박스·라디오의 boolean 상태를 읽는다.
- `session.set(name, value)`: SAP 기본 입력·텍스트 편집·체크박스·라디오·콤보박스 API를 호출하고 반영을 확인한다. 같은 값은 건너뛴다.
- `session.press(buttonOrFieldName, expectedLabel)`: 연결된 SAP 버튼의 문구가 일치할 때 기본 버튼 API를 호출한다. 자동화해도 되는 준비 동작인지와 최종 제출 직전 중단은 호출하는 매크로가 검증한다.
- `session.runExclusive(taskName, action)`: 같은 창의 중복 실행을 막고 성공·실패 후 잠금을 해제한다.

## 검증 경계

동적 `WD…` ID를 저장해 재사용하지 않는다. 업무 필드로 매번 다시 찾고, 값 입력 뒤에는 앱이 계산하거나 표시한 실제 상태도 확인한다. 누락·중복·예상하지 못한 안내 창·응답 실패는 숨기지 않는다.

최종 제출·결재상신은 사용자가 직접 진행한다. `tests/sap.test.mjs`는 사이트에 접속하지 않고 공통 필드 조회·입력 반영·준비 상태·버튼 문구·프레임 탐색·동시 실행을 검증한다. 실제 사이트의 업무 규칙 검증은 개인 매크로의 범위다.
