import nodemailer, { Transporter } from 'nodemailer';
import { config } from '../../config';
import { logger } from '../logger';
import Handlebars from 'handlebars';
import path from 'path';
import fs from 'fs';

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
}

export class EmailService {
  private readonly transporter: Transporter;
  private templates: Map<string, Handlebars.TemplateDelegate> = new Map();

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      auth: config.SMTP_USER
        ? { user: config.SMTP_USER, pass: config.SMTP_PASS }
        : undefined,
    });
  }

  private loadTemplate(name: string): Handlebars.TemplateDelegate {
    if (this.templates.has(name)) {
      return this.templates.get(name)!;
    }

    const templatePath = path.join(__dirname, 'templates', `${name}.hbs`);

    if (fs.existsSync(templatePath)) {
      const source = fs.readFileSync(templatePath, 'utf-8');
      const template = Handlebars.compile(source);
      this.templates.set(name, template);
      return template;
    }

    // Fallback to basic template
    const fallback = Handlebars.compile('<h1>{{title}}</h1><p>{{body}}</p>');
    return fallback;
  }

  async sendEmail(options: EmailOptions): Promise<void> {
    let html = options.html;

    if (options.template && options.templateData) {
      const template = this.loadTemplate(options.template);
      html = template({
        ...options.templateData,
        appName: config.APP_NAME,
        appUrl: config.APP_URL,
        year: new Date().getFullYear(),
      });
    }

    try {
      const info = await this.transporter.sendMail({
        from: `"${config.FROM_NAME}" <${config.FROM_EMAIL}>`,
        to: Array.isArray(options.to) ? options.to.join(', ') : options.to,
        subject: options.subject,
        html,
        text: options.text,
        attachments: options.attachments,
      });

      logger.info({ messageId: info.messageId, to: options.to }, 'Email sent');
    } catch (error) {
      logger.error({ error, to: options.to }, 'Email send failed');
      throw error;
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

  async sendOTPEmail(to: string, data: { name: string; otp: string; expiresIn: string }): Promise<void> {
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
    pdfBuffer?: Buffer
  ): Promise<void> {
    return this.sendEmail({
      to,
      subject: `Invoice ${data.invoiceNumber} from ${config.APP_NAME}`,
      template: 'invoice',
      templateData: data,
      attachments: pdfBuffer
        ? [{ filename: `Invoice-${data.invoiceNumber}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }]
        : undefined,
    });
  }

  async sendPaymentReminderEmail(
    to: string,
    data: { customerName: string; invoiceNumber: string; amount: string; dueDate: string; payUrl: string }
  ): Promise<void> {
    return this.sendEmail({
      to,
      subject: `Payment Reminder: Invoice ${data.invoiceNumber}`,
      template: 'payment-reminder',
      templateData: data,
    });
  }

  async sendLowStockAlertEmail(
    to: string,
    data: { products: Array<{ name: string; sku: string; currentStock: number; reorderPoint: number }> }
  ): Promise<void> {
    return this.sendEmail({
      to,
      subject: `Low Stock Alert - Action Required`,
      template: 'low-stock',
      templateData: data,
    });
  }
}

export const emailService = new EmailService();
