/** ChatTabStrip — the conversation switcher for the windowed workspace's chat
 *  canvas (PLAN-odysseus-feel.md, W1.5). Open chat panes live BEHIND the
 *  floating tool windows as one full-bleed canvas; this strip is how you flip
 *  between them (Odysseus's session header, OSAI-style): a pill per open
 *  conversation + new-chat + home. Right-click a pill for rename (inline;
 *  double-click too) / archive / close. Archived conversations leave the strip
 *  into the box dropdown on the right — picking one brings it back. Pane
 *  lifecycle stays in App.
 */
import { useState } from "react";
import { Archive, House, MessageSquarePlus, Pencil, X } from "lucide-react";

import { PaneMenu, type PaneMenuEntry } from "./PaneMenu";

export interface ChatTab {
  key: string;
  label: string;
  /** live agent run streaming in this conversation. */
  busy: boolean;
}

export function ChatTabStrip({
  tabs,
  archived,
  activeKey,
  onSelect,
  onClose,
  onRename,
  onArchive,
  onNew,
  onHome,
}: {
  tabs: ChatTab[];
  /** conversations parked out of the strip; restored via the dropdown. */
  archived: ChatTab[];
  activeKey: string | null;
  onSelect: (key: string) => void;
  onClose: (key: string) => void;
  onRename: (key: string, label: string) => void;
  onArchive: (key: string) => void;
  onNew: () => void;
  onHome: () => void;
}) {
  const [menu, setMenu] = useState<{ key: string; x: number; y: number } | null>(null);
  const [archiveMenu, setArchiveMenu] = useState<{ x: number; y: number } | null>(null);
  const [editing, setEditing] = useState<{ key: string; draft: string } | null>(null);

  const commitRename = () => {
    if (!editing) return;
    if (editing.draft.trim()) onRename(editing.key, editing.draft);
    setEditing(null);
  };

  const menuItems = (key: string): PaneMenuEntry[] => [
    {
      key: "rename",
      icon: <Pencil size={14} />,
      label: "Rename conversation",
      onSelect: () => {
        const tab = tabs.find((t) => t.key === key);
        setEditing({ key, draft: tab?.label ?? "" });
      },
    },
    {
      key: "archive",
      icon: <Archive size={14} />,
      label: "Archive conversation",
      hint: "keeps running",
      onSelect: () => onArchive(key),
    },
    { key: "sep", separator: true },
    {
      key: "close",
      icon: <X size={14} />,
      label: "Close conversation",
      danger: true,
      onSelect: () => onClose(key),
    },
  ];

  const archiveItems: PaneMenuEntry[] = archived.map((tab) => ({
    key: tab.key,
    icon: tab.busy ? (
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-accent)]" />
    ) : (
      <Archive size={14} />
    ),
    label: tab.label,
    onSelect: () => onSelect(tab.key),
  }));

  return (
    <div
      data-no-window-drag
      className="absolute top-2 left-1/2 z-30 flex max-w-[70%] -translate-x-1/2 items-center gap-0.5 rounded-full border border-[var(--color-border-strong)] bg-[var(--color-panel)]/90 px-1.5 py-1 shadow-[var(--osai-shadow-pop)] backdrop-blur"
    >
      <button
        type="button"
        onClick={onHome}
        title="Home"
        className="press grid h-6 w-6 shrink-0 place-items-center rounded-full text-[var(--color-muted)] transition-colors hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
      >
        <House size={13} />
      </button>
      {/* pills scroll silently — no scrollbar chrome inside a floating strip */}
      <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((tab) => {
          const active = tab.key === activeKey;
          return (
            <div
              key={tab.key}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setMenu({ key: tab.key, x: e.clientX, y: e.clientY });
              }}
              className={`group flex min-w-0 shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[11px] transition-colors ${
                active
                  ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                  : "text-[var(--color-muted)] hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
              }`}
            >
              {editing?.key === tab.key ? (
                <input
                  autoFocus
                  value={editing.draft}
                  onChange={(e) => setEditing({ key: tab.key, draft: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    else if (e.key === "Escape") setEditing(null);
                    e.stopPropagation();
                  }}
                  onBlur={commitRename}
                  size={Math.min(32, Math.max(8, editing.draft.length + 2))}
                  className="bg-transparent text-[11px] text-[var(--color-text)] outline-none"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => onSelect(tab.key)}
                  onDoubleClick={() => setEditing({ key: tab.key, draft: tab.label })}
                  title={`${tab.label} — double-click or right-click to rename`}
                  className="flex min-w-0 items-center gap-1.5"
                >
                  {tab.busy && (
                    <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[var(--color-accent)]" />
                  )}
                  <span className="max-w-40 truncate">{tab.label}</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => onClose(tab.key)}
                title="Close conversation"
                className={`grid h-4 w-4 shrink-0 place-items-center rounded-full transition-opacity hover:text-[var(--color-danger)] ${
                  active ? "opacity-70 hover:opacity-100" : "opacity-0 group-hover:opacity-70 hover:opacity-100"
                }`}
              >
                <X size={11} />
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={onNew}
        title="New conversation"
        className="press grid h-6 w-6 shrink-0 place-items-center rounded-full text-[var(--color-muted)] transition-colors hover:bg-[var(--color-panel-2)] hover:text-[var(--color-accent)]"
      >
        <MessageSquarePlus size={13} />
      </button>
      {archived.length > 0 && (
        <button
          type="button"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setArchiveMenu(archiveMenu ? null : { x: r.left, y: r.bottom + 6 });
          }}
          title={`Archived conversations (${archived.length})`}
          className="press relative grid h-6 w-6 shrink-0 place-items-center rounded-full text-[var(--color-muted)] transition-colors hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
        >
          <Archive size={13} />
          <span className="absolute -top-0.5 -right-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-[var(--color-accent)] px-0.5 text-[8px] leading-none font-bold text-[var(--color-accent-fg)]">
            {archived.length > 9 ? "9+" : archived.length}
          </span>
        </button>
      )}
      {menu && (
        <PaneMenu x={menu.x} y={menu.y} items={menuItems(menu.key)} onClose={() => setMenu(null)} />
      )}
      {archiveMenu && (
        <PaneMenu
          x={archiveMenu.x}
          y={archiveMenu.y}
          items={archiveItems}
          onClose={() => setArchiveMenu(null)}
        />
      )}
    </div>
  );
}
