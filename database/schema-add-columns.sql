USE KinderCura;
GO

-- Add diagnosis column to assessments if missing
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='assessments' AND COLUMN_NAME='diagnosis')
    ALTER TABLE assessments ADD diagnosis NVARCHAR(MAX) NULL;
GO

-- Add recommendations column to assessments if missing  
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='assessments' AND COLUMN_NAME='recommendations')
    ALTER TABLE assessments ADD recommendations NVARCHAR(MAX) NULL;
GO

-- Fix appointments status constraint to include approved/rejected
DECLARE @cname NVARCHAR(200);
SELECT @cname = name FROM sys.check_constraints 
WHERE parent_object_id = OBJECT_ID('appointments') AND name LIKE '%status%';
IF @cname IS NOT NULL
    EXEC('ALTER TABLE appointments DROP CONSTRAINT [' + @cname + ']');
GO
IF NOT EXISTS (SELECT * FROM sys.check_constraints WHERE name = 'CK_appointments_status')
    ALTER TABLE appointments ADD CONSTRAINT CK_appointments_status
        CHECK (status IN ('pending','confirmed','approved','rejected','completed','cancelled'));
GO

-- Fix emailVerified (safe guard)
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='users' AND COLUMN_NAME='emailVerified')
    ALTER TABLE users ADD emailVerified BIT NOT NULL DEFAULT 0;
GO

PRINT '✅ Missing columns added successfully!';
GO
