import { NextRequest, NextResponse } from "next/server";
import { getQuiz } from "@/lib/repos/quiz";
import { serializeQuiz, quizFilenameSlug } from "@/lib/quiz-io";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const quiz = await getQuiz(id);
  if (!quiz) return NextResponse.json({ error: "not found" }, { status: 404 });

  const json = serializeQuiz({
    title: quiz.title,
    questions: quiz.questions.map((q) => ({
      type: q.type,
      text: q.text,
      options: q.options,
      correct: q.correct,
      timeLimit: q.timeLimit,
      doublePoints: q.doublePoints,
    })),
  });
  const filename = quizFilenameSlug(quiz.title);

  return new NextResponse(json, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
