import { Type } from 'class-transformer';
import { IsArray, IsBoolean, Matches, ValidateNested } from 'class-validator';

export class PeriodoExcecaoDto {
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/)
  inicio: string;

  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/)
  fim: string;
}

export class ExcecaoAgendaDto {
  @IsBoolean()
  fechado: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PeriodoExcecaoDto)
  periodos: PeriodoExcecaoDto[];
}
