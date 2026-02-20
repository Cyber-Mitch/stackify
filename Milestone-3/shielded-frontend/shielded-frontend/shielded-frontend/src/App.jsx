import { useState, useEffect } from 'react';
import { connect, request, disconnect, isConnected } from '@stacks/connect';
import axios from 'axios';
import toast, { Toaster } from 'react-hot-toast';
import { Shield, LogOut, Users } from 'lucide-react';

const RELAYER_URL = 'http://localhost:3000';

export default function App() {
  const [userAddress, setUserAddress] = useState(null);
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
  const [jobId, setJobId] = useState(null);
  const [jobStatus, setJobStatus] = useState(null);

  // Status
  const [health, setHealth] = useState(null);

  // ==================== ALL FUNCTIONS FIRST ====================

  const fetchHealth = async () => {
    try {
      const res = await axios.get(`${RELAYER_URL}/health`);
      setHealth(res.data);
    } catch (e) {
      toast.error('Relayer offline');
    }
  };

  const handleConnect = async () => {
    try {
      const res = await connect();
      const addr = res.addresses?.stx?.[0]?.address || res.address;
      setUserAddress(addr);
      toast.success('Wallet connected');
    } catch (e) {
      toast.error('Connection cancelled');
    }
  };

  const handleDisconnect = () => {
    disconnect();
    setUserAddress(null);
    toast.success('Disconnected');
  };

  // DEPOSIT
  const generateNote = async () => {
    setLoading(true);
    try {
      const res = await axios.post(`${RELAYER_URL}/deposit/compute-commitment`, {
        nullifier: nullifier || undefined,
        secret: secret || undefined,
      });
      setCommitmentData(res.data.data);
      toast.success('Note generated — SAVE IT!');
    } catch (e) {
      toast.error('Failed');
    }
    setLoading(false);
  };

  const depositOnChain = async () => {
    if (!commitmentData || !userAddress) return toast.error('Generate note first');
    setLoading(true);
    try {
      await request('stx_callContract', {
        contractAddress: 'ST2RSFWY4AJTJXK4ECCDRYY96CWAM2DXMNME6RB9N',
        contractName: 'shielded-native-pool',
        functionName: 'deposit',
        functionArgs: [{ type: 'buffer', value: Buffer.from(commitmentData.commitment, 'hex') }],
      });
      toast.success('Deposit sent! Index it after confirmation.');
    } catch (e) {
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
        pool: 'stx'
      });
      toast.success('Deposit indexed');
      fetchHealth();
    } catch (e) {
      toast.error('Indexing failed');
    }
    setLoading(false);
  };

  // WITHDRAW
  const submitWithdraw = async () => {
    if (!proof || !publicSignals || !recipient) return toast.error('Fill all fields');
    setLoading(true);
    try {
      const res = await axios.post(`${RELAYER_URL}/withdraw/stx`, {
        proof: JSON.parse(proof),
        publicSignals: JSON.parse(publicSignals),
        recipient,
      });
      setJobId(res.data.jobId);
      toast.success(`Job queued #${res.data.jobId}`);
      pollJob(res.data.jobId);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Submit failed');
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
      } catch (e) {}
    }, 2500);
  };

  // ==================== useEffect (NOW SAFE) ====================
  useEffect(() => {
    if (isConnected()) {
      const data = JSON.parse(localStorage.getItem('stacksConnect') || '{}');
      setUserAddress(data.addresses?.stx?.[0]?.address || null);
    }
    fetchHealth();
  }, []);

  // ==================== JSX ====================
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

      {/* HERO */}
      <section className="pt-32 pb-20 relative flex items-center justify-center min-h-screen">
        <div className="absolute inset-0 bg-[radial-gradient(at_center,#22ff9922_0%,transparent_70%)]" />
        
        <div className="relative z-10 text-center px-6 max-w-4xl mx-auto">
          <div className="mb-8 flex justify-center">
            <div className="relative">
              <div className="w-40 h-40 bg-gradient-to-br from-cyan-400 to-emerald-400 rounded-full flex items-center justify-center animate-pulse">
                <Shield className="w-24 h-24 text-black" />
              </div>
              <div className="absolute inset-0 bg-cyan-400/30 blur-3xl rounded-full -z-10" />
            </div>
          </div>

          <h1 className="text-7xl md:text-8xl font-bold tracking-tighter mb-6">
            Privacy is <span className="bg-gradient-to-r from-cyan-400 to-emerald-400 bg-clip-text text-transparent">Normal</span>.
          </h1>
          <p className="text-xl text-gray-400 max-w-lg mx-auto">
            The first zk-powered shielded pool on Stacks.<br />Deposit, mix, withdraw anonymously.
          </p>

          <div className="mt-12 flex justify-center gap-4">
            <button 
              onClick={() => document.getElementById('app').scrollIntoView({ behavior: 'smooth' })} 
              className="px-10 py-4 bg-gradient-to-r from-cyan-500 to-emerald-500 text-black font-semibold rounded-2xl hover:scale-105 transition text-lg"
            >
              Launch App
            </button>
            <a href="#roadmap" className="px-10 py-4 border border-white/20 rounded-2xl hover:bg-white/5 transition">Roadmap →</a>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how" className="py-24 border-t border-white/10">
        <div className="max-w-5xl mx-auto px-6">
          <h2 className="text-5xl font-bold text-center mb-16">Built for Privacy. Powered by Zero Knowledge.</h2>
          
          <div className="grid md:grid-cols-3 gap-8">
            {[
              { num: "01", title: "Deposit", desc: "Send STX to the shielded pool. Your funds become anonymous." },
              { num: "02", title: "Shielded Pool", desc: "Funds are mixed with others using zk-SNARKs. No one can link deposits to withdrawals." },
              { num: "03", title: "Withdraw Anonymously", desc: "Withdraw to any address with a zero-knowledge proof. No trace." }
            ].map((step, i) => (
              <div key={i} className="bg-[#111113] border border-white/10 rounded-3xl p-8 hover:border-emerald-500/50 transition group">
                <div className="text-5xl font-mono text-emerald-400/30 group-hover:text-emerald-400 transition">{step.num}</div>
                <h3 className="text-3xl font-semibold mt-6 mb-3">{step.title}</h3>
                <p className="text-gray-400">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* THE APP */}
      <section id="app" className="py-20 bg-black/40 border-t border-b border-white/10">
        <div className="max-w-4xl mx-auto px-6">
          <div className="bg-[#0a0a0f] border border-white/10 rounded-3xl p-10">
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-4xl font-bold">Stackify Shielded Pool</h2>
              <div className="flex gap-2">
                {['deposit', 'withdraw', 'status'].map(t => (
                  <button 
                    key={t} 
                    onClick={() => setTab(t)} 
                    className={`px-6 py-2 rounded-2xl font-medium transition ${tab === t ? 'bg-emerald-500 text-black' : 'bg-white/5 hover:bg-white/10'}`}
                  >
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* DEPOSIT TAB */}
            {tab === 'deposit' && (
              <div className="space-y-8">
                <div className="grid md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm text-gray-400 mb-2">Nullifier (optional)</label>
                    <input 
                      value={nullifier} 
                      onChange={e => setNullifier(e.target.value)} 
                      className="w-full bg-black border border-white/10 rounded-2xl px-6 py-4 font-mono" 
                      placeholder="random" 
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-2">Secret (optional)</label>
                    <input 
                      value={secret} 
                      onChange={e => setSecret(e.target.value)} 
                      className="w-full bg-black border border-white/10 rounded-2xl px-6 py-4 font-mono" 
                      placeholder="random" 
                    />
                  </div>
                </div>

                <button 
                  onClick={generateNote} 
                  disabled={loading} 
                  className="w-full py-5 bg-gradient-to-r from-cyan-400 to-emerald-400 text-black font-bold text-xl rounded-2xl hover:scale-[1.02] transition"
                >
                  {loading ? 'Generating...' : 'Generate Private Note'}
                </button>

                {commitmentData && (
                  <div className="bg-black border border-emerald-500/30 rounded-3xl p-8 font-mono text-sm space-y-3">
                    <p className="text-emerald-400 font-bold">SAVE THIS NOTE FOREVER</p>
                    <div>Commitment: 0x{commitmentData.commitment}</div>
                    <div>Nullifier: {commitmentData.nullifier}</div>
                    <div>Secret: {commitmentData.secret}</div>
                    
                    <div className="pt-6 grid grid-cols-2 gap-4">
                      <button onClick={depositOnChain} className="py-4 bg-white text-black rounded-2xl font-bold">Deposit via Wallet</button>
                      <button onClick={indexDeposit} className="py-4 bg-white/10 hover:bg-white/20 rounded-2xl">Index in Pool</button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* WITHDRAW TAB */}
            {tab === 'withdraw' && (
              <div className="space-y-8">
                <input 
                  value={recipient} 
                  onChange={e => setRecipient(e.target.value)} 
                  placeholder="Recipient address (any ST...)" 
                  className="w-full bg-black border border-white/10 rounded-2xl px-6 py-5 font-mono" 
                />
                
                <div>
                  <label className="block text-sm text-gray-400 mb-3">ZK Proof (JSON)</label>
                  <textarea 
                    value={proof} 
                    onChange={e => setProof(e.target.value)} 
                    rows={8} 
                    className="w-full bg-black border border-white/10 rounded-3xl p-6 font-mono text-xs" 
                    placeholder='{"pi_a": [...], ...}' 
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-3">Public Signals (JSON array)</label>
                  <textarea 
                    value={publicSignals} 
                    onChange={e => setPublicSignals(e.target.value)} 
                    rows={4} 
                    className="w-full bg-black border border-white/10 rounded-3xl p-6 font-mono text-xs" 
                  />
                </div>

                <button 
                  onClick={submitWithdraw} 
                  disabled={loading} 
                  className="w-full py-6 bg-gradient-to-r from-emerald-500 to-cyan-500 text-black font-bold text-xl rounded-2xl"
                >
                  Submit Anonymous Withdrawal
                </button>

                {jobStatus && <div className="mt-6 p-6 bg-black rounded-2xl font-mono text-sm">Job {jobId}: {jobStatus.state}</div>}
              </div>
            )}

            {/* STATUS TAB */}
            {tab === 'status' && health && (
              <div className="grid grid-cols-2 gap-8">
                <div className="bg-black/60 p-8 rounded-3xl border border-white/10">
                  <div className="text-emerald-400 text-sm mb-2">POOL SIZE</div>
                  <div className="text-6xl font-mono font-bold">{health.pools.stx.deposits}</div>
                  <div className="text-gray-400">deposits • 1 STX each</div>
                </div>
                <div className="bg-black/60 p-8 rounded-3xl border border-white/10">
                  <div className="text-emerald-400 text-sm mb-2">RELAYER FEE</div>
                  <div className="text-6xl font-mono font-bold">0.5%</div>
                  <div className="text-gray-400">5000 microSTX per withdrawal</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" className="py-24">
        <div className="max-w-6xl mx-auto px-6 text-center">
          <h2 className="text-5xl font-bold mb-6">Enterprise-grade privacy infrastructure</h2>
          <div className="grid md:grid-cols-2 gap-6 mt-16">
            {[
              { icon: Shield, title: "zk-SNARK Privacy", desc: "Mathematical privacy. No one can link your deposit to your withdrawal." },
              { icon: Users, title: "Relayer Network", desc: "Decentralized relayers pay the gas. You stay completely anonymous." },
            ].map((f, i) => (
              <div key={i} className="bg-[#111113] border border-white/10 rounded-3xl p-10 text-left hover:border-emerald-400/50 transition">
                <f.icon className="w-12 h-12 text-emerald-400 mb-6" />
                <h3 className="text-2xl font-semibold mb-3">{f.title}</h3>
                <p className="text-gray-400">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="py-12 border-t border-white/10 text-center text-sm text-gray-500">
        Built with ❤️ on Stacks • Stackify 2026
      </footer>
    </div>
  );
}