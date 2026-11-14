const paths = { edit: 'm16 4 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L5 15 4 20Z', save: 'm5 12 4 4L19 6', cancel: 'm6 6 12 12M18 6 6 18' };
function control(action, label) {
  const button = document.createElement('button'); button.type = 'button';
  button.className = 'icon-button name-' + action; button.title = label; button.setAttribute('aria-label', label);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', paths[action]); svg.append(path); button.append(svg);
  return button;
}
export function scriptName(script, rename) {
  const row = document.createElement('div'); row.className = 'script-name';
  const title = document.createElement('strong'); title.textContent = script.name; row.append(title);
  if (!rename) return row;
  const edit = control('edit', script.name + ' 이름 수정'); row.append(edit);
  edit.addEventListener('click', () => {
    if (row.dataset.editing === 'true') return;
    row.dataset.editing = 'true'; title.hidden = edit.hidden = true;
    const editor = document.createElement('div'); editor.className = 'name-editor';
    const input = document.createElement('input'); input.value = title.textContent; input.maxLength = 100;
    input.setAttribute('aria-label', '매크로 이름'); input.autocomplete = 'off';
    const save = control('save', '이름 저장'), cancel = control('cancel', '수정 취소');
    const feedback = document.createElement('p'); feedback.className = 'name-error'; feedback.setAttribute('role', 'status');
    const finish = () => { editor.remove(); feedback.remove(); row.dataset.editing = 'false'; title.hidden = edit.hidden = false; edit.focus(); };
    let saving = false;
    const submit = async () => {
      if (saving) return;
      const name = input.value.trim();
      if (!name || name.length > 100) { feedback.textContent = '이름을 1–100자로 입력하세요.'; input.focus(); return; }
      if (name === title.textContent) { finish(); return; }
      saving = true; save.disabled = cancel.disabled = input.disabled = true; editor.setAttribute('aria-busy', 'true'); feedback.textContent = '';
      try {
        await rename(name); title.textContent = name;
        edit.title = name + ' 이름 수정'; edit.setAttribute('aria-label', edit.title); finish();
      } catch (error) { feedback.textContent = error.message || '저장하지 못했습니다. 다시 시도하세요.'; }
      finally { saving = false; save.disabled = cancel.disabled = input.disabled = false; editor.setAttribute('aria-busy', 'false'); }
    };
    save.addEventListener('click', submit); cancel.addEventListener('click', () => { if (!saving) finish(); });
    input.addEventListener('keydown', event => {
      if (event.isComposing) return;
      if (event.key === 'Enter') { event.preventDefault(); submit(); }
      if (event.key === 'Escape' && !saving) { event.preventDefault(); finish(); }
    });
    editor.append(input, save, cancel); row.append(editor, feedback); input.focus(); input.select?.();
  });
  return row;
}
