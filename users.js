// ══════════════════════════════════════════════
//  GESTIÓN DE USUARIOS (solo administradores)
//  Depende de firebaseConfig, db, auth, currentRol
//  y registrarAccion(), definidos en app.js
// ══════════════════════════════════════════════

function cargarUsuarios() {
    db.ref('usuarios').on('value', snap => {
        const cont = document.getElementById('lista-usuarios');
        if (!cont) return;
        cont.innerHTML = '';

        if (!snap.exists()) {
            cont.innerHTML = '<div class="no-toques">Sin usuarios registrados</div>';
            return;
        }

        const usuarios = [];
        snap.forEach(child => usuarios.push({ uid: child.key, ...child.val() }));
        usuarios.sort((a, b) => (a.email || '').localeCompare(b.email || ''));

        usuarios.forEach(u => {
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
                </div>`;
            cont.appendChild(div);
        });
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
            // Cerrar y destruir la app secundaria para no dejar sesiones colgadas
            appSecundaria.auth().signOut().finally(() => appSecundaria.delete());
        });
}

function cambiarRol(uid, nuevoRol) {
    if (currentRol !== 'admin') return;
    if (uid === currentUID && nuevoRol !== 'admin') {
        alert('No puedes quitarte tu propio rol de administrador desde aquí.');
        cargarUsuarios();
        return;
    }
    db.ref('usuarios/' + uid + '/rol').set(nuevoRol).then(() => {
        registrarAccion('rol_cambiado', `${uid} → ${nuevoRol}`);
    }).catch(e => console.error(e));
}

function toggleActivo(uid, estadoActual) {
    if (currentRol !== 'admin') return;
    if (uid === currentUID) {
        alert('No puedes desactivar tu propia cuenta.');
        return;
    }
    const nuevoEstado = !estadoActual;
    db.ref('usuarios/' + uid + '/activo').set(nuevoEstado).then(() => {
        registrarAccion(nuevoEstado ? 'usuario_activado' : 'usuario_desactivado', uid);
    }).catch(e => console.error(e));
}

function traducirErrorAuth(code) {
    const mapa = {
        'auth/email-already-in-use': 'Ese correo ya está registrado.',
        'auth/invalid-email': 'Correo inválido.',
        'auth/weak-password': 'La contraseña es muy débil.'
    };
    return mapa[code] || code || 'error desconocido';
}
