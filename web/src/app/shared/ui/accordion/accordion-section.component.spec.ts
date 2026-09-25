import { Component } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';

import { AccordionSectionComponent } from './accordion-section.component';

@Component({
  imports: [AccordionSectionComponent],
  template: `
    <app-accordion-section title="Notifications" subtitle="What reaches you">
      <p class="body">Switches</p>
    </app-accordion-section>
  `,
})
class HostComponent {}

describe('AccordionSectionComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let element: HTMLElement;

  function heading(): HTMLButtonElement {
    return element.querySelector('button') as HTMLButtonElement;
  }

  beforeEach(() => {
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    element = fixture.nativeElement as HTMLElement;
  });

  it('starts closed, with the body out of the DOM', () => {
    expect(element.querySelector('.body')).toBeNull();
    expect(heading().getAttribute('aria-expanded')).toBe('false');
  });

  it('opens and closes from the heading, not only from the chevron', () => {
    heading().click();
    fixture.detectChanges();

    expect(element.querySelector('.body')?.textContent).toContain('Switches');
    expect(heading().getAttribute('aria-expanded')).toBe('true');

    heading().click();
    fixture.detectChanges();

    expect(element.querySelector('.body')).toBeNull();
  });

  it('names the panel it controls, so the heading and the body are linked', () => {
    heading().click();
    fixture.detectChanges();

    const controls = heading().getAttribute('aria-controls');
    expect(controls).toBeTruthy();
    expect(element.querySelector(`#${controls}`)).not.toBeNull();
  });
});
