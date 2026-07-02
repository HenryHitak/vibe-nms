# Vibe NMS Windows Installer

This package runs Vibe NMS without Docker.

Use the GitHub Release asset named `vibe-nms-windows-installer.zip`. Do not use GitHub `Code > Download ZIP` as the installer.

## Install

Extract `vibe-nms-windows-installer.zip`, then run the root file:

```text
Install Vibe NMS.exe
```

If Windows asks for administrator permission, approve it. Do not double-click `.ps1` files; on some company PCs those files open in VS Code or Notepad.

Do not run `server\vibe-nms-server.exe` directly. That file is the backend runtime used internally by the installed Windows Scheduled Task.

To check whether the server is installed, running, and where it is located, run the root file:

```text
Check Vibe NMS Status.exe
```

It shows the install folder, Scheduled Task state, port 8080 listener, health check result, dashboard URL, and start/stop commands.

Open:

```text
http://localhost:8080
```

Other company PCs must use the server PC's IPv4 address, for example:

```text
http://10.10.1.25:8080
```

The installer prints the detected company-network URLs and writes them to the desktop file `Vibe NMS Network URLs.txt`.

Default login:

```text
ID: admin
Password: admin
```

The installer registers a Windows Scheduled Task named `VibeNMS`. It starts on boot and runs the backend collector inside the corporate network.

Backend runtime:

```text
Scheduled Task: VibeNMS
Runner: C:\Program Files\Vibe NMS\service\run-vibe-nms.ps1
Backend EXE: C:\Program Files\Vibe NMS\server\vibe-nms-server.exe
Config: C:\Program Files\Vibe NMS\.env
Default SQLite DB: C:\Program Files\Vibe NMS\data\nms.sqlite
```

Admins can open `Backend Info` in the app to see where the backend and SQL database are running. ADMIN users can also change the ping monitoring interval there with a 30, 40, 50, 60, 70, 80, or 90 second option box.

Device Excel import/export is inside `Device Master`:

```text
Device Master > Template
Device Master > Excel Import
Device Master > Excel Export
```

Alarm controls are inside `Settings > Alarm Settings`. Turning an alarm type off stops new alerts for that type and resolves active alerts for that type during the next collector cycle.

## Configure

Edit:

```text
C:\Program Files\Vibe NMS\.env
```

For a simple local install, SQLite is used by default:

```text
NMS_DATABASE_ENGINE=sqlite
NMS_DATABASE_PATH=C:\Program Files\Vibe NMS\data\nms.sqlite
```

The installer writes the detected company LAN ranges to:

```text
NMS_CORPORATE_NETWORKS=...
```

If devices use another internal range, add it here. Example:

```text
NMS_CORPORATE_NETWORKS=10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,105.102.0.0/16
```

Monitoring uses ICMP ping first. If a Windows PC blocks ping but is still reachable, Vibe NMS checks these backend-only TCP fallback ports:

```text
NMS_TCP_FALLBACK_PORTS=445,3389,80,443
```

If one fallback port responds, the device is marked `ONLINE` and Monitoring Logs show method `PING+TCP`.

Traffic Graphs:

```text
NMS_TRAFFIC_COLLECTION_ENABLED=true
NMS_TRAFFIC_COLLECTION_INTERVAL_SECONDS=60
NMS_TRAFFIC_DEFAULT_PROVIDER=not-configured
NMS_TRAFFIC_GENERIC_API_URL=
NMS_TRAFFIC_GENERIC_API_TOKEN=
NMS_SEED_SAMPLE_DATA=false
```

`Traffic Graphs` shows TX/RX current, min, avg, max, trend, and top traffic devices. The default provider is `not-configured`, so fake demo traffic is not generated. For production, connect a controller/SNMP/API collector or push real observations to `POST /api/traffic/observations`, and keep API tokens in backend `.env` only.

The top KPI cards show `Current RX`, `RX Min`, `RX Avg`, `RX Max`, `Current TX`, `TX Min`, `TX Avg`, and `TX Max` separately for the selected date range.

New production installs set `NMS_SEED_SAMPLE_DATA=false`; the dashboard starts from devices you import or create. Reinstalling the package preserves existing traffic source settings.

Traffic graphs support date range filtering and per-minute/per-hour buckets. Date filters use the Mexico/Tijuana time base:

```text
GET /api/traffic/summary?date_from=2026-06-30T08:00&date_to=2026-06-30T17:00&bucket=hour
```

To test real traffic data from an internal collector, POST observations to:

```text
POST /api/traffic/observations
```

The backend matches observations by `device_id`, `ip_address`, or `device_name`.

Main dashboard layout:

- Left side: full registered device list.
- Right side: offline ping list, about 30% of desktop width, with a hide button. When hidden, `Offline Ping: count` appears next to the Devices title and opens the panel again.
- Device list order: latest monitoring check or manual update first.
- Offline ping list includes red OFFLINE/CRITICAL devices and devices with 100% packet loss.
- Dashboard and Offline Ping tables show Status, Device, Type, IP, Plant, and Line only.
- Dashboard search applies the typed value to the device list when Enter is pressed or Confirm is clicked. It does not open device detail.
- Backend ping monitoring runs every 60 seconds by default:

```text
NMS_COLLECTOR_INTERVAL_SECONDS=60
```

`NMS_COLLECTOR_INTERVAL_SECONDS` is the install-time default. During operation, `system_settings.monitoring_interval_seconds` controls the live ping worker interval and can be changed from `Backend Info` or `Settings` without editing `.env`.

Screen timestamps use Mexico/Tijuana by default:

```text
NMS_TIME_ZONE=America/Tijuana
```

This affects Audit Logs, Monitoring Logs, Alerts, AP Clients, and Display Dashboard display times. Audit Logs date filters are also interpreted in this timezone.

For SQL Server 2025 Express, use the in-app screen:

```text
Admin menu -> DB Config
```

Recommended SQL Server 2025 Express settings:

```text
NMS_DATABASE_ENGINE=mssql
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

Leave `NMS_MSSQL_PORT` blank for the default `SQLEXPRESS` named instance. Use `1433` only when SQL Server Express is configured with a fixed TCP port. After saving DB Config, restart the scheduled task:

```powershell
Stop-ScheduledTask -TaskName VibeNMS
Start-ScheduledTask -TaskName VibeNMS
```

AP controller API tokens also go in `.env`; they are only read by the backend process and are not exposed to the browser.

`AP Clients` is a monitoring-only screen. To register or edit a known wireless device, use `Device Master` and enter the expected AP information there.

External display dashboard:

```text
http://SERVER_IP:8080/display
GET  /api/display/dashboard
POST /api/display/dashboard
```

Optional read-only display API token:

```text
NMS_DISPLAY_API_TOKEN=
```

If the token is set, use:

```text
http://SERVER_IP:8080/display?token=YOUR_TOKEN
```

After editing `.env`, restart the task:

```powershell
Stop-ScheduledTask -TaskName VibeNMS
Start-ScheduledTask -TaskName VibeNMS
```

## Uninstall

Run:

```text
Uninstall Vibe NMS.exe
```

Advanced option, keep data during uninstall:

```powershell
.\installer\uninstall.ps1 -KeepData
```
