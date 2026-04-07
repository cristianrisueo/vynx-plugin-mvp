.PHONY: build test lint sim e2e

build:
	npx tsc --noEmit

test:
	npx vitest run --coverage

lint:
	npx biome check .

# Run the local agent simulation against a running Anvil node and Relayer.
# Compiles with tsc (emitDecoratorMetadata) before executing so that AgentKit's
# @CreateAction decorator metadata is correctly emitted.
# Requires: VYNX_RELAYER_URL and ANVIL_RPC_URL to be set (or uses defaults).
sim:
	npx tsc --project tsconfig.scripts.json
	node .sim-dist/scripts/simulate_agent.js

# Full E2E orchestration:
#   1. Start Anvil with chain-id 84532 (Base Sepolia)
#   2. Deploy VynxSettlement to Anvil
#   3. Build and start the Go Relayer
#   4. Run the TypeScript simulation
#   5. Kill background processes
e2e:
	@echo "==> Starting Anvil (chain-id 84532) in background …"
	anvil --chain-id 84532 --port 8545 > /tmp/anvil.log 2>&1 & echo $$! > /tmp/anvil.pid
	@sleep 3

	@echo "==> Deploying VynxSettlement to Anvil …"
	cd ../vynx-settlement-mvp && \
		PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
		RELAYER_SIGNER=0x70997970C51812dc3A010C7d01b50e0d17dc79C8 \
		forge script script/DeployVynxSettlement.s.sol:DeployVynxSettlement \
			--rpc-url http://localhost:8545 \
			--broadcast \
			-vvvv 2>&1 | tail -20
	@sleep 2

	@echo "==> Building and starting VynX Relayer in background …"
	cd ../vynx-relayer-mvp && go build -o bin/relayer ./cmd/relayer/... && \
		BASE_RPC_URL=http://127.0.0.1:8545 \
		CHAIN_ID=84532 \
		RELAYER_PRIVATE_KEY=59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d \
		SETTLEMENT_CONTRACT_ADDRESS=0x5FbDB2315678afecb367f032d93F642f64180aa3 \
		AUCTION_TIMEOUT_MS=200 \
		PORT=8080 \
		./bin/relayer > /tmp/relayer.log 2>&1 & echo $$! > /tmp/relayer.pid
	@sleep 3

	@echo "==> Running agent simulation …"
	npx tsc --project tsconfig.scripts.json
	VYNX_RELAYER_URL=http://127.0.0.1:8080 ANVIL_RPC_URL=http://127.0.0.1:8545 \
		node .sim-dist/scripts/simulate_agent.js; SIM_EXIT=$$?; \
		echo "==> Simulation exit code: $$SIM_EXIT"; \
		echo "==> Stopping background processes …"; \
		kill $$(cat /tmp/anvil.pid) 2>/dev/null || true; \
		kill $$(cat /tmp/relayer.pid) 2>/dev/null || true; \
		pkill -f "anvil" 2>/dev/null || true; \
		pkill -f "bin/relayer" 2>/dev/null || true; \
		rm -f /tmp/anvil.pid /tmp/relayer.pid; \
		exit $$SIM_EXIT
