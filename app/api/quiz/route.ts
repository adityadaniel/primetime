import { NextRequest, NextResponse } from "next/server";
import { createQuiz, listQuizzes } from "@/lib/repos/quiz";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const quiz = await createQuiz(body);
    return NextResponse.json({ id: quiz.id });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "bad request";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function GET() {
  const list = await listQuizzes();
  return NextResponse.json(list);
}
