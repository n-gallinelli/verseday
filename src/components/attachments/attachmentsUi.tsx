import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../../stores/appStore";
import { getAttachmentData } from "../../db/queries";
import {
  fileToAttachmentPayload,
  imageFilesFromClipboard,
  formatAttachmentSize,
} from "../../utils/attachmentUpload";
import type { Attachment, AttachmentOwnerType } from "../../types";

// Attachments v2 — shared UI for the Task + Objective detail panels (one
// component set, parameterized by owner). Notes/Attachments live in a tab
// switcher; the WHOLE detail panel is a drop target with a warm full-panel
// overlay. Presentational + a metadata store-count read — no DB/schema change.
//
// Palette: warm sunset (`--accent-orange` family), never blue. Blob discipline
// unchanged from v1 (Verse C1/C2): lists carry metadata only; the base64 blob
// is fetched on demand for exactly one attachment, only on open, discarded after.

const EMPTY: Attachment[] = [];

// ── Controller: owns load / ingest / remove + busy/error, shared by the list
//    (button + paste) AND the full-panel drop (Verse: single ingest path). ──
export interface AttachmentsController {
  ownerType: AttachmentOwnerType;
  ownerId: number;
  list: Attachment[];
  count: number;
  busy: boolean;
  error: string | null;
  setError: (e: string | null) => void;
  ingest: (files: File[]) => Promise<void>;
  remove: (id: number) => void;
}

export function useAttachmentsController(
  ownerType: AttachmentOwnerType,
  ownerId: number
): AttachmentsController {
  const key = `${ownerType}:${ownerId}`;
  const list = (useAppStore((s) => s.attachmentsByOwner.get(key)) ?? EMPTY) as Attachment[];
  const loadAttachments = useAppStore((s) => s.loadAttachments);
  const addAttachment = useAppStore((s) => s.addAttachment);
  const removeAttachment = useAppStore((s) => s.removeAttachment);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadAttachments(ownerType, ownerId);
  }, [ownerType, ownerId, loadAttachments]);

  const ingest = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setError(null);
      setBusy(true);
      try {
        for (const file of files) {
          const p = await fileToAttachmentPayload(file);
          await addAttachment({
            ownerType,
            ownerId,
            filename: p.filename,
            mime: p.mime,
            sizeBytes: p.sizeBytes,
            data: p.dataUri,
          });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not add that file.");
      } finally {
        setBusy(false);
      }
    },
    [ownerType, ownerId, addAttachment]
  );

  const remove = useCallback(
    (id: number) => removeAttachment(id, ownerType, ownerId),
    [ownerType, ownerId, removeAttachment]
  );

  return { ownerType, ownerId, list, count: list.length, busy, error, setError, ingest, remove };
}

// ── Full-panel drop: whole detail panel is the target (Verse §3 guards). ──
export function useAttachmentDrop(
  ingest: (files: File[]) => Promise<void> | void,
  onDropped?: () => void
) {
  const [isDragging, setIsDragging] = useState(false);
  const depth = useRef(0);

  // Window guard: a file dropped anywhere we don't handle makes the webview
  // navigate to file://… and blanks the app. Swallow stray file drag/drop.
  useEffect(() => {
    const prevent = (e: DragEvent) => {
      if (Array.from(e.dataTransfer?.types ?? []).includes("Files")) e.preventDefault();
    };
    window.addEventListener("dragover", prevent);
    window.addEventListener("drop", prevent);
    return () => {
      window.removeEventListener("dragover", prevent);
      window.removeEventListener("drop", prevent);
    };
  }, []);

  // Only react to FILE drags — internal RichTextEditor text/selection drags
  // don't carry "Files", so the overlay never shows and the RTE keeps native
  // drag/drop (Verse: the clean fix to the hijack concern).
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files");

  const onDragEnter = useCallback((e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth.current += 1;
    setIsDragging(true);
  }, []);
  const onDragOver = useCallback((e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    try {
      e.dataTransfer.dropEffect = "copy";
    } catch {
      /* readonly in some engines */
    }
  }, []);
  const onDragLeave = useCallback((e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    // Depth counter defeats child dragenter/leave flicker.
    depth.current -= 1;
    if (depth.current <= 0) {
      depth.current = 0;
      setIsDragging(false);
    }
  }, []);
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setIsDragging(false);
      const files = Array.from(e.dataTransfer.files ?? []);
      if (files.length === 0) return;
      onDropped?.(); // switch to Attachments so the result (or error) lands in view
      void ingest(files);
    },
    [ingest, onDropped]
  );

  return {
    isDragging,
    dropHandlers: { onDragEnter, onDragOver, onDragLeave, onDrop },
  };
}

// ── Full-panel drop overlay. pointer-events:none ALWAYS so it can never become
//    a dragleave source; the panel root under it owns the handlers. ──
export function AttachmentDropOverlay({ visible }: { visible: boolean }) {
  return (
    <div
      aria-hidden
      className={`absolute inset-0 z-40 flex items-center justify-center pointer-events-none transition-opacity duration-150 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
      style={{ background: "color-mix(in srgb, var(--accent-orange) 9%, transparent)" }}
    >
      <div
        className="absolute inset-3 rounded-2xl"
        style={{ border: "1.5px dashed var(--accent-orange)" }}
      />
      <div className="relative flex items-center gap-2 text-accent-orange font-medium text-[15px]">
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 3v10M6 9l4 4 4-4M4 16h12" />
        </svg>
        Drop to attach
      </div>
    </div>
  );
}

function iconFor(mime: string, filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (mime.startsWith("image/")) return "🖼️";
  if (mime.startsWith("audio/")) return "🎵";
  if (mime.startsWith("video/")) return "🎬";
  if (mime === "application/pdf" || ext === "pdf") return "📄";
  if (["doc", "docx", "pages", "txt", "rtf", "md"].includes(ext)) return "📝";
  if (["xls", "xlsx", "numbers", "csv", "tsv"].includes(ext)) return "📊";
  if (["zip", "dmg", "gz", "tar", "rar", "7z"].includes(ext)) return "🗜️";
  return "📎";
}

// ── The list itself: no dashed box, no per-item card (Verse §2). Clean rows,
//    generous spacing, quiet empty prompt, inline "+ Add file". ──
export function AttachmentList({ controller }: { controller: AttachmentsController }) {
  const { list, ingest, remove, error, busy } = controller;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [lightbox, setLightbox] = useState<{ filename: string; dataUri: string } | null>(null);

  async function open(att: Attachment) {
    try {
      const rec = await getAttachmentData(att.id);
      if (!rec) return;
      if (rec.mime.startsWith("image/")) {
        setLightbox({ filename: rec.filename, dataUri: rec.data });
        return;
      }
      const comma = rec.data.indexOf(",");
      const base64 = comma >= 0 ? rec.data.slice(comma + 1) : rec.data;
      await invoke("open_attachment", { id: att.id, filename: rec.filename, base64 });
    } catch (err) {
      console.error("[attachments] open failed", err);
    }
  }

  return (
    <div
      tabIndex={0}
      onPaste={(e) => {
        const files = imageFilesFromClipboard(e.nativeEvent);
        if (files.length > 0) {
          e.preventDefault();
          void ingest(files);
        }
      }}
      className="outline-none"
    >
      {list.length > 0 ? (
        <ul className="flex flex-col">
          {list.map((att) => (
            <li
              key={att.id}
              className="group flex items-center gap-3 py-2 px-1.5 -mx-1.5 rounded-md hover:bg-input-hover transition-colors"
            >
              <button
                type="button"
                onClick={() => open(att)}
                className="flex-1 min-w-0 flex items-center gap-3 text-left cursor-pointer"
                title={`Open ${att.filename}`}
              >
                <span className="shrink-0 text-[15px] leading-none" aria-hidden>
                  {iconFor(att.mime, att.filename)}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-fg-secondary">
                  {att.filename}
                </span>
                <span className="shrink-0 text-[11px] text-fg-faded tabular-nums">
                  {formatAttachmentSize(att.size_bytes)}
                </span>
              </button>
              <button
                type="button"
                onClick={() => remove(att.id)}
                className="shrink-0 text-fg-faded opacity-0 group-hover:opacity-100 hover:text-fg-primary transition-opacity cursor-pointer px-1"
                title="Remove attachment"
                aria-label={`Remove ${att.filename}`}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-fg-faded py-1">Drop a screenshot or file here.</p>
      )}

      <div className="mt-2.5">
        <button
          type="button"
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
          className="text-[12px] text-accent-orange-soft-fg hover:text-accent-orange cursor-pointer disabled:opacity-50 transition-colors"
        >
          {busy ? "Adding…" : "+ Add file"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            void ingest(files);
          }}
        />
      </div>

      {error && <div className="mt-2 text-[12px] text-danger">{error}</div>}

      {lightbox && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-8"
          onClick={() => setLightbox(null)}
          role="dialog"
          aria-modal="true"
          aria-label={lightbox.filename}
        >
          <img
            src={lightbox.dataUri}
            alt={lightbox.filename}
            className="max-h-full max-w-full rounded-md shadow-2xl object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

// ── Notes / Attachments tab switcher. Warm underline active state, no blue,
//    arrow-key nav, aria tab roles. Both panes stay mounted (crossfade + keeps
//    the notes editor alive); inactive pane is absolute + faded + inert. ──
export function NotesAttachmentsTabs({
  active,
  onChange,
  controller,
  notes,
}: {
  active: "notes" | "attachments";
  onChange: (t: "notes" | "attachments") => void;
  controller: AttachmentsController;
  notes: React.ReactNode;
}) {
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      onChange(active === "notes" ? "attachments" : "notes");
    }
  };

  const tab = (id: "notes" | "attachments", label: string, count?: number) => {
    const selected = active === id;
    return (
      <button
        role="tab"
        aria-selected={selected}
        tabIndex={selected ? 0 : -1}
        onClick={() => onChange(id)}
        className={`relative uppercase [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)] pb-1.5 cursor-pointer transition-colors ${
          selected ? "text-accent-orange" : "text-fg-faded hover:text-fg-muted"
        }`}
      >
        {label}
        {count ? <span className="ml-1.5 font-normal opacity-70 tabular-nums normal-case">{count}</span> : null}
        {selected && (
          <span className="absolute left-0 right-0 -bottom-px h-0.5 rounded-full bg-accent-orange" />
        )}
      </button>
    );
  };

  return (
    <div>
      <div role="tablist" aria-label="Notes and attachments" onKeyDown={onKeyDown} className="flex items-center gap-6 mb-4">
        {tab("notes", "Notes")}
        {tab("attachments", "Attachments", controller.count)}
      </div>
      {/* Both panes share one grid cell so the container is ALWAYS the taller
          pane's height — the panel never changes height when you switch tabs
          (both stay in layout; only opacity toggles). */}
      <div role="tabpanel" className="grid">
        <div
          style={{ gridArea: "1 / 1" }}
          className={`transition-opacity duration-150 ${
            active === "notes" ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
          aria-hidden={active !== "notes"}
        >
          {notes}
        </div>
        <div
          style={{ gridArea: "1 / 1" }}
          className={`transition-opacity duration-150 ${
            active === "attachments" ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
          aria-hidden={active !== "attachments"}
        >
          <AttachmentList controller={controller} />
        </div>
      </div>
    </div>
  );
}
