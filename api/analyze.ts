import type { VercelRequest, VercelResponse } from "@vercel/node";
import { GoogleGenAI } from "@google/genai";

const MAX_IMAGE_LENGTH = 5_500_000;

const resultSchema = {
  type: "object",
  properties: {
    disclaimer: {
      type: "object",
      properties: {
        present: { type: "boolean" },
        text: { type: "string" },
        confidence: { type: "number" },
        issues: { type: "array", items: { type: "string" } },
      },
      required: ["present", "text", "confidence", "issues"],
    },
    grid: {
      type: "object",
      properties: {
        score: { type: "integer" },
        status: { type: "string", enum: ["pass", "review", "fail"] },
        issues: { type: "array", items: { type: "string" } },
      },
      required: ["score", "status", "issues"],
    },
  },
  required: ["disclaimer", "grid"],
} as const;

function validImage(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= MAX_IMAGE_LENGTH
    && /^data:image\/(jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(value);
}

function publicGeminiError(error: unknown) {
  const status = typeof error === "object" && error && "status" in error ? Number(error.status) : 0;
  if (status === 401 || status === 403) return "GEMINI_API_KEY отклонён Google";
  if (status === 404) return "Модель Gemini недоступна для этого API-проекта";
  if (status === 429) return "Исчерпан бесплатный лимит Gemini — попробуйте позже";
  if (status === 400) return "Gemini отклонил параметры запроса";
  return `Ошибка Gemini${status ? ` (${status})` : ""}`;
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Разрешён только POST-запрос" });
  }

  if (!process.env.GEMINI_API_KEY) {
    return response.status(503).json({ error: "На сервере не настроен GEMINI_API_KEY" });
  }

  const image = request.body?.image;
  const filename = typeof request.body?.filename === "string" ? request.body.filename.slice(0, 160) : "creative";
  if (!validImage(image)) {
    return response.status(400).json({ error: "Некорректное или слишком большое изображение" });
  }

  try {
    const dataUrl = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/i.exec(image);
    if (!dataUrl) return response.status(400).json({ error: "Некорректное изображение" });
    const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const interaction = await client.interactions.create({
      model: process.env.GEMINI_VISION_MODEL || "gemini-3.6-flash",
      input: [
        {
          type: "text",
          text: `Проверь рекламный креатив ${filename} как специалист по контролю качества.

ДИСКЛЕЙМЕР:
- Найди только юридический дисклеймер, обычно это самый мелкий текст в нижней части баннера.
- Перепиши его дословно, символ за символом, сохранив числа, даты, ИНН, названия, домены и пунктуацию.
- Не исправляй и не дополняй текст по смыслу. Если отдельный фрагмент невозможно прочитать, поставь [неразборчиво] именно на его месте и снизь confidence.
- present=false только если юридического дисклеймера действительно нет. В этом случае text должен быть пустым.

СЕТКА:
- Анализируй только размещённые поверх фона элементы дизайна: логотип, бренд, заголовки, оффер, цены и числа, CTA, подписи и юридический дисклеймер.
- Полностью игнорируй фотографию и её содержимое: архитектуру, окна, фасады, горизонт, тени, текстуры, узоры и естественные линии объектов. Не считай их сеткой и не используй для оценки выравнивания.
- Игнорируй декоративные линии и фигуры, если они не служат явной осью выравнивания нескольких текстовых или брендовых элементов.
- Проверяй общие левые и правые оси переднего плана, безопасные отступы от края, интервалы между связанными блоками, наложения и визуально случайные смещения.
- Не требуй симметрии и одинаковых полей сверху и снизу: рекламная композиция может быть намеренно асимметричной, особенно в широких форматах.
- В issues включай только конкретные подтверждённые дефекты, требующие правки. Если дефектов нет, верни пустой массив.
- score — оценка от 0 до 100. pass разрешён только при пустом issues; review — есть подтверждённое замечание или сомнение; fail — заметная ошибка.
- Все пояснения верни на русском языке.`,
        },
        { type: "image", data: dataUrl[2], mime_type: dataUrl[1] },
      ],
      response_format: {
        type: "text",
        mime_type: "application/json",
        schema: resultSchema,
      },
      generation_config: { thinking_level: "minimal" },
    });

    if (!interaction.output_text) throw new Error("Gemini returned an empty response");
    const parsed = JSON.parse(interaction.output_text);
    return response.status(200).json(parsed);
  } catch (error) {
    console.error("Gemini analysis failed", error);
    return response.status(502).json({ error: publicGeminiError(error) });
  }
}
