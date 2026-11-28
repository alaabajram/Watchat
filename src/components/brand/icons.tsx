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
export const BookmarkIcon = ({ size = 22, color = "currentColor", fill = "none" }: P) => (
  <svg {...base(size)} fill={fill} stroke={color} strokeWidth={2} strokeLinejoin="round">
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
export const UserIcon = ({ size = 22, color = "currentColor", fill = "none" }: P) => (
  <svg {...base(size)} fill={fill} stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </svg>
);
export const GlobeIcon = ({ size = 20, color = "currentColor" }: P) => (
  <svg {...base(size)} fill="none" stroke={color} strokeWidth={2}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
  </svg>
);
export const HelpIcon = ({ size = 20, color = "currentColor" }: P) => (
  <svg {...base(size)} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z" />
  </svg>
);
export const ShieldIcon = ({ size = 20, color = "currentColor" }: P) => (
  <svg {...base(size)} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z" />
    <path d="M9 12l2 2 4-4" />
  </svg>
);
export const DocIcon = ({ size = 20, color = "currentColor" }: P) => (
  <svg {...base(size)} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 3h9l4 4v14H6z" />
    <path d="M9 12h7M9 16h5" />
  </svg>
);
export const LogoutIcon = ({ size = 20, color = "currentColor" }: P) => (
  <svg {...base(size)} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 4H6v16h8M10 12h11M17 8l4 4-4 4" />
  </svg>
);
export const ShareIcon = ({ size = 20, color = "currentColor" }: P) => (
  <svg {...base(size)} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 3L3 10.5l7 3 3 7z" />
  </svg>
);
export const ExploreIcon = ({ size = 22, color = "currentColor", fill = "none" }: P) => (
  <svg {...base(size)} fill="none" stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M15.5 8.5l-2 5-5 2 2-5z" fill={fill === "none" ? "none" : color} />
  </svg>
);
export const SearchIcon = ({ size = 20, color = "currentColor" }: P) => (
  <svg {...base(size)} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round">
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4.5 4.5" />
  </svg>
);
export const FlameIcon = ({ size = 14, color = "currentColor" }: P) => (
  <svg {...base(size)} fill={color}>
    <path d="M12 2c1 4 5 6 5 11a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3 0-4-1-6 1-9.5z" />
  </svg>
);
export const TranslateIcon = ({ size = 14, color = "currentColor" }: P) => (
  <svg {...base(size)} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 5h9M8.5 3v2M6 5c.5 3 2.5 6 6 7.5M11 5c-.5 3-3 6.5-6.5 8M13 20l4-9 4 9M14.5 17h5" />
  </svg>
);

export const RoomsIcon = ({ size = 22, color = "currentColor", fill = "none" }: P) => (
  <svg {...base(size)} fill={fill} stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="8" cy="9" r="3" />
    <circle cx="16.5" cy="9.5" r="2.5" />
    <path d="M2.5 19c.6-3 2.8-5 5.5-5s4.9 2 5.5 5M13.5 15.2c.9-.8 1.9-1.2 3-1.2 2.3 0 4 1.7 4.5 4.5" />
  </svg>
);
export const SparkIcon = ({ size = 22, color = "currentColor", fill = "none" }: P) => (
  <svg {...base(size)} fill={fill} stroke={color} strokeWidth={1.8} strokeLinejoin="round">
    <path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z" />
    <path d="M19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z" />
  </svg>
);
export const BotIcon = ({ size = 22, color = "currentColor", fill = "none" }: P) => (
  <svg {...base(size)} fill={fill} stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="8" width="16" height="12" rx="4" />
    <path d="M12 4v4M9 14h.01M15 14h.01" />
  </svg>
);
export const CompassIcon = ({ size = 22, color = "currentColor", fill = "none" }: P) => (
  <svg {...base(size)} fill={fill} stroke={color} strokeWidth={1.8} strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M15.5 8.5l-2 5-5 2 2-5z" />
  </svg>
);
