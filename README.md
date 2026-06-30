# Vibe NMS

Internal Network Monitoring Software for plant networks.

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

## Monitoring Behavior

The backend collector continuously monitors every registered active device IP.

```text
Included: every network_devices row where is_deleted = 0 and ip_address is not empty
Excluded: soft-deleted devices only
```

Do not rely on the browser for ping checks. The browser only displays data. The backend collector performs network checks inside the corporate network and writes every check into `device_metrics`.

If a single registered IP drops, the collector creates an ACTIVE warning alert after the first failed check, and the dashboard banner shows it on the next refresh. If multiple alerts happen in the same Plant, the banner rolls the message up to Plant-level impact.

## AP Client Discovery

The backend also runs a separate AP Client Discovery collector. It is independent from the ping monitoring worker.

Registered access points are `Device Master` rows where `Device Type` is `AP` and `Monitoring Enabled` is on. The collector reads AP/controller data from the backend network only; the browser never scans the network.

MVP provider:

```text
NMS_AP_CLIENT_DEFAULT_PROVIDER=demo
```

The demo provider uses registered device AP mappings for local testing. For production, set the AP row's `AP Controller Type` to one of:

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

Admins can also use `AP Clients` as a CRUD screen for known wireless clients. Registering an observed client creates a `network_devices` row tied to the selected AP, so future discovery runs can mark it as known, detect wrong AP connections, and monitor missing critical clients.

AP client CRUD endpoints:

```text
GET /api/access-points/{ap_id}/registered-clients
POST /api/access-points/{ap_id}/registered-clients
PUT /api/access-points/{ap_id}/registered-clients/{device_id}
DELETE /api/access-points/{ap_id}/registered-clients/{device_id}
```

Deleting a registered AP client soft-deletes the underlying Device Master row and writes an audit log.

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

Admins can open `DB Config` in the app to use the SQL Server 2025 Express profile, test the connection, and save database settings to `C:\Program Files\Vibe NMS\.env`. Restart the `VibeNMS` scheduled task after saving. `Backend Info` shows the live backend process, database target, worker status, and API paths. The same data is available from `GET /api/backend/runtime` with an ADMIN bearer token.

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
- Alert Center with acknowledge and resolve actions
- Login with ADMIN / USER roles
- Admin user account creation, disable, and password reset
- React dashboard/admin UI with green, orange, red, and gray device states
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
NMS_COLLECTOR_INTERVAL_SECONDS=30
NMS_COLLECTOR_TIMEOUT_MS=1000
NMS_PING_COUNT=3
NMS_TCP_FALLBACK_PORTS=445,3389,80,443
NMS_WARNING_LATENCY_MS=150
NMS_CRITICAL_LATENCY_MS=500
NMS_WARNING_PACKET_LOSS_PERCENT=5
NMS_DEFAULT_ROLE=USER
NMS_SEED_SAMPLE_DATA=true
NMS_AUTH_SECRET=change-this-to-a-long-random-secret
NMS_TOKEN_TTL_MINUTES=720
NMS_BOOTSTRAP_ADMIN_USERNAME=admin
NMS_BOOTSTRAP_ADMIN_PASSWORD=admin
NMS_BOOTSTRAP_ADMIN_EMAIL=admin@example.internal
```

UI timestamps are displayed in `NMS_TIME_ZONE`. The Windows installer defaults this to `America/Tijuana` so Audit Logs, Monitoring Logs, Alerts, AP Clients, and Display Dashboard times use the Mexico/Tijuana time base instead of the Windows client timezone.

## Login and Roles

```text
ADMIN = can create/update/delete devices, import/export, manage alerts, change settings, and create USER/ADMIN accounts
USER = read-only dashboard and alert center access
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

Use the Excel import screen:

```text
1. Download devices-template.xlsx
2. Fill plant, line, AP, IP, switch, VLAN, owner, criticality, and monitoring fields
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
