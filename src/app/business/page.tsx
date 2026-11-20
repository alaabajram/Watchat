import type { Metadata } from "next";
import { BusinessPage } from "./BusinessPage";

export const metadata: Metadata = {
  title: "واتشات للأعمال · Watchat for Business",
  description: "دراما عربية قصيرة تبدأ في واتساب — توزيع، إعادة تفاعل، وعلامة بيضاء للمنتجين ومنصات البث وشركات الاتصالات.",
};

export default function Page() {
  return <BusinessPage locale="ar" />;
}
