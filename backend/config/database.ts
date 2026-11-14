import app from '@adonisjs/core/services/app'
import { defineConfig } from '@adonisjs/lucid'
import env from '#start/env'

/**
 * Postgres em produção (Supabase), SQLite no computador e nos testes.
 * O endereço do Postgres vem inteiro em DATABASE_URL, com usuário e senha: nunca fica no repositório.
 */
const usePostgres = env.get('DB_CONNECTION') === 'pg'

/**
 * O `sslmode` do endereço (o Supabase às vezes manda `?sslmode=require`) passaria por cima do
 * `ssl` abaixo no driver, então ele sai daqui e o TLS fica só por conta do DB_SSL.
 */
function postgresUrl() {
  const raw = env.get('DATABASE_URL')?.release()
  if (!raw) {
    return undefined
  }
  const url = new URL(raw)
  url.searchParams.delete('sslmode')
  return url.toString()
}

const migrations = {
  /**
   * Sort migration files naturally by filename.
   */
  naturalSort: true,

  /**
   * Paths containing migration files.
   */
  paths: ['database/migrations'],
}

const dbConfig = defineConfig({
  /**
   * Default connection used for all queries.
   */
  connection: usePostgres ? 'pg' : 'sqlite',

  connections: {
    /**
     * SQLite connection (default).
     */
    sqlite: {
      client: 'better-sqlite3',

      connection: {
        // Banco separado para testes: a suite trunca tabelas e reverte
        // migracoes, o que apagaria os dados de desenvolvimento.
        filename: app.tmpPath(app.inTest ? 'test.sqlite3' : 'db.sqlite3'),
      },

      /**
       * Required by Knex for SQLite defaults.
       */
      useNullAsDefault: true,

      migrations,

      schemaGeneration: {
        /**
         * Enable schema generation from Lucid models.
         */
        enabled: true,

        /**
         * Custom schema rules file paths.
         */
        rulesPaths: ['./database/schema_rules.js'],
      },
    },

    /**
     * PostgreSQL (Supabase em produção). O banco grátis do Supabase pede TLS; o certificado do
     * pooler é assinado pela própria Supabase, então a conexão é cifrada sem conferir a cadeia
     * (DB_SSL=false desliga o TLS, para o Postgres local dos testes).
     */
    pg: {
      client: 'pg',
      connection: {
        connectionString: postgresUrl(),
        ssl: env.get('DB_SSL', true) ? { rejectUnauthorized: false } : false,
      },
      // Poucas conexões: o plano grátis tem limite, e a API é uma só
      pool: { min: 0, max: 5 },
      migrations,
      // database/schema.ts é gerado pelo SQLite; o Postgres tipa algumas colunas diferente
      // (decimal vira texto) e não deve reescrever o arquivo
      schemaGeneration: {
        enabled: false,
      },
    },

    /**
     * MySQL / MariaDB connection.
     * Install package to switch: npm install mysql2
     */
    // mysql: {
    //   client: 'mysql2',
    //   connection: {
    //     host: env.get('DB_HOST'),
    //     port: env.get('DB_PORT'),
    //     user: env.get('DB_USER'),
    //     password: env.get('DB_PASSWORD'),
    //     database: env.get('DB_DATABASE'),
    //   },
    //   migrations: {
    //     naturalSort: true,
    //     paths: ['database/migrations'],
    //   },
    //   debug: app.inDev,
    // },

    /**
     * Microsoft SQL Server connection.
     * Install package to switch: npm install tedious
     */
    // mssql: {
    //   client: 'mssql',
    //   connection: {
    //     server: env.get('DB_HOST'),
    //     port: env.get('DB_PORT'),
    //     user: env.get('DB_USER'),
    //     password: env.get('DB_PASSWORD'),
    //     database: env.get('DB_DATABASE'),
    //   },
    //   migrations: {
    //     naturalSort: true,
    //     paths: ['database/migrations'],
    //   },
    //   debug: app.inDev,
    // },

    /**
     * libSQL (Turso) connection.
     * Install package to switch: npm install @libsql/client
     */
    // libsql: {
    //   client: 'libsql',
    //   connection: {
    //     url: env.get('LIBSQL_URL'),
    //     authToken: env.get('LIBSQL_AUTH_TOKEN'),
    //   },
    //   useNullAsDefault: true,
    //   migrations: {
    //     naturalSort: true,
    //     paths: ['database/migrations'],
    //   },
    //   debug: app.inDev,
    // },
  },
})

export default dbConfig
