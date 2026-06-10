// Byte time-domain data from AnalyserNode is centered at 128 (0..255).
export function rmsFromTimeDomain(bytes: Uint8Array): number {
  if (bytes.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < bytes.length; i++) {
    const v = (bytes[i] - 128) / 128; // -1..1
    sum += v * v;
  }
  const rms = Math.sqrt(sum / bytes.length);
  return Math.min(1, Math.max(0, rms));
}
