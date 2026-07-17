/**
 * Handoff prompt builder — pure, so the wording is unit-testable and the ChatPane
 * panel stays thin. A "handoff" packages the current session for CONTINUATION in
 * another model: the current model writes a compact, self-contained brief the
 * target can resume from without rereading the whole chat.
 *
 * Redesign (2026-07): the target list is now the LIVE model catalog (not a
 * hardcoded set), the prompt is tailored to the target (context-window budget +
 * engine flavor), and it can be delivered into the chat OR written to a file.
 */

/** A handoff target — shape-compatible with `ChatModel` (id + label + engine). */
export interface HandoffTarget {
  id: string;
  label: string;
  /** "claude" | "codex" | "opencode" | a BYO-key API provider id. */
  engine?: string;
}

export type HandoffDelivery = "chat" | "file";

/** Approx usable context window (tokens) for a target. Mirrors ChatPane's
 *  `ctxMeter` window map so the tailored length guidance matches what the app
 *  shows elsewhere. Conservative by default (unknown → 200k). */
export function contextWindowFor(target: HandoffTarget): number {
  const id = target.id.toLowerCase();
  const engine = (target.engine ?? "claude").toLowerCase();
  if (id.startsWith("claude-opus")) return 1_000_000;
  if (id.includes("gemini") || id.includes("gpt-5")) return 400_000;
  if (engine === "codex") return 272_000;
  if (engine === "opencode") return 256_000;
  return 200_000;
}

/** Short human name for an engine, for grouping the target list. */
export function engineGroupLabel(engine: string | undefined): string {
  switch ((engine ?? "claude").toLowerCase()) {
    case "claude":
      return "Claude (CLI)";
    case "codex":
      return "Codex (ChatGPT)";
    case "opencode":
      return "OpenCode";
    case "anthropic":
      return "Anthropic API";
    case "openai":
      return "OpenAI API";
    case "openrouter":
      return "OpenRouter";
    case "google":
      return "Google API";
    case "ollama":
      return "Ollama (local)";
    default:
      return (engine ?? "other").replace(/[-_]/g, " ");
  }
}

/** Length/verbosity guidance keyed to how much room the target has to read. */
function lengthGuidance(windowTokens: number): string {
  if (windowTokens >= 500_000)
    return "You have room to be thorough — the target has a large context window, so don't over-compress; keep the reasoning that matters.";
  if (windowTokens <= 220_000)
    return "Keep it tight and prioritized — the target has a modest context window, so lead with what's essential and drop anything it can rederive.";
  return "Be compact but complete — enough to resume confidently, no filler.";
}

/** A one-line flavor note about the target engine, so the brief speaks to it. */
function engineFlavor(engine: string | undefined): string {
  switch ((engine ?? "claude").toLowerCase()) {
    case "codex":
    case "openai":
      return "The target is a GPT/Codex-family model.";
    case "opencode":
      return "The target runs via OpenRouter.";
    case "ollama":
      return "The target is a local model — assume no internet and limited tool access.";
    default:
      return "";
  }
}

/** Build the tailored handoff prompt sent to (or run by) the CURRENT model. */
export function buildHandoffPrompt(
  target: HandoffTarget,
  opts: { delivery?: HandoffDelivery; cwd?: string | null } = {},
): string {
  const delivery = opts.delivery ?? "chat";
  const engine = target.engine ?? "claude";
  const win = contextWindowFor(target);
  const flavor = engineFlavor(engine);
  const cwd = opts.cwd?.trim();

  const sections = [
    "current objective",
    "important user preferences and constraints",
    "what's already shipped / changed",
    "files touched (with why)",
    "verification already run and its result",
    "known caveats and open risks",
    "the next best actions, in order",
  ]
    .map((s) => `  - ${s}`)
    .join("\n");

  const head = `Create a clean HANDOFF for continuing THIS exact session in ${target.label} (${engine} / ${target.id}).`;
  const body = `Include:\n${sections}`;
  const tail =
    delivery === "file"
      ? `Write the handoff as Markdown to \`HANDOFF.md\`${
          cwd ? ` in ${cwd}` : " in the working directory"
        } using your file-writing tool, then reply with just the path and a one-line summary.`
      : `Write it as a single self-contained Markdown message so ${target.label} can resume without rereading this whole chat.`;

  return [head, body, lengthGuidance(win), flavor, tail].filter(Boolean).join("\n\n");
}
