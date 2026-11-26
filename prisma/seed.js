import 'dotenv/config';
import { createHash } from 'node:crypto';
import { PrismaClient } from '../src/generated/prisma/client.js';
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
    update: { nome: companyData.nome, telefone: companyData.telefone, ativa: true },
    create: companyData,
  });

  const clients = [];
  for (const [nome, telefone] of [
    ['Marina Oliveira', '11999990001'],
    ['Caio Mendes', '11999990002'],
    ['Joana Ribeiro', '11999990003'],
  ]) {
    clients.push(await prisma.cliente.upsert({
      where: { empresaId_telefone: { empresaId: company.id, telefone } },
      update: { nome },
      create: { empresaId: company.id, nome, telefone },
    }));
  }

  const professionals = [];
  for (const nome of ['Rafael Martins', 'Lucas Ferreira']) {
    const existing = await prisma.profissional.findFirst({ where: { empresaId: company.id, nome } });
    professionals.push(existing
      ? await prisma.profissional.update({ where: { id: existing.id }, data: { ativo: true } })
      : await prisma.profissional.create({ data: { empresaId: company.id, nome, ativo: true } }));
  }

  const services = [];
  for (const data of [
    { nome: 'Corte', preco: 45, duracaoMin: 45 },
    { nome: 'Barba', preco: 30, duracaoMin: 30 },
    { nome: 'Corte + barba', preco: 68, duracaoMin: 75 },
  ]) {
    const existing = await prisma.servico.findFirst({ where: { empresaId: company.id, nome: data.nome } });
    services.push(existing
      ? await prisma.servico.update({ where: { id: existing.id }, data })
      : await prisma.servico.create({ data: { ...data, empresaId: company.id } }));
  }

  const weeklyHours = [
    ...[1, 2, 3, 4, 5].flatMap((diaSemana) => [
      { diaSemana, inicio: '09:00', fim: '12:00' },
      { diaSemana, inicio: '13:00', fim: '19:00' },
    ]),
    { diaSemana: 6, inicio: '09:00', fim: '14:00' },
  ];
  for (const professional of professionals) {
    await prisma.horarioSemanal.deleteMany({ where: { empresaId: company.id, profissionalId: professional.id } });
    await prisma.horarioSemanal.createMany({
      data: weeklyHours.map((hours) => ({ ...hours, empresaId: company.id, profissionalId: professional.id })),
    });
  }

  const dates = nextBusinessDays(3);
  const bookings = [
    { key: 'demo-seed:booking-1', client: clients[0], professional: professionals[0], services: [services[0]], date: dates[0], time: '10:00' },
    { key: 'demo-seed:booking-2', client: clients[1], professional: professionals[1], services: [services[1]], date: dates[1], time: '11:00' },
    { key: 'demo-seed:booking-3', client: clients[2], professional: professionals[0], services: [services[0], services[1]], date: dates[2], time: '14:00' },
  ];

  for (const booking of bookings) {
    const inicio = new Date(`${booking.date}T${booking.time}:00-03:00`);
    const duracaoMinutos = booking.services.reduce((total, service) => total + service.duracaoMin, 0);
    const fim = new Date(inicio.getTime() + duracaoMinutos * 60_000);
    const payloadHash = createHash('sha256')
      .update(JSON.stringify({ date: booking.date, time: booking.time, client: booking.client.id }))
      .digest('hex');
    await prisma.$transaction(async (tx) => {
      const current = await tx.agendamento.findUnique({ where: { idempotencyKey: booking.key } });
      if (current) {
        await tx.agendamentoServico.deleteMany({ where: { agendamentoId: current.id } });
        await tx.agendamento.update({
          where: { id: current.id },
          data: {
            inicio,
            fim,
            status: 'AGENDADO',
            motivo: null,
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
            status: 'AGENDADO',
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

  console.log(`Seed de demonstração pronto para "${company.nome}".`);
}

function nextBusinessDays(count) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (name) => parts.find((item) => item.type === name)?.value;
  const current = new Date(`${part('year')}-${part('month')}-${part('day')}T00:00:00.000Z`);
  const dates = [];
  for (let offset = 1; dates.length < count; offset += 1) {
    const date = new Date(current);
    date.setUTCDate(date.getUTCDate() + offset);
    const weekday = date.getUTCDay();
    if (weekday >= 1 && weekday <= 6) dates.push(date.toISOString().slice(0, 10));
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
