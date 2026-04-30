"use client";
import { motion } from 'framer-motion';
import { ReactNode } from 'react';

interface GameContainerProps {
  isExploding: boolean;
  children: ReactNode;
  difficulty?: string;
}

const GameContainer = ({ isExploding, children, difficulty }: GameContainerProps) => {
  return (
    <motion.div
      animate={isExploding ? { x: [-10, 10, -10, 10, 0], y: [-5, 5, -5, 5, 0] } : {}}
      transition={{ duration: 0.5 }}
      className={`min-h-screen text-white flex flex-col items-center justify-start pt-8 pb-16 px-6 relative ${isExploding ? 'overflow-hidden' : ''}`}
    >
      {/* Floating ambient blobs */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute top-[-10%] left-[-5%] w-[40rem] h-[40rem] rounded-full bg-cyan-500/15 blur-[120px] animate-float-blob" />
        <div className="absolute top-[30%] right-[-10%] w-[35rem] h-[35rem] rounded-full bg-violet-500/15 blur-[120px] animate-float-blob" style={{ animationDelay: '-4s' }} />
        <div className="absolute bottom-[-15%] left-[20%] w-[40rem] h-[40rem] rounded-full bg-emerald-500/10 blur-[120px] animate-float-blob" style={{ animationDelay: '-8s' }} />
      </div>

      {isExploding && (
        <div className="absolute inset-0 bg-rose-500/20 z-0 pointer-events-none animate-pulse" />
      )}
      <div className={`z-10 w-full flex flex-col items-center ${difficulty === 'hardcore' ? 'max-w-[95vw]' : 'max-w-7xl'}`}>
        {children}
      </div>
    </motion.div>
  );
};

export default GameContainer;
