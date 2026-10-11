# Ecosystem activity

The backend publishes aggregate traffic and its infrastructure heartbeat to the
Oxy API, which broadcasts changes to the website dashboard. Collection runs in
the service process regardless of whether somebody opens the dashboard.

The publisher starts when the process can authenticate to Oxy at all. On the
infrastructure that is its own identity: an ECS task signs an STS
`GetCallerIdentity` request with its task role, Oxy replays it and mints the
service token (oxy ADR 0026), so a deployed task needs no credential in its
environment. A registered application credential (`OXY_SERVICE_API_KEY` and
`OXY_SERVICE_API_SECRET`) is still accepted and still preferred where it is
present. `AWS_REGION` selects the infrastructure location and ECS sets it.

Neither an attestable workload identity nor a credential — a laptop, a CI box —
emits a warning and starts no publisher; that must not be interpreted as zero
traffic.

HTTP middleware is mounted before body parsers and routers, including public
routes, webhooks, failures and authenticated internal calls. Outgoing fetch and
Node HTTP requests are observed by the shared SDK, including requests made by
background workers. Socket.IO message sends and receives are observed where
this service exposes Socket.IO. Internal/external scope is independent of
inbound/outbound direction; media is a separate activity category.

Only bounded aggregate fields leave the service. No bodies, message contents,
user identifiers, tokens or IP addresses are added to activity events. Visitor
origins represent the Cloudflare edge PoP, not an IP-derived country. Infrastructure
location follows `AWS_REGION`; registration and graceful removal update the
shared inventory, and crashed instances expire through the API registry.

The publisher does not observe database wire traffic, raw TCP, HTTP/2, WebRTC,
or a separate process that has not installed the collector. These transports
must not be represented by fabricated lines.

## Cloudflare web traffic

Oxy measures the `nilo.so` web app's traffic keylessly from Cloudflare's own
analytics (see OxyHQ/oxy `docs/operations/cloudflare-web-activity.md`). This app
holds no Oxy activity secret and its Worker runs no activity code. The
`OXY_EDGE_ACTIVITY_*` bindings were never provisioned and nothing reads them; if
one is ever found on a deployment, delete it.
