-- ====================================================
-- KinderCura  –  SQL Server Schema (Updated)
-- Run this entire file in SSMS (F5)
-- Server: CINDYGEVEROLA\SQLEXPRESS02
-- ====================================================

USE KinderCura;
GO

-- ─────────────────────────────────────────
-- Add new columns to existing tables (run only if upgrading)
-- ─────────────────────────────────────────

-- Add emailVerified and profileIcon to users if not exists
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('children') AND name = 'middleName')
    ALTER TABLE children ADD middleName NVARCHAR(100) NULL;
GO
    ALTER TABLE users ADD emailVerified BIT NOT NULL DEFAULT 0;
GO
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('users') AND name = 'profileIcon')
    ALTER TABLE users ADD profileIcon NVARCHAR(100) DEFAULT 'avatar1';
GO
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('children') AND name = 'profileIcon')
    ALTER TABLE children ADD profileIcon NVARCHAR(100) DEFAULT 'child1';
GO

-- ─────────────────────────────────────────
-- OTP VERIFICATION TABLE
-- ─────────────────────────────────────────
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'otp_codes')
CREATE TABLE otp_codes (
    id        INT IDENTITY(1,1) PRIMARY KEY,
    email     NVARCHAR(255) NOT NULL,
    code      NVARCHAR(10)  NOT NULL,
    expiresAt DATETIME      NOT NULL,
    used      BIT           NOT NULL DEFAULT 0,
    createdAt DATETIME      NOT NULL DEFAULT GETDATE()
);
GO

-- ─────────────────────────────────────────
-- PEDIATRICIAN NOTIFICATIONS
-- ─────────────────────────────────────────
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'pedia_notifications')
CREATE TABLE pedia_notifications (
    id              INT IDENTITY(1,1) PRIMARY KEY,
    pediatricianId  INT NOT NULL FOREIGN KEY REFERENCES users(id) ON DELETE CASCADE,
    appointmentId   INT NOT NULL FOREIGN KEY REFERENCES appointments(id),
    parentName      NVARCHAR(200),
    childName       NVARCHAR(200),
    appointmentDate DATE,
    appointmentTime NVARCHAR(50),
    reason          NVARCHAR(500),
    isRead          BIT DEFAULT 0,
    status          NVARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','approved','declined')),
    createdAt       DATETIME NOT NULL DEFAULT GETDATE()
);
GO

PRINT '✅ KinderCura schema updated successfully!';
GO
