import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["dist/", "src-tauri/"],
  },
  // M4 — entity guardrail. After the M3 refactor, Task data lives in
  // the canonical Zustand store and is read through selectors.
  // Per-screen `useState<Task[]>` (and friends) was the pattern M3
  // retired. This rule prevents future drift by flagging
  // `useState<...>` whose type argument references Task, anywhere in
  // src/pages/ or src/components/.
  //
  // Currently scoped to Task — Project lift is a separate future
  // milestone (tracked as M5 in MEMORY.md;
  // project_project_canonical_store_deferral.md). The entity plan's
  // M4 mention of "we lifted projects in M3" was aspirational; M3
  // was task-as-entity only and projects stayed as per-screen
  // useState<Project[]>. Re-add `Project` to the type alternation
  // when projectsById exists. Easily reactivated later — one regex
  // change.
  //
  // Scope rationale: src/hooks/ and src/utils/ are not in scope —
  // those directories don't own task state today and adding them
  // just expands false-positive surface. Custom hooks that
  // genuinely need to own task state are a code-review conversation,
  // not a rule violation.
  //
  // Why no-restricted-syntax over a custom plugin: one rule, one
  // selector, no new dependency. Trade-off: doesn't follow type
  // aliases (`type T = Task; useState<T>` slips through). Theoretical
  // drift; caught in code review. Upgrade path is
  // @typescript-eslint/no-restricted-types with type-checker, parked
  // until/unless that drift mode appears.
  //
  // The selector targets TSTypeReference nodes (Task) descendants of
  // the type-arguments slot only — NOT the call's arguments slot.
  // This means props that happen to be `Task` (e.g.
  // `(task: Task) => void` callbacks, `<TaskCard task={t} />`) and
  // initial-value expressions that mention Task aren't flagged. Only
  // the type parameter to useState itself.
  //
  // Adding a new entity type? Extend the regex. Don't add a second
  // selector unless the message diverges meaningfully.
  {
    files: ["src/pages/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.name='useState'] > TSTypeParameterInstantiation TSTypeReference[typeName.name=/^Task$/]",
          message:
            "Don't put Task in useState — read from the canonical store via selectors (selectTaskById, selectTaskIdsBy*, selectUnscheduledTasksByProject, etc.). M3 entity refactor / M4 guardrail. For a confirmed legitimate exception (transient single-component UI state with no cross-screen visibility need), add `// eslint-disable-next-line no-restricted-syntax -- <justification>` on the line above with a specific reason; the justification is the gate, not the disable.",
        },
      ],
    },
  },
);
