# mdwys

mdwys is a local desktop workspace for Markdown and document files. It lets you open files as movable widgets, arrange them in rows or columns, edit Markdown, preview documents, attach timeline-style memos anchored to text in each document, and reload changes made by an external editor.

Built with Go, Wails, Deno, Vite, React, Wysimark, and pdf.js.

[日本語 README](README_ja.md)

![Column layout](docs/images/col.png)

## Features

- Open local files as independent widgets.
- Supported file types: Markdown, plain text, HTML, EPUB, PDF, and common image formats.
- Markdown modes: Preview, WYSIWYG, and Raw.
- Add, move, resize, maximize, restore, and close widgets.
- Arrange widgets in row-oriented or column-oriented layouts.
- Drag and drop a file onto empty space to create a new widget.
- Drag and drop a file onto an existing widget to replace that widget's file.
- Set an external editor and open the current widget file from the widget toolbar.
- Reload a widget from disk after editing the file externally.
- Keep session history with split and unified diffs.
- Restore local-file widgets after restart when a file path is available.
- PDF viewing powered by pdf.js: continuous page rendering, zoom, page navigation, and text selection.
- Per-document memo timeline: select text and right-click to add a memo with the quote and its location.
- Anchored memos highlight the quoted text in the document; hovering previews the memo and clicking jumps to the timeline entry. Quotes in the timeline jump back to the document.
- Memo anchors survive EPUB reflow (font size and width changes) by re-resolving the quoted text.
- Memo timeline panel per widget: oldest first, collapse to a narrow rail with `«` / `»`, edit, delete, and pin entries, Raw/WYSIWYG composer, `[[wiki links]]` resolved against the memo directory.
- Memos are plain Markdown timeline files stored in a configurable memo directory, one file per document (see `specs/memo.md`).
- Memo list in the top toolbar: browse every file that has memos, filter by file name, sorted by last update with paging, and open a file with one click.
- UI language: English and Japanese, following the system language with an override in Settings.
- Light and dark themes.

## Screenshots

### Row Layout

![Row layout](docs/images/row.png)

### Column Layout

![Column layout](docs/images/col.png)

### External Editor

![External editor setting](docs/images/external_editor.png)

## Install

Download a binary from the GitHub Releases page. The executable does not require Deno or Go at runtime.

Release artifacts are built for:

- `mdwys-linux-amd64`
- `mdwys-linux-arm64`
- `mdwys-darwin-arm64`
- `mdwys-windows-amd64.exe`
- `mdwys-windows-arm64.exe`

## Usage

1. Start mdwys.
2. Click `+ Add Widget`.
3. Choose a local file.
4. Use the widget toolbar to switch Markdown mode, reload from disk, open the file in an external editor, view history, maximize, or close the widget.
5. Use the row/column buttons in the top toolbar to control how new widgets are arranged.

For external editor integration, open Settings and set the editor executable path. On Windows, for example:

```text
C:\Program Files\Neovim\bin\nvim.exe
```

### Memos

1. Open Settings and set the memo directory. The memo feature stays disabled until this is set.
2. Open a local file in a widget and click the memo icon in the widget toolbar to open the timeline panel on the left.
3. Select text in the document (Markdown preview, PDF, EPUB, HTML, or plain text) and right-click, then choose "Add to memo". The composer is pre-filled with the quote and its anchor; write your note and post.
4. Quoted locations are highlighted in the document while the panel is open. Click a highlight to jump to the entry; click a quote in the timeline to jump back to the document.
5. Use the memo list button in the top toolbar to find and reopen any file that has memos.

Each document maps to one Markdown file in the memo directory, so memos can be read and edited with any editor.

## Keyboard Shortcuts

- `Ctrl/Cmd + O`: maximize the active widget.
- `Ctrl/Cmd + M`: restore a maximized widget.
- `Ctrl/Cmd + S`: save the current local state.
- `Ctrl/Cmd + E`: export the current document content.
- `Ctrl/Cmd + P`: open the widget file picker.
- `Esc`: close a modal.

## Development

Development requires:

- Deno 2.9 or newer
- Go 1.23 or newer
- Wails platform dependencies for your OS

Install frontend dependencies:

```bash
deno install --allow-scripts
```

Run the web UI:

```bash
deno task dev
```

Run the desktop app in Wails dev mode:

```bash
deno task desktop
```

Type-check and build the frontend:

```bash
deno task check
deno task build
```

Build the desktop app:

```bash
deno task desktop:build
```

Build a Windows ARM64 binary manually:

```bash
go run github.com/wailsapp/wails/v2/cmd/wails@v2.10.2 build -platform windows/arm64 -nopackage -o mdwys-windows-arm64.exe
```

## Release

Push a `v*` tag to build a draft GitHub Release:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The release workflow builds Linux, macOS, and Windows binaries and uploads them as direct executable artifacts.
