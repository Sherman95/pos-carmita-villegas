import { Request, Response } from 'express';
import { google } from 'googleapis';
import path from 'path';
import pool from '../database/db';

export const getGoogleSyncStatus = async (req: Request, res: Response) => {
    try {
        const { rows } = await pool.query(`SELECT config_value FROM business_config WHERE config_key = 'google_calendar_id'`);
        const calendarId = rows.length > 0 ? rows[0].config_value : '';
        res.status(200).json({ isConnected: !!calendarId, calendarId });
    } catch (error) {
        console.error('Error verificando estado de Google Sync:', error);
        res.status(500).json({ error: 'Error verificando estado' });
    }
};

export const updateCalendarId = async (req: Request, res: Response) => {
    const { calendarId } = req.body;
    try {
        if (!calendarId) {
             await pool.query(`DELETE FROM business_config WHERE config_key = 'google_calendar_id'`);
             return res.status(200).json({ success: true, message: 'Desconectado' });
        }

        // Buscar el archivo en varias posibles rutas (local y Render secret files)
        const possiblePaths = [
            process.env.GOOGLE_CREDENTIALS_PATH,
            path.join(__dirname, '../../google-credentials.json'),
            '/etc/secrets/google-credentials.json'
        ];
        
        const keyFile = possiblePaths.find(p => p && require('fs').existsSync(p));

        if (!keyFile) {
            throw new Error('Archivo de credenciales (google-credentials.json) no encontrado en el servidor.');
        }

        const auth = new google.auth.GoogleAuth({
            keyFile: keyFile,
            scopes: ['https://www.googleapis.com/auth/calendar.events'],
        });
        const calendar = google.calendar({ version: 'v3', auth });
        
        // Intentar leer el calendario para ver si tenemos permisos
        await calendar.calendars.get({ calendarId });

        // Si funciona, lo guardamos
        await pool.query(
            `INSERT INTO business_config (config_key, config_value) 
             VALUES ('google_calendar_id', $1) 
             ON CONFLICT (config_key) DO UPDATE SET config_value = $1, updated_at = NOW()`,
            [calendarId]
        );

        res.status(200).json({ success: true, message: 'Calendario vinculado exitosamente' });
    } catch (error: any) {
        console.error('Error vinculando calendario:', error.message);
        res.status(400).json({ error: 'No se pudo vincular el calendario. Asegúrate de haberlo compartido con el correo de servicio.' });
    }
};
