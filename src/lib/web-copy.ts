// Web player copy, Arabic first. Mirrors the screens doc (P1–P16).

export type Locale = "ar" | "en";

const strings = {
  ar: {
    tagline: "دراما حقيقية في الشات",
    startInWhatsApp: "ابدأ في واتساب",
    linkExpiredTitle: "انتهت صلاحية هذا الرابط",
    linkExpiredBody: "الروابط الشخصية صالحة لمدة 7 أيام. اطلب رابط جديد من واتساب وكمّل من حيث وقفت.",
    getFreshLink: "اطلب رابط جديد من واتساب",
    signInFromWhatsApp: "افتح رابطك الشخصي من واتساب للمشاهدة.",
    episode: (n: number) => `الحلقة ${n}`,
    of: (n: number, total: number) => `${n} من ${total}`,
    next: "الحلقة التالية",
    previous: "السابقة",
    episodes: "الحلقات",
    locked: "مقفلة",
    free: "مجانية",
    unlockFor: (coins: number) => `افتح بـ ${coins} عملة`,
    seasonPass: (price: number) => `تذكرة الموسم · ${price} درهم`,
    paywallTitle: "الحلقة القادمة مقفلة",
    paywallBody: "الدفع عبر Apple Pay و Google Pay والبطاقة قادم قريبًا.",
    videoComingSoon: "الفيديو غير متوفر بعد",
    notFound: "ما لقينا هذه الحلقة.",
  },
  en: {
    tagline: "Real drama, in the chat",
    startInWhatsApp: "Start in WhatsApp",
    linkExpiredTitle: "This link has expired",
    linkExpiredBody: "Personal links work for 7 days. Get a fresh link in WhatsApp and continue where you left off.",
    getFreshLink: "Get a fresh link in WhatsApp",
    signInFromWhatsApp: "Open your personal link from WhatsApp to watch.",
    episode: (n: number) => `Episode ${n}`,
    of: (n: number, total: number) => `${n} of ${total}`,
    next: "Next episode",
    previous: "Previous",
    episodes: "Episodes",
    locked: "Locked",
    free: "Free",
    unlockFor: (coins: number) => `Unlock for ${coins} coins`,
    seasonPass: (price: number) => `Season pass · AED ${price}`,
    paywallTitle: "The next episode is locked",
    paywallBody: "Paying with Apple Pay, Google Pay and card is coming soon.",
    videoComingSoon: "Video not available yet",
    notFound: "We couldn't find this episode.",
  },
};

export function webCopy(locale: Locale) {
  return strings[locale];
}

export const dirFor = (locale: Locale) => (locale === "ar" ? "rtl" : "ltr");
