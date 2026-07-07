//! Dictation transcription — the cloud tier.
//!
//! The webview records + encodes the WAV (lib/voice.ts); transcription then goes
//! either to the user's local whisper.cpp server (fetched straight from JS — no
//! key involved) or through HERE to OpenAI's speech-to-text API. The cloud call
//! must live Rust-side because BYO keys are keychain-only (apikeys.rs) and never
//! cross into JS. Note the CLI engines (claude / codex OAuth) have no
//! speech-to-text endpoint, so "use my provider" means the OpenAI API key today.

use base64::Engine as _;
use serde::Deserialize;

const OPENAI_TRANSCRIBE_URL: &str = "https://api.openai.com/v1/audio/transcriptions";
/// The dependable STT workhorse. gpt-4o-transcribe exists but whisper-1 is the
/// stable, cheap default; revisit when the model catalog grows an audio lane.
const OPENAI_TRANSCRIBE_MODEL: &str = "whisper-1";

/// Whether cloud transcription is usable right now (an OpenAI key in the
/// keychain or env). Never returns key material. The frontend's "auto" backend
/// pick calls this before each dictation.
#[tauri::command]
pub fn transcribe_available() -> bool {
    crate::apikeys::key_for("openai").is_some()
}

#[derive(Deserialize)]
struct TranscriptBody {
    text: String,
}

/// Transcribe a WAV clip (base64-encoded; 16 kHz mono PCM16 from lib/voice.ts)
/// with the user's OpenAI key. Returns the trimmed transcript.
#[tauri::command]
pub fn transcribe_audio(wav_b64: String) -> Result<String, String> {
    let key = crate::apikeys::key_for("openai")
        .ok_or_else(|| "no OpenAI API key configured — add one in Settings".to_string())?;
    let wav = base64::engine::general_purpose::STANDARD
        .decode(wav_b64.as_bytes())
        .map_err(|e| format!("bad audio payload: {e}"))?;

    let part = reqwest::blocking::multipart::Part::bytes(wav)
        .file_name("audio.wav")
        .mime_str("audio/wav")
        .map_err(|e| format!("multipart: {e}"))?;
    let form = reqwest::blocking::multipart::Form::new()
        .part("file", part)
        .text("model", OPENAI_TRANSCRIBE_MODEL)
        .text("temperature", "0")
        .text("response_format", "json");

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("http client: {e}"))?;
    let res = client
        .post(OPENAI_TRANSCRIBE_URL)
        .bearer_auth(key)
        .multipart(form)
        .send()
        .map_err(|e| format!("transcription request failed: {e}"))?;

    let status = res.status();
    let body = res.text().unwrap_or_default();
    if !status.is_success() {
        // Prefer OpenAI's own error message (bad key, quota, …) over a bare code.
        #[derive(Deserialize)]
        struct ErrBody {
            error: Option<ErrInner>,
        }
        #[derive(Deserialize)]
        struct ErrInner {
            message: String,
        }
        let detail = serde_json::from_str::<ErrBody>(&body)
            .ok()
            .and_then(|e| e.error)
            .map(|e| e.message)
            .unwrap_or_else(|| format!("HTTP {status}"));
        return Err(format!("openai transcription failed: {detail}"));
    }

    let parsed: TranscriptBody = serde_json::from_str(&body)
        .map_err(|_| "transcription response had no text".to_string())?;
    Ok(parsed.text.trim().to_string())
}
