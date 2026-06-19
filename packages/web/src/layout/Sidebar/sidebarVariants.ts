import type { ComponentType } from "react";
import { matchPath } from "react-router-dom";
import { protectedRoutes, type SidebarVariant } from "@/router/routes.js";
import { DefaultSidebarNav } from "./DefaultSidebarNav.js";
import { SettingsSidebarNav } from "./SettingsSidebarNav.js";

/** Props every sidebar nav variant receives. Keep variants static and prop-light. */
export interface SidebarNavProps {
  collapsed: boolean;
}

/**
 * Maps a route's `sidebar` variant to the menu it renders.
 *
 * To add a section with its own menu:
 *   1. Add the key to `SidebarVariant` in `router/routes.ts`.
 *   2. Write `XxxSidebarNav.tsx` (takes `SidebarNavProps`, static content).
 *   3. Register it here, and set `sidebar: "xxx"` on the route(s) in `routes.ts`.
 */
const SIDEBAR_NAV_VARIANTS: Record<
  SidebarVariant,
  ComponentType<SidebarNavProps>
> = {
  default: DefaultSidebarNav,
  settings: SettingsSidebarNav,
};

/** Resolve the nav component for the current pathname (route paths are exact, so one matches). */
export function resolveSidebarNav(
  pathname: string,
): ComponentType<SidebarNavProps> {
  const matched = protectedRoutes.find((route) =>
    matchPath(route.path, pathname),
  );
  return SIDEBAR_NAV_VARIANTS[matched?.sidebar ?? "default"];
}
