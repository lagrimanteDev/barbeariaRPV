import { Controller, Get, Post, Body, Patch, Param, Delete, ParseIntPipe, Query, Headers } from '@nestjs/common';
import { AgendamentosService } from './agendamentos.service.js';
import { CreateAgendamentoDto } from './dto/create-agendamento.dto.js';
import { AgendaQueryDto } from './dto/agenda-query.dto.js';
import { AvailabilityQueryDto } from './dto/availability-query.dto.js';
import { RescheduleAgendamentoDto } from './dto/reschedule-agendamento.dto.js';
import { UpdateStatusDto } from './dto/update-status.dto.js';
import { EmpresaId } from '../common/empresa-id.decorator.js';

@Controller('agendamentos')
export class AgendamentosController {
  constructor(private readonly agendamentosService: AgendamentosService) { }

  @Post()
  create(
    @EmpresaId() empresaId: number,
    @Body() dto: CreateAgendamentoDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    return this.agendamentosService.create(empresaId, dto, idempotencyKey);
  }

  @Get()
  findAll(@EmpresaId() empresaId: number) {
    return this.agendamentosService.findAll(empresaId);
  }

  @Get('agenda')
  findAgenda(
    @EmpresaId() empresaId: number,
    @Query() query: AgendaQueryDto
  ) {
    return this.agendamentosService.findAgenda(empresaId, query);
  }

  @Get('horarios-disponiveis')
  findHorariosDisponiveis(
    @EmpresaId() empresaId: number,
    @Query() query: AvailabilityQueryDto,
  ) {
    return this.agendamentosService.findHorariosDisponiveis(empresaId, query);
  }

  @Get(':id')
  findOne(
    @EmpresaId() empresaId: number,
    @Param('id', ParseIntPipe) id: number
  ) {
    return this.agendamentosService.findOne(empresaId, id);
  }

  @Patch(':id/status')
  atualizarStatus(
    @EmpresaId() empresaId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateStatusDto
  ) {
    return this.agendamentosService.atualizarStatus(empresaId, id, dto);
  }

  @Patch(':id/remarcar')
  remarcar(
    @EmpresaId() empresaId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RescheduleAgendamentoDto,
  ) {
    return this.agendamentosService.remarcar(empresaId, id, dto);
  }

  @Delete(':id')
  remove(
    @EmpresaId() empresaId: number,
    @Param('id', ParseIntPipe) id: number
  ) {
    return this.agendamentosService.remove(empresaId, id);
  }
}
