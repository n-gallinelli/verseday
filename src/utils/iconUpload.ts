// Custom-icon upload → safe PNG data URI.
//
// SECURITY (Verse binding condition): the raw uploaded bytes are NEVER
// persisted or rendered. Every upload is re-rasterized through a canvas and
// re-encoded to PNG, which strips any SVG/script payload (the XSS vector for
// user-supplied images). A pre-decode size guard rejects multi-MB inputs before
// we ever decode, so a huge file can't OOM the resize.

/** Reject inputs larger than this before decoding. Icons are tiny; this is a
 *  generous ceiling that still blocks accidental multi-MB uploads. */
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB
/** Output icon box (contain-fit, preserves aspect). */
const ICON_PX = 64;

/**
 * Read an image File, resize to ≤64×64 (centered, aspect-preserved), and
 * re-encode to a PNG data URI. Throws on oversized / non-image / decode errors.
 */
export async function fileToIconDataUri(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Please choose an image file.");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error("Image is too large (max 5 MB).");
  }

  // Decode via an object URL → HTMLImageElement (never trust the raw bytes
  // beyond this decode; the canvas re-encode below is what we persist).
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Could not read that image."));
      el.src = objectUrl;
    });

    // SVGs (and some images) can report 0 intrinsic size — fall back to a
    // square so they fill the box instead of drawing 1×1 (blank).
    const iw = img.naturalWidth || img.width || ICON_PX;
    const ih = img.naturalHeight || img.height || ICON_PX;
    const scale = Math.min(ICON_PX / iw, ICON_PX / ih, 1);
    const w = Math.max(1, Math.round(iw * scale));
    const h = Math.max(1, Math.round(ih * scale));

    const canvas = document.createElement("canvas");
    canvas.width = ICON_PX;
    canvas.height = ICON_PX;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable.");
    // Centered in the 64×64 box (transparent padding).
    ctx.drawImage(img, (ICON_PX - w) / 2, (ICON_PX - h) / 2, w, h);

    try {
      return canvas.toDataURL("image/png");
    } catch {
      // toDataURL throws on a tainted canvas (e.g. an SVG referencing external
      // resources). Re-encoding is mandatory for safety, so we surface a clear
      // error rather than ever storing the raw bytes.
      throw new Error("Couldn't process that image — try a PNG, or an SVG without external references.");
    }
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
