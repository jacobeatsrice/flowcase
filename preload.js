const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("flowcase", {
  initialize: () => ipcRenderer.invoke("app:initialize"),
  openDocument: () => ipcRenderer.invoke("document:open"),
  openDroppedDocuments: (files) =>
    ipcRenderer.invoke(
      "document:openPaths",
      files.map((file) => webUtils.getPathForFile(file))
    ),
  addPermanentDocuments: () => ipcRenderer.invoke("library:add"),
  removePermanentDocument: (sourceId) =>
    ipcRenderer.invoke("library:remove", sourceId),
  exportDocument: (selections) =>
    ipcRenderer.invoke("document:export", { selections }),
  revealFile: (filePath) => ipcRenderer.invoke("document:reveal", filePath),
  platform: process.platform
});
