import { useDeferredValue, useEffect, useState, type ChangeEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  SkillInfo,
  SkillLocalRunCheck,
  SkillProvisionLog,
  SkillProvisionPlan,
} from "@clawbot/shared";
import { toast } from "@clawbot/ui";
import { useSkills } from "../../hooks/useSkills.js";
import { fetchSkillSource, type ProvisionMode } from "@/api/skills.js";
import { formatCount } from "../../lib/format.js";
import { queryKeys } from "../../lib/query-keys.js";
import { isAutoProvisionableRuntime } from "./skills-runtime-labels.js";
import {
  formatActivationLabel,
  formatOriginLabel,
  type SkillActivationFilter,
  type SkillDetailTab,
} from "./types.js";

export function notifySkillInstallSuccess(skillName: string, notify: (message: string) => void) {
  notify(`技能 "${skillName}" 安装成功`);
}

export function useSkillsPage() {
  const {
    skills,
    loading,
    error,
    refresh,
    enable,
    disable,
    uploadFile,
    preflight,
    streamProvision,
  } = useSkills();
  const [query, setQuery] = useState("");
  const [activationFilter, setActivationFilter] = useState<SkillActivationFilter>("all");
  const [onlyEnabled, setOnlyEnabled] = useState(false);
  const [activeSkillName, setActiveSkillName] = useState<string | null>(null);
  const [activeDetailTab, setActiveDetailTab] = useState<SkillDetailTab>("markdown");
  const [notice, setNotice] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [pendingToggleName, setPendingToggleName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadCheck, setUploadCheck] = useState<SkillLocalRunCheck | null>(null);
  const [preflightBusy, setPreflightBusy] = useState(false);
  const [provisionBusy, setProvisionBusy] = useState(false);
  const [preflightPlan, setPreflightPlan] = useState<SkillProvisionPlan | null>(null);
  const [preflightError, setPreflightError] = useState<string | null>(null);
  const [provisionLogs, setProvisionLogs] = useState<SkillProvisionLog[]>([]);
  const deferredQuery = useDeferredValue(query);
  const normalizedQuery = deferredQuery.trim().toLowerCase();
  const filteredSkills = skills.filter((skill) => {
    if (onlyEnabled && !skill.enabled) return false;
    if (activationFilter !== "all" && skill.activation !== activationFilter) return false;
    if (!normalizedQuery) return true;

    return [
      skill.name,
      skill.summary,
      formatActivationLabel(skill.activation),
      formatOriginLabel(skill.origin),
      skill.author ?? "",
    ].some((value) => value.toLowerCase().includes(normalizedQuery));
  });
  const activeSkill = skills.find((skill) => skill.name === activeSkillName) ?? null;
  const sourceQuery = useQuery({
    queryKey: queryKeys.skillSource(activeSkillName ?? ""),
    queryFn: () => fetchSkillSource(activeSkillName!),
    enabled: Boolean(activeSkillName),
  });
  const source = {
    data: sourceQuery.data ?? null,
    loading: Boolean(activeSkillName) && sourceQuery.isPending,
    error:
      sourceQuery.error instanceof Error
        ? sourceQuery.error.message
        : sourceQuery.error
          ? String(sourceQuery.error)
          : null,
  };

  useEffect(() => {
    if (!activeSkillName) return;

    if (!skills.some((skill) => skill.name === activeSkillName)) {
      setActiveSkillName(null);
    }
  }, [activeSkillName, skills]);

  useEffect(() => {
    if (!activeSkillName) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setActiveSkillName(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeSkillName]);

  useEffect(() => {
    setPreflightBusy(false);
    setPreflightPlan(null);
    setPreflightError(null);
    setProvisionLogs([]);
  }, [activeSkillName]);

  useEffect(() => {
    if (!activeSkillName) return;
    setActiveDetailTab("markdown");
  }, [activeSkillName]);

  useEffect(() => {
    if (activeDetailTab !== "runtime" || !activeSkill) {
      return;
    }

    if (!isAutoProvisionableRuntime(activeSkill.runtimeKind)) {
      return;
    }

    if (preflightBusy || preflightPlan || preflightError) {
      return;
    }

    void handlePreflight(activeSkill);
  }, [activeDetailTab, activeSkill, preflightBusy, preflightPlan, preflightError]);

  const enabledCount = skills.filter((skill) => skill.enabled).length;
  const alwaysOnCount = skills.filter((skill) => skill.activation === "always").length;
  const onDemandCount = skills.length - alwaysOnCount;
  const tabCounts: Record<SkillActivationFilter, number> = {
    all: skills.length,
    always: alwaysOnCount,
    "on-demand": onDemandCount,
  };
  const stats = [
    {
      label: "技能总数",
      value: formatCount(skills.length),
      meta: "已安装",
      dotClassName: "bg-account-ink",
      valueClassName: "text-account-ink",
    },
    {
      label: "已启用",
      value: formatCount(enabledCount),
      meta: "运行中",
      dotClassName: "bg-account-success-dot",
      valueClassName: "text-account-success-fg",
    },
    {
      label: "常驻 Always-On",
      value: formatCount(alwaysOnCount),
      meta: "持续监听",
      dotClassName: "bg-danger",
      valueClassName: "text-danger-strong",
    },
    {
      label: "按需 On-Demand",
      value: formatCount(onDemandCount),
      meta: "触发调用",
      dotClassName: "bg-account-warning-dot",
      valueClassName: "text-account-warning-fg",
    },
  ];

  async function handleRefresh() {
    setNotice(null);
    setMutationError(null);
    setUploadCheck(null);
    refresh();
  }

  async function handleFileUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = "";

    setNotice(null);
    setMutationError(null);
    setUploadCheck(null);
    setUploading(true);

    try {
      const result = await uploadFile(file);
      notifySkillInstallSuccess(result.name, toast.success);
      setUploadCheck(result.localRunCheck ?? null);
    } catch (reason) {
      setMutationError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setUploading(false);
    }
  }

  async function handlePreflight(skill: SkillInfo) {
    setPreflightBusy(true);
    setPreflightError(null);
    // 保留旧列表不清空：重新检测期间列表原地降透明度，弹窗高度不抖动；
    // 骨架仅在从未有过 plan（首次加载）时出现。
    try {
      const plan = await preflight(skill.name);
      setPreflightPlan(plan);
    } catch (reason) {
      setPreflightError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPreflightBusy(false);
    }
  }

  /** 首装与重装共用同一条流式链路，安装过程实时可见。 */
  async function runProvision(skill: SkillInfo, mode: ProvisionMode) {
    setProvisionBusy(true);
    setPreflightError(null);
    setProvisionLogs([]);
    setMutationError(null);

    let failed = false;
    try {
      await streamProvision(skill.name, mode, {
        onLog: (log) => setProvisionLogs((prev) => [...prev, log]),
        onError: (payload) => {
          failed = true;
          setMutationError(payload.error);
        },
      });
      await handleRefresh();
      if (!failed) {
        setNotice(
          mode === "reprovision"
            ? `技能 "${skill.name}" 已完成重装`
            : `技能 "${skill.name}" 运行时安装完成`,
        );
        // 环境已变，重新检测让列表状态跟上
        void handlePreflight(skill);
      }
    } catch (reason) {
      setMutationError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setProvisionBusy(false);
    }
  }

  function handleProvision(skill: SkillInfo) {
    return runProvision(skill, "provision");
  }

  function handleReprovision(skill: SkillInfo) {
    return runProvision(skill, "reprovision");
  }

  async function handleToggle(skill: SkillInfo) {
    setNotice(null);
    setMutationError(null);
    setPendingToggleName(skill.name);

    try {
      const result = skill.enabled ? await disable(skill.name) : await enable(skill.name);
      setNotice(`${result.name} 已${result.enabled ? "启用" : "停用"}`);
    } catch (reason) {
      setMutationError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPendingToggleName(null);
    }
  }

  return {
    skills,
    loading,
    error,
    refresh,
    query,
    setQuery,
    activationFilter,
    setActivationFilter,
    onlyEnabled,
    setOnlyEnabled,
    activeSkillName,
    setActiveSkillName,
    activeDetailTab,
    setActiveDetailTab,
    notice,
    mutationError,
    pendingToggleName,
    uploading,
    uploadCheck,
    preflightBusy,
    provisionBusy,
    preflightPlan,
    preflightError,
    provisionLogs,
    filteredSkills,
    activeSkill,
    source,
    enabledCount,
    alwaysOnCount,
    onDemandCount,
    tabCounts,
    stats,
    handleRefresh,
    handleFileUpload,
    handleToggle,
    handlePreflight,
    handleProvision,
    handleReprovision,
  };
}
