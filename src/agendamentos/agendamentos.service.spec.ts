import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { vi } from 'vitest';
import { Prisma } from '../generated/prisma/client.js';
import { AgendamentosService } from './agendamentos.service.js';
import { ExpedientesService } from '../expedientes/expedientes.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { EmpresasService } from '../empresas/empresas.service.js';

describe('AgendamentosService', () => {
  const prisma = {
    $transaction: vi.fn(),
    agendamento: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    profissional: {
      findFirst: vi.fn(),
    },
    servico: {
      findMany: vi.fn(),
    },
  };
  const empresas = {
    validarEmpresaAtiva: vi.fn().mockResolvedValue({ id: 1, ativa: true }),
  };
  const expedientes = {
    periodosDoDia: vi.fn(),
    lockProfissional: vi.fn(),
  };
  const service = new AgendamentosService(
    prisma as unknown as PrismaService,
    empresas as unknown as EmpresasService,
    expedientes as unknown as ExpedientesService,
  );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('filtra a agenda pelo dia civil de São Paulo e pelo início do agendamento', async () => {
    prisma.profissional.findFirst.mockResolvedValue({ id: 7 });
    prisma.agendamento.findMany.mockResolvedValue([]);

    await service.findAgenda(3, { profissionalId: 7, data: '2026-11-25' });

    expect(prisma.agendamento.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        empresaId: 3,
        profissionalId: 7,
        inicio: {
          gte: new Date('2026-11-25T03:00:00.000Z'),
          lt: new Date('2026-11-26T03:00:00.000Z'),
        },
      }),
      orderBy: { inicio: 'asc' },
    }));
  });

  it('rejeita uma data que não existe no calendário', async () => {
    await expect(
      service.findAgenda(3, { profissionalId: 7, data: '2026-02-30' })
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.profissional.findFirst).not.toHaveBeenCalled();
  });

  it('respeita a transição histórica de horário de verão em São Paulo', async () => {
    prisma.profissional.findFirst.mockResolvedValue({ id: 7 });
    prisma.agendamento.findMany.mockResolvedValue([]);

    await service.findAgenda(3, { profissionalId: 7, data: '2018-11-04' });

    expect(prisma.agendamento.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        inicio: {
          gte: new Date('2018-11-04T03:00:00.000Z'),
          lt: new Date('2018-11-05T02:00:00.000Z'),
        },
      }),
    }));
  });

  it('retorna não encontrado para profissional fora da empresa', async () => {
    prisma.profissional.findFirst.mockResolvedValue(null);

    await expect(
      service.findAgenda(3, { profissionalId: 7, data: '2026-11-25' })
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.agendamento.findMany).not.toHaveBeenCalled();
  });

  it('impede mudar o status de um agendamento já finalizado', async () => {
    prisma.agendamento.updateMany.mockResolvedValue({ count: 0 });
    prisma.agendamento.findFirst
      .mockResolvedValueOnce({ id: 12, status: 'AGENDADO', fim: new Date(Date.now() - 60_000) })
      .mockResolvedValueOnce({ id: 12 });

    await expect(
      service.atualizarStatus(3, 12, { status: 'CANCELADO' })
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.agendamento.updateMany).toHaveBeenCalledWith({
      where: { id: 12, empresaId: 3, status: 'AGENDADO' },
      data: { status: 'CANCELADO', motivo: null },
    });
  });

  it('não permite marcar falta antes do fim previsto', async () => {
    prisma.agendamento.findFirst.mockResolvedValue({
      id: 12,
      status: 'AGENDADO',
      fim: new Date(Date.now() + 60_000),
    });

    await expect(
      service.atualizarStatus(3, 12, { status: 'FALTOU' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.agendamento.updateMany).not.toHaveBeenCalled();
  });

  it('devolve o mesmo agendamento para a mesma chave e payload idempotente', async () => {
    const dto = {
      clienteId: 4,
      profissionalId: 7,
      inicio: '2026-11-25T13:00:00.000Z',
      servicoIds: [9, 3],
    };
    const payloadHash = createHash('sha256')
      .update(JSON.stringify({
        empresaId: 3,
        clienteId: dto.clienteId,
        profissionalId: dto.profissionalId,
        inicio: new Date(dto.inicio).toISOString(),
        servicoIds: [3, 9],
      }))
      .digest('hex');
    const existente = { id: 20, empresaId: 3, payloadHash };
    prisma.agendamento.findUnique.mockResolvedValue(existente);

    await expect(service.create(3, dto, 'retry-key')).resolves.toBe(existente);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('revalida o expediente no servidor antes de gravar uma reserva', async () => {
    prisma.agendamento.findUnique.mockResolvedValue(null);
    expedientes.lockProfissional.mockResolvedValue(undefined);
    expedientes.periodosDoDia.mockResolvedValue([{ inicio: '09:00', fim: '12:00' }]);
    const tx = {
      agendamento: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn(),
        create: vi.fn(),
      },
      cliente: { findFirst: vi.fn().mockResolvedValue({ id: 4 }) },
      profissional: { findFirst: vi.fn().mockResolvedValue({ id: 7, ativo: true, nome: 'Alex' }) },
      servico: { findMany: vi.fn().mockResolvedValue([{ id: 9, duracaoMin: 45, preco: 50 }]) },
    };
    prisma.$transaction.mockImplementation((callback) =>
      callback(tx as unknown as Prisma.TransactionClient),
    );

    await expect(service.create(3, {
      clienteId: 4,
      profissionalId: 7,
      inicio: '2030-01-02T18:00:00.000Z',
      servicoIds: [9],
    }, 'new-booking-key')).rejects.toBeInstanceOf(ConflictException);
    expect(tx.agendamento.create).not.toHaveBeenCalled();
  });

  it('retorna os horários livres em incrementos de 15 minutos e exclui sobreposição', async () => {
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const data = tomorrow.toISOString().slice(0, 10);
    prisma.profissional.findFirst.mockResolvedValue({ id: 7 });
    prisma.servico.findMany.mockResolvedValue([{ id: 9, duracaoMin: 30 }]);
    prisma.agendamento.findMany.mockResolvedValue([{
      inicio: new Date(`${data}T12:30:00.000Z`),
      fim: new Date(`${data}T13:00:00.000Z`),
    }]);
    expedientes.periodosDoDia.mockResolvedValue([{ inicio: '09:00', fim: '11:00' }]);

    const horarios = await service.findHorariosDisponiveis(3, {
      profissionalId: 7,
      data,
      servicoIds: [9],
    });

    expect(horarios.length).toBeGreaterThan(0);
    const conflitoInicio = new Date(`${data}T12:30:00.000Z`);
    const conflitoFim = new Date(`${data}T13:00:00.000Z`);
    expect(horarios.every((slot) => {
      const inicio = new Date(slot.inicio);
      const fim = new Date(slot.fim);
      return inicio >= conflitoFim || fim <= conflitoInicio;
    })).toBe(true);
  });
});
