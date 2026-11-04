import test from 'node:test';
import assert from 'node:assert/strict';
import { folderReady, normalizeFolderPath, scriptsPath } from '../extension/core/script-setup.js';
import { agentPrompt } from '../extension/recorder/model.js';

test('confirmed paths support spaces and Windows separators and reject relative or mismatched locations', () => {
  assert.equal(normalizeFolderPath('/Users/example/My Macros/', 'My Macros'), '/Users/example/My Macros');
  assert.equal(normalizeFolderPath('C:\\Users\\example\\Macros', 'Macros'), 'C:/Users/example/Macros');
  for (const value of ['~/Macros', 'Macros', '/Users/example/../Macros', '/Users/example/Macros\nrun-this', '/Users/example/Other']) {
    assert.throws(() => normalizeFolderPath(value, 'Macros'));
  }
  assert.equal(folderReady({ connected: true, readable: true, folderName: 'Macros', folderPath: '/Users/example/Macros' }), true);
  assert.equal(scriptsPath('/Users/example/Repository', ['local', 'scripts']), '/Users/example/Repository/local/scripts');
  assert.throws(() => scriptsPath('/Users/example/Repository', ['..']));
});

test('generation instructions specify the destination and bounded checks while retaining manual submission', () => {
  const prompt = agentPrompt({ name: 'Test', steps: [] }, {
    standalone: true, scriptsPath: '/Users/example/My Macros', variables: 'date'
  });
  assert.match(prompt, /현재 연결된 개인 매크로 저장 폴더.*\/Users\/example\/My Macros/);
  assert.match(prompt, /이 폴더 바로 아래에 <id>\/script.json과 <id>\/script.js/);
  assert.match(prompt, /브라우저 진단·조작·실제 실행은 사용자가 명시적으로 요청한 경우에만/);
  assert.match(prompt, /통과한 검사를 이유 없이 반복하지 마/);
  assert.match(prompt, /실제 최종 제출·최종 결재상신은 자동 실행하지 마/);
  assert.doesNotMatch(prompt, /npm run verify|내가 연 작업 폴더 안에/);
});
