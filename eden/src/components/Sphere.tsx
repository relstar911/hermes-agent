import { useEffect, useRef } from "react";
import type { SphereState } from "../lib/sphereState";

const PAL = { node: [150, 235, 255], core: ["#eafdff", "#38e1ff", "#0b6f96"], link: "56,225,255", acc: [124, 240, 255] };

export function Sphere({ state, amplitudeRef }: { state: SphereState; amplitudeRef: { current: number } }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // The amplitude arrives as a ref so the canvas loop reads it per frame
  // without forcing the React tree to re-render at 60fps while speaking.
  const live = useRef({ state, amplitudeRef });
  live.current = { state, amplitudeRef };

  useEffect(() => {
    const cv = canvasRef.current!;
    const ctx = cv.getContext("2d")!;
    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    let W = 0, H = 0, cx = 0, cy = 0;
    const resize = () => {
      W = cv.clientWidth; H = cv.clientHeight;
      cv.width = W * DPR; cv.height = H * DPR;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      cx = W / 2; cy = H * 0.46;
    };
    resize();
    window.addEventListener("resize", resize);

    const N = 240, base: { x: number; y: number; z: number; tw: number; sz: number }[] = [];
    const GA = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), th = GA * i;
      base.push({ x: Math.cos(th) * r, y, z: Math.sin(th) * r, tw: Math.random() * 6.28, sz: 0.7 + Math.random() * 0.9 });
    }
    const links: [number, number, number][] = [], LT = 0.34;
    for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
      const a = base[i], b = base[j];
      const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      if (d < LT) links.push([i, j, 1 - d / LT]);
    }

    const hex = (c: string, a: number) => {
      const n = parseInt(c.slice(1), 16);
      return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
    };

    let ry = 0, rx = -0.32, t = 0, raf = 0, lastTs = performance.now();
    const focal = 2.4;

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - lastTs) / 1000); lastTs = now;
      const { state: st, amplitudeRef: ar } = live.current;
      const amp = ar.current;
      const energy = st === "speaking" ? Math.max(0.25, amp)
        : st === "thinking" ? 0.5 : st === "tool" ? 0.6
        : st === "listening" ? 0.12 : st === "error" ? 0.0 : 0.05;
      const rotSpeed = st === "thinking" || st === "tool" ? 0.5 : 0.22;
      t += dt; ry += dt * rotSpeed; rx = -0.30 + Math.sin(t * 0.18) * 0.12;
      const breathe = 1 + 0.028 * Math.sin(t * 1.6);
      const pulse = breathe * (1 + 0.16 * energy * (0.6 + 0.4 * Math.sin(t * 22)));
      const R = Math.min(W, H) * 0.30 * pulse;
      const accent = st === "tool" ? [124, 255, 178] : st === "error" ? [255, 120, 120] : PAL.acc;

      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = "lighter";

      const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.7);
      cg.addColorStop(0, hex(PAL.core[0], 0.95));
      cg.addColorStop(0.18, hex(PAL.core[1], 0.55 * (0.7 + 0.5 * energy)));
      cg.addColorStop(0.5, hex(PAL.core[2], 0.1));
      cg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(cx, cy, R * 1.7, 0, 6.2832); ctx.fill();

      const cosY = Math.cos(ry), sinY = Math.sin(ry), cosX = Math.cos(rx), sinX = Math.sin(rx);
      const P: { sx: number; sy: number; z: number; persp: number; sz: number; tw: number }[] = new Array(N);
      for (let i = 0; i < N; i++) {
        const p = base[i];
        const x1 = p.x * cosY - p.z * sinY, z1 = p.x * sinY + p.z * cosY, y1 = p.y;
        const y2 = y1 * cosX - z1 * sinX, z2 = y1 * sinX + z1 * cosX;
        const persp = focal / (focal - z2);
        P[i] = { sx: cx + x1 * R * persp, sy: cy + y2 * R * persp, z: z2, persp, sz: p.sz, tw: p.tw };
      }

      ctx.lineWidth = 1;
      for (const [i, j, w] of links) {
        const a = P[i], b = P[j];
        const dep = (a.z + b.z) * 0.5;
        const al = (0.06 + 0.5 * w) * (0.35 + 0.65 * (dep + 1) / 2) * (0.7 + 0.5 * energy);
        ctx.strokeStyle = `rgba(${PAL.link},${al.toFixed(3)})`;
        ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
      }

      const order = P.map((_, i) => i).sort((a, b) => P[a].z - P[b].z);
      for (const i of order) {
        const p = P[i], dep = (p.z + 1) / 2, tw = 0.7 + 0.3 * Math.sin(t * 3 + p.tw);
        const r = (0.6 + p.sz * 1.7) * p.persp * (0.6 + 0.7 * dep) * tw * (1 + 0.5 * energy * dep);
        const a = (0.18 + 0.82 * dep) * tw;
        ctx.fillStyle = `rgba(${PAL.node[0]},${PAL.node[1]},${PAL.node[2]},${a.toFixed(3)})`;
        ctx.shadowBlur = 10 * dep; ctx.shadowColor = `rgba(${accent[0]},${accent[1]},${accent[2]},0.9)`;
        ctx.beginPath(); ctx.arc(p.sx, p.sy, Math.max(0.4, r), 0, 6.2832); ctx.fill();
      }
      ctx.shadowBlur = 0;

      const cd = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.22 * pulse);
      cd.addColorStop(0, hex(PAL.core[0], 1));
      cd.addColorStop(0.6, hex(PAL.core[1], 0.6));
      cd.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = cd; ctx.beginPath(); ctx.arc(cx, cy, R * 0.22 * pulse, 0, 6.2832); ctx.fill();

      ctx.globalCompositeOperation = "source-over";
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, []);

  return <canvas ref={canvasRef} className="eden-canvas" />;
}
