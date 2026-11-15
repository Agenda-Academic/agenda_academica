import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * Semeia as contas e os dados de demonstração só num banco novo, sem nenhum usuário.
 *
 * O Postgres guarda os dados entre os reinícios da API. Semear de novo a cada boot desfaria o
 * que foi mudado na demonstração e duplicaria o que foi renomeado.
 */
export default class SeedIfEmpty extends BaseCommand {
  static commandName = 'db:seed-if-empty'
  static description = 'Run the demo seeder only when the database has no users yet'

  static options: CommandOptions = {
    startApp: true,
  }

  async run() {
    // Tudo carregado aqui dentro: o Ace lê este arquivo antes de a aplicação subir, e o modelo
    // de usuário precisa do serviço de hash já pronto
    const { default: db } = await import('@adonisjs/lucid/services/db')
    const { default: User } = await import('#models/user')
    const { default: AccountPolicyService } = await import('#services/account_policy_service')

    if (!AccountPolicyService.demoAccountsEnabled()) {
      this.logger.info('contas de demonstração desligadas (DEMO_ACCOUNTS=false): seed pulado')
      return
    }

    if (await User.query().first()) {
      this.logger.info('o banco já tem usuários: seed pulado')
      return
    }
    this.logger.info('banco vazio: populando os dados de demonstração')
    // O seeder roda direto: chamar o db:seed por dentro de outro comando não funciona no Ace
    const { default: DemoSeeder } = await import('#database/seeders/demo_datum_seeder')
    await new DemoSeeder(db.connection()).run()
    this.logger.success('dados de demonstração prontos')
  }
}
