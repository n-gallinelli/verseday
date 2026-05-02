import { useState } from "react";
import { PRESET_COLORS } from "../db/queries";
import Button from "./Button";

const PALETTE = PRESET_COLORS.slice(0, 8);
const MAX_NAME_LENGTH = 100;

interface NewProjectPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string, color: string) => void;
  activeColors?: string[];
}

function pickDefaultColor(activeColors: string[]): string {
  const used = new Set(activeColors);
  return PALETTE.find((c) => !used.has(c)) ?? PALETTE[0];
}

export default function NewProjectPanel({
  isOpen,
  onClose,
  onCreate,
  activeColors = [],
}: NewProjectPanelProps) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(() => pickDefaultColor(activeColors));

  function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreate(trimmed, color);
    setName("");
    setColor(pickDefaultColor(activeColors));
    onClose();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleCreate();
    }
    if (e.key === "Escape") {
      onClose();
    }
  }

  return (
    <div
      className={`absolute top-0 right-0 h-full w-[260px] bg-elevated border-l border-line-soft flex flex-col z-10 transition-transform duration-200 ${
        isOpen ? "translate-x-0" : "translate-x-full"
      }`}
      onKeyDown={handleKeyDown}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-[18px] pt-4 pb-3.5 border-b border-line-hairline flex-shrink-0">
        <span className="text-[14px] font-medium text-fg">
          New project
        </span>
        <button
          onClick={onClose}
          className="w-6 h-6 rounded-md bg-overlay-hover border border-line-soft flex items-center justify-center text-[13px] text-fg-muted cursor-pointer hover:bg-overlay-pressed"
        >
          ✕
        </button>
      </div>

      {/* Body */}
      <div className="px-[18px] py-4 flex flex-col gap-[14px] flex-1">
        {/* Name */}
        <div>
          <label className="text-[11px] text-fg-secondary mb-[5px] block">
            Project name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={MAX_NAME_LENGTH}
            placeholder="e.g. Q2 launch, Website redesign..."
            autoFocus={isOpen}
            className="w-full bg-base border border-line-medium rounded-lg px-[10px] py-2 text-[13px] text-fg outline-none focus:border-accent-blue/40 focus:bg-elevated placeholder-fg-faded"
          />
        </div>

        {/* Color */}
        <div>
          <label className="text-[11px] text-fg-secondary mb-[5px] block">
            Color
          </label>
          <div className="flex items-center gap-[7px] flex-wrap">
            {PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className="w-[22px] h-[22px] rounded-full cursor-pointer border-2"
                style={{
                  backgroundColor: c,
                  borderColor:
                    color === c ? "var(--border-strong)" : "transparent",
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-[18px] py-[14px] border-t border-line-hairline flex-shrink-0">
        <Button size="sm" className="w-full" onClick={handleCreate}>Create project</Button>
      </div>
    </div>
  );
}
