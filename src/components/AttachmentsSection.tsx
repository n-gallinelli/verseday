import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../stores/appStore";
import { getAttachmentData } from "../db/queries";
import {
  fileToAttachmentPayload,
  imageFilesFromClipboard,
  formatAttachmentSize,
} from "../utils/attachmentUpload";
import type { Attachment, AttachmentOwnerType } from "../types";

/**
 * Shared attachments block for Task details AND Objective details (Verse C7:
 * ONE component + ONE store slice, parameterized by owner). Its own section,
 * distinct from Notes.
 *
 * Blob discipline (Verse C1/C2): the list is METADATA only — no thumbnails, so
 * hydrating a detail view never drags any base64. The blob is fetched on demand
 * for exactly one attachment, only when the user opens it (image → in-app
 * lightbox; other → OS default app via the sandboxed `open_attachment`
 * command), and discarded right after.
 */
export function AttachmentsSection({
  ownerType,
  ownerId,
}: {
  ownerType: AttachmentOwnerType;
  ownerId: number;
}) {
  const key = `${ownerType}:${ownerId}`;
  const attachments = useAppStore(
    (s) => s.attachmentsByOwner.get(key)
  ) as Attachment[] | undefined;
  const loadAttachments = useAppStore((s) => s.loadAttachments);
  const addAttachment = useAppStore((s) => s.addAttachment);
  const removeAttachment = useAppStore((s) => s.removeAttachment);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The one blob we ever hold in memory — a single image being previewed.
  const [lightbox, setLightbox] = useState<{
    filename: string;
    dataUri: string;
  } | null>(null);

  useEffect(() => {
    loadAttachments(ownerType, ownerId);
  }, [ownerType, ownerId, loadAttachments]);

  const list = useMemo(() => attachments ?? [], [attachments]);

  async function ingest(files: File[]) {
    if (files.length === 0) return;
    setError(null);
    setBusy(true);
    try {
      for (const file of files) {
        const payload = await fileToAttachmentPayload(file);
        await addAttachment({
          ownerType,
          ownerId,
          filename: payload.filename,
          mime: payload.mime,
          sizeBytes: payload.sizeBytes,
          data: payload.dataUri,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add that file.");
    } finally {
      setBusy(false);
    }
  }

  async function open(att: Attachment) {
    setError(null);
    try {
      const rec = await getAttachmentData(att.id);
      if (!rec) {
        setError("That attachment is no longer available.");
        return;
      }
      if (rec.mime.startsWith("image/")) {
        // In-app lightbox — one blob, held only while open, discarded on close.
        setLightbox({ filename: rec.filename, dataUri: rec.data });
        return;
      }
      // Non-image → hand to the OS via the sandboxed Rust command. Strip the
      // "data:<mime>;base64," prefix; Rust decodes the raw base64.
      const comma = rec.data.indexOf(",");
      const base64 = comma >= 0 ? rec.data.slice(comma + 1) : rec.data;
      await invoke("open_attachment", {
        id: att.id,
        filename: rec.filename,
        base64,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open that file.");
    }
  }

  return (
    <div>
      <div className="uppercase [font-size:var(--font-size-label)] [font-weight:var(--font-weight-label)] [letter-spacing:var(--letter-spacing-label)] text-fg-faded mb-3">
        Attachments
      </div>

      {list.length > 0 && (
        <ul className="flex flex-col gap-1.5 mb-3">
          {list.map((att) => (
            <li
              key={att.id}
              className="group flex items-center gap-2.5 rounded-md bg-elevated px-2.5 py-2 hover:bg-input-hover transition-colors"
            >
              <button
                type="button"
                onClick={() => open(att)}
                className="flex-1 min-w-0 flex items-center gap-2.5 text-left cursor-pointer"
                title={`Open ${att.filename}`}
              >
                <span className="shrink-0 text-fg-faded" aria-hidden>
                  {att.mime.startsWith("image/") ? "🖼️" : "📄"}
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
                onClick={() => removeAttachment(att.id, ownerType, ownerId)}
                className="shrink-0 text-fg-faded opacity-0 group-hover:opacity-100 hover:text-fg-primary transition-opacity cursor-pointer px-1"
                title="Remove attachment"
                aria-label={`Remove ${att.filename}`}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Add zone — click to pick, or focus + paste a screenshot. */}
      <div
        tabIndex={0}
        onPaste={(e) => {
          const files = imageFilesFromClipboard(e.nativeEvent);
          if (files.length > 0) {
            e.preventDefault();
            void ingest(files);
          }
        }}
        className="rounded-md border border-dashed border-border-subtle px-3 py-2.5 text-[12px] text-fg-faded outline-none focus:border-accent-blue transition-colors"
      >
        <button
          type="button"
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
          className="text-fg-secondary hover:text-fg-primary cursor-pointer disabled:opacity-50"
        >
          {busy ? "Adding…" : "+ Add file"}
        </button>
        <span className="ml-2">or click here and paste a screenshot</span>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = ""; // allow re-picking the same file
            void ingest(files);
          }}
        />
      </div>

      {error && (
        <div className="mt-2 text-[12px] text-danger">{error}</div>
      )}

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
