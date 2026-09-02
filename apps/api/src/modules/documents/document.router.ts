import { Router } from 'express';
import { Request, Response } from 'express';
import { prisma } from '../../infrastructure/database';
import { successResponse, paginatedResponse } from '../../shared/helpers/response.helper';
import { authMiddleware } from '../../shared/middleware/auth.middleware';
import { tenantMiddleware } from '../../shared/middleware/tenant';
import { storage } from '../../infrastructure/storage';
import multer from 'multer';
import { z } from 'zod';

const router = Router();
router.use(authMiddleware, tenantMiddleware);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

router.get('/', async (req: Request, res: Response) => {
  const { page = 1, limit = 20, type, search } = req.query as any;
  const where: any = {
    organizationId: req.organizationId!,
    ...(type && { type }),
    ...(search && { OR: [{ name: { contains: search, mode: 'insensitive' } }, { tags: { hasSome: [search] } }] }),
  };
  const [data, total] = await Promise.all([
    prisma.document.findMany({ where, skip: (+page - 1) * +limit, take: +limit, orderBy: { createdAt: 'desc' } }),
    prisma.document.count({ where }),
  ]);
  res.json(paginatedResponse(data, { page: +page, limit: +limit, total, totalPages: Math.ceil(total / +limit) }));
});

router.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const { type = 'ATTACHMENT', name } = req.body;
  const result = await storage.uploadBuffer(req.file.buffer, {
    folder: 'documents',
    filename: req.file.originalname,
    mimeType: req.file.mimetype,
    organizationId: req.organizationId!,
  });

  const doc = await prisma.document.create({
    data: {
      organizationId: req.organizationId!, type: type as any, name: name || req.file.originalname,
      fileName: req.file.originalname, fileSize: req.file.size, mimeType: req.file.mimetype,
      fileUrl: result.url,
      uploadedBy: req.userId!,
    },
  });
  res.status(201).json(successResponse(doc, 'File uploaded successfully'));
});

router.get('/:id/download', async (req: Request, res: Response) => {
  const doc = await prisma.document.findFirst({ where: { id: req.params.id, organizationId: req.organizationId! } });
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  res.json(successResponse({ url: doc.fileUrl }));
});

router.delete('/:id', async (req: Request, res: Response) => {
  const doc = await prisma.document.findFirst({ where: { id: req.params.id, organizationId: req.organizationId! } });
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  await prisma.document.delete({ where: { id: req.params.id } });
  res.json(successResponse({ message: 'Document deleted' }));
});

export { router as documentRouter };
