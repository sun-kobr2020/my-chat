// ==========================================
// 1. ИМПОРТЫ И ИНИЦИАЛИЗАЦИЯ
// ==========================================
import {
    getAuth,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    onAuthStateChanged,
    signOut,
    deleteUser,
    updateProfile
} from 'firebase/auth';

import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";

import { initializeApp } from "firebase/app";
import {
    getFirestore,
    collection,
    addDoc,
    query,
    orderBy,
    limit,
    onSnapshot,
    serverTimestamp,
    doc,
    setDoc,
    deleteDoc,
    getDoc // Добавлен getDoc
} from "firebase/firestore";
import { getStorage } from "firebase/storage";

// Конфигурация Firebase
const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID
};

console.log("Проверка ProjectId:", firebaseConfig.projectId);

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);
const auth = getAuth(app);

// Активация невидимой защиты от ботов reCAPTCHA v3
// Автоматически включаем дебаг-токен ТОЛЬКО на локальном компьютере
if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    console.log("ℹ️ App Check запущен в режиме отладки (Localhost)");
}

// Инициализация App Check
const appCheck = initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(import.meta.env.VITE_RECAPTCHA_SITE_KEY),
    isTokenAutoRefreshEnabled: true
});



// Логика комнат и URL
const urlParams = new URLSearchParams(window.location.search);
const currentRoom = urlParams.get('room') || 'general';

// Селекторы элементов интерфейса
const authForm = document.getElementById('auth-form');
const emailInput = document.getElementById('auth-email');
const passwordInput = document.getElementById('auth-password');
const submitBtn = document.getElementById('auth-submit-btn');
const toggleModeBtn = document.getElementById('auth-toggle-mode-btn');
const authTitle = document.getElementById('auth-title');
const switchDesc = document.getElementById('auth-switch-desc');
const logoutBtn = document.getElementById('logout-btn');
const authNicknameGroup = document.getElementById('auth-nickname-group');
const nicknameInput = document.getElementById('auth-nickname');


// Селектор новой кнопки
const deleteAccountBtn = document.getElementById('delete-account-btn');

// Логика безопасного удаления аккаунта
if (deleteAccountBtn) {
    deleteAccountBtn.addEventListener('click', async () => {
        const user = auth.currentUser; // Получаем текущего вошедшего пользователя

        if (!user) {
            alert("Пользователь не найден или сессия истекла.");
            return;
        }

        // Первое подтверждение
        const firstConfirm = confirm(`Вы уверены, что хотите НАВСЕГДА удалить свой аккаунт (${user.email})? Это действие нельзя отменить.`);

        if (firstConfirm) {
            // Второе подтверждение для защиты от случайного клика
            const secondConfirm = confirm("ВНИМАНИЕ: Все ваши доступы будут аннулированы прямо сейчас. Подтверждаете удаление?");

            if (secondConfirm) {
                try {
                    // Удаляем пользователя из Firebase Auth
                    await deleteUser(user);
                    alert("Ваш аккаунт был успешно и безвозвратно удален.");

                    // Наблюдатель onAuthStateChanged сам увидит, что пользователя больше нет,
                    // и автоматически переключит интерфейс в режим 'auth-mode' (на экран входа)

                } catch (error) {
                    console.error("Ошибка при удалении аккаунта:", error);

                    // Защита Firebase: если пользователь вошел давно, Google потребует перезайти в аккаунт перед удалением
                    if (error.code === 'auth/requires-recent-login') {
                        alert("В целях безопасности для удаления аккаунта необходимо перезайти в систему. Пожалуйста, выйдете и войдите заново, затем повторите попытку.");
                    } else {
                        alert(`Не удалось удалить аккаунт: ${error.message}`);
                    }
                }
            }
        }
    });
}

const roomNameElement = document.getElementById('room-name');
const chatWindow = document.getElementById('chat-window');
const msgInput = document.getElementById('message');
const userInput = document.getElementById('username');
const sendBtn = document.getElementById('send-btn');
const fileInput = document.getElementById('file-input');

const previewZone = document.getElementById('file-preview-zone');
const previewName = document.getElementById('file-preview-name');
const cancelFileBtn = document.getElementById('cancel-file-btn');
const progressContainer = document.getElementById('progress-container');
const progressBar = document.getElementById('progress-bar');

// Проверка наличия критических элементов
if (!chatWindow || !msgInput || !userInput || !sendBtn || !fileInput) {
    console.error('❌ ОШИБКА: Не найдены элементы!', { chatWindow, msgInput, userInput, sendBtn, fileInput });
    throw new Error('Критическая ошибка: элементы интерфейса не найдены');
}

if (roomNameElement) {
    roomNameElement.innerText = currentRoom;
}

// Глобальные переменные состояния чата
let attachedFilesList = [];
let messagesRef = null; // Будет инициализировано после входа
let unsubscribeMessages = null;
let unsubscribeRooms = null;
let isLoginMode = true;

// Вспомогательная функция защиты от XSS-атак
function escapeHtml(text) {
    return text ? text.replace(/&/g, "&").replace(/</g, "<").replace(/>/g, ">") : '';
}

// Отмена прикрепленных файлов
if (cancelFileBtn) {
    cancelFileBtn.addEventListener('click', () => {
        attachedFilesList = [];
        if (previewZone) previewZone.style.display = 'none';
    });
}

// ==========================================
// 2. УПРАВЛЕНИЕ СЕССИЕЙ И АВТОРИЗАЦИЯ
// ==========================================

// Переключение между Входом и Регистрацией
toggleModeBtn.addEventListener('click', () => {
    isLoginMode = !isLoginMode;
    if (isLoginMode) {
        authTitle.textContent = 'Вход в чат';
        submitBtn.textContent = 'Войти';
        switchDesc.textContent = 'Ещё нет аккаунта?';
        toggleModeBtn.textContent = 'Зарегистрироваться';

        authForm.classList.remove('show-register-fields'); // Скрываем поле никнейма
        nicknameInput.removeAttribute('required');          // Снимаем обязательность заполнения
    } else {
        authTitle.textContent = 'Регистрация';
        submitBtn.textContent = 'Создать аккаунт';
        switchDesc.textContent = 'Уже есть аккаунт?';
        toggleModeBtn.textContent = 'Войти';

        authForm.classList.add('show-register-fields');    // Показываем поле никнейма
        nicknameInput.setAttribute('required', 'true');     // Делаем поле обязательным
    }
});

// Отправка формы (Вход / Регистрация)
authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    const nickname = nicknameInput.value.trim(); // Получаем введенный ник

    try {
        if (isLoginMode) {
            await signInWithEmailAndPassword(auth, email, password);
        } else {
            // 1. Создаем пользователя
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);

            // 2. Сразу же записываем никнейм в его профиль Firebase Auth
            await updateProfile(userCredential.user, {
                displayName: nickname
            });

            alert('Аккаунт успешно создан! Добро пожаловать.');
        }
        authForm.reset();
    } catch (error) {
        // ... ваш существующий блок catch с обработкой ошибок ошибок ...
        console.error("Ошибка аутентификации:", error);
        let errorMessage = 'Произошла ошибка при авторизации';
        if (error.code === 'auth/invalid-credential') {
            errorMessage = 'Неверный email или пароль.';
        } else if (error.code === 'auth/email-already-in-use') {
            errorMessage = 'Этот email уже зарегистрирован.';
        } else if (error.code === 'auth/weak-password') {
            errorMessage = 'Пароль должен быть не менее 6 символов.';
        }
        alert(errorMessage);
    }
});

// Кнопка выхода
if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
        try {
            await signOut(auth);
        } catch (error) {
            console.error("Ошибка при выходе:", error);
        }
    });
}

// ГЛАВНЫЙ НАБЛЮДАТЕЛЬ ЗА СЕССИЕЙ
onAuthStateChanged(auth, (user) => {
    if (user) {
        // Пользователь вошел: включаем чат-режим, выключаем авторизацию
        document.body.classList.remove('auth-mode');
        document.body.classList.add('chat-mode');

        // Выводим в консоль ник для проверки
        console.log(`Успешный вход! Никнейм: ${user.displayName || 'Не указан'}, Email: ${user.email}`);

        if (userInput) {
            // Если у пользователя есть displayName, пишем его. Если нет (для старых аккаунтов) — пишем email.
            userInput.value = user.displayName || user.email;
            userInput.readOnly = true;
        }

        // АКТИВИРУЕМ ДИНАМИЧЕСКИЕ ССЫЛКИ И СЛУШАТЕЛИ ПОСЛЕ ВХОДА
        messagesRef = collection(db, "rooms", currentRoom, "messages");

        const q = query(messagesRef, orderBy("createdAt", "asc"), limit(200));
        unsubscribeMessages = onSnapshot(q, (snapshot) => {
            chatWindow.innerHTML = '';
            if (snapshot.empty) {
                chatWindow.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">Сообщений пока нет...</div>';
                return;
            }
            snapshot.forEach((doc) => {
                const data = doc.data();
                let timeStr = "--:--";
                if (data.createdAt) {
                    const date = data.createdAt.toDate();
                    timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                }

                let contentHtml = '';
                if (data.text) {
                    contentHtml += `<div class="text">${escapeHtml(data.text)}</div>`;
                }

                // Обработка случая, когда data.files пустой, но есть data.fileUrl
                const filesArray = data.files || (data.fileUrl ? [{ fileUrl: data.fileUrl, fileType: data.fileType, fileName: 'Файл' }] : []);
                filesArray.forEach(file => {
                    if (file.fileType.startsWith('image/')) {
                        contentHtml += `<img src="${file.fileUrl}" alt="image" loading="lazy" style="max-width: 100%; border-radius: 8px; margin-top: 5px; display: block;">`;
                    } else if (file.fileType.startsWith('video/')) {
                        contentHtml += `<video src="${file.fileUrl}" controls style="max-width: 100%; border-radius: 8px; margin-top: 5px; display: block;"></video>`;
                    } else {
                        contentHtml += `
                        <div class="chat-doc-box" style="display: flex; align-items: center; background: #f1f5f9; padding: 8px 12px; border-radius: 6px; margin-top: 5px; border: 1px solid #e2e8f0;">
                            <span style="font-size: 24px; margin-right: 10px;">📄</span>
                            <div style="flex-grow: 1; min-width: 0; text-align: left;">
                                <div style="font-size: 13px; font-weight: 500; color: #1e293b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(file.fileName) || 'Документ'}</div>
                                <div style="font-size: 11px; color: #64748b;">Файл (${escapeHtml(file.fileType.split('/')[1] || 'bin')})</div>
                            </div>
                            <a href="${file.fileUrl}" target="_blank" download style="text-decoration: none; background: #007bff; color: white; padding: 4px 10px; border-radius: 4px; font-size: 12px; font-weight: bold; margin-left: 10px;">Скачать</a>
                        </div>`;
                    }
                });

                chatWindow.innerHTML += `
                <div class="msg">
                    <div class="user">${escapeHtml(data.username)}</div>
                    ${contentHtml}
                    <div class="time">${timeStr}</div>
                </div>`;
            });
            chatWindow.scrollTop = chatWindow.scrollHeight;
        }, (error) => {
            console.error("❌ Ошибка Firestore: ", error);
        });

        const roomsListElement = document.getElementById('rooms-list');
        if (roomsListElement) {
            const roomsQuery = query(collection(db, "all_rooms"), orderBy("createdAt", "desc"));
            unsubscribeRooms = onSnapshot(roomsQuery, (snapshot) => {
                roomsListElement.innerHTML = `<li><a href="${window.location.pathname}">🌐 general</a></li>`; // Ссылка на general
                snapshot.forEach((roomDoc) => {
                    const roomId = roomDoc.id;
                    // Пропускаем general, так как он уже добавлен
                    if (roomId === 'general') return;

                    const li = document.createElement('li');
                    li.innerHTML = `
                        <a href="${window.location.pathname}?room=${roomId}">🔑 ${roomId}</a>
                        <button class="delete-room-btn" data-id="${roomId}" style="margin-left: 10px; color: red; background: none; border: none; cursor: pointer;">❌</button>
                    `;
                    roomsListElement.appendChild(li);
                });

                // Перепривязка слушателей после обновления HTML
                document.querySelectorAll('.delete-room-btn').forEach(btn => {
                    btn.addEventListener('click', async (e) => {
                        e.preventDefault();
                        const idToDelete = btn.getAttribute('data-id');
                        if (confirm(`Вы уверены, что хотите удалить комнату "${idToDelete}"? Она исчезнет у всех.`)) {
                            try {
                                await deleteDoc(doc(db, "all_rooms", idToDelete));
                                // Если удаляется текущая комната, перенаправляем на general
                                if (currentRoom === idToDelete) {
                                    window.location.search = ''; // Удалить параметр 'room' из URL
                                }
                            } catch (err) {
                                alert("Ошибка при удалении комнаты: " + err.message);
                            }
                        }
                    });
                });
            }, (error) => {
                console.error("Ошибка загрузки списка комнат:", error);
            });
        }
    } else {
        // Пользователь вышел или не авторизован: включаем режим авторизации, гасим чат
        document.body.classList.remove('chat-mode');
        document.body.classList.add('auth-mode');

        if (unsubscribeMessages) unsubscribeMessages();
        if (unsubscribeRooms) unsubscribeRooms();
        if (chatWindow) chatWindow.innerHTML = '';
    }
});

// ==========================================
// 3. ОТПРАВКА СООБЩЕНИЙ И ЗАГРУЗКА ФАЙЛОВ
// ==========================================
async function sendMessage() {
    const text = msgInput.value.trim();
    const username = userInput.value.trim() || "Аноним";
    if (!text && attachedFilesList.length === 0) return;

    try {
        sendBtn.disabled = true;
        if (previewZone && attachedFilesList.length > 0) {
            previewZone.className = 'state-loading';
            previewName.innerHTML = `🚀 Отправка в чат... (${attachedFilesList.length} шт.)`;
        }

        const messageData = {
            username: username,
            text: text,
            createdAt: serverTimestamp()
        };

        // Добавляем файлы, только если они были успешно загружены
        if (attachedFilesList.length > 0) {
            messageData.files = attachedFilesList.filter(f => f.fileUrl);
        }

        await addDoc(messagesRef, messageData);

        // Очищаем поля и состояние после успешной отправки
        msgInput.value = "";
        attachedFilesList = []; // Сброс списка прикрепленных файлов
        if (previewZone) {
            previewZone.style.display = 'none';
            previewZone.className = ''; // Сброс класса состояния
        }
        msgInput.placeholder = "Введите сообщение...";

    } catch (error) {
        console.error("Ошибка при отправке в Firebase:", error);
        alert("Не удалось отправить сообщение. Попробуйте позже.");
    } finally {
        sendBtn.disabled = false;
    }
}

// Функция загрузки файла с отображением прогресса
function uploadFileWithProgress(url, file, onProgress) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const formData = new FormData();
        formData.append('chatFile', file); // Имя поля 'chatFile' должно совпадать с тем, что ожидает сервер

        xhr.upload.addEventListener('progress', (event) => {
            if (event.lengthComputable) {
                const percent = Math.round((event.loaded / event.total) * 100);
                onProgress(percent);
            }
        });

        xhr.addEventListener('load', () => {
            let result;
            try {
                result = JSON.parse(xhr.responseText);
            } catch {
                reject(new Error('Сервер вернул не JSON'));
                return;
            }
            if (xhr.status < 200 || xhr.status >= 300) {
                reject(new Error(result.error || `Ошибка сервера: ${xhr.status}`));
                return;
            }
            resolve(result);
        });

        xhr.addEventListener('error', () => reject(new Error('Сетевая ошибка при загрузке файла')));
        xhr.addEventListener('abort', () => reject(new Error('Загрузка файла отменена')));

        xhr.open('POST', url);
        xhr.send(formData);
    });
}

// Обработка выбора файлов для загрузки
async function handleFileUpload(e) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.mp4', '.webm', '.ogg', '.mov', '.avi', '.mkv', '.zip', '.rar', '.7z', '.tar', '.gz', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv'];
    const forbiddenFiles = files.filter(file => {
        // Получаем расширение файла в нижнем регистре
        const ext = '.' + file.name.toLowerCase().split('.').pop();
        return !allowedExtensions.includes(ext);
    });

    // Сброс значения input, чтобы можно было выбрать тот же файл повторно
    fileInput.value = "";

    if (forbiddenFiles.length > 0) {
        if (previewZone) {
            previewZone.style.display = 'flex';
            previewZone.className = 'state-error';
            previewName.innerText = '❌ Запрещённый тип файла';
        }
        setTimeout(() => { // Скрываем сообщение об ошибке через некоторое время
            if (previewZone && previewZone.classList.contains('state-error')) {
                previewZone.style.display = 'none';
                previewZone.className = '';
            }
        }, 4000);
        return; // Прерываем загрузку
    }

    // Блокируем ввод и кнопку отправки пока идет загрузка
    msgInput.disabled = true;
    sendBtn.disabled = true;

    const progressContainer = document.getElementById('progress-container');
    const progressBar = document.getElementById('progress-bar');
    const progressText = document.getElementById('progress-text');

    if (previewZone) {
        previewZone.style.display = 'flex';
        previewZone.className = 'state-loading'; // Устанавливаем стиль загрузки
    }
    if (progressContainer) progressContainer.style.display = 'block';
    if (progressBar) progressBar.style.width = '0%';
    if (progressText) progressText.textContent = '0%';

    let serverUrl = '';
    try {
        // Получаем backendUrl из Firestore
        const configDoc = await getDoc(doc(db, "system", "config"));
        if (configDoc.exists() && configDoc.data().backendUrl) {
            // Убираем любые слеши в конце URL, чтобы избежать двойных слешей
            serverUrl = configDoc.data().backendUrl.replace(/\/+$/, '') + '/api/upload';
        } else {
            throw new Error("backendUrl не найден в Firestore.");
        }
    } catch (err) {
        console.error("Ошибка при получении backendUrl:", err);
        if (previewZone) previewZone.className = 'state-error';
        if (previewName) previewName.innerText = 'Ошибка сервера';
        setTimeout(() => {
            if (previewZone) previewZone.style.display = 'none';
        }, 3000);
        msgInput.disabled = false;
        sendBtn.disabled = false;
        return; // Выход, если не удалось получить URL сервера
    }

    const uploadedFilesTemp = []; // Временный массив для загруженных файлов
    try {
        for (let i = 0; i < files.length; i++) {
            const currentFile = files[i];
            // Передаем колбэк для обновления общего прогресса
            const uploadResult = await uploadFileWithProgress(serverUrl, currentFile, (filePercent) => {
                // Рассчитываем общий прогресс для всех файлов
                const overall = Math.round(((i / files.length) * 100) + (filePercent / files.length));
                if (progressBar) progressBar.style.width = overall + '%';
                if (progressText) progressText.textContent = overall + '%';
            });

            uploadedFilesTemp.push({
                fileUrl: uploadResult.fileUrl,
                fileType: uploadResult.fileType || currentFile.type || 'application/octet-stream', // fallback
                fileName: uploadResult.fileName || currentFile.name // fallback
            });
        }

        // После успешной загрузки всех файлов
        attachedFilesList = uploadedFilesTemp; // Обновляем глобальный список
        if (previewZone) previewZone.className = 'state-success'; // Меняем стиль на успешный
        if (previewName) previewName.innerHTML = `✅ Готово: <b>${attachedFilesList.length} файл(ов)</b>`;

        // Через некоторое время скрываем контейнер прогресса
        setTimeout(() => {
            if (progressContainer) progressContainer.style.display = 'none';
            // если были только файлы, то фокус можно перевести на ввод сообщения
            if (!msgInput.value.trim()) {
                msgInput.focus();
            }
        }, 1500);

    } catch (error) {
        console.error("Ошибка загрузки файла:", error);
        if (previewZone) previewZone.className = 'state-error'; // Меняем стиль на ошибку
        if (previewName) previewName.innerText = 'Ошибка загрузки';
        setTimeout(() => { // Убираем индикатор ошибки через 3 секунды
            if (previewZone && previewZone.classList.contains('state-error')) {
                previewZone.style.display = 'none';
                previewZone.className = '';
            }
        }, 3000);
    } finally {
        msgInput.disabled = false; // Снова разрешаем ввод сообщения
        sendBtn.disabled = false; // Снова разрешаем кнопку отправки
    }
}

// Привязка событий
sendBtn.addEventListener('click', sendMessage);
msgInput.addEventListener('keydown', (e) => {
    // Отправка по Enter, но с учетом Shift для переноса строки
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault(); // Предотвращаем стандартное поведение (перенос строки)
        sendMessage();
    }
});

if (fileInput) {
    fileInput.addEventListener('change', handleFileUpload);
}

// Кнопки управления комнатами
const createRoomBtn = document.getElementById('create-room-btn');
const shareRoomBtn = document.getElementById('share-room-btn');
const backToGeneralBtn = document.getElementById('back-to-general-btn');

// Показываем кнопки "Поделиться" и "Назад" только если текущая комната не "general"
if (currentRoom !== 'general') {
    if (shareRoomBtn) shareRoomBtn.style.display = 'inline-block';
    if (backToGeneralBtn) backToGeneralBtn.style.display = 'inline-block';
}

if (createRoomBtn) {
    createRoomBtn.addEventListener('click', async () => {
        // Генерируем уникальный ID для комнаты, например: rm-abc123xyz
        const randomRoomId = 'rm-' + Math.random().toString(36).substring(2, 9);
        try {
            await setDoc(doc(db, "all_rooms", randomRoomId), {
                createdAt: serverTimestamp() // Добавляем время создания
            });
            // Перенаправляем пользователя в новую комнату
            window.location.search = `?room=${randomRoomId}`;
        } catch (err) {
            alert("Ошибка при создании комнаты: " + err.message);
        }
    });
}

if (shareRoomBtn) {
    shareRoomBtn.addEventListener('click', () => {
        const roomLink = window.location.href; // Получаем текущий URL с параметром комнаты
        navigator.clipboard.writeText(roomLink)
            .then(() => alert(`Ссылка на комнату "${currentRoom}" скопирована!`))
            .catch(err => {
                console.error('Ошибка копирования ссылки: ', err);
                alert('Не удалось скопировать ссылку. Попробуйте вручную.');
            });
    });
}

if (backToGeneralBtn) {
    backToGeneralBtn.addEventListener('click', () => {
        window.location.search = ''; // Переход на главную страницу (general)
    });
}