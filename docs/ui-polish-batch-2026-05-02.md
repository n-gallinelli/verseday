# UI Polish Batch — 2026-05-02

Seven UI tweaks bundled together. Each group ships in its own commit and pauses for review.

## Items

1. **Time on task bars → muted pill.** Worked + estimated in the same color, wrapped in a small `bg-overlay-hover` pill. Over-budget keeps the red signal.
2. **"Shutdown day" link icon.** Bottom button now reuses `DailyShutdownIcon` paths from the sidebar so both clocks read the same.
3. **Highlight star → pleasant yellow.** New `--accent-highlight` token (`#e8b440` light / `#f0c25a` dark). Star fill/stroke swapped from `--accent-warning` so we don't disturb due-date warnings that share that token.
4. **Tiptap formatting in task notes.** Bubble menu (H1/H2/Bold/Italic/Bullets/Numbered) + visible CSS for headings, strong, em, and lists. Markdown shortcuts (`# `, `* `, `**bold**`) already worked under the hood; this surfaces them.
5. **Weekly planner — small pills + day modal.** Calendar chips become one-line pills; clicking a day's date number opens a `DayTasksModal` with the full task list for that day. (Trigger confirmed: date-number header, not whole-column.)
6. **Drag handle removal on TaskCard.** No more `⠿`. Whole card is draggable; click opens task detail. Distance activation constraint prevents click→drag confusion.
7. **Focus-mode placeholder hides on focus.** RichTextEditor now tracks `isFocused`; placeholder shows only when `isEmpty && !isFocused`. Affects all RichTextEditor consumers.

## Order
A. Items 1–3 (visual tweaks)
B. Item 7 (placeholder)
C. Item 6 (dnd handle)
D. Item 4 (bubble menu + CSS)
E. Item 5 (weekly redesign)

## Decisions
- Star: introduce a new token rather than recolor `--accent-warning`. Stars and due-date warnings have different semantic registers.
- Weekly day-modal trigger: date-number header. Less ambiguous than whole-column click and won't clash with dnd.
- Branch: `feat/past-shutdowns` (continuing the existing UI-tweak chain).
