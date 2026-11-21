"use client";

import * as React from "react";
import { toast } from "sonner";
import { CloudOff, RefreshCw, Lock } from "lucide-react";
import { outbox, flushOutbox, currentOwner } from "@/lib/outbox";
import { cn } from "@/lib/utils";

/** Shows "Offline" and how many saved items are waiting, and sends them as soon as the connection returns. */
export function SyncBar() {
  const [online, setOnline] = React.useState(true);
  const [waiting, setWaiting] = React.useState(0);
  const [locked, setLocked] = React.useState(0);
  const [busy, setBusy] = React.useState(false);

  const refresh = React.useCallback(() => setWaiting(outbox.count(currentOwner())), []);
  const sync = React.useCallback(
    async (quiet = false) => {
      if (!currentOwner() || !outbox.count(currentOwner())) return;
      setBusy(true);
      const r = await flushOutbox();
      setBusy(false);
      setLocked(r.locked);
      refresh();
      if (r.sent > 0) toast.success(`Sent ${r.sent} saved item${r.sent === 1 ? "" : "s"}.`);
      else if (!quiet && r.offline) toast("Still no signal. Your work is safe on this phone.");
    },
    [refresh],
  );

  React.useEffect(() => {
    setOnline(navigator.onLine);
    refresh();
    const on = () => {
      setOnline(true);
      void sync(true);
    };
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    window.addEventListener("asli:outbox", refresh);
    const t = setInterval(() => void sync(true), 20_000);
    void sync(true);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      window.removeEventListener("asli:outbox", refresh);
      clearInterval(t);
    };
  }, [refresh, sync]);

  if (online && waiting === 0) return null;
  return (
    <div className="container-page">
      <div role="status" className={cn("flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-ink px-4 py-3", online ? "bg-lime" : "bg-ink text-white")}>
        <span className="flex items-center gap-2 text-[15px]">
          {online ? <RefreshCw className={cn("size-4", busy && "animate-spin")} aria-hidden /> : <CloudOff className="size-4" aria-hidden />}
          {online ? `${waiting} saved item${waiting === 1 ? "" : "s"} waiting to send` : `Offline. ${waiting ? `${waiting} saved on this phone.` : "You can keep working; it will send later."}`}
          {locked > 0 && (
            <span className="inline-flex items-center gap-1">
              <Lock className="size-3.5" aria-hidden /> {locked} locked: enter the family PIN to send
            </span>
          )}
        </span>
        {online && waiting > 0 && (
          <button type="button" onClick={() => void sync()} className="rounded-full border border-ink bg-white px-4 py-1.5 text-[14px] text-black hover:bg-mist">
            Send now
          </button>
        )}
      </div>
    </div>
  );
}
