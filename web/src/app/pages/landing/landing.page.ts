import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PublicFooterComponent, PublicHeaderComponent } from '../../shared/brand';

interface Capability {
  title: string;
  body: string;
  status: 'Live' | 'In progress';
}

interface Workflow {
  role: string;
  summary: string;
  steps: string[];
}

@Component({
  selector: 'app-landing-page',
  imports: [RouterLink, PublicHeaderComponent, PublicFooterComponent],
  templateUrl: './landing.page.html',
  styleUrl: './landing.page.scss',
})
export class LandingPage {
  protected readonly workflows: Workflow[] = [
    {
      role: 'Document Controller',
      summary: 'Keeps the register authoritative.',
      steps: [
        'Uploads drawings, specs and product data with discipline and category',
        'Issues new revisions; earlier bytes and checksums stay untouched',
        'Distributes the current revision while superseded ones remain traceable',
      ],
    },
    {
      role: 'Reviewer',
      summary: 'Answers questions with evidence.',
      steps: [
        'Sees assigned RFIs and submittals with due dates and overdue flags',
        'Answers RFIs that cite an exact revision and page',
        'Records one review decision per submittal cycle',
      ],
    },
    {
      role: 'Project Manager',
      summary: 'Owns approvals and escalations.',
      steps: [
        'Assigns reviewers and due dates',
        'Approves or returns RFI answers before closing',
        'Reads the audit trail and turnaround insights',
      ],
    },
  ];

  protected readonly capabilities: Capability[] = [
    {
      title: 'Controlled document register',
      body: 'Search and filter by discipline, status, category, review status and revision, with server-side paging.',
      status: 'Live',
    },
    {
      title: 'Immutable revisions',
      body: 'Every upload is a new row with a SHA-256 checksum. A SQL trigger, an EF Core interceptor and the service layer all block edits to stored revisions.',
      status: 'Live',
    },
    {
      title: 'Safe files',
      body: 'Magic-byte allow-list (PDF, TXT, PNG, JPG), size limits, generated storage keys, sanitized download names and sandboxed previews.',
      status: 'Live',
    },
    {
      title: 'Isolated guest demo',
      body: 'Each visitor gets a private tenant cloned from the seed template, with persona switching and automatic 24-hour cleanup.',
      status: 'Live',
    },
    {
      title: 'RFI and submittal workflows',
      body: 'Server-enforced state machines with assignments, approvals, rowversion concurrency and audit events.',
      status: 'In progress',
    },
    {
      title: 'Rules-based extraction',
      body: 'Deterministic suggestions for title, number, dates and spec sections, each citing its source page, accepted or rejected by a person.',
      status: 'In progress',
    },
  ];
}
