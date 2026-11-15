import { Component, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PublicFooterComponent, PublicHeaderComponent } from '../../shared/brand';
import { IconName } from '../../shared/icons.generated';
import { RevealDirective } from '../../shared/reveal.directive';
import { MEASURED_TESTS } from '../../shared/site';
import { IconComponent } from '../../shared/ui';
import { HeroPreviewComponent } from './hero-preview.component';

interface TourTab {
  key: string;
  label: string;
  icon: IconName;
  title: string;
  points: string[];
  image: string;
  alt: string;
}

@Component({
  selector: 'app-landing-page',
  imports: [
    RouterLink,
    PublicHeaderComponent,
    PublicFooterComponent,
    HeroPreviewComponent,
    IconComponent,
    RevealDirective,
  ],
  templateUrl: './landing.page.html',
  styleUrl: './landing.page.scss',
})
export class LandingPage {
  protected readonly counts = MEASURED_TESTS;
  protected readonly totalTests =
    MEASURED_TESTS.unit + MEASURED_TESTS.integration + MEASURED_TESTS.angular + MEASURED_TESTS.e2e;

  protected readonly steps: { icon: IconName; title: string; text: string }[] = [
    {
      icon: 'upload',
      title: 'Upload',
      text: 'Add a drawing or spec. Every revision keeps its checksum.',
    },
    {
      icon: 'message-square-text',
      title: 'Ask',
      text: 'Raise an RFI pinned to the exact revision and page.',
    },
    {
      icon: 'circle-check',
      title: 'Approve',
      text: 'Reviewers answer, managers approve. Every step is on record.',
    },
  ];

  protected readonly tabs: TourTab[] = [
    {
      key: 'documents',
      label: 'Documents',
      icon: 'file-text',
      title: 'A register that never loses history',
      points: [
        'Every upload is a new revision with a SHA-256 checksum.',
        'Superseded revisions stay one click away.',
        'Preview PDFs in the browser and link to any page.',
      ],
      image: '/screenshots/tour-documents.png',
      alt: 'Document register with discipline, status, revision and review columns',
    },
    {
      key: 'rfis',
      label: 'RFIs',
      icon: 'message-square-text',
      title: 'Questions pinned to the exact page',
      points: [
        'Raise an RFI from the page you are reading.',
        'The citation stays on that revision after updates.',
        'Assign, answer, approve and close, each step on record.',
      ],
      image: '/screenshots/tour-rfis.png',
      alt: 'RFI record with its question, pinned citation, answer and details panel',
    },
    {
      key: 'submittals',
      label: 'Submittals',
      icon: 'clipboard-check',
      title: 'One decision per review cycle',
      points: [
        'Approve, approve with comments, or ask for a resubmission.',
        'A resubmission starts a new cycle with a newer revision.',
        'The review queue shows what is waiting and what is late.',
      ],
      image: '/screenshots/tour-submittals.png',
      alt: 'Submittal record with review decisions and a details panel',
    },
    {
      key: 'insights',
      label: 'Insights',
      icon: 'chart-column',
      title: 'Numbers computed live',
      points: [
        'Turnaround, open items and overdue reviews from the database.',
        'Every chart can switch to a data table.',
        'Nothing on the page is hard-coded.',
      ],
      image: '/screenshots/tour-insights.png',
      alt: 'Insights with key figures and charts for RFIs and overdue reviews',
    },
  ];

  protected readonly active = signal('documents');

  protected select(key: string): void {
    this.active.set(key);
  }

  protected move(delta: number): void {
    const i = this.tabs.findIndex((t) => t.key === this.active());
    const next = this.tabs[(i + delta + this.tabs.length) % this.tabs.length];
    this.active.set(next.key);
    document.getElementById('tour-tab-' + next.key)?.focus();
  }

  protected current(): TourTab {
    return this.tabs.find((t) => t.key === this.active()) ?? this.tabs[0];
  }
}
