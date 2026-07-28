export {
  startHeartbeat,
  stopHeartbeat,
  runHeartbeatTick,
  notePulseActivity,
} from "./engine.js";

export { parsePulseVerdict, applyPulseGuards } from "./evaluator.js";

export type { PulseRow, PulseUpdate, PulseVerdict, PulseDecision } from "./types.js";
export {
  PULSE_MIN_MINUTES,
  PULSE_MAX_MINUTES,
  PULSE_MAX_PER_DAY,
  PULSE_MIN_GAP_MINUTES,
  PULSE_TICK_BATCH_SIZE,
} from "./types.js";
