# Shielded Pool v2.1 - Privacy Mixer for Stacks

A Tornado Cash-style privacy mixer enabling private transactions for STX and SIP-10 tokens on Stacks blockchain.

## Milestone 3 Deliverables

| Deliverable | Status | Description |
|-------------|--------|-------------|
| Contracts on Testnet | ✅ Ready | Deploy with Clarinet |
| Security Audit | ✅ Complete | 9 bugs fixed, 3 acknowledged |
| Relayer API | ✅ Open | Developer testing ready |
| Documentation | ✅ Complete | Setup, API, Multi-relayer guides |

## Quick Start

```bash
# 1. Install tools
npm install -g snarkjs circom

# 2. Setup relayer
cd relayer && npm install

# 3. Compile circuit (see docs/SETUP-AND-DEPLOYMENT.md)
cd circuits
circom shielded-withdraw.circom --r1cs --wasm --sym

# 4. Run relayer
cd relayer && npm start

# 5. Test API
curl http://localhost:3000/health
```

## Architecture

**No ZK proof needed for deposits** - matches Tornado Cash design.

| Action | ZK Proof? | Why |
|--------|-----------|-----|
| Deposit | ❌ No | Just compute hash in JavaScript |
| Withdraw | ✅ Yes | Prove knowledge without revealing which deposit |

## Specifications

| Parameter | Value |
|-----------|-------|
| Merkle Tree | 20 levels (1M deposits) |
| Hash | Poseidon |
| Proving | Groth16 |
| Fee | 0.5% to Treasury |

## API Endpoints

```
  GET  /              - API info
  GET  /docs          - OpenAPI docs
  GET  /health        - Health check
  POST /deposit/compute-commitment - Compute commitment
  GET  /merkle/:pool  - Tree info
  GET  /merkle/:pool/path/:idx - Merkle path
  POST /merkle/index  - Index deposit
  POST /withdraw/stx  - Submit withdrawal
  GET  /job/:id       - Job status
  GET  /stats         - Statistics
  GET  /zeros         - Precomputed zeros

```

## Documentation

- [Setup & Deployment Guide](docs/SETUP-AND-DEPLOYMENT.md)
- [Multi-Relayer Guide](docs/MULTI-RELAYER-GUIDE.md)
- [API Documentation](docs/API-DOCUMENTATION.md)
- [Security Audit Report](docs/SECURITY-AUDIT-REPORT.docx)

## Security

All code bugs fixed. See audit report for details.

## License

Glitch Gremlins
