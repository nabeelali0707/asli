"use client";

import * as React from "react";
import { api } from "@/lib/api";
import { useAction } from "@/lib/hooks";
import { Btn, Bilingual, Tag } from "@/components/brut/kit";

type Bi = { en: string; ur: string };
type Answer = { answerable: boolean; answer: Bi; sources: { id: string; doc: string; title: string; score: number }[]; mode: string };

const EXAMPLES = ["Who can apply?", "What documents do I need?", "Do I have to pay a fee?", "Why was I asked for more proof?"];

export default function AskPage() {
  const [q, setQ] = React.useState("");
  const [a, setA] = React.useState<Answer | null>(null);
  const { busy, run } = useAction();
  const ask = (text: string) => run("ask", () => api<Answer>("/policy/ask", { body: { question: text } }), setA);

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="text-h1">
          Ask a <span className="marker">question</span>
        </h1>
        <p className="mt-3 text-lead text-muted-ink">Answers come only from the programme&rsquo;s own rules, and we show which paragraph. If the rules don&rsquo;t say, we say so and a person helps.</p>
      </div>
      <form
        className="space-y-3 rounded-[28px] border border-ink bg-mist p-6 shadow-hard"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim().length > 1) void ask(q);
        }}
      >
        <label htmlFor="q" className="block font-medium">
          Your question <span lang="ur" className="urdu text-muted-ink">— آپ کا سوال</span>
        </label>
        <input id="q" className="field" dir="auto" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Who can apply?" />
        <div className="flex flex-wrap items-center gap-2">
          <Btn type="submit" loading={busy === "ask"} disabled={q.trim().length < 2}>
            Ask
          </Btn>
          {EXAMPLES.map((x) => (
            <button
              key={x}
              type="button"
              onClick={() => {
                setQ(x);
                void ask(x);
              }}
              className="rounded-full border border-ink bg-white px-3 py-1.5 text-[14px] hover:bg-lime"
            >
              {x}
            </button>
          ))}
        </div>
      </form>
      {a && (
        <div className="space-y-5 rounded-[28px] border border-ink bg-white p-6 shadow-hard">
          <div className="flex flex-wrap items-center gap-2">
            <Tag tone={a.answerable ? "lime" : "dark"}>{a.answerable ? "answered from the rules" : "not sure — a person will help"}</Tag>
            <Tag>{a.mode}</Tag>
          </div>
          <Bilingual text={a.answer} />
          {a.sources.length > 0 && a.answerable && (
            <div className="border-t border-ink/20 pt-4">
              <p className="mb-2 text-[13px] uppercase tracking-wide text-muted-ink">Where this comes from</p>
              <ul className="space-y-1.5 text-[15px]">
                {a.sources.map((s) => (
                  <li key={s.id}>
                    <span className="font-mono text-[12px]">{s.id}</span> · {s.title} <span className="text-muted-ink">({s.doc})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
