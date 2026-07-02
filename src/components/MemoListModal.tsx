import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, FileText, Search, X } from "lucide-react";
import { useI18n } from "../i18n/context";
import { decodeMemoPath } from "../lib/memoPath";
import { listMemoFiles, type MemoListEntry } from "../lib/wailsBackend";

const PAGE_SIZE = 20;

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

// The document path comes from the frontmatter; hash-fallback names (§4.2)
// without frontmatter cannot be resolved and are skipped.
function sourceFor(entry: MemoListEntry): string {
  if (entry.source) return entry.source;
  const memoName = baseName(entry.memoPath).replace(/\.md$/i, "");
  return decodeMemoPath(memoName) ?? "";
}

export function MemoListModal({
  memoDirPath,
  onOpenFile,
  onClose,
}: {
  memoDirPath: string;
  onOpenFile: (path: string) => void;
  onClose: () => void;
}) {
  const { t: tr } = useI18n();
  const [entries, setEntries] = useState<MemoListEntry[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await listMemoFiles(memoDirPath);
        if (!cancelled) setEntries(list);
      } catch (loadError) {
        console.error(loadError);
        if (!cancelled) setError(tr("memoList.loadFailed"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [memoDirPath]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const items = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return (entries ?? [])
      .map((entry) => ({ entry, source: sourceFor(entry) }))
      .filter((item) => item.source)
      .filter((item) => !normalized || baseName(item.source).toLowerCase().includes(normalized))
      .sort((a, b) => b.entry.modTime - a.entry.modTime);
  }, [entries, query]);

  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageItems = items.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  return (
    <div className="memo-list-backdrop" onClick={onClose}>
      <section className="memo-list-modal" onClick={(event) => event.stopPropagation()}>
        <header className="memo-list-header">
          <strong>{tr("memoList.title")}</strong>
          <button type="button" className="icon-button" onClick={onClose} title={tr("common.close")}>
            <X size={18} />
          </button>
        </header>

        <div className="memo-list-search">
          <Search size={16} />
          <input
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
            placeholder={tr("memoList.filterPlaceholder")}
            aria-label={tr("memoList.filterPlaceholder")}
          />
        </div>

        <div className="memo-list-body">
          {error && <div className="memo-list-empty">{error}</div>}
          {!error && entries === null && <div className="memo-list-empty">{tr("common.loading")}</div>}
          {!error && entries !== null && pageItems.length === 0 && (
            <div className="memo-list-empty">{tr("memoList.empty")}</div>
          )}
          {pageItems.map(({ entry, source }) => (
            <button
              key={entry.memoPath}
              type="button"
              className="memo-list-item"
              onClick={() => onOpenFile(source)}
              title={source}
            >
              <FileText size={17} />
              <span className="memo-list-item-main">
                <span className="memo-list-item-name">{baseName(source)}</span>
                <small className="memo-list-item-path">{source}</small>
              </span>
              <small className="memo-list-item-time">{new Date(entry.modTime).toLocaleString()}</small>
            </button>
          ))}
        </div>

        {items.length > PAGE_SIZE && (
          <footer className="memo-list-pager">
            <button
              type="button"
              onClick={() => setPage((value) => Math.max(0, value - 1))}
              disabled={currentPage <= 0}
              title={tr("pdf.prevPage")}
            >
              <ChevronLeft size={15} />
            </button>
            <span>{currentPage + 1} / {pageCount}</span>
            <button
              type="button"
              onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}
              disabled={currentPage >= pageCount - 1}
              title={tr("pdf.nextPage")}
            >
              <ChevronRight size={15} />
            </button>
          </footer>
        )}
      </section>
    </div>
  );
}
