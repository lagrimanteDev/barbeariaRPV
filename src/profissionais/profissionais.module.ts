import { Module } from '@nestjs/common';
import { ProfissionaisService } from './profissionais.service.js';
import { ProfissionaisController } from './profissionais.controller.js';
import { EmpresasModule } from '../empresas/empresas.module.js';
import { ExpedientesModule } from '../expedientes/expedientes.module.js';

@Module({
  controllers: [ProfissionaisController],
  providers: [ProfissionaisService],
  imports: [EmpresasModule, ExpedientesModule],
})
export class ProfissionaisModule { }
