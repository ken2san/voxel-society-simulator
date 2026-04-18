PROJECT_ID ?= voxel-society-simulator
SERVICE_NAME ?= voxel-society-simulator
IMAGE = gcr.io/$(PROJECT_ID)/$(SERVICE_NAME)
REGION ?= us-central1

.PHONY: guard-project build deploy clean all

guard-project:
	@test -n "$(PROJECT_ID)" || (echo "PROJECT_ID is empty. Run 'gcloud config set project <id>' or pass PROJECT_ID=<id>." && exit 1)

# Apple Silicon対応: buildxでamd64向けビルド＆push
build: guard-project
	docker buildx build --platform linux/amd64 -t $(IMAGE) . --push

deploy: guard-project
	gcloud run deploy $(SERVICE_NAME) \
	  --project $(PROJECT_ID) \
	  --image $(IMAGE) \
	  --platform managed \
	  --region $(REGION) \
	  --allow-unauthenticated

clean:
	docker image prune -f
	docker rmi $(IMAGE) 2>/dev/null || true

all: build deploy