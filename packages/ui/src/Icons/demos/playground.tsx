import * as Icons from "@clawbot/ui";
import { StoryBook } from "../../Playground/index.js";

const iconEntries = [
  ["ActivityIcon", Icons.ActivityIcon],
  ["PulseIcon", Icons.PulseIcon],
  ["ArrowRightIcon", Icons.ArrowRightIcon],
  ["BoltIcon", Icons.BoltIcon],
  ["BookIcon", Icons.BookIcon],
  ["ChatIcon", Icons.ChatIcon],
  ["GridIcon", Icons.GridIcon],
  ["HomeIcon", Icons.HomeIcon],
  ["LinkIcon", Icons.LinkIcon],
  ["RssIcon", Icons.RssIcon],
  ["QueueIcon", Icons.QueueIcon],
  ["PuzzleIcon", Icons.PuzzleIcon],
  ["ScanIcon", Icons.ScanIcon],
  ["PencilIcon", Icons.PencilIcon],
  ["CheckIcon", Icons.CheckIcon],
  ["XIcon", Icons.XIcon],
  ["SearchIcon", Icons.SearchIcon],
  ["StackIcon", Icons.StackIcon],
  ["TerminalIcon", Icons.TerminalIcon],
  ["LogOutIcon", Icons.LogOutIcon],
  ["WebhookIcon", Icons.WebhookIcon],
  ["CopyIcon", Icons.CopyIcon],
  ["TrashIcon", Icons.TrashIcon],
  ["RefreshIcon", Icons.RefreshIcon],
  ["PlusIcon", Icons.PlusIcon],
  ["UploadIcon", Icons.UploadIcon],
  ["KeyIcon", Icons.KeyIcon],
  ["LockIcon", Icons.LockIcon],
  ["ClockIcon", Icons.ClockIcon],
  ["ChevronDownIcon", Icons.ChevronDownIcon],
  ["ChevronUpIcon", Icons.ChevronUpIcon],
  ["MoreHorizontalIcon", Icons.MoreHorizontalIcon],
  ["HistoryIcon", Icons.HistoryIcon],
  ["AlertCircleIcon", Icons.AlertCircleIcon],
  ["CheckCircleIcon", Icons.CheckCircleIcon],
  ["PlayIcon", Icons.PlayIcon],
  ["PauseIcon", Icons.PauseIcon],
  ["CalendarIcon", Icons.CalendarIcon],
  ["CpuIcon", Icons.CpuIcon],
  ["LayersIcon", Icons.LayersIcon],
  ["SlidersIcon", Icons.SlidersIcon],
  ["GaugeIcon", Icons.GaugeIcon],
  ["HeartIcon", Icons.HeartIcon],
  ["NetworkIcon", Icons.NetworkIcon],
  ["DiamondIcon", Icons.DiamondIcon],
  ["SettingsIcon", Icons.SettingsIcon],
] as const;

export default function IconsPlayground() {
  return (
    <StoryBook>
      <div className="ui-demo-icons-grid">
        {iconEntries.map(([name, Icon]) => (
          <div key={name} className="ui-demo-icons-item">
            <Icon className="ui-demo-icons-glyph" />
            <span className="ui-demo-icons-name">{name}</span>
          </div>
        ))}
      </div>
    </StoryBook>
  );
}
