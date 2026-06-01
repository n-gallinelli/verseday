import { useEffect, useRef, useState, type ChangeEvent } from "react";
import type { Project } from "../types";
import { createCustomIcon } from "../db/queries";
import { fileToIconDataUri } from "../utils/iconUpload";
import { useCustomIcons } from "../hooks/useCustomIcons";
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

  const hasIcon = !!project.icon || project.custom_icon_id != null;

  return (
    <div ref={wrapRef} className="relative flex-shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Set objective icon"
        className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-overlay-hover transition-colors cursor-pointer"
      >
        <ProjectGlyph project={project} iconsById={byId} size={18} />
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

          {list.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-fg-faded mb-1">Your icons</div>
              <div className="grid grid-cols-6 gap-1.5">
                {list.map((ic) => (
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
          )}

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
