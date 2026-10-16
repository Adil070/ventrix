import { Router } from 'express';
import { Request, Response } from 'express';
import { prisma } from '../../infrastructure/database';
import { successResponse, paginatedResponse } from '../../shared/helpers/response.helper';
import { authMiddleware } from '../../shared/middleware/auth.middleware';
import { tenantMiddleware } from '../../shared/middleware/tenant';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { NotFoundError, BadRequestError } from '../../shared/errors';

const router = Router();
router.use(authMiddleware, tenantMiddleware);

const CreateLeadSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  company: z.string().optional(),
  source: z.string().optional(),
  status: z.enum(['NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST', 'INACTIVE']).default('NEW'),
  expectedValue: z.number().min(0).optional(),
  expectedCloseDate: z.coerce.date().optional(),
  assignedTo: z.string().optional(),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

const CreateTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  dueDate: z.coerce.date().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  assignedToId: z.string().optional(),
  leadId: z.string().optional(),
  status: z.enum(['TODO', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).default('TODO'),
});

// Every by-id lookup is limited to the caller's organization, so another business's record reads as not found.
async function findLeadOr404(id: string, organizationId: string) {
  const lead = await prisma.lead.findFirst({ where: { id, organizationId }, select: { id: true } });
  if (!lead) throw new NotFoundError('Lead', id);
  return lead;
}

async function findTaskOr404(id: string, organizationId: string) {
  const task = await prisma.task.findFirst({ where: { id, organizationId }, select: { id: true } });
  if (!task) throw new NotFoundError('Task', id);
  return task;
}

// A lead or assignee referenced from a task must belong to the same organization.
async function assertTaskRefs(organizationId: string, input: { leadId?: string; assignedToId?: string }) {
  if (input.leadId) {
    const lead = await prisma.lead.findFirst({ where: { id: input.leadId, organizationId }, select: { id: true } });
    if (!lead) throw new BadRequestError('Lead not found in this organization');
  }
  if (input.assignedToId) {
    const member = await prisma.userOrganization.findFirst({ where: { userId: input.assignedToId, organizationId, isActive: true }, select: { id: true } });
    if (!member) throw new BadRequestError('Assignee is not a member of this organization');
  }
}

// ─── Leads ────────────────────────────────────────────────────────────────────
router.get('/leads', async (req: Request, res: Response) => {
  const { page = 1, limit = 20, status, search, assignedTo } = req.query as any;
  const where: Prisma.LeadWhereInput = {
    organizationId: req.organizationId!,
    ...(status && { status: status as any }),
    ...(assignedTo && { assignedTo }),
    ...(search && { OR: [{ name: { contains: search, mode: 'insensitive' } }, { company: { contains: search, mode: 'insensitive' } }, { email: { contains: search, mode: 'insensitive' } }] }),
  };
  const [data, total] = await Promise.all([
    prisma.lead.findMany({ where, skip: (+page - 1) * +limit, take: +limit, orderBy: { createdAt: 'desc' }, include: { tasks: { where: { status: { not: 'COMPLETED' } }, take: 3 } } }),
    prisma.lead.count({ where }),
  ]);
  res.json(paginatedResponse(data, { page: +page, limit: +limit, total, totalPages: Math.ceil(total / +limit) }));
});

router.post('/leads', async (req: Request, res: Response) => {
  const input = CreateLeadSchema.parse(req.body);
  const lead = await prisma.lead.create({ data: { organizationId: req.organizationId!, ...input, status: input.status as any, tags: input.tags ?? [] } });
  res.status(201).json(successResponse(lead, 'Lead created'));
});

router.get('/leads/:id', async (req: Request, res: Response) => {
  const lead = await prisma.lead.findFirst({ where: { id: req.params.id, organizationId: req.organizationId! }, include: { tasks: { orderBy: { createdAt: 'desc' } }, activities: { orderBy: { createdAt: 'desc' } } } });
  if (!lead) throw new NotFoundError('Lead', req.params.id);
  res.json(successResponse(lead));
});

router.put('/leads/:id', async (req: Request, res: Response) => {
  const input = CreateLeadSchema.partial().parse(req.body);
  await findLeadOr404(req.params.id, req.organizationId!);
  const lead = await prisma.lead.update({ where: { id: req.params.id }, data: { ...input, status: input.status as any } });
  res.json(successResponse(lead));
});

router.patch('/leads/:id', async (req: Request, res: Response) => {
  const input = CreateLeadSchema.partial().parse(req.body);
  await findLeadOr404(req.params.id, req.organizationId!);
  const lead = await prisma.lead.update({ where: { id: req.params.id }, data: { ...input, status: input.status as any } });
  res.json(successResponse(lead));
});

router.delete('/leads/:id', async (req: Request, res: Response) => {
  await findLeadOr404(req.params.id, req.organizationId!);
  await prisma.lead.delete({ where: { id: req.params.id } });
  res.json(successResponse({ message: 'Lead deleted' }));
});

// Lead activities/notes
router.post('/leads/:id/notes', async (req: Request, res: Response) => {
  const { content } = z.object({ content: z.string().min(1) }).parse(req.body);
  await findLeadOr404(req.params.id, req.organizationId!);
  const note = await prisma.leadActivity.create({ data: { leadId: req.params.id, type: 'NOTE', title: 'Note', description: content, createdBy: req.userId! } });
  res.status(201).json(successResponse(note));
});

// ─── Tasks ────────────────────────────────────────────────────────────────────
router.get('/tasks', async (req: Request, res: Response) => {
  const { page = 1, limit = 20, status, priority, assigneeId } = req.query as any;
  const where: Prisma.TaskWhereInput = {
    organizationId: req.organizationId!,
    ...(status && { status: status as any }),
    ...(priority && { priority: priority as any }),
    ...(assigneeId && { assignedToId: assigneeId }),
  };
  const [data, total] = await Promise.all([
    prisma.task.findMany({ where, skip: (+page - 1) * +limit, take: +limit, orderBy: { dueDate: 'asc' }, include: { assignedTo: { select: { firstName: true, lastName: true } } } }),
    prisma.task.count({ where }),
  ]);
  res.json(paginatedResponse(data, { page: +page, limit: +limit, total, totalPages: Math.ceil(total / +limit) }));
});

router.post('/tasks', async (req: Request, res: Response) => {
  const input = CreateTaskSchema.parse(req.body);
  await assertTaskRefs(req.organizationId!, input);
  const task = await prisma.task.create({ data: { ...input, organizationId: req.organizationId!, status: input.status as any, priority: input.priority as any, createdById: req.userId! } });
  res.status(201).json(successResponse(task));
});

router.put('/tasks/:id', async (req: Request, res: Response) => {
  const input = CreateTaskSchema.partial().parse(req.body);
  await findTaskOr404(req.params.id, req.organizationId!);
  await assertTaskRefs(req.organizationId!, input);
  const task = await prisma.task.update({ where: { id: req.params.id }, data: { ...input, status: input.status as any, priority: input.priority as any } });
  res.json(successResponse(task));
});

// ─── Sales Pipeline ───────────────────────────────────────────────────────────
router.get('/pipeline', async (req: Request, res: Response) => {
  const pipeline = await prisma.lead.groupBy({
    by: ['status'],
    where: { organizationId: req.organizationId! },
    _count: { id: true },
    _sum: { expectedValue: true },
  });
  res.json(successResponse(pipeline));
});

export { router as crmRouter };
