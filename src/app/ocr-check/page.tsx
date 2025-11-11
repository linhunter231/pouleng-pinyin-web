"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import Image from 'next/image';
import JSZip from 'jszip'; // Import JSZip

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
  const [focusedElementIndex, setFocusedElementIndex] = useState<number | null>(null); // New state for tracking focused element
  // Insert a visual line break at the caret inside a contentEditable element
  const insertLineBreakAtCaret = () => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const br = document.createElement('br');
    range.insertNode(br);
    // Move caret after the inserted BR
    range.setStartAfter(br);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  };
  const leftPaneRef = useRef<HTMLDivElement>(null);
  const [originalOcrDimensions, setOriginalOcrDimensions] = useState<{ width: number; height: number } | null>(null);
  const [imageRenderedDimensions, setImageRenderedDimensions] = useState<{ width: number; height: number; naturalWidth: number; naturalHeight: number; offsetX: number; offsetY: number; containerHeight: number } | null>(null);
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [currentImageIndex, setCurrentImageIndex] = useState<number>(0);
  const currentEditableInfo = useRef<{ element: HTMLElement; index: number; caretOffset?: number } | null>(null);
  const pinyinButtonsRef = useRef<HTMLDivElement>(null);
  const rightRawRef = useRef<HTMLDivElement>(null);
  const rightParagraphRef = useRef<HTMLDivElement>(null);
  const isSyncingScrollRef = useRef(false);

  // Local mode states
  const [imageZipFile, setImageZipFile] = useState<File | null>(null);
  const [jsonZipFile, setJsonZipFile] = useState<File | null>(null);
  const [localImageUrls, setLocalImageUrls] = useState<Record<string, string>>({});
  const [localJsonData, setLocalJsonData] = useState<Record<string, any>>({});
  const [editedLocalJsonData, setEditedLocalJsonData] = useState<Record<string, any>>({});
  const [isLocalMode, setIsLocalMode] = useState<boolean>(false);

  // 右侧视图模式：图上定位文本 / 原始 JSON / 段号排序文本
  const [rightViewMode, setRightViewMode] = useState<'overlay' | 'raw' | 'paragraph'>('overlay');

  // 同步左右两侧的滚动（在原始JSON/按段号模式下）
  useEffect(() => {
    const leftEl = leftPaneRef.current;
    const rightEl = rightViewMode === 'raw' ? rightRawRef.current : rightViewMode === 'paragraph' ? rightParagraphRef.current : null;
    if (!leftEl || !rightEl) return;

    const handleLeftScroll = () => {
      if (isSyncingScrollRef.current) return;
      isSyncingScrollRef.current = true;
      rightEl.scrollTop = leftEl.scrollTop;
      isSyncingScrollRef.current = false;
    };
    const handleRightScroll = () => {
      if (isSyncingScrollRef.current) return;
      isSyncingScrollRef.current = true;
      leftEl.scrollTop = rightEl.scrollTop;
      isSyncingScrollRef.current = false;
    };

    leftEl.addEventListener('scroll', handleLeftScroll);
    rightEl.addEventListener('scroll', handleRightScroll);
    return () => {
      leftEl.removeEventListener('scroll', handleLeftScroll);
      rightEl.removeEventListener('scroll', handleRightScroll);
    };
  }, [rightViewMode]);

  // 从 AdvancedInfo 中安全读取 ParagNo
  const getParagNo = (item: OcrDetectionItem): number | null => {
    try {
      const adv = JSON.parse(item.AdvancedInfo || '{}');
      const val = adv?.Parag?.ParagNo;
      if (typeof val === 'number') return val;
      if (typeof val === 'string') {
        const n = Number(val);
        return Number.isNaN(n) ? null : n;
      }
      return null;
    } catch {
      return null;
    }
  };

  // 段号聚合与排序：按 ParagNo 排序，再按 Y/X；拼接文本
  const paragraphLines = useMemo(() => {
    if (!ocrData || ocrData.length === 0) return [] as { paragNo: number | null; text: string }[];
    const groups = new Map<number | null, OcrDetectionItem[]>();
    for (const d of ocrData) {
      const key = getParagNo(d);
      const arr = groups.get(key) || [];
      arr.push(d);
      groups.set(key, arr);
    }
    const sortedKeys = Array.from(groups.keys()).sort((a, b) => {
      if (a === null && b === null) return 0;
      if (a === null) return 1;
      if (b === null) return -1;
      return a - b;
    });
    const lines: { paragNo: number | null; text: string }[] = [];
    for (const k of sortedKeys) {
      const arr = groups.get(k)!;
      arr.sort((p, q) => {
        const py = p.ItemPolygon?.Y ?? 0;
        const qy = q.ItemPolygon?.Y ?? 0;
        if (py !== qy) return py - qy;
        const px = p.ItemPolygon?.X ?? 0;
        const qx = q.ItemPolygon?.X ?? 0;
        return px - qx;
      });
      const text = arr.map(x => (x.DetectedText || '').trim()).filter(Boolean).join(' ');
      lines.push({ paragNo: k, text });
    }
    return lines;
  }, [ocrData]);

  // Function to clean up object URLs when component unmounts or image URLs change
  useEffect(() => {
    return () => {
      Object.values(localImageUrls).forEach(url => URL.revokeObjectURL(url));
    };
  }, [localImageUrls]);

  const currentFileName = fileNames[currentImageIndex];
  const imageName = currentFileName ? `${currentFileName}.png` : '';
  const jsonName = currentFileName ? `${currentFileName}.json` : '';
  console.log("Current imageName:", imageName, "and jsonName:", jsonName);

  // Effect to update editedLocalJsonData when ocrData changes for the current file
  useEffect(() => {
    if (isLocalMode && currentFileName && ocrData) {
      setEditedLocalJsonData(prevData => ({
        ...prevData,
        [currentFileName]: {
          ...prevData[currentFileName],
          Response: {
            ...prevData[currentFileName]?.Response,
            TextDetections: ocrData,
          },
          TextDetections: ocrData, // Also update top-level if it exists
        },
      }));
    }
  }, [isLocalMode, currentFileName, ocrData]);

  // Handlers for local file uploads
  const handleImageZipUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImageZipFile(file);
    setIsLocalMode(true);
    setLoading(true);
    setError(null);

    try {
      const zip = await JSZip.loadAsync(file);
      const newImageUrls: Record<string, string> = {};
      const newFileNames: string[] = [];

      for (const relativePath in zip.files) {
        const zipEntry = zip.files[relativePath];
        if (!zipEntry.dir && (relativePath.endsWith('.png') || relativePath.endsWith('.jpg') || relativePath.endsWith('.jpeg'))) {
          const blob = await zipEntry.async('blob');
          const url = URL.createObjectURL(blob);
          const fileName = relativePath.split('/').pop()?.split('.')[0]; // Get base name without extension
          if (fileName) {
            newImageUrls[fileName] = url;
            newFileNames.push(fileName);
          }
        }
      }
      setLocalImageUrls(newImageUrls);
      // Only set fileNames if JSON is not yet loaded, or if this is the primary source
      if (Object.keys(localJsonData).length === 0) {
        setFileNames(newFileNames.sort());
      }
      console.log("Loaded local image URLs:", newImageUrls);
    } catch (e: any) {
      console.error("Error loading image zip:", e);
      setError(`Error loading image zip: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [localJsonData]);

  const handleJsonZipUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setJsonZipFile(file);
    setIsLocalMode(true);
    setLoading(true);
    setError(null);

    try {
      const zip = await JSZip.loadAsync(file);
      const newJsonData: Record<string, any> = {};
      const newFileNames: string[] = [];

      for (const relativePath in zip.files) {
        const zipEntry = zip.files[relativePath];
        if (!zipEntry.dir && relativePath.endsWith('.json')) {
          const text = await zipEntry.async('string');
          const jsonData = JSON.parse(text);
          const fileName = relativePath.split('/').pop()?.split('.')[0]; // Get base name without extension
          if (fileName) {
            newJsonData[fileName] = jsonData;
            newFileNames.push(fileName);
          }
        }
      }
      setLocalJsonData(newJsonData);
      setEditedLocalJsonData(newJsonData); // Initialize edited data with loaded data
      // Only set fileNames if images are not yet loaded, or if this is the primary source
      if (Object.keys(localImageUrls).length === 0) {
        setFileNames(newFileNames.sort());
      }
      console.log("Loaded local JSON data:", newJsonData);
    } catch (e: any) {
      console.error("Error loading JSON zip:", e);
      setError(`Error loading JSON zip: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [localImageUrls]);

  // Effect to combine file names from both image and JSON zips
  useEffect(() => {
    if (isLocalMode) {
      const imageKeys = Object.keys(localImageUrls);
      const jsonKeys = Object.keys(localJsonData);

      // Find common keys or combine unique keys, then sort
      const combinedKeys = Array.from(new Set([...imageKeys, ...jsonKeys])).sort();
      setFileNames(combinedKeys);

      // If both are loaded, try to set initial OCR data
      if (imageKeys.length > 0 && jsonKeys.length > 0 && combinedKeys.length > 0) {
        const firstKey = combinedKeys[0];
        const data = localJsonData[firstKey];
        const textDetections = data?.Response?.TextDetections || data?.TextDetections;
        if (textDetections) {
          setOcrData(textDetections as OcrResult);
          setInitialOcrData(textDetections as OcrResult);
        } else {
          setOcrData([]);
          setInitialOcrData([]);
        }
        setCurrentImageIndex(0);
      }
    }
  }, [isLocalMode, localImageUrls, localJsonData]);

  // Effect for fetching file names (remote mode) or setting OCR data (local mode)
  useEffect(() => {
    if (!isLocalMode) {
      const fetchFileNames = async () => {
        try {
          setLoading(true);
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
        } finally {
          setLoading(false);
        }
      };
      fetchFileNames();
    } else if (isLocalMode && currentFileName) {
      const data = localJsonData[currentFileName];
      const textDetections = data?.Response?.TextDetections || data?.TextDetections;
      if (textDetections) {
        setOcrData(textDetections as OcrResult);
        setInitialOcrData(textDetections as OcrResult);
      } else {
        setOcrData([]);
        setInitialOcrData([]);
      }
    }
  }, [isLocalMode, currentFileName, localJsonData]);

  // Effect for fetching OCR data (remote mode) or setting image dimensions (local mode)
  useEffect(() => {
    if (!isLocalMode && jsonName) {
      async function fetchOcrData() {
        try {
          setLoading(true);
          const response = await fetch(`/ocr_results/wdzh/${jsonName}`);
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }
          const data: any = await response.json();
          const textDetections = data.Response?.TextDetections || data.TextDetections;
          if (!textDetections) {
            throw new Error("OCR data does not contain TextDetections.");
          }
          setOcrData(textDetections as OcrResult);
          setInitialOcrData(textDetections as OcrResult);
        } catch (e: any) {
          setError(e.message);
        } finally {
          setLoading(false);
        }
      }
      fetchOcrData();
    } else if (isLocalMode && currentFileName) {
      // In local mode, image dimensions are derived from the loaded image itself
      // No API call needed
      if (imageRef.current) {
        setOriginalOcrDimensions({ width: imageRef.current.naturalWidth, height: imageRef.current.naturalHeight });
      }
    }
  }, [isLocalMode, jsonName, currentFileName, localJsonData]);

  // Effect to reset states when isLocalMode changes
  useEffect(() => {
    setOcrData(null);
    setInitialOcrData(null);
    setFileNames([]);
    setCurrentImageIndex(0);
    setLocalImageUrls({});
    setLocalJsonData({});
    setEditedLocalJsonData({});
    setError(null);
    setLoading(false);
  }, [isLocalMode]);

  // Effect for fetching image dimensions (remote mode)
  useEffect(() => {
    if (!isLocalMode) {
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
    }
  }, [isLocalMode, imageName, currentImageIndex, fileNames]);

  useEffect(() => {
    if (ocrData) {
      let maxX = 0;
      let maxY = 0;

      ocrData.forEach(item => {
        const { X, Y, Width, Height } = item.ItemPolygon;
        if (X + Width > maxX) maxX = X + Width;
        if (Y + Height > maxY) maxY = Y + Height;
      });
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

  // Re-instate handleResize effect to update image dimensions on window resize
  useEffect(() => {
    const handleResize = () => {
      handleImageLoad();
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [imageRenderedDimensions]); // Depend on imageRenderedDimensions to re-run when it changes

  const handlePrevious = () => {
    setCurrentImageIndex(prevIndex => Math.max(0, prevIndex - 1));
  };

  const handleNext = () => {
    setCurrentImageIndex(prevIndex => Math.min(fileNames.length - 1, prevIndex + 1));
  };

  const handleNextImage = useCallback(() => {
    setCurrentImageIndex(prevIndex => Math.min(prevIndex + 1, fileNames.length - 1));
  }, [fileNames.length]);

  const handlePreviousImage = useCallback(() => {
    setCurrentImageIndex(prevIndex => Math.max(prevIndex - 1, 0));
  }, [fileNames.length]);

  // Re-add loading and error state checks
  if (loading) return <div className="flex justify-center items-center h-screen">加载中...</div>;
  if (error) return <div className="flex justify-center items-center h-screen text-red-500">错误: {error}</div>;

  const insertPinyin = (pinyin: string) => {
    if (!currentEditableInfo.current) return;
    const { element, index } = currentEditableInfo.current;

    // 保持焦点在可编辑元素
    element.focus();

    const selection = window.getSelection();
    if (!selection) return;

    // 计算插入前的起始字符偏移（从元素起点到选区起点的字符数）
    let range: Range;
    if (selection.rangeCount > 0) {
      range = selection.getRangeAt(0);
      // 如果选区不在当前元素内，则移动到元素末尾
      if (!element.contains(range.commonAncestorContainer)) {
        range = document.createRange();
        range.selectNodeContents(element);
        range.collapse(false);
      }
    } else {
      range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
    }

    const startOffsetChars = (() => {
      const pre = range.cloneRange();
      pre.selectNodeContents(element);
      pre.setEnd(range.startContainer, range.startOffset);
      return pre.toString().length;
    })();

    // 删除当前选区内容并插入拼音字符
    range.deleteContents();
    const textNode = document.createTextNode(pinyin);
    range.insertNode(textNode);

    // 将光标临时放到新插入文本的末尾（避免立即跳到首位）
    const caretRange = document.createRange();
    caretRange.setStart(textNode, textNode.textContent ? textNode.textContent.length : pinyin.length);
    caretRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(caretRange);

    // 计算新的光标偏移并保存，待状态更新后恢复
    const newCaretOffset = startOffsetChars + pinyin.length;
    currentEditableInfo.current = { element, index, caretOffset: newCaretOffset };

    // 更新 OCR 数据，并在渲染完成后恢复光标位置
    // 使用 requestAnimationFrame 确保 DOM 已完成更新和绘制
    setOcrData(prevOcrData => {
      if (!prevOcrData) return null;
      const next = [...prevOcrData];
      next[index] = { ...next[index], DetectedText: element.textContent || '' };
      return next;
    });

    const restoreCaret = () => {
      const info = currentEditableInfo.current;
      const target = info?.element || element;
      const offset = info?.caretOffset ?? newCaretOffset;

      // 将光标恢复到指定字符偏移位置
      const setCaretByOffset = (el: HTMLElement, charOffset: number) => {
        const sel = window.getSelection();
        if (!sel) return;
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
        let node = walker.nextNode() as Text | null;
        let traversed = 0;
        const range = document.createRange();
        while (node) {
          const nextTraversed = traversed + (node.textContent ? node.textContent.length : 0);
          if (charOffset <= nextTraversed) {
            const localOffset = Math.max(0, charOffset - traversed);
            range.setStart(node, localOffset);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
            return;
          }
          traversed = nextTraversed;
          node = walker.nextNode() as Text | null;
        }
        // 如果偏移超过文本长度，放到末尾
        range.selectNodeContents(el);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      };

      if (document.activeElement !== target) target.focus();
      setCaretByOffset(target, offset);
    };

    requestAnimationFrame(() => {
      requestAnimationFrame(restoreCaret);
    });
  };

  // 拼音字符按钮，两行布局
  const pinyinRows: string[][] = [
    ['ā','á','ǎ','à','ē','é','ě','è','ī','í','ǐ','ì'],
    ['ō','ó','ǒ','ò','ū','ú','ǔ','ù','ǖ','ǘ','ǚ','ǜ','ü'],
  ];

  return (
    <div className="flex flex-col flex-grow">
      {/* Top Toolbar spanning both panes */}
      <div className="sticky top-0 z-50 bg-white p-4 border-b border-gray-300 flex justify-between items-center">
        {/* Left controls */}
        <div className="flex items-center space-x-2">
          <input
            type="file"
            accept=".zip"
            onChange={handleImageZipUpload}
            className="hidden"
            id="imageZipUpload"
          />
          <label htmlFor="imageZipUpload" className="bg-purple-500 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded cursor-pointer">
            导入图片 ZIP
          </label>

          <input
            type="file"
            accept=".zip"
            onChange={handleJsonZipUpload}
            className="hidden"
            id="jsonZipUpload"
          />
          <label htmlFor="jsonZipUpload" className="bg-purple-500 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded cursor-pointer">
            导入 JSON ZIP
          </label>

          <button
            className={`py-2 px-4 rounded font-bold ${isLocalMode ? 'bg-green-500 text-white' : 'bg-gray-300 text-gray-800'}`}
            onClick={() => setIsLocalMode(!isLocalMode)}
          >
            {isLocalMode ? '本地模式' : '远程模式'}
          </button>

          <button
            onClick={handlePrevious}
            disabled={currentImageIndex === 0 || fileNames.length === 0}
            className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50 disabled:cursor-not-allowed"
          >
            上一页
          </button>
          <select
            value={currentImageIndex}
            onChange={(e) => setCurrentImageIndex(Number(e.target.value))}
            className="p-2 border rounded"
            disabled={fileNames.length === 0}
          >
            {fileNames.map((name, index) => (
              <option key={name} value={index}>
                {name}
              </option>
            ))}
          </select>
          <button
            onClick={handleNext}
            disabled={currentImageIndex === fileNames.length - 1 || fileNames.length === 0}
            className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50 disabled:cursor-not-allowed"
          >
            下一页
          </button>
        </div>

        {/* Right controls */}
        <div className="flex items-center space-x-2">
          <button
            className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
            onClick={async () => {
              if (isLocalMode) {
                // Handle local save (download ZIP)
                const zip = new JSZip();
                for (const fileName in editedLocalJsonData) {
                  const originalJson = editedLocalJsonData[fileName];
                  // Reconstruct JSON with updated TextDetections
                  const newJson = {
                    ...originalJson,
                    Response: {
                      ...originalJson.Response,
                      TextDetections: originalJson.Response?.TextDetections || originalJson.TextDetections,
                    },
                    TextDetections: originalJson.TextDetections, // Also update top-level if it exists
                  };
                  zip.file(`${fileName}.json`, JSON.stringify(newJson, null, 2));
                }
                const content = await zip.generateAsync({ type: "blob" });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(content);
                a.download = 'ocr_json_updated.zip';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                alert('OCR data downloaded successfully!');
              } else {
                // Original remote save logic
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
              }
            }}
          >
            保存所有更改
          </button>
          <button
            className="bg-gray-500 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded"
            onClick={() => {
              if (isLocalMode && currentFileName) {
                const data = localJsonData[currentFileName];
                const textDetections = data?.Response?.TextDetections || data?.TextDetections;
                if (textDetections) {
                  setOcrData(textDetections as OcrResult);
                  setInitialOcrData(textDetections as OcrResult);
                } else {
                  setOcrData([]);
                  setInitialOcrData([]);
                }
              } else {
                setOcrData(initialOcrData);
              }
            }}
          >
            重置所有更改
          </button>
          <div className="space-y-2" ref={pinyinButtonsRef}>
            {pinyinRows.map((row, idx) => (
              <div key={idx} className="flex space-x-1">
                {row.map((char) => (
                  <button
                    key={`${idx}-${char}`}
                    onMouseDown={(e) => {
                      e.preventDefault(); // Prevent button from taking focus
                    }}
                    onClick={() => {
                      if (currentEditableInfo.current) {
                        insertPinyin(char, currentEditableInfo.current.element, currentEditableInfo.current.index);
                      }
                    }}
                    className={`px-2 py-1 rounded text-sm font-medium ${char === '' ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-green-500 hover:bg-green-600 text-white'}`}
                    disabled={char === ''}
                  >
                    {char === '' ? '' : char}
                  </button>
                ))}
              </div>
            ))}
          </div> {/* Closing div for space-y-2 */}
          {/* 右侧视图模式切换（与拼音按钮同属sticky工具栏） */}
          <div className="flex items-center gap-2 text-sm">
            <button
              className={`px-2 py-1 rounded ${rightViewMode === 'overlay' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-800'}`}
              onClick={() => setRightViewMode('overlay')}
            >
              图上定位文本
            </button>
            <button
              className={`px-2 py-1 rounded ${rightViewMode === 'raw' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-800'}`}
              onClick={() => setRightViewMode('raw')}
            >
              原始 JSON
            </button>
            <button
              className={`px-2 py-1 rounded ${rightViewMode === 'paragraph' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-800'}`}
              onClick={() => setRightViewMode('paragraph')}
            >
              按段号输出文本
            </button>
          </div>
        </div>
      </div>

      {/* Two panes below toolbar */}
      <div className="flex flex-grow">
        {/* Left Pane: Image */}
        <div className="p-4 border-r border-gray-300 overflow-auto flex-grow basis-0" ref={leftPaneRef}>
          <div className="relative w-full h-auto" ref={imageContainerRef}> {/* This div will contain the image */}
            {imageName && (
              <Image
                ref={imageRef}
                src={isLocalMode ? localImageUrls[currentFileName] : `/images/wdzh/${imageName}`}
                alt="OCR Image"
                layout="responsive"
                width={1000} // These are intrinsic width/height hints for Next.js, not necessarily rendered size
                height={1500}
                objectFit="contain"
                onLoad={handleImageLoad}
                onError={(e) => console.error("Image failed to load:", e.currentTarget.src)}
                unoptimized={isLocalMode} // Disable Next.js Image optimization for local Blob URLs
              />
            )}
          </div>
        </div>

        {/* Right Pane: OCR Detected Text on Image */}
        <div className="p-4 overflow-hidden flex flex-col flex-grow basis-0 min-h-0">
          {rightViewMode === 'overlay' && (
            <div
              className="relative border border-gray-300 overflow-y-auto"
              style={imageRenderedDimensions ? {
                  height: `${imageRenderedDimensions.containerHeight}px`,
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
                border: '1px solid rgba(0, 123, 255, 0.2)',
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
                      border: `1px solid ${focusedElementIndex === index ? 'blue' : 'rgba(0, 123, 255, 0.2)'}`, // Dynamic border color based on focusedElementIndex
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
                  onKeyDown={(e) => {
                    // Shift+Enter: insert visual line break
                    if (e.key === 'Enter' && e.shiftKey) {
                      e.preventDefault();
                      insertLineBreakAtCaret();
                      return;
                    }
                    // Enter or Ctrl+Enter: exit edit (save on blur)
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      (e.currentTarget as HTMLElement).blur();
                    }
                  }}
                  onFocus={(e) => {
                    currentEditableInfo.current = { element: e.currentTarget, index };
                    setFocusedElementIndex(index); // Set focused element index
                  }}
                    onBlur={(e) => {
                      console.log("onBlur triggered. relatedTarget:", e.relatedTarget);
                      const isPinyinButtonFocused = pinyinButtonsRef.current && pinyinButtonsRef.current.contains(e.relatedTarget as Node);
                      console.log("isPinyinButtonFocused:", isPinyinButtonFocused);

                      // Check if the new focused element is within the pinyin buttons container
                      if (isPinyinButtonFocused) {
                        // If a pinyin button was clicked, do not clear currentEditableInfo and keep focusedElementIndex
                        return;
                      }

                      setFocusedElementIndex(null); // Clear focused element index
                      const newText = e.currentTarget.textContent || '';
                      setOcrData(prevOcrData => {
                        if (!prevOcrData) return null;
                        const newOcrData = [...prevOcrData];
                        newOcrData[index] = { ...newOcrData[index], DetectedText: newText };
                        return newOcrData;
                      });
                      console.log(`Edited text for item ${index}:`, newText);
                      currentEditableInfo.current = null;
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
                     zIndex: 5, // Keep below sticky toolbar
                   }}
                   contentEditable={true}
                   suppressContentEditableWarning={true}
                   title="页码 (ParagNo)"
                   onKeyDown={(e) => {
                     // Shift+Enter: insert visual line break
                     if (e.key === 'Enter' && e.shiftKey) {
                       e.preventDefault();
                       insertLineBreakAtCaret();
                       return;
                     }
                     // Enter or Ctrl+Enter: exit edit (save on blur)
                     if (e.key === 'Enter') {
                       e.preventDefault();
                       (e.currentTarget as HTMLElement).blur();
                     }
                   }}
                   onBlur={(e) => {
                     const raw = (e.currentTarget.textContent || '').trim();
                     const nextNo = Number(raw);
                     if (Number.isNaN(nextNo)) {
                       // If not a valid number, revert to current value
                       e.currentTarget.textContent = String(
                         (function() {
                           try {
                             return JSON.parse(detection.AdvancedInfo).Parag?.ParagNo ?? '';
                           } catch {
                             return '';
                           }
                         })()
                                   );
                                       return;
                                     }
                                     setOcrData(prev => {
                                       if (!prev) return null;
                                       const next = [...prev];
                                       const item = { ...next[index] } as any;
                                       let adv: any = {};
                                       try {
                                         adv = JSON.parse(item.AdvancedInfo);
                                       } catch (e) {
                                         console.error("Error parsing AdvancedInfo:", e);
                                       }
                                       adv.Parag = { ...adv.Parag, ParagNo: nextNo };
                                       item.AdvancedInfo = JSON.stringify(adv);
                                       next[index] = item;
                                       return next;
                                     });
                                   }}
                                   >
                                     {(function() {
                                       try {
                                         return JSON.parse(detection.AdvancedInfo).Parag?.ParagNo ?? '';
                                       } catch {
                                         return '';
                                       }
                                     })()}
                                   </span>
                                   <span style={{
                                     position: 'absolute',
                                     top: '-15px', // Adjust this value to position it correctly above the box
                                     right: '-15px', // Adjust this value to position it correctly to the right of the box
                                     fontSize: '8px',
                                     backgroundColor: 'rgba(255, 255, 255, 0.7)',
                                     padding: '2px 4px',
                                     borderRadius: '4px',
                                     zIndex: 5, // Keep below sticky toolbar
                                   }}
                                   contentEditable={true}
                                   suppressContentEditableWarning={true}
                                   title="置信度 (Confidence)"
                                   onKeyDown={(e) => {
                                     if (e.key === 'Enter' && e.shiftKey) {
                                       e.preventDefault();
                                       insertLineBreakAtCaret();
                                       return;
                                     }
                                     if (e.key === 'Enter') {
                                       e.preventDefault();
                                       (e.currentTarget as HTMLElement).blur();
                                     }
                                   }}
                                   onBlur={(e) => {
                                     const raw = (e.currentTarget.textContent || '').trim();
                                     const nextVal = Number(raw);
                                     if (Number.isNaN(nextVal)) {
                                       e.currentTarget.textContent = String(detection.Confidence ?? '');
                                       return;
                                     }
                                     setOcrData(prev => {
                                       if (!prev) return null;
                                       const next = [...prev];
                                       next[index] = { ...next[index], Confidence: nextVal } as any;
                                       return next;
                                     });
                                   }}
                                   >
                                     {detection.Confidence}
                                   </span>
                                </div>
                              );
                            })}
                          </div>
          )}
            {rightViewMode === 'raw' && (
              <div className="border border-gray-300 p-2 overflow-y-auto" ref={rightRawRef}
                   style={imageRenderedDimensions ? { height: `${imageRenderedDimensions.containerHeight}px` } : {}}>
                <pre className="font-mono text-xs whitespace-pre-wrap break-words">{JSON.stringify(ocrData ?? [], null, 2)}</pre>
              </div>
            )}
            {rightViewMode === 'paragraph' && (
              <div className="border border-gray-300 p-2 overflow-y-auto" ref={rightParagraphRef}
                   style={imageRenderedDimensions ? { height: `${imageRenderedDimensions.containerHeight}px` } : {}}>
                <ol className="list-decimal pl-4 space-y-1 text-sm">
                  {paragraphLines.map((line, idx) => (
                    <li key={`parag-${line.paragNo ?? 'none'}-${idx}`}>
                      <span className="text-gray-500 mr-2">{line.paragNo ?? '—'}</span>
                      <span>{line.text}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
                        </div>
                      </div>
                    </div>
                  );
}