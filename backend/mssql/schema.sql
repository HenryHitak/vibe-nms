IF DB_ID(N'vibe_nms') IS NULL
BEGIN
    CREATE DATABASE vibe_nms;
END
GO

USE vibe_nms;
GO

IF OBJECT_ID(N'dbo.users', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.users (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        username NVARCHAR(120) NOT NULL UNIQUE,
        display_name NVARCHAR(200) NULL,
        email NVARCHAR(320) NULL,
        role NVARCHAR(20) NOT NULL DEFAULT N'USER',
        password_hash NVARCHAR(500) NULL,
        is_active BIT NOT NULL DEFAULT 1,
        last_login_at DATETIME2 NULL,
        last_login_ip NVARCHAR(64) NULL,
        created_by NVARCHAR(120) NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_by NVARCHAR(120) NULL,
        updated_at DATETIME2 NULL
    );
END
GO

IF OBJECT_ID(N'dbo.roles', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.roles (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        role_name NVARCHAR(20) NOT NULL UNIQUE,
        permissions_json NVARCHAR(MAX) NOT NULL DEFAULT N'{}'
    );
END
GO

IF OBJECT_ID(N'dbo.network_devices', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.network_devices (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        plant_code NVARCHAR(200) NULL,
        plant_name NVARCHAR(200) NULL,
        building NVARCHAR(120) NULL,
        floor NVARCHAR(80) NULL,
        area NVARCHAR(160) NULL,
        zone NVARCHAR(160) NULL,
        line_code NVARCHAR(200) NULL,
        line_name NVARCHAR(200) NULL,
        detailed_location NVARCHAR(500) NULL,
        device_name NVARCHAR(200) NOT NULL,
        device_type NVARCHAR(80) NOT NULL,
        ip_address NVARCHAR(64) NOT NULL UNIQUE,
        mac_address NVARCHAR(64) NULL,
        hostname NVARCHAR(255) NULL,
        connected_ap_name NVARCHAR(200) NULL,
        connected_ap_ip NVARCHAR(64) NULL,
        switch_name NVARCHAR(200) NULL,
        switch_port NVARCHAR(80) NULL,
        vlan INT NULL,
        owner_department NVARCHAR(200) NULL,
        criticality NVARCHAR(20) NOT NULL DEFAULT N'MEDIUM',
        monitoring_enabled BIT NOT NULL DEFAULT 1,
        status NVARCHAR(20) NOT NULL DEFAULT N'UNKNOWN',
        latency_ms FLOAT NULL,
        packet_loss_percent FLOAT NULL,
        consecutive_failure_count INT NOT NULL DEFAULT 0,
        notes NVARCHAR(MAX) NULL,
        created_by NVARCHAR(120) NULL,
        created_from_ip NVARCHAR(64) NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_by NVARCHAR(120) NULL,
        updated_from_ip NVARCHAR(64) NULL,
        updated_at DATETIME2 NULL,
        deleted_by NVARCHAR(120) NULL,
        deleted_from_ip NVARCHAR(64) NULL,
        deleted_at DATETIME2 NULL,
        is_deleted BIT NOT NULL DEFAULT 0
    );
END
GO

IF OBJECT_ID(N'dbo.audit_logs', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.audit_logs (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        actor_user_id NVARCHAR(80) NULL,
        actor_username NVARCHAR(120) NULL,
        actor_display_name NVARCHAR(200) NULL,
        actor_role NVARCHAR(20) NULL,
        actor_ip_address NVARCHAR(64) NULL,
        actor_user_agent NVARCHAR(1000) NULL,
        action_type NVARCHAR(60) NOT NULL,
        entity_type NVARCHAR(60) NOT NULL,
        entity_id NVARCHAR(120) NULL,
        target_ip_address NVARCHAR(64) NULL,
        before_data_json NVARCHAR(MAX) NULL,
        after_data_json NVARCHAR(MAX) NULL,
        changed_fields_json NVARCHAR(MAX) NULL,
        result NVARCHAR(20) NOT NULL,
        error_message NVARCHAR(MAX) NULL,
        request_id NVARCHAR(120) NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
END
GO

IF OBJECT_ID(N'dbo.import_jobs', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.import_jobs (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        file_name NVARCHAR(500) NOT NULL,
        uploaded_by NVARCHAR(120) NULL,
        uploaded_from_ip NVARCHAR(64) NULL,
        status NVARCHAR(40) NOT NULL,
        total_rows INT NOT NULL DEFAULT 0,
        valid_rows INT NOT NULL DEFAULT 0,
        warning_rows INT NOT NULL DEFAULT 0,
        error_rows INT NOT NULL DEFAULT 0,
        inserted_rows INT NOT NULL DEFAULT 0,
        updated_rows INT NOT NULL DEFAULT 0,
        failed_rows INT NOT NULL DEFAULT 0,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        completed_at DATETIME2 NULL
    );
END
GO

IF OBJECT_ID(N'dbo.import_job_rows', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.import_job_rows (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        import_job_id INT NOT NULL,
        row_number INT NOT NULL,
        row_data_json NVARCHAR(MAX) NOT NULL,
        validation_status NVARCHAR(40) NOT NULL,
        validation_message NVARCHAR(MAX) NULL,
        CONSTRAINT fk_import_job_rows_import_jobs FOREIGN KEY(import_job_id) REFERENCES dbo.import_jobs(id) ON DELETE CASCADE
    );
END
GO

IF OBJECT_ID(N'dbo.export_jobs', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.export_jobs (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        export_type NVARCHAR(80) NOT NULL,
        requested_by NVARCHAR(120) NULL,
        requested_from_ip NVARCHAR(64) NULL,
        file_name NVARCHAR(500) NULL,
        row_count INT NOT NULL DEFAULT 0,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
END
GO

IF OBJECT_ID(N'dbo.monitoring_runs', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.monitoring_runs (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        started_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        completed_at DATETIME2 NULL,
        total_devices_checked INT NOT NULL DEFAULT 0,
        online_count INT NOT NULL DEFAULT 0,
        warning_count INT NOT NULL DEFAULT 0,
        offline_count INT NOT NULL DEFAULT 0,
        error_count INT NOT NULL DEFAULT 0,
        duration_ms INT NOT NULL DEFAULT 0
    );
END
GO

IF OBJECT_ID(N'dbo.device_metrics', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.device_metrics (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        device_id INT NOT NULL,
        checked_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        check_method NVARCHAR(40) NOT NULL,
        is_online BIT NOT NULL,
        status NVARCHAR(20) NOT NULL,
        latency_ms FLOAT NULL,
        packet_loss_percent FLOAT NULL,
        consecutive_failure_count INT NOT NULL DEFAULT 0,
        error_message NVARCHAR(MAX) NULL,
        CONSTRAINT fk_device_metrics_network_devices FOREIGN KEY(device_id) REFERENCES dbo.network_devices(id) ON DELETE CASCADE
    );
END
GO

IF OBJECT_ID(N'dbo.alerts', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.alerts (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        device_id INT NULL,
        severity NVARCHAR(20) NOT NULL,
        alert_type NVARCHAR(80) NOT NULL,
        message NVARCHAR(MAX) NOT NULL,
        status NVARCHAR(30) NOT NULL DEFAULT N'ACTIVE',
        first_detected_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        last_detected_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        acknowledged_by NVARCHAR(120) NULL,
        acknowledged_at DATETIME2 NULL,
        resolved_at DATETIME2 NULL,
        CONSTRAINT fk_alerts_network_devices FOREIGN KEY(device_id) REFERENCES dbo.network_devices(id) ON DELETE SET NULL
    );
END
GO

IF OBJECT_ID(N'dbo.notifications', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.notifications (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        alert_id INT NULL,
        recipient_role NVARCHAR(20) NOT NULL DEFAULT N'ADMIN',
        title NVARCHAR(300) NOT NULL,
        message NVARCHAR(MAX) NOT NULL,
        channel NVARCHAR(40) NOT NULL DEFAULT N'DASHBOARD',
        read_at DATETIME2 NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT fk_notifications_alerts FOREIGN KEY(alert_id) REFERENCES dbo.alerts(id) ON DELETE CASCADE
    );
END
GO

IF OBJECT_ID(N'dbo.system_settings', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.system_settings (
        [key] NVARCHAR(200) NOT NULL PRIMARY KEY,
        [value] NVARCHAR(MAX) NOT NULL,
        updated_by NVARCHAR(120) NULL,
        updated_from_ip NVARCHAR(64) NULL,
        updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_devices_status')
    CREATE INDEX idx_devices_status ON dbo.network_devices(status);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_devices_plant_line')
    CREATE INDEX idx_devices_plant_line ON dbo.network_devices(plant_code, line_code);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_audit_created')
    CREATE INDEX idx_audit_created ON dbo.audit_logs(created_at);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_audit_filters')
    CREATE INDEX idx_audit_filters ON dbo.audit_logs(actor_username, action_type, entity_type, target_ip_address);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_metrics_device_checked')
    CREATE INDEX idx_metrics_device_checked ON dbo.device_metrics(device_id, checked_at);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_alerts_status')
    CREATE INDEX idx_alerts_status ON dbo.alerts(status, severity);
GO

MERGE dbo.roles AS target
USING (VALUES
    (N'ADMIN', N'{"all": true}'),
    (N'USER', N'{"read": true}')
) AS source(role_name, permissions_json)
ON target.role_name = source.role_name
WHEN NOT MATCHED THEN
    INSERT(role_name, permissions_json) VALUES(source.role_name, source.permissions_json);
GO
