-- Sanabel Al-Ehsan — full production database schema
-- Dumped from Railway MySQL (SHOW CREATE TABLE, all tables), 2026.
-- Reference only — do not run this file directly; schema is managed via
-- Sequelize migrations in server/database/migrations/.

CREATE TABLE `AppConfigs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `platform` varchar(30) NOT NULL,
  `latestVersion` varchar(30) NOT NULL DEFAULT '1.0.0',
  `minRequiredVersion` varchar(30) NOT NULL DEFAULT '1.0.0',
  `forceUpdate` tinyint(1) NOT NULL DEFAULT '0',
  `storeUrl` varchar(1000) NOT NULL DEFAULT '',
  `releaseNotesAr` text NOT NULL,
  `releaseNotesEn` text NOT NULL,
  `maintenanceMode` tinyint(1) NOT NULL DEFAULT '0',
  `createdAt` datetime(6) NOT NULL,
  `updatedAt` datetime(6) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `app_configs_platform_unique` (`platform`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `Organizations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `type` varchar(255) NOT NULL DEFAULT 'School',
  `img` varchar(255) DEFAULT NULL,
  `createdAt` datetime(6) NOT NULL,
  `updatedAt` datetime(6) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `organizations_name_unique` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `Grades` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `createdAt` datetime(6) NOT NULL,
  `updatedAt` datetime(6) NOT NULL,
  `organizationId` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `grades_name_organization_id_unique` (`name`,`organizationId`),
  KEY `Grades_organizationId_foreign_idx` (`organizationId`),
  CONSTRAINT `Grades_organizationId_foreign_idx` FOREIGN KEY (`organizationId`) REFERENCES `Organizations` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `Groupes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `groupename` varchar(255) DEFAULT NULL,
  `groupedescrption` varchar(255) DEFAULT NULL,
  `createdAt` datetime(6) NOT NULL,
  `updatedAt` datetime(6) NOT NULL,
  `organizationId` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `organizationId` (`organizationId`),
  CONSTRAINT `Groupes_ibfk_1` FOREIGN KEY (`organizationId`) REFERENCES `Organizations` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `Users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `firstName` varchar(255) DEFAULT NULL,
  `lastName` varchar(255) DEFAULT NULL,
  `email` varchar(255) NOT NULL,
  `password` varchar(255) DEFAULT NULL,
  `role` enum('Parent','Teacher','Student','Admin') DEFAULT 'Student',
  `resetOTP` varchar(255) DEFAULT NULL,
  `otpExpiry` datetime DEFAULT NULL,
  `otpVerified` tinyint(1) DEFAULT '0',
  `gender` varchar(255) DEFAULT NULL,
  `dateOfBirth` date DEFAULT NULL,
  `isAccess` tinyint(1) NOT NULL DEFAULT '0',
  `profileImg` json DEFAULT NULL,
  `createdAt` datetime(6) NOT NULL,
  `updatedAt` datetime(6) NOT NULL,
  `otpAttempts` int NOT NULL DEFAULT '0',
  `otpLockedUntil` datetime DEFAULT NULL,
  `tokenVersion` int NOT NULL DEFAULT '0',
  `seenGuides` json DEFAULT NULL,
  `pushSubscription` json DEFAULT NULL,
  `location` json DEFAULT NULL,
  `organizationId` int DEFAULT NULL COMMENT 'Admin scope: NULL = super admin (sees everything), set = locked to that school. Ignored for non-Admin roles.',
  PRIMARY KEY (`id`),
  UNIQUE KEY `users_email_unique` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `Teachers` (
  `id` int NOT NULL AUTO_INCREMENT,
  `createdAt` datetime(6) NOT NULL,
  `updatedAt` datetime(6) NOT NULL,
  `userId` int DEFAULT NULL,
  `organizationId` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `userId` (`userId`),
  KEY `organizationId` (`organizationId`),
  CONSTRAINT `Teachers_ibfk_25` FOREIGN KEY (`userId`) REFERENCES `Users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `Teachers_ibfk_26` FOREIGN KEY (`organizationId`) REFERENCES `Organizations` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `Parents` (
  `id` int NOT NULL AUTO_INCREMENT,
  `createdAt` datetime(6) NOT NULL,
  `updatedAt` datetime(6) NOT NULL,
  `userId` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `userId` (`userId`),
  CONSTRAINT `Parents_ibfk_1` FOREIGN KEY (`userId`) REFERENCES `Users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `Representatives` (
  `id` int NOT NULL AUTO_INCREMENT,
  `createdAt` datetime(6) NOT NULL,
  `updatedAt` datetime(6) NOT NULL,
  `userId` int DEFAULT NULL,
  `organizationId` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `userId` (`userId`),
  KEY `organizationId` (`organizationId`),
  CONSTRAINT `Representatives_ibfk_25` FOREIGN KEY (`userId`) REFERENCES `Users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `Representatives_ibfk_26` FOREIGN KEY (`organizationId`) REFERENCES `Organizations` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `Trees` (
  `id` int NOT NULL AUTO_INCREMENT,
  `water` int DEFAULT NULL,
  `seeders` int DEFAULT NULL,
  `treeProgress` int DEFAULT '1',
  `stage` int DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `Classes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `classname` varchar(255) NOT NULL,
  `classdescrption` varchar(255) DEFAULT NULL,
  `category` varchar(255) DEFAULT NULL,
  `createdAt` datetime(6) NOT NULL,
  `updatedAt` datetime(6) NOT NULL,
  `teacherId` int DEFAULT NULL,
  `organizationId` int DEFAULT NULL,
  `grade` varchar(255) DEFAULT NULL,
  `gradeId` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `teacherId` (`teacherId`),
  KEY `organizationId` (`organizationId`),
  KEY `gradeId` (`gradeId`),
  CONSTRAINT `Classes_ibfk_32` FOREIGN KEY (`teacherId`) REFERENCES `Teachers` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `Classes_ibfk_33` FOREIGN KEY (`organizationId`) REFERENCES `Organizations` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `Classes_ibfk_34` FOREIGN KEY (`gradeId`) REFERENCES `Grades` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `Students` (
  `id` int NOT NULL AUTO_INCREMENT,
  `grade` varchar(255) DEFAULT NULL,
  `medal` int DEFAULT '1',
  `connectCode` varchar(255) DEFAULT NULL,
  `seeders` int DEFAULT '0',
  `water` int DEFAULT '0',
  `snabelRed` int DEFAULT '0',
  `snabelYellow` int DEFAULT '0',
  `snabelBlue` int DEFAULT '0',
  `level` int DEFAULT '1',
  `xp` int DEFAULT '0',
  `createdAt` datetime(6) NOT NULL,
  `updatedAt` datetime(6) NOT NULL,
  `userId` int DEFAULT NULL,
  `ParentId` int DEFAULT NULL,
  `organizationId` int DEFAULT NULL,
  `classId` int DEFAULT NULL,
  `treeProgress` int DEFAULT NULL,
  `groupeId` int DEFAULT NULL,
  `gradeId` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `userId` (`userId`),
  KEY `ParentId` (`ParentId`),
  KEY `organizationId` (`organizationId`),
  KEY `classId` (`classId`),
  KEY `treeProgress` (`treeProgress`),
  KEY `groupeId` (`groupeId`),
  KEY `gradeId` (`gradeId`),
  CONSTRAINT `Students_ibfk_88` FOREIGN KEY (`userId`) REFERENCES `Users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `Students_ibfk_89` FOREIGN KEY (`ParentId`) REFERENCES `Parents` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `Students_ibfk_90` FOREIGN KEY (`organizationId`) REFERENCES `Organizations` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `Students_ibfk_91` FOREIGN KEY (`classId`) REFERENCES `Classes` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `Students_ibfk_92` FOREIGN KEY (`treeProgress`) REFERENCES `Trees` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `Students_ibfk_93` FOREIGN KEY (`groupeId`) REFERENCES `Groupes` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `Students_ibfk_94` FOREIGN KEY (`gradeId`) REFERENCES `Grades` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `TaskCategories` (
  `id` int NOT NULL AUTO_INCREMENT,
  `title` varchar(255) DEFAULT NULL,
  `description` varchar(255) DEFAULT NULL,
  `xp` int DEFAULT NULL,
  `snabelRed` int DEFAULT NULL,
  `snabelYellow` int DEFAULT NULL,
  `snabelBlue` int DEFAULT NULL,
  `createdAt` datetime(6) NOT NULL,
  `updatedAt` datetime(6) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `Tasks` (
  `id` int NOT NULL AUTO_INCREMENT,
  `type` varchar(255) DEFAULT NULL,
  `title` varchar(255) NOT NULL,
  `description` varchar(255) DEFAULT NULL,
  `categoryId` int DEFAULT NULL,
  `snabelRed` int DEFAULT '0',
  `snabelYellow` int DEFAULT '0',
  `snabelBlue` int DEFAULT '0',
  `xp` int DEFAULT '0',
  `kind` varchar(255) DEFAULT NULL,
  `timeToDo` time DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `categoryId` (`categoryId`),
  CONSTRAINT `Tasks_ibfk_1` FOREIGN KEY (`categoryId`) REFERENCES `TaskCategories` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `Challenges` (
  `id` int NOT NULL AUTO_INCREMENT,
  `title` varchar(255) NOT NULL,
  `description` varchar(255) DEFAULT NULL,
  `level` int NOT NULL DEFAULT '1',
  `snabelRed` int DEFAULT '0',
  `snabelYellow` int DEFAULT '0',
  `snabelBlue` int DEFAULT '0',
  `xp` int DEFAULT '0',
  `water` int DEFAULT '0',
  `seeder` int DEFAULT '0',
  `point` int DEFAULT NULL COMMENT 'Nullable — callers must guard: pointOfStudent >= point coerces to >= 0 when point is NULL',
  `category` enum('snabelBlue','snabelRed','snabelYellow','snabelMixed','water','seeder','xp','task','alltask','treelevel','treestage','tasktype') NOT NULL,
  `taskCategory` varchar(255) DEFAULT NULL,
  `tasktype` varchar(255) DEFAULT NULL,
  `createdAt` datetime(6) NOT NULL,
  `updatedAt` datetime(6) NOT NULL,
  `taskId` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `taskId` (`taskId`),
  CONSTRAINT `Challenges_ibfk_1` FOREIGN KEY (`taskId`) REFERENCES `Tasks` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `StudentTasks` (
  `id` int NOT NULL AUTO_INCREMENT,
  `studentId` int NOT NULL,
  `taskId` int DEFAULT NULL,
  `parentId` int DEFAULT NULL,
  `teacherId` int DEFAULT NULL,
  `completionStatus` varchar(255) NOT NULL DEFAULT 'NotCompleted',
  `comment` varchar(255) DEFAULT NULL,
  `createdAt` datetime NOT NULL DEFAULT (now()),
  `updatedAt` datetime NOT NULL DEFAULT (now()),
  `date` date NOT NULL DEFAULT (curdate()),
  PRIMARY KEY (`id`),
  UNIQUE KEY `stu_task_date_p_t_unique` (`studentId`,`taskId`,`date`,`parentId`,`teacherId`),
  KEY `taskId` (`taskId`),
  KEY `parentId` (`parentId`),
  KEY `teacherId` (`teacherId`),
  CONSTRAINT `StudentTasks_ibfk_49` FOREIGN KEY (`studentId`) REFERENCES `Students` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `StudentTasks_ibfk_50` FOREIGN KEY (`taskId`) REFERENCES `Tasks` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `StudentTasks_ibfk_51` FOREIGN KEY (`parentId`) REFERENCES `Parents` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `StudentTasks_ibfk_52` FOREIGN KEY (`teacherId`) REFERENCES `Teachers` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `StudentChallenges` (
  `studentId` int NOT NULL,
  `challengeId` int NOT NULL,
  `completionStatus` enum('Completed','NotCompleted') NOT NULL DEFAULT 'NotCompleted',
  `comment` varchar(255) DEFAULT NULL,
  `date` datetime DEFAULT NULL,
  `pointOfStudent` int DEFAULT '0',
  `createdAt` datetime(6) NOT NULL,
  `updatedAt` datetime(6) NOT NULL,
  PRIMARY KEY (`studentId`,`challengeId`),
  KEY `challengeId` (`challengeId`),
  CONSTRAINT `StudentChallenges_ibfk_1` FOREIGN KEY (`studentId`) REFERENCES `Students` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `StudentChallenges_ibfk_2` FOREIGN KEY (`challengeId`) REFERENCES `Challenges` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `MissionApprovalRequests` (
  `id` int NOT NULL AUTO_INCREMENT,
  `studentId` int NOT NULL,
  `missionId` int NOT NULL,
  `missionDate` date NOT NULL,
  `status` varchar(255) NOT NULL DEFAULT 'pending',
  `parentIds` json NOT NULL,
  `teacherIds` json NOT NULL,
  `approvedById` int DEFAULT NULL,
  `approvedByType` varchar(255) DEFAULT NULL,
  `approvedAt` datetime DEFAULT NULL,
  `createdAt` datetime(6) NOT NULL,
  `updatedAt` datetime(6) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `studentId` (`studentId`),
  KEY `missionId` (`missionId`),
  CONSTRAINT `MissionApprovalRequests_ibfk_1` FOREIGN KEY (`studentId`) REFERENCES `Students` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `MissionApprovalRequests_ibfk_2` FOREIGN KEY (`missionId`) REFERENCES `Tasks` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `Donations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `amount` float NOT NULL,
  `receiptImage` varchar(255) DEFAULT NULL,
  `createdAt` datetime(6) NOT NULL,
  `updatedAt` datetime(6) NOT NULL,
  `studentId` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `studentId` (`studentId`),
  CONSTRAINT `Donations_ibfk_1` FOREIGN KEY (`studentId`) REFERENCES `Students` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `Rewards` (
  `id` int NOT NULL AUTO_INCREMENT,
  `type` enum('Virtual','Physical') NOT NULL,
  `pointsRequired` int NOT NULL,
  `description` varchar(255) NOT NULL,
  `createdAt` datetime(6) NOT NULL,
  `updatedAt` datetime(6) NOT NULL,
  `studentId` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `studentId` (`studentId`),
  CONSTRAINT `Rewards_ibfk_1` FOREIGN KEY (`studentId`) REFERENCES `Students` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- SequelizeMeta: internal migration-tracking table (Sequelize CLI), not app data.
CREATE TABLE `SequelizeMeta` (
  `name` varchar(255) NOT NULL,
  PRIMARY KEY (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
