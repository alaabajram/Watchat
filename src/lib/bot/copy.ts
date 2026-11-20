// Every text the bot sends, with defaults in Arabic and English (drafts — have a Gulf copywriter polish).
// The admin panel can override any of them, for all series or for one series (table bot_messages).
// Placeholders: {title} series title · {n} episode number · {total} episode count · {next} next episode · {code} code
// Button labels must stay within 20 characters (messages.ts clips anything longer).

export type CopyLang = "ar" | "en";

// flowDefault: starting text for flow cards (edited on the cards in the Flow builder, not in Shared replies).
type Entry = { label: string; kind: "text" | "button"; ar: string; en: string; flowDefault?: true };

export const COPY = {
  welcomeAskLanguage: {
    label: "W1 · Welcome + language question",
    kind: "text",
    ar: "أهلًا بك في واتشات 🎬\nمسلسل «{title}» جاهز.\nاختر اللغة:\n\nWelcome to Watchat. Choose your language:",
    en: "Welcome to Watchat 🎬\n“{title}” is ready.\nChoose your language:\n\nأهلًا بك في واتشات. اختر اللغة:",
  },
  btnArabic: { label: "W1 · Arabic button", kind: "button", ar: "عربي", en: "عربي" },
  btnEnglishSubs: { label: "W1 · English subtitles button", kind: "button", ar: "English subtitles", en: "English subtitles" },
  trailerBody: {
    label: "W2 · Trailer message",
    kind: "text",
    ar: "هذا الإعلان الرسمي لـ «{title}». جاهز تبدأ؟",
    en: "Here's the official trailer for “{title}”. Ready to start?",
    flowDefault: true,
  },
  btnStartEp1: { label: "W2 · Start button", kind: "button", ar: "ابدأ الحلقة 1", en: "Start episode 1", flowDefault: true },
  btnNext: { label: "W3 · Next episode button", kind: "button", ar: "الحلقة التالية", en: "Next episode", flowDefault: true },
  btnNotForMe: { label: "W2/W3 · Not for me button", kind: "button", ar: "ما يناسبني", en: "Not for me", flowDefault: true },
  episodeCaption: {
    label: "W3/W4 · Episode caption",
    kind: "text",
    ar: "الحلقة {n} من {total} · {title}",
    en: "Episode {n} of {total} · {title}",
    flowDefault: true,
  },
  videoMissing: {
    label: "Episode video not uploaded yet",
    kind: "text",
    ar: "(فيديو الحلقة {n} غير متوفر حاليًا)",
    en: "(Episode {n} video isn't available yet)",
    flowDefault: true,
  },
  cliffhangerBody: {
    label: "W5 · Cliffhanger link message",
    kind: "text",
    ar: "الحلقة {next} بانتظارك 👀\nكمّل المشاهدة الحين، بدون تطبيق وبدون تسجيل.",
    en: "Episode {next} is waiting for you 👀\nKeep watching now — no app, no sign-up.",
    flowDefault: true,
  },
  btnWatchEp: { label: "W5 · Watch link button", kind: "button", ar: "شاهد الحلقة {next}", en: "Watch episode {next}", flowDefault: true },
  optInBody: {
    label: "W6 · Alerts question",
    kind: "text",
    ar: "تبي نرسل لك رسالة لما تنزل حلقات جديدة؟",
    en: "Want a message when new episodes drop?",
  },
  btnYesNotify: { label: "W6 · Yes button", kind: "button", ar: "نعم، نبّهني", en: "Yes, notify me" },
  btnNoThanks: { label: "W6 · No button", kind: "button", ar: "لا، شكرًا", en: "No thanks" },
  optInConfirmed: {
    label: "W6 · Alerts on confirmation",
    kind: "text",
    ar: "تم ✅ بنبلغك أول ما تنزل حلقات جديدة. تقدر توقف التنبيهات أي وقت بإرسال STOP.",
    en: "Done ✅ We'll message you when new episodes drop. Send STOP any time to turn alerts off.",
  },
  optInDeclined: {
    label: "W6 · Alerts declined reply",
    kind: "text",
    ar: "ولا يهمك. تقدر تفعّل التنبيهات أي وقت من القائمة.",
    en: "No problem. You can turn alerts on any time from the menu.",
  },
  notForMeBody: { label: "W7 · Not for me message", kind: "text", ar: "ولا يهمك! جرّب واحد من هذي المسلسلات:", en: "No problem! Try one of these:" },
  btnSeeSeries: { label: "W7 · See series button", kind: "button", ar: "شوف المسلسلات", en: "See series" },
  noOtherSeries: {
    label: "W7 · No other series",
    kind: "text",
    ar: "ما عندنا مسلسلات ثانية حاليًا، بنبلغك أول ما ينزل جديد.",
    en: "No other series right now — we'll let you know when a new one drops.",
  },
  seriesSectionTitle: { label: "W7 · List section title", kind: "button", ar: "مسلسلات", en: "Series" },
  seriesNotFound: {
    label: "Unknown series code",
    kind: "text",
    ar: "ما لقينا هذا الكود 🤔 تأكد منه وأرسله مرة ثانية.",
    en: "We couldn't find that code 🤔 Please check it and send it again.",
  },
  menuBody: { label: "W12 · Menu message", kind: "text", ar: "كيف نقدر نساعدك؟", en: "How can we help?" },
  btnMenu: { label: "W12 · Menu button", kind: "button", ar: "القائمة", en: "Menu" },
  menuSectionTitle: { label: "W12 · Menu section title", kind: "button", ar: "القائمة", en: "Menu" },
  menuLink: { label: "W12 · My player link", kind: "button", ar: "رابط المشغّل", en: "My player link" },
  menuLanguage: { label: "W12 · Change language", kind: "button", ar: "تغيير اللغة", en: "Change language" },
  menuAlerts: { label: "W12 · Alerts on/off", kind: "button", ar: "التنبيهات", en: "Alerts on/off" },
  menuSupport: { label: "W12 · Talk to support", kind: "button", ar: "التواصل مع الدعم", en: "Talk to support" },
  linkBody: {
    label: "W12 · Player link message",
    kind: "text",
    ar: "«{title}» — كمّل من الحلقة {n}.",
    en: "“{title}” — continue from episode {n}.",
  },
  accountBody: {
    label: "My account link message",
    kind: "text",
    ar: "حسابك في واتشات: كل مسلسلاتك، من وين وقفت، ورصيدك. افتحه من هنا 👇",
    en: "Your Watchat account: all your series, where you left off, and your coins. Open it here 👇",
  },
  btnMyAccount: { label: "My account button", kind: "button", ar: "حسابي", en: "My account" },
  pinHint: {
    label: "Pin tip (added once, to the first link)",
    kind: "text",
    ar: "📌 افتح الزر أول مرة من هنا ليسجّل دخولك، وبعدها ثبّت هذه الرسالة (اضغط عليها مطوّلاً ← تثبيت) لترجع لحسابك متى ما حبيت.",
    en: "📌 Open the button the first time to sign in, then pin this message (press and hold → Pin) to get back to your account anytime.",
  },
  btnOpenPlayer: { label: "W12 · Open player button", kind: "button", ar: "افتح المشغّل", en: "Open my player" },
  needSeriesFirst: {
    label: "No series yet",
    kind: "text",
    ar: "أرسل كود المسلسل اللي شفته في الإعلان عشان نبدأ (مثال: SECRETS01).",
    en: "Send the series code from the ad to get started (e.g. SECRETS01).",
  },
  stopConfirmed: {
    label: "W14 · Alerts stopped",
    kind: "text",
    ar: "تم إيقاف التنبيهات. ما راح نرسل لك رسائل تسويقية.",
    en: "Alerts are off. We won't send you marketing messages.",
  },
  btnAlertsOn: { label: "W14 · Turn alerts on button", kind: "button", ar: "شغّل التنبيهات", en: "Turn alerts back on" },
  supportBody: {
    label: "Support reply",
    kind: "text",
    ar: "اكتب مشكلتك هنا وبيرد عليك فريق الدعم في أقرب وقت.",
    en: "Write your question here and our support team will reply soon.",
  },
  deleteRequested: {
    label: "Data deletion requested",
    kind: "text",
    ar: "استلمنا طلب حذف بياناتك ✅ أوقفنا التنبيهات، وبنحذف بياناتك خلال 30 يومًا.",
    en: "We've received your request to delete your data ✅ Alerts are off, and your data will be deleted within 30 days.",
  },
  picksBody: {
    label: "Growth agent · Your picks (after 'See my picks')",
    kind: "text",
    ar: "اخترنا لك هالمسلسلات 🍿 اختر واحد ونكمل معك:",
    en: "Here are your picks 🍿 Choose one and we'll take it from there:",
  },
  confirmOk: {
    label: "W13 · Device confirmed",
    kind: "text",
    ar: "تم التأكيد ✅ ارجع للمتصفح وكمّل.",
    en: "Confirmed ✅ Go back to your browser to continue.",
  },
  confirmFailed: {
    label: "W13 · Wrong or expired code",
    kind: "text",
    ar: "الكود غير صحيح أو انتهت صلاحيته. اطلب كود جديد من المتصفح.",
    en: "That code is wrong or has expired. Get a new code in your browser.",
  },
} satisfies Record<string, Entry>;

export type CopyKey = keyof typeof COPY;
export type CopyOverrides = Partial<Record<CopyKey, string>>;
export type CopyVars = Partial<Record<"title" | "n" | "total" | "next" | "code" | "tagline" | "genre" | "cast", string | number>>;

export const COPY_KEYS = Object.keys(COPY) as CopyKey[];
/** Replies used outside series flows (menu, alerts, support, links…), edited in Admin → Shared replies. */
export const SHARED_KEYS = COPY_KEYS.filter((k) => !(COPY[k] as Entry).flowDefault);

export function isCopyKey(key: string): key is CopyKey {
  return key in COPY;
}

export function renderCopy(template: string, vars: CopyVars = {}): string {
  return template.replace(/\{(title|n|total|next|code|tagline|genre|cast)\}/g, (_, k: keyof CopyVars) => String(vars[k] ?? ""));
}

/** A translator for one language, with admin overrides applied on top of the defaults. */
export function makeT(lang: CopyLang, overrides: CopyOverrides = {}) {
  return (key: CopyKey, vars?: CopyVars) => renderCopy(overrides[key] ?? COPY[key][lang], vars);
}

export type T = ReturnType<typeof makeT>;
