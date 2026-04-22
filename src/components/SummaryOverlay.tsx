import { useState, useEffect, useRef } from "react";
import Button from "./Button";
import { getSetting, setSetting } from "../db/queries";
import { callClaude } from "../utils/summaryApi";
import {
  AUDIENCES,
  buildShutdownUserPrompt,
  buildPlanUserPrompt,
  buildWeeklySummaryUserPrompt,
  type AudienceKey,
  type ShutdownSummaryData,
  type PlanSummaryData,
  type WeeklySummaryData,
} from "../utils/summaryPrompts";

interface SummaryOverlayProps {
  type: "shutdown" | "plan" | "weekly";
  data: ShutdownSummaryData | PlanSummaryData | WeeklySummaryData;
  onClose: () => void;
}

type Status = "idle" | "loading" | "success" | "error" | "no-key";

export default function SummaryOverlay({
  type,
  data,
  onClose,
}: SummaryOverlayProps) {
  const [audience, setAudience] = useState<AudienceKey>("cam");
  const [status, setStatus] = useState<Status>("idle");
  const [summary, setSummary] = useState("");
  const [error, setError] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const [copied, setCopied] = useState(false);
  const [editingKey, setEditingKey] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  // Load API key on mount
  useEffect(() => {
    getSetting("anthropic_api_key").then((key) => {
      if (key) {
        setApiKey(key);
        setStatus("idle");
      } else {
        setStatus("no-key");
      }
    });
  }, []);

  // Check if there's content to summarize
  const hasContent =
    type === "shutdown"
      ? (data as ShutdownSummaryData).tasks.length > 0
      : type === "plan"
        ? (data as PlanSummaryData).tasks.length > 0
        : (data as WeeklySummaryData).completedCount + (data as WeeklySummaryData).incompleteCount > 0;

  async function handleGenerate() {
    if (!apiKey) {
      setStatus("no-key");
      return;
    }
    if (!hasContent) {
      setError(
        type === "shutdown"
          ? "No tasks to summarize. Complete some tasks first."
          : type === "plan"
            ? "No tasks planned for today."
            : "No tasks found for this week."
      );
      setStatus("error");
      return;
    }

    setStatus("loading");
    setError("");
    setSummary("");

    const profile = AUDIENCES[audience];
    const userPrompt =
      type === "shutdown"
        ? buildShutdownUserPrompt(data as ShutdownSummaryData)
        : type === "plan"
          ? buildPlanUserPrompt(data as PlanSummaryData)
          : buildWeeklySummaryUserPrompt(data as WeeklySummaryData);

    try {
      const result = await callClaude(apiKey, profile.systemPrompt, userPrompt);
      setSummary(result);
      setStatus("success");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }

  async function handleSaveKey() {
    const trimmed = keyInput.trim();
    if (!trimmed) return;
    await setSetting("anthropic_api_key", trimmed);
    setApiKey(trimmed);
    setKeyInput("");
    setEditingKey(false);
    setStatus("idle");
  }

  function handleCopy() {
    navigator.clipboard.writeText(summary);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const title =
    type === "shutdown"
      ? "Daily Shutdown Summary"
      : type === "plan"
        ? "Daily Plan Summary"
        : "Weekly Summary";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/30" />
      <div
        ref={modalRef}
        className="relative bg-white rounded-xl shadow-xl w-[540px] max-h-[85vh] overflow-y-auto animate-scale-in"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <h2 className="text-base font-semibold text-[#2c2a35]">{title}</h2>
          <button
            onClick={onClose}
            className="text-black/40 hover:text-black/70 text-lg leading-none cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Audience selector */}
        <div className="px-6 pb-4">
          <div className="flex gap-1 bg-[#f5f4f0] rounded-lg p-1">
            {(Object.keys(AUDIENCES) as AudienceKey[]).map((key) => (
              <button
                key={key}
                onClick={() => setAudience(key)}
                className={`flex-1 text-sm py-1.5 px-3 rounded-md transition-colors cursor-pointer ${
                  audience === key
                    ? "bg-white shadow-sm text-[#2c2a35] font-medium"
                    : "text-black/50 hover:text-black/70"
                }`}
              >
                {AUDIENCES[key].label}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="px-6 pb-4 min-h-[200px]">
          {/* No API key state */}
          {(status === "no-key" || editingKey) && (
            <div className="space-y-3">
              <p className="text-sm text-black/60">
                Enter your Anthropic API key to generate summaries.
              </p>
              <input
                type="password"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveKey();
                }}
                placeholder="sk-ant-..."
                className="w-full px-3 py-2 text-sm border border-black/15 rounded-lg focus:outline-none focus:border-[#7B9ED9]"
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={handleSaveKey} disabled={!keyInput.trim()} className={keyInput.trim() ? "" : "opacity-40"}>Save key</Button>
                {editingKey && (
                  <Button variant="ghost" size="sm" onClick={() => setEditingKey(false)}>Cancel</Button>
                )}
              </div>
            </div>
          )}

          {/* Idle — ready to generate */}
          {status === "idle" && !editingKey && (
            <div className="flex flex-col items-center justify-center py-8 gap-4">
              <p className="text-sm text-black/50">
                Generate a{" "}
                {type === "shutdown" ? "productivity recap" : type === "plan" ? "plan overview" : "weekly summary"}{" "}
                written for {AUDIENCES[audience].label}.
              </p>
              <Button size="sm" onClick={handleGenerate}>Generate summary</Button>
            </div>
          )}

          {/* Loading */}
          {status === "loading" && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <div className="w-6 h-6 border-2 border-[#7B9ED9] border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-black/50">Writing summary...</p>
            </div>
          )}

          {/* Success */}
          {status === "success" && (
            <div className="space-y-3">
              <div className="prose prose-sm max-w-none text-[#2c2a35] text-sm leading-relaxed whitespace-pre-wrap">
                {summary}
              </div>
            </div>
          )}

          {/* Error */}
          {status === "error" && (
            <div className="space-y-3">
              <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-lg">
                {error}
              </div>
              <Button size="sm" onClick={handleGenerate}>Try again</Button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-5 flex items-center justify-between">
          <div>
            {apiKey && !editingKey && (
              <button
                onClick={() => {
                  setEditingKey(true);
                  setKeyInput("");
                }}
                className="text-xs text-black/30 hover:text-black/50 cursor-pointer"
              >
                Change API key
              </button>
            )}
          </div>
          <div className="flex gap-2">
            {status === "success" && (
              <>
                <Button variant="secondary" size="sm" onClick={handleGenerate}>Regenerate</Button>
                <Button size="sm" onClick={handleCopy}>{copied ? "Copied!" : "Copy to clipboard"}</Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
