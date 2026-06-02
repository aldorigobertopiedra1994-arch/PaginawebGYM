# Templo GYM — Versión segura con backend

Esta versión ya no guarda la contraseña del administrador en el navegador. El catálogo se carga desde un servidor Node.js y los cambios se guardan en una base de datos SQLite central.

## Seguridad implementada

- Inicio de sesión del administrador verificado en el servidor.
- Contraseña almacenada únicamente como hash `bcrypt`.
- Sesión con cookie `HttpOnly`, `SameSite=Lax` y `Secure` en producción.
- Protección CSRF para acciones de administración.
- Límite de intentos de inicio de sesión.
- Cabeceras de seguridad con Helmet y CSP sin JavaScript inline.
- Validación de imágenes: JPG, PNG o WEBP, máximo 2 MB.
- Edición, creación, eliminación y ocultación de precios desde la base de datos.

## Requisitos

Instala **Node.js 22.5 o superior**.

## Probar en tu computadora

1. Copia `.env.example` como `.env`.
2. Edita `.env` y cambia `SESSION_SECRET` por una cadena larga y aleatoria de al menos 32 caracteres.
3. Instala dependencias:

```bash
npm install
```

4. Crea el usuario administrador y su contraseña. La contraseña solo se cifra en la base de datos; no aparecerá en la página:

```bash
npm run admin:create -- admin "TuClaveSegura123!"
```

5. Inicia la página:

```bash
npm start
```

6. Abre en el navegador:

```text
http://localhost:3000
```

## Carpetas importantes

```text
public/                 Interfaz visible para clientes
public/js/app.js        Lógica del navegador, sin contraseña admin
server.js               API, sesiones, seguridad y servidor web
src/db.js               Base de datos SQLite
data/seed-products.json Productos iniciales
data/runtime/           Base de datos creada al ejecutar; no subir a GitHub
storage/uploads/        Imágenes nuevas subidas desde admin
```

## Subir a GitHub

No subas `.env`, `data/runtime/` ni imágenes privadas. Ya están excluidas con `.gitignore`.

```bash
git init
git add .
git commit -m "Version segura Templo GYM"
git branch -M main
git remote add origin URL_DE_TU_REPOSITORIO
git push -u origin main
```

## Publicarlo en un hosting Node.js

Configura las variables:

```text
NODE_ENV=production
SESSION_SECRET=un_secreto_largo_y_unico
DATA_DIR=/ruta/persistente/data
UPLOAD_DIR=/ruta/persistente/uploads
```

**Importante:** la base de datos y las imágenes nuevas necesitan almacenamiento persistente. En un hosting sin disco persistente, los cambios pueden borrarse al reiniciar el servicio. Monta un disco persistente o migra la base a PostgreSQL antes del lanzamiento definitivo.

Después del primer despliegue, ejecuta una sola vez:

```bash
npm run admin:create -- admin "TuClaveSegura123!"
```

No escribas tu contraseña real en GitHub ni en archivos públicos.

## Imágenes del catálogo

Los 230 productos iniciales cargan su fotografía desde internet mediante miniaturas públicas basadas en el nombre, marca y presentación del producto, igual que en la versión anterior. Si una imagen externa no carga, la interfaz muestra automáticamente el logo local como respaldo.

Las imágenes nuevas que subas desde el panel administrador se guardan en `storage/uploads/`.
