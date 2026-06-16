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

// tone -> 状态徽标的边框、底色与前景
export const toneBadge: Record<DialogTone, string> = {
  accent: "cb-tone-badge--accent",
  success: "cb-tone-badge--success",
  danger: "cb-tone-badge--danger",
  neutral: "cb-tone-badge--neutral",
};

// tone -> 状态徽标圆点底色
export const toneDot: Record<DialogTone, string> = {
  accent: "cb-tone-dot--accent",
  success: "cb-tone-dot--success",
  danger: "cb-tone-dot--danger",
  neutral: "cb-tone-dot--neutral",
};
