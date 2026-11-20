// Stroke icons for the viewer app (decorative: always aria-hidden; the control carries the label).

type P = { size?: number; color?: string; fill?: string };
const base = (size: number) => ({ width: size, height: size, viewBox: "0 0 24 24", "aria-hidden": true as const, focusable: "false" as const });

export const ChatIcon = ({ size = 22, color = "currentColor" }: P) => (
  <svg {...base(size)} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12a8 8 0 0 1-11.8 7L4 20.5l1.5-5A8 8 0 1 1 21 12z" />
  </svg>
);
export const PlayIcon = ({ size = 14, fill = "currentColor" }: P) => (
  <svg {...base(size)} fill={fill}>
    <path d="M7 4v16l13-8z" />
  </svg>
);
export const GiftIcon = ({ size = 20, color = "currentColor" }: P) => (
  <svg {...base(size)} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <rect x="3.5" y="8" width="17" height="4" rx="1" />
    <path d="M5 12v8h14v-8M12 8v12M12 8c-1.5-3-5-3-5-1s3 1 5 1c2 0 5 1 5-1s-3.5-2-5 1" />
  </svg>
);
export const HomeIcon = ({ size = 22, color = "currentColor", fill = "none" }: P) => (
  <svg {...base(size)} fill={fill} stroke={color} strokeWidth={1.8} strokeLinejoin="round">
    <path d="M4 10l8-6 8 6v10h-5v-6H9v6H4z" />
  </svg>
);
export const BookmarkIcon = ({ size = 22, color = "currentColor" }: P) => (
  <svg {...base(size)} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round">
    <path d="M6 3h12v18l-6-4-6 4z" />
  </svg>
);
export const WalletIcon = ({ size = 22, color = "currentColor" }: P) => (
  <svg {...base(size)} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a1 1 0 0 1-1-1V7zM4 7l11-3v3" />
    <circle cx="16" cy="13.5" r="1.2" fill={color} />
  </svg>
);
export const SettingsIcon = ({ size = 22, color = "currentColor" }: P) => (
  <svg {...base(size)} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </svg>
);
export const PlusIcon = ({ size = 16, color = "currentColor" }: P) => (
  <svg {...base(size)} fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round">
    <path d="M12 5v14M5 12h14" />
  </svg>
);
/** Points "forward" in reading order: left in Arabic, right in English. */
export const ChevronIcon = ({ size = 18, color = "currentColor", rtl = true }: P & { rtl?: boolean }) => (
  <svg {...base(size)} fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <path d={rtl ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} />
  </svg>
);
