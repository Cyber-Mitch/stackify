# Shielded Pool on Stacks – Privacy Mixer (Tornado Cash Inspired)

A fully private transaction pool for STX and SIP-10 tokens on the Stacks blockchain, using zk-SNARKs to break on-chain linkability.

**Milestone 1 Complete** – Design & Documentation Only  
This repository contains the finalized design of:
- zk-SNARK circuits (Circom + snarkjs)
- Clarity v4 smart contract structure and full specification
- Comprehensive privacy threat model
- Relayer architecture
- System architecture, cryptographic assumptions, and security considerations

All documents are written with maximum detail for immediate peer review and future implementation.

**Folders**
- `/circuits` – Complete zk-SNARK circuit design (no .circom files yet)
- `/contracts` – Clarity contract specification
- `/docs` – Architecture, threat model, crypto assumptions, security
- `/diagrams` – Mermaid source files (renderable on GitHub)

**Next Milestone**: Implementation of circuits and contracts.