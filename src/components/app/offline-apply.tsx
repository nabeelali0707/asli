"use client";

import * as React from "react";
import { toast } from "sonner";
import { WifiOff } from "lucide-react";
import { newKey } from "@/lib/api";
import { fileToUpload } from "@/lib/image";
import { outbox, flushOutbox } from "@/lib/outbox";
import { Btn } from "@/components/brut/kit";

/** "No signal?" form: saves a whole application (details + optional photo) on the phone and sends it when the signal returns. */
export function OfflineApply({ onSent }: { onSent?: () => void }) {
  const [f, setF] = React.useState({ fullName: "", cnic: "", monthlyIncome: "", householdSize: "", statement: "" });
  const [photo, setPhoto] = React.useState<File | null>(null);
  const [busy, setBusy] = React.useState(false);
  const id = React.useId();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const ref = newKey();
      await outbox.add({
        opId: newKey(),
        type: "create_case",
        clientRef: ref,
        payload: {
          type: "relief_claim",
          claim: {
            fullName: f.fullName || undefined,
            cnic: f.cnic.replace(/\D/g, "") || undefined,
            monthlyIncome: f.monthlyIncome ? Number(f.monthlyIncome) : undefined,
            householdSize: f.householdSize ? Number(f.householdSize) : undefined,
            statement: f.statement || undefined,
          },
        },
      });
      if (photo) {
        const up = await fileToUpload(photo);
        await outbox.add({ opId: newKey(), type: "add_document", caseRef: ref, payload: { kind: "cnic", mime: up.mime, contentBase64: up.base64 } });
      }
      await outbox.add({ opId: newKey(), type: "submit_case", caseRef: ref });
      setF({ fullName: "", cnic: "", monthlyIncome: "", householdSize: "", statement: "" });
      setPhoto(null);
      const r = await flushOutbox();
      if (r.sent > 0 && r.left === 0) {
        toast.success("Sent. You will hear the answer here.");
        onSent?.();
      } else toast("Saved on this phone. It will be sent when the signal returns.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <p className="flex items-center gap-2 font-medium">
        <WifiOff className="size-5" aria-hidden /> No signal? Fill this in. <span lang="ur" className="urdu text-muted-ink">سگنل نہیں؟ یہاں بھریں</span>
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1.5" htmlFor={`${id}-n`}>
          <span className="text-[15px]">Full name</span>
          <input id={`${id}-n`} className="field" value={f.fullName} onChange={set("fullName")} autoComplete="name" />
        </label>
        <label className="space-y-1.5" htmlFor={`${id}-c`}>
          <span className="text-[15px]">CNIC (13 digits)</span>
          <input id={`${id}-c`} className="field font-mono" inputMode="numeric" value={f.cnic} onChange={set("cnic")} placeholder="3520212345678" />
        </label>
        <label className="space-y-1.5" htmlFor={`${id}-i`}>
          <span className="text-[15px]">Monthly income (Rs)</span>
          <input id={`${id}-i`} className="field" inputMode="numeric" value={f.monthlyIncome} onChange={set("monthlyIncome")} />
        </label>
        <label className="space-y-1.5" htmlFor={`${id}-h`}>
          <span className="text-[15px]">People at home</span>
          <input id={`${id}-h`} className="field" inputMode="numeric" value={f.householdSize} onChange={set("householdSize")} />
        </label>
      </div>
      <label className="block space-y-1.5" htmlFor={`${id}-s`}>
        <span className="text-[15px]">Anything else</span>
        <textarea id={`${id}-s`} className="field min-h-[80px]" dir="auto" value={f.statement} onChange={set("statement")} />
      </label>
      <label className="block space-y-1.5" htmlFor={`${id}-p`}>
        <span className="text-[15px]">Photo of your ID card (optional)</span>
        <input id={`${id}-p`} type="file" accept="image/*" capture="environment" className="field" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
      </label>
      <Btn type="submit" loading={busy}>Save and send</Btn>
    </form>
  );
}
