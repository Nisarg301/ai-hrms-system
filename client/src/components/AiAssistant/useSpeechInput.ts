import { useCallback, useEffect, useRef, useState } from 'react';

// The browser's speech recognition (Chrome, Edge, Safari). Chrome and Edge send the audio to
// their cloud speech service; only the recognised text reaches our server and Ollama.

interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEvent {
  results: ArrayLike<RecognitionResult>;
}
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

const ERRORS: Record<string, string> = {
  'not-allowed': 'Microphone access was blocked. Allow it in the browser to use voice.',
  'service-not-allowed': 'Microphone access was blocked. Allow it in the browser to use voice.',
  'audio-capture': 'No microphone was found.',
  network: "The browser's speech service could not be reached.",
};

/**
 * Speak and the text goes into the chat: words appear while you talk, and when you pause
 * the final text is handed to `onFinal` (the chat sends it). Cancel drops it unsent.
 */
export function useSpeechInput(lang = 'en-IN') {
  const Ctor = recognitionCtor();
  // Browsers only allow the microphone on https:// or localhost.
  const supported = Boolean(Ctor) && (typeof window === 'undefined' || window.isSecureContext !== false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<Recognition | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => () => recognitionRef.current?.abort(), []);

  const start = useCallback(
    (onFinal: (text: string) => void) => {
      if (!Ctor || recognitionRef.current) return;
      const recognition = new Ctor();
      recognition.lang = lang;
      recognition.interimResults = true;
      // One utterance: recognition ends by itself when the user pauses.
      recognition.continuous = false;
      let heard = '';
      cancelledRef.current = false;
      recognition.onresult = (event) => {
        let finalText = '';
        let partial = '';
        for (let i = 0; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) finalText += result[0].transcript;
          else partial += result[0].transcript;
        }
        heard = `${finalText} ${partial}`.trim();
        setInterim(heard);
      };
      recognition.onerror = (event) => {
        if (event.error !== 'no-speech' && event.error !== 'aborted') setError(ERRORS[event.error] ?? 'Voice input stopped.');
      };
      recognition.onend = () => {
        recognitionRef.current = null;
        setListening(false);
        setInterim('');
        if (!cancelledRef.current && heard) onFinal(heard);
      };
      setError(null);
      recognitionRef.current = recognition;
      recognition.start();
      setListening(true);
    },
    [Ctor, lang]
  );

  /** Stop listening now and send what was heard. */
  const stop = useCallback(() => recognitionRef.current?.stop(), []);

  /** Stop listening and send nothing. */
  const cancel = useCallback(() => {
    cancelledRef.current = true;
    recognitionRef.current?.abort();
  }, []);

  return { supported, listening, interim, error, start, stop, cancel };
}
