/* eslint-disable react-refresh/only-export-components -- Icon re-exports barrel file */
// Icon components - powered by lucide-react
// Re-exports with project defaults (size=16, aria-hidden)
import type { SVGProps, ComponentType } from 'react'
import type { LucideProps } from 'lucide-react'
import {
  ChevronDown,
  ChevronUp,
  ChevronRight,
  SquarePen,
  Hand,
  Keyboard,
  Check,
  Send,
  Plus,
  GraduationCap,
  Settings,
  Sun,
  Moon,
  Monitor,
  PanelLeft,
  PanelRight,
  PanelBottom,
  Image,
  Copy,
  Brain,
  ExternalLink,
  X,
  Sparkles,
  Undo2,
  Redo2,
  Terminal,
  File,
  Folder,
  FolderOpen,
  Search,
  Pencil,
  Trash2,
  CornerDownLeft,
  Eye,
  Maximize,
  Minimize,
  Share,
  Link,
  Globe,
  MessageSquare,
  ArrowUp,
  ArrowDown,
  Clock,
  Circle,
  CircleAlert,
  RefreshCcw,
  Cpu,
  DollarSign,
  Lightbulb,
  Users,
  GitCommitHorizontal,
  GitBranch,
  Split,
  Plug,
  KeyRound,
  Wifi,
  WifiOff,
  Bell,
  Download,
  Pin,
  Square,
  LoaderCircle,
  CircleHelp,
  Slash,
  FileDiff,
  Waypoints,
  GitCompare,
  ListTodo,
  Layers,
  Minus,
  Paperclip,
  FastForward,
  Volume2,
  VolumeX,
  Play,
  Upload,
  Shield,
  Columns2,
  Rows2,
  GripVertical,
} from 'lucide-react'

export interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number | string
}

// ============================================
// Wrapper: apply project defaults (size=16, aria-hidden)
// ============================================

function wrap(Icon: ComponentType<LucideProps>) {
  const Wrapped = ({ size = 16, ...props }: IconProps) => (
    <Icon size={size} aria-hidden="true" {...(props as LucideProps)} />
  )
  return Wrapped
}

// ============================================
// Lucide-backed icons
// ============================================

export const ChevronDownIcon = wrap(ChevronDown)
export const ChevronUpIcon = wrap(ChevronUp)
export const ChevronRightIcon = wrap(ChevronRight)
export const NewChatIcon = wrap(SquarePen)
export const HandIcon = wrap(Hand)
export const KeyboardIcon = wrap(Keyboard)
export const CheckIcon = wrap(Check)
export const SendIcon = wrap(Send)
export const PlusIcon = wrap(Plus)
export const TeachIcon = wrap(GraduationCap)
export const SettingsIcon = wrap(Settings)
export const SunIcon = wrap(Sun)
export const MoonIcon = wrap(Moon)
export const SystemIcon = wrap(Monitor)
export const SidebarIcon = wrap(PanelLeft)
export const PanelRightIcon = wrap(PanelRight)
export const PanelBottomIcon = wrap(PanelBottom)
export const ImageIcon = wrap(Image)
export const CopyIcon = wrap(Copy)
export const AgentIcon = wrap(Brain)
export const ExpandIcon = wrap(ExternalLink)
export const CloseIcon = wrap(X)
export const ThinkingIcon = wrap(Sparkles)
export const UndoIcon = wrap(Undo2)
export const RedoIcon = wrap(Redo2)
export const TerminalIcon = wrap(Terminal)
export const FileIcon = wrap(File)
export const FolderIcon = wrap(Folder)
export const FolderOpenIcon = wrap(FolderOpen)
export const SearchIcon = wrap(Search)
export const PencilIcon = wrap(Pencil)
export const TrashIcon = wrap(Trash2)
export const ReturnIcon = wrap(CornerDownLeft)
export const EyeIcon = wrap(Eye)
export const MaximizeIcon = wrap(Maximize)
export const MinimizeIcon = wrap(Minimize)
export const ShareIcon = wrap(Share)
export const LinkIcon = wrap(Link)
export const ExternalLinkIcon = wrap(ExternalLink)
export const GlobeIcon = wrap(Globe)
export const MessageSquareIcon = wrap(MessageSquare)
export const ArrowUpIcon = wrap(ArrowUp)
export const ArrowDownIcon = wrap(ArrowDown)
export const ClockIcon = wrap(Clock)
export const CircleIcon = wrap(Circle)
export const AlertCircleIcon = wrap(CircleAlert)
export const RetryIcon = wrap(RefreshCcw)
export const CpuIcon = wrap(Cpu)
export const DollarSignIcon = wrap(DollarSign)
export const LightbulbIcon = wrap(Lightbulb)
export const UsersIcon = wrap(Users)
export const GitCommitIcon = wrap(GitCommitHorizontal)
export const GitBranchIcon = wrap(GitBranch)
export const SplitIcon = wrap(Split)
export const PlugIcon = wrap(Plug)
export const KeyIcon = wrap(KeyRound)
export const WifiIcon = wrap(Wifi)
export const WifiOffIcon = wrap(WifiOff)
export const BellIcon = wrap(Bell)
export const DownloadIcon = wrap(Download)
export const PinIcon = wrap(Pin)

// Aliases
export const ComposeIcon = wrap(SquarePen)
export const CogIcon = wrap(Settings)

// ============================================
// Icons with custom defaults (lucide-backed)
// ============================================

export const StopIcon = ({ size = 16, ...props }: IconProps) => (
  <Square size={size} fill="currentColor" strokeWidth={0} aria-hidden="true" {...(props as LucideProps)} />
)

export const SpinnerIcon = wrap(LoaderCircle)
export const QuestionIcon = wrap(CircleHelp)
export const PathAutoIcon = wrap(Sun)
export const PathUnixIcon = wrap(Slash)

export const PathWindowsIcon = ({ size = 16, style, ...props }: IconProps) => (
  <Slash size={size} aria-hidden="true" style={{ transform: 'scaleX(-1)', ...style }} {...(props as LucideProps)} />
)

export const PatchIcon = wrap(FileDiff)
export const GitWorktreeIcon = wrap(Waypoints)
export const GitDiffIcon = wrap(GitCompare)
export const PermissionListIcon = wrap(ListTodo)
export const LayersIcon = wrap(Layers)
export const MinusIcon = wrap(Minus)
export const PaperclipIcon = wrap(Paperclip)
export const FastForwardIcon = wrap(FastForward)
export const VolumeIcon = wrap(Volume2)
export const VolumeOffIcon = wrap(VolumeX)
export const PlayIcon = wrap(Play)
export const UploadIcon = wrap(Upload)
export const ShieldIcon = wrap(Shield)
export const SplitHorizontalIcon = wrap(Columns2)
export const SplitVerticalIcon = wrap(Rows2)
export const GripVerticalIcon = wrap(GripVertical)
