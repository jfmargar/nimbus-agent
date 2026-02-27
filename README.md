# NimbusAgent

NimbusAgent es una app de macOS en la barra de menús que empaqueta y ejecuta un bot de Telegram basado en **AIPAL** con runtime embebido (`Node` + código del agente). El repo ya incluye ese runtime bajo `Embedded/`, así que el flujo normal de trabajo no requiere un checkout separado de AIPAL.

Su objetivo principal es operar sesiones de agentes desde Telegram, con integración real con **Codex** para compartir proyectos y conversaciones entre:

- `Codex app -> bot de Telegram`
- `bot de Telegram -> Codex app`

## Qué hace la app

- Inicia y detiene el agente desde el menú de macOS.
- Abre ventanas de **Configuración** y **Diagnóstico**.
- Ejecuta **preflight** antes de arrancar para validar requisitos locales.
- Muestra logs recientes y permite copiarlos para soporte.
- Guarda secretos y ajustes de forma separada:
  - `TELEGRAM_BOT_TOKEN` en Keychain.
  - resto de settings en `~/Library/Application Support/NimbusAgent/settings.json`.

## Qué hay en el repo

- `NimbusAgent/`: app macOS, UI, preflight y arranque del proceso embebido.
- `Embedded/aipal/`: copia embebida y versionada del bot AIPAL que arranca la app.
- `Embedded/runtime/node`: binario de Node que usa la app en tiempo de ejecución.
- `scripts/prepare_embedded_runtime.sh`: script de mantenimiento para refrescar `Embedded/` desde una fuente externa de AIPAL y desde un Node local.

Origen del agente integrado:

- repositorio original: [antoniolg/aipal](https://github.com/antoniolg/aipal)

## Cómo funciona con Codex

Nimbus usa `codex` como agente principal para trabajar con proyectos y sesiones locales.

### Sesiones compartidas

La integración actual está pensada para que una misma conversación pueda continuar indistintamente desde Telegram o desde Codex app.

Reglas actuales:

- El bot descubre sesiones locales de Codex leyendo `CODEX_HOME` o `~/.codex`.
- Los proyectos se resuelven desde el `cwd` de las sesiones de Codex.
- La selección de proyecto y sesión se guarda **por topic/chat/agente**, no de forma global.
- Cuando el bot crea una sesión nueva para Codex, intenta crear una sesión visible para Codex app.
- Cuando el bot continúa una sesión ya existente, reutiliza el `thread_id` de esa sesión.

Limitación conocida de Codex app:

- Si Codex app ya está abierta, puede no refrescar inmediatamente los mensajes o conversaciones que avanzan desde Telegram.
- Esa falta de refresco no bloquea el flujo real de trabajo: puedes seguir usando Telegram normalmente y, al abrir o reiniciar Codex app más tarde, continuar desde la sesión compartida en el punto en que quedó.

### Flujo de Telegram para Codex

1. Abrir `/menu`.
2. Entrar en `Projects`.
3. Elegir un proyecto detectado desde sesiones locales de Codex.
4. Elegir una acción:
   - `Continuar última sesión`
   - `Crear nueva sesión`
5. Enviar el siguiente mensaje.

Comportamiento:

- `Continuar última sesión`: conecta la última sesión de ese proyecto.
- `Crear nueva sesión`: deja preparado el topic para que el siguiente mensaje cree una sesión nueva en ese proyecto.
- El topic recuerda su proyecto y su sesión activa sin pisar otros topics.

### Prompt limpio para sesiones compartidas

Para que la conversación siga siendo legible en Codex app, las sesiones compartidas de `codex` usan un prompt mínimo.

Eso significa que **ya no** se inyecta en la sesión de Codex:

- bootstrap interno,
- `memory.md`,
- thread memory,
- memory retrieval,
- instrucciones largas de formato para Telegram.

En las sesiones compartidas de Codex se envía solo:

- el texto real del usuario,
- la transcripción limpia del audio si aplica,
- contexto puntual de imágenes o documentos si existen,
- contexto puntual de scripts si el turno lo necesita.

## Requisitos de la máquina

Para que NimbusAgent funcione correctamente en una máquina nueva, necesitas:

### Obligatorios

- macOS
- Xcode para compilar la app
- `codex` disponible en `PATH`
- un token válido de bot de Telegram

### Recomendados / opcionales según uso

- un comando de transcripción compatible para audio

### Solo para mantenimiento del runtime embebido

Estos requisitos no son necesarios para compilar o ejecutar la app si `Embedded/` ya está poblado:

- un runtime local de Node si quieres reemplazar `Embedded/runtime/node`
- un checkout externo de AIPAL si quieres refrescar `Embedded/aipal`

## Dependencias externas

### 1. Codex CLI

Nimbus valida en preflight que `codex` exista en `PATH`.

Qué se usa:

- creación y reanudación de sesiones
- lectura de proyectos/sesiones locales
- interoperabilidad con Codex app

Validación:

```bash
command -v codex
codex --help
```

Si Nimbus no lo encuentra, el preflight falla.

### 2. Comando de transcripción de audio

Nimbus/AIPAL usa `AIPAL_WHISPER_CMD` para transcribir audios de Telegram antes de enviarlos al agente.

Valor por defecto actual:

- `parakeet-mlx`

También puedes configurar otro comando compatible desde Ajustes si quieres cambiarlo.

Validación:

```bash
command -v parakeet-mlx
```

Si no existe, el preflight muestra warning y la transcripción de audio puede fallar.

### 3. Runtime embebido versionado

La app no depende de un `node` global en tiempo de ejecución. Arranca directamente:

- `Embedded/runtime/node`
- `Embedded/aipal/src/index.js`

El preflight valida:

- runtime Node embebido
- entrypoint de AIPAL
- `codex` en `PATH`
- comando de transcripción si está configurado

## Configuración

### General

- `TELEGRAM_BOT_TOKEN`: token del bot de Telegram (se guarda en Keychain).
- `ALLOWED_USERS` (CSV): restringe usuarios permitidos; si está vacío, el bot queda abierto.
- `AIPAL_DROP_PENDING_UPDATES`: evita procesar mensajes pendientes al arrancar.
- `AIPAL_AGENT_CWD`: carpeta de trabajo por defecto del agente.

Notas:

- Si `AIPAL_AGENT_CWD` está vacío, AIPAL usa su fallback por defecto.
- En el caso de `codex`, el proyecto activo real se resuelve por topic/sesión; `AIPAL_AGENT_CWD` actúa como valor por defecto, no como estado principal compartido.
- Nimbus fuerza `CODEX_HOME` a `~/.codex` si no viene definido, para compartir sesiones con Codex app.

### Avanzado

Valores por defecto actuales:

- `AIPAL_WHISPER_CMD`: `parakeet-mlx`
- `AIPAL_SCRIPT_TIMEOUT_MS`: `120000`
- `AIPAL_AGENT_TIMEOUT_MS`: `600000`
- `AIPAL_AGENT_MAX_BUFFER`: `10485760`
- `AIPAL_MEMORY_CURATE_EVERY`: `20`
- `AIPAL_MEMORY_RETRIEVAL_LIMIT`: `8`
- `AIPAL_SHUTDOWN_DRAIN_TIMEOUT_MS`: `120000`

## Diagnóstico

La pestaña de diagnóstico muestra:

- Estado del proceso (`Detenido`, `Iniciando`, `Activo`, `Deteniendo`, `Error`).
- Errores y warnings de preflight.
- Logs recientes del proceso.
- Botón para copiar diagnóstico completo.

Ejemplos de detalles útiles:

- ruta del runtime Node embebido
- ruta del entrypoint de AIPAL
- ruta resuelta de `codex`
- ruta del comando de transcripción

## Capturas

### Menú de barra

![Menú de Nimbus](docs/images/nimbus-menu.png)

### Configuración general

![Configuración general](docs/images/nimbus-config-general.png)

### Configuración avanzada

![Configuración avanzada](docs/images/nimbus-config-avanzado.png)

### Diagnóstico y logs

![Diagnóstico y logs](docs/images/nimbus-diagnostico.png)

## Preparación del runtime embebido

Este paso no es obligatorio para el uso normal del repo. Úsalo solo si quieres refrescar el contenido de `Embedded/` desde un checkout externo de AIPAL o reemplazar el binario embebido de Node.

Comando:

```bash
./scripts/prepare_embedded_runtime.sh
```

El script:

- copia AIPAL dentro de `Embedded/aipal`,
- instala dependencias de producción si faltan en el checkout fuente,
- copia un binario local de Node en `Embedded/runtime/node`.

Variables opcionales:

- `AIPAL_SRC`: ruta absoluta del repo de AIPAL (por defecto `../../aipal`)
- `NIMBUS_NODE_BIN`: ruta absoluta al binario de Node a embeber

## Instalación / puesta en marcha en una máquina nueva

Pasos recomendados:

1. Instalar `codex` y comprobar que está en `PATH`.
2. Instalar o configurar el comando de transcripción que vayas a usar (`parakeet-mlx` por defecto).
3. Abrir `NimbusAgent.xcodeproj` en Xcode.
4. Compilar y ejecutar la app.
5. Abrir **Configuración** y rellenar:
   - `TELEGRAM_BOT_TOKEN`
   - `ALLOWED_USERS`
   - `AIPAL_AGENT_CWD` si quieres un cwd por defecto
   - `AIPAL_WHISPER_CMD` si no usas `parakeet-mlx`
6. Ejecutar **Validar**.
7. Arrancar el agente desde el menú.

Solo si `Embedded/` estuviera vacío, corrupto o quieres sincronizarlo con otra versión de AIPAL, ejecuta antes:

```bash
./scripts/prepare_embedded_runtime.sh
```

## Desarrollo

### App macOS

1. Abrir `NimbusAgent.xcodeproj` en Xcode.
2. Compilar y ejecutar el target de la app.
3. Usar la vista de diagnóstico para revisar logs del agente embebido.

### Runtime embebido de AIPAL

Si quieres trabajar directamente sobre el bot embebido:

1. Entra en `Embedded/aipal`.
2. Usa Node 24+.
3. Ejecuta `npm start` para levantarlo fuera de la app.

Notas:

- ese runtime sigue asumiendo herramientas tipo Unix (`bash`, `python3`, `sqlite3`) para varias rutas de ejecución;
- el script `prepare_embedded_runtime.sh` es un flujo de mantenimiento, no un prerrequisito para editar la app cuando `Embedded/` ya está correcto.

## Notas operativas

- `ALLOWED_USERS` vacío deja el bot abierto a cualquier usuario de Telegram.
- Si `codex` no está en `PATH`, Nimbus no debería arrancarse en producción.
- Si `AIPAL_WHISPER_CMD` no existe en `PATH`, el resto del bot funciona, pero el audio puede fallar.
- Las sesiones de Codex viven en `CODEX_HOME` o `~/.codex`.
- El bot utiliza esas sesiones para listar proyectos, continuar conversaciones y crear nuevas sesiones visibles en Codex app.
