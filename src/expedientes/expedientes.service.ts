import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { EmpresasService } from '../empresas/empresas.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ExcecaoAgendaDto } from './dto/excecao-agenda.dto.js';
import { UpdateHorarioSemanalDto } from './dto/horario-semanal.dto.js';
import { dataLocal, diaSemanaLocal, minutosDoDia, validarDataLocal } from '../common/agenda-time.js';

type Transacao = Prisma.TransactionClient;
type Periodo = { inicio: string; fim: string };

@Injectable()
export class ExpedientesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly empresas: EmpresasService,
  ) {}

  async find(empresaId: number, profissionalId: number) {
    await this.empresas.validarEmpresaAtiva(empresaId);
    await this.validarProfissional(empresaId, profissionalId);

    const [horarios, excecoes] = await Promise.all([
      this.prisma.horarioSemanal.findMany({
        where: { empresaId, profissionalId },
        orderBy: [{ diaSemana: 'asc' }, { inicio: 'asc' }],
      }),
      this.prisma.excecaoAgenda.findMany({
        where: { empresaId, profissionalId },
        include: { horarios: { orderBy: { inicio: 'asc' } } },
        orderBy: { data: 'asc' },
      }),
    ]);

    return {
      horarios,
      excecoes: excecoes.map((excecao) => ({
        data: excecao.data.toISOString().slice(0, 10),
        fechado: excecao.fechado,
        periodos: excecao.horarios.map(({ inicio, fim }) => ({ inicio, fim })),
      })),
    };
  }

  async atualizarSemanal(empresaId: number, profissionalId: number, dto: UpdateHorarioSemanalDto) {
    await this.empresas.validarEmpresaAtiva(empresaId);
    this.validarPeriodos(dto.horarios);

    return this.prisma.$transaction(async (tx) => {
      await this.lockProfissional(tx, empresaId, profissionalId);
      await tx.horarioSemanal.deleteMany({ where: { empresaId, profissionalId } });
      if (dto.horarios.length > 0) {
        await tx.horarioSemanal.createMany({
          data: dto.horarios.map((horario) => ({ ...horario, empresaId, profissionalId })),
        });
      }
      await this.validarAgendamentosFuturos(tx, empresaId, profissionalId);
      return this.findDentroTransacao(tx, empresaId, profissionalId);
    });
  }

  async salvarExcecao(
    empresaId: number,
    profissionalId: number,
    data: string,
    dto: ExcecaoAgendaDto,
  ) {
    await this.empresas.validarEmpresaAtiva(empresaId);
    const dataBanco = new Date(`${data}T00:00:00.000Z`);
    if (Number.isNaN(dataBanco.getTime()) || dataBanco.toISOString().slice(0, 10) !== data) {
      throw new BadRequestException('data deve ser uma data válida no formato AAAA-MM-DD');
    }
    if (dto.fechado && dto.periodos.length > 0) {
      throw new BadRequestException('Uma exceção fechada não pode conter horários');
    }
    if (!dto.fechado && dto.periodos.length === 0) {
      throw new BadRequestException('Informe ao menos um período ou marque o dia como fechado');
    }
    this.validarPeriodos(dto.periodos);

    return this.prisma.$transaction(async (tx) => {
      await this.lockProfissional(tx, empresaId, profissionalId);
      const existente = await tx.excecaoAgenda.findUnique({
        where: { profissionalId_data: { profissionalId, data: dataBanco } },
        select: { id: true },
      });
      if (existente) {
        await tx.excecaoHorarioIntervalo.deleteMany({ where: { excecaoId: existente.id } });
        await tx.excecaoAgenda.update({
          where: { id: existente.id },
          data: { empresaId, fechado: dto.fechado },
        });
        if (dto.periodos.length > 0) {
          await tx.excecaoHorarioIntervalo.createMany({
            data: dto.periodos.map((periodo) => ({ ...periodo, excecaoId: existente.id })),
          });
        }
      } else {
        await tx.excecaoAgenda.create({
          data: {
            empresaId,
            profissionalId,
            data: dataBanco,
            fechado: dto.fechado,
            horarios: { create: dto.periodos },
          },
        });
      }
      await this.validarAgendamentosFuturos(tx, empresaId, profissionalId);
      return this.findDentroTransacao(tx, empresaId, profissionalId);
    });
  }

  async removerExcecao(empresaId: number, profissionalId: number, data: string) {
    await this.empresas.validarEmpresaAtiva(empresaId);
    const dataBanco = new Date(`${data}T00:00:00.000Z`);
    if (Number.isNaN(dataBanco.getTime()) || dataBanco.toISOString().slice(0, 10) !== data) {
      throw new BadRequestException('data deve ser uma data válida no formato AAAA-MM-DD');
    }

    return this.prisma.$transaction(async (tx) => {
      await this.lockProfissional(tx, empresaId, profissionalId);
      const excecao = await tx.excecaoAgenda.findFirst({
        where: { empresaId, profissionalId, data: dataBanco },
        select: { id: true },
      });
      if (!excecao) {
        throw new NotFoundException('Exceção de agenda não encontrada');
      }
      await tx.excecaoAgenda.delete({ where: { id: excecao.id } });
      await this.validarAgendamentosFuturos(tx, empresaId, profissionalId);
      return this.findDentroTransacao(tx, empresaId, profissionalId);
    });
  }

  async periodosDoDia(tx: Transacao, empresaId: number, profissionalId: number, data: string): Promise<Periodo[]> {
    validarDataLocal(data);
    const dataBanco = new Date(`${data}T00:00:00.000Z`);
    const excecao = await tx.excecaoAgenda.findUnique({
      where: { profissionalId_data: { profissionalId, data: dataBanco } },
      include: { horarios: { orderBy: { inicio: 'asc' } } },
    });
    if (excecao) {
      return excecao.fechado ? [] : excecao.horarios;
    }

    return tx.horarioSemanal.findMany({
      where: {
        empresaId,
        profissionalId,
        diaSemana: diaSemanaLocal(data),
      },
      select: { inicio: true, fim: true },
      orderBy: { inicio: 'asc' },
    });
  }

  async validarProfissional(empresaId: number, profissionalId: number) {
    const profissional = await this.prisma.profissional.findFirst({
      where: { id: profissionalId, empresaId },
      select: { id: true },
    });
    if (!profissional) {
      throw new NotFoundException('Profissional não encontrado nesta empresa');
    }
  }

  async lockProfissional(tx: Transacao, empresaId: number, profissionalId: number) {
    const rows = await tx.$queryRaw<Array<{ id: number }>>`
      SELECT id FROM profissionais
      WHERE id = ${profissionalId} AND empresaId = ${empresaId}
      FOR UPDATE
    `;
    if (rows.length === 0) {
      throw new NotFoundException('Profissional não encontrado nesta empresa');
    }
  }

  private validarPeriodos(periodos: Periodo[]) {
    const ordenados = [...periodos].sort((a, b) => minutosDoDia(a.inicio) - minutosDoDia(b.inicio));
    for (let index = 0; index < ordenados.length; index += 1) {
      const atual = ordenados[index];
      if (minutosDoDia(atual.fim) <= minutosDoDia(atual.inicio)) {
        throw new BadRequestException('O fim de cada período deve ser posterior ao início');
      }
      if (index > 0 && minutosDoDia(atual.inicio) < minutosDoDia(ordenados[index - 1].fim)) {
        throw new BadRequestException('Os períodos de expediente não podem se sobrepor');
      }
    }
  }

  private async validarAgendamentosFuturos(tx: Transacao, empresaId: number, profissionalId: number) {
    const agora = new Date();
    const agendamentos = await tx.agendamento.findMany({
      where: { empresaId, profissionalId, status: 'AGENDADO', inicio: { gt: agora } },
      select: { id: true, inicio: true, fim: true },
    });
    const datas = [...new Set(agendamentos.map(({ inicio }) => dataLocal(inicio)))];
    const intervalos = new Map<string, Periodo[]>();
    for (const data of datas) {
      intervalos.set(data, await this.periodosDoDia(tx, empresaId, profissionalId, data));
    }

    const conflitos = agendamentos.filter((agendamento) => {
      const dataInicio = dataLocal(agendamento.inicio);
      if (dataLocal(agendamento.fim) !== dataInicio) {
        return true;
      }
      const inicio = minutoLocalAgendamento(agendamento.inicio);
      const fim = minutoLocalAgendamento(agendamento.fim);
      return !(intervalos.get(dataInicio) ?? []).some(
        (periodo) => inicio >= minutosDoDia(periodo.inicio) && fim <= minutosDoDia(periodo.fim),
      );
    });

    if (conflitos.length > 0) {
      throw new ConflictException(
        `Resolva os agendamentos futuros ${conflitos.map(({ id }) => `#${id}`).join(', ')} antes de alterar o expediente`,
      );
    }
  }

  private async findDentroTransacao(tx: Transacao, empresaId: number, profissionalId: number) {
    const [horarios, excecoes] = await Promise.all([
      tx.horarioSemanal.findMany({
        where: { empresaId, profissionalId },
        orderBy: [{ diaSemana: 'asc' }, { inicio: 'asc' }],
      }),
      tx.excecaoAgenda.findMany({
        where: { empresaId, profissionalId },
        include: { horarios: { orderBy: { inicio: 'asc' } } },
        orderBy: { data: 'asc' },
      }),
    ]);
    return {
      horarios,
      excecoes: excecoes.map((excecao) => ({
        data: excecao.data.toISOString().slice(0, 10),
        fechado: excecao.fechado,
        periodos: excecao.horarios.map(({ inicio, fim }) => ({ inicio, fim })),
      })),
    };
  }
}

function minutoLocalAgendamento(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return value('hour') * 60 + value('minute');
}
