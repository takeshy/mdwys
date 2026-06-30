# mdwys

mdwys is a local Markdown/file workspace built with Deno, Vite, and React. It provides movable dashboard widgets for editing and previewing Markdown, text, HTML, PDF, and image files.

## English

### Features

- Markdown modes: Preview, WYSIWYG, and Raw.
- File widgets can open Markdown, plain text, HTML, PDF, and common image formats.
- Add Widget opens the file picker first; a widget is created only after a file is selected.
- Widgets can be moved, resized, maximized, restored, deleted, and selected from the header.
- Split controls support vertical and horizontal layout defaults, active-widget splitting, and full re-layout.
- Layouts are capped at 9 widgets and are normalized to avoid very small 2/3-style leftover regions.
- Current document and dashboard state are stored in `localStorage`.

### Requirements

- Deno 2.9.0 or newer

### Commands

```bash
deno install --allow-scripts
deno task dev
deno task build
deno task check
deno task desktop
```

- `deno task dev`: starts the Vite web UI at `127.0.0.1`.
- `deno task build`: builds the web UI into `dist/`.
- `deno task check`: type-checks the web and desktop entry points.
- `deno task desktop`: builds the UI and opens it with `deno desktop`.
- `deno task desktop:dev`: opens the desktop shell with HMR.

### Basic Usage

1. Start the app with `deno task dev` or `deno task desktop`.
2. Click `Add Widget`.
3. Choose a recent file or browse for a local file.
4. Use the widget header to select a widget.
5. Use the split buttons to change the default add direction or affect the selected widget.

Keyboard shortcuts:

- `Cmd/Ctrl+O`: open a document in the main document state.
- `Cmd/Ctrl+S`: save the current state.
- `Cmd/Ctrl+E`: export the current document.
- `Cmd/Ctrl+P`: open the file picker.
- `Esc`: restore a maximized widget.

## 日本語

mdwys は Deno、Vite、React で作られたローカル向けの Markdown / ファイル作業スペースです。移動・リサイズ可能なWidget上で、Markdown、テキスト、HTML、PDF、画像ファイルを表示・編集できます。

### 機能

- Markdown は Preview、WYSIWYG、Raw の3モードに対応。
- File Widget で Markdown、テキスト、HTML、PDF、一般的な画像形式を開けます。
- `Add Widget` は先にファイルピッカーを開き、ファイル選択後にWidgetを作成します。
- Widget は移動、リサイズ、最大化、復元、削除、ヘッダークリックでの選択に対応。
- 分割ボタンで縦/横の追加デフォルト、選択中Widgetへの分割反映、全体再整列を操作できます。
- Widget は最大9個まで。Add時は小さすぎる余り領域ができにくいように正規化します。
- 現在のドキュメントとダッシュボード状態は `localStorage` に保存されます。

### 必要環境

- Deno 2.9.0 以上

### コマンド

```bash
deno install --allow-scripts
deno task dev
deno task build
deno task check
deno task desktop
```

- `deno task dev`: Vite のWeb UIを `127.0.0.1` で起動します。
- `deno task build`: Web UIを `dist/` にビルドします。
- `deno task check`: Web / desktop のエントリポイントを型チェックします。
- `deno task desktop`: UIをビルドして `deno desktop` で起動します。
- `deno task desktop:dev`: HMR付きでdesktop shellを起動します。

### 基本操作

1. `deno task dev` または `deno task desktop` で起動します。
2. `Add Widget` をクリックします。
3. 最近使ったファイル、またはローカルファイルを選びます。
4. Widgetヘッダーをクリックすると、そのWidgetが選択状態になります。
5. 分割ボタンで追加方向の切り替え、選択中Widgetへの分割反映、全体整列を行います。

ショートカット:

- `Cmd/Ctrl+O`: メインドキュメントとしてファイルを開く。
- `Cmd/Ctrl+S`: 現在の状態を保存。
- `Cmd/Ctrl+E`: 現在のドキュメントをエクスポート。
- `Cmd/Ctrl+P`: ファイルピッカーを開く。
- `Esc`: 最大化したWidgetを元に戻す。
