// Импортируем модули локально из папки firebase
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
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

// ФУНКЦИЯ ОТПРАВКИ ТЕКСТА
async function sendMessage() {
    const text = msgInput.value.trim();
    const username = userInput.value.trim() || "Аноним";
    
    if (!text) return;
    
    const originalText = text;
    msgInput.value = '';
    sendBtn.disabled = true;
    
    try {
        await addDoc(messagesRef, {
            username: username,
            text: text,
            createdAt: serverTimestamp()
        });
    } catch (error) {
        console.error("❌ Ошибка отправки:", error);
        alert("Ошибка отправки: " + error.message);
        msgInput.value = originalText;
    } finally {
        sendBtn.disabled = false;
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

// Вспомогательная функция
function escapeHtml(text) {
    return text ? text.replace(/&/g, "&amp;")
                     .replace(/</g, "&lt;")
                     .replace(/>/g, "&gt;") : '';
}

console.log("✅ Чат инициализирован, комната:", currentRoom);