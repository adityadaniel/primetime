import { compare, hash } from 'bcryptjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const userCreate = vi.fn();
const userFindUnique = vi.fn();

vi.mock('@/lib/db', () => ({
  prisma: {
    user: {
      create: (args: unknown) => userCreate(args),
      findUnique: (args: unknown) => userFindUnique(args),
    },
  },
}));

vi.mock('@/auth', () => ({
  auth: vi.fn(),
}));

import { createCredentialsUser, verifyCredentials } from './auth-helpers';

describe('password hashing', () => {
  it('roundtrips a password through bcrypt.compare', async () => {
    const hashed = await hash('hunter2', 4);
    expect(await compare('hunter2', hashed)).toBe(true);
    expect(await compare('hunter3', hashed)).toBe(false);
  });

  it("produces hashes that don't equal the plaintext", async () => {
    const hashed = await hash('hunter2', 4);
    expect(hashed).not.toBe('hunter2');
    expect(hashed.length).toBeGreaterThan(20);
  });
});

describe('createCredentialsUser', () => {
  beforeEach(() => {
    userCreate.mockReset();
    userCreate.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
      id: 'u1',
      ...data,
    }));
  });

  it('stores a hashed password rather than plaintext', async () => {
    await createCredentialsUser('Alice@Example.com', 'hunter2', 'Alice');

    expect(userCreate).toHaveBeenCalledOnce();
    const args = userCreate.mock.calls[0][0] as { data: { passwordHash: string } };
    expect(args.data.passwordHash).not.toBe('hunter2');
    expect(await compare('hunter2', args.data.passwordHash)).toBe(true);
  });

  it('lowercases the email', async () => {
    await createCredentialsUser('Alice@Example.com', 'hunter2');
    const args = userCreate.mock.calls[0][0] as { data: { email: string } };
    expect(args.data.email).toBe('alice@example.com');
  });

  it('defaults missing name to null', async () => {
    await createCredentialsUser('bob@example.com', 'hunter2');
    const args = userCreate.mock.calls[0][0] as { data: { name: string | null } };
    expect(args.data.name).toBeNull();
  });
});

describe('verifyCredentials', () => {
  beforeEach(() => {
    userFindUnique.mockReset();
  });

  it('returns the safe user shape on a correct email/password (happy path)', async () => {
    const passwordHash = await hash('hunter2', 4);
    userFindUnique.mockResolvedValue({
      id: 'u1',
      email: 'alice@example.com',
      passwordHash,
      name: 'Alice',
      image: null,
      tier: 'free',
    });

    const result = await verifyCredentials('Alice@Example.com', 'hunter2');

    expect(result).toEqual({
      id: 'u1',
      email: 'alice@example.com',
      name: 'Alice',
      image: null,
    });
    // Email is lowercased before lookup so casing never blocks sign-in.
    expect(userFindUnique).toHaveBeenCalledWith({ where: { email: 'alice@example.com' } });
  });

  it('returns null when the password is wrong (invalid credentials)', async () => {
    const passwordHash = await hash('hunter2', 4);
    userFindUnique.mockResolvedValue({
      id: 'u1',
      email: 'alice@example.com',
      passwordHash,
      name: 'Alice',
      image: null,
    });

    expect(await verifyCredentials('alice@example.com', 'wrong-password')).toBeNull();
  });

  it('returns null for an unknown email', async () => {
    userFindUnique.mockResolvedValue(null);
    expect(await verifyCredentials('ghost@example.com', 'hunter2')).toBeNull();
  });

  it('returns null for an account with no password set (e.g. OAuth-only)', async () => {
    userFindUnique.mockResolvedValue({
      id: 'u1',
      email: 'alice@example.com',
      passwordHash: null,
      name: 'Alice',
      image: null,
    });
    expect(await verifyCredentials('alice@example.com', 'hunter2')).toBeNull();
  });

  it('returns null on malformed input without touching the database', async () => {
    expect(await verifyCredentials(undefined, 'hunter2')).toBeNull();
    expect(await verifyCredentials('alice@example.com', undefined)).toBeNull();
    expect(await verifyCredentials('', '')).toBeNull();
    expect(userFindUnique).not.toHaveBeenCalled();
  });
});
