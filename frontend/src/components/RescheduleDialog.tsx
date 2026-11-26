import { useEffect, useState } from 'react';
import { ArrowRight, CalendarClock, X } from 'lucide-react';
import { api, ApiError, type Agendamento, type Profissional } from '../api';
import { clock, dateLabel, todayLocal } from './BookingWizard';

type Props = {
  empresaId: number;
  appointment: Agendamento;
  profissionais: Profissional[];
  onClose: () => void;
  onSaved: () => void;
};

export default function RescheduleDialog({ empresaId, appointment, profissionais, onClose, onSaved }: Props) {
  const [profissionalId, setProfissionalId] = useState(appointment.profissional?.id ?? 0);
  const appointmentDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(appointment.inicio));
  const [data, setData] = useState(appointmentDate < todayLocal() ? todayLocal() : appointmentDate);
  const [horarios, setHorarios] = useState<Array<{ inicio: string; fim: string }>>([]);
  const [inicio, setInicio] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const servicoIds = appointment.servicos.map((item) => item.servicoId);

  useEffect(() => {
    let active = true;
    setInicio('');
    setLoading(true);
    setError('');
    api.horariosDisponiveis(empresaId, profissionalId, data, servicoIds)
      .then((result) => {
        if (active) setHorarios(result);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os horários.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [empresaId, profissionalId, data, servicoIds.join(',')]);

  async function save() {
    if (!inicio) return;
    setSaving(true);
    setError('');
    try {
      await api.remarcar(empresaId, appointment.id, { profissionalId, inicio });
      onSaved();
      onClose();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        try {
          setHorarios(await api.horariosDisponiveis(empresaId, profissionalId, data, servicoIds));
          setInicio('');
          setError('O horário ficou indisponível. Atualizamos as opções; escolha outro horário.');
        } catch (refreshError) {
          setError(`${cause.message} Não foi possível atualizar os horários: ${refreshError instanceof Error ? refreshError.message : 'tente novamente.'}`);
        }
      } else {
        setError(cause instanceof Error ? cause.message : 'Não foi possível remarcar.');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="overlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="modal reschedule-modal" role="dialog" aria-modal="true" aria-labelledby="reschedule-title">
        <div className="modal-top">
          <div><p className="eyebrow">ALTERAR RESERVA #{appointment.id}</p><h2 id="reschedule-title">Remarcar atendimento</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Fechar"><X size={20} /></button>
        </div>
        <div className="reschedule-summary"><CalendarClock size={18} /><span>{appointment.cliente?.nome} · {dateLabel(appointment.inicio)} às {clock(appointment.inicio)}</span></div>
        <div className="form-grid">
          <label>Profissional
            <select value={profissionalId} onChange={(event) => setProfissionalId(Number(event.target.value))}>
              {profissionais.filter((item) => item.ativo).map((item) => <option value={item.id} key={item.id}>{item.nome}</option>)}
            </select>
          </label>
          <label>Nova data<input type="date" min={todayLocal()} value={data} onChange={(event) => setData(event.target.value)} /></label>
        </div>
        <span className="field-title">Horários disponíveis</span>
        {loading ? <div className="loading-state"><span className="spinner" /> Atualizando horários…</div> : (
          <div className="slot-grid compact-slots">
            {horarios.map((slot) => <button className={`slot-button ${inicio === slot.inicio ? 'selected' : ''}`} key={slot.inicio} onClick={() => setInicio(slot.inicio)}>{clock(slot.inicio)}</button>)}
            {horarios.length === 0 && <p className="empty-note">Nenhum horário disponível nesta data.</p>}
          </div>
        )}
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="wizard-footer">
          <button className="button button-quiet" onClick={onClose}>Cancelar</button>
          <button className="button button-primary" disabled={!inicio || saving} onClick={save}>{saving ? 'Salvando…' : 'Confirmar remarcação'} <ArrowRight size={16} /></button>
        </div>
      </section>
    </div>
  );
}
