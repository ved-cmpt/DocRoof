/** Display helpers shared by templates. Values come from the API as enum names. */

const LABELS: Record<string, string> = {
  FireProtection: 'Fire Protection',
  Mechanical: 'Mechanical / HVAC',
  ProductData: 'Product Data',
  InReview: 'In review',
  NotReviewed: 'Not reviewed',
  ApprovedWithComments: 'Approved with comments',
  ReviseAndResubmit: 'Revise & resubmit',
  DocumentController: 'Document Controller',
  ProjectManager: 'Project Manager',
  ApproveAnswer: 'Approve answer',
  RejectAnswer: 'Reject answer',
  StartReview: 'Start review',
  DocumentRevision: 'Revision',
  RfiResponse: 'RFI response',
  ReviewDecision: 'Review decision',
  ExtractionSuggestion: 'Extraction suggestion',
  SpecSection: 'Spec section',
  DocumentNumber: 'Document number',
  Rfi: 'RFI',
};

export function label(value: string | null | undefined): string {
  if (!value) {
    return '';
  }
  return LABELS[value] ?? value.replace(/([a-z])([A-Z])/g, '$1 $2');
}

export type Tone = 'neutral' | 'info' | 'warning' | 'success' | 'danger';

/**
 * Status colour used by chips. Colour carries meaning only: waiting = info, needs action = warning,
 * done = success, refused = danger, everything else neutral.
 */
export function tone(value: string | null | undefined): Tone {
  switch (value) {
    case 'Approved':
    case 'ApprovedWithComments':
    case 'Final':
    case 'Closed':
    case 'Issued':
    case 'Accepted':
      return 'success';
    case 'Submitted':
    case 'Assigned':
    case 'Answered':
    case 'InReview':
    case 'Pending':
      return 'info';
    case 'ReviseAndResubmit':
    case 'Reopened':
      return 'warning';
    case 'Rejected':
    case 'Overdue':
      return 'danger';
    default:
      return 'neutral';
  }
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function auditLabel(action: string): string {
  const [, verb] = action.split('.');
  return (verb ?? action).replace(/-/g, ' ');
}
