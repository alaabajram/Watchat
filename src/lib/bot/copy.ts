// Bot copy (drafts — have a Gulf copywriter polish the Arabic).
// Button titles must stay within 20 characters; messages.ts clips anything longer.
// Later: move these into a database table so the admin panel can edit them without a deploy.

export type CopyLang = "ar" | "en";

type Copy = {
  welcomeAskLanguage: (seriesTitle: string) => string;
  btnArabic: string;
  btnEnglishSubs: string;
  trailerBody: (seriesTitle: string) => string;
  btnStartEp1: string;
  btnNext: string;
  btnNotForMe: string;
  episodeCaption: (n: number, total: number, title: string) => string;
  videoMissing: (n: number) => string;
  cliffhangerBody: (nextEp: number) => string;
  btnWatchEp: (nextEp: number) => string;
  optInBody: string;
  btnYesNotify: string;
  btnNoThanks: string;
  optInConfirmed: string;
  optInDeclined: string;
  notForMeBody: string;
  btnSeeSeries: string;
  noOtherSeries: string;
  seriesSectionTitle: string;
  seriesNotFound: string;
  menuBody: string;
  btnMenu: string;
  menuSectionTitle: string;
  menuLink: string;
  menuLanguage: string;
  menuAlerts: string;
  menuSupport: string;
  linkBody: (seriesTitle: string, ep: number) => string;
  btnOpenPlayer: string;
  needSeriesFirst: string;
  stopConfirmed: string;
  btnAlertsOn: string;
  supportBody: string;
  deleteRequested: string;
};

const ar: Copy = {
  welcomeAskLanguage: (title) =>
    `أهلًا بك في واتشات 🎬\nمسلسل «${title}» جاهز.\nاختر اللغة:\n\nWelcome to Watchat. Choose your language:`,
  btnArabic: "عربي",
  btnEnglishSubs: "English subtitles",
  trailerBody: (title) => `هذا الإعلان الرسمي لـ «${title}». جاهز تبدأ؟`,
  btnStartEp1: "ابدأ الحلقة 1",
  btnNext: "الحلقة التالية",
  btnNotForMe: "ما يناسبني",
  episodeCaption: (n, total, title) => `الحلقة ${n} من ${total} · ${title}`,
  videoMissing: (n) => `(فيديو الحلقة ${n} غير متوفر حاليًا)`,
  cliffhangerBody: (next) => `الحلقة ${next} بانتظارك 👀\nكمّل المشاهدة الحين، بدون تطبيق وبدون تسجيل.`,
  btnWatchEp: (next) => `شاهد الحلقة ${next}`,
  optInBody: "تبي نرسل لك رسالة لما تنزل حلقات جديدة؟",
  btnYesNotify: "نعم، نبّهني",
  btnNoThanks: "لا، شكرًا",
  optInConfirmed: "تم ✅ بنبلغك أول ما تنزل حلقات جديدة. تقدر توقف التنبيهات أي وقت بإرسال STOP.",
  optInDeclined: "ولا يهمك. تقدر تفعّل التنبيهات أي وقت من القائمة.",
  notForMeBody: "ولا يهمك! جرّب واحد من هذي المسلسلات:",
  btnSeeSeries: "شوف المسلسلات",
  noOtherSeries: "ما عندنا مسلسلات ثانية حاليًا، بنبلغك أول ما ينزل جديد.",
  seriesSectionTitle: "مسلسلات",
  seriesNotFound: "ما لقينا هذا الكود 🤔 تأكد منه وأرسله مرة ثانية.",
  menuBody: "كيف نقدر نساعدك؟",
  btnMenu: "القائمة",
  menuSectionTitle: "القائمة",
  menuLink: "رابط المشغّل",
  menuLanguage: "تغيير اللغة",
  menuAlerts: "التنبيهات",
  menuSupport: "التواصل مع الدعم",
  linkBody: (title, ep) => `«${title}» — كمّل من الحلقة ${ep}.`,
  btnOpenPlayer: "افتح المشغّل",
  needSeriesFirst: "أرسل كود المسلسل اللي شفته في الإعلان عشان نبدأ (مثال: SECRETS01).",
  stopConfirmed: "تم إيقاف التنبيهات. ما راح نرسل لك رسائل تسويقية.",
  btnAlertsOn: "شغّل التنبيهات",
  supportBody: "اكتب مشكلتك هنا وبيرد عليك فريق الدعم في أقرب وقت.",
  deleteRequested: "استلمنا طلب حذف بياناتك ✅ أوقفنا التنبيهات، وبنحذف بياناتك خلال 30 يومًا.",
};

const en: Copy = {
  welcomeAskLanguage: (title) =>
    `Welcome to Watchat 🎬\n“${title}” is ready.\nChoose your language:\n\nأهلًا بك في واتشات. اختر اللغة:`,
  btnArabic: "عربي",
  btnEnglishSubs: "English subtitles",
  trailerBody: (title) => `Here's the official trailer for “${title}”. Ready to start?`,
  btnStartEp1: "Start episode 1",
  btnNext: "Next episode",
  btnNotForMe: "Not for me",
  episodeCaption: (n, total, title) => `Episode ${n} of ${total} · ${title}`,
  videoMissing: (n) => `(Episode ${n} video isn't available yet)`,
  cliffhangerBody: (next) => `Episode ${next} is waiting for you 👀\nKeep watching now — no app, no sign-up.`,
  btnWatchEp: (next) => `Watch episode ${next}`,
  optInBody: "Want a message when new episodes drop?",
  btnYesNotify: "Yes, notify me",
  btnNoThanks: "No thanks",
  optInConfirmed: "Done ✅ We'll message you when new episodes drop. Send STOP any time to turn alerts off.",
  optInDeclined: "No problem. You can turn alerts on any time from the menu.",
  notForMeBody: "No problem! Try one of these:",
  btnSeeSeries: "See series",
  noOtherSeries: "No other series right now — we'll let you know when a new one drops.",
  seriesSectionTitle: "Series",
  seriesNotFound: "We couldn't find that code 🤔 Please check it and send it again.",
  menuBody: "How can we help?",
  btnMenu: "Menu",
  menuSectionTitle: "Menu",
  menuLink: "My player link",
  menuLanguage: "Change language",
  menuAlerts: "Alerts on/off",
  menuSupport: "Talk to support",
  linkBody: (title, ep) => `“${title}” — continue from episode ${ep}.`,
  btnOpenPlayer: "Open my player",
  needSeriesFirst: "Send the series code from the ad to get started (e.g. SECRETS01).",
  stopConfirmed: "Alerts are off. We won't send you marketing messages.",
  btnAlertsOn: "Turn alerts back on",
  supportBody: "Write your question here and our support team will reply soon.",
  deleteRequested: "We've received your request to delete your data ✅ Alerts are off, and your data will be deleted within 30 days.",
};

export function copyFor(lang: CopyLang): Copy {
  return lang === "en" ? en : ar;
}
