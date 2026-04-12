-- ====================================================
-- KinderCura  –  SQL Server Schema
-- Run this entire file in SSMS (F5)
-- Server: CINDYGEVEROLA\SQLEXPRESS02
-- ====================================================

CREATE DATABASE KinderCura;
GO
USE KinderCura;
GO

-- ─────────────────────────────────────────
-- USERS  (parents, pediatricians, admins)
-- ─────────────────────────────────────────
CREATE TABLE users (
    id           INT IDENTITY(1,1) PRIMARY KEY,
    firstName    NVARCHAR(100) NOT NULL,
    middleName   NVARCHAR(100),
    lastName     NVARCHAR(100) NOT NULL,
    username     NVARCHAR(100) NOT NULL UNIQUE,
    email        NVARCHAR(255) NOT NULL UNIQUE,
    passwordHash NVARCHAR(255) NOT NULL,
    role         NVARCHAR(20)  NOT NULL CHECK (role IN ('parent','pediatrician','admin')),
    status       NVARCHAR(20)  NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('active','pending','suspended')),
    -- Pediatrician fields
    licenseNumber  NVARCHAR(100),
    institution    NVARCHAR(255),
    specialization NVARCHAR(255),
    -- Admin fields
    organization NVARCHAR(255),
    department   NVARCHAR(255),
    createdAt    DATETIME NOT NULL DEFAULT GETDATE(),
    updatedAt    DATETIME NOT NULL DEFAULT GETDATE()
);
GO

-- ─────────────────────────────────────────
-- CHILDREN
-- ─────────────────────────────────────────
CREATE TABLE children (
    id           INT IDENTITY(1,1) PRIMARY KEY,
    parentId     INT NOT NULL FOREIGN KEY REFERENCES users(id) ON DELETE CASCADE,
    firstName    NVARCHAR(100) NOT NULL,
    lastName     NVARCHAR(100) NOT NULL,
    dateOfBirth  DATE NOT NULL,
    gender       NVARCHAR(20)  CHECK (gender IN ('male','female','other')),
    relationship NVARCHAR(50),   -- mother, father, guardian, etc.
    createdAt    DATETIME NOT NULL DEFAULT GETDATE(),
    updatedAt    DATETIME NOT NULL DEFAULT GETDATE()
);
GO

-- ─────────────────────────────────────────
-- ASSESSMENTS  (one per screening session)
-- ─────────────────────────────────────────
CREATE TABLE assessments (
    id              INT IDENTITY(1,1) PRIMARY KEY,
    childId         INT NOT NULL FOREIGN KEY REFERENCES children(id),
    createdBy       INT NOT NULL FOREIGN KEY REFERENCES users(id),
    status          NVARCHAR(20) NOT NULL DEFAULT 'in_progress'
                                 CHECK (status IN ('in_progress','submitted','complete')),
    currentProgress INT DEFAULT 0,
    startedAt       DATETIME NOT NULL DEFAULT GETDATE(),
    completedAt     DATETIME
);
GO

-- ─────────────────────────────────────────
-- ASSESSMENT ANSWERS  (one row per question)
-- ─────────────────────────────────────────
CREATE TABLE assessment_answers (
    id           INT IDENTITY(1,1) PRIMARY KEY,
    assessmentId INT NOT NULL FOREIGN KEY REFERENCES assessments(id) ON DELETE CASCADE,
    questionId   INT NOT NULL,              -- matches the id in the JS questions array
    domain       NVARCHAR(50) NOT NULL,     -- Communication | Social Skills | Cognitive | Motor Skills
    questionText NVARCHAR(500),
    answer       NVARCHAR(20) NOT NULL      -- yes | sometimes | no
);
GO

-- ─────────────────────────────────────────
-- ASSESSMENT RESULTS  (calculated scores)
-- ─────────────────────────────────────────
CREATE TABLE assessment_results (
    id                  INT IDENTITY(1,1) PRIMARY KEY,
    assessmentId        INT NOT NULL FOREIGN KEY REFERENCES assessments(id) ON DELETE CASCADE,
    childId             INT NOT NULL FOREIGN KEY REFERENCES children(id),
    communicationScore  FLOAT,
    socialScore         FLOAT,
    cognitiveScore      FLOAT,
    motorScore          FLOAT,
    overallScore        FLOAT,
    communicationStatus NVARCHAR(20),  -- on-track | at-risk | advanced
    socialStatus        NVARCHAR(20),
    cognitiveStatus     NVARCHAR(20),
    motorStatus         NVARCHAR(20),
    riskFlags           NVARCHAR(MAX), -- JSON string
    generatedAt         DATETIME NOT NULL DEFAULT GETDATE()
);
GO

-- ─────────────────────────────────────────
-- RECOMMENDATIONS
-- ─────────────────────────────────────────
CREATE TABLE recommendations (
    id                  INT IDENTITY(1,1) PRIMARY KEY,
    assessmentResultId  INT NOT NULL FOREIGN KEY REFERENCES assessment_results(id) ON DELETE CASCADE,
    childId             INT NOT NULL FOREIGN KEY REFERENCES children(id),
    skill               NVARCHAR(50) NOT NULL,   -- communication | social | cognitive | motor
    priority            NVARCHAR(20) NOT NULL CHECK (priority IN ('high','medium','low')),
    suggestion          NVARCHAR(MAX) NOT NULL,
    activities          NVARCHAR(MAX),            -- JSON string
    consultationNeeded  BIT DEFAULT 0,
    generatedAt         DATETIME NOT NULL DEFAULT GETDATE()
);
GO

-- ─────────────────────────────────────────
-- APPOINTMENTS
-- ─────────────────────────────────────────
CREATE TABLE appointments (
    id              INT IDENTITY(1,1) PRIMARY KEY,
    childId         INT NOT NULL FOREIGN KEY REFERENCES children(id),
    parentId        INT NOT NULL FOREIGN KEY REFERENCES users(id),
    pediatricianId  INT          FOREIGN KEY REFERENCES users(id),
    appointmentDate DATE NOT NULL,
    appointmentTime TIME NOT NULL,
    reason          NVARCHAR(200),
    notes           NVARCHAR(MAX),
    location        NVARCHAR(200),
    status          NVARCHAR(20) NOT NULL DEFAULT 'pending'
                                 CHECK (status IN ('pending','confirmed','completed','cancelled')),
    createdAt       DATETIME NOT NULL DEFAULT GETDATE()
);
GO

-- ─────────────────────────────────────────
-- NOTIFICATIONS
-- ─────────────────────────────────────────
CREATE TABLE notifications (
    id        INT IDENTITY(1,1) PRIMARY KEY,
    userId    INT NOT NULL FOREIGN KEY REFERENCES users(id) ON DELETE CASCADE,
    title     NVARCHAR(200) NOT NULL,
    message   NVARCHAR(MAX),
    type      NVARCHAR(50),    -- assessment | appointment | system
    isRead    BIT DEFAULT 0,
    createdAt DATETIME NOT NULL DEFAULT GETDATE()
);
GO

-- ─────────────────────────────────────────
-- ACTIVITY LOG  (admin dashboard feed)
-- ─────────────────────────────────────────
CREATE TABLE activity_log (
    id          INT IDENTITY(1,1) PRIMARY KEY,
    userId      INT FOREIGN KEY REFERENCES users(id),
    type        NVARCHAR(100) NOT NULL,
    description NVARCHAR(MAX),
    createdAt   DATETIME NOT NULL DEFAULT GETDATE()
);
GO

-- ─────────────────────────────────────────
-- DEFAULT ADMIN ACCOUNT
-- Username: admin  |  Password: Admin@1234
-- ⚠️  Change this password immediately after first login!
-- ─────────────────────────────────────────
INSERT INTO users (firstName, middleName, lastName, username, email, passwordHash, role, status)
VALUES (
    'System', NULL, 'Admin',
    'admin',
    'admin@kindercura.com',
    '$2b$10$hACwQ5/HQI/6FBR7rFSMcO1jT.Zb/VaTvYGHCEVQ1P1rVz3bUYmJi',  -- Admin@1234
    'admin',
    'active'
);
GO

PRINT '✅  KinderCura database created successfully on CINDYGEVEROLA\SQLEXPRESS02';
GO
