// ══════════════════════════════════════════════
//  GESTIÓN DE USUARIOS (solo administradores)
//  Depende de firebaseConfig, db, auth, currentRol,
//  currentUID, currentEmail, registrarAccion(),
//  confirmar() y setStatus(), definidos en app.js
// ══════════════════════════════════════════════

let usuariosCache = [];

function cargarUsuarios() {
    db.ref('usuarios').on('value', snap => {
        usuariosCache = [];
        if (snap.exists()) {
            snap.forEach(child => usuariosCache.push({ uid: child.key, ...child.val() }));
            usuariosCache.sort((a, b) => (a.email || '').localeCompare(b.email || ''));
        }
        pintarUsuarios();
        actualizarStatUsuarios();
    });
}

function actualizarStatUsuarios() {
    const activos = usuariosCache.filter(u => u.activo !== false).length;
    const el = document.getElementById('stat-usuarios-activos');
    if (el) el.textContent = activos;
}

function pintarUsuarios() {
    const cont = document.getElementById('lista-usuarios');
    if (!cont) return;

    const busqueda = (document.getElementById('buscar-usuario')?.value || '').toLowerCase().trim();
    const filtrados = busqueda
        ? usuariosCache.filter(u => (u.email || '').toLowerCase().includes(busqueda))
        : usuariosCache;

    document.getElementById('contador-usuarios').textContent = usuariosCache.length;
    cont.innerHTML = '';

    if (filtrados.length === 0) {
        cont.innerHTML = `<div class="no-toques">${busqueda ? 'Sin coincidencias' : 'Sin usuarios registrados'}</div>`;
        return;
    }

    filtrados.forEach(u => {
        const activo = u.activo !== false;
        const div = document.createElement('div');
        div.className = 'usuario-item' + (activo ? '' : ' inactivo');
        div.innerHTML = `
            <span class="usuario-email">${u.email || u.uid}</span>
            <div class="usuario-actions">
                <select onchange="cambiarRol('${u.uid}', this.value)">
                    <option value="usuario" ${u.rol !== 'admin' ? 'selected' : ''}>Usuario</option>
                    <option value="admin" ${u.rol === 'admin' ? 'selected' : ''}>Admin</option>
                </select>
                <button class="${activo ? 'off' : 'on'}" onclick="toggleActivo('${u.uid}', ${activo})">
                    ${activo ? 'Desactivar' : 'Activar'}
                </button>
                <button class="link" onclick="enviarResetPassword('${u.uid}')">Resetear clave</button>
            </div>`;
        cont.appendChild(div);
    });
}

// Crea un usuario nuevo SIN cerrar la sesión del admin actual.
// Truco: se usa una segunda instancia de Firebase App solo para el
// alta, y se descarta después. Esto es necesario porque el SDK de
// cliente de Firebase no permite crear usuarios "en nombre de otro"
// sin cerrar tu propia sesión.
function crearUsuario() {
    if (currentRol !== 'admin') return;

    const email = document.getElementById('nuevo-user-email').value.trim();
    const pass  = document.getElementById('nuevo-user-pass').value;
    const rol   = document.getElementById('nuevo-user-rol').value;
    const statusEl = document.getElementById('user-status');

    if (!email || !pass) {
        statusEl.textContent = 'Completa correo y contraseña.';
        return;
    }
    if (pass.length < 6) {
        statusEl.textContent = 'La contraseña debe tener al menos 6 caracteres.';
        return;
    }

    statusEl.textContent = 'Creando usuario...';

    const nombreApp = 'Secundaria_' + Date.now();
    const appSecundaria = firebase.initializeApp(firebaseConfig, nombreApp);

    appSecundaria.auth().createUserWithEmailAndPassword(email, pass)
        .then(cred => {
            const nuevoUid = cred.user.uid;
            return db.ref('usuarios/' + nuevoUid).set({
                email,
                rol,
                activo: true,
                creado: Date.now(),
                creadoPor: currentEmail
            });
        })
        .then(() => {
            registrarAccion('usuario_creado', `${email} (${rol})`);
            statusEl.textContent = `Usuario ${email} creado ✓`;
            document.getElementById('nuevo-user-email').value = '';
            document.getElementById('nuevo-user-pass').value = '';
        })
        .catch(err => {
            console.error(err);
            statusEl.textContent = 'Error: ' + traducirErrorAuth(err.code);
        })
        .finally(() => {
            appSecundaria.auth().signOut().finally(() => appSecundaria.delete());
        });
}

function cambiarRol(uid, nuevoRol) {
    if (currentRol !== 'admin') return;
    if (uid === currentUID && nuevoRol !== 'admin') {
        confirmar('No puedes quitarte tu propio rol de administrador desde aquí. ¿Entendido?', () => {});
        pintarUsuarios();
        return;
    }
    db.ref('usuarios/' + uid + '/rol').set(nuevoRol).then(() => {
        registrarAccion('rol_cambiado', `${uid} → ${nuevoRol}`);
        setStatus('Rol actualizado ✓', 'ok');
    }).catch(e => console.error(e));
}

function toggleActivo(uid, estadoActual) {
    if (currentRol !== 'admin') return;
    if (uid === currentUID) {
        confirmar('No puedes desactivar tu propia cuenta.', () => {});
        return;
    }
    const nuevoEstado = !estadoActual;
    const usuario = usuariosCache.find(u => u.uid === uid);
    const mensaje = nuevoEstado
        ? `¿Reactivar el acceso de ${usuario?.email || uid}?`
        : `¿Desactivar el acceso de ${usuario?.email || uid}? No podrá iniciar sesión hasta que lo reactives.`;

    confirmar(mensaje, () => {
        db.ref('usuarios/' + uid + '/activo').set(nuevoEstado).then(() => {
            registrarAccion(nuevoEstado ? 'usuario_activado' : 'usuario_desactivado', uid);
            setStatus(nuevoEstado ? 'Usuario activado ✓' : 'Usuario desactivado ✓', 'ok');
        }).catch(e => console.error(e));
    });
}

function enviarResetPassword(uid) {
    if (currentRol !== 'admin') return;
    const usuario = usuariosCache.find(u => u.uid === uid);
    if (!usuario?.email) return;

    confirmar(`¿Enviar un correo de restablecimiento de contraseña a ${usuario.email}?`, () => {
        auth.sendPasswordResetEmail(usuario.email).then(() => {
            registrarAccion('password_reset_enviado', usuario.email);
            setStatus('Correo de restablecimiento enviado ✓', 'ok');
        }).catch(() => setStatus('Error al enviar el correo de restablecimiento', 'err'));
    });
}

function traducirErrorAuth(code) {
    const mapa = {
        'auth/email-already-in-use': 'Ese correo ya está registrado.',
        'auth/invalid-email': 'Correo inválido.',
        'auth/weak-password': 'La contraseña es muy débil.'
    };
    return mapa[code] || code || 'error desconocido';
}
