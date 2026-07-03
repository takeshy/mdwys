import { useCallback, useEffect, useRef, useState, type Dispatch, type PointerEvent as ReactPointerEvent, type SetStateAction } from "react";
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
  RefreshCw,
  Save,
  Search,
  ExternalLink,
  SquarePen,
  ZoomIn,
  ZoomOut,
  X,
  type LucideIcon,
} from "lucide-react";
import { useI18n } from "../i18n/context";
import { epubToHtml, isEpubFileName } from "../lib/epub";
import { FileWidgetBody } from "./FileWidgetBody";
import {
  hasWailsBackend,
  listSiblingImageFiles,
  onWailsFileDrop,
  openExternalEditor,
  readLocalFile,
  selectLocalFilePath,
  selectSaveFilePath,
  startupFilePaths,
  writeLocalTextFile,
} from "../lib/wailsBackend";
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
const RECENT_FILES_STORAGE_KEY = "mdwys:recentFiles";
const MAX_RECENT_FILES = 30;

const widgetDefs = [
  { type: "file" as const, label: "File", icon: FileText, size: { w: 7, h: 5 } },
];

interface RecentFile {
  id: string;
  fileName: string;
  filePath: string;
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

async function prepareOpenedContent(fileName: string, content: string): Promise<string> {
  if (!isEpubFileName(fileName)) return content;
  const blob = dataUrlToBlob(content);
  if (!blob) throw new Error("EPUB content was not returned as binary data.");
  return await epubToHtml(new File([blob], fileName || "document.epub", { type: "application/epub+zip" }));
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
  return "preview";
}

function isEditMode(mode: unknown): mode is "wysiwyg" | "raw" {
  return mode === "wysiwyg" || mode === "raw";
}

function isImageFileName(fileName: string) {
  return /\.(avif|bmp|gif|jpe?g|png|svg|webp)$/i.test(fileName);
}

function isWritableTextFileName(fileName: string) {
  return /\.(md|markdown|txt|html?)$/i.test(fileName);
}

function isMarkdownFileName(fileName: string) {
  return /\.(md|markdown)$/i.test(fileName);
}

function markdownTitleFromFileName(fileName: string): string {
  return fileName.replace(/\.(md|markdown)$/i, "") || "untitled";
}

function markdownFileNameFromTitle(title: string): string {
  const safeTitle = title.trim().replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-").replace(/\s+/g, " ").trim() || "untitled";
  return isMarkdownFileName(safeTitle) ? safeTitle : `${safeTitle}.md`;
}

function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function pathBaseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function samePath(left: string, right: string): boolean {
  return left.replaceAll("\\", "/").toLowerCase() === right.replaceAll("\\", "/").toLowerCase();
}

function readStoredRecentFiles(): RecentFile[] {
  try {
    const stored = localStorage.getItem(RECENT_FILES_STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item): RecentFile[] => {
      if (!item || typeof item.fileName !== "string") return [];
      if (typeof item.filePath !== "string" || !item.filePath) return [];
      const mode = item.mode === "preview" || item.mode === "wysiwyg" || item.mode === "raw" ? item.mode : readFileMode(item.fileName);
      return [{
        id: typeof item.id === "string" ? item.id : `${item.filePath}-${Date.now()}`,
        fileName: item.fileName,
        filePath: item.filePath,
        mode,
        updatedAt: item.updatedAt ? new Date(item.updatedAt) : new Date(),
      }];
    }).filter((item) => !Number.isNaN(item.updatedAt.getTime())).slice(0, MAX_RECENT_FILES);
  } catch {
    return [];
  }
}

function persistRecentFiles(items: RecentFile[]) {
  try {
    localStorage.setItem(RECENT_FILES_STORAGE_KEY, JSON.stringify(items.slice(0, MAX_RECENT_FILES).map((item) => ({
      id: item.id,
      fileName: item.fileName,
      filePath: item.filePath,
      mode: item.mode,
      updatedAt: item.updatedAt.toISOString(),
    }))));
  } catch (error) {
    console.warn("Could not persist recent files.", error);
  }
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


function FilePickerDialog({
  query,
  recentFiles,
  onQueryChange,
  onBrowse,
  onNew,
  onSelect,
  onClose,
}: {
  query: string;
  recentFiles: RecentFile[];
  onQueryChange: (value: string) => void;
  onBrowse: () => void;
  onNew: () => void;
  onSelect: (file: RecentFile) => void;
  onClose: () => void;
}) {
  const { t: tr } = useI18n();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredFiles = recentFiles.filter((file) => {
    const searchable = `${file.fileName} ${file.filePath ?? ""}`.toLowerCase();
    return searchable.includes(normalizedQuery);
  });

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

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
              placeholder={tr("picker.searchRecent")}
              aria-label={tr("picker.searchRecent")}
            />
          </div>
          <button type="button" className="file-picker-browse" onClick={onBrowse}>
            <FolderOpen size={16} />
            <span>{tr("common.browse")}</span>
          </button>
          <button type="button" className="file-picker-browse" onClick={onNew}>
            <FilePlus size={16} />
            <span>{tr("widget.new")}</span>
          </button>
          <button type="button" className="file-picker-close" onClick={onClose} title={tr("common.close")}>
            <X size={17} />
          </button>
        </header>

        <div className="file-picker-body">
          <aside className="file-picker-rail">
            <button type="button" className="active">
              {tr("picker.recent")}
            </button>
            <button type="button" onClick={onBrowse}>
              {tr("picker.localFiles")}
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
                <span>{tr("picker.noRecent")}</span>
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
  onExportDocument,
  onHistoryClick,
  isDark,
  addWidgetRequest,
  activeLayoutDirection,
  equalizeLayoutRequest,
  splitWidgetRequest,
  openFilePickerRequest,
  externalEditorPath,
  memoDirPath,
  onOpenSettings,
  openPathRequest,
  onHistoryCheckpoint,
  onDeferredHistoryCheckpoint,
}: {
  data: DashboardData;
  onChange: Dispatch<SetStateAction<DashboardData>>;
  documentMarkdown: string;
  onDocumentMarkdownChange: (value: string) => void;
  markdownMode: MarkdownMode;
  onMarkdownModeChange: (mode: MarkdownMode) => void;
  fileName: string;
  onFileNameChange: (value: string) => void;
  onNewDocument: () => void;
  onExportDocument: () => void;
  onHistoryClick: () => void;
  isDark: boolean;
  addWidgetRequest: { id: number; direction: EqualizeLayoutDirection };
  activeLayoutDirection: EqualizeLayoutDirection;
  equalizeLayoutRequest: { id: number; direction: EqualizeLayoutDirection };
  splitWidgetRequest: { id: number; direction: EqualizeLayoutDirection };
  openFilePickerRequest: number;
  externalEditorPath: string;
  memoDirPath: string;
  onOpenSettings: () => void;
  openPathRequest: { id: number; path: string };
  onHistoryCheckpoint: (reason: "reload") => void;
  onDeferredHistoryCheckpoint: (reason: "reload") => void;
}) {
  const { t: tr } = useI18n();
  const [moreOpenId, setMoreOpenId] = useState<string | null>(null);
  const [maximizedWidgetId, setMaximizedWidgetId] = useState<string | null>(null);
  const [activeWidgetId, setActiveWidgetId] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const seededRecentFilesRef = useRef(false);
  const handledAddWidgetRequestRef = useRef(0);
  const handledOpenPathRequestRef = useRef(0);
  const handledEqualizeLayoutRequestRef = useRef(0);
  const handledSplitWidgetRequestRef = useRef(0);
  const hydratedFilePathsRef = useRef(new Set<string>());
  const handledStartupFilesRef = useRef(false);
  const navigatingImageRef = useRef(false);
  const [startupFileCheckDone, setStartupFileCheckDone] = useState(() => !hasWailsBackend());
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>(() => readStoredRecentFiles());
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
      onChange((current) => ({
        widgets: current.widgets.map((widget) => (widget.id === nextWidget.id ? nextWidget : widget)),
      }));
    },
    [onChange],
  );

  const recordRecentFile = useCallback((fileName: string, mode: MarkdownMode, filePath?: string) => {
    if (!fileName.trim() || !filePath) return;
    setRecentFiles((items) => {
      const next = [
        { id: `${filePath}-${Date.now()}`, fileName, filePath, mode, updatedAt: new Date() },
        ...items.filter((item) => item.filePath !== filePath),
      ].slice(0, MAX_RECENT_FILES);
      persistRecentFiles(next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (seededRecentFilesRef.current) return;
    seededRecentFilesRef.current = true;
    data.widgets.forEach((widget) => {
      if (widget.type !== "file") return;
      const widgetFileName = typeof widget.config.fileName === "string" ? widget.config.fileName : "";
      const widgetFilePath = typeof widget.config.filePath === "string" ? widget.config.filePath : undefined;
      const widgetMode = widget.config.mode === "preview" || widget.config.mode === "wysiwyg" || widget.config.mode === "raw"
        ? widget.config.mode
        : readFileMode(widgetFileName);
      if (widgetFileName && widgetFilePath) recordRecentFile(widgetFileName, widgetMode, widgetFilePath);
    });
  }, [data.widgets, recordRecentFile]);

  const updateFileWidget = useCallback(
    (widgetId: string, next: Record<string, unknown>) => {
      const widget = data.widgets.find((item) => item.id === widgetId);
      if (!widget) return;
      const nextConfig = { ...widget.config, ...next };
      updateWidget({ ...widget, config: nextConfig });

      const nextFileName = typeof nextConfig.fileName === "string" ? nextConfig.fileName : "";
      const nextFilePath = typeof nextConfig.filePath === "string" ? nextConfig.filePath : undefined;
      const nextMode = nextConfig.mode === "preview" || nextConfig.mode === "wysiwyg" || nextConfig.mode === "raw" ? nextConfig.mode : readFileMode(nextFileName);
      if (nextFileName && nextFilePath) recordRecentFile(nextFileName, nextMode, nextFilePath);
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

  const createFileWidget = useCallback(
    (fileName: string, content: string, mode: MarkdownMode, direction: EqualizeLayoutDirection, filePath?: string) => {
      const nextWidgetId = crypto.randomUUID();
      onChange((current) => {
        if (current.widgets.length >= MAX_WIDGETS) return current;
        const nextWidget = {
          ...widgetDefaults("file", current.widgets, direction),
          id: nextWidgetId,
          config: { fileName, filePath, content, mode },
        };
        return { widgets: buildAddedWidgets(current.widgets, nextWidget, direction) };
      });
      recordRecentFile(fileName, mode, filePath);
      setActiveWidgetId(nextWidgetId);
      return nextWidgetId;
    },
    [buildAddedWidgets, onChange, recordRecentFile],
  );

  const openFileInWidget = useCallback(
    (widgetId: string, fileName: string, content: string, mode: MarkdownMode, filePath?: string) => {
      const targetWidget = data.widgets.find((widget) => widget.id === widgetId);
      const nextMode = isEditMode(targetWidget?.config.mode) ? targetWidget.config.mode : mode;
      updateFileWidget(widgetId, { fileName, filePath, content, mode: nextMode });
      setActiveWidgetId(widgetId);
    },
    [data.widgets, updateFileWidget],
  );

  useEffect(() => {
    if (!startupFileCheckDone) return;
    if (!hasWailsBackend()) return;
    data.widgets.forEach((widget) => {
      if (widget.type !== "file") return;
      const fileName = typeof widget.config.fileName === "string" ? widget.config.fileName : "";
      const filePath = typeof widget.config.filePath === "string" ? widget.config.filePath : "";
      const content = typeof widget.config.content === "string" ? widget.config.content : "";
      if (!fileName || !filePath || content) return;

      const hydrateKey = `${widget.id}:${filePath}`;
      if (hydratedFilePathsRef.current.has(hydrateKey)) return;
      hydratedFilePathsRef.current.add(hydrateKey);

      void (async () => {
        try {
          const result = await readLocalFile(filePath);
          if (!result) return;
          const nextContent = await prepareOpenedContent(result.fileName, result.content);
          openFileInWidget(widget.id, result.fileName, nextContent, readFileMode(result.fileName), result.path);
        } catch (error) {
          console.warn("Could not restore local file content.", error);
        }
      })();
    });
  }, [data.widgets, openFileInWidget, startupFileCheckDone]);

  const applyPickedFile = useCallback(
    (fileName: string, content: string, mode: MarkdownMode, filePath?: string) => {
      if (filePickerCreatesWidget) {
        createFileWidget(fileName, content, mode, filePickerCreateDirection, filePath);
      } else if (filePickerTargetId) {
        openFileInWidget(filePickerTargetId, fileName, content, mode, filePath);
      }
      setFilePickerTargetId(null);
      setFilePickerCreatesWidget(false);
      setFilePickerCreateDirection(activeLayoutDirection);
      setFilePickerQuery("");
    },
    [activeLayoutDirection, createFileWidget, filePickerCreateDirection, filePickerCreatesWidget, filePickerTargetId, openFileInWidget],
  );

  const createNewMarkdownFromPicker = useCallback(() => {
    const fileName = "untitled.md";
    const content = "# Untitled\n\n";
    const config = { fileName, fileTitle: "untitled", filePath: undefined, content, mode: "wysiwyg" as MarkdownMode };
    if (filePickerCreatesWidget) {
      const nextWidgetId = crypto.randomUUID();
      onChange((current) => {
        if (current.widgets.length >= MAX_WIDGETS) return current;
        const nextWidget = {
          ...widgetDefaults("file", current.widgets, filePickerCreateDirection),
          id: nextWidgetId,
          config,
        };
        return { widgets: buildAddedWidgets(current.widgets, nextWidget, filePickerCreateDirection) };
      });
      setActiveWidgetId(nextWidgetId);
    } else if (filePickerTargetId) {
      updateFileWidget(filePickerTargetId, config);
      setActiveWidgetId(filePickerTargetId);
    }
    setFilePickerTargetId(null);
    setFilePickerCreatesWidget(false);
    setFilePickerCreateDirection(activeLayoutDirection);
    setFilePickerQuery("");
  }, [activeLayoutDirection, buildAddedWidgets, filePickerCreateDirection, filePickerCreatesWidget, filePickerTargetId, onChange, updateFileWidget]);

  const openPathAsWidget = useCallback(
    async (path: string) => {
      const result = await readLocalFile(path);
      if (!result) return undefined;
      const content = await prepareOpenedContent(result.fileName, result.content);
      return createFileWidget(result.fileName, content, readFileMode(result.fileName), activeLayoutDirection, result.path);
    },
    [activeLayoutDirection, createFileWidget],
  );

  const openPathInWidget = useCallback(
    async (widgetId: string, path: string) => {
      const result = await readLocalFile(path);
      if (!result) return;
      const content = await prepareOpenedContent(result.fileName, result.content);
      openFileInWidget(widgetId, result.fileName, content, readFileMode(result.fileName), result.path);
    },
    [openFileInWidget],
  );

  const saveFileWidget = useCallback(
    async (widgetId: string, fileName: string, content: string, mode: MarkdownMode, filePath: string) => {
      if (filePath ? !isWritableTextFileName(fileName) : !isMarkdownFileName(fileName)) {
        alert(tr("alert.saveTextOnly"));
        return;
      }
      if (!hasWailsBackend()) {
        downloadFile(fileName, content);
        return;
      }

      try {
        const targetPath = filePath || await selectSaveFilePath(fileName || "untitled.md");
        if (!targetPath) return;
        const result = await writeLocalTextFile(targetPath, content);
        if (!result) throw new Error("Save returned no file.");
        updateFileWidget(widgetId, { fileName: result.fileName, filePath: result.path, content: result.content, mode });
        recordRecentFile(result.fileName, mode, result.path);
      } catch (error) {
        console.error(error);
        alert(tr("alert.saveFailed"));
      }
    },
    [recordRecentFile, tr, updateFileWidget],
  );

  const navigateImageSibling = useCallback(
    async (direction: -1 | 1) => {
      if (navigatingImageRef.current) return;
      const imageWidgets = data.widgets.filter((item) => {
        const fileName = typeof item.config.fileName === "string" ? item.config.fileName : "";
        const filePath = typeof item.config.filePath === "string" ? item.config.filePath : "";
        return item.type === "file" && Boolean(filePath) && isImageFileName(fileName);
      });
      const widgetId = activeWidgetId ?? maximizedWidgetId ?? (imageWidgets.length === 1 ? imageWidgets[0].id : null);
      if (!widgetId) return;

      const widget = data.widgets.find((item) => item.id === widgetId);
      if (!widget || widget.type !== "file") return;
      const fileName = typeof widget.config.fileName === "string" ? widget.config.fileName : "";
      const filePath = typeof widget.config.filePath === "string" ? widget.config.filePath : "";
      if (!filePath || !isImageFileName(fileName)) return;

      navigatingImageRef.current = true;
      try {
        const siblings = await listSiblingImageFiles(filePath);
        if (siblings.length < 2) return;
        let currentIndex = siblings.findIndex((path) => samePath(path, filePath));
        if (currentIndex < 0) {
          currentIndex = siblings.findIndex((path) => pathBaseName(path).toLowerCase() === fileName.toLowerCase());
        }
        if (currentIndex < 0) return;
        const nextIndex = (currentIndex + direction + siblings.length) % siblings.length;
        const nextPath = siblings[nextIndex];
        if (!nextPath || nextPath === filePath) return;
        await openPathInWidget(widget.id, nextPath);
      } catch (error) {
        console.warn("Could not navigate image files.", error);
      } finally {
        navigatingImageRef.current = false;
      }
    },
    [activeWidgetId, data.widgets, maximizedWidgetId, openPathInWidget],
  );

  useEffect(() => {
    if (!hasWailsBackend()) {
      setStartupFileCheckDone(true);
      return;
    }
    if (handledStartupFilesRef.current) return;
    handledStartupFilesRef.current = true;

    void (async () => {
      try {
        const paths = await startupFilePaths();
        if (!paths.length) return;

        const openedFiles = [];
        for (const path of paths) {
          try {
            const result = await readLocalFile(path);
            if (!result) continue;
            const content = await prepareOpenedContent(result.fileName, result.content);
            openedFiles.push({ ...result, content, mode: readFileMode(result.fileName) });
          } catch (error) {
            console.warn("Could not open startup file.", error);
          }
        }

        if (!openedFiles.length) return;

        let nextWidgets: DashboardWidget[] = [];
        for (const file of openedFiles.slice(0, MAX_WIDGETS)) {
          const nextWidget = {
            ...widgetDefaults("file", nextWidgets, activeLayoutDirection),
            config: { fileName: file.fileName, filePath: file.path, content: file.content, mode: file.mode },
          };
          nextWidgets = buildAddedWidgets(nextWidgets, nextWidget, activeLayoutDirection);
          recordRecentFile(file.fileName, file.mode, file.path);
        }

        onChange({ widgets: nextWidgets });
        setActiveWidgetId(nextWidgets[0]?.id ?? null);
        setMaximizedWidgetId(nextWidgets[0]?.id ?? null);
      } finally {
        setStartupFileCheckDone(true);
      }
    })();
  }, [activeLayoutDirection, buildAddedWidgets, onChange, recordRecentFile]);

  const browseLocalFile = useCallback(async () => {
    if (hasWailsBackend()) {
      try {
        const path = await selectLocalFilePath();
        if (!path) return;
        setFilePickerTargetId(null);
        setFilePickerCreatesWidget(false);
        setFilePickerCreateDirection(activeLayoutDirection);
        setFilePickerQuery("");

        const result = await readLocalFile(path);
        if (result) {
          const content = await prepareOpenedContent(result.fileName, result.content);
          applyPickedFile(result.fileName, content, readFileMode(result.fileName), result.path);
        }
      } catch (error) {
        console.error(error);
        alert(tr("alert.openFileFailed"));
      }
      return;
    }
    alert(tr("alert.desktopOnly"));
  }, [activeLayoutDirection, applyPickedFile, tr]);

  useEffect(() => {
    if (!hasWailsBackend()) return;
    const dispose = onWailsFileDrop((x, y, paths) => {
      const path = paths[0];
      if (!path) return;
      const target = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-widget-id]");
      const widgetId = target?.dataset.widgetId;
      if (widgetId) {
        void openPathInWidget(widgetId, path);
      } else {
        void openPathAsWidget(path);
      }
    });
    return () => dispose?.();
  }, [openPathAsWidget, openPathInWidget]);

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

  // Open-file requests from outside the dashboard (e.g. the memo list modal).
  useEffect(() => {
    if (openPathRequest.id <= handledOpenPathRequestRef.current) return;
    handledOpenPathRequestRef.current = openPathRequest.id;
    if (!openPathRequest.path) return;
    void (async () => {
      try {
        const widgetId = await openPathAsWidget(openPathRequest.path);
        if (!widgetId) alert(tr("alert.openFileFailed"));
      } catch (error) {
        console.error(error);
        alert(tr("alert.openFromListFailed"));
      }
    })();
  }, [openPathAsWidget, openPathRequest]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
        if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && !isTextEditingTarget(event.target)) {
          event.preventDefault();
          void navigateImageSibling(event.key === "ArrowLeft" ? -1 : 1);
          return;
        }
      }

      const meta = event.metaKey || event.ctrlKey;
      if (!meta) return;
      const key = event.key.toLowerCase();
      if (key === "s") {
        const widgetId = activeWidgetId ?? maximizedWidgetId ?? (data.widgets.length === 1 ? data.widgets[0].id : null);
        const widget = data.widgets.find((item) => item.id === widgetId);
        if (!widget || widget.type !== "file") return;
        const targetFileName = typeof widget.config.fileName === "string" ? widget.config.fileName : fileName;
        const targetFilePath = typeof widget.config.filePath === "string" ? widget.config.filePath : "";
        const targetContent = typeof widget.config.content === "string" ? widget.config.content : documentMarkdown;
        const targetMode = widget.config.mode === "preview" || widget.config.mode === "wysiwyg" || widget.config.mode === "raw"
          ? widget.config.mode
          : readFileMode(targetFileName);
        event.preventDefault();
        void saveFileWidget(widget.id, targetFileName, targetContent, targetMode, targetFilePath);
        return;
      }
      if (key === "p") {
        event.preventDefault();
        openFilePicker();
      }
      if (key === "o") {
        event.preventDefault();
        const nextWidgetId = activeWidgetId ?? data.widgets[0]?.id ?? null;
        if (nextWidgetId) setMaximizedWidgetId(nextWidgetId);
      }
      if (key === "m") {
        event.preventDefault();
        setMaximizedWidgetId(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeWidgetId, data.widgets, documentMarkdown, fileName, maximizedWidgetId, navigateImageSibling, openFilePicker, saveFileWidget]);

  const markdownModes: Array<{ key: MarkdownMode; label: string; icon: LucideIcon }> = [
    { key: "preview", label: "Preview", icon: Eye },
    { key: "wysiwyg", label: "WYSIWYG", icon: PenLine },
    { key: "raw", label: "Raw", icon: Code },
  ];

  const markdownActions = [
    { id: "new", label: tr("widget.new"), icon: FilePlus },
    { id: "open", label: tr("widget.file"), icon: FolderOpen },
    { id: "save", label: tr("widget.save"), icon: Save },
    { id: "export", label: tr("widget.export"), icon: Download },
    { id: "history", label: tr("widget.history"), icon: History },
  ];

  return (
    <section className="dashboard-shell">
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
          {(startupFileCheckDone ? data.widgets : []).map((widget) => (
            (() => {
              const widgetFileName = typeof widget.config.fileName === "string" ? widget.config.fileName : fileName;
              const widgetFilePath = typeof widget.config.filePath === "string" ? widget.config.filePath : "";
              const widgetFileTitle = typeof widget.config.fileTitle === "string" ? widget.config.fileTitle : markdownTitleFromFileName(widgetFileName);
              const widgetContent = typeof widget.config.content === "string" ? widget.config.content : documentMarkdown;
              const widgetMode = widget.config.mode === "preview" || widget.config.mode === "wysiwyg" || widget.config.mode === "raw"
                ? widget.config.mode
                : readFileMode(widgetFileName);
              const fileIsMarkdown = widgetFileName.toLowerCase().endsWith(".md") || widgetFileName.toLowerCase().endsWith(".markdown");
              const fileIsHtml = /\.(html?|epub)$/i.test(widgetFileName);
              const fileIsPdf = /\.pdf$/i.test(widgetFileName);
              const canEditUnsavedMarkdownTitle = !widgetFilePath && fileIsMarkdown;
              const viewFontScale = readViewFontScale(widget.config);
              const viewWidthScale = readViewWidthScale(widget.config);
              const canAdjustView = (fileIsMarkdown && widgetMode === "preview") || fileIsHtml || fileIsPdf;
              const memoPanelOpen = widget.config.memoPanelOpen === true;
              const updateFileConfig = (next: Record<string, unknown>) => updateFileWidget(widget.id, next);
              // §3: without a memo directory the feature is disabled and the
              // icon prompts for settings instead.
              const toggleMemoPanel = () => {
                if (!memoDirPath) {
                  if (confirm(tr("memo.dirPrompt"))) onOpenSettings();
                  return;
                }
                if (!widgetFilePath) {
                  alert(tr("memo.needsLocalFile"));
                  return;
                }
                updateFileConfig({ memoPanelOpen: !memoPanelOpen, memoPanelCollapsed: false });
              };
              const isMaximized = maximizedWidgetId === widget.id;
              const handleAction = (id: string) => {
                if (id === "new") {
                  updateFileConfig({ fileName: "untitled.md", fileTitle: "untitled", filePath: undefined, content: "# Untitled\n\n", mode: "wysiwyg" });
                } else if (id === "open") {
                  openFilePicker(widget.id);
                } else if (id === "save") {
                  void saveFileWidget(widget.id, widgetFileName, widgetContent, widgetMode, widgetFilePath);
                } else if (id === "export") {
                  downloadFile(widgetFileName, widgetContent);
                } else if (id === "history") {
                  onHistoryClick();
                }
              };
              const openInExternalEditor = async () => {
                if (!externalEditorPath || !widgetFilePath) return;
                try {
                  await openExternalEditor(externalEditorPath, widgetFilePath);
                } catch (error) {
                  console.error(error);
                  alert(tr("alert.externalEditorFailed"));
                }
              };
              const reloadFromDisk = async () => {
                if (!widgetFilePath) return;
                try {
                  onHistoryCheckpoint("reload");
                  const result = await readLocalFile(widgetFilePath);
                  if (!result) return;
                  const content = await prepareOpenedContent(result.fileName, result.content);
                  openFileInWidget(widget.id, result.fileName, content, readFileMode(result.fileName), result.path);
                  onDeferredHistoryCheckpoint("reload");
                } catch (error) {
                  console.error(error);
                  alert(tr("alert.reloadFailed"));
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
              data-widget-id={widget.id}
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
                    {canEditUnsavedMarkdownTitle ? (
                      <input
                        className="widget-filename-input"
                        value={widgetFileTitle}
                        onChange={(event) => updateFileConfig({ fileTitle: event.target.value, fileName: markdownFileNameFromTitle(event.target.value) })}
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                        aria-label={tr("widget.fileTitle")}
                      />
                    ) : (
                      <span className="widget-filename-label" title={widgetFileName}>{widgetFileName}</span>
                    )}
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
                          title={tr("widget.decreaseFont")}
                          disabled={viewFontScale <= MIN_VIEW_FONT_SCALE}
                        >
                          <ZoomOut size={15} />
                        </button>
                        <button
                          type="button"
                          className="widget-icon-button"
                          onClick={() => updateFileConfig({ viewFontScale: nextViewFontScale(viewFontScale, 1) })}
                          title={tr("widget.increaseFont")}
                          disabled={viewFontScale >= MAX_VIEW_FONT_SCALE}
                        >
                          <ZoomIn size={15} />
                        </button>
                        <button
                          type="button"
                          className="widget-icon-button"
                          onClick={() => updateFileConfig({ viewWidthScale: nextViewWidthScale(viewWidthScale, -1) })}
                          title={tr("widget.narrow")}
                          disabled={viewWidthScale <= MIN_VIEW_WIDTH_SCALE}
                        >
                          <span className="widget-width-symbol" aria-hidden="true">→←</span>
                        </button>
                        <button
                          type="button"
                          className="widget-icon-button"
                          onClick={() => updateFileConfig({ viewWidthScale: nextViewWidthScale(viewWidthScale, 1) })}
                          title={tr("widget.widen")}
                          disabled={viewWidthScale >= MAX_VIEW_WIDTH_SCALE}
                        >
                          <span className="widget-width-symbol" aria-hidden="true">←→</span>
                        </button>
                      </div>
                    )}
                    <div className="widget-action-group">
                      <button
                        type="button"
                        className={`widget-icon-button ${memoPanelOpen ? "active" : ""}`}
                        onClick={toggleMemoPanel}
                        title={tr("widget.memoTimeline")}
                      >
                        <SquarePen size={15} />
                      </button>
                      <button
                        type="button"
                        className="widget-icon-button"
                        onClick={openInExternalEditor}
                        title={widgetFilePath ? tr("widget.externalEditorOpen") : tr("widget.openLocalFirst")}
                        disabled={!externalEditorPath || !widgetFilePath}
                      >
                        <ExternalLink size={15} />
                      </button>
                      <button
                        type="button"
                        className="widget-icon-button"
                        onClick={reloadFromDisk}
                        title={widgetFilePath ? tr("widget.reload") : tr("widget.openLocalFirst")}
                        disabled={!widgetFilePath}
                      >
                        <RefreshCw size={15} />
                      </button>
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
                        title={tr("widget.more")}
                      >
                        <MoreHorizontal size={16} />
                      </button>
                      {moreOpenId === widget.id && (
                        <>
                          <button type="button" className="widget-more-scrim" onClick={() => setMoreOpenId(null)} aria-label="Close menu" />
                          <div className="widget-more-menu">
                            <button
                              type="button"
                              onClick={() => {
                                toggleMemoPanel();
                                setMoreOpenId(null);
                              }}
                            >
                              <SquarePen size={15} />
                              <span>{tr("widget.memoTimeline")}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                void openInExternalEditor();
                                setMoreOpenId(null);
                              }}
                              disabled={!externalEditorPath || !widgetFilePath}
                            >
                              <ExternalLink size={15} />
                              <span>{tr("widget.externalEditor")}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                void reloadFromDisk();
                                setMoreOpenId(null);
                              }}
                              disabled={!widgetFilePath}
                            >
                              <RefreshCw size={15} />
                              <span>{tr("widget.reloadShort")}</span>
                            </button>
                            {canAdjustView && (
                              <>
                                <div className="widget-more-separator" />
                                <button
                                  type="button"
                                  onClick={() => updateFileConfig({ viewFontScale: nextViewFontScale(viewFontScale, -1) })}
                                  disabled={viewFontScale <= MIN_VIEW_FONT_SCALE}
                                >
                                  <ZoomOut size={15} />
                                  <span>{tr("widget.decreaseFont")}</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => updateFileConfig({ viewFontScale: nextViewFontScale(viewFontScale, 1) })}
                                  disabled={viewFontScale >= MAX_VIEW_FONT_SCALE}
                                >
                                  <ZoomIn size={15} />
                                  <span>{tr("widget.increaseFont")}</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => updateFileConfig({ viewWidthScale: nextViewWidthScale(viewWidthScale, -1) })}
                                  disabled={viewWidthScale <= MIN_VIEW_WIDTH_SCALE}
                                >
                                  <span className="widget-width-symbol" aria-hidden="true">→←</span>
                                  <span>{tr("widget.narrow")}</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => updateFileConfig({ viewWidthScale: nextViewWidthScale(viewWidthScale, 1) })}
                                  disabled={viewWidthScale >= MAX_VIEW_WIDTH_SCALE}
                                >
                                  <span className="widget-width-symbol" aria-hidden="true">←→</span>
                                  <span>{tr("widget.widen")}</span>
                                </button>
                              </>
                            )}
                            <div className="widget-more-separator" />
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
                  <button type="button" className="dashboard-move-handle" onPointerDown={beginMove} title={tr("widget.move")}>
                    <GripVertical size={15} />
                  </button>
                )}
                <div className="dashboard-widget-tools">
                  <button
                    type="button"
                    onClick={() => setMaximizedWidgetId((id) => (id === widget.id ? null : widget.id))}
                    title={isMaximized ? tr("widget.restoreSize") : tr("widget.maximize")}
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
                    title={tr("widget.close")}
                  >
                    <X size={15} />
                  </button>
                </div>
              </header>
              <div className="dashboard-widget-body">
                {widget.type === "file" && (
                  <FileWidgetBody
                    widget={widget}
                    fallbackFileName={fileName}
                    fallbackContent={documentMarkdown}
                    isDark={isDark}
                    onConfigChange={(config) => updateFileWidget(widget.id, config)}
                    memoDirPath={memoDirPath}
                    onOpenPath={(path) => void openPathAsWidget(path)}
                  />
                )}
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
                  title={tr("widget.resize")}
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
          onBrowse={browseLocalFile}
          onNew={createNewMarkdownFromPicker}
          onSelect={async (file) => {
            setFilePickerTargetId(null);
            setFilePickerCreatesWidget(false);
            setFilePickerCreateDirection(activeLayoutDirection);
            setFilePickerQuery("");
            const result = await readLocalFile(file.filePath);
            if (!result) return;
            const content = await prepareOpenedContent(result.fileName, result.content);
            applyPickedFile(result.fileName, content, readFileMode(result.fileName), result.path);
          }}
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
