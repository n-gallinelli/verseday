// File/screenshot → attachment payload.
//
// Unlike iconUpload.ts (which canvas-re-encodes to strip SVG/script payloads
// because icons are RENDERED inline), attachments preserve the original bytes:
// arbitrary file types must round-trip intact, and image previews go through an
// <img src="data:…"> tag, where scripts never execute (Verse: "accept all for
// storage — inert base64 is harmless; constrain the OPEN path").
//
// SIZE (Verse C4): the cap is enforced from File.size BEFORE we read the bytes,
// so an oversize file is rejected without ever loading it into memory. The
// stored size_bytes is the RAW pre-base64 size — display metadata only.

/** Per-file ceiling. base64-in-DB bloats the DB + every launch backup, so keep
 *  attachments modest. Verse-approved at 10 MB. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export interface AttachmentPayload {
  filename: string;
  mime: string;
  sizeBytes: number;
  /** "data:<mime>;base64,…" — what lands in attachments.data. */
  dataUri: string;
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Read a File (from a picker or a paste/drop) into an attachment payload.
 * Throws (with a user-facing message) on oversize or read failure. Rejects
 * BEFORE decoding so a huge file can't OOM us.
 */
export async function fileToAttachmentPayload(
  file: File
): Promise<AttachmentPayload> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(
      `That file is too large (${humanSize(file.size)}). Max ${humanSize(
        MAX_ATTACHMENT_BYTES
      )}.`
    );
  }

  const mime = file.type || "application/octet-stream";
  const filename = file.name?.trim() || "attachment";

  const dataUri = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") resolve(result);
      else reject(new Error("Could not read that file."));
    };
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });

  return { filename, mime, sizeBytes: file.size, dataUri };
}

/** Pull image files out of a paste ClipboardEvent (screenshots land here as
 *  synthetic "image.png" blobs). Returns [] when the clipboard has no files. */
export function imageFilesFromClipboard(
  e: ClipboardEvent
): File[] {
  const items = e.clipboardData?.items;
  if (!items) return [];
  const files: File[] = [];
  for (const item of items) {
    if (item.kind === "file") {
      const f = item.getAsFile();
      if (f) files.push(f);
    }
  }
  return files;
}

export { humanSize as formatAttachmentSize };
