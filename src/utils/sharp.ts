import sharp from 'sharp';

export type CompressionLevel = 'high' | 'medium' | 'low';

interface CompressionOptions {
  width: number;
  quality: number;
}

const compressionSettings: Record<CompressionLevel, CompressionOptions> = {
  high: { width: 1200, quality: 80 },
  medium: { width: 800, quality: 60 },
  low: { width: 400, quality: 40 },
};

/**
 * Comprime y redimensiona una imagen buffer según el nivel de compresión.
 * @param buffer Buffer de la imagen original
 * @param level Nivel de compresión: 'high' | 'medium' | 'low' (por defecto: 'high')
 * @returns Buffer de la imagen comprimida
 */
export async function compressImage(
  buffer: Buffer,
  qualityLevel: CompressionLevel = 'high'
): Promise<Buffer> {
  const { width, quality } = compressionSettings[qualityLevel];
  return sharp(buffer)
    .resize({ width, withoutEnlargement: true })
    .webp({ quality })
    .toBuffer();
}
