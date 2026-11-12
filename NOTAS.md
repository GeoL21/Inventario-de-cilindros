# Inventario de cilindros — Notas para Claude

## Qué es
PWA para el inventario de cilindros de Clínica Reina Catalina, por sede (Barranquilla y Baranoa).
Cilindros propios de la clínica y de Messer, con opción de escribir otra empresa.
Gases: oxígeno, nitrógeno, dioxicarbomed, oxígeno portátil y aire, con opción de agregar otro.

## Dónde vive cada parte
- Código de la PWA: este repo, publicado en GitHub Pages.
- Servidor: `apps-script/Code.gs` de este repo, pegado en el Apps Script de la hoja.
  La URL del servidor está en `config.js`.
- Datos: hoja "Inventario de cilindros - CRC", con pestañas `Registros`, `Inventario actual` y `Config`.
- La hoja y su Apps Script viven en la cuenta cilindrocrc@gmail.com (migrada el 12/11/2026).
  La copia vieja de geoortiz89@gmail.com ya no se usa.
- Salidas a llenado (pestaña Llenado de la app): hojas `Llenados` (un lote por fila) y `Llenados cilindros`
  (un cilindro por fila). Fotos de remisiones en la carpeta "Inventario de cilindros - Remisiones" de cilindrocrc,
  puestas en la hoja como chip de Drive (servicio avanzado Google Sheets API; si falta, queda un enlace "Remisión").
  Alerta cuando un lote pasa de 14 días afuera. Regreso cilindro por cilindro; los que no llegan dejan el lote abierto.
- Borrar (papelera en cada cilindro del Inventario): solo con el "Código de administrador" de Config, que se pide
  cada vez. No elimina filas: marca la columna "Borrado" de Registros e Inventario actual.
- Vencimiento del gas (mes/año de la etiqueta): columna "Vence gas" (18) en Registros e Inventario actual y col. 7 en
  Llenados cilindros. Se pide al cerrar un regreso (uno por lote, se puede cambiar por cilindro) y es opcional en Registrar
  si está Lleno. Aviso 30 días antes; solo cuenta en cilindros llenos.
- Técnicos, empresas, gases, capacidades y años de la prueba hidrostática se cambian en la pestaña `Config`.

## Reglas que no se cambian
- Registro ágil con botones, sin desplegables. Lo más rápido posible al registrar.
- Serial siempre en MAYÚSCULAS.
- Si dos cilindros de distinto gas tienen el mismo serial grabado, al segundo se le agrega un dígito.
  Se decidió así; no manejar serial + gas.
- Un mismo serial no se registra dos veces el mismo día, pero se puede corregir ese mismo día.
- Fecha de prueba hidrostática escrita a mano (mes/año). Alerta de vencida a los 5 años.
- Válvula nueva/vieja; pintura Buena/Regular/Mala; lleno/vacío; observación; técnico.
- Capacidad con escritura libre que recuerda las ya usadas.
- Historial + estado actual por serial.
- Funciona sin señal y sube los registros al volver la conexión.
- Todo en español, con el logo y los colores de la clínica. Letra: Plus Jakarta Sans.

## Cómo trabajar aquí
- Preguntar antes de cambiar algo y mostrar un bosquejo para aprobar.
- No romper la hoja ni los registros existentes.
- Al cambiar archivos, subir el número de `VERSION` en `sw.js`.
- Si se cambia `Code.gs`, hay que pegarlo en el Apps Script y crear una nueva versión de la implementación.
- Este repo es público: no escribir aquí códigos de acceso, claves ni nombres del personal.
