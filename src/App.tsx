import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Columns2, LayoutDashboard, Moon, NotebookText, Rows2, Settings, Sun, X } from "lucide-react";
import { MemoListModal } from "./components/MemoListModal";
import { DashboardView } from "./dashboard/DashboardView";
import { DASHBOARD_STORAGE_KEY, defaultDashboard, type DashboardData } from "./dashboard/types";
import { I18nProvider, useI18n } from "./i18n/context";
import { resolveLanguage, t, type LanguageSetting, type TranslationStrings } from "./i18n/translations";
import { selectDirectoryPath, selectExternalEditor } from "./lib/wailsBackend";

type Translate = (key: keyof TranslationStrings) => string;

export type MarkdownMode = "preview" | "wysiwyg" | "raw";
export type EqualizeLayoutDirection = "vertical" | "horizontal";

type CheckpointReason = "initial" | "idle" | "blur" | "manual" | "restore" | "reload";
type DiffViewMode = "unified" | "split";

interface HistoryCheckpoint {
  id: string;
  timestamp: Date;
  reason: CheckpointReason;
  fileName: string;
  content: string;
  dashboard: DashboardData;
}

interface DiffLine {
  type: "unchanged" | "added" | "removed";
  content: string;
  oldLineNum: number | null;
  newLineNum: number | null;
}

interface SplitDiffRow {
  left: DiffLine | null;
  right: DiffLine | null;
}

interface DiffTarget {
  label: string;
  before: string;
  after: string;
}

const STORAGE_KEY = "mdwys:document";
const NAME_KEY = "mdwys:fileName";
const EXTERNAL_EDITOR_KEY = "mdwys:externalEditorPath";
const MEMO_DIR_KEY = "mdwys:memoDirPath";
const LANGUAGE_KEY = "mdwys:language";

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

function reasonLabel(tr: Translate, reason: CheckpointReason): string {
  switch (reason) {
    case "initial":
      return tr("history.reason.initial");
    case "idle":
      return tr("history.reason.idle");
    case "blur":
      return tr("history.reason.blur");
    case "manual":
      return tr("history.reason.manual");
    case "restore":
      return tr("history.reason.restore");
    case "reload":
      return tr("history.reason.reload");
  }
}

function changedSummary(tr: Translate, current: HistoryCheckpoint, previous?: HistoryCheckpoint): string {
  if (!previous) return tr("history.changed.initial");
  const changes: string[] = [];
  if (current.fileName !== previous.fileName) changes.push(tr("history.changed.fileName"));
  if (current.content !== previous.content) changes.push(tr("history.changed.document"));
  if (JSON.stringify(current.dashboard) !== JSON.stringify(previous.dashboard)) changes.push(tr("history.changed.dashboard"));
  return changes.length ? changes.join(", ") : tr("history.changed.none");
}

function uniqueCheckpoints(items: HistoryCheckpoint[]): HistoryCheckpoint[] {
  const result: HistoryCheckpoint[] = [];
  let previousHash = "";
  for (const item of items) {
    const hash = checkpointHash(item.fileName, item.content, item.dashboard);
    if (hash === previousHash) continue;
    previousHash = hash;
    result.push(item);
  }
  return result;
}

function buildLineDiff(before: string, after: string): DiffLine[] {
  const oldLines = before.split("\n");
  const newLines = after.split("\n");
  const rows = oldLines.length;
  const cols = newLines.length;
  const table = Array.from({ length: rows + 1 }, () => Array(cols + 1).fill(0) as number[]);

  for (let i = rows - 1; i >= 0; i--) {
    for (let j = cols - 1; j >= 0; j--) {
      table[i][j] = oldLines[i] === newLines[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const result: DiffLine[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < rows && newIndex < cols) {
    if (oldLines[oldIndex] === newLines[newIndex]) {
      result.push({ type: "unchanged", content: oldLines[oldIndex], oldLineNum: oldIndex + 1, newLineNum: newIndex + 1 });
      oldIndex++;
      newIndex++;
    } else if (table[oldIndex + 1][newIndex] >= table[oldIndex][newIndex + 1]) {
      result.push({ type: "removed", content: oldLines[oldIndex], oldLineNum: oldIndex + 1, newLineNum: null });
      oldIndex++;
    } else {
      result.push({ type: "added", content: newLines[newIndex], oldLineNum: null, newLineNum: newIndex + 1 });
      newIndex++;
    }
  }
  while (oldIndex < rows) {
    result.push({ type: "removed", content: oldLines[oldIndex], oldLineNum: oldIndex + 1, newLineNum: null });
    oldIndex++;
  }
  while (newIndex < cols) {
    result.push({ type: "added", content: newLines[newIndex], oldLineNum: null, newLineNum: newIndex + 1 });
    newIndex++;
  }
  return result;
}

function splitDiffRows(lines: DiffLine[]): SplitDiffRow[] {
  const rows: SplitDiffRow[] = [];
  let index = 0;
  while (index < lines.length) {
    if (lines[index].type === "unchanged") {
      rows.push({ left: lines[index], right: lines[index] });
      index++;
      continue;
    }

    const removed: DiffLine[] = [];
    const added: DiffLine[] = [];
    while (index < lines.length && lines[index].type === "removed") {
      removed.push(lines[index]);
      index++;
    }
    while (index < lines.length && lines[index].type === "added") {
      added.push(lines[index]);
      index++;
    }

    const count = Math.max(removed.length, added.length);
    for (let i = 0; i < count; i++) {
      rows.push({ left: removed[i] ?? null, right: added[i] ?? null });
    }
  }
  return rows;
}

function diffStats(lines: DiffLine[]) {
  return {
    additions: lines.filter((line) => line.type === "added").length,
    deletions: lines.filter((line) => line.type === "removed").length,
  };
}

function dashboardWidgetContent(widget: DashboardData["widgets"][number]): string | null {
  return typeof widget.config.content === "string" ? widget.config.content : null;
}

function dashboardWidgetLabel(widget: DashboardData["widgets"][number]): string {
  const fileName = typeof widget.config.fileName === "string" && widget.config.fileName.trim()
    ? widget.config.fileName
    : widget.title;
  return fileName || "Widget";
}

function checkpointDiffTargets(previous: HistoryCheckpoint, checkpoint: HistoryCheckpoint): DiffTarget[] {
  const targets: DiffTarget[] = [];
  if (previous.content !== checkpoint.content) {
    targets.push({ label: "Document", before: previous.content, after: checkpoint.content });
  }

  const previousWidgets = new Map(previous.dashboard.widgets.map((widget) => [widget.id, widget]));
  for (const widget of checkpoint.dashboard.widgets) {
    const previousWidget = previousWidgets.get(widget.id);
    if (!previousWidget) continue;
    const before = dashboardWidgetContent(previousWidget);
    const after = dashboardWidgetContent(widget);
    if (before === null || after === null || before === after) continue;
    targets.push({ label: dashboardWidgetLabel(widget), before, after });
  }

  return targets;
}

function checkpointDiffStats(previous?: HistoryCheckpoint, checkpoint?: HistoryCheckpoint) {
  if (!previous || !checkpoint) return { additions: 0, deletions: 0 };
  return checkpointDiffTargets(previous, checkpoint).reduce(
    (total, target) => {
      const stats = diffStats(buildLineDiff(target.before, target.after));
      total.additions += stats.additions;
      total.deletions += stats.deletions;
      return total;
    },
    { additions: 0, deletions: 0 },
  );
}

function DiffModeToggle({ value, onChange }: { value: DiffViewMode; onChange: (value: DiffViewMode) => void }) {
  const { t: tr } = useI18n();
  return (
    <div className="diff-mode-toggle">
      <button type="button" className={value === "unified" ? "active" : ""} onClick={() => onChange("unified")}>{tr("history.unified")}</button>
      <button type="button" className={value === "split" ? "active" : ""} onClick={() => onChange("split")}>{tr("history.split")}</button>
    </div>
  );
}

function UnifiedDiffView({ lines }: { lines: DiffLine[] }) {
  return (
    <pre className="history-diff-pre">
      {lines.map((line, index) => {
        const sign = line.type === "added" ? "+" : line.type === "removed" ? "-" : " ";
        return (
          <div key={index} className={`history-diff-line ${line.type}`}>
            <span className="history-diff-num">{line.oldLineNum ?? ""}</span>
            <span className="history-diff-num">{line.newLineNum ?? ""}</span>
            <span className="history-diff-sign">{sign}</span>
            <span className="history-diff-text">{line.content || " "}</span>
          </div>
        );
      })}
    </pre>
  );
}

function SplitDiffView({ lines }: { lines: DiffLine[] }) {
  const rows = splitDiffRows(lines);
  return (
    <pre className="history-diff-pre split">
      {rows.map((row, index) => (
        <div key={index} className="history-diff-split-row">
          <div className={`history-diff-split-cell ${row.left?.type ?? "empty"}`}>
            {row.left ? (
              <>
                <span className="history-diff-num">{row.left.oldLineNum ?? ""}</span>
                <span className="history-diff-sign">{row.left.type === "removed" ? "-" : " "}</span>
                <span className="history-diff-text">{row.left.content || " "}</span>
              </>
            ) : <span className="history-diff-text"> </span>}
          </div>
          <div className={`history-diff-split-cell ${row.right?.type ?? "empty"}`}>
            {row.right ? (
              <>
                <span className="history-diff-num">{row.right.newLineNum ?? ""}</span>
                <span className="history-diff-sign">{row.right.type === "added" ? "+" : " "}</span>
                <span className="history-diff-text">{row.right.content || " "}</span>
              </>
            ) : <span className="history-diff-text"> </span>}
          </div>
        </div>
      ))}
    </pre>
  );
}

function HistoryDiffPanel({
  checkpoint,
  previous,
  viewMode,
  onViewModeChange,
}: {
  checkpoint?: HistoryCheckpoint;
  previous?: HistoryCheckpoint;
  viewMode: DiffViewMode;
  onViewModeChange: (value: DiffViewMode) => void;
}) {
  const { t: tr } = useI18n();
  if (!checkpoint) {
    return <div className="history-diff-empty">{tr("history.selectCheckpoint")}</div>;
  }
  if (!previous) {
    return <div className="history-diff-empty">{tr("history.noPrevious")}</div>;
  }

  const target = checkpointDiffTargets(previous, checkpoint)[0];
  if (!target) {
    return (
      <section className="history-diff-panel">
        <header className="history-diff-header">
          <div>
            <strong>{tr("history.diff")}</strong>
            <span>{tr("history.noTextChanges")}</span>
          </div>
          <DiffModeToggle value={viewMode} onChange={onViewModeChange} />
        </header>
        <div className="history-diff-empty">{tr("history.noDocumentDiff")}</div>
      </section>
    );
  }

  const lines = buildLineDiff(target.before, target.after);
  const stats = diffStats(lines);
  const hasDiff = stats.additions > 0 || stats.deletions > 0;

  return (
    <section className="history-diff-panel">
      <header className="history-diff-header">
        <div>
          <strong>{tr("history.diff")}</strong>
          <span>
            {target.label}{" "}
            <span className="history-added">+{stats.additions}</span>
            {" / "}
            <span className="history-removed">-{stats.deletions}</span>
          </span>
        </div>
        <DiffModeToggle value={viewMode} onChange={onViewModeChange} />
      </header>
      {!hasDiff ? (
        <div className="history-diff-empty">{tr("history.noDocumentDiff")}</div>
      ) : viewMode === "split" ? (
        <SplitDiffView lines={lines} />
      ) : (
        <UnifiedDiffView lines={lines} />
      )}
    </section>
  );
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [historyDiffViewMode, setHistoryDiffViewMode] = useState<DiffViewMode>("split");
  const [externalEditorPath, setExternalEditorPath] = useState(() => readStored(EXTERNAL_EDITOR_KEY, ""));
  const [memoDirPath, setMemoDirPath] = useState(() => readStored(MEMO_DIR_KEY, ""));
  const [languageSetting, setLanguageSetting] = useState<LanguageSetting>(() => {
    const stored = readStored(LANGUAGE_KEY, "system");
    return stored === "en" || stored === "ja" ? stored : "system";
  });
  const language = resolveLanguage(languageSetting, navigator.language);
  const tr = useCallback((key: keyof TranslationStrings) => t(language, key), [language]);
  const [memoListOpen, setMemoListOpen] = useState(false);
  const [openPathRequest, setOpenPathRequest] = useState<{ id: number; path: string }>({ id: 0, path: "" });
  const visibleCheckpoints = uniqueCheckpoints(checkpoints);
  const selectedHistoryCheckpoint = visibleCheckpoints.find((item) => item.id === selectedHistoryId) ?? visibleCheckpoints.at(-1);
  const selectedHistoryPrevious = selectedHistoryCheckpoint
    ? visibleCheckpoints[visibleCheckpoints.findIndex((item) => item.id === selectedHistoryCheckpoint.id) - 1]
    : undefined;
  const activeLayoutDirectionRef = useRef<EqualizeLayoutDirection>("horizontal");
  const lastCheckpointHashRef = useRef<string>("");
  const latestStateRef = useRef({ fileName, content, dashboard });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
  }, [isDark]);

  useEffect(() => {
    if (!historyOpen) return;
    if (!selectedHistoryId || !visibleCheckpoints.some((item) => item.id === selectedHistoryId)) {
      setSelectedHistoryId(visibleCheckpoints.at(-1)?.id ?? null);
    }
  }, [historyOpen, selectedHistoryId, visibleCheckpoints]);

  useEffect(() => {
    try {
      localStorage.setItem(EXTERNAL_EDITOR_KEY, externalEditorPath);
    } catch (error) {
      console.warn("Could not persist external editor path.", error);
    }
  }, [externalEditorPath]);

  useEffect(() => {
    try {
      localStorage.setItem(MEMO_DIR_KEY, memoDirPath);
    } catch (error) {
      console.warn("Could not persist memo directory path.", error);
    }
  }, [memoDirPath]);

  useEffect(() => {
    try {
      localStorage.setItem(LANGUAGE_KEY, languageSetting);
    } catch (error) {
      console.warn("Could not persist language setting.", error);
    }
  }, [languageSetting]);

  useEffect(() => {
    latestStateRef.current = { fileName, content, dashboard };
  }, [fileName, content, dashboard]);

  const addCheckpoint = useCallback((reason: CheckpointReason) => {
    const latest = latestStateRef.current;
    const hash = checkpointHash(latest.fileName, latest.content, latest.dashboard);
    if (hash === lastCheckpointHashRef.current) return false;

    lastCheckpointHashRef.current = hash;
    const checkpoint: HistoryCheckpoint = {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      reason,
      fileName: latest.fileName,
      content: persistenceContent(latest.fileName, latest.content),
      dashboard: persistenceDashboard(latest.dashboard),
    };

    setCheckpoints((items) => {
      const previous = items.at(-1);
      if (previous && checkpointHash(previous.fileName, previous.content, previous.dashboard) === hash) return items;
      return [...items.slice(-99), checkpoint];
    });
    return true;
  }, []);

  useEffect(() => {
    addCheckpoint("initial");
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
    if (content.trim() && !confirm(tr("app.newDocumentConfirm"))) return;
    setContent("# Untitled\n\n");
    setFileName("untitled.md");
    setMarkdownMode("wysiwyg");
  }, [content, tr]);

  const saveDocument = useCallback(() => {
    persistLocalState(fileName, content, dashboard);
    addCheckpoint("manual");
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
    window.setTimeout(() => addCheckpoint("restore"), 0);
  }, [addCheckpoint, content, dashboard, fileName]);

  const requestHistoryCheckpoint = useCallback((reason: CheckpointReason) => {
    addCheckpoint(reason);
  }, [addCheckpoint]);

  const requestDeferredHistoryCheckpoint = useCallback((reason: CheckpointReason) => {
    window.setTimeout(() => addCheckpoint(reason), 0);
  }, [addCheckpoint]);

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
    <I18nProvider language={language}>
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
            title={tr("topbar.addWidget")}
          >
            <span>{tr("topbar.addWidget")}</span>
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
            title={tr("topbar.equalizeVertical")}
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
            title={tr("topbar.equalizeHorizontal")}
          >
            <Columns2 size={18} />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => {
              if (!memoDirPath) {
                if (confirm(tr("memo.dirPrompt"))) setSettingsOpen(true);
                return;
              }
              setMemoListOpen(true);
            }}
            title={tr("topbar.memoList")}
          >
            <NotebookText size={18} />
          </button>
          <button type="button" className="icon-button" onClick={() => setIsDark((value) => !value)} title={tr("topbar.toggleTheme")}>
            {isDark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button type="button" className="icon-button" onClick={() => setSettingsOpen(true)} title={tr("topbar.settings")}>
            <Settings size={18} />
          </button>
        </div>
      </header>

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
          onExportDocument={exportDocument}
          onHistoryClick={() => setHistoryOpen(true)}
          isDark={isDark}
          addWidgetRequest={addWidgetRequest}
          activeLayoutDirection={activeLayoutDirection}
          equalizeLayoutRequest={equalizeLayoutRequest}
          splitWidgetRequest={splitWidgetRequest}
          openFilePickerRequest={openFilePickerRequest}
          externalEditorPath={externalEditorPath}
          memoDirPath={memoDirPath}
          onOpenSettings={() => setSettingsOpen(true)}
          openPathRequest={openPathRequest}
          onHistoryCheckpoint={requestHistoryCheckpoint}
          onDeferredHistoryCheckpoint={requestDeferredHistoryCheckpoint}
        />
      </section>

      {memoListOpen && (
        <MemoListModal
          memoDirPath={memoDirPath}
          onOpenFile={(path) => {
            setOpenPathRequest((value) => ({ id: value.id + 1, path }));
            setMemoListOpen(false);
          }}
          onClose={() => setMemoListOpen(false)}
        />
      )}

      {settingsOpen && (
        <div className="settings-backdrop" onClick={() => setSettingsOpen(false)}>
          <section className="settings-modal" onClick={(event) => event.stopPropagation()}>
            <header className="settings-header">
              <strong>{tr("settings.title")}</strong>
              <button type="button" className="icon-button" onClick={() => setSettingsOpen(false)} title={tr("common.close")}>
                <X size={18} />
              </button>
            </header>
            <div className="settings-body">
              <label className="settings-field">
                <span>{tr("settings.externalEditor")}</span>
                <div className="settings-path-row">
                  <input
                    value={externalEditorPath}
                    onChange={(event) => setExternalEditorPath(event.target.value)}
                    placeholder="C:\\Program Files\\Microsoft VS Code\\Code.exe"
                  />
                  <button
                    type="button"
                    className="settings-browse"
                    onClick={async () => {
                      const path = await selectExternalEditor();
                      if (path) setExternalEditorPath(path);
                    }}
                  >
                    {tr("common.browse")}
                  </button>
                </div>
              </label>
              <label className="settings-field">
                <span>{tr("settings.memoDirectory")}</span>
                <div className="settings-path-row">
                  <input
                    value={memoDirPath}
                    onChange={(event) => setMemoDirPath(event.target.value)}
                    placeholder="/home/you/memos"
                  />
                  <button
                    type="button"
                    className="settings-browse"
                    onClick={async () => {
                      const path = await selectDirectoryPath();
                      if (path) setMemoDirPath(path);
                    }}
                  >
                    {tr("common.browse")}
                  </button>
                </div>
                <small className="settings-hint">{tr("settings.memoDirectoryHint")}</small>
              </label>
              <label className="settings-field">
                <span>{tr("settings.language")}</span>
                <select
                  className="settings-select"
                  value={languageSetting}
                  onChange={(event) => {
                    const value = event.target.value;
                    setLanguageSetting(value === "en" || value === "ja" ? value : "system");
                  }}
                >
                  <option value="system">{tr("settings.languageSystem")}</option>
                  <option value="en">English</option>
                  <option value="ja">日本語</option>
                </select>
              </label>
            </div>
          </section>
        </div>
      )}

      {historyOpen && (
        <div className="history-backdrop" onClick={() => setHistoryOpen(false)}>
          <section className="history-modal" onClick={(event) => event.stopPropagation()}>
            <header className="history-header">
              <div>
                <strong>{tr("history.title")}</strong>
                <span>{visibleCheckpoints.length} {tr("history.checkpointsSuffix")}</span>
              </div>
              <button type="button" className="icon-button" onClick={() => setHistoryOpen(false)} title={tr("common.close")}>
                <X size={18} />
              </button>
            </header>

            <div className="history-body">
              <div className="history-list">
                {[...visibleCheckpoints].reverse().map((checkpoint, index) => {
                  const previous = visibleCheckpoints[visibleCheckpoints.findIndex((item) => item.id === checkpoint.id) - 1];
                  const isCurrent = index === 0 && checkpointHash(fileName, content, dashboard) === checkpointHash(checkpoint.fileName, checkpoint.content, checkpoint.dashboard);
                  const isSelected = selectedHistoryCheckpoint?.id === checkpoint.id;
                  const stats = checkpointDiffStats(previous, checkpoint);
                  return (
                    <article key={checkpoint.id} className={`history-item ${isSelected ? "selected" : ""}`} onClick={() => setSelectedHistoryId(checkpoint.id)}>
                      <div className="history-item-main">
                        <strong>{reasonLabel(tr, checkpoint.reason)}</strong>
                        <span>{checkpoint.timestamp.toLocaleString()}</span>
                        <small>
                          {changedSummary(tr, checkpoint, previous)}
                          {previous ? `  +${stats.additions} / -${stats.deletions}` : ""}
                        </small>
                      </div>
                      <button
                        type="button"
                        className="history-restore"
                        onClick={(event) => {
                          event.stopPropagation();
                          restoreCheckpoint(checkpoint);
                        }}
                        disabled={isCurrent}
                        title={isCurrent ? tr("history.currentState") : tr("history.restoreTooltip")}
                      >
                        {isCurrent ? <Check size={16} /> : null}
                        <span>{isCurrent ? tr("history.current") : tr("history.restore")}</span>
                      </button>
                    </article>
                  );
                })}
                {visibleCheckpoints.length === 0 && <div className="history-empty">{tr("history.empty")}</div>}
              </div>
              <HistoryDiffPanel
                checkpoint={selectedHistoryCheckpoint}
                previous={selectedHistoryPrevious}
                viewMode={historyDiffViewMode}
                onViewModeChange={setHistoryDiffViewMode}
              />
            </div>
          </section>
        </div>
      )}
    </main>
    </I18nProvider>
  );
}
