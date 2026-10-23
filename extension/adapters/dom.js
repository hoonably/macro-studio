"use strict";
(() => {
  const studio = window.MacroStudio;
  const visible = element => element.isConnected && !element.hidden && element.getClientRects().length > 0 &&
    getComputedStyle(element).visibility !== 'hidden';
  function one(selector, { root = document, includeHidden = false } = {}) {
    const found = [...root.querySelectorAll(selector)].filter(element => includeHidden || visible(element));
    if (found.length !== 1) throw new Error('항목을 하나로 찾지 못했습니다: ' + selector + ' (' + found.length + ')');
    return found[0];
  }
  async function waitFor(read, { timeout = 15000, signal } = {}) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      const value = await read();
      if (value) return value;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('화면이 준비되지 않았습니다.');
  }
  async function set(selector, value, options) {
    const element = one(selector, options);
    if (element.disabled || element.readOnly) throw new Error('입력할 수 없는 항목입니다.');
    if (element.type === 'password' || element.type === 'file' || element.type === 'hidden') throw new Error('직접 입력할 항목입니다.');
    const checkbox = ['checkbox', 'radio'].includes(element.type);
    const property = checkbox ? 'checked' : 'value';
    const expected = checkbox ? Boolean(value) : String(value);
    if (element[property] === expected) return;
    const view = element.ownerDocument.defaultView;
    const constructor = element.tagName === 'TEXTAREA' ? view.HTMLTextAreaElement :
      element.tagName === 'SELECT' ? view.HTMLSelectElement : view.HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(constructor.prototype, property)?.set;
    if (!setter) throw new Error('지원하지 않는 입력 항목입니다.');
    setter.call(element, expected);
    element.dispatchEvent(new view.Event('input', { bubbles: true }));
    element.dispatchEvent(new view.Event('change', { bubbles: true }));
    await waitFor(() => one(selector, options)[property] === expected);
  }
  async function click(selector, { expectedText, allowSubmit = false, ...options } = {}) {
    const element = one(selector, options);
    if (element.disabled || element.getAttribute('aria-disabled') === 'true') throw new Error('사용할 수 없는 버튼입니다.');
    const text = (element.textContent || element.value || '').replace(/\s+/g, ' ').trim();
    if (expectedText !== undefined && text !== expectedText) throw new Error('버튼 이름이 예상과 다릅니다.');
    if (!allowSubmit && (element.type === 'submit' || /결재상신|최종\s*제출|구매\s*확정|영구\s*삭제/.test(text))) {
      throw new Error('최종 제출은 직접 진행하세요.');
    }
    element.click();
  }
  studio.dom = { one, waitFor, set, click };
})();
