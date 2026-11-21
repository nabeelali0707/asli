"use client";

import * as React from "react";
import { motion, useInView, useMotionValue, useTransform, animate } from "motion/react";
import { api } from "@/lib/api";
import { ArrowLink } from "@/components/brut/kit";

type Transparency = {
  decisions: number;
  shareSentToHumans: number;
  shareAskedForProof: number;
  paymentsReleased: number;
  amountReleasedPKR: number;
  scam: { flagged: number; confirmedScam: number; falseAlarms: number; falseAlarmRate: number };
  aiNeverMovesMoney: boolean;
};

function CountUp({ to, format = (n: number) => Math.round(n).toLocaleString("en-PK") }: { to: number; format?: (n: number) => string }) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const mv = useMotionValue(0);
  const text = useTransform(mv, (v) => format(v));
  React.useEffect(() => {
    if (!inView) return;
    const c = animate(mv, to, { duration: 1.1, ease: [0.2, 0, 0, 1] });
    return () => c.stop();
  }, [inView, to, mv]);
  return <motion.span ref={ref}>{text}</motion.span>;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

export function LiveNumbers() {
  const [t, setT] = React.useState<Transparency | null>(null);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    api<Transparency>("/transparency", { anonymous: true }).then(setT, () => setFailed(true));
  }, []);

  const cols = [
    {
      big: <CountUp to={18} format={(n) => `${Math.round(n)}/18`} />,
      body: "attacks caught by the Break It suite: edited amounts, copied codes, forged ID cards, a helper reusing one family's PIN, a prompt hidden in a document.",
      href: "/login?as=admin",
      cta: "Run the attacks yourself",
    },
    {
      big: t ? <CountUp to={t.shareSentToHumans * 100} format={(n) => `${Math.round(n)}%`} /> : "—",
      body: t
        ? `of ${t.decisions} live decisions were handed to a person, and ${pct(t.shareAskedForProof)} asked for one more document. We'd rather be slow than wrong about someone's money.`
        : "of decisions are handed to a person whenever any hard stop fires.",
      href: "/transparency",
      cta: "See every number",
    },
    {
      big: t ? <CountUp to={t.scam.falseAlarmRate * 100} format={(n) => `${Math.round(n)}%`} /> : "—",
      body: t
        ? `false-alarm rate on ${t.scam.flagged} flagged messages (${t.scam.falseAlarms} were real). We publish it, because a checker that cries wolf teaches people to ignore it.`
        : "false-alarm rate on flagged messages, published openly.",
      href: "/check",
      cta: "Check a message",
    },
  ];

  return (
    <div className="mt-10">
      <div className="on-dark grid rounded-[45px] bg-ink px-8 py-10 text-white sm:px-14 sm:py-14 lg:grid-cols-3">
        {cols.map((c, i) => (
          <motion.div
            key={c.cta}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ type: "spring", bounce: 0, visualDuration: 0.45, delay: i * 0.08 }}
            className={
              "flex flex-col gap-5 py-8 first:pt-0 last:pb-0 lg:px-12 lg:py-0 lg:first:pl-0 lg:last:pr-0 " +
              (i > 0 ? "border-t border-white/30 lg:border-l lg:border-t-0" : "")
            }
          >
            <div className="font-mono text-[2.75rem] leading-none text-lime">{c.big}</div>
            <p className="text-white/90">{c.body}</p>
            <ArrowLink href={c.href} tone="dark" className="mt-auto">
              {c.cta}
            </ArrowLink>
          </motion.div>
        ))}
      </div>
      <p className="mt-4 text-[15px] text-muted-ink">
        {failed ? "Live numbers are unavailable right now; the suite result is from the last run." : "Live from this prototype’s database. Test sets are synthetic, so these are not real-world accuracy."}
        {t?.aiNeverMovesMoney && " AI moved money: 0 times."}
      </p>
    </div>
  );
}
