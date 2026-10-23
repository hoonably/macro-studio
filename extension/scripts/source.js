// This function is serialized into a user-script context. Keep all its dependencies inside it.
export function captureDefinitions(spec, load) {
  const registry = window.__macroStudioLocalRegistry ||= new Map();
  const describe = item => [...item.definitions.values()].map(definition => ({
    id: definition.id, name: String(definition.name || spec.id).slice(0, 100), description: String(definition.description || '').slice(0, 300),
    note: String(definition.note || '').slice(0, 2000), actionLabel: String(definition.actionLabel || '실행').slice(0, 80),
    fields: (definition.fields || []).slice(0, 30).map(field => ({ name: String(field.name), label: String(field.label || field.name), type: String(field.type || 'text'),
      required: !!field.required, value: String((typeof field.value === 'function' ? field.value() : field.value) ?? '') })),
    summary: (definition.summary || []).slice(0, 50).map(row => row.map(value => String(value))),
    local: { key: spec.key, revision: spec.revision, world: spec.world, id: spec.id }
  }));
  const existing = registry.get(spec.key);
  if (existing?.revision === spec.revision) return describe(existing);
  const base = window.MacroStudio ||= { features: {}, config: {} };
  const definitions = new Map();
  const features = Object.create(base.features || {});
  for (const [name, value] of Object.entries(base.features || {})) if (value && typeof value === 'object') features[name] = Object.create(value);
  const scoped = { ...base, features, config: Object.create(base.config || {}), launcher: { create: () => ({ register(definition) {
    if (definition?.id !== spec.id || typeof definition.run !== 'function') throw new Error('등록 id가 script.json과 다릅니다: ' + spec.id);
    definitions.set(definition.id, definition);
  } }) } };
  window.MacroStudio = scoped;
  try {
    load();
    const entry = { revision: spec.revision, definitions, scoped };
    const result = describe(entry); // Reject malformed UI definitions before replacing the working revision.
    registry.set(spec.key, entry);
    return result;
  } finally { window.MacroStudio = base; }
}
export function compileSource(spec, sources) {
  return '(' + captureDefinitions.toString() + ')(' + JSON.stringify(spec) + ',function(){\n' + sources.join('\n;\n') + '\n});';
}
export async function invokeDefinition({ key, revision, id, values, requestId }) {
  const entry = window.__macroStudioLocalRegistry?.get(key), definition = entry?.definitions.get(id);
  if (!definition || entry.revision !== revision) throw new Error('스크립트가 변경됐습니다. 목록에서 다시 선택하세요.');
  const report = message => document.getElementById('macro-studio-launcher')?.dispatchEvent(new CustomEvent('macro-studio:script-progress', {
    detail: JSON.stringify({ requestId, message: String(message).slice(0, 2000) })
  }));
  return String(await definition.run(values, report) || '완료했습니다.');
}
