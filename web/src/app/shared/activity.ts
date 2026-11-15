import { AuditEvent } from '../core/api.models';
import { auditLabel, label } from '../core/labels';
import { IconName } from './icons.generated';
import { shortDate } from './ui';

/** A human-readable rendering of one audit event: "<actor> <verb> <object> · <meta>", plus an optional quote. */
export interface EventText {
  verb: string;
  object?: string;
  meta?: string;
  quote?: string;
  icon: IconName;
}

type Bag = Record<string, unknown>;

function parse(e: AuditEvent): { before: Bag; after: Bag } {
  try {
    const p = JSON.parse(e.changeJson || '{}') as { before?: Bag; after?: Bag };
    return { before: p.before ?? {}, after: p.after ?? {} };
  } catch {
    return { before: {}, after: {} };
  }
}

const str = (v: unknown): string | undefined =>
  v === null || v === undefined || v === '' ? undefined : String(v);

const join = (...parts: (string | undefined)[]): string | undefined => {
  const kept = parts.filter((p): p is string => !!p);
  return kept.length ? kept.join(' · ') : undefined;
};

const due = (v: unknown): string | undefined => {
  const s = str(v);
  return s ? `due ${shortDate(s)}` : undefined;
};

const cycle = (v: unknown): string | undefined => (str(v) ? `cycle ${str(v)}` : undefined);

/** Maps the audit vocabulary to short sentences, never raw field dumps. */
export function describeEvent(e: AuditEvent): EventText {
  const { before, after } = parse(e);
  switch (e.action) {
    case 'project.created':
      return { verb: 'created the project', object: str(after['code']), icon: 'building' };
    case 'document.created':
      return {
        verb: 'created',
        object: str(after['documentNumber']) ?? e.reference ?? undefined,
        icon: 'file-text',
      };
    case 'document.metadata-updated': {
      const field = Object.keys(after).find((k) => k !== 'source' && k !== 'Source');
      return {
        verb: 'updated',
        object: field
          ? label(field.charAt(0).toUpperCase() + field.slice(1)).toLowerCase()
          : 'metadata',
        meta: field ? `now “${str(after[field]) ?? '—'}”` : undefined,
        icon: 'square-pen',
      };
    }
    case 'revision.uploaded':
      return {
        verb: 'uploaded',
        object: str(after['versionLabel']),
        meta: str(after['fileName']),
        icon: 'upload',
      };
    case 'revision.superseded':
      return {
        verb: 'uploaded',
        object: str(after['versionLabel']),
        meta: str(before['versionLabel']) ? `supersedes ${str(before['versionLabel'])}` : undefined,
        icon: 'layers',
      };
    case 'revision.approval-status':
      return {
        verb: 'set review status to',
        object: label(str(after['approvalStatus'])),
        meta: e.reference ?? undefined,
        icon: 'clipboard-check',
      };
    case 'rfi.created':
      return {
        verb: 'created',
        object: str(after['referenceNumber']) ?? e.reference ?? undefined,
        meta: join(
          str(after['revision']),
          str(after['sourcePage']) ? `page ${str(after['sourcePage'])}` : undefined,
        ),
        icon: 'message-square-text',
      };
    case 'rfi.submitted':
      return { verb: 'submitted the RFI', icon: 'send' };
    case 'rfi.assigned':
      return {
        verb: 'assigned',
        object: str(after['assignee']),
        meta: due(after['dueAt']),
        icon: 'user-check',
      };
    case 'rfi.answered':
      return { verb: 'posted an answer', icon: 'message-square' };
    case 'rfi.answer-approved':
      return { verb: 'approved the answer', icon: 'circle-check' };
    case 'rfi.answer-rejected':
      return { verb: 'returned the answer', quote: str(after['reason']), icon: 'rotate-ccw' };
    case 'rfi.closed':
      return { verb: 'closed the RFI', icon: 'check' };
    case 'rfi.reopened':
      return { verb: 'reopened the RFI', quote: str(after['reason']), icon: 'rotate-ccw' };
    case 'submittal.submitted':
      return {
        verb: 'submitted',
        object: str(after['number']) ?? e.reference ?? undefined,
        meta: str(after['reviewer']) ? `for review by ${str(after['reviewer'])}` : undefined,
        icon: 'send',
      };
    case 'submittal.review-started':
      return { verb: 'started the review', meta: cycle(after['cycle']), icon: 'eye' };
    case 'submittal.decided':
      return {
        verb: 'decided',
        object: label(str(after['status'])),
        meta: cycle(after['cycle']),
        quote: str(after['comments']),
        icon: 'clipboard-check',
      };
    case 'submittal.resubmitted':
      return {
        verb: 'resubmitted',
        object: str(after['revision']) ?? str(after['versionLabel']),
        meta: join(cycle(after['cycle']), due(after['dueAt'])),
        icon: 'refresh-cw',
      };
    case 'submittal.finalized':
      return { verb: 'finalized the submittal', icon: 'file-check' };
    case 'submittal.reassigned':
      return {
        verb: 'reassigned the review to',
        object: str(after['reviewer']),
        icon: 'user-check',
      };
    case 'extraction.run':
    case 'extraction.llm-run':
      return {
        verb: 'ran metadata extraction',
        meta: str(after['suggestions']) ? `${str(after['suggestions'])} suggestions` : undefined,
        icon: 'scan-text',
      };
    case 'extraction.accepted':
      return {
        verb: 'accepted',
        object: `${label(str(after['field'])).toLowerCase() || 'a'} suggestion`,
        meta: join(
          str(after['proposedValue']),
          str(after['page']) ? `page ${str(after['page'])}` : undefined,
        ),
        icon: 'circle-check',
      };
    case 'extraction.rejected':
      return {
        verb: 'rejected',
        object: `${label(str(after['field'])).toLowerCase() || 'a'} suggestion`,
        meta: str(after['proposedValue']),
        icon: 'x',
      };
    case 'comment.added':
      return {
        verb: 'commented',
        meta: str(after['page']) ? `page ${str(after['page'])}` : undefined,
        icon: 'message-square',
      };
    default:
      return { verb: auditLabel(e.action), icon: 'activity' };
  }
}

/** One-line sentence without the actor, e.g. "assigned Marcus Lindqvist · due Nov 12". */
export function eventSentence(e: AuditEvent): string {
  const t = describeEvent(e);
  const head = t.object ? `${t.verb} ${t.object}` : t.verb;
  return t.meta ? `${head} · ${t.meta}` : head;
}
