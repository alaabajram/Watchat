// Emoji picker data (curated for drama marketing in Arabic and English) and a cursor-safe insert.
// Each entry: [emoji, search words in English and Arabic].

export type EmojiGroup = { id: string; label: string; icon: string; items: [string, string][] };

export const EMOJI_GROUPS: EmojiGroup[] = [
  {
    id: "drama",
    label: "Drama",
    icon: "🎬",
    items: [
      ["🎬", "film clapper movie فيلم مسلسل"], ["🎥", "camera movie كاميرا"], ["📺", "tv television تلفزيون"], ["🍿", "popcorn فشار"],
      ["🎞️", "film frames فيلم"], ["▶️", "play تشغيل"], ["⏯️", "play pause"], ["⏭️", "next التالي"], ["🔥", "fire hot نار"],
      ["💥", "boom explosion انفجار"], ["⚡", "lightning shock صدمة"], ["😱", "scream shocked صدمة"], ["🤯", "mind blown"], ["👀", "eyes look عيون"],
      ["🕵️", "detective mystery تحقيق"], ["🔍", "search clue بحث"], ["🗝️", "key secret مفتاح سر"], ["🔒", "lock secret قفل"], ["💔", "broken heart قلب مكسور"],
      ["💍", "ring wedding خاتم زواج"], ["👑", "crown king ملك"], ["🗡️", "dagger revenge خنجر"], ["⚖️", "justice عدالة"], ["🕯️", "candle شمعة"],
      ["🌙", "moon night قمر ليل"], ["⏳", "hourglass time وقت"], ["❓", "question سؤال"], ["❗", "exclamation"], ["‼️", "double exclamation"],
    ],
  },
  {
    id: "faces",
    label: "Faces",
    icon: "😊",
    items: [
      ["😀", "grin smile ابتسامة"], ["😂", "joy laugh ضحك"], ["🤣", "rofl laugh"], ["😊", "smile blush"], ["😍", "love eyes حب"], ["🥰", "love hearts"],
      ["😘", "kiss"], ["😉", "wink غمزة"], ["😎", "cool"], ["🤩", "star struck"], ["🥳", "party celebrate احتفال"], ["😏", "smirk"],
      ["🤔", "thinking تفكير"], ["🤫", "shush secret سر"], ["🤭", "oops giggle"], ["😳", "flushed embarrassed"], ["😢", "cry sad حزن"], ["😭", "sob crying بكاء"],
      ["😤", "angry huff"], ["😡", "angry غضب"], ["🥺", "pleading"], ["😬", "grimace"], ["😴", "sleep نوم"], ["🙄", "eye roll"],
      ["😮", "surprised wow"], ["🫣", "peek scared"], ["😈", "devil evil شر"], ["🤐", "zipper mouth secret"],
    ],
  },
  {
    id: "hands",
    label: "Hands",
    icon: "👋",
    items: [
      ["👋", "wave hello مرحبا"], ["👍", "thumbs up like"], ["👎", "thumbs down"], ["👏", "clap تصفيق"], ["🙌", "raise hands"], ["🙏", "please thanks شكرا"],
      ["🤝", "handshake deal"], ["✌️", "peace victory"], ["🤞", "fingers crossed luck"], ["👉", "point right"], ["👈", "point left"], ["👇", "point down"],
      ["☝️", "point up"], ["👆", "point up"], ["✋", "stop hand"], ["💪", "strong قوة"], ["🫶", "heart hands"], ["🤲", "palms dua دعاء"],
    ],
  },
  {
    id: "hearts",
    label: "Hearts",
    icon: "❤️",
    items: [
      ["❤️", "heart love قلب"], ["🧡", "orange heart"], ["💛", "yellow heart"], ["💚", "green heart"], ["💙", "blue heart"], ["💜", "purple heart"],
      ["🖤", "black heart"], ["🤍", "white heart"], ["💕", "two hearts"], ["💖", "sparkling heart"], ["💘", "cupid arrow"], ["💌", "love letter رسالة"],
      ["❤️‍🔥", "heart on fire"], ["💋", "kiss lips"], ["🌹", "rose وردة"],
    ],
  },
  {
    id: "symbols",
    label: "Symbols",
    icon: "✨",
    items: [
      ["✨", "sparkles"], ["⭐", "star نجمة"], ["🌟", "glowing star"], ["💫", "dizzy"], ["🎉", "party tada احتفال"], ["🎁", "gift هدية"],
      ["🏆", "trophy"], ["🔔", "bell alerts تنبيه"], ["🔕", "bell off"], ["📣", "megaphone announce"], ["🆕", "new جديد"], ["🆓", "free مجانا"],
      ["💯", "hundred"], ["✅", "check done تم"], ["☑️", "check box"], ["❌", "cross no"], ["⚠️", "warning تحذير"], ["⛔", "no entry"],
      ["🔗", "link رابط"], ["📲", "phone mobile"], ["💬", "chat message"], ["📩", "inbox message"], ["🪙", "coin عملة"], ["💰", "money bag"],
      ["💎", "gem diamond"], ["🎟️", "ticket pass تذكرة"], ["⏰", "alarm clock"], ["🕘", "clock time"], ["📅", "calendar date"], ["⬇️", "down arrow"],
      ["➡️", "right arrow"], ["⬅️", "left arrow"], ["🔁", "repeat"],
    ],
  },
  {
    id: "culture",
    label: "Gulf & Arabic",
    icon: "🌙",
    items: [
      ["🌙", "ramadan crescent رمضان هلال"], ["🕌", "mosque مسجد"], ["🏮", "lantern فانوس"], ["☕", "coffee qahwa قهوة"], ["🫖", "tea pot شاي"],
      ["🌴", "palm نخلة"], ["🐪", "camel جمل"], ["🏜️", "desert صحراء"], ["🌅", "sunset غروب"], ["🏙️", "city skyline مدينة"], ["🇦🇪", "uae emirates الإمارات"],
      ["🇸🇦", "saudi السعودية"], ["🇰🇼", "kuwait الكويت"], ["🇶🇦", "qatar قطر"], ["🇧🇭", "bahrain البحرين"], ["🇴🇲", "oman عمان"], ["🇪🇬", "egypt مصر"],
      ["🇱🇧", "lebanon لبنان"], ["🇯🇴", "jordan الأردن"], ["🎆", "fireworks eid عيد"],
    ],
  },
];

export function searchEmoji(query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: string[] = [];
  for (const g of EMOJI_GROUPS) for (const [e, words] of g.items) if (words.toLowerCase().includes(q) && !out.includes(e)) out.push(e);
  return out;
}

/** Insert text at the selection [start, end) and return the new value and caret position. */
export function insertText(value: string, start: number | null, end: number | null, text: string): { value: string; caret: number } {
  const s = start == null ? value.length : Math.max(0, Math.min(start, value.length));
  const e = end == null ? s : Math.max(s, Math.min(end, value.length));
  return { value: value.slice(0, s) + text + value.slice(e), caret: s + text.length };
}
