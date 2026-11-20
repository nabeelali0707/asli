/**
 * Mock official policy documents for the prototype programme (NOT real government policy).
 * Each passage is bilingual so the offline answer path can still speak Urdu.
 */
export type PolicyPassage = { id: string; doc: string; title: string; en: string; ur: string };

export const POLICY_PASSAGES: PolicyPassage[] = [
  {
    id: "elig-1",
    doc: "Rahat Relief Support — Eligibility (prototype)",
    title: "Who can apply",
    en: "Any adult (18 or older) whose monthly household income is Rs 40,000 or less can apply. Widows, people with disabilities and households of five or more get priority. One payment is allowed every 90 days.",
    ur: "کوئی بھی بالغ (18 سال یا زیادہ) جس کی ماہانہ گھریلو آمدنی 40,000 روپے یا کم ہو درخواست دے سکتا ہے۔ بیوہ خواتین، معذور افراد اور پانچ یا زیادہ افراد والے گھرانوں کو ترجیح دی جاتی ہے۔ ہر 90 دن میں ایک ادائیگی کی اجازت ہے۔",
  },
  {
    id: "amount-1",
    doc: "Rahat Relief Support — Benefit amount (prototype)",
    title: "How much money",
    en: "The standard payment is Rs 8,000. Households with five or more members receive Rs 12,000. The maximum is Rs 15,000.",
    ur: "معیاری ادائیگی 8,000 روپے ہے۔ پانچ یا زیادہ افراد والے گھرانوں کو 12,000 روپے ملتے ہیں۔ زیادہ سے زیادہ رقم 15,000 روپے ہے۔",
  },
  {
    id: "docs-1",
    doc: "Rahat Relief Support — Documents (prototype)",
    title: "Documents needed",
    en: "You need a clear photo of your identity card (CNIC) and a proof of monthly income, such as a salary slip, a letter from the union council, or a statement from a community helper. If a photo is blurry, the system will ask you to take it again.",
    ur: "آپ کو اپنے شناختی کارڈ کی صاف تصویر اور ماہانہ آمدنی کا ثبوت چاہیے، جیسے تنخواہ کی پرچی، یونین کونسل کا خط، یا کمیونٹی مددگار کا بیان۔ اگر تصویر دھندلی ہو تو نظام آپ سے دوبارہ تصویر لینے کو کہے گا۔",
  },
  {
    id: "fees-1",
    doc: "Rahat Relief Support — Fraud warning (prototype)",
    title: "No fees, ever",
    en: "Applying and receiving money is free. No officer, helper or message will ever ask you for a fee, an OTP, a PIN or a code to release your payment. Anyone who asks for money is a fraudster.",
    ur: "درخواست دینا اور رقم وصول کرنا مفت ہے۔ کوئی افسر، مددگار یا پیغام آپ سے رقم جاری کرنے کے لیے کبھی فیس، OTP، PIN یا کوڈ نہیں مانگے گا۔ جو بھی پیسے مانگے وہ دھوکے باز ہے۔",
  },
  {
    id: "fees-2",
    doc: "Rahat Relief Support — Fraud warning (prototype)",
    title: "How to check a message",
    en: "Every real message from Asli has a 4-digit code that matches your case and a verify link. Forward any message about relief money to Asli, or call and press 2, to check whether it is real.",
    ur: "اصلی کی طرف سے ہر حقیقی پیغام میں آپ کے کیس سے ملتا ہوا 4 ہندسوں کا کوڈ اور تصدیق کا لنک ہوتا ہے۔ امدادی رقم کے بارے میں کوئی بھی پیغام اصلی کو بھیجیں، یا کال کر کے 2 دبائیں، تاکہ معلوم ہو کہ یہ اصلی ہے یا نہیں۔",
  },
  {
    id: "process-1",
    doc: "Rahat Relief Support — How decisions are made (prototype)",
    title: "Who decides",
    en: "The computer checks your papers and records, but it never pays money by itself. If it is not sure, it hands your case to an officer. Every payment needs a human officer, and larger payments need two officers.",
    ur: "کمپیوٹر آپ کے کاغذات اور ریکارڈ کی جانچ کرتا ہے، لیکن خود کبھی رقم ادا نہیں کرتا۔ اگر اسے یقین نہ ہو تو آپ کا کیس افسر کو دے دیتا ہے۔ ہر ادائیگی کے لیے ایک انسانی افسر کی منظوری ضروری ہے، اور بڑی ادائیگیوں کے لیے دو افسران کی۔",
  },
  {
    id: "process-2",
    doc: "Rahat Relief Support — How decisions are made (prototype)",
    title: "How long it takes",
    en: "Most complete applications are checked within 3 working days. If one more document is needed, you have 72 hours to send it; after that a person looks at your case — it is never rejected just because time passed.",
    ur: "زیادہ تر مکمل درخواستیں 3 کاروباری دنوں میں جانچ لی جاتی ہیں۔ اگر ایک اور کاغذ چاہیے ہو تو آپ کے پاس بھیجنے کے لیے 72 گھنٹے ہیں؛ اس کے بعد ایک انسان آپ کا کیس دیکھتا ہے — صرف وقت گزرنے کی وجہ سے کبھی مسترد نہیں کیا جاتا۔",
  },
  {
    id: "appeal-1",
    doc: "Rahat Relief Support — Appeals (prototype)",
    title: "Appeals",
    en: "If you disagree with a decision you can appeal by speaking to the app, calling, or asking your helper. A different officer will review the appeal.",
    ur: "اگر آپ کسی فیصلے سے متفق نہیں تو آپ ایپ سے بول کر، کال کر کے، یا اپنے مددگار کے ذریعے اپیل کر سکتی ہیں۔ اپیل کا جائزہ ایک دوسرا افسر لے گا۔",
  },
  {
    id: "consent-1",
    doc: "Rahat Relief Support — Your data (prototype)",
    title: "Your data and permission",
    en: "You can see who has your information, choose what is shared, and take back permission at any time. When you take it back, access stops immediately. Officers see only partial details unless they record a reason, which you can see.",
    ur: "آپ دیکھ سکتی ہیں کہ آپ کی معلومات کس کے پاس ہیں، طے کر سکتی ہیں کہ کیا شیئر ہو، اور کسی بھی وقت اجازت واپس لے سکتی ہیں۔ اجازت واپس لیتے ہی رسائی فوراً بند ہو جاتی ہے۔ افسران صرف جزوی معلومات دیکھتے ہیں جب تک وہ کوئی وجہ درج نہ کریں، جو آپ دیکھ سکتی ہیں۔",
  },
  {
    id: "helper-1",
    doc: "Rahat Relief Support — Community helpers (prototype)",
    title: "Community helpers",
    en: "A community helper can apply for your family using their phone, but only after you give permission and only while you enter your family PIN. You can remove a helper's access at any time.",
    ur: "ایک کمیونٹی مددگار اپنے فون سے آپ کے خاندان کے لیے درخواست دے سکتا ہے، لیکن صرف آپ کی اجازت کے بعد اور صرف اس وقت جب آپ اپنا خاندانی PIN درج کریں۔ آپ کسی بھی وقت مددگار کی رسائی ختم کر سکتی ہیں۔",
  },
  {
    id: "payment-1",
    doc: "Rahat Relief Support — Receiving money (prototype)",
    title: "How money is received",
    en: "Money is sent to your registered mobile account (Raast alias). You will get a message with your 4-digit code when it is sent. You never need to visit anyone or pay anything to receive it.",
    ur: "رقم آپ کے رجسٹرڈ موبائل اکاؤنٹ (راست عرفیت) میں بھیجی جاتی ہے۔ بھیجے جانے پر آپ کو آپ کے 4 ہندسوں کے کوڈ کے ساتھ پیغام ملے گا۔ رقم وصول کرنے کے لیے آپ کو نہ کسی کے پاس جانا ہے نہ کچھ ادا کرنا ہے۔",
  },
];
