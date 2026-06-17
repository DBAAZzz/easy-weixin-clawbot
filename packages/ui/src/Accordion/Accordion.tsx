import { Collapsible } from "@base-ui/react/collapsible";
import { type ReactNode } from "react";
import { ChevronDownIcon } from "../Icons/index.js";
import { cn } from "../utils/cn.js";

export function Accordion(props: {
  title: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <Collapsible.Root
      defaultOpen={props.defaultOpen ?? false}
      className={cn("cb-accordion", props.className)}
    >
      <Collapsible.Trigger className="cb-accordion-trigger">
        <span className="cb-accordion-title">{props.title}</span>
        <span className="cb-accordion-meta">
          {props.meta}
          <ChevronDownIcon className="cb-accordion-chevron" />
        </span>
      </Collapsible.Trigger>

      <Collapsible.Panel className={cn("cb-accordion-panel", props.contentClassName)}>
        {props.children}
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
