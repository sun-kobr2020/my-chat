const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = 5000;

app.use(express.json());

// ============================
// CORS (единый, без дублей)
// ============================
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Requested-With',
        'Accept',
        'Origin',
        'Bypass-Tunnel-Reminder'
    ]
}));

// Ручной preflight на всякий случай (для туннелей типа Pinggy)
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, X-Requested-With, Accept, Origin, Bypass-Tunnel-Reminder'
    );
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// ============================
// Базовая папка хранения
// ============================
const baseUploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(baseUploadDir)) {
    fs.mkdirSync(baseUploadDir, { recursive: true });
}

// Раздача статики ДО любых лимитеров
app.use('/uploads', express.static(baseUploadDir));

// ============================
// RATE LIMIT (увеличен под мультизагрузку)
// ============================
const uploadLimiter = rateLimit({
    windowMs: 2 * 60 * 1000, // 2 минуты
    max: 50,                 // 50 файлов за 2 минуты (раньше было 5 — это и ломало мультизагрузку!)
    message: { error: 'Слишком много загрузок. Подождите 2 минуты.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// ============================
// Определение подпапки по mimetype
// ============================
function getSubFolder(mimetype, originalName = '') {
    if (mimetype.startsWith('image/')) return 'images';
    if (mimetype.startsWith('video/')) return 'videos';

    const allowedDocs = [
        'application/pdf',
        'application/zip',
        'application/x-zip-compressed',
        'application/x-rar-compressed',
        'application/vnd.rar',
        'application/x-rar',
        'application/rar',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    ];

    // Расширения как запасной вариант когда браузер даёт octet-stream
    const allowedExtsByExt = [
        '.zip', '.rar', '.7z', '.tar', '.gz',
        '.pdf',
        '.doc', '.docx',
        '.xls', '.xlsx',
        '.ppt', '.pptx',
        '.txt', '.csv'
    ];

    const ext = '.' + originalName.split('.').pop().toLowerCase();

    if (
        mimetype.startsWith('text/') ||
        allowedDocs.includes(mimetype) ||
        // Если MIME = octet-stream но расширение разрешено
        (mimetype === 'application/octet-stream' && allowedExtsByExt.includes(ext))
    ) {
        return 'documents';
    }

    return null;
}

// ============================
// Multer storage
// ============================
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const subFolder = getSubFolder(file.mimetype, file.originalname);
        const targetDir = path.join(baseUploadDir, subFolder);
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }
        cb(null, targetDir);
    },
    filename: (req, file, cb) => {
        // Корректно декодируем имя (Multer присылает в latin1)
        const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
        const ext = path.extname(originalName);
        const safeName = path.basename(originalName, ext)
            .replace(/[^a-zA-Z0-9а-яА-Я._-]/g, '')
            .substring(0, 30) || 'file';
        cb(null, `${Date.now()}_${safeName}${ext}`);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 300 * 1024 * 1024 // абсолютный потолок 300 МБ
    },
    fileFilter: (req, file, cb) => {
        const folder = getSubFolder(file.mimetype, file.originalname);
        const sizeInBytes = parseInt(req.headers['content-length']) || 0;

        if (!folder) {
            return cb(new Error('Запрещенный тип файла! Разрешены только фото, видео, архивы и документы.'));
        }
        if (folder === 'documents' && sizeInBytes > 50 * 1024 * 1024) {
            return cb(new Error('Документы не должны превышать 50 МБ.'));
        }
        if (folder === 'images' && sizeInBytes > 50 * 1024 * 1024) {
            return cb(new Error('Фотографии не должны превышать 50 МБ.'));
        }
        cb(null, true);
    }
});

const uploadSingle = upload.single('chatFile');

// ============================
// Маршрут загрузки
// ============================
app.post('/api/upload', uploadLimiter, (req, res) => {
    uploadSingle(req, res, function (err) {
        if (err instanceof multer.MulterError) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ error: 'Файл слишком большой! Максимум 300 МБ.' });
            }
            return res.status(400).json({ error: err.message });
        } else if (err) {
            return res.status(400).json({ error: err.message });
        }

        if (!req.file) {
            return res.status(400).json({ error: 'Файл не выбран' });
        }

        const subFolder = getSubFolder(req.file.mimetype, req.file.originalname);
        const protocol = req.headers['x-forwarded-proto'] || 'http';
        const host = req.headers['x-forwarded-host'] || req.get('host');
        const fileUrl = `${protocol}://${host}/uploads/${subFolder}/${req.file.filename}`;

        res.json({
            fileUrl: fileUrl,
            fileType: req.file.mimetype
        });
    });
});

// ============================
// Глобальный перехватчик ошибок
// ============================
app.use((err, req, res, next) => {
    console.error('Критическая ошибка сервера:', err.message);
    if (!res.headersSent) {
        res.status(500).json({ error: 'Внутренняя ошибка сервера хранилища.' });
    }
});

// Защита Node от падения при обрыве соединения
process.on('uncaughtException', (err) => {
    console.error('uncaughtException:', err.message);
});
process.on('unhandledRejection', (err) => {
    console.error('unhandledRejection:', err);
});

const localtunnel = require('localtunnel');
const admin = require('firebase-admin');

// 1. Инициализация Firebase Admin (нужно скачать JSON-ключ из настроек Firebase Console -> Service Accounts)
const serviceAccount = require('./firebase-key.json');
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// 2. Запуск сервера и туннеля
const { exec } = require('child_process');

// 2. Запуск сервера и автоматического SSH-туннеля localhost.run
app.listen(PORT, '0.0.0.0', () => {
    console.log(`=== Локальный сервер запущен на порту ${PORT} ===`);

    try {
        // Запускаем ssh-туннель программно (подставляем ваш PORT)
        const sshProcess = exec(`ssh -R 80:127.0.0.1:${PORT} nokey@localhost.run`);

        sshProcess.stdout.on('data', async (data) => {
            // Ищем регулярным выражением ссылку lhr.life в выводе терминала
            const match = data.match(/https:\/\/[a-z0-9]+\.lhr\.life/);

            if (match) {
                const serverUrl = match[0];
                console.log(`🌍 НОВЫЙ АДРЕС СЕРВЕРА (localhost.run): ${serverUrl}`);

                // Записываем этот адрес в Firebase Firestore!
                await db.collection('system').doc('config').set({
                    backendUrl: serverUrl,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
                console.log(`✅ Адрес успешно обновлен в базе данных!`);
            }
        });

        sshProcess.stderr.on('data', (data) => {
            // Если соединение разрывается или запрашивает Host Key
            if (data.includes('Are you sure you want to continue connecting')) {
                sshProcess.stdin.write('yes\n');
            }
        });

        process.on('exit', () => sshProcess.kill());

    } catch (err) {
        console.error('Ошибка создания SSH-туннеля:', err);
    }
});
