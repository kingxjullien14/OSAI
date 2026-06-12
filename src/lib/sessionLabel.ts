/**
 * Session title/preview sanitizer — strips claude-code's local-command XML
 * wrappers. Slash turns recorded by the CLI arrive as
 * `<command-name>/usage</command-name> <command-message>usage</command-message>…`
 * and the raw tags leaked into the resume rows (user-reported screenshot).
 * Keeps the command name, drops wrapper noise, collapses whitespace.
 *
 * Leaf module (zero imports) so the node --test suite can import it directly.
 */
export function cleanSessionLabel(s: string): string {
  if (!s.includes("<")) return s;
  return s
    .replace(/<command-name>([\s\S]*?)<\/command-name>/g, "$1")
    .replace(/<(command-message|command-args|local-command-stdout|local-command-stderr)>[\s\S]*?<\/\1>/g, " ")
    .replace(/<\/?(?:command|local-command)[a-z-]*[^>]*>/g, " ")
    // previews are length-truncated and can end mid-tag ("…</command-me") —
    // drop the dangling fragment too.
    .replace(/<\/?(?:command|local-command)[a-z-]*[^>]*$/, " ")
    .replace(/\s+/g, " ")
    .trim();
}
