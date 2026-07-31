const state = {
  sources: [],
  activeSourceId: null,
  selected: [],
  selectedItemKey: null,
  expanded: new Set(),
  depth: 1,
  search: "",
  draggedKey: null,
  shortcut: loadShortcut(),
  recordingShortcut: false,
  exporting: false,
  editorItemKey: null,
  editorDraftLevel: 1
};

const levelNames = {
  1: "Pocket",
  2: "Hat",
  3: "Block",
  4: "Tag"
};

const levelColors = {
  1: { item: "#194d3c", badge: "#194d3c", bg: "#e2eee8" },
  2: { item: "#4f7969", badge: "#376454", bg: "#e9f1ed" },
  3: { item: "#d07b45", badge: "#a95a2c", bg: "#fae9de" },
  4: { item: "#b7a175", badge: "#77633d", bg: "#f1ecdf" }
};

const els = {
  openButton: document.querySelector("#openButton"),
  emptyOpenButton: document.querySelector("#emptyOpenButton"),
  exportButton: document.querySelector("#exportButton"),
  exportLabel: document.querySelector("#exportLabel"),
  footerExportButton: document.querySelector("#footerExportButton"),
  documentState: document.querySelector("#documentState"),
  documentName: document.querySelector("#documentName"),
  headingCount: document.querySelector("#headingCount"),
  searchInput: document.querySelector("#searchInput"),
  searchKey: document.querySelector("#searchKey"),
  tree: document.querySelector("#tree"),
  treeScroller: document.querySelector("#treeScroller"),
  emptySource: document.querySelector("#emptySource"),
  noResults: document.querySelector("#noResults"),
  levelLegend: document.querySelector("#levelLegend"),
  sourceTabs: document.querySelector("#sourceTabs"),
  selectedCount: document.querySelector("#selectedCount"),
  footerCount: document.querySelector("#footerCount"),
  outlineHelp: document.querySelector("#outlineHelp"),
  outlineEditBar: document.querySelector("#outlineEditBar"),
  editSelectedButton: document.querySelector("#editSelectedButton"),
  emptyOutline: document.querySelector("#emptyOutline"),
  outlineList: document.querySelector("#outlineList"),
  newHeadingButton: document.querySelector("#newHeadingButton"),
  shortcutHint: document.querySelector("#shortcutHint"),
  shortcutButton: document.querySelector("#shortcutButton"),
  shortcutModal: document.querySelector("#shortcutModal"),
  shortcutRecorder: document.querySelector("#shortcutRecorder"),
  shortcutDisplay: document.querySelector("#shortcutDisplay"),
  shortcutRecorderNote: document.querySelector("#shortcutRecorderNote"),
  shortcutReset: document.querySelector("#shortcutReset"),
  shortcutDone: document.querySelector("#shortcutDone"),
  modalClose: document.querySelector("#modalClose"),
  libraryButton: document.querySelector("#libraryButton"),
  emptyLibraryButton: document.querySelector("#emptyLibraryButton"),
  libraryCount: document.querySelector("#libraryCount"),
  libraryModal: document.querySelector("#libraryModal"),
  libraryClose: document.querySelector("#libraryClose"),
  libraryAddButton: document.querySelector("#libraryAddButton"),
  librarySectionCount: document.querySelector("#librarySectionCount"),
  libraryList: document.querySelector("#libraryList"),
  libraryEmpty: document.querySelector("#libraryEmpty"),
  sessionSection: document.querySelector("#sessionSection"),
  sessionList: document.querySelector("#sessionList"),
  headingEditorModal: document.querySelector("#headingEditorModal"),
  headingEditorClose: document.querySelector("#headingEditorClose"),
  headingEditorCancel: document.querySelector("#headingEditorCancel"),
  headingEditorSave: document.querySelector("#headingEditorSave"),
  headingEditorTitle: document.querySelector("#headingEditorTitle"),
  headingNameInput: document.querySelector("#headingNameInput"),
  dropOverlay: document.querySelector("#dropOverlay"),
  toastRegion: document.querySelector("#toastRegion")
};

function loadShortcut() {
  try {
    const saved = JSON.parse(localStorage.getItem("flowcase.exportShortcut"));
    if (saved?.key && Array.isArray(saved.modifiers)) return saved;
  } catch {
    // Ignore malformed preference data.
  }
  return { key: "e", modifiers: ["meta", "shift"] };
}

function saveShortcut() {
  localStorage.setItem("flowcase.exportShortcut", JSON.stringify(state.shortcut));
}

function shortcutGlyph(shortcut) {
  const symbols = { meta: "⌘", ctrl: "⌃", alt: "⌥", shift: "⇧" };
  const modifierOrder = ["meta", "ctrl", "alt", "shift"];
  const prefix = modifierOrder
    .filter((modifier) => shortcut.modifiers.includes(modifier))
    .map((modifier) => symbols[modifier])
    .join("");
  const key = shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key;
  return `${prefix}${key}`;
}

function updateShortcutUI() {
  const glyph = shortcutGlyph(state.shortcut);
  els.shortcutHint.textContent = glyph;
  els.shortcutDisplay.textContent = glyph;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function headingKey(sourceId, headingId) {
  return `${sourceId}::${headingId}`;
}

function getSource(sourceId) {
  return state.sources.find((source) => source.id === sourceId) || null;
}

function activeSource() {
  return getSource(state.activeSourceId);
}

function getHeading(sourceId, headingId) {
  return (
    getSource(sourceId)?.headings.find((heading) => heading.id === headingId) || null
  );
}

function getOutlineItem(key) {
  return state.selected.find((item) => item.key === key) || null;
}

function outlineItemDetails(item) {
  if (item.kind === "manual") {
    return {
      text: item.text,
      level: item.level,
      sourceName: "Manual header",
      path: levelNames[item.level]
    };
  }
  const source = getSource(item.sourceId);
  const heading = getHeading(item.sourceId, item.headingId);
  if (!source || !heading) return null;
  const level = item.levelOverride || heading.level;
  return {
    text: item.textOverride || heading.text,
    level,
    sourceName: source.name,
    path: ancestorPath(source, heading).join(" › ") || levelNames[level]
  };
}

function ancestorPath(source, heading, includeSelf = false) {
  const path = includeSelf ? [heading.text] : [];
  let cursor = heading;
  while (cursor?.parentId) {
    cursor = source.headings.find((candidate) => candidate.id === cursor.parentId);
    if (cursor) path.unshift(cursor.text);
  }
  return path;
}

function matchesSearch(source, heading) {
  if (!state.search) return true;
  const searchable = [...ancestorPath(source, heading), heading.text]
    .join(" ")
    .toLowerCase();
  return searchable.includes(state.search);
}

function isVisibleInTree(source, heading) {
  if (state.search) return matchesSearch(source, heading);
  let cursor = heading;
  while (cursor?.parentId) {
    const parent = source.headings.find(
      (candidate) => candidate.id === cursor.parentId
    );
    if (!parent || !state.expanded.has(parent.id)) return false;
    cursor = parent;
  }
  return true;
}

function renderTree() {
  const source = activeSource();
  if (!source) {
    els.emptySource.hidden = false;
    els.tree.hidden = true;
    els.noResults.hidden = true;
    els.tree.innerHTML = "";
    return;
  }

  const visible = source.headings.filter((heading) =>
    isVisibleInTree(source, heading)
  );
  els.emptySource.hidden = true;
  els.tree.hidden = visible.length === 0;
  els.noResults.hidden = visible.length > 0;

  const selectedKeys = new Set(state.selected.map((item) => item.key));
  els.tree.innerHTML = visible
    .map((heading) => {
      const key = headingKey(source.id, heading.id);
      const isCollapsed = !state.expanded.has(heading.id);
      const path = state.search ? ancestorPath(source, heading).join(" › ") : "";
      const toggle =
        heading.hasChildren && !state.search
          ? `<button class="tree-toggle ${isCollapsed ? "collapsed" : ""}" data-toggle="${heading.id}" aria-label="${isCollapsed ? "Expand" : "Collapse"} ${escapeHtml(heading.text)}">
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"></path></svg>
            </button>`
          : `<span class="tree-toggle placeholder"></span>`;

      return `
        <div class="tree-row ${selectedKeys.has(key) ? "added" : ""}" style="--level:${heading.level}" data-id="${heading.id}" data-level="${heading.level}" role="button" tabindex="0" aria-label="Add ${escapeHtml(heading.text)}">
          ${toggle}
          <div class="tree-label">
            <strong>${escapeHtml(heading.text)}</strong>
            ${path ? `<span class="tree-path">${escapeHtml(path)}</span>` : ""}
          </div>
          <span class="add-indicator" aria-hidden="true">${selectedKeys.has(key) ? "✓" : "+"}</span>
        </div>
      `;
    })
    .join("");
}

function renderSourceTabs() {
  els.sourceTabs.hidden = state.sources.length === 0;
  els.sourceTabs.innerHTML = state.sources
    .map(
      (source) => `
        <button class="source-tab ${source.id === state.activeSourceId ? "active" : ""}" data-source-tab="${source.id}" title="${escapeHtml(source.name)}">
          ${
            source.persistent
              ? '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3.5h4.5a2 2 0 0 1 2 2V13a2 2 0 0 0-2-2H3zM13 3.5H8.5a2 2 0 0 0-2 2V13a2 2 0 0 1 2-2H13z"></path></svg>'
              : '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5h5l3 3v8H4zM9 2.5v3h3"></path></svg>'
          }
          <span>${escapeHtml(source.name)}</span>
        </button>
      `
    )
    .join("");
}

function renderSourceState() {
  const source = activeSource();
  renderSourceTabs();
  if (!source) {
    els.documentName.textContent = "No source document";
    els.documentState.classList.remove("loaded");
    els.headingCount.textContent = "0 headings";
    els.searchInput.disabled = true;
    els.searchInput.value = "";
    state.search = "";
  } else {
    els.documentName.textContent = source.name;
    els.documentState.classList.add("loaded");
    els.headingCount.textContent = `${source.headings.length} ${
      source.headings.length === 1 ? "heading" : "headings"
    }`;
    els.searchInput.disabled = false;
  }
  renderTree();
}

function renderOutline() {
  state.selected = state.selected.filter(
    (item) =>
      item.kind === "manual" ||
      getHeading(item.sourceId, item.headingId) !== null
  );
  if (
    state.selectedItemKey &&
    !state.selected.some((item) => item.key === state.selectedItemKey)
  ) {
    state.selectedItemKey = null;
  }
  const hasItems = state.selected.length > 0;
  const selectedItem = getOutlineItem(state.selectedItemKey);
  els.emptyOutline.hidden = hasItems;
  els.outlineList.hidden = !hasItems;
  els.outlineEditBar.hidden = !selectedItem;
  els.exportButton.disabled = !hasItems || state.exporting;
  els.footerExportButton.disabled = !hasItems || state.exporting;
  els.selectedCount.textContent = state.selected.length;
  els.footerCount.textContent = `${state.selected.length} ${
    state.selected.length === 1 ? "item" : "items"
  }`;
  els.outlineHelp.textContent = hasItems
    ? "Click a header to select it. Drag the handle to reorder."
    : "Add a source section or create a header with F4–F7.";

  const selectedDetails = selectedItem
    ? outlineItemDetails(selectedItem)
    : null;
  document.querySelectorAll("[data-quick-level]").forEach((button) => {
    button.classList.toggle(
      "active",
      Number(button.dataset.quickLevel) === selectedDetails?.level
    );
  });

  els.outlineList.innerHTML = state.selected
    .map((item, index) => {
      const details = outlineItemDetails(item);
      if (!details) return "";
      const colors = levelColors[details.level];
      return `
        <li
          class="outline-item ${item.key === state.selectedItemKey ? "selected" : ""}"
          draggable="true"
          data-key="${item.key}"
          style="--item-color:${colors.item};--badge-color:${colors.badge};--badge-bg:${colors.bg}"
        >
          <span class="drag-handle" title="Drag to reorder">
            <svg viewBox="0 0 12 18" aria-hidden="true">
              <circle cx="3" cy="3" r="1.2"></circle><circle cx="9" cy="3" r="1.2"></circle>
              <circle cx="3" cy="9" r="1.2"></circle><circle cx="9" cy="9" r="1.2"></circle>
              <circle cx="3" cy="15" r="1.2"></circle><circle cx="9" cy="15" r="1.2"></circle>
            </svg>
          </span>
          <span class="level-badge" title="${levelNames[details.level]}">${details.level}</span>
          <div class="outline-copy">
            <strong>${escapeHtml(details.text)}</strong>
            <span>${escapeHtml(details.sourceName)} · ${escapeHtml(details.path)} · Position ${index + 1}</span>
          </div>
          <button class="edit-item-button" data-edit="${item.key}" aria-label="Edit ${escapeHtml(details.text)}">
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4 16 3.2-.7L15 7.5 12.5 5 4.7 12.8zM11.8 5.7l2.5 2.5"></path></svg>
          </button>
          <button class="remove-button" data-remove="${item.key}" aria-label="Remove ${escapeHtml(details.text)}">×</button>
        </li>
      `;
    })
    .join("");

  renderTree();
}

function renderLibrary() {
  const permanent = state.sources.filter((source) => source.persistent);
  const session = state.sources.filter((source) => !source.persistent);
  els.libraryCount.textContent = permanent.length;
  els.librarySectionCount.textContent = permanent.length;
  els.libraryEmpty.hidden = permanent.length > 0;
  els.libraryList.hidden = permanent.length === 0;
  els.libraryList.innerHTML = permanent.map(libraryItemMarkup).join("");
  els.sessionSection.hidden = session.length === 0;
  els.sessionList.innerHTML = session.map(libraryItemMarkup).join("");
}

function libraryItemMarkup(source) {
  return `
    <div class="library-item ${source.id === state.activeSourceId ? "active" : ""}">
      <span class="library-file-icon">
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M5 2.5h6l4 4v11H5zM11 2.5v4h4M7.5 10h5M7.5 13h5"></path>
        </svg>
      </span>
      <div class="library-file-copy">
        <strong>${escapeHtml(source.name)}</strong>
        <span>${source.headings.length} headings · ${source.persistent ? "Saved permanently" : "Available until Flowcase closes"}</span>
      </div>
      <div class="library-item-actions">
        <button class="library-use" data-use-source="${source.id}">
          ${source.id === state.activeSourceId ? "Active" : "Use"}
        </button>
        ${
          source.persistent
            ? `<button class="library-remove" data-remove-source="${source.id}" aria-label="Remove ${escapeHtml(source.name)}">×</button>`
            : ""
        }
      </div>
    </div>
  `;
}

function applyDepth(depth) {
  state.depth = depth;
  state.expanded.clear();
  for (const heading of activeSource()?.headings || []) {
    if (heading.level < depth && heading.hasChildren) {
      state.expanded.add(heading.id);
    }
  }
  document.querySelectorAll("[data-depth]").forEach((button) => {
    button.classList.toggle(
      "active",
      Number(button.dataset.depth) === depth
    );
  });
  els.levelLegend.textContent = ["POCKETS", "HATS", "BLOCKS", "TAGS"]
    .slice(0, depth)
    .join(" · ");
  renderTree();
}

function setActiveSource(sourceId) {
  if (!getSource(sourceId)) return;
  state.activeSourceId = sourceId;
  state.search = "";
  els.searchInput.value = "";
  applyDepth(1);
  renderSourceState();
  renderLibrary();
}

function registerSources(sources, activateLast = true) {
  for (const source of sources || []) {
    const existingIndex = state.sources.findIndex(
      (candidate) => candidate.id === source.id
    );
    if (existingIndex >= 0) state.sources[existingIndex] = source;
    else state.sources.push(source);
  }
  if (activateLast && sources?.length) {
    setActiveSource(sources[sources.length - 1].id);
  } else {
    renderSourceState();
    renderLibrary();
  }
}

function addHeading(headingId) {
  const source = activeSource();
  if (!source) return;
  const key = headingKey(source.id, headingId);
  if (state.selected.some((item) => item.key === key)) {
    toast(
      "Already in your outline",
      getHeading(source.id, headingId)?.text || "That heading is already selected."
    );
    return;
  }
  state.selected.push({
    key,
    kind: "source",
    sourceId: source.id,
    headingId,
    textOverride: null,
    levelOverride: null
  });
  state.selectedItemKey = key;
  renderOutline();
}

function removeHeading(key) {
  state.selected = state.selected.filter((item) => item.key !== key);
  if (state.selectedItemKey === key) state.selectedItemKey = null;
  renderOutline();
}

function createManualHeading(level, text = `New ${levelNames[level].toLowerCase()}`) {
  const key = `manual-${globalThis.crypto?.randomUUID?.() || Date.now()}`;
  state.selected.push({
    key,
    kind: "manual",
    text,
    level
  });
  state.selectedItemKey = key;
  renderOutline();
  return key;
}

function selectOutlineItem(key) {
  state.selectedItemKey = key;
  renderOutline();
}

function restyleOutlineItem(key, level) {
  const item = getOutlineItem(key);
  if (!item || !levelNames[level]) return;
  if (item.kind === "manual") item.level = level;
  else item.levelOverride = level;
  renderOutline();
}

function setEditorLevel(level) {
  state.editorDraftLevel = level;
  document.querySelectorAll("[data-editor-level]").forEach((button) => {
    button.classList.toggle(
      "active",
      Number(button.dataset.editorLevel) === level
    );
  });
}

function showHeadingEditor(key = null) {
  const item = key ? getOutlineItem(key) : null;
  state.editorItemKey = item?.key || null;
  const details = item ? outlineItemDetails(item) : null;
  els.headingEditorTitle.textContent = item ? "Edit header" : "Create header";
  els.headingEditorSave.textContent = item ? "Save changes" : "Add header";
  els.headingNameInput.value = details?.text || "New pocket";
  setEditorLevel(details?.level || 1);
  els.headingEditorModal.hidden = false;
  window.setTimeout(() => {
    els.headingNameInput.focus();
    els.headingNameInput.select();
  }, 0);
}

function hideHeadingEditor() {
  els.headingEditorModal.hidden = true;
  state.editorItemKey = null;
}

function saveHeadingEditor() {
  const text = els.headingNameInput.value.trim();
  if (!text) {
    toast("Header text is required", "Enter a name for this header.", true);
    els.headingNameInput.focus();
    return;
  }
  const item = getOutlineItem(state.editorItemKey);
  if (item) {
    if (item.kind === "manual") {
      item.text = text;
      item.level = state.editorDraftLevel;
    } else {
      const original = getHeading(item.sourceId, item.headingId);
      item.textOverride = text === original?.text ? null : text;
      item.levelOverride =
        state.editorDraftLevel === original?.level
          ? null
          : state.editorDraftLevel;
    }
    state.selectedItemKey = item.key;
  } else {
    createManualHeading(state.editorDraftLevel, text);
  }
  hideHeadingEditor();
  renderOutline();
}

async function chooseDocument() {
  const result = await window.flowcase.openDocument();
  loadSourcesResult(result);
}

function loadSourcesResult(result) {
  if (result?.canceled) return;
  if (result?.error) {
    toast("Couldn’t open that document", result.error, true);
    return;
  }
  const sources = result?.sources || (result?.source ? [result.source] : []);
  if (sources.length) {
    registerSources(sources, true);
    const headingCount = sources.reduce(
      (total, source) => total + source.headings.length,
      0
    );
    toast(
      sources.length === 1 ? "Document ready" : `${sources.length} documents opened`,
      `Found ${headingCount} headings.`
    );
  }
  for (const failure of result?.failures || []) {
    toast(`Couldn’t open ${failure.name}`, failure.error, true);
  }
}

async function addPermanentDocuments() {
  els.libraryAddButton.disabled = true;
  const result = await window.flowcase.addPermanentDocuments();
  els.libraryAddButton.disabled = false;
  if (result?.canceled) return;
  if (result?.error) {
    toast("Couldn’t update the library", result.error, true);
    return;
  }
  if (result.added?.length) {
    registerSources(result.added, true);
    toast(
      "Permanent library updated",
      `${result.added.length} ${result.added.length === 1 ? "document is" : "documents are"} now saved in Flowcase.`
    );
  }
  for (const failure of result.failures || []) {
    toast(`Couldn’t add ${failure.name}`, failure.error, true);
  }
}

async function removePermanentDocument(sourceId) {
  const result = await window.flowcase.removePermanentDocument(sourceId);
  if (result?.canceled) return;
  if (result?.error) {
    toast("Couldn’t remove that document", result.error, true);
    return;
  }
  state.sources = state.sources.filter(
    (source) => source.id !== result.removedId
  );
  state.selected = state.selected.filter(
    (item) => item.sourceId !== result.removedId
  );
  if (state.activeSourceId === result.removedId) {
    state.activeSourceId = state.sources[0]?.id || null;
    state.search = "";
    els.searchInput.value = "";
    applyDepth(1);
  }
  renderSourceState();
  renderOutline();
  renderLibrary();
  toast("Permanent document removed", "Your original Word file was not changed.");
}

async function exportDocument() {
  if (!state.selected.length || state.exporting) {
    if (!state.selected.length) {
      toast("Nothing to export", "Add at least one heading first.", true);
    }
    return;
  }

  state.exporting = true;
  els.exportLabel.textContent = "Exporting…";
  renderOutline();
  const selections = state.selected.map((item) =>
    item.kind === "manual"
      ? {
          kind: "manual",
          text: item.text,
          level: item.level
        }
      : {
          kind: "source",
          sourceId: item.sourceId,
          headingId: item.headingId,
          textOverride: item.textOverride,
          levelOverride: item.levelOverride
        }
  );
  const result = await window.flowcase.exportDocument(selections);
  state.exporting = false;
  els.exportLabel.textContent = "Export Word doc";
  renderOutline();

  if (result?.canceled) return;
  if (result?.error) {
    toast("Export failed", result.error, true);
    return;
  }
  toast("Word document exported", result.path);
}

function toast(title, message, isError = false) {
  const node = document.createElement("div");
  node.className = `toast${isError ? " error" : ""}`;
  node.innerHTML = `
    <div class="toast-content">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(message)}</span>
    </div>
  `;
  els.toastRegion.append(node);
  window.setTimeout(() => node.remove(), 4200);
}

function eventToShortcut(event) {
  const modifiers = [];
  if (event.ctrlKey) modifiers.push("ctrl");
  if (event.altKey) modifiers.push("alt");
  if (event.shiftKey) modifiers.push("shift");
  if (event.metaKey) modifiers.push("meta");
  if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) return null;
  if (
    !modifiers.some((modifier) => ["meta", "ctrl", "alt"].includes(modifier))
  ) {
    return null;
  }
  return { key: event.key.toLowerCase(), modifiers };
}

function shortcutMatches(event, shortcut) {
  return (
    event.key.toLowerCase() === shortcut.key.toLowerCase() &&
    event.metaKey === shortcut.modifiers.includes("meta") &&
    event.ctrlKey === shortcut.modifiers.includes("ctrl") &&
    event.altKey === shortcut.modifiers.includes("alt") &&
    event.shiftKey === shortcut.modifiers.includes("shift")
  );
}

function showShortcutModal() {
  state.recordingShortcut = false;
  els.shortcutRecorder.classList.remove("recording");
  els.shortcutRecorderNote.textContent = "Click to record";
  updateShortcutUI();
  els.shortcutModal.hidden = false;
}

function hideShortcutModal() {
  state.recordingShortcut = false;
  els.shortcutModal.hidden = true;
}

function showLibraryModal() {
  renderLibrary();
  els.libraryModal.hidden = false;
}

function hideLibraryModal() {
  els.libraryModal.hidden = true;
}

els.openButton.addEventListener("click", chooseDocument);
els.emptyOpenButton.addEventListener("click", chooseDocument);
els.exportButton.addEventListener("click", exportDocument);
els.footerExportButton.addEventListener("click", exportDocument);
els.libraryButton.addEventListener("click", showLibraryModal);
els.emptyLibraryButton.addEventListener("click", showLibraryModal);
els.libraryClose.addEventListener("click", hideLibraryModal);
els.libraryAddButton.addEventListener("click", addPermanentDocuments);
els.newHeadingButton.addEventListener("click", () => showHeadingEditor());
els.editSelectedButton.addEventListener("click", () => {
  if (state.selectedItemKey) showHeadingEditor(state.selectedItemKey);
});
document.querySelectorAll("[data-quick-level]").forEach((button) => {
  button.addEventListener("click", () => {
    if (state.selectedItemKey) {
      restyleOutlineItem(
        state.selectedItemKey,
        Number(button.dataset.quickLevel)
      );
    }
  });
});

els.searchInput.addEventListener("input", (event) => {
  state.search = event.target.value.trim().toLowerCase();
  renderTree();
});

document.querySelectorAll("[data-depth]").forEach((button) => {
  button.addEventListener("click", () =>
    applyDepth(Number(button.dataset.depth))
  );
});

els.sourceTabs.addEventListener("click", (event) => {
  const tab = event.target.closest("[data-source-tab]");
  if (tab) setActiveSource(tab.dataset.sourceTab);
});

els.tree.addEventListener("click", (event) => {
  const toggle = event.target.closest("[data-toggle]");
  if (toggle) {
    event.stopPropagation();
    const id = toggle.dataset.toggle;
    if (state.expanded.has(id)) state.expanded.delete(id);
    else state.expanded.add(id);
    renderTree();
    return;
  }
  const row = event.target.closest("[data-id]");
  if (row) addHeading(row.dataset.id);
});

els.tree.addEventListener("keydown", (event) => {
  if (
    (event.key === "Enter" || event.key === " ") &&
    event.target.matches(".tree-row")
  ) {
    event.preventDefault();
    addHeading(event.target.dataset.id);
  }
});

els.outlineList.addEventListener("click", (event) => {
  const remove = event.target.closest("[data-remove]");
  if (remove) {
    removeHeading(remove.dataset.remove);
    return;
  }
  const edit = event.target.closest("[data-edit]");
  if (edit) {
    selectOutlineItem(edit.dataset.edit);
    showHeadingEditor(edit.dataset.edit);
    return;
  }
  const item = event.target.closest(".outline-item");
  if (item) selectOutlineItem(item.dataset.key);
});

els.outlineList.addEventListener("dblclick", (event) => {
  if (event.target.closest("button")) return;
  const item = event.target.closest(".outline-item");
  if (item) showHeadingEditor(item.dataset.key);
});

els.outlineList.addEventListener("dragstart", (event) => {
  const item = event.target.closest(".outline-item");
  if (!item) return;
  state.draggedKey = item.dataset.key;
  item.classList.add("dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", item.dataset.key);
});

els.outlineList.addEventListener("dragend", () => {
  state.draggedKey = null;
  els.outlineList.querySelectorAll(".outline-item").forEach((item) => {
    item.classList.remove("dragging", "drag-over");
  });
});

els.outlineList.addEventListener("dragover", (event) => {
  const item = event.target.closest(".outline-item");
  if (!item || item.dataset.key === state.draggedKey) return;
  event.preventDefault();
  els.outlineList.querySelectorAll(".outline-item").forEach((candidate) => {
    candidate.classList.toggle("drag-over", candidate === item);
  });
});

els.outlineList.addEventListener("drop", (event) => {
  const target = event.target.closest(".outline-item");
  if (!target || !state.draggedKey || target.dataset.key === state.draggedKey) {
    return;
  }
  event.preventDefault();
  const fromIndex = state.selected.findIndex(
    (item) => item.key === state.draggedKey
  );
  const [moved] = state.selected.splice(fromIndex, 1);
  const targetIndex = state.selected.findIndex(
    (item) => item.key === target.dataset.key
  );
  const bounds = target.getBoundingClientRect();
  const insertAfter = event.clientY > bounds.top + bounds.height / 2;
  state.selected.splice(targetIndex + (insertAfter ? 1 : 0), 0, moved);
  state.draggedKey = null;
  renderOutline();
});

els.libraryList.addEventListener("click", handleLibraryListClick);
els.sessionList.addEventListener("click", handleLibraryListClick);

function handleLibraryListClick(event) {
  const use = event.target.closest("[data-use-source]");
  if (use) {
    setActiveSource(use.dataset.useSource);
    hideLibraryModal();
    return;
  }
  const remove = event.target.closest("[data-remove-source]");
  if (remove) removePermanentDocument(remove.dataset.removeSource);
}

els.shortcutButton.addEventListener("click", showShortcutModal);
els.modalClose.addEventListener("click", hideShortcutModal);
els.shortcutDone.addEventListener("click", hideShortcutModal);
els.shortcutModal.addEventListener("click", (event) => {
  if (event.target === els.shortcutModal) hideShortcutModal();
});
els.libraryModal.addEventListener("click", (event) => {
  if (event.target === els.libraryModal) hideLibraryModal();
});
els.headingEditorModal.addEventListener("click", (event) => {
  if (event.target === els.headingEditorModal) hideHeadingEditor();
});
els.headingEditorClose.addEventListener("click", hideHeadingEditor);
els.headingEditorCancel.addEventListener("click", hideHeadingEditor);
els.headingEditorSave.addEventListener("click", saveHeadingEditor);
document.querySelectorAll("[data-editor-level]").forEach((button) => {
  button.addEventListener("click", () =>
    setEditorLevel(Number(button.dataset.editorLevel))
  );
});
els.headingNameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    saveHeadingEditor();
  }
});

els.shortcutRecorder.addEventListener("click", () => {
  state.recordingShortcut = true;
  els.shortcutRecorder.classList.add("recording");
  els.shortcutRecorderNote.textContent = "Press your new shortcut…";
});

els.shortcutReset.addEventListener("click", () => {
  state.shortcut = { key: "e", modifiers: ["meta", "shift"] };
  saveShortcut();
  updateShortcutUI();
  state.recordingShortcut = false;
  els.shortcutRecorder.classList.remove("recording");
  els.shortcutRecorderNote.textContent = "Default restored";
});

document.addEventListener("keydown", (event) => {
  if (state.recordingShortcut) {
    event.preventDefault();
    event.stopPropagation();
    const shortcut = eventToShortcut(event);
    if (!shortcut) {
      els.shortcutRecorderNote.textContent = "Include ⌘, ⌃, or ⌥";
      return;
    }
    state.shortcut = shortcut;
    saveShortcut();
    updateShortcutUI();
    state.recordingShortcut = false;
    els.shortcutRecorder.classList.remove("recording");
    els.shortcutRecorderNote.textContent = "Saved";
    return;
  }

  const functionLevels = { F4: 1, F5: 2, F6: 3, F7: 4 };
  if (
    functionLevels[event.key] &&
    els.shortcutModal.hidden &&
    els.libraryModal.hidden
  ) {
    event.preventDefault();
    const level = functionLevels[event.key];
    if (!els.headingEditorModal.hidden) {
      setEditorLevel(level);
    } else if (state.selectedItemKey) {
      restyleOutlineItem(state.selectedItemKey, level);
    } else {
      createManualHeading(level);
    }
    return;
  }

  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    if (!els.searchInput.disabled) els.searchInput.focus();
    return;
  }

  if (shortcutMatches(event, state.shortcut)) {
    event.preventDefault();
    exportDocument();
  }

  if (event.key === "Escape") {
    if (!els.shortcutModal.hidden) hideShortcutModal();
    if (!els.libraryModal.hidden) hideLibraryModal();
    if (!els.headingEditorModal.hidden) hideHeadingEditor();
  }
});

let dragCounter = 0;
window.addEventListener("dragenter", (event) => {
  if (
    !Array.from(event.dataTransfer?.items || []).some(
      (item) => item.kind === "file"
    )
  ) {
    return;
  }
  dragCounter += 1;
  els.dropOverlay.hidden = false;
});

window.addEventListener("dragleave", () => {
  dragCounter = Math.max(0, dragCounter - 1);
  if (dragCounter === 0) els.dropOverlay.hidden = true;
});

window.addEventListener("dragover", (event) => event.preventDefault());
window.addEventListener("drop", async (event) => {
  event.preventDefault();
  dragCounter = 0;
  els.dropOverlay.hidden = true;
  const files = Array.from(event.dataTransfer?.files || []).filter((file) =>
    file.name.toLowerCase().endsWith(".docx")
  );
  if (files.length === 0) {
    toast("That isn’t a Word document", "Drop a file ending in .docx.", true);
    return;
  }
  const result = await window.flowcase.openDroppedDocuments(files);
  loadSourcesResult(result);
});

async function initializeApp() {
  updateShortcutUI();
  applyDepth(1);
  renderSourceState();
  renderOutline();
  renderLibrary();

  if (!window.flowcase) {
    if (new URLSearchParams(window.location.search).get("demo") === "1") {
      const demoSources = [
        {
          id: "library-theory",
          name: "Theory Core.docx",
          persistent: true,
          addedAt: "2026-07-29T00:00:00.000Z",
          headings: [
            {
              id: "p1",
              text: "Theory",
              level: 1,
              parentId: null,
              hasChildren: true
            },
            {
              id: "h1",
              text: "Conditionality Bad",
              level: 2,
              parentId: "p1",
              hasChildren: true
            },
            {
              id: "b1",
              text: "2AC — Condo Is a Voting Issue",
              level: 3,
              parentId: "h1",
              hasChildren: true
            },
            {
              id: "t1",
              text: "Interpretation — one conditional advocacy",
              level: 4,
              parentId: "b1",
              hasChildren: false
            },
            {
              id: "t2",
              text: "Time skew makes conditionality unfair",
              level: 4,
              parentId: "b1",
              hasChildren: false
            },
            {
              id: "p1b",
              text: "Topicality",
              level: 1,
              parentId: null,
              hasChildren: true
            },
            {
              id: "h1b",
              text: "T — Substantial",
              level: 2,
              parentId: "p1b",
              hasChildren: false
            }
          ]
        },
        {
          id: "session-case",
          name: "2026 Aff Case.docx",
          persistent: false,
          addedAt: null,
          headings: [
            {
              id: "p2",
              text: "1AC",
              level: 1,
              parentId: null,
              hasChildren: true
            },
            {
              id: "h2",
              text: "Advantage 1 — Climate",
              level: 2,
              parentId: "p2",
              hasChildren: true
            },
            {
              id: "b2",
              text: "Warming causes extinction",
              level: 3,
              parentId: "h2",
              hasChildren: false
            }
          ]
        }
      ];
      registerSources(demoSources, false);
      setActiveSource(demoSources[0].id);
    }
    return;
  }
  const result = await window.flowcase.initialize();
  if (result?.error) {
    toast("Library unavailable", result.error, true);
    return;
  }
  const sources = result?.library?.sources || [];
  registerSources(sources, false);
  if (sources.length) setActiveSource(sources[0].id);
  for (const unavailable of result?.library?.unavailable || []) {
    toast(`Couldn’t restore ${unavailable.name}`, unavailable.error, true);
  }
}

initializeApp();
