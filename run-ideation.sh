#!/usr/bin/env bash
# =============================================================================
# IDDRR Agents — Fase I: Ideación
# Convierte una idea en PDP.md + requirements.md
# Usa Claude CLI en modo conversacional para entrevistar al usuario
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
PROMPTS_DIR="$CONFIG_DIR/prompts"

# Asegurar que existan los directorios de estado
mkdir -p "$STATE_DIR/queue" "$STATE_DIR/memory/archive"

# Colores
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║     IDDRR AGENTS — Fase I: Ideación             ║${NC}"
echo -e "${GREEN}║     De idea vaga → PDP + Requerimientos         ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════╝${NC}"
echo ""

# Verificar Claude CLI
if ! command -v claude &> /dev/null; then
  echo "Error: Claude CLI no encontrado."
  exit 1
fi

# ─────────────────────────────────────────────────────────────────────────────
# Detectar modo:
#   --plan archivo.md               (un solo documento previo, legacy)
#   --docs archivo1.md archivo2.md  (múltiples documentos previos)
#   "idea en texto"                 (entrevista interactiva)
# ─────────────────────────────────────────────────────────────────────────────
PLAN_FILE=""
DOC_FILES=()
SKIP_INTERVIEW=false

if [ "${1:-}" = "--plan" ]; then
  # Legacy: un solo archivo
  if [ -z "${2:-}" ]; then
    echo -e "${RED}Uso: ./run-ideation.sh --plan archivo.md${NC}"
    exit 1
  fi
  PLAN_FILE="$2"
  if [ ! -f "$PLAN_FILE" ]; then
    echo -e "${RED}Error: No se encontró el archivo: $PLAN_FILE${NC}"
    exit 1
  fi
  DOC_FILES=("$PLAN_FILE")
  SKIP_INTERVIEW=true
  IDEA="(plan previo cargado desde $PLAN_FILE)"
  echo -e "${GREEN}Plan previo detectado:${NC} $PLAN_FILE"
  echo -e "${BLUE}Se saltará la entrevista y se usarán los documentos.${NC}"
  echo ""

elif [ "${1:-}" = "--docs" ]; then
  # Múltiples documentos previos (PRD, plan de implementación, etc.)
  shift
  if [ $# -eq 0 ]; then
    echo -e "${RED}Uso: ./run-ideation.sh --docs archivo1.md archivo2.md ...${NC}"
    exit 1
  fi
  for doc in "$@"; do
    if [ ! -f "$doc" ]; then
      echo -e "${RED}Error: No se encontró el archivo: $doc${NC}"
      exit 1
    fi
    DOC_FILES+=("$doc")
  done
  SKIP_INTERVIEW=true
  IDEA="(documentos previos cargados: ${DOC_FILES[*]})"
  echo -e "${GREEN}Documentos previos detectados:${NC}"
  for doc in "${DOC_FILES[@]}"; do
    echo -e "  ${BLUE}→${NC} $doc ($(wc -l < "$doc") líneas)"
  done
  echo -e "${BLUE}El agente revisará los documentos y generará PDP + requirements.${NC}"
  echo ""

else
  # Recibir idea inicial
  if [ $# -gt 0 ]; then
    IDEA="$*"
  else
    echo -e "${YELLOW}Describe tu idea (puede ser vaga, el agente te ayudará a definirla):${NC}"
    echo -e "${BLUE}Tip: Puedes indicar tecnologías, agentes, o executors preferidos.${NC}"
    echo -e "${BLUE}Ejemplo: 'Dashboard de ventas con React y Python, quiero un agente de datos'${NC}"
    echo ""
    read -r IDEA
  fi

  if [ -z "$IDEA" ]; then
    echo "Error: Idea vacía."
    exit 1
  fi
fi

echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}  Iniciando entrevista con el Ideation Agent${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
echo ""

# Leer la matriz para que el agente sepa qué agentes/executors existen
MATRIX=$(cat "$CONFIG_DIR/matrix.json" 2>/dev/null || echo '{"agents": [], "executors": []}')
IDEATION_PROMPT=$(cat "$PROMPTS_DIR/ideation-agent.md" 2>/dev/null || echo "# Ideation Agent System Prompt (missing)")

# ─────────────────────────────────────────────────────────────────────────────
# PASO 1: Entrevista conversacional
# Usamos Claude CLI en modo conversacional (-c) para mantener contexto
# ─────────────────────────────────────────────────────────────────────────────

if [ "$SKIP_INTERVIEW" = true ]; then
  # ───────────────────────────────────────────────────────────────────────────
  # Modo documentos: saltar entrevista, cargar todos los docs como contexto
  # ───────────────────────────────────────────────────────────────────────────

  # Construir bloque con todos los documentos
  ALL_DOCS_CONTENT=""
  for doc in "${DOC_FILES[@]}"; do
    doc_name=$(basename "$doc")
    doc_content=$(cat "$doc")
    ALL_DOCS_CONTENT="$ALL_DOCS_CONTENT
--- INICIO: $doc_name ---
$doc_content
--- FIN: $doc_name ---

"
  done

  CONVERSATION="El usuario ya tiene documentación previa del proyecto. NO hagas entrevista.

Revisa TODOS los documentos proporcionados. Pueden incluir:
- PRD (Product Requirements Document)
- Plan de implementación con fases
- Notas de diseño o arquitectura
- Cualquier otro documento relevante

Usa toda esta información para generar el PDP y requirements. Si hay un plan de
implementación con fases definidas, respétalo y conviértelo en requerimientos
concretos siguiendo el orden de fases propuesto.

Si detectas inconsistencias entre documentos, prioriza el más reciente o detallado.

$ALL_DOCS_CONTENT

Agentes y executors disponibles actualmente en el sistema (matrix.json):
$MATRIX

Genera el PDP directamente a partir de estos documentos."

  echo -e "${BLUE}[Ideation Agent]${NC} ${#DOC_FILES[@]} documento(s) cargado(s). Revisando y generando PDP...\n"

else
  # ───────────────────────────────────────────────────────────────────────────
  # Modo normal: entrevista conversacional
  # ───────────────────────────────────────────────────────────────────────────
  INITIAL_PROMPT="El usuario tiene esta idea:

\"$IDEA\"

Agentes y executors disponibles actualmente en el sistema (matrix.json):
$MATRIX

Empieza la entrevista. Haz 2-3 preguntas para entender mejor la idea.
Recuerda: el usuario puede indicar agentes/executors preferidos.
Si menciona tecnologías o agentes, anótalos para el PDP."

  # Lanzar conversación interactiva con Claude
  echo -e "${BLUE}[Ideation Agent]${NC} Analizando tu idea...\n"

  CONVERSATION="$INITIAL_PROMPT"
  ROUND=0
  MAX_ROUNDS=5

  while [ $ROUND -lt $MAX_ROUNDS ]; do
    ROUND=$((ROUND + 1))

    RESPONSE=$(claude -p "$CONVERSATION" \
      --system-prompt "$IDEATION_PROMPT" \
      --output-format text 2>/dev/null || true)

    if [ -z "$RESPONSE" ]; then
      echo -e "${RED}[Ideation Agent] Error al contactar con Claude. Verifica que la CLI esté autenticada.${NC}"
      exit 1
    fi

    echo -e "${BLUE}[Ideation Agent]${NC}"
    echo "$RESPONSE"
    echo ""

    if echo "$RESPONSE" | grep -qi "PDP\|generar el documento\|suficiente información\|listo para crear\|aquí.*plan\|Product Definition"; then
      echo -e "${GREEN}El agente tiene suficiente información.${NC}"
      echo -e "${YELLOW}¿Quieres ajustar algo antes de generar el PDP? [Enter = generar / texto = más contexto]${NC}"
      read -r EXTRA
      if [ -n "$EXTRA" ]; then
        CONVERSATION="$CONVERSATION

Respuesta del agente: $RESPONSE

Usuario responde: $EXTRA"
        continue
      fi
      break
    fi

    echo -e "${YELLOW}Tu respuesta (o 'generar' para crear el PDP):${NC}"
    read -r USER_ANSWER

    if [ "$USER_ANSWER" = "generar" ] || [ "$USER_ANSWER" = "g" ]; then
      break
    fi

    CONVERSATION="$CONVERSATION

Respuesta del agente: $RESPONSE

Usuario responde: $USER_ANSWER"
  done
fi

# ─────────────────────────────────────────────────────────────────────────────
# PASO 2: Generar PDP.md
# ─────────────────────────────────────────────────────────────────────────────

echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}  Generando PDP.md${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"

PDP_PROMPT="$CONVERSATION

Basándote en TODA la conversación anterior, genera el PDP completo.
Usa EXACTAMENTE la estructura definida en tu system prompt.
Incluye la sección de Agentes Sugeridos y Executors Sugeridos.
Si el usuario indicó preferencias de tecnología o agentes, respétalas.
Si sugirió agentes/executors que no existen en matrix.json, indícalo.

IMPORTANTE: Responde SOLO con el contenido markdown del PDP, sin envolturas de código."

PDP_CONTENT=$(claude -p "$PDP_PROMPT" \
  --system-prompt "$IDEATION_PROMPT" \
  --output-format text 2>/dev/null)

# Guardar PDP
echo "$PDP_CONTENT" > "$STATE_DIR/pdp.md"
echo -e "${GREEN}✓${NC} PDP guardado en: $STATE_DIR/pdp.md"

# Mostrar resumen del PDP
echo ""
echo "$PDP_CONTENT" | head -40
echo -e "\n  ${BLUE}... (ver archivo completo en state/pdp.md)${NC}"

# ─────────────────────────────────────────────────────────────────────────────
# PASO 3: Generar requirements.md
# ─────────────────────────────────────────────────────────────────────────────

echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}  Generando requirements.md${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"

REQ_PROMPT="Dado este PDP:

$PDP_CONTENT

Agentes/executors disponibles en matrix.json:
$MATRIX

Genera el archivo requirements.md con TODOS los requerimientos del MVP.
Cada requerimiento debe tener:
- Título claro
- Descripción concreta y accionable
- Tipo estimado (A-F)
- Agente sugerido
- Executor sugerido
- Dependencias
- Prioridad

Si el PDP sugiere agentes/executors nuevos (no en matrix.json), márcalos con:
  ⚠ NUEVO — Requiere crear {agent/executor} y registrar en matrix.json

Usa EXACTAMENTE la estructura de requirements definida en tu system prompt.
Responde SOLO con el contenido markdown, sin envolturas de código."

REQ_CONTENT=$(claude -p "$REQ_PROMPT" \
  --system-prompt "$IDEATION_PROMPT" \
  --output-format text 2>/dev/null)

# Guardar requirements
echo "$REQ_CONTENT" > "$STATE_DIR/requirements.md"
echo -e "${GREEN}✓${NC} Requirements guardado en: $STATE_DIR/requirements.md"

echo ""
echo "$REQ_CONTENT" | head -50
echo -e "\n  ${BLUE}... (ver archivo completo en state/requirements.md)${NC}"

# ─────────────────────────────────────────────────────────────────────────────
# PASO 4: Detectar nuevos agentes/executors necesarios
# ─────────────────────────────────────────────────────────────────────────────

echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}  Verificando agentes y executors necesarios${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"

VERIFY_PROMPT="Compara estos requirements con los agentes/executors disponibles:

Requirements:
$REQ_CONTENT

matrix.json actual:
$MATRIX

Responde SOLO con JSON válido, sin markdown ni texto adicional:
{
  \"existing_agents_needed\": [\"ui-agent-001\"],
  \"existing_executors_needed\": [\"react-executor\"],
  \"new_agents_needed\": [
    {
      \"id\": \"python-agent-001\",
      \"type\": \"specialist\",
      \"specialization\": \"backend-python\",
      \"reason\": \"El usuario quiere Python para el backend\"
    }
  ],
  \"new_executors_needed\": [
    {
      \"id\": \"python-executor\",
      \"technology\": \"Python + FastAPI\",
      \"reason\": \"Requerido por REQ-003\"
    }
  ],
  \"matrix_update_needed\": true
}"

VERIFY=$(claude -p "$VERIFY_PROMPT" \
  --system-prompt "$IDEATION_PROMPT" \
  --output-format text 2>/dev/null)

echo ""
echo -e "${BLUE}Análisis de agentes/executors:${NC}"
echo "$VERIFY" | sed 's/^/  /'

# Verificar si hay nuevos agentes necesarios
if echo "$VERIFY" | grep -q '"matrix_update_needed"[[:space:]]*:[[:space:]]*true'; then
  echo ""
  echo -e "${YELLOW}Se necesitan nuevos agentes/executors.${NC}"
  echo -e "${YELLOW}¿Quieres que actualice matrix.json automáticamente? [s/n]${NC}"
  read -r UPDATE_CHOICE

  if [ "$UPDATE_CHOICE" = "s" ] || [ "$UPDATE_CHOICE" = "S" ]; then
    UPDATE_PROMPT="Actualiza este matrix.json agregando los nuevos agentes y executors:

matrix.json actual:
$MATRIX

Nuevos agentes/executors a agregar:
$VERIFY

Responde SOLO con el JSON completo actualizado de matrix.json, sin envolturas de código ni explicaciones."

    UPDATED_MATRIX=$(claude -p "$UPDATE_PROMPT" \
      --system-prompt "$IDEATION_PROMPT" \
      --output-format text 2>/dev/null)

    echo "$UPDATED_MATRIX" > "$CONFIG_DIR/matrix.json"
    echo -e "${GREEN}✓${NC} matrix.json actualizado con nuevos agentes/executors"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# Resumen final
# ─────────────────────────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║          IDEACIÓN COMPLETADA                     ║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║${NC} Proyecto:     $PROJECT_DIR"
echo -e "${GREEN}║${NC} PDP:          state/pdp.md"
echo -e "${GREEN}║${NC} Requirements: state/requirements.md"
echo -e "${GREEN}║${NC} Matrix:       config/matrix.json"
echo -e "${GREEN}╠══════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║${NC}"
echo -e "${GREEN}║${NC} Siguiente paso:"
echo -e "${GREEN}║${NC}   Ejecuta cada requerimiento con:"
echo -e "${GREEN}║${NC}   ./run-iddrr.sh \"REQ-001: descripción\""
echo -e "${GREEN}║${NC}"
echo -e "${GREEN}║${NC} O ejecuta todos los del MVP en orden:"
echo -e "${GREEN}║${NC}   ./run-all-requirements.sh"
echo -e "${GREEN}╚══════════════════════════════════════════════════╝${NC}"
echo ""
