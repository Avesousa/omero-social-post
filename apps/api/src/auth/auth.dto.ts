import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './auth.constants';

/** Usernames are stored lower-cased, so login is case-insensitive. */
const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(32)
  .regex(/^[a-z0-9._-]+$/, 'may only contain letters, digits, dots, dashes and underscores');

export const setupSchema = z.object({
  username: usernameSchema,
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
});

/** Looser than setup on purpose: login must not reveal the password policy. */
export const loginSchema = z.object({
  username: z.string().trim().toLowerCase().min(1).max(64),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

export const setupStatusSchema = z.object({ needsSetup: z.boolean() });

export const meSchema = z.object({ id: z.uuid(), username: z.string() });

export class SetupDto extends createZodDto(setupSchema) {}
export class LoginDto extends createZodDto(loginSchema) {}
export class SetupStatusDto extends createZodDto(setupStatusSchema) {}
export class MeDto extends createZodDto(meSchema) {}
