// ══════════════════════════════════════════════
//  SUPABASE — Historial / Bitácora (v6.1)
// ══════════════════════════════════════════════

const SUPABASE_URL = 'https://kzqdjxzobuiqxihefuni.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_CLP73Z8_iBpsFwyFNMuCUQ_vSlmmvE8';

let supabase = null;

function initSupabase() {
    if (typeof window.supabase === 'undefined' || typeof window.supabase.createClient !== 'function') {
        console.error('[Supabase] SDK no cargado. Revisa el <script> del CDN.');
        return false;
    }
    if (!SUPABASE_ANON_KEY) {
        console.error('[Supabase] Falta la API key');
        return false;
    }
    try {
        supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        console.log('[Supabase] Cliente inicializado OK');
        return true;
    } catch (e) {
        console.error('[Supabase] Error al crear cliente:', e);
        return false;
    }
}

/**
 * Guarda una acción en el historial de Supabase.
 */
async function guardarEnHistorial(accion, detalle = '', extra = {}) {
    if (!supabase) {
        if (!initSupabase()) {
            console.error('[Supabase] No se pudo inicializar al guardar');
            return;
        }
    }

    const fila = {
        uid: (typeof currentUID !== 'undefined' ? currentUID : null) || null,
        email: (typeof currentEmail !== 'undefined' ? currentEmail : null) || null,
        accion,
        detalle: detalle || null,
        tipo: extra.tipo || 'accion',
        duracion_seg: extra.duracion_seg ?? null,
        metadata: extra.metadata || {}
    };

    console.log('[Supabase] Guardando:', fila);

    try {
        const { data, error } = await supabase.from('historial').insert([fila]).select();
        if (error) {
            console.error('[Supabase] Error INSERT:', error.message, error);
            if (typeof setStatus === 'function') {
                setStatus('Error historial: ' + error.message, 'err');
            }
            return;
        }
        console.log('[Supabase] Guardado OK:', data);
    } catch (e) {
        console.error('[Supabase] Excepción:', e);
        if (typeof setStatus === 'function') {
            setStatus('Error historial: ' + e.message, 'err');
        }
    }
}

/**
 * Carga el historial desde Supabase.
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
            console.error('[Supabase] Error SELECT:', error.message, error);
            if (typeof setStatus === 'function') {
                setStatus('Error leyendo historial: ' + error.message, 'err');
            }
            return [];
        }
        console.log('[Supabase] Leídos', (data || []).length, 'registros');
        return data || [];
    } catch (e) {
        console.error('[Supabase] Excepción SELECT:', e);
        return [];
    }
}

async function guardarDesconexion(duracionSeg, inicioTs) {
    await guardarEnHistorial('desconexion_esp32', `Duración: ${duracionSeg}s`, {
        tipo: 'desconexion',
        duracion_seg: duracionSeg,
        metadata: { inicio: inicioTs || null }
    });
}

/**
 * Prueba rápida: escribe una fila de test y la muestra en consola.
 * Puedes llamar esto desde la consola del navegador: probarSupabase()
 */
async function probarSupabase() {
    if (!initSupabase()) {
        alert('No se pudo inicializar Supabase. Mira la consola (F12).');
        return;
    }
    console.log('[Supabase] Probando INSERT...');
    const { data, error } = await supabase.from('historial').insert([{
        accion: 'prueba_consola',
        detalle: 'Test manual desde el navegador',
        tipo: 'accion',
        email: 'test@local'
    }]).select();

    if (error) {
        console.error('[Supabase] FALLO:', error);
        alert('Error: ' + error.message + '\n\nMira la consola (F12) para más detalle.');
    } else {
        console.log('[Supabase] ÉXITO:', data);
        alert('¡Funciona! Se guardó en Supabase. Revisa Table Editor → historial');
    }
}

// Inicializar al cargar
document.addEventListener('DOMContentLoaded', () => {
    initSupabase();
});
