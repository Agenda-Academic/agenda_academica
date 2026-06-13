export type UserRole = "student" | "teacher" | "admin";

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
  registration: string | null;
  defaultReminderMinutes: number;
  notificationChannel: "email" | "push";
  /** Presente nas respostas de conta (transformer); ausente em relações como event.teacher. */
  initials?: string;
};

export type Course = {
  id: number;
  code: string;
  name: string;
  campus: string;
};

export type AcademicClass = {
  id: number;
  name: string;
  period: string;
  year: number;
  semester: number;
  shift: string;
  course?: Course;
};

export type Subject = {
  id: number;
  code: string;
  name: string;
  workloadHours: number;
};

export type AcademicEvent = {
  id: number;
  title: string;
  description: string | null;
  category: Category;
  source: EventSource;
  status: "scheduled" | "changed" | "cancelled" | "completed";
  startsAt: string;
  endsAt: string | null;
  points: number | null;
  location: string | null;
  color: string | null;
  academicClassId: number | null;
  subjectId: number | null;
  teacherId: number | null;
  officialPriority: boolean;
  academicClass?: AcademicClass | null;
  subject?: Subject | null;
  teacher?: User | null;
  reminder?: Reminder | null;
};

export type Reminder = {
  id: number;
  userId: number;
  academicEventId: number;
  channel: "email" | "push";
  offsetMinutes: number;
  sendAt: string;
  sentAt: string | null;
  enabled: boolean;
  academicEvent?: AcademicEvent;
};

export type TeachingAssignment = {
  id: number;
  teacherId: number;
  academicClassId: number;
  subjectId: number;
  academicClass?: AcademicClass;
  subject?: Subject;
};

export type Enrollment = {
  id: number;
  userId: number;
  academicClassId: number;
  status: string;
  academicClass?: AcademicClass;
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
  enrollments: Enrollment[];
  teachingAssignments: TeachingAssignment[];
  catalog: {
    courses: Course[];
    classes: AcademicClass[];
    subjects: Subject[];
  };
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
