# Ecosystem activity

The backend publishes aggregate traffic and its infrastructure heartbeat to the
Oxy API, which broadcasts changes to the website dashboard. Collection runs in
the service process regardless of whether somebody opens the dashboard.

The publisher uses the shared workload transport. On deployed infrastructure,
Oxy validates the process's attested role against its registered application and
explicit environment. Local development can use a registered temporary IAM role
through the AWS credential chain, including SSO. Customer API keys are not an
internal fallback. `AWS_REGION` (or `AWS_DEFAULT_REGION`) selects the infrastructure location.
Without a region, optional collection stays off; no location is fabricated.

Credential resolution is lazy and shared; bootstrap does not infer capability
from ECS environment variables or disable collection merely because the host is a developer machine. Registration failures remain visible through the collector's normal
retry and status behavior. No heartbeat represents fabricated traffic.

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
