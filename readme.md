# Я разрабатываю веб-чат на Vite + Firebase (Firestore + Auth + App Check) с собственным файловым сервером на Express + Multer (Node.js). 
# В проект внедрена автоматизация динамических адресов и многоуровневая система безопасности.
# Структура проекта: 
# Веб-чат на Vite + Firebase с собственным файловым сервером на Express


Этот проект представляет собой полнофункциональный веб-чат, разработанный с использованием Vite, 
Firebase (Firestore, Auth, App Check) и собственного серверного решения на Express + Multer (Node.js). 
Проект включает автоматизацию динамических доступов и многоуровневую систему безопасности.

## Функционал и технологии

### 1. Сетевая автоматизация и CORS (server.js)

*   **Программный туннель:** При запуске сервера Express (порт 5000) автоматически запускается фоновый SSH-процесс `ssh -R 80:127.0.0.1:5000 nokey@localhost.run` для обеспечения доступности извне. Обработка проверки ключей хоста.
*   **Синхронизация адреса:** Сервер парсит логи терминала, извлекает уникальный URL вида `https://[id].lhr.life` и обновляет его в Firestore (`db.collection('system').doc('config')`) через Firebase Admin SDK.
*   **CORS & OPTIONS (Express 5):** Реализовано универсальное middleware для полной поддержки CORS-заголовков. Запросы предварительной проверки (OPTIONS) мгновенно возвращают `200 OK`, предотвращая синтаксические ошибки путей в Express 5.

    ```javascript
    app.use((req, res, next) => {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin, Bypass-Tunnel-Reminder');
        if (req.method === 'OPTIONS') { return res.sendStatus(200); }
        next();
    });
    ```

### 2. Безопасность, авторизация и сессии (Firebase Auth + App Check)

*   **Firebase Authentication & Профили:**
    *   Доступ к чату ограничен.
    *   При регистрации (`createUserWithEmailAndPassword`) пользователь указывает кастомное прозвище (Никнейм), которое мгновенно записывается в профиль Firebase через `updateProfile`.
    *   `user.reload()` используется для мгновенного подтягивания никнейма на клиенте без перезагрузки.
    *   Пароли безопасно хэшируются на стороне Firebase. Сессия автоматически сохраняется в IndexedDB браузера.
*   **Безопасное удаление аккаунта:**
    *   Кнопка `.delete-account-button` в сайдбаре запрашивает двойное подтверждение (`confirm()`) и полностью стирает профиль пользователя через `deleteUser(user)`.
    *   Перехват ошибки `auth/requires-recent-login` с предупреждением о необходимости перезайти.
*   **Firebase App Check:**
    *   Защита от спам-ботов через Google reCAPTCHA v3.
    *   Публичный Site Key вынесен в `.env`.
    *   Для локальной разработки включен отладочный токен (`FIREBASE_APPCHECK_DEBUG_TOKEN = true`).
    *   На продакшене (GitHub Pages `sun-kobr2020.github.io`) защита переключается автоматически.
*   **Правила Firestore:**
    *   Гостевой доступ к данным закрыт.
    *   Настройки туннеля открыты на чтение.
    *   Комнаты, сообщения и статусы защищены строгой проверкой авторизации.

    ```javascript
    match /system/config {
      allow read: if true;
      allow write: if false;
    }

    match /all_rooms/{roomId} {
      allow read, write: if request.auth != null;
    }

    match /typing_statuses/{statusId} {
      allow read, write: if request.auth != null;
    }

    match /rooms/{roomId} {
      allow read, write: if request.auth != null;
      match /messages/{messageId} {
        allow read, write: if request.auth != null;
      }
    }
    ```

### 3. Архитектура и интерфейс (index.html + style.css)

*   **Разметка:** Два глобальных контейнера в `<body>`:
    *   `#auth-container`: Форма входа/регистрации с динамическим полем никнейма (`.register-only-field`).
    *   `#app-container`: Основной интерфейс чата и сайдбар.
*   **Кнопка выхода:** `#logout-btn` интегрирована в верхнюю левую панель сайдбара (`<aside class="sidebar">`).
*   **Идеальное переключение без мерцания:**
    *   Оба контейнера по умолчанию скрыты (`display: none !important`).
    *   JavaScript-наблюдатель (`onAuthStateChanged`) динамически добавляет классы `.auth-mode` (для `#auth-container`) или `.chat-mode` (для `#app-container`) к тегу `<body>`, обеспечивая плавное переключение.

### 4. Индикатор печати в реальном времени

*   **Служебная коллекция `typing_statuses`:**
    *   Реализован realtime-мониторинг набора текста.
    *   При вводе символов в `#message` срабатывает слушатель, который через `setTypingStatus(true)` записывает в Firestore документ вида `${currentRoom}_${userEmail}`.
    *   Схема данных: `{ room, username, userEmail, isTyping: true, updatedAt: serverTimestamp() }`.
*   **Оптимизация `Debounce` & Сброс:**
    *   Используется `clearTimeout` / `setTimeout` для предотвращения спама в базе данных.
    *   Если пользователь перестает набирать текст более 2.5 секунд или полностью стирает его, статус автоматически меняется на `isTyping: false`.
    *   Статус мгновенно сбрасывается при отправке сообщения.
*   **Рендеринг статусов на клиенте:**
    *   Слушатель `onSnapshot` для коллекции `typing_statuses` фильтрует активных пользователей в текущей комнате, исключает самого себя и проверяет актуальность записи по времени.
    *   Результат выводится в `#typing-indicator-zone` в формате: "Ник печатает...", "Ник1, Ник2 печатают..." или "Несколько человек печатают...".

### 5. Работа с Firestore и клиентская логика (app.js)

*   **Инициализация по сессии:** Все realtime-слушатели Firestore (`onSnapshot`) для получения сообщений и списка комнат запускаются только после успешного события `onAuthStateChanged`.
*   **При выходе (signOut):** Клиент принудительно вызывает функции отписки от обновлений базы данных (`unsubscribeMessages`, `unsubscribeRooms`, `unsubscribeTyping`), предотвращая ошибки `Missing permissions`.
*   **Идентификация автора:** Поле ввода имени (`readOnly = true`) автоматически заполняется `user.displayName` или `user.email` текущей сессии Firebase Auth.
*   **Чат-функционал:**
    *   Разделение комнат через URL-параметр `?room=`.
    *   Лимит на 200 сообщений.
    *   Защита от XSS через `escapeHtml()`.
    *   Рендеринг изображений, видео или кастомных виджетов с скачиванием документов.

### 6. Загрузка и валидация файлов

*   **Асинхронный запрос URL:** Перед загрузкой клиент асинхронно запрашивает актуальный `backendUrl` из Firestore.
*   **Отправка на Express-сервер:** Файлы отправляются через `XMLHttpRequest` для расчета прогресса загрузки в реальном времени.
*   **Состояние зоны предпросмотра:** `#file-preview-zone` переключается через CSS-классы (`state-loading`, `state-success`, `state-error`).
*   **Валидация расширений:** Происходит на клиенте ДО отправки. Разрешенные типы: изображения, видео, архивы (`.zip`, `.rar`, `.7z`, `.tar`, `.gz`) и документы (`.pdf`, `.doc`, `.docx`, `.xls`, `.xlsx`, `.ppt`, `.pptx`, `.txt`, `.csv`).
*   **Серверные лимиты:**
    *   Express + Multer раздает стати
    *   ку из `/uploads`.
    *   Функция `getSubFolder(mimetype, originalName)` для распределения по подпапкам.
    *   Лимит размера файла: 300 МБ (фото и документы до 50 МБ).
    *   Ограничение частоты: 50 файлов за 2 минуты.