// The six starter rooms from the brief, with a few hand-written rounds each so the Playground works on day one
// even before the AI drafts more. Added once from Admin → Rooms ("Add the starter rooms"), or automatically the
// first time the Playground opens with no rooms at all. Everything here is editable afterwards.

import type { Mechanic, RoomConfig, Round } from "./engine";

export type StarterRoom = {
  slug: string;
  mechanic: Mechanic;
  titleAr: string;
  titleEn: string;
  blurbAr: string;
  blurbEn: string;
  emoji: string;
  color: string;
  config: Partial<RoomConfig>;
  rounds: Omit<Round, "extra">[] | Round[];
};

const o = (ar: string, en: string, more: Record<string, unknown> = {}) => ({ id: "", ar, en, ...more });

export const STARTER_ROOMS: StarterRoom[] = [
  {
    slug: "hot-seat",
    mechanic: "hot_seat",
    titleAr: "الكرسي الساخن",
    titleEn: "Daily Hot Seat",
    blurbAr: "ضيف جديد كل يوم على الكرسي. اختر سؤالك واقرأ جوابه.",
    blurbEn: "A new guest in the seat every day. Pick your question, read the answer.",
    emoji: "🔥",
    color: "#ff5a48",
    config: { guestAr: "شخصية اليوم", guestEn: "Today's guest", aiBrief: "Each day's guest is a fun fictional character (e.g. a retired taxi driver from Dubai, a cat who owns a café, a time traveller from 1985). Name the guest in promptAr/promptEn: 'In the seat today: …'." },
    rounds: [
      {
        promptAr: "على الكرسي اليوم: سائق تاكسي متقاعد قضى ٣٠ سنة في شوارع دبي",
        promptEn: "In the seat today: a retired taxi driver with 30 years on Dubai's roads",
        options: [
          o("أغرب راكب ركب معك؟", "Your strangest passenger?", { revealAr: "رجل ركب معي بصقر على يده وطلب أفتح الشباك عشان الصقر يشوف الطريق. دفع ضعف الأجرة!", revealEn: "A man with a falcon on his arm asked me to open the window so the bird could see the road. He paid double!" }),
          o("وش تغيّر في دبي؟", "What changed most in Dubai?", { revealAr: "زمان كنت أعرف كل شارع باسم صاحب الدكان اللي عليه. اليوم الشوارع تتغير أسرع من الخريطة.", revealEn: "I used to know every street by the shop on its corner. Now the roads change faster than the map." }),
          o("أفضل نصيحة من راكب؟", "Best advice from a passenger?", { revealAr: "شيبة قال لي: لا تستعجل، الإشارة الحمرا تعلّمك الصبر ببلاش.", revealEn: "An old man told me: don't rush — every red light is a free lesson in patience." }),
        ],
      },
      {
        promptAr: "على الكرسي اليوم: قطة تملك مقهى في جدة",
        promptEn: "In the seat today: a cat who owns a café in Jeddah",
        options: [
          o("كيف صرتِ صاحبة مقهى؟", "How did you end up owning a café?", { revealAr: "جلست على نفس الكرسي كل يوم لين صار الكرسي لي، والمقهى جا معه.", revealEn: "I sat on the same chair every day until it was mine. The café came with it." }),
          o("أسوأ زبون؟", "Your worst customer?", { revealAr: "اللي يطلب حليب بدون لاكتوز ويحرمني من نصيبي.", revealEn: "Anyone who orders lactose-free milk and takes away my share." }),
          o("سر نجاحك؟", "Your secret to success?", { revealAr: "أتجاهل الكل، فيرجعون عشان يحاولون يرضوني.", revealEn: "I ignore everyone, so they keep coming back to win me over." }),
        ],
      },
      {
        promptAr: "على الكرسي اليوم: مسافر عبر الزمن جاي من سنة ١٩٨٥",
        promptEn: "In the seat today: a time traveller from 1985",
        options: [
          o("وش أكثر شي صدمك؟", "What shocked you most?", { revealAr: "الكل ماسك تلفون ويكلم نفسه بالشارع، وما أحد مستغرب!", revealEn: "Everyone holds a phone and talks to themselves in the street — and nobody finds it odd!" }),
          o("تشتاق لشي من زمانك؟", "Miss anything from your time?", { revealAr: "انتظار الحلقة الجاية أسبوع كامل. كان للشوق طعم.", revealEn: "Waiting a whole week for the next episode. Longing had a flavour." }),
          o("نصيحة لنا؟", "Advice for us?", { revealAr: "اكتبوا رقم واحد على الأقل بالقلم. يوم البطارية تخلص بتشكروني.", revealEn: "Write at least one phone number on paper. The day your battery dies, you'll thank me." }),
        ],
      },
    ],
  },
  {
    slug: "would-you-rather",
    mechanic: "would_you_rather",
    titleAr: "تفضّل إيش؟",
    titleEn: "Would You Rather",
    blurbAr: "خيارين، واحد بس. شوف وين الناس.",
    blurbEn: "Two choices, only one. See where everyone landed.",
    emoji: "⚖️",
    color: "#7c5cff",
    config: {},
    rounds: [
      { promptAr: "تفضّل…", promptEn: "Would you rather…", options: [o("تعرف كل اللغات", "Speak every language"), o("تكلم الحيوانات", "Talk to animals")] },
      { promptAr: "تفضّل…", promptEn: "Would you rather…", options: [o("صيف دائم", "Endless summer"), o("شتاء دائم", "Endless winter")] },
      { promptAr: "تفضّل…", promptEn: "Would you rather…", options: [o("ترجع ١٠ سنين", "Go back 10 years"), o("تقفز ١٠ سنين لقدام", "Jump 10 years ahead")] },
      { promptAr: "تفضّل…", promptEn: "Would you rather…", options: [o("ما تستخدم تلفونك أسبوع", "No phone for a week"), o("ما تشرب قهوة شهر", "No coffee for a month")] },
      { promptAr: "تفضّل…", promptEn: "Would you rather…", options: [o("تكون مشهور", "Be famous"), o("تكون غني بصمت", "Be quietly rich")] },
    ],
  },
  {
    slug: "unpopular-opinions",
    mechanic: "opinion",
    titleAr: "رأي غير شعبي",
    titleEn: "Unpopular Opinions",
    blurbAr: "رأي جريء كل يوم. توافق ولا لا؟",
    blurbEn: "One bold opinion a day. Agree or not?",
    emoji: "🌶️",
    color: "#ffb020",
    config: {},
    rounds: [
      { promptAr: "الشاي أحسن من القهوة.", promptEn: "Tea is better than coffee.", options: [] },
      { promptAr: "المسلسلات القصيرة أحسن من الطويلة.", promptEn: "Short series beat long ones.", options: [] },
      { promptAr: "الرسائل الصوتية لازم تنمنع.", promptEn: "Voice notes should be banned.", options: [] },
      { promptAr: "الفطور أهم وجبة… مبالغة.", promptEn: "“Breakfast is the most important meal” is overrated.", options: [] },
      { promptAr: "السفر بدون خطة أمتع.", promptEn: "Travelling without a plan is more fun.", options: [] },
    ],
  },
  {
    slug: "who-is-lying",
    mechanic: "liar",
    titleAr: "مين يكذب؟",
    titleEn: "Who Is Lying",
    blurbAr: "ثلاث معلومات، وحدة كذبة. اكتشفها.",
    blurbEn: "Three facts, one is a lie. Spot it.",
    emoji: "🕵️",
    color: "#22c55e",
    config: { rewardPing: 2 },
    rounds: [
      {
        promptAr: "وحدة من هذي كذبة:",
        promptEn: "One of these is a lie:",
        options: [o("الأخطبوط عنده ثلاث قلوب", "An octopus has three hearts"), o("العسل ما يخرب أبداً", "Honey never spoils"), o("الجمل يخزن الماء في سنامه", "A camel stores water in its hump", { correct: true })],
        extra: { explainAr: "السنام فيه دهون مو ماء! الدهون تعطي الجمل طاقة في الرحلات الطويلة.", explainEn: "The hump is fat, not water — it fuels the camel on long journeys." },
      },
      {
        promptAr: "وحدة من هذي كذبة:",
        promptEn: "One of these is a lie:",
        options: [o("الموز يعتبر من التوت", "Bananas are berries"), o("الفراولة من التوت", "Strawberries are berries", { correct: true }), o("الطماطم فاكهة", "Tomatoes are a fruit")],
        extra: { explainAr: "علمياً الفراولة مو توت، بينما الموز توت!", explainEn: "Botanically, strawberries aren't berries — but bananas are!" },
      },
      {
        promptAr: "وحدة من هذي كذبة:",
        promptEn: "One of these is a lie:",
        options: [o("برج خليفة يُرى من ٩٥ كم", "Burj Khalifa is visible from 95 km"), o("سور الصين يُرى من القمر بالعين", "The Great Wall is visible from the Moon", { correct: true }), o("البحر الميت أخفض نقطة يابسة", "The Dead Sea is the lowest land point")],
        extra: { explainAr: "سور الصين ضيق جداً عشان يبان من القمر بالعين المجردة.", explainEn: "The Great Wall is far too narrow to see from the Moon with the naked eye." },
      },
    ],
  },
  {
    slug: "guess-the-mystery",
    mechanic: "guess",
    titleAr: "خمّن السر",
    titleEn: "Guess the Mystery",
    blurbAr: "تلميحات وحدة ورا الثانية. تعرف الجواب؟",
    blurbEn: "Clue after clue. Can you name it?",
    emoji: "🔍",
    color: "#06b6d4",
    config: { rewardPing: 2 },
    rounds: [
      {
        promptAr: "وش أنا؟",
        promptEn: "What am I?",
        options: [o("القهوة العربية", "Arabic coffee", { correct: true }), o("الشاي", "Tea"), o("اللبن", "Laban")],
        extra: { cluesAr: ["أنا قديمة قِدم الضيافة", "أتقدّم بفنجان صغير", "فيني هيل وزعفران أحياناً"], cluesEn: ["I'm as old as hospitality", "I'm served in a tiny cup", "Sometimes I carry cardamom and saffron"], explainAr: "القهوة العربية مسجّلة في قائمة اليونسكو للتراث.", explainEn: "Arabic coffee is on UNESCO's heritage list." },
      },
      {
        promptAr: "وش أنا؟",
        promptEn: "What am I?",
        options: [o("الصقر", "Falcon", { correct: true }), o("النسر", "Eagle"), o("البومة", "Owl")],
        extra: { cluesAr: ["عندي جواز سفر في بعض الدول", "أسرع كائن حي في الغطس", "رمز من رموز الخليج"], cluesEn: ["I can have my own passport in some countries", "I'm the fastest animal in a dive", "I'm a Gulf icon"], explainAr: "الصقر الشاهين يغطس بسرعة تتجاوز ٣٠٠ كم/س.", explainEn: "A peregrine falcon dives at over 300 km/h." },
      },
      {
        promptAr: "وش أنا؟",
        promptEn: "What am I?",
        options: [o("الكبسة", "Kabsa"), o("المندي", "Mandi", { correct: true }), o("المقلوبة", "Maqluba")],
        extra: { cluesAr: ["أصلي من اليمن", "أنطبخ في حفرة تحت الأرض", "اسمي من الندى"], cluesEn: ["I come from Yemen", "I'm cooked in a pit underground", "My name comes from 'dew'"], explainAr: "اسم المندي من «الندى» لأن اللحم يطلع رطب.", explainEn: "Mandi's name comes from 'nada' (dew) — the meat comes out moist." },
      },
    ],
  },
  {
    slug: "debate",
    mechanic: "debate",
    titleAr: "المناظرة",
    titleEn: "The Debate",
    blurbAr: "طرفين وحجتين. مين أقنعك؟",
    blurbEn: "Two sides, two arguments. Who wins you over?",
    emoji: "🎤",
    color: "#ec4899",
    config: {},
    rounds: [
      {
        promptAr: "الشغل من البيت أحسن من المكتب؟",
        promptEn: "Is working from home better than the office?",
        options: [
          o("البيت", "Home", { revealAr: "وقت أقل في الزحمة ووقت أكثر لنفسك وأهلك. الإنتاجية بالنتيجة مو بالكرسي.", revealEn: "Less time in traffic, more time for yourself and family. Productivity is about results, not the chair." }),
          o("المكتب", "Office", { revealAr: "الأفكار الحلوة تجي من الكلام العفوي عند آلة القهوة. والفصل بين البيت والشغل راحة للعقل.", revealEn: "The best ideas come from chats by the coffee machine — and keeping home and work apart rests the mind." }),
        ],
      },
      {
        promptAr: "الأفلام أحسن في السينما ولا في البيت؟",
        promptEn: "Are films better at the cinema or at home?",
        options: [
          o("السينما", "Cinema", { revealAr: "الشاشة الكبيرة والصوت وضحكة الناس حولك… تجربة ما تتكرر في الصالة.", revealEn: "The big screen, the sound, a room laughing with you — an experience a living room can't copy." }),
          o("البيت", "Home", { revealAr: "توقف متى ما تبي، فشار أرخص، والكنب أريح من أي كرسي.", revealEn: "Pause whenever you like, cheaper popcorn, and the sofa beats any seat." }),
        ],
      },
      {
        promptAr: "الرسائل الصوتية ولا الكتابة؟",
        promptEn: "Voice notes or texting?",
        options: [
          o("الصوتية", "Voice notes", { revealAr: "النبرة توصل المشاعر اللي الكلمات تضيّعها، وأسرع وانت ماشي.", revealEn: "Tone carries feelings words lose — and it's faster on the go." }),
          o("الكتابة", "Texting", { revealAr: "تقراها بأي مكان وبثانية، وما تحتاج سماعة في الاجتماع.", revealEn: "Read anywhere in a second — no headphones needed in a meeting." }),
        ],
      },
    ],
  },
];
