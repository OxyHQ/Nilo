#!/usr/bin/env bash
set -euo pipefail

: "${AWS_REGION:?AWS_REGION required}"
: "${CLUSTER:?CLUSTER required}"
: "${APP:?APP required}"
: "${IMAGE_URI:?IMAGE_URI required}"

WORK_DIR=$(mktemp -d)
trap 'find "$WORK_DIR" -depth -delete' EXIT

SERVICE=$(aws ecs describe-services --cluster "$CLUSTER" --services "$APP" --output json)
if [ "$(jq -r '.services[0].status // ""' <<<"$SERVICE")" != ACTIVE ]; then
  echo "::error::ECS service $APP is not active"
  exit 1
fi

LIVE_TASK_DEFINITION=$(jq -r '.services[0].taskDefinition' <<<"$SERVICE")
aws ecs describe-task-definition --task-definition "$LIVE_TASK_DEFINITION" \
  --query taskDefinition --output json > "$WORK_DIR/live.json"

jq --arg container "$APP" --arg image "$IMAGE_URI" '
  del(.taskDefinitionArn, .revision, .status, .requiresAttributes,
      .compatibilities, .registeredAt, .registeredBy)
  | .containerDefinitions |= map(if .name == $container then .image = $image else . end)
' "$WORK_DIR/live.json" > "$WORK_DIR/release.json"

RELEASE_TASK_DEFINITION=$(aws ecs register-task-definition \
  --cli-input-json "file://$WORK_DIR/release.json" \
  --query 'taskDefinition.taskDefinitionArn' --output text)

NETWORK=$(jq -c '.services[0].networkConfiguration.awsvpcConfiguration' <<<"$SERVICE")

# One task with the release image and the service's network, on the given
# command; a non-zero exit fails the deploy.
run_oneshot() {
  local label="$1" command="$2"
  local overrides task_arn exit_code
  overrides=$(jq -nc --arg container "$APP" --argjson command "$command" '{
    containerOverrides: [{ name: $container, command: $command }]
  }')
  task_arn=$(aws ecs run-task --cluster "$CLUSTER" --launch-type FARGATE \
    --task-definition "$RELEASE_TASK_DEFINITION" \
    --network-configuration "$(jq -nc --argjson config "$NETWORK" '{awsvpcConfiguration: $config}')" \
    --overrides "$overrides" --query 'tasks[0].taskArn' --output text)
  aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$task_arn"
  exit_code=$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$task_arn" \
    --query 'tasks[0].containers[0].exitCode' --output text)
  if [ "$exit_code" != 0 ]; then
    echo "::error::$label failed with exit code $exit_code"
    exit 1
  fi
}

# `bun`: the runtime apps/api/Dockerfile ships. Reverting to a Node image
# means reverting these commands with it.
run_migration() {
  run_oneshot "$1 migration" \
    "$(jq -nc --arg phase "$1" '["bun", "apps/api/dist/db/migrate.js", "--target-database=nilo", ("--phase=" + $phase)]')"
}

run_migration pre

# Start every replacement task at once, next to the old ones: 200% with a 100%
# healthy floor. At 150% the two tasks were replaced one at a time, two waves
# of start, health checks and a 60 s drain (404 s on 2026-09-30). Migrations
# are the one-shots above and below, never on boot, so four copies side by
# side is safe. Same value as oxy-infra's app-service module declares.
aws ecs update-service --cluster "$CLUSTER" --service "$APP" \
  --task-definition "$RELEASE_TASK_DEFINITION" \
  --deployment-configuration '{
    "deploymentCircuitBreaker": {"enable": true, "rollback": true},
    "minimumHealthyPercent": 100,
    "maximumPercent": 200
  }' >/dev/null
# `aws ecs wait services-stable` gives up after 10 minutes, which a Fargate
# rollout with a health-check grace period and connection draining can exceed.
# Follow the primary deployment itself until it settles (30 minutes at most).
DEADLINE=$((SECONDS + 1800))
while :; do
  read -r PRIMARY STATE <<<"$(aws ecs describe-services --cluster "$CLUSTER" --services "$APP" \
    --query 'services[0].deployments[?status==`PRIMARY`].[taskDefinition,rolloutState] | [0]' --output text)"
  if [ "$STATE" != IN_PROGRESS ] || [ "$SECONDS" -ge "$DEADLINE" ]; then
    break
  fi
  sleep 15
done
if [ "$PRIMARY" != "$RELEASE_TASK_DEFINITION" ] || [ "$STATE" != COMPLETED ]; then
  echo "::error::release rolled back or did not complete (primary=$PRIMARY state=$STATE)"
  exit 1
fi

curl --fail --silent --show-error --retry 5 --retry-delay 3 \
  https://api.nilo.so/health/ready >/dev/null

run_migration post

# The notes capability catalog Alia and MCP clients see is the one this
# release serves; registering an unchanged catalog again is a no-op in Oxy.
run_oneshot "capability catalog registration" \
  '["bun", "apps/api/dist/scripts/register-capability-catalog.js"]'

echo "Deployed $RELEASE_TASK_DEFINITION ($IMAGE_URI)"
