import { useEffect, useRef, useState, type ChangeEvent } from "react";
import type { Project } from "../types";
import { createCustomIcon } from "../db/queries";
import { fileToIconDataUri } from "../utils/iconUpload";
import { useCustomIcons } from "../hooks/useCustomIcons";
import { VERSEDAY_ICON_DATA_URI } from "../utils/versedayIcon";
import ProjectGlyph from "./ProjectGlyph";

/**
 * Objective icon picker: type an emoji, pick a previously-uploaded custom icon,
 * or upload a new image. `onPick(icon, customIconId)` persists the choice
 * (one of: emoji+null, null+id, or null+null to clear). Uploads go through the
 * canvas re-encode in fileToIconDataUri — raw bytes are never persisted.
 */
export default function ProjectIconPicker({
  project,
  onPick,
}: {
  project: Pick<Project, "icon" | "custom_icon_id" | "color">;
  onPick: (icon: string | null, customIconId: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [emoji, setEmoji] = useState("");
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { list, byId } = useCustomIcons();

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    try {
      setError(null);
      const data = await fileToIconDataUri(file);
      const id = await createCustomIcon(data);
      onPick(null, id);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    }
  }

  function commitEmoji() {
    const v = emoji.trim();
    if (!v) return;
    onPick(v, null);
    setEmoji("");
    setOpen(false);
  }

  // Built-in VerseDay logo: reuse the existing custom-icon row if one already
  // holds the logo (dedupe by data), otherwise seed one. Either way the choice
  // persists via the normal custom_icon_id path — no new schema/render kind.
  async function pickVerseday() {
    try {
      setError(null);
      const existing = list.find((ic) => ic.data === VERSEDAY_ICON_DATA_URI);
      const id = existing ? existing.id : await createCustomIcon(VERSEDAY_ICON_DATA_URI);
      onPick(null, id);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't set the VerseDay icon");
    }
  }

  const hasIcon = !!project.icon || project.custom_icon_id != null;
  const versedaySelected =
    project.custom_icon_id != null && byId.get(project.custom_icon_id) === VERSEDAY_ICON_DATA_URI;
  // The built-in VerseDay logo leads the "Your icons" grid as a permanent
  // first tile; drop any seeded custom_icons row that holds the same logo so
  // it never shows twice.
  const userIcons = list.filter((ic) => ic.data !== VERSEDAY_ICON_DATA_URI);

  return (
    <div ref={wrapRef} className="relative flex-shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={hasIcon ? "Change objective icon" : "Add an emoji or icon"}
        className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors cursor-pointer ${
          hasIcon
            ? "hover:bg-overlay-hover"
            : "border border-dashed border-line-medium text-fg-faded hover:text-fg-secondary hover:border-line-strong"
        }`}
      >
        {hasIcon ? (
          <ProjectGlyph project={project} iconsById={byId} size={18} />
        ) : (
          /* No icon yet — show a clear "add emoji" glyph (smiley + ＋) so this
             button reads as the icon control, not a second color dot. */
          <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17.5 9.2A7.5 7.5 0 1 1 10.8 2.5" />
            <path d="M7 8.5h.01M12.5 8.5h.01" />
            <path d="M6.8 12.5a4 4 0 0 0 5.4.6" />
            <path d="M16 2v4M18 4h-4" />
          </svg>
        )}
      </button>
      {open && (
        <div
          className="absolute top-full left-0 mt-1 z-30 bg-elevated border border-line-soft rounded-lg p-3 w-[240px] space-y-3"
          style={{ boxShadow: "var(--shadow-card)" }}
        >
          <div>
            <div className="text-[10px] uppercase tracking-wide text-fg-faded mb-1">Emoji</div>
            <div className="flex gap-1.5">
              <input
                value={emoji}
                onChange={(e) => setEmoji(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitEmoji();
                  }
                }}
                placeholder="Type or ⌃⌘Space"
                className="flex-1 bg-base border border-line-medium rounded-md px-2 py-1 text-[14px] text-fg outline-none focus:border-accent-blue placeholder:text-fg-disabled"
              />
              <button
                type="button"
                onClick={commitEmoji}
                className="px-2.5 rounded-md bg-overlay-hover text-[12px] text-fg-secondary hover:bg-overlay-pressed cursor-pointer"
              >
                Set
              </button>
            </div>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wide text-fg-faded mb-1">Your icons</div>
            <div className="grid grid-cols-6 gap-1.5">
              {/* Built-in VerseDay logo — always the first tile. */}
              <button
                type="button"
                onClick={pickVerseday}
                title="VerseDay logo"
                className={`w-7 h-7 rounded-md flex items-center justify-center hover:bg-overlay-hover cursor-pointer ${
                  versedaySelected ? "ring-1 ring-accent-blue" : ""
                }`}
              >
                <img
                  src={VERSEDAY_ICON_DATA_URI}
                  alt=""
                  aria-hidden
                  className="w-5 h-5 object-contain rounded-[3px]"
                />
              </button>
              {userIcons.map((ic) => (
                <button
                  key={ic.id}
                  type="button"
                  onClick={() => {
                    onPick(null, ic.id);
                    setOpen(false);
                  }}
                  className={`w-7 h-7 rounded-md flex items-center justify-center hover:bg-overlay-hover cursor-pointer ${
                    project.custom_icon_id === ic.id ? "ring-1 ring-accent-blue" : ""
                  }`}
                >
                  <img src={ic.data} alt="" className="w-5 h-5 object-contain rounded-[3px]" />
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="text-[12px] text-accent-blue-soft-fg hover:underline cursor-pointer"
            >
              Upload image…
            </button>
            {hasIcon && (
              <button
                type="button"
                onClick={() => {
                  onPick(null, null);
                  setOpen(false);
                }}
                className="text-[12px] text-fg-faded hover:text-accent-destructive cursor-pointer"
              >
                Remove
              </button>
            )}
          </div>

          {error && <div className="text-[11px] text-accent-destructive">{error}</div>}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFile}
          />
        </div>
      )}
    </div>
  );
}
