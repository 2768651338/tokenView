/**
 * TokenView 预加载脚本（沙箱模式，仅暴露只读设置通道）
 * 渲染进程通过 window.tokenview 读写"关闭时最小化到托盘"开关
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tokenview', {
  getCloseToTray: () => ipcRenderer.invoke('tokenview:get-close-to-tray'),
  setCloseToTray: (v) => ipcRenderer.invoke('tokenview:set-close-to-tray', !!v)
});
