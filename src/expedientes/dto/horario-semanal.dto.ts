import { Type } from 'class-transformer';
import { ArrayUnique, IsArray, IsInt, Max, Min, Matches, ValidateNested } from 'class-validator';

export class HorarioSemanalItemDto {
  @IsInt()
  @Min(0)
  @Max(6)
  diaSemana: number;

  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/)
  inicio: string;

  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/)
  fim: string;
}

export class UpdateHorarioSemanalDto {
  @IsArray()
  @ArrayUnique((item: HorarioSemanalItemDto) => `${item.diaSemana}-${item.inicio}`)
  @ValidateNested({ each: true })
  @Type(() => HorarioSemanalItemDto)
  horarios: HorarioSemanalItemDto[];
}
