export function parseScopeSelection(
  scope: "global" | "account" | "conversation",
  scopeKey: string,
): { accountId: string; conversationId: string } {
  if (scope === "account") {
    return {
      accountId: scopeKey === "*" ? "" : scopeKey,
      conversationId: "",
    };
  }

  if (scope === "conversation") {
    if (!scopeKey || scopeKey === "*") {
      return { accountId: "", conversationId: "" };
    }

    const separatorIndex = scopeKey.indexOf(":");
    if (separatorIndex < 0) {
      return { accountId: scopeKey, conversationId: "" };
    }

    return {
      accountId: scopeKey.slice(0, separatorIndex),
      conversationId: scopeKey.slice(separatorIndex + 1),
    };
  }

  return { accountId: "", conversationId: "" };
}

export function buildScopeKey(
  scope: "global" | "account" | "conversation",
  accountId: string,
  conversationId: string,
): string {
  if (scope === "global") {
    return "*";
  }

  const normalizedAccountId = accountId.trim();
  if (scope === "account") {
    return normalizedAccountId;
  }

  const normalizedConversationId = conversationId.trim();
  if (!normalizedAccountId || !normalizedConversationId) {
    return "";
  }

  return `${normalizedAccountId}:${normalizedConversationId}`;
}
