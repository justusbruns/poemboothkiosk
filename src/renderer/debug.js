import { elements, state } from './state.js';
import { formatCameraResolution } from './ui.js';

export function updateDebugInfo() {
  if (!state.isDev) return;

  const currentStyle = state.availableStyles.length > 0
    ? state.availableStyles[state.currentStyleIndex]
    : null;

  const info = {
    screen: state.screen,
    deviceId: state.deviceConfig?.device_id || 'Not registered',
    equipmentId: state.deviceConfig?.equipment_id || 'N/A',
    hubId: state.deviceConfig?.hub_id || 'N/A',
    online: navigator.onLine,
    camera: formatCameraResolution() +
      (state.cameraMaxResolution ? ` (max ${state.cameraMaxResolution.width}×${state.cameraMaxResolution.height})` : ''),
    processing: state.isProcessing,
    currentStyle: currentStyle ? `${currentStyle.name} (${state.currentStyleIndex + 1}/${state.availableStyles.length})` : 'None'
  };

  elements.debugContent.textContent = JSON.stringify(info, null, 2);
}
