/**
 * Help content.
 *
 * Deliberately static rather than fetched: none of it changes per tenant, and a
 * help page that cannot load when something is already going wrong is the least
 * useful page in the product. If these ever need editing without a deploy, they
 * move behind an endpoint — until then, shipping them in the bundle means they
 * are always available, including offline.
 *
 * The answers describe how **this** product behaves against the WhatsApp Cloud
 * API. Generic WhatsApp advice belongs in Meta's own documentation, which the
 * links at the bottom of the panel point to.
 */

export interface FaqEntry {
  readonly id: string;
  readonly topic: FaqTopic;
  readonly question: string;
  /** Paragraphs. Kept as an array so the template does not have to parse copy. */
  readonly answer: readonly string[];
}

export type FaqTopic = 'templates' | 'campaigns' | 'contacts' | 'billing' | 'account';

export const FAQ_TOPIC_LABEL: Readonly<Record<FaqTopic, string>> = {
  templates: 'Templates',
  campaigns: 'Campaigns',
  contacts: 'Contacts',
  billing: 'Billing',
  account: 'Account',
};

export const FAQ_ENTRIES: readonly FaqEntry[] = [
  {
    id: 'template-approval',
    topic: 'templates',
    question: 'How long does template approval take?',
    answer: [
      'Usually a few minutes. Meta occasionally takes up to 24 hours, and there is no way to expedite it from here.',
      'While a template is pending it cannot be used in a campaign. The Templates screen shows a Pending count so you can see at a glance what is still waiting.',
    ],
  },
  {
    id: 'template-rejected',
    topic: 'templates',
    question: 'My template was rejected. What now?',
    answer: [
      'Open the template and use "Fix and resubmit". The rejection reason Meta gave is shown on the card — it is usually promotional wording in a template submitted as Utility, or a placeholder with no surrounding context.',
      'Resubmitting sends it back for review as a new pending template. You cannot edit an approved template: Meta treats those as immutable, so create a new version instead.',
    ],
  },
  {
    id: 'template-paused',
    topic: 'templates',
    question: 'Why did Meta pause one of my templates?',
    answer: [
      'Meta pauses a template when recipients block or report it often enough. It is a quality signal, not a policy strike, and it usually clears on its own.',
      'Any campaign relying on a paused template will pause rather than fail, with the reason recorded against the run that could not go out. Fix or replace the template, then resume the campaign.',
    ],
  },
  {
    id: 'why-templates',
    topic: 'templates',
    question: 'Why do I need a template to message someone?',
    answer: [
      'WhatsApp only lets a business start a conversation with a pre-approved template. Free-form messages are allowed once the customer has replied, for 24 hours.',
      'This is Meta policy and applies to every provider on the WhatsApp Business Platform, not just this product.',
    ],
  },
  {
    id: 'service-window',
    topic: 'campaigns',
    question: 'What is the 24-hour window?',
    answer: [
      'Once a customer messages you, you have 24 hours to reply with anything — text, images, voice notes — without using a template.',
      'When the window closes, the Inbox stops allowing free-form replies and you are back to templates. The countdown is shown on each conversation.',
    ],
  },
  {
    id: 'campaign-paused',
    topic: 'campaigns',
    question: 'My campaign paused on its own. Why?',
    answer: [
      'Recurring campaigns are re-checked before every send: the template must still be approved, WhatsApp must still be connected, the groups must still exist, and you must be within your plan limits.',
      'If any of those fails the campaign pauses rather than fails, because a paused campaign can be fixed and resumed while a failed one usually has to be rebuilt. The reason is shown on the campaign, above the run history.',
    ],
  },
  {
    id: 'recurring-first-run',
    topic: 'campaigns',
    question: 'Why did my repeating campaign not run when I expected?',
    answer: [
      'Weekly intervals count from the week the start date falls in, not from the first matching weekday. "Every 2 weeks on Monday" starting on a Saturday first runs eleven days later, not two.',
      'The scheduler shows the computed first run underneath the summary whenever it differs from the start date, so you can check before activating.',
    ],
  },
  {
    id: 'recipient-count',
    topic: 'campaigns',
    question: 'Why is the recipient count different from my group totals?',
    answer: [
      'Someone in two selected groups is one recipient, not two, and anyone who has opted out is excluded. The real figure is therefore usually lower than the group totals added together.',
      'The audience is resolved when the campaign runs, not when you save it — so a recurring campaign to "New this quarter" reaches whoever qualifies on the day.',
    ],
  },
  {
    id: 'run-now',
    topic: 'campaigns',
    question: 'Does "Run now" cancel my schedule?',
    answer: [
      'No. It sends immediately and leaves the schedule untouched — a campaign set for Monday still runs on Monday.',
      'A manual run also does not count towards an "after N sends" limit. It appears in the run history badged Manual so an unexpected send can be explained later.',
    ],
  },
  {
    id: 'opt-out',
    topic: 'contacts',
    question: 'How do opt-outs work?',
    answer: [
      'A contact who replies STOP, or who you mark as unsubscribed, is excluded from every campaign from that moment on. There is no way to override it, and that is deliberate.',
      'Opt-outs are applied when a campaign runs, so someone who unsubscribes today will not receive tomorrow’s scheduled send.',
    ],
  },
  {
    id: 'import-duplicates',
    topic: 'contacts',
    question: 'What happens to duplicates when I import?',
    answer: [
      'The import wizard matches on phone number and shows you what it found before anything is written. You choose whether to skip duplicates or update the existing contact.',
      'Rows that cannot be imported are listed with the reason, and you can download just the failed rows to fix and re-upload.',
    ],
  },
  {
    id: 'phone-format',
    topic: 'contacts',
    question: 'What phone number format should I use?',
    answer: [
      'International format including the country code — for example +44 7700 900123. Spaces and dashes are fine; they are stripped on import.',
      'A number without a country code cannot be delivered to, so those rows are rejected at import rather than failing silently at send time.',
    ],
  },
  {
    id: 'conversation-pricing',
    topic: 'billing',
    question: 'How does Meta charge for messages?',
    answer: [
      'Meta bills per 24-hour conversation, not per message, and the rate depends on the category and the recipient’s country. Replies inside an open conversation cost nothing extra.',
      'Those charges are billed by Meta directly through your WhatsApp Business account. Your subscription here is separate and covers the platform itself.',
    ],
  },
  {
    id: 'plan-limits',
    topic: 'billing',
    question: 'What happens when I hit a plan limit?',
    answer: [
      'Contacts beyond your limit are not imported, and a campaign that would exceed your message allowance sends what fits and records the rest as skipped rather than failing outright.',
      'Nothing is deleted when you reach a limit. Upgrading restores the allowance immediately.',
    ],
  },
  {
    id: 'suspended',
    topic: 'billing',
    question: 'My account is suspended. What can I still do?',
    answer: [
      'You can sign in and reach the subscription screen to settle the balance or upgrade. The rest of the workspace is locked until then.',
      'Your data is untouched while suspended — contacts, templates and campaign history are all still there when access is restored.',
    ],
  },
  {
    id: 'employee-access',
    topic: 'account',
    question: 'How do I control what my team can see?',
    answer: [
      'Employees are invited from the Employees screen, where you grant access per feature. Anything they lack permission for is hidden rather than shown and refused.',
      'Invitations are sent from the platform on your behalf, with your name identified as the sender so the recipient knows who invited them.',
    ],
  },
  {
    id: 'theme',
    topic: 'account',
    question: 'Is my theme shared with my team?',
    answer: [
      'No. Light, dark or system is stored in your browser and applies only to you. Someone else signing in on another machine keeps their own choice.',
    ],
  },
];
