'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  load: () => ipcRenderer.invoke('data:load'),
  save: (data) => ipcRenderer.invoke('data:save', data),
  saveSync: (data) => ipcRenderer.sendSync('data:save-sync', data),
  onDataChanged: (cb) => ipcRenderer.on('data:changed', (_e, data) => cb(data)),
  exportData: (data) => ipcRenderer.invoke('data:export', data),
  importData: () => ipcRenderer.invoke('data:import'),
  dataPath: () => ipcRenderer.invoke('app:data-path'),
  phoneStatus: (fresh) => ipcRenderer.invoke('phone:status', fresh),
  phoneSet: (enabled) => ipcRenderer.invoke('phone:set', enabled),
  phoneNewKey: () => ipcRenderer.invoke('phone:new-key'),
  openWifiSettings: () => ipcRenderer.invoke('phone:wifi-settings'),
});
