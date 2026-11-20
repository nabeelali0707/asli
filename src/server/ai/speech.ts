/**
 * Urdu speech-to-text via Whisper (OpenAI whisper-1, or Groq whisper-large-v3 — fast and cheap).
 * Text-to-speech: fixed prompts use pre-recorded clips (audioKey on every message), so they work
 * on 2G; dynamic text is spoken by the browser/TTS on the client.
 * Offline / no key: the client must send its own transcript (e.g. on-device recognition) and the
 * response says so — we never pretend to have transcribed audio.
 */
import { env, aiLive } from "../env";

export type Transcription = { text: string; language: string | null; provider: "openai" | "groq" | "client"; model: string; latencyMs: number };

export function speechAvailable() {
  const e = env();
  return aiLive() && !!(e.GROQ_API_KEY || e.OPENAI_API_KEY);
}

export async function transcribe(audio: Buffer, mime: string, filename = "audio.webm", languageHint = "ur"): Promise<Transcription | null> {
  if (!speechAvailable()) return null;
  const e = env();
  const useGroq = !!e.GROQ_API_KEY;
  const url = useGroq ? "https://api.groq.com/openai/v1/audio/transcriptions" : "https://api.openai.com/v1/audio/transcriptions";
  const model = useGroq ? "whisper-large-v3" : "whisper-1";
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)], { type: mime }), filename);
  form.append("model", model);
  form.append("language", languageHint);
  form.append("response_format", "json");
  const started = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${useGroq ? e.GROQ_API_KEY : e.OPENAI_API_KEY}` },
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Transcription failed: ${res.status} ${await res.text().catch(() => "")}`);
  const json = (await res.json()) as { text: string; language?: string };
  return { text: json.text, language: json.language ?? languageHint, provider: useGroq ? "groq" : "openai", model, latencyMs: Date.now() - started };
}
