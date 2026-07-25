import {
  Archive,
  Award,
  Ban,
  CalendarClock,
  Check,
  CheckCheck,
  Clock,
  Eye,
  Hourglass,
  LoaderCircle,
  Mail,
  Pencil,
  Play,
  RotateCcw,
  Send,
  TriangleAlert,
  Upload,
  X,
} from 'lucide-react';
import { Badge, type BadgeSize, type BadgeTone, type BadgeVariant } from './badge';
import { cn } from '@/lib/cn';

/**
 * StatusPill — exactly one pill per domain enum value (§9.2, §21).
 *
 * The point of this component is that a status can never be rendered with the
 * wrong colour: the tone and the icon are looked up from a `Record` keyed by the
 * enum, so adding a member to a Prisma enum breaks the build here until it is
 * given an appearance. Every pill pairs a semantic colour with an icon **and**
 * a text label — colour alone is never the signal.
 *
 * The enums are declared as string unions rather than imported from
 * `@prisma/client`: UI never imports Prisma (§5), and a Prisma enum value is
 * structurally assignable to these unions, so `<StatusPill domain="request"
 * status={request.status} …>` type-checks against a real row.
 *
 * Labels are always supplied by the caller — primitives hold no copy (§10.2).
 */

/** Minimal shape a lucide icon satisfies. Keeps this file free of a `LucideIcon` import. */
export type StatusIcon = React.ComponentType<{
  className?: string;
  'aria-hidden'?: boolean | 'true' | 'false';
  strokeWidth?: number;
}>;

export interface StatusAppearance {
  readonly tone: BadgeTone;
  readonly Icon: StatusIcon;
}

/* -------------------------------------------------------------------------- */
/* Domain enums — mirrors of prisma/schema.prisma                              */
/* -------------------------------------------------------------------------- */

export type AccountStatus =
  | 'PENDING_EMAIL'
  | 'PENDING_APPROVAL'
  | 'ACTIVE'
  | 'REJECTED'
  | 'SUSPENDED';

export type RequestStatus =
  | 'AWAITING_RECEIPT'
  | 'UNDER_REVIEW'
  | 'INFO_REQUESTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'CANCELLED';

export type EnrollmentStatus = 'ACTIVE' | 'COMPLETED' | 'EXPIRED' | 'REVOKED';

export type CourseStatus = 'DRAFT' | 'REVIEW' | 'PUBLISHED' | 'SCHEDULED' | 'ARCHIVED';

export type SubmissionStatus = 'SUBMITTED' | 'GRADED' | 'RETURNED';

export type JobStatus = 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED';

/* -------------------------------------------------------------------------- */
/* Tone maps — the single source of truth for status colour                    */
/* -------------------------------------------------------------------------- */

export const accountStatusAppearance: Record<AccountStatus, StatusAppearance> = {
  PENDING_EMAIL: { tone: 'warn', Icon: Mail },
  PENDING_APPROVAL: { tone: 'warn', Icon: Hourglass },
  ACTIVE: { tone: 'success', Icon: Check },
  REJECTED: { tone: 'danger', Icon: X },
  SUSPENDED: { tone: 'danger', Icon: Ban },
};

export const requestStatusAppearance: Record<RequestStatus, StatusAppearance> = {
  AWAITING_RECEIPT: { tone: 'warn', Icon: Upload },
  UNDER_REVIEW: { tone: 'strait', Icon: Eye },
  INFO_REQUESTED: { tone: 'warn', Icon: TriangleAlert },
  APPROVED: { tone: 'success', Icon: Check },
  REJECTED: { tone: 'danger', Icon: X },
  EXPIRED: { tone: 'neutral', Icon: Clock },
  CANCELLED: { tone: 'neutral', Icon: Ban },
};

export const enrollmentStatusAppearance: Record<EnrollmentStatus, StatusAppearance> = {
  ACTIVE: { tone: 'strait', Icon: Play },
  // Completion is an achievement, which is what brass is for (§11.2).
  COMPLETED: { tone: 'brass', Icon: Award },
  EXPIRED: { tone: 'neutral', Icon: Clock },
  REVOKED: { tone: 'danger', Icon: Ban },
};

export const courseStatusAppearance: Record<CourseStatus, StatusAppearance> = {
  DRAFT: { tone: 'neutral', Icon: Pencil },
  REVIEW: { tone: 'warn', Icon: Eye },
  PUBLISHED: { tone: 'success', Icon: Check },
  SCHEDULED: { tone: 'strait', Icon: CalendarClock },
  ARCHIVED: { tone: 'neutral', Icon: Archive },
};

export const submissionStatusAppearance: Record<SubmissionStatus, StatusAppearance> = {
  SUBMITTED: { tone: 'strait', Icon: Send },
  GRADED: { tone: 'success', Icon: CheckCheck },
  RETURNED: { tone: 'warn', Icon: RotateCcw },
};

export const jobStatusAppearance: Record<JobStatus, StatusAppearance> = {
  QUEUED: { tone: 'neutral', Icon: Clock },
  RUNNING: { tone: 'strait', Icon: LoaderCircle },
  DONE: { tone: 'success', Icon: Check },
  FAILED: { tone: 'danger', Icon: TriangleAlert },
};

/* -------------------------------------------------------------------------- */
/* Component                                                                   */
/* -------------------------------------------------------------------------- */

type StatusSelection =
  | { domain: 'account'; status: AccountStatus }
  | { domain: 'request'; status: RequestStatus }
  | { domain: 'enrollment'; status: EnrollmentStatus }
  | { domain: 'course'; status: CourseStatus }
  | { domain: 'submission'; status: SubmissionStatus }
  | { domain: 'job'; status: JobStatus };

export type StatusDomain = StatusSelection['domain'];

export type StatusPillProps = StatusSelection & {
  /** Translated, human-readable name of the status. Required — colour is never alone. */
  label: string;
  size?: BadgeSize;
  variant?: BadgeVariant;
  className?: string;
  /** Optional prefix read only by screen readers, e.g. « Statut : ». */
  srPrefix?: string;
};

/** Resolves a status to its locked-in tone + icon. Exported for tables and legends. */
export function statusAppearance(selection: StatusSelection): StatusAppearance {
  switch (selection.domain) {
    case 'account':
      return accountStatusAppearance[selection.status];
    case 'request':
      return requestStatusAppearance[selection.status];
    case 'enrollment':
      return enrollmentStatusAppearance[selection.status];
    case 'course':
      return courseStatusAppearance[selection.status];
    case 'submission':
      return submissionStatusAppearance[selection.status];
    case 'job':
      return jobStatusAppearance[selection.status];
  }
}

export function StatusPill(props: StatusPillProps): React.JSX.Element {
  const { label, size = 'sm', variant = 'soft', className, srPrefix, domain, status } = props;
  const { tone, Icon } = statusAppearance(props);

  return (
    <Badge
      tone={tone}
      variant={variant}
      size={size}
      className={cn(className)}
      icon={<Icon aria-hidden="true" />}
      data-domain={domain}
      data-status={status}
    >
      {srPrefix === undefined ? null : <span className="sr-only">{`${srPrefix} `}</span>}
      {label}
    </Badge>
  );
}
