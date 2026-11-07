# n8n-nodes-pewpros

This is an n8n community node. It lets you use the [Pewpros](https://pewpros.com)
CRM, events, and learning platform in your n8n workflows.

Pewpros is a multi-tenant platform for contacts, tags, lists, events, courses,
certifications, conversations, memberships, appointments, range lane
reservations, waivers, and affiliate leads. This package provides an **action
node** for the REST API, a **trigger node** that starts workflows from Pewpros
outbound webhooks, and a **poll trigger node** for incremental syncs
(registrations, course enrollments, affiliate leads, and waiver signatures).

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
node that uses them: the key is only attached to requests whose origin is the
credential's own Base URL, so it is never sent over a non-loopback `http://`
URL nor to any other host.

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
| **Pewpros Trigger** (registers webhooks), **Webhook** resource | Setup → Integrations and credentials (`setup.integrations`) |
| Event → Get Registrations | Classes and events (`classes`) |
| Event → Register Attendee, **Registration** resource, Poll Trigger → New Registration | Classes and events → Registrations and rosters (`classes.registrations`) |
| Course → Get Many Enrollments, Enroll User, Poll Trigger → New Course Enrollment | Classes and events → Courses and lessons (`classes.manage_courses`) |
| **Check-In** resource | Classes and events → Check-in (`classes.check_in`) |
| **Appointment** resource | Calendar (`calendar`). Another instructor's appointments also need `calendar.view_all`; an Override Reason needs `calendar.override_availability`. |
| **Range Reservation** resource | Range (`range`). Waiver and lane-block overrides need `range.waiver_override`. |
| **Membership Level** resource, Membership → Get Timeline | Memberships (`memberships`) |
| Membership → Hold, Resume, Cancel Subscription, Undo Scheduled Cancel, Set Amount, Clear Scheduled Amount, Add Note | Memberships → Edit (`memberships.edit`) |
| Membership → Update Card | `memberships.edit` and CRM → Manage cards (`crm.manage_cards`) |
| Conversation → Mark Read | Conversations (`conversations`) |
| All other operations, Poll Trigger → waiver and affiliate events | admin role only |

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
| **Conversation** | Get Many, Get, Get Messages, Create, Send, Send Message, Update, Close, Reopen, Mark Read |
| **Event** | Get Many, Get, Get Upcoming Sessions, Get Registrations, Register Attendee |
| **Registration** | Get Many, Get (every registration on the site) |
| **Course** | Get Many, Get, Get Lessons, Get Many Enrollments, Enroll, Enroll User |
| **Certification** | Get Many, Get, Get Download URL |
| **Group** | Get Many, Get, Create, Update, Delete, Get Members, Invite |
| **Membership** | Get Current, Get Many, Get, Hold, Resume, Cancel Subscription, Undo Scheduled Cancel, Set Amount, Clear Scheduled Amount, Update Card, Get Timeline, Add Note |
| **Membership Level** | Get Many, Add Course, Remove Course |
| **Appointment** | Get Many, Get, Get Available Slots, Create, Update, Move, Cancel, Confirm, Reject, Reconfirm, Add Service Line, Remove Service Line |
| **Range Reservation** | Get Board, Get Many, Get, Get Rate Options, Get Reschedule Slots, Create, Reschedule, Extend, Move to Lane, Update Participants, Check In, Check In Participant, Send Waiver Link, Cancel, Mark No-Show, Complete |
| **Check-In** | Verify QR Code, Verify Membership |
| **Waiver** | Get Many, Get, Get Many Signatures, Get Signature, Get Contact Status |
| **Affiliate Lead** | Get Many, Get, Get Contact Attribution |
| **Webhook** | Send Test, Get Deliveries |

Contact `Get Many` supports filtering by search, status, contact type, tag IDs,
list IDs, and an `Updated Since` timestamp for incremental syncs. Waiver
`Get Many Signatures` (filter by waiver, contact, event, or course) and
Affiliate Lead `Get Many` (filter by status or source) follow the same
`Updated Since` incremental-sync contract. `Get Contact Status` answers "has
contact X signed waiver Y?"; `Get Contact Attribution` returns a contact's
affiliate lead handoff rollup.

Registration `Get Many` and Course `Get Many Enrollments` cover the whole site
and take the same `Updated Since` filter.

> **Breaking change:** Course → Get Many Enrollments keeps its old operation
> value (`getEnrollments`) but now lists **every enrollment on the site** and
> needs the `classes.manage_courses` permission. It used to return only the API
> token user's own enrollments. Saved workflows that use it will see different
> data, or a 403 if the token's role lacks the permission.

**Enroll User** enrolls
anyone by email and creates the user if needed; it takes the numeric course ID,
not the slug. Re-enrolling returns the existing enrollment.

**Date-times.** Fields such as Starts At accept ISO 8601. A value without a time
zone offset (what the n8n date picker produces) is read in the n8n server's time
zone and sent as UTC. Date-only fields (`From`, `To`, `Date`) are sent as
`YYYY-MM-DD`.

**Appointments.** Create books a single appointment, or a weekly series when a
**Repeat** rule is set. **Confirm** accepts a customer's requested appointment
and **captures the payment held at booking**; Reject releases it. Cancel does
not email the customer unless **Notify Customer** is on. Update, Move and Cancel
can apply to the rest of a series (**Apply To**).

**Range reservations.** Every operation needs the **Location ID** of the range
the lanes belong to. Pewpros has no reservation list endpoint: **Get Many**
reads the lane board for one day and returns one item per reservation (with
`lane_number` and `lane_name`). The board shows only reserved and checked-in
reservations, not cancelled or completed ones. A guest booking needs Guest Name
and Guest Phone. When a lane is taken the error names the free lanes
(`... [lane_busy]. Free lanes: #3 (id 11)`), and a staff alert that blocks a
customer is spelled out (`[lane_blocked] Alerts: ...`). Extend returns any
overtime charge as `charge_cents`. Tickets, the walk-in queue, lane requests and
guest passes are counter work and are not in the node.

**Membership subscription controls.** Membership ID is the membership's ID, not
the subscription's. **Set Amount** takes whole cents; an increase is scheduled
and the member is emailed. **Update Card** switches the subscription to a card
the member already has saved in Stripe, by its PaymentMethod ID (`pm_...`); no
card data passes through n8n. Square and legacy Fortis subscriptions answer
`unsupported_gateway`.

**Check-In.** Both verify operations return `valid` and `reason` instead of
failing on an invalid or voided pass, so the workflow can branch on them.

**Conversation → Assign** is not offered yet. Pewpros answers it with a server
error for API tokens (pewpros #3233). The same bug likely affects **Send** and
**Send Message**.

### Scope

The **Pewpros** action node targets the **Bearer-token** REST surface
(`/api/v1`), which covers the CRM, messaging, events, and learning resources used
in automations. Not covered by a dedicated node:

- **Partner API** (`X-Partner-Key`) — facility/booking sync (customers,
  resource bookings, orders). Use the **Pewpros Partner API** credential with
  n8n's HTTP Request node. Range lane reservations are covered by the action
  node's **Range Reservation** resource through the admin API.
- **Membership integration endpoints** (member lookup, create a membership,
  family seats) accept only the fleet-wide admin key today, so the node does not
  offer them (pewpros #3228).
- Register (point of sale), cash drawer, time clock and redemption routes, which
  belong to the desktop register.
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
workflow. This is best effort: two deliveries handled at the same moment by
separate main/webhook processes can each save their own copy of the list, so a
retry of one of those events could run again. Pewpros spaces its retries, so
this is rare; make workflows that must never double-run idempotent on `id`.

## Poll Trigger

The **Pewpros Poll Trigger** node polls on the schedule you choose in n8n's
**Poll Times** setting. Use it for record types without a webhook topic, or when
you want new *and changed* records:

- **New Waiver Signature** — optionally filtered by waiver, contact, event, or
  course. *Replaced by the `waiver.signed` topic on the **Pewpros Trigger** for
  new workflows* (real time, no polling). It keeps working for existing
  workflows.
- **New Affiliate Lead** — optionally filtered by status or source.
- **New Registration** — every registration on the site, optionally filtered by
  event or status (needs `classes.registrations`).
- **New Course Enrollment** — every enrollment on the site, optionally filtered
  by course or status (needs `classes.manage_courses`).

It uses the API's `updated_since` cursor (inclusive, ascending): each poll
fetches everything updated since the last high-water mark, advances the cursor,
and dedupes the boundary so records are emitted exactly once. The first poll
after activation sets the cursor to "now" rather than replaying history; a
manual test run returns the most recent records without moving the cursor.
Note the cursor fires on *updates* too — a record that is modified later (a
registration cancelled, an enrollment completed) will be emitted again.

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
