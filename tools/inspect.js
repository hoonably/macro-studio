/* Read-only console helper. Paste the whole file into the target frame's console. */
(() => {
  const safeURL = value => { try { const u = new URL(value); return u.origin + u.pathname; } catch { return ''; } };
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 100);
  const secret = el => ['password', 'hidden', 'file'].includes(el.type) ||
    /pass|secret|token|authorization|api.?key|otp|one.?time|cc-|비밀번호|인증번호/i.test([el.name, el.id, el.autocomplete].join(' '));
  const quote = value => JSON.stringify(value);
  const fields = [...document.querySelectorAll('input,select,textarea,button,[role="button"],[ct]')]
    .filter(el => !secret(el) && !el.closest('#macro-studio-launcher') && el.getClientRects().length)
    .slice(0, 300).map(el => ({
      tag: el.localName, type: el.type || '', role: el.getAttribute('role') || '',
      name: el.name || '', id: el.id || '',
      label: clean(el.getAttribute('aria-label') || el.getAttribute('title') ||
        (el.matches('button,[role="button"],[ct="B"]') ? el.textContent : '')),
      selector: el.getAttribute('data-testid') ? '[data-testid=' + quote(el.getAttribute('data-testid')) + ']' :
        el.name ? el.localName + '[name=' + quote(el.name) + ']' : '',
      sapField: el.getAttributeNames().map(name => name.match(/((?:v_main|main)\.[\w.]+)"?$/)?.[1]).find(Boolean) || ''
    }));
  const frames = [...document.querySelectorAll('iframe,frame')].map(el => ({
    id: el.id, title: clean(el.title), src: safeURL(el.src),
    accessible: (() => { try { return !!el.contentDocument; } catch { return false; } })()
  }));
  const report = { page: safeURL(location.href), fields, frames };
  console.table(fields);
  console.log(JSON.stringify(report, null, 2));
  return report;
})();
