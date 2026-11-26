import { IsDateString, IsInt, Min } from 'class-validator';

export class RescheduleAgendamentoDto {
  @IsInt()
  @Min(1)
  profissionalId: number;

  @IsDateString()
  inicio: string;
}
