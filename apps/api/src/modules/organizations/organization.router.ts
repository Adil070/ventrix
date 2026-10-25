import { Router } from 'express';
import { Request, Response } from 'express';
import { prisma } from '../../infrastructure/database';
import { successResponse } from '../../shared/helpers/response.helper';
import { authMiddleware } from '../../shared/middleware/auth.middleware';
import { tenantMiddleware } from '../../shared/middleware/tenant';
import { requireOrgRole } from '../../shared/middleware/org-role';
import { z } from 'zod';
import { Prisma, UserRole } from '@prisma/client';
import { BadRequestError, NotFoundError } from '../../shared/errors';
import { config } from '../../config';
import { logger } from '../../infrastructure/logger';
import { emailService, describeSmtpError } from '../../infrastructure/email';
import { encryptSecret, decryptSecret } from '../../shared/utils/secret-box';

const router = Router();
router.use(authMiddleware, tenantMiddleware);

// ─── Organization Details ─────────────────────────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  const org = await prisma.organization.findUnique({
    where: { id: req.organizationId! },
    include: { branches: true, subscription: true, _count: { select: { customers: true, suppliers: true, products: true, invoices: true } } },
  });
  res.json(successResponse(org));
});

const UpdateOrgSchema = z.object({
  name: z.string().min(1).optional(),
  legalName: z.string().optional(),
  gstin: z.string().optional(),
  pan: z.string().optional(),
  cin: z.string().optional(),
  tan: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  website: z.string().url().optional(),
  industry: z.string().optional(),
  businessType: z.string().optional(),
  address: z.record(z.string()).optional(),
  billingAddress: z.record(z.string()).optional(),
  bankDetails: z.record(z.any()).optional(),
  invoicePrefix: z.string().max(10).optional(),
  purchasePrefix: z.string().max(10).optional(),
  quotationPrefix: z.string().max(10).optional(),
  currency: z.string().length(3).optional(),
  timezone: z.string().optional(),
  financialYearStart: z.number().min(1).max(12).optional(),
  settings: z.record(z.any()).optional(),
});

// Business details, settings and branches are changed by owners and admins only; every member can read them.
const orgAdmins = requireOrgRole(UserRole.ORG_OWNER, UserRole.BRANCH_ADMIN);

router.put('/', orgAdmins, async (req: Request, res: Response) => {
  const input = UpdateOrgSchema.parse(req.body);
  const org = await prisma.organization.update({
    where: { id: req.organizationId! },
    data: { ...input, address: input.address as Prisma.InputJsonValue, billingAddress: input.billingAddress as Prisma.InputJsonValue, bankDetails: input.bankDetails as Prisma.InputJsonValue, settings: input.settings as Prisma.InputJsonValue },
  });
  res.json(successResponse(org, 'Organization updated'));
});

// ─── Email sending account (Settings → Email) ─────────────────────────────────
// The business's own mail account (e.g. its Gmail) for emails sent on its behalf. The password is write-only:
// stored encrypted and never returned. Saving clears "verified"; business emails use the account only after a
// test email succeeds, and go from the platform account until then.
const GMAIL = { host: 'smtp.gmail.com', port: 465, secure: true };

const EmailSettingsSchema = z.object({
  provider: z.enum(['gmail', 'custom']).default('gmail'),
  host: z.string().trim().min(1).max(253).optional(),
  port: z.coerce.number().int().min(1).max(65535).optional(),
  secure: z.boolean().optional(),
  username: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(256).optional(), // omit to keep the saved one
  fromEmail: z.string().trim().email().optional().or(z.literal('')),
  fromName: z.string().trim().max(100).optional(),
}).superRefine((d, ctx) => {
  if (d.provider === 'custom' && (!d.host || !d.port || d.secure === undefined)) {
    ctx.addIssue({ code: 'custom', path: ['host'], message: 'Server, port and SSL setting are required' });
  }
  // Gmail only sends as the signed-in address; other providers need a real sender address.
  const sender = d.provider === 'gmail' ? d.username : d.fromEmail || d.username;
  if (!z.string().email().safeParse(sender).success) {
    ctx.addIssue({ code: 'custom', path: [d.provider === 'gmail' ? 'username' : 'fromEmail'], message: 'Enter a valid email address' });
  }
});

type EmailSettingsRow = Prisma.OrganizationEmailSettingsGetPayload<object>;

function publicEmailSettings(s: EmailSettingsRow | null) {
  const platformFrom = config.FROM_EMAIL;
  if (!s) return { configured: false as const, platformFrom };
  const { passwordEncrypted: _secret, organizationId: _org, ...visible } = s;
  return { configured: true as const, ...visible, provider: s.host === GMAIL.host ? 'gmail' : 'custom', platformFrom };
}

router.get('/email-settings', orgAdmins, async (req: Request, res: Response) => {
  const settings = await prisma.organizationEmailSettings.findUnique({ where: { organizationId: req.organizationId! } });
  res.json(successResponse(publicEmailSettings(settings)));
});

router.put('/email-settings', orgAdmins, async (req: Request, res: Response) => {
  const input = EmailSettingsSchema.parse(req.body);
  const existing = await prisma.organizationEmailSettings.findUnique({ where: { organizationId: req.organizationId! }, select: { id: true } });
  if (!input.password && !existing) throw new BadRequestError('Enter the password (for Gmail, the App Password)');

  const isGmail = input.provider === 'gmail';
  // Gmail shows App Passwords in groups of four; the spaces are not part of it.
  const password = isGmail ? input.password?.replace(/\s+/g, '') : input.password;
  const data = {
    ...(isGmail ? GMAIL : { host: input.host!, port: input.port!, secure: input.secure! }),
    username: input.username,
    fromEmail: isGmail ? input.username : input.fromEmail || input.username,
    fromName: input.fromName || null,
    verifiedAt: null,
    lastError: null,
  };
  const passwordEncrypted = password ? encryptSecret(password) : undefined;
  const saved = existing
    ? await prisma.organizationEmailSettings.update({ where: { id: existing.id }, data: { ...data, passwordEncrypted } })
    : await prisma.organizationEmailSettings.create({ data: { organizationId: req.organizationId!, ...data, passwordEncrypted: passwordEncrypted! } });
  res.json(successResponse(publicEmailSettings(saved), 'Saved. Send a test email to start using it.'));
});

// Sends a test email to the signed-in admin through the saved account; success marks it verified.
router.post('/email-settings/test', orgAdmins, async (req: Request, res: Response) => {
  const settings = await prisma.organizationEmailSettings.findUnique({
    where: { organizationId: req.organizationId! },
    include: { organization: { select: { name: true } } },
  });
  if (!settings) throw new NotFoundError('Email settings');
  const me = await prisma.user.findUniqueOrThrow({ where: { id: req.userId! }, select: { email: true } });

  const fail = async (message: string, error?: unknown) => {
    logger.warn({ error, organizationId: req.organizationId }, 'Email settings test failed');
    await prisma.organizationEmailSettings.update({ where: { id: settings.id }, data: { verifiedAt: null, lastError: message } });
    throw new BadRequestError(message);
  };

  let password: string;
  try {
    password = decryptSecret(settings.passwordEncrypted);
  } catch (error) {
    return fail('The saved password can no longer be read. Enter the password again and save.', error);
  }
  try {
    await emailService.sendTestEmail(
      { ...settings, password, fromName: settings.fromName || settings.organization.name },
      me.email,
      settings.organization.name,
    );
  } catch (error) {
    return fail(describeSmtpError(error), error);
  }

  const saved = await prisma.organizationEmailSettings.update({ where: { id: settings.id }, data: { verifiedAt: new Date(), lastError: null } });
  res.json(successResponse(publicEmailSettings(saved), `Test email sent to ${me.email}`));
});

// Go back to sending business emails from the platform account.
router.delete('/email-settings', orgAdmins, async (req: Request, res: Response) => {
  await prisma.organizationEmailSettings.deleteMany({ where: { organizationId: req.organizationId! } });
  res.json(successResponse(publicEmailSettings(null), `Emails will be sent by ${config.APP_NAME}`));
});

// ─── Branches ─────────────────────────────────────────────────────────────────
router.get('/branches', async (req: Request, res: Response) => {
  const branches = await prisma.branch.findMany({ where: { organizationId: req.organizationId! }, orderBy: { name: 'asc' } });
  res.json(successResponse(branches));
});

const CreateBranchSchema = z.object({
  name: z.string().min(1),
  code: z.string().optional(),
  gstin: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  address: z.record(z.string()).optional(),
  isHeadOffice: z.boolean().default(false),
});

router.post('/branches', orgAdmins, async (req: Request, res: Response) => {
  const input = CreateBranchSchema.parse(req.body);
  const branch = await prisma.branch.create({ data: { organizationId: req.organizationId!, ...input, address: input.address as Prisma.InputJsonValue } });
  res.status(201).json(successResponse(branch, 'Branch created'));
});

router.put('/branches/:id', orgAdmins, async (req: Request, res: Response) => {
  const input = CreateBranchSchema.partial().parse(req.body);
  const existing = await prisma.branch.findFirst({ where: { id: req.params.id, organizationId: req.organizationId! }, select: { id: true } });
  if (!existing) throw new NotFoundError('Branch', req.params.id);
  const branch = await prisma.branch.update({ where: { id: req.params.id }, data: { ...input, address: input.address as Prisma.InputJsonValue } });
  res.json(successResponse(branch));
});

// ─── Audit Logs ───────────────────────────────────────────────────────────────
router.get('/audit-logs', async (req: Request, res: Response) => {
  const { page = 1, limit = 20, action, userId, fromDate, toDate } = req.query as any;
  const where: Prisma.AuditLogWhereInput = {
    organizationId: req.organizationId!,
    ...(action && { action: { contains: action, mode: 'insensitive' } }),
    ...(userId && { userId }),
    ...(fromDate && { createdAt: { gte: new Date(fromDate) } }),
    ...(toDate && { createdAt: { lte: new Date(toDate) } }),
  };
  const [data, total] = await Promise.all([
    prisma.auditLog.findMany({ where, skip: (+page - 1) * +limit, take: +limit, orderBy: { createdAt: 'desc' }, include: { user: { select: { firstName: true, lastName: true, email: true } } } }),
    prisma.auditLog.count({ where }),
  ]);
  res.json(successResponse({ data, meta: { page: +page, limit: +limit, total, totalPages: Math.ceil(total / +limit) } }));
});

// ─── Price Lists ──────────────────────────────────────────────────────────────
router.get('/price-lists', async (req: Request, res: Response) => {
  const lists = await prisma.priceList.findMany({ where: { organizationId: req.organizationId! } });
  res.json(successResponse(lists));
});

router.post('/price-lists', async (req: Request, res: Response) => {
  const { name, description, discountPercentage, isDefault } = req.body;
  const list = await prisma.priceList.create({ data: { organizationId: req.organizationId!, name, description, discountValue: discountPercentage ?? 0, isDefault } });
  res.status(201).json(successResponse(list));
});

// ─── Payment Terms ────────────────────────────────────────────────────────────
router.get('/payment-terms', async (req: Request, res: Response) => {
  const terms = await prisma.paymentTerm.findMany({ where: { organizationId: req.organizationId! }, orderBy: { days: 'asc' } });
  res.json(successResponse(terms));
});

export { router as organizationRouter };
