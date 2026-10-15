import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  registerUserSchema,
  loginUserSchema,
  slugSchema,
  timeZoneSchema,
  createBusinessSchema,
  createBookingSchema,
  UserRole,
} from '../src/index.js';

describe('Shared Domain Schemas', () => {
  describe('User Schemas', () => {
    it('validates a valid customer registration payload', () => {
      const input = {
        email: '  Customer@Example.COM ',
        password: 'securePassword123!',
        fullName: 'Jane Doe',
        role: UserRole.CUSTOMER,
      };

      const result = registerUserSchema.parse(input);
      assert.equal(result.email, 'customer@example.com');
      assert.equal(result.fullName, 'Jane Doe');
      assert.equal(result.role, UserRole.CUSTOMER);
    });

    it('rejects short passwords', () => {
      const input = {
        email: 'test@example.com',
        password: 'short',
        fullName: 'Test User',
      };

      assert.throws(
        () => registerUserSchema.parse(input),
        /Password must be at least 8 characters/
      );
    });

    it('rejects invalid email addresses', () => {
      const input = {
        email: 'not-an-email',
        password: 'securePassword123!',
        fullName: 'Test User',
      };

      assert.throws(() => registerUserSchema.parse(input), /Invalid email address/);
    });

    it('validates login input', () => {
      const result = loginUserSchema.parse({
        email: 'owner@slotify.local',
        password: 'somePassword',
      });
      assert.equal(result.email, 'owner@slotify.local');
    });
  });

  describe('Business Schemas', () => {
    it('validates a valid slug', () => {
      assert.equal(slugSchema.parse('zen-massage-spa'), 'zen-massage-spa');
      assert.throws(() => slugSchema.parse('Invalid Slug!'), /Slug must consist/);
      assert.throws(() => slugSchema.parse('ab'), /Slug must be at least 3 characters/);
    });

    it('validates IANA time zones', () => {
      assert.equal(timeZoneSchema.parse('America/New_York'), 'America/New_York');
      assert.equal(timeZoneSchema.parse('Europe/London'), 'Europe/London');
      assert.equal(timeZoneSchema.parse('Asia/Kolkata'), 'Asia/Kolkata');
      assert.throws(() => timeZoneSchema.parse('Invalid/Timezone_X'), /Invalid IANA time zone/);
    });

    it('validates business creation payload with defaults', () => {
      const input = {
        name: 'Downtown Dental',
        slug: 'downtown-dental',
        category: 'Dental',
        timeZone: 'America/Chicago',
        location: {
          address: '123 Main St',
          city: 'Austin',
          state: 'TX',
          country: 'USA',
        },
      };

      const result = createBusinessSchema.parse(input);
      assert.equal(result.defaultSlotIntervalMinutes, 30);
      assert.equal(result.minNoticeHours, 2);
      assert.equal(result.maxHorizonDays, 60);
    });
  });

  describe('Booking Schemas', () => {
    it('validates multi-service booking payload', () => {
      const input = {
        businessId: '507f1f77bcf86cd799439011',
        idempotencyKey: 'idem-key-12345678',
        segments: [
          {
            serviceId: '507f1f77bcf86cd799439012',
            staffId: '507f1f77bcf86cd799439013',
            startTime: '2026-11-01T10:00:00.000Z',
          },
          {
            serviceId: '507f1f77bcf86cd799439014',
            staffId: 'any',
            startTime: '2026-11-01T10:45:00.000Z',
          },
        ],
      };

      const result = createBookingSchema.parse(input);
      assert.equal(result.segments.length, 2);
      assert.equal(result.segments[1].staffId, 'any');
    });

    it('rejects booking with empty segments', () => {
      const input = {
        businessId: '507f1f77bcf86cd799439011',
        idempotencyKey: 'idem-key-12345678',
        segments: [],
      };

      assert.throws(
        () => createBookingSchema.parse(input),
        /At least one service segment is required/
      );
    });
  });
});
