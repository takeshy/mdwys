# mdwys

Markdown preview / WYSIWYG / raw editor packaged as a Deno desktop app.

## Requirements

- Deno 2.9.0 or newer

## Commands

```bash
deno install --allow-scripts
deno task dev
deno task desktop
```

`deno task dev` starts the Vite web UI. `deno task desktop` builds the UI and opens it with `deno desktop`.

The editor stores the current draft in `localStorage`. Use the toolbar or `Cmd/Ctrl+O` and `Cmd/Ctrl+S` to import/export Markdown files.
