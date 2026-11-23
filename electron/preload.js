'use strict';
// Pont minimal et explicite entre l'interface et le processus principal.
// L'interface ne reçoit que ces fonctions, jamais ipcRenderer ni Node.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('frhios', {
  music: {
    show: (service, rect) => ipcRenderer.send('music:show', service, rect),
    setBounds: (rect) => ipcRenderer.send('music:bounds', rect),
    hide: () => ipcRenderer.send('music:hide'),
    action: (service, action) => ipcRenderer.send('music:action', service, action),
  },
  osk: {
    // key : { type: 'text', value } | { type: 'key', value: 'Backspace'|'Enter' } | { type: 'blur' }
    send: (key) => ipcRenderer.send('osk:key', key),
    // cb({ editable, touch }) quand un champ de texte prend/perd le focus dans le site affiché
    onFocus: (cb) => { ipcRenderer.on('osk:focus', (_event, payload) => cb(payload)); },
  },
  system: {
    // 'poweroff' | 'reboot' — le processus principal refuse hors mode kiosque
    power: (action) => ipcRenderer.invoke('system:power', action),
  },
  terminal: {
    start: (cols, rows) => ipcRenderer.invoke('term:start', cols, rows),
    input: (data) => ipcRenderer.send('term:input', data),
    resize: (cols, rows) => ipcRenderer.send('term:resize', cols, rows),
    kill: () => ipcRenderer.send('term:kill'),
    onData: (cb) => { ipcRenderer.on('term:data', (_e, text) => cb(text)); },
    onExit: (cb) => { ipcRenderer.on('term:exit', (_e, result) => cb(result)); },
  },
  clipboard: {
    read: () => ipcRenderer.invoke('clipboard:read'),
  },
  wifi: {
    status: () => ipcRenderer.invoke('wifi:status'),
    scan: () => ipcRenderer.invoke('wifi:scan'),
    connect: (ssid, password) => ipcRenderer.invoke('wifi:connect', ssid, password),
  },
  // Utilisé seulement par la page d'installation de l'ISO (ignoré hors mode --installer)
  installer: {
    disks: () => ipcRenderer.invoke('installer:disks'),
    start: (disk) => ipcRenderer.send('installer:start', disk),
    reboot: () => ipcRenderer.send('installer:reboot'),
    onLog: (cb) => { ipcRenderer.on('installer:log', (_e, line) => cb(line)); },
    onDone: (cb) => { ipcRenderer.on('installer:done', (_e, result) => cb(result)); },
  },
});
