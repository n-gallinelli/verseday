import { invoke } from "@tauri-apps/api/core";

export async function callClaude(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  return invoke<string>("generate_summary", {
    apiKey,
    systemPrompt,
    userPrompt,
  });
}
