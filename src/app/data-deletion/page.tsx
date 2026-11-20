// Data deletion instructions (required by Meta to publish the WhatsApp app).

import type { Metadata } from "next";

export const metadata: Metadata = { title: "Delete my data · حذف بياناتي — Watchat" };

export default function DataDeletionPage() {
  return (
    <main className="page">
      <section dir="rtl" lang="ar">
        <h1>حذف بياناتك</h1>
        <p>لحذف حسابك وجميع بياناتك من واتشات:</p>
        <ol>
          <li>افتح محادثة واتشات في واتساب.</li>
          <li>
            أرسل الرسالة: <strong>DELETE MY DATA</strong>
          </li>
          <li>سيؤكد فريقنا الطلب ويحذف بياناتك خلال 30 يومًا.</li>
        </ol>
        <p className="muted">
          نحتفظ فقط بسجلات المشتريات التي يفرضها القانون الضريبي، للمدة التي يفرضها.
        </p>
      </section>

      <hr style={{ margin: "40px 0", borderColor: "#333" }} />

      <section dir="ltr" lang="en">
        <h1>Delete your data</h1>
        <p>To delete your Watchat account and all your data:</p>
        <ol>
          <li>Open the Watchat chat in WhatsApp.</li>
          <li>
            Send the message: <strong>DELETE MY DATA</strong>
          </li>
          <li>Our team will confirm the request and delete your data within 30 days.</li>
        </ol>
        <p className="muted">We keep purchase records only where tax law requires it, and only for as long as it requires.</p>
      </section>
    </main>
  );
}
