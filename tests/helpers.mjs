import { parseHTML } from 'linkedom';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
export const root = new URL('../', import.meta.url);
export const code = file => fs.readFile(new URL(file, root), 'utf8');
export const tick = () => new Promise(resolve => setTimeout(resolve, 0));
export function context(html = '<html><body></body></html>', globals = {}) {
  const { window, document } = parseHTML(html);
  window.top = window;
  window.innerWidth = 1200; window.innerHeight = 900;
  const saved = new Map();
  window.localStorage = { getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value) };
  window.HTMLElement.prototype.getClientRects = function () { return this.hidden || this.style?.display === 'none' ? [] : [{ width: 100, height: 40 }]; };
  window.HTMLElement.prototype.getBoundingClientRect = function () { return { x: 0, y: 0, width: 100, height: 40 }; };
  window.HTMLElement.prototype.focus = function () {};
  window.HTMLFormElement.prototype.reportValidity = () => true;
  const ctx = vm.createContext({
    window, document, console: { log() {}, table() {}, warn() {} }, crypto: webcrypto,
    setTimeout, clearTimeout, setInterval, clearInterval, Event: window.Event, MouseEvent: window.Event,
    getComputedStyle: () => ({ visibility: 'visible' }),
    CSS: { escape: value => value.replace(/[^a-zA-Z0-9_-]/g, char => '\\' + char) },
    location: { href: 'https://example.test/form?private=value', origin: 'https://example.test' }, ...globals
  });
  return { window, document, ctx, saved };
}
export async function load(ctx, ...files) { for (const file of files) vm.runInContext(await code(file), ctx, { filename: file }); }
export function trusted(window, target, type) {
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'isTrusted', { value: true });
  target.dispatchEvent(event);
}
