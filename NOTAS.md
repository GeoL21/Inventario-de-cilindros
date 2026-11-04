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
- OJO: esta hoja se creó en la cuenta personal geoortiz89@gmail.com, no en cilindrocrc.
  Para verla desde la cuenta cilindrocrc hay que compartirla con esa cuenta.
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
