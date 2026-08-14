import type {
  PaymentChannelDetailsDto,
  PaymentChannelDto,
  PaymentRequestDto,
  PaymentRequestStatusDto,
} from '@core/dto/payment-request.dto';

/**
 * In-memory stand-in for the manual-payment endpoints.
 *
 * The QR images are placeholders generated here as data URIs — they encode
 * nothing and are not scannable. They exist so the layout is real while the
 * actual codes are pending; replacing them means serving `qrImageUrl` from the
 * API and deleting `placeholderQr` below. Nothing else has to change.
 */

/* ------------------------------------------------------------------ *
 * Placeholder QR
 * ------------------------------------------------------------------ */

/** Deterministic pattern, so a given channel always renders the same code. */
function seeded(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return value / 4_294_967_296;
  };
}

/**
 * Draws something that reads as a QR code at a glance: finder squares in three
 * corners and a pseudo-random field between them. Deliberately not a real code
 * — scanning it does nothing, which is the honest behaviour for a placeholder.
 */
function placeholderQr(label: string, seed: number): string {
  const modules = 25;
  const size = 250;
  const unit = size / modules;
  const random = seeded(seed);
  const cells: string[] = [];

  const inFinder = (x: number, y: number): boolean => {
    const corner = (cx: number, cy: number): boolean =>
      x >= cx && x < cx + 7 && y >= cy && y < cy + 7;
    return corner(0, 0) || corner(modules - 7, 0) || corner(0, modules - 7);
  };

  for (let y = 0; y < modules; y++) {
    for (let x = 0; x < modules; x++) {
      if (inFinder(x, y) || random() > 0.5) {
        continue;
      }
      cells.push(
        `<rect x="${(x * unit).toFixed(1)}" y="${(y * unit).toFixed(1)}" width="${unit.toFixed(1)}" height="${unit.toFixed(1)}"/>`,
      );
    }
  }

  const finder = (cx: number, cy: number): string => {
    const x = cx * unit;
    const y = cy * unit;
    const outer = 7 * unit;
    return `
      <rect x="${x}" y="${y}" width="${outer}" height="${outer}" fill="none" stroke="#0f172a" stroke-width="${unit}"/>
      <rect x="${x + 2 * unit}" y="${y + 2 * unit}" width="${3 * unit}" height="${3 * unit}"/>`;
  };

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size + 26}" width="${size}" height="${size + 26}">
    <rect width="100%" height="100%" fill="#ffffff"/>
    <g fill="#0f172a">${cells.join('')}${finder(0, 0)}${finder(modules - 7, 0)}${finder(0, modules - 7)}</g>
    <text x="${size / 2}" y="${size + 18}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="12" fill="#64748b">${label} · sample code</text>
  </svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/* ------------------------------------------------------------------ *
 * Channels
 * ------------------------------------------------------------------ */

/**
 * Mutable, because the platform edits these. The real API seeds them
 * **inactive** with placeholder account numbers; the mock seeds them ready so
 * the checkout is explorable without setting them up first.
 */
export const paymentChannelStore: PaymentChannelDetailsDto[] = [
  {
    channel: 'JazzCash',
    displayName: 'JazzCash',
    accountTitle: 'NextReach Technologies',
    accountNumber: '0300 1234567',
    bankName: null,
    qrImageUrl: placeholderQr('JazzCash', 7),
    instructions: [
      'Open the JazzCash app and choose Scan QR.',
      'Scan the code and enter the exact amount shown above.',
      'Complete the transfer and take a screenshot of the receipt.',
    ],
    isActive: true,
  },
  {
    channel: 'EasyPaisa',
    displayName: 'EasyPaisa',
    accountTitle: 'NextReach Technologies',
    accountNumber: '0345 7654321',
    bankName: null,
    qrImageUrl: placeholderQr('EasyPaisa', 23),
    instructions: [
      'Open EasyPaisa and tap Scan & Pay.',
      'Scan the code and enter the exact amount shown above.',
      'Save the confirmation screen as your receipt.',
    ],
    isActive: true,
  },
  {
    channel: 'BankTransfer',
    displayName: 'Bank transfer',
    accountTitle: 'NextReach Technologies (Pvt) Ltd',
    accountNumber: 'PK36 SCBL 0000 0011 2345 6702',
    bankName: 'Standard Chartered',
    qrImageUrl: placeholderQr('Bank', 41),
    instructions: [
      'Transfer the exact amount to the IBAN shown.',
      'Use your organisation name as the payment reference.',
      'Bank transfers can take a few hours to appear on our side.',
    ],
    isActive: true,
  },
];

/* ------------------------------------------------------------------ *
 * Requests
 * ------------------------------------------------------------------ */

export interface MockPaymentRequest extends PaymentRequestDto {
  /** Data URI of the uploaded proof, so the reviewer sees the real upload. */
  proofDataUrl: string;
}

const SEED_PROOF = placeholderQr('Receipt', 99);

export const paymentRequestStore: MockPaymentRequest[] = [
  {
    id: 'pay_1042',
    status: 'Pending',
    planId: 'plan_growth',
    planName: 'Growth',
    billingCycle: 'Monthly',
    amount: 24000,
    currency: 'PKR',
    channel: 'JazzCash',
    reference: 'TXN-84920113',
    note: 'Paid from the finance account.',
    proofUrl: '/billing/payment-requests/pay_1042/proof',
    proofFileName: 'jazzcash-receipt.png',
    proofContentType: 'image/png',
    organisation: 'Northwind Retail',
    submittedByName: 'Amara Chen',
    submittedByEmail: 'admin@nextreach.io',
    adminId: 'adm_1',
    submittedAt: new Date(Date.now() - 40 * 60_000).toISOString(),
    reviewedAt: null,
    reviewedBy: null,
    rejectionReason: null,
    proofDataUrl: SEED_PROOF,
  },
  {
    id: 'pay_1041',
    status: 'Pending',
    planId: 'plan_scale',
    planName: 'Scale',
    billingCycle: 'Yearly',
    amount: 420000,
    currency: 'PKR',
    channel: 'BankTransfer',
    reference: '',
    note: '',
    proofUrl: '/billing/payment-requests/pay_1041/proof',
    proofFileName: 'bank-slip.pdf',
    proofContentType: 'application/pdf',
    organisation: 'Pharmacy',
    submittedByName: 'Hassan Karim',
    submittedByEmail: 'pharma@yopmail.com',
    adminId: 'adm_2',
    submittedAt: new Date(Date.now() - 5 * 3_600_000).toISOString(),
    reviewedAt: null,
    reviewedBy: null,
    rejectionReason: null,
    proofDataUrl: SEED_PROOF,
  },
  {
    id: 'pay_1038',
    status: 'Approved',
    planId: 'plan_starter',
    planName: 'Starter',
    billingCycle: 'Monthly',
    amount: 9000,
    currency: 'PKR',
    channel: 'EasyPaisa',
    reference: 'TXN-77120044',
    note: '',
    proofUrl: '/billing/payment-requests/pay_1038/proof',
    proofFileName: 'easypaisa.png',
    proofContentType: 'image/png',
    organisation: 'Shop',
    submittedByName: 'Shop Admin',
    submittedByEmail: 'shop@yopmail.com',
    adminId: 'adm_3',
    submittedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    reviewedAt: new Date(Date.now() - 2 * 86_400_000 + 3_600_000).toISOString(),
    reviewedBy: 'Priya Raman',
    rejectionReason: null,
    proofDataUrl: SEED_PROOF,
  },
  {
    id: 'pay_1035',
    status: 'Rejected',
    planId: 'plan_growth',
    planName: 'Growth',
    billingCycle: 'Monthly',
    amount: 24000,
    currency: 'PKR',
    channel: 'JazzCash',
    reference: '',
    note: 'Sent from a personal number.',
    proofUrl: '/billing/payment-requests/pay_1035/proof',
    proofFileName: 'screenshot.jpg',
    proofContentType: 'image/jpeg',
    organisation: 'retail',
    submittedByName: 'Retail Admin',
    submittedByEmail: 'retail@yopmail.com',
    adminId: 'adm_4',
    submittedAt: new Date(Date.now() - 4 * 86_400_000).toISOString(),
    reviewedAt: new Date(Date.now() - 4 * 86_400_000 + 7_200_000).toISOString(),
    reviewedBy: 'Priya Raman',
    rejectionReason:
      'The screenshot shows PKR 4,000 but the Growth plan is PKR 24,000 per month. Please send the balance and upload the new receipt.',
    proofDataUrl: SEED_PROOF,
  },
];

let nextId = 1043;

export function createPaymentRequest(
  fields: Omit<
    MockPaymentRequest,
    'id' | 'status' | 'submittedAt' | 'reviewedAt' | 'reviewedBy' | 'rejectionReason' | 'proofUrl'
  >,
): MockPaymentRequest {
  const id = `pay_${nextId++}`;
  const request: MockPaymentRequest = {
    ...fields,
    id,
    status: 'Pending',
    proofUrl: `/billing/payment-requests/${id}/proof`,
    submittedAt: new Date().toISOString(),
    reviewedAt: null,
    reviewedBy: null,
    rejectionReason: null,
  };
  paymentRequestStore.unshift(request);
  return request;
}

export function findPaymentRequest(id: string): MockPaymentRequest | undefined {
  return paymentRequestStore.find((request) => request.id === id);
}

export function decidePaymentRequest(
  id: string,
  status: PaymentRequestStatusDto,
  rejectionReason: string | null,
): MockPaymentRequest | undefined {
  const index = paymentRequestStore.findIndex((request) => request.id === id);
  if (index === -1) {
    return undefined;
  }

  const updated: MockPaymentRequest = {
    ...paymentRequestStore[index],
    status,
    reviewedAt: new Date().toISOString(),
    reviewedBy: 'Priya Raman',
    rejectionReason,
  };
  // Replaced rather than mutated: the list is handed to signals, and reusing
  // the same reference would make `set()` a no-op under `Object.is`.
  paymentRequestStore[index] = updated;
  return updated;
}

export function channelDetails(channel: PaymentChannelDto): PaymentChannelDetailsDto | undefined {
  return paymentChannelStore.find((entry) => entry.channel === channel);
}

/** Replaced rather than mutated, so signal `set()` is not a no-op under `Object.is`. */
export function updateChannel(
  channel: PaymentChannelDto,
  patch: Partial<PaymentChannelDetailsDto>,
): PaymentChannelDetailsDto | undefined {
  const index = paymentChannelStore.findIndex((entry) => entry.channel === channel);
  if (index === -1) {
    return undefined;
  }
  paymentChannelStore[index] = { ...paymentChannelStore[index], ...patch, channel };
  return paymentChannelStore[index];
}

export function activeChannels(): readonly PaymentChannelDetailsDto[] {
  return paymentChannelStore.filter((entry) => entry.isActive);
}

/** Turns the stored data URI back into bytes for the proof download. */
export function proofBlobFor(request: MockPaymentRequest): Blob {
  const [meta, payload] = request.proofDataUrl.split(',');
  const isBase64 = meta.includes(';base64');
  const type = meta.slice(5, meta.indexOf(';') === -1 ? undefined : meta.indexOf(';'));

  if (isBase64) {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type });
  }

  return new Blob([decodeURIComponent(payload)], { type });
}
