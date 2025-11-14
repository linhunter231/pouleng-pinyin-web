"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import Image from 'next/image';
import JSZip from 'jszip'; // Import JSZip
import { useSearchParams } from 'next/navigation'; // Import useSearchParams

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
  const searchParams = useSearchParams();
  const enableRemote = searchParams.get('remote') === 'true'; // Check if remote mode is enabled via URL parameter
  
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
  const [isLocalMode, setIsLocalMode] = useState<boolean>(!enableRemote); // Set initial mode based on URL parameter

  // Image zoom states
  const [isImageZoomed, setIsImageZoomed] = useState(false);
  const [zoomedImageSrc, setZoomedImageSrc] = useState<string>('');
  
  // Local zoom states
  const [isLocalZoomActive, setIsLocalZoomActive] = useState(false);
  const [zoomPosition, setZoomPosition] = useState({ x: 0, y: 0 });
  const [imageOffset, setImageOffset] = useState({ top: 0, left: 0 });

  // 添加控制图上定位文本位置的状态
  const [overlayPosition, setOverlayPosition] = useState<'left' | 'right'>('right');
  const [overlayOffset, setOverlayOffset] = useState<{ x: number; y: number }>({ x: 5, y: 5 });
  
  // 添加控制左侧图片是否放大的状态
  const [isLeftImageExpanded, setIsLeftImageExpanded] = useState(false);

  // 右侧视图模式：图上定位文本 / 原始 JSON / 段号排序文本
  const [rightViewMode, setRightViewMode] = useState<'overlay' | 'raw' | 'paragraph'>('overlay');

  // 同步左右两侧的滚动（在原始JSON/按段号模式下)
  useEffect(() => {
    const leftEl = leftPaneRef.current;
    const rightEl = rightViewMode === 'raw' ? rightRawRef.current : rightViewMode === 'paragraph' ? rightParagraphRef.current : null;
    if (!leftEl || !rightEl) return;

    // 初始同步一次滚动位置
    rightEl.scrollTop = leftEl.scrollTop;

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

  // 处理键盘事件
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        event.preventDefault();
        // You can trigger save functionality here if needed
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // 当overlayPosition改变时，如果移到左侧，则右侧自动切换到原始JSON视图
  useEffect(() => {
    if (overlayPosition === 'left' && rightViewMode === 'overlay') {
      setRightViewMode('raw');
    }
  }, [overlayPosition, rightViewMode]);

  // 计算段落行
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
    if (!isLocalMode && enableRemote) { // Only fetch in remote mode when it's enabled
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
  }, [isLocalMode, currentFileName, localJsonData, enableRemote]);

  // Effect for fetching OCR data (remote mode) or setting image dimensions (local mode)
  useEffect(() => {
    if (!isLocalMode && jsonName && enableRemote) { // Only fetch in remote mode when it's enabled
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
  }, [isLocalMode, jsonName, currentFileName, localJsonData, enableRemote]);

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
    if (!isLocalMode && enableRemote) { // Only fetch in remote mode when it's enabled
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
  }, [isLocalMode, imageName, currentImageIndex, fileNames, enableRemote]);

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

  // Function to handle image zoom
  const handleZoomImage = () => {
    if (imageName) {
      const src = isLocalMode ? localImageUrls[currentFileName] : `/images/wdzh/${imageName}`;
      if (src) {
        setZoomedImageSrc(src);
        setIsImageZoomed(true);
      }
    }
  };

  // Function to close zoomed image
  const handleCloseZoom = () => {
    setIsImageZoomed(false);
    setZoomedImageSrc('');
  };
  
  // Function to handle local zoom
  const handleLocalZoom = () => {
    setIsLocalZoomActive(true);
  };
  
  // Function to hide local zoom
  const handleHideLocalZoom = () => {
    setIsLocalZoomActive(false);
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

  // 监听左侧图片放大状态变化，更新图片尺寸
  useEffect(() => {
    if (isLeftImageExpanded || !isLeftImageExpanded) {
      // 状态变化后稍微延迟一下再更新尺寸，确保布局已经完成
      const timer = setTimeout(() => {
        handleImageLoad();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isLeftImageExpanded]);

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

          {/* Only show mode toggle button when remote mode is enabled via URL parameter */}
          {enableRemote && (
            <button
              className={`py-2 px-4 rounded font-bold ${isLocalMode ? 'bg-green-500 text-white' : 'bg-gray-300 text-gray-800'}`}
              onClick={() => setIsLocalMode(!isLocalMode)}
            >
              {isLocalMode ? '本地模式' : '远程模式'}
            </button>
          )}

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
          {/* Add zoom image button */}
          {imageName && (
            <button
              className={`bg-yellow-500 hover:bg-yellow-600 text-white font-bold py-2 px-4 rounded ${isLocalZoomActive ? 'ring-2 ring-yellow-300' : ''}`}
              onClick={() => setIsLocalZoomActive(!isLocalZoomActive)}
            >
              {isLocalZoomActive ? '关闭局部放大' : '开启局部放大'}
            </button>
          )}
          
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
              } else if (enableRemote) {
                // Original remote save logic - only execute when remote mode is enabled
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
              } else {
                // Remote mode is disabled
                alert('远程模式未启用，无法保存到服务器。');
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
              } else if (enableRemote) {
                // Only reset from remote data when remote mode is enabled
                setOcrData(initialOcrData);
              } else {
                // Remote mode is disabled
                alert('远程模式未启用，无法重置数据。');
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
                        insertPinyin(char);
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
            {/* 控制图上定位文本显示位置的按钮，始终显示 */}
            <button
              className="px-2 py-1 rounded bg-gray-200 text-gray-800"
              onClick={() => {
                // 切换图上定位文本位置时，如果当前不是overlay模式，则切换到overlay模式
                if (rightViewMode !== 'overlay') {
                  setRightViewMode('overlay');
                }
                setOverlayPosition(overlayPosition === 'left' ? 'right' : 'left');
              }}
            >
              {overlayPosition === 'left' ? '移到右侧' : '移到左侧'}
            </button>
            
            {/* 控制左侧图片放大/缩小的按钮，仅当图上定位文本在左侧时显示 */}
            {overlayPosition === 'left' && (
              <button
                className="px-2 py-1 rounded bg-gray-200 text-gray-800"
                onClick={() => setIsLeftImageExpanded(!isLeftImageExpanded)}
              >
                {isLeftImageExpanded ? '缩小图片' : '放大图片'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Two panes below toolbar */}
      <div className="flex flex-grow">
        {/* Left Pane: Image with OCR overlay */}
        <div 
          className={`p-4 border-r border-gray-300 overflow-auto ${isLeftImageExpanded ? 'flex-grow basis-0' : 'flex-grow basis-0'}`} 
          ref={leftPaneRef}
          style={isLeftImageExpanded ? { flex: '0 0 100%' } : {}}
        >
          <div 
            className="relative w-full h-auto" 
            ref={imageContainerRef}
            onMouseMove={(e) => {
              if (isLocalZoomActive && imageContainerRef.current) {
                const rect = imageContainerRef.current.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                setZoomPosition({ x, y });
              }
            }}
            onMouseLeave={() => setIsLocalZoomActive(false)}
          >
            {/* 浮动偏移控制面板 - 仅当图上定位文本在左侧时显示 */}
            {overlayPosition === 'left' && (
              <div className="absolute top-2 left-2 bg-white bg-opacity-80 rounded-lg shadow-lg p-2 z-10 flex flex-col">
                <div className="flex items-center justify-between mb-1">
                  <button 
                    className="w-6 h-6 flex items-center justify-center bg-gray-200 rounded hover:bg-gray-300"
                    onClick={() => setOverlayOffset(prev => ({ ...prev, x: prev.x - 1 }))}
                  >
                    ←
                  </button>
                  <input 
                    type="number" 
                    value={overlayOffset.x} 
                    onChange={(e) => setOverlayOffset(prev => ({ ...prev, x: parseInt(e.target.value) || 0 }))}
                    className="w-12 text-center border border-gray-300 rounded mx-1 text-xs"
                  />
                  <button 
                    className="w-6 h-6 flex items-center justify-center bg-gray-200 rounded hover:bg-gray-300"
                    onClick={() => setOverlayOffset(prev => ({ ...prev, x: prev.x + 1 }))}
                  >
                    →
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <button 
                    className="w-6 h-6 flex items-center justify-center bg-gray-200 rounded hover:bg-gray-300"
                    onClick={() => setOverlayOffset(prev => ({ ...prev, y: prev.y - 1 }))}
                  >
                    ↑
                  </button>
                  <input 
                    type="number" 
                    value={overlayOffset.y} 
                    onChange={(e) => setOverlayOffset(prev => ({ ...prev, y: parseInt(e.target.value) || 0 }))}
                    className="w-12 text-center border border-gray-300 rounded mx-1 text-xs"
                  />
                  <button 
                    className="w-6 h-6 flex items-center justify-center bg-gray-200 rounded hover:bg-gray-300"
                    onClick={() => setOverlayOffset(prev => ({ ...prev, y: prev.y + 1 }))}
                  >
                    ↓
                  </button>
                </div>
              </div>
            )}
            
            {imageName && (isLocalMode ? localImageUrls[currentFileName] : `/images/wdzh/${imageName}`) && (
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
            
            {/* OCR Overlay on image - 当位置为左侧时显示在图片上 */}
            {overlayPosition === 'left' && ocrData && imageRenderedDimensions && originalOcrDimensions && ocrData.map((detection, index) => {
              const { X, Y, Width, Height } = detection.ItemPolygon;
              // 只有在左侧且图片放大时才应用放大逻辑
              if (isLeftImageExpanded) {
                // 计算实际的缩放因子 - 基于图片实际显示尺寸的变化
                // 获取图片在正常状态和放大状态下的尺寸
                const normalScaleX = imageRenderedDimensions.width / originalOcrDimensions.width;
                const normalScaleY = imageRenderedDimensions.height / originalOcrDimensions.height;
                
                // 直接使用实际测量的缩放因子，不再乘以额外系数
                const scaleX = normalScaleX;
                const scaleY = normalScaleY;
                
                // 偏移量也应根据放大状态调整
                const offsetX = overlayOffset.x;
                const offsetY = overlayOffset.y;

                return (
                  <div
                    key={`wrapper-${index}`}
                    style={{
                      position: 'absolute',
                      left: `${X * scaleX + offsetX}px`,
                      top: `${Y * scaleY - offsetY}px`,
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
                        border: `1px solid ${focusedElementIndex === index ? 'blue' : 'rgba(0, 123, 255, 0.1)'}`, // Dynamic border color based on focusedElementIndex
                        fontSize: '22px', // 放大时使用更大的字体
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
                        // Enter: move focus to next editable element
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const nextIndex = (index + 1) % ocrData.length;
                          setFocusedElementIndex(nextIndex);
                          setTimeout(() => {
                            const nextElement = document.querySelector(`[data-ocr-index="${nextIndex}"]`) as HTMLElement | null;
                            if (nextElement) {
                              nextElement.focus();
                              const range = document.createRange();
                              const sel = window.getSelection();
                              range.selectNodeContents(nextElement);
                              range.collapse(false);
                              sel?.removeAllRanges();
                              sel?.addRange(range);
                            }
                          }, 0);
                        }
                      }}
                      onFocus={(e) => {
                        setFocusedElementIndex(index);
                        currentEditableInfo.current = { element: e.currentTarget, index };
                      }}
                      onBlur={(e) => {
                        // Save the caret position when blurring
                        const selection = window.getSelection();
                        if (selection && selection.rangeCount > 0) {
                          const range = selection.getRangeAt(0);
                          const preCaretRange = range.cloneRange();
                          preCaretRange.selectNodeContents(e.currentTarget);
                          preCaretRange.setEnd(range.endContainer, range.endOffset);
                          currentEditableInfo.current = { 
                            element: e.currentTarget, 
                            index, 
                            caretOffset: preCaretRange.toString().length 
                          };
                        }
                      }}
                      data-ocr-index={index}
                    >
                      {detection.DetectedText}
                    </div>
                    
                    {/* ParagNo 显示在左上角，仅在左侧模式下显示 */}
                    <span style={{
                      position: 'absolute',
                      top: '-15px',
                      left: '-15px',
                      fontSize: '8px',
                      backgroundColor: 'rgba(255, 255, 255, 0)',
                      padding: '2px 4px',
                      borderRadius: '4px',
                      zIndex: 5,
                    }}
                      contentEditable={true}
                      suppressContentEditableWarning={true}
                      title="页码 (ParagNo)"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && e.shiftKey) {
                          e.preventDefault();
                          insertLineBreakAtCaret();
                          return;
                        }
                      }}
                    >
                      {(() => {
                        try {
                          return JSON.parse(detection.AdvancedInfo).Parag?.ParagNo ?? '';
                        } catch {
                          return '';
                        }
                      })()}
                    </span>
                    
                    {/* Confidence 显示在右上角，仅在左侧模式下显示 */}
                    <span style={{
                      position: 'absolute',
                      top: '-15px',
                      right: '-15px',
                      fontSize: '8px',
                      backgroundColor: 'rgba(255, 255, 255, 0)',
                      padding: '2px 4px',
                      borderRadius: '4px',
                      zIndex: 5,
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
                    }}
                  >
                    {detection.Confidence}
                  </span>
                  </div>
                );
              } else {
                // 正常大小时使用原有逻辑
                const scaleX = imageRenderedDimensions.width / originalOcrDimensions.width;
                const scaleY = imageRenderedDimensions.height / originalOcrDimensions.height;
                
                return (
                  <div
                    key={`wrapper-${index}`}
                    style={{
                      position: 'absolute',
                      left: `${X * scaleX + overlayOffset.x}px`,
                      top: `${Y * scaleY - overlayOffset.y}px`,
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
                        border: `1px solid ${focusedElementIndex === index ? 'blue' : 'rgba(0, 123, 255, 0.1)'}`, // Dynamic border color based on focusedElementIndex
                        fontSize: '12px', // 当在左侧时使用更小的字体
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
                        // Enter: move focus to next editable element
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const nextIndex = (index + 1) % ocrData.length;
                          setFocusedElementIndex(nextIndex);
                          setTimeout(() => {
                            const nextElement = document.querySelector(`[data-ocr-index="${nextIndex}"]`) as HTMLElement | null;
                            if (nextElement) {
                              nextElement.focus();
                              const range = document.createRange();
                              const sel = window.getSelection();
                              range.selectNodeContents(nextElement);
                              range.collapse(false);
                              sel?.removeAllRanges();
                              sel?.addRange(range);
                            }
                          }, 0);
                        }
                      }}
                      onFocus={(e) => {
                        setFocusedElementIndex(index);
                        currentEditableInfo.current = { element: e.currentTarget, index };
                      }}
                      onBlur={(e) => {
                        // Save the caret position when blurring
                        const selection = window.getSelection();
                        if (selection && selection.rangeCount > 0) {
                          const range = selection.getRangeAt(0);
                          const preCaretRange = range.cloneRange();
                          preCaretRange.selectNodeContents(e.currentTarget);
                          preCaretRange.setEnd(range.endContainer, range.endOffset);
                          currentEditableInfo.current = { 
                            element: e.currentTarget, 
                            index, 
                            caretOffset: preCaretRange.toString().length 
                          };
                        }
                      }}
                      data-ocr-index={index}
                    >
                      {detection.DetectedText}
                    </div>
                    
                    {/* ParagNo 显示在左上角，仅在左侧模式下显示 */}
                    <span style={{
                      position: 'absolute',
                      top: '-15px',
                      left: '-15px',
                      fontSize: '8px',
                      backgroundColor: 'rgba(255, 255, 255, 0)',
                      padding: '2px 4px',
                      borderRadius: '4px',
                      zIndex: 5,
                    }}
                      contentEditable={true}
                      suppressContentEditableWarning={true}
                      title="页码 (ParagNo)"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && e.shiftKey) {
                          e.preventDefault();
                          insertLineBreakAtCaret();
                          return;
                        }
                      }}
                    >
                      {(() => {
                        try {
                          return JSON.parse(detection.AdvancedInfo).Parag?.ParagNo ?? '';
                        } catch {
                          return '';
                        }
                      })()}
                    </span>
                    
                    {/* Confidence 显示在右上角，仅在左侧模式下显示 */}
                    <span style={{
                      position: 'absolute',
                      top: '-15px',
                      right: '-15px',
                      fontSize: '8px',
                      backgroundColor: 'rgba(255, 255, 255, 0)',
                      padding: '2px 4px',
                      borderRadius: '4px',
                      zIndex: 5,
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
                    }}
                  >
                    {detection.Confidence}
                  </span>
                  </div>
                );
              }
            })}
            
            {/* Local zoom overlay */}
            {isLocalZoomActive && imageName && (
              <div 
                className="absolute pointer-events-none"
                style={{
                  width: '200px',
                  height: '200px',
                  border: '2px solid white',
                  borderRadius: '8px',
                  boxShadow: '0 0 15px rgba(0, 0, 0, 0.8)',
                  top: `${zoomPosition.y - 100}px`,
                  left: `${zoomPosition.x - 100}px`,
                  transform: 'translate(0, 0)',
                  zIndex: 20,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: '1000px',
                    height: '1500px',
                    backgroundImage: `url(${isLocalMode ? localImageUrls[currentFileName] : `/images/wdzh/${imageName}`})`,
                    backgroundSize: '1000px 1500px',
                    backgroundPosition: `-${zoomPosition.x * 5 - 100}px -${zoomPosition.y * 5 - 100}px`,
                  }}
                />
              </div>
            )}
          </div>
        </div>

        {/* Image Zoom Modal */}
        {isImageZoomed && (
          <div className="fixed inset-0 bg-black bg-opacity-75 z-[100] flex items-center justify-center p-4" onClick={handleCloseZoom}>
            <div className="relative max-w-6xl max-h-[90vh]">
              <button 
                className="absolute top-2 right-2 bg-white rounded-full p-2 z-10 shadow-lg hover:bg-gray-200"
                onClick={handleCloseZoom}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-gray-800" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              <div className="overflow-auto max-h-[90vh]">
                <img 
                  src={zoomedImageSrc} 
                  alt="Zoomed OCR Image" 
                  className="max-w-full max-h-full object-contain"
                />
              </div>
            </div>
          </div>
        )}

        {/* Right Pane: OCR data in different views (raw JSON, paragraph) or overlay on right */}
        <div 
          className={`p-4 overflow-hidden flex flex-col flex-grow basis-0 min-h-0 ${isLeftImageExpanded ? 'hidden' : ''}`}
        >
          {/* 当位置为右侧且视图为overlay时，图上定位文本显示在右侧窗格中 */}
          {overlayPosition === 'right' && rightViewMode === 'overlay' && (
            <div
              className="relative border border-gray-300 overflow-y-auto"
              style={imageRenderedDimensions ? {
                  height: `${imageRenderedDimensions.containerHeight}px`,
                } : {}}
            >
              {ocrData && imageRenderedDimensions && originalOcrDimensions && ocrData.map((detection, index) => {
                const { X, Y, Width, Height } = detection.ItemPolygon;
                const scaleX = imageRenderedDimensions.width / originalOcrDimensions.width;
                const scaleY = imageRenderedDimensions.height / originalOcrDimensions.height;

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
                      top: '-15px',
                      left: '-15px',
                      fontSize: '8px',
                      backgroundColor: 'rgba(255, 255, 255, 0.7)',
                      padding: '2px 4px',
                      borderRadius: '4px',
                      zIndex: 5,
                    }}
                    contentEditable={true}
                    suppressContentEditableWarning={true}
                    title="页码 (ParagNo)"
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
                      const nextNo = Number(raw);
                      if (Number.isNaN(nextNo)) {
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
                      top: '-15px',
                      right: '-15px',
                      fontSize: '8px',
                      backgroundColor: 'rgba(255, 255, 255, 0.7)',
                      padding: '2px 4px',
                      borderRadius: '4px',
                      zIndex: 5,
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
          {/* 原始JSON视图 */}
          {rightViewMode === 'raw' && (
            <div className="border border-gray-300 p-2 overflow-y-auto" ref={rightRawRef}
                 style={imageRenderedDimensions ? { height: `${imageRenderedDimensions.containerHeight}px` } : {}}>
              <pre className="font-mono text-xs whitespace-pre-wrap break-words">{JSON.stringify(ocrData ?? [], null, 2)}</pre>
            </div>
          )}
          {/* 按段号输出文本视图 */}
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