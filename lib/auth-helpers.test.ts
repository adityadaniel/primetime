import { compare, hash } from 'bcryptjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const userCreate = vi.fn();

vi.mock('@/lib/db', () => ({
  prisma: {
    user: {
      create: (args: unknown) => userCreate(args),
    },
  },
}));

vi.mock('@/auth', () => ({
  auth: vi.fn(),
}));

import { createCredentialsUser } from './auth-helpers';

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
