import type { VercelRequest, VercelResponse } from "@vercel/node";
import OpenAI from "openai";

const MAX_IMAGE_LENGTH = 5_500_000;

const resultSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    disclaimer: {
      type: "object",
      additionalProperties: false,
      properties: {
        present: { type: "boolean" },
        text: { type: "string" },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        issues: { type: "array", items: { type: "string" } },
      },
      required: ["present", "text", "confidence", "issues"],
    },
    grid: {
      type: "object",
      additionalProperties: false,
      properties: {
        score: { type: "integer", minimum: 0, maximum: 100 },
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

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Разрешён только POST-запрос" });
  }

  if (!process.env.OPENAI_API_KEY) {
    return response.status(503).json({ error: "На сервере не настроен OPENAI_API_KEY" });
  }

  const image = request.body?.image;
  const filename = typeof request.body?.filename === "string" ? request.body.filename.slice(0, 160) : "creative";
  if (!validImage(image)) {
    return response.status(400).json({ error: "Некорректное или слишком большое изображение" });
  }

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const aiResponse = await client.responses.create({
      model: process.env.OPENAI_VISION_MODEL || "gpt-5.6",
      store: false,
      input: [{
        role: "user",
        content: [
          {
            type: "input_text",
            text: `Проверь рекламный креатив ${filename} как специалист по контролю качества.

ДИСКЛЕЙМЕР:
- Найди только юридический дисклеймер, обычно это самый мелкий текст в нижней части баннера.
- Перепиши его дословно, символ за символом, сохранив числа, даты, ИНН, названия, домены и пунктуацию.
- Не исправляй и не дополняй текст по смыслу. Если отдельный фрагмент невозможно прочитать, поставь [неразборчиво] именно на его месте и снизь confidence.
- present=false только если юридического дисклеймера действительно нет. В этом случае text должен быть пустым.

СЕТКА:
- Проверь ровность элементов, визуальные поля, выравнивание по вертикали/горизонтали, слишком тесные интервалы и выходы к краям.
- score — оценка от 0 до 100. pass — явных проблем нет; review — есть сомнение; fail — заметная ошибка.
- Все пояснения верни на русском языке.`,
          },
          { type: "input_image", image_url: image, detail: "high" },
        ],
      }],
      text: {
        format: {
          type: "json_schema",
          name: "creative_quality_result",
          strict: true,
          schema: resultSchema,
        },
      },
    });

    const parsed = JSON.parse(aiResponse.output_text);
    return response.status(200).json(parsed);
  } catch (error) {
    console.error("OpenAI analysis failed", error);
    return response.status(502).json({ error: "ИИ не смог завершить анализ изображения" });
  }
}
