import type {
  AppendMemoryEventInput,
  AppendResult,
  MemoryEvent,
} from "../shared/fact-ledger/contracts.js";
import { createPortSlot } from "./slot.js";

export interface ListMemoryEventsInput {
  accountId: string;
  branch: string;
  afterSeq?: number;
  throughSeq?: number;
  limit: number;
}

/** memoryAssertionSchema 的类别联合（fact-writer 按 key 查 live 断言时使用）。 */
export type MemoryAssertionCategory = "fact" | "preference" | "decision";

export interface MemoryEventStore {
  append(input: AppendMemoryEventInput): Promise<AppendResult<MemoryEvent>>;
  getById(eventId: string): Promise<MemoryEvent | null>;
  listBranch(input: ListMemoryEventsInput): Promise<MemoryEvent[]>;
  /** 当前 branch 已落库的最后 memorySeq（空 branch → 0）——manifest watermark 读取用。 */
  headSeq(accountId: string, branch: string): Promise<number>;
  /**
   * 返回该 key 当前 live 的断言事件（未被后续事件替换的最新 memory_asserted）。
   * Phase 5 实现可落为按 memorySeq 倒序的最新 asserted；未来引入
   * memory_retracted / memory_corrected_by_user 时更新实现，调用方不变。
   */
  findLiveAssertionByKey(
    accountId: string,
    branch: string,
    category: MemoryAssertionCategory,
    key: string,
  ): Promise<MemoryEvent | null>;
}

export const { set: setMemoryEventStore, get: getMemoryEventStore } =
  createPortSlot<MemoryEventStore>("MemoryEventStore", "setMemoryEventStore");
