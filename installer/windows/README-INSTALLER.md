# Vibe NMS Windows Installer

This package runs Vibe NMS without Docker.

## Install

Extract the zip, then run:

```text
Install Vibe NMS.cmd
```

If Windows asks for administrator permission, approve it. Do not double-click `.ps1` files; on some company PCs those files open in Notepad.

Open:

```text
http://localhost:8080
```

Default login:

```text
ID: admin
Password: admin
```

The installer registers a Windows Scheduled Task named `VibeNMS`. It starts on boot and runs the backend collector inside the corporate network.

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

After editing `.env`, restart the task:

```powershell
Stop-ScheduledTask -TaskName VibeNMS
Start-ScheduledTask -TaskName VibeNMS
```

## Uninstall

Run:

```text
Uninstall Vibe NMS.cmd
```

Advanced option, keep data during uninstall:

```powershell
.\installer\uninstall.ps1 -KeepData
```
