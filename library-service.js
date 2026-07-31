const fs = require("node:fs/promises");
const path = require("node:path");

const MANIFEST_NAME = "library.json";

function emptyManifest() {
  return { version: 1, documents: [] };
}

async function ensureLibraryDirectory(libraryDirectory) {
  await fs.mkdir(libraryDirectory, { recursive: true });
}

async function readLibraryManifest(libraryDirectory) {
  await ensureLibraryDirectory(libraryDirectory);
  try {
    const raw = await fs.readFile(path.join(libraryDirectory, MANIFEST_NAME), "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.documents)) return emptyManifest();
    return {
      version: 1,
      documents: parsed.documents.filter(
        (document) =>
          typeof document?.id === "string" &&
          typeof document?.name === "string" &&
          typeof document?.fileName === "string"
      )
    };
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return emptyManifest();
    throw error;
  }
}

async function writeLibraryManifest(libraryDirectory, manifest) {
  await ensureLibraryDirectory(libraryDirectory);
  const manifestPath = path.join(libraryDirectory, MANIFEST_NAME);
  const temporaryPath = path.join(libraryDirectory, `${MANIFEST_NAME}.tmp`);
  await fs.writeFile(temporaryPath, JSON.stringify(manifest, null, 2), "utf8");
  await fs.rename(temporaryPath, manifestPath);
}

function libraryDocumentPath(libraryDirectory, record) {
  return path.join(libraryDirectory, record.fileName);
}

async function addLibraryRecord(libraryDirectory, record, sourcePath) {
  const manifest = await readLibraryManifest(libraryDirectory);
  await fs.copyFile(sourcePath, libraryDocumentPath(libraryDirectory, record));
  manifest.documents.push(record);
  await writeLibraryManifest(libraryDirectory, manifest);
  return manifest;
}

async function removeLibraryRecord(libraryDirectory, id) {
  const manifest = await readLibraryManifest(libraryDirectory);
  const record = manifest.documents.find((document) => document.id === id);
  if (!record) return { manifest, record: null };

  const nextManifest = {
    ...manifest,
    documents: manifest.documents.filter((document) => document.id !== id)
  };
  await writeLibraryManifest(libraryDirectory, nextManifest);
  try {
    await fs.unlink(libraryDocumentPath(libraryDirectory, record));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return { manifest: nextManifest, record };
}

module.exports = {
  addLibraryRecord,
  emptyManifest,
  libraryDocumentPath,
  readLibraryManifest,
  removeLibraryRecord,
  writeLibraryManifest
};
