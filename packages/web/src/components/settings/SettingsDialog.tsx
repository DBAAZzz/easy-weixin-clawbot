import { useEffect, useState } from "react";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "../ui/dialog.js";
import { LinkIcon, SearchIcon, SlidersIcon } from "../ui/icons.js";
import { cn } from "../../lib/cn.js";
import { GeneralSettingsPanel } from "./GeneralSettingsPanel.js";
import { NetworkSearchSettingsPanel } from "./NetworkSearchSettingsPanel.js";
import { RssSettingsPanel } from "./RssSettingsPanel.js";

type SettingsSectionId = "general" | "rss" | "network-search";

const SETTINGS_SECTIONS: Array<{
  id: SettingsSectionId;
  label: string;
  icon: typeof SlidersIcon;
}> = [
  {
    id: "general",
    label: "通用",
    icon: SlidersIcon,
  },
  {
    id: "rss",
    label: "RSS",
    icon: LinkIcon,
  },
  {
    id: "network-search",
    label: "网络搜索",
    icon: SearchIcon,
  },
];

function menuItemClassName(active: boolean) {
  return cn(
    "group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-md transition duration-200 ease-expo",
    active
      ? "bg-accent-active font-semibold text-ink shadow-accent-xs"
      : "text-muted-strong hover:bg-white/72 hover:text-ink",
  );
}

export function SettingsDialog(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("general");

  useEffect(() => {
    if (!props.open) {
      return;
    }

    setActiveSection("general");
  }, [props.open]);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogContent className="h-160 max-w-4xl rounded-dialog md:h-180">
          <DialogHeader className="flex flex-row items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <DialogTitle className="text-4xl md:text-5xl">设置</DialogTitle>
            </div>
            <DialogClose className="mt-0.5" />
          </DialogHeader>

          <DialogBody className="overflow-hidden p-0 md:p-0">
            <div className="flex h-full min-h-0 flex-col md:flex-row">
              <aside className="shrink-0 border-b border-line bg-pane-74 md:w-56 md:border-b-0 md:border-r">
                <nav className="flex flex-col gap-1 p-2">
                  {SETTINGS_SECTIONS.map((section) => {
                    const Icon = section.icon;
                    const active = activeSection === section.id;

                    return (
                      <button
                        key={section.id}
                        type="button"
                        onClick={() => setActiveSection(section.id)}
                        className={menuItemClassName(active)}
                      >
                        <span
                          className={cn(
                            "text-muted-strong transition group-hover:text-ink",
                            active && "text-ink",
                          )}
                        >
                          <Icon className="size-4" />
                        </span>
                        <span className="text-md font-medium">{section.label}</span>
                      </button>
                    );
                  })}
                </nav>
              </aside>

              <div className="min-h-0 min-w-0 flex-1">
                <GeneralSettingsPanel active={activeSection === "general"} />
                <RssSettingsPanel active={activeSection === "rss"} />
                <NetworkSearchSettingsPanel active={activeSection === "network-search"} />
              </div>
            </div>
          </DialogBody>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
