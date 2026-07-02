//! BYO-key API chat — the PURE request/response core for the API tier (Tier 4).
//!
//! The HTTP I/O + claude-shaped event emission live in `chat.rs` (`run_api_turn`);
//! THIS module is the pure, unit-tested part that's easy to get wrong blind:
//!   - `build_request_body` — the streaming request per protocol.
//!   - `parse_stream_line`   — one SSE/ndjson line → text deltas + usage + done.
//!   - `parse_answer`        — pull the message out of a NON-streamed body (used
//!                             for an error/non-2xx body, which isn't streamed).
//! Protocols:
//!   - `anthropic-messages` (Anthropic API)      → POST /v1/messages   (SSE)
//!   - `openai-chat`        (OpenAI + OpenRouter) → /v1/chat/completions (SSE)
//!   - `ollama-chat`        (local Ollama)        → POST /api/chat       (ndjson)
//!
//! `messages` is the FULL conversation [{role, content}] in order — AIOS owns this
//! array (unlike the CLI tier, where the binary owns context), which is also what
//! makes honest branching / edit-rewind possible.

use serde_json::{json, Value};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ApiProtocol {
    AnthropicMessages,
    OpenaiChat,
    OllamaChat,
}

/// One parsed item from a streaming line. A single line can yield several (e.g.
/// an OpenAI usage chunk carries both token counts).
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum StreamEvent {
    /// A text token to append to the answer + stream to the UI.
    Delta(String),
    /// Prompt/input token count (usage).
    InputTokens(u64),
    /// Completion/output token count (usage).
    OutputTokens(u64),
    /// Terminal sentinel (`[DONE]` / `message_stop` / ollama `done:true`).
    Done,
}

/// Anthropic requires `max_tokens`; a sane default for chat.
const DEFAULT_MAX_TOKENS: u32 = 4096;

/// Build the streaming request body for one turn.
pub fn build_request_body(proto: ApiProtocol, model: &str, messages: &[Value]) -> Value {
    match proto {
        ApiProtocol::AnthropicMessages => json!({
            "model": model,
            "max_tokens": DEFAULT_MAX_TOKENS,
            "messages": messages,
            "stream": true,
        }),
        ApiProtocol::OpenaiChat => json!({
            "model": model,
            "messages": messages,
            "stream": true,
            // ask for a final usage chunk (OpenAI; OpenRouter passes it through).
            "stream_options": { "include_usage": true },
        }),
        ApiProtocol::OllamaChat => json!({
            "model": model,
            "messages": messages,
            "stream": true,
        }),
    }
}

/// Parse ONE streaming line into zero or more `StreamEvent`s. Blank lines, SSE
/// comments, `event:` lines, and unrelated frames yield `[]`.
pub fn parse_stream_line(proto: ApiProtocol, line: &str) -> Vec<StreamEvent> {
    let line = line.trim();
    if line.is_empty() {
        return vec![];
    }
    match proto {
        ApiProtocol::OpenaiChat => {
            let Some(data) = line.strip_prefix("data:") else {
                return vec![];
            };
            let data = data.trim();
            if data == "[DONE]" {
                return vec![StreamEvent::Done];
            }
            let Ok(v) = serde_json::from_str::<Value>(data) else {
                return vec![];
            };
            let mut out = Vec::new();
            if let Some(t) = v.pointer("/choices/0/delta/content").and_then(Value::as_str) {
                if !t.is_empty() {
                    out.push(StreamEvent::Delta(t.to_string()));
                }
            }
            if let Some(u) = v.get("usage").filter(|u| u.is_object()) {
                if let Some(n) = u.get("prompt_tokens").and_then(Value::as_u64) {
                    out.push(StreamEvent::InputTokens(n));
                }
                if let Some(n) = u.get("completion_tokens").and_then(Value::as_u64) {
                    out.push(StreamEvent::OutputTokens(n));
                }
            }
            out
        }
        ApiProtocol::AnthropicMessages => {
            let Some(data) = line.strip_prefix("data:") else {
                return vec![];
            };
            let Ok(v) = serde_json::from_str::<Value>(data.trim()) else {
                return vec![];
            };
            match v.get("type").and_then(Value::as_str) {
                Some("content_block_delta") => v
                    .pointer("/delta/text")
                    .and_then(Value::as_str)
                    .filter(|t| !t.is_empty())
                    .map(|t| vec![StreamEvent::Delta(t.to_string())])
                    .unwrap_or_default(),
                Some("message_start") => v
                    .pointer("/message/usage/input_tokens")
                    .and_then(Value::as_u64)
                    .map(|n| vec![StreamEvent::InputTokens(n)])
                    .unwrap_or_default(),
                Some("message_delta") => v
                    .pointer("/usage/output_tokens")
                    .and_then(Value::as_u64)
                    .map(|n| vec![StreamEvent::OutputTokens(n)])
                    .unwrap_or_default(),
                Some("message_stop") => vec![StreamEvent::Done],
                _ => vec![],
            }
        }
        ApiProtocol::OllamaChat => {
            // ndjson: one JSON object per line (no `data:` prefix).
            let Ok(v) = serde_json::from_str::<Value>(line) else {
                return vec![];
            };
            let mut out = Vec::new();
            if let Some(t) = v.pointer("/message/content").and_then(Value::as_str) {
                if !t.is_empty() {
                    out.push(StreamEvent::Delta(t.to_string()));
                }
            }
            if v.get("done").and_then(Value::as_bool) == Some(true) {
                if let Some(n) = v.get("prompt_eval_count").and_then(Value::as_u64) {
                    out.push(StreamEvent::InputTokens(n));
                }
                if let Some(n) = v.get("eval_count").and_then(Value::as_u64) {
                    out.push(StreamEvent::OutputTokens(n));
                }
                out.push(StreamEvent::Done);
            }
            out
        }
    }
}

/// Pull the message out of a NON-streamed body — used for an error/non-2xx body
/// (which providers return as a single JSON object, not a stream). Returns `Err`
/// with the provider's own message when the body is an error (or empty).
pub fn parse_answer(proto: ApiProtocol, resp: &Value) -> Result<String, String> {
    if let Some(err) = resp.get("error") {
        let msg = err
            .get("message")
            .and_then(Value::as_str)
            .map(|s| s.to_string())
            .unwrap_or_else(|| err.to_string());
        return Err(msg);
    }
    let text = match proto {
        ApiProtocol::AnthropicMessages => resp
            .get("content")
            .and_then(|c| c.as_array())
            .map(|blocks| {
                blocks
                    .iter()
                    .filter(|b| b.get("type").and_then(Value::as_str) == Some("text"))
                    .filter_map(|b| b.get("text").and_then(Value::as_str))
                    .collect::<Vec<_>>()
                    .join("")
            })
            .unwrap_or_default(),
        ApiProtocol::OpenaiChat => resp
            .pointer("/choices/0/message/content")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        ApiProtocol::OllamaChat => resp
            .pointer("/message/content")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
    };
    if text.trim().is_empty() {
        return Err("the provider returned an empty response".to_string());
    }
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msgs() -> Vec<Value> {
        vec![json!({"role": "user", "content": "hi"})]
    }

    #[test]
    fn bodies_request_streaming_per_protocol() {
        let a = build_request_body(ApiProtocol::AnthropicMessages, "claude-opus-4-8", &msgs());
        assert_eq!(a["stream"], true);
        assert_eq!(a["max_tokens"], DEFAULT_MAX_TOKENS);

        let o = build_request_body(ApiProtocol::OpenaiChat, "gpt-4o", &msgs());
        assert_eq!(o["stream"], true);
        assert_eq!(o["stream_options"]["include_usage"], true);
        assert!(o.get("max_tokens").is_none());

        let l = build_request_body(ApiProtocol::OllamaChat, "llama3.1", &msgs());
        assert_eq!(l["stream"], true);
    }

    #[test]
    fn openai_stream_deltas_and_final_usage() {
        let d = parse_stream_line(
            ApiProtocol::OpenaiChat,
            r#"data: {"choices":[{"delta":{"content":"Hel"}}]}"#,
        );
        assert_eq!(d, vec![StreamEvent::Delta("Hel".into())]);
        // empty delta (role-only first chunk) yields nothing.
        assert!(parse_stream_line(ApiProtocol::OpenaiChat, r#"data: {"choices":[{"delta":{}}]}"#).is_empty());
        let u = parse_stream_line(
            ApiProtocol::OpenaiChat,
            r#"data: {"choices":[],"usage":{"prompt_tokens":11,"completion_tokens":3}}"#,
        );
        assert_eq!(u, vec![StreamEvent::InputTokens(11), StreamEvent::OutputTokens(3)]);
        assert_eq!(parse_stream_line(ApiProtocol::OpenaiChat, "data: [DONE]"), vec![StreamEvent::Done]);
        assert!(parse_stream_line(ApiProtocol::OpenaiChat, ": keep-alive comment").is_empty());
    }

    #[test]
    fn anthropic_stream_events() {
        assert_eq!(
            parse_stream_line(
                ApiProtocol::AnthropicMessages,
                r#"data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"world"}}"#
            ),
            vec![StreamEvent::Delta("world".into())]
        );
        assert_eq!(
            parse_stream_line(
                ApiProtocol::AnthropicMessages,
                r#"data: {"type":"message_start","message":{"usage":{"input_tokens":42}}}"#
            ),
            vec![StreamEvent::InputTokens(42)]
        );
        assert_eq!(
            parse_stream_line(
                ApiProtocol::AnthropicMessages,
                r#"data: {"type":"message_delta","usage":{"output_tokens":9}}"#
            ),
            vec![StreamEvent::OutputTokens(9)]
        );
        assert_eq!(
            parse_stream_line(ApiProtocol::AnthropicMessages, r#"data: {"type":"message_stop"}"#),
            vec![StreamEvent::Done]
        );
        // SSE `event:` lines + pings are ignored.
        assert!(parse_stream_line(ApiProtocol::AnthropicMessages, "event: ping").is_empty());
    }

    #[test]
    fn ollama_ndjson_stream() {
        assert_eq!(
            parse_stream_line(ApiProtocol::OllamaChat, r#"{"message":{"content":"loc"},"done":false}"#),
            vec![StreamEvent::Delta("loc".into())]
        );
        assert_eq!(
            parse_stream_line(
                ApiProtocol::OllamaChat,
                r#"{"message":{"content":""},"done":true,"prompt_eval_count":8,"eval_count":4}"#
            ),
            vec![StreamEvent::InputTokens(8), StreamEvent::OutputTokens(4), StreamEvent::Done]
        );
    }

    #[test]
    fn parse_answer_surfaces_errors_and_empty() {
        let err = json!({"error": {"message": "invalid x-api-key"}});
        assert!(parse_answer(ApiProtocol::AnthropicMessages, &err)
            .unwrap_err()
            .contains("invalid x-api-key"));
        assert!(parse_answer(ApiProtocol::OpenaiChat, &json!({"choices": []})).is_err());
        // a non-streamed success body still parses (defensive fallback).
        let ok = json!({"choices":[{"message":{"content":"hi"}}]});
        assert_eq!(parse_answer(ApiProtocol::OpenaiChat, &ok).unwrap(), "hi");
    }
}
