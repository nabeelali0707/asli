/**
 * Name normalisation and identity matching for messy records (Challenge 03).
 *
 * Principles:
 * - Deterministic and explainable: every match returns the evidence that produced it.
 * - Never merge on a name alone. Name similarity can only *support* a CNIC match or
 *   create a *candidate* for a human — it can never auto-merge two people.
 * - A CNIC that matches but a name that clearly doesn't is a CONFLICT (hard stop), not a match.
 */

// Common transliteration variants in Pakistani names → canonical token.
const VARIANTS: Record<string, string> = {
  muhammad: "muhammad", mohammad: "muhammad", muhammed: "muhammad", mohammed: "muhammad",
  mohamad: "muhammad", muhamad: "muhammad", mohd: "muhammad", muhd: "muhammad", md: "muhammad",
  mohamed: "muhammad", mhd: "muhammad",
  ahmad: "ahmad", ahmed: "ahmad", ahmet: "ahmad",
  hussain: "hussain", husain: "hussain", hussein: "hussain", hosain: "hussain", husayn: "hussain",
  hassan: "hasan", hasan: "hasan",
  fatima: "fatima", fatimah: "fatima", fathima: "fatima", fatma: "fatima",
  ayesha: "ayesha", aisha: "ayesha", aysha: "ayesha", aishah: "ayesha",
  zainab: "zainab", zaynab: "zainab", zenab: "zainab",
  khadija: "khadija", khadijah: "khadija", khadeeja: "khadija",
  bibi: "bibi", bi: "bibi", bibee: "bibi",
  begum: "begum", begam: "begum",
  ali: "ali", aly: "ali",
  abdul: "abdul", abdel: "abdul", abd: "abdul",
  rehman: "rahman", rahman: "rahman", rehmaan: "rahman", rahmaan: "rahman",
  rasheed: "rashid", rashid: "rashid",
  saeed: "saeed", said: "saeed", sayeed: "saeed",
  shah: "shah", sha: "shah",
  khan: "khan",
  noor: "noor", nur: "noor",
  yousaf: "yusuf", yousuf: "yusuf", yusuf: "yusuf", yousef: "yusuf", yusaf: "yusuf",
  iqbal: "iqbal", ikbal: "iqbal",
  shahida: "shahida", shaheeda: "shahida",
  nasreen: "nasreen", nasrin: "nasreen",
  parveen: "parveen", perveen: "parveen", parvin: "parveen",
  ghulam: "ghulam", gulam: "ghulam",
};

// A few Urdu-script names → roman canonical form (records may come in either script).
const URDU_SCRIPT: Record<string, string> = {
  "محمد": "muhammad", "احمد": "ahmad", "علی": "ali", "فاطمہ": "fatima", "عائشہ": "ayesha",
  "زینب": "zainab", "خدیجہ": "khadija", "بی": "bibi", "بیگم": "begum", "حسین": "hussain",
  "حسن": "hasan", "خان": "khan", "عبدال": "abdul", "عبد": "abdul", "رحمان": "rahman", "نور": "noor",
  "یوسف": "yusuf", "اقبال": "iqbal", "شاہدہ": "shahida", "نسرین": "nasreen", "پروین": "parveen",
  "غلام": "ghulam", "شاہ": "shah", "رشید": "rashid", "سعید": "saeed",
};

const HONORIFICS = new Set(["mr", "mrs", "ms", "miss", "dr", "sahib", "sahiba", "syed", "sayyid", "hafiz", "haji", "mst", "mussammat", "musammat"]);

export function normalizeName(raw: string | null | undefined): string {
  if (!raw) return "";
  const tokens = raw
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[.\-_,'"`()]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((tok) => URDU_SCRIPT[tok] ?? tok)
    .map((tok) => tok.replace(/[^a-z؀-ۿ]/g, ""))
    .filter((tok) => tok && !HONORIFICS.has(tok))
    .map((tok) => VARIANTS[tok] ?? tok.replace(/(.)\1+/g, "$1")); // collapse doubled letters
  return tokens.join(" ");
}

export function normalizeCnic(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length === 13 ? digits : null;
}

export function formatCnic(cnic: string): string {
  return `${cnic.slice(0, 5)}-${cnic.slice(5, 12)}-${cnic.slice(12)}`;
}

/** Mask all but the last 4 digits: 42101-*******-1 style. */
export function maskCnic(cnic: string | null | undefined): string | null {
  if (!cnic) return null;
  return `${cnic.slice(0, 2)}***-*******-${cnic.slice(12)}`;
}

export function jaroWinkler(a: string, b: string): number {
  if (a === b) return a.length ? 1 : 0;
  if (!a.length || !b.length) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aM = new Array<boolean>(a.length).fill(false);
  const bM = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - range);
    const hi = Math.min(i + range + 1, b.length);
    for (let j = lo; j < hi; j++) {
      if (bM[j] || a[i] !== b[j]) continue;
      aM[i] = bM[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let k = 0;
  let transpositions = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aM[i]) continue;
    while (!bM[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  const m = matches;
  const jaro = (m / a.length + m / b.length + (m - transpositions / 2) / m) / 3;
  let prefix = 0;
  while (prefix < 4 && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

/** Token-aware similarity of two already-normalised names (order-insensitive). */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = na.split(" ");
  const tb = nb.split(" ");
  const best = (xs: string[], ys: string[]) =>
    xs.reduce((sum, x) => sum + Math.max(...ys.map((y) => jaroWinkler(x, y))), 0) / xs.length;
  const sym = (best(ta, tb) + best(tb, ta)) / 2;
  const whole = jaroWinkler(ta.slice().sort().join(" "), tb.slice().sort().join(" "));
  return Math.round(Math.max(sym, whole) * 1000) / 1000;
}

export type IdentityClaim = {
  fullName?: string | null;
  fatherName?: string | null;
  cnic?: string | null;
  dob?: string | null;
};

export type IdentityVerdict = "verified" | "probable" | "candidate" | "conflict" | "no_record" | "insufficient";

export type IdentityMatch = {
  verdict: IdentityVerdict;
  score: number; // 0..1 evidence strength
  evidence: { check: string; result: "pass" | "fail" | "unknown"; detail: string }[];
};

export const NAME_STRONG = 0.92;
export const NAME_WEAK = 0.8;

/** Compare a claim against an authoritative record (e.g. mock NADRA). */
export function matchIdentity(claim: IdentityClaim, record: IdentityClaim | null): IdentityMatch {
  const evidence: IdentityMatch["evidence"] = [];
  const cnic = normalizeCnic(claim.cnic);
  if (!cnic) {
    evidence.push({ check: "cnic", result: "unknown", detail: "No valid 13-digit CNIC provided" });
    return { verdict: "insufficient", score: 0, evidence };
  }
  if (!record) {
    evidence.push({ check: "cnic", result: "fail", detail: "CNIC not found in identity registry" });
    return { verdict: "no_record", score: 0, evidence };
  }
  evidence.push({ check: "cnic", result: "pass", detail: "CNIC found in identity registry" });

  const nameSim = claim.fullName ? nameSimilarity(claim.fullName, record.fullName ?? "") : null;
  if (nameSim === null) evidence.push({ check: "name", result: "unknown", detail: "No name provided" });
  else
    evidence.push({
      check: "name",
      result: nameSim >= NAME_STRONG ? "pass" : nameSim >= NAME_WEAK ? "unknown" : "fail",
      detail: `Name similarity ${nameSim} ("${claim.fullName}" vs registry; normalised "${normalizeName(claim.fullName)}" vs "${normalizeName(record.fullName)}")`,
    });

  const fatherSim = claim.fatherName && record.fatherName ? nameSimilarity(claim.fatherName, record.fatherName) : null;
  if (fatherSim === null) evidence.push({ check: "father_name", result: "unknown", detail: "Father's name not provided" });
  else
    evidence.push({
      check: "father_name",
      result: fatherSim >= NAME_STRONG ? "pass" : fatherSim >= NAME_WEAK ? "unknown" : "fail",
      detail: `Father's name similarity ${fatherSim}`,
    });

  const dobMatch = claim.dob && record.dob ? claim.dob === record.dob : null;
  evidence.push({
    check: "dob",
    result: dobMatch === null ? "unknown" : dobMatch ? "pass" : "fail",
    detail: dobMatch === null ? "Date of birth not provided" : dobMatch ? "Date of birth matches" : "Date of birth differs",
  });

  // CNIC matches but the name clearly belongs to someone else → conflict, never a match.
  if (nameSim !== null && nameSim < NAME_WEAK) {
    return { verdict: "conflict", score: 0.1, evidence };
  }
  if (dobMatch === false && (fatherSim === null || fatherSim < NAME_STRONG)) {
    return { verdict: "conflict", score: 0.2, evidence };
  }
  const supports = [fatherSim !== null && fatherSim >= NAME_STRONG, dobMatch === true].filter(Boolean).length;
  if (nameSim !== null && nameSim >= NAME_STRONG && supports >= 1) {
    return { verdict: "verified", score: Math.min(1, 0.8 + 0.1 * supports), evidence };
  }
  if (nameSim !== null && nameSim >= NAME_STRONG) {
    return { verdict: "probable", score: 0.7, evidence };
  }
  // Name in the grey zone (e.g. a spelling variant we don't know): needs one more proof.
  if (supports >= 1) return { verdict: "probable", score: 0.6, evidence };
  return { verdict: "candidate", score: 0.4, evidence };
}

export type DuplicateCandidate = { id: string; reason: string; nameSimilarity: number };

/** Find possible duplicate beneficiary records. Returns candidates for a human — never merges. */
export function findDuplicateCandidates(
  target: { id: string; fullName: string; fatherName?: string | null; cnic?: string | null; dob?: string | null },
  others: { id: string; fullName: string; fatherName?: string | null; cnic?: string | null; dob?: string | null; mergedInto?: string | null }[],
): DuplicateCandidate[] {
  const out: DuplicateCandidate[] = [];
  for (const o of others) {
    if (o.id === target.id || o.mergedInto) continue;
    const sim = nameSimilarity(target.fullName, o.fullName);
    const sameCnic = target.cnic && o.cnic && normalizeCnic(target.cnic) === normalizeCnic(o.cnic);
    if (sameCnic) {
      out.push({ id: o.id, reason: "same CNIC on two records", nameSimilarity: sim });
      continue;
    }
    const fatherSim = target.fatherName && o.fatherName ? nameSimilarity(target.fatherName, o.fatherName) : 0;
    const sameDob = !!target.dob && target.dob === o.dob;
    if (sim >= NAME_STRONG && (fatherSim >= NAME_STRONG || sameDob)) {
      out.push({ id: o.id, reason: "same name with matching father's name or date of birth, different or missing CNIC", nameSimilarity: sim });
    }
  }
  return out;
}
