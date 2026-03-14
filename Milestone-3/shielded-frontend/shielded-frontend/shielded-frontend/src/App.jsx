import { useState, useEffect } from 'react';
import { connect, request, disconnect, isConnected, getLocalStorage } from '@stacks/connect';
import { Cl, cvToHex } from '@stacks/transactions';
import axios from 'axios';
import toast, { Toaster } from 'react-hot-toast';
import { Shield, LogOut, Users } from 'lucide-react';
import { Buffer } from 'buffer';

// Polyfill Buffer for browser (needed by circomlibjs/snarkjs)
if (typeof window !== 'undefined' && !window.Buffer) {
  window.Buffer = Buffer;
}

const RELAYER_URL = 'http://localhost:3000';

// Helper to convert hex string to Uint8Array (Clarity buffer format)
const hexToUint8Array = (hex) => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
};

export default function App() {
  const [userAddress, setUserAddress] = useState(null);
  const [pool, setPool] = useState('stx'); // 'stx' or 'token'
  const [tab, setTab] = useState('deposit');
  const [loading, setLoading] = useState(false);

  // Denomination selector (Tornado Cash style) - values in actual STX/tokens (not micro)
  const [selectedDenomination, setSelectedDenomination] = useState(1000); // default 1000 STX/tokens

  // Deposit
  const [nullifier, setNullifier] = useState('');
  const [secret, setSecret] = useState('');
  const [commitmentData, setCommitmentData] = useState(null);
  const [leafIndex, setLeafIndex] = useState(null);

  // Withdraw
  const [recipient, setRecipient] = useState('');
  const [withdrawNullifier, setWithdrawNullifier] = useState('');
  const [withdrawSecret, setWithdrawSecret] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState(1000);
  const [withdrawLeafIndex, setWithdrawLeafIndex] = useState('');
  const [tokenContract, setTokenContract] = useState('');
  const [jobId, setJobId] = useState(null);
  const [jobStatus, setJobStatus] = useState(null);
  const [withdrawStep, setWithdrawStep] = useState(''); // tracks progress

  // ==================== WALLET CONNECTION (RELIABLE) ====================
  useEffect(() => {
    // Check if already connected on page load
    if (isConnected()) {
      const data = getLocalStorage();
      const addr = data?.addresses?.stx?.[0]?.address || data?.address;
      // Defer setUserAddress to avoid synchronous setState in effect
      setTimeout(() => {
        if (addr) setUserAddress(addr);
      }, 0);
    }

    // Listen for wallet changes (storage events)
    const handleStorage = (e) => {
      if (e.key === 'stacksConnect') {
        const data = JSON.parse(e.newValue || '{}');
        const addr = data.addresses?.stx?.[0]?.address || data.address;
        setUserAddress(addr || null);
      }
    };
    window.addEventListener('storage', handleStorage);

    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const handleConnect = async () => {
    try {
      await connect();
      const data = getLocalStorage();
      const addr = data?.addresses?.stx?.[0]?.address || data?.address;
      if (addr) {
        setUserAddress(addr);
        toast.success('Wallet connected');
      } else {
        toast.error('No address found – try reconnecting');
      }
    } catch {
      toast.error('Connection cancelled');
    }
  };

  const handleDisconnect = () => {
    disconnect();
    setUserAddress(null);
    toast.success('Disconnected');
  };

  // ==================== DEPOSIT ====================
  // Denomination options (Tornado Cash style) - values in actual STX/tokens (not micro)
  const denominations = [
    { label: '10 ' + (pool === 'stx' ? 'STX' : 'Tokens'), value: 10 },
    { label: '100 ' + (pool === 'stx' ? 'STX' : 'Tokens'), value: 100 },
    { label: '110 ' + (pool === 'stx' ? 'STX' : 'Tokens'), value: 110 },
    { label: '1000 ' + (pool === 'stx' ? 'STX' : 'Tokens'), value: 1000 },
    { label: '1010 ' + (pool === 'stx' ? 'STX' : 'Tokens'), value: 1010 },
    { label: '10000 ' + (pool === 'stx' ? 'STX' : 'Tokens'), value: 10000 },
    { label: '10010 ' + (pool === 'stx' ? 'STX' : 'Tokens'), value: 10010 },
    { label: '100000 ' + (pool === 'stx' ? 'STX' : 'Tokens'), value: 100000 },
    { label: '110000 ' + (pool === 'stx' ? 'STX' : 'Tokens'), value: 110000 },
    { label: '1000000 ' + (pool === 'stx' ? 'STX' : 'Tokens'), value: 1000000 },
  ];

  const generateNote = async () => {
    setLoading(true);
    setLeafIndex(null); // reset leaf index for new note
    try {
      const res = await axios.post(`${RELAYER_URL}/deposit/compute-commitment`, {
        nullifier: nullifier || undefined,
        secret: secret || undefined,
        amount: selectedDenomination,
      });
      setCommitmentData(res.data.data);
      toast.success(`Note generated for ${selectedDenomination} ${pool === 'stx' ? 'STX' : 'Tokens'} — SAVE IT!`);
    } catch (err) {
      toast.error('Failed to generate note');
      console.error(err);
    }
    setLoading(false);
  };

  const depositOnChain = async () => {
    if (!commitmentData || !userAddress) return toast.error('Generate note first');
    setLoading(true);
    try {
      const contractName = pool === 'stx' ? 'shielded-stx-pool' : 'shielded-sip10-pool';

      console.log(`Sending deposit of ${selectedDenomination} ${pool === 'stx' ? 'STX' : 'Tokens'} to ${contractName}`);

      const response = await request('stx_callContract', {
        contract: `ST2RSFWY4AJTJXK4ECCDRYY96CWAM2DXMNME6RB9N.${contractName}`,
        functionName: 'deposit',
        functionArgs: [
          cvToHex(Cl.buffer(hexToUint8Array(commitmentData.commitment))),
          cvToHex(Cl.uint(selectedDenomination)),
        ],
      });

      console.log('Deposit success:', response);
      toast.success(`Deposit of ${selectedDenomination} ${pool === 'stx' ? 'STX' : 'Tokens'} sent! Tx ID: ${response.txId || 'pending'}`);
    } catch (err) {
      console.error('Deposit error details:', err);
      toast.error('Transaction rejected: ' + (err.message || 'Wallet or contract error'));
    }
    setLoading(false);
  };

  const indexDeposit = async () => {
    if (!commitmentData) return;
    setLoading(true);
    try {
      const res = await axios.post(`${RELAYER_URL}/merkle/index`, {
        commitment: commitmentData.commitmentDecimal,
        depositor: userAddress,
        pool
      });
      const idx = res.data.leafIndex;
      setLeafIndex(idx);
      setWithdrawLeafIndex(String(idx)); // auto-populate withdraw field
      toast.success(`Deposit indexed at leaf #${idx} — save this number for withdrawal!`, { duration: 8000 });
    } catch {
      toast.error('Indexing failed');
    }
    setLoading(false);
  };

  // ==================== WITHDRAW ====================
  const submitWithdraw = async () => {
    if (!withdrawNullifier || !withdrawSecret || !recipient || !withdrawLeafIndex) {
      return toast.error('Fill all fields: nullifier, secret, leaf index, and recipient');
    }
    if (pool === 'token' && !tokenContract) return toast.error('Enter token contract address');

    setLoading(true);
    setWithdrawStep('');
    try {
      // Step 1: Initialize Poseidon for client-side hashing
      setWithdrawStep('Initializing Poseidon...');
      const { buildPoseidon } = await import('circomlibjs');
      const poseidon = await buildPoseidon();
      const F = poseidon.F;
      const poseidonHash = (inputs) => F.toString(poseidon(inputs.map(x => F.e(x))));

      // Step 2: Compute values from nullifier, secret, and denomination
      setWithdrawStep('Computing commitment values...');
      const nullifierBigInt = BigInt('0x' + withdrawNullifier);
      const secretBigInt = BigInt('0x' + withdrawSecret);
      const denominationBigInt = BigInt(withdrawAmount);

      // Compute nullifierHash = Poseidon(nullifier)
      const nullifierHash = poseidonHash([nullifierBigInt]);

      // Convert recipient address to a field element (hash of the address string)
      // The circuit expects recipient as a field element, not a raw string
      const recipientFieldStr = BigInt('0x' + Array.from(
        new TextEncoder().encode(recipient)
      ).map(b => b.toString(16).padStart(2, '0')).join('')).toString();

      // Compute recipientCommitment = Poseidon(nullifier, recipient)
      const recipientCommitment = poseidonHash([nullifierBigInt, BigInt(recipientFieldStr)]);

      // Step 3: Fetch Merkle path from relayer
      setWithdrawStep('Fetching Merkle path...');
      const pathRes = await axios.get(`${RELAYER_URL}/merkle/${pool}/path/${withdrawLeafIndex}`);
      const { pathElements, pathIndices, root } = pathRes.data;

      // Step 4: Build circuit input matching circom signal names exactly
      // Public:  root, nullifierHash, recipient, relayer, fee, refund, denomination, recipientCommitment
      // Private: nullifier, secret, pathElements[20], pathIndices[20]
      setWithdrawStep('Preparing circuit inputs...');
      const circuitInput = {
        // Private inputs
        nullifier: nullifierBigInt.toString(),
        secret: secretBigInt.toString(),
        pathElements: pathElements.map(e => e.toString()),
        pathIndices: pathIndices,
        // Public inputs
        root: root.toString(),
        nullifierHash: nullifierHash.toString(),
        recipient: recipientFieldStr,
        relayer: '0',                                    // 0 = self-relay (no relayer)
        fee: '0',                                        // relayer base fee handled server-side
        refund: '0',                                     // usually 0 on Stacks
        denomination: denominationBigInt.toString(),
        recipientCommitment: recipientCommitment.toString(),
      };

      console.log('Circuit input:', circuitInput);

      // Step 5: Generate ZK proof client-side using snarkjs
      setWithdrawStep('Generating ZK proof (this may take a moment)...');
      const snarkjs = await import('snarkjs');
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(
        circuitInput,
        '/circuits/shielded-withdraw.wasm',      // circuit WASM in public folder
        '/circuits/shielded-withdraw_final.zkey'  // proving key in public folder
      );

      console.log('Proof generated:', { proof, publicSignals });
      // publicSignals order: [root, nullifierHash, recipient, relayer, fee, refund, denomination, recipientCommitment]

      // Step 6: Submit to relayer
      setWithdrawStep('Submitting to relayer...');
      const payload = {
        proof,
        publicSignals,
        recipient,
      };

      const endpoint = pool === 'stx' ? '/withdraw/stx' : '/withdraw/token';
      if (pool === 'token') payload.tokenContract = tokenContract;

      const res = await axios.post(`${RELAYER_URL}${endpoint}`, payload);

      setJobId(res.data.jobId);
      setWithdrawStep('');
      toast.success(`Withdrawal queued in ${pool.toUpperCase()} Pool`);
      pollJob(res.data.jobId);
    } catch (err) {
      console.error('Withdraw error:', err);
      toast.error('Withdraw failed: ' + (err?.response?.data?.error || err.message));
      setWithdrawStep('');
    }
    setLoading(false);
  };

  const pollJob = (id) => {
    const int = setInterval(async () => {
      try {
        const res = await axios.get(`${RELAYER_URL}/job/${id}`);
        setJobStatus(res.data);
        if (res.data.state === 'completed') {
          clearInterval(int);
          toast.success(`✅ Tx: ${res.data.result.txid}`, { duration: 8000 });
        }
        if (res.data.state === 'failed') {
          clearInterval(int);
          toast.error(`Job failed: ${res.data.error}`);
        }
      } catch {
        // intentionally ignored
      }
    }, 2500);
  };

  return (
    <div className="min-h-screen bg-[#050507] text-white overflow-x-hidden">
      <Toaster position="top-center" toastOptions={{ style: { background: '#111', color: '#fff', border: '1px solid #22ff99' } }} />

      {/* NAVBAR */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/10 bg-[#050507]/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gradient-to-br from-cyan-400 to-emerald-400 rounded-full flex items-center justify-center">
              <Shield className="w-5 h-5 text-black" />
            </div>
            <span className="text-3xl font-bold bg-gradient-to-r from-cyan-400 via-emerald-400 to-cyan-400 bg-clip-text text-transparent">Stackify</span>
          </div>
          <div className="flex items-center gap-8 text-sm font-medium">
            <a href="#how" className="hover:text-emerald-400 transition">How it works</a>
            <a href="#features" className="hover:text-emerald-400 transition">Features</a>
            <a href="#roadmap" className="hover:text-emerald-400 transition">Roadmap</a>
          </div>
          {userAddress ? (
            <div className="flex items-center gap-4">
              <div className="text-xs font-mono px-4 py-2 bg-white/5 rounded-full border border-white/10">
                {userAddress.slice(0, 8)}...{userAddress.slice(-6)}
              </div>
              <button onClick={handleDisconnect} className="flex items-center gap-2 px-5 py-2 rounded-full border border-red-500/30 hover:bg-red-500/10 transition">
                <LogOut className="w-4 h-4" /> Disconnect
              </button>
            </div>
          ) : (
            <button onClick={handleConnect} className="px-6 py-3 bg-white text-black font-semibold rounded-full hover:scale-105 transition flex items-center gap-2">
              <Users className="w-4 h-4" /> Connect Wallet
            </button>
          )}
        </div>
      </nav>

      {/* THE APP */}
      <section id="app" className="pt-32 pb-20">
        <div className="max-w-4xl mx-auto px-6">
          <div className="bg-[#0a0a0f] border border-white/10 rounded-3xl p-10">
            
            {/* Pool Selector */}
            <div className="flex gap-2 mb-10 border-b border-white/10 pb-6">
              <button onClick={() => setPool('stx')} className={`flex-1 py-4 rounded-2xl font-semibold transition ${pool === 'stx' ? 'bg-emerald-500 text-black' : 'bg-white/5 hover:bg-white/10'}`}>
                STX Pool
              </button>
              <button onClick={() => setPool('token')} className={`flex-1 py-4 rounded-2xl font-semibold transition ${pool === 'token' ? 'bg-emerald-500 text-black' : 'bg-white/5 hover:bg-white/10'}`}>
                SIP-10 Token Pool
              </button>
            </div>

            <h2 className="text-4xl font-bold mb-8 text-center">
              {pool === 'stx' ? 'STX Pool' : 'SIP-10 Token Pool'}
            </h2>

            <div className="flex gap-2 mb-8">
              {['deposit', 'withdraw'].map(t => (
                <button key={t} onClick={() => setTab(t)} className={`px-8 py-3 rounded-2xl font-medium transition ${tab === t ? 'bg-emerald-500 text-black' : 'bg-white/5 hover:bg-white/10'}`}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>

            {/* DEPOSIT TAB - WITH DENOMINATION SELECTOR */}
            {tab === 'deposit' && (
              <div className="space-y-8">
                {/* Denomination Selector (Tornado Cash style) */}
                <div>
                  <label className="block text-sm text-gray-400 mb-3">Select Deposit Amount</label>
                  <div className="grid grid-cols-5 gap-3">
                    {denominations.map((denom, index) => (
                      <button
                        key={index}
                        onClick={() => setSelectedDenomination(denom.value)}
                        className={`py-3 px-4 rounded-2xl font-medium transition text-sm ${selectedDenomination === denom.value 
                          ? 'bg-emerald-500 text-black' 
                          : 'bg-white/5 hover:bg-white/10'}`}
                      >
                        {denom.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm text-gray-400 mb-2">Nullifier (optional)</label>
                    <input value={nullifier} onChange={e => setNullifier(e.target.value)} className="w-full bg-black border border-white/10 rounded-2xl px-6 py-4 font-mono" placeholder="random" />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-2">Secret (optional)</label>
                    <input value={secret} onChange={e => setSecret(e.target.value)} className="w-full bg-black border border-white/10 rounded-2xl px-6 py-4 font-mono" placeholder="random" />
                  </div>
                </div>

                <button onClick={generateNote} disabled={loading} className="w-full py-5 bg-gradient-to-r from-cyan-400 to-emerald-400 text-black font-bold text-xl rounded-2xl hover:scale-[1.02] transition">
                  {loading ? 'Generating...' : 'Generate Private Note'}
                </button>

                {commitmentData && (
                  <div className="bg-black border border-emerald-500/30 rounded-3xl p-8 font-mono text-sm space-y-3">
                    <p className="text-emerald-400 font-bold">SAVE THIS NOTE FOREVER</p>
                    <div>Commitment: 0x{commitmentData.commitment}</div>
                    <div>Nullifier: {commitmentData.nullifier}</div>
                    <div>Secret: {commitmentData.secret}</div>
                    <div>Amount: {commitmentData.amount} {pool === 'stx' ? 'STX' : 'Tokens'}</div>
                    {leafIndex !== null && (
                      <div className="text-cyan-400 font-bold">Leaf Index: {leafIndex} — you need this to withdraw!</div>
                    )}
                    <div className="pt-6 grid grid-cols-2 gap-4">
                      <button onClick={depositOnChain} className="py-4 bg-white text-black rounded-2xl font-bold">Deposit to {pool.toUpperCase()} Pool</button>
                      <button onClick={indexDeposit} className="py-4 bg-white/10 hover:bg-white/20 rounded-2xl">
                        {leafIndex !== null ? `✓ Indexed (#${leafIndex})` : 'Index in Pool'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* WITHDRAW TAB */}
            {tab === 'withdraw' && (
              <div className="space-y-8">
                {/* Amount selector for withdrawal */}
                <div>
                  <label className="block text-sm text-gray-400 mb-3">Withdrawal Amount</label>
                  <div className="grid grid-cols-5 gap-3">
                    {denominations.map((denom, index) => (
                      <button
                        key={index}
                        onClick={() => setWithdrawAmount(denom.value)}
                        className={`py-3 px-4 rounded-2xl font-medium transition text-sm ${withdrawAmount === denom.value 
                          ? 'bg-emerald-500 text-black' 
                          : 'bg-white/5 hover:bg-white/10'}`}
                      >
                        {denom.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm text-gray-400 mb-2">Nullifier</label>
                    <input value={withdrawNullifier} onChange={e => setWithdrawNullifier(e.target.value)} className="w-full bg-black border border-white/10 rounded-2xl px-6 py-4 font-mono text-sm" placeholder="Your nullifier from the deposit note" />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-2">Secret</label>
                    <input value={withdrawSecret} onChange={e => setWithdrawSecret(e.target.value)} className="w-full bg-black border border-white/10 rounded-2xl px-6 py-4 font-mono text-sm" placeholder="Your secret from the deposit note" />
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm text-gray-400 mb-2">Leaf Index</label>
                    <input value={withdrawLeafIndex} onChange={e => setWithdrawLeafIndex(e.target.value)} className="w-full bg-black border border-white/10 rounded-2xl px-6 py-4 font-mono text-sm" placeholder="Leaf index from deposit indexing (e.g. 0)" type="number" />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-2">Recipient Address</label>
                    <input value={recipient} onChange={e => setRecipient(e.target.value)} className="w-full bg-black border border-white/10 rounded-2xl px-6 py-4 font-mono text-sm" placeholder="ST... address to receive funds" />
                  </div>
                </div>

                {pool === 'token' && (
                  <div>
                    <label className="block text-sm text-gray-400 mb-2">SIP-10 Token Contract</label>
                    <input value={tokenContract} onChange={e => setTokenContract(e.target.value)} placeholder="e.g. SP3K8BC0PE...token-name" className="w-full bg-black border border-white/10 rounded-2xl px-6 py-4 font-mono text-sm" />
                  </div>
                )}

                <button onClick={submitWithdraw} disabled={loading} className="w-full py-6 bg-gradient-to-r from-emerald-500 to-cyan-500 text-black font-bold text-xl rounded-2xl hover:scale-[1.02] transition">
                  {loading ? (withdrawStep || 'Processing...') : `Withdraw from ${pool.toUpperCase()} Pool`}
                </button>

                {jobStatus && (
                  <div className="mt-6 p-6 bg-black border border-white/10 rounded-2xl font-mono text-sm space-y-2">
                    <div>Job ID: {jobId}</div>
                    <div>Status: <span className={jobStatus.state === 'completed' ? 'text-emerald-400' : jobStatus.state === 'failed' ? 'text-red-400' : 'text-yellow-400'}>{jobStatus.state}</span></div>
                    {jobStatus.result?.txid && <div>Tx: <span className="text-emerald-400">{jobStatus.result.txid}</span></div>}
                    {jobStatus.error && <div className="text-red-400">Error: {jobStatus.error}</div>}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      <footer className="py-12 border-t border-white/10 text-center text-sm text-gray-500">
        Built with ❤️ on Stacks • Stackify 2026
      </footer>
    </div>
  );
}