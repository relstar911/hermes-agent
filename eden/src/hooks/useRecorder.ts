import { useCallback, useEffect, useRef } from "react";

const MIN_BLOB_BYTES = 1024; // accidental taps produce near-empty blobs — not worth an API call

/**
 * Microphone recorder for push-to-talk. The stream is acquired once on the
 * first hold and kept (tracks toggled per hold) so later holds don't clip the
 * first phonemes waiting for getUserMedia.
 */
export function useRecorder() {
  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const supported =
    typeof window !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined";

  useEffect(() => {
    return () => {
      try { recRef.current?.stop(); } catch { /* ignore */ }
      for (const t of streamRef.current?.getAudioTracks() ?? []) t.stop();
      streamRef.current = null;
    };
  }, []);

  const start = useCallback(async (): Promise<boolean> => {
    if (!supported) return false;
    try {
      if (!streamRef.current) {
        streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      for (const t of streamRef.current.getAudioTracks()) t.enabled = true;
      chunksRef.current = [];
      const mime = "audio/webm;codecs=opus";
      const rec = MediaRecorder.isTypeSupported?.(mime)
        ? new MediaRecorder(streamRef.current, { mimeType: mime })
        : new MediaRecorder(streamRef.current);
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      rec.start();
      recRef.current = rec;
      return true;
    } catch {
      return false;
    }
  }, [supported]);

  const stop = useCallback((): Promise<Blob | null> => {
    const rec = recRef.current;
    recRef.current = null;
    for (const t of streamRef.current?.getAudioTracks() ?? []) t.enabled = false;
    if (!rec || rec.state === "inactive") return Promise.resolve(null);
    return new Promise((resolve) => {
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        chunksRef.current = [];
        resolve(blob.size >= MIN_BLOB_BYTES ? blob : null);
      };
      try { rec.stop(); } catch { resolve(null); }
    });
  }, []);

  return { supported, start, stop };
}
