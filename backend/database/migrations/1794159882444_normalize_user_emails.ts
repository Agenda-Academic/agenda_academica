import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * O e-mail passa a ser guardado sempre em minúsculas e sem espaços (o cadastro, o login e o
 * vínculo comparam assim). Aqui as contas antigas são acertadas.
 *
 * Se duas contas antigas só diferem nas maiúsculas, nenhuma das duas é mexida: decidir qual é
 * a verdadeira fica para a secretaria. Sem esses casos, um índice único em lower(email) impede
 * que eles voltem a acontecer.
 */
export default class extends BaseSchema {
  protected tableName = 'users'

  async up() {
    this.defer(async (db) => {
      const rows: { id: number; email: string }[] = await db
        .from(this.tableName)
        .select('id', 'email')
      const groups = new Map<string, { id: number; email: string }[]>()
      for (const row of rows) {
        const key = row.email.trim().toLowerCase()
        groups.set(key, [...(groups.get(key) ?? []), row])
      }

      let duplicated = false
      for (const [normalized, group] of groups) {
        if (group.length > 1) {
          duplicated = true
          continue
        }
        if (group[0].email !== normalized) {
          await db.from(this.tableName).where('id', group[0].id).update({ email: normalized })
        }
      }

      if (!duplicated) {
        await db.rawQuery(
          'CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique ON users (lower(email))'
        )
      }
    })
  }

  async down() {
    this.defer(async (db) => {
      await db.rawQuery('DROP INDEX IF EXISTS users_email_lower_unique')
    })
  }
}
