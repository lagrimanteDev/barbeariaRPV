# Sistema de Barbearia

Aplicação de gestão interna para agendamentos, clientes, profissionais e serviços. O repositório contém uma API NestJS/Prisma e um front-end React/TypeScript com Vite.

## Requisitos

- Node.js 20 ou superior
- MySQL ou MariaDB
- Uma base vazia ou acessível para a aplicação

## Configuração da API

Na raiz do repositório, copie `.env.example` para `.env` e ajuste `DATABASE_URL`:

```env
DATABASE_URL="mysql://usuario:senha@localhost:3306/sistema_barbearia"
FRONTEND_ORIGIN="http://localhost:5173,http://127.0.0.1:5173"
```

Instale as dependências, gere o cliente Prisma e aplique as migrações:

```bash
pnpm install
pnpm exec prisma generate
pnpm exec prisma migrate deploy
```

Carregue dados fictícios repetíveis para demonstração:

```bash
pnpm run db:seed
```

Inicie a API:

```bash
pnpm run start:dev
```

A API fica disponível em `http://127.0.0.1:3000`. As rotas de negócio usam o header `x-empresa-id`; consulte as empresas ativas em `GET /empresas?ativas=true`.

## Configuração do front-end

Em outro terminal:

```bash
npm install --prefix frontend
npm run dev --prefix frontend
```

Abra `http://localhost:5173`. Para apontar o front-end a outra URL, copie `frontend/.env.example` para `frontend/.env.local` e altere `VITE_API_URL`.

Build de produção:

```bash
npm run build --prefix frontend
```

## Funcionalidades

- Painel diário com todos os status, atendimentos próximos, pendências antigas e fila offline.
- Fluxo de reserva em quatro etapas, busca/cadastro de cliente, seleção de serviços e consulta de disponibilidade.
- Expediente semanal por profissional, exceções de data, remarcação e atualização de status.
- Cadastro e manutenção de clientes, profissionais e serviços.
- Tentativas offline de criação são armazenadas no navegador e repetidas com uma chave idempotente. A reserva só é considerada confirmada depois da resposta da API.
- Horários e datas da agenda são tratados no fuso `America/Sao_Paulo`.

## API e contratos relevantes

- `GET /agendamentos/horarios-disponiveis?profissionalId=1&data=AAAA-MM-DD&servicoIds=1,2`
- `GET /profissionais/:id/expediente`
- `PUT /profissionais/:id/expediente/semanal` com `{ "horarios": [{ "diaSemana": 1, "inicio": "09:00", "fim": "12:00" }] }` (`diaSemana`: domingo `0` a sábado `6`)
- `PUT /profissionais/:id/expediente/excecoes/:data` com `{ "fechado": true, "periodos": [] }` ou horários substitutos
- `PATCH /agendamentos/:id/remarcar` com `{ "profissionalId": 1, "inicio": "..." }`
- `POST /agendamentos` exige `Idempotency-Key`. Repetir a chave e o mesmo payload devolve o agendamento já criado; reutilizá-la com payload diferente gera conflito.
- `PATCH /agendamentos/:id/status` aceita `CONCLUIDO`, `CANCELADO` ou `FALTOU`; a falta só pode ser registrada depois do fim previsto. O campo `motivo` é opcional para cancelamento/falta.

Atualizações de expediente que deixariam agendamentos futuros fora dos horários de trabalho são rejeitadas até que as reservas sejam resolvidas. A API serializa criações e alterações por profissional e valida novamente a disponibilidade no momento da gravação.

## Testes e qualidade

```bash
pnpm test
pnpm run build
pnpm run lint
```

## Segurança e execução

O fluxo sem autenticação é destinado exclusivamente a demonstrações e ambientes internos privados. O header `x-empresa-id` apenas seleciona o contexto da empresa e **não** autentica nem autoriza usuários. Antes de disponibilizar o sistema na internet, implemente autenticação e autorização na API. Configure `FRONTEND_ORIGIN` para a origem confiável do front-end.
