import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * Semeia as contas e os dados de demonstração num banco novo, sem nenhum usuário, e completa
 * uma vez a demonstração antiga (sem a escola de `escola_demo_seeder.ts`).
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

    const { default: DemoSeeder } = await import('#database/seeders/demo_datum_seeder')
    const { default: SchoolSeeder, ESCOLA_DEMO_MARKER } =
      await import('#database/seeders/escola_demo_seeder')

    if (await User.query().first()) {
      // Banco com dados: só a demonstração de antes da escola completa (23/11/2026) ganha a
      // escola, uma vez. Os dois seeders procuram cada registro antes de criar, então o que já
      // foi mudado na demonstração fica como está.
      const hasDemo = await User.findBy('email', 'admin@agenda.test')
      const hasSchool = await User.findBy('email', ESCOLA_DEMO_MARKER)
      if (!hasDemo || hasSchool) {
        this.logger.info('o banco já tem usuários: seed pulado')
        return
      }
      this.logger.info('demonstração antiga: trocando as contas e completando a escola')
    } else {
      this.logger.info('banco vazio: populando os dados de demonstração')
    }
    // Os seeders rodam direto: chamar o db:seed por dentro de outro comando não funciona no Ace.
    // Um erro aqui só vai para o log: o entrypoint para no primeiro comando que falha, e a API
    // tem que subir mesmo sem os dados de demonstração (o próximo início tenta de novo).
    try {
      await new DemoSeeder(db.connection()).run()
      await new SchoolSeeder(db.connection()).run()
      this.logger.success('dados de demonstração prontos')
    } catch (error) {
      this.logger.error(`dados de demonstração incompletos: ${(error as Error).message}`)
    }
  }
}
