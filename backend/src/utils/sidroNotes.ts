export const buildSidroAppointmentNotes = (
  source: string,
  clientNotes?: string | null
): string => {
  const normalizedNotes = clientNotes?.trim();
  return normalizedNotes
    ? `${source}\nSolicitud de la clienta: ${normalizedNotes}`
    : source;
};
