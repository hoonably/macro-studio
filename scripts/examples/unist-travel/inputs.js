"use strict";

(() => {
  const feature = window.MacroStudio.features.travelRequest;
  const minutes = value => {
    if (typeof value !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
      throw new Error("출장 시간을 HH:MM 형식으로 입력하세요.");
    }
    const [hour, minute] = value.split(":").map(Number);
    return hour * 60 + minute;
  };
  feature.resolveTrip = function (date, inputs = {}) {
    const parts = String(date).split(".").map(Number);
    const day = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    if (!/^\d{4}\.\d{2}\.\d{2}$/.test(date) ||
        day.getUTCFullYear() !== parts[0] || day.getUTCMonth() !== parts[1] - 1 ||
        day.getUTCDate() !== parts[2]) throw new Error("날짜를 YYYY.MM.DD 형식의 실제 날짜로 입력하세요.");
    const preset = { ...feature.preset, ...inputs.preset };
    feature.ensureConfigured(preset);
    const defaultStart = preset.startHour + ":" + preset.startMinute;
    const defaultEnd = preset.endHour + ":" + preset.endMinute;
    const start = inputs.startTime ?? defaultStart, end = inputs.endTime ?? defaultEnd;
    const duration = minutes(end) - minutes(start);
    if (duration <= 0) throw new Error("같은 날의 종료 시간을 시작 시간보다 늦게 입력하세요.");
    const defaultDuration = minutes(defaultEnd) - minutes(defaultStart);
    // 시간 변경으로 달라지는 여비 규정은 추정하지 않고 SAP 계산값을 확인합니다.
    if (duration !== defaultDuration) preset.expectedAmount = null;
    [preset.startHour, preset.startMinute] = start.split(":");
    [preset.endHour, preset.endMinute] = end.split(":");
    preset.expectedHours = duration / 60;
    preset.approvers = Object.freeze([...preset.approvers]);
    return { date, preset: Object.freeze(preset) };
  };
  feature.tripTasks = (date, p) => [
    ["출장유형", "tco_left2_zztrvcl", p.tripType],
    ["출장일", "begda_cp", date],
    ["출장재원: 기타", "tco_zztrvfd_cp_cp", true],
    ["외부지원", "zforyn", false],
    ["타기관공동연구", "zjsyn", false],
    ["자비", "allbt", true],
    ["중복출장", "chk_duplication", false],
    ["공용차량이용", "tco_gunyn_cp", false],
    ["학회출장", "chk_society", false],
    ["종료 시", "endho_cp", p.endHour],
    ["종료 분", "endmi_cp", p.endMinute],
    ["시작 시", "begho_cp", p.startHour],
    ["시작 분", "begmi_cp", p.startMinute],
    ["출장지", "zztrvlo_cp", p.destination],
    ["출장기관", "zor_cp", p.organization],
    ["출장목적", "zztrvpu", p.purpose],
    ["관련문서번호", "textedit2", p.documentNumber],
    ["비고", "textedit1", p.memo],
    ["여비처리방법", "zztrvcm_cp", p.paymentMethod]
  ];
})();
