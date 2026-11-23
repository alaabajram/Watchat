"use client";

// Password box for the admin sign-in screens: warns when Caps Lock is on and can show what was typed.

import { useState, type KeyboardEvent } from "react";

type Props = { name: string; autoComplete: "current-password" | "new-password"; minLength?: number; required?: boolean };

export function PasswordInput({ name, autoComplete, minLength, required = true }: Props) {
  const [caps, setCaps] = useState(false);
  const [show, setShow] = useState(false);
  const check = (e: KeyboardEvent<HTMLInputElement>) => setCaps(e.getModifierState?.("CapsLock") ?? false);
  return (
    <span style={{ display: "grid", gap: 4 }}>
      <span style={{ position: "relative", display: "block" }}>
        <input
          name={name}
          type={show ? "text" : "password"}
          autoComplete={autoComplete}
          minLength={minLength}
          required={required}
          onKeyDown={check}
          onKeyUp={check}
          onBlur={() => setCaps(false)}
          style={{ width: "100%", paddingInlineEnd: 64 }}
        />
        <button
          type="button"
          className="secondary"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? "Hide password" : "Show password"}
          style={{ position: "absolute", insetInlineEnd: 6, top: "50%", transform: "translateY(-50%)", padding: "3px 10px", fontSize: 12, boxShadow: "none" }}
        >
          {show ? "Hide" : "Show"}
        </button>
      </span>
      {caps && (
        <span role="status" style={{ fontSize: 13, fontWeight: 600, color: "#9a5b00", background: "#fff4dc", borderRadius: 8, padding: "4px 10px" }}>
          ⇪ Caps Lock is on
        </span>
      )}
    </span>
  );
}
