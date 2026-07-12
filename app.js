// ══════════════════════════════════════════════
//  FIREBASE CONFIG
//  (usado también por users.js)
// ══════════════════════════════════════════════
const firebaseConfig = {
    apiKey:      "AIzaSyAbTb-cXeJmmPprRaVTqSyBiEyoEGv93f0",
    authDomain:  "sistematimbre.firebaseapp.com",
    databaseURL: "https://sistematimbre-default-rtdb.firebaseio.com",
    projectId:   "sistematimbre"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db   = firebase.database();

let estadoMaestro = true;
let hbTimer = null;

// Datos de sesión actual (se llenan al iniciar sesión)
let currentUID   = null;
let currentEmail = null;
let currentRol   = null; // "admin" | "usuario"

// ── Reloj local ──────────────────────────────
function actualizarReloj() {
    const ahora = new Date();
    const pad = n => String(n).padStart(2, '0');
    document.getElementById('hora-local').textContent =
        `${pad(ahora.getHours())}:${pad(ahora.getMinutes())}:${pad(ahora.getSeconds())}`;
}
setInterval(actualizarReloj, 1000);
actualizarReloj();

// ── Sincronización automática de hora (cada 24h) ─
function programarSyncHora() {
    const ahora = new Date();
    const mañana = new Date(ahora);
    mañana.setDate(mañana.getDate() + 1);
    mañana.setHours(0, 0, 30, 0);
    const msHastaMedianoche = mañana - ahora;

    setTimeout(() => {
        subirTimestampHora();
        setInterval(subirTimestampHora, 24 * 60 * 60 * 1000);
    }, msHastaMedianoche);
}

function subirTimestampHora() {
    db.ref('hora_unix_ms').set(Date.now()).catch(e => console.error('Error subiendo hora:', e));
}

// ══════════════════════════════════════════════
//  REGISTRO DE ACTIVIDAD (bitácora)
// ══════════════════════════════════════════════
function registrarAccion(accion, detalle = '') {
    if (!currentUID) return;
    db.ref('registro').push({
        uid: currentUID,
        email: currentEmail,
        accion,
        detalle,
        timestamp: Date.now()
    }).catch(e => console.error('Error registrando acción:', e));
}

function renderRegistro() {
    db.ref('registro').limitToLast(50).on('value', snap => {
        const cont = document.getElementById('lista-registro');
        if (!cont) return;
        cont.innerHTML = '';
        const items = [];
        snap.forEach(child => items.push(child.val()));
        items.reverse(); // más reciente primero
        document.getElementById('contador-registro').textContent = items.length;
        if (items.length === 0) {
            cont.innerHTML = '<div class="no-toques">Sin actividad registrada</div>';
            return;
        }
        items.forEach(r => {
            const fecha = new Date(r.timestamp);
            const ts = fecha.toLocaleString('es-SV', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
            const div = document.createElement('div');
            div.className = 'registro-item';
            div.innerHTML = `<span class="ts">${ts}</span><b>${r.email || 'desconocido'}</b> — ${r.accion}${r.detalle ? ': ' + r.detalle : ''}`;
            cont.appendChild(div);
        });
    });
}

// ══════════════════════════════════════════════
//  AUTH
// ══════════════════════════════════════════════
auth.onAuthStateChanged(user => {
    if (user) {
        // Verificar el rol/estado del usuario en la base de datos
        db.ref('usuarios/' + user.uid).once('value').then(snap => {
            const perfil = snap.val();

            if (!perfil) {
                document.getElementById('error-msg').textContent =
                    'Tu cuenta no está registrada en el sistema. Contacta a un administrador.';
                auth.signOut();
                return;
            }
            if (perfil.activo === false) {
                document.getElementById('error-msg').textContent =
                    'Tu acceso ha sido desactivado. Contacta a un administrador.';
                auth.signOut();
                return;
            }

            currentUID   = user.uid;
            currentEmail = perfil.email || user.email;
            currentRol   = perfil.rol === 'admin' ? 'admin' : 'usuario';

            document.getElementById('login-box').classList.add('hidden');
            document.getElementById('panel-box').classList.remove('hidden');
            document.getElementById('user-email-display').textContent = currentEmail;

            const badge = document.getElementById('user-role-badge');
            badge.textContent = currentRol === 'admin' ? 'Administrador' : 'Usuario';
            badge.className = 'role-badge ' + currentRol;

            document.getElementById('admin-zone').classList.toggle('hidden', currentRol !== 'admin');

            startListening();
            if (currentRol === 'admin') {
                renderRegistro();
                if (typeof cargarUsuarios === 'function') cargarUsuarios();
            }

            subirTimestampHora();
            programarSyncHora();
            registrarAccion('inicio_sesion');
        }).catch(e => {
            console.error(e);
            document.getElementById('error-msg').textContent = 'Error al verificar tu cuenta.';
            auth.signOut();
        });
    } else {
        currentUID = null; currentEmail = null; currentRol = null;
        document.getElementById('login-box').classList.remove('hidden');
        document.getElementById('panel-box').classList.add('hidden');
        document.getElementById('error-msg').textContent = '';
    }
});

function handleLogin() {
    const email = document.getElementById('user-email').value.trim();
    const pass  = document.getElementById('user-pass').value;
    document.getElementById('error-msg').textContent = '';
    auth.signInWithEmailAndPassword(email, pass).catch(() => {
        document.getElementById('error-msg').textContent = 'Correo o contraseña incorrectos.';
    });
}

function handleLogout() {
    registrarAccion('cierre_sesion');
    setTimeout(() => auth.signOut(), 150); // dar tiempo a que se guarde el registro
}

// ══════════════════════════════════════════════
//  LISTENERS EN TIEMPO REAL
// ══════════════════════════════════════════════
function startListening() {

    // Estado maestro (solo relevante para admin, pero no hace daño si un usuario normal no lo ve)
    db.ref('estado_maestro').on('value', snap => {
        estadoMaestro = snap.val() !== false;
        const btn = document.getElementById('btn-maestro');
        if (!btn) return;
        if (estadoMaestro) {
            btn.textContent = '✔ SISTEMA ACTIVADO';
            btn.className   = 'btn btn-green';
        } else {
            btn.textContent = '⏸ SISTEMA PAUSADO';
            btn.className   = 'btn btn-red';
        }
    });

    // Horarios (solo se pinta si el admin-zone existe visible, pero el listener no hace daño)
    db.ref('timbres').on('value', snap => {
        const listDiv = document.getElementById('lista-toques');
        if (!listDiv) return;
        listDiv.innerHTML = '';
        let count = 0;
        if (!snap.exists()) {
            listDiv.innerHTML = '<div class="no-toques">Sin horarios registrados</div>';
        } else {
            const items = [];
            snap.forEach(child => {
                const t = child.val();
                items.push({ key: child.key, h: t.h, m: t.m });
            });
            items.sort((a, b) => a.h * 60 + a.m - (b.h * 60 + b.m));
            items.forEach(t => {
                const ts = `${String(t.h).padStart(2, '0')}:${String(t.m).padStart(2, '0')}`;
                const div = document.createElement('div');
                div.className = 'toque-item';
                div.id = `item-${t.key}`;
                div.innerHTML = `
                    <span class="toque-time">${ts}</span>
                    <div class="toque-actions">
                        <button class="btn-edit" onclick="showEditForm('${t.key}','${ts}')">Editar</button>
                        <button class="btn-del"  onclick="deleteTime('${t.key}')">Borrar</button>
                    </div>`;
                listDiv.appendChild(div);
                count++;
            });
        }
        document.getElementById('contador-horarios').textContent = count;
    });

    // Heartbeat / estado del dispositivo (visible para TODOS los roles)
    db.ref('ultima_conexion').on('value', snap => {
        const statusDiv  = document.getElementById('device-status');
        const statusText = document.getElementById('device-status-text');
        const lastTime   = snap.val();
        const update = () => {
            if (!lastTime) {
                statusDiv.className = 'st-offline';
                statusText.textContent = 'Sin datos del dispositivo';
                return;
            }
            const diff = (Date.now() - lastTime) / 1000;
            if (diff < 40) {
                statusDiv.className = 'st-online';
                statusText.textContent = `ESP32 EN LÍNEA — hace ${Math.round(diff)}s`;
            } else {
                statusDiv.className = 'st-offline';
                statusText.textContent = `FUERA DE LÍNEA — última vez hace ${Math.round(diff / 60)} min`;
            }
        };
        update();
        if (hbTimer) clearInterval(hbTimer);
        hbTimer = setInterval(update, 5000);
    });
}

// ══════════════════════════════════════════════
//  ACCIONES (protegidas también por reglas de Firebase,
//  ver reglas-seguridad.json)
// ══════════════════════════════════════════════
function setStatus(msg, tipo = '') {
    const el = document.getElementById('status-bar');
    el.textContent = msg;
    el.className   = tipo;
    if (tipo === 'ok') setTimeout(() => { el.textContent = 'Listo.'; el.className = ''; }, 4000);
}

function toggleMaestro() {
    if (currentRol !== 'admin') return;
    const nuevoEstado = !estadoMaestro;
    db.ref('estado_maestro').set(nuevoEstado).then(() => {
        registrarAccion('estado_maestro', nuevoEstado ? 'activado' : 'pausado');
    }).catch(() => setStatus('Error al cambiar estado', 'err'));
}

function addTime() {
    if (currentRol !== 'admin') return;
    const val = document.getElementById('nuevo-horario').value;
    if (!val) { setStatus('Selecciona una hora primero', 'err'); return; }
    const [h, m] = val.split(':').map(Number);
    setStatus('Guardando horario...', 'busy');
    db.ref('timbres').push({ h, m }).then(() => {
        triggerSync();
        registrarAccion('horario_agregado', val);
        document.getElementById('nuevo-horario').value = '';
        setStatus('Horario guardado ✓', 'ok');
    }).catch(() => setStatus('Error al guardar', 'err'));
}

function deleteTime(id) {
    if (currentRol !== 'admin') return;
    if (!confirm('¿Borrar este horario?')) return;
    setStatus('Borrando...', 'busy');
    db.ref('timbres/' + id).remove().then(() => {
        triggerSync();
        registrarAccion('horario_eliminado', id);
        setStatus('Horario eliminado ✓', 'ok');
    }).catch(() => setStatus('Error al borrar', 'err'));
}

function showEditForm(id, currentTime) {
    if (currentRol !== 'admin') return;
    const item = document.getElementById(`item-${id}`);
    item.innerHTML = `
        <div class="edit-row">
            <input type="time" id="edit-${id}" value="${currentTime}">
            <button class="btn-edit" onclick="saveEdit('${id}')">OK</button>
            <button class="btn-del"  onclick="cancelEdit()">✕</button>
        </div>`;
}

function cancelEdit() { /* el listener de DB reconstruye la lista */ }

function saveEdit(id) {
    if (currentRol !== 'admin') return;
    const newVal = document.getElementById(`edit-${id}`)?.value;
    if (!newVal) return;
    const [h, m] = newVal.split(':').map(Number);
    setStatus('Actualizando...', 'busy');
    db.ref('timbres/' + id).update({ h, m }).then(() => {
        triggerSync();
        registrarAccion('horario_editado', newVal);
        setStatus('Horario actualizado ✓', 'ok');
    }).catch(() => setStatus('Error al actualizar', 'err'));
}

function manualRing() {
    if (currentRol !== 'admin') return;
    setStatus('Enviando toque manual...', 'busy');
    db.ref('manual').set(true).then(() => {
        registrarAccion('toque_manual');
        setStatus('¡Toque enviado! ✓', 'ok');
    }).catch(() => setStatus('Error al enviar', 'err'));
}

function syncSystem() {
    if (currentRol !== 'admin') return;
    setStatus('Sincronizando...', 'busy');
    const batch = {
        hora_unix_ms: Date.now(),
        comando_sync: true,
        comando_sync_hora: true
    };
    db.ref('/').update(batch).then(() => {
        registrarAccion('sincronizacion_completa');
        setStatus('Sincronización enviada ✓', 'ok');
    }).catch(() => setStatus('Error de sincronización', 'err'));
}

// Disponible para TODOS los roles (admin y usuario normal)
function syncHora() {
    setStatus('Actualizando hora...', 'busy');
    db.ref('hora_unix_ms').set(Date.now())
      .then(() => db.ref('comando_sync_hora').set(true))
      .then(() => {
          registrarAccion('hora_actualizada');
          setStatus('Hora actualizada ✓', 'ok');
      })
      .catch(() => setStatus('Error al actualizar hora', 'err'));
}

function triggerSync() {
    db.ref('hora_unix_ms').set(Date.now());
    db.ref('comando_sync').set(true);
}

// ══════════════════════════════════════════════
//  BLUETOOTH HELPER (Web Bluetooth API) — solo admin
// ══════════════════════════════════════════════
function toggleBT() {
    const panel = document.getElementById('bt-panel');
    const icon  = document.getElementById('bt-toggle-icon');
    if (panel.style.display === 'block') {
        panel.style.display = 'none';
        icon.textContent = '▼';
    } else {
        panel.style.display = 'block';
        icon.textContent = '▲';
    }
}

async function enviarCredencialesBT() {
    if (currentRol !== 'admin') return;
    const ssid = document.getElementById('bt-ssid').value.trim();
    const pass = document.getElementById('bt-pass').value;
    const btStatus = document.getElementById('bt-status');

    if (!ssid) { btStatus.textContent = 'ERROR: Ingresa el nombre de la red.'; return; }
    if (!navigator.bluetooth) {
        btStatus.textContent = 'Tu navegador no soporta Web Bluetooth. Usa Chrome en Android/PC.';
        return;
    }

    try {
        btStatus.textContent = 'Buscando ESP32 por Bluetooth...';
        const device = await navigator.bluetooth.requestDevice({
            filters: [{ name: 'Timbre-ESP32' }],
            optionalServices: ['0000ffe0-0000-1000-8000-00805f9b34fb']
        });
        btStatus.textContent = 'Conectando...';
        const server  = await device.gatt.connect();
        const service = await server.getPrimaryService('0000ffe0-0000-1000-8000-00805f9b34fb');
        const char    = await service.getCharacteristic('0000ffe1-0000-1000-8000-00805f9b34fb');

        const mensaje = `${ssid}|${pass}\n`;
        const encoder = new TextEncoder();
        await char.writeValue(encoder.encode(mensaje));

        btStatus.textContent = `✓ Credenciales enviadas: ${ssid} | (contraseña oculta)`;
        registrarAccion('wifi_configurado', ssid);
        setTimeout(() => device.gatt.disconnect(), 3000);
    } catch (e) {
        btStatus.textContent = 'No se pudo conectar por Bluetooth: ' + e.message;
        console.error('BT Error:', e);
    }
}
