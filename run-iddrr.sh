#!/usr/bin/env bash
# =============================================================================
# IDDRR Agents — Orquestador MVP
# Ejecuta el flujo IDDRR Type A: I → D2 → R1 → R2
# Usa Claude CLI como runtime para cada agente
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ─────────────────────────────────────────────────────────────────────────────
# Determinar PROJECT_DIR: directorio del proyecto donde se guardan artefactos.
# Prioridad: --project-dir > pwd (si tiene estructura IDDRR) > SCRIPT_DIR
# ─────────────────────────────────────────────────────────────────────────────
PROJECT_DIR=""

# Extraer --project-dir si se pasó como primer argumento
if [ "${1:-}" = "--project-dir" ]; then
  if [ -z "${2:-}" ]; then
    echo "Error: --project-dir requiere una ruta."
    exit 1
  fi
  PROJECT_DIR="$2"
  shift 2
elif [ -d "$(pwd)/config" ] && [ -d "$(pwd)/state" ]; then
  # El directorio actual tiene estructura IDDRR → usarlo como proyecto
  PROJECT_DIR="$(pwd)"
else
  # Fallback: usar el directorio del script
  PROJECT_DIR="$SCRIPT_DIR"
fi

CONFIG_DIR="$PROJECT_DIR/config"
STATE_DIR="$PROJECT_DIR/state"
QUEUE_DIR="$STATE_DIR/queue"
MEMORY_DIR="$STATE_DIR/memory"
PROMPTS_DIR="$CONFIG_DIR/prompts"
LOG_FILE="$STATE_DIR/agents_log.md"

# Asegurar que existan los directorios de estado
mkdir -p "$QUEUE_DIR" "$MEMORY_DIR/archive"

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Timestamp
now() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
today() { date +"%Y-%m-%d"; }
task_id="task-$(date +%s)"
msg_counter=0
next_msg_id() { msg_counter=$((msg_counter + 1)); echo "msg-$(today)-$(printf '%03d' $msg_counter)"; }

# -----------------------------------------------------------------------------
# Utilidades
# -----------------------------------------------------------------------------

log_phase() {
  local phase="$1"
  local msg="$2"
  echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
  echo -e "${YELLOW}  FASE $phase${NC} — $msg"
  echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
}

log_agent() {
  local agent="$1"
  local msg="$2"
  echo -e "  ${BLUE}[$agent]${NC} $msg"
}

log_ok() {
  echo -e "  ${GREEN}✓${NC} $1"
}

log_err() {
  echo -e "  ${RED}✗${NC} $1"
}

# Guarda un mensaje JSON en la cola
save_message() {
  local msg_id
  msg_id=$(next_msg_id)
  local from="$1" to="$2" type="$3" phase="$4" status="$5" summary="$6"
  local detail="${7:-}" files="${8:-[]}" learnings="${9:-[]}"

  cat > "$QUEUE_DIR/$msg_id.json" <<JSONEOF
{
  "message_id": "$msg_id",
  "from": "$from",
  "to": "$to",
  "type": "$type",
  "priority": "normal",
  "timestamp": "$(now)",
  "payload": {
    "task_id": "$task_id",
    "phase": "$phase",
    "status": "$status",
    "summary": "$summary",
    "detail": "$detail",
    "options": [],
    "requires_user_input": false
  },
  "context": {
    "tokens_used": 0,
    "files_modified": $files,
    "learnings": $learnings
  }
}
JSONEOF
  echo "$msg_id"
}

# Llama a Claude CLI con un prompt de sistema y un prompt de usuario
# Retorna la respuesta
call_claude() {
  local system_prompt_file="$1"
  local user_prompt="$2"
  local system_prompt
  system_prompt=$(cat "$system_prompt_file")

  # Construir el prompt completo incluyendo memoria y contexto
  local full_prompt="$user_prompt"

  claude -p "$full_prompt" --system-prompt "$system_prompt" --output-format text 2>/dev/null
}

# -----------------------------------------------------------------------------
# MAIN
# -----------------------------------------------------------------------------

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║        IDDRR AGENTS — MVP Orquestador           ║${NC}"
echo -e "${GREEN}║        Flujo: I → D2 → R1 → R2                 ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════╝${NC}"
echo ""

# Verificar que claude CLI está disponible
if ! command -v claude &> /dev/null; then
  log_err "Claude CLI no encontrado. Instala claude: https://docs.anthropic.com/en/docs/claude-code"
  exit 1
fi

# Recibir requerimiento
if [ $# -gt 0 ]; then
  REQUIREMENT="$*"
else
  echo -e "${YELLOW}Ingresa tu requerimiento:${NC}"
  read -r REQUIREMENT
fi

if [ -z "$REQUIREMENT" ]; then
  log_err "Requerimiento vacío. Uso: ./run-iddrr.sh \"Add search to UserTable\""
  exit 1
fi

echo -e "\n${BLUE}Requerimiento:${NC} $REQUIREMENT"
echo -e "${BLUE}Task ID:${NC} $task_id\n"

# =============================================================================
# FASE I — IDEACIÓN (Supervisor clasifica)
# =============================================================================
log_phase "I" "Ideación — Supervisor clasifica el requerimiento"

MATRIX=$(cat "$CONFIG_DIR/matrix.json" 2>/dev/null || echo '{"agents": [], "executors": []}')
SUPERVISOR_MEMORY=$(cat "$MEMORY_DIR/supervisor.md" 2>/dev/null || echo "# Supervisor Memory (new)")

CLASSIFY_PROMPT="Requerimiento del usuario: \"$REQUIREMENT\"

Configuración de agentes disponible (matrix.json):
$MATRIX

Tu memoria actual:
$SUPERVISOR_MEMORY

Clasifica este requerimiento. Responde SOLO con JSON válido, sin markdown ni texto adicional:
{
  \"type\": \"A|B|C|D|E|F\",
  \"confidence\": 0.0-1.0,
  \"reasoning\": \"una línea explicando por qué\",
  \"suggested_agent\": \"id del agente de matrix.json\",
  \"estimated_complexity\": \"low|medium|high\"
}"

log_agent "Supervisor" "Clasificando requerimiento..."
CLASSIFICATION=$(call_claude "$PROMPTS_DIR/supervisor.md" "$CLASSIFY_PROMPT")

echo -e "\n  ${BLUE}Clasificación:${NC}"
echo "$CLASSIFICATION" | sed 's/^/    /'

# Extraer tipo y agente del JSON
REQ_TYPE=$(echo "$CLASSIFICATION" | grep -o '"type"[[:space:]]*:[[:space:]]*"[A-F]"' | grep -o '[A-F]' || echo "A")
AGENT=$(echo "$CLASSIFICATION" | grep -o '"suggested_agent"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*"suggested_agent"[[:space:]]*:[[:space:]]*"//' | sed 's/"//' || echo "ui-agent-001")

log_ok "Tipo: $REQ_TYPE | Agente: $AGENT"

# Guardar mensaje de clasificación
save_message "supervisor-001" "$AGENT" "task_request" "I" "pending" "$REQUIREMENT" > /dev/null

# =============================================================================
# CONSULTAR AL USUARIO
# =============================================================================
echo ""
echo -e "${YELLOW}Tipo $REQ_TYPE detectado. Agente asignado: $AGENT${NC}"
echo -e "${YELLOW}¿Procedo? [s = sí / d = delegar todo / n = cancelar]${NC}"
read -r USER_CHOICE

case "$USER_CHOICE" in
  d|D)
    DELEGATE_ALL=true
    log_ok "Modo 'delegar todo' activado"
    ;;
  s|S|"")
    DELEGATE_ALL=false
    log_ok "Modo paso a paso"
    ;;
  *)
    log_err "Cancelado por el usuario"
    exit 0
    ;;
esac

# =============================================================================
# FASE I cont. — UI Agent analiza y diseña
# =============================================================================
log_phase "I" "Ideación — UI Agent analiza y diseña solución"

UI_MEMORY=$(cat "$MEMORY_DIR/ui-agent.md" 2>/dev/null || echo "# UI Agent Memory (new)")

# Listar archivos del proyecto para contexto
PROJECT_FILES=""
if [ -d "$PROJECT_DIR/src" ] && [ "$(ls -A "$PROJECT_DIR/src" 2>/dev/null)" ]; then
  PROJECT_FILES=$(find "$PROJECT_DIR/src" -type f -name "*.tsx" -o -name "*.ts" -o -name "*.jsx" -o -name "*.js" 2>/dev/null | head -20)
fi

IDEATION_PROMPT="Has recibido una tarea del Supervisor:

Requerimiento: \"$REQUIREMENT\"
Tipo clasificado: $REQ_TYPE
Task ID: $task_id

Archivos del proyecto en src/:
$PROJECT_FILES

Tu memoria actual:
$UI_MEMORY

Analiza el requerimiento y diseña una solución de alto nivel.
Si hay archivos relevantes en src/, léelos mentalmente.
NO implementes código. Solo diseña.

Responde SOLO con JSON válido, sin markdown ni texto adicional:
{
  \"phase\": \"I\",
  \"status\": \"completed\",
  \"design\": {
    \"summary\": \"Resumen de la solución en 1-2 líneas\",
    \"changes_needed\": [\"cambio 1\", \"cambio 2\"],
    \"files_to_modify\": [\"archivo1.tsx\"],
    \"files_to_create\": [],
    \"dependencies\": [],
    \"risks\": []
  },
  \"skip_d1\": true,
  \"reason_skip_d1\": \"Type A sin ambigüedad\"
}"

log_agent "UI Agent" "Analizando requerimiento y diseñando solución..."
DESIGN=$(call_claude "$PROMPTS_DIR/ui-agent.md" "$IDEATION_PROMPT")

echo -e "\n  ${BLUE}Diseño:${NC}"
echo "$DESIGN" | sed 's/^/    /'

save_message "ui-agent-001" "supervisor-001" "task_update" "I" "completed" "Diseño completado" > /dev/null

log_ok "Fase I completada"

# =============================================================================
# FASE D1 — DISEÑO (se salta para Type A)
# =============================================================================
if [ "$REQ_TYPE" = "A" ]; then
  log_phase "D1" "Diseño — Saltada (Type A, sin ambigüedad)"
  log_ok "Pasando directamente a Desarrollo"
else
  log_phase "D1" "Diseño — Requiere decisión del usuario"
  echo -e "${YELLOW}El agente presenta opciones. Revisa el diseño arriba.${NC}"
  if [ "$DELEGATE_ALL" = false ]; then
    echo -e "${YELLOW}¿Continuar con este diseño? [s/n]${NC}"
    read -r D1_CHOICE
    if [ "$D1_CHOICE" != "s" ] && [ "$D1_CHOICE" != "S" ] && [ "$D1_CHOICE" != "" ]; then
      log_err "Cancelado. Reformula el requerimiento."
      exit 0
    fi
  fi
fi

# =============================================================================
# FASE D2 — DESARROLLO (React Executor implementa)
# =============================================================================
log_phase "D2" "Desarrollo — React Executor implementa"

DEVELOP_PROMPT="Eres el React Executor. Implementa lo siguiente:

Requerimiento original: \"$REQUIREMENT\"
Task ID: $task_id

Diseño del UI Agent:
$DESIGN

Directorio del proyecto: $PROJECT_DIR/src/

Archivos existentes en src/:
$PROJECT_FILES

INSTRUCCIONES:
1. Implementa exactamente lo que pide el diseño
2. Si necesitas crear archivos nuevos, indica la ruta completa y contenido
3. Si necesitas modificar archivos existentes, muestra el diff unificado
4. Incluye tests básicos si aplica
5. Usa React 18 + TypeScript

Responde SOLO con JSON válido, sin markdown ni texto adicional:
{
  \"phase\": \"D2\",
  \"status\": \"completed\",
  \"implementation\": {
    \"files_created\": [
      {
        \"path\": \"src/components/Example.tsx\",
        \"content\": \"... código completo ...\"
      }
    ],
    \"files_modified\": [
      {
        \"path\": \"src/components/Existing.tsx\",
        \"diff\": \"... diff unificado ...\"
      }
    ],
    \"tests\": [
      {
        \"path\": \"src/components/__tests__/Example.test.tsx\",
        \"content\": \"... código de test ...\"
      }
    ]
  },
  \"summary\": \"Descripción de lo implementado\",
  \"learnings\": []
}"

log_agent "React Executor" "Implementando..."
IMPLEMENTATION=$(call_claude "$PROMPTS_DIR/executor-react.md" "$DEVELOP_PROMPT")

echo -e "\n  ${BLUE}Implementación:${NC}"
echo "$IMPLEMENTATION" | sed 's/^/    /'

# Escribir archivos generados al disco
log_agent "React Executor" "Escribiendo archivos..."

# Extraer files_created del JSON y escribirlos
# Usamos un enfoque simple: pedimos a Claude que escriba los archivos
WRITE_PROMPT="Dado este JSON de implementación, genera un script bash que cree los archivos.
Solo genera comandos mkdir -p y cat <<'FILEOF' > path ... FILEOF.
No incluyas nada más, solo el script bash puro sin \`\`\` ni explicaciones.

JSON:
$IMPLEMENTATION

Directorio base: $PROJECT_DIR/src"

WRITE_SCRIPT=$(call_claude "$PROMPTS_DIR/executor-react.md" "$WRITE_PROMPT")

# Ejecutar el script de escritura si no está vacío
if [ -n "$WRITE_SCRIPT" ]; then
  log_agent "React Executor" "Creando archivos en src/..."
  # Crear src si no existe
  mkdir -p "$PROJECT_DIR/src"
  # Ejecutar en el contexto correcto
  (cd "$PROJECT_DIR" && eval "$WRITE_SCRIPT" 2>/dev/null) || log_err "Algunos archivos no pudieron crearse (revisar manualmente)"
fi

save_message "react-executor" "ui-agent-001" "delegate_result" "D2" "completed" "Implementación completada" > /dev/null

log_ok "Fase D2 completada"

# =============================================================================
# FASE R1 — REFACTORIZACIÓN (UI Agent revisa)
# =============================================================================
log_phase "R1" "Refactorización — UI Agent revisa el código"

# Listar archivos creados/modificados
NEW_FILES=""
if [ -d "$PROJECT_DIR/src" ] && [ "$(ls -A "$PROJECT_DIR/src" 2>/dev/null)" ]; then
  NEW_FILES=$(find "$PROJECT_DIR/src" -type f \( -name "*.tsx" -o -name "*.ts" \) -newer "$LOG_FILE" 2>/dev/null | head -20)
fi

# Leer contenido de archivos nuevos para revisión
FILES_CONTENT=""
if [ -n "$NEW_FILES" ]; then
  while IFS= read -r f; do
    if [ -f "$f" ]; then
      FILES_CONTENT="$FILES_CONTENT
--- $f ---
$(cat "$f")
"
    fi
  done <<< "$NEW_FILES"
fi

REFACTOR_PROMPT="Revisa el código implementado por el React Executor.

Requerimiento original: \"$REQUIREMENT\"
Task ID: $task_id

Diseño aprobado:
$DESIGN

Código implementado:
$IMPLEMENTATION

Archivos en disco:
$FILES_CONTENT

Revisa:
1. ¿El código cumple con el diseño?
2. ¿Hay errores obvios?
3. ¿Se necesita refactoring?
4. ¿Performance es aceptable?

Responde SOLO con JSON válido, sin markdown ni texto adicional:
{
  \"phase\": \"R1\",
  \"status\": \"completed\",
  \"review\": {
    \"quality_score\": 0.0-1.0,
    \"meets_design\": true,
    \"issues_found\": [],
    \"refactor_needed\": false,
    \"refactor_instructions\": \"\",
    \"performance_notes\": \"\"
  },
  \"learnings\": []
}"

log_agent "UI Agent" "Revisando implementación..."
REVIEW=$(call_claude "$PROMPTS_DIR/ui-agent.md" "$REFACTOR_PROMPT")

echo -e "\n  ${BLUE}Revisión:${NC}"
echo "$REVIEW" | sed 's/^/    /'

# Verificar si necesita refactor
NEEDS_REFACTOR=$(echo "$REVIEW" | grep -o '"refactor_needed"[[:space:]]*:[[:space:]]*true' || echo "")

if [ -n "$NEEDS_REFACTOR" ]; then
  log_err "Se necesita refactoring. En el MVP, reportamos el issue y continuamos."
  # En futuras versiones: volver a D2 con instrucciones de corrección
else
  log_ok "Código aprobado, sin refactoring necesario"
fi

save_message "ui-agent-001" "supervisor-001" "task_update" "R1" "completed" "Revisión completada" > /dev/null

log_ok "Fase R1 completada"

# =============================================================================
# FASE R2 — RELEASE (Supervisor cierra y actualiza memoria)
# =============================================================================
log_phase "R2" "Release — Supervisor cierra tarea y actualiza memoria"

# Actualizar agents_log.md
RELEASE_DATE=$(today)
cat >> "$LOG_FILE" <<LOGEOF

## $RELEASE_DATE

### $task_id: $REQUIREMENT
- **Tipo:** $REQ_TYPE
- **Agente:** $AGENT
- **Executor:** react-executor
- **Estado:** ✓ Completado
- **Fases:** I → D2 → R1 → R2
- **Clasificación:** $CLASSIFICATION
- **Diseño:** $(echo "$DESIGN" | tr '\n' ' ' | cut -c1-200)
- **Revisión:** $(echo "$REVIEW" | tr '\n' ' ' | cut -c1-200)
LOGEOF

log_ok "agents_log.md actualizado"

# Actualizar memoria del UI Agent con learnings
MEMORY_UPDATE_PROMPT="Actualiza la memoria del UI Agent basándote en esta tarea completada.

Tarea: \"$REQUIREMENT\"
Tipo: $REQ_TYPE
Diseño: $DESIGN
Revisión: $REVIEW

Memoria actual del UI Agent:
$UI_MEMORY

Genera la memoria actualizada COMPLETA (no solo los cambios).
Incrementa los contadores de stats.
Agrega cualquier learning nuevo.
Responde SOLO con el contenido markdown para el archivo de memoria, sin \`\`\` ni envolturas."

log_agent "Supervisor" "Actualizando memoria del UI Agent..."
UPDATED_MEMORY=$(call_claude "$PROMPTS_DIR/supervisor.md" "$MEMORY_UPDATE_PROMPT")

if [ -n "$UPDATED_MEMORY" ]; then
  echo "$UPDATED_MEMORY" > "$MEMORY_DIR/ui-agent.md"
  log_ok "Memoria del UI Agent actualizada"
fi

# Resumen final
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║              TAREA COMPLETADA                    ║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║${NC} Task:    $task_id"
echo -e "${GREEN}║${NC} Tipo:    $REQ_TYPE"
echo -e "${GREEN}║${NC} Agente:  $AGENT"
echo -e "${GREEN}║${NC} Fases:   I → D2 → R1 → R2"
echo -e "${GREEN}╚══════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}Archivos del proyecto:${NC}"
if [ -d "$PROJECT_DIR/src" ]; then
  find "$PROJECT_DIR/src" -type f 2>/dev/null | sed 's/^/  /'
fi
echo ""
echo -e "${BLUE}Log:${NC} $LOG_FILE"
echo -e "${BLUE}Memoria:${NC} $MEMORY_DIR/"
echo -e "${BLUE}Cola:${NC} $QUEUE_DIR/"
echo ""
