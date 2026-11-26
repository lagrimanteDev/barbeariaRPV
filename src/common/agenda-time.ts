import { BadRequestException } from '@nestjs/common';

export const FUSO_AGENDA = 'America/Sao_Paulo';

const formatador = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO_AGENDA,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function validarDataLocal(data: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    throw new BadRequestException('data deve estar no formato AAAA-MM-DD');
  }

  const parsed = new Date(`${data}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== data) {
    throw new BadRequestException('data deve ser uma data válida');
  }
  return parsed;
}

export function partesDataHoraLocal(date: Date) {
  const parts = formatador.formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    data: `${value('year').toString().padStart(4, '0')}-${value('month').toString().padStart(2, '0')}-${value('day').toString().padStart(2, '0')}`,
    hora: value('hour'),
    minuto: value('minute'),
  };
}

export function instanteLocal(data: string, hora: string) {
  validarDataLocal(data);
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hora);
  if (!match) {
    throw new BadRequestException('Horário deve estar no formato HH:mm');
  }

  const target = new Date(`${data}T${hora}:00.000Z`);
  const targetTime = target.getTime();
  let guess = targetTime;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const local = partesDataHoraLocal(new Date(guess));
    const represented = new Date(`${local.data}T${local.hora.toString().padStart(2, '0')}:${local.minuto.toString().padStart(2, '0')}:00.000Z`);
    const difference = targetTime - represented.getTime();
    if (difference === 0) {
      return new Date(guess);
    }
    guess += difference;
  }

  throw new BadRequestException('Horário local não existe no fuso da agenda');
}

export function diaSemanaLocal(data: string) {
  validarDataLocal(data);
  return new Date(`${data}T00:00:00.000Z`).getUTCDay();
}

export function minutosDoDia(hora: string) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hora);
  if (!match) {
    throw new BadRequestException('Horário deve estar no formato HH:mm');
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

export function dataLocal(date: Date) {
  return partesDataHoraLocal(date).data;
}

export function minutoLocal(date: Date) {
  const local = partesDataHoraLocal(date);
  return local.hora * 60 + local.minuto;
}
