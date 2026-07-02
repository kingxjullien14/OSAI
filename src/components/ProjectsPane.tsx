/** ProjectsPane — a dedicated home for ALL your workspaces (not just the recent
 *  ones the idle dashboard shows). It reuses the structured-workspace manager that
 *  used to live in Settings (`ProjectsSection`: scan roots, detected shape +
 *  component tree, rename/hide/delete, agent-context generation) and adds a
 *  one-click "open" on every card → the same launch picker the homescreen uses
 *  (choose the root or a component, as a terminal or a chat agent).
 *
 *  Token-only styling (Neon Glass) — no hex (design-token ratchet). */
import { FolderGit2 } from "lucide-react";

import { ProjectsSection } from "./Settings";
import type { ProjectWorkspace } from "../lib/projectWorkspaces";

export function ProjectsPane({
  onLaunch,
}: {
  /** open a workspace's launch picker (component/env · terminal/chat). */
  onLaunch: (ws: ProjectWorkspace) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--color-bg)]">
      <div className="pane-header">
        <span className="pane-header__title flex items-center gap-2">
          <FolderGit2 size={14} className="text-[var(--color-accent)]" />
          projects
        </span>
        <span className="ml-auto font-mono text-[10px] text-[var(--color-faint)]">
          configure · open in chat or terminal
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="mx-auto max-w-[820px] px-4 py-4">
          <ProjectsSection onLaunch={onLaunch} />
        </div>
      </div>
    </div>
  );
}
