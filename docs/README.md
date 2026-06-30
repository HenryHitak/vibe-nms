# Vibe NMS 운영 문서

이 폴더는 사내 Plant Network Monitoring System을 설치, 운영, 설명할 때 쓰는 문서입니다.

## 문서 목록

- [Workflow Diagrams](./workflow-diagrams.md): 전체 작동 흐름, 설치 흐름, 모니터링 흐름, AP Client Discovery 흐름, Dashboard API 흐름
- [Operation and Usage](./operation-and-usage.md): 설치 후 사용하는 순서, ADMIN/USER 계정, DB Config, 로그 확인, 운영 점검
- [Device Network Model](./easy-device-network-model.md): 장치, IP, AP, Switch, Cisco Controller 관계를 쉬운 말로 설명
- [Backend Workflow](./backend-workflow.md): 백엔드가 켜지고 DB, API, 워커가 같이 도는 방식
- [Monitoring Workflow](./monitoring-workflow.md): 등록된 IP를 계속 모니터링하는 방식과 상태 판정 기준
- [Dashboard API Workflow](./dashboard-api-workflow.md): 다른 화면, TV, 사내 페이지에서 대시보드를 보여주는 API 방식

## 기준 용어

- 서버 PC: Vibe NMS가 설치되어 실제 백엔드가 실행되는 PC 또는 서버
- 사용자 PC: 브라우저로 Vibe NMS에 접속하는 사내 PC
- ADMIN: 장치, 사용자, DB 설정, Import/Export, Alert 처리를 할 수 있는 관리자
- USER: 대시보드와 Alert Center를 읽는 운영자
- Device Master: 모니터링 대상 장치 등록 화면
- AP Clients: AP별 무선 Client 조회 및 등록 관리 화면

브라우저는 네트워크를 직접 스캔하지 않습니다. Ping 모니터링과 AP Client Discovery는 모두 서버 PC 안에서 실행되는 백엔드 워커가 수행합니다.
