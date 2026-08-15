// ══════════════════════════════════════════════
//  SUPABASE — Historial / Bitácora (v6.1)
// ══════════════════════════════════════════════

// ⚠️ Pega aquí tu Publishable key (sb_publishable_...)
const SUPABASE_URL = 'https://kzqdjxzobuiqxihefuni.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_CLP73Z8_iBpsFwyFNMuCUQ_vSlmmvE8';

// Cliente Supabase (se crea cuando el SDK esté cargado)
let supabase = null;

function initSupabase() {
    if (typeof window.supabase === 'undefined') {
        console.error('Supabase SDK no cargado');
        return false;
    }
    if (!SUPABASE_ANON_KEY || SUPABASE_ANON_KEY.includes('PEGA_AQUI')) {
        console.warn('Falta configurar SUPABASE_ANON_KEY en supabase.js');
        return false;
    }
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return true;
}

/**
 * Guarda una acción en el historial de Supabase.
 * @param {string} accion  - ej: 'inicio_sesion', 'horario_agregado'
 * @param {string} detalle - texto opcional
 * @param {object} extra   - { tipo, duracion_seg, metadata }
 */
async function guardarEnHistorial(accion, detalle = '', extra = {}) {
    if (!supabase) {
        if (!initSupabase()) return;
    }

    const fila = {
        uid: currentUID || null,
        email: currentEmail || null,
        accion,
        detalle: detalle || null,
        tipo: extra.tipo || 'accion',
        duracion_seg: extra.duracion_seg ?? null,
        metadata: extra.metadata || {}
    };

    try {
        const { error } = await supabase.from('historial').insert([fila]);
        if (error) {
            console.error('Error guardando historial en Supabase:', error);
        }
    } catch (e) {
        console.error('Excepción al guardar historial:', e);
    }
}

/**
 * Carga el historial desde Supabase (más recientes primero).
 * @param {number} limite
 * @param {object} filtros - { accion, email, desde, hasta, tipo }
 */
async function cargarHistorialSupabase(limite = 80, filtros = {}) {
    if (!supabase) {
        if (!initSupabase()) return [];
    }

    let query = supabase
        .from('historial')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limite);

    if (filtros.accion) query = query.eq('accion', filtros.accion);
    if (filtros.email)  query = query.eq('email', filtros.email);
    if (filtros.tipo)   query = query.eq('tipo', filtros.tipo);
    if (filtros.desde)  query = query.gte('created_at', filtros.desde);
    if (filtros.hasta)  query = query.lte('created_at', filtros.hasta + 'T23:59:59');

    try {
        const { data, error } = await query;
        if (error) {
            console.error('Error leyendo historial:', error);
            return [];
        }
        return data || [];
    } catch (e) {
        console.error('Excepción al leer historial:', e);
        return [];
    }
}

/**
 * Guarda una desconexión del ESP32.
 */
async function guardarDesconexion(duracionSeg, inicioTs) {
    await guardarEnHistorial('desconexion_esp32', `Duración: ${duracionSeg}s`, {
        tipo: 'desconexion',
        duracion_seg: duracionSeg,
        metadata: { inicio: inicioTs || null }
    });
}
