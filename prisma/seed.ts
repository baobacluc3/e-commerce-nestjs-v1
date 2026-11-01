import * as argon2 from 'argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  PrismaClient,
  Role,
  StockMovementType,
} from '../src/generated/prisma/client';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://ecommerce:local_dev_only@localhost:5432/ecommerce';

const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter });

async function main(): Promise<void> {
  console.log('🌱 Starting database seed...');

  // 1. Seed Users (Admin & Customer)
  const passwordHash = await argon2.hash('Password123!', {
    type: argon2.argon2id,
  });

  const admin = await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: {
      email: 'admin@example.com',
      passwordHash,
      name: 'System Admin',
      role: Role.ADMIN,
    },
  });
  console.log(`👤 Admin created: ${admin.email}`);

  const customer = await prisma.user.upsert({
    where: { email: 'customer@example.com' },
    update: {},
    create: {
      email: 'customer@example.com',
      passwordHash,
      name: 'Jane Customer',
      role: Role.CUSTOMER,
    },
  });
  console.log(`👤 Customer created: ${customer.email}`);

  // 2. Seed Categories
  const categoriesData = [
    {
      name: 'Electronics',
      slug: 'electronics',
      description: 'Keyboards, mice, monitors, and audio equipment',
    },
    {
      name: 'Accessories',
      slug: 'accessories',
      description: 'Cables, hubs, stands, and desk accessories',
    },
    {
      name: 'Furniture',
      slug: 'furniture',
      description: 'Ergonomic chairs and motorized standing desks',
    },
  ];

  const categories = await Promise.all(
    categoriesData.map((c) =>
      prisma.category.upsert({
        where: { slug: c.slug },
        update: {},
        create: c,
      }),
    ),
  );
  console.log(`📁 Seeded ${categories.length} categories`);

  const electronics = categories.find((c) => c.slug === 'electronics')!;
  const accessories = categories.find((c) => c.slug === 'accessories')!;
  const furniture = categories.find((c) => c.slug === 'furniture')!;

  // 3. Seed Products with initial inventory stock
  const sampleProducts = [
    {
      name: 'Wireless Ergonomic Mechanical Keyboard',
      slug: 'wireless-ergonomic-mechanical-keyboard',
      sku: 'KB-ERG-001',
      description:
        'Split mechanical keyboard with low-profile wireless connectivity and hot-swappable switches.',
      price: 12999, // $129.99
      stock: 45,
      categoryId: electronics.id,
    },
    {
      name: 'Precision Optical Gaming Mouse',
      slug: 'precision-optical-gaming-mouse',
      sku: 'MS-OPT-002',
      description:
        'Lightweight wireless mouse with 26K DPI optical sensor and ultra-fast response.',
      price: 5999, // $59.99
      stock: 30,
      categoryId: electronics.id,
    },
    {
      name: '34-Inch UltraWide Curved Monitor',
      slug: '34-inch-ultrawide-curved-monitor',
      sku: 'MN-UWD-003',
      description:
        '144Hz WQHD curved productivity and gaming monitor with USB-C 90W power delivery.',
      price: 49999, // $499.99
      stock: 12,
      categoryId: electronics.id,
    },
    {
      name: '10-in-1 Aluminum USB-C Hub',
      slug: '10-in-1-aluminum-usb-c-hub',
      sku: 'HB-ALU-004',
      description:
        'Dual 4K HDMI, Gigabit Ethernet, 100W PD charging, and high-speed SD card reader.',
      price: 3999, // $39.99
      stock: 80,
      categoryId: accessories.id,
    },
    {
      name: 'Ergonomic Mesh High-Back Chair',
      slug: 'ergonomic-mesh-high-back-chair',
      sku: 'CH-MSH-005',
      description:
        'Fully adjustable lumbar support, 4D armrests, and breathable high-tensile mesh.',
      price: 28999, // $289.99
      stock: 8,
      categoryId: furniture.id,
    },
  ];

  for (const item of sampleProducts) {
    const existing = await prisma.product.findUnique({
      where: { sku: item.sku },
    });

    if (!existing) {
      const product = await prisma.product.create({
        data: {
          name: item.name,
          slug: item.slug,
          sku: item.sku,
          description: item.description,
          price: item.price,
          stock: item.stock,
          categoryId: item.categoryId,
        },
      });

      await prisma.stockMovement.create({
        data: {
          productId: product.id,
          type: StockMovementType.IN,
          quantity: item.stock,
          balanceAfter: item.stock,
          reason: 'Initial database seed intake',
          userId: admin.id,
        },
      });
      console.log(
        `📦 Seeded product: ${product.name} (stock: ${product.stock})`,
      );
    }
  }

  console.log('✅ Database seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Database seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
