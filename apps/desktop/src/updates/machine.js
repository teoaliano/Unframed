function initialState(currentVersion, { notAppliedVersion = null } = {}) {
  return {
    status: 'disabled',
    currentVersion,
    availableVersion: null,
    downloadedVersion: null,
    percent: null,
    message: null,
    notAppliedVersion,
  };
}

function reduce(state, event) {
  if (state.status === 'installing' && event.type !== 'install-failed') return state;
  switch (event.type) {
    case 'enabled':
      return { ...state, status: 'idle' };
    case 'check-started':
      return { ...state, status: state.downloadedVersion ? 'downloaded' : 'checking', message: null };
    case 'check-failed':
      return state.downloadedVersion
        ? { ...state, status: 'downloaded' }
        : { ...state, status: 'error', message: event.message, percent: null };
    case 'not-available':
      return state.downloadedVersion
        ? { ...state, status: 'downloaded' }
        : { ...state, status: 'idle', availableVersion: null, percent: null, message: null };
    case 'available':
      if (state.downloadedVersion === event.version) return { ...state, status: 'downloaded' };
      if (state.status === 'downloading' && state.availableVersion === event.version) return state;
      return {
        ...state,
        status: 'available',
        availableVersion: event.version,
        downloadedVersion: null,
        percent: null,
        message: null,
      };
    case 'download-started':
      return { ...state, status: 'downloading', percent: 0, message: null };
    case 'progress':
      return { ...state, status: 'downloading', percent: Math.round(event.percent) };
    case 'downloaded':
      return {
        ...state,
        status: 'downloaded',
        availableVersion: event.version,
        downloadedVersion: event.version,
        percent: 100,
        message: null,
      };
    case 'download-failed':
      return {
        ...state,
        status: state.availableVersion ? 'available' : 'error',
        percent: null,
        message: event.message,
      };
    case 'install-started':
      return { ...state, status: 'installing', message: null, notAppliedVersion: null };
    case 'install-failed':
      return { ...state, status: 'downloaded', message: event.message };
    default:
      return state;
  }
}

function notAppliedVersion(record, appVersion) {
  if (!record || typeof record.fromVersion !== 'string' || typeof record.targetVersion !== 'string') return null;
  return record.fromVersion === appVersion && record.targetVersion !== appVersion ? record.targetVersion : null;
}

module.exports = { initialState, reduce, notAppliedVersion };
