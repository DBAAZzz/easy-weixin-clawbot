import type { DialogTone } from "./type.js";

// Header / Body / Footer 共享的区块内边距。
export const sectionPadding = "cb-dialog-section-padding";

export const splitSectionPadding = "cb-dialog-split-section-padding";
export const splitSidebarPadding = "cb-dialog-split-sidebar-padding";
export const splitFooterPadding = "cb-dialog-footer-padding";

// tone -> 图标徽章底色与前景
export const toneIcon: Record<DialogTone, string> = {
  accent: "cb-tone-icon--accent",
  success: "cb-tone-icon--success",
  danger: "cb-tone-icon--danger",
  neutral: "cb-tone-icon--neutral",
};
