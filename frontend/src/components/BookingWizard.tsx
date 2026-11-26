import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Clock3, Plus, Search, UserRound, X } from 'lucide-react';
import { api, ApiError, type AgendamentoPayload, type Cliente, type Profissional, type Servico } from '../api';

type Props = {
  empresaId: number;
  clientes: Cliente[];
  profissionais: Profissional[];
  servicos: Servico[];
  onClose: () => void;
  onSubmit: (payload: AgendamentoPayload) => Promise<'created' | 'queued'>;
  onClientCreated: (cliente: Cliente) => void;
  initialPayload?: AgendamentoPayload;
};

const steps = ['Cliente', 'Equipe e serviços', 'Horário', 'Revisão'];

export default function BookingWizard({
  empresaId,
  clientes,
  profissionais,
  servicos,
  onClose,
  onSubmit,
  onClientCreated,
  initialPayload,
}: Props) {
  const [step, setStep] = useState(initialPayload ? 2 : 0);
  const [clientSearch, setClientSearch] = useState('');
  const [clienteId, setClienteId] = useState<number | null>(initialPayload?.clienteId ?? null);
  const [profissionalId, setProfissionalId] = useState<number | null>(initialPayload?.profissionalId ?? null);
  const [servicoIds, setServicoIds] = useState<number[]>(initialPayload?.servicoIds ?? []);
  const initialDate = initialPayload ? dateFromInstant(initialPayload.inicio) : todayLocal();
  const [data, setData] = useState(initialDate < todayLocal() ? todayLocal() : initialDate);
  const [inicio, setInicio] = useState('');
  const [horarios, setHorarios] = useState<Array<{ inicio: string; fim: string }>>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [newClientOpen, setNewClientOpen] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [newClientPhone, setNewClientPhone] = useState('');
  const [savingClient, setSavingClient] = useState(false);

  const cliente = clientes.find((item) => item.id === clienteId);
  const profissional = profissionais.find((item) => item.id === profissionalId);
  const selecionados = servicos.filter((item) => servicoIds.includes(item.id));
  const duracao = selecionados.reduce((sum, item) => sum + item.duracaoMin, 0);
  const valor = selecionados.reduce((sum, item) => sum + item.preco, 0);
  const filteredClients = useMemo(() => {
    const term = clientSearch.trim().toLocaleLowerCase('pt-BR');
    return clientes.filter((item) =>
      !term || item.nome.toLocaleLowerCase('pt-BR').includes(term) || item.telefone.includes(term),
    );
  }, [clientes, clientSearch]);

  useEffect(() => {
    setInicio('');
    setHorarios([]);
    if (!profissionalId || servicoIds.length === 0 || !data) return;
    let active = true;
    setLoadingSlots(true);
    setError('');
    api.horariosDisponiveis(empresaId, profissionalId, data, servicoIds)
      .then((result) => {
        if (active) setHorarios(result);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os horários.');
      })
      .finally(() => {
        if (active) setLoadingSlots(false);
      });
    return () => {
      active = false;
    };
  }, [empresaId, profissionalId, data, servicoIds.join(',')]);

  async function saveNewClient(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingClient(true);
    setError('');
    try {
      const created = await api.criarCliente(empresaId, {
        nome: newClientName.trim(),
        telefone: newClientPhone.replace(/\D/g, ''),
      });
      onClientCreated(created);
      setClienteId(created.id);
      setNewClientOpen(false);
      setNewClientName('');
      setNewClientPhone('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível cadastrar o cliente.');
    } finally {
      setSavingClient(false);
    }
  }

  async function confirmBooking() {
    if (!clienteId || !profissionalId || !inicio || servicoIds.length === 0) return;
    setCreating(true);
    setError('');
    try {
      const result = await onSubmit({ clienteId, profissionalId, inicio, servicoIds });
      if (result === 'queued') {
        onClose();
        return;
      }
      onClose();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409 && profissionalId) {
        try {
          const updated = await api.horariosDisponiveis(empresaId, profissionalId, data, servicoIds);
          setHorarios(updated);
          setInicio(updated.some((slot) => slot.inicio === inicio) ? inicio : '');
          setStep(2);
          setError('Esse horário acabou de ficar indisponível. Atualizamos as opções; escolha outro horário para continuar.');
        } catch (refreshError) {
          setError(`${cause.message} Não foi possível atualizar os horários: ${refreshError instanceof Error ? refreshError.message : 'tente novamente.'}`);
        }
      } else {
        setError(cause instanceof Error ? cause.message : 'Não foi possível confirmar o agendamento.');
      }
    } finally {
      setCreating(false);
    }
  }

  function next() {
    setError('');
    if (step === 0 && !clienteId) return setError('Selecione um cliente para continuar.');
    if (step === 1 && (!profissionalId || servicoIds.length === 0)) {
      return setError('Selecione um profissional e ao menos um serviço.');
    }
    if (step === 2 && !inicio) return setError('Escolha um horário disponível.');
    setStep((current) => Math.min(current + 1, steps.length - 1));
  }

  function toggleServico(id: number) {
    setServicoIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  return (
    <div className="overlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="wizard modal" role="dialog" aria-modal="true" aria-labelledby="booking-title">
        <div className="modal-top">
          <div>
            <p className="eyebrow">NOVA RESERVA</p>
            <h2 id="booking-title">Agendar atendimento</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Fechar"><X size={20} /></button>
        </div>

        <div className="step-track" aria-label="Etapas do agendamento">
          {steps.map((label, index) => (
            <div className={`step-item ${index === step ? 'active' : ''} ${index < step ? 'done' : ''}`} key={label}>
              <span>{index < step ? <Check size={14} /> : index + 1}</span>
              <small>{label}</small>
            </div>
          ))}
        </div>

        <div className="wizard-content">
          {step === 0 && (
            <div className="wizard-step">
              <div className="section-heading">
                <div><h3>Quem vem hoje?</h3><p>Encontre um cliente pelo nome ou telefone.</p></div>
                <button className="button button-outline" onClick={() => setNewClientOpen((open) => !open)}>
                  <Plus size={16} /> Novo cliente
                </button>
              </div>
              {newClientOpen && (
                <form className="inline-form client-create" onSubmit={saveNewClient}>
                  <label>Nome<input autoFocus required value={newClientName} onChange={(event) => setNewClientName(event.target.value)} /></label>
                  <label>Telefone com DDD<input required inputMode="tel" placeholder="11987654321" value={newClientPhone} onChange={(event) => setNewClientPhone(event.target.value)} /></label>
                  <button className="button button-primary" disabled={savingClient}>{savingClient ? 'Salvando…' : 'Salvar cliente'}</button>
                </form>
              )}
              <label className="search-field">
                <Search size={17} />
                <input value={clientSearch} onChange={(event) => setClientSearch(event.target.value)} placeholder="Buscar por nome ou telefone" />
              </label>
              <div className="choice-list client-choices">
                {filteredClients.map((item) => (
                  <button className={`choice-row ${clienteId === item.id ? 'selected' : ''}`} key={item.id} onClick={() => setClienteId(item.id)}>
                    <span className="avatar">{initials(item.nome)}</span>
                    <span className="choice-copy"><strong>{item.nome}</strong><small>{formatPhone(item.telefone)}</small></span>
                    {clienteId === item.id && <Check size={18} className="check-icon" />}
                  </button>
                ))}
                {filteredClients.length === 0 && <p className="empty-note">Nenhum cliente encontrado. Cadastre um novo para continuar.</p>}
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="wizard-step">
              <div className="section-heading"><div><h3>Monte o atendimento</h3><p>Escolha quem atende e os serviços da visita.</p></div></div>
              <div className="form-block">
                <span className="field-title">Profissional</span>
                <div className="professional-pills">
                  {profissionais.filter((item) => item.ativo).map((item) => (
                    <button className={`professional-pill ${profissionalId === item.id ? 'selected' : ''}`} key={item.id} onClick={() => setProfissionalId(item.id)}>
                      <span className="avatar small">{initials(item.nome)}</span><span>{item.nome}</span>
                    </button>
                  ))}
                  {profissionais.filter((item) => item.ativo).length === 0 && <p className="empty-note">Cadastre um profissional para liberar a agenda.</p>}
                </div>
              </div>
              <div className="form-block">
                <span className="field-title">Serviços</span>
                <div className="service-choices">
                  {servicos.map((item) => (
                    <button className={`service-choice ${servicoIds.includes(item.id) ? 'selected' : ''}`} key={item.id} onClick={() => toggleServico(item.id)}>
                      <span className="checkbox-mark">{servicoIds.includes(item.id) && <Check size={13} />}</span>
                      <span className="service-choice-copy"><strong>{item.nome}</strong><small>{item.duracaoMin} min</small></span>
                      <strong className="service-price">{money(item.preco)}</strong>
                    </button>
                  ))}
                  {servicos.length === 0 && <p className="empty-note">Cadastre ao menos um serviço para montar o atendimento.</p>}
                </div>
              </div>
              {selecionados.length > 0 && (
                <div className="selection-summary"><span>{selecionados.length} {selecionados.length === 1 ? 'serviço' : 'serviços'} · {duracao} min</span><strong>{money(valor)}</strong></div>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="wizard-step">
              <div className="section-heading"><div><h3>Encontre um horário</h3><p>Os horários são confirmados pela agenda da equipe.</p></div></div>
              <label className="date-field">Data<input type="date" min={todayLocal()} value={data} onChange={(event) => setData(event.target.value)} /></label>
              {loadingSlots ? <div className="loading-state"><span className="spinner" /> Buscando horários livres…</div> : (
                <div className="slot-grid">
                  {horarios.map((slot) => (
                    <button className={`slot-button ${inicio === slot.inicio ? 'selected' : ''}`} key={slot.inicio} onClick={() => setInicio(slot.inicio)}>
                      {clock(slot.inicio)}
                    </button>
                  ))}
                  {!loadingSlots && horarios.length === 0 && <div className="empty-state compact"><Clock3 size={22} /><p>Nenhum horário disponível nesta data.</p><small>Tente outro dia ou profissional.</small></div>}
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="wizard-step">
              <div className="section-heading"><div><h3>Revise antes de confirmar</h3><p>Confira os detalhes da reserva.</p></div></div>
              <div className="review-card">
                <div className="review-row"><span><UserRound size={16} /> Cliente</span><strong>{cliente?.nome ?? '—'}</strong></div>
                <div className="review-row"><span>Profissional</span><strong>{profissional?.nome ?? '—'}</strong></div>
                <div className="review-row"><span>Data e horário</span><strong>{inicio ? `${dateLabel(inicio)} · ${clock(inicio)}` : '—'}</strong></div>
                <div className="review-divider" />
                {selecionados.map((item) => <div className="review-row service-review" key={item.id}><span>{item.nome} · {item.duracaoMin} min</span><strong>{money(item.preco)}</strong></div>)}
                <div className="review-divider" />
                <div className="review-row total-row"><span>Total · {duracao} min</span><strong>{money(valor)}</strong></div>
              </div>
              <p className="review-footnote">O horário só fica reservado depois da confirmação da API.</p>
            </div>
          )}
          {error && <div className="form-error" role="alert">{error}</div>}
        </div>

        <div className="wizard-footer">
          <button className="button button-quiet" onClick={() => step === 0 ? onClose() : setStep((current) => current - 1)}>
            <ArrowLeft size={16} /> {step === 0 ? 'Cancelar' : 'Voltar'}
          </button>
          {step < 3 ? (
            <button className="button button-primary" onClick={next}>Continuar <ArrowRight size={16} /></button>
          ) : (
            <button className="button button-primary" onClick={confirmBooking} disabled={creating}>
              {creating ? 'Confirmando…' : 'Confirmar agendamento'} <Check size={16} />
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

export function todayLocal() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function dateFromInstant(value: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function clock(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function dateLabel(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  }).format(new Date(value));
}

export function money(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

export function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toLocaleUpperCase('pt-BR') ?? '').join('');
}

function formatPhone(phone: string) {
  if (phone.length < 10) return phone;
  return phone.length === 11
    ? `(${phone.slice(0, 2)}) ${phone.slice(2, 7)}-${phone.slice(7)}`
    : `(${phone.slice(0, 2)}) ${phone.slice(2, 6)}-${phone.slice(6)}`;
}
