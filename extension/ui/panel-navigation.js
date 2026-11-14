"use strict";
(() => {
  const routes = { 'studio.html':'studio', 'library.html':'library', 'scripts.html':'scripts', 'privacy.html':'privacy', 'reset.html':'reset' };
  const origin = chrome.runtime.getURL('').replace(/\/$/,'');
  let context = null;
  if (window === window.parent) chrome.windows.getCurrent().then(current => { context = { windowId:current.id }; }).catch(() => {});
  function open(page) {
    if (!['studio','library','scripts','privacy','reset','updates'].includes(page)) return Promise.reject(new Error('지원하지 않는 화면입니다.'));
    if (window !== window.parent) {
      window.parent.postMessage({ type:'macro-studio:panel-navigate',page }, origin);
      return Promise.resolve();
    }
    if (!context) return Promise.reject(new Error('화면을 준비하고 있습니다. 잠시 후 다시 눌러주세요.'));
    return chrome.runtime.sendMessage({ type:'panel:open',page,...context }).then(reply => {
      if (!reply?.ok) throw new Error(reply?.error || '오른쪽 패널을 열지 못했습니다.');
    });
  }
  function permissions() {
    if (window !== window.parent) {
      window.parent.postMessage({type:'macro-studio:show-permissions'},origin);return Promise.resolve();
    }
    return chrome.runtime.sendMessage({ type:'recording:permission-prompt',...context });
  }
  window.MacroStudioPanel = { open, permissions };
  const follow = event => {
    const link = event.target.closest?.('a[href]');
    if (!link) return;
    const url = new URL(link.href, location.href);
    const page = url.protocol + '//' + url.host === origin ? routes[url.pathname.split('/').pop()] : null;
    if (!page) return;
    event.preventDefault();
    open(url.hash === '#updates' ? 'updates' : page).then(() => {
      if (document.getElementById('site-toggle')) window.close();
    }).catch(error => {
      const status = document.createElement('p'); status.setAttribute('role','status'); status.textContent = error.message;
      document.body.append(status);
    });
  };
  document.addEventListener('click', follow);
  document.addEventListener('auxclick', follow);
})();
