# LLM Provider Config Source Design

## Background

The project now has a first-class LLM provider management feature in the Web admin. Provider templates store reusable model credentials and scoped model configs decide which provider template and model are used for global, account, or conversation scopes.

The runtime still also supports environment-variable model defaults through:

- `LLM_PROVIDER`
- `LLM_MODEL`
- `LLM_BASE_URL`
- `LLM_API_KEY`
- provider-specific keys such as `KIMI_API_KEY`

That creates two configuration sources for the same product concern. The code currently treats Web configuration as higher priority and environment variables as a fallback default, but that behavior is hard for users to reason about. A user can configure one place and still see another place take effect.

This design removes the fallback path. The Web admin becomes the only runtime source for LLM provider configuration.

## Decision

Runtime LLM configuration must come from the database-backed Web admin model provider configuration only.

If no matching enabled model config exists for a request, the Agent must fail with a clear configuration error. It must not fall back to `LLM_PROVIDER`, `LLM_MODEL`, `LLM_BASE_URL`, `LLM_API_KEY`, `KIMI_API_KEY`, or any other provider-specific environment variable.

## Goals

- Make Web admin the single source of truth for LLM provider configuration.
- Remove environment-variable fallback from runtime model resolution.
- Make missing LLM configuration fail clearly instead of silently using hidden defaults.
- Simplify deployment documentation by separating infrastructure env vars from application runtime model configuration.
- Keep the existing scoped resolution model:
  - conversation config
  - account config
  - global config

## Non-Goals

- No one-time environment-variable seeding flow.
- No migration that converts existing `LLM_*` values into database rows.
- No support for using environment variables as secret references inside provider templates.
- No change to the provider template data model itself.
- No redesign of the `/model-config` page beyond the messaging needed for missing configuration.

## Product Behavior

### Configuration Source

The only valid runtime LLM configuration source is the model provider configuration stored in the database.

Users configure LLM access by:

1. creating a provider template in Web admin
2. adding at least one model ID to the template
3. setting the API key and optional base URL on the template
4. creating a scoped model config that references the template

Environment variables are not a runtime model configuration surface.

### Resolution Order

The runtime model resolver should check scopes in this order:

1. conversation: `accountId:conversationId`
2. account: `accountId`
3. global: `*`

For each scope, it should find the first enabled config whose purpose matches the requested purpose or `*`, whose referenced template is enabled, and whose selected `model_id` belongs to the template's model list.

If no valid row is found, resolution fails.

### Missing Configuration

When no usable model config is found, user-facing Agent requests should return a clear error instead of attempting LLM execution.

Suggested internal error code:

```text
LLM_PROVIDER_NOT_CONFIGURED
```

Suggested message:

```text
LLM provider is not configured. Configure a provider template and usage config in Web admin before using the Agent.
```

The Chinese UI can render this as:

```text
尚未配置 LLM Provider。请先在后台创建 Provider 模板并添加使用配置。
```

The error should be treated as a configuration problem, not an unknown provider/model problem.

## Runtime Design

### Agent Resolver

`resolveModel()` should no longer call `getDefaultModel()`.

The resolver contract should become:

- return a resolved model when a database-backed config matches
- throw a typed configuration error when no config matches

The following concepts should be removed from runtime resolution:

- `defaultModel`
- `setDefaultModel`
- `getDefaultModel`
- "env-var default" as the fourth resolution layer

`buildModelFromConfig()` remains useful because it builds a model from a provider template and selected model ID. It should continue accepting `provider`, `modelId`, `apiKey`, and `baseUrl` from database rows.

### Server Startup

Server startup should not create or register a default LLM model from environment variables.

`packages/server/src/ai.ts` should continue wiring ports, registries, prompt assets, and the Agent runner, but it should not read `LLM_PROVIDER`, `LLM_MODEL`, `LLM_BASE_URL`, or `LLM_API_KEY` to build a fallback model.

The Agent runner creation path must support deferred model resolution from request context. If the runner currently requires a model at construction time, that dependency should be refactored so model resolution happens per request through `resolveModel()`.

### Provider API Key Fallbacks

Provider-specific environment-variable fallbacks should be removed from runtime provider construction.

Current examples to remove:

- `moonshot` / `kimi` falling back to `MOONSHOT_API_KEY` or `KIMI_API_KEY`
- `kimi-coding` falling back to `KIMI_API_KEY`, `ANTHROPIC_API_KEY`, or `MOONSHOT_API_KEY`

The provider factory should use only the explicit `apiKey` supplied by the provider template row. If a provider requires a key and the template has no key, the upstream provider package may still throw its own missing-key error, but the application should no longer search process environment variables to fill it.

## API and UI Behavior

### Health and Settings

The health endpoint does not need to fail when no LLM provider is configured, because the server can still run and the admin UI can still be used to configure it.

Instead, the Web admin should surface LLM readiness in settings or model config areas:

- configured: at least one enabled global/account/conversation config references an enabled template
- unconfigured: no enabled usage config references an enabled template

This status is advisory. The authoritative failure still happens at model resolution time.

### Model Config Page

When no provider templates exist, the page should guide the user to create a provider template first.

When templates exist but no usage configs exist, the page should guide the user to create a global usage config.

The UI should not mention `LLM_PROVIDER`, `LLM_MODEL`, `LLM_BASE_URL`, or API-key environment variables as valid alternatives.

### API Responses

The existing model provider template APIs remain the source of provider credentials.

No API should expose raw saved API keys. Responses should continue returning only `api_key_set`.

## Environment Variables

The following environment variables should no longer be documented or consumed as runtime model configuration:

- `LLM_PROVIDER`
- `LLM_MODEL`
- `LLM_BASE_URL`
- `LLM_API_KEY`
- `KEY`
- `KIMI_API_KEY`
- `MOONSHOT_API_KEY`
- other provider-specific LLM API key fallbacks used only by model construction

They may remain in a user's local `.env` without effect, but the project documentation and Docker Compose defaults should stop advertising them.

Infrastructure and service environment variables remain valid, for example:

- `DATABASE_URL`
- `DIRECT_URL`
- `API_PORT`
- `WEB_ORIGIN`
- `AUTH_USERNAME`
- `AUTH_PASSWORD`
- `AUTH_JWT_SECRET`
- `CLAWBOT_CREDENTIAL_KEY`

## Docker Behavior

Docker deployment should start the server and Web admin without requiring any LLM environment variables.

After deployment, the user configures LLM access in Web admin.

`docker-compose.yml` should remove model runtime variables from the server environment block:

- `LLM_API_KEY`
- `LLM_PROVIDER`
- `LLM_MODEL`
- provider-specific LLM keys such as `KIMI_API_KEY`

If a user sends an Agent message before configuration, the request should fail with the explicit missing-configuration message.

## Documentation Changes

Update the following docs and examples:

- `.env.example`
- `docker-compose.yml`
- `packages/server/AGENTS.md`
- root `AGENTS.md` if it describes LLM env vars
- README or deployment docs that tell users to configure LLM through `.env`

The docs should say:

```text
LLM providers are configured in the Web admin. Environment variables are not used for runtime LLM model selection or API keys.
```

## Error Handling

### Missing Runtime Config

If no matching config exists:

- log at warning level with account, conversation, and purpose metadata
- return a user-facing configuration error
- do not attempt provider construction
- do not fall back to environment variables

### Invalid Saved Config

If a saved config references a disabled template or a model not present in the template's model list:

- resolver skips that row and tries the next candidate
- if no row survives, throw the same missing-configuration error

If a saved config references an unknown provider and reaches provider construction:

- keep the existing unknown provider/model error
- log enough metadata to identify the broken template

## Testing Strategy

### Agent Tests

Add resolver coverage for:

- global database config resolves without any LLM environment variables
- conversation config overrides account and global
- account config overrides global
- missing database config throws `LLM_PROVIDER_NOT_CONFIGURED`
- disabled template is skipped
- invalid `model_id` outside the template model list is skipped
- provider factory does not read `KIMI_API_KEY` or `MOONSHOT_API_KEY`

### Server Tests

Add startup/config coverage for:

- server AI bootstrap does not require `LLM_PROVIDER` or `LLM_MODEL`
- config validation does not warn about missing LLM API keys
- API routes can start with no LLM provider configured

### Documentation Verification

Search for removed runtime model env vars after implementation:

```bash
rg -n "LLM_PROVIDER|LLM_MODEL|LLM_BASE_URL|LLM_API_KEY|KIMI_API_KEY|MOONSHOT_API_KEY" .env.example docker-compose.yml README.md docs packages
```

Remaining references should be either:

- migration notes explaining removal
- tests proving the variables are ignored
- unrelated provider documentation not used as runtime configuration

## Migration and Compatibility

This is an intentional breaking change for deployments that relied on `.env` model configuration.

Upgrade behavior:

- existing database model provider templates and usage configs continue to work
- deployments with only `.env` LLM settings become unconfigured after upgrade
- users must create provider templates and usage configs in Web admin

No automatic migration from environment variables is provided. This keeps the runtime source of truth explicit and avoids silently copying secrets from deployment configuration into the database.

## Open Questions

None. The selected approach is intentionally strict: Web admin is the only runtime source for LLM provider configuration.

