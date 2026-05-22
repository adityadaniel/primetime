import { NextResponse } from "next/server";
import { z } from "zod";
import { createHash } from "crypto";
import { hash } from "bcryptjs";
import { prisma } from "@/lib/db";

const Body = z.object({ password: z.string().min(8).max(200) });

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;
  if (!token || typeof token !== "string") {
    return NextResponse.json({ error: "Invalid token" }, { status: 400 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Use 8+ characters" },
      { status: 422 },
    );
  }

  const tokenHash = hashToken(token);
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
  });
  if (!record || record.used || record.expires.getTime() < Date.now()) {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 400 });
  }

  const passwordHash = await hash(parsed.data.password, 12);

  const [updatedUser] = await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash },
      select: { email: true },
    }),
    prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { used: true },
    }),
  ]);

  return NextResponse.json({ ok: true, email: updatedUser.email });
}
