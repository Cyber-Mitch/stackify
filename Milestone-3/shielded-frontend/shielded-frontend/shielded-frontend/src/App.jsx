import { useState, useEffect } from 'react';
import { connect, request, disconnect, isConnected, getLocalStorage } from '@stacks/connect';
import axios from 'axios';
import toast, { Toaster } from 'react-hot-toast';
import { Shield, LogOut, Users } from 'lucide-react';

const RELAYER_URL = 'http://localhost:3000';

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

  // Deposit
  const [nullifier, setNullifier] = useState('');
  const [secret, setSecret] = useState('');
  const [commitmentData, setCommitmentData] = useState(null);

  // Withdraw
  const [recipient, setRecipient] = useState('');
  const [proof, setProof] = useState('');
  const [publicSignals, setPublicSignals] = useState('');
  const [tokenContract, setTokenContract] = useState('');
  const [jobId, setJobId] = useState(null);
  const [jobStatus, setJobStatus] = useState(null);

  // ==================== WALLET CONNECTION ====================

  useEffect(() => {
    // Check if already connected on mount
    if (isConnected()) {
      const data = getLocalStorage();
      const addr = data?.addresses?.stx?.[0]?.address || data?.address;
      if (addr) {
        setUserAddress(addr);
      }
    }

    // Listen for storage changes (wallet updates)
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
  const generateNote = async () => {
    setLoading(true);
    try {
      const res = await axios.post(`${RELAYER_URL}/deposit/compute-commitment`, {
        nullifier: nullifier || undefined,
        secret: secret || undefined,
      });
      setCommitmentData(res.data.data);
      toast.success('Note generated — SAVE IT!');
    } catch {
      toast.error('Failed');
    }
    setLoading(false);
  };

  const depositOnChain = async () => {
    if (!commitmentData || !userAddress) return toast.error('Generate note first');
    setLoading(true);
    try {
      const contractName = pool === 'stx' ? 'shielded-native-pool' : 'shielded-token-pool';

      await request('stx_callContract', {
        contractAddress: 'ST2RSFWY4AJTJXK4ECCDRYY96CWAM2DXMNME6RB9N',
        contractName,
        functionName: 'deposit',
        functionArgs: [{ type: 'buffer', value: hexToUint8Array(commitmentData.commitment) }],
      });
      toast.success(`Deposit sent to ${pool.toUpperCase()} Pool!`);
    } catch {
      toast.error('Transaction rejected');
    }
    setLoading(false);
  };

  const indexDeposit = async () => {
    if (!commitmentData) return;
    setLoading(true);
    try {
      await axios.post(`${RELAYER_URL}/merkle/index`, {
        commitment: commitmentData.commitmentDecimal,
        depositor: userAddress,
        pool
      });
      toast.success('Deposit indexed');
    } catch {
      toast.error('Indexing failed');
    }
    setLoading(false);
  };

  // ==================== WITHDRAW ====================
  const submitWithdraw = async () => {
    if (!proof || !publicSignals || !recipient) return toast.error('Fill all fields');
    if (pool === 'token' && !tokenContract) return toast.error('Enter token contract address');

    setLoading(true);
    try {
      const payload = {
        proof: JSON.parse(proof),
        publicSignals: JSON.parse(publicSignals),
        recipient,
      };

      const endpoint = pool === 'stx' ? '/withdraw/stx' : '/withdraw/token';
      if (pool === 'token') payload.tokenContract = tokenContract;

      const res = await axios.post(`${RELAYER_URL}${endpoint}`, payload);

      setJobId(res.data.jobId);
      toast.success(`Job queued in ${pool.toUpperCase()} Pool`);
      pollJob(res.data.jobId);
    } catch {
      toast.error('Submit failed');
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
      } catch {}
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
              <button 
                onClick={() => setPool('stx')}
                className={`flex-1 py-4 rounded-2xl font-semibold transition ${pool === 'stx' ? 'bg-emerald-500 text-black' : 'bg-white/5 hover:bg-white/10'}`}
              >
                STX Pool
              </button>
              <button 
                onClick={() => setPool('token')}
                className={`flex-1 py-4 rounded-2xl font-semibold transition ${pool === 'token' ? 'bg-emerald-500 text-black' : 'bg-white/5 hover:bg-white/10'}`}
              >
                SIP-10 Token Pool
              </button>
            </div>

            <h2 className="text-4xl font-bold mb-8 text-center">
              {pool === 'stx' ? 'STX Pool' : 'SIP-10 Token Pool'}
            </h2>

            <div className="flex gap-2 mb-8">
              {['deposit', 'withdraw'].map(t => (
                <button 
                  key={t} 
                  onClick={() => setTab(t)} 
                  className={`px-8 py-3 rounded-2xl font-medium transition ${tab === t ? 'bg-emerald-500 text-black' : 'bg-white/5 hover:bg-white/10'}`}
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>

            {/* DEPOSIT */}
            {tab === 'deposit' && (
              <div className="space-y-8">
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
                    <div className="pt-6 grid grid-cols-2 gap-4">
                      <button onClick={depositOnChain} className="py-4 bg-white text-black rounded-2xl font-bold">Deposit to {pool.toUpperCase()} Pool</button>
                      <button onClick={indexDeposit} className="py-4 bg-white/10 hover:bg-white/20 rounded-2xl">Index in Pool</button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* WITHDRAW */}
            {tab === 'withdraw' && (
              <div className="space-y-8">
                <input value={recipient} onChange={e => setRecipient(e.target.value)} placeholder="Recipient address" className="w-full bg-black border border-white/10 rounded-2xl px-6 py-5 font-mono" />

                {pool === 'token' && (
                  <input value={tokenContract} onChange={e => setTokenContract(e.target.value)} placeholder="SIP-10 Token Contract Address" className="w-full bg-black border border-white/10 rounded-2xl px-6 py-5 font-mono" />
                )}

                <div>
                  <label className="block text-sm text-gray-400 mb-3">ZK Proof (JSON)</label>
                  <textarea value={proof} onChange={e => setProof(e.target.value)} rows={8} className="w-full bg-black border border-white/10 rounded-3xl p-6 font-mono text-xs" placeholder='{"pi_a": [...], ...}' />
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-3">Public Signals (JSON array)</label>
                  <textarea value={publicSignals} onChange={e => setPublicSignals(e.target.value)} rows={4} className="w-full bg-black border border-white/10 rounded-3xl p-6 font-mono text-xs" />
                </div>

                <button onClick={submitWithdraw} disabled={loading} className="w-full py-6 bg-gradient-to-r from-emerald-500 to-cyan-500 text-black font-bold text-xl rounded-2xl">
                  Withdraw from {pool.toUpperCase()} Pool
                </button>

                {jobStatus && <div className="mt-6 p-6 bg-black rounded-2xl font-mono text-sm">Job {jobId}: {jobStatus.state}</div>}
              </div>
            )}
          </div>
        </div>
      </section>

      <footer className="py-12 border-t border-white/10 text-center text-sm text-gray-500">
        Built on Stacks • Stackify 2026
      </footer>
    </div>
  );
}