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

Admins can open `Backend Info` in the app to see where the backend and SQL database are running.

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

For MS SQL Server, change the database settings in `.env`:

```text
NMS_DATABASE_ENGINE=mssql
NMS_MSSQL_SERVER=your-sql-server
NMS_MSSQL_PORT=1433
NMS_MSSQL_DATABASE=vibe_nms
NMS_MSSQL_USERNAME=sa
NMS_MSSQL_PASSWORD=your-password
```

AP controller API tokens also go in `.env`; they are only read by the backend process and are not exposed to the browser.

`AP Clients` includes CRUD for registered wireless clients. Admins can add an observed unknown client as a known device, edit it, or delete the registration from that AP.

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
