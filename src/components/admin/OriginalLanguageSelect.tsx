// "Original language" of a series (the language spoken in the uploaded videos). Stored in series.dialect.

import { LANG_KEYS, LANGS, originalLang } from "@/lib/storage/tracks";

export function OriginalLanguageSelect({ value }: { value?: string | null }) {
  return (
    <label>
      Original language (spoken in the videos)
      <select name="dialect" defaultValue={originalLang(value)}>
        {LANG_KEYS.map((k) => (
          <option key={k} value={k}>
            {LANGS[k].en}
          </option>
        ))}
      </select>
    </label>
  );
}
