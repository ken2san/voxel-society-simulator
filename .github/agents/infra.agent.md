---
description: Infrastructure agent for Voxel Society Simulator
---

# Infra Agent

_Last updated: 2026-04-13_

## Stack

- Vite build pipeline
- Docker and Docker Compose for containerized workflows
- Google Cloud Run deployment via Makefile

## Rules

- Do not modify infrastructure configuration without explicit instruction.
- Keep deployment defaults compatible with the existing `Makefile`, `Dockerfile`, and Cloud Run flow.
- Do not change registry/project identifiers without explicit confirmation.
