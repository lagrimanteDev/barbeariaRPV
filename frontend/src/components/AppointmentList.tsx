import { CalendarClock, Check, Clock3, MoreHorizontal, Pencil, Trash2, UserRound, X } from 'lucide-react';
import type { Agendamento, StatusAgendamento } from '../api';
import { clock, money } from './BookingWizard';

type Props = {
  appointments: Agendamento[];
  onStatus: (appointment: Agendamento, status: StatusAgendamento) => void;
  onDelete: (appointment: Agendamento) => void;
  onReschedule: (appointment: Agendamento) => void;
};

const statusNames: Record<StatusAgendamento, string> = {
  AGENDADO: 'Agendado',
  CONCLUIDO: 'Concluído',
  CANCELADO: 'Cancelado',
  FALTOU: 'Faltou',
};

export default function AppointmentList({ appointments, onStatus, onDelete, onReschedule }: Props) {
  if (appointments.length === 0) {
    return <div className="empty-state"><CalendarClock size={28} /><p>Nenhum atendimento por aqui.</p><small>Quando houver uma reserva, ela aparecerá nesta lista.</small></div>;
  }

  return (
    <div className="appointment-list">
      {appointments.map((appointment) => {
        const startsSoon = appointment.status === 'AGENDADO' &&
          new Date(appointment.inicio).getTime() > Date.now() &&
          new Date(appointment.inicio).getTime() - Date.now() <= 30 * 60_000;
        const overdue = appointment.status === 'AGENDADO' && new Date(appointment.fim).getTime() < Date.now();
        const total = appointment.servicos.reduce((sum, item) => sum + item.precoCobrado, 0);
        const canMiss = new Date(appointment.fim).getTime() < Date.now();

        return (
          <article className={`appointment-card ${startsSoon ? 'urgent' : ''} ${overdue ? 'overdue' : ''}`} key={appointment.id}>
            <div className="appointment-time">
              <strong>{clock(appointment.inicio)}</strong>
              <span>{clock(appointment.fim)}</span>
              <i />
            </div>
            <div className="appointment-main">
              <div className="appointment-heading">
                <h3>{appointment.cliente?.nome ?? 'Cliente removido'}</h3>
                <span className={`status-tag status-${appointment.status.toLowerCase()}`}>{statusNames[appointment.status]}</span>
              </div>
              <p className="appointment-service">{appointment.servicos.map((item) => item.servico?.nome ?? 'Serviço removido').join(' · ') || 'Sem serviço'}</p>
              <div className="appointment-meta">
                <span><UserRound size={14} /> {appointment.profissional?.nome ?? 'Profissional removido'}</span>
                <span><Clock3 size={14} /> {appointment.servicos.reduce((sum, item) => sum + item.duracaoMinutos, 0)} min</span>
                <strong>{money(total)}</strong>
              </div>
              {appointment.motivo && <p className="appointment-reason">Motivo: {appointment.motivo}</p>}
              {startsSoon && <p className="appointment-alert">Começa nos próximos 30 minutos</p>}
              {overdue && <p className="appointment-alert">Pendente de conclusão</p>}
            </div>
            {appointment.status === 'AGENDADO' && (
              <div className="appointment-actions">
                <button className="button button-outline button-small" onClick={() => onReschedule(appointment)}><Pencil size={14} /> Remarcar</button>
                <div className="action-menu">
                  <button className="icon-button" aria-label="Mais ações"><MoreHorizontal size={19} /></button>
                  <div className="action-menu-popover">
                    <button onClick={() => onStatus(appointment, 'CONCLUIDO')}><Check size={14} /> Concluir</button>
                    {canMiss && <button onClick={() => onStatus(appointment, 'FALTOU')}><X size={14} /> Marcar falta</button>}
                    <button onClick={() => onStatus(appointment, 'CANCELADO')}><X size={14} /> Cancelar</button>
                    <button className="danger-action" onClick={() => onDelete(appointment)}><Trash2 size={14} /> Excluir</button>
                  </div>
                </div>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
