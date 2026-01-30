import { Request, Response } from 'express';
import pool from '../database/db'; // Asegúrate que apunte a tu db.ts

// 1. VERIFICAR ESTADO (¿Está abierta o cerrada?)
export const getCashStatus = async (req: Request, res: Response) => {
    try {
        // Buscamos si hay alguna caja con estado 'ABIERTA'
        const result = await pool.query(
            `SELECT * FROM cash_registers WHERE estado = 'ABIERTA' ORDER BY fecha_apertura DESC LIMIT 1`
        );

        if (result.rows.length > 0) {
            res.json({ isOpen: true, session: result.rows[0] });
        } else {
            res.json({ isOpen: false, message: 'Caja cerrada' });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al verificar caja' });
    }
};

// 2. ABRIR CAJA (Empezar el día)
export const openRegister = async (req: Request, res: Response) => {
    const { monto_inicial, usuario_id } = req.body;

    try {
        // Validación: No puedes abrir si ya hay una abierta
        const checkOpen = await pool.query("SELECT id FROM cash_registers WHERE estado = 'ABIERTA'");
        if (checkOpen.rows.length > 0) {
            return res.status(400).json({ error: 'Ya existe una caja abierta. Ciérrala primero.' });
        }

        const result = await pool.query(
            `INSERT INTO cash_registers (monto_inicial, usuario_id, estado)
             VALUES ($1, $2, 'ABIERTA')
             RETURNING *`,
            [monto_inicial || 0, usuario_id]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al abrir caja' });
    }
};



export const getClosingDetails = async (req: Request, res: Response) => {
    try {
        // 1. Buscamos la sesión abierta
        const sessionRes = await pool.query("SELECT * FROM cash_registers WHERE estado = 'ABIERTA' LIMIT 1");
        
        if (sessionRes.rows.length === 0) {
            return res.status(404).json({ error: 'No hay caja abierta.' });
        }

        const session = sessionRes.rows[0];
        const fechaInicio = session.fecha_apertura;

        // =================================================================================
        // 🕵️‍♂️ LÓGICA CORREGIDA (Usa 'fecha' en lugar de 'created_at')
        // =================================================================================

        // A. VENTAS DEL DÍA
        // ⚠️ CAMBIO: Usamos 'fecha' en el WHERE. Si tu tabla ventas usa 'created_at', avísame.
        // Asumo que si payment_history falló, sales también puede tener 'fecha'.
        // Intentaremos usar COALESCE o simplemente 'fecha' si así las creaste.
        
        const ventasRes = await pool.query(`
            SELECT 
                COALESCE(SUM(CASE WHEN tipo_pago = 'EFECTIVO' THEN monto_pagado ELSE 0 END), 0) as efectivo_ventas,
                COALESCE(SUM(CASE WHEN tipo_pago = 'TRANSFERENCIA' THEN monto_pagado ELSE 0 END), 0) as digital_ventas,
                COALESCE(SUM(total), 0) as total_facturado
            FROM sales 
            WHERE fecha >= $1 
        `, [fechaInicio]);
        // 👆 NOTA: Si aquí te vuelve a dar error, cambia 'WHERE fecha' por 'WHERE created_at' solo en este bloque.

        // B. ABONOS DE DEUDAS
        // ⚠️ CAMBIO: Aquí seguramente estaba el error. Cambiamos 'created_at' por 'fecha'.
        const abonosRes = await pool.query(`
            SELECT 
                COALESCE(SUM(CASE WHEN metodo_pago = 'EFECTIVO' THEN monto ELSE 0 END), 0) as efectivo_abonos,
                COALESCE(SUM(CASE WHEN metodo_pago = 'TRANSFERENCIA' THEN monto ELSE 0 END), 0) as digital_abonos
            FROM payment_history 
            WHERE fecha >= $1
            AND notas != 'Entrada Inicial' 
            AND notas != 'Pago al contado' 
        `, [fechaInicio]);

        // C. GASTOS (Ya usaba fecha, esto debe estar bien)
        const gastosRes = await pool.query(`
            SELECT 
                COALESCE(SUM(CASE WHEN metodo_pago = 'EFECTIVO' THEN monto ELSE 0 END), 0) as gastos_efectivo,
                COALESCE(SUM(CASE WHEN metodo_pago = 'TRANSFERENCIA' THEN monto ELSE 0 END), 0) as gastos_digital
            FROM expenses 
            WHERE fecha >= $1
        `, [fechaInicio]);

        // =================================================================================
        // 🧮 CALCULADORA FINAL
        // =================================================================================
        
        const v = ventasRes.rows[0];
        const a = abonosRes.rows[0];
        const g = gastosRes.rows[0];

        const efectivoVentas = Number(v.efectivo_ventas);
        const efectivoAbonos = Number(a.efectivo_abonos);
        
        const gastosEfectivo = Number(g.gastos_efectivo);
        const gastosDigital = Number(g.gastos_digital);
        const totalGastos = gastosEfectivo + gastosDigital;

        const montoInicial = Number(session.monto_inicial);

        // 1. DINERO EN CAJÓN (SOLO EFECTIVO)
        const esperadoEnCaja = (montoInicial + efectivoVentas + efectivoAbonos) - gastosEfectivo;

        // 2. DINERO DIGITAL
        const digitalVentas = Number(v.digital_ventas);
        const digitalAbonos = Number(a.digital_abonos);
        const totalDigital = digitalVentas + digitalAbonos;

        const totalFacturado = Number(v.total_facturado);
        const totalIngresosReales = efectivoVentas + efectivoAbonos + totalDigital;

        res.json({
            session_id: session.id,
            fecha_apertura: fechaInicio,
            monto_inicial: montoInicial,
            
            resumen: {
                efectivo_ventas: efectivoVentas,
                efectivo_abonos: efectivoAbonos,
                digital_total: totalDigital,
            },

            total_ventas: totalIngresosReales,
            total_facturado: totalFacturado,
            credito_otorgado: totalFacturado - (efectivoVentas + digitalVentas), 
            
            total_gastos: totalGastos,
            gastos_en_efectivo: gastosEfectivo,
            monto_esperado: esperadoEnCaja 
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error calculando cierre' });
    }
};

// Verificar si hay caja abierta
export const getStatus = async (req: Request, res: Response) => {
    try {
        // Buscamos si existe alguna caja con estado 'ABIERTA'
        const result = await pool.query(
            "SELECT id, fecha_apertura, monto_inicial FROM cash_registers WHERE estado = 'ABIERTA' LIMIT 1"
        );
        
        if (result.rows.length > 0) {
            // ✅ SI hay caja abierta
            res.json({ 
                isOpen: true, 
                session: result.rows[0],
                message: 'Caja abierta' 
            });
        } else {
            // ❌ NO hay caja abierta
            res.json({ 
                isOpen: false, 
                message: 'Caja cerrada' 
            });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error verificando estado de caja' });
    }
};


// 4. CERRAR CAJA (Guardar el arqueo final)
export const closeRegister = async (req: Request, res: Response) => {
    const { id } = req.params; // ID de la sesión
    const { monto_real, observaciones, total_ventas, total_gastos, monto_esperado } = req.body;

    // Calculamos la diferencia (Sobrante o Faltante)
    const diferencia = Number(monto_real) - Number(monto_esperado);

    try {
        const result = await pool.query(
            `UPDATE cash_registers 
             SET fecha_cierre = now(),
                 estado = 'CERRADA',
                 total_ventas_sistema = $1,
                 total_gastos_sistema = $2,
                 monto_esperado = $3,
                 monto_real = $4,
                 diferencia = $5,
                 observaciones = $6
             WHERE id = $7
             RETURNING *`,
            [total_ventas, total_gastos, monto_esperado, monto_real, diferencia, observaciones, id]
        );

        res.json({ message: 'Caja cerrada correctamente', data: result.rows[0] });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al cerrar caja' });
    }
};

// Obtener historial con filtros de fecha
export const getCashHistory = async (req: Request, res: Response) => {
    try {
        const { from, to } = req.query;
        
        let query = `
            SELECT 
                id, 
                fecha_apertura, 
                fecha_cierre, 
                monto_inicial, 
                monto_real as monto_final, 
                diferencia, 
                usuario_id, 
                estado
            FROM cash_registers 
            WHERE estado = 'CERRADA'
        `;

        const params: any[] = [];

        // Si envían fechas, filtramos por rango
        if (from && to) {
            query += ` AND fecha_cierre::date BETWEEN $1 AND $2`;
            params.push(from, to);
        } else {
            // Si no envían fechas, traemos solo los últimos 50 (comportamiento por defecto)
            query += ` ORDER BY fecha_cierre DESC LIMIT 50`;
        }

        // Si hay filtro, ordenamos también pero sin limite
        if (from && to) {
            query += ` ORDER BY fecha_cierre DESC`;
        }

        const result = await pool.query(query, params);
        res.json(result.rows);

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error obteniendo historial' });
    }
};


export const getClosingReport = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        // 1. Datos básicos
        const registerResult = await pool.query('SELECT * FROM cash_registers WHERE id = $1', [id]);
        if (registerResult.rows.length === 0) return res.status(404).json({ error: 'Cierre no encontrado' });

        const caja = registerResult.rows[0];

        // 2. Ventas (Efectivo)
        const ventasResult = await pool.query(`
            SELECT COALESCE(SUM(total), 0) as total FROM sales
            WHERE fecha >= $1 AND fecha <= $2 AND metodo_pago = 'EFECTIVO'
        `, [caja.fecha_apertura, caja.fecha_cierre]);

        // 3. Gastos (Efectivo)
        const gastosResult = await pool.query(`
            SELECT COALESCE(SUM(monto), 0) as total FROM expenses
            WHERE fecha >= $1 AND fecha <= $2 AND metodo_pago = 'EFECTIVO'
        `, [caja.fecha_apertura, caja.fecha_cierre]);

        // 4. Abonos (Efectivo) - 👇 AQUÍ CORREGIMOS "created_at" POR "fecha"
        const abonosResult = await pool.query(`
            SELECT COALESCE(SUM(monto), 0) as total FROM payment_history
            WHERE fecha >= $1 AND fecha <= $2 AND metodo_pago = 'EFECTIVO'
        `, [caja.fecha_apertura, caja.fecha_cierre]);

        const totalVentas = Number(ventasResult.rows[0].total);
        const totalGastos = Number(gastosResult.rows[0].total);
        const totalAbonos = Number(abonosResult.rows[0].total);
        const montoInicial = Number(caja.monto_inicial);

        const esperado = montoInicial + totalVentas + totalAbonos - totalGastos;

        res.json({
            ...caja,
            total_ventas_efectivo: totalVentas + totalAbonos,
            total_gastos: totalGastos,
            esperado: esperado,
            monto_real: Number(caja.monto_real || 0),
            diferencia: Number(caja.diferencia || 0)
        });

    } catch (error) {
        console.error("❌ ERROR EN REPORTE:", error);
        res.status(500).json({ error: 'Error obteniendo reporte' });
    }
};