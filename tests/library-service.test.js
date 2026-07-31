const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  addLibraryRecord,
  libraryDocumentPath,
  readLibraryManifest,
  removeLibraryRecord
} = require("../library-service");

test("permanent document records survive reload and removal preserves the original", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "flowcase-library-"));
  const libraryDirectory = path.join(root, "library");
  const originalPath = path.join(root, "theory.docx");
  await fs.writeFile(originalPath, "fixture");
  const record = {
    id: "library-test",
    name: "theory.docx",
    fileName: "library-test.docx",
    addedAt: "2026-07-29T00:00:00.000Z",
    headingCount: 12
  };

  await addLibraryRecord(libraryDirectory, record, originalPath);
  const reloaded = await readLibraryManifest(libraryDirectory);
  assert.deepEqual(reloaded.documents, [record]);
  assert.equal(
    await fs.readFile(libraryDocumentPath(libraryDirectory, record), "utf8"),
    "fixture"
  );

  await removeLibraryRecord(libraryDirectory, record.id);
  assert.equal((await readLibraryManifest(libraryDirectory)).documents.length, 0);
  assert.equal(await fs.readFile(originalPath, "utf8"), "fixture");
});
