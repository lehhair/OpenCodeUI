// Icon components standardized to 24x24 Stroked (Lucide-style)
import type { SVGProps } from 'react'

export interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number | string
}

const DefaultIcon = ({ size = 16, className, children, ...props }: IconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    {...props}
  >
    {children}
  </svg>
)

export const ChevronDownIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <path d="m6 9 6 6 6-6" />
  </DefaultIcon>
)

export const ChevronUpIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <path d="m18 15-6-6-6 6" />
  </DefaultIcon>
)

export const NewChatIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.375 2.625a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4Z" />
  </DefaultIcon>
)

export const MenuDotsIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <circle cx="12" cy="12" r="1" />
    <circle cx="19" cy="12" r="1" />
    <circle cx="5" cy="12" r="1" />
  </DefaultIcon>
)

export const HandIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0" />
    <path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2" />
    <path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8" />
    <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
  </DefaultIcon>
)

export const KeyboardIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <rect width="20" height="16" x="2" y="4" rx="2" ry="2" />
    <path d="M6 8h.001" />
    <path d="M10 8h.001" />
    <path d="M14 8h.001" />
    <path d="M18 8h.001" />
    <path d="M8 12h.001" />
    <path d="M12 12h.001" />
    <path d="M16 12h.001" />
    <path d="M7 16h10" />
  </DefaultIcon>
)


export const CheckIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <path d="M20 6 9 17l-5-5" />
  </DefaultIcon>
)

export const SendIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <path d="m22 2-7 20-4-9-9-4Z" />
    <path d="M22 2 11 13" />
  </DefaultIcon>
)

export const PlusIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <path d="M5 12h14" />
    <path d="M12 5v14" />
  </DefaultIcon>
)

export const TeachIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z" />
    <path d="M22 10v6" />
    <path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5" />
  </DefaultIcon>
)

export const SettingsIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1.51 1H15a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </DefaultIcon>
)


export const BoltIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
  </DefaultIcon>
)

export const SunIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2" />
    <path d="M12 20v2" />
    <path d="m4.93 4.93 1.41 1.41" />
    <path d="m17.66 17.66 1.41 1.41" />
    <path d="M2 12h2" />
    <path d="M20 12h2" />
    <path d="m6.34 17.66-1.41 1.41" />
    <path d="m19.07 4.93-1.41 1.41" />
  </DefaultIcon>
)

export const MoonIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
  </DefaultIcon>
)

export const SystemIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
  </DefaultIcon>
)

export const SidebarIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <line x1="9" y1="3" x2="9" y2="21" />
  </DefaultIcon>
)

export const PanelRightIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <line x1="15" y1="3" x2="15" y2="21" />
  </DefaultIcon>
)

export const PanelBottomIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <line x1="3" y1="15" x2="21" y2="15" />
  </DefaultIcon>
)

export const StopIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />
  </DefaultIcon>
)


export const ImageIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
    <circle cx="9" cy="9" r="2" />
    <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
  </DefaultIcon>
)

export const CopyIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
  </DefaultIcon>
)

export const AgentIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z" />
    <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z" />
  </DefaultIcon>
)

export const ExpandIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <path d="M15 3h6v6" />
    <path d="M10 14 21 3" />
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
  </DefaultIcon>
)

export const CloseIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </DefaultIcon>
)


export const ThinkingIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
    <path d="M20 3v4" />
    <path d="M22 5h-4" />
    <path d="M4 17v2" />
    <path d="M5 18H3" />
  </DefaultIcon>
)

export const UndoIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11" />
  </DefaultIcon>
)

export const RedoIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5v0A5.5 5.5 0 0 0 9.5 20H13" />
  </DefaultIcon>
)

export const TerminalIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <polyline points="4 17 10 11 4 5" />
    <line x1="12" y1="19" x2="20" y2="19" />
  </DefaultIcon>
)

export const FileIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
    <path d="M14 2v4a2 2 0 0 0 2 2h4" />
  </DefaultIcon>
)

export const FolderIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 2H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
  </DefaultIcon>
)

export const FolderOpenIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
  </DefaultIcon>
)


export const SearchIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </DefaultIcon>
)

export const AtIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <circle cx="12" cy="12" r="4" />
    <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" />
  </DefaultIcon>
)

// ============================================
// Stroke-style icons (for UI elements)
// ============================================

export const PencilIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    <path d="m15 5 4 4" />
  </DefaultIcon>
)

export const ComposeIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.375 2.625a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4Z" />
  </DefaultIcon>
)

export const CogIcon = (props: IconProps) => (
  <SettingsIcon {...props} />
)

export const MoreHorizontalIcon = (props: IconProps) => (
  <MenuDotsIcon {...props} />
)

export const TrashIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <path d="M3 6h18" />
    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
  </DefaultIcon>
)

export const QuestionIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <path d="M8 8a4 4 0 1 1 8 0c0 2-4 3-4 5v1" />
    <circle cx="12" cy="19" r="1.5" fill="currentColor" stroke="none" />
  </DefaultIcon>
)

export const GridIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </DefaultIcon>
)

export const ChevronRightIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <path d="m9 18 6-6-6-6" />
  </DefaultIcon>
)

export const ReturnIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <polyline points="9 10 4 15 9 20" />
    <path d="M20 4v7a4 4 0 0 1-4 4H4" />
  </DefaultIcon>
)

export const SpinnerIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
    <path d="M12 2a10 10 0 0 1 10 10" />
  </DefaultIcon>
)

export const LightningIcon = (props: IconProps) => (
  <BoltIcon {...props} />
)

export const EyeIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </DefaultIcon>
)

export const MaximizeIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
  </DefaultIcon>
)

export const MinimizeIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M10 14l-7 7" />
  </DefaultIcon>
)

export const ShareIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
    <polyline points="16 6 12 2 8 6" />
    <line x1="12" y1="2" x2="12" y2="15" />
  </DefaultIcon>
)

export const LinkIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </DefaultIcon>
)

export const ExternalLinkIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </DefaultIcon>
)

export const GlobeIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <circle cx="12" cy="12" r="10" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </DefaultIcon>
)

export const MessageSquareIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </DefaultIcon>
)

export const ArrowUpIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <path d="M12 19V5" />
    <path d="m5 12 7-7 7 7" />
  </DefaultIcon>
)

export const ArrowDownIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <path d="M12 5v14" />
    <path d="m19 12-7 7-7-7" />
  </DefaultIcon>
)


export const PathAutoIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M4.93 19.07l1.41-1.41m11.32-11.32l1.41-1.41" />
  </DefaultIcon>
)

export const PathUnixIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <path d="M7 4l10 16" />
  </DefaultIcon>
)

export const PathWindowsIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <path d="M17 4L7 20" />
  </DefaultIcon>
)

export const ClockIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </DefaultIcon>
)

export const CircleIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <circle cx="12" cy="12" r="10" />
  </DefaultIcon>
)

export const AlertCircleIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </DefaultIcon>
)

export const RetryIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
    <path d="M3 21v-5h5" />
  </DefaultIcon>
)

export const CompactIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <path d="M4 12h16" />
    <path d="M4 6h16" />
    <path d="M4 18h16" />
    <path d="M8 3v3" />
    <path d="M16 3v3" />
    <path d="M8 18v3" />
    <path d="M16 18v3" />
  </DefaultIcon>
)

export const PatchIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <path d="M12 3v18" />
    <path d="M3 12h18" />
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </DefaultIcon>
)

export const CpuIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <rect width="16" height="16" x="4" y="4" rx="2" />
    <path d="M9 2v2" /><path d="M15 2v2" />
    <path d="M9 20v2" /><path d="M15 20v2" />
    <path d="M2 9h2" /><path d="M2 15h2" />
    <path d="M20 9h2" /><path d="M20 15h2" />
  </DefaultIcon>
)

export const DollarSignIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <line x1="12" x2="12" y1="2" y2="22" />
    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </DefaultIcon>
)

export const LightbulbIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-1 1.5-2 1.5-3.5 0-3-2-5.5-6-5.5S6 5 6 8c0 1.5.5 2.5 1.5 3.5.8.8 1.3 1.5 1.5 2.5" />
    <path d="M9 18h6" />
    <path d="M10 22h4" />
  </DefaultIcon>
)

export const ClipboardListIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    <path d="M12 11h4" />
    <path d="M12 16h4" />
    <path d="M8 11h.01" />
    <path d="M8 16h.01" />
  </DefaultIcon>
)

export const PermissionListIcon = (props: IconProps) => (
  <DefaultIcon {...props} strokeWidth={1.5}>
    <polyline points="3 5 5 7 9 3" />
    <path d="M12 5h9" />
    <rect x="3" y="10" width="4" height="4" rx="1" />
    <path d="M12 12h9" />
    <rect x="3" y="17" width="4" height="4" rx="1" />
    <path d="M12 19h9" />
  </DefaultIcon>
)

export const UsersIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </DefaultIcon>
)

export const GitCommitIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <circle cx="12" cy="12" r="3" />
    <line x1="3" y1="12" x2="9" y2="12" />
    <line x1="15" y1="12" x2="21" y2="12" />
  </DefaultIcon>
)

export const GitBranchIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <line x1="6" y1="3" x2="6" y2="15" />
    <circle cx="18" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M18 9a9 9 0 0 1-9 9" />
  </DefaultIcon>
)

export const GitWorktreeIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <circle cx="6" cy="6" r="3" />
    <path d="M6 9v6" />
    <circle cx="6" cy="18" r="3" />
    <path d="M9 6h6" />
    <circle cx="18" cy="6" r="3" />
    <path d="M18 9v6" />
    <circle cx="18" cy="18" r="3" />
  </DefaultIcon>
)

export const GitDiffIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <path d="M12 3v14" />
    <path d="M5 10h14" />
    <path d="M5 21h14" />
  </DefaultIcon>
)

export const PlugIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <path d="M12 22v-5" />
    <path d="M9 8V2" />
    <path d="M15 8V2" />
    <path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
  </DefaultIcon>
)

export const KeyIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <circle cx="7.5" cy="15.5" r="5.5" />
    <path d="m21 2-9.3 9.3" />
    <path d="M17 6h4v-4" />
  </DefaultIcon>
)

export const WifiIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <path d="M5 13a10 10 0 0 1 14 0" />
    <path d="M8.5 16.5a5 5 0 0 1 7 0" />
    <path d="M2 8.82a15 15 0 0 1 20 0" />
    <line x1="12" y1="20" x2="12.01" y2="20" />
  </DefaultIcon>
)

export const WifiOffIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <path d="M12 20h.01" />
    <path d="M8.5 16.5a5 5 0 0 1 7 0" />
    <path d="M2 8.82a15 15 0 0 1 4.17-2.65" />
    <path d="M10.66 5c4.01-.36 8.14.9 11.34 3.76" />
    <path d="M16.85 11.25a10 10 0 0 1 2.22 1.68" />
    <path d="M5 13a10 10 0 0 1 5.24-2.76" />
    <line x1="2" y1="2" x2="22" y2="22" />
  </DefaultIcon>
)

export const MenuIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <line x1="4" y1="6" x2="20" y2="6" />
    <line x1="4" y1="12" x2="20" y2="12" />
    <line x1="4" y1="18" x2="20" y2="18" />
  </DefaultIcon>
)

export const BellIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </DefaultIcon>
)

export const DownloadIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </DefaultIcon>
)

export const PinIcon = (props: IconProps) => (
  <DefaultIcon {...props}>
    <line x1="12" x2="12" y1="17" y2="22" />
    <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1V2H8v4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
  </DefaultIcon>
)


