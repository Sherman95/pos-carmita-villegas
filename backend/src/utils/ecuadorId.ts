export type EcuadorDocumentType =
  | 'CEDULA'
  | 'RUC_NATURAL'
  | 'RUC_PUBLICO'
  | 'RUC_JURIDICO'
  | 'RUC_OTRO';

export type EcuadorDocumentVerificationLevel = 'algorithmic' | 'structure_only';

export interface EcuadorDocumentValidation {
  valid: boolean;
  type: EcuadorDocumentType | null;
  checksum_valid: boolean | null;
  verification_level: EcuadorDocumentVerificationLevel | null;
  official_verification: 'not_performed';
  normalized: string;
  error?: string;
}

const CEDULA_COEFFICIENTS = [2, 1, 2, 1, 2, 1, 2, 1, 2];
const JURIDICO_COEFFICIENTS = [4, 3, 2, 7, 6, 5, 4, 3, 2];
const PUBLICO_COEFFICIENTS = [3, 2, 7, 6, 5, 4, 3, 2];

export const normalizeDocumento = (value: unknown): string =>
  String(value ?? '').replace(/\D/g, '');

const isValidProvince = (code: string): boolean => {
  const numeric = Number(code);
  return (numeric >= 1 && numeric <= 24) || numeric === 30;
};

const cedulaCheckDigit = (digits: string): number => {
  let sum = 0;
  for (let index = 0; index < 9; index += 1) {
    let product = Number(digits[index]) * CEDULA_COEFFICIENTS[index];
    if (product > 9) product -= 9;
    sum += product;
  }
  return (10 - (sum % 10)) % 10;
};

const modulo11CheckDigit = (digits: string, coefficients: number[]): number => {
  let sum = 0;
  for (let index = 0; index < coefficients.length; index += 1) {
    sum += Number(digits[index]) * coefficients[index];
  }
  let remainder = 11 - (sum % 11);
  if (remainder === 11) remainder = 0;
  if (remainder === 10) remainder = 0;
  return remainder;
};

const build = (
  valid: boolean,
  type: EcuadorDocumentType | null,
  checksum_valid: boolean | null,
  normalized: string,
  error?: string
): EcuadorDocumentValidation => ({
  valid,
  type,
  checksum_valid,
  verification_level: valid ? (checksum_valid ? 'algorithmic' : 'structure_only') : null,
  official_verification: 'not_performed',
  normalized,
  ...(error ? { error } : {})
});

export const validateEcuadorDocument = (value: unknown): EcuadorDocumentValidation => {
  const normalized = normalizeDocumento(value);
  if (!normalized) return build(false, null, null, '', 'Ingresa tu cédula o RUC');
  if (!/^\d{10}$/.test(normalized) && !/^\d{13}$/.test(normalized)) {
    return build(false, null, null, normalized, 'La cédula debe tener 10 dígitos y el RUC 13 dígitos');
  }
  if (!isValidProvince(normalized.slice(0, 2))) {
    return build(false, null, null, normalized, 'El código de provincia del documento no es válido');
  }

  const third = Number(normalized[2]);

  if (normalized.length === 10) {
    if (third > 5) {
      return build(false, null, null, normalized, 'El documento no corresponde a una cédula ecuatoriana válida');
    }
    const expected = cedulaCheckDigit(normalized);
    if (expected !== Number(normalized[9])) {
      return build(false, 'CEDULA', false, normalized, 'El dígito verificador de la cédula no es válido');
    }
    return build(true, 'CEDULA', true, normalized);
  }

  const establecimiento = normalized.slice(10);
  if (third <= 5) {
    const expected = cedulaCheckDigit(normalized.slice(0, 10));
    if (expected !== Number(normalized[9])) {
      return build(false, 'RUC_NATURAL', false, normalized, 'El RUC de persona natural no contiene una cédula válida');
    }
    if (/^0{3}$/.test(establecimiento)) {
      return build(false, 'RUC_NATURAL', true, normalized, 'El establecimiento del RUC no es válido');
    }
    return build(true, 'RUC_NATURAL', true, normalized);
  }

  if (third === 6) {
    const expected = modulo11CheckDigit(normalized.slice(0, 9), PUBLICO_COEFFICIENTS);
    return build(true, 'RUC_PUBLICO', expected === Number(normalized[8]), normalized);
  }

  if (third === 9) {
    const expected = modulo11CheckDigit(normalized.slice(0, 9), JURIDICO_COEFFICIENTS);
    return build(true, 'RUC_JURIDICO', expected === Number(normalized[9]), normalized);
  }

  return build(false, null, null, normalized, 'El tercer dígito del RUC no corresponde a un tipo de contribuyente soportado');
};

export const isValidEcuadorDocument = (value: unknown): boolean => validateEcuadorDocument(value).valid;
