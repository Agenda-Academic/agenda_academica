import {
  parseCalendarItems,
  parseDateText,
  type ParsedCalendarEvent,
  type PdfTextItem,
} from '#services/calendar_pdf_service'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import { test } from '@japa/runner'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

/**
 * Leitura do PDF do Calendário Acadêmico do IFMS. O arquivo de teste é o calendário de 2027 do
 * Campus Três Lagoas, publicado pelo IFMS.
 */

type Envelope<T> = { data: T }
type PdfBody = Envelope<{
  sourceName: string
  checksum: string
  year: number | null
  campus: string | null
  events: ParsedCalendarEvent[]
}>

const API = '/api/v1'
const PDF_2027 = app.makePath('tests/fixtures/calendario-ifms-2027-tres-lagoas.pdf')

async function loginAs(client: any, email: string) {
  const response = await client.post(`${API}/auth/login`).json({ email, password: 'password123' })
  response.assertStatus(200)
  return (response.body() as unknown as Envelope<{ token: string }>).data.token
}

function find(events: ParsedCalendarEvent[], startsAt: string, title: string) {
  return events.filter((event) => event.startsAt === startsAt && event.title === title)
}

test.group('Calendário em PDF', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('lê as 137 datas do calendário de 2027 de Três Lagoas', async ({ client, assert }) => {
    const token = await loginAs(client, 'admin@agenda.test')
    const response = await client
      .post(`${API}/calendar-imports/pdf`)
      .bearerToken(token)
      .file('file', PDF_2027)

    response.assertStatus(200)
    const body = (response.body() as unknown as PdfBody).data
    assert.equal(body.sourceName, 'Calendário Acadêmico IFMS 2027, Campus Três Lagoas')
    assert.equal(body.year, 2027)
    assert.equal(body.campus, 'Três Lagoas')
    // o código vem do arquivo inteiro (o de um arquivo vazio seria pdf-e3b0c44298fc...)
    const expected = createHash('sha256')
      .update(await readFile(PDF_2027))
      .digest('hex')
      .slice(0, 24)
    assert.equal(body.checksum, `pdf-${expected}`)

    const events = body.events
    assert.lengthOf(events, 137)

    // dia só, com o texto quebrado em duas linhas
    const firstClass = find(
      events,
      '2027-03-01',
      'Início das aulas do 1º semestre letivo de 2027 - Graduação - Calendário 17 semanas'
    )
    assert.lengthOf(firstClass, 1)
    assert.isNull(firstClass[0].endsAt)
    assert.equal(firstClass[0].category, 'institutional')

    // intervalo, e outra linha da mesma data vira outro evento
    const march = events.filter(
      (event) => event.startsAt === '2027-03-01' && event.endsAt === '2027-03-05'
    )
    assert.deepEqual(
      march.map((event) => event.title),
      [
        'Período para solicitação de cancelamento de unidades curriculares, exceto para ingressantes (Cursos Técnicos)',
        'Período para solicitação de convalidação de unidades curriculares (Cursos técnicos, CENID, pós-graduação e turmas da graduação)',
        'Período para solicitação de Exame Especial de Dependência',
      ]
    )

    // virada de mês com as duas datas escritas, e o ano seguinte no "Janeiro/2028"
    assert.equal(find(events, '2027-05-31', 'Semana do Meio Ambiente')[0]?.endsAt, '2027-06-05')
    assert.equal(find(events, '2028-01-03', 'Férias docentes')[0]?.endsAt, '2028-02-01')
    assert.lengthOf(find(events, '2028-01-01', 'Confraternização Universal'), 1)

    // Agosto tem duas etiquetas "Dias letivos" sobrepostas no PDF; as datas não podem cair em julho
    assert.lengthOf(find(events, '2027-08-21', 'Sábado letivo referente à segunda-feira'), 1)
    assert.lengthOf(
      find(
        events,
        '2027-08-02',
        'Início das aulas do 2º semestre letivo de 2027 - Graduação - Calendário 17 semanas'
      ),
      1
    )

    // categorias
    assert.equal(
      find(events, '2027-04-21', 'Tiradentes (Feriado Nacional)')[0]?.category,
      'holiday'
    )
    assert.equal(find(events, '2027-02-08', 'Recesso de Carnaval')[0]?.category, 'recess')
    assert.equal(
      find(events, '2027-05-27', 'Corpus Christi (Ponto Facultativo)')[0]?.category,
      'recess'
    )
    assert.equal(
      find(events, '2027-06-15', 'Aniversário de Três Lagoas (Feriado Municipal)')[0]?.category,
      'holiday'
    )

    // assuntos só de servidores vêm marcados para a prévia deixar desmarcados
    assert.equal(
      find(events, '2027-02-26', 'Data limite para entrega dos Planos de Ensino')[0]?.audience,
      'staff'
    )
    assert.equal(
      find(events, '2027-02-11', 'Início das aulas do 1º semestre letivo de 2027')[0]?.audience,
      'all'
    )

    // "2027- Graduação" do PDF sai com espaço; nenhum título passa de 140 ou fica com ponto final
    assert.lengthOf(
      find(
        events,
        '2027-12-10',
        'Término das aulas do 2º semestre letivo de 2027 - Graduação - Calendário 17 semanas'
      ),
      1
    )
    for (const event of events) {
      assert.isAtMost(event.title.length, 140)
      assert.notMatch(event.title, /\.$/)
    }

    // nada repetido e nada da página da grade (que usa "05 – Ref. quinta-feira")
    const keys = events.map((event) => `${event.startsAt}|${event.endsAt}|${event.title}`)
    assert.equal(new Set(keys).size, keys.length)
    assert.isFalse(events.some((event) => event.title.startsWith('Ref.')))
  })

  test('as datas lidas do PDF entram pela importação normal', async ({ client, assert }) => {
    const token = await loginAs(client, 'admin@agenda.test')
    const read = await client
      .post(`${API}/calendar-imports/pdf`)
      .bearerToken(token)
      .file('file', PDF_2027)
    const body = (read.body() as unknown as PdfBody).data
    const chosen = body.events.filter((event) => event.audience === 'all').slice(0, 5)

    const response = await client
      .post(`${API}/calendar-imports`)
      .bearerToken(token)
      .json({
        sourceName: body.sourceName,
        checksum: body.checksum,
        events: chosen.map(({ audience: _audience, ...event }) => event),
      })

    response.assertStatus(201)
    const created = (response.body() as unknown as Envelope<{ events: { title: string }[] }>).data
      .events
    assert.deepEqual(
      created.map((event) => event.title),
      chosen.map((event) => event.title)
    )
  })

  test('só a administração lê o PDF', async ({ client }) => {
    const token = await loginAs(client, 'maraisa@agenda.test')
    const response = await client
      .post(`${API}/calendar-imports/pdf`)
      .bearerToken(token)
      .file('file', PDF_2027)
    response.assertStatus(403)
  })

  test('arquivo que não é PDF é recusado com mensagem', async ({ client, assert }) => {
    const token = await loginAs(client, 'admin@agenda.test')
    const response = await client
      .post(`${API}/calendar-imports/pdf`)
      .bearerToken(token)
      .file('file', Buffer.from('não é um pdf'), { filename: 'calendario.txt' })

    response.assertStatus(422)
    assert.equal(
      (response.body() as unknown as { message: string }).message,
      'O arquivo precisa ser um PDF.'
    )
  })

  test('PDF quebrado é recusado com mensagem', async ({ client, assert }) => {
    const token = await loginAs(client, 'admin@agenda.test')
    const response = await client
      .post(`${API}/calendar-imports/pdf`)
      .bearerToken(token)
      .file('file', Buffer.from('%PDF-1.4 isto não é um pdf de verdade'), {
        filename: 'calendario.pdf',
      })

    response.assertStatus(422)
    assert.match((response.body() as unknown as { message: string }).message, /PDF/)
  })

  test('datas no formato do calendário', ({ assert }) => {
    assert.deepEqual(parseDateText('01.', 3, 2027), { start: '2027-03-01', end: null })
    assert.deepEqual(parseDateText('1º.', 3, 2027), { start: '2027-03-01', end: null })
    assert.deepEqual(parseDateText('01 a 05.', 3, 2027), { start: '2027-03-01', end: '2027-03-05' })
    assert.deepEqual(parseDateText('07 e 08.', 10, 2027), {
      start: '2027-10-07',
      end: '2027-10-08',
    })
    assert.deepEqual(parseDateText('31/05 a 05/06.', 5, 2027), {
      start: '2027-05-31',
      end: '2027-06-05',
    })
    assert.deepEqual(parseDateText('28/06 a 02/07', 6, 2027), {
      start: '2027-06-28',
      end: '2027-07-02',
    })
    assert.deepEqual(parseDateText('29/12 a 05/01.', 12, 2027), {
      start: '2027-12-29',
      end: '2028-01-05',
    })
    assert.deepEqual(parseDateText('30 a 03/01.', 12, 2027), {
      start: '2027-12-30',
      end: '2028-01-03',
    })
    assert.isNull(parseDateText('31.', 2, 2027))
    assert.isNull(parseDateText('2º SEMESTRE', 7, 2027))
  })

  test('outro ano e outro campus no mesmo formato, com a virada de dezembro sem ano escrito', ({
    assert,
  }) => {
    const page = { page: 1, pageWidth: 842, pageHeight: 1190 }
    const items: PdfTextItem[] = [
      { ...page, x: 300, y: 1071, text: '2029' },
      { ...page, x: 692, y: 1084, text: 'Campus' },
      { ...page, x: 691, y: 1067, text: 'Ponta Porã' },
      { ...page, x: 43, y: 1000, text: 'Dezembro' },
      { ...page, x: 327, y: 1001, text: 'Dias letivos: 12' },
      { ...page, x: 43, y: 980, text: '25.' },
      { ...page, x: 115, y: 980, text: 'Natal (Feriado Nacional).' },
      { ...page, x: 43, y: 970, text: '28 a 31.' },
      { ...page, x: 115, y: 970, text: 'Recesso escolar de fim de' },
      { ...page, x: 115, y: 960, text: 'ano.' },
      { ...page, x: 43, y: 900, text: 'Janeiro' },
      { ...page, x: 43, y: 880, text: '01.' },
      { ...page, x: 115, y: 880, text: 'Confraternização universal.' },
      // rodapé, fora do alinhamento do texto
      { ...page, x: 647, y: 72, text: 'MINISTÉRIO DA' },
    ]

    const calendar = parseCalendarItems(items)
    assert.equal(calendar.sourceName, 'Calendário Acadêmico IFMS 2029, Campus Ponta Porã')
    assert.deepEqual(
      calendar.events.map((event) => [event.startsAt, event.endsAt, event.title, event.category]),
      [
        ['2029-12-25', null, 'Natal (Feriado Nacional)', 'holiday'],
        ['2029-12-28', '2029-12-31', 'Recesso escolar de fim de ano', 'recess'],
        ['2030-01-01', null, 'Confraternização universal', 'holiday'],
      ]
    )
  })
})
