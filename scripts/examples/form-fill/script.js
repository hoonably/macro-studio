"use strict";
(() => {
  if (!document.querySelector('#demo-form')) return;
  const studio = window.MacroStudio;
  studio.launcher.create().register({
    id: 'example-form-fill', name: '폼 입력 예제', description: '날짜를 바꾸고 고정값을 한 번에 입력',
    actionLabel: '예제 채우기',
    fields: [{ name: 'date', label: '방문일', type: 'date', required: true,
      value: () => { const d = new Date(); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'); } }],
    summary: [['방문 기관', '예제 연구실'], ['목적', '정기 미팅']],
    note: '입력까지만 진행합니다.',
    async run({ date }, report) {
      report('방문일 입력'); await studio.dom.set('[name="visitDate"]', date);
      report('기관 입력'); await studio.dom.set('[name="organization"]', '예제 연구실');
      report('목적 입력'); await studio.dom.set('[name="purpose"]', '정기 미팅');
      document.querySelector('#demo-result').textContent = '입력 완료. 날짜와 내용을 확인하세요.';
      return '입력 완료. 날짜와 내용을 확인하세요.';
    }
  });
  document.getElementById('macro-studio-launcher')?.shadowRoot.querySelector('.studio-open')?.addEventListener('click', () => { location.href = 'studio.html'; });
})();
