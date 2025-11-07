"use client";

import { useEffect, useState, useRef } from 'react';
import Image from 'next/image';

interface OcrDetectionItem {
  DetectedText: string;
  Confidence: number;
  ItemPolygon: {
    X: number;
    Y: number;
    Width: number;
    Height: number;
  };
  AdvancedInfo: string;
}

type OcrResult = OcrDetectionItem[];

export default function OcrCheckPage() {
  const [ocrData, setOcrData] = useState<OcrResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const imageContainerRef = useRef<HTMLDivElement>(null);
  const leftPaneRef = useRef<HTMLDivElement>(null);
  const [originalOcrDimensions, setOriginalOcrDimensions] = useState<{ width: number; height: number } | null>(null);
  const [imageRenderedDimensions, setImageRenderedDimensions] = useState<{ width: number; height: number; naturalWidth: number; naturalHeight: number; offsetX: number; offsetY: number; containerHeight: number } | null>(null);
  const [initialOcrData, setInitialOcrData] = useState<OcrResult | null>(null); // New state for initial OCR data

  const imageName = "dic-017.png";
  const jsonName = "dic-017.json";

  useEffect(() => {
    async function fetchOcrData() {
      try {
        const response = await fetch(`/ocr_results/wdzh/${jsonName}`);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data: any = await response.json(); // Fetch raw data first

        // Extract TextDetections array, handling both direct and nested structures
        const textDetections = data.Response?.TextDetections || data.TextDetections;

        if (!textDetections) {
          throw new Error("OCR data does not contain TextDetections.");
        }
        setOcrData(textDetections as OcrResult);
        setInitialOcrData(textDetections as OcrResult); // Set initial OCR data
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }

    fetchOcrData();
  }, [jsonName]);

  useEffect(() => {
    if (ocrData) {
      let maxX = 0;
      let maxY = 0;

      ocrData.forEach(item => {
        const { X, Y, Width, Height } = item.ItemPolygon;
        if (X + Width > maxX) maxX = X + Width;
        if (Y + Height > maxY) maxY = Y + Height;
      });
      maxX = maxX + 500;
      maxY = maxY + 400;
      setOriginalOcrDimensions({ width: maxX, height: maxY });
      console.log("originalOcrDimensions:", { width: maxX, height: maxY });
    }
  }, [ocrData]);

  const handleImageLoad = () => {
    if (imageRef.current && imageContainerRef.current && leftPaneRef.current) {
      const { naturalWidth, naturalHeight, width, height } = imageRef.current;
      const imageRect = imageRef.current.getBoundingClientRect();
      const leftPaneRect = leftPaneRef.current.getBoundingClientRect();

      const offsetX = imageRect.left - leftPaneRect.left;
      const offsetY = imageRect.top - leftPaneRect.top;
      const containerHeight = imageContainerRef.current.offsetHeight; // Get container height

      const dimensions = {
        naturalWidth,
        naturalHeight,
        width,
        height,
        offsetX,
        offsetY,
        containerHeight, // Add container height to state
      };
      setImageRenderedDimensions(dimensions);
    }
  };

  if (loading) return <div className="flex justify-center items-center h-screen">加载中...</div>;
  if (error) return <div className="flex justify-center items-center h-screen text-red-500">错误: {error}</div>;

  return (
    <div className="flex h-screen">
      {/* Left Pane: Image */}
      <div className="w-1/2 p-4 border-r border-gray-300 overflow-auto" ref={leftPaneRef}>
        <h2 className="text-xl font-bold mb-4">图片: {imageName}</h2>
        <div className="relative w-full h-auto" ref={imageContainerRef}> {/* This div will contain the image */} 
          <Image
            ref={imageRef}
            src={`/images/wdzh/${imageName}`}
            alt="OCR Image"
            layout="responsive"
            width={1000} // These are intrinsic width/height hints for Next.js, not necessarily rendered size
            height={1500}
            objectFit="contain"
            onLoad={handleImageLoad}
          />
        </div>
      </div>

      {/* Right Pane: OCR Detected Text on Image */}
      <div className="w-1/2 p-4 overflow-auto">

        <div className="flex space-x-2 mb-4">
          <button
            className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
            onClick={async () => {
              try {
                const response = await fetch('/api/save-ocr', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify(ocrData),
                });
                if (response.ok) {
                  alert('OCR data saved successfully!');
                } else {
                  alert('Failed to save OCR data.');
                }
              } catch (error) {
                console.error('Error saving OCR data:', error);
                alert('Error saving OCR data.');
              }
            }}
          >
            保存所有更改
          </button>
          <button
            className="bg-gray-500 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded"
            onClick={() => setOcrData(initialOcrData)}
          >
            重置所有更改
          </button>
        </div>
        <div
          className="relative border border-gray-300 overflow-y-auto"
          style={{ height: imageRenderedDimensions?.containerHeight || 'auto' }}
          style={imageRenderedDimensions ? {
              width: `${imageRenderedDimensions.width}px`,
              height: `${imageRenderedDimensions.containerHeight}px`,
              marginLeft: `${imageRenderedDimensions.offsetX}px`,
              marginTop: `${imageRenderedDimensions.offsetY}px`,
            } : {}}
          >
          {ocrData && imageRenderedDimensions && originalOcrDimensions && ocrData.map((detection, index) => {
            const { X, Y, Width, Height } = detection.ItemPolygon;
            const { naturalWidth, naturalHeight, width: renderedWidth, height: renderedHeight } = imageRenderedDimensions;

            const scaleX = imageRenderedDimensions.width / originalOcrDimensions.width;
            const scaleY = imageRenderedDimensions.height / originalOcrDimensions.height;

            const style: React.CSSProperties = {
              position: 'absolute',
              left: `${X * scaleX + imageRenderedDimensions.offsetX}px`,
              top: `${Y * scaleY}px`,
              minWidth: `${Width * scaleX * 1}px`,
              minHeight: `${Height * scaleY * 1}px`,
              width: 'auto',
              height: 'auto',
              border: '1px solid rgba(0, 123, 255, 0.7)',
              backgroundColor: 'rgba(0, 123, 255, 0.2)',
              boxSizing: 'border-box',
              display: 'flex',
              alignItems: 'center',
              fontSize: '14px',
              color: 'black',
              overflow: 'auto', // Changed from hidden
              textAlign: 'left',
              whiteSpace: 'normal',
              wordBreak: 'break-word',
            };

            return (
              <div
                key={index}
                style={style}
                title={detection.DetectedText}
                contentEditable="true"
                suppressContentEditableWarning={true}
                onBlur={(e) => {
                  const newText = e.currentTarget.textContent || '';
                  setOcrData(prevOcrData => {
                    if (!prevOcrData) return null;
                    const newOcrData = [...prevOcrData];
                    newOcrData[index] = { ...newOcrData[index], DetectedText: newText };
                    return newOcrData;
                  });
                  console.log(`Edited text for item ${index}:`, newText);
                }}
              >
                {detection.DetectedText}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};