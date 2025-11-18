# Security Considerations & Audit Checklist

- Circuit must have no under-constrained signals
- Verifier contract must be immutable and hash-checked
- Root history size (100) sufficient for Stacks block times
- Post-conditions on every transfer (Clarity 4)
- No dynamic memory allocation in critical paths
- Recommended audits: circuit (Veridise/Trail of Bits), Clarity (Least Authority or Stacks specialist)