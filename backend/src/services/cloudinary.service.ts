import { createHash } from 'node:crypto';

interface CloudinaryConfig {
    cloudName: string;
    apiKey: string;
    apiSecret: string;
    folder: string;
}

interface UploadSignature {
    upload_url: string;
    cloud_name: string;
    api_key: string;
    timestamp: number;
    signature: string;
    folder: string;
    public_id: string;
    overwrite: 'true';
    invalidate: 'true';
    allowed_formats: 'jpg,png,webp';
}

const getConfig = (): CloudinaryConfig => {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim() || '';
    const apiKey = process.env.CLOUDINARY_API_KEY?.trim() || '';
    const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim() || '';
    const folder = process.env.CLOUDINARY_SIDRO_FOLDER?.trim() || 'sidro/services';

    if (!cloudName || !apiKey || !apiSecret) {
        throw new Error('Cloudinary no está configurado en el servidor');
    }

    return { cloudName, apiKey, apiSecret, folder };
};

const sign = (params: Record<string, string | number>, apiSecret: string): string => {
    const payload = Object.keys(params)
        .sort()
        .map((key) => `${key}=${params[key]}`)
        .join('&');
    return createHash('sha1').update(`${payload}${apiSecret}`).digest('hex');
};

export class CloudinaryService {
    static isConfigured(): boolean {
        return Boolean(
            process.env.CLOUDINARY_CLOUD_NAME?.trim() &&
            process.env.CLOUDINARY_API_KEY?.trim() &&
            process.env.CLOUDINARY_API_SECRET?.trim()
        );
    }

    static expectedPublicId(serviceId: string): string {
        const folder = process.env.CLOUDINARY_SIDRO_FOLDER?.trim() || 'sidro/services';
        return `${folder}/${serviceId}`;
    }

    static createServiceUploadSignature(serviceId: string): UploadSignature {
        const config = getConfig();
        const timestamp = Math.floor(Date.now() / 1000);
        const params = {
            allowed_formats: 'jpg,png,webp',
            folder: config.folder,
            invalidate: 'true',
            overwrite: 'true',
            public_id: serviceId,
            timestamp
        };

        return {
            upload_url: `https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudName)}/image/upload`,
            cloud_name: config.cloudName,
            api_key: config.apiKey,
            timestamp,
            signature: sign(params, config.apiSecret),
            folder: config.folder,
            public_id: serviceId,
            overwrite: 'true',
            invalidate: 'true',
            allowed_formats: 'jpg,png,webp'
        };
    }

    static validateServiceImageReference(serviceId: string, imageUrl: string, publicId: string): void {
        const config = getConfig();
        const expectedPublicId = `${config.folder}/${serviceId}`;
        if (publicId !== expectedPublicId) {
            throw new Error('La imagen no corresponde al servicio seleccionado');
        }

        let parsedUrl: URL;
        try {
            parsedUrl = new URL(imageUrl);
        } catch {
            throw new Error('La URL de imagen recibida no es válida');
        }

        const expectedPathPrefix = `/${config.cloudName}/image/upload/`;
        if (parsedUrl.protocol !== 'https:' || parsedUrl.hostname !== 'res.cloudinary.com' ||
            !parsedUrl.pathname.startsWith(expectedPathPrefix)) {
            throw new Error('La imagen debe proceder del Cloudinary configurado para SIDRO');
        }
    }

    static async destroyServiceImage(publicId: string): Promise<void> {
        const config = getConfig();
        const timestamp = Math.floor(Date.now() / 1000);
        const params = { invalidate: 'true', public_id: publicId, timestamp };
        const body = new URLSearchParams({
            ...Object.fromEntries(Object.entries(params).map(([key, value]) => [key, String(value)])),
            api_key: config.apiKey,
            signature: sign(params, config.apiSecret)
        });
        const response = await fetch(
            `https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudName)}/image/destroy`,
            { method: 'POST', body }
        );
        const result = await response.json() as { result?: string; error?: { message?: string } };
        if (!response.ok || !['ok', 'not found'].includes(result.result || '')) {
            throw new Error(result.error?.message || 'Cloudinary no pudo eliminar la imagen');
        }
    }
}
