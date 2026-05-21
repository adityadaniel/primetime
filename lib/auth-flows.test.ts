import { describe, it, expect, vi, beforeEach } from "vitest";
import { compare } from "bcryptjs";
import { createHash, randomBytes } from "crypto";

const userFindUnique = vi.fn();
const userCreate = vi.fn();
const userUpdate = vi.fn();
const tokenCreate = vi.fn();
const tokenFindUnique = vi.fn();
const tokenUpdate = vi.fn();
const txn = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: (args: unknown) => userFindUnique(args),
      create: (args: unknown) => userCreate(args),
      update: (args: unknown) => userUpdate(args),
    },
    passwordResetToken: {
      create: (args: unknown) => tokenCreate(args),
      findUnique: (args: unknown) => tokenFindUnique(args),
      update: (args: unknown) => tokenUpdate(args),
    },
    $transaction: (ops: unknown[]) => txn(ops),
  },
}));

vi.mock("@/auth", () => ({ auth: vi.fn() }));

import { POST as signupPOST } from "@/app/api/auth/signup/route";
import { POST as resetRequestPOST } from "@/app/api/auth/reset/route";
import { POST as resetTokenPOST } from "@/app/api/auth/reset/[token]/route";

function jsonReq(url: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  userFindUnique.mockReset();
  userCreate.mockReset();
  userUpdate.mockReset();
  tokenCreate.mockReset();
  tokenFindUnique.mockReset();
  tokenUpdate.mockReset();
  txn.mockReset();
});

describe("POST /api/auth/signup", () => {
  it("creates a user with a hashed password and lowercases email", async () => {
    userFindUnique.mockResolvedValue(null);
    let createdData: { email: string; passwordHash: string; name: string | null } | null = null;
    userCreate.mockImplementation(({ data }: { data: { email: string; passwordHash: string; name: string | null } }) => {
      createdData = data;
      return { id: "u1", ...data };
    });

    const res = await signupPOST(
      jsonReq("http://localhost/api/auth/signup", {
        email: "Alice@Example.com",
        password: "hunter22",
        name: "Alice",
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(createdData).not.toBeNull();
    expect(createdData!.email).toBe("alice@example.com");
    expect(createdData!.passwordHash).not.toBe("hunter22");
    expect(await compare("hunter22", createdData!.passwordHash)).toBe(true);
  });

  it("rejects an existing email with 409", async () => {
    userFindUnique.mockResolvedValue({ id: "u1", email: "alice@example.com" });

    const res = await signupPOST(
      jsonReq("http://localhost/api/auth/signup", {
        email: "alice@example.com",
        password: "hunter22",
      }),
    );

    expect(res.status).toBe(409);
    expect(userCreate).not.toHaveBeenCalled();
  });

  it("rejects passwords shorter than 8 chars with 400", async () => {
    userFindUnique.mockResolvedValue(null);
    const res = await signupPOST(
      jsonReq("http://localhost/api/auth/signup", {
        email: "alice@example.com",
        password: "short",
      }),
    );
    expect(res.status).toBe(400);
    expect(userCreate).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON with 400", async () => {
    const req = new Request("http://localhost/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    const res = await signupPOST(req);
    expect(res.status).toBe(400);
  });
});

describe("POST /api/auth/reset", () => {
  it("returns 200 even when no user exists (no leak)", async () => {
    userFindUnique.mockResolvedValue(null);
    const res = await resetRequestPOST(
      jsonReq("http://localhost/api/auth/reset", { email: "ghost@example.com" }),
    );
    expect(res.status).toBe(200);
    expect(tokenCreate).not.toHaveBeenCalled();
  });

  it("returns 200 and creates a token when user exists", async () => {
    userFindUnique.mockResolvedValue({ id: "u1", email: "alice@example.com" });
    tokenCreate.mockResolvedValue({ id: "t1" });

    const res = await resetRequestPOST(
      jsonReq(
        "http://localhost/api/auth/reset",
        { email: "alice@example.com" },
        { origin: "http://localhost:4321" },
      ),
    );

    expect(res.status).toBe(200);
    expect(tokenCreate).toHaveBeenCalledOnce();
    const args = tokenCreate.mock.calls[0][0] as {
      data: { userId: string; tokenHash: string; expires: Date };
    };
    expect(args.data.userId).toBe("u1");
    expect(args.data.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(args.data.expires.getTime()).toBeGreaterThan(Date.now());
  });

  it("returns 200 even on invalid email payload (no leak)", async () => {
    const res = await resetRequestPOST(
      jsonReq("http://localhost/api/auth/reset", { email: "not-an-email" }),
    );
    expect(res.status).toBe(200);
    expect(tokenCreate).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/reset/[token]", () => {
  function makeCtx(token: string) {
    return { params: Promise.resolve({ token }) };
  }

  it("rejects an invalid (unknown) token with 400", async () => {
    tokenFindUnique.mockResolvedValue(null);
    const raw = randomBytes(32).toString("base64url");
    const res = await resetTokenPOST(
      jsonReq(`http://localhost/api/auth/reset/${raw}`, { password: "newpass99" }),
      makeCtx(raw),
    );
    expect(res.status).toBe(400);
  });

  it("rejects an expired token with 400", async () => {
    tokenFindUnique.mockResolvedValue({
      id: "t1",
      userId: "u1",
      expires: new Date(Date.now() - 1000),
      used: false,
    });
    const raw = randomBytes(32).toString("base64url");
    const res = await resetTokenPOST(
      jsonReq(`http://localhost/api/auth/reset/${raw}`, { password: "newpass99" }),
      makeCtx(raw),
    );
    expect(res.status).toBe(400);
    expect(txn).not.toHaveBeenCalled();
  });

  it("rejects a used token with 400", async () => {
    tokenFindUnique.mockResolvedValue({
      id: "t1",
      userId: "u1",
      expires: new Date(Date.now() + 60_000),
      used: true,
    });
    const raw = randomBytes(32).toString("base64url");
    const res = await resetTokenPOST(
      jsonReq(`http://localhost/api/auth/reset/${raw}`, { password: "newpass99" }),
      makeCtx(raw),
    );
    expect(res.status).toBe(400);
    expect(txn).not.toHaveBeenCalled();
  });

  it("accepts a valid token, hashes the new password, marks token used", async () => {
    const raw = randomBytes(32).toString("base64url");
    const expectedHash = createHash("sha256").update(raw).digest("hex");
    tokenFindUnique.mockResolvedValue({
      id: "t1",
      userId: "u1",
      tokenHash: expectedHash,
      expires: new Date(Date.now() + 60_000),
      used: false,
    });
    txn.mockResolvedValue([{ email: "alice@example.com" }, { id: "t1", used: true }]);

    const res = await resetTokenPOST(
      jsonReq(`http://localhost/api/auth/reset/${raw}`, { password: "newpass99" }),
      makeCtx(raw),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, email: "alice@example.com" });
    expect(tokenFindUnique).toHaveBeenCalledWith({ where: { tokenHash: expectedHash } });
    expect(txn).toHaveBeenCalledOnce();
  });

  it("rejects weak passwords with 422", async () => {
    const raw = randomBytes(32).toString("base64url");
    const res = await resetTokenPOST(
      jsonReq(`http://localhost/api/auth/reset/${raw}`, { password: "short" }),
      makeCtx(raw),
    );
    expect(res.status).toBe(422);
    expect(tokenFindUnique).not.toHaveBeenCalled();
  });
});
