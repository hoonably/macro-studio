"use strict";
(() => {
  const helper = window.MacroStudio;
  const feature = helper.features.travelRequest ||= {};
  const config = helper.config.unistTravel || {};
  feature.preset = Object.freeze({
    name: "UNIST 국내출장 신청",
    tripType: "관내출장", startHour: "13", startMinute: "00", endHour: "17", endMinute: "00",
    destination: "", organization: "", purpose: "", documentNumber: "", memo: "",
    paymentMethod: "사후지급", expectedHours: 4, expectedAmount: 20000,
    approvalLine: "", ...config,
    approvers: Object.freeze(Array.isArray(config.approvers) ? [...config.approvers] : [])
  });
  feature.isConfigured = () => ["destination", "organization", "purpose", "approvalLine"]
    .every(key => typeof feature.preset[key] === "string" && feature.preset[key].trim()) &&
    feature.preset.approvers.length > 0 && feature.preset.approvers.every(name => typeof name === "string" && name.trim());
  feature.ensureConfigured = () => {
    if (!feature.isConfigured()) throw new Error("개인 출장 설정이 없습니다. local/profiles/unist-travel.json을 만들고 npm run build를 실행하세요. docs/unist.md 참고.");
  };
})();
