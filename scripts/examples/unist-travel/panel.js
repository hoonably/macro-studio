"use strict";

(() => {
  // 포탈 안에서는 최상위 공통 아이콘 하나만 사용합니다.
  if (window !== window.top) return;
  const helper = window.MacroStudio;
  const feature = helper.features.travelRequest;
  const launcher = helper.launcher.create();
  const initialDate = () => {
    const value = helper.sap.locate(document, "begda_cp")?.value;
    if (/^\d{4}\.\d{2}\.\d{2}$/.test(value)) return value.replace(/\./g, "-");
    const now = new Date();
    return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0")].join("-");
  };
  launcher.register(feature.launcherDefinition(async (date, report) => {
    await feature.runFromList(date, report);
    return date + " 결재선 준비 완료: " + feature.preset.approvers.join(" → ") + "\n최종 결재상신을 직접 누르세요.";
  }, initialDate));
})();
