import { PrismaClient } from '@prisma/client';

// Singleton instance
let prisma: PrismaClient;

export function getPrismaClient(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    });
  }
  return prisma;
}

export async function disconnectPrisma(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
  }
}

// Export types for convenience
export { Prisma } from '@prisma/client';
export type {
  Persona,
  Memory,
  EmotionalState,
  PersonaState,
  Relationship,
  Entity,
  MemoryType,
  ConsolidationState,
} from '@prisma/client';
