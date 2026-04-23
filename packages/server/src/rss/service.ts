import {
  cleanupExpiredEntries,
  collectDueSources,
  createSource,
  deleteSource,
  listSources,
  previewSource,
  testSettingsConnection,
  testSource,
  updateSource,
} from "./source-service.js";
import {
  createRssScheduledTaskHandler,
  createTask,
  deleteTask,
  executeRssTask,
  getTaskRuntime,
  listTasks,
  previewTask,
  updateTask,
} from "./task-service.js";

const rssService = {
  listSources,
  createSource,
  updateSource,
  deleteSource,
  previewSource,
  testSource,
  listTasks,
  createTask,
  updateTask,
  deleteTask,
  previewTask,
  testSettingsConnection,
  collectDueSources,
  cleanupExpiredEntries,
  getTaskRuntime,
};

export { rssService, createRssScheduledTaskHandler, executeRssTask };
export { RssNotFoundError, RssValidationError } from "./errors.js";
export type {
  RssConnectionTestDto,
  RssPreviewItemDto,
  RssSourceDto,
  RssSourcePreviewDto,
  RssTaskDto,
  RssTaskPreviewDto,
} from "./types.js";
