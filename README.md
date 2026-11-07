# n8n-nodes-pewpros

This is an n8n community node. It lets you use the [Pewpros](https://pewpros.com)
CRM, events, and learning platform in your n8n workflows.

Pewpros is a multi-tenant platform for contacts, tags, lists, events, courses,
certifications, conversations, waivers, and affiliate leads. This package
provides an **action node** for the REST API, a **trigger node** that starts
workflows from Pewpros outbound webhooks, and a **poll trigger node** for
record types without webhook topics (affiliate leads, plus waiver signatures for
existing workflows).

[n8n](https://n8n.io) is a [fair-code licensed](https://docs.n8n.io/reference/license/)
workflow automation platform.

[Installation](#installation)
[Credentials](#credentials)
[Operations](#operations)
[Trigger](#trigger)
[Poll Trigger](#poll-trigger)
[Compatibility](#compatibility)
[Resources](#resources)

## Installation

Follow the
[installation guide](https://docs.n8n.io/integrations/community-nodes/installation/)
in the n8n community nodes documentation.

In your n8n instance, go to **Settings > Community Nodes**, select **Install**,
and enter `n8n-nodes-pewpros`.

## Credentials

This package ships two credential types. The **Base URL** must be `https://`
(plain `http://` is rejected so your key is never sent in cleartext; `localhost`
is the one exception, for local development). Both credentials enforce this on
every request they sign, including the credential test and any **HTTP Request**
node that uses them: the key is never attached to a request bound for a
non-loopback `http://` URL.

### Pewpros API (Bearer)

Used by the **Pewpros** action node and the **Pewpros Trigger** node. Most write
operations require the user to have an admin role (`owner`, `instructor`,
`staff`, or `super_admin`).

- **API Token** — the user's Bearer API token.
- **Base URL** — your Pewpros instance, no trailing slash.
  - Production example: `https://app.pewpros.com`
  - Development example: `https://dev.pewpros.com`
  - Tenants on custom domains use their own domain.

Verified against `GET /api/v1/auth/me`.

### Pewpros Partner API (X-Partner-Key)

A secret server-to-server key (`sk_partner_...`) for the facility-management
partner API under `/api/v1/partner` (customers, memberships, range, bookings,
orders, events). Generate and rotate it in **Site Settings → Integrations**;
it is **not** the public funnel key (`pk_...`). There is no dedicated partner
action node yet — pair this credential with n8n's built-in **HTTP Request** node
to call partner endpoints.

- **Partner Key** — the `sk_partner_...` secret.
- **Base URL** — same format as above.

Verified against `GET /api/v1/partner/whoami`.

### Permissions

Every action and both triggers need a Pewpros user with an admin role (`owner`,
`instructor`, `staff`, or `super_admin`). Some routes also check the role's
permissions (Pewpros role capabilities):

| Feature | Permission the token's role needs |
| --- | --- |
| **Pewpros Trigger** (registers webhooks) | Setup → Integrations and credentials (`setup.integrations`) |
| Event → Get Registrations | Classes and events (`classes`) |
| Event → Register Attendee | Classes and events → Registrations and rosters (`classes.registrations`) |
| All other operations, **Pewpros Poll Trigger** | admin role only |

When the role lacks a permission, the node fails with an error naming it, e.g.
`HTTP 403: the API token's role lacks the "Integrations and credentials"
(setup.integrations) permission needed for POST /api/v1/webhooks/register`.

## Operations

| Resource | Operations |
| --- | --- |
| **Contact** | Get Many, Get, Create, Update, Delete, Create or Update, Get Activities, Add Tags, Remove Tags, Bulk Add Tags, Add to List, Remove from List |
| **Contact Note** | Get Many, Create, Update, Delete |
| **Tag** | Get Many, Create, Update, Delete |
| **List** | Get Many, Create, Update, Delete |
| **Conversation** | Get Many, Get, Get Messages, Create, Send, Send Message, Update, Close, Reopen |
| **Event** | Get Many, Get, Get Upcoming Sessions, Get Registrations, Register Attendee |
| **Course** | Get Many, Get, Get Lessons, Get Enrollments, Enroll |
| **Certification** | Get Many, Get, Get Download URL |
| **Group** | Get Many, Get, Create, Update, Delete, Get Members, Invite |
| **Membership** | Get Current, Get Many, Get |
| **Waiver** | Get Many, Get, Get Many Signatures, Get Signature, Get Contact Status |
| **Affiliate Lead** | Get Many, Get, Get Contact Attribution |

Contact `Get Many` supports filtering by search, status, contact type, tag IDs,
list IDs, and an `Updated Since` timestamp for incremental syncs. Waiver
`Get Many Signatures` (filter by waiver, contact, event, or course) and
Affiliate Lead `Get Many` (filter by status or source) follow the same
`Updated Since` incremental-sync contract. `Get Contact Status` answers "has
contact X signed waiver Y?"; `Get Contact Attribution` returns a contact's
affiliate lead handoff rollup.

### Scope

The **Pewpros** action node targets the **Bearer-token** REST surface
(`/api/v1`), which covers the CRM, messaging, events, and learning resources used
in automations. Not covered by a dedicated node:

- **Partner API** (`X-Partner-Key`) — facility/booking sync (customers, range
  reservations, resource bookings, orders). Use the **Pewpros Partner API**
  credential with n8n's HTTP Request node.
- **Public funnel API** (`X-Tenant-Key`) — anonymous lead capture and public
  event registration.

App-internal surfaces (community, push notifications, wallet passes, telephony,
QR, timers) are intentionally not exposed.

The full API is documented at [pewpros.com/docs](https://pewpros.com/docs)
(OpenAPI spec at `/api/docs/openapi.json`).

## Trigger

The **Pewpros Trigger** node starts a workflow when a Pewpros event fires,
instead of polling. It uses the **Pewpros API** (Bearer) credential.

On activation it registers the workflow's webhook URL as an outbound-webhook
subscription (`POST /api/v1/webhooks/register`, idempotent — re-activating never
creates duplicates) and removes it on deactivation. Use **Listen for test
event** to receive a synthetic sample without waiting for real traffic.

Select one or more **Events**:

`contact.created`, `contact.updated`, `registration.created`,
`registration.cancelled`, `enrollment.created`, `order.paid`,
`conversation.created`, `message.received`, `membership.created`,
`membership.updated`, `membership.cancelled`, `waiver.signed`.

**Signature verification is always on** and cannot be turned off. Each
delivery carries `Pewpros-Signature: t=<unix>,v1=<hex>` where
`v1 = HMAC_SHA256(secret, "<t>.<rawBody>")`, computed over the exact bytes
received. The node answers `401` and runs nothing when:

- the header is missing or malformed, or no `v1` matches the subscription
  secret (several `v1=` values are accepted, so the secret can be rotated);
- `t` is more than 5 minutes from the n8n host's clock (replayed or delayed
  delivery; keep the host's clock synced);
- the raw request body is unavailable (the node never re-serialises the body to
  verify it).

**Duplicate deliveries** are dropped. Pewpros retries failed sends, and each
event keeps its `id` (`evt_...`). The node remembers the last 1000 event ids in
the workflow's static data; a repeated id is answered `200` without starting the
workflow. Two copies arriving at the same instant on separate queue-mode workers
could both run; Pewpros spaces its retries, so this does not happen in practice.

## Poll Trigger

Affiliate leads are not (yet) an outbound-webhook topic, so the **Pewpros Poll
Trigger** node covers them by polling on the schedule you choose in n8n's
**Poll Times** setting:

- **New Waiver Signature** — optionally filtered by waiver, contact, event, or
  course. *Replaced by the `waiver.signed` topic on the **Pewpros Trigger** for
  new workflows* (real time, no polling). It keeps working for existing
  workflows.
- **New Affiliate Lead** — optionally filtered by status or source.

It uses the API's `updated_since` cursor (inclusive, ascending): each poll
fetches everything updated since the last high-water mark, advances the cursor,
and dedupes the boundary so records are emitted exactly once. The first poll
after activation sets the cursor to "now" rather than replaying history; a
manual test run returns the most recent records without moving the cursor.
Note the cursor fires on *updates* too — a signature or lead that is modified
later will be emitted again.

## Compatibility

- Requires n8n with `n8nNodesApiVersion` 1 (`n8n-workflow ^1.82.0`).
- Node.js `>=20.15`.

## Development

```bash
npm install
npm run build      # compile TypeScript + copy icons to dist/
npm run lint       # n8n community node lint rules
npm test           # build, then run the unit tests (node:test)
npm run dev        # tsc --watch
```

To test locally, link the built package into your n8n custom nodes folder and
run an n8n instance pointed at your Pewpros dev host.

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/community-nodes/)
- [Pewpros](https://pewpros.com)

## License

[MIT](LICENSE)
