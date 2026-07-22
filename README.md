# Creative Quality Checker

Онлайн-инструмент для пакетной технической и ИИ-проверки рекламных баннеров.

## Возможности

- точная проверка фактических размеров по справочнику форматов;
- приоритет эталона размера из имени файла, например `banner_300x250.png`;
- анализ сетки, полей и выравнивания с помощью vision-модели;
- дословное распознавание юридического дисклеймера на русском и английском;
- сравнение дисклеймеров внутри загруженной пачки;
- резервный локальный OCR, если онлайн-анализ временно недоступен;
- выгрузка результатов в CSV.

Изображения передаются в OpenAI только через защищённую серверную функцию Vercel. `OPENAI_API_KEY` хранится в переменных окружения Vercel и никогда не попадает в браузер.

## Запуск

```bash
npm install
npm run dev
```

## Проверка

```bash
npm run build:vercel
npx tsc --noEmit --strict --skipLibCheck --esModuleInterop --module NodeNext --moduleResolution NodeNext --target ES2022 api/analyze.ts
```

## Развёртывание на Vercel

1. Загрузите проект в GitHub.
2. В Vercel выберите **Add New → Project** и импортируйте репозиторий.
3. Настройки сборки берутся из `vercel.json`: команда `npm run build:vercel`, папка результата `dist`.
4. В **Settings → Environment Variables** добавьте `OPENAI_API_KEY` для Production и Preview.
5. Необязательно добавьте `OPENAI_VISION_MODEL`; по умолчанию используется `gpt-5-mini` с поддержкой изображений и Structured Outputs.
6. Нажмите **Deploy**.

Не добавляйте реальный API-ключ в файлы проекта, GitHub или клиентский код.
