"use client";

import { ChangeEvent, DragEvent, useMemo, useRef, useState } from "react";

type CheckState = "waiting" | "running" | "pass" | "review" | "fail";

type GridCheck = {
  score: number;
  status: CheckState;
  issues: string[];
  verticalGuides: number[];
  horizontalGuides: number[];
};

type CreativeResult = {
  id: string;
  file: File;
  url: string;
  width: number;
  height: number;
  sizeStatus: CheckState;
  expectedFromName?: string;
  grid: GridCheck;
  disclaimerStatus: CheckState;
  disclaimerText: string;
  disclaimerSimilarity?: number;
  analysisSource: "ai" | "local";
  aiError?: string;
  progress: number;
  status: CheckState;
};

type AiAnalysis = {
  disclaimer: {
    present: boolean;
    text: string;
    confidence: number;
    issues: string[];
  };
  grid: {
    score: number;
    status: "pass" | "review" | "fail";
    issues: string[];
  };
};

const INITIAL_SIZES = [
  "240×400",
  "300×250",
  "300×300",
  "300×500",
  "336×280",
  "728×90",
  "970×250",
  "1080×607",
  "1080×1080",
  "1080×1920",
  "1200×628",
];

const STATE_LABELS: Record<CheckState, string> = {
  waiting: "Ожидает",
  running: "Проверяется",
  pass: "Пройдено",
  review: "Нужна проверка",
  fail: "Ошибка",
};

function fileId(file: File) {
  return `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`;
}

function loadImage(file: File): Promise<{ image: HTMLImageElement; url: string }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => resolve({ image, url });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Не удалось прочитать изображение"));
    };
    image.src = url;
  });
}

function imageForAi(image: HTMLImageElement) {
  const maxSide = 2200;
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Не удалось подготовить изображение");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.92);
}

async function analyzeWithAi(image: HTMLImageElement, filename: string): Promise<AiAnalysis> {
  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: imageForAi(image), filename }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || "ИИ-анализ недоступен");
  }
  return response.json();
}

function normalizeSize(width: number, height: number) {
  return `${width}×${height}`;
}

function expectedSizeFromFilename(filename: string) {
  const match = filename.match(/(?:^|[^0-9])(\d{2,4})\s*[xх×]\s*(\d{2,4})(?:[^0-9]|$)/i);
  return match ? `${Number(match[1])}×${Number(match[2])}` : undefined;
}

function peaks(values: number[], limit = 5) {
  if (!values.length) return [];
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  const threshold = mean + Math.sqrt(variance) * 1.45;
  return values
    .map((value, index) => ({ value, index }))
    .filter(({ value, index }) => value > threshold && index > 3 && index < values.length - 4)
    .sort((a, b) => b.value - a.value)
    .reduce<number[]>((selected, item) => {
      if (selected.every((index) => Math.abs(index - item.index) > values.length * 0.025)) {
        selected.push(item.index);
      }
      return selected;
    }, [])
    .slice(0, limit)
    .sort((a, b) => a - b);
}

function analyzeGrid(image: HTMLImageElement): GridCheck {
  const maxSide = 520;
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return { score: 70, status: "review", issues: ["Не удалось проанализировать сетку"], verticalGuides: [], horizontalGuides: [] };
  }

  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  const gray = new Float32Array(width * height);
  for (let index = 0; index < gray.length; index += 1) {
    const offset = index * 4;
    gray[index] = pixels[offset] * 0.299 + pixels[offset + 1] * 0.587 + pixels[offset + 2] * 0.114;
  }

  const columns = new Float32Array(width);
  const rows = new Float32Array(height);
  let borderEnergy = 0;
  let totalEnergy = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const dx = Math.abs(gray[index + 1] - gray[index - 1]);
      const dy = Math.abs(gray[index + width] - gray[index - width]);
      const energy = dx + dy;
      columns[x] += energy;
      rows[y] += energy;
      totalEnergy += energy;
      if (x < width * 0.025 || x > width * 0.975 || y < height * 0.025 || y > height * 0.975) borderEnergy += energy;
    }
  }

  const activeColumnThreshold = Math.max(...columns) * 0.16;
  const activeRowThreshold = Math.max(...rows) * 0.16;
  const firstX = columns.findIndex((value) => value > activeColumnThreshold);
  const lastX = width - 1 - [...columns].reverse().findIndex((value) => value > activeColumnThreshold);
  const firstY = rows.findIndex((value) => value > activeRowThreshold);
  const lastY = height - 1 - [...rows].reverse().findIndex((value) => value > activeRowThreshold);
  const leftMargin = firstX > -1 ? firstX / width : 0;
  const rightMargin = lastX > -1 ? (width - 1 - lastX) / width : 0;
  const topMargin = firstY > -1 ? firstY / height : 0;
  const bottomMargin = lastY > -1 ? (height - 1 - lastY) / height : 0;
  const horizontalImbalance = Math.abs(leftMargin - rightMargin);
  const verticalImbalance = Math.abs(topMargin - bottomMargin);
  const borderRatio = totalEnergy ? borderEnergy / totalEnergy : 0;

  const issues: string[] = [];
  let score = 100;
  if (horizontalImbalance > 0.055) {
    issues.push("Неравномерные отступы слева и справа");
    score -= 18;
  }
  if (verticalImbalance > 0.09) {
    issues.push("Неравномерные поля сверху и снизу");
    score -= 10;
  }
  if (borderRatio > 0.115) {
    issues.push("Есть элементы слишком близко к краю");
    score -= 16;
  }

  const verticalPeaks = peaks([...columns]);
  const horizontalPeaks = peaks([...rows]);
  const closeVertical = verticalPeaks.some((value, index) => index > 0 && value - verticalPeaks[index - 1] < width * 0.04);
  if (closeVertical) {
    issues.push("Возможен слишком узкий промежуток между элементами");
    score -= 8;
  }
  if (!issues.length) issues.push("Явных нарушений выравнивания не найдено");

  score = Math.max(35, Math.round(score));
  return {
    score,
    status: score >= 82 ? "pass" : "review",
    issues,
    verticalGuides: verticalPeaks.map((value) => (value / width) * 100),
    horizontalGuides: horizontalPeaks.map((value) => (value / height) * 100),
  };
}

function prepareDisclaimerCrop(image: HTMLImageElement, startRatio: number, enhanced: boolean) {
  const sourceY = Math.round(image.naturalHeight * startRatio);
  const sourceHeight = image.naturalHeight - sourceY;
  const multiplier = Math.min(4.5, 2400 / image.naturalWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(900, Math.round(image.naturalWidth * multiplier));
  canvas.height = Math.round(sourceHeight * (canvas.width / image.naturalWidth));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return image.src;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, sourceY, image.naturalWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
  if (!enhanced) return canvas.toDataURL("image/png");

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < imageData.data.length; index += 4) {
    const value = imageData.data[index] * 0.299 + imageData.data[index + 1] * 0.587 + imageData.data[index + 2] * 0.114;
    // Soft contrast preserves the antialiasing of tiny letters. The previous
    // hard threshold destroyed thin Cyrillic strokes and produced gibberish.
    const contrasted = Math.max(0, Math.min(255, Math.round((value - 128) * 1.55 + 128)));
    imageData.data[index] = contrasted;
    imageData.data[index + 1] = contrasted;
    imageData.data[index + 2] = contrasted;
  }
  context.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

function cleanOcrText(text: string) {
  let cleaned = text
    .replace(/[|_]{2,}/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[^А-ЯA-Z0-9]+|[^А-ЯA-Z0-9.)]+$/gi, "")
    .trim();
  // Local OCR sometimes reads grid lines and facade details as a short
  // sequence of random characters before the real legal copy.
  const legalStart = cleaned.search(/РЕКЛАМА(?=[\s.,:;—-]|$)|РЕКЛАМОДАТЕЛЬ/i);
  if (legalStart > 0) cleaned = cleaned.slice(legalStart);
  return cleaned;
}

function disclaimerMarkers(text: string) {
  const normalized = text.toLowerCase().replace(/ё/g, "е");
  const checks = [
    /реклам|reklam|pekлам|peklam/,
    /инн|inn/,
    /застрой|застр0й|developer/,
    /проектн.{0,12}деклар|наш[.\s-]*дом[.\s-]*рф|нашдомрф/,
    /срок.{0,12}акци|level[.\s-]*ru/,
  ];
  return checks.filter((pattern) => pattern.test(normalized)).length;
}

function ocrCandidateScore(text: string, confidence: number) {
  if (!text) return 0;
  const letters = text.match(/[а-яёa-z]/gi)?.length || 0;
  const noise = text.match(/[|_[\]{}<>]/g)?.length || 0;
  return disclaimerMarkers(text) * 45 + Math.min(text.length, 240) * 0.18 + confidence * 0.35 + letters * 0.08 - noise * 4;
}

function disclaimerCheckState(text: string, confidence: number): CheckState {
  if (text.length < 18) return "fail";
  const markers = disclaimerMarkers(text);
  if (markers >= 2 && confidence >= 35) return "pass";
  return "review";
}

async function analyzeWithLocalOcr(image: HTMLImageElement, onProgress: (progress: number) => void) {
  const crops = [
    prepareDisclaimerCrop(image, 0.7, true),
    prepareDisclaimerCrop(image, 0.56, false),
  ];
  const { createWorker, PSM } = await import("tesseract.js");
  let activePass = 0;
  const worker = await createWorker("rus+eng", 1, {
    logger: (message) => {
      if (message.status === "recognizing text") {
        onProgress(Math.round(((activePass + (message.progress || 0)) / crops.length) * 100));
      }
    },
  });
  try {
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
      preserve_interword_spaces: "1",
      user_defined_dpi: "300",
    });
    const candidates: Array<{ text: string; confidence: number }> = [];
    for (const crop of crops) {
      const { data } = await worker.recognize(crop);
      candidates.push({ text: cleanOcrText(data.text), confidence: data.confidence || 0 });
      activePass += 1;
    }
    return candidates.sort((a, b) => ocrCandidateScore(b.text, b.confidence) - ocrCandidateScore(a.text, a.confidence))[0];
  } finally {
    await worker.terminate();
  }
}

function similarity(first: string, second: string) {
  const tokenize = (value: string) => new Set(value.toLowerCase().replace(/[^а-яёa-z0-9]+/gi, " ").split(" ").filter(Boolean));
  const a = tokenize(first);
  const b = tokenize(second);
  if (!a.size || !b.size) return 0;
  const common = [...a].filter((token) => b.has(token)).length;
  return Math.round((common / new Set([...a, ...b]).size) * 100);
}

function deriveOverall(result: Pick<CreativeResult, "sizeStatus" | "grid" | "disclaimerStatus">): CheckState {
  if (result.sizeStatus === "fail" || result.grid.status === "fail" || result.disclaimerStatus === "fail") return "fail";
  if (result.grid.status === "review" || result.disclaimerStatus === "review") return "review";
  return "pass";
}

function StatusPill({ state }: { state: CheckState }) {
  return <span className={`status-pill status-${state}`}><i />{STATE_LABELS[state]}</span>;
}

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [allowedSizes, setAllowedSizes] = useState(INITIAL_SIZES);
  const [newSize, setNewSize] = useState("");
  const [results, setResults] = useState<CreativeResult[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const summary = useMemo(() => ({
    total: results.length,
    pass: results.filter((item) => item.status === "pass").length,
    review: results.filter((item) => item.status === "review").length,
    fail: results.filter((item) => item.status === "fail").length,
  }), [results]);

  const patchResult = (id: string, patch: Partial<CreativeResult>) => {
    setResults((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  };

  const analyzeFiles = async (incoming: File[]) => {
    const files = incoming.filter((file) => file.type.startsWith("image/"));
    if (!files.length || isAnalyzing) return;
    setIsAnalyzing(true);
    const prepared: CreativeResult[] = [];

    for (const file of files) {
      try {
        const { image, url } = await loadImage(file);
        const id = fileId(file);
        const actualSize = normalizeSize(image.naturalWidth, image.naturalHeight);
        const expectedFromName = expectedSizeFromFilename(file.name);
        const sizeStatus = expectedFromName
          ? expectedFromName === actualSize ? "pass" : "fail"
          : allowedSizes.includes(actualSize) ? "pass" : "fail";
        const grid = analyzeGrid(image);
        prepared.push({
          id,
          file,
          url,
          width: image.naturalWidth,
          height: image.naturalHeight,
          expectedFromName,
          sizeStatus,
          grid,
          disclaimerStatus: "running",
          disclaimerText: "",
          analysisSource: "local",
          progress: 0,
          status: "running",
        });
      } catch {
        // Unsupported or damaged images are skipped.
      }
    }

    setResults((current) => [...current, ...prepared]);

    for (const item of prepared) {
      try {
        const image = new Image();
        image.src = item.url;
        await image.decode();
        patchResult(item.id, { progress: 12 });

        try {
          const ai = await analyzeWithAi(image, item.file.name);
          const disclaimerText = cleanOcrText(ai.disclaimer.text || "");
          const disclaimerStatus: CheckState = !ai.disclaimer.present
            ? "fail"
            : ai.disclaimer.confidence >= 0.86 && disclaimerText.length >= 18 ? "pass" : "review";
          const gridScore = Math.max(0, Math.min(100, Math.round(ai.grid.score)));
          const gridDefects = ai.grid.issues.map((issue) => issue.trim()).filter(Boolean);
          const gridStatus: CheckState = gridScore < 60 || ai.grid.status === "fail"
            ? "fail"
            : gridDefects.length > 0 || gridScore < 85 || ai.grid.status === "review" ? "review" : "pass";
          const grid: GridCheck = {
            score: gridScore,
            status: gridStatus,
            issues: gridDefects.length ? gridDefects : ["Явных нарушений сетки элементов переднего плана не найдено"],
            verticalGuides: [],
            horizontalGuides: [],
          };
          const next = { ...item, grid, disclaimerText, disclaimerStatus, analysisSource: "ai" as const };
          const status = deriveOverall(next);
          patchResult(item.id, { grid, disclaimerText, disclaimerStatus, analysisSource: "ai", progress: 100, status });
          Object.assign(item, { grid, disclaimerText, disclaimerStatus, analysisSource: "ai", progress: 100, status });
        } catch (error) {
          const aiError = error instanceof Error ? error.message : "ИИ-анализ недоступен";
          const best = await analyzeWithLocalOcr(image, (progress) => patchResult(item.id, { progress }));
          const disclaimerText = best?.text || "";
          const localOcrState = disclaimerCheckState(disclaimerText, best?.confidence || 0);
          const disclaimerStatus: CheckState = localOcrState === "fail" ? "fail" : "review";
          const grid: GridCheck = {
            ...item.grid,
            status: "review",
            issues: ["Точная проверка элементов переднего плана недоступна без онлайн-ИИ"],
            verticalGuides: [],
            horizontalGuides: [],
          };
          const next = { ...item, grid, disclaimerText, disclaimerStatus, analysisSource: "local" as const };
          const status = deriveOverall(next);
          patchResult(item.id, { grid, disclaimerText, disclaimerStatus, analysisSource: "local", aiError, progress: 100, status });
          Object.assign(item, { grid, disclaimerText, disclaimerStatus, analysisSource: "local", aiError, progress: 100, status });
        }
      } catch {
        patchResult(item.id, {
          disclaimerStatus: "review",
          disclaimerText: "Текст не удалось уверенно распознать",
          progress: 100,
          status: item.sizeStatus === "fail" ? "fail" : "review",
        });
        item.disclaimerStatus = "review";
        item.disclaimerText = "";
      }
    }

    const reference = prepared.find((item) => item.disclaimerText.length >= 18)?.disclaimerText;
    if (reference && prepared.length > 1) {
      setResults((current) => current.map((item) => {
        if (!prepared.some((candidate) => candidate.id === item.id) || item.disclaimerText.length < 18) return item;
        const disclaimerSimilarity = similarity(reference, item.disclaimerText);
        const disclaimerStatus: CheckState = disclaimerSimilarity >= 88 ? item.disclaimerStatus : "review";
        return { ...item, disclaimerSimilarity, disclaimerStatus, status: deriveOverall({ ...item, disclaimerStatus }) };
      }));
    }
    setIsAnalyzing(false);
  };

  const onFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    void analyzeFiles([...event.target.files || []]);
    event.target.value = "";
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    void analyzeFiles([...event.dataTransfer.files]);
  };

  const addSize = () => {
    const match = newSize.trim().match(/^(\d{2,4})\s*[xх×]\s*(\d{2,4})$/i);
    if (!match) return;
    const formatted = `${Number(match[1])}×${Number(match[2])}`;
    setAllowedSizes((current) => current.includes(formatted) ? current : [...current, formatted]);
    setNewSize("");
  };

  const clearResults = () => {
    results.forEach((item) => URL.revokeObjectURL(item.url));
    setResults([]);
  };

  const exportCsv = () => {
    const rows = [
      ["Файл", "Размер", "Размер — статус", "Сетка", "Оценка сетки", "Дисклеймер", "Совпадение", "Текст"],
      ...results.map((item) => [
        item.file.name,
        `${item.width}×${item.height}`,
        STATE_LABELS[item.sizeStatus],
        STATE_LABELS[item.grid.status],
        `${item.grid.score}%`,
        STATE_LABELS[item.disclaimerStatus],
        item.disclaimerSimilarity === undefined ? "—" : `${item.disclaimerSimilarity}%`,
        item.disclaimerText,
      ]),
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(";")).join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
    link.download = "creative-check-report.csv";
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Creative Check — главная">
          <span className="brand-mark">CC</span>
          <span><b>Creative Check</b><small>контроль баннеров</small></span>
        </a>
        <button className="ghost-button" onClick={() => setShowSettings((value) => !value)} aria-expanded={showSettings}>
          <span className="sliders-icon" aria-hidden="true">≡</span> Форматы
        </button>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <span className="eyebrow"><i /> Онлайн-проверка с ИИ</span>
          <h1>Каждый баннер.<br /><em>До пикселя.</em></h1>
          <p>Загрузите один креатив или всю сетку. Сервис проверит размеры, выравнивание элементов и единообразие дисклеймеров.</p>
        </div>
        <div className="hero-badge" aria-hidden="true">
          <span>3</span><small>уровня<br />контроля</small>
        </div>
      </section>

      {showSettings && (
        <section className="settings-panel">
          <div>
            <span className="section-kicker">Допустимые размеры</span>
            <h2>Справочник форматов</h2>
            <p>Если размер указан в имени файла, он становится приоритетным эталоном.</p>
          </div>
          <div className="size-editor">
            <div className="size-chips">
              {allowedSizes.map((size) => (
                <button key={size} title="Удалить формат" onClick={() => setAllowedSizes((current) => current.filter((item) => item !== size))}>{size}<span>×</span></button>
              ))}
            </div>
            <div className="add-size">
              <input value={newSize} onChange={(event) => setNewSize(event.target.value)} onKeyDown={(event) => event.key === "Enter" && addSize()} placeholder="Например, 320×480" aria-label="Новый допустимый размер" />
              <button onClick={addSize}>Добавить</button>
            </div>
          </div>
        </section>
      )}

      <section className="workspace">
        <div
          className={`dropzone ${isDragging ? "is-dragging" : ""} ${isAnalyzing ? "is-busy" : ""}`}
          onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onDrop}
          onClick={() => !isAnalyzing && inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => (event.key === "Enter" || event.key === " ") && inputRef.current?.click()}
        >
          <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={onFileInput} />
          <div className="upload-symbol"><span>+</span></div>
          <div>
            <h2>{isAnalyzing ? "Анализируем креативы…" : "Перетащите креативы сюда"}</h2>
            <p>{isAnalyzing ? "Распознавание мелкого текста может занять немного времени" : "или нажмите, чтобы выбрать PNG, JPG или WEBP"}</p>
          </div>
          <span className="upload-cta">{isAnalyzing ? "Пожалуйста, подождите" : "Выбрать файлы"}</span>
        </div>

        <div className="privacy-note"><span>◇</span><p><b>Бесплатный ИИ-анализ Gemini.</b> Изображения отправляются в Google через сервер Vercel; API-ключ никогда не передаётся в браузер. На бесплатном тарифе данные могут использоваться Google для улучшения продуктов. Если лимит исчерпан, включается локальный OCR.</p></div>
      </section>

      {results.length > 0 && (
        <section className="results-section">
          <div className="results-head">
            <div>
              <span className="section-kicker">Результаты проверки</span>
              <h2>{summary.total} {summary.total === 1 ? "креатив" : summary.total < 5 ? "креатива" : "креативов"}</h2>
            </div>
            <div className="summary-strip">
              <span className="sum-pass"><i />{summary.pass} пройдено</span>
              <span className="sum-review"><i />{summary.review} проверить</span>
              <span className="sum-fail"><i />{summary.fail} ошибок</span>
            </div>
            <div className="head-actions">
              <button onClick={exportCsv} disabled={isAnalyzing}>Скачать отчёт</button>
              <button onClick={clearResults} disabled={isAnalyzing}>Очистить</button>
            </div>
          </div>

          <div className="creative-list">
            {results.map((item, index) => (
              <article className="creative-card" key={item.id}>
                <div className="preview-column">
                  <div className="preview-frame">
                    <img src={item.url} alt={`Превью ${item.file.name}`} />
                    <span className="card-index">{String(index + 1).padStart(2, "0")}</span>
                  </div>
                  <p title={item.file.name}>{item.file.name}</p>
                </div>

                <div className="checks-column">
                  <div className="card-title">
                    <div><span>Общий результат</span><h3>{item.status === "running" ? "Идёт анализ" : STATE_LABELS[item.status]}</h3></div>
                    <StatusPill state={item.status} />
                  </div>

                  <div className="check-row">
                    <div className="check-number">01</div>
                    <div className="check-body">
                      <div className="check-title"><b>Точный размер</b><StatusPill state={item.sizeStatus} /></div>
                      <p className="dimension-value">{item.width} × {item.height} <small>px</small></p>
                      {item.expectedFromName && <p className="muted">В имени файла указан эталон {item.expectedFromName}</p>}
                      {!item.expectedFromName && item.sizeStatus === "fail" && <p className="warning-text">Размер отсутствует в справочнике допустимых форматов</p>}
                    </div>
                  </div>

                  <div className="check-row">
                    <div className="check-number">02</div>
                    <div className="check-body">
                      <div className="check-title"><b>Сетка и выравнивание</b><StatusPill state={item.grid.status} /></div>
                      <div className="score-line"><span><i style={{ width: `${item.grid.score}%` }} /></span><b>{item.grid.score}<small>/100</small></b></div>
                      <ul>{item.grid.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
                    </div>
                  </div>

                  <div className="check-row disclaimer-row">
                    <div className="check-number">03</div>
                    <div className="check-body">
                      <div className="check-title"><b>Дисклеймер</b><StatusPill state={item.disclaimerStatus} /></div>
                      {item.disclaimerStatus === "running" ? (
                        <div className="ocr-progress"><span><i style={{ width: `${item.progress}%` }} /></span><small>{item.progress}%</small></div>
                      ) : (
                        <>
                          <blockquote>{item.disclaimerText || "Дисклеймер не найден или текст слишком мелкий для уверенного распознавания."}</blockquote>
                          <p className="analysis-source">Источник: {item.analysisSource === "ai" ? "онлайн-анализ ИИ" : "резервный локальный OCR"}</p>
                          {item.analysisSource === "local" && item.aiError && <p className="warning-text">ИИ: {item.aiError}</p>}
                          {item.disclaimerSimilarity !== undefined && <p className={item.disclaimerSimilarity >= 88 ? "match-good" : "warning-text"}>Совпадение с эталоном в этой пачке: <b>{item.disclaimerSimilarity}%</b></p>}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <footer>
        <span>Creative Check</span>
        <p>Автоматическая проверка помогает находить технические ошибки. Финальное решение по композиции остаётся за дизайнером.</p>
      </footer>
    </main>
  );
}
