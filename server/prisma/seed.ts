import 'dotenv/config';
import { PrismaClient, Role } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed demo data in production.');
  process.exit(1);
}

const rupees = (n: number) => Math.round(n * 100);

const categories = [
  { slug: 'electronics', name: 'Electronics', description: 'Cameras, projectors, audio gear and more' },
  { slug: 'tools', name: 'Tools', description: 'Power tools and workshop equipment' },
  { slug: 'outdoor-recreation', name: 'Outdoor & Recreation', description: 'Camping, sports and adventure gear' },
  { slug: 'events-party', name: 'Events & Party', description: 'Tables, speakers, lighting and decor' },
];

// [name, category slug, description, daily rate INR, item value INR, number of units, tag prefix]
const catalog: Array<[string, string, string, number, number, number, string]> = [
  ['DSLR Camera (24MP)', 'electronics', 'Full-frame DSLR with 24-70mm lens, two batteries and charger.', 1500, 85000, 3, 'CAM'],
  ['HD Projector', 'electronics', '4000-lumen projector with HDMI cable and carry case.', 1200, 45000, 2, 'PRJ'],
  ['Cordless Power Drill', 'tools', '18V drill with two batteries and a 40-piece bit set.', 400, 9000, 4, 'DRL'],
  ['Angle Grinder', 'tools', '900W angle grinder with guard and spare discs.', 350, 6500, 2, 'GRD'],
  ['4-Person Camping Tent', 'outdoor-recreation', 'Waterproof dome tent with rainfly and ground sheet.', 500, 12000, 5, 'TNT'],
  ['Mountain Bike', 'outdoor-recreation', '21-speed aluminium frame mountain bike, helmet included.', 600, 28000, 3, 'BKE'],
  ['PA Speaker System', 'events-party', 'Pair of 500W active speakers with stands and mixer.', 2000, 60000, 2, 'SPK'],
  ['Folding Banquet Table (6ft)', 'events-party', 'Sturdy folding table seating up to eight guests.', 150, 4000, 10, 'TBL'],
];

const users: Array<{ email: string; name: string; role: Role; password: string }> = [
  { email: 'admin@rental.local', name: 'Asha Admin', role: Role.ADMIN, password: 'Admin@12345' },
  { email: 'staff@rental.local', name: 'Sam Staff', role: Role.STAFF, password: 'Staff@12345' },
  { email: 'customer@rental.local', name: 'Chitra Customer', role: Role.CUSTOMER, password: 'Customer@12345' },
];

async function main() {
  for (const c of categories) {
    await prisma.category.upsert({ where: { slug: c.slug }, update: {}, create: c });
  }

  for (const u of users) {
    const passwordHash = await argon2.hash(u.password, { type: argon2.argon2id });
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { email: u.email, name: u.name, role: u.role, passwordHash },
    });
  }

  for (const [name, slug, description, rate, value, unitCount, prefix] of catalog) {
    const category = await prisma.category.findUniqueOrThrow({ where: { slug } });
    let equipment = await prisma.equipment.findFirst({ where: { name } });
    if (!equipment) {
      equipment = await prisma.equipment.create({
        data: {
          name,
          description,
          categoryId: category.id,
          dailyRatePaise: rupees(rate),
          itemValuePaise: rupees(value),
        },
      });
    }
    for (let i = 1; i <= unitCount; i++) {
      const tag = `${prefix}-${String(i).padStart(3, '0')}`;
      await prisma.equipmentUnit.upsert({
        where: { tag },
        update: {},
        create: { tag, equipmentId: equipment.id },
      });
    }
  }

  console.log('Seed complete.');
  console.log('Demo logins (development only):');
  for (const u of users) console.log(`  ${u.role.padEnd(8)} ${u.email}  /  ${u.password}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
