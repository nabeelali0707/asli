"use client";

import { Checker } from "@/components/site/checker";
import { useSession } from "@/lib/hooks";

export default function CitizenCheck() {
  const s = useSession();
  return (
    <div className="max-w-3xl">
      <h1 className="text-h1">
        Is this message <span className="marker">real?</span>
      </h1>
      <p className="mt-3 text-lead text-muted-ink">
        {s?.user.email.startsWith("shopkeeper") ? "Checking a customer's message? We won't use your own case as evidence." : "Checked against your own case and the payment ledger."}
      </p>
      <div className="mt-8 rounded-[28px] border border-ink bg-mist p-6 shadow-hard sm:p-8">
        <Checker about={s?.user.email.startsWith("shopkeeper") ? "someone_else" : "me"} />
      </div>
    </div>
  );
}
