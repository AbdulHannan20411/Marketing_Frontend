import type { TourStepContent } from '@core/models/onboarding.model';

/**
 * The product tour, in order.
 *
 * **To add a step:** add an entry here keyed by its nav `route`. Nothing else
 * changes — the service filters this list against what the user can actually
 * reach, so an entry for a route the user has no permission for simply does not
 * appear, and the "Step 3 of 8" count adjusts on its own.
 *
 * **A route with no entry gets no step.** That is deliberate: this is a curated
 * walkthrough, not an inventory. A full-permission admin can reach fourteen nav
 * items, and marching someone through all fourteen on their first login is a
 * tour they will skip. The ones left out — Import, Tags, Subscription, Billing —
 * are either sub-features of a step that is covered, or self-explanatory when
 * the user goes looking for them.
 *
 * The consequence to know about: adding a nav item without adding copy here
 * means it is silently absent from the tour. That beats the alternative of
 * auto-generating filler text, which would put words in the product's mouth.
 */
export const TOUR_STEPS: readonly TourStepContent[] = [
  {
    route: '/dashboard',
    title: 'Dashboard',
    description:
      'Your starting point. Delivery rates, recent campaigns and anything that needs attention are summarised here, so you can see how messaging is performing without opening each screen.',
  },
  {
    route: '/contacts',
    title: 'Contacts',
    description:
      'Everyone you can message. Add people individually or import a spreadsheet — the importer checks for duplicates and bad numbers before anything is saved.',
  },
  {
    route: '/groups',
    title: 'Groups',
    description:
      'Groups are the audiences you send to. A contact can belong to several, and campaigns count them only once, so overlapping groups will not double-message anyone.',
  },
  {
    route: '/whatsapp',
    title: 'WhatsApp connection',
    description:
      'Connect your WhatsApp Business number here. Nothing can be sent until this is linked, so it is worth doing first — everything else waits on it.',
  },
  {
    route: '/templates',
    title: 'Templates',
    description:
      'WhatsApp only lets you start a conversation with a template Meta has approved. Write them here and submit for review; approval usually takes minutes.',
  },
  {
    route: '/campaigns',
    title: 'Campaigns',
    description:
      'Pick an approved template, choose your audience, and send now or on a schedule — including repeating sends. Every run is recorded so you can see what went out and when.',
  },
  {
    route: '/inbox',
    title: 'Inbox',
    description:
      'When someone replies, the conversation lands here. You can answer freely for 24 hours after their last message; after that WhatsApp requires a template again.',
  },
  {
    route: '/reports',
    title: 'Reports',
    description:
      'Delivery, read and failure figures across campaigns, with the reasons behind anything that did not arrive. Exportable when you need to share the numbers.',
  },
  {
    route: '/employees',
    title: 'Employees',
    description:
      'Invite your team and choose what each person can see. Anything they lack permission for is hidden rather than shown and refused.',
  },
  {
    route: '/settings',
    title: 'Settings',
    description:
      'Your profile, appearance, and the Help & FAQ panel — which is also where you can restart this tour whenever you like. That is the end of the tour.',
  },
];
