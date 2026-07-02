# Vibe NMS

Internal Network Monitoring Software for plant networks.

## Documentation

- [Operations documentation](docs/README.md)
- [Workflow diagrams](docs/workflow-diagrams.md)
- [Operation and usage guide](docs/operation-and-usage.md)
- [Device, IP, AP, Switch, Cisco Controller model](docs/easy-device-network-model.md)
- [Backend workflow](docs/backend-workflow.md)
- [Monitoring workflow](docs/monitoring-workflow.md)
- [Dashboard API workflow](docs/dashboard-api-workflow.md)
- [Input normalization](docs/input-normalization.md)

## Download and Run from GitHub

On the company PC or internal server:

```bash
git clone https://github.com/henryhitak/vibe-nms.git
cd vibe-nms
docker compose up -d --build
```

Open:

```text
http://localhost:8080
```

Other company PCs must use the server PC's IPv4 address, for example `http://10.10.1.25:8080`. The installer prints the detected company-network URLs and writes them to the desktop file `Vibe NMS Network URLs.txt`.

Default login:

```text
ID: admin
Password: admin
Role: ADMIN
```

After first login, go to `User Accounts` and create normal `USER` accounts for operators. `USER` accounts are read-only. `ADMIN` accounts can manage devices, imports, exports, alerts, settings, and users.

`User Accounts` shows each user's last login time and last login IP. `Audit Logs` shows the source IP for every login, CRUD change, import, export, alert action, and settings change.

Excel device import/export is managed from `Device Master`:

- `Template`: download the device import template.
- `Excel Import`: upload and preview a device workbook, then commit valid rows.
- `Excel Export`: download the current device list as `devices.xlsx`.

Text values are normalized before save and matching. Leading/trailing spaces are ignored for manual forms, Excel import, filters, external API payloads, backend collector observations, and `.env` config values. Optional fields that contain only spaces are treated as empty. See [Input normalization](docs/input-normalization.md).

Device Master starts with `Device Type`. Select the type first, then the form opens only the fields that match that device type. Enter only confirmed information:

- `AP`: AP management IP, AP vendor/controller details, and switch uplink if known. Do not enter a separate connected AP IP for an AP.
- Non-AP devices: device IP/MAC/hostname plus `Expected AP Name/IP` when known, so AP Clients can group and verify them under the correct AP.
- Switch fields are shown only for device types where a switch/port relationship is normally useful.

## Monitoring Behavior

The backend collector continuously monitors every registered active device IP.

```text
Included: every network_devices row where is_deleted = 0 and ip_address is not empty
Excluded: soft-deleted devices only
```

Do not rely on the browser for ping checks. The browser only displays data. The backend collector performs network checks inside the corporate network and writes every check into `device_metrics`.

If a single registered IP drops, the collector creates an ACTIVE warning alert after the first failed check, and the dashboard banner shows it on the next refresh. If multiple alerts happen in the same Plant, the banner rolls the message up to Plant-level impact.

ADMIN users can open `Settings > Alarm Settings` to turn alert creation on or off by type. Disabling an alarm type stops new alerts, immediately resolves active alerts for that type, and clears unread notifications tied to that type.

`Alert Center` shows the Notification List. Only the notification list scrolls; the outer Alert Center page stays fixed. ADMIN users can mute a specific notification type or mark notifications as read. Muting does not delete or resolve alerts; it only stops new dashboard notifications for that alert type until it is unmuted.

UI language is controlled from `Settings > Language Settings`. The default language is English, and the available browser UI languages are English, Korean, and Spanish. The selection is saved in the browser.

Sidebar menu order can be changed by dragging menu items. Main menu items can be reordered inside the main section, and ADMIN items can be reordered inside the ADMIN section. The custom menu order is saved in the browser.

All data tables support horizontal column resizing. Drag the divider on a table header to make a column wider or narrower; the width is saved in the browser for that page.

The main menu shows `Dashboard` and `Alert Center`. `Traffic Graphs`, `AP Clients`, user management, Device Master, logs, DB Config, Backend Info, and Settings are under the `ADMIN` section and require an ADMIN account.

ADMIN users can double-click the top-right `ADMIN / IP` user information to open the Source Map. The Source Map shows where dashboard data comes from: database tables, backend workers, API endpoints, latest ping result, latest traffic source, AP client observations, audit logs, and import history. Device IP cells in Dashboard, Device Master, and Traffic Graphs also open a device-specific Source Map on double-click.

## Main Dashboard Layout

The main dashboard is focused on live device operations:

- Left side: full registered device list.
- Right side: offline ping list, approximately 30% of the page width on desktop.
- The offline ping panel can be hidden; when hidden, `Offline Ping: count` appears next to the Devices title and opens the panel again.
- Device list order: latest monitoring check or manual update first.
- Dashboard device status is displayed as `ONLINE` or `OFFLINE` only.
- Offline ping list includes devices whose raw monitoring status is OFFLINE/CRITICAL or whose packet loss is 100%.
- Dashboard and Offline Ping tables show only Status, Device, Type, IP, Plant, and Line. AP, Switch, and ICMP Loss stay available in hover preview and detail views.
- Devices can be multi-selected with checkboxes. Click `Selected: count` to open a modal that lists all selected device information.
- Dashboard search checks device name, type, status, IP, MAC, hostname, Plant, Line, location, AP, Switch, VLAN, owner, criticality, latest check, reason, and notes. Matching devices appear under the search box while typing.
- Press `Enter` or click `Confirm` in the dashboard search box to apply the search to the device list. It does not open device detail.
- The dashboard refreshes from backend monitoring data every 60 seconds. The browser does not ping devices directly.

## AP Client Discovery

The backend also runs a separate AP Client Discovery collector. It is independent from the ping monitoring worker.

Registered access points are `Device Master` rows where `Device Type` is `AP` and `Monitoring Enabled` is on. The collector reads AP/controller data from the backend network only; the browser never scans the network.

MVP provider:

```text
NMS_AP_CLIENT_DEFAULT_PROVIDER=not-configured
```

The default AP client provider is not configured, so fake demo clients are not generated. For production, set the AP row's `AP Controller Type` to one of:

```text
meraki-api
aruba-central-api
unifi-api
cisco-wlc
generic-snmp
generic-api
```

Controller credentials stay in backend environment variables only:

```text
NMS_MERAKI_API_TOKEN=
NMS_ARUBA_CENTRAL_API_TOKEN=
NMS_UNIFI_API_TOKEN=
NMS_CISCO_WLC_API_TOKEN=
NMS_GENERIC_API_TOKEN=
```

Use read-only controller/API tokens whenever possible. These tokens are never returned to the frontend.

Open `AP Clients` to see each AP's status, connected client count, known/unknown counts, connected IP list, MAC, hostname, SSID, VLAN, RSSI, last seen time, and status. Admins can manually run discovery from that page; manual runs are written to `Audit Logs` with username and source IP.

`AP Clients` is a monitoring-only screen. It does not create, edit, or delete client records. To register a known wireless device, add it in `Device Master`, select the correct device type such as `PC`, `LAPTOP`, `MOBILE`, `TABLET`, `SCANNER`, or `IOT`, and enter expected AP information only when it is confirmed.

## Traffic Graphs

`Traffic Graphs` shows TX/RX traffic by device, Plant, and Line.

It includes:

- Current RX and TX
- RX min / avg / max
- TX min / avg / max
- TX/RX trend graph
- Top traffic devices
- Date range filtering
- Per-minute and hourly graph buckets
- Latest interface traffic table with Device, IP, AP, Switch, interface, source, and last collected time

The top KPI area shows `Current RX`, `RX Min`, `RX Avg`, `RX Max`, `Current TX`, `TX Min`, `TX Avg`, and `TX Max` as separate cards for the selected date range.

The browser does not collect traffic directly. The backend traffic collector writes snapshots to `network_traffic_metrics`, and the UI reads them from:

```text
GET /api/traffic/summary
POST /api/traffic/run
GET /api/traffic/config
PUT /api/traffic/config
POST /api/traffic/observations
```

Date range and bucket example:

```text
GET /api/traffic/summary?date_from=2026-06-30T08:00&date_to=2026-06-30T17:00&bucket=hour
```

Traffic date filters are interpreted in `NMS_TIME_ZONE` (`America/Tijuana` by default).

Default provider:

```text
NMS_TRAFFIC_DEFAULT_PROVIDER=not-configured
```

Fake demo traffic is not generated by default. For production, use a backend-only controller/SNMP/API source or push real observations to `POST /api/traffic/observations`, and keep tokens in `.env`, not in the frontend.

Production installer builds set `NMS_SEED_SAMPLE_DATA=false` so a new company install starts with real imported devices only. Existing traffic source settings are preserved during reinstall/update.

Real monitoring startup order:

1. Install Vibe NMS on a PC/server inside the corporate network.
2. Import or create real devices in `Device Master`.
3. Confirm `monitoring_enabled` is ON for devices that should be checked.
4. Let the backend ping worker update device ONLINE/WARNING/OFFLINE status.
5. For traffic graphs, either configure `Traffic Graphs > Traffic Source` or POST real observations to `/api/traffic/observations`.

To push real traffic observations from an internal collector:

```json
{
  "observations": [
    {
      "ip_address": "105.102.8.106",
      "interface_name": "Gi1/0/4",
      "rx_bps": 12500000,
      "tx_bps": 4200000,
      "source": "cisco-controller"
    }
  ]
}
```

Send it to:

```text
POST /api/traffic/observations
```

The backend matches the observation to `network_devices` by `device_id`, `ip_address`, or `device_name`.

## Windows Installer Without Docker

You can run Vibe NMS without Docker on a Windows PC or Windows Server.

Build the installer package from this repo:

```powershell
.\build_windows_installer.ps1
```

This creates:

```text
vibe-nms-windows-installer.zip
```

Do not use GitHub `Code > Download ZIP` as the installer. Use the release asset named `vibe-nms-windows-installer.zip`.

On the target PC, extract `vibe-nms-windows-installer.zip` and run the root file:

```text
Install Vibe NMS.exe
```

Do not run `server\vibe-nms-server.exe` directly. That file is the backend runtime used internally by the installed Windows Scheduled Task.

Do not double-click `.ps1` files. On some company PCs they open in VS Code or Notepad. The `.exe` launcher handles PowerShell and administrator permission automatically.

Open:

```text
http://localhost:8080
```

Default login:

```text
ID: admin
Password: admin
```

The installer registers a Windows Scheduled Task named `VibeNMS` so ping monitoring and AP Client Discovery keep running in the background. Docker and Node.js are not required on the target PC. For production, install it on a PC or server that stays powered on inside the corporate network.

Backend runtime:

```text
Scheduled Task: VibeNMS
Runner: C:\Program Files\Vibe NMS\service\run-vibe-nms.ps1
Backend EXE: C:\Program Files\Vibe NMS\server\vibe-nms-server.exe
Config: C:\Program Files\Vibe NMS\.env
Default URL: http://localhost:8080
```

Default SQL storage for the Windows installer is SQLite:

```text
C:\Program Files\Vibe NMS\data\nms.sqlite
```

If `NMS_DATABASE_ENGINE=mssql` is set in `.env`, SQL runs on the configured MS SQL Server instead:

```text
NMS_MSSQL_SERVER=localhost\SQLEXPRESS
NMS_MSSQL_PORT=
NMS_MSSQL_DATABASE=vibe_nms
NMS_MSSQL_AUTH=sql
NMS_MSSQL_USERNAME=sa
NMS_MSSQL_PASSWORD=your-password
NMS_MSSQL_DRIVER=ODBC Driver 18 for SQL Server
NMS_MSSQL_ENCRYPT=true
NMS_MSSQL_TRUST_SERVER_CERTIFICATE=true
```

Admins can open `DB Config` in the app to use the SQL Server 2025 Express profile, test the connection, and save database settings to `C:\Program Files\Vibe NMS\.env`. Restart the `VibeNMS` scheduled task after saving. `Backend Info` shows the live backend process, database target, worker status, and API paths. ADMIN users can also change the ping monitoring interval there with a 30, 40, 50, 60, 70, 80, or 90 second option box. The same runtime data is available from `GET /api/backend/runtime` with an ADMIN bearer token.

SQL Server 2025 Express design notes:

- Named instance profile: `localhost\SQLEXPRESS` with blank `NMS_MSSQL_PORT`.
- Fixed TCP profile: set `NMS_MSSQL_SERVER` to the SQL host and `NMS_MSSQL_PORT=1433`.
- Supports SQL Login and Windows Auth through `NMS_MSSQL_AUTH=sql` or `windows`.
- Uses `DATETIME2`, `NVARCHAR(MAX)`, `IDENTITY`, normal indexes, and foreign keys; it does not require SQL Agent, CLR, replication, or Enterprise features.
- Backend creates the `vibe_nms` database and schema at startup when the configured login has permission.

This package contains:

- FastAPI backend with MS SQL Server storage for deployment and SQLite fallback for local development
- Background ping collector
- Separate AP client discovery collector with provider adapters
- Device CRUD with soft delete and restore
- CRUD audit logs with username, role, source IP, user agent, before/after data, request id, and result
- Excel template, import preview, import commit, Excel export, full backup zip, migration JSON
- Alert Center notification history with ADMIN mark-read and per-alert-type mute/unmute
- Login with ADMIN / USER roles
- Admin user account creation, disable, and password reset
- React dashboard/admin UI with green, orange, red, and gray device states
- Shared admin layout scrolling so Settings, logs, tables, and forms remain readable on smaller screens
- Docker Compose packaging for internal server deployment
- Windows installer package build script for non-Docker deployment

## Local Development

Backend:

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Open:

```text
http://localhost:5173
```

The Vite dev server proxies `/api` to `http://localhost:8000`.

Local development uses SQLite unless `NMS_DATABASE_ENGINE=mssql` is set.

Default bootstrap login:

```text
Username: admin
Password: admin
Role: ADMIN
```

## External Display Dashboard API

Use this when another PC, TV screen, browser kiosk, or internal web page needs to show the live dashboard without using the admin console.

Display page:

```text
http://SERVER_IP:8080/display
```

Optional filters:

```text
http://SERVER_IP:8080/display?plant=Main%20Plant
http://SERVER_IP:8080/display?plant=Main%20Plant&line=Assembly%20Line%201
```

Read-only JSON API:

```text
GET /api/display/dashboard
GET /api/display/dashboard?plant=Main%20Plant&line=Assembly%20Line%201
POST /api/display/dashboard
```

POST body example:

```json
{
  "plant": "Main Plant",
  "line": "Assembly Line 1",
  "status": "OFFLINE",
  "device_limit": 200,
  "alert_limit": 20,
  "metric_limit": 60,
  "include_ap": true
}
```

Response includes:

```text
summary.status_counts
devices
recent_alerts
recent_metrics
by_ap
```

Security:

```text
NMS_DISPLAY_API_TOKEN=
```

If `NMS_DISPLAY_API_TOKEN` is empty, the display API is open as read-only on the internal network. If a token is set, call it with one of:

```text
GET /api/display/dashboard?token=YOUR_TOKEN
X-NMS-Display-Token: YOUR_TOKEN
```

## Docker Compose Deployment

```bash
cp .env.example .env
docker compose up -d --build
```

Open:

```text
http://SERVER_IP:8080
```

Docker Compose starts MS SQL Server 2022 Express and the backend creates the `vibe_nms` database/schema on startup. SQL Server data is stored in the `nms-mssql-data` Docker volume.

## Intranet Embedding

The frontend expects API calls under `/api`. Put this behind the company intranet reverse proxy with:

```text
/      -> frontend container
/api   -> backend container
```

When using trusted internal proxies, set:

```text
NMS_TRUSTED_PROXY_IPS=10.0.0.10,10.0.0.11
```

The backend only trusts `X-Forwarded-For` and `X-Real-IP` when the direct client IP is in `NMS_TRUSTED_PROXY_IPS`. Otherwise it uses `request.client.host`.

If the app is behind nginx, a VPN, or an intranet reverse proxy, the backend may see the proxy IP instead of the user's PC IP. Add only trusted proxy IPs to `NMS_TRUSTED_PROXY_IPS` so `X-Forwarded-For` can be used safely.

## Environment Variables

Common settings:

```text
NMS_DATABASE_ENGINE=mssql
NMS_DATABASE_PATH=/app/data/nms.sqlite
NMS_MSSQL_SERVER=mssql
NMS_MSSQL_PORT=1433
NMS_MSSQL_DATABASE=vibe_nms
NMS_MSSQL_AUTH=sql
NMS_MSSQL_USERNAME=sa
NMS_MSSQL_PASSWORD=ChangeThisStrongPassword!123
NMS_MSSQL_DRIVER=ODBC Driver 18 for SQL Server
NMS_MSSQL_ENCRYPT=true
NMS_MSSQL_TRUST_SERVER_CERTIFICATE=true
NMS_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,http://127.0.0.1:5177,http://localhost
NMS_TRUSTED_PROXY_IPS=10.0.0.10,10.0.0.11
NMS_CORPORATE_NETWORKS=10.0.0.0/8,172.16.0.0/12,192.168.0.0/16
NMS_TIME_ZONE=America/Tijuana
NMS_COLLECTOR_ENABLED=true
NMS_COLLECTOR_INTERVAL_SECONDS=60
NMS_COLLECTOR_TIMEOUT_MS=1000
NMS_PING_COUNT=3
NMS_TCP_FALLBACK_PORTS=445,3389,80,443
NMS_WARNING_LATENCY_MS=150
NMS_CRITICAL_LATENCY_MS=500
NMS_WARNING_PACKET_LOSS_PERCENT=5
NMS_TRAFFIC_COLLECTION_ENABLED=true
NMS_TRAFFIC_COLLECTION_INTERVAL_SECONDS=60
NMS_TRAFFIC_DEFAULT_PROVIDER=not-configured
NMS_TRAFFIC_GENERIC_API_URL=
NMS_TRAFFIC_GENERIC_API_TOKEN=
NMS_DEFAULT_ROLE=USER
NMS_SEED_SAMPLE_DATA=true
NMS_AUTH_SECRET=change-this-to-a-long-random-secret
NMS_TOKEN_TTL_MINUTES=720
NMS_BOOTSTRAP_ADMIN_USERNAME=admin
NMS_BOOTSTRAP_ADMIN_PASSWORD=admin
NMS_BOOTSTRAP_ADMIN_EMAIL=admin@example.internal
```

`NMS_COLLECTOR_INTERVAL_SECONDS` is the install-time default. During operation, `system_settings.monitoring_interval_seconds` controls the live ping worker interval and can be changed from `Backend Info` or `Settings` without editing `.env`.

UI timestamps are displayed in `NMS_TIME_ZONE`. The Windows installer defaults this to `America/Tijuana` so Audit Logs, Monitoring Logs, Alerts, AP Clients, and Display Dashboard times use the Mexico/Tijuana time base instead of the Windows client timezone.

## Login and Roles

```text
ADMIN = can create/update/delete devices, import/export, manage alerts, change settings, and create USER/ADMIN accounts
USER = read-only Dashboard and Alert Center access. USER menus show only Dashboard and Alert Center, and Alert Center shows the notification list only.
```

All `/api` routes except `/api/auth/login` require a bearer token from login.

Admin user management endpoints:

```text
GET /api/users
POST /api/users
PUT /api/users/{id}
POST /api/users/{id}/reset-password
POST /api/users/{id}/deactivate
DELETE /api/users/{id}
```

`POST /api/users/{id}/deactivate` keeps the account history but blocks login. `DELETE /api/users/{id}` permanently deletes the account row. The backend blocks deleting/deactivating your own active session, the bootstrap admin account, or the last active ADMIN account.

Change `NMS_BOOTSTRAP_ADMIN_PASSWORD` before production deployment.

## Status Rules

Device state colors:

```text
ONLINE = green
WARNING = orange
UNCERTAIN = orange
FLAPPING = orange
OFFLINE = red
CRITICAL = dark red
UNKNOWN = gray
DISABLED = gray
```

Failure count rules:

```text
0 failures = ONLINE
1-2 failures = WARNING
3-4 failures = OFFLINE
5+ failures = CRITICAL when criticality is HIGH or CRITICAL
```

Monitoring uses ICMP ping first. Some company Windows PCs are online but block ICMP ping in Windows Firewall or endpoint security. When ping fails, the backend checks `NMS_TCP_FALLBACK_PORTS`; if one port is reachable, the device is marked `ONLINE` and the log method is `PING+TCP`. The UI label `ICMP Loss` means ping loss only, not necessarily that the PC cannot be used.

If a company uses a non-private internal range such as `105.102.x.x`, add that range to `NMS_CORPORATE_NETWORKS`, for example:

```text
NMS_CORPORATE_NETWORKS=10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,105.102.0.0/16
```

The Windows installer automatically adds the server PC's detected LAN ranges to `NMS_CORPORATE_NETWORKS`.

## Backup and Export

Admin export endpoints:

```text
GET /api/export/devices.xlsx
GET /api/export/plants.xlsx
GET /api/export/access-points.xlsx
GET /api/export/audit-logs.xlsx
GET /api/export/full-backup.zip
GET /api/export/migration.json
```

The full backup zip includes:

```text
devices.xlsx
plants.xlsx
locations.xlsx
production_lines.xlsx
access_points.xlsx
alerts.xlsx
audit_logs.xlsx
nms_config.json
migration.json
database_backup.sqlite
```

When running against MS SQL Server, the full backup includes `mssql_schema.sql` and `migration.json`. Use SQL Server backup tooling for physical `.bak` backups.

Every export writes an audit log with username and source IP.

## Restore and Import

Use `Device Master > Excel Import`:

```text
1. Download devices-template.xlsx
2. Fill plant, line, device type, IP, and only confirmed AP/switch/VLAN/owner/criticality fields
3. Upload the file to preview validation
4. Commit only after validation passes
```

Backend endpoints:

```text
GET /api/import/template/devices.xlsx
POST /api/import/devices/preview
POST /api/import/devices/commit
```

Commit performs upsert by IP address. Rows with validation errors are skipped.

## Release Zip

Windows:

```powershell
.\build_release.ps1
```

Linux/macOS:

```bash
chmod +x build_release.sh
./build_release.sh
```

Output:

```text
vibe-nms-release.zip
```
