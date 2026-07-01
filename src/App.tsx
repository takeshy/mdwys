import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Columns2, LayoutDashboard, Moon, Rows2, Sun, X } from "lucide-react";
import { DashboardView } from "./dashboard/DashboardView";
import { DASHBOARD_STORAGE_KEY, defaultDashboard, type DashboardData } from "./dashboard/types";
import { epubToHtml, isEpubFileName } from "./lib/epub";

export type MarkdownMode = "preview" | "wysiwyg" | "raw";
export type EqualizeLayoutDirection = "vertical" | "horizontal";

type CheckpointReason = "initial" | "idle" | "blur" | "manual" | "restore";

interface HistoryCheckpoint {
  id: string;
  timestamp: Date;
  reason: CheckpointReason;
  fileName: string;
  content: string;
  dashboard: DashboardData;
}

const STORAGE_KEY = "mdwys:document";
const NAME_KEY = "mdwys:fileName";

const initialMarkdown = `# mdwys

GeminiHub の Markdown 体験を単体 desktop アプリにした小さなエディタです。

> [!note] Preview
> GFM, tables, task lists, code highlight, callouts, and Mermaid diagrams are supported.

## Modes

- Preview
- WYSIWYG
- Raw

\`\`\`mermaid
flowchart LR
  Raw --> Preview
  Raw --> WYSIWYG
  WYSIWYG --> Preview
\`\`\`
`;

function readStored(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function readDashboard(): DashboardData {
  try {
    const stored = localStorage.getItem(DASHBOARD_STORAGE_KEY);
    if (!stored) return defaultDashboard();
    const parsed = JSON.parse(stored) as { widgets?: Array<Record<string, unknown>> };
    if (!parsed || !Array.isArray(parsed.widgets)) return defaultDashboard();
    return {
      ...parsed,
      widgets: parsed.widgets
        .filter((widget) => widget.type !== "note" && widget.type !== "links" && widget.type !== "web")
        .map((widget) => widget.type === "markdown" ? { ...widget, type: "file", title: widget.title || "File" } : widget),
    } as unknown as DashboardData;
  } catch {
    return defaultDashboard();
  }
}

function dataUrlToBlob(dataUrl: string): Blob | null {
  const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/);
  if (!match) return null;
  const mimeType = match[1] || "application/octet-stream";
  const body = match[2] ? atob(match[3]) : decodeURIComponent(match[3]);
  const bytes = new Uint8Array(body.length);
  for (let i = 0; i < body.length; i++) bytes[i] = body.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

function isBinaryPreviewFileName(fileName: string): boolean {
  return /\.(avif|bmp|gif|jpe?g|pdf|png|svg|webp)$/i.test(fileName);
}

function persistenceContent(fileName: string, content: string): string {
  return isBinaryPreviewFileName(fileName) && content.startsWith("data:") ? "" : content;
}

function persistenceDashboard(dashboard: DashboardData): DashboardData {
  return {
    ...dashboard,
    widgets: dashboard.widgets.map((widget) => {
      const fileName = typeof widget.config.fileName === "string" ? widget.config.fileName : "";
      const content = typeof widget.config.content === "string" ? widget.config.content : "";
      if (!fileName || !content || persistenceContent(fileName, content) === content) return widget;

      return {
        ...widget,
        config: {
          ...widget.config,
          content: "",
        },
      };
    }),
  };
}

function persistLocalState(fileName: string, content: string, dashboard?: DashboardData) {
  try {
    localStorage.setItem(STORAGE_KEY, persistenceContent(fileName, content));
    localStorage.setItem(NAME_KEY, fileName);
    if (dashboard) {
      localStorage.setItem(DASHBOARD_STORAGE_KEY, JSON.stringify(persistenceDashboard(dashboard)));
    }
  } catch (error) {
    console.warn("Could not persist current document.", error);
  }
}

function downloadFile(fileName: string, content: string) {
  const dataBlob = content.startsWith("data:") ? dataUrlToBlob(content) : null;
  const blob = dataBlob ?? new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName || "document.txt";
  anchor.click();
  URL.revokeObjectURL(url);
}

function checkpointHash(fileName: string, content: string, dashboard: DashboardData): string {
  return JSON.stringify({
    fileName,
    content: persistenceContent(fileName, content),
    dashboard: persistenceDashboard(dashboard),
  });
}

function reasonLabel(reason: CheckpointReason): string {
  switch (reason) {
    case "initial":
      return "Opened";
    case "idle":
      return "Idle checkpoint";
    case "blur":
      return "Focus left";
    case "manual":
      return "Saved";
    case "restore":
      return "Restored";
  }
}

function changedSummary(current: HistoryCheckpoint, previous?: HistoryCheckpoint): string {
  if (!previous) return "Initial state";
  const changes: string[] = [];
  if (current.fileName !== previous.fileName) changes.push("file name");
  if (current.content !== previous.content) changes.push("document");
  if (JSON.stringify(current.dashboard) !== JSON.stringify(previous.dashboard)) changes.push("dashboard");
  return changes.length ? changes.join(", ") : "No content change";
}

export default function App() {
  const [markdownMode, setMarkdownMode] = useState<MarkdownMode>("wysiwyg");
  const [content, setContent] = useState(() => readStored(STORAGE_KEY, initialMarkdown));
  const [fileName, setFileName] = useState(() => readStored(NAME_KEY, "document.md"));
  const [dashboard, setDashboard] = useState<DashboardData>(() => readDashboard());
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [addWidgetRequest, setAddWidgetRequest] = useState<{ id: number; direction: EqualizeLayoutDirection }>({ id: 0, direction: "horizontal" });
  const [activeLayoutDirection, setActiveLayoutDirection] = useState<EqualizeLayoutDirection>("horizontal");
  const [equalizeLayoutRequest, setEqualizeLayoutRequest] = useState<{ id: number; direction: EqualizeLayoutDirection }>({ id: 0, direction: "horizontal" });
  const [splitWidgetRequest, setSplitWidgetRequest] = useState<{ id: number; direction: EqualizeLayoutDirection }>({ id: 0, direction: "horizontal" });
  const [openFilePickerRequest, setOpenFilePickerRequest] = useState(0);
  const [checkpoints, setCheckpoints] = useState<HistoryCheckpoint[]>([]);
  const [isDark, setIsDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeLayoutDirectionRef = useRef<EqualizeLayoutDirection>("horizontal");
  const lastCheckpointHashRef = useRef<string>("");
  const latestStateRef = useRef({ fileName, content, dashboard });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
  }, [isDark]);

  useEffect(() => {
    latestStateRef.current = { fileName, content, dashboard };
  }, [fileName, content, dashboard]);

  const addCheckpoint = useCallback((reason: CheckpointReason, force = false) => {
    const latest = latestStateRef.current;
    const hash = checkpointHash(latest.fileName, latest.content, latest.dashboard);
    if (reason !== "initial" && hash === lastCheckpointHashRef.current) return false;

    lastCheckpointHashRef.current = hash;
    const checkpoint: HistoryCheckpoint = {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      reason,
      fileName: latest.fileName,
      content: persistenceContent(latest.fileName, latest.content),
      dashboard: persistenceDashboard(latest.dashboard),
    };

    setCheckpoints((items) => [...items.slice(-99), checkpoint]);
    return true;
  }, []);

  useEffect(() => {
    addCheckpoint("initial", true);
  }, [addCheckpoint]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      persistLocalState(fileName, content);
      setSavedAt(new Date());
    }, 250);

    return () => window.clearTimeout(id);
  }, [content, fileName]);

  useEffect(() => {
    try {
      localStorage.setItem(DASHBOARD_STORAGE_KEY, JSON.stringify(persistenceDashboard(dashboard)));
    } catch (error) {
      console.warn("Could not persist dashboard.", error);
    }
  }, [dashboard]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      addCheckpoint("idle");
    }, 3500);

    return () => window.clearTimeout(id);
  }, [content, fileName, dashboard, addCheckpoint]);

  useEffect(() => {
    const onBlur = () => {
      addCheckpoint("blur");
    };
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, [addCheckpoint]);

  const newDocument = useCallback(() => {
    if (content.trim() && !confirm("Create a new document and replace the current editor content?")) return;
    setContent("# Untitled\n\n");
    setFileName("untitled.md");
    setMarkdownMode("wysiwyg");
  }, [content]);

  const openDocument = useCallback((file: File) => {
    const lowerName = file.name.toLowerCase();
    if (isEpubFileName(lowerName)) {
      epubToHtml(file).then((html) => {
        setContent(html);
        setFileName(file.name || "document.epub");
        setMarkdownMode("preview");
      }).catch((error) => {
        console.error(error);
        alert("Could not open this EPUB file.");
      });
      return;
    }

    const reader = new FileReader();
    reader.addEventListener("load", () => {
      setContent(String(reader.result ?? ""));
      setFileName(file.name || "document.md");
      setMarkdownMode(lowerName.endsWith(".md") || lowerName.endsWith(".markdown") ? "wysiwyg" : "preview");
    });
    if (lowerName.endsWith(".pdf")) {
      reader.readAsDataURL(file);
    } else {
      reader.readAsText(file);
    }
  }, []);

  const saveDocument = useCallback(() => {
    persistLocalState(fileName, content, dashboard);
    addCheckpoint("manual", true);
    setSavedAt(new Date());
  }, [content, fileName, dashboard, addCheckpoint]);

  const exportDocument = useCallback(() => {
    downloadFile(fileName, content);
  }, [content, fileName]);

  const restoreCheckpoint = useCallback((checkpoint: HistoryCheckpoint) => {
    const currentHash = checkpointHash(fileName, content, dashboard);
    const targetHash = checkpointHash(checkpoint.fileName, checkpoint.content, checkpoint.dashboard);
    if (currentHash === targetHash) {
      setHistoryOpen(false);
      return;
    }

    addCheckpoint("restore");
    setFileName(checkpoint.fileName);
    setContent(checkpoint.content);
    setDashboard(structuredClone(checkpoint.dashboard));
    setHistoryOpen(false);
    window.setTimeout(() => addCheckpoint("restore", true), 0);
  }, [addCheckpoint, content, dashboard, fileName]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (!meta) return;
      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveDocument();
      }
      if (event.key.toLowerCase() === "e") {
        event.preventDefault();
        exportDocument();
      }
      if (event.key.toLowerCase() === "o") {
        event.preventDefault();
        setOpenFilePickerRequest((value) => value + 1);
      }
      if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        newDocument();
      }
    };

    const onMenu = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (id === "new") newDocument();
      if (id === "open") setOpenFilePickerRequest((value) => value + 1);
      if (id === "save") saveDocument();
      if (id === "export") exportDocument();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mdwys-menu", onMenu);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mdwys-menu", onMenu);
    };
  }, [exportDocument, newDocument, saveDocument]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="document-meta">
          <LayoutDashboard size={18} aria-hidden="true" />
          <strong className="app-title">mdwys</strong>
        </div>

        <div className="global-toolbar">
          <button
            type="button"
            className="global-command"
            onClick={() => setAddWidgetRequest((value) => ({ id: value.id + 1, direction: activeLayoutDirectionRef.current }))}
            title="Add widget"
          >
            <span>+ Add Widget</span>
          </button>
          <button
            type="button"
            className={`icon-button ${activeLayoutDirection === "vertical" ? "active" : ""}`}
            onClick={() => {
              if (activeLayoutDirection === "vertical") {
                setEqualizeLayoutRequest((value) => ({ id: value.id + 1, direction: "vertical" }));
              } else {
                activeLayoutDirectionRef.current = "vertical";
                setActiveLayoutDirection("vertical");
                setSplitWidgetRequest((value) => ({ id: value.id + 1, direction: "vertical" }));
              }
            }}
            title="縦に均等"
          >
            <Rows2 size={18} />
          </button>
          <button
            type="button"
            className={`icon-button ${activeLayoutDirection === "horizontal" ? "active" : ""}`}
            onClick={() => {
              if (activeLayoutDirection === "horizontal") {
                setEqualizeLayoutRequest((value) => ({ id: value.id + 1, direction: "horizontal" }));
              } else {
                activeLayoutDirectionRef.current = "horizontal";
                setActiveLayoutDirection("horizontal");
                setSplitWidgetRequest((value) => ({ id: value.id + 1, direction: "horizontal" }));
              }
            }}
            title="横に均等"
          >
            <Columns2 size={18} />
          </button>
          <button type="button" className="icon-button" onClick={() => setIsDark((value) => !value)} title="Toggle theme">
            {isDark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
      </header>

      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.markdown,.html,.htm,.epub,.pdf,.txt,text/markdown,text/html,application/epub+zip,text/plain,application/pdf,*/*"
        className="hidden-input"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) openDocument(file);
          event.currentTarget.value = "";
        }}
      />

      <section className="editor-frame">
        <DashboardView
          data={dashboard}
          onChange={setDashboard}
          documentMarkdown={content}
          onDocumentMarkdownChange={setContent}
          markdownMode={markdownMode}
          onMarkdownModeChange={setMarkdownMode}
          fileName={fileName}
          onFileNameChange={setFileName}
          onNewDocument={newDocument}
          onOpenDocument={() => fileInputRef.current?.click()}
          onSaveDocument={saveDocument}
          onExportDocument={exportDocument}
          onHistoryClick={() => setHistoryOpen(true)}
          isDark={isDark}
          addWidgetRequest={addWidgetRequest}
          activeLayoutDirection={activeLayoutDirection}
          equalizeLayoutRequest={equalizeLayoutRequest}
          splitWidgetRequest={splitWidgetRequest}
          openFilePickerRequest={openFilePickerRequest}
        />
      </section>

      {historyOpen && (
        <div className="history-backdrop" onClick={() => setHistoryOpen(false)}>
          <section className="history-modal" onClick={(event) => event.stopPropagation()}>
            <header className="history-header">
              <div>
                <strong>History</strong>
                <span>{checkpoints.length} checkpoints in this session</span>
              </div>
              <button type="button" className="icon-button" onClick={() => setHistoryOpen(false)} title="Close">
                <X size={18} />
              </button>
            </header>

            <div className="history-list">
              {[...checkpoints].reverse().map((checkpoint, index) => {
                const previous = checkpoints[checkpoints.findIndex((item) => item.id === checkpoint.id) - 1];
                const isCurrent = index === 0 && checkpointHash(fileName, content, dashboard) === checkpointHash(checkpoint.fileName, checkpoint.content, checkpoint.dashboard);
                return (
                  <article key={checkpoint.id} className="history-item">
                    <div className="history-item-main">
                      <strong>{reasonLabel(checkpoint.reason)}</strong>
                      <span>{checkpoint.timestamp.toLocaleString()}</span>
                      <small>{changedSummary(checkpoint, previous)}</small>
                    </div>
                    <button
                      type="button"
                      className="history-restore"
                      onClick={() => restoreCheckpoint(checkpoint)}
                      disabled={isCurrent}
                      title={isCurrent ? "Current state" : "Restore this checkpoint"}
                    >
                      {isCurrent ? <Check size={16} /> : null}
                      <span>{isCurrent ? "Current" : "Restore"}</span>
                    </button>
                  </article>
                );
              })}
              {checkpoints.length === 0 && <div className="history-empty">No checkpoints yet.</div>}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
