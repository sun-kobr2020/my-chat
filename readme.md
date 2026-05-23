Я разрабатываю веб-чат на Vite + Firebase (Firestore) с собственным файловым сервером на Express + Multer (Node.js). 
В проект внедрена полная автоматизация динамических адресов сервера.

Описание проекта

Этот проект представляет собой полнофункциональный веб-чат, разработанный с использованием современных технологий:
Фронтенд: Vite, Firebase SDK (Firestore)
Бэкенд: Node.js, Express, Multer
База данных: Firebase Firestore
Автоматизация: Динамические адреса сервера, автоматическое обновление в Firestore
Структура проекта
index.html: Разметка пользовательского интерфейса (UI).
app.js: Клиентская логика (ES-модули, Vite, Firebase SDK).
style.css: Стили приложения (инлайн-стили отсутствуют).
server.js: Express-сервер для загрузки и раздачи файлов.
.env: Переменные окружения фронтенда (VITE_*).
Реализованный функционал

1. Автоматизация адреса сервера и сетевая архитектура
Программный туннель: Сервер Express (порт 5000) запускает фоновый процесс ssh -R 80:127.0.0.1:5000 nokey@localhost.run для создания публичного адреса. 
Обработка проверки ключей хоста автоматизирована.
Синхронизация адреса: Сервер парсит логи терминала, извлекает динамический URL (https://[id].lhr.life) и автоматически обновляет его в Firebase Firestore:

javascript

db.collection('system').doc('config').set({

    backendUrl: serverUrl,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()

});

(Используется Firebase Admin SDK)
Правила безопасности Firestore: Для коллекции system/config настроен безопасный гостевой доступ, позволяющий клиентам читать URL, но запрещающий его модификацию:

javascript

rules_version = '2';

service cloud.firestore {

match /databases/{database}/documents {

    match /system/config {

      allow read: if true;

      allow write: if false;

    }

}

}

Настройка CORS (Express 5): Универсальное middleware для обхода ограничений CORS и корректной обработки OPTIONS-запросов:

javascript

app.use((req, res, next) => {

    res.header('Access-Control-Allow-Origin', '*');

    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin, Bypass-Tunnel-Reminder');

    if (req.method === 'OPTIONS') {

        return res.sendStatus(200);

    }

    next();

});

2. Чат
Комнаты: Разделение на комнаты (general + приватные) осуществляется через URL-параметр ?room=.
Сообщения в Firestore: Документы хранятся в формате:

json

{

"username": "...",

"text": "...",

"files": [

    { "fileUrl": "...", "fileType": "...", "fileName": "..." }

],

"createdAt": "..."

}

Отображение: Поддерживается рендеринг изображений, видео и документов (в виде виджета со скачиванием). 
Ссылки на файлы формируются динамически на основе backendUrl из Firestore.
Безопасность: Защита от XSS-атак через функцию escapeHtml().

Оптимизация: Ограничение на выборку сообщений (200 шт.), realtime-обновления через onSnapshot().

3. Загрузка файлов
Инициализация URL: Перед загрузкой клиент асинхронно считывает актуальный backendUrl из Firestore.
Протокол отправки: Файлы загружаются на Express-сервер через XMLHttpRequest (XHR) для получения прогресса загрузки.
Валидация порядка вызовов: Настройка заголовков xhr.setRequestHeader() происходит после xhr.open() и до xhr.send().

Логика функций:

uploadFileWithProgress(url, file, onProgress): Отправляет файл, возвращает Promise и передает прогресс выполнения в callback.
handleFileUpload(e): Проверяет расширения файлов на клиенте, рассчитывает общий прогресс и обновляет UI.

4. Прогресс-бар и состояния UI
HTML-структура:
html
¨K13K
CSS-управление состояниями (через классы на #file-preview-zone):
state-loading: Голубой фон, анимация shimmer на баре загрузки.
state-success: Зеленый фон.
state-error: Красный фон.
Пустая строка классов ('') для полного сброса панели.

5. Правила хранилища на сервере (Express + Multer)
Роут: POST /api/upload (принимает поле chatFile).
Сортировка по папкам: Функция getSubFolder(mimetype, originalName) распределяет файлы по директориям: images/, videos/, documents/. 
При возврате null файл запрещен (например, .exe, .bat).
RAR-фикс: Если MIME-тип определен как application/octet-stream, проверяется расширение файла.

Лимиты:

Rate limit: 50 файлов за 2 минуты.
Максимальный размер файла: 300 МБ.
Ограничение на документы и фото: до 50 МБ.
Статика раздается через /uploads.

6. Список разрешённых типов файлов
Изображения: .jpg, .jpeg, .png, .gif, .webp, .svg, .bmp.
Видео: .mp4, .webm, .ogg, .mov, .avi, .mkv.
Архивы: .zip, .rar, .7z, .tar, .gz.
Документы: .pdf, .doc, .docx, .xls, .xlsx, .ppt, .pptx, .txt, .csv.

7. Боковая панель (Sidebar)
Отображает список комнат в реальном времени из коллекции Firestore all_rooms.
Кнопка создания комнаты генерирует случайный ID.
Кнопки "Поделиться ссылкой" (копирование в буфер обмена), "Удалить комнату" и быстрого возврата в комнату general.