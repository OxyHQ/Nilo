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

run_migration() {
  local phase="$1"
  local overrides task_arn exit_code
  overrides=$(jq -nc --arg container "$APP" --arg phase "$phase" '{
    containerOverrides: [{
      name: $container,
      command: ["node", "apps/api/dist/db/migrate.js", "--target-database=nilo", ("--phase=" + $phase)]
    }]
  }')
  task_arn=$(aws ecs run-task --cluster "$CLUSTER" --launch-type FARGATE \
    --task-definition "$RELEASE_TASK_DEFINITION" \
    --network-configuration "$(jq -nc --argjson config "$NETWORK" '{awsvpcConfiguration: $config}')" \
    --overrides "$overrides" --query 'tasks[0].taskArn' --output text)
  aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$task_arn"
  exit_code=$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$task_arn" \
    --query 'tasks[0].containers[0].exitCode' --output text)
  if [ "$exit_code" != 0 ]; then
    echo "::error::$phase migration failed with exit code $exit_code"
    exit 1
  fi
}

run_migration pre

aws ecs update-service --cluster "$CLUSTER" --service "$APP" \
  --task-definition "$RELEASE_TASK_DEFINITION" >/dev/null
aws ecs wait services-stable --cluster "$CLUSTER" --services "$APP" || true

read -r PRIMARY STATE <<<"$(aws ecs describe-services --cluster "$CLUSTER" --services "$APP" \
  --query 'services[0].deployments[?status==`PRIMARY`].[taskDefinition,rolloutState] | [0]' --output text)"
if [ "$PRIMARY" != "$RELEASE_TASK_DEFINITION" ] || [ "$STATE" != COMPLETED ]; then
  echo "::error::release rolled back or did not complete (primary=$PRIMARY state=$STATE)"
  exit 1
fi

curl --fail --silent --show-error --retry 5 --retry-delay 3 \
  https://api.nilo.so/health/ready >/dev/null

run_migration post
echo "Deployed $RELEASE_TASK_DEFINITION ($IMAGE_URI)"
