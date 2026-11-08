import { configApp } from '@adonisjs/eslint-config'

// database/schema.ts é gerado pelo `node ace migration:run` e não passa pelo prettier.
export default configApp({ ignores: ['database/schema.ts'] })
