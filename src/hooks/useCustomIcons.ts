import { useEffect, useState } from "react";
import { getCustomIcons } from "../db/queries";
import { onIconsChanged } from "../utils/iconEvents";
import type { CustomIcon } from "../types";

/**
 * The custom-icon library as both a list (for pickers) and an id→dataURI map
 * (for resolving a project's custom_icon_id at render time). Loads on mount and
 * refreshes on `verseday:icons-changed`, so no surface holds a stale copy
 * (Verse condition: custom icons must resolve everywhere they render).
 */
export function useCustomIcons(): { list: CustomIcon[]; byId: Map<number, string> } {
  const [list, setList] = useState<CustomIcon[]>([]);

  useEffect(() => {
    let mounted = true;
    const load = () => {
      getCustomIcons()
        .then((icons) => {
          if (mounted) setList(icons);
        })
        .catch(() => {});
    };
    load();
    const off = onIconsChanged(load);
    return () => {
      mounted = false;
      off();
    };
  }, []);

  const byId = new Map<number, string>();
  for (const ic of list) byId.set(ic.id, ic.data);
  return { list, byId };
}
