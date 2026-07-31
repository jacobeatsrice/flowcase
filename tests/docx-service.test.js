const test = require("node:test");
const assert = require("node:assert/strict");
const JSZip = require("jszip");
const {
  parseDocx,
  exportSelection,
  exportCombinedSelection,
  _test
} = require("../docx-service");

const namespaces =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

function paragraph(text, style) {
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
}

async function fixtureDocx() {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>'
  );
  zip.file(
    "word/styles.xml",
    `<?xml version="1.0"?><w:styles ${namespaces}>
      <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>
      <w:style w:type="paragraph" w:styleId="Hat"><w:name w:val="Hat"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style>
      <w:style w:type="paragraph" w:styleId="Block"><w:name w:val="Block"/><w:pPr><w:outlineLvl w:val="2"/></w:pPr></w:style>
      <w:style w:type="paragraph" w:styleId="Tag"><w:name w:val="Tag"/><w:pPr><w:outlineLvl w:val="3"/></w:pPr></w:style>
    </w:styles>`
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:document ${namespaces}><w:body>
      ${paragraph("Pocket A", "Heading1")}
      ${paragraph("Hat A", "Hat")}
      ${paragraph("Block A", "Block")}
      ${paragraph("Tag A", "Tag")}
      <w:p><w:r><w:t>Evidence A</w:t></w:r></w:p>
      ${paragraph("Tag B", "Tag")}
      <w:p><w:r><w:t>Evidence B</w:t></w:r></w:p>
      ${paragraph("Pocket B", "Heading1")}
      <w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>
    </w:body></w:document>`
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

test("recognizes debate and Word heading style names", () => {
  assert.equal(_test.namedHeadingLevel("Heading1"), 1);
  assert.equal(_test.namedHeadingLevel("Heading 4"), 4);
  assert.equal(_test.namedHeadingLevel("Pocket"), 1);
  assert.equal(_test.namedHeadingLevel("Tags"), 4);
  assert.equal(_test.namedHeadingLevel("Verbatim Pocket — 1"), 1);
  assert.equal(_test.namedHeadingLevel("Theory Block Style"), 3);
});

test("parses hierarchy and section boundaries", async () => {
  const source = await fixtureDocx();
  const parsed = await parseDocx(source, "/tmp/case.docx");
  assert.deepEqual(
    parsed.headings.map(({ text, level, parentId }) => ({ text, level, parentId })),
    [
      { text: "Pocket A", level: 1, parentId: null },
      { text: "Hat A", level: 2, parentId: "heading-0" },
      { text: "Block A", level: 3, parentId: "heading-1" },
      { text: "Tag A", level: 4, parentId: "heading-2" },
      { text: "Tag B", level: 4, parentId: "heading-2" },
      { text: "Pocket B", level: 1, parentId: null }
    ]
  );
});

test("normalizes documents whose Word outline begins at Heading 2", async () => {
  const zip = new JSZip();
  zip.file(
    "word/styles.xml",
    `<?xml version="1.0"?><w:styles ${namespaces}>
      <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style>
      <w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:pPr><w:outlineLvl w:val="2"/></w:pPr></w:style>
      <w:style w:type="paragraph" w:styleId="Heading4"><w:name w:val="heading 4"/><w:pPr><w:outlineLvl w:val="3"/></w:pPr></w:style>
      <w:style w:type="paragraph" w:styleId="Heading5"><w:name w:val="heading 5"/><w:pPr><w:outlineLvl w:val="4"/></w:pPr></w:style>
    </w:styles>`
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0"?><w:document ${namespaces}><w:body>
      ${paragraph("Pocket", "Heading2")}
      ${paragraph("Hat", "Heading3")}
      ${paragraph("Block", "Heading4")}
      ${paragraph("Tag", "Heading5")}
      <w:p><w:r><w:t>Card text</w:t></w:r></w:p>
      <w:sectPr/>
    </w:body></w:document>`
  );
  const source = await zip.generateAsync({ type: "nodebuffer" });
  const parsed = await parseDocx(source, "/tmp/offset.docx");
  assert.deepEqual(parsed.headings.map(({ text, level }) => ({ text, level })), [
    { text: "Pocket", level: 1 },
    { text: "Hat", level: 2 },
    { text: "Block", level: 3 },
    { text: "Tag", level: 4 }
  ]);
});

test("exports selected sections in requested order", async () => {
  const source = await fixtureDocx();
  const parsed = await parseDocx(source, "/tmp/case.docx");
  const output = await exportSelection(parsed, ["heading-4", "heading-3"]);
  const outputZip = await JSZip.loadAsync(output);
  const xml = await outputZip.file("word/document.xml").async("string");

  assert.ok(xml.indexOf("Tag B") < xml.indexOf("Tag A"));
  assert.match(xml, /Evidence B/);
  assert.match(xml, /Evidence A/);
  assert.doesNotMatch(xml, /Pocket A/);
  assert.match(xml, /sectPr/);
});

test("exports selections drawn from multiple source documents", async () => {
  const firstSource = await fixtureDocx();
  const secondZip = await JSZip.loadAsync(await fixtureDocx());
  const secondXml = await secondZip.file("word/document.xml").async("string");
  secondZip.file(
    "word/document.xml",
    secondXml.replaceAll("Tag A", "Theory Tag").replaceAll("Evidence A", "Theory evidence")
  );
  const secondSource = await secondZip.generateAsync({ type: "nodebuffer" });
  const first = await parseDocx(firstSource, "/tmp/case.docx");
  const second = await parseDocx(secondSource, "/tmp/theory.docx");
  const documents = new Map([
    ["case", first],
    ["theory", second]
  ]);

  const output = await exportCombinedSelection(documents, [
    { sourceId: "case", headingId: "heading-4" },
    { sourceId: "theory", headingId: "heading-3" }
  ]);
  const outputZip = await JSZip.loadAsync(output);
  const xml = await outputZip.file("word/document.xml").async("string");
  assert.ok(xml.indexOf("Tag B") < xml.indexOf("Theory Tag"));
  assert.match(xml, /Evidence B/);
  assert.match(xml, /Theory evidence/);
});

test("exports renamed/restyled source headers and inserts the filename pocket", async () => {
  const source = await fixtureDocx();
  const parsed = await parseDocx(source, "/tmp/case.docx");
  const documents = new Map([["case", parsed]]);
  const output = await exportCombinedSelection(
    documents,
    [
      {
        kind: "source",
        sourceId: "case",
        headingId: "heading-3",
        textOverride: "Perm — AT: Do Plank 1",
        levelOverride: 1
      },
      {
        kind: "manual",
        text: "Overview",
        level: 2
      }
    ],
    { title: "2NC---Tournament X---R1" }
  );
  const outputZip = await JSZip.loadAsync(output);
  const xml = await outputZip.file("word/document.xml").async("string");

  assert.ok(xml.indexOf("2NC---Tournament X---R1") < xml.indexOf("Perm — AT"));
  assert.ok(xml.indexOf("Perm — AT: Do Plank 1") < xml.indexOf("Overview"));
  assert.match(xml, /Evidence A/);
  assert.doesNotMatch(xml, />Tag A</);
  assert.match(xml, /w:pStyle[^>]+w:val="Heading1"/);
});

test("exports a valid document made only from manual headers", async () => {
  const output = await exportCombinedSelection(
    new Map(),
    [
      { kind: "manual", text: "Manual Pocket", level: 1 },
      { kind: "manual", text: "Manual Hat", level: 2 }
    ],
    { title: "Speech Name" }
  );
  const outputZip = await JSZip.loadAsync(output);
  const xml = await outputZip.file("word/document.xml").async("string");
  assert.match(xml, /Speech Name/);
  assert.match(xml, /Manual Pocket/);
  assert.match(xml, /Manual Hat/);
  assert.ok(outputZip.file("word/styles.xml"));
});
