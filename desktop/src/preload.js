/**
 * TokenView 预加载脚本（沙箱模式，仅暴露只读设置通道）
 * 渲染进程通过 window.tokenview 读写"关闭时最小化到托盘"与"开机自启"开关
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tokenview', {
  getCloseToTray: () => ipcRenderer.invoke('tokenview:get-close-to-tray'),
  setCloseToTray: (v) => ipcRenderer.invoke('tokenview:set-close-to-tray', !!v),
  /** 开机自启（自启时带 --hidden 静默驻留托盘）；浏览器版无此能力 */
  getAutoLaunch: () => ipcRenderer.invoke('tokenview:get-auto-launch'),
  setAutoLaunch: (v) => ipcRenderer.invoke('tokenview:set-auto-launch', !!v),
  /** 选择文件夹（取消返回空串）；浏览器版无此能力 */
  pickFolder: () => ipcRenderer.invoke('tokenview:pick-folder')
});
