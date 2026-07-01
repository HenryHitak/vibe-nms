import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export const SUPPORTED_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "ko", label: "한국어" },
  { code: "es", label: "Español" }
];

const STORAGE_KEY = "nms.language";
const DEFAULT_LANGUAGE = "en";

const translations = {
  en: {
    "app.subtitle": "Internal Network Monitoring",
    "app.operationsConsole": "Operations Console",
    "app.menu": "Menu",
    "app.admin": "Admin",
    "app.expandMenu": "Expand menu",
    "app.collapseMenu": "Collapse menu",
    "app.logout": "Logout",
    "common.save": "Save",
    "common.saving": "Saving",
    "common.saved": "Saved",
    "common.dismiss": "Dismiss",
    "routes.dashboard": "Dashboard",
    "routes.traffic": "Traffic Graphs",
    "routes.alerts": "Alert Center",
    "routes.apClients": "AP Clients",
    "routes.users": "User Accounts",
    "routes.devices": "Device Master",
    "routes.audit": "Audit Logs",
    "routes.monitoring": "Monitoring Logs",
    "routes.database": "DB Config",
    "routes.backend": "Backend Info",
    "routes.settings": "Settings",
    "login.subtitle": "Network Monitoring Login",
    "login.username": "Username",
    "login.password": "Password",
    "login.submit": "Login",
    "notifications.title": "Notifications",
    "notifications.unread": "unread",
    "notifications.noUnread": "No unread notifications",
    "notifications.openAlertCenter": "Open Alert Center",
    "notifications.markAsRead": "Mark as read",
    "settings.title": "System Settings",
    "settings.languageTitle": "Language Settings",
    "settings.languageDescription": "Choose the browser UI language. Default is English.",
    "settings.uiLanguage": "UI Language",
    "settings.languageHelp": "This setting is saved in this browser and applies immediately.",
    "settings.alarmTitle": "Alarm Settings",
    "settings.alarmDescription": "Turn alert creation on or off by alarm type. OFF resolves active alerts and clears unread notifications immediately.",
    "settings.monitoringTitle": "Monitoring Settings",
    "alerts.networkWarning": "Network warning",
    "alerts.networkWarningDescription": "Ping failure before OFFLINE, warning latency, or warning state alerts.",
    "alerts.networkOffline": "Network offline / critical",
    "alerts.networkOfflineDescription": "OFFLINE and CRITICAL ping status alerts.",
    "alerts.packetLoss": "Packet loss",
    "alerts.packetLossDescription": "Alerts when packet loss is above the configured warning threshold.",
    "alerts.latency": "Latency",
    "alerts.latencyDescription": "Alerts when ping latency is above warning or critical thresholds.",
    "alerts.flapping": "Flapping",
    "alerts.flappingDescription": "Alerts when a device repeatedly changes between up and down states.",
    "alerts.apUnknownClient": "AP unknown client",
    "alerts.apUnknownClientDescription": "Alerts for wireless clients not registered in Device Master.",
    "alerts.apWrongConnection": "AP wrong connection",
    "alerts.apWrongConnectionDescription": "Alerts when a known client appears on a different AP than expected.",
    "alerts.apDuplicateIp": "AP duplicate IP",
    "alerts.apDuplicateIpDescription": "Alerts when AP discovery sees duplicate client IP addresses.",
    "alerts.apCriticalMissing": "AP critical missing",
    "alerts.apCriticalMissingDescription": "Alerts when a critical expected wireless device is missing.",
    "alerts.apClientCountDrop": "AP client count drop",
    "alerts.apClientCountDropDescription": "Alerts when an AP client count drops sharply."
  },
  ko: {
    "app.subtitle": "사내 네트워크 모니터링",
    "app.operationsConsole": "운영 콘솔",
    "app.menu": "메뉴",
    "app.admin": "관리자",
    "app.expandMenu": "메뉴 펼치기",
    "app.collapseMenu": "메뉴 접기",
    "app.logout": "로그아웃",
    "common.save": "저장",
    "common.saving": "저장 중",
    "common.saved": "저장됨",
    "common.dismiss": "닫기",
    "routes.dashboard": "대시보드",
    "routes.traffic": "트래픽 그래프",
    "routes.alerts": "알림 센터",
    "routes.apClients": "AP 클라이언트",
    "routes.users": "사용자 계정",
    "routes.devices": "장치 마스터",
    "routes.audit": "감사 로그",
    "routes.monitoring": "모니터링 로그",
    "routes.database": "DB 설정",
    "routes.backend": "백엔드 정보",
    "routes.settings": "설정",
    "login.subtitle": "네트워크 모니터링 로그인",
    "login.username": "사용자 이름",
    "login.password": "비밀번호",
    "login.submit": "로그인",
    "notifications.title": "알림",
    "notifications.unread": "개 읽지 않음",
    "notifications.noUnread": "읽지 않은 알림이 없습니다",
    "notifications.openAlertCenter": "알림 센터 열기",
    "notifications.markAsRead": "읽음 처리",
    "settings.title": "시스템 설정",
    "settings.languageTitle": "언어 설정",
    "settings.languageDescription": "브라우저 UI 언어를 선택합니다. 기본값은 영어입니다.",
    "settings.uiLanguage": "UI 언어",
    "settings.languageHelp": "이 설정은 현재 브라우저에 저장되며 즉시 적용됩니다.",
    "settings.alarmTitle": "알람 설정",
    "settings.alarmDescription": "알림 타입별로 Alert 생성을 켜거나 끕니다. OFF로 바꾸면 활성 Alert와 읽지 않은 알림이 즉시 정리됩니다.",
    "settings.monitoringTitle": "모니터링 설정",
    "alerts.networkWarning": "네트워크 경고",
    "alerts.networkWarningDescription": "OFFLINE 전 ping 실패, warning latency, warning 상태 알림입니다.",
    "alerts.networkOffline": "네트워크 오프라인 / 크리티컬",
    "alerts.networkOfflineDescription": "OFFLINE 및 CRITICAL ping 상태 알림입니다.",
    "alerts.packetLoss": "패킷 손실",
    "alerts.packetLossDescription": "패킷 손실이 설정된 warning 기준보다 높을 때 알림을 생성합니다.",
    "alerts.latency": "지연 시간",
    "alerts.latencyDescription": "ping latency가 warning 또는 critical 기준보다 높을 때 알림을 생성합니다.",
    "alerts.flapping": "상태 반복 변경",
    "alerts.flappingDescription": "장치가 up/down 상태를 반복해서 바꿀 때 알림을 생성합니다.",
    "alerts.apUnknownClient": "AP 미등록 클라이언트",
    "alerts.apUnknownClientDescription": "Device Master에 등록되지 않은 무선 Client 알림입니다.",
    "alerts.apWrongConnection": "AP 잘못된 연결",
    "alerts.apWrongConnectionDescription": "등록된 Client가 예상 AP가 아닌 다른 AP에 나타날 때 알림을 생성합니다.",
    "alerts.apDuplicateIp": "AP 중복 IP",
    "alerts.apDuplicateIpDescription": "AP discovery에서 중복 Client IP가 발견될 때 알림을 생성합니다.",
    "alerts.apCriticalMissing": "AP 중요 장치 누락",
    "alerts.apCriticalMissingDescription": "중요 무선 장치가 expected AP에서 사라졌을 때 알림을 생성합니다.",
    "alerts.apClientCountDrop": "AP 클라이언트 수 감소",
    "alerts.apClientCountDropDescription": "AP Client 수가 급격히 줄어들 때 알림을 생성합니다."
  },
  es: {
    "app.subtitle": "Monitoreo interno de red",
    "app.operationsConsole": "Consola de operaciones",
    "app.menu": "Menú",
    "app.admin": "Administración",
    "app.expandMenu": "Expandir menú",
    "app.collapseMenu": "Contraer menú",
    "app.logout": "Cerrar sesión",
    "common.save": "Guardar",
    "common.saving": "Guardando",
    "common.saved": "Guardado",
    "common.dismiss": "Cerrar",
    "routes.dashboard": "Panel",
    "routes.traffic": "Gráficas de tráfico",
    "routes.alerts": "Centro de alertas",
    "routes.apClients": "Clientes AP",
    "routes.users": "Cuentas de usuario",
    "routes.devices": "Maestro de dispositivos",
    "routes.audit": "Registros de auditoría",
    "routes.monitoring": "Registros de monitoreo",
    "routes.database": "Config. DB",
    "routes.backend": "Info del backend",
    "routes.settings": "Configuración",
    "login.subtitle": "Inicio de sesión de monitoreo de red",
    "login.username": "Usuario",
    "login.password": "Contraseña",
    "login.submit": "Iniciar sesión",
    "notifications.title": "Notificaciones",
    "notifications.unread": "sin leer",
    "notifications.noUnread": "No hay notificaciones sin leer",
    "notifications.openAlertCenter": "Abrir centro de alertas",
    "notifications.markAsRead": "Marcar como leído",
    "settings.title": "Configuración del sistema",
    "settings.languageTitle": "Configuración de idioma",
    "settings.languageDescription": "Elige el idioma de la interfaz del navegador. El valor predeterminado es inglés.",
    "settings.uiLanguage": "Idioma de la interfaz",
    "settings.languageHelp": "Esta configuración se guarda en este navegador y se aplica de inmediato.",
    "settings.alarmTitle": "Configuración de alarmas",
    "settings.alarmDescription": "Activa o desactiva la creación de alertas por tipo. OFF resuelve alertas activas y limpia notificaciones sin leer inmediatamente.",
    "settings.monitoringTitle": "Configuración de monitoreo",
    "alerts.networkWarning": "Advertencia de red",
    "alerts.networkWarningDescription": "Falla de ping antes de OFFLINE, latencia de advertencia o alertas de estado warning.",
    "alerts.networkOffline": "Red offline / crítica",
    "alerts.networkOfflineDescription": "Alertas de estado OFFLINE y CRITICAL por ping.",
    "alerts.packetLoss": "Pérdida de paquetes",
    "alerts.packetLossDescription": "Alertas cuando la pérdida de paquetes supera el umbral configurado.",
    "alerts.latency": "Latencia",
    "alerts.latencyDescription": "Alertas cuando la latencia de ping supera los umbrales warning o critical.",
    "alerts.flapping": "Cambios repetidos",
    "alerts.flappingDescription": "Alertas cuando un dispositivo cambia repetidamente entre activo e inactivo.",
    "alerts.apUnknownClient": "Cliente AP desconocido",
    "alerts.apUnknownClientDescription": "Alertas para clientes inalámbricos no registrados en Device Master.",
    "alerts.apWrongConnection": "Conexión AP incorrecta",
    "alerts.apWrongConnectionDescription": "Alertas cuando un cliente conocido aparece en un AP diferente al esperado.",
    "alerts.apDuplicateIp": "IP duplicada en AP",
    "alerts.apDuplicateIpDescription": "Alertas cuando AP discovery ve IPs duplicadas de clientes.",
    "alerts.apCriticalMissing": "Cliente crítico faltante en AP",
    "alerts.apCriticalMissingDescription": "Alertas cuando falta un dispositivo inalámbrico crítico esperado.",
    "alerts.apClientCountDrop": "Caída de clientes AP",
    "alerts.apClientCountDropDescription": "Alertas cuando la cantidad de clientes de un AP cae bruscamente."
  }
};

const I18nContext = createContext({
  language: DEFAULT_LANGUAGE,
  setLanguage: () => {},
  t: (key) => key
});

function normalizeLanguage(value) {
  return SUPPORTED_LANGUAGES.some((item) => item.code === value) ? value : DEFAULT_LANGUAGE;
}

export function I18nProvider({ children }) {
  const [language, setLanguageState] = useState(() => normalizeLanguage(localStorage.getItem(STORAGE_KEY)));

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, language);
    document.documentElement.lang = language;
  }, [language]);

  const setLanguage = useCallback((value) => {
    setLanguageState(normalizeLanguage(value));
  }, []);

  const t = useCallback(
    (key) => translations[language]?.[key] || translations.en[key] || key,
    [language]
  );

  const value = useMemo(() => ({ language, setLanguage, t }), [language, setLanguage, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
