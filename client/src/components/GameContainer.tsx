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
      className={`min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center p-10 ${isExploding ? 'overflow-hidden' : ''}`}
    >
      {isExploding && (
        <div className="absolute inset-0 bg-red-500/20 z-0 pointer-events-none animate-pulse" />
      )}
      <div className={`z-10 w-full flex flex-col items-center ${difficulty === 'hardcore' ? 'max-w-[95vw]' : 'max-w-7xl'}`}>
        {children}
      </div>
    </motion.div>
  );
};

export default GameContainer;
