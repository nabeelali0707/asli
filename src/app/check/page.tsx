import type { Metadata } from "next";
import { SiteHeader, SiteFooter } from "@/components/site/header";
import { Checker } from "@/components/site/checker";
import { SectionHeader, UrduText } from "@/components/brut/kit";
import { ScamMapPublic } from "@/components/site/scam-map";

export const metadata: Metadata = { title: "Check a message" };

const RULES = [
  { en: "The government never asks for a fee to release relief money.", ur: "حکومت امدادی رقم کے لیے کبھی فیس نہیں مانگتی۔" },
  { en: "Never share an OTP, PIN or code with anyone who calls you.", ur: "کال کرنے والے کو کبھی OTP، PIN یا کوڈ نہ بتائیں۔" },
  { en: "A real Asli message carries a 4-digit code you can check here.", ur: "اصلی پیغام میں 4 ہندسوں کا کوڈ ہوتا ہے جو یہاں چیک ہو سکتا ہے۔" },
];

export default function CheckPage() {
  return (
    <>
      <SiteHeader />
      <main className="container-page pb-24">
        <div className="grid gap-10 pt-6 lg:grid-cols-[1.3fr_1fr] lg:gap-14">
          <div>
            <h1 className="text-h1">
              Got a message about <span className="marker">relief money?</span>
            </h1>
            <p className="mt-5 max-w-[36rem] text-lead">
              Paste it below. Asli checks the digital signature and the real payment ledger first, and only then the wording. If you&rsquo;re a shopkeeper checking a customer&rsquo;s message, that works too.
            </p>
            <div className="mt-8 rounded-[45px] border border-ink bg-mist p-6 shadow-hard sm:p-10">
              <Checker about="someone_else" />
            </div>
          </div>
          <aside className="space-y-4 lg:pt-4">
            <h2 className="text-h3">
              <span className="marker">Three rules</span>
            </h2>
            {RULES.map((r, i) => (
              <div key={i} className="rounded-[28px] border border-ink bg-white p-6 shadow-hard">
                <UrduText className="text-lg">{r.ur}</UrduText>
                <p className="mt-1 text-muted-ink">{r.en}</p>
              </div>
            ))}
          </aside>
        </div>
        <section className="pt-20">
          <SectionHeader title="Where scams are hitting">Reports from the last 30 days, by district. Phone numbers are partly hidden.</SectionHeader>
          <ScamMapPublic />
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
