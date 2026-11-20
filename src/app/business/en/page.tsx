import type { Metadata } from "next";
import { BusinessPage } from "../BusinessPage";

export const metadata: Metadata = {
  title: "Watchat for Business",
  description: "Short Arabic dramas that start in WhatsApp — distribution, re-engagement and white label for producers, OTTs and telcos.",
};

export default function Page() {
  return <BusinessPage locale="en" />;
}
