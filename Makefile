.PHONY: build test lint

build:
	npx tsc --noEmit

test:
	npx vitest run --coverage

lint:
	npx biome check .
