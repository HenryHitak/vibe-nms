# Operation and Usage

이 문서는 설치 후 실제 운영 순서와 사용 방법을 설명합니다.

## 1. 설치 위치

Vibe NMS는 사내망 안에 있고 계속 켜져 있는 PC 또는 서버에 설치합니다. 이 PC가 실제로 Ping과 AP Client Discovery를 수행합니다.

설치 파일:

```text
Install Vibe NMS.exe
```

설치 후 기본 접속:

```text
http://localhost:8080
```

다른 사내 PC에서 접속할 때는 `localhost`가 아니라 서버 PC의 IPv4 주소를 사용합니다.

```text
http://SERVER_IPV4:8080
예: http://105.102.8.50:8080
```

다른 PC에서 접속이 안 되면 먼저 서버 PC 방화벽에서 TCP 8080 인바운드가 열려 있는지 확인합니다.

## 2. 기본 로그인

```text
ID: admin
Password: admin
Role: ADMIN
```

운영 전에는 `User Accounts`에서 일반 운영자용 `USER` 계정을 따로 만듭니다. `ADMIN`은 설정과 삭제 권한이 있으므로 최소 인원만 사용합니다.

## 3. 처음 설정 순서

1. `DB Config`에서 DB 방식을 확인합니다.
2. 회사에서 MS SQL Server 2025 Express를 쓰면 SQL 정보를 입력하고 `Test Connection`을 누릅니다.
3. 저장 후 `VibeNMS` Scheduled Task를 재시작합니다.
4. `User Accounts`에서 `USER` 계정을 만듭니다.
5. `Device Master`에서 Plant Name, Line Name, 장치명, IP, MAC, AP, Switch 정보를 등록합니다.
6. AP 장치는 `Device Type = AP`로 등록합니다.
7. `AP Clients`에서 AP별 연결 Client를 확인하고 필요한 Client를 Known Device로 등록합니다.
8. `Traffic Graphs`에서 TX/RX current, min, avg, max, trend, top devices를 확인합니다.
9. `Dashboard`, `Alert Center`, `Monitoring Logs`, `Audit Logs`를 확인합니다.

## 4. SQL Server 2025 Express 설정

앱에서 `DB Config` 메뉴를 엽니다.

권장 기본값:

```text
Database Engine: MS SQL Server 2025 Express
Server: localhost\SQLEXPRESS
Port: blank
Database: vibe_nms
Auth: SQL Login or Windows Auth
Driver: ODBC Driver 18 for SQL Server
Encrypt: ON
Trust Server Certificate: ON
```

`SQLEXPRESS` named instance를 쓰면 Port는 비워 둡니다. SQL Server를 고정 TCP 포트로 열어 둔 경우에만 `1433` 같은 포트를 입력합니다.

저장 후 적용:

```powershell
Stop-ScheduledTask -TaskName VibeNMS
Start-ScheduledTask -TaskName VibeNMS
```

현재 백엔드와 DB 상태는 `Backend Info` 화면에서 확인합니다.

관리 화면은 공통 레이아웃에서 페이지 내부 스크롤을 제공합니다. `Settings`, `Device Master`, `User Accounts`, `Audit Logs`, `Monitoring Logs`, `DB Config`, `Backend Info`, `Alert Center`처럼 내용이 긴 탭은 헤더와 메뉴를 유지한 상태로 본문만 스크롤해서 봅니다.

## 5. 장치 등록

`Device Master`에서 장치를 등록합니다.

필수로 봐야 하는 값:

- Device Name: 운영자가 알아볼 이름
- IP Address: Ping 모니터링 대상 IP
- Device Type: PLC, PC, SCANNER, AP 등
- Plant Name: Plant 이름
- Line Name: Line 이름
- MAC Address: AP Client 매칭에 중요
- Connected AP Name/IP: 무선 장치가 붙어야 하는 AP
- Switch Name/Port: 유선 장치 또는 AP uplink 위치
- Criticality: HIGH/CRITICAL 장치는 장애 판정이 더 엄격함

Ping 모니터링은 삭제되지 않고 IP가 있는 등록 장치를 계속 확인합니다. 브라우저가 Ping을 보내는 구조가 아닙니다.

## 6. AP Clients 사용

`AP Clients` 화면은 AP별 현재 무선 Client를 보여줍니다.

볼 수 있는 값:

- AP 상태
- AP IP
- Plant / Line / Location
- Connected Client Count
- Known / Unknown Count
- Client IP, MAC, Hostname
- SSID, VLAN, RSSI
- Last Seen
- Status Badge

ADMIN은 AP Client를 CRUD로 관리할 수 있습니다.

- Unknown Client를 Known Device로 등록
- 등록된 Client 정보 수정
- AP Client 등록 삭제
- Manual Discovery Run 실행

Manual Discovery Run은 `Audit Logs`에 사용자명과 Source IP가 기록됩니다.

## 7. Traffic Graphs 사용

`Traffic Graphs` 화면은 traffic collector가 저장한 TX/RX 값을 그래프로 보여줍니다.

볼 수 있는 값:

- Current RX / TX
- RX Min / Avg / Max
- TX Min / Avg / Max
- TX/RX trend
- Top Traffic Devices
- Device, IP, AP, Switch, Interface별 최신 traffic
- Date range filter
- Per minute / per hour graph bucket

기본 provider는 `demo`입니다.

```text
NMS_TRAFFIC_DEFAULT_PROVIDER=demo
```

`demo`는 UI 검증용입니다. 실제 운영 traffic은 Cisco Controller, SNMP, 또는 Generic API collector를 백엔드에서 연결해야 합니다. token과 controller URL은 `.env`에만 저장하고 frontend에는 노출하지 않습니다.

날짜 range는 Mexico/Tijuana 기준으로 선택합니다. 짧은 구간은 `Per minute`, 하루 이상 구간은 `Per hour`로 보면 그래프를 한눈에 보기 쉽습니다.

실제 데이터를 바로 넣어서 시험할 때는 ADMIN token으로 아래 API를 호출합니다.

```text
POST /api/traffic/observations
```

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

Traffic Graphs 화면의 `Traffic Source`에서 provider를 `generic-api`로 바꾸면 backend가 내부 collector API에서 값을 가져옵니다. 이때 API token은 backend `.env`에 저장되고 화면에는 다시 표시되지 않습니다.

실제 운영 시작 순서:

1. Vibe NMS는 사내망 안의 PC 또는 서버에 설치합니다.
2. `Device Master`에서 실제 장치를 등록하거나 Excel로 import합니다.
3. 모니터링할 장치는 `Monitoring Enabled`를 켭니다.
4. 장치 ONLINE/WARNING/OFFLINE 상태는 backend ping worker가 계속 갱신합니다.
5. Traffic Graphs는 ping 결과가 아니라 `network_traffic_metrics` 데이터입니다. 실제 RX/TX를 보려면 `Traffic Source`를 연결하거나 `/api/traffic/observations`로 실제 observation을 넣어야 합니다.
6. Production installer는 새 DB에 샘플 장비를 넣지 않도록 `NMS_SEED_SAMPLE_DATA=false`로 설정합니다.

## 8. 로그 확인

`Monitoring Logs`:

- Ping 체크 결과
- latency
- packet loss
- check method
- 실패 이유
- 최근 monitoring run

`Audit Logs`:

- 로그인
- 사용자 추가/수정/삭제
- Device CRUD
- Import/Export
- DB Config 변경
- AP Client Discovery 수동 실행

화면의 시간 기준은 `America/Tijuana`입니다.

## 9. Alert 확인

장치 하나라도 떨어지면 Alert가 생성되고 Dashboard 상단 banner와 notification에 표시됩니다. 상단 Critical/Warning banner는 X 버튼으로 닫을 수 있지만, 실제 Alert가 resolve되는 것은 아닙니다. 실제 처리는 `Alert Center`에서 acknowledge 또는 resolve합니다.

`Alert Center`의 `Acknowledge`는 관리자가 확인했다는 표시이며 Alert는 계속 남습니다. `Resolve`는 Alert를 종료합니다. `Mute`는 해당 Alert type의 새 notification만 막고, Alert 기록과 상태는 그대로 유지합니다.

`Settings > Alarm Settings`에서 Alert type을 OFF로 바꾸면 즉시 저장되고, 같은 type의 ACTIVE/ACKNOWLEDGED Alert와 unread notification이 바로 정리됩니다. 이 기능은 Alert 자체를 끄는 것이고, `Alert Center`의 `Mute`는 notification만 끄는 기능입니다.

## 10. Dashboard를 다른 화면에 띄우기

전체 화면:

```text
http://SERVER_IP:8080/display
```

Plant/Line 필터:

```text
http://SERVER_IP:8080/display?plant=Main%20Plant
http://SERVER_IP:8080/display?plant=Main%20Plant&line=Assembly%20Line%201
```

다른 사내 웹페이지나 TV 화면은 Display API를 호출하면 됩니다.

```text
GET /api/display/dashboard
POST /api/display/dashboard
```

자세한 방식은 [Dashboard API Workflow](./dashboard-api-workflow.md)를 참고합니다.

## 11. 자주 헷갈리는 점

CMD 창을 닫았는데도 `localhost:8080`이 켜져 있는 이유:

```text
Windows Scheduled Task VibeNMS가 백엔드를 계속 실행하기 때문입니다.
```

사내 PC에서 접속이 안 되는 이유:

```text
사용자 PC에서 localhost를 쓰면 자기 PC를 보는 것입니다.
반드시 서버 PC IPv4로 접속해야 합니다.
```

온라인 PC인데 Warning/Offline으로 뜨는 이유:

```text
해당 PC가 실제 사용은 가능해도 ICMP ping을 막고 있을 수 있습니다.
이 경우 TCP fallback 포트가 열려 있으면 ONLINE으로 보정됩니다.
그래도 계속 실패하면 Windows Firewall, endpoint security, VLAN ACL, NMS_CORPORATE_NETWORKS 설정을 확인합니다.
```
