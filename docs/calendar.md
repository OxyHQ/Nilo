# Calendar

Nilo keeps calendars as databases: an event is a row, its time a date
property. Other Oxy apps (Astro first) read and write them through `/calendar`
and the `@oxy.so/nilo` SDK; Nilo's own calendar view shows the same rows.
Code: `apps/api/src/routes/calendar.ts`, `apps/api/src/lib/calendar/`.
A calendar can also be a subscription to one kept elsewhere (Google, Outlook,
iCloud): see [Subscriptions](#subscriptions).
Contract: `packages/contracts/src/calendar.ts`. SDK: `packages/sdk`.

## The model

**A calendar is a database with a calendar view.** A database is a calendar
when one of its own views (not a linked view) is a calendar on a date
property (`config.datePropertyId`). That property is the event's time, so the
rows a calendar client reads are the ones Nilo's calendar view shows. When
several own views are calendars, the first by order decides. Adding a
Calendar view to any database therefore makes it a calendar; removing the
last one, or retyping its date property, makes it an ordinary database again
(`/calendar` then answers `not_a_calendar`).

**The other fields** come from the database's properties
(`lib/calendar/recognition.ts`): by fixed id first (the system calendar's ids
below, which any database may use), then by type and name in the schema's
order, each property used once:

| Field | Type | Names (case-insensitive) | Any of the type? |
|---|---|---|---|
| location | text | Location, Where, Place, Venue | no |
| url | url | Meeting link, Link, URL, Meeting, Video call | yes |
| description | text | Description, Notes, Details, Agenda | no |
| attendees | person | Attendees, Guests, Participants, People, Invitees | yes |
| color | select | Color, Colour, Calendar, Category, Type | no |
| recurrence | text | Repeat, Recurrence, RRULE, Repeats | no |
| uid | text | iCal UID, UID, Event UID | no |

The title is the row's Name. All-day is not a property: it is the date
value's `includeTime` (off: days; on: a time). A field the calendar has no
property for reads as null; writing a value to it is `validation_failed`
(clearing it is ignored). Renaming a property of an ordinary database can
change which field it holds; the system calendar reads ids only.

**The default calendar.** The personal workspace gets one system database,
`calendar` (`databases.system_key`, `lib/databases/system.ts`), made on first
use of `/calendar` for that workspace: `GET /calendar/calendars` or
`GET /calendar/events` without a workspace, or `POST /calendar/events` without
a calendar. It is made once (the `databases_workspace_system_key` unique index
settles concurrent first uses, as for Noted's databases), private to the owner
(`teamspace_id` null, like the notes), opens on its Calendar view, and has
fixed properties: Name, When (`event_when`, date), Location
(`event_location`), Meeting link (`event_url`), Description
(`event_description`), Attendees (`event_attendees`, person), Color
(`event_color`, select, options editable), Repeat (`event_repeat`) and iCal
UID (`event_uid`), the last two hidden in the view. As with every system
database, it cannot be deleted and those properties cannot be removed,
retyped or reconfigured (409 `SYSTEM_PROPERTY` / `SYSTEM_DATABASE`); a
workspace reset removes it and the next use makes it again. Only the
workspace's owner can trigger it: `/calendar` never provisions in anyone
else's workspace.

### Why rows of a database, not a table of events

Events as rows get everything a row has without a second implementation:
Nilo's views (calendar, timeline, table, board), filters, history and page
activity, comments and an event page with content, sharing and restricted
rows, two-way relations (an event linked to a project), `assigned`
notifications when someone is added to Attendees, CSV export, the database's
live room, and Noted-style app access through system databases. A parallel
`events` table would need each of those again and would split what a user
sees in Nilo from what a client reads.

The cost is in queries and in semantics that a database does not carry:

- A range read cannot use a column index: each calendar's date property is a
  key in `pages.properties`, read per row (below). The rows are narrowed by
  `database_id` (`pages_database_archived_created_idx`), so the cost is the
  size of the calendars read, not of the workspace. Expression indexes per
  property are possible later for a very large calendar.
- A date value has no time zone of its own (`docs/databases.md`): a timed
  event is a UTC instant, shown in the reader's zone. Repeating events and
  all-day days are therefore read in the zone the request names.
- Attendees are Oxy users (members and guests of the workspace), not email
  addresses; there is no RSVP state.

None of these was a blocker, so the model stays Nilo-native.

## Event time

The date property as stored: `{ start, end, includeTime }`.

- **All-day** (`includeTime` off): days, each stored as midnight UTC, the end
  inclusive and null for one day — what Nilo's date picker writes. The API
  speaks iCalendar's form: `start`/`end` are `YYYY-MM-DD`, the end
  **exclusive** (a one-day event on the 3rd ends on the 4th).
- **Timed** (`includeTime` on): UTC instants. The API returns ISO-8601 UTC;
  it accepts any offset and stores UTC. An event with no end ends when it
  starts (`end` equals `start`).
- `PATCH` with `start` alone moves the event and keeps its length; `end`
  alone keeps the start; changing `allDay` needs `start` (and `end`) in the
  new form.

## Repeating events

A calendar with a recurrence property holds a series as one row with an
RRULE (`lib/calendar/recurrence.ts`). Supported: `FREQ` DAILY, WEEKLY,
MONTHLY or YEARLY; `INTERVAL`; `COUNT` or `UNTIL` (a date or a UTC time);
`BYDAY` (weekdays for WEEKLY; with an ordinal, `1MO` or `-1FR`, for
MONTHLY); `BYMONTHDAY` (MONTHLY, negative from the end); `WKST=MO`. Anything
else is refused on write (422 `validation_failed`, field `recurrence`); an
import keeps the event's first occurrence and counts it as `simplified`.
Months without the day (the 31st) and non-leap years (29 February) are
skipped, as in RFC 5545.

Reads expand a series into its occurrences in the window. A timed series
keeps its wall-clock time in the request's `timeZone`: a 09:00 meeting stays
at 09:00 across a change to summer time. An occurrence's `id` is
`<rowId>:<start>`, `seriesStart` is the first occurrence's start, and a write
to `rowId` changes the whole series. A series holds exceptions (EXDATE) only
in a subscribed calendar (below); there are no single-occurrence edits.

## API

Every route needs an Oxy session (`Authorization: Bearer`). Responses follow
Oxy's API conventions (`~/Oxy/docs/api-conventions.md`): no envelope, lists
are `{ items, nextCursor }`, errors are `{ error: { code, message, details? } }`
with a code from `CALENDAR_ERROR_CODES` — the shared ones plus
`not_a_calendar` (422), `locked` (423) and `import_unreachable` (422). A
malformed request (unknown or repeated parameter, wrong type, missing field)
is `bad_request`; a well-formed value refused is `validation_failed` with
`details.field`. An unknown `/calendar` path is `unknown_route`.

- `GET /calendar/calendars?workspaceId` — the calendars of a workspace the
  caller is a member of (the personal one when absent: its default calendar
  first, made on first use), each with the caller's `role`, `canEdit`, the
  property ids of its `fields` and its `colors`.
- `GET /calendar/calendars/:id` — one calendar.
- `GET /calendar/events?from&to[&calendarIds][&workspaceId][&timeZone][&limit][&cursor]`
  — events and occurrences overlapping `[from, to)` (ISO instants, at most
  400 days apart), ordered by start then row id. `calendarIds` is a
  comma-separated list (at most 50); without it, every calendar of the
  workspace the caller can read. `timeZone` (IANA, default UTC) decides which
  days the window covers for all-day events and the time a series keeps.
  `limit` 1–1000, default 250. `cursor` is opaque, bound to the calendars,
  the window and the zone: replayed on another list it is `bad_request`.
- `POST /calendar/events` — `{ calendarId?, title, allDay?, start, end?,
  location?, url?, description?, attendees?, colorId?, recurrence?, uid?,
  icon? }` → 201 with the event. Without `calendarId`, the personal default
  calendar.
- `GET /calendar/events/:rowId`, `PATCH /calendar/events/:rowId` (the fields
  sent), `DELETE /calendar/events/:rowId` → 204 (into Nilo's trash; deleting
  an event already there is 204 too; reading one there is 410 `gone`).
- `GET /calendar/calendars/:id/export.ics` — every event as iCalendar, a
  series with its RRULE (at most 10 000).
- `POST /calendar/calendars/:id/import` — `{ ics }` or `{ url }` (public
  `https://` or `webcal://`, fetched through `safeFetch`, at most 5 MB), with
  `timeZone` for floating times. Events are matched on their UID (the
  calendar needs a uid property): importing the same feed again updates what
  it imported, and an imported event deleted in Nilo stays deleted. At most
  2000 events; 30 imports an hour per caller. Answers
  `{ created, updated, skipped, simplified }`. An import reads a feed once; to
  keep a calendar in step with one, subscribe to it (below).

**Reading a range** (`lib/calendar/query.ts`) is one SQL query for single
events and one for the series that start before the window ends. Each
calendar's date property is read with a `CASE` on the row's database and
the same start/end reading the views use (`dateMs` in `view-query.ts`); the
window is applied to days for all-day events and to instants otherwise, and
the keyset is `(start, row id)` — an all-day event's start being the local
midnight of its first day — `limit + 1` rows at a time. Series are expanded
in JS past the cursor and merged in (at most 2000 series per request).

**Access.** Reading a calendar follows its database (`resolveDatabaseRole`:
an inline database is as open as its page; one in no page lives in a
teamspace or privately). Listing a workspace's calendars needs membership;
guests reach a calendar by id. Writing an event needs edit access to its row
(`resolvePageAccess`, so a restricted or individually shared row is honoured);
creating one needs edit access to the calendar. A calendar or event the
caller cannot see is `not_found`, never `forbidden`. As in
`GET /databases/:id/rows`, a range read lists the rows of every calendar the
caller can read.

**Writes are row writes.** `POST`, `PATCH`, `DELETE` and imports go through
`lib/databases/row-writes.ts`, shared with `POST /databases/:id/rows` and
`PATCH /pages/:id`: `createPage`/`updatePage` (page activity), two-way
relations, `invalidReference` (attendees must be members or guests of the
workspace; colours must be options), `assigned` notifications and the live
rooms.

## Subscriptions

Most people's events live in Google Calendar, Outlook or iCloud. A
**subscription** keeps a Nilo calendar in step with one of them through the
calendar's secret iCal address (Google: Settings › the calendar › Integrate
calendar › *Secret address in iCal format*; Outlook: Settings › Calendar ›
Shared calendars › *Publish a calendar*, the ICS link; iCloud: share as a
*Public Calendar*; any CalDAV server's ICS link). Nilo's own UI is Settings ›
Calendars (`/settings/calendars`). Code: `lib/calendar/subscriptions.ts`,
`db/schema/calendar-subscriptions.ts`.

**The calendar.** Each subscription makes a database of its own in the
workspace (the personal one by default), private to the subscriber, with a
calendar view and the system calendar's property ids (Name, When, Location,
Link, Description, Repeat, iCal UID) plus Exceptions and Time zone, hidden. It is
**read-only** (`databases.read_only`): every role on it, its rows and their
content is capped at `viewer` (`docs/access.md`), so `/calendar` lists it with
`subscribed: true`, `canEdit: false`, and every write path (`/calendar`,
`/pages`, `/databases`, the editor) refuses. The subscription's id is the
calendar's id. Unsubscribing deletes the calendar and its events.

**A refresh** fetches the feed and applies it when it changed:

- Events are matched on their UID and written only when they differ (title or
  any field), so an unchanged event keeps its `updatedAt` and history. An
  event no longer in the feed is deleted (not trashed). The calendar holds
  what the feed holds, as an import would read it: the same fields, a series
  with an RRULE Nilo supports (an unsupported rule keeps its first occurrence,
  counted as `simplified`), cancelled events left out.
- A document cut short (no `END:VCALENDAR`, or a VEVENT left open) is not
  applied (`incomplete`): a truncated feed would otherwise read as one whose
  events were removed.
- A timed series keeps the **zone** its DTSTART names (TZID; UTC for a `Z`
  time; the subscription's `timeZone` for a floating one) and repeats at that
  zone's wall-clock time whatever zone reads it, so a 09:00 Paris meeting
  stays at 09:00 Paris for a reader in New York across both summer-time
  changes. Other calendars' series repeat in the reader's zone.
- A series keeps its **EXDATEs** as exceptions, and a **changed occurrence**
  (a VEVENT with RECURRENCE-ID) removes that occurrence from the series and,
  unless cancelled, is an event of its own whose UID is
  `<series UID>#<occurrence>`. Range reads leave the exceptions out
  (`isException`: a day for an all-day series; for a timed one, within six
  hours of the instant named); the export writes them back as EXDATE.
- Everything is one transaction, which first locks the subscription's row and
  checks the refresh still holds its lease: a refresh that outlived its lease
  (15 minutes) while another took over writes nothing; `database:changed` (and `workspace:changed`)
  is announced when anything changed, as for any row write.

**When.** Every API task sweeps once a minute and takes up to five due
subscriptions, each held (`refreshing_until`, fifteen minutes) so no two tasks
or requests refresh it at once. A feed is read again after its `Cache-Control`
max-age (else `Expires`), never sooner than 15 minutes nor later than 24
hours, 30 minutes when it says nothing. Requests send the feed's `ETag` and
`Last-Modified` back (`If-None-Match`, `If-Modified-Since`): a 304, or a body
whose SHA-256 is the one last applied, writes nothing. A failure keeps the
calendar as it was, records `lastError` (`unreachable`, `http_error`,
`not_a_calendar`, `incomplete`, `too_large`, `too_many_events`, `unsafe_url`, `internal`)
and backs off: 15 minutes, doubling, to a day. The subscriber can refresh at
once (`POST …/refresh`), at most once a minute.

**Fetching safely.** A subscription's URL is user-supplied, so it is fetched
as `safeFetch` fetches (`lib/safe-fetch.ts`) under `FEED_POLICY`: `https` only
(`webcal://` and `webcals://` are read as `https://`), port 443, no
credentials in the URL and none sent (no cookies, no Authorization); every
address a name resolves to must be public (no loopback, private, link-local,
CGNAT, metadata or reserved range, IPv4-mapped IPv6 included), checked at
connection time on the address actually used and again on every redirect (at
most five); at most `CALENDAR_IMPORT_MAX_BYTES` (5 MB) and 20 seconds; at
most `CALENDAR_IMPORT_MAX_EVENTS` events.

**The URL is a secret** (whoever holds it reads the calendar). It is stored
only sealed with AES-256-GCM under `CALENDAR_FEED_KEY`
(`lib/calendar/feed-secret.ts`, `docs/deployment.md`), deduplicated per person
by an HMAC under a key derived from it, never logged (a failed refresh logs
its error with the URL and its path taken out, `scrubbedError`), and never
answered: the API shows its `host` only. Without the key the routes answer 503
`service_unavailable` and the sweep does not start.

**API** (each needs the session; a subscription is its subscriber's alone,
`not_found` to anyone else):

- `GET /calendar/subscriptions?workspaceId` — `{ items, nextCursor: null }`.
- `POST /calendar/subscriptions { url, name?, workspaceId?, timeZone? }` → 201.
  The feed is fetched before anything is made: a URL Nilo will not fetch is
  `validation_failed` (`field: url`), one that does not answer with a
  calendar `import_unreachable` (`details.reason`), the same feed twice
  `conflict` (`details.calendarId`), more than 25 subscriptions
  `validation_failed`. The calendar is named `name`, else the feed's
  `X-WR-CALNAME`, else its host; `timeZone` (default UTC) reads its floating
  times. 20 an hour per caller.
- `GET /calendar/subscriptions/:id`, `PATCH { name }` (renames the calendar),
  `DELETE` → 204.
- `POST /calendar/subscriptions/:id/refresh` → the subscription after the
  refresh (a failed feed is its `status`, not an error); within a minute of
  the last attempt `rate_limited` with `details.retryAfterSeconds`; while
  another refresh holds it `conflict`.

The SDK has `calendar.listSubscriptions`, `getSubscription`, `subscribe`,
`updateSubscription`, `refreshSubscription` and `unsubscribe`.

## Live updates

Every write announces `database:changed` (`{ databaseId }`) to the calendar's
room, and title or trash changes `workspace:changed`, on the API's Socket.IO
server (`docs/collaboration.md`). A client authenticated with its Oxy
session joins with `database:join <calendarId>` (anyone who can read the
database) and re-reads the range when told: the events carry ids only. The
SDK is fetch-only; a client that wants live updates connects Socket.IO
itself.

## The SDK: `@oxy.so/nilo`

`packages/sdk`: a typed client over the routes above and
`GET /workspaces/personal`, its types and schemas from
`@oxy.so/nilo-contracts`. Inputs are checked against the contract before they
are sent and every answer is parsed with it.

```ts
import { createNiloClient, NiloApiError } from '@oxy.so/nilo';

// One linked client per backend, as every Oxy app does
// (`~/Oxy/docs/session-architecture.md`): its fetch carries the session's
// bearer and refreshes it on a 401; the session stays in Oxy's SDK.
const linked = oxyServices.createLinkedClient({ baseURL: NILO_API_URL });
const nilo = createNiloClient({ baseURL: NILO_API_URL, fetch: linked.fetch });

const [calendar] = await nilo.calendar.listCalendars(); // the default one first
const page = await nilo.calendar.listEvents({
  from: '2026-11-01T00:00:00Z',
  to: '2026-12-01T00:00:00Z',
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
});
for await (const event of nilo.calendar.iterateEvents({ from, to, timeZone })) { … }
const event = await nilo.calendar.createEvent({ title: 'Dentist', start, end });
await nilo.calendar.updateEvent(event.rowId, { start: later });
await nilo.calendar.deleteEvent(event.rowId);
```

- `createNiloClient({ baseURL, fetch?, getAccessToken?, timeoutMs?, headers? })`
  — `fetch` (a linked client's) or `getAccessToken` (asked before every
  request, never kept). There is no default base URL: Nilo has no public
  production origin yet (`docs/api-reference.md`).
- `workspaces.personal()`.
- `calendar.listCalendars({ workspaceId? })`, `getCalendar(id)`,
  `listEvents(query)`, `iterateEvents(query)` (throws if a cursor repeats),
  `getEvent(rowId)`, `createEvent(input)`, `updateEvent(rowId, patch)`,
  `deleteEvent(rowId)`, `exportIcs(calendarId)`, `importIcs(calendarId, { ics | url })`.
- Errors: `NiloApiError` (`code`, `status`, `details`, `retryAfterSeconds`),
  `NiloValidationError` (refused before sending), `NiloResponseError` (an
  answer that does not match the contract), `NiloNetworkError`,
  `NiloTimeoutError`. A body Nilo did not write maps by status.

It ships its TypeScript source, like `@oxy.so/nilo-contracts`, for bundlers
(Metro, Vite, Bun). It is `private` until its first release. Its calendar contract is on npm from
`@oxy.so/nilo-contracts` 0.3.0, so publishing it is flipping `private` off,
once the owner has set up its npm trusted publisher
(`~/Oxy/docs/npm-releases.md`).

Tests: `packages/sdk/src/client.test.ts` (unit), and
`e2e/calendar-sdk.test.ts`, the SDK against the real routes on PostgreSQL.

## Not yet

Exceptions to a series and single-occurrence edits outside a subscribed
calendar; per-event time zones;
attendees by email and RSVP; reminders on events (Nilo's page reminders
exist, `/pages/:id/reminders`, but `/calendar` does not expose them); a
subscribable `.ics` URL (the export needs the session). Subscriptions read
neither RDATE nor a timed series' date-only EXDATE, and expand a series
past an unsupported RRULE only to its first occurrence.
