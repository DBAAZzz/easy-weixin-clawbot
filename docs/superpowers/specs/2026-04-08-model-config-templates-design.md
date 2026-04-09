# Model Config Templates Design

## Background

`/model-config` currently stores runtime-ready model credentials directly on each scoped config row. Creating a config requires filling `scope`, `scopeKey`, `purpose`, `provider`, `modelId`, `apiKey`, and `baseUrl` in one step.

That structure has two product problems:

1. Credentials are not reusable. The same provider account must be re-entered for every scope or purpose.
2. The page starts from runtime binding details instead of provider setup, which makes the first-run flow heavier than necessary.

The user wants the flow inverted:

- First create reusable provider credential templates.
- Each template owns one provider, one API key, one base URL, and a maintained list of allowed model IDs.
- Scoped model configs should only reference a template and select one model from that template's allowed model list.
- Provider selection should have presets in the UI.
- Template changes should affect all referencing configs immediately.

The user also explicitly confirmed there is no data migration burden, so the database layer may be reworked freely.

## Goals

- Replace direct credential storage in `model_configs` with reusable provider templates.
- Redesign `/model-config` into a two-layer management page:
  - provider template management
  - scoped model usage configuration
- Keep runtime resolution behavior intact at the product level:
  - conversation overrides account
  - account overrides global
  - missing matches fall back to env defaults
- Ensure scoped configs can only choose `model_id` values that belong to the referenced template.
- Make template updates real-time for all referencing configs.

## Non-Goals

- No compatibility bridge for old `model_configs` rows.
- No provider capability discovery from remote APIs.
- No encrypted-at-rest secret management in this iteration.
- No per-purpose provider presets from the backend.
- No import/export workflow for templates.

## User Experience

### Page Structure

`/model-config` becomes a single page with two stacked work areas:

1. `Provider 模板`
2. `使用配置`

This keeps the workflow in one place while preserving the distinction between reusable credentials and runtime bindings.

### Provider Template Work Area

The upper area is the primary entry point.

- Left column: template list
  - shows all templates
  - highlights the selected template
  - displays `name`, `provider`, `enabled`, and reference count
  - includes a `新建模板` action
- Right column: template detail/editor
  - create or edit a single template
  - no `scope` or `purpose` fields appear here

### Template Fields

Each template contains:

- `name`
- `provider`
- `model_ids`
- `api_key`
- `base_url`
- `enabled`

`model_ids` is managed as a list editor, not a single text field. Empty entries are ignored and duplicate IDs are removed before save.

### Provider Presets

The UI ships with provider presets for faster creation. Presets are a frontend convenience, not a backend enum.

Each preset contains:

- display label
- provider key
- optional helper text
- optional base URL placeholder

Initial preset set:

- OpenAI
- Anthropic
- Google Gemini
- DeepSeek
- Moonshot
- Kimi
- OpenRouter
- Azure OpenAI
- Custom

Rules:

- Selecting a preset fills the `provider` field with the preset key.
- `Custom` leaves the provider fully editable.
- Presets must not prevent unsupported-but-valid provider keys that `pi-ai` can resolve.

### Scoped Usage Config Work Area

The lower area manages actual runtime bindings.

Each usage config contains only:

- `scope`
- `scope_key`
- `purpose`
- `template_id`
- `model_id`
- `enabled`
- `priority`

`provider`, `api_key`, and `base_url` are not editable here.

### Usage Config Creation Flow

When creating a usage config:

1. Choose `scope`
2. Fill `scope_key` when required
3. Choose `purpose`
4. Choose a template
5. Choose one `model_id` from that template's `model_ids`
6. Set `enabled` and `priority`

If the selected template changes:

- the model select options refresh immediately
- the previous `model_id` is cleared if it is not in the new template's list

### Status Behavior

- Disabled templates remain visible in the template list and in usage configs.
- A usage config referencing a disabled template is treated as inactive at runtime.
- The UI should make this visible with a warning or muted status label in the config card/table.
- Creating a new usage config should only offer enabled templates in the primary selector.
- Editing an existing config must still display its disabled template so the user can rebind it intentionally.

## Data Model

### Provider Template

Add a new table and DTO family for reusable provider credentials.

Suggested database shape:

```text
model_provider_templates
- id bigint primary key
- name text not null
- provider text not null
- model_ids text[] not null default {}
- api_key text null
- base_url text null
- enabled boolean not null default true
- created_at timestamptz not null default now()
- updated_at timestamptz not null default now()
```

Notes:

- `model_ids` is stored as a Postgres text array.
- `api_key` remains nullable to preserve env-var fallback patterns if needed.
- `name` is user-facing and does not need to be globally unique.

### Scoped Model Config

Refactor the existing `model_configs` table to become a reference layer.

Suggested database shape:

```text
model_configs
- id bigint primary key
- scope text not null
- scope_key text not null
- purpose text not null
- template_id bigint not null references model_provider_templates(id)
- model_id text not null
- enabled boolean not null default true
- priority int not null default 0
- created_at timestamptz not null default now()
- updated_at timestamptz not null default now()
```

Constraints:

- unique `(scope, scope_key, purpose)`
- index on `(scope, scope_key)`
- foreign key from `template_id` to `model_provider_templates.id`

Intentional removal from `model_configs`:

- `provider`
- `api_key`
- `base_url`

### Migration Strategy

Because there is no data burden:

- drop or fully redefine the old `model_configs` structure
- create `model_provider_templates`
- recreate `model_configs` around `template_id`
- no row migration logic is required

This is the cleanest option and avoids carrying legacy compatibility in the API or resolver.

## Shared Types

Add shared DTOs for the two-layer structure.

### Provider Template DTO

```ts
interface ModelProviderTemplateDto {
  id: string;
  name: string;
  provider: string;
  model_ids: string[];
  api_key_set: boolean;
  base_url: string | null;
  enabled: boolean;
  usage_count: number;
}
```

`usage_count` is returned by list endpoints so the UI can show whether a template is reused and whether delete should be blocked.

### Scoped Config DTO

```ts
interface ModelConfigDto {
  id: string;
  scope: "global" | "account" | "conversation";
  scope_key: string;
  purpose: string;
  template_id: string;
  template_name: string;
  provider: string;
  model_id: string;
  template_enabled: boolean;
  enabled: boolean;
  priority: number;
}
```

`provider` stays in the DTO as a denormalized display field for cards and tables.

## API Design

### Provider Templates API

Add a dedicated route group:

- `GET /api/model-provider-templates`
- `POST /api/model-provider-templates`
- `PATCH /api/model-provider-templates/:id`
- `DELETE /api/model-provider-templates/:id`

Behavior:

- list returns all templates plus `usage_count`
- create/update validates `provider` and `model_ids`
- delete rejects when `usage_count > 0`

Validation rules:

- `name` required
- `provider` required
- `model_ids` must contain at least one non-empty value
- `model_ids` are trimmed, deduplicated, and persisted in stable order
- `base_url` is nullable
- template update must support partial secret updates so the UI does not need to re-enter an existing key on every edit

Secret update contract:

- create accepts `api_key` as a full value or `null`
- update may omit `api_key`, which means "leave the saved key unchanged"
- update may send `api_key` with a non-empty value, which means "replace the saved key"
- update may send `clear_api_key: true`, which means "remove the saved key"
- sending both `api_key` and `clear_api_key: true` is invalid

### Scoped Config API

Keep the existing route group name:

- `GET /api/model-configs`
- `PUT /api/model-configs`
- `DELETE /api/model-configs/:id`

`PUT /api/model-configs` now accepts:

```json
{
  "scope": "global",
  "scope_key": "*",
  "purpose": "*",
  "template_id": "1",
  "model_id": "gpt-5.1",
  "enabled": true,
  "priority": 0
}
```

Validation rules:

- `scope` must be one of `global | account | conversation`
- `purpose` must be one of `chat | extraction | *`
- `template_id` must exist
- `model_id` must be one of the referenced template's `model_ids`
- non-global scopes require non-empty `scope_key`

### List Response Shape

The model config list endpoint should return config rows already joined with template metadata required by the page:

- `template_name`
- `provider`
- `template_enabled`

This avoids a client-side join for the common list view while still allowing the page to fetch templates separately for editor state.

## Persistence Layer

### Agent Port Changes

Split the current store contract into two concepts:

1. provider template store operations
2. scoped config store operations

The existing `ModelConfigStore` can be expanded rather than introducing two independent injected stores, because both are part of the same admin domain.

Suggested row types:

- `ModelProviderTemplateRow`
- `ModelConfigRow`
- `ResolvedModelConfigRow` or equivalent joined shape for resolver use

Required store methods:

- `listTemplates()`
- `createTemplate(...)`
- `updateTemplate(...)`
- `deleteTemplate(...)`
- `getTemplateById(id)`
- `listAllConfigs()`
- `findByScope(scope, scopeKey)`
- `upsertConfig(...)`
- `deleteConfig(id)`

`findByScope` should return rows already joined with template data so the resolver does not need a second query per row.

### Prisma Implementation

The Prisma store should:

- map template rows and config rows separately
- use `include` or `select` joins for config listing and scope resolution
- order scope results by `priority desc`
- reject deleting templates with existing references

## Runtime Resolution

The resolution chain remains:

1. conversation scope
2. account scope
3. global scope
4. env default

### Resolver Algorithm

For each scope candidate:

1. fetch enabled config candidates ordered by `priority desc`
2. find the first row where `purpose` matches requested purpose or `*`
3. reject rows whose template is disabled
4. reject rows whose `model_id` is not in `template.model_ids`
5. build the model using:
   - `provider` from template
   - `model_id` from config
   - `base_url` from template
   - `api_key` from template

If no valid row survives, continue to the next scope.

If no scope yields a valid row, use env default.

### Caching

The current cache key strategy can remain scope-based:

- `conversation:<accountId>:<conversationId>`
- `account:<accountId>`
- `global:*`

But cache invalidation must now clear on:

- template create/update/delete
- config create/update/delete

A full cache clear on every template mutation is acceptable for this iteration.

## Error Handling

### Template Delete

Deleting a referenced template returns `409 Conflict` with a clear error message.

Expected message shape:

- `"template is still referenced by model configs"`

### Invalid Model Selection

Creating or updating a config with a model outside the template list returns `400 Bad Request`.

Expected message shape:

- `"model_id must belong to the selected template"`

### Disabled Template

Disabled templates do not hard-fail the page or the resolver.

- UI shows the usage config as effectively inactive
- resolver skips it and falls back normally

### Unknown Provider/Model

`buildModelFromConfig` still throws when `pi-ai` cannot resolve a provider/model combination. This behavior should remain unchanged. The page is an admin surface, not a capability registry.

## UI Components and Page Behavior

### Template List Cards

Each card should show:

- template name
- provider
- active/inactive status
- model count
- usage count

### Template Editor

The template editor should support:

- preset quick-pick buttons
- inline `model_ids` list editing
- API key password field
- secret placeholder text for existing templates, such as `已设置，留空则不修改`
- an explicit `清空 API Key` action or toggle
- base URL field
- enable toggle

The create state should be usable with only template fields populated. No scoped runtime data appears here.

### Usage Config Cards or Table

Each item should show:

- scope label
- scope key
- purpose
- template name
- provider
- selected model
- enabled status
- template status
- priority

The page may keep the current card presentation, but the content must reflect the two-layer structure instead of direct credentials.

### Empty States

When there are no templates:

- show template-first empty state
- primary CTA is `新建第一个模板`
- usage config creation CTA should be disabled or hidden

When templates exist but no usage configs exist:

- show usage config empty state with CTA

## Security and Secret Handling

- API responses never return raw API keys
- templates only expose `api_key_set: boolean`
- updates replace secret values explicitly through admin actions
- UI must never prefill saved secrets back into visible inputs

This iteration keeps the current secret model, which already stores keys in the database.

## Testing Strategy

### Server Tests

Add route-level coverage for:

- creating a provider template
- updating a provider template
- rejecting template deletion when referenced
- upserting a model config with a valid `template_id` and `model_id`
- rejecting a config whose `model_id` is not in the template

### Agent Tests

Add resolver tests for:

- joined template-backed resolution
- disabled template fallback
- invalid model list fallback
- global/account/conversation precedence still working

### Web Tests

Add API client tests for:

- template CRUD requests
- config upsert payload now using `template_id`

Add page-level tests where practical for:

- template create form not requiring `scope/purpose`
- model select options being derived from selected template
- clearing invalid selected model when template changes

## Acceptance Criteria

- A user can create a provider template with `provider`, `model_ids`, `api_key`, and optional `base_url` without touching `scope` or `purpose`.
- A user can create a scoped model config that references a template and selects exactly one model from that template.
- The UI never allows freeform `model_id` entry inside scoped configs.
- Changing a template's `api_key` or `base_url` immediately affects all referencing configs.
- Disabling a template makes all referencing configs ineffective at runtime without deleting them.
- Deleting a referenced template is blocked.
- Resolver fallback order remains conversation -> account -> global -> env.

## Implementation Notes

- Keep provider presets frontend-only to avoid unnecessary backend coupling.
- Prefer reusing the existing `/model-config` route and page rather than creating a second page.
- Because this is a clean break, update all DTOs, store interfaces, Prisma schema, routes, resolver logic, and UI in one pass.

## Open Decisions Resolved

- Use a single page, not separate routes, for templates and usage configs.
- Store multiple allowed models on the template.
- Scoped config model selection is restricted to that stored list.
- No legacy migration path is needed.
