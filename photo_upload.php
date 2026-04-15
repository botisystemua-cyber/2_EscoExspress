<?php
/**
 * photo_upload.php
 * Простий завантажувач фото для EscoExpress CRM (перевірка посилок)
 *
 * Розмістити на: https://botisystem.com/Esco_Express/photo_upload.php
 * Поряд створити папку:  /Esco_Express/uploads/  (chmod 0755 або 0775)
 *
 * POST (multipart/form-data):
 *   file     — файл фото (обов'язково)
 *   pkg_id   — ID посилки (необов'язково, для префіксу імені)
 *
 * Відповідь JSON:
 *   { "ok": true,  "url": "https://botisystem.com/.../uploads/<file>" }
 *   { "ok": false, "error": "..." }
 */

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    echo json_encode(['ok' => false, 'error' => 'Only POST allowed']);
    exit;
}

if (!isset($_FILES['file'])) {
    echo json_encode(['ok' => false, 'error' => 'Файл не передано (поле "file")']);
    exit;
}

$file = $_FILES['file'];

if ($file['error'] !== UPLOAD_ERR_OK) {
    echo json_encode(['ok' => false, 'error' => 'Помилка завантаження: код ' . $file['error']]);
    exit;
}

// Ліміт розміру — 10 МБ
$maxSize = 10 * 1024 * 1024;
if ($file['size'] > $maxSize) {
    echo json_encode(['ok' => false, 'error' => 'Файл більший за 10 МБ']);
    exit;
}

// Перевірка MIME-типу
$allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
$finfo = finfo_open(FILEINFO_MIME_TYPE);
$mime = finfo_file($finfo, $file['tmp_name']);
finfo_close($finfo);

if (!in_array($mime, $allowedMimes, true)) {
    echo json_encode(['ok' => false, 'error' => 'Непідтримуваний тип: ' . $mime]);
    exit;
}

// Визначити розширення з MIME
$extMap = [
    'image/jpeg' => 'jpg',
    'image/png'  => 'png',
    'image/webp' => 'webp',
    'image/heic' => 'heic',
    'image/heif' => 'heif',
];
$ext = $extMap[$mime];

// Папка uploads/ поряд з цим скриптом
$uploadDir = __DIR__ . '/uploads';
if (!is_dir($uploadDir)) {
    if (!mkdir($uploadDir, 0755, true)) {
        echo json_encode(['ok' => false, 'error' => 'Не вдалось створити папку uploads/']);
        exit;
    }
}

// Унікальне ім'я: [pkg_id_]YYYYMMDD_HHMMSS_<rand>.<ext>
$pkgId = isset($_POST['pkg_id']) ? preg_replace('/[^A-Za-z0-9_\-]/', '', $_POST['pkg_id']) : '';
$prefix = $pkgId ? $pkgId . '_' : '';
$filename = $prefix . date('Ymd_His') . '_' . bin2hex(random_bytes(4)) . '.' . $ext;
$targetPath = $uploadDir . '/' . $filename;

if (!move_uploaded_file($file['tmp_name'], $targetPath)) {
    echo json_encode(['ok' => false, 'error' => 'Не вдалось зберегти файл']);
    exit;
}

// Зробити публічним
@chmod($targetPath, 0644);

// Зібрати URL
$scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
$host = $_SERVER['HTTP_HOST'];
$scriptDir = rtrim(dirname($_SERVER['SCRIPT_NAME']), '/');
$url = $scheme . '://' . $host . $scriptDir . '/uploads/' . $filename;

echo json_encode([
    'ok'       => true,
    'url'      => $url,
    'filename' => $filename,
    'size'     => $file['size'],
    'mime'     => $mime,
]);
