/** Chat render contexts — slice 2 of the ChatPane split
 *  (PLAN-odysseus-feel.md W4). ChatPane PROVIDES these; deep leaf renderers
 *  (markdown, code blocks, checklists) consume them without prop-drilling.
 */
import { createContext, useContext } from "react";

import { openFileInPane } from "../../lib/paneBus";
import { resolvePaneFileTarget, targetLabel } from "../../lib/paneRouting";

export type ChatFileOpener = (ref: string) => void;
export const ChatFileOpenContext = createContext<ChatFileOpener | null>(null);

/** Session cwd for leaf renderers (a code fence's "run in terminal" affordance
 *  can spawn a terminal rooted in the same dir without threading cwd through
 *  every layer). */
export const ChatCwdContext = createContext<string | null>(null);

/** Lets deep leaf renderers (markdown checklists) hand a note to the live
 *  composer machinery: steered into a running turn when the engine can take it,
 *  sent as the next message otherwise. Null outside a live pane (e.g. plan-file
 *  previews), where the affordance simply doesn't render. */
export const ChatSubmitContext = createContext<((text: string) => void) | null>(null);

export function useChatSubmit(): ((text: string) => void) | null {
  return useContext(ChatSubmitContext);
}

export function useChatCwd(): string | null {
  return useContext(ChatCwdContext);
}

export function useChatFileOpener(): ChatFileOpener {
  const ctx = useContext(ChatFileOpenContext);
  return (
    ctx ??
    // fallback (no provider, e.g. web/test): open as-is, best-effort.
    ((ref: string) => {
      const path = resolvePaneFileTarget(ref);
      openFileInPane(path, targetLabel(path));
    })
  );
}
