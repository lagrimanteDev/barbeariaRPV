-- Preserve the service duration used by an existing booking when a service is edited later.
ALTER TABLE `agendamento_servicos`
    ADD COLUMN `duracaoMinutos` INTEGER NOT NULL DEFAULT 30;

UPDATE `agendamento_servicos` AS item
INNER JOIN `servicos` AS servico ON servico.`id` = item.`servicoId`
SET item.`duracaoMinutos` = servico.`duracaoMin`;

ALTER TABLE `agendamentos`
    ADD COLUMN `motivo` VARCHAR(500) NULL,
    ADD COLUMN `idempotencyKey` VARCHAR(191) NULL,
    ADD COLUMN `payloadHash` CHAR(64) NULL,
    ADD UNIQUE INDEX `agendamentos_idempotencyKey_key` (`idempotencyKey`);

CREATE TABLE `horarios_semanais` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `empresaId` INTEGER NOT NULL,
    `profissionalId` INTEGER NOT NULL,
    `diaSemana` INTEGER NOT NULL,
    `inicio` VARCHAR(5) NOT NULL,
    `fim` VARCHAR(5) NOT NULL,

    INDEX `horarios_semanais_empresaId_profissionalId_diaSemana_idx` (`empresaId`, `profissionalId`, `diaSemana`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `excecoes_agenda` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `empresaId` INTEGER NOT NULL,
    `profissionalId` INTEGER NOT NULL,
    `data` DATE NOT NULL,
    `fechado` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `excecoes_agenda_profissionalId_data_key` (`profissionalId`, `data`),
    INDEX `excecoes_agenda_empresaId_data_idx` (`empresaId`, `data`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `excecao_horarios` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `excecaoId` INTEGER NOT NULL,
    `inicio` VARCHAR(5) NOT NULL,
    `fim` VARCHAR(5) NOT NULL,

    INDEX `excecao_horarios_excecaoId_idx` (`excecaoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `horarios_semanais`
    ADD CONSTRAINT `horarios_semanais_profissionalId_fkey`
    FOREIGN KEY (`profissionalId`) REFERENCES `profissionais`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `excecoes_agenda`
    ADD CONSTRAINT `excecoes_agenda_profissionalId_fkey`
    FOREIGN KEY (`profissionalId`) REFERENCES `profissionais`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `excecao_horarios`
    ADD CONSTRAINT `excecao_horarios_excecaoId_fkey`
    FOREIGN KEY (`excecaoId`) REFERENCES `excecoes_agenda`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
