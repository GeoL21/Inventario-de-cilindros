# Inventario de cilindros — Clínica Reina Catalina

PWA para registrar el inventario de cilindros por sede (Barranquilla y Baranoa). Funciona sin señal: los registros quedan en el celular y se suben solos al volver la conexión.

## Archivos

- `index.html`, `app.js`, `sw.js`, `manifest.webmanifest`, `config.js`, logo, íconos y letra → van al repositorio de GitHub.
- `apps-script/Code.gs` y `apps-script/appsscript.json` → van al Apps Script de la hoja.

## Paso 1: Apps Script (desde el PC)

1. Abre la hoja **Inventario de cilindros - CRC**.
2. Menú **Extensiones → Apps Script**.
3. Borra lo que haya en `Código.gs` y pega todo el contenido de `apps-script/Code.gs`. Guarda.
4. **Implementar → Nueva implementación → Aplicación web**:
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier usuario**
5. Autoriza los permisos y copia la URL que termina en `/exec`.

## Paso 2: Configurar la app

Abre `config.js` y reemplaza `PEGA_AQUI_LA_URL_DE_APPS_SCRIPT/exec` por la URL copiada.

## Paso 3: Publicar en GitHub Pages

1. Crea el repositorio `Inventario-de-cilindros` (público).
2. Sube todos los archivos de la raíz (no hace falta subir la carpeta `apps-script`).
3. **Settings → Pages → Branch: main / (root)**.
4. Abre el link en el celular, entra con el código de acceso y toca el botón de instalar.

## Cambiar opciones sin tocar código

Todo se cambia en la pestaña **Config** de la hoja: técnicos por sede, empresas, gases, capacidades, años para vencer la prueba hidrostática y el código de acceso (`cilindrocrc`). La app lo toma al sincronizar.

## Si cambias archivos de la app

Sube el número de `VERSION` en `sw.js` (por ejemplo `inv-cilindros-v2`) para que los celulares descarguen la versión nueva.
