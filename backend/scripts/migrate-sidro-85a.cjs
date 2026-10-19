const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

if (!process.env.DATABASE_URL) {
  console.error('[MIGRATE] DATABASE_URL no está configurada.');
  process.exit(1);
}

const url = new URL(process.env.DATABASE_URL);
const isLocal = ['localhost', '127.0.0.1'].includes(url.hostname);
if (!isLocal && process.env.SIDRO_85A_CONFIRM !== 'apply') {
  console.error('[MIGRATE] Destino no local detectado. Para aplicar en ese entorno ejecuta con SIDRO_85A_CONFIRM=apply.');
  process.exit(1);
}

(async () => {
  const migrator = require(path.resolve(__dirname, '..', 'dist', 'database', 'migrateSidroCompleteRegistration85.js'));
  const db = require(path.resolve(__dirname, '..', 'dist', 'database', 'db.js')).default;
  try {
    await migrator.initSidroCompleteRegistration85();
    const report = await migrator.verifySidroCompleteRegistration85();
    console.log(`[MIGRATE] Fase 8.5A verificación: ${JSON.stringify(report)}`);
    if (!report.ok) {
      console.error('[MIGRATE] La migración no quedó completa; revisa documentos duplicados o columnas faltantes antes de desplegar.');
      process.exitCode = 1;
    } else {
      console.log('[MIGRATE] Fase 8.5A aplicada y verificada correctamente.');
    }
  } finally {
    await db.end().catch(() => undefined);
  }
})().catch((error) => {
  console.error(`[MIGRATE] Error: ${error?.message || error}`);
  process.exitCode = 1;
});
