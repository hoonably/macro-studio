"use strict";

(() => {
  const helper = window.MacroStudio;
  const feature = helper.features.travelRequest;

  feature.fill = async function (date, onProgress = () => {}) {
    feature.ensureConfigured();
    const parts = date.split(".").map(Number);
    const day = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    if (!/^\d{4}\.\d{2}\.\d{2}$/.test(date) ||
        day.getUTCFullYear() !== parts[0] || day.getUTCMonth() !== parts[1] - 1 ||
        day.getUTCDate() !== parts[2]) throw new Error("날짜를 YYYY.MM.DD 형식의 실제 날짜로 입력하세요.");

    const session = helper.sap.connect("begda_cp");
    return session.runExclusive("출장신청", async () => {
      const p = feature.preset;
      const tasks = [
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
      let current = "초기화";
      try {
        for (const [label, name, value] of tasks) {
          current = label;
          onProgress(label);
          await session.set(name, value);
          console.log("입력 확인:", label);
        }
        current = "최종 값 확인";
        await session.ready();
        const rows = tasks.map(([label, name, expected]) => ({
          항목: label, 기대값: expected, 현재값: session.read(name), 일치: session.read(name) === expected
        }));
        for (const [label, name, expected] of [
          ["출장시간", "diff_cp", p.expectedHours],
          ["출장비총액", "tco_tvamt_cp", p.expectedAmount]
        ]) {
          const actual = session.read(name);
          rows.push({ 항목: label, 기대값: expected, 현재값: actual,
            일치: Number(String(actual).replace(/,/g, "")) === expected });
        }
        // 입력값은 반환만 하고 콘솔에 남기지 않습니다.
        const failed = rows.filter(row => !row.일치);
        if (failed.length) throw new Error("확인이 필요한 항목: " + failed.map(row => row.항목).join(", "));
        console.log("✅ 출장신청 자동입력 완료. 화면을 확인한 뒤 직접 저장·상신하세요.");
        return rows;
      } catch (error) {
        throw new Error(current + " 단계에서 중단: " + error.message);
      }
    });
  };
})();
