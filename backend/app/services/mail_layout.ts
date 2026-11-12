/** Partes comuns dos e-mails da Agenda Acadêmica: escapar texto e o cartão com o botão. */

export const BRAND = '#17803f'

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

type CardOptions = {
  /** Linha pequena em verde acima do título ("Lembrete", "Senha"). */
  kicker: string
  title: string
  paragraphs: string[]
  button: { label: string; href: string }
  footer: string
}

/** Cartão branco centralizado, como no app. Todo texto passa por escapeHtml. */
export function renderCard(options: CardOptions) {
  const paragraphs = options.paragraphs
    .map(
      (text) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.5">${escapeHtml(text)}</p>`
    )
    .join('')
  return `<!doctype html>
<html lang="pt-BR">
<body style="margin:0;padding:24px 12px;background:#f3f5f7;font-family:'Open Sans',Arial,sans-serif;color:#1d2433">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;border:1px solid #e3e7ec">
    <tr><td style="padding:28px 28px 8px">
      <p style="margin:0 0 4px;font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${BRAND}">${escapeHtml(options.kicker)}</p>
      <h1 style="margin:0 0 14px;font-size:20px;line-height:1.3">${escapeHtml(options.title)}</h1>
      ${paragraphs}
    </td></tr>
    <tr><td style="padding:6px 28px 28px">
      <a href="${escapeHtml(options.button.href)}" style="display:inline-block;padding:12px 20px;border-radius:12px;background:${BRAND};color:#ffffff;font-weight:700;font-size:15px;text-decoration:none">${escapeHtml(options.button.label)}</a>
    </td></tr>
  </table>
  <p style="max-width:520px;margin:16px auto 0;font-size:12px;line-height:1.5;color:#5b6472">${escapeHtml(options.footer)}</p>
</body>
</html>`
}
