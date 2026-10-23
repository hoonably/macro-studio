"use strict";
(() => {
  if (window !== window.top) return;
  const studio = window.MacroStudio;
  studio.launcher.create().register({
    id: __SCRIPT_ID__,
    name: __SCRIPT_NAME__,
    description: "나만의 반복 작업",
    fields: [{ name: "date", label: "날짜", type: "date", required: true }],
    note: "최종 제출은 직접 진행합니다.",
    async run(values, report) {
      // Read AGENTS.md and docs/create-script.md. Inspect the real page first.
      // Example: await studio.dom.set('[name="date"]', values.date);
      // Never guess a selector or automate the final submission.
      report("화면 확인 중…");
      throw new Error("기록과 실제 화면을 바탕으로 이 스크립트를 구현하세요.");
    }
  });
})();
