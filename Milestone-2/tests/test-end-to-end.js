const snarkjs = require('snarkjs');
const path = require('path');
const fs = require('fs');

(async () => {
  try {
    const fetch = (await import('node-fetch')).default;

    // Mock inputs - adjust if needed for real testing
    const privateInputs = {
      nullifier: BigInt('1'),
      secret: BigInt('2'),
      pathElements: new Array(20).fill(BigInt('0')),
      pathIndices: new Array(20).fill(0),
      denomination: BigInt('1000000')
    };
    const publicInputs = {
      root: BigInt('123456789'),
      nullifierHash: BigInt('987654321'),
      recipient: BigInt('111'),
      relayer: BigInt('222'),
      fee: BigInt('10'),
      refund: BigInt('5')
    };

    // Absolute paths based on your setup (adjust if files moved)
    const wasmPath = path.join(__dirname, '..', 'shielded-withdraw_js', 'shielded-withdraw.wasm');
    const zkeyPath = path.join(__dirname, '..', 'shielded-withdraw_final.zkey');

    // Debug: Print and check existence
    console.log('WASM path:', wasmPath);
    console.log('ZKEY path:', zkeyPath);
    if (!fs.existsSync(wasmPath)) throw new Error('WASM file missing - re-compile circuit');
    if (!fs.existsSync(zkeyPath)) throw new Error('ZKEY file missing - re-run trusted setup');

    // Generate proof
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      privateInputs,
      publicInputs,
      wasmPath,
      zkeyPath
    );
    console.log('Proof generated successfully!');
    console.log('Public signals:', publicSignals);

    // Mock encrypted note (in prod, encrypt with relayer pubkey)
    const encryptedNote = 'mock-encrypted-note';

    // Submit to relayer
    const response = await fetch('http://localhost:3000/submit-withdraw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proof, publicSignals, encryptedNote })
    });

    if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
    const data = await response.json();
    console.log('Relayer response:', data);
    console.log('End-to-end test completed!');
  } catch (error) {
    console.error('Test failed:', error.message || error);
  }
})();