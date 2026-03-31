// Preload script - Securely expose IPC to renderer
const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Basic Info
  getCertificatePath: () => ipcRenderer.invoke('get-certificate-path'),
  certificatesExist: () => ipcRenderer.invoke('certificates-exist'),
  // SECURITY: readCertificate removed - never expose private keys to renderer
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
  getFlags: () => ipcRenderer.invoke('get-flags'),

  // API Client
  apiInitialize: () => ipcRenderer.invoke('api:initialize'),
  apiCheckConnectivity: () => ipcRenderer.invoke('api:check-connectivity'),
  apiRegisterDevice: () => ipcRenderer.invoke('api:register-device'),
  apiGetConfig: () => ipcRenderer.invoke('api:get-config'),
  apiGenerateContent: (photoDataUrl, metadata) => ipcRenderer.invoke('api:generate-content', photoDataUrl, metadata),
  apiGeneratePoem: (photoDataUrl, metadata) => ipcRenderer.invoke('api:generate-poem', photoDataUrl, metadata), // DEPRECATED
  apiUploadImage: (imageBuffer, sessionId) => ipcRenderer.invoke('api:upload-image', imageBuffer, sessionId),
  apiLogPrint: (sessionId) => ipcRenderer.invoke('api:log-print', sessionId),

  // Rendering Service
  renderPoemImage: (photoDataUrl, poem, branding, options) => ipcRenderer.invoke('render:poem-image', photoDataUrl, poem, branding, options),

  // WiFi Service
  wifiConnect: (wifiConfig) => ipcRenderer.invoke('wifi:connect', wifiConfig),
  wifiGetCurrent: () => ipcRenderer.invoke('wifi:get-current'),

  // Printer Service
  printerPrint: (imageBuffer, options) => ipcRenderer.invoke('printer:print', imageBuffer, options),
  printerGetStatus: () => ipcRenderer.invoke('printer:get-status'),
  onPrinterStatusChange: (callback) => ipcRenderer.on('printer:statusChange', (event, status) => callback(status)),

  // Hardware Events (listen to events from main process)
  onButtonPress: (callback) => ipcRenderer.on('hardware:buttonPress', callback),
  onButtonRelease: (callback) => ipcRenderer.on('hardware:buttonRelease', (event, data) => callback(data)),
  onLongPress: (callback) => ipcRenderer.on('hardware:longPress', callback),
  onKnobRotate: (callback) => ipcRenderer.on('hardware:knobRotate', (event, data) => callback(data)),

  // Send keyboard events to main process for hardware simulation
  sendKeyEvent: (type, code, key) => ipcRenderer.send('hardware:keyEvent', { type, code, key }),

  // Misc
  storeDeviceConfig: (config) => ipcRenderer.invoke('store-device-config', config),
  getDeviceConfig: () => ipcRenderer.invoke('get-device-config'),
  getKioskConfig: () => ipcRenderer.invoke('get-kiosk-config'),
  quitApp: () => ipcRenderer.invoke('quit-app')
});

console.log('[PRELOAD] Electron API exposed to renderer');
