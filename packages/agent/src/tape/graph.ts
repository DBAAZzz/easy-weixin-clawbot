import { getTapeStore } from "../ports/tape-store.js";
import { recall } from "./service.js";
import type { TapeEntryRow } from "../ports/tape-store.js";
import type { TapeState } from "./types.js";

type GraphCategory = "fact" | "preference" | "decision";
type GraphScope = "global" | "session";

export interface TapeGraphNode {
  id: string;
  key: string;
  label: string;
  category: GraphCategory;
  value: unknown;
  confidence?: number;
  scope: GraphScope;
  branch: string;
  sourceEid: string;
  updatedAt: string;
}

export interface TapeGraphEdge {
  source: string;
  target: string;
  type: "co_occurrence" | "prefix_cluster";
  weight: number;
}

export interface TapeGraphGroup {
  id: string;
  label: string;
  type: "group";
  branch: string;
  children: string[];
}

export interface TapeGraphResponse {
  nodes: TapeGraphNode[];
  edges: TapeGraphEdge[];
  groups: TapeGraphGroup[];
  meta: {
    accountId: string;
    branch: string;
    totalEntries: number;
    generatedAt: string;
  };
}

interface BranchStateInput {
  branch: string;
  state: TapeState;
}

interface BuildTapeGraphSnapshotInput {
  accountId: string;
  requestedBranch: string;
  generatedAt?: Date;
  branchStates: BranchStateInput[];
  entries: TapeEntryRow[];
}

const CO_OCCURRENCE_WINDOW_MS = 2_000;

function toScope(branch: string): GraphScope {
  return branch === "__global__" ? "global" : "session";
}

function createMemoryNodeId(branch: string, category: GraphCategory, key: string) {
  return `${branch}::${category}::${key}`;
}

function createNodeLookupKey(branch: string, category: GraphCategory, key: string) {
  return `${branch}::${category}::${key}`;
}

function createEdgeKey(source: string, target: string, type: TapeGraphEdge["type"]) {
  const [left, right] = [source, target].sort();
  return `${type}::${left}::${right}`;
}

function normalizePayload(
  payload: unknown,
): { fragments?: Array<{ kind?: string; data?: Record<string, unknown> }> } {
  return typeof payload === "object" && payload !== null ? (payload as any) : {};
}

function collectEntryNodeLookups(entry: TapeEntryRow): string[] {
  if (entry.category === "decision") {
    return [entry.eid];
  }

  if (entry.category !== "fact" && entry.category !== "preference") {
    return [];
  }

  const payload = normalizePayload(entry.payload);
  const category = entry.category as "fact" | "preference";
  const lookups = new Set<string>();

  for (const fragment of payload.fragments ?? []) {
    const key = typeof fragment?.data?.key === "string" ? fragment.data.key : "";
    if (!key) continue;
    lookups.add(createNodeLookupKey(entry.branch, category, key));
  }

  return [...lookups];
}

function accumulatePairWeights(
  edgeWeights: Map<string, TapeGraphEdge>,
  nodeIds: string[],
  type: TapeGraphEdge["type"],
  weight = 1,
) {
  const uniqueIds = [...new Set(nodeIds)];
  for (let leftIndex = 0; leftIndex < uniqueIds.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < uniqueIds.length; rightIndex += 1) {
      const source = uniqueIds[leftIndex];
      const target = uniqueIds[rightIndex];
      const key = createEdgeKey(source, target, type);
      const existing = edgeWeights.get(key);

      edgeWeights.set(key, {
        source,
        target,
        type,
        weight: (existing?.weight ?? 0) + weight,
      });
    }
  }
}

function buildNodes(branchStates: BranchStateInput[]) {
  const nodes: TapeGraphNode[] = [];
  const nodeLookup = new Map<string, string>();

  for (const { branch, state } of branchStates) {
    const scope = toScope(branch);

    for (const fact of state.facts.values()) {
      const id = createMemoryNodeId(branch, "fact", fact.key);
      nodes.push({
        id,
        key: fact.key,
        label: fact.key,
        category: "fact",
        value: fact.value,
        confidence: fact.confidence,
        scope,
        branch,
        sourceEid: fact.sourceEid,
        updatedAt: fact.updatedAt,
      });
      nodeLookup.set(createNodeLookupKey(branch, "fact", fact.key), id);
    }

    for (const preference of state.preferences.values()) {
      const id = createMemoryNodeId(branch, "preference", preference.key);
      nodes.push({
        id,
        key: preference.key,
        label: preference.key,
        category: "preference",
        value: preference.value,
        scope,
        branch,
        sourceEid: preference.sourceEid,
        updatedAt: preference.updatedAt,
      });
      nodeLookup.set(createNodeLookupKey(branch, "preference", preference.key), id);
    }

    for (const decision of state.decisions) {
      nodeLookup.set(decision.sourceEid, decision.sourceEid);
      nodes.push({
        id: decision.sourceEid,
        key: decision.sourceEid,
        label: decision.context || decision.description || "决策",
        category: "decision",
        value: decision.description,
        scope,
        branch,
        sourceEid: decision.sourceEid,
        updatedAt: decision.createdAt,
      });
    }
  }

  nodes.sort((left, right) => left.branch.localeCompare(right.branch) || left.label.localeCompare(right.label));

  return { nodes, nodeLookup };
}

function buildCoOccurrenceEdges(entries: TapeEntryRow[], nodeLookup: Map<string, string>) {
  const edgeWeights = new Map<string, TapeGraphEdge>();
  const sorted = [...entries]
    .filter((entry) => entry.category === "fact" || entry.category === "preference" || entry.category === "decision")
    .sort(
      (left, right) =>
        left.branch.localeCompare(right.branch) ||
        left.createdAt.getTime() - right.createdAt.getTime() ||
        left.eid.localeCompare(right.eid),
    );

  let batchBranch: string | null = null;
  let batchStart = 0;
  let batchNodeIds: string[] = [];

  function flushBatch() {
    if (batchNodeIds.length > 1) {
      accumulatePairWeights(edgeWeights, batchNodeIds, "co_occurrence");
    }
    batchNodeIds = [];
  }

  for (const entry of sorted) {
    const createdAt = entry.createdAt.getTime();
    const shouldStartNewBatch =
      batchBranch === null ||
      batchBranch !== entry.branch ||
      createdAt - batchStart > CO_OCCURRENCE_WINDOW_MS;

    if (shouldStartNewBatch) {
      flushBatch();
      batchBranch = entry.branch;
      batchStart = createdAt;
    }

    const nodeIds = collectEntryNodeLookups(entry)
      .map((lookupKey) => nodeLookup.get(lookupKey))
      .filter((nodeId): nodeId is string => Boolean(nodeId));

    batchNodeIds.push(...nodeIds);
  }

  flushBatch();

  return edgeWeights;
}

function buildPrefixGroups(nodes: TapeGraphNode[]) {
  const groups = new Map<string, { label: string; branch: string; children: Set<string> }>();

  for (const node of nodes) {
    if (node.category === "decision") continue;
    const [prefix] = node.key.split(/[./]/);
    if (!prefix || prefix === node.key) continue;

    const groupId = `group::${node.branch}::${prefix}`;
    const existing = groups.get(groupId) ?? {
      label: prefix,
      branch: node.branch,
      children: new Set<string>(),
    };
    existing.children.add(node.id);
    groups.set(groupId, existing);
  }

  return [...groups.entries()]
    .filter(([, group]) => group.children.size > 1)
    .map(([id, group]) => ({
      id,
      label: group.label,
      type: "group" as const,
      branch: group.branch,
      children: [...group.children].sort(),
    }))
    .sort((left, right) => left.branch.localeCompare(right.branch) || left.label.localeCompare(right.label));
}

export function buildTapeGraphSnapshot(input: BuildTapeGraphSnapshotInput): TapeGraphResponse {
  const generatedAt = (input.generatedAt ?? new Date()).toISOString();
  const { nodes, nodeLookup } = buildNodes(input.branchStates);
  const coOccurrenceEdges = buildCoOccurrenceEdges(input.entries, nodeLookup);
  const groups = buildPrefixGroups(nodes);

  for (const group of groups) {
    accumulatePairWeights(coOccurrenceEdges, group.children, "prefix_cluster");
  }

  const edges = [...coOccurrenceEdges.values()].sort(
    (left, right) =>
      left.type.localeCompare(right.type) ||
      left.source.localeCompare(right.source) ||
      left.target.localeCompare(right.target),
  );

  return {
    nodes,
    edges,
    groups,
    meta: {
      accountId: input.accountId,
      branch: input.requestedBranch,
      totalEntries: input.entries.length,
      generatedAt,
    },
  };
}

export async function generateTapeGraph(
  accountId: string,
  requestedBranch = "__global__",
): Promise<TapeGraphResponse> {
  const store = getTapeStore();
  const branch = requestedBranch || "__global__";
  const branches =
    branch === "*"
      ? await store.listBranches(accountId)
      : [branch];

  const [branchStates, entries] = await Promise.all([
    Promise.all(
      branches.map(async (branchName) => ({
        branch: branchName,
        state: await recall(accountId, branchName),
      })),
    ),
    store.findAllEntries(accountId, branch),
  ]);

  return buildTapeGraphSnapshot({
    accountId,
    requestedBranch: branch,
    branchStates,
    entries,
  });
}
