import { describe, expect, it } from "vitest";
import type { InboundMessage } from "../whatsapp/inbound";
import { IDS, parseIntent } from "./intents";

const text = (body: string): InboundMessage => ({ id: "x", from: "1", timestamp: 0, kind: "text", text: body });

describe("parseIntent", () => {
  it("finds a series code anywhere in the first message", () => {
    expect(parseIntent(text("Hi, SECRETS01 please"))).toEqual({ type: "series_code", code: "SECRETS01" });
    expect(parseIntent(text("secrets01"))).toEqual({ type: "series_code", code: "SECRETS01" });
  });

  it("accepts Arabic-Indic digits in codes", () => {
    expect(parseIntent(text("SECRETS٠١"))).toEqual({ type: "series_code", code: "SECRETS01" });
  });

  it("understands commands in Arabic and English", () => {
    expect(parseIntent(text("STOP"))).toEqual({ type: "stop" });
    expect(parseIntent(text("إيقاف"))).toEqual({ type: "stop" });
    expect(parseIntent(text("menu"))).toEqual({ type: "menu" });
    expect(parseIntent(text("رابط"))).toEqual({ type: "link" });
  });

  it("maps button ids", () => {
    const reply = (id: string): InboundMessage => ({ id: "x", from: "1", timestamp: 0, kind: "reply", replyId: id });
    expect(parseIntent(reply(IDS.langEn))).toEqual({ type: "language", lang: "ar_en_subs" });
    expect(parseIntent(reply(IDS.next))).toEqual({ type: "next_episode" });
    expect(parseIntent(reply("series:DESERT02"))).toEqual({ type: "series_code", code: "DESERT02" });
  });

  it("reads device confirmation codes", () => {
    expect(parseIntent(text("CONFIRM 482913"))).toEqual({ type: "confirm_code", code: "482913" });
    expect(parseIntent(text("تأكيد ٤٨٢٩١٣"))).toEqual({ type: "confirm_code", code: "482913" });
    expect(parseIntent(text("CONFIRM 12"))).toMatchObject({ type: "unknown" });
  });

  it("falls back to unknown", () => {
    expect(parseIntent(text("hello"))).toMatchObject({ type: "unknown" });
  });
});
