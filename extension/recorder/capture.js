"use strict";
(() => {
  if (window.__macroStudioCaptureInstalled) return;
  window.__macroStudioCaptureInstalled = true;
  let recordingId = null;
  const pending = new Map();
  const observedControls = new Map();
  let controlObserver = null;
  const roots = new Set([document]);
  const metadataSeen = new Set();
  let contextTimer = null,contextExpiry = null,lastContext = null;
  const FIELD_SELECTOR = 'input,textarea,select,[contenteditable="true"],[contenteditable="plaintext-only"],[role="textbox"],[role="checkbox"],[role="radio"],[role="switch"],[role="combobox"],[role="listbox"],[role="slider"],[role="spinbutton"]';
  const NOTICE_ID = 'macro-studio-recording-permission-notice';
  function permissionNotice(recording) {
    if (document.getElementById(NOTICE_ID)) return;
    const host = document.createElement('aside'); host.id = NOTICE_ID;
    host.style.cssText = 'position:fixed;z-index:2147483647;right:16px;top:16px;width:min(320px,calc(100vw - 32px))';
    const root = host.attachShadow({mode:'open'});
    root.innerHTML = `<style>:host{font:14px/1.6 system-ui;color:#20344e}section{background:white;border:1px solid #c7d3e2;border-radius:12px;padding:18px;box-shadow:0 8px 28px #0002}p{margin:6px 0 14px}button{font:inherit;font-weight:600;background:#145fc0;color:white;border:0;border-radius:8px;padding:10px 14px;cursor:pointer}button:focus-visible{outline:3px solid #8bb9ff;outline-offset:3px}</style><section role="alert"><strong>기록을 잠시 멈췄어요</strong><p>새 내부 사이트를 허용해야 기록을 이어갈 수 있어요.</p><button type="button">오른쪽에서 허용 안내 열기</button></section>`;
    root.querySelector('strong').textContent = '기록을 잠시 멈췄어요';
    root.querySelector('button').addEventListener('click', event => {
      if (!event.isTrusted) return;
      chrome.runtime.sendMessage({type:'recording:permission-prompt',id:recording}).catch(()=>{});
    });
    document.documentElement.append(host);
  }
  const send = event => {
    if (!recordingId) return Promise.resolve();
    return chrome.runtime.sendMessage({ type: 'capture:event', recordingId, event }).catch(() => {});
  };
  const setRecording = id => {
    const next = id || null, changed = next !== recordingId;
    recordingId = next;
    if (!next || changed) {
      for (const timer of pending.values()) clearTimeout(timer); pending.clear();
      for (const choice of observedControls.values()) { clearTimeout(choice.timer); clearTimeout(choice.expiry); }
      observedControls.clear(); controlObserver?.disconnect(); controlObserver = null;
      roots.clear(); roots.add(document); metadataSeen.clear();
      clearTimeout(contextTimer);clearTimeout(contextExpiry);lastContext=null;
    }
    if (next && changed) send({ action: 'navigation', page: { url: location.href, title: document.title } });
  };
  const sensitive = element => ['password', 'hidden', 'file'].includes(element.type) ||
    /password|passwd|passcode|secret|token|authorization|api[-_ ]?key|otp|one[-_ ]?time|cc-|비밀번호|인증번호|카드번호/i.test(
      [element.name, element.id, element.autocomplete, element.getAttribute('aria-label'),
        [...(element.labels || [])].map(label=>label.textContent).join(' '),
        (element.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map(id=>element.getRootNode?.().querySelector?.('[id='+quote(id)+']')?.textContent || '').join(' ')].join(' '));
  const quote = value => '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]/g, ' ') + '"';
  const eventTarget = event => event.composedPath().find(node => node?.nodeType === 1) || event.target;
  function selectorCandidates(element) {
    const selectors = [];
    for (const attr of ['data-testid','data-test','name','aria-label']) {
      const value = element.getAttribute(attr);
      if (value && value.length < 160) selectors.push(element.localName + '[' + attr + '=' + quote(value) + ']');
    }
    if (element.id && !/^(?:WD|__|[a-f\d]{12,})/i.test(element.id)) selectors.unshift('#' + CSS.escape(element.id));
    return selectors;
  }
  function visible(element) {
    return element?.nodeType === 1 && !element.hidden && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
  }
  function rememberRoots(event) {
    for (const node of event.composedPath()) {
      const root = node?.getRootNode?.();
      if (!root?.host || root.host.shadowRoot !== root || roots.has(root) || roots.size >= 12) continue;
      roots.add(root);
      controlObserver?.observe(root, observerOptions);
    }
  }
  function lookupRoot(target) {
    let root = document;
    for (const selectors of target.shadowPath || []) {
      let host;
      for (const selector of selectors) {
        const matches = root.querySelectorAll(selector);
        if (matches.length === 1) { host = matches[0];break; }
      }
      if (!host?.shadowRoot) return null;
      root = host.shadowRoot;
    }
    return root;
  }
  function describe(element) {
    const label = element.getAttribute('aria-label') ||
      (element.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map(id => element.getRootNode?.().querySelector?.('[id='+quote(id)+']')?.textContent || '').join(' ').trim() ||
      [...(element.labels || [])].map(item => item.textContent).join(' ') ||
      (element.matches('input,textarea,select,[contenteditable],[role="textbox"],[role="combobox"],[role="listbox"],[role="slider"],[role="spinbutton"]') ? '' : element.textContent) || element.getAttribute('title') || element.name || '';
    const selectors = selectorCandidates(element);
    const shadowPath = [];
    let root = element.getRootNode?.();
    while (root?.host && shadowPath.length < 8) {
      const candidates = selectorCandidates(root.host);
      shadowPath.unshift(candidates.length ? candidates : [root.host.localName]);
      root = root.host.getRootNode();
    }
    const sapField = element.getAttributeNames().map(attr => attr.match(/((?:v_main|main)\.[\w.]+)"?$/)?.[1]).find(Boolean) || '';
    return { tag: element.localName, type: element.type || '', role: element.getAttribute('role') || '',
      name: element.name || '', id: element.id || '', autocomplete: element.autocomplete || '',
      label: label.replace(/\s+/g, ' ').trim().slice(0, 160), selectors, sapField,
      ...(shadowPath.length ? {shadowPath} : {}),
      locatorQuality: sapField || selectors.length ? 'identified' : 'text-only',
      ...(element.localName === 'canvas' || element.localName.includes('-') && !element.shadowRoot && !element.childElementCount ? {opaque:true} : {}),
      placeholder:element.getAttribute('placeholder') || '',pattern:element.getAttribute('pattern') || '',
      readOnly:!!element.readOnly || element.hasAttribute('readonly') || element.getAttribute('aria-readonly')==='true',disabled:!!element.disabled || element.hasAttribute('disabled'),controlType:element.getAttribute('ct') || '' };
  }
  const ownUI = event => event.composedPath().some(node => node?.id === 'macro-studio-launcher' || node?.id === NOTICE_ID);
  function valueOf(element) {
    if (['checkbox', 'radio'].includes(element.type)) return !!element.checked;
    if (element.hasAttribute('aria-checked')) {
      const checked = element.getAttribute('aria-checked');
      return checked === 'true' ? true : checked === 'false' ? false : checked === 'mixed' ? 'mixed' : undefined;
    }
    if (element.matches('select[multiple]')) return [...element.querySelectorAll('option')].filter(option=>option.selected).map(option=>option.value).slice(0,100);
    if ('value' in element) return String(element.value).slice(0,2000);
    if (element.matches('[contenteditable="true"],[contenteditable="plaintext-only"],[role="textbox"]')) return element.textContent.slice(0,2000);
    if (element.hasAttribute('aria-valuenow') || element.hasAttribute('aria-valuetext')) return element.getAttribute('aria-valuetext') || element.getAttribute('aria-valuenow');
    if (element.getAttribute('role') === 'listbox') return [...element.querySelectorAll('[role="option"][aria-selected="true"]')].map(option=>option.textContent.trim()).slice(0,100);
    return undefined;
  }
  function capture(action, element, evidence = 'native', details = {}) {
    if (!recordingId || !element || sensitive(element)) return;
    const target = describe(element), value = ['input','change'].includes(action) ? valueOf(element) : undefined;
    const observed = observedControls.get(target.sapField || element);
    if (observed && ['input','change'].includes(action)) observed.last = value;
    return send({ action, target, value, evidence, ...details, page: { url: location.href, title: document.title } });
  }
  function choiceTarget(target) {
    const direct = target.closest?.('[role="checkbox"],[role="radio"],[role="switch"],[role="combobox"],[ct="CB"]');
    // Native controls already emit trusted input/change events.
    if (direct && !direct.matches('input[type="checkbox"],input[type="radio"],select')) return direct;
    const option = target.closest?.('[role="option"],[data-itemkey]');
    if (!option) return null;
    const root = target.getRootNode?.() || document;
    const owners = [...root.querySelectorAll('[role="combobox"],[ct="CB"]')].filter(element =>
      (element.getAttribute('aria-controls') || '').split(/\s+/).some(id => root.querySelector('[id=' + quote(id) + ']')?.contains(option)));
    return owners.length === 1 ? owners[0] : null;
  }
  function editableField(element) {
    return element && element.matches(FIELD_SELECTOR) && !element.disabled && !element.hasAttribute('disabled') && element.getAttribute('aria-disabled')!=='true' && !sensitive(element) &&
      !['button','submit','reset','image','checkbox','radio'].includes(element.type) &&
      (!(element.readOnly || element.hasAttribute('readonly') || element.getAttribute('aria-readonly')==='true') || element.matches('[type="date"],[type="time"],[aria-haspopup="dialog"],[aria-haspopup="grid"]'));
  }
  function controlTarget(target) {
    const choice = choiceTarget(target);
    if (choice) return choice;
    const direct = target.closest?.(FIELD_SELECTOR);
    if (editableField(direct)) return direct;
    const label = target.closest?.('label');
    const labelled = label && (document.getElementById(label.getAttribute('for')) || label.querySelector('input,textarea'));
    if (editableField(labelled)) return labelled;
    // Calendar icons can be siblings of the input inside one SAP control.
    const wrapper = target.closest?.('[ct]');
    const fields = [...(wrapper?.querySelectorAll('input,textarea') || [])].filter(editableField);
    return fields.length === 1 ? fields[0] : null;
  }
  function currentControl(choice) {
    if (choice.element.isConnected) return choice.element;
    // Web Dynpro replaces DOM nodes/WD ids after a server roundtrip.
    const root = lookupRoot(choice.target);
    if (!root) return null;
    if (choice.target.sapField) {
      const matches = [...root.querySelectorAll('[ct]')].filter(element => describe(element).sapField === choice.target.sapField);
      return matches.length === 1 ? matches[0] : null;
    }
    for (const selector of choice.target.selectors) {
      const matches = root.querySelectorAll(selector);
      if (matches.length === 1 && matches[0].localName === choice.target.tag) return matches[0];
    }
    return null;
  }
  function sampleControls() {
    const sent = [];
    if (!recordingId) return sent;
    for (const choice of observedControls.values()) {
      const element = currentControl(choice);
      if (!element || sensitive(element) || pending.has(element)) continue;
      const value = valueOf(element);
      // A click is intent; only record the resulting, observed state.
      if (value === undefined || JSON.stringify(value) === JSON.stringify(choice.last)) continue;
      choice.last = value;
      sent.push(capture('change', element, choice.direct ? 'direct-change' : 'context-change'));
    }
    return sent;
  }
  function observeControl(element, direct = true) {
    if (sensitive(element)) return;
    const target = describe(element), value = valueOf(element);
    if (value === undefined) return;
    const key = target.sapField || element;
    const previous = observedControls.get(key);
    if (previous) { clearTimeout(previous.timer); clearTimeout(previous.expiry); }
    const choice = { element, target, direct:direct || !!previous?.direct,last:previous ? previous.last : value };
    observedControls.set(key, choice);
    choice.timer = setTimeout(sampleControls, 0);
    choice.expiry = setTimeout(() => {
      sampleControls(); observedControls.delete(key);
      if (!observedControls.size) { controlObserver?.disconnect(); controlObserver = null; }
    }, 30000);
    if (!controlObserver) {
      controlObserver = new window.MutationObserver(() => {sampleControls();refreshContext();});
      for (const root of roots) controlObserver.observe(root === document ? document.documentElement : root,observerOptions);
    }
  }
  const observerOptions = {subtree:true,childList:true,characterData:true,attributes:true,
    attributeFilter:['aria-checked','value','aria-valuetext','aria-valuenow','aria-selected']};
  function observeContext(event, metadataOnly = false) {
    rememberRoots(event);
    const target = eventTarget(event);
    const root = target.getRootNode?.() || document;
    const scope = metadataOnly ? root : target.closest?.('form,dialog,[role="dialog"],fieldset,[role="group"]') || root;
    const direct=controlTarget(target);
    const fields = [...new Set([direct,...scope.querySelectorAll(FIELD_SELECTOR)].filter(Boolean))]
      .filter(element=>visible(element) && !sensitive(element)).slice(0,150);
    const fresh = [];
    for (const field of fields) {
      const description = describe(field);
      if (/^(?:WD|__|[a-f\d]{12,})/i.test(description.id)) description.id='';
      const signature = location.href.split(/[?#]/)[0] + JSON.stringify(description);
      if (!metadataSeen.has(signature) && metadataSeen.size < 600) { metadataSeen.add(signature);fresh.push(description); }
      if (!metadataOnly && (editableField(field) || choiceTarget(field) === field) && observedControls.size < 150) observeControl(field,false);
    }
    if (!metadataOnly) {
      const path=event.composedPath();lastContext={target,composedPath:()=>path};
      clearTimeout(contextExpiry);
      contextExpiry=setTimeout(()=>{lastContext=null;if(!observedControls.size){controlObserver?.disconnect();controlObserver=null;}},30000);
      if (!controlObserver) {
        controlObserver=new window.MutationObserver(()=>{sampleControls();refreshContext();});
        for (const root of roots) controlObserver.observe(root===document ? document.documentElement : root,observerOptions);
      }
      refreshContext();
    }
    if (fresh.length) chrome.runtime.sendMessage({type:'capture:context',recordingId,
      context:{fields:fresh,page:{url:location.href,title:document.title}}}).catch(()=>{});
  }
  function refreshContext() {
    if (!lastContext || contextTimer !== null) return;
    contextTimer=setTimeout(()=>{
      contextTimer=null;
      if (!recordingId || !lastContext) return;
      const snapshot=lastContext;
      observeContext({target:snapshot.target.isConnected ? snapshot.target : document.body,
        composedPath:()=>snapshot.target.isConnected ? snapshot.composedPath() : [document.body]},true);
    },0);
  }
  function clickable(event) {
    const target = eventTarget(event);
    if (!target?.closest || !visible(target) || ['html','body'].includes(target.localName)) return null;
    const semantic = target.closest('button,a,input,textarea,select,summary,label,[onclick],[tabindex],[role="button"],[role="link"],[role="option"],[role="tab"],[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"],[role="treeitem"],[role="gridcell"],[role="checkbox"],[role="radio"],[role="switch"],[contenteditable="true"],[contenteditable="plaintext-only"],[ct="B"]');
    const element = semantic || target.closest('svg')?.parentElement || target;
    const related = element.localName === 'label' && document.getElementById(element.getAttribute('for'));
    return sensitive(element) || related && sensitive(related) ? null : element;
  }
  function flush() {
    const sent = sampleControls();
    for (const [element, timer] of pending) { clearTimeout(timer); sent.push(capture('input', element)); }
    pending.clear();
    return Promise.all(sent);
  }
  document.addEventListener('input', event => {
    if (!recordingId || !event.isTrusted || ownUI(event) || sensitive(eventTarget(event))) return;
    const element = eventTarget(event);
    clearTimeout(pending.get(element));
    pending.set(element, setTimeout(() => { pending.delete(element); capture('input', element); }, 250));
  }, true);
  document.addEventListener('change', event => {
    if (!recordingId || !event.isTrusted || ownUI(event)) return;
    const element = eventTarget(event);
    clearTimeout(pending.get(element)); pending.delete(element);
    capture('change', element);
  }, true);
  // Arm before SAP's mouse/key handlers. Calendar popups may change a focused
  // field's value property without emitting input/change or changing attributes.
  const prepareInteraction = event => {
    if (!recordingId || !event.isTrusted || ownUI(event)) return;
    observeContext(event);
    const element = controlTarget(eventTarget(event)) || (editableField(document.activeElement) ? document.activeElement : null);
    if (element) observeControl(element);
    else if (observedControls.size) setTimeout(sampleControls, 0);
  };
  window.addEventListener('pointerdown', prepareInteraction, true);
  document.addEventListener('focusin', prepareInteraction, true);
  window.addEventListener('keydown', event => {
    if ([' ', 'Enter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'F4'].includes(event.key)) prepareInteraction(event);
  }, true);
  const click = event => {
    if (!recordingId || !event.isTrusted || ownUI(event) || event.type === 'auxclick' && event.button !== 1) return;
    const element = clickable(event);
    if (!element) return;
    flush();observeContext(event);
    const control = controlTarget(eventTarget(event));
    if (control) observeControl(control);
    if (observedControls.size) setTimeout(sampleControls,0);
    capture(event.type,element,'interaction',{button:event.button});
  };
  for (const type of ['click','dblclick','contextmenu','auxclick']) document.addEventListener(type,click,true);
  document.addEventListener('submit', event => {
    if (recordingId && event.isTrusted) { flush(); capture('submit', event.submitter || event.target); }
  }, true);
  window.addEventListener('pagehide', flush);
  window.addEventListener('popstate', () => {
    if (recordingId) send({ action: 'navigation', page: { url: location.href, title: document.title } });
  });
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message.type === 'capture:permission-needed' && window === window.top) { permissionNotice(message.recordingId); respond({ok:true}); }
    if (message.type === 'capture:permission-clear') document.getElementById(NOTICE_ID)?.remove();
    if (message.type === 'capture:flush') { flush().then(() => respond({ ok: true })); return true; }
    if (message.type === 'capture:state') {
      setRecording(message.recordingId);
      respond({ ok: true });
    }
  });
  chrome.runtime.sendMessage({ type: 'capture:status' }).then(response => {
    setRecording(response?.value?.recordingId);
  }).catch(() => {});
})();
