import bcrypt from "bcryptjs";

const COST = 10;

// Hash fixo de uma string aleatória, usado para consumir o mesmo tempo de
// verificação quando o usuário não existe/está inativo. Evita user enumeration
// por diferença de latência (usuário inexistente retornava em ~0.1 ms enquanto
// senha errada levava ~80-100 ms do bcrypt.compare).
//
// IMPORTANTE: o cost do hash hardcoded ($2b$10$) DEVE bater com COST acima.
// Se subir COST (ex.: pra 12), regerar este hash com `bcrypt.hash("x", NOVO_COST)`
// e substituir abaixo, caso contrário o timing entre login válido e inválido
// fica descalibrado e o vetor de enumeration volta a ser explorável.
export const DUMMY_BCRYPT_HASH =
  "$2b$10$CwTycUXWue0Thq9StjUM0uJ8P3dZfQm5n4QeX2qE2N5MhOeqf6cLK";

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}
