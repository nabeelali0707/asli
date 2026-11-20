import { getDb } from "@/server/db/client";
import { verifyMessage } from "@/server/services/verify";
import { SYSTEM_ACTOR } from "@/server/lib/actor";

export const dynamic = "force-dynamic";

// Minimal verify-link page (the full UI comes with the frontend). Shows the spoken verdict in Urdu and English.
export default async function VerifyLink({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const out = await verifyMessage(await getDb(), SYSTEM_ACTOR, { token: decodeURIComponent(token) });
  const good = out.verdict === "genuine";
  return (
    <main style={{ maxWidth: 560, margin: "40px auto", padding: "0 16px" }}>
      <div style={{ fontSize: 64 }}>{good ? "✅" : "⚠️"}</div>
      <p dir="rtl" style={{ fontSize: 22, lineHeight: 1.6 }}>{out.spoken.ur}</p>
      <p style={{ fontSize: 18 }}>{out.spoken.en}</p>
      <p style={{ color: "#666", fontSize: 13 }}>Prototype only — not an official service.</p>
    </main>
  );
}
