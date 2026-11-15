import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PublicFooterComponent, PublicHeaderComponent } from '../../shared/brand';
import { GITHUB_URL, MEASURED_TESTS } from '../../shared/site';

@Component({
  selector: 'app-case-study-page',
  imports: [RouterLink, PublicHeaderComponent, PublicFooterComponent],
  templateUrl: './case-study.page.html',
  styleUrl: './case-study.page.scss',
})
export class CaseStudyPage {
  protected readonly counts = MEASURED_TESTS;
  protected readonly githubUrl = GITHUB_URL;
}
