import { type NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { config as appConfig } from '@/lib/config';
import { uploadLocal } from '@/lib/upload';

export async function POST(req: NextRequest) {
  if (appConfig.uploadProvider !== 'local') {
    return NextResponse.json(
      {
        error: `Upload provider is "${appConfig.uploadProvider}". Set UPLOAD_PROVIDER=local for local uploads.`,
      },
      { status: 400 },
    );
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.includes('multipart/form-data')) {
    return NextResponse.json(
      { error: 'Content-Type must be multipart/form-data' },
      { status: 400 },
    );
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json(
      { error: 'No file provided. Include a "file" field in your multipart form.' },
      { status: 400 },
    );
  }

  const subdir = formData.get('subdir');
  const result = await uploadLocal(
    file,
    {
      uploadDir: appConfig.uploadDir,
      maxBytes: appConfig.uploadMaxBytes,
    },
    typeof subdir === 'string' && subdir.length > 0 ? subdir : undefined,
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json(
    {
      url: result.urlPath,
      size: result.size,
      mimeType: result.mimeType,
    },
    { status: 201 },
  );
}

export const config = {
  api: {
    bodyParser: false,
  },
};
