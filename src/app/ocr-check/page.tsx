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
  const [initialOcrData, setInitialOcrData] = useState<OcrResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const imageContainerRef = useRef<HTMLDivElement>(null);
  const leftPaneRef = useRef<HTMLDivElement>(null);
  const [originalOcrDimensions, setOriginalOcrDimensions] = useState<{ width: number; height: number } | null>(null);
  const [imageRenderedDimensions, setImageRenderedDimensions] = useState<{ width: number; height: number; naturalWidth: number; naturalHeight: number; offsetX: number; offsetY: number; containerHeight: number } | null>(null);
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [currentImageIndex, setCurrentImageIndex] = useState<number>(0);

  const currentFileName = fileNames[currentImageIndex];
  const imageName = currentFileName ? `${currentFileName}.png` : '';
  const jsonName = currentFileName ? `${currentFileName}.json` : '';
  console.log("Current imageName:", imageName, "and jsonName:", jsonName);

  useEffect(() => {
    const fetchFileNames = async () => {
      try {
        const response = await fetch('/api/files');
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        setFileNames(data.files);
        console.log("Fetched file names:", data.files);
      } catch (e: any) {
        console.error('Error fetching file names:', e);
        setError(e.message);
      }
    };
    fetchFileNames();
  }, []);

  useEffect(() => {
    async function fetchOcrData() {
        if (!jsonName) return; // Use the global jsonName and check if it's valid

        try {
        setLoading(true);
        // const currentFileName = fileNames[currentImageIndex]; // Removed
        // const imageName = `${currentFileName}.png`; // Removed
        // const jsonName = `${currentFileName}.json`; // Removed, using global jsonName

        const response = await fetch(`/ocr_results/wdzh/${jsonName}`); // Use global jsonName
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
  }, [jsonName, currentImageIndex]); // Updated dependency array

  useEffect(() => {
    const fetchImageDimensions = async () => {
      console.log("Fetching image dimensions for: ", imageName);
            if (imageName) {
        try {
          const response = await fetch(`/api/image-info?imageName=${imageName}`);
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }
          const data = await response.json();
          setOriginalOcrDimensions({ width: data.width, height: data.height });
          console.log("Fetched original image dimensions:", data);
        } catch (error) {
          console.error("Error fetching image dimensions:", error);
        }
      }
    };

    fetchImageDimensions();
  }, [imageName, currentImageIndex, fileNames]);

  useEffect(() => {
    if (ocrData) {
      let maxX = 0;
      let maxY = 0;

      ocrData.forEach(item => {
        const { X, Y, Width, Height } = item.ItemPolygon;
        if (X + Width > maxX) maxX = X + Width;
        if (Y + Height > maxY) maxY = Y + Height;
      });
      // Removed fixed offsets, now using actual image dimensions
      // setOriginalOcrDimensions({ width: maxX, height: maxY }); // This line is removed
      console.log("originalOcrDimensions:", { width: maxX, height: maxY });
    }
  }, [ocrData]);

  const handleImageLoad = () => {
    if (imageRef.current && imageContainerRef.current && leftPaneRef.current) {
      const { naturalWidth, naturalHeight, width, height } = imageRef.current;
      const imageRect = imageRef.current.getBoundingClientRect();
      const leftPaneRect = leftPaneRef.current.getBoundingClientRect();

      const offsetX = imageRect.left - leftPaneRef.current.offsetLeft;
      const offsetY = imageRect.top - leftPaneRef.current.offsetTop;
      const containerHeight = imageContainerRef.current.offsetHeight; // Get container height

      console.log("Image Ref Width:", width);
      console.log("Image Ref Height:", height);
      console.log("Image Container Offset Width:", imageContainerRef.current.offsetWidth);
      console.log("Image Container Offset Height:", imageContainerRef.current.offsetHeight);

      // setOriginalOcrDimensions({ width: naturalWidth, height: naturalHeight }); // This is now handled by API call

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

  useEffect(() => {
    const handleResize = () => {
      handleImageLoad();
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [imageRenderedDimensions]); // Depend on imageRenderedDimensions to re-run when it changes

  if (loading) return <div className="flex justify-center items-center h-screen">加载中...</div>;
  if (error) return <div className="flex justify-center items-center h-screen text-red-500">错误: {error}</div>;

  const handlePrevious = () => {
    setCurrentImageIndex(prevIndex => Math.max(0, prevIndex - 1));
  };

  const handleNext = () => {
    setCurrentImageIndex(prevIndex => Math.min(fileNames.length - 1, prevIndex + 1));
  };

  return (
    <div className="flex flex-grow">
      {/* Left Pane: Image */}
      <div className="p-4 border-r border-gray-300 overflow-auto flex-grow basis-0" ref={leftPaneRef}>
        <div className="flex justify-between items-center mb-4">
          <button
            onClick={handlePrevious}
            disabled={currentImageIndex === 0}
            className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50 disabled:cursor-not-allowed"
          >
            上一页
          </button>
          <select
            value={currentImageIndex}
            onChange={(e) => setCurrentImageIndex(Number(e.target.value))}
            className="p-2 border rounded"
          >
            {fileNames.map((name, index) => (
              <option key={name} value={index}>
                {name}
              </option>
            ))}
          </select>
          <button
            onClick={handleNext}
            disabled={currentImageIndex === fileNames.length - 1}
            className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50 disabled:cursor-not-allowed"
          >
            下一页
          </button>
        </div>
        <div className="relative w-full h-auto" ref={imageContainerRef}> {/* This div will contain the image */} 
          {imageName && (
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
          )}
        </div>
      </div>

      {/* Right Pane: OCR Detected Text on Image */}
      <div className="p-4 overflow-auto flex flex-col flex-grow basis-0">

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
          className="relative border border-gray-300 overflow-y-auto flex-grow"
          style={imageRenderedDimensions ? {
              // width: `${imageRenderedDimensions.width}px`,
              // height: `${imageRenderedDimensions.containerHeight}px`,
              // marginLeft: `${imageRenderedDimensions.offsetX}px`,
              // marginTop: `${imageRenderedDimensions.offsetY}px`,
            } : {}}
          >
          {ocrData && imageRenderedDimensions && originalOcrDimensions && ocrData.map((detection, index) => {
            const { X, Y, Width, Height } = detection.ItemPolygon;
            const { naturalWidth, naturalHeight, width: renderedWidth, height: renderedHeight } = imageRenderedDimensions;

            const scaleX = imageRenderedDimensions.width / originalOcrDimensions.width;
            const scaleY = imageRenderedDimensions.height / originalOcrDimensions.height;
            const style: React.CSSProperties = {
              position: 'absolute',
              left: `${X * scaleX}px`,
              top: `${Y * scaleY}px`,
              width: `${Width * scaleX}px`,
              height: `${Height * scaleY}px`,
              border: '1px solid rgba(0, 123, 255, 0.7)',
              fontSize: `${Math.max(12, 16 * Math.min(scaleX, scaleY))}px`, // Scale font size, with a minimum of 12px
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-start',
              textAlign: 'left',
              whiteSpace: 'nowrap',
              textOverflow: 'ellipsis',
              boxSizing: 'border-box',
            };

            return (
              <div
                key={`wrapper-${index}`}
                style={{
                  position: 'absolute',
                  left: `${X * scaleX}px`,
                  top: `${Y * scaleY}px`,
                  width: `${Width * scaleX}px`,
                  height: `${Height * scaleY}px`,
                }}
              >
                <div
                  key={index}
                  style={{
                    position: 'relative',
                    width: '100%',
                    height: '100%',
                    border: '1px solid rgba(0, 123, 255, 0.7)',
                    fontSize: `${Math.max(8, 125 * Math.min(scaleX, scaleY))}px`, // Scale font size, with a minimum of 12px
                    overflow: 'hidden',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-start',
                    textAlign: 'left',
                    whiteSpace: 'nowrap',
                    textOverflow: 'ellipsis',
                    boxSizing: 'border-box',
                    color: `rgba(0, 0, 0, ${
                      detection.Confidence === 100 ? 1 :
                      detection.Confidence === 99 ? 0.9 :
                      detection.Confidence === 98 ? 0.7 :
                      0.4
                    })`,
                  }}
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
                <span style={{
                  position: 'absolute',
                  top: '-15px', // Adjust this value to position it correctly above the box
                  left: '-15px', // Adjust this value to position it correctly to the left of the box
                  fontSize: '8px',
                  backgroundColor: 'rgba(255, 255, 255, 0.7)',
                  padding: '2px 4px',
                  borderRadius: '4px',
                  zIndex: 10, // Ensure it's above the text box
                }}>
                  {JSON.parse(detection.AdvancedInfo).Parag.ParagNo}
                </span>
                <span style={{
                  position: 'absolute',
                  top: '-15px', // Adjust this value to position it correctly above the box
                  right: '0px', // Adjust this value to position it correctly to the right of the box
                  fontSize: '8px',
                  backgroundColor: 'rgba(255, 255, 255, 0.7)',
                  padding: '2px 4px',
                  borderRadius: '4px',
                  zIndex: 10, // Ensure it's above the text box
                }}>
                  {detection.Confidence}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};