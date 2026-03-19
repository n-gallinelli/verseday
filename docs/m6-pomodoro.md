# M6: Pomodoro Integration — Decision Log

## Decisions
- Pomodoro is integrated into the existing Focus Mode, not a separate feature
- 25-minute work cycles with break prompts at each boundary
- After cycles 1-3: offer 5 min break with Yes / In 5 min / No options
- After every 4th cycle: offer 15 min break with 15 min / 5 min / No break options
- "In 5 min" (snooze) dismisses the prompt and re-prompts after 5 more minutes of work
- Break mode shows a countdown timer in green, with a "Skip break" option
- Visual pomodoro counter: 4 dots showing progress through the current set
- Time entry keeps running through work and breaks — no separate DB entries for breaks
- No schema changes needed

## What was built
- Break prompt overlay: appears over the timer when a pomodoro boundary is hit
- Break countdown timer: green-colored countdown with skip option
- Pomodoro counter: 4 dots + "2/4" text label
- Snooze logic: tracks a threshold in work-elapsed time to re-prompt
- Pause during breaks: correctly adjusts break start time
- Total elapsed always visible in footer during all phases
- Phase state machine: work → prompt → break → work (or work → prompt → work for no-break/snooze)

## What's next
- M7: Weekly Plan view
