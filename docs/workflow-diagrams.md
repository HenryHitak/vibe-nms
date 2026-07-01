# Workflow Diagrams

이 문서는 Vibe NMS가 어떤 흐름으로 동작하는지 그림으로 설명합니다.

## 1. 전체 시스템 흐름

```mermaid
flowchart LR
    Admin["ADMIN Browser<br/>Device, User, DB Config"] -->|"Login + API"| Backend["FastAPI Backend<br/>Port 8080"]
    User["USER Browser<br/>Read-only Dashboard"] -->|"Login + API"| Backend
    Display["TV / Kiosk / Intranet Page"] -->|"Display API"| Backend

    Backend --> DB["SQLite or<br/>MS SQL Server 2025 Express"]
    Backend --> Frontend["React Frontend<br/>served by backend"]
    Backend --> PingWorker["Ping Monitoring Worker"]
    Backend --> APWorker["ap_client_discovery_worker.py"]
    Backend --> TrafficWorker["traffic_monitoring_worker.py"]

    PingWorker --> DeviceIPs["Registered Device IPs"]
    APWorker --> APProviders["AP Client Providers<br/>Cisco WLC, Meraki, Aruba, UniFi, SNMP, Demo"]
    TrafficWorker --> TrafficProviders["Traffic Providers<br/>Demo, Generic API, Cisco WLC, SNMP"]
    APProviders --> Controller["Wireless Controller"]
    Controller --> APs["Registered Access Points"]
    APs --> Clients["Connected Wireless Clients"]

    PingWorker --> Alerts["Alerts"]
    APWorker --> Alerts
    Alerts --> Notifications["Notifications<br/>skips muted types"]
    TrafficWorker --> TrafficDB["network_traffic_metrics"]
    Alerts --> Backend
    Notifications --> Backend
    TrafficDB --> Backend
```

## 2. Windows 설치 후 실행 흐름

```mermaid
flowchart TD
    Installer["Install Vibe NMS.exe"] --> ProgramFiles["C:\\Program Files\\Vibe NMS"]
    Installer --> Task["Windows Scheduled Task<br/>VibeNMS"]
    Task --> Runner["service\\run-vibe-nms.ps1"]
    Runner --> ServerExe["server\\vibe-nms-server.exe"]
    ServerExe --> Backend["FastAPI Backend<br/>http://0.0.0.0:8080"]
    Backend --> WebUI["Dashboard UI<br/>http://SERVER_IP:8080"]
    Backend --> Workers["Background Workers"]
    Workers --> Ping["Ping Monitoring"]
    Workers --> Discovery["AP Client Discovery"]
```

CMD 창을 닫아도 `VibeNMS` Scheduled Task가 살아 있으면 백엔드는 계속 동작합니다.

## 3. 로그인과 일반 API 흐름

```mermaid
sequenceDiagram
    participant Browser as Browser
    participant Backend as FastAPI Backend
    participant DB as Database

    Browser->>Backend: POST /api/auth/login
    Backend->>DB: users 조회 및 password 검증
    Backend->>DB: last_login_ip, audit_logs 저장
    Backend-->>Browser: Bearer token
    Browser->>Backend: GET /api/devices with token
    Backend->>DB: 권한 확인 후 데이터 조회
    Backend-->>Browser: JSON response
```

## 4. Ping Monitoring 흐름

```mermaid
flowchart TD
    Timer["Every NMS_COLLECTOR_INTERVAL_SECONDS"] --> Load["Load all non-deleted devices with IP"]
    Load --> RangeCheck{"IP inside<br/>NMS_CORPORATE_NETWORKS?"}
    RangeCheck -- "No" --> Restricted["Skip probe<br/>mark failure reason"]
    RangeCheck -- "Yes" --> Ping["ICMP ping"]
    Ping --> PingOK{"Ping reply?"}
    PingOK -- "Yes" --> MetricsOK["Save latency/loss<br/>device_metrics"]
    PingOK -- "No" --> TCP["TCP fallback ports<br/>445, 3389, 80, 443"]
    TCP --> TCPReachable{"TCP reachable?"}
    TCPReachable -- "Yes" --> OnlineTCP["Mark ONLINE<br/>method PING+TCP"]
    TCPReachable -- "No" --> Failure["Increase failure count"]
    Failure --> Status["WARNING / OFFLINE / CRITICAL"]
    Restricted --> Status
    MetricsOK --> Alerts["Resolve or update alerts"]
    OnlineTCP --> Alerts
    Status --> Alerts
    Alerts --> UI["Dashboard, Alert Center,<br/>Monitoring Logs"]
```

## 5. AP Client Discovery 흐름

```mermaid
flowchart TD
    Start["Timer or Manual Run"] --> LoadAP["Load Device Type = AP<br/>Monitoring Enabled = ON"]
    LoadAP --> Provider["Select provider by<br/>AP Controller Type or Vendor"]
    Provider --> Query["Query controller/API/SNMP/demo"]
    Query --> Normalize["Normalize APClientObservation"]
    Normalize --> ResolveIP["If IP missing, resolve by MAC<br/>from registered device table"]
    ResolveIP --> Match["Match against network_devices<br/>by MAC first, then IP"]
    Match --> Detect["Detect unknown, wrong AP,<br/>duplicate IP, missing critical device,<br/>client count drop"]
    Detect --> History["Insert ap_client_observations"]
    Detect --> Current["Replace ap_connected_clients_current"]
    Detect --> RunLog["Update ap_client_discovery_runs"]
    Detect --> Alerts["Create or resolve AP client alerts"]
    Alerts --> UI["AP Clients page<br/>Dashboard by AP"]
```

## 6. 외부 Dashboard API 흐름

```mermaid
sequenceDiagram
    participant Display as Display Browser or TV
    participant Backend as Vibe NMS Backend
    participant DB as Database

    Display->>Backend: GET /api/display/dashboard?plant=A&line=Line1
    Backend->>Backend: Optional display token check
    Backend->>DB: summary, devices, alerts, metrics, AP data 조회
    Backend-->>Display: Read-only dashboard JSON
    Display->>Backend: GET /display
    Backend-->>Display: Full-screen display dashboard page
```

`/api/display/dashboard`는 읽기 전용입니다. 관리 기능은 일반 로그인 API와 ADMIN 권한이 필요합니다.

## 7. Traffic Graphs 흐름

```mermaid
flowchart TD
    Start["Traffic collection timer"] --> Load["Load monitoring-enabled devices"]
    Load --> Provider["Provider selection"]
    Provider --> Collect["Collect RX/TX bps"]
    Collect --> Rollup["Calculate min / avg / max"]
    Rollup --> Store["network_traffic_metrics"]
    Store --> Summary["GET /api/traffic/summary<br/>date_from, date_to, bucket"]
    Summary --> Page["Traffic Graphs tab"]
    Summary --> Display["Display API traffic block"]
```
