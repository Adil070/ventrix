import nodemailer, { Transporter } from 'nodemailer';
import type Mail from 'nodemailer/lib/mailer';
import dns from 'dns/promises';
import net from 'net';
import Handlebars from 'handlebars';
import { config } from '../../config';
import { logger } from '../logger';
import { prisma } from '../database';
import { decryptSecret } from '../../shared/utils/secret-box';
import { TEMPLATES } from './templates';

/**
 * Two kinds of sender:
 * - Platform account (SMTP_* env, e.g. the Ventrix Gmail): account emails such as welcome, OTP, password reset.
 * - A business's own account (OrganizationEmailSettings, set in Settings → Email): emails sent for that
 *   business (pass `organizationId`). Used once a test send has worked; until then, or if it fails, the
 *   platform account sends instead, under the business's name with replies going to the business.
 */

interface EmailOptions {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  template?: string;
  templateData?: Record<string, unknown>;
  attachments?: Array<{
    filename: string;
    content?: Buffer;
    path?: string;
    contentType?: string;
  }>;
  /** Send on behalf of this business (its own account when set up, else the platform account). */
  organizationId?: string;
}

export interface SmtpAccount {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
}

export interface SalesReportEmailData {
  organizationName: string;
  reportDate: string;
  slotLabel: string;
  isClosing: boolean;
  currency: string;
  totals: {
    invoiceCount: number;
    totalSales: number;
    taxAmount: number;
    discountAmount: number;
    averageBill: number;
    collected: number;
    outstanding: number;
  };
  collectedByMode: Array<{ mode: string; amount: number }>;
  topProducts: Array<{ name: string; quantity: number; amount: number }>;
  viewUrl: string;
}

// Give up quickly on a wrong host or port instead of hanging a request or a queue worker.
const TIMEOUTS = { connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000 };

export function createSmtpTransport(account: SmtpAccount): Transporter {
  return nodemailer.createTransport({
    host: account.host,
    port: account.port,
    secure: account.secure,
    auth: { user: account.username, pass: account.password },
    ...TIMEOUTS,
  });
}

/** Ports a business may use for its own SMTP account; anything else could be used to probe other services. */
export const CLIENT_SMTP_PORTS = [465, 587, 2525];

function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7));
  return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80');
}

/**
 * A business-supplied SMTP host must be a public mail server: in production its port must be a mail port and
 * it must not resolve to a private address, so the test button cannot reach the server's own network.
 */
export async function assertPublicSmtpHost(host: string, port: number): Promise<void> {
  if (!config.IS_PRODUCTION) return; // allow MailHog/localhost while developing
  if (!CLIENT_SMTP_PORTS.includes(port)) throw new Error(`Use port ${CLIENT_SMTP_PORTS.join(', ')}`);
  const addresses = await dns.lookup(host, { all: true }).catch(() => []);
  if (!addresses.length) throw Object.assign(new Error('Mail server not found'), { code: 'ENOTFOUND' });
  if (addresses.some((a) => isPrivateAddress(a.address))) throw new Error('This mail server address is not allowed');
}

/** Plain-language reason for Settings → Email; raw SMTP errors are logged, never shown. */
export function describeSmtpError(error: unknown): string {
  const code = (error as { code?: string })?.code;
  if (code === 'EAUTH') return 'The email provider rejected the login. For Gmail, use an App Password, not your normal password.';
  if (code && ['ETIMEDOUT', 'ECONNECTION', 'ESOCKET', 'ECONNREFUSED', 'ENOTFOUND', 'EDNS'].includes(code)) {
    return 'Could not connect to the mail server. Check the server name, port and SSL setting.';
  }
  if (code === 'EENVELOPE') return 'The email provider refused the sender or recipient address.';
  if (error instanceof Error && /not allowed|Use port/.test(error.message)) return error.message;
  return 'The email could not be sent. Check the settings and try again.';
}

type OwnSender = { settingsId: string; transporter: Transporter; from: Mail.Address };

export class EmailService {
  private readonly platform: Transporter;
  private templates: Map<string, Handlebars.TemplateDelegate> = new Map();
  /** One transporter per business, rebuilt when its settings change (keyed by updatedAt). */
  private orgTransports = new Map<string, { stamp: number; transporter: Transporter }>();

  constructor() {
    this.platform = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      auth: config.SMTP_USER
        ? { user: config.SMTP_USER, pass: config.SMTP_PASS }
        : undefined,
      ...TIMEOUTS,
    });
  }

  private render(name: string, data: Record<string, unknown>): string {
    let template = this.templates.get(name);
    if (!template) {
      const source = TEMPLATES[name];
      if (!source) throw new Error(`Unknown email template '${name}'`);
      template = Handlebars.compile(source);
      this.templates.set(name, template);
    }
    return template({ ...data, appName: config.APP_NAME, appUrl: config.APP_URL, year: new Date().getFullYear() });
  }

  /** Who sends for a business: its own verified account (if any) and the platform fallback identity. */
  private async orgSender(organizationId: string): Promise<{ own?: () => OwnSender; from: Mail.Address; replyTo?: string } | null> {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true, email: true, emailSettings: true },
    });
    if (!org) return null;
    const s = org.emailSettings;
    const fallback = { from: { name: org.name, address: config.FROM_EMAIL }, replyTo: s?.fromEmail ?? org.email ?? undefined };
    if (!s?.verifiedAt) return fallback;

    return {
      ...fallback,
      // Built lazily inside the send's try block: a password that no longer decrypts counts as a failed send.
      own: () => {
        const stamp = s.updatedAt.getTime();
        let cached = this.orgTransports.get(organizationId);
        if (!cached || cached.stamp !== stamp) {
          cached = { stamp, transporter: createSmtpTransport({ ...s, password: decryptSecret(s.passwordEncrypted) }) };
          this.orgTransports.set(organizationId, cached);
        }
        return { settingsId: s.id, transporter: cached.transporter, from: { name: s.fromName || org.name, address: s.fromEmail } };
      },
    };
  }

  private async recordOrgFailure(settingsId: string, error: unknown): Promise<void> {
    logger.warn({ error, settingsId }, 'Business email account failed; sending from the platform account');
    // A rejected login stays broken until the owner fixes it, so stop trying it until they re-test.
    const authFailed = (error as { code?: string })?.code === 'EAUTH';
    await prisma.organizationEmailSettings
      .update({ where: { id: settingsId }, data: { lastError: describeSmtpError(error), ...(authFailed && { verifiedAt: null }) } })
      .catch((e: unknown) => logger.error({ e }, 'Could not record email settings failure'));
  }

  async sendEmail(options: EmailOptions): Promise<void> {
    const html = options.template ? this.render(options.template, options.templateData ?? {}) : options.html;
    const message: Mail.Options = {
      to: Array.isArray(options.to) ? options.to.join(', ') : options.to,
      subject: options.subject,
      html,
      text: options.text,
      attachments: options.attachments,
    };

    const org = options.organizationId ? await this.orgSender(options.organizationId) : null;
    if (org?.own) {
      let settingsId: string | undefined;
      try {
        const own = org.own();
        settingsId = own.settingsId;
        const info = await own.transporter.sendMail({ ...message, from: own.from });
        logger.info({ messageId: info.messageId, to: options.to, organizationId: options.organizationId }, 'Email sent (business account)');
        return;
      } catch (error) {
        if (settingsId) await this.recordOrgFailure(settingsId, error);
        else logger.warn({ error, organizationId: options.organizationId }, 'Business email account unusable; sending from the platform account');
      }
    }

    try {
      const info = await this.platform.sendMail({
        ...message,
        from: org?.from ?? { name: config.FROM_NAME, address: config.FROM_EMAIL },
        replyTo: org?.replyTo,
      });
      logger.info({ messageId: info.messageId, to: options.to }, 'Email sent');
    } catch (error) {
      logger.error({ error, to: options.to }, 'Email send failed');
      throw error;
    }
  }

  /** Sends the Settings → Email test message through the given account; throws the raw SMTP error on failure. */
  async sendTestEmail(account: SmtpAccount & { fromEmail: string; fromName: string }, to: string, organizationName: string): Promise<void> {
    await assertPublicSmtpHost(account.host, account.port);
    const transporter = createSmtpTransport(account);
    try {
      await transporter.sendMail({
        from: { name: account.fromName, address: account.fromEmail },
        to,
        subject: `${config.APP_NAME} can now send email for ${organizationName}`,
        html: this.render('smtp-test', { organizationName, fromEmail: account.fromEmail }),
      });
    } finally {
      transporter.close();
    }
  }

  // Pre-built email senders
  async sendWelcomeEmail(to: string, data: { name: string; verifyUrl: string }): Promise<void> {
    return this.sendEmail({
      to,
      subject: `Welcome to ${config.APP_NAME}!`,
      template: 'welcome',
      templateData: data,
    });
  }

  async sendOTPEmail(to: string, data: { name?: string; otp: string; expiresIn: string }): Promise<void> {
    return this.sendEmail({
      to,
      subject: `Your OTP for ${config.APP_NAME}`,
      template: 'otp',
      templateData: data,
    });
  }

  async sendPasswordResetEmail(to: string, data: { name: string; resetUrl: string }): Promise<void> {
    return this.sendEmail({
      to,
      subject: `Reset your ${config.APP_NAME} password`,
      template: 'password-reset',
      templateData: data,
    });
  }

  async sendInvoiceEmail(
    to: string,
    data: { customerName: string; invoiceNumber: string; amount: string; dueDate: string; viewUrl: string },
    pdfBuffer?: Buffer,
    organizationId?: string
  ): Promise<void> {
    return this.sendEmail({
      to,
      subject: `Invoice ${data.invoiceNumber}`,
      template: 'invoice',
      templateData: data,
      organizationId,
      attachments: pdfBuffer
        ? [{ filename: `Invoice-${data.invoiceNumber}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }]
        : undefined,
    });
  }

  async sendPaymentReminderEmail(
    to: string,
    data: { customerName: string; invoiceNumber: string; amount: string; dueDate: string; payUrl: string },
    organizationId?: string
  ): Promise<void> {
    return this.sendEmail({
      to,
      subject: `Payment Reminder: Invoice ${data.invoiceNumber}`,
      template: 'payment-reminder',
      templateData: data,
      organizationId,
    });
  }

  // Built in code rather than a template: the tables are computed from the snapshot.
  async sendSalesReportEmail(to: string, data: SalesReportEmailData, organizationId?: string): Promise<void> {
    const esc = Handlebars.Utils.escapeExpression;
    const money = (n: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: data.currency || 'INR' }).format(n);
    const t = data.totals;
    const row = (label: string, value: string) =>
      `<tr><td style="padding:6px 0;color:#555">${label}</td><td style="padding:6px 0;text-align:right;font-weight:600">${value}</td></tr>`;
    const heading = data.isClosing ? 'End-of-day sales' : `Sales so far (${esc(data.slotLabel)})`;

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#111">
        <h2 style="margin-bottom:4px">${heading}</h2>
        <p style="margin-top:0;color:#555">${esc(data.organizationName)} · ${esc(data.reportDate)}</p>
        <table style="width:100%;border-collapse:collapse">
          ${row('Total sales', `${money(t.totalSales)} (${t.invoiceCount} bill${t.invoiceCount === 1 ? '' : 's'})`)}
          ${row('Average bill', money(t.averageBill))}
          ${row('GST included', money(t.taxAmount))}
          ${t.discountAmount > 0 ? row('Discount given', money(t.discountAmount)) : ''}
          ${row('Collected today', money(t.collected))}
          ${row('Still to collect on today’s bills', money(t.outstanding))}
        </table>
        ${data.collectedByMode.length ? `<h3>Collected by mode</h3><table style="width:100%;border-collapse:collapse">${data.collectedByMode.map((m) => row(esc(m.mode), money(m.amount))).join('')}</table>` : ''}
        ${data.topProducts.length ? `<h3>Best-selling items</h3><table style="width:100%;border-collapse:collapse">${data.topProducts.map((p) => row(`${esc(p.name)} × ${p.quantity}`, money(p.amount))).join('')}</table>` : ''}
        <p style="margin-top:24px"><a href="${esc(data.viewUrl)}">Open reports in ${esc(config.APP_NAME)}</a></p>
      </div>`;

    return this.sendEmail({
      to,
      subject: `${data.isClosing ? 'End-of-day sales' : `Sales update ${data.slotLabel}`}: ${money(t.totalSales)} · ${data.organizationName}`,
      html,
      organizationId,
    });
  }

  async sendLowStockAlertEmail(
    to: string,
    data: { products: Array<{ name: string; sku: string; currentStock: number; reorderPoint: number }> },
    organizationId?: string
  ): Promise<void> {
    return this.sendEmail({
      to,
      subject: `Low Stock Alert - Action Required`,
      template: 'low-stock',
      templateData: data,
      organizationId,
    });
  }
}

export const emailService = new EmailService();
