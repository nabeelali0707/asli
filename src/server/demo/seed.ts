/**
 * Demo seed — ALL DATA IS FICTIONAL. Builds a believable state by running the REAL flows
 * (cases, documents, decisions, approvals, payouts, signed notices, scam checks), not by
 * inserting results directly. Demo login password for every account: see DEMO_PASSWORD below.
 */
import { eq } from "drizzle-orm";
import type { DB } from "../db/client";
import { tenants, users, citizens, mockNadra, mockIncome } from "../db/schema";
import { hashPassword } from "../auth/tokens";
import { normalizeName } from "../domain/names";
import { renderMockCnic } from "../domain/documents";
import { activeRuleSet } from "../services/rules";
import { grantConsent } from "../services/consent";
import { createCase, addDocument, submitCase, approveCase, addPayoutApproval } from "../services/cases";
import { verifyMessage } from "../services/verify";
import { reviewScamReport } from "../services/insights";
import type { Actor } from "../lib/actor";
import sharp from "sharp";

export const DEMO_PASSWORD = "asli-demo-2026";
export const DEMO_PIN = "4321";

type U = { id: string; email: string; role: "citizen" | "helper" | "officer" | "admin" | "auditor"; name: string; second?: boolean; citizenId?: string };

const T1 = "tnt_rahat_punjab";
const T2 = "tnt_sindh_social";

const PEOPLE = [
  // id, name, father, cnic, dob, gender, district, marital, alive, income, household, phone, alias
  { id: "ctz_fatima", name: "Fatima Bibi", father: "Allah Ditta", cnic: "3520112345671", dob: "1968-04-12", g: "F", d: "Lahore", m: "widowed", alive: true, inc: 18000, hh: 5, phone: "03001112233", alias: "03001112233" },
  { id: "ctz_imran", name: "Imran Khan Niazi", father: "Ikramullah", cnic: "3520198765431", dob: "1979-09-02", g: "M", d: "Lahore", m: "married", alive: true, inc: 52000, hh: 4, phone: "03214445566", alias: "03214445566" },
  { id: "ctz_aslam", name: "Muhammad Aslam", father: "Ghulam Nabi", cnic: "3540155566671", dob: "1975-03-14", g: "M", d: "Kasur", m: "married", alive: true, inc: 22000, hh: 6, phone: "03335556677", alias: "03335556677" },
  { id: "ctz_aslam_dup", name: "Mohammad Aslam", father: "Ghulam Nabee", cnic: "3540155566682", dob: "1975-03-14", g: "M", d: "Kasur", m: "married", alive: true, inc: 22000, hh: 6, phone: "03335556678", alias: "03335556678" },
  { id: "ctz_zainab", name: "Zainab Begum", father: "Muhammad Rafiq", cnic: "3410177788891", dob: "1983-11-30", g: "F", d: "Gujranwala", m: "widowed", alive: true, inc: 15000, hh: 3, phone: "03451231234", alias: "03451231234" },
  { id: "ctz_shahida", name: "Shahida Parveen", father: "Abdul Ghani", cnic: "3610122233341", dob: "1990-06-18", g: "F", d: "Multan", m: "married", alive: true, inc: 26000, hh: 7, phone: "03017778899", alias: "03017778899" },
  { id: "ctz_khadija", name: "Khadija Bibi", father: "Noor Muhammad", cnic: "3810144455561", dob: "1960-01-05", g: "F", d: "Bahawalpur", m: "widowed", alive: true, inc: 9000, hh: 2, phone: "03024445566", alias: "03024445566" },
  { id: "ctz_yusuf", name: "Yousaf Ali", father: "Rasheed Ahmad", cnic: "3520166677781", dob: "1985-08-21", g: "M", d: "Lahore", m: "married", alive: true, inc: 31000, hh: 5, phone: "03128889900", alias: "03128889900" },
  // Sindh department (second tenant) — for cross-department tests
  { id: "ctz_naseem", name: "Naseem Akhtar", father: "Abdul Karim", cnic: "4210133344451", dob: "1972-02-02", g: "F", d: "Karachi", m: "widowed", alive: true, inc: 14000, hh: 4, phone: "03002223344", alias: "03002223344", tenant: T2 },
] as const;

async function incomeProofPng(name: string, income: number, opts: { blur?: boolean } = {}) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600"><rect width="900" height="600" fill="#fffdf5"/><text x="40" y="70" font-family="Arial" font-size="32" font-weight="bold">MOCK INCOME CERTIFICATE — PROTOTYPE</text><text x="40" y="160" font-family="Arial" font-size="28">Union Council 42 (mock) certifies that</text><text x="40" y="220" font-family="Arial" font-size="34" font-weight="bold">${name}</text><text x="40" y="290" font-family="Arial" font-size="28">has a monthly household income of</text><text x="40" y="350" font-family="Arial" font-size="40" font-weight="bold">Rs ${income.toLocaleString("en-US")}</text><text x="40" y="540" font-family="Arial" font-size="20" fill="#777">NOT A REAL DOCUMENT · generated for the Coder's Cup demo</text></svg>`;
  let img = sharp(Buffer.from(svg)).png();
  if (opts.blur) img = sharp(await img.toBuffer()).blur(12).png();
  return (await img.toBuffer()).toString("base64");
}

export async function seedDemo(db: DB, opts: { log?: (s: string) => void } = {}) {
  const log = opts.log ?? (() => {});
  const [already] = await db.select().from(tenants).where(eq(tenants.id, T1));
  if (already) {
    log("Demo data already present — skipping (run db:reset to start over).");
    return { skipped: true };
  }
  await db.insert(tenants).values([
    { id: T1, slug: "rahat-punjab", name: "Rahat Relief — Punjab (mock department)", plan: "standard" },
    { id: T2, slug: "sindh-social", name: "Sindh Social Protection (mock department)", plan: "free" },
  ]);
  const pw = await hashPassword(DEMO_PASSWORD);
  const pin = await hashPassword(DEMO_PIN);

  for (const p of PEOPLE) {
    await db.insert(mockNadra).values({ cnic: p.cnic, fullName: p.name, fatherName: p.father, dob: p.dob, gender: p.g, district: p.d, maritalStatus: p.m, alive: p.alive });
    await db.insert(mockIncome).values({ cnic: p.cnic, monthlyIncome: p.inc, householdSize: p.hh, source: "mock social registry" });
    await db.insert(citizens).values({
      id: p.id,
      tenantId: "tenant" in p ? p.tenant : T1,
      fullName: p.name,
      nameKey: normalizeName(p.name),
      fatherName: p.father,
      cnic: p.id === "ctz_fatima" ? null : p.cnic, // Fatima's record is incomplete: CNIC comes from her ID card photo
      dob: p.id === "ctz_fatima" ? null : p.dob,
      gender: p.g,
      district: p.d,
      phone: p.phone,
      payoutAlias: p.alias,
      pinHash: pin,
    });
  }
  // Registry quirk: the registry spells Fatima's father differently from her own records.
  await db.update(mockNadra).set({ fatherName: "Allah Dita" }).where(eq(mockNadra.cnic, "3520112345671"));

  const staff: U[] = [
    { id: "usr_admin", email: "admin@asli.demo", role: "admin", name: "Sana Admin" },
    { id: "usr_officer1", email: "officer@asli.demo", role: "officer", name: "Officer Bilal", second: false },
    { id: "usr_officer2", email: "officer2@asli.demo", role: "officer", name: "Officer Hina (second approver)", second: true },
    { id: "usr_helper", email: "helper@asli.demo", role: "helper", name: "Rukhsana (community helper)" },
    { id: "usr_auditor", email: "auditor@asli.demo", role: "auditor", name: "Auditor Kamran" },
    { id: "usr_fatima", email: "fatima@asli.demo", role: "citizen", name: "Fatima Bibi", citizenId: "ctz_fatima" },
    { id: "usr_imran", email: "shopkeeper@asli.demo", role: "citizen", name: "Imran (shopkeeper)", citizenId: "ctz_imran" },
  ];
  for (const u of staff) {
    await db.insert(users).values({ id: u.id, tenantId: T1, email: u.email, passwordHash: pw, role: u.role, displayName: u.name, citizenId: u.citizenId ?? null, canSecondApprove: !!u.second });
  }
  await db.insert(users).values({ id: "usr_sindh_officer", tenantId: T2, email: "officer@sindh.demo", passwordHash: pw, role: "officer", displayName: "Sindh Officer", canSecondApprove: true });
  await activeRuleSet(db, T1);
  await activeRuleSet(db, T2);
  log("Departments, users, mock registries, rules v1 ✓");

  const actorOf = (u: U): Actor => ({ type: "user", id: u.id, role: u.role, tenantId: T1, citizenId: u.citizenId ?? null, displayName: u.name, canSecondApprove: !!u.second });
  const [admin, officer1, officer2, helper, , fatimaUser, imranUser] = staff.map(actorOf) as Actor[];
  const system: Actor = { type: "system", id: "seed", tenantId: T1, role: "system" };

  // Helper Rukhsana assists families on her shared phone (consent per family).
  for (const cid of ["ctz_fatima", "ctz_zainab", "ctz_shahida", "ctz_khadija", "ctz_aslam_dup"]) {
    await grantConsent(db, system, { citizenId: cid, granteeType: "user", granteeId: "usr_helper", scopes: ["case.write", "case.read", "documents.read", "identity.read", "payout.read"], purpose: "helper_assistance", expiresInDays: 180, grantedVia: "voice" });
  }

  const person = (id: string) => PEOPLE.find((p) => p.id === id)!;
  const cnicPng = async (id: string, o: Parameters<typeof renderMockCnic>[2] = {}) => {
    const p = person(id);
    return (await renderMockCnic(db, { fullName: p.name, fatherName: p.father, cnic: p.cnic, dob: p.dob, gender: p.g, district: p.d }, o)).toString("base64");
  };
  const helperCtx = (citizenId: string) => ({ actor: helper, actFor: { citizenId, consentId: "seed" } });

  // 1) Fatima (the widow): helper files with voice statement; CNIC photo; income proof → decide → approve (Rs 12,000 > limit → 2 officers) → paid.
  {
    const ctx = helperCtx("ctz_fatima");
    const { case: c } = await createCase(db, ctx, { claim: { fullName: "Fatimah Bibi", maritalStatus: "widowed", householdSize: 5, monthlyIncome: 18000, statement: "Mera naam Fatimah Bibi hai, main bewa hoon, ghar mein 5 log hain, aamdani 18000." }, createdVia: "voice" });
    await addDocument(db, ctx, c.id, { kind: "cnic", mime: "image/png", contentBase64: await cnicPng("ctz_fatima") });
    await addDocument(db, ctx, c.id, { kind: "income_proof", mime: "image/png", contentBase64: await incomeProofPng("Fatima Bibi", 18000) });
    const s = await submitCase(db, ctx, c.id);
    log(`Fatima's case ${c.id}: lane ${s.decision.lane} (score ${s.decision.score})`);
    {
      const a = await approveCase(db, officer1, c.id, { note: "Verified by phone call with helper present." });
      if (!a.released) await addPayoutApproval(db, officer2, a.payoutId);
      log("Fatima paid via mock Raast; signed payment notice sent ✓");
    }
  }
  // 2) Zainab: income proof photo blurry → ask for proof (retake).
  {
    const ctx = helperCtx("ctz_zainab");
    const { case: c } = await createCase(db, ctx, { claim: { maritalStatus: "widowed", householdSize: 3 } });
    await addDocument(db, ctx, c.id, { kind: "cnic", mime: "image/png", contentBase64: await cnicPng("ctz_zainab") });
    await addDocument(db, ctx, c.id, { kind: "income_proof", mime: "image/png", contentBase64: await incomeProofPng("Zainab Begum", 15000, { blur: true }) });
    const s = await submitCase(db, ctx, c.id);
    log(`Zainab's case: lane ${s.decision.lane}, asked for ${s.decision.proofItems.join(", ")}`);
  }
  // 3) "Mohammad Aslam": near-duplicate of Muhammad Aslam (same father/DOB, different CNIC) → human.
  {
    const ctx = helperCtx("ctz_aslam_dup");
    const { case: c } = await createCase(db, ctx, { claim: { householdSize: 6 } });
    await addDocument(db, ctx, c.id, { kind: "cnic", mime: "image/png", contentBase64: await cnicPng("ctz_aslam_dup") });
    await addDocument(db, ctx, c.id, { kind: "income_proof", mime: "image/png", contentBase64: await incomeProofPng("Mohammad Aslam", 22000) });
    const s = await submitCase(db, ctx, c.id);
    log(`Duplicate-suspect case: lane ${s.decision.lane} (${s.decision.hardStops.join(", ")})`);
  }
  // 4) Shahida: forged CNIC (QR edited after signing) → hard stop → human.
  {
    const ctx = helperCtx("ctz_shahida");
    const { case: c } = await createCase(db, ctx, { claim: { householdSize: 7 } });
    await addDocument(db, ctx, c.id, { kind: "cnic", mime: "image/png", contentBase64: await cnicPng("ctz_shahida", { tamperQr: true }) });
    await addDocument(db, ctx, c.id, { kind: "income_proof", mime: "image/png", contentBase64: await incomeProofPng("Shahida Parveen", 26000) });
    const s = await submitCase(db, ctx, c.id);
    log(`Forged-document case: lane ${s.decision.lane} (${s.decision.hardStops.join(", ")})`);
  }
  // 5) Khadija: clean and complete → fast lane (waiting for one-tap officer approval).
  {
    const ctx = helperCtx("ctz_khadija");
    const { case: c } = await createCase(db, ctx, { claim: { maritalStatus: "widowed", householdSize: 2 } });
    await addDocument(db, ctx, c.id, { kind: "cnic", mime: "image/png", contentBase64: await cnicPng("ctz_khadija") });
    await addDocument(db, ctx, c.id, { kind: "income_proof", mime: "image/png", contentBase64: await incomeProofPng("Khadija Bibi", 9000) });
    const s = await submitCase(db, ctx, c.id);
    log(`Clean case: lane ${s.decision.lane} (score ${s.decision.score})`);
  }
  // 6) Imran the shopkeeper applies himself; income above the limit → rule fails → human (never auto-rejected).
  {
    const ctx = { actor: imranUser };
    const { case: c } = await createCase(db, ctx, { claim: { monthlyIncome: 52000, householdSize: 4 } });
    await addDocument(db, ctx, c.id, { kind: "cnic", mime: "image/png", contentBase64: await cnicPng("ctz_imran") });
    await addDocument(db, ctx, c.id, { kind: "income_proof", mime: "image/png", contentBase64: await incomeProofPng("Imran Khan Niazi", 52000) });
    const s = await submitCase(db, ctx, c.id);
    log(`Over-income case: lane ${s.decision.lane}, eligible=${s.decision.eligible}`);
  }

  // Scam messages the shopkeeper and others forwarded (feeds the Scam Map; one is a false alarm).
  const scams: { text: string; sender: string; district: string; citizen?: string }[] = [
    { text: "BISP: Mubarak ho! Aap ki Rs. 25,000 relief payment approve ho gayi hai. Release ke liye Rs 500 processing fee 03451234567 par jama karwayen. Aaj hi!", sender: "03451234567", district: "Lahore", citizen: "ctz_imran" },
    { text: "Benazir program: your Rs 12,000 is ready. Share the OTP sent to your phone with our agent to receive it.", sender: "03009998887", district: "Lahore" },
    { text: "Govt Relief 2026: click bit.ly/relief-pk to claim Rs 30,000 before midnight.", sender: "03112223334", district: "Kasur" },
    { text: "Ehsaas: Rs 25000 approved. Call 03211112222 on WhatsApp to confirm your CNIC and PIN.", sender: "03211112222", district: "Multan" },
    { text: "حکومت کی طرف سے آپ کو 25,000 روپے امداد منظور ہوئی ہے۔ فیس 1000 روپے ایزی پیسہ کریں۔", sender: "03331110000", district: "Bahawalpur" },
    { text: "BISP: Rs. 25,000 aap ke liye manzoor. Registration fee 300 rupay bhejein.", sender: "03451234567", district: "Lahore" },
    { text: "Relief payment update: your application is under review. No action needed.", sender: "8171", district: "Gujranwala" },
  ];
  for (const s of scams) await verifyMessage(db, s.citizen ? imranUser : system, { text: s.text, sender: s.sender, district: s.district, citizenId: s.citizen ?? null, tenantId: T1 });
  // An officer reviews: the last one turns out to be a genuine (mock) programme message → recorded FALSE ALARM.
  const { scamReports } = await import("../db/schema");
  const reports = await db.select().from(scamReports).where(eq(scamReports.tenantId, T1));
  for (const r of reports) {
    await reviewScamReport(db, officer1, r.id, r.sender === "8171" ? "false_alarm" : "confirmed_scam", r.sender === "8171" ? "Genuine status update from the programme; flagged only because it was not linked to a case." : undefined);
  }
  log(`Scam reports: ${reports.length} (1 recorded as a false alarm) ✓`);
  void admin;
  void fatimaUser;
  return { skipped: false, tenants: [T1, T2] };
}
