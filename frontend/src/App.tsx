import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  LayoutDashboard,
  Plus,
  RefreshCw,
  Scissors,
  Users,
  UserRound,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import {
  api,
  ApiError,
  type Agendamento,
  type AgendamentoPayload,
  type Cliente,
  type Empresa,
  type Profissional,
  type Servico,
  type StatusAgendamento,
} from './api';
import AppointmentList from './components/AppointmentList';
import BookingWizard, { money, todayLocal } from './components/BookingWizard';
import RescheduleDialog from './components/RescheduleDialog';
import { ClientsPage, ProfessionalsPage, ServicesPage } from './components/ManagementPages';

type Page = 'inicio' | 'agenda' | 'clientes' | 'equipe' | 'servicos';
type PendingBooking = {
  key: string;
  empresaId: number;
  payload: AgendamentoPayload;
  enqueuedAt: number;
  automaticUntil: number;
  lastTriedAt?: number;
  attempts: number;
  manualOnly: boolean;
  lastError?: string;
  lastStatus?: number;
};
type Notice = { message: string; kind: 'success' | 'error' };

const queueStorageKey = 'barbearia.pending-bookings.v1';

function readQueue() {
  try {
    const text = localStorage.getItem(queueStorageKey);
    if (!text) return { items: [] as PendingBooking[], error: '' };
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed) || !parsed.every(isPendingBooking)) throw new Error('Formato inválido');
    return { items: parsed, error: '' };
  } catch {
    return {
      items: [] as PendingBooking[],
      error: 'Não foi possível ler a fila local de agendamentos. Os dados armazenados foram preservados.',
    };
  }
}

function isPendingBooking(value: unknown): value is PendingBooking {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<PendingBooking>;
  return typeof item.key === 'string'
    && typeof item.empresaId === 'number'
    && typeof item.enqueuedAt === 'number'
    && typeof item.automaticUntil === 'number'
    && typeof item.attempts === 'number'
    && typeof item.manualOnly === 'boolean'
    && (item.lastStatus === undefined || typeof item.lastStatus === 'number')
    && !!item.payload
    && typeof item.payload.clienteId === 'number'
    && typeof item.payload.profissionalId === 'number'
    && typeof item.payload.inicio === 'string'
    && Array.isArray(item.payload.servicoIds);
}

function localDate(value: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  const part = (name: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === name)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function fullDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${value}T12:00:00-03:00`));
}

function greeting() {
  const hour = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    hour: 'numeric',
    hourCycle: 'h23',
  }).format(new Date()));
  return hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
}

function bookingId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export default function App() {
  const [initialQueue] = useState(readQueue);
  const [companies, setCompanies] = useState<Empresa[]>([]);
  const [empresaId, setEmpresaId] = useState<number | null>(null);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [profissionais, setProfissionais] = useState<Profissional[]>([]);
  const [servicos, setServicos] = useState<Servico[]>([]);
  const [agendamentos, setAgendamentos] = useState<Agendamento[]>([]);
  const [queue, setQueue] = useState<PendingBooking[]>(initialQueue.items);
  const [queueError, setQueueError] = useState(initialQueue.error);
  const [queueBlocked] = useState(Boolean(initialQueue.error));
  const queueRef = useRef(queue);
  const queueBusy = useRef(false);
  const [page, setPage] = useState<Page>('inicio');
  const [companiesLoading, setCompaniesLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [bookingDraft, setBookingDraft] = useState<AgendamentoPayload | undefined>();
  const [editingQueueKey, setEditingQueueKey] = useState<string | null>(null);
  const [rescheduling, setRescheduling] = useState<Agendamento | null>(null);
  const [selectedDate, setSelectedDate] = useState(todayLocal());
  const [statusFilter, setStatusFilter] = useState<'TODOS' | StatusAgendamento>('TODOS');
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  const persistQueue = useCallback((nextOrUpdate: PendingBooking[] | ((current: PendingBooking[]) => PendingBooking[])) => {
    if (queueBlocked) return false;
    const next = typeof nextOrUpdate === 'function' ? nextOrUpdate(queueRef.current) : nextOrUpdate;
    try {
      localStorage.setItem(queueStorageKey, JSON.stringify(next));
      queueRef.current = next;
      setQueue(next);
      setQueueError('');
      return true;
    } catch {
      setQueueError('A fila não pôde ser persistida neste navegador. Não feche esta página até recuperar a conexão.');
      return false;
    }
  }, [queueBlocked]);

  const notify = useCallback((message: string, kind: 'success' | 'error' = 'success') => {
    setNotice({ message, kind });
  }, []);

  const refreshCompanies = useCallback(async () => {
    setCompaniesLoading(true);
    setLoadError('');
    try {
      setCompanies(await api.empresas());
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : 'Não foi possível carregar as empresas.');
    } finally {
      setCompaniesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    void refreshCompanies();
  }, [refreshCompanies]);

  const refresh = useCallback(async () => {
    if (!empresaId) return;
    setLoading(true);
    setLoadError('');
    try {
      const [clients, staff, catalog, bookings] = await Promise.all([
        api.clientes(empresaId),
        api.profissionais(empresaId),
        api.servicos(empresaId),
        api.agendamentos(empresaId),
      ]);
      setClientes(clients);
      setProfissionais(staff);
      setServicos(catalog);
      setAgendamentos(bookings);
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : 'Não foi possível carregar os dados da empresa.');
    } finally {
      setLoading(false);
    }
  }, [empresaId]);

  useEffect(() => {
    if (!empresaId) {
      setClientes([]);
      setProfissionais([]);
      setServicos([]);
      setAgendamentos([]);
      return;
    }
    void refresh();
  }, [empresaId, refresh]);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const processQueue = useCallback(async (manualKey?: string) => {
    if (!navigator.onLine || queueBusy.current) return;
    queueBusy.current = true;
    try {
      const now = Date.now();
      const expiredKeys = new Set(queueRef.current
        .filter((item) => !item.manualOnly && now > item.automaticUntil)
        .map((item) => item.key));
      if (expiredKeys.size > 0) {
        persistQueue((current) => current.map((item) => expiredKeys.has(item.key)
          ? { ...item, manualOnly: true, lastError: 'O prazo de tentativas automáticas terminou.' }
          : item));
      }
      const items = queueRef.current.filter((item) => {
        if (manualKey) return item.key === manualKey;
        return !item.manualOnly && now <= item.automaticUntil && (!item.lastTriedAt || now - item.lastTriedAt >= 12_000);
      });
      for (const item of items) {
        persistQueue((current) => current.map((entry) =>
          entry.key === item.key ? { ...entry, lastTriedAt: Date.now() } : entry,
        ));
        try {
          await api.criarAgendamento(item.empresaId, item.payload, item.key);
          persistQueue((current) => current.filter((entry) => entry.key !== item.key));
          if (item.empresaId === empresaId) await refresh();
          notify('Agendamento confirmado pela API.');
        } catch (cause) {
          const current = queueRef.current.find((entry) => entry.key === item.key);
          if (!current) continue;
          const message = cause instanceof Error ? cause.message : 'Falha ao enviar o agendamento.';
          const manualOnly = (cause instanceof ApiError && cause.status < 500) || Date.now() >= current.automaticUntil;
          persistQueue((entries) => entries.map((entry) => entry.key === item.key
            ? {
                ...entry,
                attempts: entry.attempts + 1,
                manualOnly,
                lastError: message,
                lastStatus: cause instanceof ApiError ? cause.status : undefined,
              }
            : entry));
          if (manualOnly) notify(`Agendamento pendente: ${message}`, 'error');
        }
      }
    } finally {
      queueBusy.current = false;
    }
  }, [empresaId, notify, persistQueue, refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (navigator.onLine) void processQueue();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [processQueue]);

  function enqueue(payload: AgendamentoPayload, key = bookingId()) {
    const now = Date.now();
    const item: PendingBooking = {
      key,
      empresaId: empresaId!,
      payload,
      enqueuedAt: now,
      automaticUntil: now + 2 * 60_000,
      attempts: 0,
      manualOnly: false,
    };
    return persistQueue((current) => current.some((entry) => entry.key === key) ? current : [...current, item]);
  }

  function openBooking(draft?: AgendamentoPayload, queueKey?: string) {
    setBookingDraft(draft);
    setEditingQueueKey(queueKey ?? null);
    setBookingOpen(true);
  }

  function closeBooking() {
    setBookingOpen(false);
    setBookingDraft(undefined);
    setEditingQueueKey(null);
  }

  async function submitBooking(payload: AgendamentoPayload): Promise<'created' | 'queued'> {
    if (editingQueueKey) {
      if (!persistQueue((current) => current.filter((entry) => entry.key !== editingQueueKey))) {
        throw new Error('Não foi possível atualizar a fila local. Mantenha este formulário aberto e tente novamente.');
      }
      setEditingQueueKey(null);
    }
    const key = bookingId();
    if (!navigator.onLine) {
      if (!enqueue(payload, key)) throw new Error('Não foi possível guardar a solicitação offline neste navegador. Mantenha este formulário aberto e tente novamente.');
      notify('Salvo na fila local; ainda não é uma reserva confirmada.', 'error');
      return 'queued';
    }
    try {
      await api.criarAgendamento(empresaId!, payload, key);
      await refresh();
      notify('Agendamento confirmado.');
      return 'created';
    } catch (cause) {
      if (cause instanceof ApiError && cause.status < 500) throw cause;
      if (!enqueue(payload, key)) throw new Error('A API não respondeu e a fila local não pôde ser salva. Mantenha este formulário aberto e tente novamente.');
      notify('Sem resposta da API. O envio ficou pendente e será repetido com a mesma chave.', 'error');
      return 'queued';
    }
  }

  async function updateStatus(appointment: Agendamento, status: StatusAgendamento) {
    const names: Record<StatusAgendamento, string> = {
      AGENDADO: 'agendado',
      CONCLUIDO: 'concluído',
      CANCELADO: 'cancelado',
      FALTOU: 'marcado como falta',
    };
    if (!window.confirm(`Confirmar que este atendimento será ${names[status]}? Esta ação não pode ser desfeita.`)) return;
    let motivo: string | undefined;
    if (status === 'CANCELADO' || status === 'FALTOU') {
      const response = window.prompt('Motivo opcional (deixe em branco para não informar):', '');
      if (response === null) return;
      motivo = response.trim() || undefined;
    }
    try {
      await api.atualizarStatus(empresaId!, appointment.id, status, motivo);
      await refresh();
      notify('Status atualizado.');
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'Não foi possível atualizar o status.', 'error');
    }
  }

  async function deleteAppointment(appointment: Agendamento) {
    if (!window.confirm(`Excluir o agendamento de ${appointment.cliente?.nome ?? 'cliente'}? Esta ação é permanente.`)) return;
    try {
      await api.removerAgendamento(empresaId!, appointment.id);
      await refresh();
      notify('Agendamento excluído.');
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'Não foi possível excluir o agendamento.', 'error');
    }
  }

  async function deletePending(item: PendingBooking) {
    if (!window.confirm('Remover esta tentativa pendente da fila local? Ela não está confirmada pela API.')) return;
    persistQueue((current) => current.filter((entry) => entry.key !== item.key));
  }

  const selectedCompany = companies.find((company) => company.id === empresaId);
  const companyQueue = useMemo(
    () => queue.filter((item) => item.empresaId === empresaId),
    [queue, empresaId],
  );
  const todayAppointments = useMemo(
    () => agendamentos.filter((appointment) => localDate(appointment.inicio) === todayLocal()).sort((a, b) => a.inicio.localeCompare(b.inicio)),
    [agendamentos],
  );
  const pastPending = useMemo(
    () => agendamentos.filter((appointment) => appointment.status === 'AGENDADO' && localDate(appointment.inicio) < todayLocal()).sort((a, b) => a.inicio.localeCompare(b.inicio)),
    [agendamentos],
  );
  const selectedAppointments = useMemo(
    () => agendamentos
      .filter((appointment) => localDate(appointment.inicio) === selectedDate)
      .filter((appointment) => statusFilter === 'TODOS' || appointment.status === statusFilter)
      .sort((a, b) => a.inicio.localeCompare(b.inicio)),
    [agendamentos, selectedDate, statusFilter],
  );
  const todayRevenue = todayAppointments
    .filter((appointment) => appointment.status === 'CONCLUIDO')
    .reduce((sum, appointment) => sum + appointment.servicos.reduce((total, item) => total + item.precoCobrado, 0), 0);

  const pageTitles: Record<Page, { title: string; subtitle: string }> = {
    inicio: { title: 'Visão geral', subtitle: 'Acompanhe o ritmo do seu dia.' },
    agenda: { title: 'Agendamentos', subtitle: 'Consulte e organize os atendimentos.' },
    clientes: { title: 'Clientes', subtitle: 'Relacionamentos que fazem o negócio crescer.' },
    equipe: { title: 'Equipe', subtitle: 'Profissionais e disponibilidade.' },
    servicos: { title: 'Serviços', subtitle: 'Seu catálogo, duração e valores.' },
  };

  function changeCompany(value: string) {
    const next = Number(value);
    setEmpresaId(Number.isInteger(next) && next > 0 ? next : null);
    setPage('inicio');
    setLoadError('');
  }

  const appointmentActions = {
    onStatus: (appointment: Agendamento, status: StatusAgendamento) => void updateStatus(appointment, status),
    onDelete: (appointment: Agendamento) => void deleteAppointment(appointment),
    onReschedule: (appointment: Agendamento) => setRescheduling(appointment),
  };

  const navigation: Array<{ key: Page; label: string; icon: typeof LayoutDashboard }> = [
    { key: 'inicio', label: 'Visão geral', icon: LayoutDashboard },
    { key: 'agenda', label: 'Agendamentos', icon: CalendarDays },
    { key: 'clientes', label: 'Clientes', icon: Users },
    { key: 'equipe', label: 'Equipe', icon: UserRound },
    { key: 'servicos', label: 'Serviços', icon: Scissors },
  ];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark">a.</div>
          <div><strong>atelier</strong><small>gestão de agenda</small></div>
        </div>
        <div className="sidebar-section-label">MENU PRINCIPAL</div>
        <nav className="main-nav" aria-label="Navegação principal">
          {navigation.map(({ key, label, icon: Icon }) => (
            <button key={key} className={`nav-item ${page === key ? 'active' : ''}`} onClick={() => setPage(key)} disabled={!empresaId}>
              <Icon size={18} strokeWidth={1.8} /><span>{label}</span>
              {key === 'agenda' && companyQueue.length > 0 && <span className="nav-badge">{companyQueue.length}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="support-card"><span className="support-icon"><CircleHelp size={17} /></span><strong>Precisa de ajuda?</strong><small>Consulte o guia de operação no README.</small></div>
          <div className="sidebar-user"><span className="avatar sidebar-avatar">AT</span><span className="choice-copy"><strong>Atendimento</strong><small>Operação interna</small></span><ChevronDown size={15} /></div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-title"><p>{fullDate(todayLocal())}</p><span className={`connection-status ${isOnline ? 'online' : 'offline'}`}>{isOnline ? <Wifi size={14} /> : <WifiOff size={14} />}{isOnline ? 'Online' : 'Offline'}</span></div>
          <div className="topbar-actions">
            <label className="company-select-label"><span>Empresa</span><select value={empresaId ?? ''} onChange={(event) => changeCompany(event.target.value)} aria-label="Selecionar empresa">
              <option value="">Escolher empresa</option>
              {companies.map((company) => <option value={company.id} key={company.id}>{company.nome}</option>)}
            </select><ChevronDown size={14} /></label>
            <button className="button button-primary top-new-button" onClick={() => openBooking()} disabled={!empresaId}><Plus size={16} /> Novo agendamento</button>
          </div>
        </header>

        <div className="content-area">
          {!empresaId ? (
            <section className="company-welcome">
              <div className="welcome-copy"><p className="eyebrow">BEM-VINDO AO ATELIER</p><h1>Um dia bem organizado<br />começa por aqui.</h1><p>Escolha uma empresa ativa para acessar a agenda, a equipe e os clientes.</p></div>
              <div className="company-picker">
                <div className="section-heading"><div><h2>Selecione uma empresa</h2><p>A seleção define os dados e horários exibidos.</p></div></div>
                {loadError && <div className="global-error" role="alert"><AlertTriangle size={18} /><span>{loadError}</span><button className="icon-button" onClick={() => void refreshCompanies()} aria-label="Tentar carregar empresas"><RefreshCw size={16} /></button></div>}
                {companies.map((company) => <button className="company-option" key={company.id} onClick={() => changeCompany(String(company.id))}><span className="company-symbol">{company.nome.slice(0, 1).toLocaleUpperCase('pt-BR')}</span><span className="choice-copy"><strong>{company.nome}</strong><small>Empresa ativa</small></span><ChevronDown size={17} className="company-arrow" /></button>)}
                {companiesLoading && <div className="loading-state"><span className="spinner" /> Carregando empresas…</div>}
                {!companiesLoading && companies.length === 0 && !loadError && <p className="empty-note">Nenhuma empresa ativa foi encontrada.</p>}
              </div>
            </section>
          ) : (
            <>
              <div className="page-heading">
                <div><p className="eyebrow">{selectedCompany?.nome ?? 'EMPRESA'}</p><h1>{pageTitles[page].title}</h1><p>{pageTitles[page].subtitle}</p></div>
                {page === 'inicio' && <button className="button button-outline" onClick={() => void refresh()} disabled={loading}><RefreshCw size={15} className={loading ? 'spinning' : ''} /> Atualizar</button>}
              </div>

              {loadError && <div className="global-error" role="alert"><AlertTriangle size={18} /><span>{loadError}</span><button className="icon-button" onClick={() => void refresh()} aria-label="Tentar novamente"><RefreshCw size={16} /></button></div>}
              {queueError && <div className="global-error" role="alert"><AlertTriangle size={18} /><span>{queueError}</span></div>}

              {page === 'inicio' && (
                <div className="page-stack">
                  <section className="welcome-banner">
                    <div><span className="welcome-badge">HOJE · {todayAppointments.length} ATENDIMENTOS</span><h2>{greeting()}, equipe.</h2><p>Seu espaço está pronto para receber bem.</p></div>
                    <div className="banner-art" aria-hidden="true"><div className="sun-disc" /><span className="art-line art-line-one" /><span className="art-line art-line-two" /><span className="art-stamp">a</span></div>
                    <button className="button button-light" onClick={() => openBooking()}><Plus size={16} /> Novo agendamento</button>
                  </section>

                  <section className="stats-grid">
                    <div className="stat-card"><span className="stat-label">Na agenda de hoje</span><strong>{todayAppointments.length.toString().padStart(2, '0')}</strong><small><CalendarDays size={14} /> atendimentos programados</small></div>
                    <div className="stat-card"><span className="stat-label">Próximos</span><strong>{todayAppointments.filter((item) => item.status === 'AGENDADO').length.toString().padStart(2, '0')}</strong><small><Clock3 size={14} /> aguardando atendimento</small></div>
                    <div className="stat-card"><span className="stat-label">Concluído hoje</span><strong>{money(todayRevenue)}</strong><small><Check size={14} /> valor dos serviços concluídos</small></div>
                    <div className="stat-card stat-card-alert"><span className="stat-label">Pendências anteriores</span><strong>{pastPending.length.toString().padStart(2, '0')}</strong><small><AlertTriangle size={14} /> precisam de atualização</small></div>
                  </section>

                  {companyQueue.length > 0 && <PendingQueue
                        queue={companyQueue}
                    companies={companies}
                    onRetry={(item) => void processQueue(item.key)}
                    onEdit={(item) => openBooking(item.payload, item.key)}
                    onRemove={(item) => void deletePending(item)}
                    online={isOnline}
                  />}

                  <section className="panel agenda-panel">
                    <div className="panel-heading"><div><p className="eyebrow">AGENDA DO DIA</p><h2>Atendimentos de hoje</h2></div><button className="text-button" onClick={() => setPage('agenda')}>Ver agenda completa <ChevronDown size={15} /></button></div>
                    <AppointmentList appointments={todayAppointments} {...appointmentActions} />
                  </section>

                  {pastPending.length > 0 && (
                    <section className="panel pending-panel">
                      <div className="panel-heading"><div><p className="eyebrow">REVISÃO NECESSÁRIA</p><h2>Pendências de dias anteriores</h2></div><span className="pending-count">{pastPending.length} em aberto</span></div>
                      <AppointmentList appointments={pastPending} {...appointmentActions} />
                    </section>
                  )}
                  {companyQueue.length > 0 && <p className="queue-note"><WifiOff size={14} /> Pendências offline não são reservas confirmadas e só serão consideradas agendadas após resposta da API.</p>}
                </div>
              )}

              {page === 'agenda' && (
                <div className="page-stack">
                  <div className="agenda-controls panel">
                    <label className="date-field">Data<input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} /></label>
                    <button className="button button-quiet" onClick={() => setSelectedDate(todayLocal())}>Hoje</button>
                    <label className="filter-field">Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'TODOS' | StatusAgendamento)}><option value="TODOS">Todos os status</option><option value="AGENDADO">Agendado</option><option value="CONCLUIDO">Concluído</option><option value="CANCELADO">Cancelado</option><option value="FALTOU">Faltou</option></select></label>
                    <span className="result-count">{selectedAppointments.length} atendimentos</span>
                  </div>
                  <section className="panel agenda-panel">
                    <div className="panel-heading"><div><p className="eyebrow">{fullDate(selectedDate)}</p><h2>Agenda</h2></div></div>
                    <AppointmentList appointments={selectedAppointments} {...appointmentActions} />
                  </section>
                </div>
              )}

              {page === 'clientes' && <ClientsPage empresaId={empresaId} clientes={clientes} appointments={agendamentos} refresh={refresh} notify={notify} />}
              {page === 'equipe' && <ProfessionalsPage empresaId={empresaId} profissionais={profissionais} refresh={refresh} notify={notify} />}
              {page === 'servicos' && <ServicesPage empresaId={empresaId} servicos={servicos} refresh={refresh} notify={notify} />}
            </>
          )}
        </div>
      </main>

      {bookingOpen && empresaId && <BookingWizard
        empresaId={empresaId}
        clientes={clientes}
        profissionais={profissionais}
        servicos={servicos}
        onClose={closeBooking}
        onSubmit={submitBooking}
        onClientCreated={(client) => setClientes((current) => [...current, client].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')))}
        initialPayload={bookingDraft}
      />}
      {rescheduling && empresaId && <RescheduleDialog
        empresaId={empresaId}
        appointment={rescheduling}
        profissionais={profissionais}
        onClose={() => setRescheduling(null)}
        onSaved={() => { void refresh(); notify('Agendamento remarcado.'); }}
      />}
      {notice && <div className={`toast ${notice.kind}`} role="status"><span>{notice.kind === 'success' ? <Check size={17} /> : <AlertTriangle size={17} />}</span>{notice.message}<button className="icon-button" onClick={() => setNotice(null)} aria-label="Fechar aviso"><X size={15} /></button></div>}
    </div>
  );
}

function PendingQueue({
  queue,
  companies,
  onRetry,
  onEdit,
  onRemove,
  online,
}: {
  queue: PendingBooking[];
  companies: Empresa[];
  onRetry: (item: PendingBooking) => void;
  onEdit: (item: PendingBooking) => void;
  onRemove: (item: PendingBooking) => void;
  online: boolean;
}) {
  return (
    <section className="queue-panel">
      <div className="queue-heading"><span className="queue-symbol"><WifiOff size={17} /></span><div><h3>Fila offline</h3><p>Essas solicitações ainda não são reservas confirmadas.</p></div><span className="queue-count">{queue.length}</span></div>
      <div className="queue-items">
        {queue.map((item) => {
          const timeLeft = Math.max(0, Math.ceil((item.automaticUntil - Date.now()) / 1000));
          const manualOnly = item.manualOnly || timeLeft === 0;
          const company = companies.find((entry) => entry.id === item.empresaId);
          return <div className="queue-item" key={item.key}>
            <span className={`queue-dot ${manualOnly ? 'attention' : ''}`} />
            <div className="choice-copy"><strong>{company?.nome ?? `Empresa ${item.empresaId}`} · {formatLocalTime(item.payload.inicio)}</strong><small>{item.lastError || (manualOnly ? 'Reenvio manual necessário' : `Tentativa automática por mais ${timeLeft}s`)}</small></div>
            <span className="queue-status">{manualOnly ? 'Pendente' : 'Aguardando'}</span>
            {manualOnly && item.lastStatus === 409 && <button className="button button-outline button-small" onClick={() => onEdit(item)}>Revisar horário</button>}
            {manualOnly && <button className="button button-outline button-small" disabled={!online} onClick={() => onRetry(item)}>Tentar novamente</button>}
            <button className="icon-button danger-icon" onClick={() => onRemove(item)} aria-label="Remover da fila"><X size={15} /></button>
          </div>;
        })}
      </div>
    </section>
  );
}

function formatLocalTime(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}
