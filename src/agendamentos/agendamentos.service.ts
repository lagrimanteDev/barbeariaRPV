import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '../generated/prisma/client.js';
import { dataLocal, FUSO_AGENDA, instanteLocal, minutoLocal, minutosDoDia } from '../common/agenda-time.js';
import { AgendaQueryDto } from './dto/agenda-query.dto.js';
import { AvailabilityQueryDto } from './dto/availability-query.dto.js';
import { CreateAgendamentoDto } from './dto/create-agendamento.dto.js';
import { RescheduleAgendamentoDto } from './dto/reschedule-agendamento.dto.js';
import { UpdateStatusDto } from './dto/update-status.dto.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { EmpresasService } from '../empresas/empresas.service.js';
import { ExpedientesService } from '../expedientes/expedientes.service.js';

const DETALHES = {
  cliente: { select: { id: true, nome: true, telefone: true } },
  profissional: { select: { id: true, nome: true } },
  servicos: {
    include: {
      servico: { select: { id: true, nome: true, duracaoMin: true } },
    }
  }

}

const hora = (d: Date) =>
  d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })

const formatadorFuso = new Intl.DateTimeFormat('en-US', {
  timeZone: FUSO_AGENDA,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function partesLocais(timestamp: number) {
  const partes = formatadorFuso.formatToParts(new Date(timestamp));
  const valor = (tipo: Intl.DateTimeFormatPartTypes) =>
    Number(partes.find((parte) => parte.type === tipo)?.value);

  return {
    ano: valor('year'),
    mes: valor('month'),
    dia: valor('day'),
    hora: valor('hour'),
    minuto: valor('minute'),
    segundo: valor('second'),
  };
}

function timestampUtc(ano: number, mes: number, dia: number, hora = 0, minuto = 0, segundo = 0) {
  const data = new Date(0);
  data.setUTCFullYear(ano, mes - 1, dia);
  data.setUTCHours(hora, minuto, segundo, 0);
  return data.getTime();
}

function inicioDoDiaNoFuso(ano: number, mes: number, dia: number) {
  const aproximacaoUtc = timestampUtc(ano, mes, dia);
  const offsets = new Set<number>();

  // Amostras em torno do dia também cobrem transições de horário de verão à meia-noite.
  for (let horas = -36; horas <= 36; horas += 12) {
    const amostra = aproximacaoUtc + horas * 60 * 60 * 1000;
    const local = partesLocais(amostra);
    offsets.add(
      timestampUtc(local.ano, local.mes, local.dia, local.hora, local.minuto, local.segundo) - amostra
    );
  }

  const candidatos = [...offsets]
    .map((offset) => aproximacaoUtc - offset)
    .filter((timestamp) => {
      const local = partesLocais(timestamp);
      return local.ano === ano && local.mes === mes && local.dia === dia;
    })
    .sort((a, b) => a - b);

  if (candidatos.length === 0) {
    throw new BadRequestException('Data inválida para o fuso da agenda');
  }

  const meiaNoite = candidatos.find((timestamp) => {
    const local = partesLocais(timestamp);
    return local.hora === 0 && local.minuto === 0 && local.segundo === 0;
  });

  return new Date(meiaNoite ?? candidatos[0]);
}

function intervaloDoDia(data: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    throw new BadRequestException('data deve estar no formato AAAA-MM-DD');
  }

  const dataUtc = new Date(`${data}T00:00:00.000Z`);
  if (Number.isNaN(dataUtc.getTime()) || dataUtc.toISOString().slice(0, 10) !== data) {
    throw new BadRequestException('data deve ser uma data válida');
  }

  const proximoDia = new Date(dataUtc);
  proximoDia.setUTCDate(proximoDia.getUTCDate() + 1);

  return {
    inicio: inicioDoDiaNoFuso(dataUtc.getUTCFullYear(), dataUtc.getUTCMonth() + 1, dataUtc.getUTCDate()),
    fim: inicioDoDiaNoFuso(proximoDia.getUTCFullYear(), proximoDia.getUTCMonth() + 1, proximoDia.getUTCDate()),
  };
}

@Injectable()
export class AgendamentosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly empresas: EmpresasService,
    private readonly expedientes: ExpedientesService,
  ) { }

  async create(empresaId: number, dto: CreateAgendamentoDto, chave: string) {
    await this.empresas.validarEmpresaAtiva(empresaId);
    const idempotencyKey = chave?.trim();
    if (!idempotencyKey || idempotencyKey.length > 191) {
      throw new BadRequestException('O header Idempotency-Key é obrigatório e deve ter até 191 caracteres');
    }

    const inicio = new Date(dto.inicio);
    if (Number.isNaN(inicio.getTime())) {
      throw new BadRequestException('Data e horário do agendamento inválidos');
    }
    const payloadHash = this.hashPayload(empresaId, dto, inicio);
    const anterior = await this.prisma.agendamento.findUnique({
      where: { idempotencyKey },
      include: DETALHES,
    });
    if (anterior) {
      return this.validarRepeticao(anterior, empresaId, payloadHash);
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.expedientes.lockProfissional(tx, empresaId, dto.profissionalId);
        const repetido = await tx.agendamento.findUnique({
          where: { idempotencyKey },
          include: DETALHES,
        });
        if (repetido) {
          return this.validarRepeticao(repetido, empresaId, payloadHash);
        }

        if (inicio <= new Date()) {
          throw new BadRequestException('Não é possível agendar numa data antiga');
        }
        const cliente = await tx.cliente.findFirst({ where: { empresaId, id: dto.clienteId } });
        if (!cliente) {
          throw new NotFoundException('Cliente não encontrado nesta empresa');
        }

        const profissional = await tx.profissional.findFirst({
          where: { id: dto.profissionalId, empresaId },
        });
        if (!profissional?.ativo) {
          throw new NotFoundException('Profissional inativo ou não encontrado nesta empresa');
        }

        const servicos = await tx.servico.findMany({
          where: { empresaId, id: { in: dto.servicoIds } },
        });
        if (servicos.length !== dto.servicoIds.length) {
          throw new NotFoundException('Serviço não encontrado nesta empresa');
        }

        const duracaoTotal = servicos.reduce((soma, servico) => soma + servico.duracaoMin, 0);
        const fim = new Date(inicio.getTime() + duracaoTotal * 60_000);
        this.validarInicioEmIncremento(inicio);
        await this.validarDentroExpediente(tx, empresaId, dto.profissionalId, inicio, fim);
        await this.validarSemConflito(tx, empresaId, dto.profissionalId, inicio, fim);

        return tx.agendamento.create({
          data: {
            inicio,
            fim,
            empresaId,
            clienteId: dto.clienteId,
            profissionalId: dto.profissionalId,
            idempotencyKey,
            payloadHash,
            servicos: {
              create: servicos.map((servico) => ({
                servicoId: servico.id,
                precoCobrado: servico.preco,
                duracaoMinutos: servico.duracaoMin,
              })),
            },
          },
          include: DETALHES,
        });
      });
    } catch (error) {
      if (!this.isUniqueViolation(error)) {
        throw error;
      }
      const resultadoConcorrente = await this.prisma.agendamento.findUnique({
        where: { idempotencyKey },
        include: DETALHES,
      });
      if (!resultadoConcorrente) {
        throw error;
      }
      return this.validarRepeticao(resultadoConcorrente, empresaId, payloadHash);
    }
  }

  async findHorariosDisponiveis(empresaId: number, query: AvailabilityQueryDto) {
    await this.empresas.validarEmpresaAtiva(empresaId);
    const profissional = await this.prisma.profissional.findFirst({
      where: { id: query.profissionalId, empresaId, ativo: true },
      select: { id: true },
    });
    if (!profissional) {
      throw new NotFoundException('Profissional ativo não encontrado nesta empresa');
    }
    const servicos = await this.prisma.servico.findMany({
      where: { empresaId, id: { in: query.servicoIds } },
    });
    if (servicos.length !== query.servicoIds.length) {
      throw new NotFoundException('Serviço não encontrado nesta empresa');
    }
    const duracaoTotal = servicos.reduce((soma, servico) => soma + servico.duracaoMin, 0);
    const periodos = await this.expedientes.periodosDoDia(
      this.prisma,
      empresaId,
      query.profissionalId,
      query.data,
    );
    if (periodos.length === 0) {
      return [];
    }

    const primeiroInicio = instanteLocal(query.data, periodos[0].inicio);
    const ultimoFim = instanteLocal(query.data, periodos[periodos.length - 1].fim);
    const agendamentos = await this.prisma.agendamento.findMany({
      where: {
        empresaId,
        profissionalId: query.profissionalId,
        status: 'AGENDADO',
        inicio: { lt: ultimoFim },
        fim: { gt: primeiroInicio },
      },
      select: { inicio: true, fim: true },
    });
    const agora = Date.now();
    const horarios: Array<{ inicio: string; fim: string }> = [];
    for (const periodo of periodos) {
      const inicioMinuto = minutosDoDia(periodo.inicio);
      const fimMinuto = minutosDoDia(periodo.fim);
      const primeiroInicio = Math.ceil(inicioMinuto / 15) * 15;
      for (let minuto = primeiroInicio; minuto + duracaoTotal <= fimMinuto; minuto += 15) {
        const inicio = instanteLocal(
          query.data,
          `${Math.floor(minuto / 60).toString().padStart(2, '0')}:${(minuto % 60).toString().padStart(2, '0')}`,
        );
        const fim = new Date(inicio.getTime() + duracaoTotal * 60_000);
        if (
          inicio.getTime() > agora &&
          !agendamentos.some((agendamento) => agendamento.inicio < fim && agendamento.fim > inicio)
        ) {
          horarios.push({ inicio: inicio.toISOString(), fim: fim.toISOString() });
        }
      }
    }
    return horarios;
  }

  async remarcar(empresaId: number, id: number, dto: RescheduleAgendamentoDto) {
    await this.empresas.validarEmpresaAtiva(empresaId);
    const inicio = new Date(dto.inicio);
    if (Number.isNaN(inicio.getTime()) || inicio <= new Date()) {
      throw new BadRequestException('A nova data do agendamento deve ser válida e futura');
    }

    return this.prisma.$transaction(async (tx) => {
      await this.expedientes.lockProfissional(tx, empresaId, dto.profissionalId);
      const original = await tx.agendamento.findFirst({
        where: { id, empresaId },
        include: { servicos: true },
      });
      if (!original) {
        throw new NotFoundException('Agendamento não encontrado');
      }
      if (original.status !== 'AGENDADO') {
        throw new ConflictException('Somente agendamentos AGENDADO podem ser remarcados');
      }

      const profissional = await tx.profissional.findFirst({
        where: { id: dto.profissionalId, empresaId, ativo: true },
        select: { id: true },
      });
      if (!profissional) {
        throw new NotFoundException('Profissional ativo não encontrado nesta empresa');
      }

      const duracaoTotal = original.servicos.reduce((soma, servico) => soma + servico.duracaoMinutos, 0);
      const fim = new Date(inicio.getTime() + duracaoTotal * 60_000);
      this.validarInicioEmIncremento(inicio);
      await this.validarDentroExpediente(tx, empresaId, dto.profissionalId, inicio, fim);
      await this.validarSemConflito(tx, empresaId, dto.profissionalId, inicio, fim, id);

      const resultado = await tx.agendamento.updateMany({
        where: { id, empresaId, status: 'AGENDADO' },
        data: { inicio, fim, profissionalId: dto.profissionalId },
      });
      if (resultado.count === 0) {
        throw new ConflictException('O agendamento foi finalizado antes da remarcação');
      }
      const atualizado = await tx.agendamento.findFirst({
        where: { id, empresaId },
        include: DETALHES,
      });
      if (!atualizado) {
        throw new NotFoundException('Agendamento não encontrado');
      }
      return atualizado;
    });
  }

  async findAll(empresaId: number) {
    await this.empresas.validarEmpresaAtiva(empresaId);

    return this.prisma.agendamento.findMany({
      where: { empresaId },
      include: DETALHES,
      orderBy: { inicio: 'asc' }
    });
  }

  async findAgenda(empresaId: number, query: AgendaQueryDto) {
    await this.empresas.validarEmpresaAtiva(empresaId);
    const { inicio, fim } = intervaloDoDia(query.data);

    const profissional = await this.prisma.profissional.findFirst({
      where: { id: query.profissionalId, empresaId },
      select: { id: true }
    });

    if (!profissional) {
      throw new NotFoundException('Profissional não encontrado nesta empresa');
    }

    return this.prisma.agendamento.findMany({
      where: {
        empresaId,
        profissionalId: query.profissionalId,
        inicio: { gte: inicio, lt: fim }
      },
      include: DETALHES,
      orderBy: { inicio: 'asc' }
    });
  }

  async findOne(empresaId: number, id: number) {
    await this.empresas.validarEmpresaAtiva(empresaId);

    const agendamento = await this.prisma.agendamento.findFirst({
      where: { id, empresaId },
      include: DETALHES
    });

    if (!agendamento) {
      throw new NotFoundException('Agendamento não encontrado');
    }

    return agendamento;
  }

  async atualizarStatus(empresaId: number, id: number, dto: UpdateStatusDto) {
    await this.empresas.validarEmpresaAtiva(empresaId);
    const atual = await this.prisma.agendamento.findFirst({
      where: { id, empresaId },
      select: { id: true, status: true, fim: true },
    });
    if (!atual) {
      throw new NotFoundException('Agendamento não encontrado');
    }
    if (atual.status !== 'AGENDADO') {
      throw new ConflictException('Não é possível alterar o status de um agendamento finalizado');
    }
    if (dto.status === 'FALTOU' && atual.fim > new Date()) {
      throw new ConflictException('Só é possível marcar falta depois do horário previsto para o fim');
    }
    if (dto.status === 'CONCLUIDO' && dto.motivo?.trim()) {
      throw new BadRequestException('Motivo só pode ser informado para cancelamento ou falta');
    }

    const resultado = await this.prisma.agendamento.updateMany({
      where: { id, empresaId, status: 'AGENDADO' },
      data: {
        status: dto.status,
        motivo: dto.status === 'CANCELADO' || dto.status === 'FALTOU'
          ? dto.motivo?.trim() || null
          : null,
      }
    });

    if (resultado.count === 0) {
      const agendamento = await this.prisma.agendamento.findFirst({
        where: { id, empresaId },
        select: { id: true }
      });

      if (!agendamento) {
        throw new NotFoundException('Agendamento não encontrado');
      }

      throw new ConflictException('Não é possível alterar o status de um agendamento finalizado');
    }

    const agendamento = await this.prisma.agendamento.findFirst({
      where: { id, empresaId },
      include: DETALHES
    });

    if (!agendamento) {
      throw new NotFoundException('Agendamento não encontrado');
    }

    return agendamento;
  }

  async remove(empresaId: number, id: number) {
    await this.empresas.validarEmpresaAtiva(empresaId);

    return this.prisma.$transaction(async (tx) => {
      const agendamento = await tx.agendamento.findFirst({
        where: { id, empresaId },
        include: DETALHES
      });

      if (!agendamento) {
        throw new NotFoundException('Agendamento não encontrado');
      }

      if (agendamento.status !== 'AGENDADO') {
        throw new ConflictException('Agendamentos finalizados não podem ser excluídos');
      }

      await tx.agendamentoServico.deleteMany({ where: { agendamentoId: id } });

      const resultado = await tx.agendamento.deleteMany({
        where: { id, empresaId, status: 'AGENDADO' }
      });

      if (resultado.count === 0) {
        const existente = await tx.agendamento.findFirst({
          where: { id, empresaId },
          select: { id: true }
        });

        if (!existente) {
          throw new NotFoundException('Agendamento não encontrado');
        }

        throw new ConflictException('Não é possível excluir um agendamento finalizado');
      }

      return agendamento;
    });
  }

  private hashPayload(empresaId: number, dto: CreateAgendamentoDto, inicio: Date) {
    const canonical = JSON.stringify({
      empresaId,
      clienteId: dto.clienteId,
      profissionalId: dto.profissionalId,
      inicio: inicio.toISOString(),
      servicoIds: [...dto.servicoIds].sort((a, b) => a - b),
    });
    return createHash('sha256').update(canonical).digest('hex');
  }

  private validarRepeticao<T extends { empresaId: number | null; payloadHash: string | null }>(
    agendamento: T,
    empresaId: number,
    payloadHash: string,
  ) {
    if (agendamento.empresaId !== empresaId || agendamento.payloadHash !== payloadHash) {
      throw new ConflictException('Idempotency-Key já foi usada com outra solicitação');
    }
    return agendamento;
  }

  private validarInicioEmIncremento(inicio: Date) {
    if (minutoLocal(inicio) % 15 !== 0 || inicio.getUTCSeconds() !== 0 || inicio.getUTCMilliseconds() !== 0) {
      throw new ConflictException('Os horários devem começar em incrementos de 15 minutos');
    }
  }

  private async validarDentroExpediente(
    tx: Prisma.TransactionClient,
    empresaId: number,
    profissionalId: number,
    inicio: Date,
    fim: Date,
  ) {
    const data = dataLocal(inicio);
    if (dataLocal(fim) !== data) {
      throw new ConflictException('O atendimento precisa terminar no mesmo dia do expediente');
    }
    const inicioMinuto = minutoLocal(inicio);
    const fimMinuto = minutoLocal(fim);
    const periodos = await this.expedientes.periodosDoDia(tx, empresaId, profissionalId, data);
    if (!periodos.some((periodo) =>
      inicioMinuto >= minutosDoDia(periodo.inicio) && fimMinuto <= minutosDoDia(periodo.fim),
    )) {
      throw new ConflictException('O horário escolhido está fora do expediente do profissional');
    }
  }

  private async validarSemConflito(
    tx: Prisma.TransactionClient,
    empresaId: number,
    profissionalId: number,
    inicio: Date,
    fim: Date,
    ignorarId?: number,
  ) {
    const conflito = await tx.agendamento.findFirst({
      where: {
        empresaId,
        profissionalId,
        status: 'AGENDADO',
        id: ignorarId === undefined ? undefined : { not: ignorarId },
        inicio: { lt: fim },
        fim: { gt: inicio },
      },
    });
    if (conflito) {
      throw new ConflictException(
        `Profissional já possui atendimento das ${hora(conflito.inicio)} às ${hora(conflito.fim)}`,
      );
    }
  }

  private isUniqueViolation(error: unknown) {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
  }
}
