import { Body, Controller, Delete, Get, Param, ParseIntPipe, Put } from '@nestjs/common';
import { EmpresaId } from '../common/empresa-id.decorator.js';
import { ExcecaoAgendaDto } from './dto/excecao-agenda.dto.js';
import { UpdateHorarioSemanalDto } from './dto/horario-semanal.dto.js';
import { ExpedientesService } from './expedientes.service.js';

@Controller('profissionais/:profissionalId/expediente')
export class ExpedientesController {
  constructor(private readonly expedientes: ExpedientesService) {}

  @Get()
  find(
    @EmpresaId() empresaId: number,
    @Param('profissionalId', ParseIntPipe) profissionalId: number,
  ) {
    return this.expedientes.find(empresaId, profissionalId);
  }

  @Put('semanal')
  atualizarSemanal(
    @EmpresaId() empresaId: number,
    @Param('profissionalId', ParseIntPipe) profissionalId: number,
    @Body() dto: UpdateHorarioSemanalDto,
  ) {
    return this.expedientes.atualizarSemanal(empresaId, profissionalId, dto);
  }

  @Put('excecoes/:data')
  salvarExcecao(
    @EmpresaId() empresaId: number,
    @Param('profissionalId', ParseIntPipe) profissionalId: number,
    @Param('data') data: string,
    @Body() dto: ExcecaoAgendaDto,
  ) {
    return this.expedientes.salvarExcecao(empresaId, profissionalId, data, dto);
  }

  @Delete('excecoes/:data')
  removerExcecao(
    @EmpresaId() empresaId: number,
    @Param('profissionalId', ParseIntPipe) profissionalId: number,
    @Param('data') data: string,
  ) {
    return this.expedientes.removerExcecao(empresaId, profissionalId, data);
  }
}
