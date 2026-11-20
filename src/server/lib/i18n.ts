/**
 * Bilingual (English / Urdu) user-facing messages. Every message has an audio key so the
 * frontend can play a pre-recorded clip on weak connections and fall back to TTS otherwise.
 * Messages are short, plain, and avoid jargon — written for someone who cannot read the form.
 */
export type Bilingual = { en: string; ur: string };
export type Spoken = Bilingual & { audioKey: string };

type Vars = Record<string, string | number>;
const fill = (s: string, v: Vars = {}) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? `{${k}}`));

const M = {
  // ── decision lanes ──
  "lane.auto": {
    en: "Good news: your claim is provisionally approved for Rs {amount}. The money is reserved for you and will be sent after an officer's final check, after {coolHours} hours. If anything looks wrong, say so and we will stop it.",
    ur: "خوشخبری: آپ کا دعویٰ {amount} روپے کے لیے عارضی طور پر منظور ہو گیا ہے۔ رقم آپ کے لیے محفوظ کر دی گئی ہے اور {coolHours} گھنٹے بعد افسر کی آخری جانچ کے بعد بھیجی جائے گی۔ اگر کچھ غلط لگے تو بتائیں، ہم اسے روک دیں گے۔",
  },
  "lane.fast": {
    en: "Your papers look complete. An officer will confirm your payment soon. Nothing has been paid yet.",
    ur: "آپ کے کاغذات مکمل لگتے ہیں۔ ایک افسر جلد آپ کی ادائیگی کی تصدیق کرے گا۔ ابھی کوئی رقم ادا نہیں ہوئی۔",
  },
  "lane.ask_proof": {
    en: "We need one more thing from you: {items}. Please send it within {hours} hours. Your application is saved.",
    ur: "ہمیں آپ سے ایک اور چیز چاہیے: {items}۔ براہ کرم {hours} گھنٹوں میں بھیج دیں۔ آپ کی درخواست محفوظ ہے۔",
  },
  "lane.human": {
    en: "I am not sure about your case, so a person will check it. An officer will contact you. Nothing has been approved or rejected yet.",
    ur: "مجھے آپ کے کیس کے بارے میں یقین نہیں، اس لیے ایک انسان اسے دیکھے گا۔ ایک افسر آپ سے رابطہ کرے گا۔ ابھی کچھ منظور یا مسترد نہیں ہوا۔",
  },
  "lane.ineligible": {
    en: "Under the current rules you do not qualify yet: {reason}. A person will review this before anything is final. You can appeal by speaking to us.",
    ur: "موجودہ قواعد کے تحت آپ ابھی اہل نہیں: {reason}۔ حتمی فیصلے سے پہلے ایک انسان اسے دیکھے گا۔ آپ بول کر اپیل کر سکتی ہیں۔",
  },

  // ── proof items ──
  "proof.cnic": { en: "a clear photo of your ID card (CNIC)", ur: "اپنے شناختی کارڈ کی صاف تصویر" },
  "proof.income_proof": { en: "proof of your monthly income", ur: "اپنی ماہانہ آمدنی کا ثبوت" },
  "proof.father_name": { en: "your father's name", ur: "اپنے والد کا نام" },
  "proof.dob": { en: "your date of birth", ur: "اپنی تاریخ پیدائش" },
  "proof.retake_photo": { en: "a new photo — hold the phone steady in good light", ur: "نئی تصویر — فون کو روشنی میں سیدھا پکڑیں" },

  // ── signed truth verifier ──
  "verify.genuine": {
    en: "This message is real. It is from Asli and matches your case. Amount: Rs {amount}. You never need to pay any fee.",
    ur: "یہ پیغام اصلی ہے۔ یہ اصلی کی طرف سے ہے اور آپ کے کیس سے ملتا ہے۔ رقم: {amount} روپے۔ آپ کو کبھی کوئی فیس نہیں دینی۔",
  },
  "verify.tampered": {
    en: "Warning: this message was changed after it was sent. Do not trust it. Do not pay anyone.",
    ur: "خبردار: یہ پیغام بھیجنے کے بعد بدلا گیا ہے۔ اس پر بھروسہ نہ کریں۔ کسی کو پیسے نہ دیں۔",
  },
  "verify.scam": {
    en: "This message is fake. The government never asks for a fee, OTP or PIN to release relief money. Do not pay, do not share any code. We have reported it.",
    ur: "یہ پیغام جعلی ہے۔ حکومت امدادی رقم کے لیے کبھی فیس، OTP یا PIN نہیں مانگتی۔ پیسے نہ دیں، کوئی کوڈ نہ بتائیں۔ ہم نے اس کی رپورٹ کر دی ہے۔",
  },
  "verify.not_linked": {
    en: "This message does not match any payment on your case. You have no pending payment of this kind. Do not pay anyone.",
    ur: "یہ پیغام آپ کے کیس کی کسی ادائیگی سے نہیں ملتا۔ آپ کی ایسی کوئی رقم باقی نہیں۔ کسی کو پیسے نہ دیں۔",
  },
  "verify.code_mismatch": {
    en: "The code in this message belongs to a different payment. Someone may have copied a real code. Do not trust it.",
    ur: "اس پیغام کا کوڈ کسی اور ادائیگی کا ہے۔ ہو سکتا ہے کسی نے اصلی کوڈ نقل کیا ہو۔ اس پر بھروسہ نہ کریں۔",
  },
  "verify.expired": {
    en: "This message was real but it has expired. Ask your helper or call the helpline before doing anything.",
    ur: "یہ پیغام اصلی تھا مگر اب اس کی مدت ختم ہو چکی ہے۔ کچھ کرنے سے پہلے اپنے مددگار یا ہیلپ لائن سے پوچھیں۔",
  },
  "verify.suspicious": {
    en: "I am not sure about this message. It is not linked to your case. Do not pay or share anything until a person checks it.",
    ur: "مجھے اس پیغام کے بارے میں یقین نہیں۔ یہ آپ کے کیس سے منسلک نہیں۔ جب تک کوئی انسان نہ دیکھ لے، نہ پیسے دیں نہ کچھ بتائیں۔",
  },
  "verify.unrelated": {
    en: "This message is not about relief money. No action needed from Asli.",
    ur: "یہ پیغام امدادی رقم کے بارے میں نہیں۔ اصلی کی طرف سے کوئی کارروائی ضروری نہیں۔",
  },

  // ── notices (signed) ──
  "notice.payment_released": {
    en: "Asli: Rs {amount} has been sent to your account for case {caseRef}. Your code is {code}. No fee is ever required.",
    ur: "اصلی: کیس {caseRef} کے لیے {amount} روپے آپ کے اکاؤنٹ میں بھیج دیے گئے ہیں۔ آپ کا کوڈ {code} ہے۔ کبھی کوئی فیس نہیں لی جاتی۔",
  },
  "notice.decision": {
    en: "Asli: there is an update on your case {caseRef}. Your code is {code}.",
    ur: "اصلی: آپ کے کیس {caseRef} میں نئی معلومات ہیں۔ آپ کا کوڈ {code} ہے۔",
  },
  "notice.proof_requested": {
    en: "Asli: we need one more document for case {caseRef}. Your code is {code}. We will never ask for money.",
    ur: "اصلی: کیس {caseRef} کے لیے ہمیں ایک اور کاغذ چاہیے۔ آپ کا کوڈ {code} ہے۔ ہم کبھی پیسے نہیں مانگیں گے۔",
  },
  "notice.case_received": {
    en: "Asli: we received your application, case {caseRef}. Your code is {code}.",
    ur: "اصلی: ہمیں آپ کی درخواست مل گئی ہے، کیس {caseRef}۔ آپ کا کوڈ {code} ہے۔",
  },

  // ── consent ──
  "consent.receipt": {
    en: "You allow {grantee} to use your {scopes} for {purpose} until {until}. You can take this back at any time.",
    ur: "آپ {grantee} کو اجازت دیتی ہیں کہ وہ {purpose} کے لیے آپ کی {scopes} استعمال کرے، {until} تک۔ آپ یہ اجازت کسی بھی وقت واپس لے سکتی ہیں۔",
  },
  "consent.withdrawn": {
    en: "You have taken back permission from {grantee}. They can no longer see your information.",
    ur: "آپ نے {grantee} سے اجازت واپس لے لی ہے۔ اب وہ آپ کی معلومات نہیں دیکھ سکتے۔",
  },

  // ── handoff / appeal ──
  "handoff.created": {
    en: "Your case has been given to an officer, with all your papers attached. You do not need to start again.",
    ur: "آپ کا کیس آپ کے تمام کاغذات کے ساتھ ایک افسر کو دے دیا گیا ہے۔ آپ کو دوبارہ شروع کرنے کی ضرورت نہیں۔",
  },
  "appeal.received": {
    en: "We received your appeal. A different officer will look at your case again.",
    ur: "ہمیں آپ کی اپیل مل گئی ہے۔ ایک دوسرا افسر آپ کے کیس کو دوبارہ دیکھے گا۔",
  },

  // ── payout account protection ──
  "payout.change_requested": {
    en: "We received a request to change where your money is sent. An officer will check it, and it only takes effect after 48 hours.",
    ur: "آپ کی رقم بھیجنے کا اکاؤنٹ بدلنے کی درخواست ملی ہے۔ ایک افسر اس کی جانچ کرے گا، اور یہ 48 گھنٹے بعد ہی نافذ ہو گی۔",
  },
  "payout.change_requested_old_number": {
    en: "Asli: someone asked to change the account where your relief money is sent. If this was NOT you, call Asli and press 9 to stop it.",
    ur: "اصلی: کسی نے آپ کی امدادی رقم کا اکاؤنٹ بدلنے کی درخواست کی ہے۔ اگر یہ آپ نے نہیں کی تو اصلی کو کال کر کے 9 دبائیں تاکہ اسے روکا جا سکے۔",
  },
  "payout.change_frozen": {
    en: "Stopped. The account change is frozen and an officer will call you. Your money will not go to the new account.",
    ur: "روک دیا گیا۔ اکاؤنٹ کی تبدیلی منجمد کر دی گئی ہے اور ایک افسر آپ کو کال کرے گا۔ آپ کی رقم نئے اکاؤنٹ میں نہیں جائے گی۔",
  },
  "payout.change_applied": {
    en: "Asli: your payment account has been changed. If this was not you, call Asli and press 3 right away.",
    ur: "اصلی: آپ کا ادائیگی کا اکاؤنٹ بدل دیا گیا ہے۔ اگر یہ آپ نے نہیں کیا تو فوراً اصلی کو کال کر کے 3 دبائیں۔",
  },
  "receipt.ask": {
    en: "Did you receive exactly Rs {amount}? Press 1 for yes. Press 2 if you received less. Press 3 if you received nothing.",
    ur: "کیا آپ کو پورے {amount} روپے ملے؟ ہاں کے لیے 1 دبائیں۔ کم ملے ہوں تو 2 دبائیں۔ کچھ نہیں ملا تو 3 دبائیں۔",
  },
  "receipt.thanks": { en: "Thank you. We have recorded that you received the full amount.", ur: "شکریہ۔ ہم نے درج کر لیا ہے کہ آپ کو پوری رقم مل گئی۔" },
  "receipt.complaint_opened": {
    en: "We are sorry. A complaint has been opened and an officer will call you. Nobody is allowed to keep any part of your money.",
    ur: "ہمیں افسوس ہے۔ شکایت درج کر لی گئی ہے اور ایک افسر آپ کو کال کرے گا۔ کسی کو آپ کی رقم کا کوئی حصہ رکھنے کی اجازت نہیں۔",
  },

  // ── IVR ──
  "ivr.welcome": {
    en: "Assalam o Alaikum. This is Asli. Press 1 to hear your case status. Press 2 to check a message you received. Press 3 to talk to a person. Press 4 to tell us how much money you received. Press 9 if someone is changing your payment account without your permission.",
    ur: "السلام علیکم۔ یہ اصلی ہے۔ اپنے کیس کی صورتحال سننے کے لیے 1 دبائیں۔ کسی موصول شدہ پیغام کی تصدیق کے لیے 2 دبائیں۔ کسی انسان سے بات کرنے کے لیے 3 دبائیں۔ ملنے والی رقم بتانے کے لیے 4 دبائیں۔ اگر کوئی آپ کی اجازت کے بغیر آپ کا ادائیگی اکاؤنٹ بدل رہا ہے تو 9 دبائیں۔",
  },
  "ivr.status": {
    en: "Your case {caseRef} is {status}. {detail}",
    ur: "آپ کا کیس {caseRef} اس وقت {status} ہے۔ {detail}",
  },
  "ivr.no_case": {
    en: "We could not find a case for this phone number. Press 3 to talk to a person.",
    ur: "اس فون نمبر پر کوئی کیس نہیں ملا۔ کسی انسان سے بات کرنے کے لیے 3 دبائیں۔",
  },
  "ivr.enter_code": {
    en: "Please type the 4-digit code from the message.",
    ur: "براہ کرم پیغام میں موجود 4 ہندسوں کا کوڈ درج کریں۔",
  },
  "ivr.callback": {
    en: "A person will call you back. Thank you.",
    ur: "ایک انسان آپ کو واپس کال کرے گا۔ شکریہ۔",
  },
} as const satisfies Record<string, Bilingual>;

export type MessageKey = keyof typeof M;

export function t(key: MessageKey, vars?: Vars): Spoken {
  const m = M[key];
  return { en: fill(m.en, vars), ur: fill(m.ur, vars), audioKey: key };
}

/** Join translated fragments: "a, b and c" / "a، b اور c" */
export function joinList(items: Bilingual[]): Bilingual {
  if (items.length === 0) return { en: "", ur: "" };
  if (items.length === 1) return items[0]!;
  const en = items.slice(0, -1).map((i) => i.en).join(", ") + " and " + items.at(-1)!.en;
  const ur = items.slice(0, -1).map((i) => i.ur).join("، ") + " اور " + items.at(-1)!.ur;
  return { en, ur };
}

export const STATUS_WORDS: Record<string, Bilingual> = {
  draft: { en: "not yet submitted", ur: "ابھی جمع نہیں ہوا" },
  submitted: { en: "received", ur: "موصول" },
  needs_proof: { en: "waiting for one more document", ur: "ایک اور کاغذ کا انتظار" },
  in_review: { en: "with an officer", ur: "افسر کے پاس" },
  approved: { en: "approved, payment being prepared", ur: "منظور، ادائیگی کی تیاری" },
  rejected: { en: "not approved", ur: "منظور نہیں ہوا" },
  paid: { en: "paid", ur: "ادا ہو گیا" },
  closed: { en: "closed", ur: "بند" },
};
