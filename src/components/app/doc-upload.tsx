"use client";

import * as React from "react";
import { toast } from "sonner";
import { Camera, FileUp } from "lucide-react";
import { api, ApiError, newKey } from "@/lib/api";
import { fileToUpload } from "@/lib/image";
import { outbox } from "@/lib/outbox";
import { Btn, Bilingual, Tag } from "@/components/brut/kit";
import { cn } from "@/lib/utils";

type Bi = { en: string; ur: string };
type Uploaded = { document: { id: string; kind: string; checks: { blurry?: boolean; readable?: boolean; quality?: { tooDark?: boolean } }; retakePrompt?: Bi | null } };

const KINDS = [
  { k: "cnic", en: "ID card (CNIC)", ur: "شناختی کارڈ" },
  { k: "income_proof", en: "Income proof", ur: "آمدنی کا ثبوت" },
  { k: "other", en: "Other paper", ur: "کوئی اور کاغذ" },
] as const;

/** Photo upload for a case. Blurry photos get a spoken "hold steady and retake"; with no signal the photo is saved on the phone. */
export function DocUpload({ caseId, asFamily = false, onUploaded }: { caseId: string; asFamily?: boolean; onUploaded?: () => void }) {
  const [kind, setKind] = React.useState<(typeof KINDS)[number]["k"]>("cnic");
  const [busy, setBusy] = React.useState(false);
  const [last, setLast] = React.useState<{ doc?: Uploaded["document"]; queued?: boolean; err?: string } | null>(null);
  const input = React.useRef<HTMLInputElement>(null);
  const id = React.useId();

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setLast(null);
    try {
      const up = await fileToUpload(file);
      try {
        const r = await api<Uploaded>(`/cases/${caseId}/documents`, { asFamily, body: { kind, mime: up.mime, contentBase64: up.base64 }, idempotencyKey: newKey() });
        setLast({ doc: r.document });
        if (!r.document.retakePrompt && !r.document.checks.blurry) toast.success("Photo received");
        onUploaded?.();
      } catch (e) {
        if (e instanceof ApiError && e.status === 0) {
          await outbox.add({ opId: newKey(), type: "add_document", caseRef: caseId, payload: { kind, mime: up.mime, contentBase64: up.base64 } });
          setLast({ queued: true });
        } else throw e;
      }
    } catch (e) {
      setLast({ err: e instanceof Error ? e.message : "Could not upload." });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  const retake = last?.doc?.retakePrompt ?? (last?.doc?.checks.blurry ? { en: "The photo is blurry. Hold the phone steady and take it again.", ur: "تصویر دھندلی ہے۔ فون کو سیدھا رکھیں اور دوبارہ کھینچیں۔" } : null);

  return (
    <div className="space-y-4 rounded-[22px] border border-ink bg-white p-5">
      <fieldset>
        <legend className="mb-2 font-medium">
          Add a photo <span lang="ur" className="urdu text-muted-ink">— تصویر شامل کریں</span>
        </legend>
        <div className="flex flex-wrap gap-2">
          {KINDS.map((x) => (
            <label key={x.k} className={cn("cursor-pointer rounded-full border border-ink px-4 py-2 text-[15px] transition-colors", kind === x.k ? "bg-lime" : "bg-white hover:bg-mist")}>
              <input type="radio" name={`${id}-kind`} className="sr-only" checked={kind === x.k} onChange={() => setKind(x.k)} />
              {x.en}
            </label>
          ))}
        </div>
      </fieldset>
      <input ref={input} id={`${id}-file`} type="file" accept="image/*,application/pdf" capture="environment" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
      <div className="flex flex-wrap gap-3">
        <Btn type="button" loading={busy} onClick={() => input.current?.click()}>
          <Camera className="size-4" aria-hidden /> Take or choose a photo
        </Btn>
        <span className="inline-flex items-center gap-2 text-[14px] text-muted-ink">
          <FileUp className="size-4" aria-hidden /> Photos are shrunk first, so they work on a weak connection.
        </span>
      </div>
      {retake && (
        <div role="alert" className="rounded-[14px] border border-ink bg-lime p-4">
          <Bilingual text={retake} />
        </div>
      )}
      {last?.doc && !retake && (
        <p className="flex items-center gap-2 text-[15px]">
          <Tag tone="lime">received</Tag> {last.doc.checks.readable === false ? "We could not read all of it. An officer may ask for another photo." : "A person will look at it with your case."}
        </p>
      )}
      {last?.queued && (
        <p role="status" className="rounded-[14px] border border-ink bg-mist p-4 text-[15px]">
          No signal. The photo is saved on this phone and will be sent when the connection returns.
        </p>
      )}
      {last?.err && (
        <p role="alert" className="rounded-[14px] border border-ink bg-white p-4 text-[15px]">
          {last.err}
        </p>
      )}
    </div>
  );
}
