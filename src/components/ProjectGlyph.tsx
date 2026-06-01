import type { Project } from "../types";

/**
 * The objective's visual marker, in resolution order: custom image (if
 * custom_icon_id resolves in the provided library), else emoji (icon), else the
 * color dot. `iconsById` comes from useCustomIcons() — pass it from the surface
 * so custom icons resolve (and refresh on verseday:icons-changed).
 */
export default function ProjectGlyph({
  project,
  iconsById,
  size = 12,
  className = "",
}: {
  project: Pick<Project, "icon" | "custom_icon_id" | "color">;
  iconsById?: Map<number, string>;
  size?: number;
  className?: string;
}) {
  const custom =
    project.custom_icon_id != null ? iconsById?.get(project.custom_icon_id) : undefined;

  if (custom) {
    return (
      <img
        src={custom}
        alt=""
        aria-hidden
        className={`object-contain shrink-0 rounded-[3px] ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }
  if (project.icon) {
    return (
      <span
        aria-hidden
        className={`shrink-0 leading-none inline-flex items-center justify-center ${className}`}
        style={{ fontSize: Math.round(size * 0.95), width: size, height: size }}
      >
        {project.icon}
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className={`rounded-full shrink-0 ${className}`}
      style={{ width: size, height: size, backgroundColor: project.color }}
    />
  );
}
