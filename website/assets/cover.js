document.querySelectorAll('[data-macro-demo]').forEach(demo => {
  const destination = demo.querySelector('#macro-destination');
  const date = demo.querySelector('#macro-date');
  const run = demo.querySelector('[data-run]');
  const runLabel = run.querySelector('span');
  const steps = demo.querySelectorAll('.macro-tape__steps li');
  const sheet = demo.querySelector('.trip-sheet');
  const status = sheet.querySelector('[data-status]');
  const fields = sheet.querySelectorAll('[data-field]');

  function clearSheet() {
    sheet.removeAttribute('data-saved');
    for (const field of fields) {
      field.textContent = '—';
      field.removeAttribute('data-filled');
    }
    status.textContent = '작성 전';
    runLabel.textContent = '매크로 실행';
  }

  function setStep(current, message) {
    steps.forEach((step, index) => {
      if (index === current) step.setAttribute('aria-current', 'step');
      else step.removeAttribute('aria-current');
    });
    status.textContent = message;
  }

  const today = new Date();
  date.valueAsDate = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  date.disabled = false;
  destination.disabled = false;
  run.hidden = false;
  destination.addEventListener('change', clearSheet);
  date.addEventListener('input', clearSheet);
  run.addEventListener('click', async () => {
    if (run.getAttribute('aria-disabled') === 'true' || !date.reportValidity()) return;
    const option = destination.selectedOptions[0];
    const formattedDate = date.valueAsDate.toLocaleDateString('ko-KR', {
      year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC'
    });
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const pause = () => reducedMotion ? Promise.resolve() : new Promise(resolve => setTimeout(resolve, 440));
    function fillField(name, value, step, message) {
      setStep(step, message);
      const field = sheet.querySelector('[data-field="' + name + '"]');
      field.textContent = value;
      field.setAttribute('data-filled', '');
      return pause();
    }

    clearSheet();
    destination.disabled = true;
    date.disabled = true;
    run.setAttribute('aria-disabled', 'true');
    runLabel.textContent = '실행 중';
    setStep(0, '신청서 여는 중');
    await pause();
    await fillField('destination', option.value, 1, '출장지 입력 중');
    await fillField('date', formattedDate, 2, '출장일 입력 중');
    await fillField('purpose', option.dataset.purpose, -1, '출장 목적 입력 중');
    setStep(-1, '저장 중');
    await pause();
    sheet.setAttribute('data-saved', '');
    setStep(-1, '임시저장됨');
    runLabel.textContent = '다시 실행';
    run.removeAttribute('aria-disabled');
    destination.disabled = false;
    date.disabled = false;
  });
});
