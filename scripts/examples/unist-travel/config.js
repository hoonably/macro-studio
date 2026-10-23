"use strict";

(() => {
  const feature = window.MacroStudio.features.travelRequest;
  function today() {
    const now = new Date();
    return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0")].join("-");
  }
  feature.launcherDefinition = function (run, initialDate = today) {
    const p = feature.preset;
    return {
      id: "unist-travel",
      name: p.name || "UNIST 국내출장 신청",
      description: p.tripType + " · " + p.startHour + ":" + p.startMinute + "–" + p.endHour + ":" + p.endMinute,
      actionLabel: "신청 준비",
      fields: [{ name: "date", label: "출장일", type: "date", required: true, value: initialDate }],
      summary: [["출장지", p.destination], ["출장기관", p.organization], ["출장목적", p.purpose],
        ["출장재원", "기타 · 자비"], ["여비", p.expectedAmount.toLocaleString("ko-KR") + "원 · " + p.paymentMethod],
        ["비고", p.memo], ["결재선", p.approvers.join(" → ")]],
      note: feature.isConfigured() ? p.approvers.join(" → ") + " 결재선까지 준비합니다. 최종 결재상신은 직접 눌러주세요." : "개인 출장 설정이 필요합니다. docs/unist.md를 참고하세요.",
      run: (values, report) => { feature.ensureConfigured(); return run(values.date.replace(/-/g, "."), report); }
    };
  };
})();
