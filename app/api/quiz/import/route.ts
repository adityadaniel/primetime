import { NextRequest, NextResponse } from "next/server";
import { createQuiz } from "@/lib/repos/quiz";
import { parseQuiz } from "@/lib/quiz-io";

export async function POST(req: NextRequest) {
  const contentType = req.headers.get("content-type") ?? "";
  let json: string;

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "file field required" }, { status: 400 });
      }
      json = await file.text();
    } else {
      json = await req.text();
    }
  } catch {
    return NextResponse.json({ error: "Could not read body" }, { status: 400 });
  }

  const parsed = parseQuiz(json);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  try {
    const quiz = await createQuiz(parsed.data);
    return NextResponse.json({ id: quiz.id });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "create failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
