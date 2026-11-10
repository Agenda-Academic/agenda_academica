/* ------------------------------------------------------------------ */
/* Pessoas e papéis                                                    */
/* ------------------------------------------------------------------ */

/** Papéis que o sistema conhece. Qualquer outro valor é negado pela API (e descartado pelo front). */
export type UserRole = "student" | "teacher" | "admin" | "guardian";

export type Category =
  | "exam"
  | "assignment"
  | "activity"
  | "extracurricular"
  | "institutional"
  | "holiday"
  | "recess";

export type EventSource = "teacher" | "official" | "imported";

export type User = {
  id: number;
  fullName: string | null;
  email: string;
  role: UserRole;
  /** O responsável não tem matrícula (sempre null). */
  registration: string | null;
  defaultReminderMinutes: number;
  notificationChannel: "email";
  /** Presente nas respostas de conta (transformer); ausente em relações como event.teacher. */
  initials?: string;
  /** Aluno menor de idade (curso integrado ou marcado pela secretaria). Vem no login, cadastro, perfil e /context. */
  isMinor?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

/** Pessoa na busca da administração (GET /users): só id, nome, e-mail e papel. */
export type UserSummary = {
  id: number;
  fullName: string | null;
  email: string;
  role: UserRole;
};

/* ------------------------------------------------------------------ */
/* Cursos, turmas e disciplinas                                        */
/* ------------------------------------------------------------------ */

/** "superior" (semestral) ou "integrado" (turma anual, semester = 0). */
export type CourseModality = "superior" | "integrado";

/** Turno da turma. */
export type ClassShift = "matutino" | "vespertino" | "noturno" | "integral";

export type CourseCounts = {
  classes: number;
  activeClasses: number;
};

export type Course = {
  id: number;
  code: string;
  name: string;
  campus?: string;
  modality?: CourseModality;
  archivedAt?: string | null;
  /** true/false nas rotas novas; 1/0 em /context e /events. */
  active?: boolean | number;
  /** Só em GET/POST/PUT /courses. */
  counts?: CourseCounts;
};

export type AcademicClass = {
  id: number;
  name: string;
  period: string;
  year: number;
  /** 1 ou 2 no curso superior; 0 na turma anual do curso integrado (mostre "2026" ou "2026, anual", nunca "2026/0"). */
  semester: number;
  shift: string;
  courseId?: number;
  archivedAt?: string | null;
  active?: boolean | number;
  course?: Course;
};

export type Subject = {
  id: number;
  code: string;
  name: string;
  workloadHours?: number;
  archivedAt?: string | null;
  active?: boolean | number;
  /** Só para a administração em /subjects: turmas não arquivadas com oferta da disciplina ("usada em N turmas"). */
  usedIn?: number;
};

/** POST e PUT /subjects devolvem a disciplina e os avisos (nome repetido não bloqueia). */
export type SubjectSaveResult = {
  data: Subject;
  warnings: string[];
};

/** Contagens de cada turma (lista e painel). */
export type ClassCounts = {
  activeStudents: number;
  pendingStudents: number;
  /** Ofertas não arquivadas. */
  subjects: number;
  /** A pendência "disciplina sem docente". */
  subjectsWithoutTeacher: number;
  pendingInvites: number;
};

/** Turma na lista (GET /classes): sem o código da turma. */
export type ClassSummary = AcademicClass & {
  courseId: number;
  archivedAt: string | null;
  active: boolean;
  course: Course;
  counts: ClassCounts;
};

export type TeachingRole = "titular" | "substituto";

/** Docente de uma oferta no painel da turma. */
export type OfferTeacher = {
  assignmentId: number;
  teacherId: number;
  fullName: string;
  role: TeachingRole;
};

/** Disciplina ofertada na turma, com as docentes em vigor. */
export type ClassOffer = {
  id: number;
  subjectId: number;
  academicClassId?: number;
  archivedAt: string | null;
  subject: Pick<Subject, "id" | "code" | "name">;
  teachers: OfferTeacher[];
  withoutTeacher: boolean;
  /** POST /classes/:id/subjects: a oferta arquivada voltou. */
  restored?: boolean;
};

/** Painel completo da turma (GET /classes/:id, POST /classes e o arquivar). */
export type ClassDetail = ClassSummary & {
  futureEvents: number;
  /** Só para a administração e a docente da turma. Mostre joinCodeFormatted. */
  joinCode: string | null;
  joinCodeFormatted: string | null;
  joinCodeActive: boolean;
  offers: ClassOffer[];
};

/** POST e DELETE /classes/:id/join-code. */
export type JoinCodeResult = {
  academicClassId: number;
  joinCode: string | null;
  joinCodeFormatted: string | null;
  joinCodeActive: boolean;
};

/** POST /classes/:id/subjects/:subjectId/archive. */
export type OfferArchiveResult = {
  id: number;
  academicClassId: number;
  subjectId: number;
  archivedAt: string | null;
  endedAssignments: number;
};

/** Vínculo de docente (teaching_assignments). */
export type TeachingAssignment = {
  id: number;
  teacherId: number;
  academicClassId: number;
  subjectId: number;
  role?: TeachingRole;
  /** Preenchido quando o vínculo foi encerrado (a linha não é apagada). */
  endedAt?: string | null;
  academicClass?: AcademicClass;
  subject?: Subject;
  teacher?: { id: number; fullName: string | null };
};

/* ------------------------------------------------------------------ */
/* Matrículas, alunos da turma e convites                              */
/* ------------------------------------------------------------------ */

export type EnrollmentStatus = "pending" | "active" | "inactive" | "completed";
export type EnrollmentSource = "admin" | "list" | "code" | "invite";

export type Enrollment = {
  id: number;
  userId: number;
  academicClassId: number;
  status: EnrollmentStatus | string;
  source?: EnrollmentSource;
  decidedById?: number | null;
  decidedAt?: string | null;
  /** Quando a matrícula (ou o pedido de entrada) foi criada. */
  createdAt?: string | null;
  academicClass?: AcademicClass;
};

/** Aluno na lista da turma (GET /classes/:id/students e PATCH /enrollments/:id). */
export type ClassStudent = {
  enrollmentId: number;
  userId: number;
  academicClassId: number;
  fullName: string | null;
  email: string;
  status: EnrollmentStatus;
  source: EnrollmentSource;
  createdAt: string;
  decidedAt: string | null;
  /** Só para a administração: a matrícula escolar gravada na turma (a que casa as notas). */
  registration?: string | null;
  /** Só para a administração. */
  isMinor?: boolean;
};

export type AddStudentsRejectReason = "invalid_email" | "not_student" | "already_enrolled" | "already_invited";

/** POST /classes/:id/students. */
export type AddStudentsResult = {
  added: number;
  invited: number;
  rejected: Array<{ email: string; reason: AddStudentsRejectReason; message: string }>;
};

/** POST /classes/:id/students/decide. */
export type DecideStudentsResult = {
  updated: number;
  status: "active" | "inactive";
  /** Matrículas que não estavam pendentes (não mudaram). */
  skipped: number[];
};

/** Convite da turma (e-mail sem conta ainda). */
export type ClassInvite = {
  id: number;
  academicClassId: number;
  email: string;
  registration: string | null;
  createdAt: string;
  acceptedAt: string | null;
};

/** POST /enrollments/join (aluno entra com o código da turma). */
export type JoinClassResult = {
  enrollment: { id: number; academicClassId: number; status: EnrollmentStatus; source: EnrollmentSource };
  academicClass: AcademicClass;
  alreadyEnrolled: boolean;
  /** "Você entrou em TADS 5." ou "Pedido enviado para TADS 5. A docente ou a secretaria confirma." */
  message: string;
};

/* ------------------------------------------------------------------ */
/* Responsável: vínculos, códigos e alunos acompanhados                */
/* ------------------------------------------------------------------ */

export type GuardianRelationship = "mae" | "pai" | "responsavel_legal" | "outro";
export type GuardianLinkStatus = "pending" | "active" | "revoked" | "blocked";
export type GuardianLinkOrigin = "student_code" | "admin_code" | "admin";
export type GuardianCodeKind = "student" | "admin";

/** Aluno que o responsável acompanha (GET /context, campo linkedStudents; ativos primeiro). */
export type LinkedStudent = {
  /** Id do aluno: o que vai em ?studentId= e em ?aluno= no endereço. */
  id: number;
  /** Id do vínculo: o "Deixar de acompanhar" usa este. */
  linkId: number;
  fullName: string | null;
  initials: string;
  relationship: GuardianRelationship;
  /** Só "active" e "pending" aparecem aqui. */
  status: GuardianLinkStatus;
  /** Data de aprovação ou, sem ela, de criação. */
  since: string;
  /** Valor efetivo: aluno menor, sempre true; adulto, só se ele compartilha. Pendente: false. */
  shareGrades: boolean;
  /** Turmas ativas do aluno (vazio no vínculo pendente). */
  classes: AcademicClass[];
};

/** Vínculo visto pelo aluno (GET /me/guardians e PATCH /me/guardians/:id). O e-mail do responsável não vem. */
export type GuardianLink = {
  /** Id do vínculo. */
  id: number;
  guardianId: number;
  studentId: number;
  fullName: string | null;
  initials: string;
  relationship: GuardianRelationship;
  status: GuardianLinkStatus;
  origin: GuardianLinkOrigin;
  shareGrades: boolean;
  /** O aluno deixou de ser menor: confirme ou encerre o vínculo. */
  needsReview: boolean;
  since: string;
  createdAt: string;
  /** Botão "Remover". */
  canRemove: boolean;
  /** Chave "Compartilhar minhas notas" (só aluno adulto). */
  canShareGrades: boolean;
};

/** Vínculo visto pela administração (GET /students/:id/guardians, GET /guardian-links, POST /students/:id/guardians). */
export type AdminGuardianLink = Omit<GuardianLink, "canRemove" | "canShareGrades"> & {
  email: string;
  createdById: number | null;
  approvedById: number | null;
  approvedAt: string | null;
  revokedById: number | null;
  revokedAt: string | null;
  revokeReason: string | null;
  /** Só em GET /guardian-links (card "Pendências"). */
  student?: { id: number; fullName: string | null; email: string; isMinor: boolean };
};

/** Código válido, só com o prazo (o código em claro nunca volta depois de criado). */
export type GuardianCodeInfo = {
  id: number;
  kind: GuardianCodeKind;
  expiresAt: string;
  createdAt: string;
  /** Botão "Cancelar" (false só para o aluno menor no código da secretaria). Só na visão do aluno. */
  canCancel?: boolean;
};

/** Código recém-criado (POST /me/guardian-codes e POST /students/:id/guardian-codes): aparece uma vez só. */
export type GuardianCodeCreated = {
  id: number;
  studentId: number;
  kind: GuardianCodeKind;
  code: string;
  /** "TZ1H-FBE6": é o que se mostra. */
  codeFormatted: string;
  expiresAt: string;
  createdAt: string;
  /** Aluno menor: o vínculo nasce pendente até a secretaria aprovar. */
  linkWillBePending: boolean;
  message: string;
};

export type GuardianLimits = { maxLinks: number; maxCodes: number };

/** GET /me/guardians. */
export type MyGuardians = {
  isMinor: boolean;
  limits: GuardianLimits;
  guardians: GuardianLink[];
  codes: GuardianCodeInfo[];
};

/** GET /students/:id/guardians (administração). */
export type StudentGuardians = {
  student: { id: number; fullName: string | null; email: string; isMinor: boolean };
  limits: GuardianLimits;
  guardians: AdminGuardianLink[];
  codes: GuardianCodeInfo[];
};

/** Resumo do vínculo depois de desfazer, restaurar, aprovar ou bloquear. */
export type GuardianLinkSummary = {
  id: number;
  guardianId: number;
  studentId: number;
  relationship: GuardianRelationship;
  status: GuardianLinkStatus;
  origin: GuardianLinkOrigin;
  approvedAt: string | null;
  revokedAt: string | null;
  /** Até quando o Desfazer vale (10 minutos depois de desfazer). */
  undoUntil: string | null;
  message: string;
};

/** POST /guardian-links/claim (responsável usa o código). */
export type ClaimLinkResult = {
  link: { id: number; studentId: number; relationship: GuardianRelationship; status: GuardianLinkStatus; origin: GuardianLinkOrigin };
  student: { id: number; fullName: string | null; initials: string };
  alreadyLinked: boolean;
  /** "Agora você acompanha Diogo." ou "Pedido enviado. A secretaria confirma e você recebe um aviso aqui." */
  message: string;
};

/** PATCH /users/:id (administração marca ou desmarca menor de idade). */
export type MinorUpdateResult = {
  id: number;
  fullName: string | null;
  email: string;
  role: UserRole;
  isMinor: boolean;
  /** Vínculos que o aluno precisa confirmar (deixou de ser menor). */
  linksToReview: number;
  /** Vínculos que voltaram a pendente (passou a ser menor). */
  linksToApprove: number;
};

/* ------------------------------------------------------------------ */
/* Avisos do sistema                                                   */
/* ------------------------------------------------------------------ */

export type NotificationKind =
  | "guardian_linked"
  | "guardian_unlinked"
  | "guardian_pending"
  | "guardian_review"
  | "grades_published";

/** Aviso do sistema (GET /notifications). Diferente do aviso de lembrete, que é calculado no front. */
export type AppNotification = {
  id: number;
  kind: NotificationKind | string;
  title: string;
  body: string | null;
  /** Endereço da tela no front: "?tela=perfil", "?tela=painel", "?tela=turmas", "?tela=notas&evento=1", "?tela=notas&aluno=4&evento=1". */
  link: string | null;
  readAt: string | null;
  createdAt: string;
};

/** GET /notifications. */
export type NotificationList = {
  notifications: AppNotification[];
  /** O número do item do menu. */
  unreadCount: number;
};

/* ------------------------------------------------------------------ */
/* Eventos, lembretes e painel                                         */
/* ------------------------------------------------------------------ */

export type EventStatus = "scheduled" | "changed" | "cancelled" | "completed";

export type AcademicEvent = {
  id: number;
  title: string;
  description: string | null;
  category: Category;
  source: EventSource;
  status: EventStatus;
  startsAt: string;
  endsAt: string | null;
  /** Valor da avaliação (o máximo da nota em prova e trabalho). */
  points: number | null;
  location: string | null;
  color: string | null;
  academicClassId: number | null;
  subjectId: number | null;
  teacherId: number | null;
  /** Quem publicou (docente ou administração); a API manda em todo evento. */
  createdById?: number | null;
  officialPriority: boolean;
  /** Importação que trouxe o evento (só datas importadas do calendário oficial). */
  calendarImportId?: number | null;
  /** Código do evento na fonte importada, quando a fonte informa. */
  sourceExternalId?: string | null;
  /** Fase 3: quando as notas desta avaliação foram publicadas (null: ocultas ou sem nota). */
  gradesPublishedAt?: string | null;
  academicClass?: AcademicClass | null;
  subject?: Subject | null;
  /** Só { id, fullName }. */
  teacher?: Pick<User, "id" | "fullName"> | null;
  reminder?: Reminder | null;
};

export type Reminder = {
  id: number;
  userId: number;
  academicEventId: number;
  channel: "email";
  offsetMinutes: number;
  sendAt: string;
  sentAt: string | null;
  enabled: boolean;
  academicEvent?: AcademicEvent;
};

export type Dashboard = {
  important: AcademicEvent[];
  upcoming: AcademicEvent[];
  reminders: Reminder[];
  metrics: {
    upcomingCount: number;
    remindersCount: number;
    categories: Record<string, number>;
  };
};

export type AcademicContext = {
  user: User;
  /** Só matrículas ativas em turma não arquivada (o painel do aluno lê enrollments[0]). */
  enrollments: Enrollment[];
  /** Pedidos de entrada do aluno ainda sem decisão. */
  pendingEnrollments?: Enrollment[];
  /** Só vínculos em vigor (endedAt nulo) em turma não arquivada. */
  teachingAssignments: TeachingAssignment[];
  catalog: {
    courses: Course[];
    classes: AcademicClass[];
    subjects: Subject[];
  };
  /** Só para o responsável: vínculos ativos e pendentes, ativos primeiro. */
  linkedStudents?: LinkedStudent[];
};

export type Session = {
  token: string;
  user: User;
};

export type CalendarImport = {
  id: number;
  sourceName: string;
  sourceUrl: string | null;
  importedById: number | null;
  importedAt: string;
  status: string;
  totalEvents: number;
  checksum: string | null;
};

/* ------------------------------------------------------------------ */
/* Notas (fase 3)                                                      */
/* ------------------------------------------------------------------ */

/** Situação da nota: com nota, falta ou dispensa (falta e dispensa não têm score). */
export type GradeStatus = "graded" | "absent" | "excused";

/** Origem do arquivo de notas. */
export type GradeImportSource = "modelo" | "suap" | "moodle" | "classroom";

/** De onde veio o valor da nota: digitado na Agenda ou de uma importação. */
export type GradeSourceInfo =
  | { type: "manual" }
  | {
      type: "import";
      source: GradeImportSource;
      importedAt: string;
      /** Só na visão da docente e da administração. */
      importId?: number;
      fileName?: string;
    };

/** Nota de um aluno numa avaliação. score em centésimos (750 é 7,5); scoreText já vem pronto ("7,5"). */
export type Grade = {
  id?: number;
  score: number | null;
  scoreText: string | null;
  status: GradeStatus;
  updatedAt: string;
  source: GradeSourceInfo;
};

/** Avaliação na lista de notas da docente (GET /events/:id/grades, campo event). */
export type GradeEventInfo = {
  id: number;
  title: string;
  category: Category;
  status: EventStatus;
  startsAt: string;
  points: number | null;
  /** Valor máximo em centésimos (points * 100). */
  maxScore: number | null;
  maxScoreText: string | null;
  academicClassId: number | null;
  subjectId: number | null;
  gradesPublishedAt: string | null;
  academicClass: { id: number; name: string } | null;
  subject: { id: number; code: string; name: string } | null;
};

export type EventGradeCounts = {
  /** Alunos ativos na turma. */
  students: number;
  graded: number;
  absent: number;
  excused: number;
  /** Ativos sem nota. */
  missing: number;
};

/** Linha de um aluno na lista de notas da avaliação (e resposta do PUT da nota). */
export type EventGradeRow = {
  studentId: number;
  fullName: string | null;
  email: string;
  enrollmentStatus: EnrollmentStatus;
  grade: Grade | null;
  /** Só para a administração. */
  registration?: string | null;
};

/** GET /events/:id/grades. */
export type EventGrades = {
  event: GradeEventInfo;
  counts: EventGradeCounts;
  students: EventGradeRow[];
};

/** PUT /events/:id/grades/:studentId: score em centésimos (null apaga), ou status falta/dispensa sem score. */
export type GradeInput = { score?: number | null; status?: GradeStatus };

/** POST /events/:id/grades/publish. */
export type PublishGradesResult = {
  eventId: number;
  gradesPublishedAt: string | null;
  alreadyPublished: boolean;
  notified: { students: number; guardians: number };
};

/** DELETE /events/:id/grades/publish. */
export type UnpublishGradesResult = {
  eventId: number;
  gradesPublishedAt: null;
  removedNotices: number;
};

export type GradeImportStatus = "draft" | "applied" | "discarded" | "undone";

export type GradeImportRowKind =
  | "new"
  | "changed"
  | "same"
  | "no_match"
  | "not_enrolled"
  | "invalid"
  | "duplicate"
  | "newer_in_agenda";

/** Colunas do arquivo escolhidas pela docente. */
export type GradeImportMapping = {
  identifierType: "email" | "registration";
  identifierColumn: string;
  scoreColumn: string;
  nameColumn?: string | null;
};

export type GradeImportTotals = {
  new: number;
  changed: number;
  same: number;
  newerInAgenda: number;
  /** Soma de no_match, not_enrolled, invalid e duplicate. */
  rejected: number;
};

/** Linha da prévia (só no rascunho; com problema primeiro). */
export type GradeImportRow = {
  id: number;
  rowNumber: number | null;
  kind: GradeImportRowKind;
  message: string | null;
  /** Normalizado (minúsculo, sem espaços; matrícula sem zeros à esquerda). */
  identifier: string | null;
  /** O nome que veio no arquivo, só para conferir. */
  nameHint: string | null;
  rawScore: string | null;
  student: { id: number; fullName: string | null } | null;
  score: number | null;
  scoreText: string | null;
  previousScore: number | null;
  previousScoreText: string | null;
  previousStatus: GradeStatus | null;
};

/** Importação de notas (resumo; o rascunho traz também breakdown e rows). */
export type GradeImport = {
  id: number;
  academicEventId: number;
  source: GradeImportSource;
  fileName: string;
  checksum: string;
  mapping: GradeImportMapping;
  fileModifiedAt: string | null;
  status: GradeImportStatus;
  totals: GradeImportTotals;
  createdAt: string;
  appliedAt: string | null;
  undoneAt: string | null;
  createdBy: { id: number; fullName: string | null } | null;
  canApply: boolean;
  canDiscard: boolean;
  /** Já confere se alguma nota foi editada depois ("Desfazer importação"). */
  canUndo: boolean;
  /** Só no rascunho: contagem de cada kind. */
  breakdown?: Record<GradeImportRowKind, number>;
  /** Só no rascunho. */
  rows?: GradeImportRow[];
};

/** Linha enviada no POST /grade-imports (o front lê o arquivo; identifier e score aceitam texto ou número). */
export type GradeImportRowInput = {
  rowNumber?: number;
  identifier: string | number | null;
  name?: string | null;
  score: string | number | null;
};

export type GradeImportInput = {
  academicEventId: number;
  source: GradeImportSource;
  fileName: string;
  checksum: string;
  /** ISO, o lastModified do arquivo. */
  fileModifiedAt?: string | null;
  /** Só quando o evento ainda não tem valor (0,01 a 999,99). */
  points?: number;
  mapping: GradeImportMapping;
  rows: GradeImportRowInput[];
};

/** POST /grade-imports/:id/apply: o resumo com o que foi aplicado. */
export type GradeImportApplied = GradeImport & {
  applied: { created: number; updated: number; keptAgenda: number; unchanged: number; skipped: number };
};

/** DELETE /grade-imports/:id de uma importação aplicada (desfazer). */
export type GradeImportUndone = GradeImport & {
  undone?: { restored: number; removed: number };
};

/** Avaliação na visão do aluno e do responsável. */
export type StudentEvaluation = {
  eventId: number;
  title: string;
  category: Category;
  status: EventStatus;
  startsAt: string;
  maxScore: number | null;
  maxScoreText: string | null;
  /** false: "Aguardando publicação" (grade sempre null). */
  published: boolean;
  publishedAt: string | null;
  /** null com published true: avaliação publicada sem nota para este aluno. */
  grade: Grade | null;
};

/** Grupo por turma e disciplina (ordenado pelo nome da disciplina). */
export type StudentGradeGroup = {
  academicClass: { id: number; name: string; period: string; year: number; semester: number };
  subject: { id: number; code: string; name: string } | null;
  evaluations: StudentEvaluation[];
};

/**
 * GET /me/grades e GET /students/:id/grades. Responsável de aluno adulto que não compartilha:
 * shareGrades false, counts null e subjects vazio ("Diogo não compartilha as notas").
 */
export type StudentGrades = {
  student: { id: number; fullName: string | null; initials: string };
  shareGrades: boolean;
  counts: { published: number; awaiting: number } | null;
  subjects: StudentGradeGroup[];
};

/* ------------------------------------------------------------------ */
/* Erros da API                                                        */
/* ------------------------------------------------------------------ */

/** Códigos de 409 (conflito) e 429 (muitas tentativas) que a API manda no corpo. */
export type ApiConflictCode =
  | "ARCHIVED_DUPLICATE"
  | "HAS_DEPENDENTS"
  | "ARCHIVED"
  | "COURSE_ARCHIVED"
  | "OFFER_ARCHIVED"
  | "ENDED"
  | "ALREADY_ACCEPTED"
  | "LINK_LIMIT"
  | "CODE_LIMIT"
  | "CODE_USED"
  | "BLOCKED"
  | "NOT_PENDING"
  | "UNDO_EXPIRED"
  | "NOT_GRADABLE"
  | "NO_GRADES"
  | "NOT_DRAFT"
  | "EDITED_AFTER_IMPORT"
  | "HAS_GRADES"
  | "TOO_MANY_ATTEMPTS";
