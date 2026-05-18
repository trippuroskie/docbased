"use client";

import * as React from "react";
import Link from "next/link";
import { Search, X, FileText, Paperclip, Loader2 } from "lucide-react";
import { Dialog, DialogPortal, DialogOverlay } from "@/components/ui/dialog";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { cn } from "@/lib/utils";
import type { SearchHit } from "@/lib/search";

type Space = { id: string; name: string; color: string };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spaces: Space[];
  onSelectDoc: (docId: string) => void;
  onOpenDocInNewTab: (docId: string) => void;
};

type SearchResponse = {
  hits: SearchHit[];
  grouped: Record<string, { name: string; hits: SearchHit[] }>;
  totals: Record<string, number>;
};

type RecentSearch = { query: string; ts: number };

const RECENT_KEY = "kb:recent-searches";
const RECENT_MAX = 10;
const DEBOUNCE_MS = 200;
const LOADER_DELAY_MS = 150;

function readRecent(): RecentSearch[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e): e is RecentSearch =>
          !!e &&
          typeof e === "object" &&
          typeof (e as RecentSearch).query === "string" &&
          typeof (e as RecentSearch).ts === "number",
      )
      .slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

function writeRecent(entries: RecentSearch[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(entries.slice(0, RECENT_MAX)));
  } catch {
    // ignore
  }
}

function saveRecent(query: string): RecentSearch[] {
  const trimmed = query.trim();
  if (!trimmed) return readRecent();
  const existing = readRecent();
  const lower = trimmed.toLowerCase();
  const filtered = existing.filter((e) => e.query.toLowerCase() !== lower);
  const next = [{ query: trimmed, ts: Date.now() }, ...filtered].slice(
    0,
    RECENT_MAX,
  );
  writeRecent(next);
  return next;
}

function clearRecent() {
  try {
    localStorage.removeItem(RECENT_KEY);
  } catch {
    // ignore
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Wraps every case-insensitive occurrence of `query` in <mark> so the matches
// pop visually. Works for partial matches as the user is still typing.
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const re = new RegExp(`(${escapeRegExp(q)})`, "gi");
  const parts = text.split(re);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark
            key={i}
            className="bg-yellow-300/80 text-foreground dark:bg-yellow-400/40 dark:text-foreground rounded-[2px] px-0.5"
          >
            {part}
          </mark>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        ),
      )}
    </>
  );
}

export function SearchOverlay({
  open,
  onOpenChange,
  spaces,
  onSelectDoc,
  onOpenDocInNewTab,
}: Props) {
  const [query, setQuery] = React.useState("");
  const [activeSpaceId, setActiveSpaceId] = React.useState<string | null>(null);
  const [data, setData] = React.useState<SearchResponse | null>(null);
  const [pending, setPending] = React.useState(false);
  const [showLoader, setShowLoader] = React.useState(false);
  const [highlightIndex, setHighlightIndex] = React.useState(0);
  const [recent, setRecent] = React.useState<RecentSearch[]>([]);

  const inputRef = React.useRef<HTMLInputElement>(null);
  const requestSeq = React.useRef(0);
  const loaderTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refresh recent searches whenever the overlay opens and reset transient state.
  React.useEffect(() => {
    if (!open) return;
    setRecent(readRecent());
    setHighlightIndex(0);
    // Focus the input after the dialog mounts. Base UI handles focus traps,
    // so a short timeout avoids fighting it.
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open]);

  // Reset query/results when closing so reopening is a clean slate.
  React.useEffect(() => {
    if (open) return;
    setQuery("");
    setData(null);
    setActiveSpaceId(null);
    setPending(false);
    setShowLoader(false);
    if (loaderTimer.current) {
      clearTimeout(loaderTimer.current);
      loaderTimer.current = null;
    }
  }, [open]);

  // Debounced fetch.
  React.useEffect(() => {
    const q = query.trim();
    if (!q) {
      setData(null);
      setPending(false);
      setShowLoader(false);
      if (loaderTimer.current) {
        clearTimeout(loaderTimer.current);
        loaderTimer.current = null;
      }
      return;
    }
    const handle = setTimeout(() => {
      const seq = ++requestSeq.current;
      setPending(true);
      // Only show the spinner if the request takes longer than LOADER_DELAY_MS,
      // so quick responses don't flicker.
      if (loaderTimer.current) clearTimeout(loaderTimer.current);
      loaderTimer.current = setTimeout(() => {
        if (requestSeq.current === seq) setShowLoader(true);
      }, LOADER_DELAY_MS);

      const url = new URL("/api/search", window.location.origin);
      url.searchParams.set("q", q);
      url.searchParams.set("limit", "30");

      fetch(url.toString())
        .then((r) => (r.ok ? r.json() : Promise.reject(r)))
        .then((json: SearchResponse) => {
          if (requestSeq.current !== seq) return;
          setData(json);
          setHighlightIndex(0);
        })
        .catch(() => {
          if (requestSeq.current !== seq) return;
          setData({ hits: [], grouped: {}, totals: { all: 0 } });
        })
        .finally(() => {
          if (requestSeq.current !== seq) return;
          setPending(false);
          setShowLoader(false);
          if (loaderTimer.current) {
            clearTimeout(loaderTimer.current);
            loaderTimer.current = null;
          }
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query]);

  // Visible groups respect the active space chip.
  const visibleGroups = React.useMemo(() => {
    if (!data) return [] as Array<{ id: string; name: string; hits: SearchHit[] }>;
    const entries = Object.entries(data.grouped).map(([id, g]) => ({
      id,
      name: g.name,
      hits: g.hits,
    }));
    if (activeSpaceId) return entries.filter((e) => e.id === activeSpaceId);
    return entries;
  }, [data, activeSpaceId]);

  // Flat list of hits in render order — keyboard nav uses indices into this.
  const flatHits = React.useMemo(() => {
    return visibleGroups.flatMap((g) => g.hits);
  }, [visibleGroups]);

  React.useEffect(() => {
    if (highlightIndex >= flatHits.length) setHighlightIndex(0);
  }, [flatHits, highlightIndex]);

  const handleSelect = React.useCallback(
    (hit: SearchHit, openInNewTab: boolean) => {
      if (query.trim()) setRecent(saveRecent(query));
      if (openInNewTab) onOpenDocInNewTab(hit.documentId);
      else onSelectDoc(hit.documentId);
      onOpenChange(false);
    },
    [query, onSelectDoc, onOpenDocInNewTab, onOpenChange],
  );

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (flatHits.length === 0) return;
        setHighlightIndex((i) => (i + 1) % flatHits.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (flatHits.length === 0) return;
        setHighlightIndex((i) => (i - 1 + flatHits.length) % flatHits.length);
      } else if (e.key === "Enter") {
        if (flatHits.length === 0) return;
        e.preventDefault();
        const hit = flatHits[highlightIndex];
        if (hit) handleSelect(hit, e.metaKey || e.ctrlKey);
      }
    },
    [flatHits, highlightIndex, handleSelect],
  );

  const totals = data?.totals ?? {};
  const hasQuery = query.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Popup
          data-slot="dialog-content"
          className={cn(
            "fixed top-[12vh] left-1/2 z-50 w-full max-w-2xl -translate-x-1/2 rounded-xl bg-popover text-popover-foreground ring-1 ring-foreground/10 shadow-2xl outline-none",
            "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95",
            "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            "max-w-[calc(100%-2rem)] sm:max-w-2xl",
          )}
        >
          <DialogPrimitive.Title className="sr-only">Search</DialogPrimitive.Title>
          <div className="flex items-center gap-2 px-4 border-b border-border h-14">
            <Search className="size-5 text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search documents…"
              className="flex-1 h-12 bg-transparent border-0 outline-none text-base font-medium placeholder:text-muted-foreground"
              autoComplete="off"
              spellCheck={false}
            />
            {showLoader && (
              <Loader2 className="size-4 text-muted-foreground animate-spin shrink-0" />
            )}
            <button
              onClick={() => onOpenChange(false)}
              className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 px-4 py-3 border-b border-border">
            <FilterChip
              label="All Results"
              count={hasQuery ? totals.all ?? 0 : null}
              active={activeSpaceId === null}
              onClick={() => setActiveSpaceId(null)}
            />
            {spaces.map((s) => (
              <FilterChip
                key={s.id}
                label={s.name}
                count={hasQuery ? totals[s.id] ?? 0 : null}
                active={activeSpaceId === s.id}
                onClick={() =>
                  setActiveSpaceId((cur) => (cur === s.id ? null : s.id))
                }
                colorDot={s.color}
              />
            ))}
          </div>

          <div className="max-h-[55vh] overflow-y-auto">
            {!hasQuery && (
              <RecentSearches
                recent={recent}
                onPick={(q) => {
                  setQuery(q);
                  inputRef.current?.focus();
                }}
                onClear={() => {
                  clearRecent();
                  setRecent([]);
                }}
              />
            )}

            {hasQuery && data && visibleGroups.length === 0 && !pending && (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                No matches in your accessible spaces.
              </p>
            )}

            {hasQuery && visibleGroups.length > 0 && (
              <div className="py-2">
                {visibleGroups.map((g) => {
                  const startIdx = flatHits.indexOf(g.hits[0]);
                  return (
                    <div key={g.id} className="mb-2">
                      <div className="flex items-center justify-between px-4 py-1.5">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {g.name}
                        </span>
                        <Link
                          href={`/search?q=${encodeURIComponent(query)}&space=${g.id}`}
                          onClick={() => onOpenChange(false)}
                          className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
                        >
                          All &gt;
                        </Link>
                      </div>
                      <div>
                        {g.hits.map((hit, i) => {
                          const idx = startIdx + i;
                          return (
                            <ResultRow
                              key={hit.documentId}
                              hit={hit}
                              query={query}
                              highlighted={idx === highlightIndex}
                              onHover={() => setHighlightIndex(idx)}
                              onClick={(e) =>
                                handleSelect(hit, e.metaKey || e.ctrlKey)
                              }
                              onDoubleClick={() => handleSelect(hit, true)}
                            />
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </DialogPrimitive.Popup>
      </DialogPortal>
    </Dialog>
  );
}

function FilterChip({
  label,
  count,
  active,
  onClick,
  colorDot,
}: {
  label: string;
  count: number | null;
  active: boolean;
  onClick: () => void;
  colorDot?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "bg-secondary text-foreground hover:bg-secondary/80",
      )}
    >
      {colorDot && (
        <span className={cn("size-2 rounded-full shrink-0", colorDot)} />
      )}
      <span>{label}</span>
      {count !== null && (
        <span
          className={cn(
            "inline-flex items-center justify-center min-w-5 h-5 rounded-full px-1 text-[10px] font-semibold",
            active
              ? "bg-primary-foreground/20 text-primary-foreground"
              : "bg-background/60 text-muted-foreground",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function ResultRow({
  hit,
  query,
  highlighted,
  onHover,
  onClick,
  onDoubleClick,
}: {
  hit: SearchHit;
  query: string;
  highlighted: boolean;
  onHover: () => void;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
}) {
  const subtitle =
    hit.headingPath.length > 0
      ? hit.headingPath.join(" › ")
      : hit.content.slice(0, 160);
  const Icon = hit.content ? FileText : Paperclip;
  return (
    <button
      onMouseEnter={onHover}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={cn(
        "w-full flex items-center gap-3 px-4 py-2 text-left transition-colors",
        highlighted ? "bg-secondary" : "hover:bg-secondary/60",
      )}
    >
      <div className="size-8 rounded-md bg-secondary/60 flex items-center justify-center shrink-0">
        <Icon className="size-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-foreground truncate">
          <Highlight text={hit.documentTitle} query={query} />
        </p>
        <p className="text-xs text-muted-foreground truncate line-clamp-1">
          <Highlight text={subtitle} query={query} />
        </p>
      </div>
    </button>
  );
}

function RecentSearches({
  recent,
  onPick,
  onClear,
}: {
  recent: RecentSearch[];
  onPick: (q: string) => void;
  onClear: () => void;
}) {
  if (recent.length === 0) {
    return (
      <p className="px-4 py-10 text-center text-sm text-muted-foreground">
        Type to search across your documents.
      </p>
    );
  }
  return (
    <div className="py-2">
      <div className="flex items-center justify-between px-4 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Recent searches
        </span>
        <button
          onClick={onClear}
          className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
        >
          Clear all
        </button>
      </div>
      <div>
        {recent.slice(0, 8).map((r) => (
          <button
            key={`${r.ts}-${r.query}`}
            onClick={() => onPick(r.query)}
            className="w-full flex items-center gap-3 px-4 py-2 text-left text-sm hover:bg-secondary/60 transition-colors"
          >
            <Search className="size-4 text-muted-foreground shrink-0" />
            <span className="truncate">{r.query}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
