export type Empresa = { id: number; nome: string; ativa: boolean };
export type Cliente = { id: number; nome: string; telefone: string };
export type Profissional = { id: number; nome: string; ativo: boolean };
export type Servico = { id: number; nome: string; preco: number; duracaoMin: number };
export type StatusAgendamento = 'AGENDADO' | 'CONCLUIDO' | 'CANCELADO' | 'FALTOU';
export type Agendamento = {
  id: number;
  inicio: string;
  fim: string;
  status: StatusAgendamento;
  motivo: string | null;
  cliente: Cliente | null;
  profissional: Profissional | null;
  servicos: Array<{
    servicoId: number;
    precoCobrado: number;
    duracaoMinutos: number;
    servico: { id: number; nome: string; duracaoMin: number } | null;
  }>;
};
export type HorarioSemanal = { diaSemana: number; inicio: string; fim: string };
export type ExcecaoAgenda = {
  data: string;
  fechado: boolean;
  periodos: Array<{ inicio: string; fim: string }>;
};
export type Expediente = { horarios: HorarioSemanal[]; excecoes: ExcecaoAgenda[] };
export type AgendamentoPayload = {
  clienteId: number;
  profissionalId: number;
  inicio: string;
  servicoIds: number[];
};

const API_URL = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  path: string,
  options: {
    empresaId?: number;
    method?: string;
    body?: unknown;
    idempotencyKey?: string;
  } = {},
): Promise<T> {
  const headers = new Headers({ Accept: 'application/json' });
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  if (options.empresaId !== undefined) headers.set('x-empresa-id', String(options.empresaId));
  if (options.idempotencyKey) headers.set('Idempotency-Key', options.idempotencyKey);

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15_000);
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('A API não respondeu dentro do tempo limite.');
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      throw new ApiError(`A API retornou uma resposta inválida (HTTP ${response.status}).`, response.status);
    }
  }
  if (!response.ok) {
    const message = extractMessage(data) || `A API respondeu com erro ${response.status}`;
    throw new ApiError(message, response.status);
  }
  return data as T;
}

function extractMessage(data: unknown): string | null {
  if (!data || typeof data !== 'object' || !('message' in data)) return null;
  const message = data.message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) return message.filter((item): item is string => typeof item === 'string').join('. ');
  return null;
}

const query = (params: Record<string, string>) => new URLSearchParams(params).toString();

export const api = {
  empresas: () => request<Empresa[]>('/empresas?ativas=true'),
  clientes: (empresaId: number) => request<Cliente[]>('/clientes', { empresaId }),
  criarCliente: (empresaId: number, body: Pick<Cliente, 'nome' | 'telefone'>) =>
    request<Cliente>('/clientes', { empresaId, method: 'POST', body }),
  atualizarCliente: (empresaId: number, id: number, body: Partial<Pick<Cliente, 'nome' | 'telefone'>>) =>
    request<Cliente>(`/clientes/${id}`, { empresaId, method: 'PATCH', body }),
  removerCliente: (empresaId: number, id: number) =>
    request<Cliente>(`/clientes/${id}`, { empresaId, method: 'DELETE' }),
  profissionais: (empresaId: number, ativos = false) =>
    request<Profissional[]>(`/profissionais?ativos=${ativos}`, { empresaId }),
  criarProfissional: (empresaId: number, nome: string) =>
    request<Profissional>('/profissionais', { empresaId, method: 'POST', body: { nome } }),
  atualizarProfissional: (empresaId: number, id: number, body: Partial<Pick<Profissional, 'nome' | 'ativo'>>) =>
    request<Profissional>(`/profissionais/${id}`, { empresaId, method: 'PATCH', body }),
  servicos: (empresaId: number) => request<Servico[]>('/servicos', { empresaId }),
  criarServico: (empresaId: number, body: Omit<Servico, 'id'>) =>
    request<Servico>('/servicos', { empresaId, method: 'POST', body }),
  atualizarServico: (empresaId: number, id: number, body: Partial<Omit<Servico, 'id'>>) =>
    request<Servico>(`/servicos/${id}`, { empresaId, method: 'PATCH', body }),
  removerServico: (empresaId: number, id: number) =>
    request<Servico>(`/servicos/${id}`, { empresaId, method: 'DELETE' }),
  agendamentos: (empresaId: number) => request<Agendamento[]>('/agendamentos', { empresaId }),
  agenda: (empresaId: number, profissionalId: number, data: string) =>
    request<Agendamento[]>(`/agendamentos/agenda?${query({ profissionalId: String(profissionalId), data })}`, { empresaId }),
  horariosDisponiveis: (empresaId: number, profissionalId: number, data: string, servicoIds: number[]) =>
    request<Array<{ inicio: string; fim: string }>>(
      `/agendamentos/horarios-disponiveis?${query({
        profissionalId: String(profissionalId),
        data,
        servicoIds: servicoIds.join(','),
      })}`,
      { empresaId },
    ),
  criarAgendamento: (empresaId: number, body: AgendamentoPayload, key: string) =>
    request<Agendamento>('/agendamentos', { empresaId, method: 'POST', body, idempotencyKey: key }),
  atualizarStatus: (empresaId: number, id: number, status: StatusAgendamento, motivo?: string) =>
    request<Agendamento>(`/agendamentos/${id}/status`, {
      empresaId,
      method: 'PATCH',
      body: { status, motivo },
    }),
  remarcar: (empresaId: number, id: number, body: Pick<AgendamentoPayload, 'inicio' | 'profissionalId'>) =>
    request<Agendamento>(`/agendamentos/${id}/remarcar`, { empresaId, method: 'PATCH', body }),
  removerAgendamento: (empresaId: number, id: number) =>
    request<Agendamento>(`/agendamentos/${id}`, { empresaId, method: 'DELETE' }),
  expediente: (empresaId: number, profissionalId: number) =>
    request<Expediente>(`/profissionais/${profissionalId}/expediente`, { empresaId }),
  atualizarExpediente: (empresaId: number, profissionalId: number, horarios: HorarioSemanal[]) =>
    request<Expediente>(`/profissionais/${profissionalId}/expediente/semanal`, {
      empresaId,
      method: 'PUT',
      body: { horarios },
    }),
  salvarExcecao: (
    empresaId: number,
    profissionalId: number,
    data: string,
    body: Pick<ExcecaoAgenda, 'fechado' | 'periodos'>,
  ) =>
    request<Expediente>(`/profissionais/${profissionalId}/expediente/excecoes/${data}`, {
      empresaId,
      method: 'PUT',
      body,
    }),
  removerExcecao: (empresaId: number, profissionalId: number, data: string) =>
    request<Expediente>(`/profissionais/${profissionalId}/expediente/excecoes/${data}`, {
      empresaId,
      method: 'DELETE',
    }),
};
