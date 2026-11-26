import 'dotenv/config';
import { createHash } from 'node:crypto';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

const adapter = new PrismaMariaDb(process.env.DATABASE_URL);
const prisma = new PrismaClient({ adapter });

const companyData = {
  nome: 'Ateliê Aurora — Demonstração',
  cnpj: '00000000000191',
  telefone: '11999990000',
  ativa: true,
};

async function seed() {
  const company = await prisma.empresa.upsert({
    where: { cnpj: companyData.cnpj },
    update: {
      nome: companyData.nome,
      telefone: companyData.telefone,
      ativa: true,
    },
    create: companyData,
  });

  const clients = [];
  for (const [nome, telefone] of [
    ['Marina Oliveira', '11999990001'],
    ['Caio Mendes', '11999990002'],
    ['Joana Ribeiro', '11999990003'],
    ['Bruno Almeida', '11999990004'],
    ['Camila Santos', '11999990005'],
    ['Pedro Costa', '11999990006'],
    ['Isabela Rocha', '11999990007'],
    ['Gabriel Lima', '11999990008'],
    ['Larissa Souza', '11999990009'],
    ['Mateus Carvalho', '11999990010'],
    ['Beatriz Ferreira', '11999990011'],
    ['Felipe Rodrigues', '11999990012'],
    ['Ana Clara Nunes', '11999990013'],
    ['Thiago Barbosa', '11999990014'],
    ['Vitória Martins', '11999990015'],
    ['Daniel Ribeiro', '11999990016'],
  ]) {
    clients.push(
      await prisma.cliente.upsert({
        where: { empresaId_telefone: { empresaId: company.id, telefone } },
        update: { nome },
        create: { empresaId: company.id, nome, telefone },
      }),
    );
  }

  const professionals = [];
  for (const nome of [
    'Rafael Martins',
    'Lucas Ferreira',
    'André Costa',
    'Diego Santos',
  ]) {
    const existing = await prisma.profissional.findFirst({
      where: { empresaId: company.id, nome },
    });
    professionals.push(
      existing
        ? await prisma.profissional.update({
            where: { id: existing.id },
            data: { ativo: true },
          })
        : await prisma.profissional.create({
            data: { empresaId: company.id, nome, ativo: true },
          }),
    );
  }

  const services = [];
  for (const data of [
    { nome: 'Corte', preco: 45, duracaoMin: 45 },
    { nome: 'Barba', preco: 30, duracaoMin: 30 },
    { nome: 'Corte + barba', preco: 68, duracaoMin: 75 },
    { nome: 'Degradê', preco: 50, duracaoMin: 45 },
    { nome: 'Pezinho', preco: 15, duracaoMin: 15 },
    { nome: 'Sobrancelha', preco: 20, duracaoMin: 15 },
    { nome: 'Hidratação capilar', preco: 35, duracaoMin: 30 },
    { nome: 'Pigmentação de barba', preco: 40, duracaoMin: 30 },
  ]) {
    const existing = await prisma.servico.findFirst({
      where: { empresaId: company.id, nome: data.nome },
    });
    services.push(
      existing
        ? await prisma.servico.update({ where: { id: existing.id }, data })
        : await prisma.servico.create({
            data: { ...data, empresaId: company.id },
          }),
    );
  }

  const weeklyHours = [
    ...[1, 2, 3, 4, 5].flatMap((diaSemana) => [
      { diaSemana, inicio: '09:00', fim: '12:00' },
      { diaSemana, inicio: '13:00', fim: '19:00' },
    ]),
    { diaSemana: 6, inicio: '09:00', fim: '14:00' },
  ];
  for (const professional of professionals) {
    await prisma.horarioSemanal.deleteMany({
      where: { empresaId: company.id, profissionalId: professional.id },
    });
    await prisma.horarioSemanal.createMany({
      data: weeklyHours.map((hours) => ({
        ...hours,
        empresaId: company.id,
        profissionalId: professional.id,
      })),
    });
  }

  const bookings = [];
  const historicalDates = previousBusinessDays(15);
  const futureDates = nextBusinessDays(10);
  const serviceCombinations = [
    [services[0]],
    [services[1]],
    [services[2]],
    [services[3]],
    [services[0], services[4]],
    [services[1], services[5]],
    [services[3], services[1]],
    [services[6]],
    [services[7], services[1]],
  ];
  const slotsForDate = (date) =>
    new Date(`${date}T00:00:00.000Z`).getUTCDay() === 6
      ? ['09:00', '10:30']
      : ['09:00', '14:00'];

  historicalDates.forEach((date, dateIndex) => {
    const times = slotsForDate(date);
    professionals.forEach((professional, professionalIndex) => {
      times.forEach((time, slotIndex) => {
        const index =
          dateIndex * professionals.length * times.length +
          professionalIndex * times.length +
          slotIndex;
        const statusIndex = index % 12;
        bookings.push({
          key: `demo-seed:history:${date}:${professional.id}:${time}`,
          client: clients[index % clients.length],
          professional,
          services: serviceCombinations[index % serviceCombinations.length],
          date,
          time,
          status:
            statusIndex < 8
              ? 'CONCLUIDO'
              : statusIndex === 8
                ? 'CANCELADO'
                : statusIndex === 9
                  ? 'FALTOU'
                  : 'AGENDADO',
          motivo:
            statusIndex === 8
              ? 'Cancelado para fins de demonstração'
              : statusIndex === 9
                ? 'Cliente não compareceu'
                : null,
        });
      });
    });
  });

  futureDates.forEach((date, dateIndex) => {
    const times = slotsForDate(date);
    professionals.forEach((professional, professionalIndex) => {
      times.forEach((time, slotIndex) => {
        const index =
          dateIndex * professionals.length * times.length +
          professionalIndex * times.length +
          slotIndex;
        bookings.push({
          key: `demo-seed:future:${date}:${professional.id}:${time}`,
          client: clients[(index + historicalDates.length) % clients.length],
          professional,
          services:
            serviceCombinations[(index + 2) % serviceCombinations.length],
          date,
          time,
          status: 'AGENDADO',
          motivo: null,
        });
      });
    });
  });

  const legacyKeys = [
    'demo-seed:booking-1',
    'demo-seed:booking-2',
    'demo-seed:booking-3',
  ];
  const legacyBookings = await prisma.agendamento.findMany({
    where: { idempotencyKey: { in: legacyKeys } },
    select: { id: true },
  });
  if (legacyBookings.length > 0) {
    const legacyIds = legacyBookings.map(({ id }) => id);
    await prisma.agendamentoServico.deleteMany({
      where: { agendamentoId: { in: legacyIds } },
    });
    await prisma.agendamento.deleteMany({ where: { id: { in: legacyIds } } });
  }

  for (const booking of bookings) {
    const inicio = new Date(`${booking.date}T${booking.time}:00-03:00`);
    const duracaoMinutos = booking.services.reduce(
      (total, service) => total + service.duracaoMin,
      0,
    );
    const fim = new Date(inicio.getTime() + duracaoMinutos * 60_000);
    const payloadHash = createHash('sha256')
      .update(
        JSON.stringify({
          date: booking.date,
          time: booking.time,
          client: booking.client.id,
          professional: booking.professional.id,
          services: booking.services.map((service) => service.id),
        }),
      )
      .digest('hex');
    await prisma.$transaction(async (tx) => {
      const current = await tx.agendamento.findUnique({
        where: { idempotencyKey: booking.key },
      });
      if (current) {
        await tx.agendamentoServico.deleteMany({
          where: { agendamentoId: current.id },
        });
        await tx.agendamento.update({
          where: { id: current.id },
          data: {
            inicio,
            fim,
            status: booking.status,
            motivo: booking.motivo,
            empresaId: company.id,
            clienteId: booking.client.id,
            profissionalId: booking.professional.id,
            payloadHash,
            servicos: {
              create: booking.services.map((service) => ({
                servicoId: service.id,
                precoCobrado: service.preco,
                duracaoMinutos: service.duracaoMin,
              })),
            },
          },
        });
      } else {
        await tx.agendamento.create({
          data: {
            inicio,
            fim,
            status: booking.status,
            motivo: booking.motivo,
            empresaId: company.id,
            clienteId: booking.client.id,
            profissionalId: booking.professional.id,
            idempotencyKey: booking.key,
            payloadHash,
            servicos: {
              create: booking.services.map((service) => ({
                servicoId: service.id,
                precoCobrado: service.preco,
                duracaoMinutos: service.duracaoMin,
              })),
            },
          },
        });
      }
    });
  }

  console.log(
    `Seed de demonstração pronta para "${company.nome}": ` +
      `${clients.length} clientes, ${professionals.length} profissionais, ` +
      `${services.length} serviços e ${bookings.length} agendamentos.`,
  );
}

function previousBusinessDays(count) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (name) => parts.find((item) => item.type === name)?.value;
  const current = new Date(
    `${part('year')}-${part('month')}-${part('day')}T00:00:00.000Z`,
  );
  const dates = [];
  for (let offset = 1; dates.length < count; offset += 1) {
    const date = new Date(current);
    date.setUTCDate(date.getUTCDate() - offset);
    const weekday = date.getUTCDay();
    if (weekday >= 1 && weekday <= 6)
      dates.push(date.toISOString().slice(0, 10));
  }
  return dates.reverse();
}

function nextBusinessDays(count) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (name) => parts.find((item) => item.type === name)?.value;
  const current = new Date(
    `${part('year')}-${part('month')}-${part('day')}T00:00:00.000Z`,
  );
  const dates = [];
  for (let offset = 1; dates.length < count; offset += 1) {
    const date = new Date(current);
    date.setUTCDate(date.getUTCDate() + offset);
    const weekday = date.getUTCDay();
    if (weekday >= 1 && weekday <= 6)
      dates.push(date.toISOString().slice(0, 10));
  }
  return dates;
}

try {
  await seed();
} catch (error) {
  console.error('Falha ao carregar os dados de demonstração:', error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
