import { prisma } from '../../infrastructure/database';
import { generateSequenceNumber } from '../helpers/response.helper';

export async function generateQuotationNumber(organizationId: string): Promise<string> {
  const count = await prisma.quotation.count({
    where: { organizationId }
  });
  return generateSequenceNumber('QT', count + 1);
}
