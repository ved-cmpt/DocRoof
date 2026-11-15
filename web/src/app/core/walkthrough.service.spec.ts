import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Me } from './api.models';
import { SessionService } from './session.service';
import { WalkthroughService } from './walkthrough.service';

const guest: Me = {
  userId: 'u1',
  displayName: 'Theo Brandt',
  email: null,
  jobTitle: 'Site Superintendent',
  tenantId: `t-${Math.random().toString(36).slice(2)}`,
  tenantName: 'Guest workspace',
  isGuest: true,
  guestExpiresAt: null,
  persona: 'requester',
  projects: [],
};

describe('WalkthroughService (optional tour)', () => {
  function setup() {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    const session = TestBed.inject(SessionService);
    const tour = TestBed.inject(WalkthroughService);
    session.me.set({ ...guest, tenantId: `t-${Math.random().toString(36).slice(2)}` });
    TestBed.tick();
    return tour;
  }

  it('is hidden by default and opens only when asked', () => {
    const tour = setup();
    expect(tour.open()).toBe(false);
    expect(tour.welcomed()).toBe(false);
    tour.start();
    expect(tour.open()).toBe(true);
    expect(tour.welcomed()).toBe(true);
  });

  it('counts workflow steps only for the RFI created during the tour', () => {
    const tour = setup();
    tour.mark('assign', 'other-rfi');
    expect(tour.done()).toEqual([]);
    tour.mark('create-rfi', 'rfi-1');
    tour.mark('assign', 'rfi-1');
    expect(tour.done()).toEqual(['create-rfi', 'assign']);
    tour.reset();
    expect(tour.done()).toEqual([]);
  });
});
