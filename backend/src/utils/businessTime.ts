export const BUSINESS_TIME_ZONE = 'America/Guayaquil';
export const BUSINESS_UTC_OFFSET = '-05:00';

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_ONLY = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;
const ABSOLUTE_INSTANT = /(Z|[+-]\d{2}:\d{2})$/i;

export const normalizeDateOnly = (value: unknown): string => {
    if (typeof value === 'string') {
        const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
        if (match) return match[1];
    }
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
    }
    throw new Error('Fecha local de Ecuador invalida');
};

export const timeToMinutes = (value: unknown): number => {
    if (typeof value !== 'string') throw new Error('Hora local de Ecuador invalida');
    const match = value.match(TIME_ONLY);
    if (!match) throw new Error('Hora local de Ecuador invalida');
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = Number(match[3] || 0);
    if (hours > 23 || minutes > 59 || seconds > 59) throw new Error('Hora local de Ecuador invalida');
    return hours * 60 + minutes + seconds / 60;
};

export const minutesToTime = (totalMinutes: number): string => {
    const normalized = ((Math.trunc(totalMinutes) % 1440) + 1440) % 1440;
    return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
};

export const addDays = (dateStr: string, days: number): string => {
    const match = dateStr.match(DATE_ONLY);
    if (!match) throw new Error('Fecha local de Ecuador invalida');
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
};

export const localMinutesToInstant = (dateStr: string, totalMinutes: number): string => {
    const dayOffset = Math.floor(totalMinutes / 1440);
    const localDate = addDays(dateStr, dayOffset);
    const localTime = minutesToTime(totalMinutes);
    return new Date(`${localDate}T${localTime}:00${BUSINESS_UTC_OFFSET}`).toISOString();
};

export const assertAbsoluteInterval = (start: string, end: string): void => {
    if (!ABSOLUTE_INSTANT.test(start) || !ABSOLUTE_INSTANT.test(end)) {
        throw new Error('Las fechas de la cita deben incluir zona horaria');
    }
    const startMs = Date.parse(start);
    const endMs = Date.parse(end);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
        throw new Error('El intervalo de la cita es invalido');
    }
};

export const dayOfWeekForBusinessDate = (dateStr: string): number => {
    const match = dateStr.match(DATE_ONLY);
    if (!match) throw new Error('Fecha local de Ecuador invalida');
    return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay();
};

export const getBusinessNow = (now = new Date()): { date: string; minute: number } => {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: BUSINESS_TIME_ZONE,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(now);
    const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || '';
    const date = `${read('year')}-${read('month')}-${read('day')}`;
    return { date, minute: Number(read('hour')) * 60 + Number(read('minute')) };
};

export const getBusinessDateRange = (from: unknown, to: unknown = from): { start: string; end: string } => {
    const startDate = normalizeDateOnly(from);
    const endDate = normalizeDateOnly(to);
    if (endDate < startDate) throw new Error('El rango de fechas es invalido');
    return {
        start: localMinutesToInstant(startDate, 0),
        end: localMinutesToInstant(addDays(endDate, 1), 0)
    };
};
