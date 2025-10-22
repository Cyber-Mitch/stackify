import { motion } from "motion/react";

interface RoadmapItemProps {
  quarter: string;
  description: string;
  index: number;
  isLast?: boolean;
}

export function RoadmapItem({ quarter, description, index, isLast }: RoadmapItemProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      whileInView={{ opacity: 1, scale: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, delay: index * 0.15 }}
      className="relative flex flex-col items-center"
    >
      <div className="w-4 h-4 rounded-full bg-gradient-to-br from-[var(--stacks-purple)] to-[var(--zk-green)] mb-4 relative z-10" />
      {!isLast && (
        <div className="absolute top-2 left-1/2 w-full h-0.5 bg-gradient-to-r from-[var(--stacks-purple)] to-[var(--zk-green)] opacity-30 hidden lg:block" />
      )}
      <div className="text-center max-w-xs">
        <div className="mb-2 bg-gradient-to-r from-[var(--stacks-purple)] to-[var(--zk-green)] bg-clip-text text-transparent">
          {quarter}
        </div>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
    </motion.div>
  );
}
