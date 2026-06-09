# n8n-nodes-pewpros — Design Spec (v1)

Date: 2026-06-09
Status: Approved pending user review
Author: CloudBedrock

## Purpose

A community n8n node that lets n8n workflows drive the Pewpros app's REST API
(CRM contacts, tags, lists, events, courses, certifications, conversations).
Published to npm as `n8n-nodes-pewpros`, hosted on GitHub under the CloudBedrock
org. A later `n8n-nodes-coachpros` will be a rebrand fork of this package
(same codebase, different name/icon/default base URL) — out of scope for v1.

## Pattern Source

Mirrors the proven `n8n-nodes-cribops` package (`/Users/jhankins/dev/n8n-nodes-cribops`):
- TypeScript → CommonJS, programmatic `INodeType` style, `n8nNodesApiVersion: 1`
- `n8n-workflow ^1.82.0`, Node `>=20.15`, target ES2022
- Build: `rimraf dist && tsc && gulp build:icons && cp package.json dist/`
- Publish: `dist/` only, MIT license, author CloudBedrock
- Reuse cribops' `tsconfig.json`, `.eslintrc.js`, `gulpfile.js`, `.prettierrc`,
  `.gitignore` verbatim

Difference from cribops: cribops uses a flat operation list on a single node.
Pewpros has 7 resources, so it uses the standard n8n **two-level Resource →
Operation** dropdown UI.

## Architecture

Three source units, each one clear purpose:

1. **`credentials/PewprosApi.credentials.ts`** — credential type. Bearer token +
   base URL. Injects `Authorization: Bearer {{token}}`. Connectivity test via
   `GET /api/v1/auth/me`.
2. **`nodes/Pewpros/Pewpros.node.ts`** — the action node. Declares resources,
   operations, and per-operation parameters; `execute()` loops items, dispatches
   to the HTTP helper, returns paired results, supports `continueOnFail()`.
3. **`utils/PewprosHttp.ts`** — thin HTTP client. One `request(method, path,
   {body, qs})` method that injects the Bearer header against `baseUrl`, parses
   JSON, and throws `NodeApiError` on non-2xx with the server's error message.

Icon: `nodes/Pewpros/pewpros.svg`, copied from
`/Users/jhankins/dev/pewpros/priv/static/images/logo.svg` (Pewpros brand mark,
viewBox 0 0 71 48, `fill="currentColor"`).

## Credential — `PewprosApi`

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `apiToken` | string (password) | — | User/admin API token. Sent as `Authorization: Bearer <token>` |
| `baseUrl` | string | `https://app.pewpros.com` | User-editable per deployment. Dev: `https://dev.pewpros.com`. Tenants on custom domains set their own. |

- `authenticate`: generic, header `Authorization: =Bearer {{$credentials.apiToken}}`
- `test`: `GET {{baseUrl}}/api/v1/auth/me`

Auth note: most write operations require the token to belong to a user with an
admin role (`owner`, `instructor`, `staff`, or `super_admin`). Documented in
README.

## Resources & Operations (v1)

All paths are relative to `{{baseUrl}}`. Bearer token on every request.

### Contact  (`/api/v1/contacts`)
| Operation | Method | Path | Key params |
|-----------|--------|------|-----------|
| List | GET | `/api/v1/contacts` | qs: `search`, `tag_ids[]`, `list_ids[]`, `status`, `contact_type`, `page`, `per_page` |
| Get | GET | `/api/v1/contacts/:id` | `id` |
| Create | POST | `/api/v1/contacts` | `email` (req), `first_name`, `last_name`, `phone`, `company`, `source`, `status`, `contact_type`, `timezone`, `metadata`, + address fields |
| Update | PUT | `/api/v1/contacts/:id` | `id` + same fields as Create |
| Delete | DELETE | `/api/v1/contacts/:id` | `id` |
| Upsert | POST | `/api/v1/contacts` | upserts by `email` (server behavior); same body as Create |
| Add Tags | POST | `/api/v1/contacts/:id/tags` | `id`, `tag_ids[]` |
| Remove Tags | DELETE | `/api/v1/contacts/:id/tags` | `id`, `tag_ids[]` |
| Add To List | POST | `/api/v1/contacts/:id/lists` | `id`, `list_ids[]` |
| Remove From List | DELETE | `/api/v1/contacts/:id/lists` | `id`, `list_ids[]` |

### Tag  (`/api/v1/tags`)
| Operation | Method | Path | Key params |
|-----------|--------|------|-----------|
| List | GET | `/api/v1/tags` | — |
| Create | POST | `/api/v1/tags` | `title` (req), `description`, `color`, `emoji` |
| Update | PUT | `/api/v1/tags/:id` | `id` + same fields |
| Delete | DELETE | `/api/v1/tags/:id` | `id` |

### List  (`/api/v1/lists`)
| Operation | Method | Path | Key params |
|-----------|--------|------|-----------|
| List | GET | `/api/v1/lists` | — |
| Create | POST | `/api/v1/lists` | `title` (req), `description`, `is_public` |
| Update | PUT | `/api/v1/lists/:id` | `id` + same fields |
| Delete | DELETE | `/api/v1/lists/:id` | `id` |

### Event
| Operation | Method | Path | Key params |
|-----------|--------|------|-----------|
| List | GET | `/api/v1/events` | published public events |
| Get | GET | `/api/v1/events/:slug` | `slug` |
| List Registrations | GET | `/api/v1/admin/events/:eventId/attendees` | `eventId`, qs `search` (admin) |
| Register Attendee | POST | `/api/v1/admin/registrations/invite` | `email`, `event_id`, `ticket_type_id`, `mode` (`comp`\|`checkout_link`), `first_name`, `last_name`, `phone`, `event_instance_id`, `delivery` (`email`\|`sms`\|`both`) (admin) |

### Course  (`/api/v1/courses`)
| Operation | Method | Path | Key params |
|-----------|--------|------|-----------|
| List | GET | `/api/v1/courses` | — |
| Get | GET | `/api/v1/courses/:slug` | `slug` |
| Enroll | POST | `/api/v1/courses/:slug/enroll` | `slug` (enrolls the token's user) |

### Certification  (`/api/v1/certifications`)
| Operation | Method | Path | Key params |
|-----------|--------|------|-----------|
| List | GET | `/api/v1/certifications` | — |
| Get | GET | `/api/v1/certifications/:id` | `id` |

### Conversation  (`/api/v1/conversations`)
| Operation | Method | Path | Key params |
|-----------|--------|------|-----------|
| List | GET | `/api/v1/conversations` | qs: `channel`, `status`, `contact_id`, `assigned_to`, `search`, `limit`, `offset` |
| Get | GET | `/api/v1/conversations/:id` | `id` |
| Send Message | POST | `/api/v1/conversations/:id/messages` | `id`, `message` (req), `type` (optional) |

### Explicitly out of v1 (no REST surface)
- **Appointments** — LiveView-only in the app, no REST API.
- **Certification "issue"** — background-job driven, no REST endpoint. Read ops
  (list/get) only.

These can be added once the app exposes REST endpoints for them.

## Execution Flow (`Pewpros.node.ts`)

```
execute():
  items = getInputData()
  creds = getCredentials('pewprosApi')
  http  = new PewprosHttp({ baseUrl, apiToken })
  resource  = getNodeParameter('resource', 0)
  operation = getNodeParameter('operation', 0)
  for i in items:
    try:
      build {method, path, body, qs} from (resource, operation, getNodeParameter(.., i))
      data = await http.request(...)
      push { json: data, pairedItem: { item: i } }
    catch e:
      if continueOnFail(): push { json: { error: e.message }, pairedItem: { item: i } }; continue
      throw new NodeApiError(getNode(), e)
  return [returnData]
```

Parameter visibility uses `displayOptions.show.resource[]` / `.operation[]`.
Optional/advanced fields grouped under a "Additional Fields" collection per
create/update operation to keep the UI clean.

## Repo, Build & Publish

- GitHub: `github.com/CloudBedrock/n8n-nodes-pewpros` (HTTPS remote, matches cribops)
- npm package: `n8n-nodes-pewpros`, version `0.1.0`
- keyword: `n8n-community-node-package` (required for n8n community discovery)
- `package.json` `n8n` block lists `dist/credentials/PewprosApi.credentials.js`
  and `dist/nodes/Pewpros/Pewpros.node.js`
- Scripts identical to cribops (`build`, `dev`, `format`, `lint`, `lintfix`,
  `prepublishOnly`)
- README (install, credential setup, resource/operation reference, dev vs prod
  base URL), MIT LICENSE (CloudBedrock)
- No runtime dependencies (uses n8n's request helpers / fetch via PewprosHttp)

## Testing

1. `npm run build` succeeds; `npm run lint` clean (n8n-nodes-base ruleset).
2. Manual smoke test against the dev instance (`https://dev.pewpros.com`, port per
   `~/dev/pewpros/.env`) with a real admin Bearer token:
   - Contact create → get → update → add tag → delete
   - Tag list/create; List list/create
   - Event list; Conversation list
   - Credential "test" button returns success (`/api/v1/auth/me`)
3. Verify in a local n8n instance that the node loads, resources/operations
   render, and a Contact List call returns data before publishing.

## Coachpros Follow-up (not built now)

Same Pewpros codebase, different brand. The follow-up `n8n-nodes-coachpros` is a
fork of this package with: package name, node `displayName`/`name`, icon
(CoachPros wallet/logo asset), and default `baseUrl`. Track as a separate
spec → plan → implement cycle once v1 ships.
