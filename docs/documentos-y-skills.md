# Documentos y habilidades (skills)

## Cómo pedir un documento
Dilo con naturalidad: "hazme un informe sobre X en Word", "arma una presentación sobre Y", "haz una tabla de gastos en Excel",
"guarda esto como Markdown", "redacta una carta formal usando mi skill de cartas". Jarvis prepara una **tarjeta "Crear documento"**
con el título, el formato, la carpeta, la habilidad usada y el coste. Al pulsar **Crear documento** lo redacta y lo guarda.

Si no dices el formato: Word para informes y cartas, Excel para tablas, PowerPoint para presentaciones, PDF si es "para enviar/imprimir",
Markdown si son notas. También puedes decir "qué documentos has creado" y "abre el último documento" (este último pide confirmar).

## Formatos
Word (.docx), PDF, Excel (.xlsx), PowerPoint (.pptx), Markdown (.md), HTML, texto (.txt) y CSV. La extensión la fija el formato, nunca el texto.
El PDF necesita Microsoft Edge o Chrome instalados (se usa en modo invisible).

## Dónde se guardan
`Documentos\Jarvis` (el Documentos real de Windows, también si está en OneDrive). Nunca se sobrescribe: si el nombre existe se crea
`Nombre (2)`. Se guarda un índice de los últimos 200 en `docs-index.json` (carpeta de datos de Jarvis). Si el ajuste
"Abrir la carpeta al crear un documento" está activo, se abre el Explorador con el archivo seleccionado. En Ajustes > Documentos hay un
botón para abrir la carpeta y la lista de los últimos documentos con "Mostrar en carpeta".

## Costes
- **Contenido ya escrito** (lo dictas o es corto): se convierte localmente. **Sin coste de IA.**
- **Redactado con IA** (`brief`): una sola llamada al modelo de documentos (Ajustes; vacío = el modelo principal). Con Sonnet 5.5
  el peor caso son unos **$0,06 a $0,08**; con Haiku unas 20 veces menos, pero redacta peor. La tarjeta muestra "hasta ~$X" (peor caso
  con el tope de tokens) y el gasto real aparece en el contador como "Documentos".
- No hay reintentos automáticos: si el modelo devuelve algo vacío, sin estructura o hay un error (saldo, límite, tiempo), se te dice y no se crea nada.

## Límites
Título hasta 200 caracteres; encargo (`brief`) hasta 1500; texto dictado (`markdown`) hasta 8000; tope de tokens de salida 1000 a 16000
(por defecto 6000); la redacción se cancela a los 120 s; hasta 6 creaciones por minuto y una a la vez; cada tarjeta sirve una sola vez;
archivos de hasta 25 MB. Si el modelo se queda sin tokens, el documento sale cortado y Jarvis lo avisa.
El texto generado es siempre **dato**: se convierte a un documento con contenido escapado y nunca se interpreta como órdenes ni ejecuta nada.

## Crear skills
Una skill es un archivo Markdown con instrucciones (tono, estructura, secciones). Ponla en `<carpeta de datos>\skills\nombre.md` o en
`<carpeta de datos>\skills\nombre\SKILL.md` (o créala en Ajustes > Habilidades), con este encabezado:

```
---
name: carta-formal
description: Cuándo usarla, en una frase.
---
Instrucciones de estilo y estructura...
```

El nombre va en minúsculas con guiones. El índice de skills activas está en el prompt de Jarvis; si pides un documento y una encaja,
usa su nombre en `skill` y su cuerpo se inyecta como guía de estilo en la redacción (siempre acotado y saneado; no puede pedir otra cosa que
redactar el documento). Jarvis solo lee texto: nunca ejecuta código de una skill.

## Para desarrolladores
Código: `src/lib/docs/create.server.ts` (flujo), `src/lib/actions/documents.ts` (acciones y tarjeta), `src/lib/docs/cost.ts` (estimación),
`src/lib/openrouterUrl.ts` (override de URL solo para pruebas: `OPENROUTER_CHAT_URL_OVERRIDE`, http en loopback, nunca desde ajustes).
Pruebas sin gasto: `node tests/documents.mjs`. Prueba con gasto real (no se ejecuta sola): `JARVIS_LIVE=1 node tests/documents-live.mjs`.
