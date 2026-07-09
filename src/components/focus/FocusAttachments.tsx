import { useEffect, useReducer, useRef, useState } from "react";
import { getAttachmentData } from "../../db/queries";
import {
  useAttachmentsController,
  useAttachmentDrop,
  useAttachmentOpener,
  AttachmentDropOverlay,
  type AttachmentsController,
} from "../attachments/attachmentsUi";

// Focus attachments — hover-revealed, minimal footprint. The Focus screen is
// deliberately spartan (task + timer), so this must be invisible at rest and
// only meaningful on hover:
//   • zero attachments → nothing at rest; hovering the strip fades in a faint
//     "drop files here" hint.
//   • N>0 → one quiet "📎 N" line. Hover opens a FLOATING popover (absolute,
//     never reflows notes) with an image-thumbnail grid.
// Drop = the whole Focus content area (see useFocusAttachments consumer), which
// also mounts useAttachmentDrop's window guard — the fix for Focus's latent
// "stray file drop navigates the webview and blanks the app" bug.
//
// Blob discipline (Verse C1–C5): thumbnails lazy-fetch ONLY on popover-open,
// ONLY for image mimes, capped at THUMB_CAP resident blobs, cached per-open so
// re-hover never re-queries SQLite, released on close, and fully reset when
// Focus switches task. Non-images and over-cap images stay glyph-only (no
// fetch). Opens reuse the shared useAttachmentOpener (single lightbox / single
// allowlisted open_attachment path).

const OPEN_DELAY_MS = 180; // C1 — hover-intent gate; a cursor graze fetches nothing
const CLOSE_GRACE_MS = 120; // travel from trigger into the popover must not dismiss
const THUMB_CAP = 6; // C4 — max full-res image blobs ever resident at once

const isImage = (mime: string) => mime.startsWith("image/");

function ClipIcon({ className }: { className?: string }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M13 6.5l-5.6 5.6a2.4 2.4 0 0 1-3.4-3.4l5.9-5.9a1.5 1.5 0 0 1 2.1 2.1l-5.9 5.9a.6.6 0 0 1-.85-.85l5.2-5.2" />
    </svg>
  );
}

function DocGlyph() {
  return (
    <span className="text-fg-warm-muted" aria-hidden>
      <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 1.75H4.25A1.25 1.25 0 0 0 3 3v10a1.25 1.25 0 0 0 1.25 1.25h7.5A1.25 1.25 0 0 0 13 13V5.75z" />
        <path d="M9 1.75V5.75h4" />
      </svg>
    </span>
  );
}

/**
 * Wire attachments into the Focus screen. Call once, unconditionally (owner id
 * -1 when there's no real task, mirroring ProjectDetail). Returns three pieces
 * the Focus layout places:
 *   • rootDropProps — spread on the full-screen Focus content wrapper (drop
 *     target + installs the window drop-guard).
 *   • overlay — the shared warm "Drop to attach" overlay (mid-drag only).
 *   • strip — the collapsed line + hover popover, placed under the hairline.
 */
export function useFocusAttachments(taskId: number) {
  const controller = useAttachmentsController("task", taskId);
  const { isDragging, dropHandlers } = useAttachmentDrop(controller.ingest);

  return {
    rootDropProps: dropHandlers,
    overlay: <AttachmentDropOverlay visible={isDragging} />,
    strip: <FocusAttachmentsStrip controller={controller} taskId={taskId} />,
  };
}

function FocusAttachmentsStrip({
  controller,
  taskId,
}: {
  controller: AttachmentsController;
  taskId: number;
}) {
  const { list, busy, remove } = controller;
  const { open, lightbox } = useAttachmentOpener();

  const [open_, setOpen] = useState(false);
  // Thumbnail cache lives in a ref (avoids a fetch/deps loop); `force` re-renders
  // when a thumb lands. Reset (new Map) on close and on task change.
  const cacheRef = useRef<Map<number, string>>(new Map());
  const [, force] = useReducer((x: number) => x + 1, 0);

  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped whenever we open/close or switch task; an in-flight fetch whose token
  // no longer matches discards its result so task A's thumbs never paint task B.
  const applyToken = useRef(0);

  function clearTimers() {
    if (openTimer.current) {
      clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }

  function requestOpen() {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    if (open_ || openTimer.current) return;
    openTimer.current = setTimeout(() => {
      openTimer.current = null;
      setOpen(true);
    }, OPEN_DELAY_MS);
  }

  function requestClose() {
    if (openTimer.current) {
      clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (!open_ || closeTimer.current) return;
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      setOpen(false);
    }, CLOSE_GRACE_MS);
  }

  // C5 — Focus switches the viewed task constantly (arrow-nav, roll-to-next).
  // Slam everything shut and drop the cache so a stale popover can't linger.
  useEffect(() => {
    clearTimers();
    applyToken.current += 1;
    cacheRef.current = new Map();
    setOpen(false);
    // taskId is the only dep; force() not needed (setOpen re-renders).
  }, [taskId]);

  // C2 — release the cache on close (honors the module's discard discipline).
  useEffect(() => {
    if (!open_) {
      applyToken.current += 1;
      cacheRef.current = new Map();
      force();
    }
  }, [open_]);

  // F1 — when the last attachment is removed the strip swaps to the hint branch,
  // which has no hover handlers, so a still-`open_` popover would be stranded
  // (and would auto-reappear on the next add without a hover). Force it shut.
  useEffect(() => {
    if (list.length === 0) setOpen(false);
  }, [list.length]);

  useEffect(() => () => clearTimers(), []);

  // C1/C2/C3/C4 — on open, fetch ONLY uncached, image-mime, within-cap blobs.
  useEffect(() => {
    if (!open_) return;
    const token = ++applyToken.current;
    let cancelled = false;
    const imgs = list.filter((a) => isImage(a.mime)).slice(0, THUMB_CAP);
    (async () => {
      for (const att of imgs) {
        if (cacheRef.current.has(att.id)) continue; // C2 — never re-query cached
        const rec = await getAttachmentData(att.id); // C3 — images only reach here
        if (cancelled || token !== applyToken.current) return; // C5 — stale guard
        if (rec) {
          cacheRef.current.set(att.id, rec.data);
          force();
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // `list` dep so an attachment dropped while the popover is open thumbnails too.
  }, [open_, list]);

  if (taskId <= 0) return null;

  // Which image ids are allowed a thumbnail (the capped set). Over-cap images and
  // all non-images render glyph-only and are never fetched here.
  const thumbImageIds = new Set(
    list.filter((a) => isImage(a.mime)).slice(0, THUMB_CAP).map((a) => a.id),
  );

  return (
    <div className="w-full pl-10 relative">
      {list.length === 0 ? (
        // Zero layout height so notes sit as close to the hairline as they did
        // before attachments existed (no reserved line, no floating gap). A
        // transparent catch over the hairline→notes gap reveals the faint drop
        // hint on hover without pushing notes down. Drop still works anywhere.
        <div className="group relative h-0 select-none" aria-hidden>
          <div className="absolute left-0 top-0 h-6 w-48" />
          <span className="absolute left-0 top-2 flex items-center gap-1.5 text-[12px] leading-none text-fg-faded opacity-0 group-hover:opacity-60 transition-opacity pointer-events-none whitespace-nowrap">
            <ClipIcon />
            Drop files here
          </span>
        </div>
      ) : (
        <div
          className="inline-block relative mt-1.5"
          onMouseEnter={requestOpen}
          onMouseLeave={requestClose}
        >
          <button
            type="button"
            onClick={() => (open_ ? setOpen(false) : setOpen(true))}
            className="inline-flex items-center gap-1.5 py-1 text-[12px] text-fg-faded opacity-55 hover:opacity-100 transition-opacity cursor-pointer"
            title="Attachments"
          >
            <ClipIcon />
            <span className="tabular-nums">{list.length}</span>
            {busy && (
              <span className="ml-0.5 w-2.5 h-2.5 rounded-full border border-fg-faded border-t-transparent animate-spin" aria-hidden />
            )}
          </button>

          {open_ && (
            <div
              className="absolute left-0 top-full mt-1 z-50 p-2.5 rounded-xl bg-elevated border border-line-soft"
              style={{ boxShadow: "var(--shadow-card)" }}
              onMouseEnter={requestOpen}
              onMouseLeave={requestClose}
              role="dialog"
              aria-label="Attachments"
            >
              <div className="grid grid-cols-4 gap-2 max-w-[268px]">
                {list.map((att) => {
                  const thumb = thumbImageIds.has(att.id)
                    ? cacheRef.current.get(att.id)
                    : undefined;
                  return (
                    <div key={att.id} className="group relative">
                      <button
                        type="button"
                        onClick={() => open(att)}
                        title={att.filename}
                        className="w-[60px] h-[60px] rounded-lg overflow-hidden flex items-center justify-center bg-input-hover border border-line-hairline hover:border-line-soft transition-colors cursor-pointer"
                      >
                        {thumb ? (
                          <img
                            src={thumb}
                            alt={att.filename}
                            draggable={false}
                            className="w-full h-full object-cover select-none"
                          />
                        ) : (
                          <DocGlyph />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(att.id)}
                        title="Remove attachment"
                        aria-label={`Remove ${att.filename}`}
                        className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-elevated border border-line-soft text-fg-faded text-[10px] leading-none flex items-center justify-center opacity-0 group-hover:opacity-100 hover:text-fg-primary transition-opacity cursor-pointer"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {lightbox}
    </div>
  );
}
