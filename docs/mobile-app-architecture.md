# ISP Max Mobile

## Decision

Build the current mobile application natively for Android with Kotlin and Jetpack Compose. Keep the Angular application as the desktop web console and reuse the existing Railway backend. Android is the supported mobile platform for this delivery; iOS remains a separate future product decision.

The mobile app must not be a WebView and must never connect directly to MikroTik, the OLT, GenieACS or an ONU. The data path is:

```text
Kotlin app -> HTTPS / realtime -> ISP Max Railway API -> WispHub / MikroTik / OLT / ACS
                                               |
                                               +-> Windows ONU agent for LAN-only work
```

## Mobile Navigation

Use five stable destinations:

1. `Inicio`: operational KPIs, incidents, collections and pending work.
2. `Clientes`: search, intelligent filters, client workspace and quick actions.
3. `Red`: live monitoring, MikroTik, OLT, ONUs, optical diagnostics and traffic.
4. `Trabajo`: tickets, ONU provisioning jobs, inventory assignments and field tasks.
5. `Mas`: invoices, reports, expenses, payroll, WhatsApp, users and settings.

Global search must find clients, IPs, usernames, ONUs, serial numbers, invoices and tickets. A client opens in a tabbed workspace: summary, service, monitoring, equipment, activity and portfolio. Portfolio is a full-screen sheet on phones and supports filtering, receipt viewing, sharing and printing.

## Functional Coverage

### Phase 1: operator core

- Login, remembered device session, biometric unlock and revocation.
- Dashboard and incident notifications.
- Client search, filters, detail, edits, activation, suspension and ping.
- Portfolio, invoices, receipts and payment status.
- Tickets, maps, GPS and assigned equipment.

### Phase 2: network operations

- Live client status, throughput and historical stability.
- MikroTik health, queues and controlled administrative actions.
- OLT/PON/ONU inventory, optical diagnostics, association and relocation.
- TR-069/OMCI capabilities according to certified ONU profiles.
- ONU provisioning coordination. The Windows agent performs LAN automation; mobile only starts, follows and audits the job.

### Phase 3: administration

- Inventory, expenses and payroll.
- Plans, reports, audit history and exports.
- WhatsApp operations, users, roles and application settings.

## Backend Requirements

- Version the API under `/api/v1` and publish an OpenAPI contract.
- Replace browser-style token handling with short-lived bearer access tokens and rotating refresh tokens.
- Store refresh credentials only in Android Keystore or iOS Keychain and support device revocation.
- Enforce roles and destructive-action permissions on the server, never only in the interface.
- Add pagination, stable filters and compact DTOs; do not send complete historical tables on every screen.
- Use idempotency keys for payments, client changes, OLT actions and provisioning jobs.
- Use WebSocket or SSE for live status and push notifications for incidents, tickets and completed jobs.
- Add mobile device registration, audit metadata and server-side rate limits.
- Keep an encrypted local SQLite cache for read access and safe drafts. Network changes cannot be queued offline.

## Kotlin/Compose Structure

```text
android/app/src/main/java/com/ispmax/mobile/
  data/                # Room, Keystore session and HTTP repositories
  clients/             # clients, portfolio, billing and payments
  network/             # WAN, incidents, MikroTik and OLT views
  onu/                 # local identification and certified adapters
  inventory/           # equipment and assignments
  expenses/            # expense lifecycle
  administration/      # payroll, users and sessions
  ui/                  # theme and shared Compose controls
```

Each feature separates presentation, application and data layers. Repositories own API and Room cache access; ViewModels expose immutable StateFlow state. Use adaptive Material 3 components, phone bottom navigation and tablet navigation rail. Destructive network actions require an explicit confirmation sheet and server permission.

## Quality Gates

- Unit tests for models, repositories, permissions and business rules.
- Compose UI and screenshot tests for phone and tablet layouts.
- Contract tests against the Railway OpenAPI specification.
- Integration tests for login, client actions, invoices and provisioning.
- Real-device validation on supported Android and iOS versions, including slow or interrupted networks.
- Security tests for encrypted storage, revoked sessions, role enforcement and log sanitization.

An iOS release still requires a macOS build runner and Apple signing even if most development is performed on Windows.
