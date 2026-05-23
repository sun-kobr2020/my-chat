Я разрабатываю веб-чат на Vite + Firebase (Firestore) с собственным
файловым сервером на Express + Multer (Node.js).

Структура проекта:
- index.html — разметка
- app.js — клиентская логика (ES-модули, Vite)
- style.css — все стили (инлайн-стилей нет)
- server.js — Express-сервер для загрузки файлов
- .env — переменные окружения через import.meta.env (VITE_*)

Что уже реализовано:

1. ЧАТ:
- Комнаты (general + приватные) через URL-параметр ?room=
- Сообщения в Firestore: { username, text, files[], createdAt }
- files[] = [{ fileUrl, fileType, fileName }]
- Рендеринг: картинки, видео, документы (виджет со скачиванием)
- Защита от XSS через escapeHtml()
- Лимит 200 сообщений, realtime через onSnapshot()

2. ЗАГРУЗКА ФАЙЛОВ (app.js):
- Файлы грузятся на свой Express-сервер через XHR (не fetch!)
- XHR используется для получения реального прогресса через
  xhr.upload.addEventListener('progress')
- Функция uploadFileWithProgress(url, file, onProgress) —
  возвращает Promise, принимает callback с процентом (0-100)
- Функция handleFileUpload(e) — основная логика:
    * Сначала проверяет расширения файлов на клиенте ДО загрузки
    * Если расширение запрещено — сразу показывает ошибку,
      загрузка не начинается
    * Считает общий прогресс по всем файлам
    * Управляет состояниями через CSS-классы (не инлайн-стили!)

3. ПРОГРЕСС-БАР (UI):
   HTML-структура в index.html:
  <div id="file-preview-zone">
    <div class="preview-row">
      <span id="file-preview-name">📎 Файл: </span>
      <button id="cancel-file-btn">❌</button>
    </div>
    <div id="progress-container">
      <div id="progress-bar"></div>
      <span id="progress-text">0%</span>
    </div>
  </div>

CSS-классы состояний на #file-preview-zone:
- state-loading → голубой фон + shimmer-анимация на баре
- state-success → зелёный фон
- state-error   → красный фон
  Все стили в style.css, инлайн-стилей нет.

JS управление состояниями:
previewZone.className = 'state-loading' // при загрузке
previewZone.className = 'state-success'  // успех
previewZone.className = 'state-error'    // ошибка
previewZone.className = ''               // сброс

4. СЕРВЕР (server.js):
- Express + Multer, порт 5000
- Маршрут POST /api/upload принимает поле chatFile
- Функция getSubFolder(mimetype, originalName) определяет папку:
    * images/ — для image/*
    * videos/ — для video/*
    * documents/ — для pdf, zip, rar, doc, xls, ppt и т.д.
    * null — запрещено (exe, bat, sh и т.д.)
- RAR-фикс: если MIME = application/octet-stream,
  проверяет расширение файла как запасной вариант
- originalName передаётся во все вызовы getSubFolder()
- Rate limit: 50 файлов за 2 минуты
- Лимит размера: 300 МБ (документы и фото — до 50 МБ)
- Файлы раздаются статически через /uploads

5. РАЗРЕШЁННЫЕ ТИПЫ (клиент — по расширению):
   Изображения: .jpg .jpeg .png .gif .webp .svg .bmp
   Видео: .mp4 .webm .ogg .mov .avi .mkv
   Архивы: .zip .rar .7z .tar .gz
   Документы: .pdf .doc .docx .xls .xlsx .ppt .pptx .txt .csv

6. SIDEBAR:
- Список комнат из Firestore коллекции all_rooms
- Кнопка создать комнату (случайный ID)
- Кнопка поделиться ссылкой (копирует в буфер)
- Кнопка удалить комнату
- Кнопка вернуться в general