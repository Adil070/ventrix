import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // ── Admin user (super admin) ──────────────────────────────
  const adminPassword = await bcrypt.hash('Admin@123', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@ventrix.local' },
    update: {},
    create: {
      email: 'admin@ventrix.local',
      firstName: 'Super',
      lastName: 'Admin',
      passwordHash: adminPassword,
      isSuperAdmin: true,
      isEmailVerified: true,
      isActive: true,
    },
  });
  console.log('✅ Super admin:', admin.email);

  // ── Demo organisation ─────────────────────────────────────
  let org = await prisma.organization.findFirst({ where: { email: 'contact@demotrade.local' } });
  if (!org) {
    org = await prisma.organization.create({
      data: {
        name: 'Demo Trading Co.',
        gstin: '27AABCD1234E1Z5',
        pan: 'AABCD1234E',
        email: 'contact@demotrade.local',
        phone: '9876543210',
        currency: 'INR',
        timezone: 'Asia/Kolkata',
        invoicePrefix: 'INV',
        isActive: true,
        address: { line1: '123, MG Road', city: 'Mumbai', state: 'Maharashtra', pincode: '400001', country: 'India' },
      },
    });
  }
  console.log('✅ Organisation:', org.name);

  // ── Demo org owner ────────────────────────────────────────
  const ownerPassword = await bcrypt.hash('Owner@123', 12);
  const owner = await prisma.user.upsert({
    where: { email: 'owner@demotrade.local' },
    update: {},
    create: {
      email: 'owner@demotrade.local',
      firstName: 'Rajesh',
      lastName: 'Sharma',
      passwordHash: ownerPassword,
      phone: '9876543211',
      isSuperAdmin: false,
      isEmailVerified: true,
      isActive: true,
      organizations: {
        create: {
          organizationId: org.id,
          role: 'ORG_OWNER',
        },
      },
    },
  });
  console.log('✅ Org owner:', owner.email);

  // ── Subscription ─────────────────────────────────────────
  await prisma.subscription.upsert({
    where: { organizationId: org.id },
    update: {},
    create: {
      organizationId: org.id,
      plan: 'PREMIUM',
      status: 'ACTIVE',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    },
  });

  // ── Chart of Accounts (System Accounts) ──────────────────
  const chartOfAccounts = [
    // Assets
    { code: '1000', name: 'Cash', type: 'ASSET', subType: 'CASH', isSystem: true },
    { code: '1100', name: 'Bank Accounts', type: 'ASSET', subType: 'BANK', isSystem: true },
    { code: '1200', name: 'Accounts Receivable', type: 'ASSET', subType: 'ACCOUNTS_RECEIVABLE', isSystem: true },
    { code: '1300', name: 'Inventory', type: 'ASSET', subType: 'CURRENT_ASSET', isSystem: true },
    { code: '1400', name: 'Fixed Assets', type: 'ASSET', subType: 'FIXED_ASSET', isSystem: true },
    
    // Liabilities
    { code: '2000', name: 'Accounts Payable', type: 'LIABILITY', subType: 'ACCOUNTS_PAYABLE', isSystem: true },
    { code: '2200', name: 'CGST Payable', type: 'LIABILITY', subType: 'CURRENT_LIABILITY', isSystem: true },
    { code: '2300', name: 'SGST Payable', type: 'LIABILITY', subType: 'CURRENT_LIABILITY', isSystem: true },
    { code: '2400', name: 'IGST Payable', type: 'LIABILITY', subType: 'CURRENT_LIABILITY', isSystem: true },
    { code: '2500', name: 'Loans Payable', type: 'LIABILITY', subType: 'LONG_TERM_LIABILITY', isSystem: true },
    
    // Equity
    { code: '3000', name: 'Owner\'s Capital', type: 'EQUITY', subType: 'CAPITAL', isSystem: true },
    { code: '3100', name: 'Retained Earnings', type: 'EQUITY', subType: 'RETAINED_EARNINGS', isSystem: true },
    
    // Revenue
    { code: '4000', name: 'Sales Revenue', type: 'REVENUE', subType: 'OPERATING_REVENUE', isSystem: true },
    { code: '4100', name: 'Other Income', type: 'REVENUE', subType: 'OTHER_REVENUE', isSystem: true },
    
    // Expenses
    { code: '5000', name: 'Cost of Goods Sold', type: 'EXPENSE', subType: 'COST_OF_GOODS_SOLD', isSystem: true },
    { code: '5100', name: 'Purchases', type: 'EXPENSE', subType: 'COST_OF_GOODS_SOLD', isSystem: true },
    { code: '5200', name: 'Operating Expenses', type: 'EXPENSE', subType: 'OPERATING_EXPENSE', isSystem: true },
    { code: '5300', name: 'Rent Expense', type: 'EXPENSE', subType: 'OPERATING_EXPENSE', isSystem: true },
    { code: '5400', name: 'Salary Expense', type: 'EXPENSE', subType: 'OPERATING_EXPENSE', isSystem: true },
    { code: '5500', name: 'Utilities Expense', type: 'EXPENSE', subType: 'OPERATING_EXPENSE', isSystem: true },
  ];

  for (const account of chartOfAccounts) {
    const existing = await prisma.account.findFirst({
      where: { organizationId: org.id, code: account.code }
    });
    if (!existing) {
      await prisma.account.create({
        data: {
          organizationId: org.id,
          code: account.code,
          name: account.name,
          type: account.type as any,
          subType: account.subType as any,
          isSystem: account.isSystem,
          isActive: true,
        },
      });
    }
  }
  console.log('✅ Chart of Accounts created');

  // ── Tax rates ─────────────────────────────────────────────
  const taxRateNames = [
    { name: 'GST 0%', rate: 0 },
    { name: 'GST 5%', rate: 5 },
    { name: 'GST 12%', rate: 12 },
    { name: 'GST 18%', rate: 18 },
    { name: 'GST 28%', rate: 28 },
  ];
  for (const t of taxRateNames) {
    const existing = await prisma.taxRate.findFirst({ where: { organizationId: org.id, name: t.name } });
    if (!existing) {
      await prisma.taxRate.create({ data: { organizationId: org.id, name: t.name, rate: t.rate, isActive: true } });
    }
  }
  console.log('✅ Tax rates created');

  // ── Units ─────────────────────────────────────────────────
  const units = [
    { name: 'Piece', abbreviation: 'PCS' },
    { name: 'Kilogram', abbreviation: 'KG' },
    { name: 'Gram', abbreviation: 'GM' },
    { name: 'Litre', abbreviation: 'LTR' },
    { name: 'Metre', abbreviation: 'MTR' },
    { name: 'Box', abbreviation: 'BOX' },
    { name: 'Dozen', abbreviation: 'DZN' },
    { name: 'Set', abbreviation: 'SET' },
  ];
  for (const u of units) {
    await prisma.unit.upsert({
      where: { organizationId_abbreviation: { organizationId: org.id, abbreviation: u.abbreviation } },
      update: {},
      create: { organizationId: org.id, name: u.name, abbreviation: u.abbreviation, isActive: true },
    });
  }
  console.log('✅ Units created');

  // ── Product categories ────────────────────────────────────
  const categories = ['Electronics', 'Clothing', 'Food & Beverage', 'Machinery', 'Stationery'];
  const catMap: Record<string, string> = {};
  for (const name of categories) {
    let cat = await prisma.productCategory.findFirst({ where: { organizationId: org.id, name } });
    if (!cat) {
      cat = await prisma.productCategory.create({ data: { organizationId: org.id, name, isActive: true } });
    }
    catMap[name] = cat.id;
  }
  console.log('✅ Categories created');

  const pcsUnit = await prisma.unit.findFirst({ where: { organizationId: org.id, abbreviation: 'PCS' } });

  // ── Sample products ───────────────────────────────────────
  const products = [
    { name: 'Laptop Core i5', sku: 'LAP-001', hsnCode: '8471', taxRate: 18, sellingPrice: 55000, costPrice: 45000, mrp: 60000, reorderPoint: 3, categoryName: 'Electronics' },
    { name: 'Wireless Mouse', sku: 'MSE-001', hsnCode: '8471', taxRate: 18, sellingPrice: 799, costPrice: 450, mrp: 999, reorderPoint: 10, categoryName: 'Electronics' },
    { name: 'A4 Paper Ream', sku: 'PPR-001', hsnCode: '4802', taxRate: 12, sellingPrice: 350, costPrice: 280, mrp: 400, reorderPoint: 50, categoryName: 'Stationery' },
    { name: 'Office Chair', sku: 'CHR-001', hsnCode: '9401', taxRate: 18, sellingPrice: 8500, costPrice: 6000, mrp: 10000, reorderPoint: 2, categoryName: 'Machinery' },
    { name: 'Cotton T-Shirt', sku: 'TSH-001', hsnCode: '6109', taxRate: 5, sellingPrice: 599, costPrice: 300, mrp: 799, reorderPoint: 10, categoryName: 'Clothing' },
  ];

  for (const p of products) {
    await prisma.product.upsert({
      where: { organizationId_sku: { organizationId: org.id, sku: p.sku } },
      update: {},
      create: {
        organizationId: org.id,
        categoryId: catMap[p.categoryName],
        unitId: pcsUnit?.id,
        name: p.name,
        sku: p.sku,
        hsnCode: p.hsnCode,
        taxRate: p.taxRate,
        sellingPrice: p.sellingPrice,
        costPrice: p.costPrice,
        mrp: p.mrp,
        reorderPoint: p.reorderPoint,
        type: 'PRODUCT',
        trackInventory: true,
        isActive: true,
      },
    });
  }
  console.log('✅ Products created');

  // ── Sample customers ──────────────────────────────────────
  const customers = [
    { name: 'Acme Corp', email: 'billing@acme.com', phone: '9111111111', gstin: '27AACCA1234B1Z1', creditLimit: 500000 },
    { name: 'Tech Solutions Pvt Ltd', email: 'accounts@techsol.com', phone: '9222222222', gstin: '27AABCB5678C1Z2', creditLimit: 200000 },
    { name: 'Retail Store - Andheri', email: 'store@retail.com', phone: '9333333333', gstin: null, creditLimit: 50000 },
    { name: 'Sharma Enterprises', email: 'sharma@enterprise.in', phone: '9444444444', gstin: '29AACCS1234D1Z3', creditLimit: 1000000 },
    { name: 'Walk-in Customer', email: null, phone: '9000000000', gstin: null, creditLimit: 0 },
  ];

  for (const c of customers) {
    const existing = await prisma.customer.findFirst({ where: { organizationId: org.id, phone: c.phone } });
    if (!existing) {
      await prisma.customer.create({
        data: { organizationId: org.id, ...c, isActive: true },
      });
    }
  }
  console.log('✅ Customers created');

  // ── Sample suppliers ──────────────────────────────────────
  const suppliers = [
    { name: 'TechnoSource Pvt Ltd', email: 'supply@technosource.com', phone: '8111111111', gstin: '27AACTS1234E1Z5', paymentTerms: 30 },
    { name: 'Global Imports Co', email: 'orders@globalimports.in', phone: '8222222222', gstin: '27AACGI1234F1Z6', paymentTerms: 45 },
    { name: 'Office Supplies Hub', email: 'billing@officehub.com', phone: '8333333333', gstin: null, paymentTerms: 15 },
  ];

  for (const s of suppliers) {
    const existing = await prisma.supplier.findFirst({ where: { organizationId: org.id, phone: s.phone } });
    if (!existing) {
      await prisma.supplier.create({
        data: { organizationId: org.id, ...s, isActive: true },
      });
    }
  }
  console.log('✅ Suppliers created');

  // ── Warehouse ─────────────────────────────────────────────
  await prisma.warehouse.upsert({
    where: { organizationId_code: { organizationId: org.id, code: 'WH-MAIN' } },
    update: {},
    create: {
      organizationId: org.id,
      name: 'Main Warehouse',
      code: 'WH-MAIN',
      address: { line1: 'Andheri East, Mumbai' },
      contactPerson: 'Rakesh Kumar',
      phone: '9555555555',
      isDefault: true,
      isActive: true,
    },
  });
  console.log('✅ Warehouse created');

  // ── Expense categories ────────────────────────────────────
  const expCats = ['Office Supplies', 'Travel', 'Utilities', 'Marketing', 'Rent', 'Salary', 'Maintenance'];
  for (const name of expCats) {
    const existing = await prisma.expenseCategory.findFirst({ where: { name } });
    if (!existing) {
      await prisma.expenseCategory.create({ data: { name, isActive: true } });
    }
  }
  console.log('✅ Expense categories created');

  console.log('\n🎉 Seed complete!\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  🔐 Login credentials:');
  console.log('');
  console.log('  Super Admin (platform):');
  console.log('    Email   : admin@ventrix.local');
  console.log('    Password: Admin@123');
  console.log('');
  console.log('  Org Owner (Demo Trading Co.):');
  console.log('    Email   : owner@demotrade.local');
  console.log('    Password: Owner@123');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main()
  .catch(e => { console.error('❌ Seed failed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
