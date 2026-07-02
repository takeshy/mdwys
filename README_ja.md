# mdwys

mdwys は、Markdown やドキュメントファイルをローカルで扱う desktop workspace です。ファイルを widget として開き、行・列に並べたり、Markdown を編集したり、PDF / EPUB / HTML / 画像を参照したり、ドキュメント内のテキストに紐づく Timeline 形式のメモを残したりできます。

Go、Wails、Deno、Vite、React、Wysimark、pdf.js で作っています。

[English README](README.md)

![列レイアウト](docs/images/col.png)

## 主な機能

- ローカルファイルを独立した widget として開く。
- Markdown、テキスト、HTML、EPUB、PDF、主要な画像形式に対応。
- Markdown は Preview、WYSIWYG、Raw の 3 モード。
- widget の追加、移動、リサイズ、最大化、復元、閉じる操作。
- 行方向・列方向のレイアウト切り替え。
- widget がない場所への file drag & drop で新しい widget として開く。
- 既存 widget への file drag & drop で、その widget のファイルを差し替える。
- 外部エディタのパスを設定し、widget のファイルを外部エディタで開く。
- 外部エディタで変更した内容を reload で反映。
- 履歴モーダルで split / unified diff を確認。
- PDF や画像などの大きな内容は保存せず、再起動時に file path から自動再読込。
- pdf.js による PDF 表示: 連続ページレンダリング、ズーム、ページ移動、テキスト選択。
- ドキュメントごとのメモタイムライン: テキストを選択して右クリック →「メモに追加」で、引用と位置(アンカー)付きのメモを投稿。
- アンカー付きメモは本文の該当テキストをハイライト。ホバーでメモをプレビュー、クリックでタイムラインの該当エントリへ。タイムライン側の引用クリックで本文の該当位置へジャンプ。
- EPUB のフォントサイズ・幅変更(リフロー)後も、引用文字列の再解決でハイライトとジャンプが機能。
- メモパネルは widget ごとに開閉。古い順表示、`«` / `»` でレール状に折りたたみ、エントリの編集・削除・ピン留め、Raw / WYSIWYG コンポーザー、メモディレクトリ基準の `[[wiki link]]` に対応。
- メモは設定したメモディレクトリに 1 ドキュメント = 1 Markdown ファイルとして保存(仕様は `specs/memo.md`)。
- トップバーのメモ一覧: メモのあるファイルを更新日時の降順で一覧表示。ファイル名で絞り込み、ページング、クリックでそのファイルを開く。各項目にメモ件数と最新メモの冒頭を表示するので、読了時に「読了」とメモしておけば一覧で一目でわかる。
- UI 言語: 英語 / 日本語(システム言語に追従、Settings で切替可能)。
- light / dark theme。

## スクリーンショット

### 行レイアウト

widget を行方向に並べたレイアウト。

![行レイアウト](docs/images/row.png)

### 列レイアウト

widget を列方向に並べたレイアウト。

![列レイアウト](docs/images/col.png)

### メモタイムライン

ドキュメント内のテキストを選択して右クリック →「メモに追加」で、引用と位置付きのメモを投稿。左パネルのエントリから本文の該当位置へジャンプできます。

![メモタイムライン](docs/images/memo_timeline.png)

### メモ一覧

メモのあるファイルを更新日時の降順で一覧表示。各項目にメモ件数と最新メモの冒頭が表示されます。

![メモ一覧](docs/images/memo_list.png)

### 設定

外部エディタのパス、メモディレクトリ、UI 言語を設定します。

![設定](docs/images/setting.png)

### 外部エディタ設定

設定した外部エディタで widget のファイルを開き、reload で変更を反映します。

![外部エディタ設定](docs/images/external_editor.png)

## インストール

GitHub Releases から実行ファイルをダウンロードしてください。配布された実行ファイルの起動には Deno や Go は不要です。

Release では以下の実行ファイルを作成します。

- `mdwys-linux-amd64`
- `mdwys-linux-arm64`
- `mdwys-darwin-arm64`
- `mdwys-windows-amd64.exe`
- `mdwys-windows-arm64.exe`

## 使い方

1. mdwys を起動します。
2. `+ Add Widget` を押します。
3. ローカルファイルを選びます。
4. widget の toolbar から Markdown mode、reload、外部エディタ起動、history、最大化、閉じる操作を行います。
5. 画面右上の行・列ボタンで、新しい widget の並び方を切り替えます。

外部エディタ連携を使う場合は、Settings でエディタの実行ファイルパスを設定します。Windows の例:

```text
C:\Program Files\Neovim\bin\nvim.exe
```

### メモ

1. Settings でメモディレクトリを設定します。未設定の間はメモ機能は無効です。
2. widget でローカルファイルを開き、toolbar のメモアイコンで左側にタイムラインパネルを開きます。
3. ドキュメント(Markdown preview / PDF / EPUB / HTML / テキスト)内のテキストを選択して右クリック →「メモに追加」。引用とアンカーがプリセットされたコンポーザーに本文を書いて投稿します。
4. パネルを開いている間、引用箇所は本文でハイライトされます。ハイライトのクリックで該当エントリへ、タイムラインの引用クリックで本文の該当位置へジャンプします。
5. トップバーのメモ一覧から、メモのあるファイルを検索して開き直せます。

メモは 1 ドキュメント = 1 Markdown ファイルなので、任意のエディタでそのまま読み書きできます。

## キーボードショートカット

- `Ctrl/Cmd + O`: active widget を最大化。
- `Ctrl/Cmd + M`: 最大化 widget を戻す。
- `Ctrl/Cmd + S`: 現在のローカル状態を保存。
- `Ctrl/Cmd + E`: 現在の document content を export。
- `Ctrl/Cmd + P`: widget file picker を開く。
- `Esc`: modal を閉じる。

## 開発

開発には以下が必要です。

- Deno 2.9 以上
- Go 1.23 以上
- 利用 OS 向けの Wails platform dependencies

frontend dependencies を入れます。

```bash
deno install --allow-scripts
```

Web UI を起動します。

```bash
deno task dev
```

Wails の desktop app を dev mode で起動します。

```bash
deno task desktop
```

型チェックと frontend build:

```bash
deno task check
deno task build
```

desktop app build:

```bash
deno task desktop:build
```

Windows ARM64 binary を手元で build する例:

```bash
go run github.com/wailsapp/wails/v2/cmd/wails@v2.10.2 build -platform windows/arm64 -nopackage -o mdwys-windows-arm64.exe
```

## リリース

`v*` tag を push すると draft GitHub Release を作成します。

```bash
git tag v0.1.0
git push origin v0.1.0
```

release workflow は Linux、macOS、Windows の binary を build し、zip ではなく直接実行ファイルとして添付します。
