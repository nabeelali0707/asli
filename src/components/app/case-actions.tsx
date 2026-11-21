"use client";

import * as React from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAction } from "@/lib/hooks";
import { Btn, Bilingual } from "@/components/brut/kit";
import { DocUpload } from "@/components/app/doc-upload";

type Bi = { en: string; ur: string };
type CaseLite = { id: string; status: string; lane: string | null };

/** What a citizen (or helper) can do on one case: add photos, appeal a "no", or ask for a person. */
export function CaseActions({ c, asFamily = false, onDone }: { c: CaseLite; asFamily?: boolean; onDone: () => void }) {
  const { busy, run } = useAction();
  const [open, setOpen] = React.useState<"appeal" | "person" | null>(null);
  const [text, setText] = React.useState("");
  const [said, setSaid] = React.useState<Bi | null>(null);

  const wantsPhotos = ["draft", "needs_proof"].includes(c.status);
  const canAppeal = c.status === "rejected";
  const canTalk = !["paid", "closed", "rejected", "approved"].includes(c.status) && c.lane !== "human";

  return (
    <div className="mt-6 space-y-4 text-black">
      {wantsPhotos && <DocUpload caseId={c.id} asFamily={asFamily} onUploaded={onDone} />}
      {(canAppeal || canTalk) && (
        <div className="flex flex-wrap gap-3">
          {canAppeal && (
            <Btn variant="inverse" size="sm" onClick={() => setOpen(open === "appeal" ? null : "appeal")}>
              I disagree — appeal
            </Btn>
          )}
          {canTalk && (
            <Btn variant="inverse" size="sm" onClick={() => setOpen(open === "person" ? null : "person")}>
              I want to talk to a person
            </Btn>
          )}
        </div>
      )}
      {open && (
        <div className="space-y-3 rounded-[18px] border border-ink bg-white p-5">
          <label className="block font-medium" htmlFor={`why-${c.id}`}>
            {open === "appeal" ? "Tell us why this is wrong" : "What do you want the officer to know?"}
            <span lang="ur" className="urdu ms-2 text-muted-ink">{open === "appeal" ? "کیا غلط ہے؟" : "افسر کو کیا بتانا ہے؟"}</span>
          </label>
          <textarea id={`why-${c.id}`} className="field min-h-[90px]" dir="auto" value={text} onChange={(e) => setText(e.target.value)} />
          <Btn
            disabled={text.trim().length < (open === "appeal" ? 2 : 3)}
            loading={busy === open}
            onClick={() =>
              run(
                open,
                () =>
                  open === "appeal"
                    ? api<{ spoken: Bi }>(`/cases/${c.id}/appeal`, { asFamily, body: { statement: text, via: asFamily ? "helper" : "web" } })
                    : api<{ spoken: Bi }>(`/cases/${c.id}/escalate`, { asFamily, body: { reason: text } }),
                (r) => {
                  setSaid(r.spoken);
                  setOpen(null);
                  setText("");
                  toast.success(open === "appeal" ? "Appeal sent" : "An officer will look at it");
                  onDone();
                },
              )
            }
          >
            Send
          </Btn>
        </div>
      )}
      {said && (
        <div className="rounded-[18px] border border-ink bg-lime p-5">
          <Bilingual text={said} />
        </div>
      )}
    </div>
  );
}
