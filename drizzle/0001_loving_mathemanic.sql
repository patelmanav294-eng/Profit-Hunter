CREATE TABLE `chartAnalyses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`pair` varchar(32) NOT NULL,
	`timeframe` varchar(16) NOT NULL,
	`imageUrl` text NOT NULL,
	`imageKey` varchar(255) NOT NULL,
	`direction` enum('buy','sell','no_trade') NOT NULL,
	`entryPrice` varchar(64),
	`stopLoss` varchar(64),
	`takeProfit` varchar(64),
	`reasoning` text NOT NULL,
	`confidenceScore` int NOT NULL,
	`riskWarning` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `chartAnalyses_id` PRIMARY KEY(`id`)
);
