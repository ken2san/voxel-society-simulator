PROJECT_ID=voxel-society-simulator
IMAGE=gcr.io/$(PROJECT_ID)/voxel-society-simulator
REGION=us-central1

# Apple Silicon対応: buildxでamd64向けビルド＆push
build:
	docker buildx build --platform linux/amd64 -t $(IMAGE) . --push

deploy:
	gcloud run deploy voxel-society-simulator \
	  --image $(IMAGE) \
	  --platform managed \
	  --region $(REGION) \
	  --allow-unauthenticated

all: build deploy