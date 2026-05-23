// Вспомогательная функция защиты от XSS-атак
function escapeHtml(text) {
    return text ? text.replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;") : '';
}

// Импортируем модули локально из папки firebase
import { initializeApp } from "firebase/app";
import {
    getFirestore, collection, addDoc, query, orderBy, limit, onSnapshot,
    serverTimestamp, doc, setDoc, deleteDoc
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

console.log("ПроверкаProjectId:", firebaseConfig.projectId);

// Инициализация модулей
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);

// Логика комнат
const urlParams = new URLSearchParams(window.location.search);
const currentRoom = urlParams.get('room') || 'general';

// Селекторы элементов интерфейса
const roomNameElement = document.getElementById('room-name');
const chatWindow = document.getElementById('chat-window');
const msgInput = document.getElementById('message');
const userInput = document.getElementById('username');
const sendBtn = document.getElementById('send-btn');
const fileInput = document.getElementById('file-input');

// Элементы визуальной плашки файлов
const previewZone = document.getElementById('file-preview-zone');
const previewName = document.getElementById('file-preview-name');
const cancelFileBtn = document.getElementById('cancel-file-btn');

// Проверка наличия критических элементов
if (!chatWindow || !msgInput || !userInput || !sendBtn || !fileInput) {
    console.error('❌ ОШИБКА: Не найдены элементы!', {
        chatWindow, msgInput, userInput, sendBtn, fileInput
    });
    throw new Error('Критическая ошибка: элементы интерфейса не найдены');
}

// Устанавливаем название комнаты
if (roomNameElement) {
    roomNameElement.innerText = currentRoom;
}

// Глобальный массив для хранения списка успешно загруженных файлов перед отправкой
let attachedFilesList = [];

// Логика кнопки "Крестик" — полная отмена прикрепленных файлов
if (cancelFileBtn) {
    cancelFileBtn.addEventListener('click', () => {
        attachedFilesList = [];
        if (previewZone) previewZone.style.display = 'none';
    });
}

// Ссылка на коллекцию сообщений текущей комнаты
const messagesRef = collection(db, "rooms", currentRoom, "messages");

// СЛУШАТЕЛЬ ЧАТА В РЕАЛЬНОМ ВРЕМЕНИ
const q = query(messagesRef, orderBy("createdAt", "asc"), limit(200));
onSnapshot(q, (snapshot) => {
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

        // РЕНДЕРИНГ СОДЕРЖИМОГО (ТЕКСТ + МАССИВ ФАЙЛОВ)
        let contentHtml = '';
        if (data.text) {
            contentHtml += `<div class="text">${escapeHtml(data.text)}</div>`;
        }

        // Поддержка как новых массивов (data.files), так и старых одиночных записей (data.fileUrl)
        const filesArray = data.files || (data.fileUrl ? [{ fileUrl: data.fileUrl, fileType: data.fileType, fileName: 'Файл' }] : []);

        filesArray.forEach(file => {
            if (file.fileType.startsWith('image/')) {
                contentHtml += `<img src="${file.fileUrl}" alt="image" loading="lazy" style="max-width: 100%; border-radius: 8px; margin-top: 5px; display: block;">`;
            } else if (file.fileType.startsWith('video/')) {
                contentHtml += `<video src="${file.fileUrl}" controls style="max-width: 100%; border-radius: 8px; margin-top: 5px; display: block;"></video>`;
            } else {
                // Виджет для документов (PDF, DOCX, ZIP и т.д.) с кнопкой скачивания
                contentHtml += `
                    <div class="chat-doc-box" style="display: flex; align-items: center; background: #f1f5f9; padding: 8px 12px; border-radius: 6px; margin-top: 5px; border: 1px solid #e2e8f0;">
                        <span style="font-size: 24px; margin-right: 10px;">📄</span>
                        <div style="flex-grow: 1; min-width: 0; text-align: left;">
                            <div style="font-size: 13px; font-weight: 500; color: #1e293b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(file.fileName) || 'Документ'}</div>
                            <div style="font-size: 11px; color: #64748b;">Файл (${escapeHtml(file.fileType.split('/')[1] || 'bin')})</div>
                        </div>
                        <a href="${file.fileUrl}" target="_blank" download style="text-decoration: none; background: #007bff; color: white; padding: 4px 10px; border-radius: 4px; font-size: 12px; font-weight: bold; margin-left: 10px;">Скачать</a>
                    </div>
                `;
            }
        });

        chatWindow.innerHTML += `
            <div class="msg">
                <div class="user">${escapeHtml(data.username)}</div>
                ${contentHtml}
                <div class="time">${timeStr}</div>
            </div>
        `;
    });

    chatWindow.scrollTop = chatWindow.scrollHeight;
}, (error) => {
    console.error("❌ Ошибка Firestore: ", error);
    chatWindow.innerHTML = `<div style="padding: 20px; color: red;">Ошибка подключения: ${error.message}</div>`;
});

// МОДЕРНИЗИРОВАННАЯ ФУНКЦИЯ ОТПРАВКИ
async function sendMessage() {
    const text = msgInput.value.trim();
    const username = userInput.value.trim() || "Аноним";

    if (!text && attachedFilesList.length === 0) return;

    try {
        sendBtn.disabled = true;

        // Меняем статус плашки на отправку в облако Firestore
        if (previewZone && attachedFilesList.length > 0) {
            previewZone.style.background = "#e3f2fd"; // Синеватый оттенок
            previewName.innerHTML = `🚀 Отправка в чат... (${attachedFilesList.length} шт.)`;
        }

        const messageData = {
            username: username,
            text: text,
            createdAt: serverTimestamp()
        };

        // Если файлы прикреплены, добавляем их массивом
        if (attachedFilesList.length > 0) {
            // Фильтруем файлы без URL (защита от undefined в Firestore)
            const validFiles = attachedFilesList.filter(f => f.fileUrl);
            if (validFiles.length > 0) {
                messageData.files = validFiles;
            }
            console.log("📎 Прикреплённые файлы:", JSON.stringify(validFiles));
        }

        await addDoc(messagesRef, messageData);

        // Полная очистка полей после успешной публикации
        msgInput.value = "";
        attachedFilesList = [];
        if (previewZone) {
            previewZone.style.display = 'none';
            previewZone.style.background = "#eef2f3"; // Сброс к дефолту
        }
        msgInput.placeholder = "Введите сообщение...";

    } catch (error) {
        console.error("Ошибка при отправке в Firebase:", error);
        if (previewZone) {
            previewZone.style.background = "#ffebee"; // Красный цвет ошибки
            previewName.innerHTML = `❌ Ошибка публикации: ${error.message}`;
        } else {
            alert("Не удалось отправить сообщение: " + error.message);
        }
    } finally {
        sendBtn.disabled = false;
    }
}

// ФУНКЦИЯ ЗАГРУЗКИ ФАЙЛОВ НА СОБСТВЕННЫЙ СЕРВЕР
async function handleFileUpload(e) {
    // ВАЖНО: копируем FileList в обычный массив ДО очистки input
    const files = Array.from(e.target.files || []);

    if (files.length === 0) return;

    // Теперь можно очищать input, массив files уже сохранён
    fileInput.value = "";

    msgInput.disabled = true;
    sendBtn.disabled = true;

    if (previewZone) {
        previewZone.style.display = 'block';
        previewZone.style.background = "#eef2f3";
    }

    if (previewName) {
        previewName.innerText = `⏳ Отправка на ваш сервер: 0 из ${files.length}...`;
    }

    const cleanServerUrl = new URL('/api/upload', import.meta.env.VITE_FILE_SERVER_URL).href;
    const uploadedFilesTemp = [];

    try {
        for (let i = 0; i < files.length; i++) {
            const currentFile = files[i];

            if (previewName) {
                previewName.innerText = `⏳ Отправка на ваш сервер: ${i + 1} из ${files.length} (${currentFile.name})...`;
            }

            const formData = new FormData();
            formData.append('chatFile', currentFile);

            const response = await fetch(cleanServerUrl, {
                method: 'POST',
                body: formData,
            });

            const rawText = await response.text();

            let result;
            try {
                result = JSON.parse(rawText);
            } catch {
                throw new Error(`Сервер вернул не JSON: ${rawText.slice(0, 200)}`);
            }

            console.log("📦 Ответ сервера:", result);

            if (!response.ok) {
                throw new Error(result.error || `Не удалось загрузить файл ${currentFile.name}`);
            }

            if (!result.fileUrl) {
                throw new Error(`Сервер не вернул fileUrl для файла ${currentFile.name}`);
            }

            uploadedFilesTemp.push({
                fileUrl: result.fileUrl,
                fileType: result.fileType || currentFile.type || 'application/octet-stream',
                fileName: result.fileName || currentFile.name
            });
        }

        attachedFilesList = uploadedFilesTemp;

        if (previewZone) {
            previewZone.style.background = "#e8f5e9";
        }

        if (previewName) {
            previewName.innerHTML = `✅ Файлы на сервере! Готово к отправке: <b>${attachedFilesList.length} шт.</b>`;
        }

        console.log("✅ Файлы готовы к отправке в Firestore:", attachedFilesList);

        msgInput.focus();

    } catch (error) {
        console.error("Ошибка загрузки:", error);

        attachedFilesList = [];

        if (previewZone) {
            previewZone.style.background = "#ffebee";
        }

        if (previewName) {
            previewName.innerText = `❌ Ошибка диска: ${error.message}`;
        }
    } finally {
        msgInput.disabled = false;
        sendBtn.disabled = false;
    }
}

// Привязка событий управления вводом
sendBtn.addEventListener('click', sendMessage);
msgInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        sendMessage();
    }
});
if (fileInput) {
    fileInput.addEventListener('change', handleFileUpload);
}
console.log("✅ Чат инициализирован, комната:", currentRoom);

// ==========================================
// ЛОГИКА УПРАВЛЕНИЯ ПРИВАТНЫМИ КОМНАТАМИ
// ==========================================
const createRoomBtn = document.getElementById('create-room-btn');
const shareRoomBtn = document.getElementById('share-room-btn');
const backToGeneralBtn = document.getElementById('back-to-general-btn');
const roomsListElement = document.getElementById('rooms-list');

if (currentRoom !== 'general') {
    if (shareRoomBtn) shareRoomBtn.style.display = 'inline-block';
    if (backToGeneralBtn) backToGeneralBtn.style.display = 'inline-block';
}

if (createRoomBtn) {
    createRoomBtn.addEventListener('click', async () => {
        const randomRoomId = 'rm-' + Math.random().toString(16).substring(2, 10);
        try {
            await setDoc(doc(db, "all_rooms", randomRoomId), {
                createdAt: serverTimestamp()
            });
            window.location.search = `?room=${randomRoomId}`;
        }
        catch (e) {
            console.error("Ошибка при регистрации комнаты в базе:", e);
            alert("Не удалось создать комнату в базе данных: " + e.message);
        }
    });
}

if (shareRoomBtn) {
    shareRoomBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(window.location.href)
            .then(() => alert('Ссылка на приватную комнату скопирована в буфер обмена!'))
            .catch(err => console.error('Не удалось скопировать:', err));
    });
}

if (backToGeneralBtn) {
    backToGeneralBtn.addEventListener('click', () => {
        window.location.search = '';
    });
}

if (roomsListElement) {
    const roomsQuery = query(collection(db, "all_rooms"), orderBy("createdAt", "desc"));
    onSnapshot(roomsQuery, (snapshot) => {
        roomsListElement.innerHTML = `<li><a href="${window.location.pathname}">🌐 general</a></li>`;

        snapshot.forEach((roomDoc) => {
            const roomId = roomDoc.id;
            const li = document.createElement('li');
            li.innerHTML = `<a href="?room=${roomId}">🔑 ${roomId}</a> 
                <button class="delete-room-btn" data-id="${roomId}" style="margin-left: 10px; color: red; background: none; border: none; cursor: pointer;">❌</button>`;
            roomsListElement.appendChild(li);
        });

        document.querySelectorAll('.delete-room-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                const idToDelete = btn.getAttribute('data-id');
                if (confirm(`Вы уверены, что хотите удалить комнату ${idToDelete}? Она исчезнет у всех.`)) {
                    try {
                        await deleteDoc(doc(db, "all_rooms", idToDelete));
                        if (currentRoom === idToDelete) {
                            window.location.search = '';
                        }
                    } catch (err) {
                        alert("Ошибка при удалении комнаты: " + err.message);
                    }
                }
            });
        });
    });
}