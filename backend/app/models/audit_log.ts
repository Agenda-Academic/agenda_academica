import { AuditLogSchema } from '#database/schema'

/** Registro de quem fez o quê; só ids e valores de antes e depois. */
export default class AuditLog extends AuditLogSchema {}
