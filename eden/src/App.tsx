import { useEffect, useState } from "react";
import { GatewayClient } from "./lib/gatewayClient";

export default function App() {
  const [status, setStatus] = useState("connecting");
  const [sessionId, setSessionId] = useState<string | null>(null);
  useEffect(() => {
    const gw = new GatewayClient();
    gw.onState((s) => setStatus(s));
    (async () => {
      await gw.connect();
      const res = await gw.request<{ session_id: string }>("session.create", { cols: 80 });
      setSessionId(res.session_id);
    })().catch((e) => setStatus("error: " + (e as Error).message));
    return () => gw.close();
  }, []);
  return (
    <div style={{ color: "#cfeefb", fontFamily: "monospace", padding: 24, background: "#01040a", minHeight: "100vh" }}>
      <div>EDEN gateway: {status}</div>
      <div>session: {sessionId ?? "—"}</div>
    </div>
  );
}
