import { LucideIcon } from "lucide-react";
import { motion } from "motion/react";

interface FeatureCardProps {
  icon: LucideIcon;
  title: string;
  description: string;
  index: number;
}

export function FeatureCard({ icon: Icon, title, description, index }: FeatureCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, delay: index * 0.1 }}
      className="relative group"
    >
      <div className="absolute inset-0 bg-gradient-to-br from-[var(--stacks-purple)]/20 to-[var(--zk-green)]/20 rounded-2xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
      <div className="relative bg-card border border-border rounded-2xl p-8 h-full backdrop-blur-sm hover:border-[var(--stacks-purple)]/50 transition-colors duration-300">
        <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-[var(--stacks-purple)] to-[var(--zk-green)] flex items-center justify-center mb-6">
          <Icon className="w-7 h-7 text-white" />
        </div>
        <h3 className="mb-3">{title}</h3>
        <p className="text-muted-foreground">{description}</p>
      </div>
    </motion.div>
  );
}
