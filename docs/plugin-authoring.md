# Gloss Plugin Authoring

Gloss plugins are declarative paper-analysis modules. A plugin describes its
prompt, input requirements, optional worker presentation, and optional settings.
Gloss owns provider access, task lifecycle, cancellation, progress transport,
settings storage, and the settings UI. Plugin packages never execute downloaded
Python or JavaScript inside Gloss.

## Minimal manifest

Only the existing analysis fields are required:

```json
{
  "api_version": 1,
  "id": "example.claim-checker",
  "name": "Claim Checker",
  "version": "1.0.0",
  "author": "Your Name",
  "description": "Checks the evidence for the paper's central claims.",
  "permissions": ["paper:read", "ai:complete"],
  "requirements": ["body_text"],
  "contributes": {
    "paper_sidebar": {
      "tab_name": "Claims",
      "icon": "🔎"
    }
  },
  "prompt": "List the central claims and evaluate the evidence for each one."
}
```

This is enough to get:

- a reader tab;
- the standard Run, Cancel, provider, model, reasoning-effort, and context-mode
  controls;
- a cancellable background task with progress;
- the default Research Assistant worker presentation; and
- per-paper result caching.

## Worker presentation

`agent` is optional. It changes presentation only; it does not grant capabilities
or execute code.

```json
{
  "agent": {
    "name": "Evidence Scout",
    "name_zh": "证据侦察员",
    "icon": "🔬",
    "messages": {
      "preparing": "Preparing the paper",
      "reading": "Reading the evidence",
      "thinking": "Checking the claims",
      "writing": "Writing the review",
      "saving": "Saving the result"
    }
  }
}
```

Every field is optional. Missing fields fall back to the Gloss Research
Assistant and its localized stage messages. Messages must be short status text;
they are not model prompts.

## Plugin-specific settings

Gloss follows VS Code's declarative `contributes.configuration` model. Plugin
authors declare only settings that are specific to their analysis. Gloss adds
provider, model, reasoning effort, and context mode automatically.

```json
{
  "contributes": {
    "paper_sidebar": {
      "tab_name": "Claims",
      "icon": "🔎"
    },
    "configuration": {
      "title": "Claim Checker",
      "properties": {
        "strictness": {
          "type": "string",
          "enum": ["balanced", "strict"],
          "enumDescriptions": [
            "Report the most important evidence gaps.",
            "Report every material evidence gap."
          ],
          "default": "balanced",
          "description": "Controls how aggressively claims are challenged.",
          "order": 10
        },
        "includeFollowUps": {
          "type": "boolean",
          "default": true,
          "description": "Include proposed follow-up experiments.",
          "order": 20
        }
      }
    }
  }
}
```

Property keys may be relative, as above. Gloss stores and exposes them under the
plugin ID namespace. A fully qualified key is also accepted only when it starts
with `<plugin-id>.`. This keeps settings collision-free without forcing authors
to repeat their plugin ID throughout the manifest.

Supported schema fields are deliberately small and UI-renderable:

- `type`: `boolean`, `string`, `number`, `integer`, or a simple array;
- `default`;
- `description` or `markdownDescription`;
- `enum`, `enumDescriptions`, and `enumItemLabels`;
- `minimum`, `maximum`, `minLength`, `maxLength`, `minItems`, and `maxItems`;
- `order`; and
- `editPresentation: "multilineText"` for long strings.

Nested objects, executable callbacks, remote schemas, `$ref`, and schema
definitions are not supported. Invalid manifests or setting values are rejected
before a provider is called.

At runtime Gloss resolves defaults plus user overrides, gives the resolved
values to the plugin prompt as a separate settings block, and includes the
settings fingerprint in the result cache key.

## Standard AI settings

Gloss automatically provides these settings for every built-in feature and
installed plugin:

- **Provider**: blank means the current global provider.
- **Model**: blank means the selected provider's default.
- **Reasoning effort**: provider-specific; blank means provider default.
- **Context mode**:
  - `full` sends the required paper context for every task.
  - `shared_session` sends a paper once to a session-capable provider and resumes
    that paper session for later features and plugins.

Global task concurrency is not capped. Work that resumes the same shared
conversation is serialized to protect conversation order. Providers without a
resumable-session capability safely fall back to full context.

## Task and progress contract

Gloss runs analysis as background tasks. The frontend receives a task snapshot
with:

```text
id, feature_id, paper_id, plugin_id, status, progress, stage, detail,
agent, created_at, started_at, finished_at, result, error, cancellable
```

`progress` is an integer from 0 through 100. It advances only when Gloss reaches
a real host milestone; it does not invent a token- or time-based percentage
while a non-streaming model call is running. `stage` is a stable machine value;
`detail` and the agent messages are presentation text. Plugins do not calculate
progress themselves, so all current and future plugins get the same behavior.

Terminal statuses are `completed`, `failed`, and `cancelled`. Cancelling a task
terminates the provider subprocess or request owned by that task without
limiting unrelated plugin tasks.

Completed output is stored in Gloss's local paper cache. Reopening the paper or
restarting Gloss restores the matching result through a read-only lookup; a
cache miss never starts AI automatically. Uninstalling a plugin requires user
confirmation, cancels its active tasks, and deletes that plugin's saved output
for every paper.

## Compatibility

- Unknown fields may be preserved for forward compatibility but do not grant
  permissions.
- Adding optional settings is backward compatible.
- Removing or renaming a setting should be treated as a plugin-version
  migration.
- Deprecated settings should remain readable for at least one plugin version.
- Secrets are provider settings owned by Gloss and must not be declared in a
  paper-analysis plugin manifest.

The live schema and starter manifest are available from
`/api/plugins/schema` and `/api/plugins/template`.
