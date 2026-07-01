# Input Normalization

Vibe NMS ignores leading and trailing spaces for text information before it is saved or used for matching.

## Where Trim Is Applied

- Login username and password payloads
- User account create/update payloads
- Device Master create/update payloads
- AP client registration payloads
- Excel device import preview and commit
- Dashboard, audit log, monitoring log, alert, source map, and traffic filters
- Traffic observation ingest API
- AP client discovery provider observations
- Traffic provider observations
- `.env` and runtime configuration values

## Storage Rule

Text is stored without leading or trailing spaces.

Optional text fields that contain only spaces are treated as empty and saved as `NULL` where the database allows it.

Required fields such as device name, device type, IP address, username, role, and alert status are trimmed but not converted to `NULL`.

## Existing Data Cleanup

On backend startup, Vibe NMS attempts to trim existing text values in key tables such as:

- `users`
- `network_devices`
- `audit_logs`
- `device_metrics`
- `network_traffic_metrics`
- `alerts`
- `notifications`
- `system_settings`
- `ap_client_observations`
- `ap_connected_clients_current`

If trimming a unique field would cause a database conflict, that cleanup statement is skipped so the backend can keep running.

## Matching Behavior

After normalization, these values match correctly even if the request has accidental spaces:

```text
" Main Plant " -> "Main Plant"
" 10.250.250.77 " -> "10.250.250.77"
" AP_MAIN_01 " -> "AP_MAIN_01"
" api-ingest " -> "api-ingest"
```

This prevents Excel rows, manual forms, API requests, and backend collectors from creating separate records or failed matches because of invisible leading or trailing spaces.
