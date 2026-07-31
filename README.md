# Flowcase

Flowcase is a local macOS desktop app for turning a large policy-debate Word
document into a reordered, focused speech document.

It reads the first four Word outline levels as:

1. Pocket
2. Hat
3. Block
4. Tag

Click a heading to add that entire section to the new outline. Drag cards to
reorder them, remove cards with ×, and export the result as a new `.docx`.
Source styles, numbering, and document assets remain in the exported Word
package.

Flowcase also recognizes common debate style names containing Pocket, Hat,
Block, or Tag. If a document starts at Word Heading 2, its Heading 2–5 outline
is normalized to Flowcase levels 1–4.

## Permanent document library

Open **Library** and choose **Add permanent .docx** to save frequently used
sources such as a theory file. Flowcase keeps its own copy in macOS application
data and restores it on every launch. Removing a document from the library
never deletes or changes the original Word file.

Permanent and session documents appear as source tabs above the search field.
You can switch between them without losing the speech outline and export
selected sections from more than one source.

The **Open docs** picker accepts multiple files at once. Additional session
documents are appended as tabs and remain open until Flowcase closes.

## Manual outline headers

Use **+ Heading** to create an outline-only header, or use these shortcuts:

- F4: Pocket
- F5: Hat
- F6: Block
- F7: Tag

With no outline item selected, the shortcut creates a new manual header. With
an item selected, it changes that item’s level. Click an outline item and use
the pencil or **Edit selected** to rename it and choose its level. Renaming a
source header changes only the exported heading; the card content beneath it
is not modified.

On Macs where the function keys control system features, hold **fn** while
pressing F4–F7.

## Run locally

Requirements: macOS, Node.js 20 or newer, and npm.

```bash
npm install
npm start
```

## Build a macOS app

```bash
npm run dist
```

The unsigned `.zip` will be written to `outputs/`. Unzip it, move
`Flowcase.app` to Applications, and open it. On first launch, macOS may require
Control-clicking the app and choosing **Open**.

## How sections are exported

Choosing a heading includes that heading and everything below it until the next
heading of the same or higher level. For example, a tag includes its card text;
a block includes the tags nested beneath that block.

The filename chosen in the export save dialog is inserted as a pocket at the
very top of the generated Word document.
