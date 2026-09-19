import type { GuidedTour } from '@core/models/onboarding.model';
import { TOUR_STEPS } from './onboarding.config';

/**
 * Every guided tour the product offers.
 *
 * **The single place a tour is declared.** Settings renders this list, the
 * service runs whatever it is handed, and nothing keys off a specific tour id
 * — so adding a module tour is one entry here plus `data-tour` attributes on
 * the elements it points at. No component changes, no new service.
 *
 * Two rules keep it honest:
 *
 * 1. **Only list what is built.** An entry appears in Settings the moment it
 *    is added, so a half-written tour is a broken promise on a real screen.
 * 2. **Point at elements that already exist.** Every target below is an
 *    element the page renders for its own reasons. Nothing here exists solely
 *    to be pointed at — a tour that teaches you about UI invented for the tour
 *    teaches you nothing.
 *
 * A step whose target is missing is skipped, which is what makes the
 * state-dependent steps below work: the WhatsApp tour carries both the
 * "connect your account" and the "your account is connected" steps, and each
 * user sees whichever one their workspace is actually in.
 */

/** The whole product. Auto-starts once, on first login; restartable forever. */
const GENERAL_TOUR: GuidedTour = {
  id: 'general-tour',
  title: 'General tour',
  description: 'Learn how to navigate and use the main areas of the application.',
  type: 'general',
  steps: TOUR_STEPS,
};

/**
 * WhatsApp, end to end.
 *
 * Follows the onboarding a customer actually goes through: connect via Meta
 * Embedded Signup, watch the server-side steps finish, then the things that
 * decide whether messages get delivered — quality, sending ceiling, and the
 * templates a conversation has to start with.
 *
 * Deliberately spans routes. Templates are half of "how do I send anything",
 * and a WhatsApp tour that stops at the connection screen leaves the user at
 * the point where they still cannot send.
 */
const WHATSAPP_TOUR: GuidedTour = {
  id: 'whatsapp-tour',
  title: 'WhatsApp',
  description: 'Learn how to connect WhatsApp and send your first message.',
  type: 'module',
  module: 'whatsapp',
  requiresRoute: '/whatsapp',
  steps: [
    {
      route: '/whatsapp',
      title: 'Your WhatsApp connection',
      description:
        'Everything sending-related starts here. Until a WhatsApp Business Account is linked, campaigns cannot go out — so this is the screen to finish first.',
    },

    /* --- shown while the workspace is not yet connected --- */
    {
      route: '/whatsapp',
      target: 'whatsapp.preflight',
      title: 'Before you start',
      description:
        'Three things Meta requires, and none of them can be sorted out mid-signup: a verified business, a phone number not already on WhatsApp, and two-step verification off on that number (or its PIN to hand).',
    },
    {
      route: '/whatsapp',
      target: 'whatsapp.connect',
      title: 'Connect with Meta',
      description:
        'This opens Meta Embedded Signup in a popup. You sign in to Facebook, choose your business, pick the phone number, and grant access. We never see your Meta password — the authorisation comes back to our server, which exchanges it there.',
    },
    {
      route: '/whatsapp',
      target: 'whatsapp.progress',
      title: 'What happens after the popup',
      description:
        'Closing the popup is not the end. Our server then verifies the authorisation, subscribes to delivery updates, registers your number and reads your profile. Each step is listed here as it runs, so a failure tells you which part needs attention rather than just "could not connect".',
    },

    /* --- shown once the workspace is connected --- */
    {
      route: '/whatsapp',
      target: 'whatsapp.status',
      title: 'Connection status',
      description:
        'Your verified business name, the connected number, and its quality rating. Quality is Meta’s judgement of how people react to your messages — let it fall and your sending limit falls with it.',
    },
    {
      route: '/whatsapp',
      target: 'whatsapp.limit',
      title: 'Your sending ceiling',
      description:
        'A rolling 24-hour cap set by Meta, not by us. It rises on its own as your volume grows and your quality holds. Worth watching before a large campaign.',
    },
    {
      route: '/whatsapp',
      target: 'whatsapp.namespace',
      title: 'Template namespace',
      description:
        'The identifier your approved templates are submitted under. You rarely need it by hand, but support will ask for it.',
    },
    {
      route: '/whatsapp',
      target: 'whatsapp.refresh',
      title: 'Refreshing from Meta',
      description:
        'Quality ratings, sending limits and profile changes are Meta’s to change. Refresh pulls the current values rather than waiting for the next automatic sync.',
    },

    /* --- the other half of sending --- */
    {
      route: '/templates',
      target: 'templates.new',
      title: 'You still need a template',
      description:
        'WhatsApp does not let you message someone out of the blue. Every conversation you start must open with a template Meta has approved — so this is the next stop after connecting.',
    },
    {
      route: '/campaigns',
      target: 'campaigns.new',
      title: 'Sending your first message',
      description:
        'With a connected number and an approved template, a campaign is the third piece: choose the template, pick the audience, and send now or on a schedule. That is the whole path from connected to delivered.',
    },
  ],
};

const CONTACTS_TOUR: GuidedTour = {
  id: 'contacts-tour',
  title: 'Contacts',
  description: 'Learn how to manage contacts.',
  type: 'module',
  module: 'contacts',
  requiresRoute: '/contacts',
  steps: [
    {
      route: '/contacts',
      title: 'Your audience',
      description:
        'Everyone you can message lives here. A contact needs a phone number in international format — that is the one thing that decides whether a message can be delivered at all.',
    },
    {
      route: '/contacts',
      target: 'contacts.add',
      title: 'Adding one person',
      description:
        'Choose the country first: it decides how a number starting with 0 is read. The form shows you the number as it will actually be stored, so a wrong country is obvious before you save rather than at send time.',
    },
    {
      route: '/contacts',
      target: 'contacts.import',
      title: 'Importing a spreadsheet',
      description:
        'For anything more than a handful. You map your columns once, and the preview flags duplicates and numbers written in local format before a single row is written.',
    },
    {
      route: '/groups',
      title: 'Grouping them',
      description:
        'Campaigns send to groups, not to individuals. A contact can be in several, and a campaign counts them once — so overlapping groups will not double-message anybody.',
    },
  ],
};

const TEMPLATES_TOUR: GuidedTour = {
  id: 'templates-tour',
  title: 'Templates',
  description: 'Learn how to create and use message templates.',
  type: 'module',
  module: 'templates',
  requiresRoute: '/templates',
  steps: [
    {
      route: '/templates',
      title: 'Why templates exist',
      description:
        'WhatsApp only lets a business open a conversation with wording Meta has approved in advance. Everything you send to someone who has not messaged you first starts as one of these.',
    },
    {
      route: '/templates',
      target: 'templates.new',
      title: 'Writing one',
      description:
        'Pick a category, write the body, and use {{1}}-style placeholders for anything that changes per recipient. The editor enforces Meta’s rules as you type, so rejections for formatting are rare.',
    },
    {
      route: '/templates',
      target: 'templates.search',
      title: 'Finding one later',
      description:
        'Search matches the name and the body copy — useful when you remember what a template said but not what it was called. The status filters separate approved templates from those still under review.',
    },
  ],
};

const CAMPAIGNS_TOUR: GuidedTour = {
  id: 'campaigns-tour',
  title: 'Campaigns',
  description: 'Learn how to create and manage campaigns.',
  type: 'module',
  module: 'campaigns',
  requiresRoute: '/campaigns',
  steps: [
    {
      route: '/campaigns',
      title: 'Campaigns',
      description:
        'A campaign is an approved template, an audience and a time. Every run is recorded, so you can always see what went out, to whom, and what happened to it.',
    },
    {
      route: '/campaigns',
      target: 'campaigns.new',
      title: 'Creating one',
      description:
        'The wizard walks through template, audience, schedule and review. It shows the real recipient count — deduplicated and opt-out aware — before you commit to anything.',
    },
    {
      route: '/campaigns',
      target: 'campaigns.search',
      title: 'Finding a campaign',
      description:
        'Search matches the campaign name and the template it used. The status filters narrow to what is sending now, scheduled for later, or already finished.',
    },
    {
      route: '/reports',
      title: 'What happened next',
      description:
        'Delivery, read and failure figures across your campaigns, with the reason behind anything that did not arrive.',
    },
  ],
};

/** The AI copywriter: what to ask, and what to do with the answer. */
const AI_ASSISTANT_TOUR: GuidedTour = {
  id: 'ai-assistant-tour',
  title: 'AI Assistant',
  description: 'Learn how to write marketing copy with AI.',
  type: 'module',
  module: 'ai',
  requiresRoute: '/ai-assistant',
  steps: [
    {
      route: '/ai-assistant',
      title: 'AI Assistant',
      description:
        'Marketing copy on demand — promotions, reminders, follow-ups and announcements, written for WhatsApp. Each request uses AI credits from your plan.',
    },
    {
      route: '/ai-assistant',
      target: 'ai.prompt',
      title: 'Say what you need',
      description:
        'Name the business, the offer and who it is for. "20% off teeth whitening for new patients this week" gets a far better result than "a promotion".',
    },
    {
      route: '/ai-assistant',
      target: 'ai.examples',
      title: 'Not sure where to start?',
      description: 'Pick an example to fill the box, then change the details to match your business.',
    },
    {
      route: '/ai-assistant',
      target: 'ai.generate',
      title: 'Generate',
      description: 'Takes a few seconds. Not quite right? Adjust the request and generate again.',
    },
    {
      route: '/ai-assistant',
      target: 'ai.response',
      title: 'Use the result',
      description:
        'Copy it into a new template or a campaign. Read it through first — you are the one sending it, so check names, prices and dates.',
    },
  ],
};

/** Automatic replies: when they fire, and what the assistant is allowed to say. */
const AUTO_REPLY_TOUR: GuidedTour = {
  id: 'auto-reply-tour',
  title: 'Auto-reply',
  description: 'Learn how the assistant answers customers for you, and how to teach it your business.',
  type: 'module',
  module: 'ai',
  requiresRoute: '/ai-assistant/auto-reply',
  steps: [
    {
      route: '/ai-assistant/auto-reply',
      title: 'Auto-reply',
      description:
        'The assistant answers customers on WhatsApp when your team has not yet — only inside the 24-hour window, and never after someone from your team has replied.',
    },
    {
      route: '/ai-assistant/auto-reply',
      target: 'autoreply.switch',
      title: 'The master switch',
      description: 'Turns every automatic reply on or off at once. Your settings are kept either way.',
    },
    {
      route: '/ai-assistant/auto-reply',
      target: 'autoreply.occasions',
      title: 'When it replies',
      description:
        'A greeting, a new customer’s first message, or a message nobody has answered. Occasions your plan does not include are shown with an upgrade link.',
    },
    {
      route: '/ai-assistant/auto-reply',
      target: 'autoreply.timing',
      title: 'Timing and limits',
      description:
        'A short wait gives your team the chance to answer first. The daily cap stops one customer from getting a stream of automatic messages.',
    },
    {
      route: '/ai-assistant/auto-reply',
      target: 'autoreply.knowledge',
      title: 'What it knows',
      description:
        'The assistant answers only from the rows you upload: business info, FAQs, products and prices, policies and rules. For anything else it sends your holding message, or nothing — your choice.',
    },
    {
      route: '/ai-assistant/auto-reply',
      target: 'autoreply.template',
      title: 'Start from the template',
      description:
        'An Excel file with dropdowns for each option and example rows. Fill it in, upload it, and check the preview — problems are pointed out by row number before anything is saved.',
    },
    {
      route: '/ai-assistant/auto-reply',
      target: 'autoreply.allowance',
      title: 'Your monthly allowance',
      description:
        'How many automatic replies your plan includes this cycle. When it runs out they pause until the next cycle, and admins are notified.',
    },
  ],
};

/**
 * The registry. Order is the order Settings lists them in.
 *
 * The general tour is first because it is the one a lost user wants.
 */
export const GUIDED_TOURS: readonly GuidedTour[] = [
  GENERAL_TOUR,
  WHATSAPP_TOUR,
  CONTACTS_TOUR,
  CAMPAIGNS_TOUR,
  TEMPLATES_TOUR,
  AI_ASSISTANT_TOUR,
  AUTO_REPLY_TOUR,
];

/** The general tour's id, for the one place that genuinely needs to name it. */
export const GENERAL_TOUR_ID = GENERAL_TOUR.id;

export function findTour(id: string): GuidedTour | null {
  return GUIDED_TOURS.find((tour) => tour.id === id) ?? null;
}
