// Starting text for the Terms, Privacy and About pages (the team edits and publishes them in
// Admin → Settings → Brand & site). Drafts: have counsel review the legal pages before launch.

import type { PageSlug } from "./brand";

type PageText = { titleAr: string; titleEn: string; bodyAr: string; bodyEn: string };

export function defaultPages(nameAr: string, nameEn: string, supportEmail: string | null): Record<PageSlug, PageText> {
  const contactAr = supportEmail ? `للتواصل: [${supportEmail}](mailto:${supportEmail})` : "للتواصل: أرسل رسالة إلى رقمنا في واتساب.";
  const contactEn = supportEmail ? `Contact us: [${supportEmail}](mailto:${supportEmail})` : "Contact us: send a message to our WhatsApp number.";
  return {
    privacy: {
      titleAr: "سياسة الخصوصية",
      titleEn: "Privacy policy",
      bodyAr: `${nameAr} خدمة لمشاهدة مسلسلات قصيرة تبدأ في واتساب وتكمل على موقعنا. رقم واتساب الخاص بك هو حسابك، ولا نطلب اسمًا أو بريدًا إلكترونيًا أو كلمة مرور.

## البيانات التي نجمعها
- رقم واتساب واسم الملف الشخصي الذي يرسله واتساب.
- اللغة التي تختارها، والحلقات التي شاهدتها، ومكان توقفك.
- موافقتك أو رفضك لاستقبال تنبيهات الحلقات الجديدة.
- مشترياتك ورصيد العملات. بيانات البطاقة يعالجها مزوّد الدفع ولا تصل إلينا.
- معلومات تقنية بسيطة عند فتح الموقع (نوع المتصفح وعنوان IP) لحماية حسابك.

## كيف نستخدمها
- لإرسال الحلقات والروابط الشخصية إليك وتذكيرك بمكان توقفك.
- لإرسال التنبيهات فقط إذا وافقت عليها. أرسل STOP في أي وقت لإيقافها.
- لفهم كيف يستخدم المشاهدون الخدمة وتحسينها، باستخدام معرّف مشفّر بدل رقمك.

## مع من نشاركها
نستخدم مزوّدين لتشغيل الخدمة: Meta (واتساب)، و Vercel (استضافة الموقع)، و Supabase (قاعدة البيانات)، و Cloudflare (بث الفيديو)، ومزوّد الدفع. لا نبيع بياناتك.

## حقوقك
يمكنك طلب نسخة من بياناتك أو حذفها في أي وقت. راجع [صفحة حذف البيانات](/data-deletion).

${contactAr}`,
      bodyEn: `${nameEn} is a service for short drama series that start in WhatsApp and continue on our website. Your WhatsApp number is your account; we don't ask for a name, email or password.

## What we collect
- Your WhatsApp number and the profile name WhatsApp shares with us.
- Your chosen language, the episodes you watched and where you stopped.
- Whether you agreed to receive new-episode alerts.
- Your purchases and coin balance. Card details are handled by our payment provider and never reach us.
- Basic technical data when you open the website (browser type, IP address) to keep your account safe.

## How we use it
- To send you episodes and personal links, and remind you where you stopped.
- To send alerts only if you agreed to them. Send STOP at any time to turn them off.
- To understand how viewers use the service and improve it, using a hashed ID in place of your number.

## Who we share it with
We use service providers to run ${nameEn}: Meta (WhatsApp), Vercel (website hosting), Supabase (database), Cloudflare (video streaming) and our payment provider. We do not sell your data.

## Your rights
You can ask for a copy of your data or for it to be deleted at any time. See the [data deletion page](/data-deletion).

${contactEn}`,
    },
    terms: {
      titleAr: "الشروط والأحكام",
      titleEn: "Terms of use",
      bodyAr: `باستخدامك ${nameAr} توافق على هذه الشروط.

## الحساب
رقم واتساب الخاص بك هو حسابك. الروابط التي نرسلها لك شخصية، فلا تشاركها مع غيرك.

## العملات والمشتريات
- العملات تُستخدم لفتح الحلقات داخل ${nameAr} فقط، وليس لها قيمة نقدية.
- الأسعار تشمل ضريبة القيمة المضافة حيث تنطبق.
- المشتريات نهائية إلا إذا نص القانون على غير ذلك. إذا واجهت مشكلة في الدفع تواصل معنا.

## المحتوى
المسلسلات محمية بحقوق النشر. لا يجوز تسجيلها أو إعادة نشرها.

## التنبيهات
نرسل التنبيهات فقط إذا وافقت عليها. أرسل STOP لإيقافها في أي وقت.

## التغييرات
قد نحدّث هذه الشروط، وننشر التاريخ الجديد في هذه الصفحة.

${contactAr}`,
      bodyEn: `By using ${nameEn} you agree to these terms.

## Your account
Your WhatsApp number is your account. The links we send you are personal, so don't share them.

## Coins and purchases
- Coins unlock episodes on ${nameEn} only and have no cash value.
- Prices include VAT where it applies.
- Purchases are final unless the law says otherwise. If something went wrong with a payment, contact us.

## Content
The series are protected by copyright. You may not record or republish them.

## Alerts
We only send alerts if you agreed to them. Send STOP at any time to turn them off.

## Changes
We may update these terms and will post the new date on this page.

${contactEn}`,
    },
    about: {
      titleAr: `عن ${nameAr}`,
      titleEn: `About ${nameEn}`,
      bodyAr: `${nameAr} يقدّم مسلسلات عربية قصيرة تبدأ في واتساب. تبدأ القصة في المحادثة، وتكمل الحلقات على موقعنا بدون تحميل أي تطبيق.

${contactAr}`,
      bodyEn: `${nameEn} brings short Arabic drama series that start in WhatsApp. The story begins in the chat and continues on our website, with no app to download.

${contactEn}`,
    },
  };
}
