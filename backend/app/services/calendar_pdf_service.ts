import { createHash } from 'node:crypto'
import { DateTime } from 'luxon'

/**
 * Lê o PDF do Calendário Acadêmico do IFMS e devolve as datas no formato da importação.
 *
 * O PDF tem texto (não é foto). Em cada página há duas colunas; em cada coluna vêm os meses
 * ("Março", "Janeiro/2028") e, embaixo, as linhas com a data à esquerda e o texto à direita:
 *
 *   01.            Início das aulas do 1º semestre letivo de 2027 - Graduação
 *                  - Calendário 17 semanas.
 *   01 a 05.       Período para solicitação de cancelamento de unidades curriculares, exceto
 *                  para ingressantes (Cursos Técnicos).
 *                  Período para solicitação de convalidação de unidades curriculares (...).
 *   31/05 a 05/06. Semana do Meio Ambiente.
 *
 * Uma linha sem data continua o texto de cima quando ele não terminou em ponto; se terminou, é
 * outro evento na mesma data. A página da grade (com os dias pintados) não tem "Dias letivos:"
 * e fica de fora, porque repete o que já está nas listas.
 */

export type PdfTextItem = {
  page: number
  pageWidth: number
  pageHeight: number
  x: number
  y: number
  text: string
}

export type CalendarCategory = 'institutional' | 'holiday' | 'recess'

export type ParsedCalendarEvent = {
  title: string
  description: string | null
  category: CalendarCategory
  /** AAAA-MM-DD (dia inteiro). */
  startsAt: string
  /** AAAA-MM-DD do último dia, ou null quando é um dia só. */
  endsAt: string | null
  sourceExternalId: string
  /** `staff`: assunto só de servidores (PIT, RAD, diários...); vem desmarcado na prévia. */
  audience: 'all' | 'staff'
}

export type ParsedCalendar = {
  sourceName: string
  year: number | null
  campus: string | null
  events: ParsedCalendarEvent[]
}

const MONTHS: Record<string, number> = {
  janeiro: 1,
  fevereiro: 2,
  marco: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12,
}

const TITLE_MAX = 140
/** Distância máxima da borda da coluna para o texto contar como a coluna da data. */
const DATE_ZONE = 30
/** Tolerância para alinhar a continuação do texto com o texto da linha da data. */
const TEXT_ALIGN = 8
/** Itens com o y a até isso de distância ficam na mesma linha. */
const SAME_LINE = 2.5

const STAFF_PATTERNS = [
  /\b(PIT|PAT|RAD|COPEIs?|COERIs?)\b/,
  /coordenadores de curso/i,
  /conselho pedag[óo]gico/i,
  /planos? de ensino/i,
  /di[áa]rios/i,
  /f[ée]rias docentes/i,
  /planejamento/i,
]

function strip(text: string) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

function clean(text: string) {
  return (
    text
      .replace(/\s+/g, ' ')
      .replace(/\s+([.,;:)])/g, '$1')
      .replace(/\(\s+/g, '(')
      // "2027- Graduação" vira "2027 - Graduação"
      .replace(/(\d)- /g, '$1 - ')
      .trim()
  )
}

function iso(year: number, month: number, day: number) {
  const date = DateTime.fromObject({ year, month, day })
  return date.isValid ? date.toISODate() : null
}

function categoryOf(text: string): CalendarCategory {
  if (/\bferiado\b/i.test(text) || /^confraterniza[cç][aã]o universal/i.test(text)) {
    return 'holiday'
  }
  if (/^recesso\b/i.test(text) || /ponto facultativo/i.test(text) || /^f[ée]rias\b/i.test(text)) {
    return 'recess'
  }
  return 'institutional'
}

/** Título de até 140 caracteres, cortado numa vírgula ou num espaço; o texto inteiro vai na descrição. */
function titleOf(text: string) {
  if (text.length <= TITLE_MAX) {
    return { title: text, description: null }
  }
  const head = text.slice(0, TITLE_MAX + 1)
  const cut = Math.max(head.lastIndexOf(', '), head.lastIndexOf(' referente'))
  const at = cut > 60 ? cut : head.lastIndexOf(' ')
  return { title: text.slice(0, at).replace(/[,;:\s]+$/, ''), description: text }
}

type DateRange = { start: string; end: string | null }

/**
 * "01.", "1º.", "01 a 05.", "07 e 08.", "31/05 a 05/06.", "28/06 a 02/07", "03/01 a 01/02."
 * O mês e o ano vêm do cabeçalho; datas com mês explícito ajustam o ano na virada.
 */
export function parseDateText(raw: string, month: number, year: number): DateRange | null {
  const text = raw.replace(/\s+/g, ' ').replace(/\.$/, '').trim()

  const explicitYear = (m: number) => (m < month - 6 ? year + 1 : m > month + 6 ? year - 1 : year)

  let match = text.match(/^(\d{1,2})º?$/)
  if (match) {
    const start = iso(year, month, Number(match[1]))
    return start ? { start, end: null } : null
  }

  match = text.match(/^(\d{1,2})º? (?:a|e|à) (\d{1,2})$/)
  if (match) {
    const first = Number(match[1])
    const last = Number(match[2])
    const start = iso(year, month, first)
    const endMonth = last < first ? (month % 12) + 1 : month
    const end = iso(endMonth < month ? year + 1 : year, endMonth, last)
    return start && end ? { start, end } : null
  }

  match = text.match(/^(\d{1,2})\/(\d{1,2})$/)
  if (match) {
    const m = Number(match[2])
    const start = iso(explicitYear(m), m, Number(match[1]))
    return start ? { start, end: null } : null
  }

  match = text.match(/^(\d{1,2})(?:\/(\d{1,2}))? (?:a|e|à) (\d{1,2})\/(\d{1,2})$/)
  if (match) {
    const endM = Number(match[4])
    const startM = match[2] ? Number(match[2]) : endM === 1 ? 12 : endM - 1
    const startYear = explicitYear(startM)
    const endYear = endM < startM ? startYear + 1 : startYear
    const start = iso(startYear, startM, Number(match[1]))
    const end = iso(endYear, endM, Number(match[3]))
    return start && end && end >= start ? { start, end } : null
  }

  return null
}

type Line = { x: number; y: number; items: PdfTextItem[]; text: string }

function linesOf(items: PdfTextItem[]): Line[] {
  // o PDF repete os títulos dos meses (sombra): o mesmo texto no mesmo lugar conta uma vez
  const seen = new Set<string>()
  const unique = items.filter((item) => {
    const key = `${Math.round(item.x)}|${Math.round(item.y)}|${item.text}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  unique.sort((a, b) => b.y - a.y || a.x - b.x)

  const lines: Line[] = []
  for (const item of unique) {
    const line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= SAME_LINE)
    if (line) {
      line.items.push(item)
    } else {
      lines.push({ x: 0, y: item.y, items: [item], text: '' })
    }
  }
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x)
    line.x = line.items[0].x
    line.text = clean(line.items.map((item) => item.text).join(' '))
  }
  return lines.sort((a, b) => b.y - a.y)
}

function headerInfo(items: PdfTextItem[]) {
  const first = items.filter((item) => item.page === Math.min(...items.map((i) => i.page)))
  const top = first.filter((item) => item.y > item.pageHeight * 0.85)
  const yearItem = top.find((item) => /^20\d{2}$/.test(item.text.trim()))
  const year = yearItem ? Number(yearItem.text.trim()) : null

  const campusItem = top.find((item) => /^campus$/i.test(item.text.trim()))
  const below = campusItem
    ? top
        .filter(
          (item) =>
            item !== campusItem &&
            Math.abs(item.x - campusItem.x) < 12 &&
            item.y < campusItem.y &&
            campusItem.y - item.y < 40
        )
        .sort((a, b) => b.y - a.y)[0]
    : null
  const campus = below ? clean(below.text) : null
  return { year, campus }
}

type Pending = { range: DateRange; parts: string[] }

export function parseCalendarItems(items: PdfTextItem[], fallbackYear?: number): ParsedCalendar {
  const header = headerInfo(items)
  let year = header.year ?? fallbackYear ?? DateTime.now().year
  const baseYear = year

  const events: ParsedCalendarEvent[] = []
  const keys = new Set<string>()
  let month: number | null = null
  let pending: Pending | null = null

  const flush = () => {
    if (!pending) return
    const text = clean(pending.parts.join(' ')).replace(/\.$/, '').trim()
    const range = pending.range
    pending = null
    if (text.length < 3) return
    const { title, description } = titleOf(text)
    const key = `${range.start}|${range.end ?? ''}|${strip(text)}`
    if (keys.has(key)) return
    keys.add(key)
    const hash = createHash('sha1').update(key).digest('hex').slice(0, 10)
    events.push({
      title,
      description,
      category: categoryOf(text),
      startsAt: range.start,
      endsAt: range.end,
      sourceExternalId: `pdf-${range.start}-${hash}`,
      audience: STAFF_PATTERNS.some((pattern) => pattern.test(text)) ? 'staff' : 'all',
    })
  }

  const pages = [...new Set(items.map((item) => item.page))].sort((a, b) => a - b)
  for (const page of pages) {
    const pageItems = items.filter((item) => item.page === page)
    if (!pageItems.some((item) => /dias letivos\s*:/i.test(item.text))) {
      continue
    }
    const { pageWidth } = pageItems[0]
    const columns = [
      linesOf(pageItems.filter((item) => item.x < pageWidth / 2)),
      linesOf(pageItems.filter((item) => item.x >= pageWidth / 2)),
    ]

    // o que fica acima do primeiro mês da página é o cabeçalho (nome do campus, título)
    const monthYs = columns
      .flat()
      .filter((line) => monthOf(line.text))
      .map((line) => line.y)
    const topLimit = monthYs.length ? Math.max(...monthYs) + SAME_LINE : Infinity

    for (const columnLines of columns) {
      const lines = columnLines.filter((line) => line.y <= topLimit)
      if (!lines.length) continue
      const left = Math.min(...lines.map((line) => line.x))
      let textX: number | null = null

      for (const line of lines) {
        const heading = monthOf(line.text)
        if (heading && line.x - left < DATE_ZONE) {
          flush()
          if (heading.year) {
            year = heading.year
          } else if (month !== null && heading.month < month) {
            year += 1
          }
          month = heading.month
          continue
        }
        if (month === null || /^\dº ?semestre$/i.test(line.text)) continue

        const dateItems = line.items.filter((item) => item.x - left < DATE_ZONE)
        const textItems = line.items.filter((item) => item.x - left >= DATE_ZONE)
        if (dateItems.length) {
          const range = parseDateText(dateItems.map((item) => item.text).join(' '), month, year)
          if (!range || !textItems.length) {
            // "1º SEMESTRE", títulos e números soltos: não são datas
            continue
          }
          flush()
          textX = textItems[0].x
          pending = { range, parts: [textItems.map((item) => item.text).join(' ')] }
          continue
        }

        // continuação: precisa começar alinhada com o texto das datas (rodapé e "Dias letivos" ficam de fora)
        if (!pending || textX === null || Math.abs(line.x - textX) > TEXT_ALIGN) continue
        const current: Pending = pending
        const previous = clean(current.parts.join(' '))
        if (/[.]$/.test(previous)) {
          flush()
          pending = { range: current.range, parts: [line.text] }
        } else {
          current.parts.push(line.text)
        }
      }
      flush()
    }
  }

  events.sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  const campusLabel = header.campus ? `, Campus ${header.campus}` : ''
  return {
    sourceName: `Calendário Acadêmico IFMS ${baseYear}${campusLabel}`.slice(0, 120),
    year: header.year,
    campus: header.campus,
    events,
  }
}

function monthOf(text: string): { month: number; year: number | null } | null {
  const match = strip(text).match(
    // o PDF de 2027 tem duas etiquetas "Dias letivos" sobrepostas em Agosto, por isso o "*"
    /^(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?:\s*\/\s*(\d{4}))?(?:\s+dias letivos\s*:?\s*\d+)*$/
  )
  if (!match) return null
  return { month: MONTHS[match[1]], year: match[2] ? Number(match[2]) : null }
}

export class CalendarPdfError extends Error {}

export default class CalendarPdfService {
  /** Texto do PDF com a posição de cada pedaço (x e y em pontos, y cresce para cima). */
  static async extractItems(data: Uint8Array): Promise<PdfTextItem[]> {
    const { getDocumentProxy } = await import('unpdf')
    let pdf
    try {
      pdf = await getDocumentProxy(data)
    } catch {
      throw new CalendarPdfError(
        'Não foi possível abrir o PDF. Confira se o arquivo não está corrompido.'
      )
    }
    const items: PdfTextItem[] = []
    for (let page = 1; page <= pdf.numPages; page++) {
      const current = await pdf.getPage(page)
      const [, , pageWidth, pageHeight] = current.view
      const content = await current.getTextContent()
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue
        items.push({
          page,
          pageWidth,
          pageHeight,
          x: item.transform[4],
          y: item.transform[5],
          text: item.str,
        })
      }
    }
    return items
  }

  static async parse(data: Uint8Array) {
    // antes de ler: o PDF.js fica com o buffer do arquivo e ele chega vazio aqui depois
    const checksum = `pdf-${createHash('sha256').update(data).digest('hex').slice(0, 24)}`
    const items = await this.extractItems(data)
    if (!items.length) {
      throw new CalendarPdfError(
        'Este PDF não tem texto (parece uma imagem escaneada). Use o PDF original do calendário.'
      )
    }
    const calendar = parseCalendarItems(items)
    if (!calendar.events.length) {
      throw new CalendarPdfError(
        'Não encontrei datas neste PDF. Use o PDF do Calendário Acadêmico do IFMS, com os meses e as datas listadas.'
      )
    }
    return { ...calendar, checksum }
  }
}
