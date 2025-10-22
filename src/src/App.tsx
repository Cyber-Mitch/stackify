import { useState } from "react";
import { Shield, Lock, Network, Code2, Award } from "lucide-react";
import { Button } from "./components/ui/button";
import { Badge } from "./components/ui/badge";
import { FeatureCard } from "./components/FeatureCard";
import { RoadmapItem } from "./components/RoadmapItem";
import { WaitlistDialog } from "./components/WaitlistDialog";
import { motion } from "motion/react";
import { ImageWithFallback } from "./components/figma/ImageWithFallback";

export default function App() {
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const features = [
    {
      icon: Shield,
      title: "zk-SNARK Privacy",
      description: "Generate cryptographic proofs without revealing transaction details. Your privacy is mathematically guaranteed."
    },
    {
      icon: Lock,
      title: "Built on Stacks",
      description: "Secure transactions. Leveraging Bitcoin's trust and security."
    },
    {
      icon: Network,
      title: "Relayer Network",
      description: "Decentralized relayers handle anonymous withdrawals, ensuring no single point of compromise."
    },
    {
      icon: Code2,
      title: "Developer Ready",
      description: "SDKs and APIs for integrating privacy into any dApp. Build the future of private DeFi."
    }
  ];

  const roadmapItems = [
    { quarter: "Q4 2025", description: "zk circuit design & Clarity contracts" },
    { quarter: "Q1 2026", description: "Testnet deployment" },
    { quarter: "Q2 2026", description: "Mainnet launch" },
    { quarter: "Beyond", description: "Ecosystem SDKs, audits, and relayer incentive layer" }
  ];

  return (
    <div className="dark min-h-screen bg-background text-foreground overflow-x-hidden">
      {/* Animated Background */}
      <div className="fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-gradient-to-br from-[#0a0a14] via-[#0f0f24] to-[#0a0a14]" />
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-[var(--stacks-purple)]/20 rounded-full blur-[120px] animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-[var(--zk-green)]/10 rounded-full blur-[120px] animate-pulse" style={{ animationDelay: "1s" }} />
      </div>

      {/* Hero Section */}
      <section className="relative min-h-screen flex items-center justify-center px-6 py-20">
        <div className="max-w-6xl mx-auto w-full">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="text-center space-y-8"
          >
            {/* Logo/Title */}
            <div className="inline-block">
              <h1 className="text-6xl md:text-8xl bg-gradient-to-r from-white via-[var(--stacks-purple)] to-[var(--zk-green)] bg-clip-text text-transparent mb-4">
                Stackify
              </h1>
            </div>

            {/* Headline */}
            <h2 className="text-4xl md:text-6xl">
              Privacy is Normal.
            </h2>

            {/* Subheadline */}
            <p className="text-xl md:text-2xl text-muted-foreground max-w-3xl mx-auto">
              Stackify is a zk-powered shielded pool bringing private, trustless transactions to the Stacks blockchain.
            </p>

            {/* CTA */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5, duration: 0.8 }}
              className="pt-4"
            >
              <Button
                size="lg"
                onClick={() => setWaitlistOpen(true)}
                className="bg-gradient-to-r from-[var(--stacks-purple)] to-[var(--zk-green)] hover:opacity-90 transition-opacity px-10 py-6 text-lg"
              >
                Join the Waitlist
              </Button>
            </motion.div>

            {/* Visual Element */}
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.8, duration: 1 }}
              className="relative mt-16"
            >
              <div className="relative w-64 h-64 mx-auto">
                {/* Animated Orb */}
                <div className="absolute inset-0 bg-gradient-to-br from-[var(--stacks-purple)] to-[var(--zk-green)] rounded-full blur-2xl opacity-50 animate-pulse" />
                <div className="absolute inset-4 bg-gradient-to-br from-[var(--stacks-purple)] to-[var(--zk-green)] rounded-full blur-xl opacity-70" />
                <div className="absolute inset-8 bg-background rounded-full border-2 border-[var(--stacks-purple)]/50 flex items-center justify-center">
                  <Shield className="w-20 h-20 text-[var(--zk-green)]" />
                </div>
                {/* Orbiting particles */}
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
                  className="absolute inset-0"
                >
                  <div className="absolute top-0 left-1/2 w-3 h-3 bg-[var(--stacks-purple)] rounded-full -translate-x-1/2" />
                  <div className="absolute bottom-0 left-1/2 w-3 h-3 bg-[var(--zk-green)] rounded-full -translate-x-1/2" />
                </motion.div>
              </div>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Cohort Banner */}
      <section className="px-6 py-4 border-y border-border bg-card/30 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="flex items-center justify-center gap-3"
          >
            <Award className="w-6 h-6 text-[var(--zk-green)]" />
            <p className="text-muted-foreground">
              Building the first zk-powered privacy layer for Stacks
            </p>
          </motion.div>
        </div>
      </section>

      {/* About Section */}
      <section className="px-6 py-24 md:py-32">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="text-center space-y-8"
          >
            <h2 className="text-4xl md:text-5xl">
              Built for Privacy. Powered by Zero Knowledge.
            </h2>
            <p className="text-xl text-muted-foreground max-w-4xl mx-auto">
              Stackify enables on-chain privacy without sacrificing transparency or security. Using zk-SNARKs, users can deposit, transact, and withdraw tokens anonymously — while maintaining verifiable cryptographic integrity on-chain.
            </p>

            {/* 3-step diagram */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 pt-12">
              {[
                { step: "1", title: "Deposit", desc: "Add tokens to the shielded pool" },
                { step: "2", title: "Shielded Pool", desc: "Transactions are mixed and private" },
                { step: "3", title: "Withdraw Anonymously", desc: "Extract tokens with zero trace" }
              ].map((item, i) => (
                <motion.div
                  key={item.step}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: i * 0.15 }}
                  className="relative"
                >
                  <div className="bg-card border border-border rounded-xl p-6 relative z-10">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[var(--stacks-purple)] to-[var(--zk-green)] flex items-center justify-center mx-auto mb-4">
                      <span className="text-xl">{item.step}</span>
                    </div>
                    <h3 className="mb-2">{item.title}</h3>
                    <p className="text-sm text-muted-foreground">{item.desc}</p>
                  </div>
                  {i < 2 && (
                    <div className="hidden md:block absolute top-1/2 -right-4 w-8 h-0.5 bg-gradient-to-r from-[var(--stacks-purple)] to-[var(--zk-green)] opacity-50" />
                  )}
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* Features Section */}
      <section className="px-6 py-24 md:py-32 bg-card/20">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="text-center mb-16"
          >
            <h2 className="text-4xl md:text-5xl mb-4">
              Features
            </h2>
            <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
              Enterprise-grade privacy infrastructure built for the Stacks ecosystem
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {features.map((feature, index) => (
              <FeatureCard
                key={feature.title}
                icon={feature.icon}
                title={feature.title}
                description={feature.description}
                index={index}
              />
            ))}
          </div>
        </div>
      </section>

      {/* Vision Section */}
      <section className="px-6 py-24 md:py-32">
        <div className="max-w-4xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="space-y-6"
          >
            <h2 className="text-4xl md:text-5xl">
              Why Stackify Exists
            </h2>
            <p className="text-xl text-muted-foreground leading-relaxed">
              Financial privacy is a human right. Stackify aims to make privacy a first-class feature on Stacks — empowering users, developers, and DAOs to transact freely and securely.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Roadmap Section */}
      <section className="px-6 py-24 md:py-32 bg-card/20">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="text-center mb-16"
          >
            <h2 className="text-4xl md:text-5xl mb-4">
              Roadmap
            </h2>
            <p className="text-xl text-muted-foreground">
              Our journey to bringing privacy to Stacks
            </p>
          </motion.div>

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-12 lg:gap-4 relative">
            {roadmapItems.map((item, index) => (
              <RoadmapItem
                key={item.quarter}
                quarter={item.quarter}
                description={item.description}
                index={index}
                isLast={index === roadmapItems.length - 1}
              />
            ))}
          </div>
        </div>
      </section>

      {/* Join the Movement Section */}
      <section className="px-6 py-24 md:py-32">
        <div className="max-w-4xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="space-y-8"
          >
            <h2 className="text-4xl md:text-5xl">
              Be Part of the Privacy Revolution
            </h2>
            <p className="text-xl text-muted-foreground">
              Developers, relayers, and users — privacy on Stacks starts with you.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-6 py-12 border-t border-border">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <h4 className="bg-gradient-to-r from-[var(--stacks-purple)] to-[var(--zk-green)] bg-clip-text text-transparent">
                Stackify
              </h4>
            </div>
            <p className="text-sm text-muted-foreground">
              Built with ❤️ on Stacks
            </p>
          </div>
        </div>
      </footer>

      {/* Waitlist Dialog */}
      <WaitlistDialog open={waitlistOpen} onOpenChange={setWaitlistOpen} />
    </div>
  );
}
