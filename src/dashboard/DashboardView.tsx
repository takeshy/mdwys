import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  Code,
  Download,
  Eye,
  FileText,
  FilePlus,
  FolderOpen,
  GripVertical,
  History,
  Image,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  PenLine,
  Save,
  Search,
  ZoomIn,
  ZoomOut,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { MarkdownPreview } from "../components/MarkdownPreview";
import { WysiwygEditor } from "../components/WysiwygEditor";
import { epubToHtml, isEpubFileName } from "../lib/epub";
import type { EqualizeLayoutDirection, MarkdownMode } from "../App";
import type { DashboardData, DashboardWidget, LayoutPos } from "./types";

const COLS = 12;
const ROW_HEIGHT = 86;
const MIN_ROW_HEIGHT = 44;
const GAP = 8;
const MAX_WIDGETS = 9;
const DEFAULT_VIEW_FONT_SCALE = 100;
const MIN_VIEW_FONT_SCALE = 70;
const MAX_VIEW_FONT_SCALE = 240;
const VIEW_FONT_STEP = 10;
const DEFAULT_VIEW_WIDTH_SCALE = 100;
const MIN_VIEW_WIDTH_SCALE = 70;
const MAX_VIEW_WIDTH_SCALE = 180;
const VIEW_WIDTH_STEP = 10;
const BASE_VIEW_CONTENT_WIDTH = 1120;

const widgetDefs = [
  { type: "file" as const, label: "File", icon: FileText, size: { w: 7, h: 5 } },
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

function isImageFileName(fileName: string) {
  return /\.(avif|bmp|gif|jpe?g|png|svg|webp)$/i.test(fileName);
}

function readViewFontScale(config: Record<string, unknown>): number {
  const value = typeof config.viewFontScale === "number" ? config.viewFontScale : DEFAULT_VIEW_FONT_SCALE;
  return Math.max(MIN_VIEW_FONT_SCALE, Math.min(MAX_VIEW_FONT_SCALE, value));
}

function nextViewFontScale(current: number, direction: -1 | 1): number {
  return Math.max(MIN_VIEW_FONT_SCALE, Math.min(MAX_VIEW_FONT_SCALE, current + direction * VIEW_FONT_STEP));
}

function readViewWidthScale(config: Record<string, unknown>): number {
  const value = typeof config.viewWidthScale === "number" ? config.viewWidthScale : DEFAULT_VIEW_WIDTH_SCALE;
  return Math.max(MIN_VIEW_WIDTH_SCALE, Math.min(MAX_VIEW_WIDTH_SCALE, value));
}

function nextViewWidthScale(current: number, direction: -1 | 1): number {
  return Math.max(MIN_VIEW_WIDTH_SCALE, Math.min(MAX_VIEW_WIDTH_SCALE, current + direction * VIEW_WIDTH_STEP));
}

function viewContentWidth(scale: number): string {
  return `${Math.round(BASE_VIEW_CONTENT_WIDTH * scale / 100)}px`;
}

function rectIsFree(widgets: DashboardWidget[], x: number, y: number, w: number, h: number) {
  return widgets.every((widget) => {
    const layout = widget.layout;
    return x + w <= layout.x || layout.x + layout.w <= x || y + h <= layout.y || layout.y + layout.h <= y;
  });
}

function nextWidgetLayout(type: DashboardWidget["type"], widgets: DashboardWidget[], direction: EqualizeLayoutDirection): LayoutPos {
  const def = widgetDefs.find((item) => item.type === type) ?? widgetDefs[0];
  const height = widgets.length > 0 && widgets.every((widget) => widget.layout.h === 1) ? 1 : def.size.h;
  const maxY = widgets.reduce((max, widget) => Math.max(max, widget.layout.y + widget.layout.h), 0);

  if (direction === "vertical") return { x: 0, y: maxY, w: COLS, h: height };

  const slotWidth = COLS / 3;
  const candidateRows = [...new Set(widgets.map((widget) => widget.layout.y)), maxY].sort((a, b) => a - b);

  for (const y of candidateRows) {
    for (const x of [0, slotWidth, slotWidth * 2]) {
      if (rectIsFree(widgets, x, y, slotWidth, height)) return { x, y, w: slotWidth, h: height };
    }
  }

  return { x: 0, y: maxY, w: slotWidth, h: height };
}

function widgetDefaults(type: DashboardWidget["type"], widgets: DashboardWidget[], direction: EqualizeLayoutDirection): DashboardWidget {
  const def = widgetDefs.find((item) => item.type === type) ?? widgetDefs[0];

  return {
    id: crypto.randomUUID(),
    type,
    title: def.label,
    layout: nextWidgetLayout(type, widgets, direction),
    config: {},
  };
}

function HtmlDocumentFrame({
  content,
  title,
  fontScale,
  widthScale,
}: {
  content: string;
  title: string;
  fontScale: number;
  widthScale: number;
}) {
  const [url, setUrl] = useState("");
  const frameRef = useRef<HTMLIFrameElement>(null);
  const contentWidth = viewContentWidth(widthScale);

  useEffect(() => {
    if (!content) {
      setUrl("");
      return;
    }

    const blob = new Blob([content], { type: "text/html;charset=utf-8" });
    const nextUrl = URL.createObjectURL(blob);
    setUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [content]);

  const applyViewAdjustments = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;

    doc.documentElement.style.setProperty("--view-font-scale", `${fontScale}%`);
    doc.documentElement.style.setProperty("--view-content-width", contentWidth);
    const styleId = "mdwys-view-adjustments";
    const style = doc.getElementById(styleId) ?? doc.createElement("style");
    style.id = styleId;
    style.textContent = `
      html { font-size: ${fontScale}% !important; }
      body {
        font-size: 1rem !important;
        line-height: 1.75 !important;
        padding-left: clamp(12px, 2vw, 28px) !important;
        padding-right: clamp(12px, 2vw, 28px) !important;
      }
      .epub-book {
        width: min(100%, ${contentWidth}) !important;
        max-width: none !important;
      }
    `;
    if (!style.parentNode) {
      doc.head.appendChild(style);
    }
  }, [contentWidth, fontScale]);

  useEffect(() => {
    applyViewAdjustments();
  }, [applyViewAdjustments]);

  if (!url) return <div className="dashboard-empty">Open an HTML file.</div>;

  return (
    <iframe
      ref={frameRef}
      className="dashboard-web"
      src={url}
      title={title}
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      onLoad={applyViewAdjustments}
      style={{
        ["--view-font-scale" as string]: `${fontScale}%`,
        ["--view-content-width" as string]: contentWidth,
      }}
    />
  );
}

function PdfDocumentFrame({ content, title }: { content: string; title: string }) {
  const [url, setUrl] = useState("");

  useEffect(() => {
    if (!content) {
      setUrl("");
      return;
    }

    const blob = content.startsWith("data:") ? dataUrlToBlob(content) : new Blob([content], { type: "application/pdf" });
    if (!blob) {
      setUrl("");
      return;
    }

    const nextUrl = URL.createObjectURL(blob);
    setUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [content]);

  if (!url) return <div className="dashboard-empty">Open a PDF file.</div>;

  return <iframe className="dashboard-web" src={url} title={title} />;
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
    const viewFontScale = readViewFontScale(widget.config);
    const viewWidthScale = readViewWidthScale(widget.config);
    const lowerName = fileName.toLowerCase();
    const isMarkdown = lowerName.endsWith(".md") || lowerName.endsWith(".markdown");
    const isHtml = lowerName.endsWith(".html") || lowerName.endsWith(".htm");
    const isEpub = isEpubFileName(lowerName);
    const isPdf = lowerName.endsWith(".pdf");
    const isImage = isImageFileName(fileName);

    if (isHtml || isEpub) {
      return <HtmlDocumentFrame content={documentContent} title={fileName} fontScale={viewFontScale} widthScale={viewWidthScale} />;
    }

    if (isImage) {
      return documentContent ? (
        <div className="dashboard-image-frame">
          <img className="dashboard-image" src={documentContent} alt={fileName} />
        </div>
      ) : (
        <div className="dashboard-empty">Open an image file.</div>
      );
    }

    if (isPdf) {
      return <PdfDocumentFrame content={documentContent} title={fileName} />;
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
      return (
        <div
          className="dashboard-scaled-preview"
          style={{
            fontSize: `${viewFontScale}%`,
            ["--view-content-width" as string]: viewContentWidth(viewWidthScale),
          }}
        >
          <MarkdownPreview content={documentContent} isDark={isDark} />
        </div>
      );
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

  return null;
}

function readPickedFile(file: File, onLoad: (fileName: string, content: string, mode: MarkdownMode) => void) {
  if (isEpubFileName(file.name)) {
    epubToHtml(file).then((html) => {
      onLoad(file.name || "document.epub", html, "preview");
    }).catch((error) => {
      console.error(error);
      alert("Could not open this EPUB file.");
    });
    return;
  }

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    onLoad(file.name || "document.txt", String(reader.result ?? ""), readFileMode(file.name));
  });
  if (file.name.toLowerCase().endsWith(".pdf") || isImageFileName(file.name)) reader.readAsDataURL(file);
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
                  {isImageFileName(file.fileName) ? <Image size={18} /> : <FileText size={18} />}
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
  addWidgetRequest,
  activeLayoutDirection,
  equalizeLayoutRequest,
  splitWidgetRequest,
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
  addWidgetRequest: { id: number; direction: EqualizeLayoutDirection };
  activeLayoutDirection: EqualizeLayoutDirection;
  equalizeLayoutRequest: { id: number; direction: EqualizeLayoutDirection };
  splitWidgetRequest: { id: number; direction: EqualizeLayoutDirection };
  openFilePickerRequest: number;
}) {
  const [moreOpenId, setMoreOpenId] = useState<string | null>(null);
  const [maximizedWidgetId, setMaximizedWidgetId] = useState<string | null>(null);
  const [activeWidgetId, setActiveWidgetId] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const pickerInputRef = useRef<HTMLInputElement | null>(null);
  const seededRecentFilesRef = useRef(false);
  const handledAddWidgetRequestRef = useRef(0);
  const handledEqualizeLayoutRequestRef = useRef(0);
  const handledSplitWidgetRequestRef = useRef(0);
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);
  const [filePickerTargetId, setFilePickerTargetId] = useState<string | null>(null);
  const [filePickerCreatesWidget, setFilePickerCreatesWidget] = useState(false);
  const [filePickerCreateDirection, setFilePickerCreateDirection] = useState<EqualizeLayoutDirection>("horizontal");
  const [filePickerQuery, setFilePickerQuery] = useState("");
  const [gridRowHeight, setGridRowHeight] = useState(ROW_HEIGHT);
  const [dragging, setDragging] = useState<
    { id: string; mode: "move" | "resize"; pointerId: number; x: number; y: number; origin: LayoutPos; dx: number; dy: number; next: LayoutPos } | null
  >(null);

  const fitGridRows = useCallback((rows: number) => {
    const safeRows = Math.max(1, rows);
    const availableHeight = gridRef.current?.parentElement?.clientHeight ?? safeRows * (ROW_HEIGHT + GAP);
    setGridRowHeight(Math.max(MIN_ROW_HEIGHT, Math.floor((availableHeight - GAP * (safeRows - 1)) / safeRows)));
  }, []);

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
        setFilePickerCreatesWidget(false);
        setFilePickerQuery("");
        return;
      }

      setFilePickerTargetId(null);
      setFilePickerCreatesWidget(true);
      setFilePickerCreateDirection(activeLayoutDirection);
      setFilePickerQuery("");
    },
    [activeLayoutDirection, data.widgets],
  );

  const getGridMetrics = useCallback(() => {
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect) return { cellW: 96, cellH: gridRowHeight };
    return {
      cellW: (rect.width - GAP * (COLS - 1)) / COLS,
      cellH: gridRowHeight,
    };
  }, [gridRowHeight]);

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

  const buildEqualizedWidgets = useCallback((widgets: DashboardWidget[], direction: EqualizeLayoutDirection) => {
    const count = widgets.length;
    if (count === 0) return widgets;

    const primarySlots = Math.min(3, count);
    const groups = Array.from({ length: primarySlots }, () => [] as DashboardWidget[]);
    widgets.forEach((widget, index) => {
      groups[index % primarySlots].push(widget);
    });
    const maxGroupSize = Math.max(...groups.map((group) => group.length));
    const gridRows = direction === "vertical" ? primarySlots : maxGroupSize;

    setMaximizedWidgetId(null);
    setDragging(null);
    fitGridRows(gridRows);

    const layouts = new Map<string, LayoutPos>();
    groups.forEach((group, primaryIndex) => {
      if (direction === "vertical") {
        const slotWidth = Math.max(1, Math.floor(COLS / group.length));
        group.forEach((widget, groupIndex) => {
          const x = groupIndex * slotWidth;
          const w = groupIndex === group.length - 1 ? COLS - x : slotWidth;
          layouts.set(widget.id, clampLayout({ x, y: primaryIndex, w, h: 1 }));
        });
        return;
      }

      const slotWidth = Math.max(1, Math.floor(COLS / primarySlots));
      const x = primaryIndex * slotWidth;
      const w = primaryIndex === primarySlots - 1 ? COLS - x : slotWidth;
      group.forEach((widget, groupIndex) => {
        layouts.set(widget.id, clampLayout({
          x,
          y: groupIndex,
          w,
          h: group.length === 1 ? maxGroupSize : 1,
        }));
      });
    });

    return widgets.map((widget) => ({
      ...widget,
      layout: layouts.get(widget.id) ?? widget.layout,
    }));
  }, [fitGridRows]);

  const buildSplitWidgets = useCallback((widgets: DashboardWidget[], selectedId: string, direction: EqualizeLayoutDirection) => {
    if (widgets.length <= 1) return widgets;
    const selected = widgets.find((widget) => widget.id === selectedId);
    if (!selected) return widgets;

    const others = widgets.filter((widget) => widget.id !== selectedId);
    const layouts = new Map<string, LayoutPos>();

    setMaximizedWidgetId(null);
    setDragging(null);

    if (direction === "horizontal") {
      const rows = Math.max(1, Math.min(3, others.length));
      const groups = Array.from({ length: rows }, () => [] as DashboardWidget[]);
      others.forEach((widget, index) => groups[index % rows].push(widget));
      fitGridRows(rows);

      layouts.set(selected.id, clampLayout({ x: 8, y: 0, w: 4, h: rows }));
      groups.forEach((group, rowIndex) => {
        const slotWidth = Math.max(1, Math.floor(8 / group.length));
        group.forEach((widget, groupIndex) => {
          const x = groupIndex * slotWidth;
          const w = groupIndex === group.length - 1 ? 8 - x : slotWidth;
          layouts.set(widget.id, clampLayout({ x, y: rowIndex, w, h: 1 }));
        });
      });
    } else {
      const columns = Math.max(1, Math.min(3, others.length));
      const groups = Array.from({ length: columns }, () => [] as DashboardWidget[]);
      others.forEach((widget, index) => groups[index % columns].push(widget));
      const maxGroupSize = Math.max(1, ...groups.map((group) => group.length));
      fitGridRows(maxGroupSize + 1);

      layouts.set(selected.id, clampLayout({ x: 0, y: maxGroupSize, w: COLS, h: 1 }));
      const slotWidth = Math.max(1, Math.floor(COLS / columns));
      groups.forEach((group, columnIndex) => {
        const x = columnIndex * slotWidth;
        const w = columnIndex === columns - 1 ? COLS - x : slotWidth;
        group.forEach((widget, rowIndex) => {
          layouts.set(widget.id, clampLayout({
            x,
            y: rowIndex,
            w,
            h: group.length === 1 ? maxGroupSize : 1,
          }));
        });
      });
    }

    return widgets.map((widget) => ({
      ...widget,
      layout: layouts.get(widget.id) ?? widget.layout,
    }));
  }, [fitGridRows]);

  const buildAddedWidgets = useCallback((widgets: DashboardWidget[], nextWidget: DashboardWidget, direction: EqualizeLayoutDirection) => {
    const layouts = new Map<string, LayoutPos>();
    const FIT_ROWS = 6;

    if (direction === "vertical") {
      const columns = [...new Set(widgets.map((widget) => widget.layout.x))]
        .sort((a, b) => a - b)
        .map((x) => widgets.filter((widget) => widget.layout.x === x).sort((a, b) => a.layout.y - b.layout.y));
      if (columns.length === 0) columns.push([]);

      let targetIndex = columns
        .map((column, index) => ({ index, size: column.length }))
        .filter((item) => item.size < 3)
        .sort((a, b) => a.size - b.size || a.index - b.index)[0]?.index;
      if (targetIndex === undefined && columns.length < 3) {
        columns.push([]);
        targetIndex = columns.length - 1;
      }
      columns[targetIndex ?? 0].push(nextWidget);

      const columnCount = Math.min(3, columns.length);
      const slotWidth = Math.floor(COLS / columnCount);
      columns.slice(0, columnCount).forEach((column, columnIndex) => {
        const itemCount = Math.max(1, Math.min(3, column.length));
        const slotHeight = Math.floor(FIT_ROWS / itemCount);
        const x = columnIndex * slotWidth;
        const w = columnIndex === columnCount - 1 ? COLS - x : slotWidth;
        column.slice(0, 3).forEach((widget, rowIndex) => {
          const y = rowIndex * slotHeight;
          const h = rowIndex === itemCount - 1 ? FIT_ROWS - y : slotHeight;
          layouts.set(widget.id, clampLayout({ x, y, w, h }));
        });
      });
    } else {
      const rows = [...new Set(widgets.map((widget) => widget.layout.y))]
        .sort((a, b) => a - b)
        .map((y) => widgets.filter((widget) => widget.layout.y === y).sort((a, b) => a.layout.x - b.layout.x));
      if (rows.length === 0) rows.push([]);

      let targetIndex = rows
        .map((row, index) => ({ index, size: row.length }))
        .filter((item) => item.size < 3)
        .sort((a, b) => a.size - b.size || a.index - b.index)[0]?.index;
      if (targetIndex === undefined && rows.length < 3) {
        rows.push([]);
        targetIndex = rows.length - 1;
      }
      rows[targetIndex ?? 0].push(nextWidget);

      const rowCount = Math.min(3, rows.length);
      const rowHeight = Math.floor(FIT_ROWS / rowCount);
      rows.slice(0, 3).forEach((row, rowIndex) => {
        const rowCount = Math.min(3, row.length);
        const slotWidth = Math.floor(COLS / Math.max(1, rowCount));
        const y = rowIndex * rowHeight;
        const h = rowIndex === rows.length - 1 ? FIT_ROWS - y : rowHeight;
        row.slice(0, 3).forEach((widget, columnIndex) => {
          const x = columnIndex * slotWidth;
          const w = columnIndex === rowCount - 1 ? COLS - x : slotWidth;
          layouts.set(widget.id, clampLayout({ x, y, w, h }));
        });
      });
    }

    const nextWidgets = [...widgets, nextWidget].map((widget) => ({
      ...widget,
      layout: layouts.get(widget.id) ?? widget.layout,
    }));
    const rows = nextWidgets.reduce((max, widget) => Math.max(max, widget.layout.y + widget.layout.h), 1);
    setMaximizedWidgetId(null);
    setDragging(null);
    fitGridRows(rows);
    return nextWidgets;
  }, [fitGridRows]);

  const applyPickedFile = useCallback(
    (fileName: string, content: string, mode: MarkdownMode) => {
      if (filePickerCreatesWidget) {
        const createDirection = filePickerCreateDirection;
        const nextWidget = {
          ...widgetDefaults("file", data.widgets, createDirection),
          config: { fileName, content, mode },
        };
        onChange({ widgets: buildAddedWidgets(data.widgets, nextWidget, createDirection) });
        recordRecentFile(fileName, content, mode);
        setActiveWidgetId(nextWidget.id);
      } else if (filePickerTargetId) {
        updateFileWidget(filePickerTargetId, { fileName, content, mode });
      }
      setFilePickerTargetId(null);
      setFilePickerCreatesWidget(false);
      setFilePickerCreateDirection(activeLayoutDirection);
      setFilePickerQuery("");
    },
    [activeLayoutDirection, buildAddedWidgets, data.widgets, filePickerCreateDirection, filePickerCreatesWidget, filePickerTargetId, onChange, recordRecentFile, updateFileWidget],
  );

  const addWidget = (type: DashboardWidget["type"], direction: EqualizeLayoutDirection) => {
    if (data.widgets.length >= MAX_WIDGETS) return;
    if (type === "file") {
      setFilePickerTargetId(null);
      setFilePickerCreatesWidget(true);
      setFilePickerCreateDirection(direction);
      setFilePickerQuery("");
    }
  };

  const equalizeLayout = useCallback((direction: EqualizeLayoutDirection) => {
    onChange({ widgets: buildEqualizedWidgets(data.widgets, direction) });
  }, [buildEqualizedWidgets, data.widgets, onChange]);

  useEffect(() => {
    if (addWidgetRequest.id <= handledAddWidgetRequestRef.current) return;
    handledAddWidgetRequestRef.current = addWidgetRequest.id;
    addWidget("file", addWidgetRequest.direction);
  }, [activeLayoutDirection, addWidget, addWidgetRequest]);

  useEffect(() => {
    if (equalizeLayoutRequest.id <= handledEqualizeLayoutRequestRef.current) return;
    handledEqualizeLayoutRequestRef.current = equalizeLayoutRequest.id;
    if (activeWidgetId) {
      onChange({ widgets: buildSplitWidgets(data.widgets, activeWidgetId, equalizeLayoutRequest.direction) });
      return;
    }
    equalizeLayout(equalizeLayoutRequest.direction);
  }, [activeWidgetId, buildSplitWidgets, data.widgets, equalizeLayout, equalizeLayoutRequest, onChange]);

  useEffect(() => {
    if (splitWidgetRequest.id <= handledSplitWidgetRequestRef.current) return;
    handledSplitWidgetRequestRef.current = splitWidgetRequest.id;
    if (!activeWidgetId) return;
    onChange({ widgets: buildSplitWidgets(data.widgets, activeWidgetId, splitWidgetRequest.direction) });
  }, [activeWidgetId, buildSplitWidgets, data.widgets, onChange, splitWidgetRequest]);

  useEffect(() => {
    if (activeWidgetId && !data.widgets.some((widget) => widget.id === activeWidgetId)) {
      setActiveWidgetId(null);
    }
    const rows = data.widgets.reduce((max, widget) => Math.max(max, widget.layout.y + widget.layout.h), 1);
    fitGridRows(rows);
  }, [activeWidgetId, data.widgets, fitGridRows]);

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

  useEffect(() => {
    if (!maximizedWidgetId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMaximizedWidgetId(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [maximizedWidgetId]);

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
        accept=".md,.markdown,.html,.htm,.epub,.pdf,.txt,.png,.jpg,.jpeg,.gif,.webp,.avif,.bmp,.svg,text/markdown,text/html,application/epub+zip,text/plain,application/pdf,image/*,*/*"
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
          onClick={() => setActiveWidgetId(null)}
          style={{
            gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))`,
            gridAutoRows: `${gridRowHeight}px`,
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
              const fileIsHtml = /\.(html?|epub)$/i.test(widgetFileName);
              const viewFontScale = readViewFontScale(widget.config);
              const viewWidthScale = readViewWidthScale(widget.config);
              const canAdjustView = (fileIsMarkdown && widgetMode === "preview") || fileIsHtml;
              const updateFileConfig = (next: Record<string, unknown>) => updateFileWidget(widget.id, next);
              const isMaximized = maximizedWidgetId === widget.id;
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
              const beginMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
                if (isMaximized) return;
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
              };

              return (
            <article
              key={widget.id}
              className={`dashboard-widget ${activeWidgetId === widget.id ? "active" : ""} ${isMaximized ? "maximized" : ""} ${dragging?.id === widget.id ? "interacting" : ""}`}
              style={{
                gridColumn: isMaximized ? undefined : `${widget.layout.x + 1} / span ${widget.layout.w}`,
                gridRow: isMaximized ? undefined : `${widget.layout.y + 1} / span ${widget.layout.h}`,
                transform: !isMaximized && dragging?.id === widget.id && dragging.mode === "move" ? `translate(${dragging.dx}px, ${dragging.dy}px)` : undefined,
                width: !isMaximized && dragging?.id === widget.id && dragging.mode === "resize"
                  ? `${dragging.next.w * getGridMetrics().cellW + (dragging.next.w - 1) * GAP}px`
                  : undefined,
                height: !isMaximized && dragging?.id === widget.id && dragging.mode === "resize"
                  ? `${dragging.next.h * getGridMetrics().cellH + (dragging.next.h - 1) * GAP}px`
                  : undefined,
                touchAction: dragging?.id === widget.id ? "none" : undefined,
              }}
            >
              <header
                className="dashboard-widget-header"
                onClick={(event) => {
                  event.stopPropagation();
                  setActiveWidgetId(widget.id);
                }}
              >
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
                    {canAdjustView && (
                      <div className="widget-font-group">
                        <button
                          type="button"
                          className="widget-icon-button"
                          onClick={() => updateFileConfig({ viewFontScale: nextViewFontScale(viewFontScale, -1) })}
                          title="Decrease font size"
                          disabled={viewFontScale <= MIN_VIEW_FONT_SCALE}
                        >
                          <ZoomOut size={15} />
                        </button>
                        <button
                          type="button"
                          className="widget-icon-button"
                          onClick={() => updateFileConfig({ viewFontScale: nextViewFontScale(viewFontScale, 1) })}
                          title="Increase font size"
                          disabled={viewFontScale >= MAX_VIEW_FONT_SCALE}
                        >
                          <ZoomIn size={15} />
                        </button>
                        <button
                          type="button"
                          className="widget-icon-button"
                          onClick={() => updateFileConfig({ viewWidthScale: nextViewWidthScale(viewWidthScale, -1) })}
                          title="Narrow content"
                          disabled={viewWidthScale <= MIN_VIEW_WIDTH_SCALE}
                        >
                          <Minimize2 size={15} />
                        </button>
                        <button
                          type="button"
                          className="widget-icon-button"
                          onClick={() => updateFileConfig({ viewWidthScale: nextViewWidthScale(viewWidthScale, 1) })}
                          title="Widen content"
                          disabled={viewWidthScale >= MAX_VIEW_WIDTH_SCALE}
                        >
                          <Maximize2 size={15} />
                        </button>
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
                {!isMaximized && (
                  <button type="button" className="dashboard-move-handle" onPointerDown={beginMove} title="Move">
                    <GripVertical size={15} />
                  </button>
                )}
                <div className="dashboard-widget-tools">
                  <button
                    type="button"
                    onClick={() => setMaximizedWidgetId((id) => (id === widget.id ? null : widget.id))}
                    title={isMaximized ? "Restore" : "Maximize"}
                  >
                    {isMaximized ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMaximizedWidgetId((id) => (id === widget.id ? null : id));
                      setActiveWidgetId((id) => (id === widget.id ? null : id));
                      onChange({ widgets: data.widgets.filter((item) => item.id !== widget.id) });
                    }}
                    title="Delete"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
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
              {!isMaximized && (
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

      {(filePickerTargetId || filePickerCreatesWidget) && (
        <FilePickerDialog
          query={filePickerQuery}
          recentFiles={recentFiles}
          onQueryChange={setFilePickerQuery}
          onBrowse={() => pickerInputRef.current?.click()}
          onSelect={(file) => applyPickedFile(file.fileName, file.content, file.mode)}
          onClose={() => {
            setFilePickerTargetId(null);
            setFilePickerCreatesWidget(false);
            setFilePickerCreateDirection(activeLayoutDirection);
          }}
        />
      )}
    </section>
  );
}
