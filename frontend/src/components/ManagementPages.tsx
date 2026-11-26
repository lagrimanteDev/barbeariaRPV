import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Check, Clock3, Pencil, Plus, Search, Trash2, UserRound, X } from 'lucide-react';
import { api, type Cliente, type Expediente, type ExcecaoAgenda, type HorarioSemanal, type Profissional, type Servico } from '../api';
import { initials, money } from './BookingWizard';

type SharedProps = {
  empresaId: number;
  notify: (message: string, kind?: 'success' | 'error') => void;
};

type Period = { inicio: string; fim: string };
const dayLabels = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

export function ClientsPage({
  empresaId,
  clientes,
  appointments,
  refresh,
  notify,
}: SharedProps & {
  clientes: Cliente[];
  appointments: Array<{ cliente: Cliente | null; inicio: string }>;
  refresh: () => Promise<void>;
}) {
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const rows = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR');
    return clientes
      .filter((client) => !term || client.nome.toLocaleLowerCase('pt-BR').includes(term) || client.telefone.includes(term))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [clientes, search]);

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.criarCliente(empresaId, { nome: name.trim(), telefone: phone.replace(/\D/g, '') });
      setName('');
      setPhone('');
      setFormOpen(false);
      await refresh();
      notify('Cliente cadastrado.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível cadastrar o cliente.');
    } finally {
      setSaving(false);
    }
  }

  async function edit(client: Cliente) {
    const nextName = window.prompt('Nome do cliente', client.nome);
    if (nextName === null) return;
    const nextPhone = window.prompt('Telefone com DDD, somente números', client.telefone);
    if (nextPhone === null) return;
    try {
      await api.atualizarCliente(empresaId, client.id, { nome: nextName.trim(), telefone: nextPhone.replace(/\D/g, '') });
      await refresh();
      notify('Cadastro atualizado.');
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'Não foi possível atualizar o cliente.', 'error');
    }
  }

  async function remove(client: Cliente) {
    if (!window.confirm(`Excluir o cadastro de ${client.nome}?`)) return;
    try {
      await api.removerCliente(empresaId, client.id);
      await refresh();
      notify('Cliente removido.');
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'Não foi possível remover o cliente.', 'error');
    }
  }

  return (
    <div className="page-stack">
      <div className="page-toolbar">
        <label className="search-field"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nome ou telefone" /></label>
        <button className="button button-primary" onClick={() => setFormOpen((open) => !open)}><Plus size={16} /> Novo cliente</button>
      </div>
      {formOpen && (
        <form className="panel create-panel" onSubmit={create}>
          <div className="section-heading"><div><h3>Novo cadastro</h3><p>O telefone deve incluir DDD e conter apenas números.</p></div><button type="button" className="icon-button" onClick={() => setFormOpen(false)} aria-label="Fechar"><X size={18} /></button></div>
          <div className="form-grid">
            <label>Nome<input required value={name} onChange={(event) => setName(event.target.value)} /></label>
            <label>Telefone<input required inputMode="tel" placeholder="11987654321" value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
          </div>
          {error && <div className="form-error">{error}</div>}
          <button className="button button-primary" disabled={saving}>{saving ? 'Salvando…' : 'Salvar cliente'}</button>
        </form>
      )}
      <div className="panel table-panel">
        <div className="table-heading"><div><h3>Clientes</h3><p>{rows.length} {rows.length === 1 ? 'cadastro' : 'cadastros'}</p></div></div>
        {rows.length === 0 ? <div className="empty-state"><UserRound size={28} /><p>Nenhum cliente encontrado.</p></div> : (
          <div className="data-table">
            <div className="data-row data-header"><span>Cliente</span><span>Telefone</span><span>Atendimentos</span><span>Última visita</span><span /></div>
            {rows.map((client) => {
              const history = appointments.filter((item) => item.cliente?.id === client.id).sort((a, b) => b.inicio.localeCompare(a.inicio));
              return <div className="data-row" key={client.id}>
                <span className="person-cell"><span className="avatar">{initials(client.nome)}</span><strong>{client.nome}</strong></span>
                <span>{formatPhone(client.telefone)}</span>
                <span>{history.length}</span>
                <span>{history[0] ? shortDate(history[0].inicio) : 'Ainda não veio'}</span>
                <span className="row-actions"><button className="icon-button" onClick={() => edit(client)} aria-label={`Editar ${client.nome}`}><Pencil size={15} /></button><button className="icon-button danger-icon" onClick={() => remove(client)} aria-label={`Excluir ${client.nome}`}><Trash2 size={15} /></button></span>
              </div>;
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export function ProfessionalsPage({
  empresaId,
  profissionais,
  refresh,
  notify,
}: SharedProps & {
  profissionais: Profissional[];
  refresh: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(profissionais[0]?.id ?? null);
  const [expediente, setExpediente] = useState<Expediente | null>(null);
  const [weekly, setWeekly] = useState<Record<number, Period[]>>({});
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [scheduleError, setScheduleError] = useState('');
  const [exceptionDate, setExceptionDate] = useState('');
  const [exceptionClosed, setExceptionClosed] = useState(false);
  const [exceptionPeriods, setExceptionPeriods] = useState<Period[]>([{ inicio: '09:00', fim: '17:00' }]);
  const [savingException, setSavingException] = useState(false);

  useEffect(() => {
    if (!selectedId && profissionais[0]) setSelectedId(profissionais[0].id);
    if (selectedId && !profissionais.some((item) => item.id === selectedId)) {
      setSelectedId(profissionais[0]?.id ?? null);
    }
  }, [profissionais, selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setExpediente(null);
      return;
    }
    let active = true;
    setScheduleLoading(true);
    setScheduleError('');
    api.expediente(empresaId, selectedId).then((result) => {
      if (!active) return;
      setExpediente(result);
      const byDay: Record<number, Period[]> = {};
      for (let day = 0; day < 7; day += 1) byDay[day] = [];
      for (const item of result.horarios) byDay[item.diaSemana]?.push({ inicio: item.inicio, fim: item.fim });
      setWeekly(byDay);
    }).catch((cause: unknown) => {
      if (active) setScheduleError(cause instanceof Error ? cause.message : 'Não foi possível carregar o expediente.');
    }).finally(() => {
      if (active) setScheduleLoading(false);
    });
    return () => { active = false; };
  }, [empresaId, selectedId]);

  async function createProfessional(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    try {
      const created = await api.criarProfissional(empresaId, name.trim());
      setName('');
      setSelectedId(created.id);
      await refresh();
      notify('Profissional cadastrado.');
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'Não foi possível cadastrar o profissional.', 'error');
    } finally {
      setCreating(false);
    }
  }

  async function toggleActive(person: Profissional) {
    const action = person.ativo ? 'desativar' : 'reativar';
    if (!window.confirm(`${action[0].toLocaleUpperCase('pt-BR')}${action.slice(1)} ${person.nome}? O histórico será preservado.`)) return;
    try {
      await api.atualizarProfissional(empresaId, person.id, { ativo: !person.ativo });
      await refresh();
      notify(`Profissional ${person.ativo ? 'desativado' : 'reativado'}.`);
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'Não foi possível atualizar o profissional.', 'error');
    }
  }

  function updatePeriod(day: number, index: number, key: keyof Period, value: string) {
    setWeekly((current) => ({
      ...current,
      [day]: current[day].map((period, periodIndex) => periodIndex === index ? { ...period, [key]: value } : period),
    }));
  }

  async function saveWeekly() {
    if (!selectedId) return;
    setSavingSchedule(true);
    setScheduleError('');
    const horarios: HorarioSemanal[] = Object.entries(weekly).flatMap(([day, periods]) =>
      periods.map((period) => ({ diaSemana: Number(day), ...period })),
    );
    try {
      const result = await api.atualizarExpediente(empresaId, selectedId, horarios);
      setExpediente(result);
      notify('Expediente semanal atualizado.');
    } catch (cause) {
      setScheduleError(cause instanceof Error ? cause.message : 'Não foi possível salvar o expediente.');
    } finally {
      setSavingSchedule(false);
    }
  }

  async function saveException(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId) return;
    setSavingException(true);
    setScheduleError('');
    try {
      const result = await api.salvarExcecao(empresaId, selectedId, exceptionDate, {
        fechado: exceptionClosed,
        periodos: exceptionClosed ? [] : exceptionPeriods,
      });
      setExpediente(result);
      setExceptionDate('');
      notify('Exceção de agenda salva.');
    } catch (cause) {
      setScheduleError(cause instanceof Error ? cause.message : 'Não foi possível salvar a exceção.');
    } finally {
      setSavingException(false);
    }
  }

  async function deleteException(exception: ExcecaoAgenda) {
    if (!selectedId || !window.confirm(`Remover a exceção de ${exception.data}?`)) return;
    try {
      const result = await api.removerExcecao(empresaId, selectedId, exception.data);
      setExpediente(result);
      notify('Exceção removida.');
    } catch (cause) {
      setScheduleError(cause instanceof Error ? cause.message : 'Não foi possível remover a exceção.');
    }
  }

  const selected = profissionais.find((item) => item.id === selectedId);
  return (
    <div className="page-stack">
      <div className="panel create-panel">
        <div className="section-heading"><div><h3>Adicionar à equipe</h3><p>Cadastre quem realiza os atendimentos.</p></div></div>
        <form className="inline-form" onSubmit={createProfessional}>
          <label>Nome do profissional<input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Alex Costa" /></label>
          <button className="button button-primary" disabled={creating}><Plus size={16} /> {creating ? 'Salvando…' : 'Adicionar profissional'}</button>
        </form>
      </div>
      <div className="management-layout">
        <section className="panel team-panel">
          <div className="table-heading"><div><h3>Equipe</h3><p>{profissionais.filter((item) => item.ativo).length} ativos</p></div></div>
          <div className="team-list">
            {profissionais.map((person) => (
              <button className={`team-row ${selectedId === person.id ? 'selected' : ''}`} key={person.id} onClick={() => setSelectedId(person.id)}>
                <span className="avatar">{initials(person.nome)}</span>
                <span className="choice-copy"><strong>{person.nome}</strong><small>{person.ativo ? 'Ativo' : 'Desativado'}</small></span>
                <span className={`active-dot ${person.ativo ? 'is-active' : ''}`} />
              </button>
            ))}
            {profissionais.length === 0 && <p className="empty-note">Nenhum profissional cadastrado.</p>}
          </div>
        </section>
        <section className="panel schedule-panel">
          {!selected ? <div className="empty-state"><CalendarDays size={28} /><p>Selecione um profissional.</p></div> : (
            <>
              <div className="table-heading"><div><p className="eyebrow">EXPEDIENTE</p><h3>{selected.nome}</h3><p>Sem horários cadastrados, o profissional fica indisponível.</p></div><button className="button button-outline button-small" onClick={() => toggleActive(selected)}>{selected.ativo ? 'Desativar' : 'Reativar'}</button></div>
              {scheduleLoading ? <div className="loading-state"><span className="spinner" /> Carregando expediente…</div> : (
                <div className="weekly-editor">
                  {dayLabels.map((label, day) => (
                    <div className="day-editor" key={day}>
                      <strong>{label}</strong>
                      <div className="period-list">
                        {(weekly[day] ?? []).map((period, index) => (
                          <div className="period-fields" key={`${day}-${index}`}>
                            <input aria-label={`${label} início ${index + 1}`} type="time" value={period.inicio} onChange={(event) => updatePeriod(day, index, 'inicio', event.target.value)} />
                            <span>até</span>
                            <input aria-label={`${label} fim ${index + 1}`} type="time" value={period.fim} onChange={(event) => updatePeriod(day, index, 'fim', event.target.value)} />
                            <button className="icon-button danger-icon" onClick={() => setWeekly((current) => ({ ...current, [day]: current[day].filter((_, itemIndex) => itemIndex !== index) }))} aria-label={`Remover horário de ${label}`}><X size={15} /></button>
                          </div>
                        ))}
                        {(weekly[day] ?? []).length === 0 && <span className="closed-label">Fechado</span>}
                        <button className="add-period" onClick={() => setWeekly((current) => ({ ...current, [day]: [...(current[day] ?? []), { inicio: '09:00', fim: '17:00' }] }))}><Plus size={13} /> Adicionar horário</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {scheduleError && <div className="form-error" role="alert">{scheduleError}</div>}
              <button className="button button-primary" disabled={savingSchedule || scheduleLoading} onClick={saveWeekly}>{savingSchedule ? 'Salvando…' : 'Salvar expediente'} <Check size={16} /></button>

              <div className="exception-section">
                <div className="table-heading"><div><p className="eyebrow">DATAS ESPECIAIS</p><h3>Exceções de agenda</h3><p>Fechamentos ou horários diferentes do expediente semanal.</p></div></div>
                <form className="exception-form" onSubmit={saveException}>
                  <label>Data<input required type="date" value={exceptionDate} onChange={(event) => setExceptionDate(event.target.value)} /></label>
                  <label className="check-label"><input type="checkbox" checked={exceptionClosed} onChange={(event) => setExceptionClosed(event.target.checked)} /> Fechar o dia</label>
                  {!exceptionClosed && <div className="exception-periods">
                    {exceptionPeriods.map((period, index) => <div className="period-fields" key={`exception-${index}`}>
                      <input aria-label={`Início do período especial ${index + 1}`} type="time" value={period.inicio} onChange={(event) => setExceptionPeriods((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, inicio: event.target.value } : item))} />
                      <span>até</span>
                      <input aria-label={`Fim do período especial ${index + 1}`} type="time" value={period.fim} onChange={(event) => setExceptionPeriods((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, fim: event.target.value } : item))} />
                      <button type="button" className="icon-button danger-icon" onClick={() => setExceptionPeriods((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remover período especial ${index + 1}`}><X size={14} /></button>
                    </div>)}
                    <button type="button" className="add-period" onClick={() => setExceptionPeriods((current) => [...current, { inicio: '09:00', fim: '17:00' }])}><Plus size={13} /> Adicionar período</button>
                  </div>}
                  <button className="button button-outline" disabled={savingException}>{savingException ? 'Salvando…' : 'Salvar exceção'}</button>
                </form>
                <div className="exception-list">
                  {(expediente?.excecoes ?? []).map((exception) => (
                    <div className="exception-row" key={exception.data}>
                      <span><CalendarDays size={15} /> {formatDate(exception.data)}</span>
                      <strong>{exception.fechado ? 'Fechado' : exception.periodos.map((period) => `${period.inicio}–${period.fim}`).join(', ')}</strong>
                      <button className="icon-button danger-icon" onClick={() => deleteException(exception)} aria-label={`Remover exceção ${exception.data}`}><Trash2 size={15} /></button>
                    </div>
                  ))}
                  {(expediente?.excecoes.length ?? 0) === 0 && <p className="empty-note">Nenhuma exceção cadastrada.</p>}
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

export function ServicesPage({ empresaId, servicos, refresh, notify }: SharedProps & {
  servicos: Servico[];
  refresh: () => Promise<void>;
}) {
  const blank = { nome: '', preco: '', duracaoMin: '30' };
  const [form, setForm] = useState(blank);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function edit(service: Servico) {
    setEditingId(service.id);
    setForm({ nome: service.nome, preco: String(service.preco), duracaoMin: String(service.duracaoMin) });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(blank);
    setError('');
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    const body = { nome: form.nome.trim(), preco: Number(form.preco), duracaoMin: Number(form.duracaoMin) };
    try {
      if (editingId) await api.atualizarServico(empresaId, editingId, body);
      else await api.criarServico(empresaId, body);
      cancelEdit();
      await refresh();
      notify(editingId ? 'Serviço atualizado.' : 'Serviço cadastrado.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível salvar o serviço.');
    } finally {
      setSaving(false);
    }
  }

  async function remove(service: Servico) {
    if (!window.confirm(`Excluir o serviço “${service.nome}”?`)) return;
    try {
      await api.removerServico(empresaId, service.id);
      await refresh();
      notify('Serviço removido.');
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'Não foi possível remover o serviço.', 'error');
    }
  }

  return (
    <div className="management-layout services-layout">
      <section className="panel create-panel">
        <div className="section-heading"><div><p className="eyebrow">{editingId ? 'EDIÇÃO' : 'CATÁLOGO'}</p><h3>{editingId ? 'Editar serviço' : 'Novo serviço'}</h3><p>Os valores vigentes ficam registrados em cada reserva.</p></div></div>
        <form className="service-form" onSubmit={save}>
          <label>Nome<input required value={form.nome} onChange={(event) => setForm((current) => ({ ...current, nome: event.target.value }))} placeholder="Ex.: Corte tradicional" /></label>
          <div className="form-grid">
            <label>Preço (R$)<input required type="number" min="0.01" step="0.01" value={form.preco} onChange={(event) => setForm((current) => ({ ...current, preco: event.target.value }))} /></label>
            <label>Duração (min)<input required type="number" min="5" step="5" value={form.duracaoMin} onChange={(event) => setForm((current) => ({ ...current, duracaoMin: event.target.value }))} /></label>
          </div>
          {error && <div className="form-error">{error}</div>}
          <div className="button-row"><button className="button button-primary" disabled={saving}>{saving ? 'Salvando…' : editingId ? 'Salvar alterações' : 'Adicionar serviço'}</button>{editingId && <button type="button" className="button button-quiet" onClick={cancelEdit}>Cancelar</button>}</div>
        </form>
      </section>
      <section className="panel table-panel">
        <div className="table-heading"><div><h3>Serviços oferecidos</h3><p>{servicos.length} no catálogo</p></div></div>
        <div className="service-catalog">
          {servicos.map((service) => (
            <div className="service-catalog-row" key={service.id}>
              <span className="service-icon"><Clock3 size={17} /></span>
              <span className="choice-copy"><strong>{service.nome}</strong><small>{service.duracaoMin} minutos</small></span>
              <strong>{money(service.preco)}</strong>
              <span className="row-actions"><button className="icon-button" onClick={() => edit(service)} aria-label={`Editar ${service.nome}`}><Pencil size={15} /></button><button className="icon-button danger-icon" onClick={() => remove(service)} aria-label={`Excluir ${service.nome}`}><Trash2 size={15} /></button></span>
            </div>
          ))}
          {servicos.length === 0 && <div className="empty-state"><Clock3 size={26} /><p>Seu catálogo começa aqui.</p><small>Cadastre os serviços oferecidos pelo estabelecimento.</small></div>}
        </div>
      </section>
    </div>
  );
}

function formatPhone(phone: string) {
  return phone.length === 11
    ? `(${phone.slice(0, 2)}) ${phone.slice(2, 7)}-${phone.slice(7)}`
    : `(${phone.slice(0, 2)}) ${phone.slice(2, 6)}-${phone.slice(6)}`;
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: 'short' }).format(new Date(value));
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(`${value}T00:00:00.000Z`));
}
