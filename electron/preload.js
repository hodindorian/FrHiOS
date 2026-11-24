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
  // Home Assistant local, configuré automatiquement (electron/ha-local.js).
  // Chaque fonction renvoie { ok, result } ou { ok: false, error }.
  ha: {
    status: () => ipcRenderer.invoke('ha:status'),
    onStatus: (cb) => { ipcRenderer.on('ha:status', (_e, st) => cb(st)); },
    overview: () => ipcRenderer.invoke('ha:overview'),
    startFlow: (handler) => ipcRenderer.invoke('ha:flow-start', handler),
    flowStep: (flowId, data) => ipcRenderer.invoke('ha:flow-step', flowId, data),
    getFlow: (flowId) => ipcRenderer.invoke('ha:flow-get', flowId),
    abortFlow: (flowId) => ipcRenderer.invoke('ha:flow-abort', flowId),
    deleteEntry: (entryId) => ipcRenderer.invoke('ha:entry-delete', entryId),
    translations: (domains) => ipcRenderer.invoke('ha:translations', domains),
    matterCommission: (opts) => ipcRenderer.invoke('ha:matter-commission', opts),
  },
  net: {
    // Wake-on-LAN : réveille un appareil en veille (la télé) par son adresse MAC
    wake: (mac) => ipcRenderer.invoke('net:wake', mac),
  },
  update: {
    status: () => ipcRenderer.invoke('update:status'),
    check: () => ipcRenderer.invoke('update:check'),
    apply: () => ipcRenderer.invoke('update:apply'),
    onProgress: (cb) => { ipcRenderer.on('update:progress', (_e, text) => cb(text)); },
    onState: (cb) => { ipcRenderer.on('update:state', (_e, st) => cb(st)); },
  },
  app: {
    // L'interface annonce qu'elle a bien démarré (sinon frhios-app revient à la version précédente)
    ready: () => ipcRenderer.send('app:ready'),
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
