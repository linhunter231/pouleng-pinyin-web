import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
  const imagesDir = path.join(process.cwd(), 'public', 'images', 'wdzh');
  const ocrResultsDir = path.join(process.cwd(), 'public', 'ocr_results', 'wdzh');

  try {
    const imageFiles = await fs.promises.readdir(imagesDir);
    const jsonFiles = await fs.promises.readdir(ocrResultsDir);

    const imageNames = imageFiles.filter(file => file.endsWith('.png')).map(file => file.replace('.png', ''));
    const jsonNames = jsonFiles.filter(file => file.endsWith('.json')).map(file => file.replace('.json', ''));

    // Find common base names and sort them numerically
    const commonNames = imageNames.filter(name => jsonNames.includes(name));
    commonNames.sort((a, b) => {
      const numA = parseInt(a.replace('dic-', ''), 10);
      const numB = parseInt(b.replace('dic-', ''), 10);
      return numA - numB;
    });

    return NextResponse.json({ files: commonNames });
  } catch (error) {
    console.error('Error reading directories:', error);
    return NextResponse.json({ error: 'Failed to read files' }, { status: 500 });
  }
}