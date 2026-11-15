import { AfterViewInit, Component, ElementRef, OnDestroy, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PublicFooterComponent, PublicHeaderComponent } from '../../shared/brand';
import { GITHUB_URL, MEASURED_TESTS } from '../../shared/site';
import { IconComponent } from '../../shared/ui';

@Component({
  selector: 'app-case-study-page',
  imports: [RouterLink, PublicHeaderComponent, PublicFooterComponent, IconComponent],
  templateUrl: './case-study.page.html',
  styleUrl: './case-study.page.scss',
})
export class CaseStudyPage implements AfterViewInit, OnDestroy {
  private readonly host = inject(ElementRef<HTMLElement>);
  protected readonly counts = MEASURED_TESTS;
  protected readonly githubUrl = GITHUB_URL;
  protected readonly toc = [
    { id: 'problem', label: 'Problem' },
    { id: 'roles', label: 'Roles' },
    { id: 'rules', label: 'Business rules' },
    { id: 'arch', label: 'Architecture' },
    { id: 'data', label: 'Data model' },
    { id: 'security', label: 'Security' },
    { id: 'testing', label: 'Testing' },
    { id: 'deploy', label: 'Deployment' },
    { id: 'limits', label: 'Limitations' },
    { id: 'walkthrough', label: 'Walkthrough' },
  ];
  /** Section currently in view (table-of-contents highlight). */
  protected readonly activeId = signal('problem');
  private observer?: IntersectionObserver;

  ngAfterViewInit(): void {
    if (typeof IntersectionObserver === 'undefined') {
      return;
    }
    this.observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length > 0) {
          this.activeId.set(visible[0].target.id);
        }
      },
      { rootMargin: '-80px 0px -65% 0px' },
    );
    const root = this.host.nativeElement as HTMLElement;
    root.querySelectorAll('article section[id]').forEach((s) => this.observer!.observe(s));
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }
}
