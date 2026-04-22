import assert from "node:assert/strict";
import test from "node:test";
import {
  AppSettingsValidationError,
  createAppSettingsService,
} from "./service.js";
import type {
  AppSettingsRow,
  AppSettingsStore,
} from "../db/app-settings-store.js";
import type { SamplingSettingsConsumer } from "../observability/service.js";

function createRow(overrides: Partial<AppSettingsRow> = {}): AppSettingsRow {
  return {
    id: 1,
    normalRate: 0.1,
    createdAt: new Date("2026-04-22T00:00:00.000Z"),
    updatedAt: new Date("2026-04-22T00:00:00.000Z"),
    ...overrides,
  };
}

function createStore(initialRow: AppSettingsRow = createRow()): AppSettingsStore {
  let row = initialRow;

  return {
    async get() {
      return row;
    },

    async update(input) {
      row = createRow({
        ...row,
        normalRate: input.normalRate ?? row.normalRate,
        updatedAt: new Date("2026-04-23T00:00:00.000Z"),
      });
      return row;
    },
  };
}

function createSamplingConsumer(): SamplingSettingsConsumer & {
  currentNormalRate: number;
} {
  return {
    currentNormalRate: 0.1,
    setSamplingNormalRate(normalRate) {
      this.currentNormalRate = normalRate;
    },
  };
}

test("bootstrap loads database normalRate into observability runtime", async () => {
  const samplingConsumer = createSamplingConsumer();
  const service = createAppSettingsService(
    createStore(createRow({ normalRate: 0.35 })),
    samplingConsumer,
  );

  await service.bootstrap();

  assert.equal(samplingConsumer.currentNormalRate, 0.35);
});

test("update validates payload and syncs latest sampling rate", async () => {
  const samplingConsumer = createSamplingConsumer();
  const service = createAppSettingsService(createStore(), samplingConsumer);

  const row = await service.update({ normal_rate: 0.42 });

  assert.equal(row.normalRate, 0.42);
  assert.equal(samplingConsumer.currentNormalRate, 0.42);
});

test("update rejects missing or unsupported fields", async () => {
  const service = createAppSettingsService(createStore(), createSamplingConsumer());

  await assert.rejects(
    service.update({}),
    (error: unknown) =>
      error instanceof AppSettingsValidationError &&
      error.message === "at least one supported field is required",
  );

  await assert.rejects(
    service.update({ proxy_url: "http://localhost:7890" }),
    (error: unknown) =>
      error instanceof AppSettingsValidationError &&
      error.message === "unknown field: proxy_url",
  );
});

test("update rejects out-of-range and non-numeric normal_rate", async () => {
  const service = createAppSettingsService(createStore(), createSamplingConsumer());

  await assert.rejects(
    service.update({ normal_rate: 1.2 }),
    (error: unknown) =>
      error instanceof AppSettingsValidationError &&
      error.message === "normal_rate must be between 0 and 1",
  );

  await assert.rejects(
    service.update({ normal_rate: "0.2" }),
    (error: unknown) =>
      error instanceof AppSettingsValidationError &&
      error.message === "normal_rate must be a finite number",
  );
});
