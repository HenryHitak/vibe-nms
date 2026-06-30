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

Default login:

```text
ID: admin
Password: admin
Role: ADMIN
```

After first login, go to `User Accounts` and create normal `USER` accounts for operators. `USER` accounts are read-only. `ADMIN` accounts can manage devices, imports, exports, alerts, settings, and users.

`User Accounts` shows each user's last login time and last login IP. `Audit Logs` shows the source IP for every login, CRUD change, import, export, alert action, and settings change.

This package contains:

- FastAPI backend with MS SQL Server storage for deployment and SQLite fallback for local development
- Background ping collector
- Device CRUD with soft delete and restore
- CRUD audit logs with username, role, source IP, user agent, before/after data, request id, and result
- Excel template, import preview, import commit, Excel export, full backup zip, migration JSON
- Alert Center with acknowledge and resolve actions
- Login with ADMIN / USER roles
- Admin user account creation, disable, and password reset
- React dashboard/admin UI with green, orange, red, and gray device states
- Docker Compose packaging for internal server deployment

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
NMS_MSSQL_USERNAME=sa
NMS_MSSQL_PASSWORD=ChangeThisStrongPassword!123
NMS_MSSQL_DRIVER=ODBC Driver 18 for SQL Server
NMS_MSSQL_TRUST_SERVER_CERTIFICATE=true
NMS_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,http://127.0.0.1:5177,http://localhost
NMS_TRUSTED_PROXY_IPS=10.0.0.10,10.0.0.11
NMS_CORPORATE_NETWORKS=10.0.0.0/8,172.16.0.0/12,192.168.0.0/16
NMS_COLLECTOR_ENABLED=true
NMS_COLLECTOR_INTERVAL_SECONDS=30
NMS_COLLECTOR_TIMEOUT_MS=1000
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
DELETE /api/users/{id}
```

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
