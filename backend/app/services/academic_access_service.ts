import type AcademicEvent from '#models/academic_event'
import Enrollment from '#models/enrollment'
import type GradeImport from '#models/grade_import'
import GuardianLink from '#models/guardian_link'
import type GuardianLinkCode from '#models/guardian_link_code'
import TeachingAssignment from '#models/teaching_assignment'
import type User from '#models/user'
import type { ChainableContract } from '@adonisjs/lucid/types/querybuilder'

/** Papéis que o sistema conhece. Qualquer outro valor em users.role é negado. */
export const ROLES = ['admin', 'teacher', 'student', 'guardian'] as const
export type Role = (typeof ROLES)[number]

/** Opções de visibilidade: o responsável escolhe qual aluno vinculado quer ver. */
export type VisibilityOptions = { studentId?: number | null }

/**
 * O aluno que o responsável quer ver, a partir do `studentId` da query:
 * - sem `studentId` e com até um vínculo ativo, vale esse aluno (ou nenhum);
 * - sem `studentId` e com mais de um vínculo ativo, `required` (422);
 * - `studentId` sem vínculo ativo com o responsável, `not_found` (404).
 */
export type GuardianStudentChoice =
  | { ok: true; studentId: number | null }
  | { ok: false; reason: 'required' | 'not_found' }

/**
 * Autorização em um lugar só, sempre como lista de quem pode: cada regra tem um ramo
 * explícito por papel, e o papel que o código não conhece cai no `default`, que nega.
 */
export default class AcademicAccessService {
  /** Lista de quem pode. Use no início de cada ação: `allow(user, ['admin'])`. */
  static allow(user: User, roles: readonly Role[]) {
    return (roles as readonly string[]).includes(user.role)
  }

  static isKnownRole(user: User) {
    return this.allow(user, ROLES)
  }

  static isAdmin(user: User) {
    return user.role === 'admin'
  }

  static isTeacher(user: User) {
    return user.role === 'teacher'
  }

  static isStudent(user: User) {
    return user.role === 'student'
  }

  static isGuardian(user: User) {
    return user.role === 'guardian'
  }

  /** Restringe uma consulta de eventos ao que a pessoa vê: os oficiais e os das turmas dadas. */
  static scopeVisibleEvents(query: ChainableContract, classIds: number[]) {
    query.where((scope) => {
      scope.whereIn('source', ['official', 'imported']).orWhere('officialPriority', true)
      if (classIds.length) {
        scope.orWhereIn('academicClassId', classIds)
      }
    })
  }

  static isOfficial(event: AcademicEvent) {
    return Boolean(event.officialPriority) || ['official', 'imported'].includes(event.source)
  }

  /** Turmas em que a docente tem vínculo em vigor (ended_at nulo), arquivadas ou não. */
  static async teacherClassIds(user: User) {
    const assignments = await TeachingAssignment.query()
      .where('teacherId', user.id)
      .whereNull('endedAt')
      .select('academicClassId')
    return [...new Set(assignments.map((assignment) => assignment.academicClassId))]
  }

  /**
   * Turmas cujos eventos a pessoa vê. `null` quer dizer todas.
   * Turma arquivada continua aqui: os eventos passados ficam no histórico.
   */
  static async visibleClassIdsFor(
    user: User,
    options: VisibilityOptions = {}
  ): Promise<number[] | null> {
    switch (user.role) {
      case 'admin':
        return null
      case 'teacher':
        return this.teacherClassIds(user)
      case 'student': {
        const enrollments = await Enrollment.query()
          .where('userId', user.id)
          .where('status', 'active')
          .select('academicClassId')
        return enrollments.map((enrollment) => enrollment.academicClassId)
      }
      case 'guardian': {
        // A permissão vem sempre de guardian_links com status active, nunca só do papel.
        const linked = await this.guardianStudentIds(user)
        const studentIds =
          options.studentId === undefined || options.studentId === null
            ? linked
            : linked.filter((id) => id === options.studentId)
        return this.activeClassIdsOf(studentIds)
      }
      default:
        return []
    }
  }

  /** Alunos com vínculo ativo com o responsável. Para outros papéis, nenhum. */
  static async guardianStudentIds(user: User) {
    if (user.role !== 'guardian') {
      return []
    }
    const links = await GuardianLink.query()
      .where('guardianId', user.id)
      .where('status', 'active')
      .select('studentId')
    return links.map((link) => link.studentId)
  }

  /** Turmas com matrícula ativa dos alunos (arquivadas também: o histórico continua). */
  static async activeClassIdsOf(studentIds: number[]) {
    if (!studentIds.length) {
      return []
    }
    const enrollments = await Enrollment.query()
      .whereIn('userId', studentIds)
      .where('status', 'active')
      .select('academicClassId')
    return [...new Set(enrollments.map((enrollment) => enrollment.academicClassId))]
  }

  /** Resolve o `studentId` da query para o responsável; ver `GuardianStudentChoice`. */
  static async guardianStudentChoice(user: User, raw: unknown): Promise<GuardianStudentChoice> {
    const linked = await this.guardianStudentIds(user)
    if (raw === undefined || raw === null || raw === '') {
      if (linked.length > 1) {
        return { ok: false, reason: 'required' }
      }
      return { ok: true, studentId: linked[0] ?? null }
    }
    const studentId = Number(raw)
    if (!Number.isInteger(studentId) || !linked.includes(studentId)) {
      return { ok: false, reason: 'not_found' }
    }
    return { ok: true, studentId }
  }

  /**
   * A administração ou a docente com vínculo em vigor na turma (e na disciplina, quando
   * informada) pode criar e editar eventos dela.
   */
  static async teacherCanManage(
    user: User,
    academicClassId?: number | null,
    subjectId?: number | null
  ) {
    switch (user.role) {
      case 'admin':
        return true
      case 'teacher': {
        if (!academicClassId) {
          return false
        }
        const query = TeachingAssignment.query()
          .where('teacherId', user.id)
          .where('academicClassId', academicClassId)
          .whereNull('endedAt')
        if (subjectId) {
          query.where('subjectId', subjectId)
        }
        return !!(await query.first())
      }
      default:
        return false
    }
  }

  /**
   * Quem enxerga a turma nas rotas de gestão: a administração e a docente da turma.
   * Para os outros papéis a rota já devolve 403 antes de chegar aqui.
   */
  static async canAccessClass(user: User, academicClassId: number) {
    switch (user.role) {
      case 'admin':
        return true
      case 'teacher':
        return !!(await TeachingAssignment.query()
          .where('teacherId', user.id)
          .where('academicClassId', academicClassId)
          .whereNull('endedAt')
          .first())
      default:
        return false
    }
  }

  static async canViewEvent(user: User, event: AcademicEvent, options: VisibilityOptions = {}) {
    switch (user.role) {
      case 'admin':
        return true
      case 'teacher': {
        if (this.isOfficial(event) || event.teacherId === user.id) {
          return true
        }
        if (!event.academicClassId) {
          return false
        }
        const classIds = await this.teacherClassIds(user)
        return classIds.includes(event.academicClassId)
      }
      case 'student': {
        if (this.isOfficial(event)) {
          return true
        }
        if (!event.academicClassId) {
          return false
        }
        return !!(await Enrollment.query()
          .where('userId', user.id)
          .where('academicClassId', event.academicClassId)
          .where('status', 'active')
          .first())
      }
      case 'guardian': {
        // Eventos oficiais, e os de turma só das turmas dos alunos com vínculo ativo.
        if (this.isOfficial(event)) {
          return true
        }
        if (!event.academicClassId) {
          return false
        }
        const classIds = await this.visibleClassIdsFor(user, options)
        return (classIds ?? []).includes(event.academicClassId)
      }
      default:
        return false
    }
  }

  /** Editar e excluir: a administração, ou a docente com vínculo em vigor na oferta do evento. */
  static async canManageEvent(user: User, event: AcademicEvent) {
    switch (user.role) {
      case 'admin':
        return true
      case 'teacher':
        if (['official', 'imported'].includes(event.source)) {
          return false
        }
        return this.teacherCanManage(user, event.academicClassId, event.subjectId)
      default:
        return false
    }
  }

  /**
   * Lançar, importar e publicar notas de um evento: a administração, ou a docente com vínculo
   * em vigor na oferta do evento (turma e disciplina). Evento de turma sem disciplina não tem
   * oferta: aí só a docente autora, com vínculo em vigor na turma, e não qualquer docente dela.
   * Ninguém mais.
   */
  static async canManageGrades(user: User, event: AcademicEvent) {
    switch (user.role) {
      case 'admin':
        return true
      case 'teacher':
        if (!event.academicClassId) {
          return false
        }
        if (!event.subjectId) {
          return (
            event.teacherId === user.id &&
            (await this.teacherCanManage(user, event.academicClassId))
          )
        }
        return this.teacherCanManage(user, event.academicClassId, event.subjectId)
      default:
        return false
    }
  }

  /**
   * Quem vê uma importação de notas pelo id: a administração, quem criou e a docente da oferta
   * do evento. Aplicar e desfazer são só de quem criou (com a oferta em vigor) e da
   * administração; isso o controller confere à parte.
   */
  static async canSeeGradeImport(user: User, gradeImport: GradeImport, event: AcademicEvent) {
    switch (user.role) {
      case 'admin':
        return true
      case 'teacher':
        return gradeImport.createdById === user.id || this.canManageGrades(user, event)
      default:
        return false
    }
  }

  /**
   * Quem enxerga um vínculo de responsável pelo id: a administração, o responsável e o aluno
   * do vínculo. Vínculo bloqueado só a administração vê; para os outros é 404, para o
   * bloqueio não aparecer.
   */
  static canSeeGuardianLink(user: User, link: GuardianLink) {
    switch (user.role) {
      case 'admin':
        return true
      case 'guardian':
        return link.guardianId === user.id && link.status !== 'blocked'
      case 'student':
        return link.studentId === user.id && link.status !== 'blocked'
      default:
        return false
    }
  }

  /**
   * Quem cancela um código de responsável: a administração, qualquer um; o aluno, os dele,
   * menos o aluno menor no código que a secretaria gerou.
   */
  static canCancelGuardianCode(user: User, code: GuardianLinkCode) {
    switch (user.role) {
      case 'admin':
        return true
      case 'student':
        return code.studentId === user.id && (!user.isMinor || code.kind !== 'admin')
      default:
        return false
    }
  }

  /**
   * Quem desfaz o vínculo: a administração, o próprio responsável, o aluno adulto e o aluno
   * menor só quando o vínculo nasceu de um código dele (`origin = student_code`).
   */
  static canRemoveGuardianLink(user: User, link: GuardianLink) {
    if (!this.canSeeGuardianLink(user, link)) {
      return false
    }
    switch (user.role) {
      case 'admin':
      case 'guardian':
        return true
      case 'student':
        return !user.isMinor || link.origin === 'student_code'
      default:
        return false
    }
  }
}
