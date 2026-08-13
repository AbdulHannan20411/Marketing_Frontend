import { Injectable, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { TitleStrategy, type RouterStateSnapshot } from '@angular/router';

import { environment } from '@env/environment';

/**
 * Appends the product name to every route title.
 *
 * Routes carry only the page part — `'Contacts'`, not `'Contacts · NextReach'` —
 * so the name lives in the environment alone. It used to be restated on all
 * forty-odd routes, which meant renaming the product involved editing every one
 * of them and hoping none were missed.
 */
@Injectable({ providedIn: 'root' })
export class AppTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);

  override updateTitle(snapshot: RouterStateSnapshot): void {
    const page = this.buildTitle(snapshot);
    this.title.setTitle(page === undefined ? environment.appName : `${page} · ${environment.appName}`);
  }
}
