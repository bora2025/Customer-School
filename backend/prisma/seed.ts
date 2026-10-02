import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { getDistribution } from '../src/config/environment';
import { SeedSectionName, seedSectionsForDistribution } from '../src/distribution/seed-composition';

const prisma = new PrismaClient();

async function seedCoreIdentity() {
  await prisma.user.upsert({
    where: { email: 'admin@test.com' },
    update: {},
    create: {
      email: 'admin@test.com',
      password: await bcrypt.hash('password', 10),
      name: 'Admin',
      role: 'ADMIN',
    },
  });
  console.log('Core identity fixture seeded');
}

async function seedLegacyBusinessDemo() {
  const departments = [
    { name: 'Human Resources', nameKh: 'ធនធានមនុស្ស', description: 'HR & personnel management' },
    { name: 'Finance', nameKh: 'ហិរញ្ញវត្ថុ', description: 'Accounting & finance' },
    { name: 'Administration', nameKh: 'រដ្ឋបាល', description: 'Administration & operations' },
    { name: 'Security', nameKh: 'សន្តិសុខ', description: 'Security & safety' },
    { name: 'Academics', nameKh: 'សិក្សា', description: 'Academic affairs' },
    { name: 'IT', nameKh: 'ព័ត៌មានវិទ្យា', description: 'Information technology' },
    { name: 'Maintenance', nameKh: 'ថែទាំ', description: 'Facilities & maintenance' },
  ];

  for (const dept of departments) {
    await prisma.department.upsert({
      where: { name: dept.name },
      update: {},
      create: dept,
    });
  }
  console.log('Departments seeded');

  const teacher = await prisma.user.upsert({
    where: { email: 'teacher@test.com' },
    update: {},
    create: {
      email: 'teacher@test.com',
      password: await bcrypt.hash('password', 10),
      name: 'Teacher',
      role: 'TEACHER',
    },
  });

  const studentUser = await prisma.user.upsert({
    where: { email: 'student@test.com' },
    update: {},
    create: {
      email: 'student@test.com',
      password: await bcrypt.hash('password', 10),
      name: 'Student',
      role: 'STUDENT',
    },
  });

  const parent = await prisma.user.upsert({
    where: { email: 'parent@test.com' },
    update: {},
    create: {
      email: 'parent@test.com',
      password: await bcrypt.hash('password', 10),
      name: 'Parent',
      role: 'PARENT',
    },
  });

  // Create class
  const class1 = await prisma.class.create({
    data: {
      name: 'Class 1',
      teacherId: teacher.id,
    },
  });

  // Create student
  const student = await prisma.student.create({
    data: {
      userId: studentUser.id,
      classId: class1.id,
      parentId: parent.id,
      qrCode: 'QR123', // Placeholder
    },
  });

  console.log('Test data created');
}

const seeders: Record<SeedSectionName, () => Promise<void>> = {
  'core-identity': seedCoreIdentity,
  'legacy-business-demo': seedLegacyBusinessDemo,
};

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Development seed data is disabled in production');
  }

  const distribution = getDistribution(process.env);
  const sections = seedSectionsForDistribution(distribution);
  console.log(`Seeding ${distribution} distribution: ${sections.join(', ')}`);
  for (const section of sections) await seeders[section]();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
