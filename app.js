// Вспомогательная функция
function escapeHtml(text) {
    return text ? text.replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;") : '';
}

// Импортируем модули локально из папки firebase
import { initializeApp } from "firebase/app";
import {
    getFirestore, collection, addDoc, query, orderBy, limit, onSnapshot, serverTimestamp,
    doc, setDoc, deleteDoc
} from "firebase/firestore";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";

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

// Проверка наличия элементов
if (!chatWindow || !msgInput || !userInput || !sendBtn || !fileInput) {
    console.error('❌ ОШИБКА: Не найдены элементы!', {
        chatWindow,
        msgInput,
        userInput,
        sendBtn,
        fileInput
    });
    throw new Error('Критическая ошибка: элементы интерфейса не найдены');
}

// Устанавливаем название комнаты
if (roomNameElement) {
    roomNameElement.innerText = currentRoom;
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
        
        let contentHtml = `<div class="text">${escapeHtml(data.text)}</div>`;
        
        // Если есть прикрепленный файл
        if (data.fileUrl && data.fileType) {
            if (data.fileType.startsWith('image/')) {
                contentHtml = `<img src="${data.fileUrl}" alt="image" loading="lazy">`;
            } else if (data.fileType.startsWith('video/')) {
                contentHtml = `<video src="${data.fileUrl}" controls></video>`;
            }
        }
        
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

// Примерная структура вашей функции отправки
async function sendMessage() {
    const text = msgInput.value.trim();
    const username = userInput.value.trim() || "Аноним";

    // Если поле сообщения пустое — ничего не делаем
    if (!text) return;

    try {
        sendBtn.disabled = true; // Блокируем именно вашу кнопку sendBtn

        // Отправляем в коллекцию текущей комнаты (messagesRef)
        await addDoc(messagesRef, {
            username: username,
            text: text,
            createdAt: serverTimestamp() // Используем верное поле из вашего слушателя
        });

        msgInput.value = ""; // Очищаем ваше текстовое поле
    } catch (error) {
        console.error("Ошибка при отправке в Firebase:", error);
        alert("Не удалось отправить сообщение: " + error.message);
    } finally {
        sendBtn.disabled = false; // Всегда возвращаем кнопку в рабочее состояние!
    }
}


// ФУНКЦИЯ ЗАГРУЗКИ МЕДИАФАЙЛА ЧЕРЕЗ СКРЕПКУ
async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    // Проверка размера (макс 10 МБ)
    if (file.size > 10 * 1024 * 1024) {
        alert("Файл слишком большой! Максимум 10 МБ");
        fileInput.value = "";
        return;
    }
    
    const username = userInput.value.trim() || "Аноним";
    const folder = file.type.startsWith('image/') ? 'foto' : 'video';
    
    // Создаем ссылку на будущий файл в облаке
    const fileRef = ref(storage, `${currentRoom}/${folder}/${Date.now()}_${file.name}`);
    
    try {
        msgInput.value = "📤 Загружаю файл...";
        msgInput.disabled = true;
        sendBtn.disabled = true;
        
        console.log("⬆️ Загрузка файла:", file.name);
        
        // Загружаем байты файла в Storage
        const snapshot = await uploadBytes(fileRef, file);
        console.log("✅ Файл загружен в Storage");
        
        // Получаем прямую вечную ссылку
        const downloadUrl = await getDownloadURL(snapshot.ref);
        console.log("✅ Получена ссылка:", downloadUrl);
        
        // Записываем в базу данных чата
        await addDoc(messagesRef, {
            username: username,
            text: `Отправил файл: ${file.name}`,
            fileUrl: downloadUrl,
            fileType: file.type,
            createdAt: serverTimestamp()
        });
        
        console.log("✅ Сообщение с файлом добавлено в Firestore");
        msgInput.value = "";
    } catch (error) {
        console.error("❌ Ошибка Storage:", error);
        alert("Ошибка загрузки файла: " + error.message);
        msgInput.value = "";
    } finally {
        msgInput.disabled = false;
        sendBtn.disabled = false;
        fileInput.value = "";
    }
}

// Привязка событий
sendBtn.addEventListener('click', sendMessage);

msgInput.addEventListener('keydown', (e) => { 
    if (e.key === 'Enter') {
        e.preventDefault(); 
        sendMessage(); 
    } 
});

fileInput.addEventListener('change', handleFileUpload);

console.log("✅ Чат инициализирован, комната:", currentRoom);

// ==========================================
// ЛОГИКА УПРАВЛЕНИЯ ПРИВАТНЫМИ КОМНАТАМИ
// ==========================================

// Находим кнопки и контейнер для списка в DOM
const createRoomBtn = document.getElementById('create-room-btn');
const shareRoomBtn = document.getElementById('share-room-btn');
const backToGeneralBtn = document.getElementById('back-to-general-btn');
const roomsListElement = document.getElementById('rooms-list');

// Если мы находимся в приватной комнате — показываем кнопки управления
if (currentRoom !== 'general') {
    if (shareRoomBtn) shareRoomBtn.style.display = 'inline-block';
    if (backToGeneralBtn) backToGeneralBtn.style.display = 'inline-block';
}

// 1. Создание приватной комнаты с регистрацией в Firestore
if (createRoomBtn) {
    createRoomBtn.addEventListener('click', async () => {
        // Генерируем уникальный хэш для комнаты
        const randomRoomId = 'rm-' + Math.random().toString(16).substring(2, 10);

        try {
            // Создаем пустой документ в коллекции all_rooms на сервере, чтобы зафиксировать её существование
            await setDoc(doc(db, "all_rooms", randomRoomId), {
                createdAt: serverTimestamp()
            });
            // Перенаправляем пользователя в созданную комнату
            window.location.search = `?room=${randomRoomId}`;
        } catch (e) {
            console.error("Ошибка при регистрации комнаты в базе:", e);
            alert("Не удалось создать комнату в базе данных: " + e.message);
        }
    });
}

// 2. Логика кнопки "Скопировать ссылку"
if (shareRoomBtn) {
    shareRoomBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(window.location.href)
            .then(() => alert('Ссылка на приватную комнату скопирована в буфер обмена!'))
            .catch(err => console.error('Не удалось скопировать:', err));
    });
}

// 3. Логика кнопки "В общий чат"
if (backToGeneralBtn) {
    backToGeneralBtn.addEventListener('click', () => {
        window.location.search = ''; // Очищаем параметры, что возвращает в general
    });
}

// 4. Слушатель списка всех приватных комнат в реальном времени
if (roomsListElement) {
    const roomsQuery = query(collection(db, "all_rooms"), orderBy("createdAt", "desc"));

    onSnapshot(roomsQuery, (snapshot) => {
        // Сбрасываем список и всегда делаем общую комнату general первой в списке
        roomsListElement.innerHTML = `<li><a href="${window.location.pathname}">🌐 general</a></li>`;

        snapshot.forEach((roomDoc) => {
            const roomId = roomDoc.id;

            // Создаем элемент списка с кнопкой удаления
            const li = document.createElement('li');
            li.innerHTML = `
                <a href="?room=${roomId}">🔑 ${roomId}</a>
                <button class="delete-room-btn" data-id="${roomId}" style="margin-left: 10px; color: red; background: none; border: none; cursor: pointer;">❌</button>
            `;
            roomsListElement.appendChild(li);
        });

        // Вешаем событие удаления на все созданные крестики
        document.querySelectorAll('.delete-room-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.preventDefault(); // Защита от случайного перехода по ссылке
                const idToDelete = btn.getAttribute('data-id');

                if (confirm(`Вы уверены, что хотите удалить комнату ${idToDelete}? Она исчезнет у всех.`)) {
                    try {
                        // Удаляем запись о комнате из коллекции all_rooms
                        await deleteDoc(doc(db, "all_rooms", idToDelete));

                        // Если пользователь в этот момент находился внутри удаляемой комнаты — выкидываем его в general
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