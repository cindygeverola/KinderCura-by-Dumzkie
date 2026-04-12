-- ============================================================
-- KinderCura — Appointment System Fix
-- Run this in SSMS AFTER the original schema.sql
-- ============================================================
USE KinderCura;
GO

-- Step 1: Drop old CHECK constraint on appointments.status
DECLARE @con NVARCHAR(200);
SELECT @con = name FROM sys.check_constraints
WHERE parent_object_id = OBJECT_ID('appointments') AND definition LIKE '%status%';
IF @con IS NOT NULL
    EXEC('ALTER TABLE appointments DROP CONSTRAINT ' + @con);
GO

-- Step 2: Re-add constraint with all correct statuses
ALTER TABLE appointments
    ADD CONSTRAINT CK_appointments_status
    CHECK (status IN ('pending','approved','completed','cancelled','rejected'));
GO

-- Step 3: Fix pedia_notifications status constraint
DECLARE @con2 NVARCHAR(200);
SELECT @con2 = name FROM sys.check_constraints
WHERE parent_object_id = OBJECT_ID('pedia_notifications') AND definition LIKE '%status%';
IF @con2 IS NOT NULL
    EXEC('ALTER TABLE pedia_notifications DROP CONSTRAINT ' + @con2);
GO

ALTER TABLE pedia_notifications
    ADD CONSTRAINT CK_pedia_notifications_status
    CHECK (status IN ('pending','approved','declined','cancelled'));
GO

-- Step 4: Fix any existing 'confirmed' or 'Confirmed' rows → 'approved'
UPDATE appointments SET status = 'approved'  WHERE status IN ('confirmed','Confirmed','Approved');
UPDATE appointments SET status = 'cancelled' WHERE status IN ('Cancelled','declined','Declined');
UPDATE appointments SET status = 'rejected'  WHERE status IN ('rejected','Rejected');
GO

-- Step 5: Ensure OTP table exists
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name='otp_codes')
CREATE TABLE otp_codes (
    id        INT IDENTITY(1,1) PRIMARY KEY,
    email     NVARCHAR(255) NOT NULL,
    code      NVARCHAR(10)  NOT NULL,
    expiresAt DATETIME      NOT NULL,
    used      BIT           NOT NULL DEFAULT 0,
    createdAt DATETIME      NOT NULL DEFAULT GETDATE()
);
GO

-- Step 6: Ensure pedia_notifications exists
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name='pedia_notifications')
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
    status          NVARCHAR(20) DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','declined','cancelled')),
    createdAt       DATETIME NOT NULL DEFAULT GETDATE()
);
GO

PRINT '✅ Appointment system schema fix applied successfully!';
GO
