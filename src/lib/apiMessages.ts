// Project a list of chat turns → the API message array {role, content}[] for the
// BYO-key tier (Tier 4). With branching the caller passes the ACTIVE root→leaf
// path's turns, so the model only ever sees the active branch (AIOS owns + sends
// the array). Pure + unit-tested.
import type { ChatTurn } from "./chatStream";

export interface ApiMessage {
  role: "user" | "assistant";
  content: string;
}

/** Map turns → messages, keeping only user/assistant TEXT turns (thinking, tool,
 *  result, and empties are skipped — they aren't conversation content). */
export function turnsToApiMessages(turns: ChatTurn[]): ApiMessage[] {
  const out: ApiMessage[] = [];
  for (const t of turns) {
    if (t.kind === "user" && t.text.trim()) out.push({ role: "user", content: t.text });
    else if (t.kind === "assistant" && t.text.trim()) {
      out.push({ role: "assistant", content: t.text });
    }
  }
  return out;
}

/** Messages up to + INCLUDING the last user turn (drop any trailing answer). For
 *  regenerate: re-send the prompt without its previous answer, so the model
 *  produces a fresh sibling response. */
export function messagesUpToLastUser(turns: ChatTurn[]): ApiMessage[] {
  let cut = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i]!.kind === "user") {
      cut = i + 1;
      break;
    }
  }
  return turnsToApiMessages(turns.slice(0, cut));
}
