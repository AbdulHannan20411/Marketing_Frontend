import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';

import type { Contact, CreateContactRequest } from '@core/models/contact.model';
import { ContactEditorComponent } from './contact-editor.component';

const CONTACT: Contact = {
  id: 'cnt_27',
  fullName: 'Ayesha Khan',
  initials: 'AK',
  phoneNumber: '+441234567890',
  email: null,
  country: 'GB',
  status: 'subscribed',
  tagIds: ['tag_1', 'tag_2'],
  groupIds: ['grp_1'],
  optedInAt: null,
  lastMessagedAt: null,
  createdAt: '2026-01-01T00:00:00Z',
};

@Component({
  imports: [ContactEditorComponent],
  template: `
    <app-contact-editor
      [groups]="[]"
      [tags]="[]"
      [contact]="contact()"
      (save)="saved = $event"
    />
  `,
})
class HostComponent {
  readonly contact = signal<Contact | null>(CONTACT);
  saved: CreateContactRequest | null = null;
}

/**
 * The API replaces a collection whenever it is supplied. Sending the
 * memberships back unchanged soft-deleted and re-created every join row, which
 * filled the contact's history with entries describing nothing the user did.
 */
describe('ContactEditorComponent — membership payload', () => {
  let fixture: ComponentFixture<HostComponent>;

  interface EditorInternals {
    readonly fullName: { set: (value: string) => void };
    readonly phoneNumber: { set: (value: string) => void };
    readonly selectedTags: { set: (value: ReadonlySet<string>) => void };
  }

  /** The component instance, whose form state is protected from templates only. */
  function editor(): EditorInternals {
    return fixture.debugElement.children[0].componentInstance as EditorInternals;
  }

  /**
   * Saves through the dialog's own button.
   *
   * Queried from `<body>`: the editor lives inside `app-modal`, which moves
   * itself out there so a transformed ancestor cannot frame it.
   */
  function submit(): CreateContactRequest {
    // `app-modal` moves its own element to <body>, taking the footer with it.
    const dialog = document.body.querySelector('app-modal');
    expect(dialog).withContext('the dialog').not.toBeNull();

    const save = [...dialog!.querySelectorAll('button')].find(
      (button) => button.textContent?.trim().startsWith('Save') || button.textContent?.trim().startsWith('Add'),
    );
    expect(save).withContext('the save button').toBeTruthy();

    save!.click();
    fixture.detectChanges();
    return fixture.componentInstance.saved!;
  }

  beforeEach(async () => {
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    // The modal re-parents itself after the first render.
    await fixture.whenStable();
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it('leaves untouched tags and groups out of the payload', () => {
    const request = submit();

    expect(request).toBeTruthy();
    expect('tagIds' in request).toBeFalse();
    expect('groupIds' in request).toBeFalse();
  });

  it('sends the collection that changed, and only that one', () => {
    editor().selectedTags.set(new Set(['tag_1']));
    fixture.detectChanges();

    const request = submit();
    expect(request.tagIds).toEqual(['tag_1']);
    expect('groupIds' in request).toBeFalse();
  });

  it('sends both for a contact being created, where there is nothing to compare', async () => {
    // Its own fixture: the editor is created fresh for a new contact, and
    // reusing this one would carry the previous contact's selections.
    fixture.destroy();
    fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.contact.set(null);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // A new contact's form starts blank, so it has to be filled before the
    // save button is enabled at all.
    editor().fullName.set('New Person');
    editor().phoneNumber.set('+441234567891');
    fixture.detectChanges();

    const request = submit();
    expect(request.tagIds).toEqual([]);
    expect(request.groupIds).toEqual([]);
  });
});
