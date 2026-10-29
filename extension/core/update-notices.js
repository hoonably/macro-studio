export const UPDATE_PREFERENCES_KEY = 'macroStudioUpdatePreferences';
export const AVAILABLE_UPDATE_KEY = 'macroStudioAvailableUpdate';

export const notificationsEnabled = value => value?.notify !== false;
export const availableVersion = value => typeof value?.version === 'string' && /^\d+(?:\.\d+){0,3}$/.test(value.version) ? value.version : '';

export function updateMessage(state, storeBuild) {
  if (storeBuild) {
    if (state?.status === 'update_available') return `새 버전 ${state.version || ''}을 Chrome이 준비했습니다. 작업을 마친 뒤 확장 화면을 닫아 적용을 기다리세요.`;
    if (state?.status === 'no_update') return '현재 설치할 수 있는 새 버전이 없습니다.';
    if (state?.status === 'throttled') return 'Chrome이 업데이트 확인 빈도를 제한하고 있습니다. 잠시 후 다시 확인해 주세요.';
    return 'Chrome이 확장 프로그램을 자동으로 업데이트합니다.';
  }
  if (state?.unavailable) return '완료된 로컬 빌드를 확인할 수 없습니다. 빌드가 끝난 뒤 다시 확인해 주세요.';
  if (state?.applying) return '업데이트를 적용하는 중입니다. 기록과 작성 중인 내용은 유지됩니다.';
  if (state?.pending) return '새 빌드가 있습니다. 진행 중인 기록이나 작업이 끝나면 적용합니다.';
  return '현재 로드한 빌드와 로컬 파일이 같습니다.';
}
