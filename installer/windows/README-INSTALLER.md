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
Uninstall Vibe NMS.exe
```

Advanced option, keep data during uninstall:

```powershell
.\installer\uninstall.ps1 -KeepData
```
