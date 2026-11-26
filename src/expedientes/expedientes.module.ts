import { Module } from '@nestjs/common';
import { EmpresasModule } from '../empresas/empresas.module.js';
import { ExpedientesController } from './expedientes.controller.js';
import { ExpedientesService } from './expedientes.service.js';

@Module({
  imports: [EmpresasModule],
  controllers: [ExpedientesController],
  providers: [ExpedientesService],
  exports: [ExpedientesService],
})
export class ExpedientesModule {}
