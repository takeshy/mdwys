import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Code,
  Download,
  Eye,
  FileText,
  FilePlus,
  FolderOpen,
  Globe,
  GripVertical,
  History,
  Maximize2,
  MoreHorizontal,
  PenLine,
  Save,
  Search,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { MarkdownPreview } from "../components/MarkdownPreview";
import { WysiwygEditor } from "../components/WysiwygEditor";
import type { MarkdownMode } from "../App";
import type { DashboardData, DashboardWidget, LayoutPos } from "./types";

const COLS = 12;
const ROW_HEIGHT = 86;
const GAP = 8;

const widgetDefs = [
  { type: "file" as const, label: "File", icon: FileText, size: { w: 7, h: 5 } },
  { type: "web" as const, label: "Web", icon: Globe, size: { w: 5, h: 4 } },
];

interface RecentFile {
  id: string;
  fileName: string;
  content: string;
  mode: MarkdownMode;
  updatedAt: Date;
}

function clampLayout(pos: LayoutPos): LayoutPos {
  const w = Math.max(2, Math.min(COLS, pos.w));
  const h = Math.max(1, pos.h);
  return {
    x: Math.max(0, Math.min(COLS - w, pos.x)),
    y: Math.max(0, pos.y),
    w,
    h,
  };
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

function readFileMode(fileName: string): MarkdownMode {
  const lowerName = fileName.toLowerCase();
  return lowerName.endsWith(".md") || lowerName.endsWith(".markdown") ? "wysiwyg" : "preview";
}

function widgetDefaults(type: DashboardWidget["type"], maxY: number): DashboardWidget {
  const def = widgetDefs.find((item) => item.type === type) ?? widgetDefs[0];
  const defaultConfig = type === "web" ? { url: "https://deno.com/" } : {};

  return {
    id: crypto.randomUUID(),
    type,
    title: def.label,
    layout: { x: 0, y: maxY, ...def.size },
    config: defaultConfig,
  };
}

function WidgetBody({
  widget,
  fallbackFileName,
  fallbackContent,
  isDark,
  onConfigChange,
}: {
  widget: DashboardWidget;
  fallbackFileName: string;
  fallbackContent: string;
  isDark: boolean;
  onConfigChange: (config: Record<string, unknown>) => void;
}) {
  if (widget.type === "file") {
    const fileName = typeof widget.config.fileName === "string" ? widget.config.fileName : fallbackFileName;
    const documentContent = typeof widget.config.content === "string" ? widget.config.content : fallbackContent;
    const markdownMode = widget.config.mode === "preview" || widget.config.mode === "wysiwyg" || widget.config.mode === "raw"
      ? widget.config.mode
      : readFileMode(fileName);
    const lowerName = fileName.toLowerCase();
    const isMarkdown = lowerName.endsWith(".md") || lowerName.endsWith(".markdown");
    const isHtml = lowerName.endsWith(".html") || lowerName.endsWith(".htm");
    const isPdf = lowerName.endsWith(".pdf");

    if (isHtml) {
      return <iframe className="dashboard-web" srcDoc={documentContent} title={fileName} sandbox="allow-scripts allow-same-origin allow-forms" />;
    }

    if (isPdf) {
      return documentContent ? (
        <iframe className="dashboard-web" src={documentContent} title={fileName} />
      ) : (
        <div className="dashboard-empty">Open a PDF file.</div>
      );
    }

    if (!isMarkdown) {
      return (
        <textarea
        className="raw-editor widget-raw-editor"
          value={documentContent}
          onChange={(event) => onConfigChange({ ...widget.config, fileName, content: event.target.value })}
          spellCheck={false}
          aria-label="Text file"
        />
      );
    }

    if (markdownMode === "preview") {
      return <MarkdownPreview content={documentContent} isDark={isDark} />;
    }
    if (markdownMode === "wysiwyg") {
      return (
        <WysiwygEditor
          value={documentContent}
          onChange={(next) => onConfigChange({ ...widget.config, fileName, content: next, mode: markdownMode })}
        />
      );
    }
    return (
      <textarea
        className="raw-editor widget-raw-editor"
        value={documentContent}
        onChange={(event) => onConfigChange({ ...widget.config, fileName, content: event.target.value, mode: markdownMode })}
        spellCheck={false}
        aria-label="Raw Markdown"
      />
    );
  }

  if (widget.type === "web") {
    const url = typeof widget.config.url === "string" ? widget.config.url : "";
    return url ? (
      <iframe className="dashboard-web" src={url} title={widget.title} sandbox="allow-scripts allow-same-origin allow-forms" />
    ) : (
      <div className="dashboard-empty">No URL.</div>
    );
  }

  return null;
}

function readPickedFile(file: File, onLoad: (fileName: string, content: string, mode: MarkdownMode) => void) {
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    onLoad(file.name || "document.txt", String(reader.result ?? ""), readFileMode(file.name));
  });
  if (file.name.toLowerCase().endsWith(".pdf")) reader.readAsDataURL(file);
  else reader.readAsText(file);
}

function FilePickerDialog({
  query,
  recentFiles,
  onQueryChange,
  onBrowse,
  onSelect,
  onClose,
}: {
  query: string;
  recentFiles: RecentFile[];
  onQueryChange: (value: string) => void;
  onBrowse: () => void;
  onSelect: (file: RecentFile) => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredFiles = recentFiles.filter((file) => file.fileName.toLowerCase().includes(normalizedQuery));

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="file-picker-backdrop" onClick={onClose}>
      <section className="file-picker" onClick={(event) => event.stopPropagation()}>
        <header className="file-picker-header">
          <div className="file-picker-search">
            <Search size={17} />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") onClose();
                if (event.key === "Enter" && filteredFiles[0]) onSelect(filteredFiles[0]);
              }}
              placeholder="Search recent files"
              aria-label="Search recent files"
            />
          </div>
          <button type="button" className="file-picker-browse" onClick={onBrowse}>
            <FolderOpen size={16} />
            <span>Browse</span>
          </button>
        </header>

        <div className="file-picker-body">
          <aside className="file-picker-rail">
            <button type="button" className="active">
              Recent
            </button>
            <button type="button" onClick={onBrowse}>
              Local files
            </button>
          </aside>
          <div className="file-picker-list">
            {filteredFiles.length ? (
              filteredFiles.map((file) => (
                <button key={file.id} type="button" className="file-picker-item" onClick={() => onSelect(file)}>
                  <FileText size={18} />
                  <span>{file.fileName}</span>
                  <small>{file.updatedAt.toLocaleTimeString()}</small>
                </button>
              ))
            ) : (
              <div className="file-picker-empty">
                <FileText size={24} />
                <span>No recent files</span>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

export function DashboardView({
  data,
  onChange,
  documentMarkdown,
  onDocumentMarkdownChange,
  markdownMode,
  onMarkdownModeChange,
  fileName,
  onFileNameChange,
  onNewDocument,
  onOpenDocument,
  onSaveDocument,
  onExportDocument,
  onHistoryClick,
  isDark,
  editMode,
  onEditModeChange,
  addWidgetRequest,
  openFilePickerRequest,
}: {
  data: DashboardData;
  onChange: (data: DashboardData) => void;
  documentMarkdown: string;
  onDocumentMarkdownChange: (value: string) => void;
  markdownMode: MarkdownMode;
  onMarkdownModeChange: (mode: MarkdownMode) => void;
  fileName: string;
  onFileNameChange: (value: string) => void;
  onNewDocument: () => void;
  onOpenDocument: () => void;
  onSaveDocument: () => void;
  onExportDocument: () => void;
  onHistoryClick: () => void;
  isDark: boolean;
  editMode: boolean;
  onEditModeChange: (value: boolean) => void;
  addWidgetRequest: number;
  openFilePickerRequest: number;
}) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [moreOpenId, setMoreOpenId] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const pickerInputRef = useRef<HTMLInputElement | null>(null);
  const seededRecentFilesRef = useRef(false);
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);
  const [filePickerTargetId, setFilePickerTargetId] = useState<string | null>(null);
  const [filePickerQuery, setFilePickerQuery] = useState("");
  const [dragging, setDragging] = useState<
    { id: string; mode: "move" | "resize"; pointerId: number; x: number; y: number; origin: LayoutPos; dx: number; dy: number; next: LayoutPos } | null
  >(null);

  const maxY = useMemo(
    () => data.widgets.reduce((max, widget) => Math.max(max, widget.layout.y + widget.layout.h), 0),
    [data.widgets],
  );

  const updateWidget = useCallback(
    (nextWidget: DashboardWidget) => {
      onChange({
        widgets: data.widgets.map((widget) => (widget.id === nextWidget.id ? nextWidget : widget)),
      });
    },
    [data.widgets, onChange],
  );

  const recordRecentFile = useCallback((fileName: string, content: string, mode: MarkdownMode) => {
    if (!fileName.trim()) return;
    setRecentFiles((items) => [
      { id: `${fileName}-${Date.now()}`, fileName, content, mode, updatedAt: new Date() },
      ...items.filter((item) => item.fileName !== fileName).slice(0, 29),
    ]);
  }, []);

  useEffect(() => {
    if (seededRecentFilesRef.current) return;
    seededRecentFilesRef.current = true;
    data.widgets.forEach((widget) => {
      if (widget.type !== "file") return;
      const widgetFileName = typeof widget.config.fileName === "string" ? widget.config.fileName : "";
      const widgetContent = typeof widget.config.content === "string" ? widget.config.content : "";
      const widgetMode = widget.config.mode === "preview" || widget.config.mode === "wysiwyg" || widget.config.mode === "raw"
        ? widget.config.mode
        : readFileMode(widgetFileName);
      if (widgetFileName && widgetContent) recordRecentFile(widgetFileName, widgetContent, widgetMode);
    });
  }, [data.widgets, recordRecentFile]);

  const updateFileWidget = useCallback(
    (widgetId: string, next: Record<string, unknown>) => {
      const widget = data.widgets.find((item) => item.id === widgetId);
      if (!widget) return;
      const nextConfig = { ...widget.config, ...next };
      updateWidget({ ...widget, config: nextConfig });

      const nextFileName = typeof nextConfig.fileName === "string" ? nextConfig.fileName : "";
      const nextContent = typeof nextConfig.content === "string" ? nextConfig.content : "";
      const nextMode = nextConfig.mode === "preview" || nextConfig.mode === "wysiwyg" || nextConfig.mode === "raw" ? nextConfig.mode : readFileMode(nextFileName);
      if (nextFileName && nextContent) recordRecentFile(nextFileName, nextContent, nextMode);
    },
    [data.widgets, recordRecentFile, updateWidget],
  );

  const openFilePicker = useCallback(
    (targetId?: string) => {
      const fallbackTarget = data.widgets.find((widget) => widget.type === "file")?.id;
      const nextTargetId = targetId ?? fallbackTarget;
      if (nextTargetId) {
        setFilePickerTargetId(nextTargetId);
        setFilePickerQuery("");
        return;
      }

      const nextWidget = widgetDefaults("file", maxY);
      onChange({ widgets: [...data.widgets, nextWidget] });
      onEditModeChange(true);
      setFilePickerTargetId(nextWidget.id);
      setFilePickerQuery("");
    },
    [data.widgets, maxY, onChange, onEditModeChange],
  );

  const applyPickedFile = useCallback(
    (fileName: string, content: string, mode: MarkdownMode) => {
      if (!filePickerTargetId) return;
      updateFileWidget(filePickerTargetId, { fileName, content, mode });
      setFilePickerTargetId(null);
      setFilePickerQuery("");
    },
    [filePickerTargetId, updateFileWidget],
  );

  const getGridMetrics = useCallback(() => {
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect) return { cellW: 96, cellH: ROW_HEIGHT };
    return {
      cellW: (rect.width - GAP * (COLS - 1)) / COLS,
      cellH: ROW_HEIGHT,
    };
  }, []);

  const layoutForPointer = useCallback(
    (event: PointerEvent, current: NonNullable<typeof dragging>) => {
      const { cellW, cellH } = getGridMetrics();
      const dxPx = event.clientX - current.x;
      const dyPx = event.clientY - current.y;
      const dx = Math.round(dxPx / (cellW + GAP));
      const dy = Math.round(dyPx / (cellH + GAP));
      const next = current.mode === "move"
        ? clampLayout({ ...current.origin, x: current.origin.x + dx, y: current.origin.y + dy })
        : clampLayout({ ...current.origin, w: current.origin.w + dx, h: current.origin.h + dy });
      return { dxPx, dyPx, next };
    },
    [getGridMetrics],
  );

  const commitPointer = useCallback(
    (event?: PointerEvent) => {
      if (!dragging) return;
      const nextLayout = event ? layoutForPointer(event, dragging).next : dragging.next;
      const widget = data.widgets.find((item) => item.id === dragging.id);
      if (widget) updateWidget({ ...widget, layout: nextLayout });
      setDragging(null);
    },
    [data.widgets, dragging, layoutForPointer, updateWidget],
  );

  useEffect(() => {
    if (!dragging) return;
    const onMove = (event: PointerEvent) => {
      setDragging((current) => {
        if (!current || event.pointerId !== current.pointerId) return current;
        const { dxPx, dyPx, next } = layoutForPointer(event, current);
        return { ...current, dx: dxPx, dy: dyPx, next };
      });
    };
    const onUp = (event: PointerEvent) => commitPointer(event);
    const onCancel = () => commitPointer();
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    window.addEventListener("pointercancel", onCancel, { once: true });
    window.addEventListener("blur", onCancel, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("blur", onCancel);
    };
  }, [commitPointer, dragging, layoutForPointer]);

  const addWidget = (type: DashboardWidget["type"]) => {
    onChange({ widgets: [...data.widgets, widgetDefaults(type, maxY)] });
    setPaletteOpen(false);
    onEditModeChange(true);
  };

  useEffect(() => {
    if (addWidgetRequest > 0) setPaletteOpen(true);
  }, [addWidgetRequest]);

  useEffect(() => {
    if (openFilePickerRequest > 0) openFilePicker();
  }, [openFilePicker, openFilePickerRequest]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (!meta || event.key.toLowerCase() !== "p") return;
      event.preventDefault();
      openFilePicker();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openFilePicker]);

  const markdownModes: Array<{ key: MarkdownMode; label: string; icon: LucideIcon }> = [
    { key: "preview", label: "Preview", icon: Eye },
    { key: "wysiwyg", label: "WYSIWYG", icon: PenLine },
    { key: "raw", label: "Raw", icon: Code },
  ];

  const markdownActions = [
    { id: "new", label: "New", icon: FilePlus },
    { id: "open", label: "File", icon: FolderOpen },
    { id: "save", label: "Save", icon: Save },
    { id: "export", label: "Export", icon: Download },
    { id: "history", label: "History", icon: History },
  ];

  return (
    <section className="dashboard-shell">
      <input
        ref={pickerInputRef}
        type="file"
        className="hidden-input"
        accept=".md,.markdown,.html,.htm,.pdf,.txt,text/markdown,text/html,text/plain,application/pdf,*/*"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) readPickedFile(file, applyPickedFile);
          event.currentTarget.value = "";
        }}
      />
      <div className="dashboard-scroll">
        <div
          ref={gridRef}
          className="dashboard-grid"
          style={{
            gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))`,
            gridAutoRows: `${ROW_HEIGHT}px`,
            gap: GAP,
          }}
        >
          {data.widgets.map((widget) => (
            (() => {
              const widgetFileName = typeof widget.config.fileName === "string" ? widget.config.fileName : fileName;
              const widgetContent = typeof widget.config.content === "string" ? widget.config.content : documentMarkdown;
              const widgetMode = widget.config.mode === "preview" || widget.config.mode === "wysiwyg" || widget.config.mode === "raw"
                ? widget.config.mode
                : readFileMode(widgetFileName);
              const fileIsMarkdown = widgetFileName.toLowerCase().endsWith(".md") || widgetFileName.toLowerCase().endsWith(".markdown");
              const updateFileConfig = (next: Record<string, unknown>) => updateFileWidget(widget.id, next);
              const handleAction = (id: string) => {
                if (id === "new") {
                  updateFileConfig({ fileName: "untitled.md", content: "# Untitled\n\n", mode: "wysiwyg" });
                } else if (id === "open") {
                  openFilePicker(widget.id);
                } else if (id === "save") {
                  onSaveDocument();
                } else if (id === "export") {
                  downloadFile(widgetFileName, widgetContent);
                } else if (id === "history") {
                  onHistoryClick();
                }
              };

              return (
            <article
              key={widget.id}
              className={`dashboard-widget ${editMode ? "editing" : ""} ${dragging?.id === widget.id ? "interacting" : ""}`}
              style={{
                gridColumn: `${widget.layout.x + 1} / span ${widget.layout.w}`,
                gridRow: `${widget.layout.y + 1} / span ${widget.layout.h}`,
                transform: dragging?.id === widget.id && dragging.mode === "move" ? `translate(${dragging.dx}px, ${dragging.dy}px)` : undefined,
                width: dragging?.id === widget.id && dragging.mode === "resize"
                  ? `${dragging.next.w * getGridMetrics().cellW + (dragging.next.w - 1) * GAP}px`
                  : undefined,
                height: dragging?.id === widget.id && dragging.mode === "resize"
                  ? `${dragging.next.h * getGridMetrics().cellH + (dragging.next.h - 1) * GAP}px`
                  : undefined,
                touchAction: dragging?.id === widget.id ? "none" : undefined,
              }}
            >
              {editMode && (
                <button
                  type="button"
                  className="dashboard-move-handle"
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    setDragging({
                      id: widget.id,
                      mode: "move",
                      pointerId: event.pointerId,
                      x: event.clientX,
                      y: event.clientY,
                      origin: widget.layout,
                      dx: 0,
                      dy: 0,
                      next: widget.layout,
                    });
                  }}
                  title="Move"
                >
                  <GripVertical size={15} />
                </button>
              )}
              <header className="dashboard-widget-header">
                {widget.type === "file" ? (
                  <div className="markdown-widget-header-main">
                    <input
                      value={widgetFileName}
                      onChange={(event) => updateFileConfig({ fileName: event.target.value })}
                      className="widget-filename-input"
                      aria-label="File name"
                    />
                  </div>
                ) : (
                  <strong>{widget.title}</strong>
                )}
                {widget.type === "file" && (
                  <div className="markdown-widget-controls">
                    {fileIsMarkdown && (
                      <div className="widget-mode-group">
                        {markdownModes.map((item) => {
                          const Icon = item.icon;
                          return (
                            <button
                              key={item.key}
                              type="button"
                              className={`widget-header-button ${widgetMode === item.key ? "active" : ""}`}
                              onClick={() => updateFileConfig({ mode: item.key })}
                              title={item.label}
                            >
                              <Icon size={15} />
                              <span>{item.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                    <div className="widget-action-group">
                      {markdownActions.map((item) => {
                        const Icon = item.icon;
                        return (
                          <button key={item.id} type="button" className="widget-icon-button" onClick={() => handleAction(item.id)} title={item.label}>
                            <Icon size={15} />
                          </button>
                        );
                      })}
                    </div>
                    <div className="widget-more">
                      <button
                        type="button"
                        className="widget-icon-button"
                        onClick={() => setMoreOpenId((id) => (id === widget.id ? null : widget.id))}
                        title="More"
                      >
                        <MoreHorizontal size={16} />
                      </button>
                      {moreOpenId === widget.id && (
                        <>
                          <button type="button" className="widget-more-scrim" onClick={() => setMoreOpenId(null)} aria-label="Close menu" />
                          <div className="widget-more-menu">
                            {fileIsMarkdown && markdownModes.map((item) => {
                              const Icon = item.icon;
                              return (
                                <button
                                  key={item.key}
                                  type="button"
                                  onClick={() => {
                                    updateFileConfig({ mode: item.key });
                                    setMoreOpenId(null);
                                  }}
                                >
                                  <Icon size={15} />
                                  <span>{item.label}</span>
                                </button>
                              );
                            })}
                            {fileIsMarkdown && <div className="widget-more-separator" />}
                            {markdownActions.map((item) => {
                              const Icon = item.icon;
                              return (
                                <button
                                  key={item.id}
                                  type="button"
                                  onClick={() => {
                                    handleAction(item.id);
                                    setMoreOpenId(null);
                                  }}
                                >
                                  <Icon size={15} />
                                  <span>{item.label}</span>
                                </button>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}
                {editMode && (
                  <div className="dashboard-widget-tools">
                    <button
                      type="button"
                      onClick={() => onChange({ widgets: data.widgets.filter((item) => item.id !== widget.id) })}
                      title="Delete"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                )}
              </header>
              <div className="dashboard-widget-body">
                <WidgetBody
                  widget={widget}
                  fallbackFileName={fileName}
                  fallbackContent={documentMarkdown}
                  isDark={isDark}
                  onConfigChange={(config) => updateFileWidget(widget.id, config)}
                />
              </div>
              {editMode && (
                <button
                  type="button"
                  className="dashboard-resize"
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    setDragging({
                      id: widget.id,
                      mode: "resize",
                      pointerId: event.pointerId,
                      x: event.clientX,
                      y: event.clientY,
                      origin: widget.layout,
                      dx: 0,
                      dy: 0,
                      next: widget.layout,
                    });
                  }}
                  title="Resize"
                >
                  <Maximize2 size={13} />
                </button>
              )}
            </article>
              );
            })()
          ))}
        </div>
      </div>

      {paletteOpen && (
        <div className="dashboard-modal-backdrop" onClick={() => setPaletteOpen(false)}>
          <div className="dashboard-palette" onClick={(event) => event.stopPropagation()}>
            <strong>Add widget</strong>
            <div className="dashboard-palette-grid">
              {widgetDefs.map((def) => {
                const Icon = def.icon;
                return (
                  <button key={def.type} type="button" onClick={() => addWidget(def.type)}>
                    <Icon size={22} />
                    <span>{def.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {filePickerTargetId && (
        <FilePickerDialog
          query={filePickerQuery}
          recentFiles={recentFiles}
          onQueryChange={setFilePickerQuery}
          onBrowse={() => pickerInputRef.current?.click()}
          onSelect={(file) => applyPickedFile(file.fileName, file.content, file.mode)}
          onClose={() => setFilePickerTargetId(null)}
        />
      )}
    </section>
  );
}
