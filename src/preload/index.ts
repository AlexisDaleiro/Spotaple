import { contextBridge, ipcRenderer } from 'electron';
import { createBridge } from '../shared/bridge';
import type { SpotapleBridge } from '../shared/api';

const bridge = createBridge(
  (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  (channel, cb) => {
    ipcRenderer.removeAllListeners(channel);
    ipcRenderer.on(channel, (_event, value) => cb(value));
    return Promise.resolve({ ok: true, data: undefined });
  },
  process.platform as SpotapleBridge['platform'],
);

contextBridge.exposeInMainWorld('spotapleBridge', bridge);
