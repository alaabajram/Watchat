// Privacy notice (required by Meta to publish the WhatsApp app). Draft — have counsel review before launch.

import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy · الخصوصية — Watchat" };

const UPDATED = "20 November 2026";

export default function PrivacyPage() {
  return (
    <main className="page">
      <section dir="rtl" lang="ar">
        <h1>سياسة الخصوصية</h1>
        <p className="muted">آخر تحديث: ٢٠ نوفمبر ٢٠٢٦</p>
        <p>
          واتشات خدمة لمشاهدة مسلسلات قصيرة تبدأ في واتساب وتكمل على موقعنا. رقم واتساب الخاص بك هو حسابك، ولا نطلب
          اسمًا أو بريدًا إلكترونيًا أو كلمة مرور.
        </p>
        <h2>البيانات التي نجمعها</h2>
        <ul>
          <li>رقم واتساب واسم الملف الشخصي الذي يرسله واتساب.</li>
          <li>اللغة التي تختارها، والحلقات التي شاهدتها، ومكان توقفك.</li>
          <li>موافقتك أو رفضك لاستقبال تنبيهات الحلقات الجديدة.</li>
          <li>مشترياتك ورصيد العملات. بيانات البطاقة يعالجها مزوّد الدفع ولا تصل إلينا.</li>
          <li>معلومات تقنية بسيطة عند فتح الموقع (نوع المتصفح وعنوان IP) لحماية حسابك.</li>
        </ul>
        <h2>كيف نستخدمها</h2>
        <ul>
          <li>لإرسال الحلقات والروابط الشخصية إليك وتذكيرك بمكان توقفك.</li>
          <li>لإرسال التنبيهات فقط إذا وافقت عليها. أرسل STOP في أي وقت لإيقافها.</li>
          <li>لفهم كيف يستخدم المشاهدون الخدمة وتحسينها، باستخدام معرّف مشفّر بدل رقمك.</li>
        </ul>
        <h2>مع من نشاركها</h2>
        <p>
          نستخدم مزوّدين لتشغيل الخدمة: Meta (واتساب)، و Vercel (استضافة الموقع)، و Supabase (قاعدة البيانات)، و
          Cloudflare (بث الفيديو)، ومزوّد الدفع. لا نبيع بياناتك.
        </p>
        <h2>حقوقك</h2>
        <p>
          يمكنك طلب نسخة من بياناتك أو حذفها في أي وقت. راجع <a href="/data-deletion">صفحة حذف البيانات</a>.
        </p>
      </section>

      <hr style={{ margin: "40px 0", borderColor: "#333" }} />

      <section dir="ltr" lang="en">
        <h1>Privacy Policy</h1>
        <p className="muted">Last updated: {UPDATED}</p>
        <p>
          Watchat is a service for short drama series that start in WhatsApp and continue on our website. Your WhatsApp
          number is your account; we don&apos;t ask for a name, email or password.
        </p>
        <h2>What we collect</h2>
        <ul>
          <li>Your WhatsApp number and the profile name WhatsApp shares with us.</li>
          <li>Your chosen language, the episodes you watched and where you stopped.</li>
          <li>Whether you agreed to receive new-episode alerts.</li>
          <li>Your purchases and coin balance. Card details are handled by our payment provider and never reach us.</li>
          <li>Basic technical data when you open the website (browser type, IP address) to keep your account safe.</li>
        </ul>
        <h2>How we use it</h2>
        <ul>
          <li>To send you episodes and personal links, and remind you where you stopped.</li>
          <li>To send alerts only if you agreed to them. Send STOP at any time to turn them off.</li>
          <li>To understand how viewers use the service and improve it, using a hashed ID in place of your number.</li>
        </ul>
        <h2>Who we share it with</h2>
        <p>
          We use service providers to run Watchat: Meta (WhatsApp), Vercel (website hosting), Supabase (database),
          Cloudflare (video streaming) and our payment provider. We do not sell your data.
        </p>
        <h2>Your rights</h2>
        <p>
          You can ask for a copy of your data or for it to be deleted at any time. See the{" "}
          <a href="/data-deletion">data deletion page</a>.
        </p>
      </section>
    </main>
  );
}
