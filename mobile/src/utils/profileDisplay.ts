// mobile/src/utils/profileDisplay.ts
export const FOOT_LABELS: Record<string, string> = { left: 'Sinistro', right: 'Destro', both: 'Entrambi' };
export const ROLE_LABELS: Record<string, string> = { player: 'Giocatore', goalkeeper: 'Portiere', both: 'Entrambi' };

export function calculateAge(birthDate: string): number {
  const birth = new Date(birthDate);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}
