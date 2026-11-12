import type AcademicEvent from '#models/academic_event'
import type User from '#models/user'
import { BRAND, escapeHtml } from '#services/mail_layout'
import type { MailMessage } from '#services/mail_service'
import env from '#start/env'
import { DateTime } from 'luxon'

/** Mesma zona em que o horário do evento é digitado (ver date_time_service). */
const EVENT_ZONE = 'America/Sao_Paulo'
const DEFAULT_FRONTEND_URL = 'http://localhost:3000'

function plural(count: number, singular: string, pluralForm: string) {
  return `${count} ${count === 1 ? singular : pluralForm}`
}

/** "45 minutos", "3 horas", "2 dias": quanto falta, contado na hora do envio. */
export function timeUntil(startsAt: DateTime, now: DateTime) {
  const minutes = Math.max(1, Math.round(startsAt.diff(now, 'minutes').minutes))
  if (minutes < 60) {
    return plural(minutes, 'minuto', 'minutos')
  }
  const hours = Math.round(minutes / 60)
  if (hours < 24) {
    return plural(hours, 'hora', 'horas')
  }
  return plural(Math.round(hours / 24), 'dia', 'dias')
}

/** "quarta-feira, 12 de novembro, às 19:00" */
export function eventWhen(startsAt: DateTime) {
  return startsAt.setZone(EVENT_ZONE).setLocale('pt-BR').toFormat("cccc, d 'de' LLLL', às' HH:mm")
}

export function buildReminderEmail(
  user: User,
  event: AcademicEvent,
  now: DateTime = DateTime.now()
): MailMessage {
  const firstName = user.fullName?.trim().split(/\s+/)[0] || null
  const when = eventWhen(event.startsAt)
  const until = timeUntil(event.startsAt, now)
  const link = (env.get('FRONTEND_URL') || DEFAULT_FRONTEND_URL).replace(/\/+$/, '')
  const subjectName = event.subject?.name ?? null

  const details = [
    { label: 'Quando', value: when },
    subjectName ? { label: 'Disciplina', value: subjectName } : null,
    event.location ? { label: 'Local', value: event.location } : null,
  ].filter((item): item is { label: string; value: string } => item !== null)

  const greeting = firstName ? `Olá, ${firstName}.` : 'Olá.'
  const intro = `Faltam ${until} para este evento da sua agenda.`
  const footer =
    'Você recebeu este e-mail porque ativou um lembrete para este evento. Para não receber mais, abra o evento na agenda e remova o lembrete.'

  const text = [
    greeting,
    '',
    intro,
    '',
    event.title,
    ...details.map((item) => `${item.label}: ${item.value}`),
    '',
    `Abrir a agenda: ${link}`,
    '',
    footer,
  ].join('\n')

  const rows = details
    .map(
      (item) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#5b6472;white-space:nowrap;vertical-align:top">${escapeHtml(item.label)}</td><td style="padding:4px 0;color:#1d2433">${escapeHtml(item.value)}</td></tr>`
    )
    .join('')

  const html = `<!doctype html>
<html lang="pt-BR">
<body style="margin:0;padding:24px 12px;background:#f3f5f7;font-family:'Open Sans',Arial,sans-serif;color:#1d2433">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;border:1px solid #e3e7ec">
    <tr><td style="padding:28px 28px 8px">
      <p style="margin:0 0 4px;font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${BRAND}">Lembrete</p>
      <p style="margin:0 0 16px;font-size:15px">${escapeHtml(greeting)} ${escapeHtml(intro)}</p>
      <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3">${escapeHtml(event.title)}</h1>
      <table role="presentation" cellspacing="0" cellpadding="0" style="font-size:15px;line-height:1.5">${rows}</table>
    </td></tr>
    <tr><td style="padding:20px 28px 28px">
      <a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 20px;border-radius:12px;background:${BRAND};color:#ffffff;font-weight:700;font-size:15px;text-decoration:none">Abrir a agenda</a>
    </td></tr>
  </table>
  <p style="max-width:520px;margin:16px auto 0;font-size:12px;line-height:1.5;color:#5b6472">${escapeHtml(footer)}</p>
</body>
</html>`

  return {
    to: user.email,
    toName: user.fullName,
    subject: `Lembrete: ${event.title}, ${when}`,
    text,
    html,
  }
}
