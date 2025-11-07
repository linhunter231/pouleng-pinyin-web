import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { promises as fs } from 'fs';
import sizeOf from 'image-size';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const imageName = searchParams.get('imageName');

  if (!imageName) {
    return NextResponse.json({ error: 'Image name is required' }, { status: 400 });
  }

  try {
    const imagePath = path.join(process.cwd(), 'public', 'images', 'wdzh', imageName);
    const imageBuffer = await fs.readFile(imagePath);
    const dimensions = sizeOf(imageBuffer);

    if (dimensions && dimensions.width && dimensions.height) {
      return NextResponse.json({ width: dimensions.width, height: dimensions.height });
    } else {
      return NextResponse.json({ error: 'Could not determine image dimensions' }, { status: 500 });
    }
  } catch (error) {
    console.error('Error getting image info:', error);
    return NextResponse.json({ error: 'Failed to get image info' }, { status: 500 });
  }
}