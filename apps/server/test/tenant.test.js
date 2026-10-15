import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import { connectMongo, closeMongo } from '../src/db/mongo.js';
import { authenticate } from '../src/middleware/auth.js';
import { requireBusinessOwnership } from '../src/middleware/tenant.js';
import { UserRole } from '@slotify/shared';
import { registerUser, loginUser } from '../src/services/auth-service.js';

describe('Tenant Isolation & Authorization Middleware Tests', { concurrency: 1 }, () => {
  let app;
  let db;

  before(async () => {
    const mongo = await connectMongo();
    db = mongo.db;

    // Create dedicated app for middleware test to ensure route precedence
    const express = (await import('express')).default;
    const cookieParser = (await import('cookie-parser')).default;
    const { errorHandler } = await import('../src/middleware/error-handler.js');

    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.get(
      '/api/v1/businesses/:businessId/protected-test',
      authenticate,
      requireBusinessOwnership,
      (req, res) => {
        res.status(200).json({
          success: true,
          message: 'Tenant access granted',
          businessId: req.business?._id.toString(),
        });
      }
    );
    app.use(errorHandler);
  });

  after(async () => {
    await closeMongo();
  });

  beforeEach(async () => {
    await db.collection('users').deleteMany({});
    await db.collection('sessions').deleteMany({});
    await db.collection('businesses').deleteMany({});
  });

  it('allows business owner to access their own business', async () => {
    // 1. Register owner
    const { user: owner } = await registerUser({
      email: 'owner1@example.com',
      password: 'StrongPassword123!',
      fullName: 'Owner One',
      role: UserRole.OWNER,
    });

    const { sessionToken } = await loginUser({
      email: 'owner1@example.com',
      password: 'StrongPassword123!',
    });

    // 2. Create business in DB owned by owner1
    const businessInsert = await db.collection('businesses').insertOne({
      name: 'Business One',
      slug: 'business-one',
      ownerId: new ObjectId(owner.id),
      createdAt: new Date(),
    });
    const businessId = businessInsert.insertedId.toString();

    // 3. Request protected route
    const res = await request(app)
      .get(`/api/v1/businesses/${businessId}/protected-test`)
      .set('Authorization', `Bearer ${sessionToken}`)
      .expect(200);

    assert.equal(res.body.success, true);
    assert.equal(res.body.businessId, businessId);
  });

  it('rejects access when owner attempts to access another business (cross-tenant rejection)', async () => {
    // 1. Register owner 1 and owner 2
    const { user: owner1 } = await registerUser({
      email: 'owner1@example.com',
      password: 'StrongPassword123!',
      fullName: 'Owner One',
      role: UserRole.OWNER,
    });

    await registerUser({
      email: 'owner2@example.com',
      password: 'StrongPassword123!',
      fullName: 'Owner Two',
      role: UserRole.OWNER,
    });

    const { sessionToken: owner2Token } = await loginUser({
      email: 'owner2@example.com',
      password: 'StrongPassword123!',
    });

    // 2. Create business owned by owner1
    const businessInsert = await db.collection('businesses').insertOne({
      name: 'Owner 1 Spa',
      slug: 'owner-1-spa',
      ownerId: new ObjectId(owner1.id),
      createdAt: new Date(),
    });
    const businessId = businessInsert.insertedId.toString();

    // 3. Owner 2 tries to access Owner 1's business
    const res = await request(app)
      .get(`/api/v1/businesses/${businessId}/protected-test`)
      .set('Authorization', `Bearer ${owner2Token}`)
      .expect(403);

    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'FORBIDDEN');
    assert.match(res.body.error.message, /Access denied: You do not own this business/);
  });

  it('rejects customers attempting to access owner business routes', async () => {
    const { user: owner } = await registerUser({
      email: 'owner@example.com',
      password: 'StrongPassword123!',
      fullName: 'Owner User',
      role: UserRole.OWNER,
    });

    await registerUser({
      email: 'customer@example.com',
      password: 'StrongPassword123!',
      fullName: 'Customer User',
      role: UserRole.CUSTOMER,
    });

    const { sessionToken: customerToken } = await loginUser({
      email: 'customer@example.com',
      password: 'StrongPassword123!',
    });

    const businessInsert = await db.collection('businesses').insertOne({
      name: 'Some Clinic',
      slug: 'some-clinic',
      ownerId: new ObjectId(owner.id),
      createdAt: new Date(),
    });
    const businessId = businessInsert.insertedId.toString();

    const res = await request(app)
      .get(`/api/v1/businesses/${businessId}/protected-test`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(403);

    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'FORBIDDEN');
    assert.match(res.body.error.message, /Only business owners can perform this operation/);
  });

  it('allows platform admin to access any business', async () => {
    // 1. Create owner and business
    const { user: owner } = await registerUser({
      email: 'owner@example.com',
      password: 'StrongPassword123!',
      fullName: 'Owner User',
      role: UserRole.OWNER,
    });

    const businessInsert = await db.collection('businesses').insertOne({
      name: 'Admin Inspected Salon',
      slug: 'admin-inspected-salon',
      ownerId: new ObjectId(owner.id),
      createdAt: new Date(),
    });
    const businessId = businessInsert.insertedId.toString();

    // 2. Register admin user (in DB directly for security bootstrap)
    const adminInsert = await db.collection('users').insertOne({
      email: 'admin@slotify.internal',
      passwordHash: 'dummyhash',
      fullName: 'Platform Admin',
      role: UserRole.PLATFORM_ADMIN,
      accountStatus: 'active',
      isEmailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // 3. Create active session for admin
    const rawAdminToken = 'admin-secret-session-token-1234567890';
    const { hashToken } = await import('../src/services/auth-service.js');
    await db.collection('sessions').insertOne({
      userId: adminInsert.insertedId,
      sessionTokenHash: hashToken(rawAdminToken),
      role: UserRole.PLATFORM_ADMIN,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 3600000),
      revokedAt: null,
    });

    // 4. Admin accesses the business
    const res = await request(app)
      .get(`/api/v1/businesses/${businessId}/protected-test`)
      .set('Authorization', `Bearer ${rawAdminToken}`)
      .expect(200);

    assert.equal(res.body.success, true);
  });
});
