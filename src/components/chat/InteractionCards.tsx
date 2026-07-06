/** Blocking-tool interaction cards — a slice of the ChatPane split
 *  (PLAN-odysseus-feel.md, W4). The three cards that pause a turn on user
 *  input: AskUserQuestion (our own picker — headless claude has no TTY for its
 *  native one), ExitPlanMode (plan approval), and can_use_tool (permission
 *  approval). The input parsers live here too since the cards own the shapes;
 *  ChatPane imports them for its is-interactive-tool guards. Moved verbatim. */
import { useMemo, useState } from "react";
import {
  Check,
  CheckCheck,
  CornerDownLeft,
  FileText,
  HelpCircle,
  ListChecks,
  ShieldQuestion,
  X,
} from "lucide-react";
import type { ApprovalDecision } from "../../lib/chat";
import type { ChatTurn } from "../../lib/chatStream";
import type { ToolTurn } from "../../lib/subagentFleet";
import { CopyButton } from "../ui";
import { ellipsizeMid } from "./format";
import { Markdown } from "./Markdown";

/** One question inside an `AskUserQuestion` tool call. The tool always streams
 *  to us (claude can't render its native picker in headless stream-json mode, so
 *  it auto-denies with "Answer questions?" — we render OUR OWN picker from this
 *  shape and feed the choices back as the next user turn). */
export interface AskQuestion {
  /** The prompt shown above the options. */
  question: string;
  /** Short tag for the question (chip label), e.g. "Framework". */
  header: string;
  /** When true the user may pick several options (checkbox); else single (radio). */
  multiSelect: boolean;
  options: { label: string; description?: string }[];
}

/** Parse the `questions` array out of an AskUserQuestion tool input. Returns null
 *  when the shape isn't a usable question set (so we fall back to the generic
 *  tool card rather than render an empty picker). */
export function parseAskQuestions(input: Record<string, unknown> | undefined): AskQuestion[] | null {
  const raw = input?.questions;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: AskQuestion[] = [];
  for (const q of raw) {
    if (!q || typeof q !== "object") continue;
    const obj = q as Record<string, unknown>;
    const question = typeof obj.question === "string" ? obj.question : "";
    const opts: { label: string; description?: string }[] = [];
    if (Array.isArray(obj.options)) {
      for (const o of obj.options) {
        if (!o || typeof o !== "object") continue;
        const oo = o as Record<string, unknown>;
        if (typeof oo.label !== "string" || !oo.label) continue;
        opts.push({
          label: oo.label,
          ...(typeof oo.description === "string" ? { description: oo.description } : {}),
        });
      }
    }
    if (!question || opts.length === 0) continue;
    out.push({
      question,
      header: typeof obj.header === "string" && obj.header ? obj.header : "Question",
      multiSelect: obj.multiSelect === true,
      options: opts,
    });
  }
  return out.length > 0 ? out : null;
}

/** One auto-allowed follow-up action the model suggested alongside its plan. */
interface PlanAllowedPrompt {
  tool?: string;
  prompt?: string;
}
/** The parsed contents of an ExitPlanMode tool call — the plan the model wants
 *  approved before it starts building. Shape verified from captured stream-json:
 *  `{ plan: "<markdown>", planFilePath?: string, allowedPrompts?: [{tool,prompt}] }`. */
export interface PlanProposal {
  plan: string;
  planFilePath?: string;
  allowedPrompts: PlanAllowedPrompt[];
}

/** Parse an ExitPlanMode tool input into a usable plan proposal. Returns null
 *  when there's no plan text (so we fall back to the generic activity step rather
 *  than render an empty card). */
export function parsePlanProposal(input: Record<string, unknown>): PlanProposal | null {
  const plan = typeof input?.plan === "string" ? input.plan.trim() : "";
  if (!plan) return null;
  const planFilePath =
    typeof input?.planFilePath === "string" ? input.planFilePath : undefined;
  const allowedPrompts = Array.isArray(input?.allowedPrompts)
    ? (input.allowedPrompts as unknown[])
        .filter((p): p is Record<string, unknown> => typeof p === "object" && p != null)
        .map((p) => ({
          tool: typeof p.tool === "string" ? p.tool : undefined,
          prompt: typeof p.prompt === "string" ? p.prompt : undefined,
        }))
    : [];
  return { plan, planFilePath, allowedPrompts };
}

/** Full, UNTRUNCATED args for the approval card — the field a security decision
 *  hinges on (a Bash `command` with a `&& rm -rf` tail past 80 chars) must never
 *  be clipped. Rendered in a scrollable pre. */
function fullArgs(input: Record<string, unknown>): string {
  const entries = Object.entries(input ?? {});
  if (entries.length === 0) return "";
  return entries
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v, null, 2)}`)
    .join("\n");
}

/**
 * Interactive AskUserQuestion card. claude can't render its native picker in
 * headless stream-json mode (no TTY → it auto-denies the tool with "Answer
 * questions?"), so we render OUR OWN picker from the streamed tool input and
 * feed the choices back as the next user turn. Single-select questions render as
 * radio-style buttons, multiSelect as toggles; every question also offers a free
 * "Other…" answer. Once submitted the card collapses to a one-line verdict.
 */
export function AskQuestionCard({
  turn,
  answered,
  cancelled,
  disabled,
  onAnswer,
}: {
  turn: ToolTurn;
  /** Formatted answer once submitted (collapses the card); undefined = open. */
  answered?: string;
  /** True once the user stopped the turn before answering → cancelled verdict. */
  cancelled?: boolean;
  /** Reserved: block interaction (unused now — the card stays answerable while the
   *  model waits, since answering is what unblocks it). */
  disabled?: boolean;
  onAnswer: (toolId: string, questions: AskQuestion[], picks: string[][]) => void;
}) {
  const questions = useMemo(() => parseAskQuestions(turn.input) ?? [], [turn.input]);
  // chosen predefined labels + free "Other" text, one slot per question.
  const [sel, setSel] = useState<string[][]>(() => questions.map(() => []));
  const [other, setOther] = useState<string[]>(() => questions.map(() => ""));
  const [otherOpen, setOtherOpen] = useState<boolean[]>(() => questions.map(() => false));

  if (questions.length === 0) return null;

  // already answered → collapsed verdict (mirrors ApprovalCard's resolved state).
  if (answered) {
    return (
      <div className="rounded-xl border border-[var(--color-success)]/30 px-3.5 py-2.5 font-sans text-[12px] text-[var(--color-text-2)]">
        <div className="mb-1 flex items-center gap-2 text-[var(--color-success)]">
          <CheckCheck size={13} />
          <span className="font-medium">answered</span>
        </div>
        <pre className="whitespace-pre-wrap break-words font-sans text-[12px] leading-relaxed text-[var(--color-text-2)]">
          {answered}
        </pre>
      </div>
    );
  }

  // stopped before answering → a quiet cancelled verdict.
  if (cancelled) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-[var(--color-border)] px-3.5 py-2.5 font-sans text-[12px] text-[var(--color-faint)]">
        <X size={13} />
        <span>question cancelled — stopped before answering</span>
      </div>
    );
  }

  const effectivePicks = (i: number): string[] => {
    const q = questions[i];
    const free = other[i]?.trim() ? [other[i].trim()] : [];
    if (q.multiSelect) return [...sel[i], ...free];
    // single-select: a typed "Other" wins over a chosen option.
    return free.length ? free : sel[i];
  };
  const ready = questions.every((_, i) => effectivePicks(i).length > 0);

  const pick = (i: number, label: string) => {
    if (disabled) return;
    const q = questions[i];
    setSel((prev) => {
      const next = prev.map((a) => [...a]);
      if (q.multiSelect) {
        next[i] = next[i].includes(label)
          ? next[i].filter((l) => l !== label)
          : [...next[i], label];
      } else {
        next[i] = next[i][0] === label ? [] : [label];
      }
      return next;
    });
    if (!q.multiSelect) {
      // picking a concrete option clears a stray free-text answer.
      setOther((prev) => prev.map((v, idx) => (idx === i ? "" : v)));
      setOtherOpen((prev) => prev.map((v, idx) => (idx === i ? false : v)));
    }
  };

  const submit = () => {
    if (disabled || !ready) return;
    onAnswer(
      turn.id,
      questions,
      questions.map((_, i) => effectivePicks(i)),
    );
  };

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--color-accent)]/40 bg-[var(--color-accent-soft)]">
      <div className="flex items-center gap-2.5 px-3.5 pt-3 pb-1">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-[var(--color-bg)]/40 text-[var(--color-accent)]">
          <HelpCircle size={14} />
        </span>
        <span className="font-sans text-[12.5px] font-medium text-[var(--color-text)]">
          {questions.length > 1 ? `${questions.length} questions` : "a question for you"}
        </span>
      </div>
      <div className="flex flex-col gap-3 px-3.5 pb-2 pt-2">
        {questions.map((q, i) => {
          const chosen = effectivePicks(i);
          return (
            <div key={i} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <span className="rounded bg-[var(--color-bg)]/40 px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.12em] text-[var(--color-muted)]">
                  {q.header}
                </span>
                {q.multiSelect && (
                  <span className="font-sans text-[10.5px] text-[var(--color-faint)]">
                    pick any
                  </span>
                )}
              </div>
              <div className="font-sans text-[13px] leading-snug text-[var(--color-text)]">
                {q.question}
              </div>
              <div className="flex flex-col gap-1.5">
                {q.options.map((opt) => {
                  const active = sel[i].includes(opt.label);
                  return (
                    <button
                      key={opt.label}
                      type="button"
                      disabled={disabled}
                      onClick={() => pick(i, opt.label)}
                      className={`flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-left font-sans text-[12.5px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                        active
                          ? "border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-[var(--color-text)]"
                          : "border-[var(--color-border-strong)] bg-[var(--color-panel)]/60 text-[var(--color-text-2)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-panel)] hover:text-[var(--color-text)]"
                      }`}
                    >
                      <span
                        className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center border ${
                          q.multiSelect ? "rounded" : "rounded-full"
                        } ${active ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-bg)]" : "border-[var(--color-border-strong)]"}`}
                      >
                        {active && <Check size={11} />}
                      </span>
                      <span className="flex min-w-0 flex-col">
                        <span className="font-medium">{opt.label}</span>
                        {opt.description && (
                          <span className="text-[11px] leading-snug text-[var(--color-faint)]">
                            {opt.description}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
                {/* free-text escape hatch (the real tool always allows "Other") */}
                {otherOpen[i] ? (
                  <input
                    autoFocus
                    type="text"
                    disabled={disabled}
                    value={other[i]}
                    placeholder="your own answer…"
                    onChange={(e) =>
                      setOther((prev) => prev.map((v, idx) => (idx === i ? e.target.value : v)))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        submit();
                      }
                    }}
                    className="rounded-lg border border-[var(--color-accent)]/60 bg-[var(--color-bg)]/40 px-2.5 py-1.5 font-sans text-[12.5px] text-[var(--color-text)] placeholder:text-[var(--color-faint)] focus:outline-none"
                  />
                ) : (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      setOtherOpen((prev) => prev.map((v, idx) => (idx === i ? true : v)));
                      if (!q.multiSelect) {
                        setSel((prev) => prev.map((a, idx) => (idx === i ? [] : a)));
                      }
                    }}
                    className="self-start rounded-lg border border-dashed border-[var(--color-border-strong)] px-2.5 py-1 font-sans text-[12px] text-[var(--color-muted)] transition-colors hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Other…
                  </button>
                )}
              </div>
              {chosen.length > 0 && (
                <span className="font-sans text-[10.5px] text-[var(--color-faint)]">
                  → {chosen.join(", ")}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-2 px-3.5 pb-3 pt-1">
        <button
          type="button"
          disabled={disabled || !ready}
          onClick={submit}
          className="flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-1.5 font-sans text-[12px] font-medium text-[var(--color-bg)] transition-colors hover:bg-[var(--color-accent-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <CornerDownLeft size={13} /> send answer{questions.length > 1 ? "s" : ""}
        </button>
        {!ready && (
          <span className="font-sans text-[11px] text-[var(--color-faint)]">
            {disabled ? "model is working…" : "pick an option for each question"}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Interactive plan-approval card for an `ExitPlanMode` tool call. In headless
 * stream-json mode claude can't show its native plan picker (no TTY → the tool
 * auto-dismisses and the model stalls), so we render the proposed plan ourselves
 * with approve / keep-planning actions and feed the verdict back as the next user
 * turn (see resolvePlan). Once decided the card collapses to a one-line verdict.
 */
export function PlanProposalCard({
  turn,
  resolved,
  cancelled,
  onResolve,
}: {
  turn: ToolTurn;
  /** Verdict once decided (collapses the card); undefined = still open. */
  resolved?: "approved" | "rejected";
  /** True once the user stopped the turn before deciding → cancelled verdict. */
  cancelled?: boolean;
  onResolve: (toolId: string, decision: "approve" | "reject", feedback?: string) => void;
}) {
  const proposal = useMemo(() => parsePlanProposal(turn.input), [turn.input]);
  const [showNote, setShowNote] = useState(false);
  const [note, setNote] = useState("");

  if (!proposal) return null;

  // already decided → collapsed verdict (mirrors AskQuestionCard's resolved state).
  if (resolved) {
    const ok = resolved === "approved";
    return (
      <div
        className={`flex items-center gap-2 rounded-xl border px-3.5 py-2.5 font-sans text-[12px] ${
          ok
            ? "border-[var(--color-success)]/30 text-[var(--color-success)]"
            : "border-[var(--color-border)] text-[var(--color-muted)]"
        }`}
      >
        {ok ? <CheckCheck size={13} /> : <ListChecks size={13} />}
        <span className="font-medium">
          {ok ? "plan approved — building" : "kept planning — asked for a revision"}
        </span>
      </div>
    );
  }

  // stopped before deciding → a quiet cancelled verdict.
  if (cancelled) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-[var(--color-border)] px-3.5 py-2.5 font-sans text-[12px] text-[var(--color-faint)]">
        <X size={13} />
        <span>plan dismissed — stopped before deciding</span>
      </div>
    );
  }

  const fileName = proposal.planFilePath
    ? proposal.planFilePath.split(/[\\/]/).filter(Boolean).pop()
    : undefined;

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--color-accent)]/40 bg-[var(--color-accent-soft)] shadow-[var(--aios-glow-soft)]">
      <div className="flex items-center gap-2.5 px-3.5 pt-3 pb-1">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-[var(--color-bg)]/40 text-[var(--color-accent)]">
          <ListChecks size={14} />
        </span>
        <span className="font-sans text-[12.5px] font-medium text-[var(--color-text)]">
          ready to build — review the plan
        </span>
      </div>

      {/* the proposed plan, rendered as markdown (same renderer as assistant prose),
          capped to a scroll box so a long plan doesn't flood the transcript. */}
      <div className="mx-3.5 mb-2 mt-1 max-h-[22rem] overflow-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)]/40 px-3 py-2.5 text-[12.5px] leading-relaxed text-[var(--color-text-2)]">
        <Markdown text={proposal.plan} />
      </div>

      {proposal.allowedPrompts.length > 0 && (
        <div className="mx-3.5 mb-2 flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-faint)]">
            will run once you approve
          </span>
          {proposal.allowedPrompts.map((p, i) => (
            <div
              key={i}
              className="flex items-start gap-2 font-sans text-[11.5px] text-[var(--color-muted)]"
            >
              <span className="mt-0.5 shrink-0 rounded bg-[var(--color-bg)]/40 px-1.5 font-mono text-[9.5px] text-[var(--color-faint)]">
                {p.tool ?? "tool"}
              </span>
              <span className="min-w-0">{p.prompt ?? ""}</span>
            </div>
          ))}
        </div>
      )}

      {showNote && (
        <div className="mx-3.5 mb-2">
          <textarea
            autoFocus
            value={note}
            placeholder="optional notes for the model before it starts (or what to change)…"
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="block w-full resize-none rounded-lg border border-[var(--color-accent)]/50 bg-[var(--color-bg)]/40 px-2.5 py-1.5 font-sans text-[12px] leading-relaxed text-[var(--color-text)] placeholder:text-[var(--color-faint)] focus:outline-none"
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 px-3.5 pb-3 pt-1">
        <button
          type="button"
          onClick={() => onResolve(turn.id, "approve", note)}
          className="flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-1.5 font-sans text-[12px] font-medium text-[var(--color-bg)] transition-colors hover:bg-[var(--color-accent-hover)]"
        >
          <Check size={13} /> approve &amp; build
        </button>
        <button
          type="button"
          onClick={() => onResolve(turn.id, "reject", note)}
          className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-panel-2)] px-3 py-1.5 font-sans text-[12px] text-[var(--color-text)] transition-colors hover:bg-[var(--color-panel)]"
        >
          <ListChecks size={13} /> keep planning
        </button>
        <button
          type="button"
          onClick={() => setShowNote((v) => !v)}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-sans text-[12px] text-[var(--color-muted)] transition-colors hover:text-[var(--color-text)]"
        >
          {showNote ? "hide notes" : "add notes…"}
        </button>
        {fileName && (
          <span
            className="ml-auto inline-flex items-center gap-1 font-mono text-[10px] text-[var(--color-faint)]"
            title={proposal.planFilePath}
          >
            <FileText size={11} /> {fileName}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Inline tool-approval card for a `can_use_tool` control request (non-bypass
 * modes). Allow once / Allow always / Deny → replied via the control protocol
 * (buildApprovalLine in chat.ts owns the exact shape). Once resolved the card
 * collapses to a one-line verdict so the transcript stays clean.
 */
export function ApprovalCard({
  turn,
  onResolve,
}: {
  turn: Extract<ChatTurn, { kind: "approval" }>;
  onResolve: (
    requestId: string,
    toolName: string,
    decision: ApprovalDecision,
  ) => void;
}) {
  const args = fullArgs(turn.input);

  if (turn.decision) {
    const denied = turn.decision === "deny";
    return (
      <div
        className={`flex items-center gap-2 rounded-xl border bg-[var(--color-panel-2)]/40 px-3.5 py-2 font-sans text-[12px] backdrop-blur-md ${
          denied
            ? "border-[var(--color-danger)]/30 text-[var(--color-danger)]"
            : "border-[var(--color-success)]/30 text-[var(--color-success)]"
        }`}
      >
        {denied ? <X size={13} /> : <CheckCheck size={13} />}
        <span className="font-mono text-[11.5px] text-[var(--color-text-2)]">
          {turn.toolName}
        </span>
        <span className="shrink-0 opacity-80">
          {turn.decision === "allow"
            ? "allowed once"
            : turn.decision === "allow_always"
              ? "allowed for session"
              : "denied"}
        </span>
        {/* echo WHAT was approved — the card used to erase the command on
            resolution, leaving the transcript unauditable. Full text on hover
            + one click to copy. */}
        {args && (
          <>
            <span
              className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-[var(--color-faint)]"
              title={args}
            >
              {ellipsizeMid(args.replace(/\s+/g, " "), 64)}
            </span>
            <CopyButton
              text={args}
              size={11}
              title="copy the approved command"
              className="grid h-5 w-5 shrink-0 place-items-center rounded text-[var(--color-faint)] transition-colors hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
            />
          </>
        )}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--color-accent)]/40 bg-[var(--color-accent-soft)] backdrop-blur-md shadow-[var(--aios-glow-soft)]">
      <div className="flex items-center gap-2.5 px-3.5 pt-3 pb-2">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-[var(--color-bg)]/40 text-[var(--color-accent)]">
          <ShieldQuestion size={14} />
        </span>
        <span className="font-sans text-[12.5px] text-[var(--color-text)]">
          allow{" "}
          <span className="font-mono font-medium">{turn.toolName}</span>?
        </span>
      </div>
      {args && (
        <div className="relative mx-3.5 mb-2">
          <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-words rounded-md bg-[var(--color-bg)]/40 px-2.5 py-1.5 pr-7 font-mono text-[11px] leading-relaxed text-[var(--color-text-2)]">
            {args}
          </pre>
          <CopyButton
            text={args}
            size={11}
            title="copy command"
            className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded text-[var(--color-faint)] transition-colors hover:bg-[var(--color-panel)] hover:text-[var(--color-text)]"
          />
        </div>
      )}
      <div className="flex items-center gap-2 px-3.5 pb-3">
        <button
          type="button"
          onClick={() => onResolve(turn.requestId, turn.toolName, "allow")}
          className="flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-1.5 font-sans text-[12px] font-medium text-[var(--color-bg)] transition-colors hover:bg-[var(--color-accent-hover)]"
        >
          <Check size={13} /> allow once
        </button>
        <button
          type="button"
          onClick={() =>
            onResolve(turn.requestId, turn.toolName, "allow_always")
          }
          className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-panel-2)] px-3 py-1.5 font-sans text-[12px] text-[var(--color-text)] transition-colors hover:bg-[var(--color-panel)]"
        >
          <CheckCheck size={13} /> allow always
        </button>
        <button
          type="button"
          onClick={() => onResolve(turn.requestId, turn.toolName, "deny")}
          className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 py-1.5 font-sans text-[12px] text-[var(--color-muted)] transition-colors hover:border-[var(--color-danger)]/40 hover:text-[var(--color-danger)]"
        >
          <X size={13} /> deny
        </button>
      </div>
    </div>
  );
}
