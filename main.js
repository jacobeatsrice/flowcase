const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { parseDocx, exportCombinedSelection } = require("./docx-service");
const {
  addLibraryRecord,
  libraryDocumentPath,
  readLibraryManifest,
  removeLibraryRecord
} = require("./library-service");

let mainWindow;
const loadedDocuments = new Map();

function libraryDirectory() {
  return path.join(app.getPath("userData"), "document-library");
}

function publicSource(document) {
  return {
    id: document.sourceId,
    name: document.displayName,
    persistent: document.persistent,
    addedAt: document.addedAt || null,
    headings: document.headings
  };
}

async function registerSource(filePath, options = {}) {
  const source = await fs.readFile(filePath);
  const parsed = await parseDocx(source, filePath);
  parsed.sourceId = options.id || `session-${crypto.randomUUID()}`;
  parsed.displayName = options.name || path.basename(filePath);
  parsed.persistent = Boolean(options.persistent);
  parsed.addedAt = options.addedAt || null;
  loadedDocuments.set(parsed.sourceId, parsed);
  return parsed;
}

async function loadPermanentSources() {
  const manifest = await readLibraryManifest(libraryDirectory());
  const sources = [];
  const unavailable = [];

  for (const record of manifest.documents) {
    try {
      const parsed = await registerSource(
        libraryDocumentPath(libraryDirectory(), record),
        {
          id: record.id,
          name: record.name,
          persistent: true,
          addedAt: record.addedAt
        }
      );
      sources.push(publicSource(parsed));
    } catch (error) {
      unavailable.push({
        id: record.id,
        name: record.name,
        error: error instanceof Error ? error.message : "This file could not be read."
      });
    }
  }

  return { sources, unavailable };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 920,
    minHeight: 620,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#f4f1eb",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadFile("index.html");
  mainWindow.once("ready-to-show", () => mainWindow.show());
}

ipcMain.handle("app:initialize", async () => {
  try {
    const library = await loadPermanentSources();
    return { library };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "The permanent document library could not be loaded."
    };
  }
});

ipcMain.handle("document:open", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Open debate documents",
    buttonLabel: "Open in Flowcase",
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "Word documents", extensions: ["docx"] }]
  });

  if (result.canceled || result.filePaths.length === 0) return { canceled: true };

  const sources = [];
  const failures = [];
  for (const filePath of result.filePaths) {
    try {
      sources.push(publicSource(await registerSource(filePath)));
    } catch (error) {
      failures.push({
        name: path.basename(filePath),
        error:
          error instanceof Error ? error.message : "The document could not be opened."
      });
    }
  }
  return { canceled: false, sources, failures };
});

ipcMain.handle("document:openPaths", async (_event, filePaths) => {
  if (!Array.isArray(filePaths) || filePaths.length === 0) {
    return { error: "Drop one or more Word documents." };
  }
  const sources = [];
  const failures = [];
  for (const filePath of filePaths) {
    if (
      typeof filePath !== "string" ||
      path.extname(filePath).toLowerCase() !== ".docx"
    ) {
      failures.push({
        name: typeof filePath === "string" ? path.basename(filePath) : "File",
        error: "Only .docx files can be opened."
      });
      continue;
    }
    try {
      sources.push(publicSource(await registerSource(filePath)));
    } catch (error) {
      failures.push({
        name: path.basename(filePath),
        error:
          error instanceof Error ? error.message : "The document could not be opened."
      });
    }
  }
  return { sources, failures };
});

ipcMain.handle("library:add", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Add permanent Word documents",
    buttonLabel: "Add to Flowcase",
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "Word documents", extensions: ["docx"] }]
  });

  if (result.canceled || result.filePaths.length === 0) return { canceled: true };

  const added = [];
  const failures = [];
  for (const filePath of result.filePaths) {
    try {
      const id = `library-${crypto.randomUUID()}`;
      const addedAt = new Date().toISOString();
      const parsed = await parseDocx(await fs.readFile(filePath), filePath);
      const record = {
        id,
        name: path.basename(filePath),
        fileName: `${id}.docx`,
        addedAt,
        headingCount: parsed.headings.length
      };
      await addLibraryRecord(libraryDirectory(), record, filePath);
      parsed.sourcePath = libraryDocumentPath(libraryDirectory(), record);
      parsed.sourceId = id;
      parsed.displayName = record.name;
      parsed.persistent = true;
      parsed.addedAt = addedAt;
      loadedDocuments.set(id, parsed);
      added.push(publicSource(parsed));
    } catch (error) {
      failures.push({
        name: path.basename(filePath),
        error: error instanceof Error ? error.message : "This document could not be added."
      });
    }
  }

  return { canceled: false, added, failures };
});

ipcMain.handle("library:remove", async (_event, sourceId) => {
  const document = loadedDocuments.get(sourceId);
  if (!document?.persistent) return { error: "That permanent document is unavailable." };

  const confirmation = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    title: "Remove permanent document?",
    message: `Remove “${document.displayName}” from Flowcase?`,
    detail: "Flowcase’s saved copy will be removed. Your original Word file will not be changed.",
    buttons: ["Cancel", "Remove"],
    defaultId: 0,
    cancelId: 0
  });
  if (confirmation.response !== 1) return { canceled: true };

  try {
    await removeLibraryRecord(libraryDirectory(), sourceId);
    loadedDocuments.delete(sourceId);
    return { canceled: false, removedId: sourceId };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "The document could not be removed."
    };
  }
});

ipcMain.handle("document:export", async (_event, { selections }) => {
  if (!Array.isArray(selections) || selections.length === 0) {
    return { error: "Add at least one heading to the outline first." };
  }

  const firstSourceSelection = selections.find(
    (selection) => selection.kind !== "manual" && selection.sourceId
  );
  const firstDocument = firstSourceSelection
    ? loadedDocuments.get(firstSourceSelection.sourceId)
    : null;

  const defaultName = firstDocument
    ? `${path.parse(firstDocument.displayName).name} — speech.docx`
    : "Untitled speech.docx";
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Export debate document",
    defaultPath: path.join(app.getPath("documents"), defaultName),
    filters: [{ name: "Word document", extensions: ["docx"] }]
  });

  if (result.canceled || !result.filePath) return { canceled: true };

  try {
    const finalPath = result.filePath.toLowerCase().endsWith(".docx")
      ? result.filePath
      : `${result.filePath}.docx`;
    const output = await exportCombinedSelection(loadedDocuments, selections, {
      title: path.parse(finalPath).name
    });
    await fs.writeFile(finalPath, output);
    return { canceled: false, path: finalPath };
  } catch (error) {
    return {
      canceled: false,
      error: error instanceof Error ? error.message : "The document could not be exported."
    };
  }
});

ipcMain.handle("document:reveal", async (_event, filePath) => {
  if (filePath) shell.showItemInFolder(filePath);
});

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
