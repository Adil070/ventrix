import { Router } from 'express';
import { Request, Response } from 'express';
import { prisma } from '../../infrastructure/database';
import { successResponse, paginatedResponse } from '../../shared/helpers/response.helper';
import { authMiddleware } from '../../shared/middleware/auth.middleware';
import { tenantMiddleware } from '../../shared/middleware/tenant';
import { z } from 'zod';
import { Prisma } from '@prisma/client';

const router = Router();
router.use(authMiddleware, tenantMiddleware);

// ─── Employees ────────────────────────────────────────────────────────────────
const CreateEmployeeSchema = z.object({
  userId: z.string().optional(),
  employeeCode: z.string().optional(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email().optional(),
  mobile: z.string().optional(),
  department: z.string().optional(),
  designation: z.string().optional(),
  dateOfJoining: z.coerce.date().optional(),
  salary: z.number().min(0).optional(),
  salaryType: z.enum(['MONTHLY', 'WEEKLY', 'DAILY', 'HOURLY']).default('MONTHLY'),
  branchId: z.string().optional(),
  address: z.record(z.string()).optional(),
  bankDetails: z.record(z.string()).optional(),
});

router.get('/', async (req: Request, res: Response) => {
  const { page = 1, limit = 20, search, department } = req.query as any;
  const where: Prisma.EmployeeWhereInput = {
    organizationId: req.organizationId!, isActive: true,
    ...(search && { OR: [{ firstName: { contains: search, mode: 'insensitive' } }, { lastName: { contains: search, mode: 'insensitive' } }, { employeeCode: { contains: search } }] }),
    ...(department && { department }),
  };
  const [data, total] = await Promise.all([
    prisma.employee.findMany({ where, skip: (+page - 1) * +limit, take: +limit, orderBy: { firstName: 'asc' } }),
    prisma.employee.count({ where }),
  ]);
  res.json(paginatedResponse(data, { page: +page, limit: +limit, total, totalPages: Math.ceil(total / +limit) }));
});

router.post('/', async (req: Request, res: Response) => {
  const input = CreateEmployeeSchema.parse(req.body);
  const count = await prisma.employee.count({ where: { organizationId: req.organizationId! } });
  const employee = await prisma.employee.create({
    data: {
      organizationId: req.organizationId!, ...input,
      employeeCode: input.employeeCode || `EMP-${String(count + 1).padStart(4, '0')}`,
      address: input.address as Prisma.InputJsonValue,
      bankDetails: input.bankDetails as Prisma.InputJsonValue,
      salaryType: input.salaryType as any,
    },
  });
  res.status(201).json(successResponse(employee, 'Employee created'));
});

router.get('/:id', async (req: Request, res: Response) => {
  const employee = await prisma.employee.findFirst({ where: { id: req.params.id, organizationId: req.organizationId! } });
  res.json(successResponse(employee));
});

router.put('/:id', async (req: Request, res: Response) => {
  const input = CreateEmployeeSchema.partial().parse(req.body);
  const employee = await prisma.employee.update({ where: { id: req.params.id }, data: { ...input, address: input.address as Prisma.InputJsonValue, bankDetails: input.bankDetails as Prisma.InputJsonValue, salaryType: input.salaryType as any } });
  res.json(successResponse(employee));
});

// ─── Attendance ───────────────────────────────────────────────────────────────
const AttendanceSchema = z.object({
  employeeId: z.string(),
  date: z.coerce.date(),
  status: z.enum(['PRESENT', 'ABSENT', 'HALF_DAY', 'LEAVE', 'HOLIDAY']).default('PRESENT'),
  checkIn: z.string().optional(),
  checkOut: z.string().optional(),
  notes: z.string().optional(),
});

router.get('/:id/attendance', async (req: Request, res: Response) => {
  const { month, year } = req.query as any;
  const from = new Date(+year || new Date().getFullYear(), (+month || new Date().getMonth() + 1) - 1, 1);
  const to = new Date(from.getFullYear(), from.getMonth() + 1, 0);
  const attendance = await prisma.employeeAttendance.findMany({ where: { employeeId: req.params.id, date: { gte: from, lte: to } }, orderBy: { date: 'asc' } });
  res.json(successResponse(attendance));
});

router.post('/attendance', async (req: Request, res: Response) => {
  const input = AttendanceSchema.parse(req.body);
  const attendance = await prisma.employeeAttendance.upsert({
    where: { employeeId_date: { employeeId: input.employeeId, date: input.date } },
    update: { status: input.status as any, checkIn: input.checkIn, checkOut: input.checkOut, notes: input.notes },
    create: { ...input, status: input.status as any },
  });
  res.status(201).json(successResponse(attendance));
});

export { router as employeeRouter };
