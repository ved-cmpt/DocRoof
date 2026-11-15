export type ProjectRole = 'DocumentController' | 'ProjectManager' | 'Reviewer' | 'Requester';
export type DocumentStatus = 'Draft' | 'InReview' | 'Issued' | 'Archived';
export type Discipline =
  | 'General'
  | 'Architectural'
  | 'Structural'
  | 'Mechanical'
  | 'Electrical'
  | 'Plumbing'
  | 'FireProtection'
  | 'Civil';
export type DocumentCategory =
  'Specification' | 'Drawing' | 'Report' | 'ProductData' | 'Schedule' | 'Correspondence' | 'Manual';
export type RevisionApprovalStatus =
  'NotReviewed' | 'Pending' | 'Approved' | 'ApprovedWithComments' | 'ReviseAndResubmit';
export type RfiState = 'Draft' | 'Submitted' | 'Assigned' | 'Answered' | 'Closed' | 'Reopened';
export type RfiAction =
  'Submit' | 'Assign' | 'Answer' | 'ApproveAnswer' | 'RejectAnswer' | 'Close' | 'Reopen';
export type SubmittalStatus =
  'Submitted' | 'InReview' | 'Approved' | 'ApprovedWithComments' | 'ReviseAndResubmit' | 'Final';
export type SubmittalAction = 'StartReview' | 'Decide' | 'Finalize' | 'Resubmit' | 'Reassign';
export type ReviewDecisionType = 'Approved' | 'ApprovedWithComments' | 'ReviseAndResubmit';
export type ResourceType =
  | 'Tenant'
  | 'Project'
  | 'Membership'
  | 'Document'
  | 'DocumentRevision'
  | 'Rfi'
  | 'RfiResponse'
  | 'Submittal'
  | 'ReviewDecision'
  | 'ExtractionSuggestion'
  | 'Comment'
  | 'Notification';

export const DISCIPLINES: Discipline[] = [
  'General',
  'Architectural',
  'Structural',
  'Mechanical',
  'Electrical',
  'Plumbing',
  'FireProtection',
  'Civil',
];
export const CATEGORIES: DocumentCategory[] = [
  'Specification',
  'Drawing',
  'Report',
  'ProductData',
  'Schedule',
  'Correspondence',
  'Manual',
];
export const DOCUMENT_STATUSES: DocumentStatus[] = ['Draft', 'InReview', 'Issued', 'Archived'];

export interface UserRef {
  id: string;
  displayName: string;
}

export interface MeProject {
  id: string;
  code: string;
  title: string;
  role: ProjectRole;
}

export interface Me {
  userId: string;
  displayName: string;
  email: string | null;
  jobTitle: string;
  tenantId: string;
  tenantName: string;
  isGuest: boolean;
  guestExpiresAt: string | null;
  persona: string | null;
  projects: MeProject[];
}

export interface Persona {
  key: string;
  userId: string;
  displayName: string;
  jobTitle: string;
  roles: string;
  isActive: boolean;
}

export interface DemoSession {
  tenantId: string;
  expiresAt: string | null;
  persona: string;
  reused: boolean;
}

export interface Member {
  userId: string;
  displayName: string;
  jobTitle: string;
  role: ProjectRole;
}

export interface ProjectSummary {
  id: string;
  code: string;
  title: string;
  description: string;
  location: string;
  myRole: ProjectRole;
  documentCount: number;
  openRfiCount: number;
  openSubmittalCount: number;
  overdueCount: number;
}

export interface ProjectDetail {
  id: string;
  code: string;
  title: string;
  description: string;
  location: string;
  myRole: ProjectRole;
  members: Member[];
}

export interface Paged<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

export interface RevisionChip {
  id: string;
  versionLabel: string;
  isCurrent: boolean;
  approvalStatus: RevisionApprovalStatus;
}

export interface DocumentListItem {
  id: string;
  projectId: string;
  documentNumber: string;
  title: string;
  category: DocumentCategory;
  discipline: Discipline;
  status: DocumentStatus;
  currentRevisionId: string | null;
  currentVersionLabel: string | null;
  currentApprovalStatus: RevisionApprovalStatus | null;
  currentMimeType: string | null;
  revisions: RevisionChip[];
  updatedAt: string;
}

export interface DocumentQuery {
  search?: string;
  discipline?: Discipline | '';
  status?: DocumentStatus | '';
  category?: DocumentCategory | '';
  approvalStatus?: RevisionApprovalStatus | '';
  revision?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
}

export interface Revision {
  id: string;
  documentId: string;
  versionLabel: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  pageCount: number | null;
  hasTextLayer: boolean;
  hasActiveContent: boolean;
  changeNote: string;
  uploadedBy: UserRef;
  uploadedAt: string;
  approvalStatus: RevisionApprovalStatus;
  supersedesRevisionId: string | null;
  isCurrent: boolean;
  previewSupported: boolean;
}

export interface DocumentDetail {
  id: string;
  projectId: string;
  projectCode: string;
  projectTitle: string;
  documentNumber: string;
  title: string;
  category: DocumentCategory;
  discipline: Discipline;
  status: DocumentStatus;
  currentRevisionId: string | null;
  revisions: Revision[];
  myRole: ProjectRole;
  canUpload: boolean;
  createdAt: string;
  updatedAt: string;
  rowVersion: string;
  issueDate: string | null;
  specSection: string | null;
}

export interface AuditEvent {
  id: number;
  timestamp: string;
  actor: UserRef | null;
  resource: ResourceType;
  resourceId: string;
  action: string;
  changeJson: string;
  reference: string | null;
}

export interface DocumentHistory {
  revisions: Revision[];
  events: AuditEvent[];
}

export interface RevisionFieldChange {
  field: string;
  from: string | null;
  to: string | null;
}

export interface RevisionComparison {
  from: Revision;
  to: Revision;
  changes: RevisionFieldChange[];
  contentChanged: boolean;
  sizeDelta: number;
}

export interface ProblemDetails {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  errors?: Record<string, string[]>;
  traceId?: string;
}

export interface Citation {
  documentId: string;
  documentNumber: string;
  documentTitle: string;
  revisionId: string;
  versionLabel: string;
  page: number;
  pageCount: number | null;
  newerRevisionExists: boolean;
  currentVersionLabel: string | null;
}

export interface RfiListItem {
  id: string;
  referenceNumber: string;
  subject: string;
  state: RfiState;
  discipline: Discipline;
  assignee: UserRef | null;
  dueAt: string | null;
  isOverdue: boolean;
  daysOverdue: number;
  createdBy: UserRef;
  createdAt: string;
  citation: Citation;
}

export interface RfiResponse {
  id: string;
  author: UserRef;
  answer: string;
  createdAt: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  approvedBy: UserRef | null;
  approvedAt: string | null;
  rejectedBy: UserRef | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
}

export interface Comment {
  id: string;
  author: UserRef;
  body: string;
  page: number | null;
  revisionId: string | null;
  versionLabel: string | null;
  createdAt: string;
}

export interface RfiDetail {
  id: string;
  projectId: string;
  projectCode: string;
  referenceNumber: string;
  subject: string;
  question: string;
  state: RfiState;
  discipline: Discipline;
  assignee: UserRef | null;
  dueAt: string | null;
  isOverdue: boolean;
  createdBy: UserRef;
  createdAt: string;
  submittedAt: string | null;
  answeredAt: string | null;
  closedAt: string | null;
  reopenReason: string | null;
  approvedResponseId: string | null;
  citation: Citation;
  responses: RfiResponse[];
  timeline: AuditEvent[];
  comments: Comment[];
  availableActions: RfiAction[];
  myRole: ProjectRole;
  rowVersion: string;
}

export interface RfiQuery {
  state?: RfiState | '';
  assignee?: string;
  due?: '' | 'overdue' | 'week';
  discipline?: Discipline | '';
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface CreateRfi {
  subject: string;
  question: string;
  sourceRevisionId: string;
  sourcePage: number;
  submit: boolean;
}

export interface Decision {
  id: string;
  cycle: number;
  revisionId: string;
  versionLabel: string;
  reviewer: UserRef;
  decision: ReviewDecisionType;
  comments: string;
  createdAt: string;
}

export interface SubmittalListItem {
  id: string;
  number: string;
  title: string;
  specSection: string;
  status: SubmittalStatus;
  cycle: number;
  discipline: Discipline;
  reviewer: UserRef;
  dueAt: string | null;
  isOverdue: boolean;
  daysOverdue: number;
  documentId: string;
  documentNumber: string;
  versionLabel: string;
  submittedAt: string;
}

export interface SubmittalDetail {
  id: string;
  projectId: string;
  projectCode: string;
  number: string;
  title: string;
  specSection: string;
  status: SubmittalStatus;
  cycle: number;
  discipline: Discipline;
  reviewer: UserRef;
  dueAt: string | null;
  isOverdue: boolean;
  submittedBy: UserRef;
  submittedAt: string;
  reviewStartedAt: string | null;
  decidedAt: string | null;
  finalizedAt: string | null;
  documentId: string;
  documentNumber: string;
  documentTitle: string;
  revisionId: string;
  versionLabel: string;
  revisionApprovalStatus: RevisionApprovalStatus;
  newerRevisions: RevisionChip[];
  decisions: Decision[];
  timeline: AuditEvent[];
  comments: Comment[];
  availableActions: SubmittalAction[];
  myRole: ProjectRole;
  rowVersion: string;
}

export interface SubmittalQuery {
  status?: SubmittalStatus | '';
  reviewer?: string;
  due?: '' | 'overdue' | 'week';
  discipline?: Discipline | '';
  page?: number;
  pageSize?: number;
}

export interface ReviewQueueItem {
  itemType: 'Rfi' | 'Submittal';
  itemId: string;
  reference: string;
  title: string;
  state: string;
  assignee: UserRef | null;
  dueAt: string | null;
  discipline: string;
  isOverdue: boolean;
  daysOverdue: number | null;
}

export interface NotificationItem {
  id: string;
  projectId: string;
  kind: string;
  resource: ResourceType;
  resourceId: string;
  message: string;
  createdAt: string;
  isRead: boolean;
}

export interface NotificationFeed {
  unreadCount: number;
  items: NotificationItem[];
}

export interface CountItem {
  key: string;
  count: number;
}

export interface SeriesPoint {
  weekStart: string;
  opened: number;
  closed: number;
  openAtEnd: number;
}

export interface Insights {
  generatedAt: string;
  rfiTurnaroundMedianDays: number | null;
  closedRfiSample: number;
  submittalReviewMedianDays: number | null;
  openRfis: number;
  openSubmittals: number;
  overdueItems: number;
  rfiOpenVsClosed: SeriesPoint[];
  overdueByDiscipline: CountItem[];
  documentsByDiscipline: { discipline: string; total: number; byStatus: CountItem[] }[];
  rfisByState: CountItem[];
  submittalsByStatus: CountItem[];
}

export interface AuditQuery {
  resource?: ResourceType | '';
  action?: string;
  actorId?: string;
  page?: number;
  pageSize?: number;
}

export const RFI_STATES: RfiState[] = [
  'Draft',
  'Submitted',
  'Assigned',
  'Answered',
  'Closed',
  'Reopened',
];
export const SUBMITTAL_STATUSES: SubmittalStatus[] = [
  'Submitted',
  'InReview',
  'Approved',
  'ApprovedWithComments',
  'ReviseAndResubmit',
  'Final',
];

export type ExtractionField = 'Title' | 'Discipline' | 'DocumentNumber' | 'Date' | 'SpecSection';

export interface Suggestion {
  id: string;
  revisionId: string;
  field: ExtractionField;
  proposedValue: string;
  page: number;
  snippet: string;
  confidence: 'High' | 'Medium' | 'Low';
  rule: string;
  engine: string;
  status: 'Pending' | 'Accepted' | 'Rejected';
  decidedBy: UserRef | null;
  decidedAt: string | null;
  currentValue: string | null;
  rowVersion: string;
}

export interface ExtractionResult {
  revisionId: string;
  status: 'NotRun' | 'Ready' | 'NoTextLayer' | 'Unsupported';
  engineLabel: string;
  message: string;
  canRun: boolean;
  suggestions: Suggestion[];
}
