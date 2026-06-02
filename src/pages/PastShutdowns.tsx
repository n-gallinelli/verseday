import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { getCompletedShutdowns, type CompletedShutdown } from "../db/queries";
import { selectAllProjects, useAppStore } from "../stores/appStore";
import PastShutdownCard from "../components/PastShutdownCard";

export default function PastShutdowns() {
  const setPage = useAppStore((s) => s.setPage);
  const [shutdowns, setShutdowns] = useState<CompletedShutdown[]>([]);
  const projects = useAppStore(useShallow((s) => selectAllProjects(s)));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const s = await getCompletedShutdowns();
        if (!active) return;
        setShutdowns(s);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  return (
    <div className="flex flex-col h-full bg-base">
      <div className="px-7 pt-6 pb-4 border-b border-line-soft flex-shrink-0">
        <button
          onClick={() => setPage("dashboard")}
          className="text-[12px] text-fg-faded hover:text-fg-secondary cursor-pointer mb-1.5 flex items-center gap-1 transition-colors"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 2L3 5l3 3" />
          </svg>
          Dashboard
        </button>
        <h1 className="text-[22px] font-medium text-fg leading-tight font-display">
          Past shutdowns
        </h1>
        <p className="text-[12px] text-fg-faded mt-1">
          {loading ? "Loading…" : shutdowns.length === 0 ? "No shutdowns yet" : `${shutdowns.length} ${shutdowns.length === 1 ? "shutdown" : "shutdowns"}`}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[680px] mx-auto px-7 py-6">
          {loading ? (
            <p className="text-[13px] text-fg-faded">Loading shutdowns…</p>
          ) : shutdowns.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-[14px] text-fg-secondary mb-1">Nothing here yet</p>
              <p className="text-[12px] text-fg-faded">
                Complete a daily shutdown to start building your archive.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {shutdowns.map((s) => (
                <PastShutdownCard
                  key={s.date}
                  date={s.date}
                  mood={s.mood}
                  reflection={s.reflection}
                  tasksDone={s.tasksDone}
                  workedMinutes={s.workedMinutes}
                  projects={projects}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
