import { STORE_BUILD } from '../core/distribution.js';
import { UPDATE_PREFERENCES_KEY, AVAILABLE_UPDATE_KEY, notificationsEnabled, availableVersion, updateMessage } from '../core/update-notices.js';

const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};
const stylesheet = element('link');
stylesheet.rel = 'stylesheet'; stylesheet.href = 'update.css'; document.head.append(stylesheet);
const version = chrome.runtime.getManifest().version;
let notify = true, checking = false;
const notice = element('p', 'update-notice');
notice.hidden = true; notice.setAttribute('role', 'status');
document.querySelector('header')?.after(notice);
const entry = element('button', 'update-entry', `v${version} · 업데이트`);
entry.type = 'button'; document.querySelector('footer')?.append(entry);

const dialog = element('dialog', 'update-dialog');
dialog.id = 'update-dialog'; dialog.setAttribute('aria-labelledby', 'update-title');
const heading = element('div', 'update-heading');
const title = element('h2', '', '버전 및 업데이트'); title.id = 'update-title';
const close = element('button', 'update-close', '닫기'); close.type = 'button';
heading.append(title, close);
const identity = element('p', 'update-identity', `Macro Studio ${version}`);
const channel = element('span', 'update-channel', STORE_BUILD ? 'Chrome 웹 스토어' : '로컬 빌드');
identity.append(channel);
const description = element('p', 'update-description', STORE_BUILD
  ? '설치와 업데이트는 Chrome에서 관리합니다. 알림 설정은 자동 설치에 영향을 주지 않습니다.'
  : '완료된 로컬 빌드를 감지해 안전할 때 적용합니다. 개인 스크립트 파일은 별도로 자동 동기화됩니다.');
const label = element('label', 'update-preference');
const checkbox = element('input'); checkbox.type = 'checkbox'; checkbox.id = 'update-notifications';
label.append(checkbox, element('span', '', '새 업데이트를 확장 화면에서 알림'));
const status = element('p', 'update-result', STORE_BUILD ? updateMessage(null, true) : '현재 버전을 확인하려면 아래 버튼을 누르세요.');
status.id = 'update-result'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
const actions = element('div', 'update-actions');
const check = element('button', 'update-check', '업데이트 확인'); check.type = 'button';
const releases = element('a', '', '릴리스 보기 ↗');
releases.href = 'https://github.com/hoonably/macro-studio/releases'; releases.target = '_blank'; releases.rel = 'noopener noreferrer';
actions.append(check, releases);
dialog.append(heading, identity, description, label, status, actions); document.body.append(dialog);

async function readPreferences() {
  const values = await chrome.storage.local.get(UPDATE_PREFERENCES_KEY);
  notify = notificationsEnabled(values[UPDATE_PREFERENCES_KEY]); checkbox.checked = notify;
  if (!notify) notice.hidden = true;
}
async function showAvailableUpdate() {
  const values = await chrome.storage.local.get(AVAILABLE_UPDATE_KEY);
  const pendingVersion = availableVersion(values[AVAILABLE_UPDATE_KEY]);
  notice.hidden = !notify || !pendingVersion || pendingVersion === version;
  if (!notice.hidden) notice.textContent = `Macro Studio ${pendingVersion} 업데이트가 준비되었습니다. 작업을 마친 뒤 확장 화면을 닫아 적용을 기다리세요.`;
}
async function checkBuild(manual = false) {
  if (checking || (!manual && document.visibilityState === 'hidden')) return;
  checking = true; check.disabled = true;
  if (manual) { status.dataset.error = 'false'; status.textContent = '업데이트를 확인하는 중…'; }
  try {
    if (STORE_BUILD) {
      // Chrome already checks in the background. Only an explicit button press requests another check.
      if (!manual) { await showAvailableUpdate(); return; }
      const result = await chrome.runtime.requestUpdateCheck();
      status.textContent = updateMessage(result, true);
      if (result?.status === 'update_available') {
        await chrome.storage.local.set({ [AVAILABLE_UPDATE_KEY]: { version: availableVersion(result) } });
      } else if (result?.status === 'no_update') {
        await chrome.storage.local.remove(AVAILABLE_UPDATE_KEY);
      }
      await showAvailableUpdate();
    } else {
      const reply = await chrome.runtime.sendMessage({ type: 'update:check' });
      if (!reply?.ok) throw new Error(reply?.error || '업데이트 상태를 확인하지 못했습니다.');
      const state = reply.value;
      notice.hidden = !notify || (!state?.pending && !state?.applying);
      if (!notice.hidden) notice.textContent = updateMessage(state, false);
      if (manual || dialog.open) { status.textContent = updateMessage(state, false); status.dataset.error = String(!!state?.unavailable); }
    }
  } catch (error) {
    // A local update can replace this extension context. Never report a failed check as up to date.
    if (manual) { status.textContent = error.message || '확인하지 못했습니다. 잠시 후 다시 시도하세요.'; status.dataset.error = 'true'; }
  } finally { checking = false; check.disabled = false; }
}
entry.addEventListener('click', () => {
  if (document.querySelector('#site-toggle')) {
    chrome.tabs.create({ url: chrome.runtime.getURL('ui/scripts.html#updates') }).then(() => window.close()).catch(() => {
      notice.textContent = '업데이트 화면을 열지 못했습니다. 잠시 후 다시 시도하세요.'; notice.hidden = false;
    });
  } else dialog.showModal();
});
close.addEventListener('click', () => dialog.close());
check.addEventListener('click', () => checkBuild(true));
checkbox.addEventListener('change', async () => {
  const previous = notify; checkbox.disabled = true;
  try {
    await chrome.storage.local.set({ [UPDATE_PREFERENCES_KEY]: { notify: checkbox.checked } });
    notify = checkbox.checked;
    if (!notify) notice.hidden = true; else await checkBuild();
  } catch { checkbox.checked = previous; status.textContent = '알림 설정을 저장하지 못했습니다. 다시 시도하세요.'; status.dataset.error = 'true'; }
  finally { checkbox.disabled = false; }
});
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  if (changes[UPDATE_PREFERENCES_KEY]) await readPreferences();
  if (STORE_BUILD && (changes[AVAILABLE_UPDATE_KEY] || changes[UPDATE_PREFERENCES_KEY])) await showAvailableUpdate();
});
document.addEventListener('visibilitychange', () => checkBuild());
if (!STORE_BUILD) setInterval(() => checkBuild(), 2000);
await readPreferences();
await checkBuild();
if (window.location.hash === '#updates') dialog.showModal();
