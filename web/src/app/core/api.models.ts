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
