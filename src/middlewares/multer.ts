import multer from 'multer';

const saveFileTemporally = multer({ 
  storage: multer.memoryStorage(), // Mantener archivos en memoria para acceder al buffer
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
  fileFilter: (req, file, cb) => {
    // Permitir solo imágenes
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos de imagen'));
    }
  }
});

export {saveFileTemporally};