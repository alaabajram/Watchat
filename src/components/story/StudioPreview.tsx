"use client";

// The episode in a phone frame for Studio review (draft; nothing paid or saved), in Arabic or English.

import { useState } from "react";
import type { Character, StoryGraph, StoryStyle } from "@/lib/story/types";
import { StoryPlayer } from "./StoryPlayer";

export function StudioPreview({ story, style, characters }: { story: StoryGraph; style: StoryStyle; characters: Character[] }) {
  const [lang, setLang] = useState<"ar" | "en">("ar");
  const [run, setRun] = useState(0);
  return (
    <div className="story-phone-col" style={{ position: "static" }}>
      <div className="row" style={{ gap: 6 }}>
        <button type="button" className={lang === "ar" ? "small" : "secondary small"} onClick={() => setLang("ar")}>
          عربي
        </button>
        <button type="button" className={lang === "en" ? "small" : "secondary small"} onClick={() => setLang("en")}>
          English
        </button>
        <button type="button" className="secondary small" onClick={() => setRun((r) => r + 1)}>
          ↺ Restart
        </button>
      </div>
      <div className="story-phone wc">
        {story.scenes.length ? <StoryPlayer key={`${lang}-${run}`} story={story} style={style} characters={characters} locale={lang} preview /> : <div className="wc-story-empty">No scenes yet</div>}
      </div>
    </div>
  );
}
