import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { countryFromPhone } from "../phone";
import { marketFromPhone } from "../spend/meter";
import { parseIntent } from "../bot/intents";
import {
  chatIdOf,
  commandText,
  fillTemplate,
  isTelegram,
  parseUpdate,
  startTarget,
  tgAddress,
  toTelegramCalls,
  verifyInitData,
  webhookSecret,
} from "./telegram";

const SITE = "https://watchat.pro";

describe("Telegram addresses", () => {
  it("are tg:<chat id>, with or without the + of phone_e164", () => {
    expect(tgAddress(123)).toBe("tg:123");
    expect(isTelegram("tg:123")).toBe(true);
    expect(isTelegram("+tg:123")).toBe(true);
    expect(isTelegram("971500000000")).toBe(false);
    expect(chatIdOf("+tg:987")).toBe("987");
  });
  it("never look like a country or a billed market", () => {
    expect(countryFromPhone("tg:971500")).toBeNull();
    expect(marketFromPhone("tg:9665000")).toBe("OTHER");
  });
  it("the webhook secret is stable and Telegram-safe", () => {
    expect(webhookSecret("123:abc")).toMatch(/^[0-9a-f]{48}$/);
    expect(webhookSecret("123:abc")).toBe(webhookSecret("123:abc"));
    expect(webhookSecret("123:abc")).not.toBe(webhookSecret("123:abd"));
  });
});

describe("inbound updates", () => {
  const msg = (text: string, chatType = "private") => ({ update_id: 7, message: { message_id: 1, date: 1, text, chat: { id: 42, type: chatType }, from: { id: 42, first_name: "Sara" } } });

  it("commands become the words the bot knows", () => {
    expect(commandText("/start")).toEqual({ text: "START" });
    expect(commandText("/start SECRETS01")).toEqual({ text: "SECRETS01" });
    expect(commandText("/start INV-ABC234")).toEqual({ text: "INV-ABC234" });
    expect(commandText("/menu@WatchatDramaBot")).toEqual({ text: "MENU" });
    expect(commandText("/continue")).toEqual({ text: "LINK" });
    expect(commandText("/account")).toEqual({ text: "ACCOUNT" });
    expect(commandText("/store")).toEqual({ text: "", page: "store" });
    expect(commandText("مرحبا")).toEqual({ text: "مرحبا" });
  });

  it("a text message is an InboundMessage from tg:<chat>", () => {
    const p = parseUpdate(msg("/start SECRETS01"))!;
    expect(p.msg).toMatchObject({ id: "tg:7", from: "tg:42", kind: "text", text: "SECRETS01", profileName: "Sara" });
    expect(parseIntent(p.msg!)).toEqual({ type: "series_code", code: "SECRETS01" });
    expect(parseIntent(parseUpdate(msg("/start"))!.msg!)).toEqual({ type: "menu" });
    expect(parseIntent(parseUpdate(msg("/start INV-ABC234"))!.msg!)).toEqual({ type: "menu" });
  });

  it("a tapped button is a reply with the same id WhatsApp would send", () => {
    const p = parseUpdate({ update_id: 8, callback_query: { id: "cb1", data: "f:n1:a", from: { id: 42 }, message: { chat: { id: 42, type: "private" } } } })!;
    expect(p.callbackQueryId).toBe("cb1");
    expect(p.msg).toMatchObject({ from: "tg:42", kind: "reply", replyId: "f:n1:a" });
  });

  it("groups and channels never reach the bot", () => {
    expect(parseUpdate(msg("hi", "group"))!.msg).toBeNull();
    expect(parseUpdate(msg("hi", "channel"))!.msg).toBeNull();
    expect(parseUpdate({})).toBeNull();
  });

  it("Stars payments: the confirmation question and the paid message", () => {
    const q = parseUpdate({ update_id: 9, pre_checkout_query: { id: "pq1", currency: "XTR", total_amount: 700, invoice_payload: "order-1", from: { id: 42 } } })!;
    expect(q.preCheckout).toEqual({ id: "pq1", currency: "XTR", total_amount: 700, invoice_payload: "order-1" });
    const paid = parseUpdate({ update_id: 10, message: { chat: { id: 42, type: "private" }, from: { id: 42 }, successful_payment: { currency: "XTR", total_amount: 700, invoice_payload: "order-1", telegram_payment_charge_id: "ch1" } } })!;
    expect(paid.msg).toBeNull();
    expect(paid.payment).toMatchObject({ chatId: 42, data: { telegram_payment_charge_id: "ch1" } });
  });

  it("/store and /rewards are answered as pages", () => {
    expect(parseUpdate(msg("/rewards"))).toMatchObject({ msg: null, page: "rewards" });
  });
});

describe("outbound messages", () => {
  it("buttons become inline buttons with callback data", () => {
    const [call] = toTelegramCalls("42", { kind: "buttons", body: "Pick", buttons: [{ id: "f:n1:a", title: "Yes" }, { id: "x".repeat(80), title: "Too long" }] }, SITE);
    expect(call.method).toBe("sendMessage");
    expect(call.body.reply_markup).toEqual({ inline_keyboard: [[{ text: "Yes", callback_data: "f:n1:a" }]] });
  });

  it("links to the site open the Mini App; other links open normally", () => {
    const [own] = toTelegramCalls("42", { kind: "cta_url", body: "Watch", buttonText: "Watch now", url: `${SITE}/w/tok` }, SITE);
    expect(own.body.reply_markup).toEqual({ inline_keyboard: [[{ text: "Watch now", web_app: { url: `${SITE}/w/tok` } }]] });
    const [other] = toTelegramCalls("42", { kind: "cta_url", body: "x", buttonText: "Open", url: "https://example.com" }, SITE);
    expect(other.body.reply_markup).toEqual({ inline_keyboard: [[{ text: "Open", url: "https://example.com" }]] });
  });

  it("media headers ride along as a captioned photo or video, or go first when the text is long", () => {
    const [v] = toTelegramCalls("42", { kind: "buttons", body: "Ep 1", header: { type: "video", link: "https://v/1.mp4" }, buttons: [{ id: "a", title: "Next" }] }, SITE);
    expect(v).toMatchObject({ method: "sendVideo", body: { video: "https://v/1.mp4", caption: "Ep 1" } });
    const long = toTelegramCalls("42", { kind: "cta_url", body: "x".repeat(1500), buttonText: "Go", url: `${SITE}/me`, header: { type: "image", link: "https://i/1.jpg" } }, SITE);
    expect(long.map((c) => c.method)).toEqual(["sendPhoto", "sendMessage"]);
  });

  it("lists become one button per row", () => {
    const [l] = toTelegramCalls("42", { kind: "list", body: "Series", buttonText: "Open", sections: [{ title: "All", rows: [{ id: "series:A", title: "A" }, { id: "series:B", title: "B" }] }] }, SITE);
    expect((l.body.reply_markup as { inline_keyboard: unknown[] }).inline_keyboard).toHaveLength(2);
  });

  it("templates fill their parameters", () => {
    expect(fillTemplate("«{{1}}» episode {{2}}", ["Secrets", "4"])).toBe("«Secrets» episode 4");
    expect(fillTemplate("{{1}} and {{3}}", ["a"])).toBe("a and {{3}}");
  });
});

describe("Mini App sign-in", () => {
  const TOKEN = "123456:TEST-token";
  const sign = (fields: Record<string, string>) => {
    const check = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join("\n");
    const secret = createHmac("sha256", "WebAppData").update(TOKEN).digest();
    const hash = createHmac("sha256", secret).update(check).digest("hex");
    return new URLSearchParams({ ...fields, hash }).toString();
  };
  const now = 1_800_000_000;
  const fields = { auth_date: String(now - 60), query_id: "q1", user: JSON.stringify({ id: 42, first_name: "Sara", language_code: "en" }), start_param: "SECRETS01" };

  it("accepts Telegram's signed data", () => {
    expect(verifyInitData(sign(fields), TOKEN, now)).toEqual({ id: 42, firstName: "Sara", language: "en", startParam: "SECRETS01" });
  });
  it("rejects tampered, foreign or stale data", () => {
    const good = sign(fields);
    expect(verifyInitData(good.replace("42", "43"), TOKEN, now)).toBeNull();
    expect(verifyInitData(good, "999:other", now)).toBeNull();
    expect(verifyInitData(good, TOKEN, now + 2 * 86400)).toBeNull();
    expect(verifyInitData("", TOKEN, now)).toBeNull();
  });
  it("a series start parameter opens the series", () => {
    expect(startTarget("secrets01")).toBe("/series/SECRETS01");
    expect(startTarget("INV-ABC234")).toBe("/");
    expect(startTarget(null)).toBe("/");
  });
});

describe("framed Mini App (Telegram Web / Desktop)", () => {
  it("uses a SameSite=None, partitioned, secure session cookie only inside a frame", async () => {
    const { sessionCookieOptions, loadedInFrame } = await import("../session-cookie");
    expect(sessionCookieOptions(true, false)).toMatchObject({ sameSite: "none", partitioned: true, secure: true, httpOnly: true });
    expect(sessionCookieOptions(false, true)).toEqual({ httpOnly: true, secure: true, sameSite: "lax", path: "/" });
    expect(loadedInFrame(new Headers({ "sec-fetch-dest": "iframe" }))).toBe(true);
    expect(loadedInFrame(new Headers({ "sec-fetch-dest": "document" }))).toBe(false);
  });
});

describe("account linking updates", () => {
  const msg = (m: Record<string, unknown>) => ({ update_id: 7, message: { chat: { id: 42, type: "private" }, from: { id: 42, first_name: "A", language_code: "en" }, date: 1, ...m } });
  it("reads 'connect Telegram' links", () => {
    expect(parseUpdate(msg({ text: "/start link_abcdefghijklmnopqrstuvwxyz012345" }))?.link).toEqual({ chatId: 42, token: "abcdefghijklmnopqrstuvwxyz012345", en: true });
    expect(parseUpdate(msg({ text: "/start HOLIDAY01" }))?.link).toBeUndefined();
  });
  it("accepts only the viewer's own shared number", () => {
    expect(parseUpdate(msg({ contact: { phone_number: "971501234567", user_id: 42 } }))?.contact).toEqual({ chatId: 42, phone: "+971501234567", en: true });
    expect(parseUpdate(msg({ contact: { phone_number: "971501234567", user_id: 99 } }))?.contact).toBeUndefined();
    expect(parseUpdate(msg({ contact: { phone_number: "971501234567" } }))?.msg).toBeNull();
  });
});
