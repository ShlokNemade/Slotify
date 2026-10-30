import bcrypt from 'bcryptjs';
import { closeMongo, connectMongo } from '../apps/server/src/db/mongo.js';
import { AccountStatus, BusinessStatus, UserRole } from '@slotify/shared';

export const DEMO_ACCOUNTS = {
  customer: {
    email: 'demo.customer@slotify.local',
    password: 'DemoCustomer123!',
    fullName: 'Demo Customer',
    role: UserRole.CUSTOMER,
  },
  owner: {
    email: 'demo.owner@slotify.local',
    password: 'DemoOwner123!',
    fullName: 'Demo Owner',
    role: UserRole.OWNER,
  },
};

const DEMO_BUSINESS = {
  slug: 'northstar-wellness',
  name: 'Northstar Wellness',
};

function weekdayHours() {
  const hours = {};
  for (const day of ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']) {
    hours[day] = { isOpen: true, windows: [{ open: '09:00', close: '17:00' }] };
  }
  for (const day of ['saturday', 'sunday']) {
    hours[day] = { isOpen: false, windows: [] };
  }
  return hours;
}

async function upsertUser(db, account) {
  const passwordHash = await bcrypt.hash(account.password, 12);
  const now = new Date();
  const result = await db.collection('users').findOneAndUpdate(
    { email: account.email },
    {
      $set: {
        fullName: account.fullName,
        passwordHash,
        role: account.role,
        accountStatus: AccountStatus.ACTIVE,
        isEmailVerified: true,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true, returnDocument: 'after' }
  );
  return result;
}

async function seedDemoData() {
  const { db } = await connectMongo();
  const owner = await upsertUser(db, DEMO_ACCOUNTS.owner);
  const customer = await upsertUser(db, DEMO_ACCOUNTS.customer);
  const now = new Date();

  const businessResult = await db.collection('businesses').findOneAndUpdate(
    { slug: DEMO_BUSINESS.slug },
    {
      $set: {
        name: DEMO_BUSINESS.name,
        description: 'A calm space for massage, recovery, and intentional self-care.',
        category: 'wellness',
        status: BusinessStatus.APPROVED,
        timeZone: 'UTC',
        location: {
          address: '14 Aurora Avenue',
          city: 'Berlin',
          country: 'Germany',
        },
        hours: weekdayHours(),
        defaultSlotIntervalMinutes: 30,
        minNoticeHours: 0,
        maxHorizonDays: 60,
        ownerId: owner._id,
        reviewNotes: 'Seeded for local development demos.',
        reviewedAt: now,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true, returnDocument: 'after' }
  );
  const business = businessResult;

  await db.collection('services').deleteMany({ businessId: business._id });
  await db.collection('staff').deleteMany({ businessId: business._id });
  const staffResult = await db.collection('staff').insertOne({
    businessId: business._id,
    displayName: 'Maya Chen',
    email: 'maya@northstar-wellness.local',
    qualifications: ['Massage therapy', 'Recovery coaching'],
    active: true,
    shifts: Object.keys(weekdayHours())
      .filter((day) => weekdayHours()[day].isOpen)
      .map((day) => ({ day, windows: [{ open: '09:00', close: '17:00' }] })),
    breaks: [{ day: 'monday', start: '12:00', end: '13:00', reason: 'Lunch' }],
    leave: [],
    createdAt: now,
    updatedAt: now,
  });

  await db.collection('services').insertMany([
    {
      businessId: business._id,
      name: 'Restorative massage',
      description: 'A focused session for easing tension and restoring mobility.',
      durationMinutes: 60,
      requiredQualifications: ['Massage therapy'],
      bufferMinutes: 15,
      bufferPlacement: 'after',
      price: 75,
      active: true,
      eligibleStaffIds: [staffResult.insertedId],
      createdAt: now,
      updatedAt: now,
    },
    {
      businessId: business._id,
      name: 'Recovery consultation',
      description: 'A practical plan for sustainable recovery habits.',
      durationMinutes: 30,
      requiredQualifications: ['Recovery coaching'],
      bufferMinutes: 0,
      bufferPlacement: 'after',
      price: 40,
      active: true,
      eligibleStaffIds: [staffResult.insertedId],
      createdAt: now,
      updatedAt: now,
    },
  ]);

  console.log('Demo data seeded.');
  console.log(`Customer: ${DEMO_ACCOUNTS.customer.email} / ${DEMO_ACCOUNTS.customer.password}`);
  console.log(`Owner: ${DEMO_ACCOUNTS.owner.email} / ${DEMO_ACCOUNTS.owner.password}`);
  console.log(`Business: ${business.slug} (${business._id.toString()})`);
  console.log(`Demo customer id: ${customer._id.toString()}`);
}

async function clearDemoData() {
  const { db } = await connectMongo();
  const demoUsers = await db.collection('users').find({
    email: { $in: Object.values(DEMO_ACCOUNTS).map((account) => account.email) },
  }).toArray();
  const userIds = demoUsers.map((user) => user._id);
  const businesses = await db.collection('businesses').find({ slug: DEMO_BUSINESS.slug }).toArray();
  const businessIds = businesses.map((business) => business._id);
  const bookings = await db.collection('bookings').find({
    $or: [{ customerId: { $in: userIds } }, { businessId: { $in: businessIds } }],
  }, { projection: { _id: 1 } }).toArray();
  const bookingIds = bookings.map((booking) => booking._id);

  await db.collection('bookings').deleteMany({ _id: { $in: bookingIds } });
  await db.collection('outbox').deleteMany({
    $or: [
      { aggregateId: { $in: userIds } },
      { aggregateId: { $in: businessIds } },
      { aggregateId: { $in: bookingIds } },
    ],
  });
  await db.collection('notifications').deleteMany({ userId: { $in: userIds } });
  await db.collection('sessions').deleteMany({ userId: { $in: userIds } });
  await db.collection('services').deleteMany({ businessId: { $in: businessIds } });
  await db.collection('staff').deleteMany({ businessId: { $in: businessIds } });
  await db.collection('businesses').deleteMany({ _id: { $in: businessIds } });
  await db.collection('users').deleteMany({ _id: { $in: userIds } });
  console.log('Demo data removed.');
}

const action = process.argv.includes('--reset') ? clearDemoData : seedDemoData;
action().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => closeMongo());
