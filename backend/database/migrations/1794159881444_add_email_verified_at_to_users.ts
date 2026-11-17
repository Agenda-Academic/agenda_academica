import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Quando a pessoa provou que o e-mail é dela: entrou com o Google ou criou senha nova pelo link
 * do e-mail. O cadastro com senha não confere o e-mail, então uma conta sem essa data pode ter
 * sido criada por outra pessoa. No primeiro login pelo Google, a senha dela é trocada e as
 * sessões abertas caem (GoogleOAuthService.findOrCreateUser).
 *
 * Quem já foi criado pelo Google (auditoria `auth.google_signup`) já conta como conferido.
 */
export default class extends BaseSchema {
  protected tableName = 'users'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.timestamp('email_verified_at').nullable()
    })

    this.defer(async (db) => {
      const rows: { subject_user_id: number | null; created_at: unknown }[] = await db
        .from('audit_logs')
        .where('action', 'auth.google_signup')
        .select('subject_user_id', 'created_at')
      for (const row of rows) {
        if (row.subject_user_id) {
          await db
            .from(this.tableName)
            .where('id', row.subject_user_id)
            .whereNull('email_verified_at')
            .update({ email_verified_at: row.created_at })
        }
      }
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('email_verified_at')
    })
  }
}
