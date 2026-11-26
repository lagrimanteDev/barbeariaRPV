import { Transform, Type } from 'class-transformer';
import { ArrayNotEmpty, ArrayUnique, IsArray, IsDateString, IsInt, Min } from 'class-validator';

export class AvailabilityQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  profissionalId: number;

  @IsDateString()
  data: string;

  @Transform(({ value }) =>
    typeof value === 'string' ? value.split(',').map((item) => Number(item)) : value,
  )
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsInt({ each: true })
  servicoIds: number[];
}
