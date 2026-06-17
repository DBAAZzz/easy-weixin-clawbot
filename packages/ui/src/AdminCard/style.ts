export type CardActionTone = "neutral" | "primary" | "success" | "warning" | "danger";

export const cardActionToneClassName: Record<CardActionTone, string> = {
  danger: "cb-card-action-tone--danger",
  neutral: "cb-card-action-tone--neutral",
  primary: "cb-card-action-tone--primary",
  success: "cb-card-action-tone--success",
  warning: "cb-card-action-tone--warning",
};

export const cardActionButtonClassName = "cb-card-action-button";

export const cardActionGroupClassName = "cb-card-action-group";

export const cardMenuItemClassName = "cb-card-menu-item";

export const cardIconContainerClassName = "cb-icon-container";
