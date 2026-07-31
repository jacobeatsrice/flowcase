const JSZip = require("jszip");
const { DOMParser, XMLSerializer } = require("@xmldom/xmldom");

const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function elementChildren(node) {
  if (!node) return [];
  return Array.from(node.childNodes || []).filter((child) => child.nodeType === 1);
}

function childByName(node, name) {
  return elementChildren(node).find((child) => child.localName === name) || null;
}

function descendantByName(node, name) {
  if (!node) return null;
  return descendantsByName(node, name)[0] || null;
}

function descendantsByName(node, name) {
  if (!node) return [];
  const transitional = Array.from(node.getElementsByTagNameNS(WORD_NS, name));
  if (transitional.length) return transitional;
  return Array.from(node.getElementsByTagName("*")).filter(
    (candidate) => candidate.localName === name
  );
}

function wordAttribute(node, name) {
  if (!node) return null;
  return (
    node.getAttributeNS(WORD_NS, name) ||
    node.getAttribute(`w:${name}`) ||
    node.getAttribute(name) ||
    null
  );
}

function debateStyleLevel(styleId, styleName) {
  const candidates = [styleId, styleName].filter(Boolean);
  for (const candidate of candidates) {
    const normalized = candidate.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (normalized.includes("pocket")) return 1;
    if (
      normalized === "hat" ||
      normalized === "hats" ||
      normalized.startsWith("hatstyle") ||
      normalized.endsWith("hat") ||
      normalized.includes("debatehat") ||
      normalized.includes("verbatimhat")
    ) {
      return 2;
    }
    if (normalized.includes("block")) return 3;
    if (normalized.includes("tag")) return 4;
  }
  return null;
}

function wordHeadingLevel(styleId, styleName) {
  const candidates = [styleId, styleName].filter(Boolean);
  for (const candidate of candidates) {
    const normalized = candidate.toLowerCase().replace(/[^a-z0-9]/g, "");
    const headingMatch = normalized.match(/^heading([1-9])$/);
    if (headingMatch) return Number(headingMatch[1]);
  }
  return null;
}

function namedHeadingLevel(styleId, styleName) {
  return debateStyleLevel(styleId, styleName) || wordHeadingLevel(styleId, styleName);
}

function parseStyles(stylesXml) {
  const styles = new Map();
  if (!stylesXml) return styles;

  const doc = new DOMParser().parseFromString(stylesXml, "application/xml");
  const styleNodes = descendantsByName(doc, "style");

  for (const style of styleNodes) {
    const styleId = wordAttribute(style, "styleId");
    if (!styleId) continue;
    const name = wordAttribute(childByName(style, "name"), "val") || styleId;
    const basedOn = wordAttribute(childByName(style, "basedOn"), "val");
    const outlineNode = descendantByName(childByName(style, "pPr"), "outlineLvl");
    const outlineValue = Number.parseInt(wordAttribute(outlineNode, "val"), 10);
    const explicitDebateLevel = debateStyleLevel(styleId, name);
    const directLevel =
      explicitDebateLevel ||
      (Number.isInteger(outlineValue)
        ? outlineValue + 1
        : wordHeadingLevel(styleId, name));

    styles.set(styleId, {
      id: styleId,
      name,
      basedOn,
      directLevel,
      explicitDebateLevel
    });
  }

  function resolveLevel(styleId, visited = new Set()) {
    if (!styleId || visited.has(styleId)) return null;
    visited.add(styleId);
    const style = styles.get(styleId);
    if (!style) return namedHeadingLevel(styleId, styleId);
    if (style.directLevel) return style.directLevel;
    return resolveLevel(style.basedOn, visited);
  }

  function resolveDebateLevel(styleId, visited = new Set()) {
    if (!styleId || visited.has(styleId)) return null;
    visited.add(styleId);
    const style = styles.get(styleId);
    if (!style) return debateStyleLevel(styleId, styleId);
    if (style.explicitDebateLevel) return style.explicitDebateLevel;
    return resolveDebateLevel(style.basedOn, visited);
  }

  for (const style of styles.values()) {
    style.level = resolveLevel(style.id);
    style.debateLevel = resolveDebateLevel(style.id);
  }

  return styles;
}

function paragraphText(paragraph) {
  const pieces = [];

  function walk(node) {
    if (node.nodeType === 3) {
      if (node.parentNode?.localName === "t") pieces.push(node.data);
      return;
    }
    if (node.nodeType !== 1) return;
    if (node.localName === "tab") pieces.push("\t");
    if (node.localName === "br" || node.localName === "cr") pieces.push(" ");
    for (const child of Array.from(node.childNodes || [])) walk(child);
  }

  walk(paragraph);
  return pieces.join("").replace(/\s+/g, " ").trim();
}

function paragraphHeading(paragraph, styles) {
  if (paragraph.localName !== "p") return null;
  const pPr = childByName(paragraph, "pPr");
  const styleId = wordAttribute(childByName(pPr, "pStyle"), "val");
  const directOutline = Number.parseInt(
    wordAttribute(childByName(pPr, "outlineLvl"), "val"),
    10
  );
  const style = styles.get(styleId);
  const explicitLevel =
    style?.debateLevel || debateStyleLevel(styleId, style?.name);
  const sourceLevel = explicitLevel || (Number.isInteger(directOutline)
    ? directOutline + 1
    : style?.level || wordHeadingLevel(styleId, style?.name));

  if (!sourceLevel || sourceLevel < 1 || sourceLevel > 9) return null;
  const text = paragraphText(paragraph);
  if (!text) return null;
  return {
    text,
    sourceLevel,
    explicitLevel,
    styleId,
    styleName: style?.name || styleId || `Heading ${sourceLevel}`
  };
}

async function parseDocx(sourceBuffer, sourcePath = "document.docx") {
  let zip;
  try {
    zip = await JSZip.loadAsync(sourceBuffer);
  } catch {
    throw new Error("This file is not a valid .docx document.");
  }

  const documentFile = zip.file("word/document.xml");
  if (!documentFile) throw new Error("The Word document is missing document.xml.");

  const documentXml = await documentFile.async("string");
  const stylesXml = zip.file("word/styles.xml")
    ? await zip.file("word/styles.xml").async("string")
    : "";
  const styles = parseStyles(stylesXml);
  const doc = new DOMParser().parseFromString(documentXml, "application/xml");
  const body = descendantsByName(doc, "body")[0];
  if (!body) throw new Error("The Word document has no readable body.");

  const children = elementChildren(body);
  const rawHeadings = [];

  children.forEach((child, bodyIndex) => {
    const heading = paragraphHeading(child, styles);
    if (heading) rawHeadings.push({ ...heading, bodyIndex });
  });

  if (rawHeadings.length === 0) {
    throw new Error(
      "No navigable headings were found. Flowcase recognizes Word Heading 1–9 and debate styles containing Pocket, Hat, Block, or Tag."
    );
  }

  const hasDebateStyles = rawHeadings.some((heading) => heading.explicitLevel);
  const shallowestSourceLevel = Math.min(
    ...rawHeadings
      .filter((heading) => !heading.explicitLevel)
      .map((heading) => heading.sourceLevel)
  );
  const sourceOffset =
    !hasDebateStyles && Number.isFinite(shallowestSourceLevel)
      ? Math.max(0, shallowestSourceLevel - 1)
      : 0;
  const normalizedHeadings = rawHeadings
    .map((heading) => ({
      ...heading,
      level: heading.explicitLevel || heading.sourceLevel - sourceOffset
    }))
    .filter((heading) => heading.level >= 1 && heading.level <= 4);

  if (normalizedHeadings.length === 0) {
    throw new Error(
      "Headings were found, but none fit the four-level pocket/hat/block/tag outline."
    );
  }

  const stack = [];
  const headings = normalizedHeadings.map((heading, index) => {
    while (stack.length && stack[stack.length - 1].level >= heading.level) {
      stack.pop();
    }
    const parent = stack[stack.length - 1] || null;
    const item = {
      id: `heading-${index}`,
      text: heading.text,
      level: heading.level,
      sourceLevel: heading.sourceLevel,
      styleId: heading.styleId,
      styleName: heading.styleName,
      parentId: parent?.id || null,
      hasChildren: false,
      bodyIndex: heading.bodyIndex,
      endBodyIndex: children.length
    };
    if (parent) parent.hasChildren = true;
    stack.push(item);
    return item;
  });

  headings.forEach((heading, index) => {
    for (let cursor = index + 1; cursor < headings.length; cursor += 1) {
      if (headings[cursor].level <= heading.level) {
        heading.endBodyIndex = headings[cursor].bodyIndex;
        break;
      }
    }
  });

  const sectionProperties = children.filter((child) => child.localName === "sectPr");
  const preferredStyleIds = {};
  for (const heading of headings) {
    if (!preferredStyleIds[heading.level] && heading.styleId) {
      preferredStyleIds[heading.level] = heading.styleId;
    }
  }
  for (let level = 1; level <= 4; level += 1) {
    if (preferredStyleIds[level]) continue;
    const sourceLevel = level + sourceOffset;
    const matchingStyle = Array.from(styles.values()).find(
      (style) =>
        style.debateLevel === level ||
        (!hasDebateStyles && style.level === sourceLevel)
    );
    preferredStyleIds[level] = matchingStyle?.id || `Heading${level}`;
  }

  return {
    sourcePath,
    sourceBuffer: Buffer.from(sourceBuffer),
    documentXml,
    stylesXml,
    preferredStyleIds,
    headings: headings.map(({ bodyIndex, endBodyIndex, ...publicHeading }) => publicHeading),
    headingRanges: new Map(
      headings.map((heading) => [
        heading.id,
        { start: heading.bodyIndex, end: heading.endBodyIndex }
      ])
    ),
    serializedChildren: children.map((child) => new XMLSerializer().serializeToString(child)),
    serializedSectionProperties: sectionProperties.map((child) =>
      new XMLSerializer().serializeToString(child)
    )
  };
}

async function exportSelection(document, headingIds) {
  const uniqueValidIds = headingIds.filter((id) => document.headingRanges.has(id));
  if (uniqueValidIds.length === 0) throw new Error("The selected headings are no longer available.");

  const bodyOpen = document.documentXml.match(/<(?:w:)?body(?:\s[^>]*)?>/);
  const bodyCloseIndex = document.documentXml.search(/<\/(?:w:)?body\s*>/);
  if (!bodyOpen || bodyCloseIndex < 0) {
    throw new Error("The source document body could not be reconstructed.");
  }

  const bodyOpenEnd = bodyOpen.index + bodyOpen[0].length;
  const prefix = document.documentXml.slice(0, bodyOpenEnd);
  const suffix = document.documentXml.slice(bodyCloseIndex);
  const selectedXml = uniqueValidIds
    .map((id) => {
      const range = document.headingRanges.get(id);
      return document.serializedChildren
        .slice(range.start, range.end)
        .filter((xml) => !/<(?:w:)?sectPr(?:\s|>)/.test(xml))
        .join("");
    })
    .join("");
  const finalXml = `${prefix}${selectedXml}${document.serializedSectionProperties.join("")}${suffix}`;

  const outputZip = await JSZip.loadAsync(document.sourceBuffer);
  outputZip.file("word/document.xml", finalXml);
  return outputZip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 }
  });
}

async function exportCombinedSelection(documents, selections, options = {}) {
  if (!Array.isArray(selections) || selections.length === 0) {
    throw new Error("Add at least one heading to the outline first.");
  }

  const resolved = selections.map((selection) => {
    if (selection.kind === "manual") {
      return { selection, document: null };
    }
    const document = documents.get(selection.sourceId);
    return { selection, document };
  });

  if (
    resolved.some(
      ({ selection, document }) =>
        selection.kind !== "manual" &&
        !document?.headingRanges.has(selection.headingId)
    )
  ) {
    throw new Error("One or more selected headings are no longer available.");
  }

  const firstSourceDocument =
    resolved.find(({ document }) => document)?.document ||
    documents.values().next().value;
  const baseDocument = firstSourceDocument || (await createBlankBaseDocument());
  const bodyOpen = baseDocument.documentXml.match(/<(?:w:)?body(?:\s[^>]*)?>/);
  const bodyCloseIndex = baseDocument.documentXml.search(/<\/(?:w:)?body\s*>/);
  if (!bodyOpen || bodyCloseIndex < 0) {
    throw new Error("The source document body could not be reconstructed.");
  }

  const bodyOpenEnd = bodyOpen.index + bodyOpen[0].length;
  const prefix = baseDocument.documentXml.slice(0, bodyOpenEnd);
  const suffix = baseDocument.documentXml.slice(bodyCloseIndex);
  const titleXml = options.title
    ? buildHeadingParagraph(baseDocument, options.title, 1)
    : "";
  const selectedXml = resolved
    .map(({ document, selection }) => {
      if (selection.kind === "manual") {
        return buildHeadingParagraph(
          baseDocument,
          selection.text,
          selection.level
        );
      }
      const range = document.headingRanges.get(selection.headingId);
      const sectionParts = document.serializedChildren
        .slice(range.start, range.end)
        .filter((xml) => !/<(?:w:)?sectPr(?:\s|>)/.test(xml));
      const heading = document.headings.find(
        (candidate) => candidate.id === selection.headingId
      );
      if (
        sectionParts.length &&
        (selection.textOverride || selection.levelOverride)
      ) {
        sectionParts[0] = buildHeadingParagraph(
          document,
          selection.textOverride || heading.text,
          selection.levelOverride || heading.level,
          sectionParts[0]
        );
      }
      return sectionParts.join("");
    })
    .join("");
  const finalXml = `${prefix}${titleXml}${selectedXml}${baseDocument.serializedSectionProperties.join("")}${suffix}`;

  const outputZip = await JSZip.loadAsync(baseDocument.sourceBuffer);
  outputZip.file("word/document.xml", finalXml);
  const mergedStyles = resolved
    .map(({ document }) => document)
    .filter(Boolean)
    .filter((document, index, all) => all.indexOf(document) === index)
    .reduce(
      (baseStyles, document) => mergeStylesXml(baseStyles, document.stylesXml),
      baseDocument.stylesXml
    );
  if (mergedStyles) outputZip.file("word/styles.xml", mergedStyles);
  return outputZip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 }
  });
}

function buildHeadingParagraph(document, text, level, templateXml = "") {
  const styleId =
    document.preferredStyleIds?.[level] || `Heading${Math.min(4, Math.max(1, level))}`;
  if (!templateXml) {
    return `<w:p><w:pPr><w:pStyle w:val="${escapeXmlAttribute(styleId)}"/></w:pPr><w:r><w:t xml:space="preserve">${escapeXmlText(text)}</w:t></w:r></w:p>`;
  }

  const parser = new DOMParser();
  const serializer = new XMLSerializer();
  const templateDocument = parser.parseFromString(templateXml, "application/xml");
  const paragraph =
    templateDocument.documentElement?.localName === "p"
      ? templateDocument.documentElement
      : descendantsByName(templateDocument, "p")[0];
  if (!paragraph) {
    return buildHeadingParagraph(document, text, level);
  }
  const namespace = paragraph.namespaceURI || WORD_NS;
  let pPr = childByName(paragraph, "pPr");
  if (!pPr) {
    pPr = templateDocument.createElementNS(namespace, "w:pPr");
    paragraph.insertBefore(pPr, paragraph.firstChild);
  }
  let pStyle = childByName(pPr, "pStyle");
  if (!pStyle) {
    pStyle = templateDocument.createElementNS(namespace, "w:pStyle");
    pPr.insertBefore(pStyle, pPr.firstChild);
  }
  pStyle.setAttributeNS(namespace, "w:val", styleId);

  for (const child of Array.from(paragraph.childNodes || [])) {
    if (child !== pPr) paragraph.removeChild(child);
  }
  const run = templateDocument.createElementNS(namespace, "w:r");
  const textNode = templateDocument.createElementNS(namespace, "w:t");
  textNode.setAttribute("xml:space", "preserve");
  textNode.appendChild(templateDocument.createTextNode(String(text)));
  run.appendChild(textNode);
  paragraph.appendChild(run);
  return serializer.serializeToString(paragraph);
}

function escapeXmlText(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeXmlAttribute(value) {
  return escapeXmlText(value).replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

async function createBlankBaseDocument() {
  const documentXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<w:document xmlns:w="${WORD_NS}"><w:body><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;
  const stylesXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<w:styles xmlns:w="${WORD_NS}">` +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
    [1, 2, 3, 4]
      .map(
        (level) =>
          `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:outlineLvl w:val="${level - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${34 - level * 2}"/></w:rPr></w:style>`
      )
      .join("") +
    "</w:styles>";
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      "</Types>"
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      "</Relationships>"
  );
  zip.file("word/document.xml", documentXml);
  zip.file("word/styles.xml", stylesXml);
  zip.file(
    "word/_rels/document.xml.rels",
    '<?xml version="1.0" encoding="UTF-8"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      "</Relationships>"
  );
  const sourceBuffer = await zip.generateAsync({ type: "nodebuffer" });
  return {
    sourceBuffer,
    documentXml,
    stylesXml,
    preferredStyleIds: {
      1: "Heading1",
      2: "Heading2",
      3: "Heading3",
      4: "Heading4"
    },
    serializedSectionProperties: [
      `<w:sectPr xmlns:w="${WORD_NS}"><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>`
    ]
  };
}

function mergeStylesXml(baseXml, sourceXml) {
  if (!sourceXml) return baseXml;
  if (!baseXml) return sourceXml;

  const parser = new DOMParser();
  const serializer = new XMLSerializer();
  const baseDocument = parser.parseFromString(baseXml, "application/xml");
  const sourceDocument = parser.parseFromString(sourceXml, "application/xml");
  const baseRoot = descendantsByName(baseDocument, "styles")[0];
  const sourceRoot = descendantsByName(sourceDocument, "styles")[0];
  if (!baseRoot || !sourceRoot) return baseXml;

  const existingIds = new Set(
    descendantsByName(baseDocument, "style")
      .map((style) => wordAttribute(style, "styleId"))
      .filter(Boolean)
  );
  for (const style of descendantsByName(sourceDocument, "style")) {
    const styleId = wordAttribute(style, "styleId");
    if (!styleId || existingIds.has(styleId)) continue;
    baseRoot.appendChild(style.cloneNode(true));
    existingIds.add(styleId);
  }
  return serializer.serializeToString(baseDocument);
}

module.exports = {
  parseDocx,
  exportSelection,
  exportCombinedSelection,
  _test: {
    namedHeadingLevel,
    debateStyleLevel,
    wordHeadingLevel,
    mergeStylesXml,
    parseStyles,
    paragraphText
  }
};
