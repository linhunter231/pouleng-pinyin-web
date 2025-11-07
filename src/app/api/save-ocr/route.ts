import { promises as fs } from 'fs';
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';

export async function POST(req: NextRequest) {
  try {
    const ocrDataFromFrontend = await req.json();
    const filePath = path.join(process.cwd(), 'public', 'ocr_results', 'wdzh', 'dic-017.json');

    // Read the existing file content
    const existingFileContent = await fs.readFile(filePath, 'utf-8');
    const existingOcrJson = JSON.parse(existingFileContent);

    // Update only the TextDetections part
    existingOcrJson.TextDetections = ocrDataFromFrontend;

    await fs.writeFile(filePath, JSON.stringify(existingOcrJson, null, 4), 'utf-8');
    return NextResponse.json({ message: 'OCR data saved successfully' });
  } catch (error) {
    console.error('Error saving OCR data:', error);
    return NextResponse.json({ message: 'Failed to save OCR data' }, { status: 500 });
  }
}