import { BadRequestException } from '@nestjs/common';
import { dataLocal, instanteLocal, validarDataLocal } from './agenda-time.js';

describe('agenda-time', () => {
  it('converts an appointment time using the São Paulo timezone', () => {
    const instant = instanteLocal('2026-06-18', '09:15');

    expect(instant.toISOString()).toBe('2026-06-18T12:15:00.000Z');
    expect(dataLocal(instant)).toBe('2026-06-18');
  });

  it('rejects calendar dates that do not exist', () => {
    expect(() => validarDataLocal('2026-02-31')).toThrow(BadRequestException);
  });
});
