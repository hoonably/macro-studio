"use strict";

(() => {
  const helper = window.MacroStudio;
  const feature = helper.features.travelRequest;

  function orderedTimes(session, preset) {
    const fields = [
      ["종료 시", "endho_cp", preset.endHour], ["종료 분", "endmi_cp", preset.endMinute],
      ["시작 시", "begho_cp", preset.startHour], ["시작 분", "begmi_cp", preset.startMinute]
    ];
    const current = fields.map(([, name]) => session.read(name));
    const readable = values => values.every((value, index) =>
      typeof value === "string" && /^\d{2}$/.test(value) && Number(value) <= (index % 2 ? 59 : 23));
    const valid = values => readable(values) &&
      Number(values[0]) * 60 + Number(values[1]) > Number(values[2]) * 60 + Number(values[3]);
    if (!readable(current)) throw new Error("현재 출장 시간을 확인하지 못했습니다. 신청서의 시작·종료 시간을 확인하세요.");
    function plan(values, remaining) {
      if (!remaining.length) return [];
      for (const index of remaining) {
        const next = [...values]; next[index] = fields[index][2];
        if (!valid(next)) continue;
        const rest = plan(next, remaining.filter(item => item !== index));
        if (rest) return [fields[index], ...rest];
      }
      return null;
    }
    const result = plan(current, [0, 1, 2, 3]);
    if (!result) throw new Error("시작·종료 시간을 안전한 순서로 변경할 수 없습니다. 시간을 직접 확인하세요.");
    return result;
  }

  feature.fill = async function (date, onProgress = () => {}, inputs = {}) {
    const { preset: p } = feature.resolveTrip(date, inputs);
    const session = helper.sap.connect("begda_cp");
    return session.runExclusive("출장신청", async () => {
      const tasks = feature.tripTasks(date, p);
      let current = "초기화";
      try {
        let timePlanned = false;
        for (let index = 0; index < tasks.length; index++) {
          if (!timePlanned && tasks[index][1] === "endho_cp") {
            // 기존 순서를 우선하되, 앞당긴 종료 시간이 현재 시작보다 빨라지지 않게 합니다.
            tasks.splice(index, 4, ...orderedTimes(session, p));
            timePlanned = true;
          }
          const [label, name, value] = tasks[index];
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
          const numeric = String(actual ?? "").replace(/,/g, "");
          const valid = /^\d+(?:\.\d+)?$/.test(numeric) && Number.isFinite(Number(numeric));
          rows.push({ 항목: label, 기대값: expected ?? "SAP 계산값 · 제출 전 확인", 현재값: actual,
            일치: valid && (expected === null ? Number(numeric) >= 0 : name === "diff_cp" ?
              Math.abs(Number(numeric) - expected) < 0.005001 : Number(numeric) === expected) });
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
