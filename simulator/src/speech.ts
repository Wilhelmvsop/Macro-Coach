/** Minimal typings for the Web Speech API, which TypeScript's DOM lib does not include. */
interface RecognitionResultEvent {
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}

interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: RecognitionResultEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

type RecognitionCtor = new () => Recognition;

function ctor(): RecognitionCtor | undefined {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export const speechInputSupported = (): boolean => ctor() !== undefined;

export interface Listener {
  stop(): void;
}

/** Starts push-to-talk recognition; calls onText with interim and final transcripts. */
export function listen(onText: (text: string, final: boolean) => void, onEnd: (error?: string) => void): Listener | undefined {
  const C = ctor();
  if (!C) return undefined;
  const r = new C();
  r.lang = "en-US";
  r.interimResults = true;
  r.continuous = false;
  r.onresult = (e) => {
    const parts = Array.from(e.results);
    const text = parts.map((p) => p[0]?.transcript ?? "").join(" ").trim();
    onText(text, parts.every((p) => p.isFinal));
  };
  r.onerror = (e) => onEnd(e.error);
  r.onend = () => onEnd();
  r.start();
  return { stop: () => r.stop() };
}

export function speak(text: string, enabled: boolean): void {
  if (!enabled || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  u.rate = 1.03;
  window.speechSynthesis.speak(u);
}
