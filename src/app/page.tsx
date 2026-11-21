import { SiteHeader, SiteFooter } from "@/components/site/header";
import { Hero } from "@/components/site/hero";
import { Checker } from "@/components/site/checker";
import { Card, CardTitle, ArrowLink, SectionHeader, BtnLink, LANE_INFO, Tag } from "@/components/brut/kit";
import { ArtSeal, ArtHelper, ArtHandoff, ArtVoice, ArtCta } from "@/components/brut/illustrations";
import { LiveNumbers } from "@/components/site/live-numbers";
import { LivePulse } from "@/components/site/live-pulse";
import * as motion from "motion/react-client";

const RAILS = ["Identity registry", "Instant payments", "Income registry", "SMS short code", "Phone line (IVR)"];

const FEATURES = [
  {
    tone: "mist" as const,
    title: ["Signed", "truth"],
    body: "Every message Asli sends is digitally signed and tied to the person's real case. Forward any “relief” SMS and it's checked against the ledger — not guessed from the wording.",
    href: "/check",
    cta: "Check a message",
    Art: ArtSeal,
  },
  {
    tone: "dark" as const,
    title: ["One phone,", "forty families"],
    body: "A community helper switches between families with each family's own PIN. Every family gives its own permission, and can take it back — access stops on the next tap.",
    href: "/login?as=helper",
    cta: "Try helper mode",
    Art: ArtHelper,
  },
  {
    tone: "dark" as const,
    title: ["Says “I am", "not sure”"],
    body: "Twelve named hard stops send a case to a person, whatever the score: a CNIC that belongs to someone else, an edited ID card, a payment account changed yesterday.",
    href: "#safety",
    cta: "See the safety rules",
    Art: ArtHandoff,
  },
  {
    tone: "light" as const,
    title: ["Speak,", "don't type"],
    body: "Answer in Urdu by voice, hear every decision read aloud, or use a basic phone: press 1 for your status, 2 to check a message, 9 if someone is changing your account.",
    href: "/login?as=citizen",
    cta: "Try it as Fatima",
    Art: ArtVoice,
  },
];

const STEPS = [
  { t: "Speak", d: "The widow (or her helper) answers a few questions in Urdu and photographs her ID card." },
  { t: "Asli checks", d: "Identity, documents, income and duplicates are checked with her permission. Every check is logged." },
  { t: "One of four lanes", d: "Provisionally approved, pre-verified, needs one more thing, or “I am not sure”." },
  { t: "A person releases money", d: "Never the AI. Two officers for larger amounts, and never into an account changed in the last 48 hours." },
  { t: "She confirms the amount", d: "A signed message with a 4-digit code arrives. She presses 1 if the full amount reached her." },
];

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main>
        <Hero />
        <LivePulse />

        <section aria-label="Public systems Asli works with" className="container-page">
          <div className="marquee overflow-hidden border-y border-ink/15 py-7 grayscale [mask-image:linear-gradient(to_right,transparent,#000_8%,#000_92%,transparent)]">
            <ul className="marquee-track">
              {[...RAILS, ...RAILS].map((r, i) => (
                <li key={i} aria-hidden={i >= RAILS.length ? true : undefined} className="flex shrink-0 items-center gap-2 pe-14 font-mono text-[15px] uppercase tracking-wider text-ink/70">
                  {r}
                  <span className="rounded-[5px] border border-ink/40 px-1.5 text-[11px]">mock</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="check" className="container-page scroll-mt-8 pt-20 sm:pt-28">
          <SectionHeader title="Is it real?">Scammers copy official wording. Asli checks the signature and the real payment ledger first, then the wording. Try a sample.</SectionHeader>
          <div className="mt-10 rounded-[45px] border border-ink bg-mist p-6 shadow-hard sm:p-12">
            <Checker compact />
          </div>
        </section>

        <section id="how" className="container-page scroll-mt-8 pt-20 sm:pt-28">
          <SectionHeader title="What Asli does">Built for three people: a widow who can&rsquo;t read forms, a shopkeeper drowning in fake &ldquo;relief&rdquo; SMS, and a helper with one phone for forty families.</SectionHeader>
          <div className="mt-10 grid gap-8 md:grid-cols-2">
            {FEATURES.map((f) => (
              <Card key={f.title.join(" ")} tone={f.tone} lift className="flex min-h-[300px] flex-col justify-between gap-8">
                <div className="flex items-start justify-between gap-6">
                  <CardTitle tone={f.tone} className="flex flex-col items-start gap-0.5">
                    {f.title.map((line) => (
                      <span key={line} className={f.tone === "dark" ? "marker-white" : "marker"}>
                        {line}
                      </span>
                    ))}
                  </CardTitle>
                </div>
                <div className="grid items-end gap-6 sm:grid-cols-[1fr_auto]">
                  <div className="space-y-6">
                    <p className={f.tone === "dark" ? "text-white/85" : "text-ink"}>{f.body}</p>
                    <ArrowLink href={f.href} tone={f.tone === "dark" ? "dark" : "light"}>
                      {f.cta}
                    </ArrowLink>
                  </div>
                  <f.Art className="art-float hidden h-36 w-auto sm:block" />
                </div>
              </Card>
            ))}
          </div>
        </section>

        <section className="container-page pt-20 sm:pt-28">
          <div className="relative grid items-center gap-8 overflow-visible rounded-[45px] bg-mist px-8 py-12 sm:px-14 lg:grid-cols-[1.1fr_1fr]">
            <div className="max-w-[30rem] space-y-5">
              <h2 className="text-h3">Try it as Fatima, Rukhsana or an officer</h2>
              <p className="text-ink">Every account in the demo is fictional. Sign in with one tap, apply by voice, check a fake SMS, approve a payout, then try to break it.</p>
              <BtnLink href="/login">Open the demo</BtnLink>
            </div>
            <div className="relative h-56 lg:h-60">
              <ArtCta className="art-float absolute -top-10 left-1/2 h-[19rem] w-auto -translate-x-1/2 lg:-top-16" />
            </div>
          </div>
        </section>

        <section className="container-page pt-20 sm:pt-28">
          <SectionHeader title="How a claim moves">Five steps, in this order. The AI can stop a case at any of them; it can never finish one by sending money.</SectionHeader>
          <ol className="mt-10 grid gap-4 lg:grid-cols-5">
            {STEPS.map((s, i) => (
              <motion.li
                key={s.t}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-40px" }}
                transition={{ type: "spring", bounce: 0, visualDuration: 0.45, delay: i * 0.07 }}
                className="relative rounded-[28px] border border-ink bg-white p-6 shadow-hard"
              >
                <span className="font-mono text-sm text-muted-ink">Step {i + 1}</span>
                <h3 className="mt-2 text-xl font-medium">{s.t}</h3>
                <p className="mt-2 text-[15px] text-muted-ink">{s.d}</p>
              </motion.li>
            ))}
          </ol>
          <div className="mt-8 flex flex-wrap gap-3">
            {Object.entries(LANE_INFO).map(([k, l]) => (
              <span key={k} className="flex items-center gap-2 text-[15px]">
                <Tag tone={l.tone}>{l.label}</Tag>
                <span className="text-muted-ink">{l.hint}</span>
              </span>
            ))}
          </div>
        </section>

        <section id="safety" className="container-page scroll-mt-8 pb-24 pt-20 sm:pt-28">
          <SectionHeader title="Safety, measured">Numbers from the live prototype and its frozen test sets — including the ones that make us look worse.</SectionHeader>
          <LiveNumbers />
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
